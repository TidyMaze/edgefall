import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The bot's estimated rating and level in the fight HUD (#1611, docs/specs/roguelite.md section 32), read through the test hook
// (body[data-bot-rating]) and the line itself, in a plain bot game and in a run's fight, on a desktop and a phone.
const medals = (n: number) => JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`boss${i}`, 9])));
const pinNormal = (page: Page) => page.addInitScript(() => localStorage.setItem('ab-alone.difficulty', 'normal')); // measured at a known difficulty, not the default (Easy, #1664)
const line = (page: Page) => page.locator('#hud .bot-rating');

test('a new player meets the lowest bot, and all fifteen medals the peak: an estimated rating and a level, #1611', async ({ page }) => {
  await pinNormal(page);
  await page.goto('./?x=1');
  await page.locator('canvas').waitFor();
  await expect(line(page)).toHaveText('Bot ~1070 · Easy');
  await expect(page.locator('body')).toHaveAttribute('data-bot-rating', '1070');
  expect(await line(page).getAttribute('title')).toMatch(/estimate/i);
  await shot(page, { path: 'test-results/1611-plain-960.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(line(page)).toBeInViewport();
  await shot(page, { path: 'test-results/1611-plain-390.png' });
  await page.addInitScript((m) => localStorage.setItem('ab-alone.medals', m), medals(15));
  await page.reload();
  await expect(line(page)).toHaveText('Bot ~1600 · Hard');
});

test('the first fight of a run is a quarter of the bot the medals give, on a phone too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pinNormal(page);
  await page.goto('./?x=1');
  await page.waitForFunction(() => (window as any).__run);
  await page.evaluate((s) => (window as any).__run(s), { seed: 3, army: 14, path: [0], fighting: true, moves: [], end: '', specials: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], placed: [], reward: false });
  await expect(line(page)).toHaveText('Bot ~940 · Easy');
  const box = (await line(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shot(page, { path: 'test-results/1611-run-390.png' });
  await page.setViewportSize({ width: 960, height: 540 });
  await expect(line(page)).toBeInViewport();
  await shot(page, { path: 'test-results/1611-run-960.png' });
});

test('a boss fight shows Boss and its rating from its own search budget, on a phone too, #1611', async ({ page }) => {
  await pinNormal(page);
  await page.goto('./?x=1');
  await page.locator('canvas').waitFor();
  await startMode(page, 'echo');
  await expect(line(page)).toHaveText('Boss ~1000 · Easy');
  await expect(page.locator('body')).toHaveAttribute('data-bot-rating', '1000');
  expect(await line(page).getAttribute('title')).toMatch(/search/i);
  await shot(page, { path: 'test-results/1611-boss-960.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(line(page)).toBeInViewport();
  const box = (await line(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shot(page, { path: 'test-results/1611-boss-390.png' });
});
