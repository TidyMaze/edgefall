import { expect, test, type Locator, type Page } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The first minutes in the Hub (#1522, docs/specs/ui.md sections 4.5 and 4.7): a coach line says how to move until the player has
// rolled, a tap or a click on a plate walks the marble to its room, and the first entry of a mode from the Hub asks first. An automated
// browser shows the line and the confirm only under ?firstrun, so the specs that walk into rooms boot as before.

/** A click on a cell without the raycast and the frames of a mouse click, to stay fast. */
async function hookClick(page: Page, q: number, r: number): Promise<void> {
  await page.evaluate(([q, r]) => (window as any).__click(q, r), [q, r]);
}

/** A player's first launch, skipped to the Hub: the marble on the start cell of the Mess, The Echo's door the goal. */
async function firstHub(page: Page): Promise<void> {
  await page.goto('./?firstrun&hub=classic');
  await page.locator('canvas').waitFor();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await expect(page.locator('#hub-labels .hub-label[data-goal]')).toBeVisible();
}

/** Nothing of `plate` lies over a plate of a room, the YOU plate, the rail or the pips: the Echo's marked door stays in view. */
async function coversNothing(page: Page, plate: Locator): Promise<void> {
  const box = (await plate.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  const hidden = await page.evaluate(
    (b) =>
      [...document.querySelectorAll('#hub-labels .hub-label, #hub-rail, #hub-pips, #hud, #chrome button')]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < b.x + b.width && b.x < r.right && r.top < b.y + b.height && b.y < r.bottom;
        })
        .map((el) => el.id || el.getAttribute('data-cell') || el.textContent),
    box,
  );
  expect(hidden, 'what the plate covers').toEqual([]);
}

for (const [name, viewport, touch] of [
  ['a desktop window, 960x540', { width: 960, height: 540 }, false],
  ['a phone held upright, 390x844', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    /** A tap on a touch screen, a click otherwise. */
    const press = (page: Page, target: Locator) => (touch ? target.tap() : target.click());

    test('the coach line names the place and the way to move, covers no plate, and goes once the player rolled', async ({ page }) => {
      await firstHub(page);
      const coach = page.locator('#hub-coach');
      await expect(coach).toBeVisible();
      await expect(coach).toContainText('Tap or click a next cell to roll. The arrow keys or the stick do the same.');
      await coversNothing(page, coach);
      await shot(page, { path: `test-results/hub-walk-coach-${touch ? 'phone' : 'desktop'}.png` });
      await hookClick(page, 1, 0);
      await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 1,0');
      await expect(coach).toBeHidden();
      await page.goto('./?firstrun&hub=classic'); // a new launch: the first run is done, the Hub is opened from the menu on the saved cell
      await page.locator('canvas').waitFor();
      await startMode(page, 'hub');
      await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 1,0');
      await expect(coach).toBeHidden(); // it does not come back
    });

    test('a tap on a plate walks the marble to the room, and the first entry asks first by name, covering no plate', async ({ page }) => {
      await firstHub(page);
      await press(page, page.locator('#hub-labels [data-cell="-2,0"]')); // the House table
      await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess -1,0'); // next to it: the confirm asks
      const confirm = page.locator('#hub-confirm');
      await expect(confirm).toBeVisible();
      await expect(page.locator('#hub-confirm-text')).toHaveText("Enter House table (play the ship's bot)?");
      await coversNothing(page, confirm);
      await shot(page, { path: `test-results/hub-walk-confirm-${touch ? 'phone' : 'desktop'}.png` });
      await press(page, page.locator('#hub-confirm-no')); // Stay
      await expect(confirm).toBeHidden();
      await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess -1,0');
      await hookClick(page, -2, 0); // the next roll onto it asks again
      await expect(confirm).toBeVisible();
      await press(page, page.locator('#hub-confirm-yes'));
      await expect(page.locator('body')).not.toHaveAttribute('data-hub', /.+/); // the Bot game started
      await expect(page.locator('#hud')).toContainText('White to move');
    });

    test('once a mode was entered the confirm never comes back, and a plate walks straight in', async ({ page }) => {
      await page.goto('./?firstrun&hub=classic');
      await page.locator('canvas').waitFor();
      await page.evaluate(() => localStorage.setItem('ab-alone.entered', 'yes'));
      await page.getByRole('button', { name: 'Skip', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
      await press(page, page.locator('#hub-labels [data-cell="-2,0"]'));
      await expect(page.locator('body')).not.toHaveAttribute('data-hub', /.+/);
      await expect(page.locator('#hub-confirm')).toBeHidden();
    });
  });
}
