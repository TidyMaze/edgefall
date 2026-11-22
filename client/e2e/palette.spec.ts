import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { shot } from './shot';

test.describe('Colorblind and high-contrast palettes (#381)', () => {
  // The full cycle of the five palettes and the wrap to Default is main.palette.test.ts (#1710): here one step, in a browser; the stored palette at boot is unit tested in main.palette.test.ts.
  test('the palette setting steps to the next palette, and wears it', async ({ page }) => {
    await page.goto('./?bot=off&net=hook');
    await page.locator('canvas').waitFor();
    const cog = page.locator('#settings');
    await expect(cog).toBeEnabled();
    await cog.click();

    const paletteBtn = page.locator('#setting-palette');
    await expect(paletteBtn).toBeVisible();
    await expect(paletteBtn).toContainText('Palette: Default');

    // Default -> Protan
    await paletteBtn.click();
    await expect(paletteBtn).toContainText('Palette: Protan');
    expect(await page.evaluate(() => localStorage.getItem('ab-alone.palette'))).toBe('protan');
    expect(await page.evaluate(() => document.documentElement.dataset.palette)).toBe('protan');
    expect(await page.evaluate(() => (window as any).__palette())).toBe('protan');
  });

  test('captures screenshots for each palette', async ({ page }) => {
    mkdirSync('test-results/screenshots', { recursive: true });
    await page.goto('./?bot=off'); // one page load: the setting steps through the palettes, as the test above checks
    await page.locator('canvas').waitFor();
    const cog = page.locator('#settings');
    await expect(cog).toBeEnabled();
    const paletteBtn = page.locator('#setting-palette');
    for (const [i, pal] of ['default', 'protan', 'deutan', 'tritan', 'contrast'].entries()) {
      if (i) {
        await cog.click();
        await paletteBtn.click();
        await cog.click(); // the menu is closed for the shot
      }
      expect(await page.evaluate(() => (window as any).__palette())).toBe(pal);
      await shot(page, { path: `test-results/screenshots/palette-${pal}.png` });
    }
  });
});
