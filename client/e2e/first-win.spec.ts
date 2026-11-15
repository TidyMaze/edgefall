import { expect, test } from '@playwright/test';
import { BLACK_WINS } from './end-games';

// #1665: a new player first plays the normal game against the bot; the other modes wait for the first win. `?newplayer` gives an automated page a
// new player (every other spec stays open). The win comes from an imported finished game; the unit tests hold the rest (main.unlock.test.ts).

test('a new player cannot start a locked mode, wins once and gets the unlock card, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '0');
  await expect(page.locator('#dock #exit')).toBeHidden(); // the ship is not open yet: the first table has no way out
  await page.evaluate(() => document.getElementById('roguelite')!.click()); // a call of .click() starts nothing while locked
  await expect(page.locator('body')).not.toHaveAttribute('data-run', /./);
  await expect(page.locator('body')).not.toHaveAttribute('data-hub', /./);

  await page.locator('#import-file').setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS })),
  });
  const card = page.locator('#unlock');
  await expect(card).toBeVisible();
  await expect(card).toContainText('You won.');
  await expect(card).toContainText('Unlocked: Open world, Bosses, Runs, Daily, Royale, Ranked, Leaderboard');
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '1');
  await page.locator('#unlock-dismiss').click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.firstwin'))).toBe('1');
});

test('the locked Hub names the first win and shows no amber door, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => (window as unknown as { __enterMode: (m: string) => void }).__enterMode('hub'));
  await expect(page.locator('#hub-rail .goal')).toHaveText('Next goal: Win your first game vs the bot');
  await expect(page.locator('#hub-labels [data-goal]')).toHaveCount(0);
});

test('the card has Open world as its filled button and lists the Leaderboard, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS })) });
  await expect(page.locator('#unlock')).toBeVisible();
  const fills = await page.evaluate(() => ['unlock-world', 'unlock-dismiss'].map((id) => getComputedStyle(document.getElementById(id)!).backgroundColor));
  expect(fills[0]).not.toBe(fills[1]);
  await expect(page.locator('#unlock')).toContainText('Leaderboard');
});
