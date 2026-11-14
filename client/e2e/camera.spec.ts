import { expect, test, type Page } from '@playwright/test';
import { openModes } from './modes';
import { shot } from './shot';

const cellToScreen = (page: Page, q: number, r: number) =>
  page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr) as { x: number; y: number }, [q, r]);

const click = async (page: Page, q: number, r: number) => {
  const p = await cellToScreen(page, q, r);
  await page.mouse.click(p.x, p.y);
};

// The distance of a cell from the screen centre grows when the camera comes closer.
const fromCentre = async (page: Page, q: number, r: number) => {
  const p = await cellToScreen(page, q, r);
  const size = page.viewportSize()!;
  return Math.hypot(p.x - size.width / 2, p.y - size.height / 2);
};

test('rotate and zoom, play a move at that angle, reset the view and play again', async ({ page }, testInfo) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  const start = await cellToScreen(page, 4, 0);
  const startSpan = await fromCentre(page, 4, 0);

  // Drag to rotate: the cell moves on screen.
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(360, 200, { steps: 5 });
  await page.mouse.move(400, 230, { steps: 5 });
  await page.mouse.up();
  const rotated = await cellToScreen(page, 4, 0);
  expect(Math.hypot(rotated.x - start.x, rotated.y - start.y)).toBeGreaterThan(50);
  await expect(page.locator('#hud')).toContainText('Black to move'); // a drag never selects or plays

  // Wheel up to zoom in.
  await page.mouse.wheel(0, -300);
  await expect.poll(() => fromCentre(page, 4, 0)).toBeGreaterThan(startSpan);

  await shot(page, { path: testInfo.outputPath('rotated-view.jpg'), type: 'jpeg', quality: 70 });

  // Select a marble and play a move in the rotated view.
  await click(page, 0, 2);
  await click(page, 0, 1);
  await expect(page.locator('#hud')).toContainText('White to move');

  // Reset the view: the default camera is back, so is the cell position.
  await openModes(page); // Replay and Reset view sit in the Game modes menu (#1612)
  await page.getByRole('button', { name: 'Reset view' }).click();
  const reset = await cellToScreen(page, 4, 0);
  expect(reset.x).toBeCloseTo(start.x, 1);
  expect(reset.y).toBeCloseTo(start.y, 1);

  await click(page, 0, -2); // a White marble
  await click(page, 0, -1);
  await expect(page.locator('#hud')).toContainText('Black to move');
});

// Bug #475: dragging to orbit the camera called applyLook() on every pointermove, which recreated
// all props geometries/materials and rebuilt THREE.Fog, causing severe stutter. The page counts its look
// rebuilds (__looks), so the check holds on a loaded machine, unlike a wall-clock budget (#545).
test('dragging to orbit the camera rebuilds no props nor fog per move, bug #475', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const looks = () => page.evaluate(() => (window as any).__looks() as number);
  const start = await cellToScreen(page, 4, 0);
  const before = await looks();

  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    await page.mouse.move(400 + Math.cos(angle) * 100, 300 + Math.sin(angle) * 100);
  }
  await page.mouse.up();

  const moved = await cellToScreen(page, 4, 0);
  expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(0); // the drag orbited
  expect(await looks()).toBe(before);
});

// Bug #146: the Reset view listener comes after the top-level awaits of main.ts. Before refresh() fills
// the HUD (it runs after every listener is wired) a click would be lost, so the button must be disabled.
test('Reset view is disabled until its listener is attached, bug #146', async ({ page }) => {
  await page.goto('./?bot=off', { waitUntil: 'domcontentloaded' });
  const atLoad = await page.evaluate(() => ({
    disabled: (document.getElementById('reset-view') as HTMLButtonElement).disabled,
    ready: document.getElementById('hud')!.innerHTML !== '',
  }));
  expect(atLoad.disabled || atLoad.ready).toBe(true);
  // Under software WebGL on a loaded runner the top-level awaits can take longer than the 5 s default (#336).
  await expect(page.locator('#reset-view')).toBeEnabled({ timeout: 30_000 });
});

// #1681: once the camera moved, a Reset view button floats over the board (no menu), and a press brings the default view back.
test('a floating Reset view appears after a drag and brings the default view back', async ({ page }, testInfo) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  const chip = page.locator('#view-reset');
  await expect(chip).toBeHidden();
  const start = await cellToScreen(page, 4, 0);
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(360, 200, { steps: 5 });
  await page.mouse.move(400, 230, { steps: 5 });
  await page.mouse.up();
  await expect(chip).toBeVisible();
  await shot(page, { path: testInfo.outputPath('view-reset-shown.jpg'), type: 'jpeg', quality: 70 });
  await chip.click();
  await expect(chip).toBeHidden();
  const reset = await cellToScreen(page, 4, 0);
  expect(reset.x).toBeCloseTo(start.x, 1);
  expect(reset.y).toBeCloseTo(start.y, 1);
});
