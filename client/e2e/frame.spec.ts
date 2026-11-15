import { expect, test, type Page } from '@playwright/test';
import { FRAME } from '../src/frame';
import { BLACK_WINS } from './end-games';

// The 61 cells sit on a hexagonal steel frame (#292, world.md section 6): a plate under them, a rim around them.
const frame = (page: Page) => page.evaluate(() => (window as any).__frame());
const rings = (page: Page) => page.evaluate(() => (window as any).__rings());
// __cellToScreen is linear in q and r: fractional coordinates give any point of the board plane.
const clickAt = async (page: Page, q: number, r: number) => {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
};

// The steel frame and the rim are the room's: the terrace (#1314) draws its slab from the glTF, so these ask for the room.
test('the cells sit on a steel frame that never takes a click meant for a cell, #292', async ({ page }) => {
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  expect(await frame(page)).toMatchObject({ radius: 4, holes: 0, drawn: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  // On the rim, straight below the Black marble on (0, 4): 0.68 past its centre, past its disc.
  const d = 0.68 / (Math.sqrt(3) / 2);
  await clickAt(page, -d / 2, 4 + d);
  expect(await rings(page)).toEqual([]);
  // At 1280x720 the dock lies on this rim point (#1032): the press reached a dock button, which may open a sheet.
  // Esc closes it, so the next press is the cell's.
  await page.keyboard.press('Escape');
  await clickAt(page, 0, 4);
  expect(await rings(page)).toEqual([[0, 4]]);
});

test('clear board and the low tier keep the frame, #292', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ab-alone.tier', 'low');
    localStorage.setItem('ab-alone.clear-board', 'on');
  });
  await page.goto('./?bot=off&scene=room');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-tier', 'low');
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');
  expect(await frame(page)).toMatchObject({ radius: 4, holes: 0, drawn: true });
  await expect(page.locator('body')).toHaveAttribute('data-rim', 'near'); // the turn is game information (#300)
});

const SODIUM = 0xd9822b;
const CYAN = 0x7fd6e8;
test('the rim half at the end of the side to move lights in its colour, then goes out at the end, #300', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./?bot=off&scene=room'); // hot-seat: Black, side 1, wears the shell and starts at the near end
  await page.locator('canvas').waitFor();
  await page.mouse.move(2, 2); // no hover ghost
  await expect(page.locator('#hud')).toContainText('Black to move'); // the flat copy stays
  await expect(page.locator('body')).toHaveAttribute('data-rim', 'near');
  expect((await frame(page)).lit).toEqual({ near: SODIUM, far: 0 });
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready'); // the room is complete: the bay loads after the page (#661)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  await clickAt(page, 0, 2);
  await clickAt(page, 0, 1);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('body')).toHaveAttribute('data-rim', 'far');
  expect((await frame(page)).lit).toEqual({ near: 0, far: CYAN });

  await page.locator('#import-file').setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: BLACK_WINS })),
  });
  await expect(page.locator('body')).toHaveAttribute('data-over', /.+/);
  await expect(page.locator('body')).toHaveAttribute('data-rim', 'off');
  expect((await frame(page)).lit).toEqual({ near: 0, far: 0 });
});

test('against the bot the human glass moves first: the near half lights cyan, #300', async ({ page }) => {
  await page.goto('./?bot=on');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('body')).toHaveAttribute('data-rim', 'near');
  expect((await frame(page)).lit).toEqual({ near: CYAN, far: 0 });
});
