import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// #1094, docs/specs/motion.md story 4: the Lobby sheet opens with a slide and fade on the base token, a pressed dock button
// eases on the instant token, and Reduced motion keeps both at 0 s. The sheet is pressable from the first frame.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('the sheet opens on the base token and a dock button eases on the instant token (#1094)', async ({ page }) => {
  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas').waitFor();
  await startMode(page, 'online'); // its Lobby sheet opens over the dock until an opponent connects
  const lobby = page.getByRole('button', { name: 'Lobby' });
  expect(await lobby.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.08s');
  const sheet = page.locator('#lobby-sheet');
  await expect(sheet).toBeVisible();
  const style = await sheet.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(style).toEqual({ name: 'sheet-in', duration: '0.2s' });
});

test('Reduced motion opens the sheet and presses the button at once (#1094)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas').waitFor();
  await startMode(page, 'online');
  const lobby = page.getByRole('button', { name: 'Lobby' });
  expect(await page.locator('#lobby-sheet').evaluate((el) => getComputedStyle(el).animationDuration)).toBe('0s');
  expect(await lobby.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});
