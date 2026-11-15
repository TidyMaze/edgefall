import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// #1538: the Medal room lists the wins of the attempts of each boss, an attempt being a fight whose first move was played;
// the difficulty changes the tells that need a hover: the Echo's bonus rings are shown for every move of the selected marble
// on easy, on a hovered move on normal, never on hard. The saved state is written before the page loads.

/** Opens the page with `saved` in localStorage, as a player who played before. */
async function openWith(page: Page, saved: Record<string, string>): Promise<void> {
  await page.addInitScript((items) => {
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
  }, saved);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
}

async function startEcho(page: Page): Promise<void> {
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
}

const click = (page: Page, q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__roll(cq, cr), [q, r]);
const read = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), key);

test('the Medal room shows the wins of the attempts of each boss, and the first move of a fight is an attempt (#1538)', async ({ page }, testInfo) => {
  await openWith(page, {
    'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 1], beaten: [] }),
    'ab-alone.medals': JSON.stringify({ echo: 7 }),
    'ab-alone.boss-tally': JSON.stringify({ echo: { wins: 2, attempts: 5 }, hull: { wins: 0, attempts: 3 } }),
  });
  await startMode(page, 'hub');
  await click(page, 0, 2); // the Medal room
  const reader = page.locator('#reader');
  await expect(reader).toContainText('The Echo: 7 turns. Won 2 of 5.');
  await expect(reader).toContainText('The Hull: Not beaten. Won 0 of 3.');
  await expect(reader).toContainText('The Choir: Not beaten.');
  await shot(page, { path: testInfo.outputPath('medal-room.png') });
  await page.keyboard.press('Escape');

  // The fight opened is not an attempt, its first move is.
  await startEcho(page);
  expect((await read(page, 'ab-alone.boss-tally')).echo).toEqual({ wins: 2, attempts: 5 });
  await click(page, 0, 2);
  await click(page, 0, 1);
  await expect.poll(() => read(page, 'ab-alone.boss-tally').then((t) => t.echo)).toEqual({ wins: 2, attempts: 6 });
});

/** The Echo with the marble at (0, 2) selected, and (0, 1) hovered when `over`. */
async function selectEcho(page: Page, difficulty: string, over: boolean): Promise<void> {
  await openWith(page, { 'ab-alone.difficulty': difficulty });
  await startEcho(page);
  await click(page, 0, 2);
  if (over) {
    const { x, y } = await page.evaluate(() => (window as any).__cellToScreen(0, 1));
    await page.mouse.move(x, y);
  }
}

for (const [difficulty, over, expected] of [
  ['normal', false, '0'],
  ['normal', true, '1'],
  ['easy', false, '3'],
  ['hard', true, '0'],
] as const) {
  test(`The Echo's bonus rings on ${difficulty}, ${over ? 'a move hovered' : 'nothing hovered'}: ${expected} (#1538)`, async ({ page }) => {
    await selectEcho(page, difficulty, over);
    await expect(page.locator('body')).toHaveAttribute('data-echo-bonus', expected);
  });
}
