import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';
import { shot } from './shot';

// The evaluation bar (#191): the engine's search score of the position, in local and bot games only.
const click = async (page: Page, q: number, r: number) => {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
};
const fill = (page: Page) =>
  page.locator('#eval').evaluate((el) => Number((el as HTMLElement).style.getPropertyValue('--fill')));
const WORDS = /^(Even|(Black|White) \+\d+\.\d|(Black|White) winning)$/;

test('the evaluation bar follows a local hot-seat game, #191', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const bar = page.locator('#eval');
  const meter = page.getByRole('meter', { name: 'Evaluation' });
  await expect(bar).toBeVisible();
  // The worker answers for the start position, then for each move: the bar says which ply it shows.
  await expect(bar).toHaveAttribute('data-ply', '0', { timeout: 30_000 });

  await click(page, 0, 2); // a Black marble
  await click(page, 0, 1); // its NW neighbour, empty at the start
  await expect(bar).toHaveAttribute('data-ply', '1', { timeout: 30_000 });
  await click(page, 0, -2); // a White marble
  await click(page, 0, -1); // its SE neighbour, empty at the start
  await expect(bar).toHaveAttribute('data-ply', '2', { timeout: 30_000 });

  const words = await meter.getAttribute('aria-valuetext');
  expect(words).toMatch(WORDS);
  await expect(bar.locator('.label')).toHaveText(words!);
  const share = await fill(page);
  expect(share).toBeGreaterThan(0);
  expect(share).toBeLessThan(1);
  await expect(meter).toHaveAttribute('aria-valuenow', String(Math.round(share * 100)));
  await shot(page, { path: 'test-results/eval-bar.png' });
});

test('New game puts the bar back on the start position, #191 #230', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const bar = page.locator('#eval');
  await expect(bar).toHaveAttribute('data-ply', '0', { timeout: 30_000 });
  const start = await page.getByRole('meter', { name: 'Evaluation' }).getAttribute('aria-valuetext');
  await click(page, 0, 2);
  await click(page, 0, 1);
  await expect(bar).toHaveAttribute('data-ply', '1', { timeout: 30_000 });

  const button = page.locator('#new-game');
  await button.click();
  await expect(button).toHaveText('Confirm new game');
  await button.click();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await expect(bar).toHaveAttribute('data-ply', '0', { timeout: 30_000 });
  await expect(page.getByRole('meter', { name: 'Evaluation' })).toHaveAttribute('aria-valuetext', start!);
});

test('the bar follows a bot game, and is absent in a boss fight, #191', async ({ page }) => {
  await page.goto('./?bot=on');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('White to move'); // the board listeners are wired
  const bar = page.locator('#eval');
  const plies = () => page.evaluate(() => (window as any).__plies());
  await click(page, 0, 2);
  await click(page, 0, 1);
  await expect.poll(plies, { timeout: 30_000 }).toBe(2); // the bot answered
  await expect(bar).toHaveAttribute('data-ply', '2', { timeout: 30_000 });

  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(bar).toBeHidden();
  await click(page, 0, 2);
  await click(page, 0, 1);
  await expect.poll(plies, { timeout: 30_000 }).toBe(2); // the boss answered
  await expect(bar).toBeHidden();
});

test('the bar is absent in an online game, for the room creator and the invited player, #191', async ({ page }) => {
  await page.goto('./?net=hook#room=evalbar191');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Joining as White...');
  await expect(page.locator('#eval')).toBeHidden();

  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#eval')).toBeVisible();
  await openModes(page);
  await page.locator('#play-online').click();
  await expect(page.locator('#hud')).toContainText('You are Black');
  await expect(page.locator('#eval')).toBeHidden();
});
