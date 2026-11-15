import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The rogue-lite Magnet, Shield, Bomb and Medic on screen (#1461, docs/specs/roguelite.md section 13), loaded through the
// test hook: the placement screen lists the four, the first move closes it, the four glyphs are on the board and the
// fight resumes with them after a reload.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const placed = [[-2, 2, 7], [-1, 2, 8], [0, 2, 9], [-1, 3, 10]];
const run = { seed: 7, army: 14, path: [0], fighting: true, moves: [], end: '', specials: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1], placed, reward: false };

test('the rogue-lite Magnet, Shield, Bomb and Medic: placement, looks and reload, #1461', async ({ page }) => {
  const panel = page.locator('#run-map');
  const marks = () => page.evaluate(() => document.body.dataset.specials);
  await page.goto('./?bot=off');
  await page.waitForFunction(() => (window as any).__run);
  await page.evaluate((state) => (window as any).__run(state), run);
  await expect(panel.locator('.run-line')).toHaveText('Place your special marbles');
  await expect(panel.locator('button[data-kind]')).toHaveText(['Magnet · 0 left', 'Shield · 0 left', 'Bomb · 0 left', 'Medic · 0 left']);
  await page.evaluate(() => {
    const w = window as any;
    w.__roll(1, 3);
    w.__roll(1, 2);
  });
  await expect(panel).toBeHidden();
  expect(await marks()).toBe('-2,2,7 -1,2,8 -1,3,10 0,2,9');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-new-specials.png' });
  await page.reload();
  await page.waitForFunction(() => (window as any).__run);
  await expect(panel).toBeHidden();
  expect(await marks()).toBe('-2,2,7 -1,2,8 -1,3,10 0,2,9');
});
