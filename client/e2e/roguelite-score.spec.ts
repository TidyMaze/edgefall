import { expect, test } from '@playwright/test';
import { shot } from './shot';
import { openMore } from './runstart';

// The score of a run over, the daily run, the run history and the compendium of the rogue-lite run (#1466,
// docs/specs/roguelite.md section 21) in the browser. Seed 3: the act 1 boss 9 is reached by 0, 2 and 6 (two elites), and
// leads to the first fight 10 of act 2, lost here with 3 marbles.
test('the rogue-lite run: a score at the end, the daily run, the history and the compendium, #1466', async ({ page }) => {
  const map = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  const over = { seed: 3, army: 3, path: [0, 2, 6, 9, 10], fighting: false, moves: [], end: 'lost', specials: [1, 0, 0], placed: [], reward: false, event: false, best: 0, relics: [3], flawless: 2 };
  await page.evaluate((s) => (window as any).__run(s), over);
  await expect(page.locator('body')).toHaveAttribute('data-run', 'lost');
  await expect(map.locator('.run-score')).toHaveText('Score: 210 (acts 1 × 100, elites 2 × 25, marbles 3 × 10, flawless fights 2 × 15)');
  await shot(page, { path: 'test-results/roguelite-score-summary.png' });

  await map.getByRole('button', { name: 'New run' }).click();
  await openMore(page);
  const day = new Date().toISOString().slice(0, 10);
  await expect(map.getByRole('button', { name: `Daily run ${day}`, exact: true })).toBeEnabled();
  await map.getByRole('button', { name: 'Run history' }).click();
  await expect(map.locator('li')).toHaveText(['No commander · lost · score 210']);
  await shot(page, { path: 'test-results/roguelite-score-history.png' });
  await map.getByRole('button', { name: 'Back' }).click();

  await map.getByRole('button', { name: 'Compendium' }).click();
  await expect(map.locator('.run-line')).toContainText('Compendium · 3 of');
  await expect(map.locator('li.seen')).toHaveCount(3); // the Jammer, the Heavy and the Captain's Gyroscope
  await shot(page, { path: 'test-results/roguelite-score-compendium.png' });
  await map.getByRole('button', { name: 'Back' }).click();

  await map.getByRole('button', { name: `Daily run ${day}`, exact: true }).click();
  await expect(map.locator('.run-line')).toHaveText(`Daily run ${day} · army 14 marbles · pick a fight`);
  await openMore(page); // a new run starts with More shut
  await expect(map.getByRole('button', { name: /^Daily run .* tried today/ })).toBeDisabled();
  // The reload that resumes the daily run is checked by main.roguelite.test.ts ('the daily run plays the seed of the day, once: it is saved, resumed').
  await shot(page, { path: 'test-results/roguelite-score-daily.png' });
});

// A run that used Auto-play says so at its end, in its score line and its summary (#1542, docs/specs/roguelite.md section 21).
test('the rogue-lite run: a run over that used Auto-play is marked, #1542', async ({ page }) => {
  const map = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function');
  const over = { seed: 3, army: 3, path: [0, 2, 6, 9, 10], fighting: false, moves: [], end: 'lost', specials: [1, 0, 0], placed: [], reward: false, event: false, best: 0, relics: [3], flawless: 2, auto: true };
  await page.evaluate((s) => (window as any).__run(s), over);
  await expect(map.locator('.run-score')).toHaveText('Score: 210 (acts 1 × 100, elites 2 × 25, marbles 3 × 10, flawless fights 2 × 15) · Auto-play used');
  await expect(map.locator('.run-help', { hasText: /^Auto-play used$/ })).toBeVisible();
  await shot(page, { path: 'test-results/1542-auto-960x540.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(map.locator('.run-score')).toBeVisible();
  await shot(page, { path: 'test-results/1542-auto-390x844.png' });
});
