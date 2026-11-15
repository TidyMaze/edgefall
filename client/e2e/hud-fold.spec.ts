import { expect, test } from '@playwright/test';

// #957: the fold button folds the HUD plate to a tab, the button alone, a 44 px touch target (#922); the plate leaves the
// screen, about a pixel, but stays in the page. The Open world mode hides the tab with the plate.
test('the fold button folds the plate to a 44 px tab and unfolds it, #957', async ({ page }) => {
  await page.goto('./?bot=off');
  const [hud, fold] = [page.locator('#hud'), page.locator('#hud-fold')];
  await expect(fold).toBeEnabled();
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  const tab = (await fold.boundingBox())!;
  expect(Math.min(tab.width, tab.height)).toBeGreaterThanOrEqual(44);
  const folded = await hud.evaluate((el) => {
    const { width, height } = getComputedStyle(el);
    return [parseFloat(width), parseFloat(height)];
  });
  expect(Math.max(...folded)).toBeLessThanOrEqual(1);
  await expect(hud).toContainText('to move'); // still in the page, for a screen reader
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect((await hud.boundingBox())!.width).toBeGreaterThan(100);
});

test('the Open world mode hides the fold tab with the plate, #957', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7');
  await page.getByLabel('Edgefall board').waitFor(); // the minimap is a canvas too
  await expect(page.locator('#openworld-hud')).toBeVisible();
  await expect(page.locator('#hud-fold')).toBeHidden();
});
