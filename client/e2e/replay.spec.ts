import { expect, test, type Page } from '@playwright/test';
import { BLACK_WINS } from './end-games';
import { shot } from './shot';

// Replay mode (#793, docs/specs/ui.md section 4.3): the bar and the Left and Right keys step through the move log of an
// imported game, view only; Live returns to the current position. The game is loaded through the game file import.

const save = (moves: number[][]) => JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves });
const plies = (page: Page) => page.evaluate(() => (window as any).__plies() as number);

test('Replay steps through an imported game, view only, and Live returns to the end, #793', async ({ page }, info) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  await expect(page.locator('#replay')).toBeDisabled(); // no move yet
  await page
    .locator('#import-file')
    .setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(save(BLACK_WINS)) });
  await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  const total = BLACK_WINS.length;
  await expect(page.locator('#replay-label')).toHaveText(`Move ${total} of ${total} (live)`);

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#replay-label')).toHaveText(`Move ${total - 1} of ${total}`);
  await expect(page.locator('body')).not.toHaveAttribute('data-over', /./); // the game was still running one ply back
  await page.locator('#replay-first').click();
  await expect(page.locator('#replay-label')).toHaveText(`Move 0 of ${total}`);
  await page.locator('#replay-slider').fill('10');
  await expect(page.locator('#replay-label')).toHaveText(`Move 10 of ${total}`);
  await shot(page, { path: info.outputPath('replay-bar.png') });

  const before = await plies(page);
  const mv = await page.evaluate(() => (window as any).__legal()[0].cells[0] as [number, number]);
  await page.evaluate(([q, r]) => (window as any).__click(q, r), mv); // a click on a marble selects nothing
  expect(await page.evaluate(() => (window as any).__rings())).toEqual([]);
  expect(await plies(page)).toBe(before);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#replay-label')).toHaveText(`Move 11 of ${total}`);
  await page.getByRole('button', { name: 'Live' }).click();
  await expect(page.locator('#replay-bar')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
});

// #1038: the score bar of a replay shows the evaluation of the position on show, never the final result of the game.
test('a replay at the start shows the start position evaluated, not the result of the game, #1038', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await page
    .locator('#import-file')
    .setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(save(BLACK_WINS)) });
  await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await page.locator('#replay-first').click();
  await expect(page.locator('#replay-label')).toHaveText(`Move 0 of ${BLACK_WINS.length}`);
  // The engine's search score of the start position is small and not exactly 0: the bar reads "Black +0.1" on main
  // (b5e5a31, after #1048). The bar shows that evaluation in words, never the result ("winning").
  await expect(page.locator('#eval .label')).toHaveText(/^(Even|(Black|White) \+\d+\.\d)$/);
});
