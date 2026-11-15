import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The cues of the rogue-lite Bomb and Magnet on screen (#1490, docs/specs/roguelite.md section 13), loaded through the test
// hook: a Bomb shows its fuse on its marble and in the HUD, a Magnet's pull slides the marble it pulls.
const load = async (page: Page, specials: number[], placed: number[][], moves: number[][]) => {
  await page.goto('./?bot=off');
  await page.waitForFunction(() => (window as any).__run);
  await page.evaluate((state) => (window as any).__run(state), { seed: 3, army: 14, path: [1, 4, 7], fighting: true, moves, end: '', specials, placed, reward: false });
};
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const body = (page: Page, key: string) => page.evaluate((k) => document.body.dataset[k], key);
const click = (page: Page, cells: number[][]) => page.evaluate((all) => all.forEach(([q, r]) => (window as any).__roll(q, r)), cells);

test('a Bomb shows its fuse on the marble and in the HUD, one turn less after a move, #1490', async ({ page }) => {
  await load(page, [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], [[0, 4, 9]], []);
  expect(await body(page, 'fuses')).toBe('0,4,3');
  await expect(page.locator('#hud')).toContainText('Bomb: 3 turns left');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-bomb-fuse.png' });
  await click(page, [[-2, 2], [-3, 2]]);
  expect(await body(page, 'fuses')).toBe('0,4,2');
  await expect(page.locator('#hud')).toContainText('Bomb: 2 turns left');
});

test('a Magnet that moved pulls the enemy marble two cells away, which slides to its new cell, #1490', async ({ page }) => {
  // Four plies, then the Magnet steps from (1, 1) to (1, 0): the white marble on (1, -2) comes to (1, -1).
  const one = (q: number, r: number, dir: number) => [1, dir, q, r, 0, 0, 0, 0];
  await load(page, [0, 0, 0, 0, 0, 0, 1, 0, 0, 0], [[0, 2, 7]], [one(-4, 3, 2), one(0, -4, 3), one(0, 2, 2), one(1, -3, 5)]);
  expect(await body(page, 'pulls')).toBeUndefined();
  await click(page, [[1, 1], [1, 0]]);
  expect(await body(page, 'pulls')).toBe('1');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-magnet-pull.png' });
  await page.waitForFunction(() => document.body.dataset.sliding === undefined); // the pulled marble has arrived
});
