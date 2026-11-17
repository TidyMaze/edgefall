import { expect, test } from '@playwright/test';
import { shot } from './shot';

// Issue #849: a sustained slow frame rate offers the low tier, once, never taken without a press. Adaptation is skipped
// under Playwright, so the hook __slowWindow feeds the slow windows (quality.ts SLOW_RUNS).
test('a sustained slow rate offers the low tier; Accept switches to it and stores it', async ({ page }) => {
  await page.goto('./?bot=off&quality=high');
  await page.locator('canvas').waitFor();
  const offer = page.locator('#low-offer');
  await expect(offer).toBeHidden();
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) (window as any).__slowWindow(40);
  });
  await expect(offer).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-tier', 'high'); // nothing changed by itself
  await shot(page, { path: test.info().outputPath('offer.png') });
  await offer.getByRole('button', { name: 'Use low quality' }).click();
  await expect(offer).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-tier', 'low');
  // the stored tier read at the next page view: quality.test.ts readTier and main.boot.test.ts (#1710, no reload here)
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.tier'))).toBe('low');
});

test('on a phone the offer fits the screen and leaves the dock free', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?bot=off&quality=high');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) (window as any).__slowWindow(40);
  });
  const offer = page.locator('#low-offer');
  await expect(offer).toBeVisible();
  await shot(page, { path: test.info().outputPath('offer-phone.png') });
  const box = (await offer.boundingBox())!;
  const dock = (await page.locator('#dock').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  await offer.getByRole('button', { name: 'Dismiss' }).click();
  await expect(offer).toBeHidden();
});

// Dismiss remembered on the next page view: main.lowoffer.test.ts (`does not show again on the next page view once answered`, #1710).
