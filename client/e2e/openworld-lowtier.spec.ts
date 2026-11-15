import { expect, test } from '@playwright/test';

// #1234: the Open world is lit by no point light on any tier (the ship's are not drawn there), and the low tier still plays: a step
// rolls the hero. (That a still low scene draws no frame is a unit test of the mode, openworldmode.test.ts.)
test('the Open world on the low tier draws no point light and still rolls the hero, #1234', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7&quality=low');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
  const cost = await page.evaluate(() => (window as unknown as { __renderCost: { pointLights: number; tier: string } }).__renderCost);
  expect(cost).toMatchObject({ pointLights: 0, tier: 'low' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('1,0');
});
