import { expect, test, type Page } from '@playwright/test';
import { paused } from './frameclock';

// How a push lands (#1560): an ejection kicks the camera, and a plain move does not. The squash and the kick's timing are unit tests (#1625).

// Plies 1 to 4 of the 3v2 push of eject.spec.ts, as the game file records them, loaded by the import instead of clicked.
const FOUR_PLIES = [
  [3, 4, -2, 2, -2, 3, -2, 4],
  [2, 3, 0, -3, 0, -2, 0, 0],
  [3, 4, -2, 1, -2, 2, -2, 3],
  [2, 1, -1, -2, -1, -1, 0, 0],
];

async function open(page: Page) {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: FOUR_PLIES })) });
  await expect(page.locator('#hud')).toContainText('Black to move');
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(4);
  await expect(page.locator('body')).not.toHaveAttribute('data-sliding', /.*/);
  return async (...cells: [number, number][]) => {
    for (const [q, r] of cells) {
      const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
      await page.mouse.click(p.x, p.y);
    }
  };
}

// The squash (its depth and its rebound) and the kick's 250 ms are functions of the frame clock: their curves are unit tests (slide.test.ts,
// main.pushfeel.test.ts, #1625). Here the page only shows that the kick starts on an ejection and the picture is at rest once it is over.
test('a push that ejects kicks the camera, and the picture is at rest again once the kick is over', async ({ page }) => {
  const click = await open(page);
  // The kick lasts 250 ms of the page's clock: a software-GL frame (0.5 to 1.4 s on CI) can start and end it between two reads, so the
  // test moves the clock itself, 50 ms a frame, and reads the kick on the frame it starts (#1723).
  await paused(page, async (frame) => {
    await click([-2, 0], [-2, 1], [-2, 2], [-2, -1]); // 5. 3v2 push, the last White marble leaves
    let kicked = false;
    for (let i = 0; i < 20 && !kicked; i++) {
      await frame(50);
      kicked = (await page.evaluate(() => document.body.dataset.kick)) === 'on';
    }
    expect(kicked, 'the camera kicked within 1 s of the push').toBe(true);
    await frame(300); // past the kick's 250 ms
    // the mark leaves on a drawn frame, and under automation the page draws at most every 100 ms (drawDue): frames of 150 ms until it has
    let rested = false;
    for (let i = 0; i < 10 && !rested; i++) {
      await frame(150);
      rested = (await page.evaluate(() => document.body.dataset.kick)) === undefined;
    }
    expect(rested, 'the kick is over within 1.5 s of page clock after its 250 ms').toBe(true);
  });
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('body')).toHaveAttribute('data-ejections', '1');
  await expect(page.locator('body')).not.toHaveAttribute('data-kick', /.*/, { timeout: 2000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-sliding', /.*/);
  await page.evaluate(() => (window as any).__drawNext());
  await expect.poll(() => page.evaluate(() => (window as any).__kick())).toEqual({ zoom: 1, x: 0, y: 0 }); // the picture is the resting one again
});

test('a plain move never kicks the camera', async ({ page }) => {
  const click = await open(page);
  const mv = await page.evaluate(() => (window as any).__legal().find((m: any) => m.cells.length === 1));
  await click(mv.cells[0]);
  const target = await page.evaluate((dir) => (window as any).__targets().find((t: any) => t.dir === dir).cell, mv.dir);
  await click(target);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(page.locator('body')).not.toHaveAttribute('data-sliding', /.*/);
  expect(await page.evaluate(() => document.body.dataset.kick)).toBeUndefined();
});
