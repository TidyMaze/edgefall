import { expect, test, type Page } from '@playwright/test';

// #1110: particles drift near the hero in the Open world (pollen, leaves, snow or dust by biome), a step's dust puff and the
// reduced-motion rest are unit tests (openworldmode.test.ts, openworldambiencemode.test.ts). The page marks the count it draws (`data-openworld-particles`, webdriver pages only).
async function enter(page: Page): Promise<void> {
  await page.goto('./?bot=off&openworld=7&quality=high'); // the runner has no GPU and takes the low tier, which draws none (#1483)
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
}
const count = (page: Page) => page.evaluate(() => Number(document.body.dataset.openworldParticles ?? 0));

test('particles drift near the hero in the Open world, #1110', async ({ page }) => {
  await enter(page);
  await expect.poll(() => count(page)).toBeGreaterThan(2);
  expect(await count(page)).toBeLessThanOrEqual(64);
});
