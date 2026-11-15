import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The rogue-lite special marbles on screen (#961, docs/specs/roguelite.md section 6), loaded through the test hook: the
// placement screen places a Heavy that survives a reload, the three looks on the board, and the reward screen.
// Waits for a draw that began after this call (#435), so a screenshot shows the board as it stands.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const run = (state: object) => ({ seed: 7, army: 14, path: [0], fighting: true, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, ...state });

test('the rogue-lite special marbles: placement, looks and reward, #961', async ({ page }) => {
  const panel = page.locator('#run-map');
  const marks = () => page.evaluate(() => document.body.dataset.specials);
  await page.goto('./?bot=off');
  await page.waitForFunction(() => (window as any).__run);
  await page.evaluate((state) => (window as any).__run(state), run({ specials: [3, 2, 1] }));
  await expect(panel.locator('.run-line')).toHaveText('Place your special marbles');
  await panel.getByRole('button', { name: /Heavy/ }).click();
  await page.evaluate(() => (window as any).__roll(0, 4));
  await expect(panel.getByRole('button', { name: /Heavy/ })).toHaveText('Heavy · 2 left');
  await expect.poll(marks).toBe('0,4,1'); // set by the next draw
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-placement.png' });
  await page.reload();
  await page.waitForFunction(() => (window as any).__run);
  await expect(panel.locator('.run-line')).toHaveText('Place your special marbles');
  await expect.poll(marks).toBe('0,4,1'); // set by the next draw

  // The three looks, the fight on: its first move closes the placement.
  const placed = [[0, 4, 1], [-1, 4, 1], [1, 3, 2], [-2, 4, 2], [-2, 2, 3], [-1, 3, 3]];
  await page.evaluate((state) => (window as any).__run(state), run({ specials: [2, 2, 2], placed, moves: [] }));
  await page.evaluate(() => {
    const w = window as any;
    w.__roll(0, 2);
    w.__roll(0, 1);
  });
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await marks())!.split(' ').length).toBe(6);
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-specials.png' });

  await page.evaluate((state) => (window as any).__run(state), run({ army: 12, fighting: false, reward: true }));
  await expect(panel.locator('.run-line')).toHaveText('Fight won · pick a reward');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-reward.png' });
  await panel.locator('button[data-offer]').first().click();
  await expect(panel.locator('.run-line')).toContainText('pick a fight');
});
