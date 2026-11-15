import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi, showHud } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1531: the gains of the Open world. A marble the troop pushes into the water joins it as a recruit (seed 1: the hero on (11, -29) steps up-left to
// (11, -30), the foe on (12, -30) has water on (13, -30) behind it, and the lone hero shoves it in, #1504), and a tower beaten through the world
// leaves a teleporter pad beside it (seed 7). The states come from the test hook.
type Hooks = { __openworldFixture: (f: object) => void; __openworldPads: (seed: number) => number[] };
const sizes = [
  { name: 'desktop 1280 by 720', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];
const fixture = (page: Page, f: object): Promise<void> => page.evaluate((f) => (window as unknown as Hooks).__openworldFixture(f), f);

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const file = name.replaceAll(' ', '-');

    test('a marble the troop shoves into the water joins it as a recruit, told on the plate', async ({ page }) => {
      await page.goto('./?bot=off&openworld=1');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-at', '0,0');
      await expect(page.locator('#openworld-recruits')).toBeHidden();
      await fixture(page, { hero: [11, -29], troop: [], enemies: [[12, -30]] });
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-beaten', '1');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-recruits', '1');
      expect((await page.evaluate(() => document.body.dataset.openworldTroop))!.split(' ')).toHaveLength(1);
      await showHud(page, '#openworld-recruits'); // a phone held upright keeps it behind the chip of its bar (#1657)
      const line = page.locator('#openworld-recruits');
      await expect(line).toHaveText('A marble joins the troop. Recruits 1 / 5');
      await expect(page.locator('body')).not.toHaveAttribute('data-openworld-anim', '1'); // the push has landed
      const box = (await line.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await shot(page, { path: `test-results/gain-recruit-${file}.png` });
    });

    test('a tower beaten through the world leaves a teleporter pad beside it, in the network', async ({ page }) => {
      await page.goto('./?bot=off&openworld=7');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-at', '0,0');
      const [q, r] = await page.evaluate(() => (window as unknown as Hooks).__openworldPads(7).slice(0, 2) as [number, number]);
      await fixture(page, { hero: [q, r + 1], troop: [], enemies: [] });
      await expect(page.locator('body')).toHaveAttribute('data-openworld-teleporters', '2,-1');
      await fixture(page, { hero: [q, r + 1], troop: [], enemies: [], beaten: [0] });
      await expect(page.locator('body')).toHaveAttribute('data-openworld-teleporters', `2,-1 ${q},${r}`);
      await expect(page.locator('#openworld-teleport')).toBeHidden();
      await shot(page, { path: `test-results/gain-pad-${file}.png` });
      await fixture(page, { hero: [q, r], troop: [], enemies: [], beaten: [0] });
      await expect(page.locator('#openworld-teleport')).toBeVisible(); // the hero stands on the pad
    });
  });
}
