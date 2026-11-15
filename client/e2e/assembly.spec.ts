import { expect, test, type Page } from '@playwright/test';
import { startBoss } from './modes';
import { shot } from './shot';

// The Assembly Line (#744, game-design.md section 7.12) from the fixture of the core tests: fight seed 1 and ?bot=off, so
// the test plays both sides through the click hook. The centre belt first runs toward +q: a boss marble falls off its east
// end after ply 7, the belt reverses after the player's 5th move (ply 9), P2 starts after ply 19 and P3 after ply 29; the
// presses are announced after ply 31 and strike a marble of the player after ply 33. The screenshots are kept for the report.

const [E, W, NE, SW, NW, SE] = [0, 1, 2, 3, 4, 5];
const FIXTURE: [number, number, number][] = [
  [-4, 3, NE], [2, -2, SE], [-4, 4, NW], [2, -1, SE], [-4, 3, NW], [3, 0, E], [-4, 2, SE], [0, -2, SW], [-4, 3, NW],
  [-1, -1, SW], [-4, 2, SE], [-3, 0, W], [-4, 3, NW], [-1, -3, SW], [-4, 2, SE], [-2, -2, SW], [-4, 3, NW], [-3, -1, SW],
  [-4, 2, SE], [1, -2, SW], [-4, 3, NW], [-1, -1, W], [-4, 2, SE], [0, -3, SW], [-4, 3, NW], [-1, -2, SW], [-4, 2, SE],
  [1, -3, SW], [-4, 3, NW], [0, -4, SW], [-4, 2, NE], [-1, -3, E], [-3, 2, NW],
];

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

async function startAssembly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(1)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startBoss(page, 'The Assembly Line');
  await expect(page.locator('#boss-bar .name')).toContainText('The Assembly Line');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'cargo');
  await page.mouse.move(2, 2); // no hover ghost
}

/** Plies `from` to `to` (excluded) of the fixture, each after the slides of the one before. */
async function plies(page: Page, from: number, to: number): Promise<void> {
  for (const [q, r, dir] of FIXTURE.slice(from, to)) {
    await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
    await page.evaluate(
      ([cq, cr, d]) => {
        const step = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]][d]!;
        (window as any).__roll(cq, cr);
        (window as any).__roll(cq + step[0]!, cr + step[1]!);
      },
      [q, r, dir],
    );
  }
}

const marbleAt = (page: Page, q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__marbleTurn(cq, cr) !== null, [q, r]);
const outPips = (page: Page) => page.locator('#hud .pips > span').evaluateAll((sides) => sides.map((s) => s.querySelectorAll('.out').length));

test('The Assembly Line: a boss marble is carried to the east end of the centre belt and falls off, credited to the player, #744', async ({ page }, testInfo) => {
  const body = page.locator('body');
  await startAssembly(page);
  await expect(page.locator('#hud .boss .tell')).toHaveText('Belts reverse in 5 turns');
  await expect(body).toHaveAttribute('data-belt-dirs', '1,0,0'); // only the centre belt runs, toward +q
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-start.png') });
  await plies(page, 0, 6);
  expect(await marbleAt(page, 4, 0)).toBe(true); // a boss marble waits on the east end
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-before.png') });
  await plies(page, 6, 7); // the player's 4th move: the belt carries the boss marble off the east end
  await expect(body).toHaveAttribute('data-belt-turns', '2');
  expect(await outPips(page)).toEqual([1, 0]); // the boss marble counts for the player
  expect(await marbleAt(page, 4, 0)).toBe(false);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-after.png') });
});

test('The Assembly Line: the counter of the centre belt runs down to its reversal, then the chevrons turn, #744', async ({ page }, testInfo) => {
  const body = page.locator('body');
  const tell = page.locator('#hud .boss .tell');
  await startAssembly(page);
  await plies(page, 0, 7);
  await expect(body).toHaveAttribute('data-belt-counter', '1'); // the next move is the last toward +q
  await expect(tell).toHaveText('Belts reverse in 1 turn');
  await plies(page, 7, 9);
  await expect(body).toHaveAttribute('data-belt-counter', '5');
  await expect(body).toHaveAttribute('data-belt-dirs', '-1,0,0'); // reversed
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-reversed.png') });
});

test('The Assembly Line: in P3 a press is announced, blinks a turn ahead on its slot and strikes the marble on it, #744', async ({ page }, testInfo) => {
  const body = page.locator('body');
  await startAssembly(page);
  await plies(page, 0, 31);
  await expect(page.locator('#hud .notch.active')).toHaveText('P3'); // after 5 ejections
  await expect(body).toHaveAttribute('data-belt-strikes', '0,7,1'); // one announced cell per belt
  await expect(page.locator('#hud .boss .tell')).toContainText('press strikes next turn');
  expect(await page.evaluate(() => (window as any).__belts().belts.map((b: { dir: number }) => b.dir))).toEqual([-1, 1, 1]);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-announced.png') });
  expect(await outPips(page)).toEqual([5, 0]);
  await plies(page, 31, 33); // the boss ply, then the player's marble on the lower belt, where the press strikes it
  await expect(body).toHaveAttribute('data-burns', '1');
  expect(await outPips(page)).toEqual([5, 1]); // yours counts for the boss
  expect(await marbleAt(page, -2, 1)).toBe(false);
  await expect(body).toHaveAttribute('data-belt-strikes', '-1,-1,-1');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('assembly-struck.png') });
});
