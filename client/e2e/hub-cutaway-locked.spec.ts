import { expect, test, type Page } from '@playwright/test';
import { BLACK_WINS } from './end-games';

// #1692: a new player (`?newplayer`) sees the ship in its locked look, and the first win lights the Mess with a card on the ship.

const GAME = { version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS };
const bay = (page: Page, key: string) => page.locator(`#ship-bays [data-bay="${key}"]`);

async function lockedShip(page: Page): Promise<void> {
  await page.goto('./?newplayer&bot=off');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => (window as unknown as { __enterMode: (m: string) => void }).__enterMode('hub'));
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shipDrawn: boolean }).__shipDrawn)).toBe(true);
}

for (const size of [{ width: 390, height: 844 }, { width: 1000, height: 700 }]) {
  test(`the locked ship: the Mess alone, dashed padlocked bays, the House table the goal, ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await lockedShip(page);
    await expect(bay(page, 'mess:bot')).toHaveAttribute('data-state', 'goal');
    for (const room of ['echo', 'daily', 'royale']) {
      await expect(bay(page, `mess:${room}`)).toHaveAttribute('data-state', 'locked');
      await expect(bay(page, `mess:${room}`).locator('.cut-lock')).toHaveCount(1);
    }
    await expect(bay(page, 'mess:logs')).toHaveAttribute('data-state', 'lit');
    await expect(bay(page, 'cargo:hull')).toHaveAttribute('data-state', 'dark');
    await page.waitForTimeout(1500); // the canvas shows the ship a frame after __shipDrawn, seconds on a software tier
    await page.screenshot({ path: `test-results/locked-ship-${size.width}.png` });
  });
}

test('a tap on a locked bay says why and starts nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await lockedShip(page);
  await bay(page, 'mess:daily').click();
  await expect(page.locator('#hud')).toContainText('Locked until your first win');
  await expect(page.locator('body')).toHaveAttribute('data-hub', /^mess /);
});

for (const size of [{ width: 390, height: 844 }, { width: 1000, height: 700 }]) test(`the first win lands in the ship, lights the Mess with a spark and a card names the goal, ${size.width}`, async ({ page }) => {
  await page.setViewportSize(size);
  await page.goto('./?newplayer'); // the guided first match is a game on the board: its win is imported here
  await page.locator('canvas').waitFor();
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(GAME)) });
  await expect(page.locator('#unlock')).toContainText('The Mess is open. Next: beat The Echo.');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-hub', /^mess /);
  await expect(bay(page, 'mess:daily')).toHaveAttribute('data-state', 'lit');
  await expect(bay(page, 'mess:echo')).toHaveAttribute('data-state', 'goal');
  await expect(bay(page, 'mess:daily')).toHaveAttribute('data-spark', '1');
  await expect(page.locator('#unlock-hub')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shipDrawn: boolean }).__shipDrawn)).toBe(true);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `test-results/first-win-ship-${size.width}.png` });
  await page.locator('#unlock-dismiss').click();
  await expect(page.locator('#unlock')).toBeHidden();
});
