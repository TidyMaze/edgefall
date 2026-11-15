import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// Boss phase notches scratched on the arena frame (#356, world.md section 6 rule 4): one lit notch per boss marble left
// (per ejection for The Echo) until the next phase, dark as they go, and a glyph at the threshold. Clear board and the low tier keep them (section 8).
// With ?bot=off both sides are played by hand: a White marble walks down to the rim at (2, 2) and Black pushes it off.
// Each move's mirror is a bonus move for the other side (The Echo, #859), so the board stays symmetric: Black's waits
// are mirrored too, and its push gives White the mirror push (checked on the engine).
const PLIES: [number, number][][] = [
  [[1, 3], [1, 2]],
  [[2, -2], [2, -1]],
  [[-1, 2], [0, 1]],
  [[2, -1], [2, 0]],
  [[0, 1], [-1, 2]],
  [[2, 0], [2, 1]],
  [[-1, 2], [0, 1]],
  [[2, 1], [2, 2]],
  [[0, 2], [1, 2], [2, 2]], // 2 against 1, off the board
];

test('an ejected boss marble puts a phase notch out on the frame, with clear board and the low tier, #356', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ab-alone.tier', 'low');
    localStorage.setItem('ab-alone.clear-board', 'on');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' }); // slides take no time
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');
  const notches = () => page.evaluate(() => (window as any).__notches());
  expect(await notches()).toEqual({ lit: 0, dark: 0, glyph: false }); // no boss, no phase

  await startMode(page, 'echo');
  const hud = page.locator('#hud');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  expect(await notches()).toEqual({ lit: 3, dark: 0, glyph: true }); // P2 after 3 ejections
  await expect(page.locator('#hud .notch')).toHaveCount(2); // the flat P1 P2 fallback stays

  for (const ply of PLIES) for (const [q, r] of ply) await page.evaluate(([x, y]) => (window as any).__roll(x, y), [q, r]);
  await expect(hud).toContainText('White ejected 1/6');
  expect(await notches()).toEqual({ lit: 2, dark: 1, glyph: true });
});
