import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { openAdvanced } from './settings';

// A local game exported as a JSON file and imported back, replayed through the engine (#219,
// docs/specs/tech.md section 8). The file is the save format of the resume task (#218).

/** Waits for a loaded page to show its game and be ready for clicks. */
async function ready(page: Page): Promise<void> {
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  // __cellToScreen reads the camera, which is only set after the first rendered frame.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

async function click(page: Page, q: number, r: number): Promise<void> {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
}

/** Moves one marble: select it, then click the cell it goes to. */
async function move(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await click(page, ...from);
  await click(page, ...to);
}

const plies = (page: Page) => page.evaluate(() => (window as any).__plies() as number);
const history = (page: Page) => page.evaluate(() => (window as any).__history() as number[][]);

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

/** Deletes the saved local game, so the next load starts a new game (the New game button is #230). */
const clearSave = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open('ab-alone');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('game', 'readwrite');
          tx.objectStore('game').delete('local');
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
  );

/** What an import must restore: the plies played, the legal moves (they follow the position) and the HUD. */
const snapshot = async (page: Page) => ({
  history: await history(page),
  legal: await page.evaluate(() => (window as any).__legal()),
  hud: await page.locator('#hud .turn').textContent(),
  score: await page.locator('#hud .score').textContent(),
});

/** An item of the settings menu, where Export game and Import game live (#287), the menu opened if it is closed. */
async function menuItem(page: Page, name: string) {
  const cog = page.getByRole('button', { name: 'Settings' });
  if ((await cog.getAttribute('aria-expanded')) !== 'true') await cog.click();
  if (/ game$/.test(name)) await openAdvanced(page); // under Advanced, shut until a press (#1566)
  return page.locator('#settings-menu').getByRole('button', { name });
}

/** Clicks Export game and saves the download, returns its file name, path and parsed content. */
async function exportGame(page: Page, dir: string) {
  const button = await menuItem(page, 'Export game');
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const name = download.suggestedFilename();
  const path = `${dir}/${name}`;
  await download.saveAs(path);
  return { name, path, content: JSON.parse(await readFile(path, 'utf8')) };
}

/** Clicks Import game and picks the file at `path` in the file chooser. */
async function importGame(page: Page, path: string): Promise<void> {
  const button = await menuItem(page, 'Import game');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(path);
}

/** Picks a file holding `text` straight in the file input behind Import game (lighter on a loaded machine). */
const importText = (page: Page, text: string) =>
  page
    .locator('#import-file')
    .setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(text) });

const A = [1, 4, 0, 2, 0, 0, 0, 0]; // Black (0, 2) to (0, 1)
const B = [1, 5, 0, -2, 0, 0, 0, 0]; // White (0, -2) to (0, -1)
const C = [1, 4, 0, 1, 0, 0, 0, 0]; // Black (0, 1) to (0, 0)
const D = [1, 4, 0, -1, 0, 0, 0, 0]; // White (0, -1) back to (0, -2)
const E = [1, 5, 0, 0, 0, 0, 0, 0]; // Black (0, 0) back to (0, 1)
const save = (bot: boolean, moves: number[][], version = 1) => ({ version, mode: 'local', layout: 'standard', bot, moves });

test('a game exported to a file comes back on a new game, replayed and saved', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(2026, 9, 24, 12, 0)); // local noon: the file name holds that date
  await page.goto('./?bot=off');
  await ready(page);
  const hud = page.locator('#hud');
  await move(page, [0, 2], [0, 1]); // Black
  await move(page, [0, -2], [0, -1]); // White
  await expect(hud).toContainText('Black to move');
  const before = await snapshot(page);

  const file = await exportGame(page, testInfo.outputDir);
  expect(file.name).toBe('edgefall-2026-10-24.json');
  expect(file.content).toEqual(save(false, [A, B]));

  // A new game: the save cleared and the page reloaded.
  await clearSave(page);
  await page.reload();
  await ready(page);
  expect(await plies(page)).toBe(0);

  await importGame(page, file.path);
  await expect.poll(() => plies(page)).toBe(2);
  expect(await snapshot(page)).toEqual(before);
  // The evaluation bar (#191) follows the imported position.
  await expect(page.locator('#eval')).toHaveAttribute('data-ply', '2', { timeout: 30_000 });
  await expect(hud).toContainText('Black to move');
  await expect.poll(() => savedPlies(page)).toBe(2);

  // Saved like a game played here: it survives a reload, and goes on.
  await page.reload();
  await ready(page);
  expect(await snapshot(page)).toEqual(before);
  await move(page, [0, 1], [0, 0]); // Black
  await expect(hud).toContainText('White to move');
  expect(await history(page)).toEqual([A, B, C]);
});

test('a file that is not a game, of an unknown version or with an illegal move is refused, the game stays', async ({
  page,
}) => {
  await page.goto('./?bot=off');
  await ready(page);
  const hud = page.locator('#hud');
  await move(page, [0, 2], [0, 1]); // Black
  await expect(hud).toContainText('White to move');
  await expect.poll(() => savedPlies(page)).toBe(1);
  const before = await snapshot(page);

  // Each refusal says something else than the one before, so every message is the new file's. The other
  // causes of "not a game file" are unit tests (gamefile.test.ts).
  for (const [text, message] of [
    ['not a game', 'import refused: not a game file'],
    [JSON.stringify(save(false, [A], 2)), 'import refused: unknown file version'],
    [JSON.stringify(save(false, [A, A])), 'import refused: illegal move in the file'], // Black twice
  ]) {
    await importText(page, text);
    await expect(hud).toContainText(message);
    expect(await history(page)).toEqual([A]);
    expect(await savedPlies(page)).toBe(1);
  }
  expect(await snapshot(page)).toEqual(before);

  // The game goes on as it was.
  await move(page, [0, -2], [0, -1]); // White
  await expect(hud).toContainText('Black to move');
  expect(await history(page)).toEqual([A, B]);
});

test('an imported game replaces a game against the bot in progress, and the bot plays on', async ({ page }, testInfo) => {
  await page.goto('./?nodes=200');
  await ready(page);
  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2); // the bot replied

  // A hot-seat file with White to move: the page plays on in its own mode, the bot answers.
  await importText(page, JSON.stringify(save(false, [A, B, C])));
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(4);
  expect((await history(page)).slice(0, 3)).toEqual([A, B, C]);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect.poll(() => savedPlies(page)).toBe(4);

  const file = await exportGame(page, testInfo.outputDir);
  expect(file.content).toEqual(save(true, await history(page)));
});

test('a click right after an import during the slide of the last move selects in the imported game, #371', async ({ page }) => {
  // The page clock paused: no frame runs, so the slide of the move played before the import never ends by itself.
  const start = Date.parse('2026-01-05T12:00:00Z');
  await page.clock.install({ time: start });
  await page.goto('./?bot=off');
  await ready(page);
  await page.clock.pauseAt(start + 10 * 60_000); // a time no load reaches before, as in newgame.spec.ts
  await move(page, [0, 2], [0, 1]); // Black: its marble slides
  await expect(page.locator('body')).toHaveAttribute('data-sliding', '1');

  await importText(page, JSON.stringify(save(false, [A, B, C])));
  await expect.poll(() => plies(page)).toBe(3); // White to move, as before the import
  await click(page, 0, -1); // a White marble of the imported game: selected at once, not queued behind the old slide
  expect(await page.evaluate(() => (window as any).__rings())).toEqual([[0, -1]]);
});

test('an imported finished game shows its result, and a reload starts a new game', async ({ page }) => {
  await page.goto('./?bot=off');
  await ready(page);
  await move(page, [0, 2], [0, 1]); // Black
  await expect.poll(() => savedPlies(page)).toBe(1);

  // The position after the first move comes back a third time: a draw.
  await importText(page, JSON.stringify(save(false, [A, B, C, D, E, B, C, D, E])));
  await expect(page.locator('#hud')).toContainText('Same position three times'); // the draw reason, on the HUD since #425
  expect(await plies(page)).toBe(9);
  await expect.poll(() => savedPlies(page)).toBe(0); // a finished game is not saved

  await page.reload();
  await ready(page);
  await expect(page.locator('#hud')).toContainText('Black to move');
  expect(await plies(page)).toBe(0);
});

// In the open settings menu, beside Clear board: shown in a local game, hidden in the others (#287).
async function expectLocalMenu(page: Page): Promise<void> {
  await ready(page);
  await expect(page.locator('#online > #export-game, #online > #import-game')).toHaveCount(0); // no loose HUD buttons
  await expect(await menuItem(page, 'Export game')).toBeVisible();
  await expect(await menuItem(page, 'Import game')).toBeVisible();
  await page.keyboard.press('Escape'); // the open menu floats over the buttons clicked next
}

async function expectNoExportImport(page: Page): Promise<void> {
  await expect(await menuItem(page, 'Clear board')).toBeVisible();
  await expect(await menuItem(page, 'Export game')).toBeHidden();
  await expect(await menuItem(page, 'Import game')).toBeHidden();
}

test('export and import are not shown during a boss fight, #287', async ({ page }) => {
  await page.goto('./?net=hook');
  await expectLocalMenu(page);
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expectNoExportImport(page);
});

test('export and import are not shown during a daily fight, #287', async ({ page }) => {
  await page.goto('./?net=hook');
  await expectLocalMenu(page);
  await startMode(page, 'daily');
  await expect(page.locator('#hud')).toContainText('Daily challenge');
  await expectNoExportImport(page);
});

test('export and import are not shown during an online game, #287', async ({ page }) => {
  await page.goto('./?net=hook');
  await expectLocalMenu(page);
  await startMode(page, 'online');
  await expect(page.locator('#hud')).toContainText('You are Black');
  await expectNoExportImport(page);
});
