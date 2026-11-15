import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The Ballast Mind (#749, game-design.md section 7.5): every 2 turns it borrows an effect of another boss, named in the
// HUD during the turn before. Fight seed 6 borrows the Pulsar's pulse at the end of turn 2, seed 3 the Swarm's wave. ?bot=off plays both sides
// through the click hook, one-marble moves, so no boss search runs. The screenshots are kept for the report.

const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

/** Plays `n` plies, the first one-marble move of the side to move each time, after the slides of the one before. */
async function plies(page: Page, n: number): Promise<void> {
  for (let k = 0; k < n; k++) {
    await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
    await page.evaluate(() => {
      const mv = ((window as any).__legal() as { cells: [number, number][]; dir: number }[]).find((m) => m.cells.length === 1)!;
      const step = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]][mv.dir]!;
      (window as any).__roll(...mv.cells[0]!);
      (window as any).__roll(mv.cells[0]![0] + step[0]!, mv.cells[0]![1] + step[1]!);
    });
  }
}

test('The Ballast Mind names its borrowed effect a turn ahead, then plays the Pulsar pulse, #749', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(6)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'ballast');
  await expect(page.locator('#boss-bar .name')).toContainText('The Ballast Mind');
  await page.mouse.move(2, 2); // no hover ghost
  const tell = page.locator('#hud .boss .tell');
  await plies(page, 1);
  await expect(tell).toHaveCount(0);
  await plies(page, 1); // the player's 2nd move is next
  await expect(tell).toHaveText("Pulse in 1 turn, force 2 · Next turn: the Pulsar's pulse");
  await expect(page.locator('body')).toHaveAttribute('data-ripples', '1'); // the announced pulsar ripples (#838)
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-announce.png') });
  await plies(page, 2); // the player's 2nd move, the boss reply: the pulse
  await expect(page.locator('body')).toHaveAttribute('data-pulses', '1');
  await expect(tell).toHaveText("Fired: the Pulsar's pulse"); // until the next ply (#838)
  await expect(page.locator('body')).toHaveAttribute('data-ripples', '0');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-pulse.png') });
});

test('The Ballast Mind lands the Swarm wave on the rim and marks the cell, #1197', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(3)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'ballast');
  await expect(page.locator('#boss-bar .name')).toContainText('The Ballast Mind');
  await page.mouse.move(2, 2); // no hover ghost
  const tell = page.locator('#hud .boss .tell');
  await plies(page, 2);
  await expect(tell).toHaveText("Next turn: the Swarm's wave");
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-wave-announce.png') });
  await plies(page, 2);
  await expect(tell).toHaveText("Fired: the Swarm's wave");
  await expect(page.locator('body')).toHaveAttribute('data-fired', '1');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-wave-fired.png') });
});
