import { expect, test, type Page } from '@playwright/test';
import { openModes } from './modes';
import { shot } from './shot';

// Auto-play (#792, docs/specs/ui.md section 4.3): the bot plays the player's side, stoppable, and a boss needs its medal.

const plies = (page: Page) => page.evaluate(() => (window as any).__plies() as number);
const toggle = (page: Page) => page.getByRole('button', { name: 'Auto-play' });

test('the bot plays the player side of a bot game until Auto-play is turned off', async ({ page }) => {
  await page.goto('./?nodes=50');
  await expect(toggle(page)).toBeEnabled();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => plies(page)).toBeGreaterThanOrEqual(3);
  await shot(page, { path: 'test-results/autoplay-on.png' });
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hint')).toBeEnabled(); // the bot is done thinking: the board answers clicks again
  await expect.poll(() => page.evaluate(() => (window as any).__botBusy() as boolean)).toBe(false); // the bot's own reply, asked for before the click, lands after the last slide (ui.md 4.3)
  const stopped = await plies(page);
  await page.waitForTimeout(1500);
  expect(await plies(page)).toBe(stopped);
});

test('Auto-play is greyed with its reason against a boss without a medal, and plays once the medal is earned', async ({ page }) => {
  await page.goto('./?nodes=50');
  const fight = async () => {
    await openModes(page);
    await page.getByRole('button', { name: 'Boss fight' }).click();
    await page.locator('#boss-list').getByRole('button', { name: 'The Echo' }).click();
    await expect(page.locator('#boss-bar .name')).toHaveText('The Echo');
  };
  await fight();
  await expect(toggle(page)).toBeDisabled();
  await expect(page.locator('#auto-reason')).toHaveText('Beat The Echo once to unlock Auto-play against it');
  await shot(page, { path: 'test-results/autoplay-greyed.png' });
  await page.evaluate(() => localStorage.setItem('ab-alone.medals', JSON.stringify({ echo: 14 })));
  await fight();
  await expect(toggle(page)).toBeEnabled();
  await toggle(page).click();
  await expect.poll(() => plies(page)).toBeGreaterThanOrEqual(2);
});

test("Auto-play plays the army's side of a rogue-lite run fight, loaded through the test hook (#1489)", async ({ page }) => {
  await page.goto('./?nodes=50');
  await page.waitForFunction(() => typeof (window as any).__run === 'function');
  await page.evaluate((s) => (window as any).__run(s), { seed: 3, army: 14, path: [0], fighting: true, moves: [], end: '', specials: [0, 0, 0], placed: [], reward: false, event: false });
  await expect(page.locator('body')).toHaveAttribute('data-run', 'fight');
  await expect(toggle(page)).toBeEnabled();
  await expect(page.locator('#auto-reason')).toContainText('Daily does not rank'); // the cost is said before Auto-play is used (#1675)
  await shot(page, { path: 'test-results/autoplay-run-off.png' });
  await toggle(page).click();
  await expect.poll(() => plies(page)).toBeGreaterThanOrEqual(2);
  await shot(page, { path: 'test-results/autoplay-run-on.png' });
  await toggle(page).click();
});
