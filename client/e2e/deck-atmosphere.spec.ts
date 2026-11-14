import { expect, test } from '@playwright/test';
import { openModes, startBoss } from './modes';

// The deck atmospheres themselves (data-deck per mode and boss) are checked in deck.spec.ts. There is no ?deck= URL.
test('the Mess Deck bay is complete once the page has loaded (#660)', async ({ page }) => {
  await page.goto('./?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'mess');
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready'); // the room is complete (#661)
});

test('the clear board setting is on after a click (#665)', async ({ page }) => {
  await page.goto('./?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'off');
  await page.locator('#settings').click();
  await page.locator('#setting-clear-board').click();
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');
});

// #1551: each deck stands one silhouette prop in the surround of its board (deckprop.ts); the hub's board has none. Its shape, its place in the window and
// that it hides no cell are unit tests (deckprop.test.ts): here the page marks it drawn on every deck of a fight and not at the hub.
test('the deck prop stands by the board of each deck and not by the hub, #1551', async ({ page }) => {
  await page.goto('./?bot=off');
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-deck-prop', 'true');
  for (const [boss, deck] of [['The Hull', 'cargo'], ['The Choir', 'furnace'], ['The Chaplain', 'chapel'], ['The Pulsar', 'bridge']] as const) {
    await startBoss(page, boss);
    await expect(body).toHaveAttribute('data-deck', deck);
    await expect(body).toHaveAttribute('data-deck-prop', 'true');
  }
  await openModes(page);
  await page.getByRole('button', { name: 'Hub', exact: true }).click();
  await expect(body).toHaveAttribute('data-deck-prop', 'false');
});
