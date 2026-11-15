import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// Boss relics, keys and a fourth act of the rogue-lite run (#1467, docs/specs/roguelite.md section 22), each step loaded
// through the test hook. Seed 3: act 1 has the elites 2 and 6 (the first, 2, holds the Emerald key), the rest 3 and the treasure 4;
// its boss 9 is reached by 0, 2 and 6. The path 1, 3, 6, 9 (act 1), 10, 13, 17, 19 (act 2) and 20, 22, 26, 29 (act 3) ends on
// the third boss, which leads to the fourth act's elite 30 and boss 31 with the three keys.
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};
const run = (state: object) => ({ seed: 3, army: 12, path: [1], fighting: false, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false, best: 3, relics: [], relic: false, ...state });
const THIRD_BOSS = [1, 3, 6, 9, 10, 13, 17, 19, 20, 22, 26, 29];

test('an act boss offers a boss relic among its three, with its cost, #1467', async ({ page }) => {
  const panel = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function'); // the page is ready
  await page.evaluate((s) => (window as any).__run(s), run({ path: [0, 2, 6, 9], reward: true, relic: true }));
  await expect(panel.locator('.run-line')).toHaveText('Boss beaten · pick a relic');
  await expect(panel.locator('button[data-relic]')).toHaveCount(3);
  const boss = panel.locator('button[data-boss-relic]');
  await expect(boss).toHaveCount(1);
  await expect(boss).toContainText(' but ');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-boss-relic.png' });
  await boss.click();
  await expect(page.locator('#hud .relics .relic')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-run', 'reward');
});

test('the marked elites, a rest given up for the Ruby key, the keys on the map, #1467', async ({ page }) => {
  const panel = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function');
  await page.evaluate((s) => (window as any).__run(s), run({ path: [1] }));
  await expect(panel.locator('button.node.marked')).toHaveCount(3); // the first elite of each act
  await expect(panel.getByRole('button', { name: 'Act 1, elite, marked: its key' })).toBeVisible();
  await panel.getByRole('button', { name: 'Act 1, rest' }).click();
  await expect(panel.locator('button[data-key="0"]')).toContainText('Give up the rest: take the Ruby key');
  await panel.locator('button[data-key="0"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'map');
  await expect(panel.locator('.run-keys')).toContainText('1 of 3 keys · Ruby key');
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-keys-map.png' });
});

test('with the three keys the third boss leads to act 4: an elite, then the final boss, #1467', async ({ page }) => {
  const panel = page.locator('#run-map');
  await page.goto('./?bot=off');
  await page.waitForFunction(() => typeof (window as any).__run === 'function');
  await page.evaluate((s) => (window as any).__run(s), run({ path: THIRD_BOSS, army: 14 }));
  await expect(panel.locator('button[data-node="30"], button[data-node="31"]')).toHaveCount(0); // act 4 is not on the map without the keys
  await page.evaluate((s) => (window as any).__run(s), run({ path: THIRD_BOSS, army: 14, keys: [0, 1, 2] }));
  await expect(panel.locator('.run-keys')).toContainText('Act 4 is open');
  await expect(panel.getByRole('button', { name: 'Act 4, boss' })).toBeDisabled();
  await expect(panel.locator('button[data-node="30"]')).toBeEnabled();
  await panel.evaluate((el) => (el.scrollTop = el.scrollHeight)); // the plate scrolls inside itself: act 4 is its last two rows
  await expect(panel.getByRole('button', { name: 'Act 4, boss' })).toBeInViewport({ ratio: 1 });
  const [plate, dock] = await Promise.all([panel.boundingBox(), page.locator('#exit').boundingBox()]);
  // The plate never covers the dock, so the boss can be pressed: above it on a desktop or held upright, beside it on a short window where the dock is a column at the side.
  expect(plate!.y + plate!.height <= dock!.y || plate!.x + plate!.width <= dock!.x || dock!.x + dock!.width <= plate!.x).toBe(true);
  await freshDraw(page);
  await shot(page, { path: 'test-results/roguelite-act4.png' });
  await panel.locator('button[data-node="30"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-run', 'fight');
});
