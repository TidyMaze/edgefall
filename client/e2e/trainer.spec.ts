import { expect, test } from '@playwright/test';
import { startMode } from './modes';
import { WAVE_1_WIN } from '../src/test/trainerline';

// Issue #1159: The Trainer starts at wave 1, one bot marble against the player's 14. A won wave shows
// its card, Next wave brings one more marble, and the test hook loads wave 5 directly. ?bot=off plays both sides by hand.
test('Trainer starts at wave 1, a won wave shows its card and Next wave adds a marble, the hook loads wave 5', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'trainer');
  await expect(page.locator('#hud')).toContainText('Trainer · wave 1 · best 0 · Marbles left 6/6');
  const whites = (): Promise<number> => page.evaluate(() => (window as any).__board().filter((c: number) => c === 2).length);
  expect(await whites()).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  await page.evaluate((moves) => (window as any).__playMoves(moves), WAVE_1_WIN);
  const card = page.locator('#trainer-card');
  await expect(card).toContainText('Wave 1 cleared');
  await expect(card).toContainText('Waves survived: 1');
  await expect(card).toContainText('Marbles left: 6/6');
  await expect(card).toContainText('Best: 1');
  await expect(card).toContainText('Wave 1 filed. Best on record: 1.');
  await page.getByRole('button', { name: 'Next wave' }).click();
  await expect(card).toBeHidden();
  await expect(page.locator('#hud')).toContainText('Trainer · wave 2 · best 1');
  expect(await whites()).toBe(2);

  await page.evaluate(() => (window as any).__trainer(5));
  await expect(page.locator('#hud')).toContainText('Trainer · wave 5 · best 1');
  await expect(page.locator('#hud')).toContainText('Drill: wave 5. Opponents: five. Seated.');
  expect(await whites()).toBe(5);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#hud')).toContainText('Trainer · wave 1 · best 1');
  expect(await whites()).toBe(1);
});
