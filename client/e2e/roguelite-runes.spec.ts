import { expect, test, type Page } from '@playwright/test';
import { ELITES, RUNES } from '../src/roguelite';
import { startMode } from './modes';
import { shot } from './shot';
import { openMore } from './runstart';

// The runes of the rogue-lite run (#1476, docs/specs/roguelite.md section 27), loaded through the test hook. Seed 3: act 1 has the
// first row 0 and 1, the elites 2 and 6, its boss 9 is reached by 0, 2 and 6.
const run = (state: object) => ({ seed: 3, army: 14, path: [], fighting: false, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false, best: 3, relics: [], relic: false, enemies: true, ...state });
const load = async (page: Page, state: object) => {
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  await page.evaluate((s) => (window as any).__run(s), run(state));
};
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

test('a player who owns the runes sees a secret room and a shortcut in each act, and can walk into the room, #1476', async ({ page }) => {
  const panel = page.locator('#run-map');
  await load(page, { runes: 7 });
  await openMore(page);
  await expect(panel.locator('button[data-node-kind="secret"]')).toHaveCount(3); // one per act
  await expect(panel.locator('polyline.shortcut')).toHaveCount(3);
  await expect(panel.locator('.run-runes')).toContainText('Rune of Stone (a secret room in every act) · ');
  await expect(panel.locator('.run-legend')).toContainText('Secret');
  await expect(panel.getByText('Runes to find')).toHaveCount(0);
  await page.evaluate((s) => (window as any).__run(s), run({ runes: 7, path: [1] })); // the last node of the first row leads to the room
  const room = panel.locator('button[data-node-kind="secret"]').first();
  await expect(room).toBeEnabled();
  await expect(room).toHaveAttribute('aria-label', 'Act 1, secret');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-runes-map.png' });
  await room.click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'relic'); // played as a treasure
  await expect(panel.locator('.run-line')).toHaveText('Treasure · a chest holds a relic');
});

test('a player without runes has the plain map and is told which runes there are to find, #1476', async ({ page }) => {
  const panel = page.locator('#run-map');
  await load(page, { path: [] });
  await openMore(page);
  await expect(panel.locator('button[data-node-kind="secret"]')).toHaveCount(0);
  await expect(panel.locator('polyline.shortcut')).toHaveCount(0);
  await expect(panel.locator('.run-runes')).toHaveCount(0);
  await expect(panel.getByText('Runes to find: Rune of Stone (beat The Wall: a secret room in every act)')).toBeVisible();
});

test('the rune of the exit adds a third, secret exit after the act boss, #1476', async ({ page }) => {
  const panel = page.locator('#run-map');
  await load(page, { runes: 4, path: [0, 2, 6, 9], exits: true, exit: true });
  await expect(panel.locator('button[data-exit]')).toHaveCount(3);
  const secret = panel.locator('button[data-exit][data-secret]');
  await expect(secret).toHaveCount(1);
  await expect(secret).toContainText('Secret exit · ');
  await secret.click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'map');
  await expect(page.locator('body')).toHaveAttribute('data-biome', /\w/);
});

test('an elite of an archetype beaten for the first time finds its rune: told, kept, and open on the next run, #1476', async ({ page }) => {
  const panel = page.locator('#run-map');
  await load(page, { path: [0] });
  const label = (await panel.locator('[data-node="2"]').getAttribute('aria-label'))!; // `Act 1, elite, The Wall, marked: its key`
  const k = ELITES.findIndex((e) => label.includes(e.name));
  expect(k).toBeGreaterThanOrEqual(0);
  const told = `${RUNES[k]!.name} found: ${RUNES[k]!.opens}, on the maps of your next runs`;
  await page.evaluate((s) => (window as any).__run(s), run({ path: [0, 2], relic: true, reward: true, found: 1 << k, told }));
  await expect(panel.locator('.run-line')).toHaveText('Elite beaten · take its relic');
  await expect(panel.locator('.run-help').first()).toHaveText(told);
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.roguelite.runes'))).toBe(String(1 << k)); // kept for good
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-rune-found.png' });
  await page.reload(); // the next run starts with the rune
  await page.waitForFunction(() => typeof (window as any).__run === 'function');
  await startMode(page, 'run');
  await openMore(page);
  await expect(panel.locator('.run-runes')).toContainText(RUNES[k]!.name);
  await expect(panel.getByText('Runes to find')).not.toContainText(RUNES[k]!.name);
});
