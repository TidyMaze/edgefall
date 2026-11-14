import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';

// New game (#230): it leaves the local game in progress for the start position, bot on or off as it was,
// and deletes its save (#218). Once a move is played the first press asks "Confirm new game" for a few
// seconds and only a second press starts over. Online, boss and daily games have no New game button.
// The confirmation runs on the page clock: the tests pause it while they press, so a slow machine, where a
// click waits seconds for a frame, never lets it lapse between two presses (page.clock, installed by `load`).

// The page clock starts at START and flows in real time until `pause` stops it at START + 10 minutes, a time
// no test reaches before, however loaded the machine. A target read from the page clock can already be past
// by the time pauseAt runs ("Cannot fast-forward to the past").
const START = Date.parse('2026-01-05T12:00:00Z');
const PAUSED = START + 10 * 60_000;

/** Opens `url` with the page clock installed at START, flowing in real time until `pause`. */
async function load(page: Page, url: string): Promise<void> {
  await page.clock.install({ time: START });
  await page.goto(url);
  await ready(page);
}

/** Moves the page clock on to PAUSED and stops it: no timer fires and nothing is drawn until `fastForward` or
 * `resume`. */
const pause = (page: Page) => page.clock.pauseAt(PAUSED);

/** Waits for a loaded page to show its game and be ready for clicks. */
async function ready(page: Page): Promise<void> {
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  await expect(page.locator('#new-game')).toBeEnabled(); // listener ready
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

/** What the start position shows: no ply, Black to move, nothing ejected, the opening legal moves. */
const position = async (page: Page) => ({
  plies: await plies(page),
  legal: await page.evaluate(() => (window as any).__legal()),
  turn: await page.locator('#hud .turn').textContent(),
  score: await page.locator('#hud .score').textContent(),
});

test('New game asks for a confirmation, then starts over from the start position and deletes the save', async ({
  page,
}) => {
  await load(page, './?bot=off');
  const button = page.locator('#new-game');
  const start = await position(page);
  expect(start.plies).toBe(0);
  await expect(button).toHaveAttribute('aria-label', 'New game');

  await move(page, [0, 2], [0, 1]); // Black
  await move(page, [0, -2], [0, -1]); // White
  await expect(page.locator('#hud')).toContainText('Black to move');
  await expect.poll(() => savedPlies(page)).toBe(2);

  await pause(page);
  await button.click();
  await expect(button).toHaveText('Confirm new game');
  expect(await plies(page)).toBe(2); // nothing changed yet
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'New game');
  expect(await position(page)).toEqual(start);
  await expect.poll(() => savedPlies(page)).toBe(0);

  await page.clock.resume();
  await page.reload();
  await ready(page);
  expect(await position(page)).toEqual(start);

  // Still hot-seat: Black then White play by hand.
  await move(page, [0, 2], [0, 1]);
  await move(page, [0, -2], [0, -1]); // clicked during the slide of the first move: it waits, it is not lost
  await expect.poll(() => plies(page)).toBe(2);
});

test('New game without a move starts over at once; the confirmation lapses after 4 seconds', async ({ page }) => {
  await load(page, './?bot=off');
  const button = page.locator('#new-game');
  await button.click(); // no move yet: nothing to lose, no confirmation
  await expect(button).toHaveAttribute('aria-label', 'New game');
  expect(await plies(page)).toBe(0);

  await move(page, [0, 2], [0, 1]);
  await pause(page);
  await button.click();
  await expect(button).toHaveText('Confirm new game');
  // fastForward jumps and fires each due timer once; runFor would also run every frame in between, about 40
  // draws of the board, which took 17 s under load.
  await page.clock.fastForward(3_900);
  await expect(button).toHaveText('Confirm new game');
  await page.clock.fastForward(100);
  await expect(button).toHaveAttribute('aria-label', 'New game'); // lapsed, the game goes on
  expect(await plies(page)).toBe(1);
  await button.click(); // a press after it lapsed asks again
  await expect(button).toHaveText('Confirm new game');
  expect(await plies(page)).toBe(1);
});

test('New game while the bot thinks: its reply to the old game is dropped, the bot plays the new one', async ({
  page,
}) => {
  // The bot worker is held: its requests wait until __releaseBot, so the bot is still thinking when New game starts.
  // Only the bot's move requests are held and counted: the evaluation bar's requests (`evaluate`, #191) go to a
  // second copy of the worker and pass.
  await page.addInitScript(() => {
    const held: (() => void)[] = [];
    let holding = true;
    let replies = 0;
    const w = window as any;
    w.__heldBot = () => held.length;
    w.__botReplies = () => replies;
    w.__releaseBot = () => {
      holding = false;
      for (const send of held.splice(0)) send();
    };
    const Real = window.Worker;
    w.Worker = class extends Real {
      // The game's workers only: KTX2Loader's transcoder workers (#700) run from a blob URL, and pass.
      game: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.game = !String(url).startsWith('blob:');
        // The page handles the reply in the same task. An evaluation answer carries a score, not a move.
        this.addEventListener('message', (e) => {
          if (this.game && !('score' in e.data)) replies++;
        });
      }
      postMessage(msg: unknown): void {
        const sent = structuredClone(msg); // what the worker gets is copied now, as postMessage does
        if (this.game && holding && !(msg as { evaluate?: boolean }).evaluate) held.push(() => super.postMessage(sent));
        else super.postMessage(sent);
      }
    };
  });
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await load(page, './?nodes=200'); // the bot's search at the test budget (bot.ts)
  const start = await position(page);
  const button = page.locator('#new-game');

  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => page.evaluate(() => (window as any).__heldBot())).toBe(1); // the bot is thinking
  await pause(page);
  await button.click();
  await button.click();
  expect(await position(page)).toEqual(start);
  await page.clock.resume();

  await page.evaluate(() => (window as any).__releaseBot()); // the reply to the old game lands now
  await expect.poll(() => page.evaluate(() => (window as any).__botReplies()), { timeout: 30_000 }).toBe(1);
  expect(await position(page)).toEqual(start);
  expect(errors).toEqual([]);

  // The new game is still against the bot, and the player is not locked out by the old search.
  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect.poll(() => savedPlies(page)).toBe(2);
  expect(errors).toEqual([]);
});

// One test per state (each loads its own page, so each stays under the 15 s limit on the runner).
test('no New game button during a boss fight', async ({ page }) => {
  const button = page.locator('#new-game');
  await page.goto('./?net=hook');
  await ready(page);
  await expect(button).toBeVisible();
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(button).toBeHidden();
});

test('no New game button during a daily fight', async ({ page }) => {
  const button = page.locator('#new-game');
  await page.goto('./?net=hook');
  await ready(page);
  await openModes(page);
  await page.locator('#daily').click();
  await expect(page.locator('#hud')).toContainText('Daily challenge');
  await expect(button).toBeHidden();
});

test('no New game button in an online game', async ({ page }) => {
  const button = page.locator('#new-game');
  await page.goto('./?net=hook');
  await ready(page);
  await openModes(page);
  await page.getByRole('button', { name: 'Play online' }).click();
  await expect(page.locator('#hud')).toContainText('Waiting for an opponent');
  await expect(button).toBeHidden();
});
