import { expect, test } from '@playwright/test';

test('clear-board toggles, survives a reload, and the board still plays', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  const cog = page.getByRole('button', { name: 'Settings' });
  const toggle = page.getByRole('button', { name: 'Clear board' });

  // Clear board lives in the settings menu: no loose button, the menu is closed until the cog opens it.
  await expect(toggle).toBeHidden();
  await expect(cog).toHaveAttribute('aria-expanded', 'false');
  await cog.click();
  await expect(cog).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toHaveAttribute('data-clear', 'off');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(body).toHaveAttribute('data-clear', 'on');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await expect(body).toHaveAttribute('data-clear', 'on');
  await expect(toggle).toBeHidden(); // the menu is closed again after a reload
  await cog.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

// Split from the first test (#349): a move on the cleared board, and the menu closing on the first press.
test('the board still plays with Clear board on, and the first press on it closes the menu', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  const cog = page.getByRole('button', { name: 'Settings' });
  const toggle = page.getByRole('button', { name: 'Clear board' });
  await cog.click();
  await toggle.click();
  await expect(body).toHaveAttribute('data-clear', 'on');

  // Clicks hit nothing before the first rendered frame (the raycaster needs the updated matrices).
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const click = async (q: number, r: number) => {
    const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
    await page.mouse.click(p.x, p.y);
  };
  await click(0, 2);
  await click(0, 1);
  await expect(page.locator('#hud')).toContainText('White to move');

  await expect(toggle).toBeHidden(); // the first press on the board closed the menu
  await cog.click();
  await cog.click(); // the cog closes the menu
  await expect(toggle).toBeHidden();
  await cog.click();
  await toggle.click();
  await expect(body).toHaveAttribute('data-clear', 'off');
});

test('the settings menu closes on Escape and on a click outside, and is reachable by keyboard', async ({ page, browserName }) => {
  // On a Mac, Tab skips buttons in Safari unless Option is held (system keyboard navigation setting).
  const tab = process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const cog = page.getByRole('button', { name: 'Settings' });
  const toggle = page.getByRole('button', { name: 'Clear board' });
  await expect(cog).toBeEnabled();

  await cog.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeVisible();
  await page.keyboard.press(tab);
  // Firefox first stops on the scrollable menu box itself, one more Tab reaches the first button.
  if (browserName === 'firefox') await page.keyboard.press(tab);
  await expect(page.locator('#setting-sound')).toBeFocused(); // the first item of the first group (#1566)
  for (let i = 0; i < 5; i++) await page.keyboard.press(tab); // Transcript, Theme, the two skins, then Clear board (Logs and Ledger live in the ship, #1693)
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');

  await page.keyboard.press('Escape');
  await expect(toggle).toBeHidden();
  await expect(cog).toBeFocused();
  await expect(cog).toHaveAttribute('aria-expanded', 'false');

  await cog.click();
  await expect(toggle).toBeVisible();
  await page.mouse.click(10, 400); // on the board, outside the menu
  await expect(toggle).toBeHidden();
});

// Bug #146: main.ts awaits the wasm engine, the renderer and the textures before it attaches the
// settings listener. A click right after domcontentloaded must either hit a disabled cog or open the menu.
test('the settings cog is disabled or works when clicked right after load, bug #146', async ({ page }) => {
  await page.goto('./?bot=off', { waitUntil: 'domcontentloaded' });
  const atClick = await page.evaluate(() => {
    const button = document.getElementById('settings') as HTMLButtonElement;
    const disabled = button.disabled;
    button.click();
    return { disabled, expanded: button.getAttribute('aria-expanded') };
  });
  expect(atClick.disabled || atClick.expanded === 'true').toBe(true);
  await expect(page.locator('#settings')).toBeEnabled(); // and it works once the page is ready
});
