import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The Echo offers the player the mirror of its move as a free move (#958, game-design.md section 7.4). ?bot=off: the
// test plays both sides through the click hook. Black steps up (its mirror is the Echo's bonus), White steps east: the
// player is offered (0,1) to (-1,1). The screenshots are kept for the report.

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

const click = (page: Page, q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__click(cq, cr), [q, r]);

test('The Echo offers a free move: its marble ringed, a diamond on the selected target, taking it keeps the turn (#958)', async ({ page }) => {
  const body = page.locator('body');
  const tell = page.locator('#hud .boss .tell');
  await page.emulateMedia({ reducedMotion: 'reduce' }); // slides take no time
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  for (const [q, r] of [[0, 2], [0, 1], [0, -1], [1, -1]] as const) await click(page, q, r);
  await expect(body).toHaveAttribute('data-echo-free', '1');
  await expect(tell).toHaveText('Free move: a ringed marble moves for free, any other move declines it');
  await freshDraw(page);
  await shot(page, { path: 'test-results/echo-offer-ringed.png' });

  await click(page, 0, 1);
  await expect(body).toHaveAttribute('data-echo-free-target', '1');
  await expect(tell).toHaveText('Free move: the diamond target is free, then you move again');
  await freshDraw(page);
  await shot(page, { path: 'test-results/echo-offer-selected.png' });

  await click(page, -1, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(3);
  await expect(body).toHaveAttribute('data-echo-free', '0');
  await expect(tell).toHaveText('Echo rule: when one of your marbles is ringed, it moves for free; any other move declines it'); // the rule stays on the plate (#1674)
});

// The goal card (#1524, docs/specs/ui.md section 4.8): two short steps and a picture of marbles, in the HUD before the first move and in the Goal
// sheet after it, in place of the one long line. The card is inside the window and never covers the boss bar.
for (const [name, viewport, touch] of [
  ['a desktop window, 960x540', { width: 960, height: 540 }, false],
  ['a phone held upright, 390x844', { width: 390, height: 844 }, true],
] as const) {
  test.describe(`the goal card, ${name}`, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    test('shows two steps and a picture in the HUD, then in the Goal sheet after the first move', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await startMode(page, 'echo');
      await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
      const card = page.locator('#hud .boss .goal-card');
      await expect(card.locator('ol.goal-steps li')).toHaveText([
        'Eject 6 Black marbles to win; a draw loses.',
        'Moves are mirrored for free: take the ringed mirror, then play your own.',
      ]);
      await expect(page.locator('#hud')).not.toContainText('Every move is mirrored for free for the other side');
      const { width, height } = page.viewportSize()!;
      const inside = async (selector: string) => {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
        return box;
      };
      if (touch) {
        await expect(page.locator('#hud .boss .goal-card svg')).toBeHidden(); // the plate held upright has room for the two steps only: the picture is in the sheet
      } else {
        const picture = await inside('#hud .boss .goal-card svg');
        expect(picture.width).toBeGreaterThan(60);
        expect(picture.height).toBeGreaterThan(15);
      }
      await inside('#hud');
      const plate = (await page.locator('#hud').boundingBox())!;
      const bar = (await page.locator('#boss-bar').boundingBox())!;
      expect(plate.x + plate.width <= bar.x || bar.x + bar.width <= plate.x || plate.y + plate.height <= bar.y || bar.y + bar.height <= plate.y, 'the plate covers the boss bar').toBe(true);
      await shot(page, { path: `test-results/echo-card-hud-${touch ? 'phone' : 'desktop'}.png` });

      for (const [q, r] of [[0, 2], [0, 1], [0, -1], [1, -1]] as const) await click(page, q, r);
      await expect(page.locator('body')).toHaveAttribute('data-echo-free', '1');
      await expect(page.locator('#hud .boss .goal-card')).toHaveCount(0); // the goal is shown once: now in the sheet
      await page.locator('#boss-goal').click();
      await expect(page.locator('#goal-sheet ol.goal-steps li')).toHaveCount(2);
      const sheetPicture = await inside('#goal-sheet svg');
      expect(sheetPicture.width).toBeGreaterThan(100);
      await shot(page, { path: `test-results/echo-card-sheet-${touch ? 'phone' : 'desktop'}.png` });
    });
  });
}
