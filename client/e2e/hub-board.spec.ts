import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The Hub's first space (#1526, #1528, docs/specs/ui.md section 4.5): one station is the loud one, the others drop to a quiet weight and the
// plates wear the theme's few colours (mode, boss, locked); a notice board says today's daily with its status, the next boss, the medals
// missing and a local streak, and covers no station. The state is loaded through localStorage, as the other Hub specs do.

/** Opens the Hub with `beaten` bosses down on `deck`, and the saved `days` of the daily (day -> record), today being 2027-03-30. */
async function hubWith(page: Page, beaten: string[], deck: string, days: Record<string, string> = {}, search = './?hub=classic'): Promise<void> {
  await page.addInitScript(
    ([beaten, deck, days]) => {
      const now = Date.parse('2027-03-30T08:00:00Z');
      Date.now = () => now;
      localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck, cell: [0, 0], beaten }));
      if (Object.keys(days).length > 0) localStorage.setItem('ab-alone.daily-days', JSON.stringify(days));
    },
    [beaten, deck, days] as const,
  );
  await page.goto(search);
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-hub', `${deck} 0,0`);
}

/** What a rectangle of the page covers: the plates of the rooms, the pips, the HUD, the rail and the buttons of the chrome. */
async function covered(page: Page, selector: string): Promise<string[]> {
  const rect = (await page.locator(selector).boundingBox())!;
  return page.evaluate(
    (r) =>
      [...document.querySelectorAll('#hub-labels .hub-label, #hub-pips, #hud, #hub-rail, #chrome button, #hub-coach')]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.left < r.x + r.width && r.x < b.right && b.top < r.y + r.height && r.y < b.bottom;
        })
        .map((el) => el.id || el.getAttribute('data-cell') || el.textContent),
    rect,
  );
}

for (const [name, viewport, touch] of [
  ['a desktop window, 960x540', { width: 960, height: 540 }, false],
  ['a phone held upright, 390x844', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const kind = touch ? 'phone' : 'desktop';

    test('#1526: the goal plate is the loud one, the others are quiet and wear three colours at most', async ({ page }) => {
      await hubWith(page, [], 'mess');
      const goal = page.locator('#hub-labels .hub-label[data-goal]');
      await expect(goal).toHaveCount(1);
      const style = (selector: string) =>
        page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => ({ opacity: getComputedStyle(el).opacity, border: getComputedStyle(el).borderTopColor })), selector);
      const quiet = await style('#hub-labels .hub-label[data-quiet]');
      expect(quiet.length).toBeGreaterThan(5);
      for (const { opacity } of quiet) expect(Number(opacity)).toBeLessThan(0.9);
      expect(Number((await style('#hub-labels .hub-label[data-goal]'))[0]!.opacity)).toBe(1);
      // #1638: its words are the dark ink on the amber plate, the neon look's violet boss name too
      const ink = await goal.evaluate((el) => [...el.querySelectorAll('b, small, .short')].filter((t) => t.getClientRects().length > 0).map((t) => getComputedStyle(t).color));
      expect(ink.length).toBeGreaterThan(0);
      expect(new Set(ink)).toEqual(new Set(['rgb(26, 19, 0)']));
      expect(new Set(quiet.map(({ border }) => border)).size, 'border colours of the quiet plates').toBeLessThanOrEqual(3);
      await shot(page, { path: `test-results/hub-board-quiet-${kind}.png` });
    });

    test('#1528: the board says the daily and its status, the next boss, the medals missing and the streak, and covers no station', async ({ page }) => {
      await hubWith(page, ['echo'], 'mess', { '2027-03-30': 'won 12', '2027-03-29': 'lost 5' });
      const board = page.locator('#hub-board');
      await expect(board).toBeVisible();
      await expect(board.locator('.daily')).toHaveText(/^Daily: .+\. Won in 12 turns\.$/);
      await expect(board.locator('.streak')).toHaveText('Streak: 2 days.');
      if (!touch) {
        await expect(board.locator('.next')).toHaveText('Next boss: The Hull.');
        await expect(board.locator('.medals')).toHaveText('Medals missing: 15.');
      }
      const { width, height } = page.viewportSize()!;
      const b = (await board.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(await covered(page, '#hub-board'), 'what the board covers').toEqual([]);
      await shot(page, { path: `test-results/hub-board-${kind}.png` });
    });

    test('#1528: a day not played says so, and a missed day leaves no streak and no word about it', async ({ page }) => {
      await hubWith(page, [], 'mess', { '2027-03-27': 'won 8' });
      await expect(page.locator('#hub-board .daily')).toHaveText(/^Daily: .+\. Not played\.$/);
      await expect(page.locator('#hub-board .streak')).toHaveCount(0);
      expect(await covered(page, '#hub-board')).toEqual([]);
    });

    test('#1528: the board waits while the coach line teaches the first minutes', async ({ page }) => {
      await page.goto('./?firstrun&hub=classic');
      await page.locator('canvas').waitFor();
      await page.locator('#coldopen-skip').click();
      await expect(page.locator('#hub-coach')).toBeVisible();
      await expect(page.locator('#hub-board')).toBeHidden();
    });
  });
}
