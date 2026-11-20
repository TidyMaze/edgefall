import { expect, test } from '@playwright/test';
import { lowTierOnCi } from './modes';

lowTierOnCi();

// #1506: the troop herds a foe three cells from the water in. Seed 1: the foe on (9,-260) has the water on (12,-263) three cells away (north-east; #1755 moved the shore 230 rows north);
// the hero beside it pushes it along the sand, hero step after step, until the shove of #1504 drops it. The state comes from the test hook.
test('a foe three cells from the water is herded in within a few hero steps, #1506', async ({ page }) => {
  await page.goto('./?bot=off&openworld=1');
  await page.locator('canvas[aria-label="Edgefall board"]').waitFor();
  const data = (key: string) => page.evaluate((k) => document.body.dataset[k], key);
  const enemies = () => page.evaluate(() => (window as unknown as { __openworldEnemies: () => number[][] }).__openworldEnemies());
  await expect.poll(() => data('openworldAt')).toBe('0,0');
  await page.evaluate(() => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [7, -259], troop: [[6, -259], [6, -260], [7, -260], [8, -259]], enemies: [[9, -260]] }));
  await expect.poll(() => data('openworldAt')).toBe('7,-259');
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
  for (const key of keys) {
    if ((await enemies()).length === 0) break;
    await page.keyboard.press(key);
  }
  await expect.poll(enemies).toEqual([]);
  expect(await data('openworldBeaten')).toBe('1');
});
