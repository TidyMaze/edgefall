import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1589: the lore logs of the Open world (docs/specs/openworld.md section 12). The test hook stands the hero next to a log of the public
// seed 7 (no walk); one roll onto it opens a short panel, the next move closes it, the log is found for good (the save), and it is read
// again from the log archive of the settings menu.
type Hooks = { __openworldFixture: (f: object) => void; __openworldLogs: (seed: number) => number[] };
const sizes = [
  { name: 'desktop 1280 by 720', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];

const open = async (page: Page): Promise<void> => {
  await page.goto('./?bot=off&openworld=7');
  await expect(page.locator('body')).toHaveAttribute('data-openworld-at', '0,0');
};
const stand = (page: Page, hero: number[]): Promise<void> =>
  page.evaluate((hero) => (window as unknown as Hooks).__openworldFixture({ hero, troop: [], enemies: [] }), hero);
/** The cell of log `k` of seed 7. */
const logAt = async (page: Page, k: number): Promise<[number, number]> => {
  const all = await page.evaluate(() => (window as unknown as Hooks).__openworldLogs(7));
  return [all[2 * k]!, all[2 * k + 1]!];
};

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    test('rolling onto a log opens its panel, the next move closes it, the log stays found after a reload and reads again from the archive, #1589', async ({ page }) => {
      await open(page);
      const logs = await page.evaluate(() => (window as unknown as Hooks).__openworldLogs(7));
      expect(logs).toHaveLength(24); // twelve logs
      const [q, r] = await logAt(page, 0);
      await stand(page, [q - 2, r]);
      await stand(page, [q - 1, r]);
      await expect(page.locator('body')).toHaveAttribute('data-openworld-logs', new RegExp(`(^| )${q},${r}( |$)`));
      await shot(page, { path: `test-results/log-unread-${name.replaceAll(' ', '-')}.png` });
      const panel = page.locator('#openworld-log');
      await expect(panel).toBeHidden();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-at', `${q},${r}`);
      await expect(page.locator('body')).toHaveAttribute('data-openworld-log', 'log-meadow-near');
      await expect(panel).toBeVisible();
      await expect(page.locator('#openworld-log-title')).toHaveText('Stake: the clearing');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-logs-found', '0');
      await expect(panel).toHaveCSS('opacity', '1'); // its slide-in is over
      await shot(page, { path: `test-results/log-panel-${name.replaceAll(' ', '-')}.png` });
      // The panel ignores the pointer, and stands clear of the controls of the page.
      expect(await panel.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      for (const selector of ['#settings', '#openworld-minimap', '#openworld-map-button', '#openworld-hud']) {
        const other = await page.locator(selector).boundingBox();
        if (!other) continue;
        const apart = box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y;
        expect(apart, selector).toBe(true);
      }
      // The next move closes it, and is not held by it.
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('body')).toHaveAttribute('data-openworld-at', `${q + 1},${r}`);
      await expect(panel).toBeHidden();
      await expect(page.locator('body')).not.toHaveAttribute('data-openworld-log', /.+/);
      // Found for good: the save keeps it.
      await expect(page.locator('body')).toHaveAttribute('data-openworld-saved', /.+/);
      await page.reload();
      await expect(page.locator('body')).toHaveAttribute('data-openworld-logs-found', '0');
      // And it is in the log archive of the settings menu.
      await page.keyboard.press('Escape'); // back to the page's own menu: the world is left
      await page.locator('#settings').click();
      await page.locator('#setting-log-archive').click();
      await expect(page.locator('.setting-archive')).toContainText('Stake: the clearing');
    });
  });
}

test('Escape closes the terminal reader opened from the log archive in the world, the hero stays, a second Escape leaves, #1591', async ({ page }) => {
  await open(page);
  await stand(page, [3, 1]);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-at', '3,1');
  await page.evaluate(() => localStorage.setItem('ab-alone.lore-read', 'cargo-assay')); // one entry read: the archive lists it
  await page.locator('#settings').click();
  await page.locator('#setting-log-archive').click();
  await page.locator('.setting-archive button').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-reading', 'cargo-assay');
  await expect(page.locator('#reader')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-reading', /.+/);
  await expect(page.locator('#reader')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-openworld', '7'); // still in the world, the hero where it stood
  await expect(page.locator('body')).toHaveAttribute('data-openworld-at', '3,1');
  await shot(page, { path: 'test-results/reader-escape-stays-in-world.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-openworld', /.+/);
});
