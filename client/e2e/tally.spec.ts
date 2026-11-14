import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// Tally's line at the start of a match (#294): one line in the HUD plate, gone after the first move.

test('a local game starts with its goal line, the first move takes it off the plate', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud .tally')).toHaveText('Two players, one board. Eject 6 to win.');

  const p = await page.evaluate(() => (window as any).__cellToScreen(0, 2));
  await page.mouse.click(p.x, p.y);
  const q = await page.evaluate(() => (window as any).__cellToScreen(0, 1));
  await page.mouse.click(q.x, q.y);

  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('#hud .tally')).toHaveCount(0);
});

test('a boss fight starts with the line of its boss', async ({ page }) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  await startMode(page, 'echo');

  await expect(page.locator('#hud .tally')).toHaveText('Mirror logged. Six out to balance the books.'); // #1038: the boss bar names the boss, the line keeps its flavour
});
