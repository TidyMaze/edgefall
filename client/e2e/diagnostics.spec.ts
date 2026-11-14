import { expect, test, type Page } from '@playwright/test';
import { inviteLink, startMode } from './modes';
import { openAdvanced } from './settings';

// Copy diagnostics (#220): the last events, the counters and the game, in the clipboard or selected in a text box.
const cell = async (page: Page, q: number, r: number) => {
  // The raycaster needs the camera matrices, which three only updates on a rendered frame, and a
  // background tab renders none: bring the page to the front first.
  await page.bringToFront();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
};
const plies = (page: Page) => page.evaluate(() => (window as any).__plies());
const FIRST = [1, 4, 0, 2, 0, 0, 0, 0]; // the Black marble at (0,2) to its NW neighbour (0,1)
const PERMISSIONS = ['clipboard-read', 'clipboard-write'];
const clipboard = async (page: Page) => JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
const eventNames = (d: { events: { event: string }[] }) => d.events.map((e) => e.event);

test('Copy diagnostics puts the move, the bot search and the build in the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium grants the clipboard-read and clipboard-write permissions the test needs');
  await context.grantPermissions(PERMISSIONS);
  await page.goto('./?bot=on');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('White to move');
  await cell(page, 0, 2);
  await cell(page, 0, 1);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2); // the bot answered

  await page.locator('#settings').click(); // the clipboard is the last row of the settings list (#1032)
  await openAdvanced(page); // under Advanced (#1566)
  await page.locator('#copy-diagnostics').click();
  await expect(page.locator('#hud')).toContainText('diagnostics copied');
  const d = await clipboard(page);
  expect(d.game).toMatchObject({ mode: 'bot', layout: 'standard' });
  expect(d.game.moves).toHaveLength(2);
  expect(d.game.moves[0]).toEqual(FIRST);
  expect(eventNames(d)).toEqual(expect.arrayContaining(['start', 'bot-search']));
  expect(d.events.find((e: { event: string }) => e.event === 'bot-search').data.ms).toBeGreaterThanOrEqual(0);
  expect(typeof d.build).toBe('string');
  expect(d.environment.backend).toMatch(/^(WebGPU|WebGL2)$/);
  await expect(page.locator('#diagnostics')).toBeHidden();
});

test('when the clipboard is refused, the diagnostics are selected in a text box to copy by hand', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
  });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await cell(page, 0, 2);
  await cell(page, 0, 1);
  await expect(page.locator('#hud')).toContainText('White to move');

  await page.locator('#settings').click(); // the clipboard is the last row of the settings list (#1032)
  await openAdvanced(page); // under Advanced (#1566)
  await page.locator('#copy-diagnostics').click();
  const box = page.locator('#diagnostics');
  await expect(box).toBeVisible();
  await expect(page.locator('#hud')).toContainText('diagnostics selected: copy them by hand');
  const d = JSON.parse(await box.inputValue());
  expect(d.game).toMatchObject({ mode: 'local', moves: [FIRST] });
  expect(eventNames(d)).toContain('start');
  const selected = await box.evaluate(
    (el: HTMLTextAreaElement) =>
      document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length,
  );
  expect(selected).toBe(true);
  // It shows the start of the text, and goes away once the player is done with it: it never stays over the board.
  expect(await box.evaluate((el) => el.scrollTop)).toBe(0);
  await box.blur();
  await expect(box).toBeHidden();
});

test('an online game exports its connection counters, its refused moves and its signed log, no private key', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'only Chromium grants the clipboard-read and clipboard-write permissions the test needs');
  const a = await (await browser.newContext({ permissions: PERMISSIONS })).newPage();
  const b = await (await browser.newContext()).newPage();
  // Each page relays its records to the other, with its own name as the sender (the ?net=hook transport).
  for (const [name, page, other] of [['a', a, b], ['b', b, a]] as const) {
    await page.exposeFunction('__netOut', (rec: unknown) =>
      other.isClosed() ? undefined : other.evaluate(([r, from]) => (window as any).__netIn(r, from), [rec, name] as const),
    );
  }
  await a.goto('./?bot=off&net=hook');
  await a.locator('canvas').waitFor();
  await expect(a.locator('#hud')).not.toBeEmpty();
  await startMode(a, 'online');
  const invite = await inviteLink(a);
  await b.goto(`./?net=hook${new URL(invite).hash}`);
  await b.locator('canvas').waitFor();
  await expect(b.locator('#hud')).toContainText('Joining as White...');
  await a.evaluate(() => (window as any).__netOpen());
  await b.evaluate(() => (window as any).__netOpen());
  await expect(b.locator('body')).toHaveAttribute('data-seat', 'player');
  await cell(a, 0, 2);
  await cell(a, 0, 1);
  await expect.poll(() => plies(b)).toBe(1);
  // A malformed record reaches page A: refused and counted.
  await a.evaluate(() => (window as any).__netIn({ junk: true }, 'x'));
  await expect(a.locator('#hud')).toContainText('refused move: malformed');

  await a.locator('#settings').click(); // the clipboard is the last row of the settings list (#1032)
  await openAdvanced(a); // under Advanced (#1566)
  await a.locator('#copy-diagnostics').click();
  await expect(a.locator('#hud')).toContainText('diagnostics copied');
  const text = await a.evaluate(() => navigator.clipboard.readText());
  const d = JSON.parse(text);
  expect(d.game).toMatchObject({ mode: 'online', online: { side: 1, role: 'player' }, moves: [FIRST] });
  expect(d.game.signed).toHaveLength(1);
  expect(d.game.signed[0]).toMatchObject({ seq: 0, move: FIRST });
  expect(d.game.signed[0].pub).toMatch(/^[\w-]{43}$/); // an Ed25519 public key, base64url
  expect(d.counters).toMatchObject({ opened: 1, refused: { malformed: 1 }, desync: 0 });
  expect(d.counters.connectMs).toHaveLength(1);
  expect(d.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: 'net', data: { state: 'open' } }),
      expect.objectContaining({ level: 'warn', event: 'refused', data: { reason: 'malformed' } }),
    ]),
  );
  expect(text).not.toContain('"priv"');
  // Manual contexts stay open after the test: their WebGL pages would slow the next test (#120).
  await a.context().close();
  await b.context().close();
});
