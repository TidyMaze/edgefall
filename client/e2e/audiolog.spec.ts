import { expect, test } from '@playwright/test';
import { logOf } from '../src/audiologs';

// #516: the audio log player. While the player reads the deck console, Play log plays the deck's audio log, music and
// ambience ducked under it; the transcript shows line by line, on by default, with a saved Transcript toggle beside
// Sound; Skip log stops it at any time and a move lands while it plays. body[data-log] names the log playing.
const ducked = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __ducked: () => boolean }).__ducked());

test('play a log, move a marble while it plays, toggle the transcript, skip it, #516', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule /);
  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Play log' }).click();
  await expect(body).toHaveAttribute('data-log', 'mess-first-game');
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.logs-collected'))).toBe('mess-first-game'); // #517
  expect(await ducked(page)).toBe(true);
  const transcript = page.locator('#transcript');
  await expect(transcript).toHaveText(logOf('mess').lines[0]!.text);
  await page.keyboard.press('Escape'); // back to the board, the log plays on
  await expect(body).not.toHaveAttribute('data-reading');
  const cell = (q: number, r: number) =>
    page.evaluate(([cq, cr]) => (window as unknown as { __cellToScreen: (q: number, r: number) => { x: number; y: number } }).__cellToScreen(cq!, cr!), [q, r]);
  const from = await cell(0, 2);
  await page.mouse.click(from.x, from.y);
  const to = await cell(0, 1);
  await page.mouse.click(to.x, to.y);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(body).toHaveAttribute('data-log', 'mess-first-game');
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggle = page.getByRole('button', { name: 'Transcript' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(transcript).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.transcript'))).toBe('off');
  await toggle.click();
  await expect(transcript).toBeVisible();
  await page.keyboard.press('Escape'); // the menu closes
  await page.getByRole('button', { name: 'Skip log' }).click();
  await expect(body).not.toHaveAttribute('data-log');
  await expect(transcript).toBeHidden();
  expect(await ducked(page)).toBe(false);
});

// #517: a click on the deck's recorder prop plays its log and collects it; the log archive lists it and replays it.
test('collect a log from the recorder, then replay it from the log archive, #517', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule /);
  // The bay loads after the page and rebuilds the props, the recorder included: a click on the old one lands on nothing (#839).
  await expect(body).toHaveAttribute('data-bay', 'ready');
  type Rect = { x: number; y: number; width: number; height: number };
  const r = await page.evaluate(() => (window as unknown as { __recorderRect: () => Rect }).__recorderRect());
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await expect(body).toHaveAttribute('data-log', 'mess-first-game');
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.logs-collected'))).toBe('mess-first-game');
  await page.getByRole('button', { name: 'Skip log' }).click();
  await expect(body).not.toHaveAttribute('data-log');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#setting-log-archive').dispatchEvent('click'); // hidden: the Logs' home is the ship's Logs bays (#1693), the archive page is the same
  await page.getByRole('button', { name: logOf('mess').title }).click();
  await expect(body).toHaveAttribute('data-log', 'mess-first-game');
  await expect(page.locator('#transcript')).toHaveText(logOf('mess').lines[0]!.text);
});
