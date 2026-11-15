import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The rogue-lite rest site (#1458, docs/specs/roguelite.md section 10), loaded through the test hook: Upgrade disabled with
// its reason when the army has no special marble, an upgrade picked, and the upgraded marbles on the board with a `+`.
// Seed 3: the fight 1 leads to the rest 3.
// Waits for a draw that began after this call (#435), so a screenshot shows the board as it stands.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const run = (state: object) => ({ seed: 3, army: 9, path: [1], fighting: false, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false, ...state });

test('the rogue-lite rest site: rest or upgrade one special marble, #1458', async ({ page }, testInfo) => {
  const panel = page.locator('#run-map');
  const line = panel.locator('.run-line');
  const hook = (state: object) => page.evaluate((s) => (window as any).__run(s), state);
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  await hook(run({}));
  await panel.locator('[data-node="3"]').click();
  await expect(line).toHaveText('Rest site · rest or upgrade');
  await expect(panel.locator('button[data-upgrade]')).toBeDisabled();
  await expect(panel.locator('button[data-upgrade]')).toHaveText('Upgrade: no special marble left to upgrade');
  await shot(page, { path: testInfo.outputPath('roguelite-rest-disabled.png') });

  await hook(run({ specials: [1, 1, 1] }));
  await panel.locator('[data-node="3"]').click();
  await expect(panel.locator('button[data-upgrade]')).toHaveCount(3);
  await shot(page, { path: testInfo.outputPath('roguelite-rest-choice.png') });
  await panel.getByRole('button', { name: /^Upgrade a Spark/ }).click();
  await expect(line).toHaveText('Rogue-lite run · rested · army 9 marbles, 1 Heavy, 1 Anchor, 1 Spark+ · pick a fight');

  // The three upgraded types on the board, the fight on: its first move closes the placement.
  const placed = [[0, 4, 4], [1, 3, 5], [-1, 3, 6]];
  await hook(run({ army: 14, path: [0], fighting: true, specials: [0, 0, 0, 1, 1, 1], placed }));
  await page.evaluate(() => {
    const w = window as any;
    w.__roll(0, 2);
    w.__roll(0, 1);
  });
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => document.body.dataset.specials)).toBe('-1,3,6 0,4,4 1,3,5');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('roguelite-upgraded.png') });
});
