import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';

// A local game survives a reload: saved in IndexedDB after every move, replayed on load (#218,
// docs/specs/tech.md section 8).

/** Waits for a loaded page to show its game and be ready for clicks. */
async function ready(page: Page): Promise<void> {
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  // __cellToScreen reads the camera, which is only set after the first rendered frame.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

/** The click through the game's own handler (window.__click): no raycast, no frames. A test pays the mouse path once, on `mouse`. */
async function click(page: Page, q: number, r: number, mouse = false): Promise<void> {
  if (!mouse) return page.evaluate(([cq, cr]) => (window as any).__click(cq, cr), [q, r]);
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
}

/** Moves one marble: select it, then click the cell it goes to. */
async function move(page: Page, from: [number, number], to: [number, number], mouse = false): Promise<void> {
  await click(page, ...from, mouse);
  await click(page, ...to, mouse);
}

const plies = (page: Page) => page.evaluate(() => (window as any).__plies() as number);

/** Moves of the saved local game, read from the page's real IndexedDB; 0 when nothing is saved. */
const savedPlies = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((done) => {
        const req = indexedDB.open('ab-alone');
        req.onupgradeneeded = () => req.transaction!.abort(); // never create the page's database here
        req.onerror = () => done(0);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('game').objectStore('game').get('local');
          get.onsuccess = () => {
            db.close();
            done(get.result?.moves.length ?? 0);
          };
        };
      }),
  );

/** What a reload must keep: the plies played, the legal moves (they follow the position) and the HUD. */
const snapshot = async (page: Page) => ({
  plies: await plies(page),
  legal: await page.evaluate(() => (window as any).__legal()),
  hud: await page.locator('#hud .turn').textContent(),
  score: await page.locator('#hud .score').textContent(),
});

test('a hot-seat game survives a reload', async ({ page }) => {
  await page.goto('./?bot=off');
  await ready(page);
  const hud = page.locator('#hud');
  await move(page, [0, 2], [0, 1]); // Black
  await move(page, [0, -2], [0, -1]); // White
  await move(page, [0, 1], [0, 0], true); // Black, by the mouse
  await expect(hud).toContainText('White to move');
  await expect.poll(() => savedPlies(page)).toBe(3);
  const before = await snapshot(page);

  await page.reload();
  await ready(page);
  expect(await snapshot(page)).toEqual(before);
  await expect(hud).toContainText('White to move');
});

test('a game at the hub hot-seat table survives a reload, still with no bot (#565)', async ({ page }) => {
  await page.goto('./?nodes=200');
  await ready(page);
  await page.evaluate(() => {
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: [] }));
  });
  await openModes(page);
  await page.getByRole('button', { name: 'Hub' }).click();
  await click(page, -1, -1); // the hot-seat table
  const hud = page.locator('#hud');
  await expect(hud).toContainText('Two players, one board.');
  await move(page, [0, 2], [0, 1]); // Black
  await expect.poll(() => savedPlies(page)).toBe(1);

  await page.reload();
  await ready(page);
  expect(await plies(page)).toBe(1);
  await expect(hud).toContainText('White to move');
  await move(page, [0, -2], [0, -1]); // White, played on the page: no bot
  await expect.poll(() => plies(page)).toBe(2);
  await expect(hud).toContainText('Black to move');
});

// Split from the reload test (#349): the same position a third time ends the game, and a reload then starts a new one.
test('once a hot-seat game is over, a reload starts a new game', async ({ page }) => {
  await page.goto('./?bot=off');
  await ready(page);
  const hud = page.locator('#hud');
  // The nine plies that repeat the start position a third time, loaded from a game file (one import, not nine moves
  // on the page: the clicks are covered by the tests above). Same moves as the draw of endgame.spec.ts.
  const A = [1, 4, 0, 2, 0, 0, 0, 0], B = [1, 5, 0, -2, 0, 0, 0, 0], C = [1, 4, 0, 1, 0, 0, 0, 0];
  const D = [1, 4, 0, -1, 0, 0, 0, 0], E = [1, 5, 0, 0, 0, 0, 0, 0];
  const moves = [A, B, C, D, E, B, C, D, E]; // the position after ply 1 a third time
  await page.locator('#import-file').setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves })),
  });
  await expect(hud).toContainText('Same position three times'); // the draw reason, on the HUD since #425
  await expect.poll(() => savedPlies(page)).toBe(0);

  await page.reload();
  await ready(page);
  await expect(hud).toContainText('Black to move');
  await expect(hud).toContainText('Black ejected 0/6 · White ejected 0/6');
  expect(await plies(page)).toBe(0);
});

test('a game against the bot survives a reload, with the bot still playing White', async ({ page }) => {
  await page.goto('./?nodes=200');
  await ready(page);
  const hud = page.locator('#hud');
  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2); // the bot replied
  await expect.poll(() => savedPlies(page)).toBe(2);
  const before = await snapshot(page);

  await page.reload();
  await ready(page);
  expect(await snapshot(page)).toEqual(before);
  await expect(hud).toContainText('White to move');

  await move(page, [0, 1], [0, 0]);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(4);
  await expect(hud).toContainText('White to move');
});

test('a boss fight is not saved: a reload shows a new local game', async ({ page }) => {
  await page.goto('./?bot=on&nodes=200');
  await ready(page);
  const hud = page.locator('#hud');
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2); // the boss replied

  await page.reload();
  await ready(page);
  await expect(hud).not.toContainText('The Echo');
  await expect(hud).toContainText('White to move');
  expect(await plies(page)).toBe(0);
  expect(await savedPlies(page)).toBe(0);
});

/** Writes `save` as the saved local game in the page's real IndexedDB, as an earlier page view would have. */
const writeSave = (page: Page, save: unknown) =>
  page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open('ab-alone', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('game');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('game', 'readwrite');
          tx.objectStore('game').put(value, 'local');
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    save,
  );

const A = [1, 4, 0, 2, 0, 0, 0, 0]; // Black (0, 2) to its NW neighbour (0, 1)
const save = (bot: boolean, moves: number[][], version = 1) => ({ version, mode: 'local', layout: 'standard', bot, moves });

test('a game saved while the bot was thinking resumes with the bot reply', async ({ page }) => {
  await page.goto('./?bot=on&nodes=200');
  await ready(page);
  await writeSave(page, save(true, [A]));

  await page.reload();
  await ready(page);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect.poll(() => savedPlies(page)).toBe(2);
});

test('a save that does not replay is dropped, never shown half-done', async ({ page }) => {
  await page.goto('./?bot=off');
  await ready(page);
  // The second move is Black's again, from a cell the first one left: the engine refuses it.
  for (const bad of [save(false, [A, A]), save(false, [A], 2)]) {
    await writeSave(page, bad);
    await page.reload();
    await ready(page);
    await expect(page.locator('#hud')).toContainText('Black to move');
    expect(await plies(page)).toBe(0);
    await expect.poll(() => savedPlies(page)).toBe(0);
  }
});
