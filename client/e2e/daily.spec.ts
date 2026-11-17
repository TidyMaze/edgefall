import { expect, test } from '@playwright/test';
import { loseByRepetition, startDaily } from './fight-end';
import { startMode } from './modes';
import { shot } from './shot';

// Daily challenge (#195): the UTC date gives the boss and the seed, the same for every load of the
// day, and each start counts one attempt of the day in localStorage. The clock is fixed by page.clock.
test('the daily challenge keeps its boss and seed all day, counts attempts, and changes at 00:00 UTC, #195', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the slides take no time
  const hud = page.locator('#hud');
  const daily = page.locator('#daily');
  const fight = () => page.evaluate(() => (window as any).__fight());
  const history = () => page.evaluate(() => (window as any).__history()) as Promise<number[][]>;
  const load = async (time: string) => {
    await page.clock.setFixedTime(new Date(time));
    await page.goto('./');
    await expect(daily).toBeEnabled();
  };
  // The later days start in the page: a start reads the clock again (today(), main.ts) and the attempts are in localStorage, so the reloads these
  // legs had are unit tests (daily.test.ts: "counts one more attempt at each start", "resets on a new UTC day", "is the same after a reload"; #1710).
  const later = (time: string) => page.clock.setFixedTime(new Date(time));
  const click = (q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__roll(cq, cr), [q, r]); // the page's own click, no mouse round trip
  // The first forward one-marble move (NW or NE), then the boss reply.
  const advance = async () => {
    const mv = await page.evaluate(() =>
      (window as any).__legal().find((m: any) => m.cells.length === 1 && (m.dir === 4 || m.dir === 2)),
    );
    const [q, r] = mv.cells[0];
    await click(q, r);
    await click(mv.dir === 4 ? q : q + 1, r - 1);
    await expect.poll(async () => (await history()).length, { timeout: 30_000 }).toBe(2);
  };

  await load('2027-03-30T08:00:00Z');
  await expect(daily).toHaveText(/^Daily challenge 2027-03-30: The /);
  const title = (await daily.textContent())!;
  const name = title.split(': ')[1]!;
  await startMode(page, 'daily');
  await expect(page.locator('#boss-bar .name')).toContainText(name);
  await expect(hud).toContainText('Daily challenge 2027-03-30 · attempt 1');
  const first = await fight();
  expect(first.daily).toEqual({ day: '2027-03-30', attempt: 1 });
  await advance();
  const played = await history();
  await shot(page, { path: testInfo.outputPath('daily-attempt-1.png') });

  // Retry counts one more attempt, and the same seed gives the same boss reply to the same move.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(hud).toContainText('Daily challenge 2027-03-30 · attempt 2');
  expect(await fight()).toEqual({ ...first, daily: { day: '2027-03-30', attempt: 2 } });
  await advance();
  expect(await history()).toEqual(played);

  // A second load the same day, a second before midnight: the same boss and seed, attempt 3.
  await later('2027-03-30T23:59:59Z');
  await startMode(page, 'daily');
  await expect(daily).toHaveText(title);
  await expect(hud).toContainText('Daily challenge 2027-03-30 · attempt 3');
  expect(await fight()).toEqual({ ...first, daily: { day: '2027-03-30', attempt: 3 } });

  // 00:00 UTC: a new day and a new seed (the boss may be the same), the counter starts again.
  await later('2027-03-31T00:00:00Z');
  await startMode(page, 'daily');
  await expect(daily).toHaveText(/^Daily challenge 2027-03-31: The /);
  await expect(hud).toContainText('Daily challenge 2027-03-31 · attempt 1');
  const next = await fight();
  expect(next.seed).not.toBe(first.seed);
  expect(next.daily).toEqual({ day: '2027-03-31', attempt: 1 });
  await shot(page, { path: testInfo.outputPath('daily-next-day.png') });
});

test('a plain boss fight shows no daily line and does not count a daily attempt, #195', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-03-30T08:00:00Z'));
  await page.goto('./');
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(page.locator('#hud')).not.toContainText('Daily challenge');
  await page.getByRole('button', { name: 'Retry' }).click();
  await startMode(page, 'daily');
  await expect(page.locator('#hud')).toContainText('Daily challenge 2027-03-30 · attempt 1');
});

// The goal (#248): the HUD states it before the first move, folds away at the first move so the plate keeps its
// usual size, and the Goal control shows it again on demand.
test('the daily goal shows before the first move, folds away after it, and the Goal control brings it back, #248', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2027-03-30T08:00:00Z'));
  await page.goto('./?bot=off');
  await expect(page.locator('#daily')).toBeEnabled();
  await startMode(page, 'daily');
  const goal = page.locator('#hud .goal');
  const control = page.getByRole('button', { name: 'Goal' });
  await expect(goal).toHaveText(/^Eject 6 .+/); // before the first move the HUD line holds the goal: this date's boss is The Echo, its two-step card (#1524)
  await expect(control).toHaveAttribute('aria-expanded', 'false'); // the Goal sheet is shut (#1032)
  expect(await page.evaluate(() => (window as any).__history())).toEqual([]);
  await shot(page, { path: testInfo.outputPath('daily-goal-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  await shot(page, { path: testInfo.outputPath('daily-goal-phone.png') });
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 1280, height: 720 });

  const click = async (q: number, r: number) => {
    const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
    await page.mouse.click(p.x, p.y);
  };
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); // the camera follows the resize
  await click(0, 2);
  await click(0, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(1);
  await expect(goal).toHaveCount(0);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await shot(page, { path: testInfo.outputPath('daily-goal-folded.png') });

  await control.focus();
  await page.keyboard.press('Enter'); // reachable from the keyboard: the Goal sheet opens above the dock (#1032)
  const sheet = page.locator('#goal-sheet');
  await expect(sheet).toHaveText(/.+/);
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(goal).toHaveCount(0); // the goal is shown once: the sheet holds it, the HUD does not repeat it
  await control.click();
  await expect(sheet).toBeHidden();
});

// The result card (#196).
const card = (name: string) =>
  `Edgefall daily 2027-03-30: ${name}\nDefeat in 7 plies on attempt 1\nhttps://tidymaze.github.io/edgefall/`;

test('a finished daily fight shows the result card, and Copy puts its text in the clipboard, #196', async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'only Chromium grants the clipboard-read and clipboard-write permissions the test needs');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const name = await startDaily(page);
  await expect(page.locator('#daily-card')).toBeHidden(); // not while the fight is on
  await loseByRepetition(page);
  await expect(page.locator('#daily-card')).toBeVisible();
  await expect(page.locator('#daily-result')).toHaveValue(card(name));
  await shot(page, { path: testInfo.outputPath('daily-card.png') });

  // Nothing leaves the browser: Copy only writes the clipboard.
  await page.keyboard.press('Shift'); // the first gesture of the page loads its audio (no click started the fight any more): done before the count
  await page.waitForTimeout(150);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.locator('#hud')).toContainText('result copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(card(name));
  expect(requests).toEqual([]);

  // Retry starts the next attempt: the card goes away until that fight is over.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#hud')).toContainText('Daily challenge 2027-03-30 · attempt 2');
  await expect(page.locator('#daily-card')).toBeHidden();
});

test('when the clipboard is refused, the result text is selected to copy by hand, #196', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
  });
  const name = await startDaily(page);
  await loseByRepetition(page);
  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.locator('#hud')).toContainText('result selected: copy it by hand');
  const box = page.locator('#daily-result');
  await expect(box).toHaveValue(card(name));
  const selected = await box.evaluate(
    (el: HTMLTextAreaElement) =>
      document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length,
  );
  expect(selected).toBe(true);
});

test('a plain boss fight shows no result card at its end, #196', async ({ page }) => {
  await page.goto('./?bot=off');
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await loseByRepetition(page);
  await expect(page.locator('#daily-card')).toBeHidden();
});
