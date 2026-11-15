import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// #1697 (replaces the deleted phone-layout check of bugs #575, #603, #715, whose Modes menu is gone): the Shift crew bay's sheet with the boss list of
// Boss with a partner fits the window and every boss row can be reached, at a phone and at a window.
const ALL = ['echo', 'hull', 'choir', 'chaplain', 'ballast'];
for (const [name, viewport, touch] of [['360x800', { width: 360, height: 800 }, true], ['1000x700', { width: 1000, height: 700 }, false]] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    test('the Shift crew sheet with its boss list fits and every row is reachable', async ({ page }) => {
      await page.addInitScript((beaten) => localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten })), ALL);
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await startMode(page, 'hub');
      await page.locator('#ship-bays [data-bay="furnace:coop"]').click();
      const sheet = page.locator('#bay-sheet');
      await expect(sheet).toBeVisible();
      await page.locator('#bay-row-1').click();
      const rows = page.locator('#coop-list button');
      await expect(rows).toHaveCount(15);
      const sheetBox = await sheet.evaluate((e) => e.getBoundingClientRect().toJSON()); // the sheet scrolls inside itself: its rows are reached by scrolling it
      expect(sheetBox.left).toBeGreaterThanOrEqual(0);
      expect(sheetBox.right).toBeLessThanOrEqual(viewport.width);
      expect(sheetBox.top).toBeGreaterThanOrEqual(0);
      expect(sheetBox.bottom).toBeLessThanOrEqual(viewport.height);
      for (const i of [0, 7, 14]) {
        await rows.nth(i).scrollIntoViewIfNeeded();
        const r = await rows.nth(i).evaluate((e) => e.getBoundingClientRect().toJSON());
        expect(r.top).toBeGreaterThanOrEqual(Math.max(0, sheetBox.top - 1)); // inside the sheet, which is inside the window
        expect(r.bottom).toBeLessThanOrEqual(Math.min(viewport.height, sheetBox.bottom + 1));
        expect(r.right).toBeLessThanOrEqual(viewport.width);
        expect(r.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
