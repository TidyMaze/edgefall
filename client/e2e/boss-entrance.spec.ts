import { expect, test, type Page } from '@playwright/test';
import { startBoss } from './modes';

// #1551: a boss fight opens with an entrance beat of about 1.5 s: a card with the boss and its deck, the camera and the light of its space coming in.
// It ends on its own, any press or key ends it at once, and reduced motion has none. ?entrance asks for it on a page under automation.
async function fight(page: Page, boss: string): Promise<void> {
  await page.goto('./?bot=off&entrance');
  await page.locator('canvas').waitFor();
  await startBoss(page, boss);
}

test('The Hull arrives with its card and ends on its own, the board playable after it, #1551', async ({ page }) => {
  await fight(page, 'The Hull');
  await expect(page.locator('body')).toHaveAttribute('data-entrance', 'rise');
  await expect(page.locator('#boss-entrance-name')).toHaveText('The Hull');
  await expect(page.locator('#boss-entrance-deck')).toHaveText('Cargo deck');
  await expect(page.locator('#boss-entrance')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-entrance', /.+/, { timeout: 8000 });
  await expect(page.locator('#boss-entrance')).toBeHidden();
  const moves = await page.evaluate(() => (window as any).__legal().length);
  expect(moves).toBeGreaterThan(0);
});

test('a key ends the beat of The Pulsar at once, #1551', async ({ page }) => {
  await fight(page, 'The Pulsar');
  await expect(page.locator('body')).toHaveAttribute('data-entrance', 'pull');
  await page.keyboard.press('Shift');
  await expect(page.locator('body')).not.toHaveAttribute('data-entrance', /.+/);
  await expect(page.locator('#boss-entrance')).toBeHidden();
});

test('reduced motion has no beat, #1551', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fight(page, 'The Choir');
  await expect(page.locator('body')).toHaveAttribute('data-boss', 'choir');
  await expect(page.locator('body')).not.toHaveAttribute('data-entrance', /.+/);
  await expect(page.locator('#boss-entrance')).toBeHidden();
});
