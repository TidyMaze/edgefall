import { expect, type Page } from '@playwright/test';
import { test } from './shared-world';


// #1441: the hero and the troop sail on water, each marble on a small low-poly boat. Seed 7 has open ground on (-4,-35) and (-4,-34)
// with water on the two cells north-west of it, where Left steps at the resting yaw (#1273). The state comes from the test hook, on the
// worker's shared seed-7 page (shared-world.ts): no page load in the test (#1710).
const drawn = (page: Page) => page.evaluate(() => JSON.parse(document.body.dataset.openworldDrawn ?? '{}').boats as number);
const at = (page: Page) => page.evaluate(() => document.body.dataset.openworldAt);

test('the hero and the troop sail onto the water, each marble on a boat, #1441', async ({ world: page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the marbles jump: the drawn boats are published with the step
  try {
    await page.evaluate(() => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [-4, -35], troop: [[-4, -34]], enemies: [] }));
    await expect.poll(() => at(page)).toBe('-4,-35');
    expect(await drawn(page)).toBe(0); // on land: no boat
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => at(page)).toBe('-4,-36'); // the hero sails on to the water
    await expect.poll(() => drawn(page)).toBe(1); // its boat; the troop marble behind it is still on land (-4,-35)
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => at(page)).toBe('-4,-37');
    await expect.poll(() => drawn(page)).toBe(2); // the troop marble sails too
  } finally {
    await page.emulateMedia({ reducedMotion: null }); // the shared page goes on as the next test expects it
  }
});
