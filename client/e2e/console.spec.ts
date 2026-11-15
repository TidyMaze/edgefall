import { expect, test, type Page } from '@playwright/test';
import { TERMINAL } from '../src/terminal';
import { shot } from './shot';

// #511: the room's console screen shows its deck's lore entry (src/lore.ts), paged for the UI scale (src/terminal.ts),
// once the web fonts are in. body[data-console] names the entry and the page shown.

test('the deck console shows the entry of the deck in play, #511', async ({ page }) => {
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule 1\/\d$/);
  await page.evaluate(() => (window as unknown as { __deck: (deck: string) => void }).__deck('chapel'));
  await expect(body).toHaveAttribute('data-console', /^chapel-door 1\/\d$/);
});

test('the deck console falls back to system fonts when web font files fail to load, bug #600', async ({ page }) => {
  await page.route(/fonts\.gstatic\.com/, (r) => r.abort());
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule 1\/\d$/);
  await page.keyboard.press('t');
  await expect(page.locator('#reader')).toBeVisible();
});

// #512: the terminal reader. The T key or a click on the console screen frames the camera on it; the arrows and a click
// on the screen page through, Esc or a click off it leaves. The page is copied into #reader, the entries read are saved.
type Rect = { x: number; y: number; width: number; height: number };
const consoleRect = (page: Page) => page.evaluate(() => (window as unknown as { __consoleRect: () => Rect }).__consoleRect());
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

for (const scale of [100, 200] as const) {
  test(`the reader shows the console readable at 1080p and a ${scale} % UI scale, #512`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript((s) => localStorage.setItem('ab-alone.ui-scale', s), String(scale));
    await page.goto('./?bot=off&scene=room');
    await page.locator('canvas').waitFor();
    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-console', /^mess-house-rule 1\/\d$/);
    await expect(body).toHaveAttribute('data-bay', 'ready'); // the console is rebuilt when the bay loads (#841)
    await page.keyboard.press('t');
    const reader = page.locator('#reader');
    await expect(reader).toContainText("Captain's order, pinned above table four");
    await expect(page.locator('#hud')).toBeHidden(); // nothing covers the screen
    const shown = await consoleRect(page);
    expect(shown.x).toBeGreaterThan(0);
    expect(shown.x + shown.width).toBeLessThan(1920);
    expect(shown.y).toBeGreaterThan(0);
    expect(shown.y + shown.height).toBeLessThan(1080);
    // The text as tall on the window as the UI scale asks, 16 px at the least at 100 %.
    const textPx = ((TERMINAL.size * scale) / 100) * (shown.height / TERMINAL.height);
    expect(textPx).toBeGreaterThanOrEqual((16 * scale) / 100);
    await shot(page, { path: testInfo.outputPath(`reader-${scale}.png`) });
    const pages = Number(/\/(\d)$/.exec((await body.getAttribute('data-console'))!)![1]);
    for (let n = 2; n <= pages; n++) {
      await page.keyboard.press('ArrowRight');
      await expect(body).toHaveAttribute('data-console', `mess-house-rule ${n}/${pages}`);
      await expect(reader).toContainText(`Page ${n} of ${pages}`);
    }
    await page.mouse.click(centre(shown).x, centre(shown).y); // past the last page: back to the board
    await expect(reader).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ab-alone.lore-read'))).toBe('mess-house-rule');
  });
}

test('a click on the console screen opens the reader, a click off it leaves, and reading never blocks a move, #512', async ({ page }) => {
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-console', /^mess-house-rule /);
  // The bay loads after the page and rebuilds the props, the console included: a click on the old one lands on nothing (#841).
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready');
  const reader = page.locator('#reader');
  // Orbit to the west wall, low over the board, where the console stands.
  await page.mouse.move(640, 500);
  await page.mouse.down();
  await page.mouse.move(378, 300, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click(centre(await consoleRect(page)).x, centre(await consoleRect(page)).y);
  await expect(page.locator('body')).toHaveAttribute('data-reading', 'mess-house-rule');
  // A move played while reading lands: the reader stays open.
  await page.evaluate(() => {
    const click = (window as unknown as { __roll: (q: number, r: number) => void }).__roll;
    click(0, 2);
    click(0, 1);
  });
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('body')).toHaveAttribute('data-reading', 'mess-house-rule');
  await page.mouse.click(2, page.viewportSize()!.height - 20); // off the screen, near the bottom left corner of the window (700 is outside the 540 px window of CI, #1436)
  await expect(page.locator('body')).not.toHaveAttribute('data-reading');
  await page.getByRole('button', { name: 'Reset view' }).click();
  const cell = (q: number, r: number) =>
    page.evaluate(([cq, cr]) => (window as unknown as { __cellToScreen: (q: number, r: number) => { x: number; y: number } }).__cellToScreen(cq!, cr!), [q, r]);
  const white = await cell(0, -2);
  await page.mouse.click(white.x, white.y);
  const to = await cell(0, -1);
  await page.mouse.click(to.x, to.y);
  await expect(page.locator('#hud')).toContainText('Black to move');
});

// #513: the Log archive item of the settings menu lists the entries read and reopens one in the reader.
test('the log archive rereads an entry read on another deck, #513', async ({ page }, testInfo) => {
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await page.evaluate(() => (window as unknown as { __deck: (deck: string) => void }).__deck('cargo'));
  await expect(body).toHaveAttribute('data-console', /^cargo-assay 1\/\d$/);
  await page.keyboard.press('t');
  await expect(body).toHaveAttribute('data-reading', 'cargo-assay');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { __deck: (deck: string) => void }).__deck('mess'));
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule 1\/\d$/);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#setting-log-archive').dispatchEvent('click'); // hidden: the Logs' home is the ship's Logs bays (#1693), the archive page is the same
  const entry = page.getByRole('button', { name: 'Assay note, ore bay two' });
  await expect(entry).toBeVisible();
  await shot(page, { path: testInfo.outputPath('log-archive.png') });
  await entry.click();
  await expect(body).toHaveAttribute('data-reading', 'cargo-assay');
  await expect(page.locator('#reader')).toContainText('Assay note, ore bay two');
  await expect(page.locator('#settings-menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader')).toBeHidden();
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule /);
});

// #1369: the terrace has no console screen, so its Console entry (Settings, Advanced, #1693) reads the deck's entry as a plate.
test('the terrace Console entry in Settings, Advanced, reads the deck entry, #1369', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'table-zero');
  await page.locator('#settings').click();
  await page.locator('#settings-advanced > summary').click();
  await page.locator('#settings-menu #console-entry').click();
  await expect(page.locator('body')).toHaveAttribute('data-reading', 'mess-house-rule');
  await expect(page.locator('#reader')).toBeVisible();
  await expect(page.locator('#reader')).toContainText("Captain's order, pinned above table four");
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader')).toBeHidden();
});
