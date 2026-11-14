import { expect, test } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';
import { openMore } from './runstart';

// The ascension levels of the rogue-lite run (#1465, docs/specs/roguelite.md section 19) in the browser: the start screen picks a
// level unlocked by an earlier win, the pick is on the run line and in the fight's HUD, and a run won unlocks the next level.
// The progress (an act won, the highest level unlocked) is set in localStorage.
test('the rogue-lite run: the start screen picks an ascension level, a run won unlocks the next one, #1465', async ({ page }) => {
  const map = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  await page.evaluate(() => {
    localStorage.setItem('ab-alone.roguelite', '1');
    localStorage.setItem('ab-alone.roguelite.ascension', '4');
  });
  await startMode(page, 'run');
  await openMore(page);
  await expect(map.locator('button[data-ascension]:enabled')).toHaveCount(5); // levels 0 to 4
  await expect(map.locator('button[data-ascension="5"]')).toBeDisabled();
  await map.locator('button[data-ascension="3"]').click();
  await expect(map.locator('.run-line')).toHaveText('Rogue-lite run · ascension 3 · army 14 marbles · pick a fight');
  await expect(map).toContainText('Ascension 3: Armed foes, the bot has 1 more special marble in fights and elites, and every level before it.');
  await shot(page, { path: 'test-results/1465-start-after.png' });

  const won = { seed: 3, army: 8, path: [0, 2, 6, 9, 10], fighting: false, moves: [], end: 'won', specials: [0, 0, 0], placed: [], reward: false, event: false, best: 0, ascension: 4, top: 4 };
  await page.evaluate((s) => (window as any).__run(s), won);
  await expect(page.locator('body')).toHaveAttribute('data-run', 'won');
  await expect(map).toContainText('Ascension: 4');
  await expect(map).toContainText('Ascension 5');
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.roguelite.ascension'))).toBe('5');
});
