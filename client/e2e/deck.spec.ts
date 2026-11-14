import { expect, test } from '@playwright/test';
import { deckOf } from '../src/deck';
import { openModes, startBoss } from './modes';

// #400: each mode and boss plays on its deck (docs/specs/world.md sections 1, 3 and 5), named in body[data-deck].
// body[data-deck-set] names the deck whose texture set the cells wear (#401). The light and the texture of each deck are
// judged by the art director on captures.

test('hot-seat, each boss and online play on their decks, #400', async ({ page }) => {
  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-deck', 'mess');
  await expect(body).toHaveAttribute('data-deck-set', 'mess');
  for (const [boss, deck] of [
    ['The Echo', 'mess'],
    ['The Hull', 'cargo'],
    ['The Choir', 'furnace'],
    ['The Chaplain', 'chapel'],
  ] as const) {
    await startBoss(page, boss);
    await expect(body).toHaveAttribute('data-deck', deck);
    await expect(body).toHaveAttribute('data-deck-set', deck);
  }
  await openModes(page);
  await page.locator('#play-online').click();
  await expect(body).toHaveAttribute('data-deck', 'cargo');
  await expect(body).toHaveAttribute('data-deck-set', 'cargo');
});

test('the bot plays at the Mess, the daily on the deck of its boss, #400', async ({ page }) => {
  await page.goto('./?bot=on');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-deck', 'mess');
  await openModes(page);
  await page.locator('#daily').click();
  const boss = await page.evaluate(() => (window as any).__fight().id as string);
  await expect(body).toHaveAttribute('data-deck', deckOf('boss', boss));
});
