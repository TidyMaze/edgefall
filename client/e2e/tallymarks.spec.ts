import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// The ejected count scratched on the board frame as tally marks (#389, world.md section 6 rule 3): per side, the
// slots drawn and the bone-white marks in them. Clear board and the low tier keep them (section 8).
const tally = (page: Page) => page.evaluate(() => (window as any).__tally());
// A 3v2 push on the q = -2 column that pushes a White marble off the board (e2e/eject.spec.ts), hot-seat.
const PLIES: [number, number][][] = [
  [[-2, 2], [-2, 3], [-2, 4], [-2, 1]],
  [[0, -3], [0, -2], [-1, -2]],
  [[-2, 1], [-2, 2], [-2, 3], [-2, 0]],
  [[-1, -2], [-1, -1], [-2, -2]],
  [[-2, 0], [-2, 1], [-2, 2], [-2, -1]],
];

test('an ejection scratches one mark on the frame at the losing side, with clear board and the low tier, #389', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ab-alone.tier', 'low');
    localStorage.setItem('ab-alone.clear-board', 'on');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // slides take no time
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');
  await expect(page.locator('body')).toHaveAttribute('data-tier', 'low');
  const hud = page.locator('#hud');
  await expect(hud).toContainText('Black to move');
  expect(await tally(page)).toEqual([{ marked: 0, slots: 6 }, { marked: 0, slots: 6 }]);

  for (const ply of PLIES) for (const [q, r] of ply) await page.evaluate(([x, y]) => (window as any).__click(x, y), [q, r]);
  await expect(hud).toContainText('Black ejected 1/6');
  expect(await tally(page)).toEqual([{ marked: 0, slots: 6 }, { marked: 1, slots: 6 }]); // White, side 2, lost one
  await expect(hud.locator('.pip.out')).toHaveCount(1); // the flat fallback stays
});

test('The Choir scratches six slots a side like every boss, #389', async ({ page }) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  await startMode(page, 'choir');
  await expect(page.locator('#boss-bar .name')).toContainText('The Choir');
  expect(await tally(page)).toEqual([{ marked: 0, slots: 6 }, { marked: 0, slots: 6 }]);
});
