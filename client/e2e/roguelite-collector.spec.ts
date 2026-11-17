import { expect, test } from '@playwright/test';
import { shot } from './shot';

// The rogue-lite Collector (#1470, docs/specs/roguelite.md section 15), loaded through the test hook: the blueprint an elite
// or an act boss dropped named on its reward screen, the Collector's room after the act 1 boss, a blueprint banked for good
// (kept in the browser, so a new run has one less to bank), and Leave back to the map. Seed 3: the act 1 boss 9 is reached by 0, 2 and 6.
const KEY = 'ab-alone.roguelite.blueprints';
const run = (state: object) => ({ seed: 3, army: 12, path: [0, 2, 6, 9], fighting: false, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false, best: 0, ...state });

test('the Collector: a drop on the reward screen, the room after the act boss, a blueprint banked for good, #1470', async ({ page }, testInfo) => {
  const panel = page.locator('#run-map');
  const line = panel.locator('.run-line');
  const hook = (state: object) => page.evaluate((s) => (window as any).__run(s), state);
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready

  await hook(run({ reward: true, cells: 8, carried: [0], drop: 1 }));
  await expect(line).toHaveText('Fight won · pick a reward');
  await expect(panel.locator('.run-help')).toHaveText(/^Blueprint found · Relic blueprint · Lucky coin: an event shows how each of its gambles turns out before you take it · kept for the Collector/);
  await shot(page, { path: testInfo.outputPath('roguelite-blueprint-drop.png') });

  await hook(run({ cells: 12, carried: [0, 8], collector: true }));
  await expect(page.locator('body')).toHaveAttribute('data-run', 'collector');
  await expect(line).toHaveText('Collector · 12 cells');
  await expect(panel.locator('button[data-collect]')).toHaveCount(2);
  await shot(page, { path: testInfo.outputPath('roguelite-collector.png') });

  await panel.locator('button[data-collect="0"]').click(); // the Lucky coin, banked for 5 cells
  await expect(line).toHaveText('Collector · 7 cells');
  await expect(panel.locator('button[data-collect]')).toHaveCount(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('[0]');
  await panel.getByRole('button', { name: 'Leave' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'map');
  await expect(line).toHaveText('Rogue-lite run · army 12 marbles · 7 cells · 1 blueprint · pick a fight');

  // A new run reads what was banked (one less to bank): main.roguelite.test.ts `a new run starts with the blueprints banked before it` (#1710, no reload here).
});
