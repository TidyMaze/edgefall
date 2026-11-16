import { type Page } from '@playwright/test';
import { lowTierOnCi, showHud } from './modes';
import { expect, test } from './shared-world';
import { shot } from './shot';

lowTierOnCi();

// #1655 (Decision #1654): the Open world's resources. On seed 7, the shared Open world page of its size (#1710), the hero on (2, 4) rolls right onto a
// boulder (3, 4): 1 ore; the hero on (-3, -2) rolls onto a tree (-2, -2): 1 wood. The plate says the counts and the world is saved. That a reload reads the
// counts back is the unit test of the save (openworldsave.test.ts, record 8). The states come from the test hook.
type Hooks = { __openworldFixture: (f: object) => void };
const sizes = [
  { name: 'desktop 960 by 540', viewport: { width: 960, height: 540 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'small phone 320 by 480', viewport: { width: 320, height: 480 }, touch: true },
];
const fixture = (page: Page, f: object): Promise<void> => page.evaluate((f) => (window as unknown as Hooks).__openworldFixture(f), f);
const writes = (page: Page): Promise<number> => page.evaluate(() => Number(document.body.dataset.openworldSaved ?? 0));

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const file = name.replaceAll(' ', '-');

    test('a boulder and a tree broken fill the plate line, and the world is saved', async ({ world: page }) => {
      await expect(page.locator('body')).toHaveAttribute('data-openworld-resources', '0,0,0,0');
      await fixture(page, { hero: [2, 4], troop: [], enemies: [] });
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-resources', '0,1,0,0');
      await fixture(page, { hero: [-3, -2], troop: [], enemies: [] });
      const before = await writes(page);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-resources', '1,1,0,0');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-broken', '2');
      await expect.poll(() => writes(page)).toBeGreaterThan(before);
      await showHud(page, '#openworld-resources'); // a phone held upright keeps it behind the chip of its bar (#1657)
      const line = page.locator('#openworld-resources');
      await expect(line).toHaveText('Wood 1 · Ore 1 · Parts 0 · Shards 0');
      const box = (await line.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await shot(page, { path: `test-results/resources-${file}.png` });
    });
  });
}
