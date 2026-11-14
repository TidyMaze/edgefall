import { expect, test } from '@playwright/test';

// #1684: Settings > Reset everything, Erase wipes the ab-alone keys and reloads as a new player (lock on). The key sweep, the timers, Cancel and the
// focus are unit tested (reset.test.ts, main.reset.test.ts). An automated page lands in the first match under ?firstrun only (main.firstrun tests).

test('Erase reloads the page as a locked new player and keeps the keys of other apps, #1684', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; // seeds the first load only, not the reload after Erase
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ab-alone.firstwin', '1');
    localStorage.setItem('other.key', 'keep');
  });
  await page.goto('./?newplayer');
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '1');
  await page.locator('#settings').click();
  await page.locator('#setting-reset-all').click();
  await expect(page.locator('#reset-ask')).toHaveText('Erase all progress and settings? This cannot be undone.');
  const reloaded = page.waitForEvent('load');
  await page.locator('#reset-erase').click();
  await reloaded;
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '0');
  expect(await page.evaluate(() => [localStorage.getItem('ab-alone.firstwin'), localStorage.getItem('other.key')])).toEqual([null, 'keep']);
});
