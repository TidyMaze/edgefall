import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The Magnetizer (#645, #671, game-design.md section 7.9) from the fixture of the core tests: fight seed 120 and ?bot=off,
// so the test plays both sides through the click hook. Quiet boss moves on the right; the player walks the centre
// column up. The starts of turns 3 and 6 polarize two of its marbles, + then −, each announced a turn ahead; on turn
// 6 the second steps next to the first, which shoves the boss column of 3 off at (0, -4), and both lose their sign.
// Three marbles in line then push the rest of the column off twice: P2. The screenshots are kept for the report.

type Axial = [number, number];
type Pole = { cell: Axial; sign: number; fresh: boolean };
const NE = 2;
const SW = 3;
const NW = 4;
const SE = 5;
const FIXTURE: [Axial[], number][] = [
  [[[0, 2]], NW], [[[4, -3]], SE], [[[0, 1]], NW], [[[4, -2]], SE], [[[0, 0]], NW], [[[4, -1]], SE], [[[0, 3]], NW],
  [[[3, -3]], SE], [[[0, 2]], NW], [[[3, -2]], SE], [[[0, 1]], NW], [[[4, -4]], SE], [[[0, 1]], NW], [[[4, -3]], SE],
  [[[0, 0]], NW], [[[3, -4]], SE], [[[-1, 2]], NE], [[[3, -3]], SE], [[[0, 1]], NW], [[[4, -2]], SE],
  [[[0, -2], [0, -1], [0, 0]], NW], [[[4, 0]], SW], [[[0, -3], [0, -2], [0, -1]], NW],
];

const poles = (page: Page) => page.evaluate(() => (window as any).__polarities()) as Promise<Pole[]>;

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

async function startMagnetizer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(120)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the setup slides take no time
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'magnetizer');
  await expect(page.locator('#boss-bar .name')).toContainText('The Magnetizer');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'furnace');
}

/** Plies `from` to `to` (excluded) of the fixture, each after the slides of the one before: its marbles, then the cell in
 * front of the first one. */
async function plies(page: Page, from: number, to: number): Promise<void> {
  for (const [cells, dir] of FIXTURE.slice(from, to)) {
    await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
    await page.evaluate(
      ([marbles, d]) => {
        const step = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]][d as number]!;
        const group = marbles as Axial[];
        for (const [q, r] of group) (window as any).__click(q, r);
        (window as any).__click(group[0]![0] + step[0]!, group[0]![1] + step[1]!);
      },
      [cells, dir] as const,
    );
  }
  await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
}

test('The Magnetizer: the next polarity is announced over its marble a turn ahead, #671', async ({ page }, testInfo) => {
  await startMagnetizer(page);
  await expect(page.locator('#hud .boss .tell')).toHaveText('Polarity in 2 turns');
  await plies(page, 0, 2);
  await expect(page.locator('#hud .boss .tell')).toHaveText('Polarity next turn');
  const coming = (await page.evaluate(() => (window as any).__announce())) as { cell: Axial; sign: number };
  expect(Math.abs(coming.sign)).toBe(1);
  await page.mouse.move(2, 2); // no hover ghost
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('magnetizer-announce.png') });
  await plies(page, 2, 4);
  const [first] = await poles(page);
  expect(first!.sign).toBe(coming.sign);
  expect(first!.fresh).toBe(true);
});

test('The Magnetizer: a + moved next to a − repels and shoves a boss line of 3, ejecting one, both lose their glyph, #645 #671', async ({ page }, testInfo) => {
  const hud = page.locator('#hud');
  await startMagnetizer(page);
  await plies(page, 0, 10);
  const signs = Object.fromEntries((await poles(page)).map((p) => [String(p.cell), p.sign]));
  expect(signs['0,-1']).toBe(-signs['0,1']!);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); // the repulsion plays
  await page.mouse.move(2, 2); // no hover ghost
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('magnetizer-before.png') });
  await plies(page, 10, 11); // the second marble steps next to the first
  await expect(page.locator('body')).toHaveAttribute('data-repulsions', '1');
  await expect(hud).toContainText('1/6');
  expect(await poles(page)).toEqual([]); // the pair is spent
  await page.waitForFunction(() => !document.body.dataset.ejecting); // the marble fell
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('magnetizer-after.png') });
});

test('The Magnetizer: the phase changes after 3 ejections, #645', async ({ page }) => {
  await startMagnetizer(page);
  await plies(page, 0, 23);
  await expect(page.locator('#hud')).toContainText('3/6');
  await expect(page.locator('#hud .boss .tell')).toHaveText('Polarity in 3 turns'); // turn 12 of P2: the next one is turn 15 (#1237)
});

test('The Magnetizer: the announced marble blinks in opacity, with reduced motion it wears a steady outline, #741', async ({ page }, testInfo) => {
  await startMagnetizer(page);
  await plies(page, 0, 2);
  await page.mouse.move(2, 2);
  await freshDraw(page);
  await expect(page.locator('body')).toHaveAttribute('data-announce-blink', '1.00'); // steady
  await shot(page, { path: testInfo.outputPath('magnetizer-outline.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const seen = await page.evaluate(async () => {
    const values: number[] = [];
    for (let n = 0; n < 12; n++) {
      values.push(Number(document.body.dataset.announceBlink));
      await new Promise((done) => setTimeout(done, 100));
    }
    return values;
  });
  expect(Math.min(...seen)).toBeLessThan(0.5);
  expect(Math.max(...seen)).toBeGreaterThan(0.9);
  await page.waitForFunction(() => Number(document.body.dataset.announceBlink) < 0.45);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('magnetizer-blink.png') });
});
