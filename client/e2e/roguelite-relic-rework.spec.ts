import type { Page } from '@playwright/test';
import { expect, test } from './shared-run';
import { shot } from './shot';

// The four relics that change a tactic (#1539, docs/specs/roguelite.md section 9), each loaded through the test hook. Seed 3: the
// fight 0 and the elite 2 (The Artificer) lead to the elite 6 and the act 1 boss 9; the event at 6 is the Cold locker, a 60 % gamble.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const SPECIALS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const run = (state: object) => ({ seed: 3, army: 14, path: [], fighting: false, moves: [], end: '', specials: SPECIALS, placed: [], reward: false, enemies: true, ...state });
const load = async (page: Page, state: object) => {
  await page.evaluate((s) => (window as any).__run(s), run(state));
};

// The cheapest test comes first: it pays the boot of the worker's shared page.
test('the Salvage magnet is held in an elite\'s fight and says what it salvages, #1539', async ({ game: page }) => {
  await load(page, { relics: [2], path: [0, 2], fighting: true });
  await expect(page.locator('#hud small')).toContainText('act 1 elite · The Artificer');
  await expect(page.locator('#hud .relics .relic')).toHaveAttribute('aria-label', /^Salvage magnet: a won elite turns a plain marble into its own: an Anchor from The Wall/);
});

test('the Jammer hands a Freeze at the start of a fight, the Dampener a Fall back at the start of an act boss, #1539', async ({ game: page }) => {
  const panel = page.locator('#run-map');
  const body = page.locator('body');
  await load(page, { relics: [3, 9] });
  await expect(page.locator('#hud .relics .relic')).toHaveCount(2);
  await panel.locator('button[data-node="0"]').click();
  await expect(body).toHaveAttribute('data-run', 'fight');
  await expect(body).toHaveAttribute('data-tactics', '2'); // a Freeze
  await expect(page.locator('#hud .tactics button[data-tactic="2"]')).toBeEnabled();
  await freshDraw(page);
  await shot(page, { path: 'test-results/1539-jammer-freeze.png' });

  await page.evaluate((s) => (window as any).__run(s), run({ relics: [3, 9], path: [0, 2, 6] }));
  await panel.locator('button[data-node="9"]').click();
  await expect(body).toHaveAttribute('data-run', 'fight');
  await expect(body).toHaveAttribute('data-tactics', '4'); // a Fall back
});

test('the four reworked relics are offered with their rule on the card, #1539', async ({ game: page }) => {
  const panel = page.locator('#run-map');
  const others = [0, 1, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15]; // held, so an act boss offers the reworked ones
  await load(page, { relics: others, path: [0, 2, 6, 9], relic: true, reward: true });
  await expect(panel.locator('.run-line')).toHaveText('Boss beaten · pick a relic');
  await expect(panel.locator('button[data-relic]')).toHaveCount(3);
  const cards = await panel.locator('button[data-relic]').allTextContents();
  expect(cards.every((card) => /Salvage magnet: a won elite|Jammer: a Freeze|Lucky coin: an event shows|Dampener: a Fall back/.test(card))).toBe(true);
  await freshDraw(page);
  await shot(page, { path: 'test-results/1539-cards.png' });
});

test('the Lucky coin says how a gamble turns out before it is taken, #1539', async ({ game: page }) => {
  const panel = page.locator('#run-map');
  await load(page, { relics: [6], path: [0, 2, 6], event: true });
  await expect(panel.locator('.run-line')).toHaveText('Event · Cold locker');
  await expect(panel.locator('button[data-choice="0"]')).toHaveText(/60 %: .*, otherwise .* · Lucky coin: it will (pay off|go wrong)$/);
  await expect(panel.locator('button[data-choice="1"]')).not.toContainText('Lucky coin');
  await freshDraw(page);
  await shot(page, { path: 'test-results/1539-lucky-coin-event.png' });
});
