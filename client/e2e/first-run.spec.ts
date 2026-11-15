import { expect, test, type Page } from '@playwright/test';
import { BLACK_WINS } from './end-games';

// The first run (#1521, #1523, #1663): a fresh profile gets a three-line cold open, a guided first match (standard board, a very weak bot, a coach
// plate with one step at a time), then the Hub with The Echo as the next goal, with no menu opened and none of the guide's five pages. `?firstrun` makes the automated browser
// a player's first launch (the other specs boot without it, so no first run covers them).

/** A click on a cell without the raycast and the frames of a mouse click, to stay fast. */
async function hookClick(page: Page, q: number, r: number): Promise<void> {
  await page.evaluate(([q, r]) => (window as any).__roll(q, r), [q, r]);
}

const fits = async (page: Page, selector: string): Promise<void> => {
  const box = (await page.locator(selector).boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
};

/** Six plies from the standard start that leave White a push: (-2,-1), (-2,0), (-2,1) into the lone Black marble on the rim (-2,-2). */
const PUSH_POSITION = [
  [3, 4, -2, 2, -2, 3, -2, 4],
  [1, 1, 0, -2, 0, 0, 0, 0],
  [3, 4, -2, 1, -2, 2, -2, 3],
  [1, 1, -1, -2, 0, 0, 0, 0],
  [3, 4, -2, 0, -2, 1, -2, 2],
  [1, 0, 2, -2, 0, 0, 0, 0],
];

/** Cold open, Begin, the first guided step and the first push, loaded as a position instead of replayed. */
async function firstRun(page: Page): Promise<void> {
  const started = Date.now();
  await page.goto('./?firstrun');
  await expect(page.getByRole('dialog', { name: 'Mess, deck 1' })).toBeVisible();
  await expect(page.locator('#coldopen-text p')).toHaveCount(3);
  await expect(page.locator('#guide')).toBeHidden();
  await fits(page, '#coldopen .card');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-firstrun', 'match');
  expect(await page.evaluate(() => (window as any).__plies())).toBe(0); // the standard start, nothing scripted
  await expect(page.locator('#coach-step')).toContainText(/^(Click|Tap) one of your White marbles/);
  await expect(page.locator('#hud .tally-note')).toBeVisible();
  await fits(page, '#coach');
  await hookClick(page, -2, 2); // a selection moves the coach on
  await expect(page.locator('#coach-step')).toContainText('a ringed cell');
  await hookClick(page, -2, 2); // deselected
  await page.evaluate((moves) => (window as any).__playMoves(moves), PUSH_POSITION);
  for (const [q, r] of [[-2, -1], [-2, 0], [-2, 1], [-2, -2]]) await hookClick(page, q, r);
  await expect(page.locator('#hud')).toContainText('White ejected 1/6');
  await expect(page.locator('#coach-step')).toContainText('That is Abalone');
  await fits(page, '#coach');
  expect(Date.now() - started).toBeLessThan(60_000); // #1521: within 60 s
}

/** A won first match (loaded as a finished game): the plate says so and leads to the Hub with The Echo as the goal. */
async function winToHub(page: Page): Promise<void> {
  await page.evaluate((moves) => (window as any).__playMoves(moves), BLACK_WINS);
  await expect(page.locator('#coach-step')).toContainText('You won the first match');
  await fits(page, '#coach');
  await page.locator('#coach-hub').click();
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await expect(page.locator('#hub-rail li[data-goal]')).toHaveAttribute('data-deck', 'mess');
  await expect(page.locator('#hub-labels .hub-label[data-goal]')).toHaveAttribute('data-kind', 'boss');
}

test('a fresh profile plays the guided first match to its first push, wins, and the Hub shows The Echo as the goal', async ({ page }) => {
  await page.goto('./?firstrun');
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await winToHub(page);
  await expect(page.locator('#hub-rail li[data-goal]')).toContainText('Seat: The Echo waits');
  await expect(page.locator('#guide')).toBeHidden();
});

test('the first run can be skipped from the cold open, to the Hub, and plays once', async ({ page }) => {
  await page.goto('./?firstrun');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await page.goto('./?firstrun');
  await expect(page.locator('#coldopen')).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('every card of the first run fits the screen', async ({ page }) => {
    await firstRun(page);
  });

  test('the end plate fits the screen', async ({ page }) => {
    await page.goto('./?firstrun');
    await page.getByRole('button', { name: 'Begin', exact: true }).click();
    await winToHub(page);
  });
});
