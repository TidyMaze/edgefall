import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openAdvanced } from './settings';
import { shot } from './shot';

// #1566 (docs/specs/ui.md section 4.11): the settings menu is five groups under visible headings, every item with a visible
// label, the developer tools under Advanced (shut at first), the cog on the right and clear of the HUD plate, the minimap and
// the Map button, and a menu taller than the window scrolls inside itself with every target at least 44 px.

const sizes = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 },
  { name: '844x390', width: 844, height: 390 },
  { name: '960x540', width: 960, height: 540 },
];

const open = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.locator('canvas').first().waitFor();
  await expect(page.locator('#settings')).toBeEnabled();
  await page.locator('#settings').click();
  await expect(page.locator('#settings-menu')).toBeVisible();
};

const boxOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.getClientRects().length === 0) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }, selector);

for (const { name, width, height } of sizes) {
  test.describe(`the settings menu at ${name}`, () => {
    test.use({ viewport: { width, height } });

    test('has five headed groups, a visible label on every item and Advanced shut, #1566', async ({ page }) => {
      mkdirSync('test-results/screenshots', { recursive: true });
      await open(page, './?bot=off&net=hook');
      await expect(page.locator('#settings-menu .setting-heading')).toHaveText(['Sound', 'Display', 'Accessibility', 'Controls', 'Advanced']);
      const bare = await page.evaluate(() =>
        [...document.querySelectorAll('#settings-menu .setting-section button')]
          .filter((el) => el.getClientRects().length > 0)
          .filter((el) => (el as HTMLElement).innerText.trim() === '')
          .map((el) => el.id),
      );
      expect(bare, 'visible items with no visible label').toEqual([]);
      for (const id of ['setting-fps', 'setting-free-cam', 'setting-export-game', 'setting-import-game', 'copy-diagnostics']) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.locator('#setting-reduced-motion')).toBeVisible();
      await expect(page.locator('#setting-sound')).toBeVisible();
      await expect(page.locator('#setting-log-archive')).toBeVisible();
      await expect(page.locator('#setting-ledger')).toBeVisible();
      await openAdvanced(page);
      for (const id of ['setting-fps', 'setting-free-cam', 'setting-export-game', 'setting-import-game', 'copy-diagnostics']) await expect(page.locator(`#${id}`)).toBeVisible();
      await shot(page, { path: `test-results/screenshots/1566-settings-${name}.png` });
    });

    test('keeps every target at 44 px and scrolls inside itself, nothing clipped, #1566', async ({ page }) => {
      await open(page, './?bot=off&net=hook');
      await openAdvanced(page);
      const items = await page.evaluate(() => {
        const menu = document.getElementById('settings-menu')!;
        const m = menu.getBoundingClientRect();
        const out: { name: string; small: boolean; clipped: boolean; overflows: boolean }[] = [];
        for (const el of menu.querySelectorAll('.setting-section button, .setting-section summary')) {
          if (el.getClientRects().length === 0) continue;
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the menu scrolls where it is shorter than its rows
          const b = el.getBoundingClientRect();
          out.push({
            name: el.id || el.textContent!.trim(),
            small: b.width < 43.9 || b.height < 43.9,
            clipped: b.left < Math.max(0, m.left) - 0.5 || b.right > Math.min(innerWidth, m.right) + 0.5 || b.top < Math.max(0, m.top) - 0.5 || b.bottom > Math.min(innerHeight, m.bottom) + 0.5,
            overflows: el.scrollWidth > el.clientWidth + 1,
          });
        }
        return { items: out, menu: { top: m.top, bottom: m.bottom, left: m.left, right: m.right, scrolls: menu.scrollHeight > menu.clientHeight, canScroll: getComputedStyle(menu).overflowY } };
      });
      expect(items.items.length).toBeGreaterThan(15);
      expect(items.items.filter((i) => i.small).map((i) => i.name), 'items under 44 px').toEqual([]);
      expect(items.items.filter((i) => i.clipped).map((i) => i.name), 'items cut by the menu or the window').toEqual([]);
      expect(items.items.filter((i) => i.overflows).map((i) => i.name), 'items whose label overflows').toEqual([]);
      expect(items.menu.top).toBeGreaterThanOrEqual(0);
      expect(items.menu.bottom).toBeLessThanOrEqual(height);
      expect(items.menu.left).toBeGreaterThanOrEqual(0);
      expect(items.menu.right).toBeLessThanOrEqual(width);
      expect(items.menu.canScroll).toBe('auto');
    });

    for (const [state, url] of [
      ['a game', './?bot=off&net=hook'],
      ['the Open world', './?bot=off&openworld=7'],
    ] as const) {
      test(`puts the cog on the right, clear of the plate, the minimap and the Map button in ${state}, #1566`, async ({ page }) => {
        await page.goto(url);
        await page.locator('canvas').first().waitFor();
        await expect(page.locator('#settings')).toBeEnabled();
        // The world is entered after the boot: until then the plate is still up and the cog sits under it (#1686).
        if (state === 'the Open world') await expect(page.locator('body')).toHaveAttribute('data-openworld');
        const cog = (await boxOf(page, '#settings'))!;
        expect(cog.right, 'the cog sits at the right edge').toBeCloseTo(width - 16, 0);
        for (const other of ['#hud', '#openworld-minimap', '#openworld-map-button']) {
          const box = await boxOf(page, other);
          if (!box) continue;
          const meets = cog.left < box.right && box.left < cog.right && cog.top < box.bottom && box.top < cog.bottom;
          expect(meets, `the cog covers ${other}`).toBe(false);
        }
      });
    }
  });
}
