import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';
import { shot } from './shot';

// Hint (#192, docs/specs/ui.md section 4.2): a press shows the engine's best move for the side to move as a ghost,
// and plays nothing. A second press, a new selection or the next move clears it. Local hot-seat and bot games only.

/** Waits for a loaded page to show its game and be ready for clicks. */
async function ready(page: Page): Promise<void> {
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  await expect(page.locator('#hint')).toBeEnabled(); // listener ready
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

/** What a hint must leave alone: the moves played, the legal moves (they follow the position), the turn and score. */
const position = async (page: Page) => ({
  history: await page.evaluate(() => (window as any).__history()),
  legal: await page.evaluate(() => (window as any).__legal()),
  turn: await page.locator('#hud .turn').textContent(),
  score: await page.locator('#hud .score').textContent(),
});

const ghosts = (page: Page) => page.locator('body').evaluate((b) => Number((b as HTMLElement).dataset.ghosts));

/** Picks a file holding `text` straight in the file input behind Import game (#219). */
const importText = (page: Page, text: string) =>
  page
    .locator('#import-file')
    .setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(text) });
const A = [1, 4, 0, 2, 0, 0, 0, 0]; // Black (0, 2) to (0, 1)
const B = [1, 5, 0, -2, 0, 0, 0, 0]; // White (0, -2) to (0, -1)
const C = [1, 4, 0, 1, 0, 0, 0, 0]; // Black (0, 1) to (0, 0)
const D = [1, 4, 0, -1, 0, 0, 0, 0]; // White (0, -1) back to (0, -2)
const E = [1, 5, 0, 0, 0, 0, 0, 0]; // Black (0, 0) back to (0, 1)
const save = (moves: number[][]) => JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves });

test('Hint shows the best move as a ghost and plays nothing; a second press clears it, #192', async ({
  page,
}) => {
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const body = page.locator('body');
  const hint = page.getByRole('button', { name: 'Hint' });
  const start = await position(page);
  await expect(hint).toHaveAttribute('aria-pressed', 'false');
  await expect(body).toHaveAttribute('data-ghosts', '0');

  await hint.click();
  await expect(hint).toHaveAttribute('aria-pressed', 'true');
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  expect(await ghosts(page)).toBeGreaterThan(0);
  expect(await position(page)).toEqual(start); // drawn, never played
  await shot(page, { path: 'test-results/hint.png' });

  await hint.click(); // the second press clears it
  await expect(body).toHaveAttribute('data-hint', 'off');
  await expect(body).toHaveAttribute('data-ghosts', '0');
  await expect(hint).toHaveAttribute('aria-pressed', 'false');
  expect(await position(page)).toEqual(start);
});

// Split from the test above (#349): a selection clears the hint, then the next move's hint is White's.
test('a selection clears the hint, and the hint after the next move is for White, #192', async ({ page }) => {
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const body = page.locator('body');
  const hint = page.getByRole('button', { name: 'Hint' });
  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  await click(page, 0, 2); // a new selection clears it
  await expect(body).toHaveAttribute('data-hint', 'off');
  await expect(body).toHaveAttribute('data-ghosts', '0');
  await expect(hint).toHaveAttribute('aria-pressed', 'false');
  expect(await plies(page)).toBe(0);

  // The move is the player's to play. Then White to move: the hint is White's.
  await click(page, 0, 1);
  await expect.poll(() => plies(page)).toBe(1);
  await expect(page.locator('#hud')).toContainText('White to move');
  const after = await position(page);
  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  expect(await ghosts(page)).toBeGreaterThan(0);
  expect(await position(page)).toEqual(after);
});

test('on the start position the marbles the hint takes wear the selection ring, until the hint goes, #301', async ({
  page,
}) => {
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const body = page.locator('body');
  const hint = page.getByRole('button', { name: 'Hint' });
  const rings = () => page.evaluate(() => (window as any).__rings() as number[][]);
  expect(await rings()).toEqual([]);

  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  const move = await page.evaluate(() => (window as any).__hint() as number[]);
  const takes = Array.from({ length: move[0]! }, (_, i) => [move[2 + 2 * i], move[3 + 2 * i]]);
  expect(takes.length).toBeGreaterThan(0);
  expect(await rings()).toEqual(takes);
  await shot(page, { path: 'test-results/hint-rings.png' });

  await hint.click(); // a second press
  await expect(body).toHaveAttribute('data-hint', 'off');
  expect(await rings()).toEqual([]);

  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  await click(page, 0, 2); // a new selection: the ring is the selection's alone
  await expect(body).toHaveAttribute('data-hint', 'off');
  expect(await rings()).toEqual([[0, 2]]);
  await click(page, 0, 1); // the next move
  await expect.poll(() => plies(page)).toBe(1);
  expect(await rings()).toEqual([]);
});

test('a hint asked for an older position is never drawn on the new one, #192', async ({ page }) => {
  // The hint requests are held until __releaseHints. With ?bot=off the analysis worker is the only one: its requests
  // for a move are the hints, its evaluations (#191) pass.
  await page.addInitScript(() => {
    const held: (() => void)[] = [];
    let holding = true;
    let answers = 0;
    const w = window as any;
    w.__heldHints = () => held.length;
    w.__hintAnswers = () => answers;
    w.__releaseHints = () => {
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
          if (this.game && !('score' in e.data)) answers++;
        });
      }
      postMessage(msg: unknown): void {
        const sent = structuredClone(msg); // what the worker gets is copied now, as postMessage does
        if (this.game && holding && !(msg as { evaluate?: boolean }).evaluate) held.push(() => super.postMessage(sent));
        else super.postMessage(sent);
      }
    };
  });
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const body = page.locator('body');
  const hint = page.getByRole('button', { name: 'Hint' });

  // Asked on the start position, answered after the next move.
  await hint.click();
  await expect.poll(() => page.evaluate(() => (window as any).__heldHints())).toBe(1);
  await expect(body).toHaveAttribute('data-hint', 'asking');
  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => plies(page)).toBe(1);

  // Asked on ply 1, answered after an import replaced the game.
  await hint.click();
  await expect.poll(() => page.evaluate(() => (window as any).__heldHints())).toBe(2);
  await expect(body).toHaveAttribute('data-hint', 'asking');
  await importText(page, save([A, B]));
  await expect.poll(() => plies(page)).toBe(2);
  await expect(body).toHaveAttribute('data-hint', 'off');
  await expect(hint).toHaveAttribute('aria-pressed', 'false');

  const imported = await position(page);
  await page.evaluate(() => (window as any).__releaseHints());
  await expect.poll(() => page.evaluate(() => (window as any).__hintAnswers()), { timeout: 30_000 }).toBe(2);
  await expect(body).toHaveAttribute('data-hint', 'off');
  await expect(body).toHaveAttribute('data-ghosts', '0');
  expect(await position(page)).toEqual(imported);

  // The hint of the position on the board still works.
  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  expect(await ghosts(page)).toBeGreaterThan(0);
  expect(await position(page)).toEqual(imported);
});

test('against the bot, Hint is disabled while the bot thinks, then shows the hint of the next position, #192', async ({
  page,
}) => {
  // The bot worker is held until __releaseBot: each worker is made at its first request (#1579), the bar's analysis worker first, then the bot's.
  await page.addInitScript(() => {
    const held: (() => void)[] = [];
    let made = 0;
    const w = window as any;
    w.__heldBot = () => held.length;
    w.__releaseBot = () => {
      for (const send of held.splice(0)) send();
    };
    const Real = window.Worker;
    w.Worker = class extends Real {
      bot: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.bot = !String(url).startsWith('blob:') && made++ === 1; // not a KTX2Loader transcoder worker (#700)
      }
      postMessage(msg: unknown): void {
        const sent = structuredClone(msg);
        if (this.bot) held.push(() => super.postMessage(sent));
        else super.postMessage(sent);
      }
    };
  });
  await page.goto('./?nodes=200');
  await ready(page);
  const body = page.locator('body');
  const hint = page.getByRole('button', { name: 'Hint' });
  const start = await position(page);
  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  expect(await position(page)).toEqual(start);

  await move(page, [0, 2], [0, 1]);
  await expect.poll(() => page.evaluate(() => (window as any).__heldBot())).toBe(1); // the bot is thinking
  await expect(hint).toBeDisabled();
  await expect(body).toHaveAttribute('data-hint', 'off');

  await page.evaluate(() => (window as any).__releaseBot());
  await expect.poll(() => plies(page), { timeout: 30_000 }).toBe(2);
  await expect(page.locator('#hud')).toContainText('White to move');
  await expect(hint).toBeEnabled();
  const reply = await position(page);
  await hint.click();
  await expect(body).toHaveAttribute('data-hint', 'shown', { timeout: 30_000 });
  expect(await ghosts(page)).toBeGreaterThan(0);
  expect(await position(page)).toEqual(reply);
});

test('Hint is disabled once the game is over, #192', async ({ page }) => {
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  // The position after the first move comes back a third time: a draw.
  await importText(page, save([A, B, C, D, E, B, C, D, E]));
  await expect(page.locator('#hud')).toContainText('Same position three times'); // the draw reason, on the HUD since #425
  await expect(page.getByRole('button', { name: 'Hint' })).toBeDisabled();
});

test('no Hint during a boss fight, a daily fight or an online game, for the room creator and the invited player, #192', async ({
  page,
}) => {
  const hint = page.locator('#hint');
  await page.goto('./?net=hook#room=hint192');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Joining as White...');
  await expect(hint).toBeHidden();

  await page.goto('./?net=hook');
  await ready(page);
  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(hint).toBeHidden();

  await page.goto('./?net=hook');
  await ready(page);
  await openModes(page);
  await page.locator('#daily').click();
  await expect(page.locator('#hud')).toContainText('Daily challenge');
  await expect(hint).toBeHidden();

  await page.goto('./?net=hook');
  await ready(page);
  await openModes(page);
  await page.getByRole('button', { name: 'Play online' }).click();
  await expect(page.locator('#hud')).toContainText('Waiting for an opponent');
  await expect(hint).toBeHidden();
});

// The Hint ghost fades in (#1097, motion.md story 7): the ghost opacity read in the page the moment the hint shows, then once
// the base token (200 ms) has passed. Recorded in the page, so a slow runner cannot miss the rise.
async function ghostRise(page: Page): Promise<{ first: number; later: number }> {
  await page.evaluate(() => {
    const w = window as any;
    w.__rise = new Promise((done) => {
      new MutationObserver((_, ob) => {
        if (document.body.dataset.hint !== 'shown') return;
        ob.disconnect();
        const first = w.__ghostOpacity();
        // Wait for the rise to reach its whole value (a slow runner frames late, so a fixed 450 ms read too early); 3 s cap.
        const t0 = performance.now();
        const poll = () => {
          const later = w.__ghostOpacity();
          if (later >= 0.44 || performance.now() - t0 > 3000) done({ first, later });
          else setTimeout(poll, 50);
        };
        setTimeout(poll, 450);
      }).observe(document.body, { attributes: true, attributeFilter: ['data-hint'] });
    });
  });
  await page.locator('#hint').click();
  return page.evaluate(() => (window as any).__rise);
}

test('the Hint ghost rises from clear to whole in the base token, #1097', async ({ page }) => {
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const { first, later } = await ghostRise(page);
  expect(first).toBeLessThan(0.1);
  expect(later).toBeCloseTo(0.45);
  expect(await ghosts(page)).toBeGreaterThan(0);
});

test('reduced motion: the Hint ghost appears whole, #1097', async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await page.goto('./?bot=off&nodes=200');
  await ready(page);
  const { first, later } = await ghostRise(page);
  expect(first).toBeCloseTo(0.45);
  expect(later).toBeCloseTo(0.45);
});
