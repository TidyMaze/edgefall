import { expect, test } from '@playwright/test';
import { lowTierOnCi } from './modes';

lowTierOnCi();

// #1506: the troop herds a foe three cells from the water in. Seed 1: the foe on (137,-220) has the water on (140,-223) three cells away (north-east; #1763 moved the shore);
// the hero beside it pushes it along the sand, hero step after step, until the shove of #1504 drops it. The state comes from the test hook.
test('a foe three cells from the water is herded in within a few hero steps, #1506', async ({ page }) => {
  await page.goto('./?bot=off&openworld=1');
  await page.locator('canvas[aria-label="Edgefall board"]').waitFor();
  const data = (key: string) => page.evaluate((k) => document.body.dataset[k], key);
  const enemies = () => page.evaluate(() => (window as unknown as { __openworldEnemies: () => number[][] }).__openworldEnemies());
  await expect.poll(() => data('openworldAt')).toBe('0,0');
  await page.evaluate(() => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [135, -219], troop: [[134, -219], [134, -220], [135, -220], [136, -219]], enemies: [[137, -220]] }));
  await expect.poll(() => data('openworldAt')).toBe('135,-219');
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
  for (const key of keys) {
    if ((await enemies()).length === 0) break;
    await page.keyboard.press(key);
  }
  await expect.poll(enemies).toEqual([]);
  expect(await data('openworldBeaten')).toBe('1');
});
