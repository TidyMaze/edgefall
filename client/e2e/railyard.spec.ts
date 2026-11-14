import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The Rail Yard (#626, game-design.md section 7.8) from a fixture: fight seed 77 and ?bot=off, so the test plays both
// sides with quiet moves through the click hook. The first train is announced at the end of the player's turn 1 on the diagonal q + r = 0,
// from (4, -4) to (-4, 4), where 3 marbles of each side sit. The screenshots are kept for the report.

type Axial = [number, number];
type Train = { line: number; left: number; cells: Axial[]; dir: number };

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

async function startRailYard(page: Page, reducedMotion: boolean): Promise<void> {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(77)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'railyard');
  await expect(page.locator('#boss-bar .name')).toContainText('The Rail Yard');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'cargo');
}

/** `n` quiet plies in one call to the page: the first one-marble move of the side to move that starts and ends off
 * every announced line. */
const quiet = (page: Page, n: number) =>
  page.evaluate((count) => {
    const w = window as any;
    const DIRS = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
    for (let i = 0; i < count; i++) {
      const rails = w.__trains().flatMap((t: Train) => t.cells.map(String));
      const to = (m: { cells: Axial[]; dir: number }) => [m.cells[0]![0] + DIRS[m.dir]![0]!, m.cells[0]![1] + DIRS[m.dir]![1]!];
      const mv = w.__legal().find(
        (m: { cells: Axial[]; dir: number }) => m.cells.length === 1 && !rails.includes(String(m.cells[0])) && !rails.includes(String(to(m))),
      );
      w.__click(...mv.cells[0]);
      w.__click(...to(mv));
    }
  }, n);

const outPips = (page: Page) => page.locator('#hud .pips > span').evaluateAll((sides) => sides.map((s) => s.querySelectorAll('.out').length));

test('The Rail Yard: an announced train counts down, passes, sweeps both sides off its line, then P2, #626', async ({ page }, testInfo) => {
  const body = page.locator('body');
  await startRailYard(page, true);
  await expect(body).toHaveAttribute('data-trains', '0'); // none at the start
  await quiet(page, 1); // the end of the player's turn 1
  await expect(body).toHaveAttribute('data-trains', '1');
  await expect(body).toHaveAttribute('data-train-counters', '5');
  await expect(page.locator('#hud .boss .tell')).toHaveText('Trains pass: 1 in 5 turns');
  expect(await page.evaluate(() => (window as any).__trains().map((t: Train) => [t.line, t.cells[0]]))).toEqual([[22, [4, -4]]]);
  await page.mouse.move(2, 2); // no hover ghost
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('railyard-announced.png') });
  await quiet(page, 1);
  await expect(body).toHaveAttribute('data-train-counters', '5'); // not after the boss move
  await quiet(page, 1);
  await expect(body).toHaveAttribute('data-train-counters', '4'); // down after the player move
  await quiet(page, 7);
  await expect(body).toHaveAttribute('data-train-counters', '1');
  await expect(page.locator('#hud .notch.active')).toHaveText('P1');
  expect(await outPips(page)).toEqual([0, 0]);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('railyard-on-1.png') });
  await quiet(page, 1); // the player's 6th move: the train passes
  await expect(body).toHaveAttribute('data-trains', '0');
  await expect(body).toHaveAttribute('data-passing', '0');
  expect(await outPips(page)).toEqual([3, 3]); // 3 boss marbles for the player, 3 of the player's for the boss
  await expect(page.locator('#hud .notch.active')).toHaveText('P2'); // after 3 ejections
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('railyard-swept.png') });
});
