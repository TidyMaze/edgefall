import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// The next-goal line of the Hub (#1524, docs/specs/ui.md section 4.7): one line of the lift-shaft rail always says the next thing to do, from what
// the player has done: The Echo, then a first rogue-lite run, then the next deck's boss. The progress is loaded through localStorage, as the
// other Hub specs do. It reads in the rail on a desktop window and on a phone held upright, and covers no plate of a room.

/** Opens the Hub with `beaten` bosses down, the marble on `deck`, and, when `ran`, a run played (the acts won saved by the run's own store). */
async function hubWith(page: Page, beaten: string[], deck: string, ran: boolean): Promise<void> {
  await page.addInitScript(([beaten, deck, ran]) => {
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck, cell: [0, 0], beaten }));
    if (ran) localStorage.setItem('ab-alone.roguelite', '1');
  }, [beaten, deck, ran] as const);
  await page.goto('./?hub=classic');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-hub', `${deck} 0,0`);
}

/** The line shows inside the window and over no plate of a room, the pips or the HUD. */
async function lineIsClear(page: Page): Promise<void> {
  const { width, height } = page.viewportSize()!;
  const rail = (await page.locator('#hub-rail').boundingBox())!;
  const line = (await page.locator('#hub-rail p.goal').boundingBox())!;
  expect(line.x).toBeGreaterThanOrEqual(0);
  expect(line.y).toBeGreaterThanOrEqual(0);
  expect(line.x + line.width).toBeLessThanOrEqual(width);
  expect(line.y + line.height).toBeLessThanOrEqual(height);
  expect(line.y + line.height).toBeLessThanOrEqual(rail.y + rail.height + 1);
  const covered = await page.evaluate(
    (r) =>
      [...document.querySelectorAll('#hub-labels .hub-label, #hub-pips, #hud, #chrome button')]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.left < r.x + r.width && r.x < b.right && b.top < r.y + r.height && r.y < b.bottom;
        })
        .map((el) => el.id || el.getAttribute('data-cell') || el.textContent),
    rail,
  );
  expect(covered, 'what the rail covers').toEqual([]);
}

for (const [name, viewport, touch] of [
  ['a desktop window, 960x540', { width: 960, height: 540 }, false],
  ['a phone held upright, 390x844', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const kind = touch ? 'phone' : 'desktop';

    test('before any boss falls the line says to beat The Echo, and its door is the plate marked', async ({ page }) => {
      await hubWith(page, [], 'mess', false);
      await expect(page.locator('#hub-rail p.goal')).toHaveText('Next goal: Beat The Echo on the Mess deck.');
      await expect(page.locator('#hub-labels .hub-label[data-goal]')).toHaveAttribute('data-kind', 'boss');
      await lineIsClear(page);
      await shot(page, { path: `test-results/next-goal-echo-${kind}.png` });
    });

    test('once The Echo is beaten the line says to start a rogue-lite run, its room is marked, and after a run it names the next boss', async ({ page }) => {
      await hubWith(page, ['echo'], 'cargo', false);
      await expect(page.locator('#hub-rail p.goal')).toHaveText('Next goal: Start a rogue-lite run on the Cargo deck.');
      await expect(page.locator('#hub-labels .hub-label[data-goal]')).toHaveAttribute('data-kind', 'run');
      await expect(page.locator('#hub-rail li[data-goal]')).toHaveAttribute('data-deck', 'cargo');
      await lineIsClear(page);
      await shot(page, { path: `test-results/next-goal-run-${kind}.png` });
      await page.evaluate(() => localStorage.setItem('ab-alone.roguelite', '1')); // a run was played
      await page.reload();
      await expect(page.locator('#hub-rail p.goal')).toHaveText('Next goal: Beat The Hull on the Cargo deck.');
      await expect(page.locator('#hub-labels .hub-label[data-goal]')).toHaveAttribute('data-kind', 'boss');
      await lineIsClear(page);
    });
  });
}
