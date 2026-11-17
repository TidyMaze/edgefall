import { expect, test, type Page } from '@playwright/test';

// #391: the Flat HUD toggle of the settings menu shows every game-critical value as text on the HUD plate: the turn
// owner, the ejected count, and in a boss fight the phase and the tell countdown. Off by default, saved locally.
const flat = (page: Page) => page.locator('#hud .flat');
const toggle = async (page: Page, on: boolean) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const item = page.getByRole('button', { name: 'Flat HUD' });
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', String(on));
  await page.getByRole('button', { name: 'Settings' }).click();
};

test('the Flat HUD toggle shows and hides the flat values and survives a reload', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await expect(flat(page)).toHaveCount(0); // off by default
  await toggle(page, true);
  await expect(flat(page)).toContainText('Turn: Black');
  await expect(flat(page)).toContainText('Ejected: Black 0/6, White 0/6');

  await page.reload();
  await page.locator('canvas').waitFor();
  await expect(flat(page)).toContainText('Turn: Black');

  // A boss fight's phase and tell on the flat HUD: main.boss.test.ts (#1710, no mode start here).
  await toggle(page, false);
  await expect(flat(page)).toHaveCount(0);
});
