import { expect, test, type Page } from '@playwright/test';

// Task #390: a legal target shows a ring with an arrow glyph that points the way its move goes (docs/specs/world.md
// section 6 rule 5, game-design.md section 2). Direction codes: E 0, NE 2, NW 4.
const targets = (page: Page) => page.evaluate(() => (window as any).__targets());

const select = (page: Page, cells: [number, number][]) =>
  page.evaluate((list) => list.forEach(([q, r]) => (window as any).__roll(q, r)), cells);

test('the targets of a selected group carry the direction of the move a click plays, task #390', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  expect(await targets(page)).toEqual([]);

  await select(page, [[0, 2]]); // one marble: E, NE and NW are free
  expect(await targets(page)).toEqual([
    { cell: [1, 2], dir: 0 },
    { cell: [1, 1], dir: 2 },
    { cell: [0, 1], dir: 4 },
  ]);

  await select(page, [[0, 3]]); // a pair on the NW line: broadside NE, inline NW
  expect(await targets(page)).toEqual([
    { cell: [1, 2], dir: 2 },
    { cell: [1, 1], dir: 2 },
    { cell: [0, 1], dir: 4 },
  ]);
});
