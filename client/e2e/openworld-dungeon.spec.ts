import { expect, test } from '@playwright/test';
import { clickHud, enterBay, lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1291: the Dungeon button walks the hero to the nearest tower. The test hook stands the hero a few cells from a lair (no 150-cell
// walk); the press walks the rest and the step onto the lair starts the boss fight.
test('the Dungeon button walks the hero to the nearest tower and the fight starts, #1291', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
  const lairs = (await page.evaluate(() => document.body.dataset.openworldLairs))!.split(' ');
  const [q, r] = lairs[0]!.split(',').map(Number) as [number, number];
  await page.evaluate(
    ([q, r]) => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 4, r], troop: [], enemies: [] }),
    [q, r],
  );
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe(`${q - 4},${r}`);
  await shot(page, { path: process.env.DUNGEON_SHOT ?? 'test-results/dungeon.png' });
  await clickHud(page, '#openworld-dungeon');
  await enterBay(page);
  await expect(page.locator('#openworld-dungeon-note')).toHaveText('');
  await expect(page.locator('body')).toHaveAttribute('data-boss', /.+/);
});
