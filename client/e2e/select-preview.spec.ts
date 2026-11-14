import { expect, test, type Page } from '@playwright/test';

// #1679: the far end of a line selects the 3 marbles, the HUD counts them, the hover (mouse) or a first tap (touch) shows the move.
const SHOTS = process.env.SELECT_SHOTS; // a folder for the screenshots, unset in CI

async function at(page: Page, q: number, r: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
}
async function trio(page: Page): Promise<{ a: number[]; b: number[] }> {
  return page.evaluate(() => {
    const mv = (window as any).__legal().find((m: any) => m.cells.length === 3);
    const cells = [...mv.cells].sort((x: number[], y: number[]) => x[0] - y[0] || x[1] - y[1]);
    return { a: cells[0], b: cells[2] };
  });
}

test('desktop: two clicks select a line of 3, the HUD counts it, hovering an arrow shows the move', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  const { a, b } = await trio(page);
  await page.mouse.click((await at(page, a[0]!, a[1]!)).x, (await at(page, a[0]!, a[1]!)).y);
  await page.mouse.click((await at(page, b[0]!, b[1]!)).x, (await at(page, b[0]!, b[1]!)).y);
  await expect(page.locator('#hud')).toContainText('3 marbles selected');
  expect(await page.evaluate(() => (window as any).__rings().length)).toBe(3);
  const t = await page.evaluate(() => (window as any).__targets()[0].cell);
  await page.mouse.move((await at(page, t[0], t[1])).x, (await at(page, t[0], t[1])).y);
  await expect(page.locator('body')).toHaveAttribute('data-ghosts', /[1-9]/);
  if (SHOTS) await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-1000x700.png` });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a first tap on an arrow previews the move, a second plays it', async ({ page }) => {
    await page.goto('./?bot=off');
    await page.locator('canvas').waitFor();
    await expect(page.locator('#hud')).toContainText('Black to move');
    const { a, b } = await trio(page);
    const pa = await at(page, a[0]!, a[1]!);
    const pb = await at(page, b[0]!, b[1]!);
    await page.touchscreen.tap(pa.x, pa.y);
    await page.touchscreen.tap(pb.x, pb.y);
    await expect(page.locator('#hud')).toContainText('3 marbles selected');
    const t = await page.evaluate(() => (window as any).__targets()[0].cell);
    const pt = await at(page, t[0], t[1]);
    await page.touchscreen.tap(pt.x, pt.y);
    await expect(page.locator('#hud')).toContainText('Tap the arrow again');
    await expect(page.locator('body')).toHaveAttribute('data-ghosts', /[1-9]/);
    await expect(page.locator('#tap-play')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__plies())).toBe(0);
    if (SHOTS) await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-390x844.png` });
    await page.touchscreen.tap(pt.x, pt.y);
    await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(1);
  });
});
