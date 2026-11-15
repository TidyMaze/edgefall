import { expect, test } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// One mode at a time (#1275, docs/specs/ui.md): a mode left for another leaves nothing of itself on screen. The modes load
// through the test hooks (a royale file, the Open world fixture); src/main.modeswitch.test.ts covers every mode.

test('a boss fight and a battle royale left for the Hub leave no control and no marble behind, #1275', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#hud')).toContainText('Hub');
  await startMode(page, 'echo');
  await expect(page.locator('#boss-retry')).toBeVisible();
  await expect(page.locator('#boss-bar')).toBeVisible();
  await startMode(page, 'hub');
  await expect(page.locator('#hud')).toContainText('Hub');
  for (const id of ['#boss-retry', '#boss-goal', '#boss-bar']) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('#dock')).toBeHidden(); // the Hub at home has no dock (#1697)
  expect(await page.evaluate(() => document.body.dataset.boss)).toBeUndefined();
  await page.evaluate(() => (window as unknown as { __royale: (file: object) => void }).__royale({ seed: 7, rounds: [] }));
  await expect(page.locator('#royale-hold')).toBeVisible();
  await startMode(page, 'hub');
  await expect(page.locator('#hud')).toContainText('Hub');
  await expect(page.locator('#royale-hold')).toBeHidden();
  // The arena's marbles are drawn from their group, hidden arena or not: none is left to draw.
  expect(await page.evaluate(() => (window as unknown as { __seatGlyphs: () => number[] }).__seatGlyphs())).toEqual([0, 0, 0, 0, 0, 0]);
  const drawn = await page.evaluate(() => (window as never as { __drawNext: () => number }).__drawNext()); // under automation the loop draws when asked (#365)
  await expect.poll(() => page.evaluate(() => (window as never as { __draws: () => number }).__draws())).toBeGreaterThan(drawn);
  await shot(page, { path: process.env.MODE_SWITCH_SHOT ?? 'test-results/mode-switch-hub.png' });
});
