import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

// #1176: the hero and the troop of the Open world wear the player's marble skin of the ship, the enemies the shell skin. The test hook
// stands the state up (no walk). The hero is at the centre of the screen: the old glossy blue marble read bluer than red by about 22 of
// 255, the default Marble skin is neutral (about 3).
test('the hero of the Open world wears the ship skin, not the glossy blue marble, #1176', async ({ page }) => {
  // look=terrace: the neon default (#1424) paints the player's cyan ring, which is blue over red by design; this pins the terrace colours.
  await page.goto('./?bot=off&openworld=7&look=terrace');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
  await page.evaluate(() =>
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [8, 0], troop: [[7, 0], [7, 1]], enemies: [[10, 0], [10, -1]] }),
  );
  await page.waitForTimeout(1500); // the camera settles and the skin maps are on
  const { width, data } = PNG.sync.read(await page.screenshot({ clip: { x: 632, y: 350, width: 16, height: 16 } }));
  let blueOverRed = 0;
  for (let i = 0; i < width * width; i++) blueOverRed += data[i * 4 + 2]! - data[i * 4]!;
  expect(blueOverRed / (width * width)).toBeLessThan(12);
});
