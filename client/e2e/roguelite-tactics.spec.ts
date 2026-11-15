import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The rogue-lite tactics (#1460, docs/specs/roguelite.md section 11), loaded through the test hook: the tactic bar in the
// fight HUD, Reinforce putting a marble on the back row, Freeze making the bot skip its turn, and a reward offering a tactic.
// Seed 3: the fight 0 is the first row of act 1.
// Waits for a draw that began after this call (#435), so a screenshot shows the board as it stands.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const run = (state: object) => ({ seed: 3, army: 12, path: [0], fighting: true, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false, ...state });

test('the rogue-lite tactics: the bar, Reinforce, Freeze and a reward offering one, #1460', async ({ page }, testInfo) => {
  const bar = page.locator('#hud .tactics button');
  const panel = page.locator('#run-map');
  const hook = (state: object) => page.evaluate((s) => (window as any).__run(s), state);
  const army = () => page.evaluate(() => ((window as any).__board() as number[]).filter((c) => c === 1).length);
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  await hook(run({ tactics: [1, 2, 4] }));
  await expect(page.locator('body')).toHaveAttribute('data-run', 'fight');
  await expect(bar).toHaveCount(3);
  await expect(bar.nth(0)).toHaveAttribute('title', /^Reinforce: /);
  await expect(bar.nth(0)).toBeEnabled();
  await expect(bar.nth(2)).toBeDisabled(); // nothing to fall back on yet
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('roguelite-tactics-hud.png') });

  expect(await army()).toBe(12);
  await bar.nth(0).click(); // Reinforce
  expect(await army()).toBe(13);
  await expect(bar).toHaveCount(2);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('roguelite-tactics-reinforce.png') });

  await bar.nth(0).click(); // Freeze
  await page.evaluate(() => {
    const w = window as any;
    w.__roll(0, 2);
    w.__roll(0, 1);
  });
  await expect(page.locator('#hud')).toContainText('turn passed');
  expect(await page.evaluate(() => (window as any).__plies())).toBe(3); // Reinforce, Freeze, the move
  await expect(bar).toHaveCount(1);
  await expect(bar.first()).toBeEnabled(); // Fall back, now there is a move to undo

  await hook(run({ path: [0], fighting: false, reward: true, tactics: [1] }));
  await expect(page.locator('body')).toHaveAttribute('data-run', 'reward');
  await expect(panel.locator('button[data-tactic-offer]')).toHaveCount(1);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('roguelite-tactics-reward.png') });
  await panel.locator('button[data-tactic-offer]').click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'map');
  await expect(page.locator('body')).toHaveAttribute('data-tactics', /^1,[1-4]$/);
});
