import { expect, test, type Page } from '@playwright/test';
import { inviteLink, lowTierPages, openModes, startMode } from './modes';

// Two isolated browser contexts. The transport is the ?net=hook test hook: the test relays records
// from one page to the other, so no public Nostr relay is involved.
const cell = async (page: Page, q: number, r: number) => {
  // The raycaster needs the camera matrices, which three only updates on a rendered frame, and a
  // background tab renders none: bring the page to the front first.
  await page.bringToFront();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  return page.mouse.click(p.x, p.y);
};
// The same click through the game's own handler (window.__click), without the raycast and the frames of a mouse
// click. The setup plies of a test use it, so each test pays the mouse path once, on its last ply.
const play = (page: Page, q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__click(cq, cr), [q, r]);
// Reduced motion on pages whose test checks no animation: slides and ejection effects take no time.
const calm = async (...pages: Page[]) => {
  await lowTierPages(...pages); // on CI: the runner's software GL draws the low tier ten times faster
  await Promise.all(pages.map((p) => p.emulateMedia({ reducedMotion: 'reduce' })));
};
const plies =(page: Page) => page.evaluate(() => (window as any).__plies());
// Seating is a Hello round trip after the connection opens: wait for it before the first move. A page that just
// loaded can block its main thread for seconds on a loaded machine (one long task of 4 to 10 s seen, bug #554),
// and the Hello waits for it: the seat is waited for up to the test timeout, not the 5 s expect default.
const seat = (page: Page, role: 'player' | 'spectator') =>
  expect(page.locator('body')).toHaveAttribute('data-seat', role, { timeout: 15_000 });
// Every page relays its records to the others with its own name as the sender, like a Trystero room,
// or to the one page `to` names (a catch-up answer, #226). Whatever goes to or from a page named in
// `lost` is lost, as on a connection that broke before anyone noticed.
// Records handed to the other pages and not yet delivered: a test that moves a page clock waits for them (`delivered`).
const inflight = new Set<Promise<unknown>>();
const delivered = async () => {
  while (inflight.size) await Promise.allSettled([...inflight]);
};
// A page shared by several tests (#1481) is bound once: its binding reads the room of the test running now.
const rooms = new WeakMap<Page, { name: string; pages: Record<string, Page>; lost: Set<string> }>();
const room = async (pages: Record<string, Page>, lost = new Set<string>()) => {
  for (const [name, page] of Object.entries(pages)) {
    const bound = rooms.has(page);
    rooms.set(page, { name, pages, lost });
    if (bound) continue;
    await page.exposeFunction('__netOut', (rec: unknown, to?: string) => {
      const { name, pages, lost } = rooms.get(page)!;
      const sent = Promise.all(
        Object.entries(pages)
          .filter(([n, p]) => p !== page && !p.isClosed() && (!to || to === n) && !lost.has(n) && !lost.has(name))
          // A page whose session does not exist yet has no __netIn: like a Trystero room, drop the record for it
          // instead of throwing inside the sender's __netOut (an unhandled rejection, #249).
          .map(([, p]) => p.evaluate(([r, from]) => (window as any).__netIn?.(r, from), [rec, name] as const)),
      );
      inflight.add(sent);
      void sent.finally(() => inflight.delete(sent));
      return sent;
    });
  }
};
// What Trystero's onPeerLeave does on `page` when the peer `name` closed its page or lost its connection.
const leave = (page: Page, name: string) => page.evaluate((n) => (window as any).__netLeave(n), name);
// The hook transport only exists once main.ts reaches goOnline, after the textures and the saved game
// loaded: the canvas shows well before (bug #238). data-seat is set once the session is wired to it,
// and like the canvas it is waited for as long as the test runs, a page load on a loaded machine.
const open = async (page: Page) => {
  await page.locator('body[data-seat]').waitFor({ state: 'attached' });
  await page.evaluate(() => (window as any).__netOpen());
};
const status = (page: Page) => page.locator('#hud .presence');

// The player moves of a co-op fight against The Echo that end in a draw by repetition against its deterministic search
// replies (#859, 100 nodes since #951), found with the engine. A seat's turn is the free moves The Echo offers it (#958)
// and then its main move, which the boss answers: [seat (0 = A, 1 = B), from q, from r, to q, to r, plies on every page
// once it is played]. The 7th move ends the fight: no boss reply.
const COOP_DRAW: [number, number, number, number, number, number][] = [
  [0, -4, 3, -3, 2, 2],
  [1, 1, 3, 2, 2, 3], // seat 2 takes the free move offered
  [1, 2, 2, 3, 1, 5],
  [0, 3, 1, 2, 1, 6], // seat 1 takes the free move offered
  [0, 2, 1, 3, 1, 8],
  [1, 3, 1, 2, 1, 9],
  [1, 2, 1, 3, 1, 10],
];

// One creator page for a group of tests (#1481): a page boot is most of a test's time on the GPU-less runner. Page A boots once and each
// test opens its own room on it with Play online (or a boss list), which leaves the room of the test before; the joiners boot fresh pages
// on the invite link, as a player opening it. The group runs serially on one page and one CI shard (tag @one-page, scripts/shard-reporter.ts).
const sharedCreator = (calmed: boolean): (() => Page) => {
  let a: Page;
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    a = await (await browser.newContext()).newPage();
    if (calmed) await calm(a);
    await a.goto('./?bot=off&net=hook&quality=low');
    await a.locator('canvas').waitFor();
  });
  test.afterAll(async () => {
    await a.context().close();
  });
  return () => a;
};

test.describe('one creator page, joiners on the invite link', { tag: '@one-page' }, () => {
  const creator = sharedCreator(false);

  test('the invite link shows in the open lobby sheet without a tap while alone, and the sheet folds once the opponent joins', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await room({ a, b });
    await startMode(a, 'online');
    await expect(a.locator('#lobby-sheet')).toBeVisible();
    await expect(a.locator('#invite')).toBeVisible();
    await a.mouse.click(5, 5); // a tap on the board keeps the link while alone
    await expect(a.locator('#invite')).toBeVisible();
    await b.goto(`./?net=hook&quality=low${new URL(await inviteLink(a)).hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(a.locator('#lobby-sheet')).toBeHidden();
  });

  test('a move played on page A shows up on page B over the signed move log', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await room({ a, b });

    await expect(a.locator('#hud')).not.toBeEmpty(); // refresh() runs after the play-online listener is wired
    await startMode(a, 'online');
    const invite = await inviteLink(a);
    expect(invite).toMatch(/#room=[\w-]+&key=[\w-]{8}$/); // the creator key's fingerprint (#1323)
    await expect(a.locator('#hud')).toContainText('You are Black');

    await b.goto(`./?net=hook&quality=low${new URL(invite).hash}`);
    await b.locator('canvas').waitFor();
    await expect(b.locator('#hud')).toContainText('Joining as White...');

    // Before the connection is open a move is blocked, never applied on one side only.
    await play(a, 0, 2);
    await play(a, 0, 1);
    await expect(a.locator('#hud')).toContainText('waiting for opponent');
    await expect(a.locator('#hud')).toContainText('Black to move');
    expect(await plies(a)).toBe(0);

    await open(a);
    await open(b);
    await seat(b, 'player');
    await play(a, 0, 2); // a Black marble
    await play(a, 0, 1); // its NW neighbour
    await expect(a.locator('#hud')).toContainText('White to move');
    await expect.poll(() => plies(b)).toBe(1);
    await expect(b.locator('#hud')).toContainText('White to move');
    expect(await plies(a)).toBe(1);

    // White answers on page B, Black sees it on page A.
    await play(b, 0, -2);
    await cell(b, 0, -1); // the one mouse click of the test
    await expect.poll(() => plies(a)).toBe(2);
    await expect(a.locator('#hud')).toContainText('Black to move');
    await expect(a.locator('#hud')).not.toContainText('refused');
    // Manual contexts stay open after the test: their WebGL pages would slow the next test (#120).
    await b.context().close();
  });

  // Issue #121: each player sees its own color and whether the opponent is online, updated live.
  test('online status: creator waits with the invite, joiner joins, both see each other, drop, reconnect and close, #121', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await room({ a, b });

    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    await expect(status(a)).toHaveText('You are Black. Waiting for an opponent...');
    await expect(a.locator('#invite')).toBeVisible();
    await expect(a.getByText('Invite link: send it to your opponent')).toBeVisible();
    const invite = await inviteLink(a);

    await b.goto(`./?net=hook&quality=low${new URL(invite).hash}`);
    await b.locator('canvas').waitFor();
    await expect(status(b)).toHaveText('Joining as White...');
    await expect(status(a)).toHaveText('You are Black. Waiting for an opponent...'); // B is not connected yet

    await open(a);
    await open(b);
    await expect(status(b)).toHaveText('You are White. Black is here.');
    await expect(status(a)).toHaveText('You are Black. White is here.');

    // The connection drops on both sides, then comes back: same pages, same keys.
    await leave(a, 'b');
    await leave(b, 'a');
    await expect(status(a)).toHaveText('You are Black. White is disconnected.');
    await expect(status(b)).toHaveText('You are White. Black is disconnected.');
    await open(a);
    await open(b);
    await expect(status(a)).toHaveText('You are Black. White is here.');
    await expect(status(b)).toHaveText('You are White. Black is here.');

    // Closing page B: page A shows White disconnected, and still its own color.
    await b.context().close();
    await leave(a, 'b');
    await expect(status(a)).toHaveText('You are Black. White is disconnected.');
  });

  // Issue #226: a player back after a drop catches up on the move it missed. Page B's connection breaks
  // before page A notices (Trystero sees a peer leave only after a timeout), so A still plays and its move
  // is lost on the way. B comes back on the same key: A sends it the signed move it missed.
  test('a player back after a drop shows the same ply and side to move as the other page, #226', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    const lost = new Set<string>();
    await room({ a, b }, lost);
    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    await b.goto(`./?net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('You are Black. White is here.');
    await play(a, 0, 2);
    await play(a, 0, 1);
    await expect.poll(() => plies(b)).toBe(1);
    await play(b, 0, -2);
    await play(b, 0, -1);
    await expect.poll(() => plies(a)).toBe(2);

    // B's connection breaks: B sees Black leave, A does not notice yet and plays.
    lost.add('b');
    await leave(b, 'a');
    await expect(status(b)).toHaveText('You are White. Black is disconnected.');
    await play(a, 0, 1);
    await play(a, 0, 2);
    await expect(a.locator('#hud .turn')).toHaveText('White to move');
    expect(await plies(a)).toBe(3);
    expect(await plies(b)).toBe(2);
    await expect(b.locator('#hud .turn')).toHaveText('Black to move');

    // A notices, then both come back on the same keys: B catches up on the move it missed.
    await leave(a, 'b');
    lost.delete('b');
    await open(a);
    await open(b);
    await expect.poll(() => plies(b)).toBe(3);
    for (const page of [a, b]) await expect(page.locator('#hud .turn')).toHaveText('White to move');
    await expect(status(b)).toHaveText('You are White. Black is here.');
    await expect(status(a)).toHaveText('You are Black. White is here.');

    // And the game goes on from there.
    await play(b, 0, -1);
    await cell(b, 0, -2);
    await expect.poll(() => plies(a)).toBe(4);
    for (const page of [a, b]) await expect(page.locator('#hud')).not.toContainText('refused');
    await b.context().close();
  });
});

test.describe('one creator page in reduced motion, joiners on the invite link', { tag: '@one-page' }, () => {
  const creator = sharedCreator(true);

  test('a third peer opening the link is not a player: room is full, its move changes nothing, bug #117', async ({ browser }) => {
    const a = creator();
    const [b, c] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()));
    const all = [a, b, c];
    await calm(b, c);
    await room({ a, b, c });

    await expect(a.locator('#hud')).not.toBeEmpty(); // refresh() runs after the play-online listener is wired
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    // The two joiners load at once: their page loads overlap instead of queueing one after the other.
    await Promise.all([b, c].map(async (page) => {
      await page.goto(`./?net=hook&quality=low${hash}`);
      await page.locator('canvas').waitFor();
    }));
    for (const page of all) await open(page);

    await seat(b, 'player');
    await seat(c, 'spectator');
    await expect(status(c)).toHaveText('Room is full, watching');
    await expect(c.locator('#hud')).not.toContainText('You are White');
    await expect(status(b)).toHaveText('You are White. Black is here.');
    await expect(status(a)).toHaveText('You are Black. White is here.');

    await play(a, 0, 2);
    await play(a, 0, 1);
    await expect.poll(() => plies(b)).toBe(1);
    await expect.poll(() => plies(c)).toBe(1); // a spectator still follows the game

    // It is White's turn: C tries to play it.
    await play(c, 0, -2);
    await play(c, 0, -1);
    await expect(c.locator('#hud')).toContainText('Room is full, watching');
    expect(await plies(c)).toBe(1);
    expect(await plies(a)).toBe(1);
    expect(await plies(b)).toBe(1);
    await expect(b.locator('#hud')).toContainText('White to move');

    // The real White still plays, everyone follows.
    await play(b, 0, -2);
    await cell(b, 0, -1);
    await expect.poll(() => plies(a)).toBe(2);
    await expect.poll(() => plies(c)).toBe(2);
    await expect(a.locator('#hud')).not.toContainText('refused');

    // Presence follows the key bound to the seat: the spectator leaving is not White leaving (#121).
    await c.context().close();
    await leave(a, 'c');
    await leave(b, 'c');
    await expect(status(a)).toHaveText('You are Black. White is here.');
    await expect(status(b)).toHaveText('You are White. Black is here.');
    await b.context().close();
  });

  // Issue #143: a move is sent only while the key bound to the opponent's seat is connected, not
  // while just any peer (here a spectator) is.
  test('a player cannot move while the opponent is gone, even with a spectator still there, #143', async ({ browser }) => {
    const a = creator();
    const [b, c] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()));
    await calm(b, c);
    await room({ a, b, c });
    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    await Promise.all([b, c].map(async (page) => {
      await page.goto(`./?net=hook&quality=low${hash}`);
      await page.locator('canvas').waitFor();
    }));
    for (const page of [a, b, c]) await open(page);
    await seat(b, 'player');
    await seat(c, 'spectator');
    await expect(status(a)).toHaveText('You are Black. White is here.');

    // White's connection drops, the spectator stays: Black's move must not be sent.
    await leave(a, 'b');
    await leave(c, 'b');
    await leave(b, 'a');
    await leave(b, 'c');
    await expect(status(a)).toHaveText('You are Black. White is disconnected.');
    await play(a, 0, 2);
    await play(a, 0, 1);
    await expect(a.locator('#hud')).toContainText('waiting for opponent');
    for (const page of [a, b, c]) expect(await plies(page)).toBe(0);

    // White comes back on the same key: the move goes through to everyone.
    await open(b);
    await open(a);
    await expect(status(a)).toHaveText('You are Black. White is here.');
    await play(a, 0, 2);
    await cell(a, 0, 1);
    await expect.poll(() => plies(b)).toBe(1);
    await expect.poll(() => plies(c)).toBe(1);
    await b.context().close();
    await c.context().close();
  });

  // Issue #186: after a finished game both players ask for a rematch, a new game on the same channel
  // with the colours swapped. The cheapest real way to finish a game: one marble each, there and
  // back twice, brings the start position back a third time, a draw by threefold repetition.
  test('a finished online game ends in a rematch: colours swapped, the new Black moves first, #186', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await calm(b);
    await room({ a, b });
    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    await b.goto(`./?net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('You are Black. White is here.');
    await expect(a.locator('#rematch')).toBeHidden(); // the game runs

    const cycle: [Page, number, number, number, number][] = [
      [a, 0, 2, 0, 1],
      [b, 0, -2, 0, -1],
      [a, 0, 1, 0, 2],
      [b, 0, -1, 0, -2],
    ];
    for (let ply = 0; ply < 8; ply++) {
      const [page, fq, fr, tq, tr] = cycle[ply % 4]!;
      const press = ply < 7 ? play : cell; // the last ply goes through the mouse
      await press(page, fq, fr);
      await press(page, tq, tr);
      await expect.poll(() => plies(page === a ? b : a)).toBe(ply + 1); // the other page replayed it
    }
    for (const page of [a, b]) await expect(page.locator('#hud .turn')).toHaveText('Draw');
    for (const page of [a, b]) {
      // Each side sees its own result (a draw is the same for both) and the one action it can take (#282).
      await expect(page.locator('body')).toHaveAttribute('data-over', 'draw');
      await expect(page.locator('#hud .end')).toContainText('Tally closes the page.');
    }

    // Each seated player sees the Rematch button. Black asks first, White sees it.
    await expect(a.locator('#rematch')).toBeVisible();
    await expect(b.locator('#rematch')).toBeVisible();
    await a.locator('#rematch').click();
    await expect(a.locator('#hud .rematch')).toHaveText('You asked for a rematch. Waiting for White...');
    await expect(a.locator('#rematch')).toBeDisabled();
    await expect(b.locator('#hud .rematch')).toHaveText('Black asks for a rematch.');
    await expect(status(a)).toHaveText('You are Black. White is here.'); // nothing starts on one ask

    // White asks too: a new game, colours swapped, nothing played yet.
    await b.locator('#rematch').click();
    await expect(status(a)).toHaveText('You are White. Black is here.');
    await expect(status(b)).toHaveText('You are Black. White is here.');
    for (const page of [a, b]) {
      await expect(page.locator('#hud .turn')).toHaveText('Black to move');
      await expect.poll(() => plies(page)).toBe(0);
      await expect(page.locator('#rematch')).toBeHidden();
      await expect(page.locator('#hud .rematch')).toHaveCount(0);
    }

    // The former Black cannot open the new game, the new Black (page B) does and page A sees it.
    await play(a, 0, -2);
    await play(a, 0, -1);
    expect(await plies(a)).toBe(0);
    await play(b, 0, 2);
    await play(b, 0, 1);
    await expect.poll(() => plies(a)).toBe(1);
    await expect(a.locator('#hud .turn')).toHaveText('White to move');
    await expect(b.locator('#hud .turn')).toHaveText('White to move');
    await play(a, 0, -2); // and the new White answers
    await play(a, 0, -1);
    await expect.poll(() => plies(b)).toBe(2);
    await expect(a.locator('#hud')).not.toContainText('refused');
    await expect(b.locator('#hud')).not.toContainText('refused');
    await b.context().close();
  });

  // Issue #232: the moves a peer catches up on show at once, without their ejection effect. Black pushes a
  // White marble off in the 3v2 push of eject.spec.ts, then a spectator joins: it shows the score of that
  // ply, and no effect ever started on it (recorded in the page, so a slow runner cannot miss one).
  test('a spectator joining after an ejection shows the score at once, with no ejection effect, #232', async ({ browser }) => {
    const a = creator();
    const [b, c] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()));
    const lost = new Set(['c']); // the spectator is not there yet
    // Reduced motion: slides take no time, and a live ejection still plays its effect (a fade) and counts in data-ejections.
    await calm(b, c);
    await room({ a, b, c }, lost);
    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    // The spectator's page loads now, in parallel with b's: the room drops its records until it is opened after the plies.
    await Promise.all([
      b.goto(`./?net=hook&quality=low${hash}`).then(() => b.locator('canvas').waitFor()),
      c.goto(`./?net=hook&quality=low${hash}`).then(() => c.locator('canvas').waitFor()),
    ]);
    await c.evaluate(() => {
      const w = window as any;
      w.__effects = [];
      new MutationObserver((changes) => w.__effects.push(...changes.map((ch) => ch.attributeName))).observe(document.body, {
        attributeFilter: ['data-ejecting', 'data-ejections', 'data-sound'],
      });
    });
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('You are Black. White is here.');
    const plays: [Page, ...[number, number][]][] = [
      [a, [-2, 2], [-2, 3], [-2, 4], [-2, 1]], // Black trio NW
      [b, [0, -3], [0, -2], [-1, -2]], // White pair SW
      [a, [-2, 1], [-2, 2], [-2, 3], [-2, 0]], // Black trio NW
      [b, [-1, -2], [-1, -1], [-2, -2]], // White pair W, into the Black column
      [a, [-2, 0], [-2, 1], [-2, 2], [-2, -1]], // 3v2 push, the last White marble leaves
    ];
    for (const [ply, [page, ...cells]] of plays.entries()) {
      const last = ply === plays.length - 1;
      // The last click of the last ply goes through the mouse: each mouse click waits for frames on three WebGL pages.
      for (const [i, [q, r]] of cells.entries()) await (last && i === cells.length - 1 ? cell : play)(page, q, r);
      await expect.poll(() => plies(page === a ? b : a)).toBe(ply + 1); // the other page replayed it
    }
    const score = 'Black ejected 1/6 · White ejected 0/6';
    for (const page of [a, b]) {
      await expect(page.locator('#hud .score')).toHaveText(score);
      await expect(page.locator('body')).toHaveAttribute('data-ejections', '1'); // a live move plays its effect
    }

    lost.delete('c');
    await open(c);
    // A Hello round trip, then a Sync answered by both players, each record verified: slow with three WebGL pages.
    await expect(c.locator('body')).toHaveAttribute('data-seat', 'spectator', { timeout: 30_000 });
    await expect.poll(() => plies(c), { timeout: 30_000 }).toBe(5);
    await expect(c.locator('#hud .score')).toHaveText(score);
    await expect(c.locator('#hud .turn')).toHaveText('White to move');
    await expect(c.locator('#hud .pip.out')).toHaveCount(1); // the ejected marble shows
    expect(await c.evaluate(() => (window as any).__effects)).toEqual([]);
    expect(await c.evaluate(() => document.body.dataset.ejecting)).toBeUndefined();
    await expect(c.locator('#hud')).not.toContainText('refused');
    for (const page of [b, c]) await page.context().close();
  });

  // Issue #187: online games end by anti-stalling exactly like hot-seat (rules.md sections 9 and 10.2).
  // The move list of the rematch test above, one marble each there and back twice, is played online between two
  // pages: after every ply both pages show the turn and score lines hot-seat shows, the draw by threefold
  // repetition at ply 8 included.
  // The no-ejection cap needs 100 plies: src/antistalling.test.ts checks it on two real sessions.
  test('threefold repetition ends an online game as a draw on both pages, as in hot-seat, #187', async ({ browser }) => {
    const plays: [number, number, number, number][] = [
      [0, 2, 0, 1],
      [0, -2, 0, -1],
      [0, 1, 0, 2],
      [0, -1, 0, -2],
    ];
    // What hot-seat shows after each ply (resume.spec.ts and eject.spec.ts check the hot-seat HUD itself): the start position
    // twice at ply 4 keeps the game going, the third time at ply 8 is a draw. No ejection in the cycle.
    const noScore = 'Black ejected 0/6 · White ejected 0/6';
    const hotSeat: string[][] = Array.from({ length: 8 }, (_, ply) => [ply % 2 === 0 ? 'White to move' : 'Black to move', noScore]);
    hotSeat[7] = ['Draw', noScore];

    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await calm(b);
    await room({ a, b });
    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'online');
    const hash = new URL(await inviteLink(a)).hash;
    await b.goto(`./?net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('You are Black. White is here.');
    for (let ply = 0; ply < 8; ply++) {
      const [fq, fr, tq, tr] = plays[ply % 4]!;
      const [mover, other] = ply % 2 === 0 ? [a, b] : [b, a];
      const press = ply < 7 ? play : cell; // the last ply goes through the mouse
      await press(mover, fq, fr);
      await press(mover, tq, tr);
      await expect.poll(() => plies(other)).toBe(ply + 1); // the other page replayed it
      for (const page of [a, b]) {
        await expect(page.locator('#hud .turn')).toHaveText(hotSeat[ply]![0]!);
        await expect(page.locator('#hud .score')).toHaveText(hotSeat[ply]![1]!);
      }
    }
    for (const page of [a, b]) await expect(page.locator('#hud')).toContainText('Same position three times'); // a draw by repetition
    await expect(a.locator('#hud')).not.toContainText('refused');
    await expect(b.locator('#hud')).not.toContainText('refused');
    await b.context().close();
  });

  // Co-op (docs/specs/coop-boss.md, #529, #530): page A opens the room with Fight together in the mode menu. Both pages
  // fight The Echo together: each human move is followed on every page by the boss reply its own engine computes. The
  // Echo's search is deterministic and each move's mirror is a bonus move for the other side (#859), offered to the
  // next seat (#958), so COOP_DRAW ends in a draw by repetition at the 7th player move (10 plies with the boss replies
  // and the free moves taken): a Defeat on both pages.
  test('a co-op boss fight from Fight together: the seats take turns, both pages play the boss replies and end alike, #529 #530', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await calm(b);
    await room({ a, b });
    const history = (page: Page) => page.evaluate(() => (window as any).__history());
    const turn = (page: Page) => page.locator('#hud .turn');

    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'coop:echo');
    const hash = new URL(await inviteLink(a)).hash;
    expect(hash).toMatch(/^#room=[\w-]+&boss=echo&seed=\d+&key=[\w-]{8}$/);
    await b.goto(`./?bot=off&net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('Your partner is here.');
    await expect(status(b)).toHaveText('Your partner is here.');
    await expect(turn(a)).toHaveText('Your turn');
    await expect(turn(b)).toHaveText("Partner's turn");

    await play(b, 0, 2); // seat 1 plays first: a move from seat 2 changes nothing
    await play(b, 0, 1);
    expect(await plies(b)).toBe(0);
    for (const [k, [seatNo, fq, fr, tq, tr, done]] of COOP_DRAW.entries()) {
      const [mover, other] = seatNo === 0 ? [a, b] : [b, a];
      await play(mover, fq, fr);
      await play(mover, tq, tr);
      await expect.poll(() => plies(other)).toBe(done);
      if (k === 0) {
        await expect(turn(a)).toHaveText("Partner's turn");
        await expect(turn(b)).toHaveText('Your turn');
        await play(a, 1, 2); // now seat 2's move
        await play(a, 1, 3);
        expect(await plies(a)).toBe(2);
      }
    }
    for (const page of [a, b]) await expect(turn(page)).toHaveText('Defeat');
    expect(await history(a)).toEqual(await history(b));
    await expect(a.locator('#hud .boss')).toHaveText((await b.locator('#hud .boss').textContent())!); // phase notches, tell, result
    expect(await a.evaluate(() => (window as any).__notches())).toEqual(await b.evaluate(() => (window as any).__notches()));
    await expect(a.locator('#hud')).not.toContainText('refused');
    await expect(b.locator('#hud')).not.toContainText('refused');
    await b.context().close();
  });

  // Co-op Retry (docs/specs/coop-boss.md section 5, #531): the fight of the test above ends in a Defeat, both seats ask
  // for a Retry, and the same fight restarts on both pages: no colour swap, seat 1 first, one attempt counter.
  test('a co-op Retry once both seats asked restarts the same fight, attempt 2 on both pages, #531', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await calm(b);
    await room({ a, b });
    const fight = (page: Page) => page.evaluate(() => (window as any).__fight());
    const retry = (page: Page) => page.getByRole('button', { name: 'Retry' });
    const asked = (page: Page) => page.locator('#hud .rematch');

    await expect(a.locator('#hud')).not.toBeEmpty();
    await startMode(a, 'coop:echo');
    const hash = new URL(await inviteLink(a)).hash;
    await b.goto(`./?bot=off&net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('Your partner is here.');
    for (const page of [a, b]) await expect(page.locator('#hud .boss')).toContainText('Boss with a partner · attempt 1');
    for (const [seatNo, fq, fr, tq, tr, done] of COOP_DRAW) {
      const [mover, other] = seatNo === 0 ? [a, b] : [b, a];
      await play(mover, fq, fr);
      await play(mover, tq, tr);
      await expect.poll(() => plies(other)).toBe(done);
    }
    for (const page of [a, b]) await expect(page.locator('#hud .turn')).toHaveText('Defeat');

    await retry(a).click();
    await expect(asked(a)).toHaveText('You asked for a retry. Waiting for your partner...');
    await expect(retry(a)).toBeDisabled();
    await expect(asked(b)).toHaveText('Your partner asks for a retry.');
    expect(await plies(b)).toBe(10); // nothing starts on one ask
    await retry(b).click();
    for (const page of [a, b]) {
      await expect.poll(() => plies(page)).toBe(0);
      await expect(page.locator('#hud .boss')).toContainText('Boss with a partner · attempt 2');
      await expect(retry(page)).toBeHidden();
      await expect(asked(page)).toHaveCount(0);
    }
    await expect(a.locator('#hud .turn')).toHaveText('Your turn'); // seat 1 opens the new attempt, both still Black
    await expect(b.locator('#hud .turn')).toHaveText("Partner's turn");
    expect(await fight(a)).toEqual(await fight(b));
    await play(a, 0, 2); // the same boss and seed: the same boss reply on both engines
    await cell(a, 0, 1);
    for (const page of [a, b]) await expect.poll(() => plies(page)).toBe(2); // each page played the boss reply
    expect(await a.evaluate(() => (window as any).__history())).toEqual(await b.evaluate(() => (window as any).__history()));
    await expect(a.locator('#hud')).not.toContainText('refused');
    await expect(b.locator('#hud')).not.toContainText('refused');
    await b.context().close();
  });

  // Boss duel (#1316): page A opens the room with Boss duel in the mode menu and is the hero, page B opens the invite and
  // plays the boss as White. The boss move comes from page B through the room, not from the engine's search, and both
  // pages judge it with the same encounter and end on the same board. An MCP agent joins the same link (mcp/e2e).
  test('a boss duel from Boss duel: the joiner plays the boss, both pages judge the same moves and end alike, #1316', async ({ browser }) => {
    const a = creator();
    const b = await (await browser.newContext()).newPage();
    await calm(b);
    await room({ a, b });
    const turn = (page: Page) => page.locator('#hud .turn');

    await expect(a.locator('#hud')).not.toBeEmpty();
    await openModes(a);
    await a.getByRole('button', { name: 'Boss vs a player' }).click();
    await a.locator('#coop-list').getByRole('button', { name: 'The Hull' }).click();
    const hash = new URL(await inviteLink(a)).hash;
    expect(hash).toMatch(/^#room=[\w-]+&boss=hull&seed=\d+&seat=boss&key=[\w-]{8}$/);
    await b.goto(`./?bot=off&net=hook&quality=low${hash}`);
    await b.locator('canvas').waitFor();
    await open(a);
    await open(b);
    await seat(b, 'player');
    await expect(status(a)).toHaveText('You fight the boss. The boss seat is here.');
    await expect(status(b)).toHaveText('You are the boss. The hero is here.');
    await expect(turn(a)).toHaveText('Your turn');
    await expect(turn(b)).toHaveText("Hero's turn");

    await play(a, 1, 3); // the hero, Black
    await play(a, 2, 2);
    await expect.poll(() => plies(b)).toBe(1);
    expect(await plies(a)).toBe(1); // no boss reply is computed by either page: the boss seat answers
    await expect(turn(b)).toHaveText('Your turn');
    await play(b, 2, -2); // the boss, White, chosen by its player
    await play(b, 2, -1);
    await expect.poll(() => plies(a)).toBe(2);
    await expect(turn(a)).toHaveText('Your turn');
    const history = (page: Page) => page.evaluate(() => (window as any).__history());
    expect(await history(a)).toEqual(await history(b));
    await expect(a.locator('#hud .boss')).toContainText('Boss vs a player');
    await expect(a.locator('#hud')).not.toContainText('refused');
    await expect(b.locator('#hud')).not.toContainText('refused');
    await a.screenshot({ path: test.info().outputPath('duel-hero.png') });
    await b.screenshot({ path: test.info().outputPath('duel-boss.png') });
    await b.context().close();
  });
});

test('two tabs of the same browser context play an online game, bug #116', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage(); // same context: shared localStorage
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', (e) => errors.push(e.message));
  await room({ a, b });
  // Bug #238: page b's hook transport only comes after main.ts loads the textures and the saved game. Its textures
  // are held until open(b) has run in the page, so the test opens a page that is still loading on every run, not only
  // on a loaded machine.
  let release!: () => void;
  const held = new Promise<void>((done) => (release = () => done()));
  let loading!: () => void;
  const textures = new Promise<void>((done) => (loading = done));
  await b.route('**/assets/*.ktx2', async (route) => {
    loading();
    await held;
    await route.continue();
  });

  await a.goto('./?bot=off&net=hook&quality=low'); // './' keeps the /edgefall/ path of E2E_BASE_URL, '/' is the Pages host root (404)
  await a.locator('canvas').waitFor();
  await expect(a.locator('#hud')).not.toBeEmpty(); // refresh() runs after the play-online listener is wired
  await startMode(a, 'online');
  const invite = await inviteLink(a);
  await b.goto(`./?net=hook&quality=low${new URL(invite).hash}`, { waitUntil: 'commit' }); // held textures can hold the load event
  await textures; // main.ts runs on page b and waits for its textures (its canvas comes after them, #585)
  await open(a);
  // Calls on a page run in order: the textures go only once a later call on page b came back, so open(b)
  // reaches page b while it still loads.
  await Promise.all([open(b), b.evaluate(() => {}).then(release)]);
  await seat(b, 'player');

  await play(a, 0, 2);
  await play(a, 0, 1);
  await expect.poll(() => plies(b)).toBe(1);
  await play(b, 0, -2);
  await cell(b, 0, -1);
  await expect.poll(() => plies(a)).toBe(2);
  await expect(a.locator('#hud')).not.toContainText('refused');
  await expect(b.locator('#hud')).not.toContainText('refused');
  expect(errors).toEqual([]); // a record relayed to a page with no session yet was an unhandled rejection (#249)
});

// Bug #127: main.ts awaits the wasm engine and the textures before it attaches the click listener.
// A click right after domcontentloaded must either hit a disabled button or create the invite.
test('Play online is disabled or works when clicked right after load, bug #127', async ({ page }) => {
  await page.goto('./?bot=off&net=hook&quality=low', { waitUntil: 'domcontentloaded' });
  const disabledAtClick = await page.evaluate(() => {
    const button = document.getElementById('play-online') as HTMLButtonElement;
    const wasDisabled = button.disabled;
    button.click();
    return wasDisabled;
  });
  expect(disabledAtClick || /#room=[\w-]+&key=[\w-]{8}$/.test(await inviteLink(page))).toBe(true);
});

// Issue #194: offline, Play online is disabled with a notice. Back online, it works again without a reload.
test('Play online is disabled with a notice while offline and works again back online, #194', async ({ page, context }) => {
  await page.goto('./?bot=off&net=hook&quality=low');
  await page.locator('canvas').waitFor();
  const button = page.locator('#play-online');
  await expect(button).toBeEnabled();

  await context.setOffline(true);
  await expect(button).toBeDisabled();
  await expect(page.locator('#hud')).toContainText('online play needs a connection');

  await context.setOffline(false);
  await expect(button).toBeEnabled();
  await expect(page.locator('#hud')).not.toContainText('online play needs a connection');
  await openModes(page);
  await button.click();
  await expect(page.locator('#hud')).toContainText('You are Black');
});

// #359: a room of three (Black, White and a spectator: the smallest room with a host, tech.md section 6). A 4-peer room costs
// four page loads, 10 to 14 s of the 15 s a test has, so the four-peer room is the unit test (migration.test.ts) and this is
// the thin e2e of the result. The coordinator page closes without a leave event, as a crashed tab does: only the missing
// heartbeats show it. beat=1200 shortens the 5 s heartbeat (not lower: a background page runs timers once a second at best),
// honoured under webdriver.
test('the coordinator page closes: the lowest join_seq live peer coordinates on every page, #359', async ({ browser }) => {
  const [a, b, c] = await Promise.all([0, 1, 2].map(async () => (await browser.newContext()).newPage()));
  const rest = [b, c];
  await calm(a, b, c);
  await Promise.all(rest.map((p) => p.clock.install())); // the missing heartbeats are counted on the page clock, moved by hand below
  await room({ a, b, c });
  await a.goto('./?bot=off&net=hook&beat=1200');
  await a.locator('canvas').waitFor();
  await expect(a.locator('#hud')).not.toBeEmpty();
  await startMode(a, 'online');
  const hash = new URL(await inviteLink(a)).hash;
  // White first, so its join_seq is 2 and the spectator's 3: the pages load together, they open in that order.
  await Promise.all([b, c].map(async (page) => {
    await page.goto(`./?net=hook&beat=1200${hash}`);
    await page.locator('canvas').waitFor();
  }));
  await open(a);
  await open(b);
  await seat(b, 'player');
  await open(c);
  await seat(c, 'spectator');
  for (const page of [a, ...rest]) await expect(page.locator('body')).toHaveAttribute('data-coordinator', '1');

  await a.context().close(); // no __netLeave anywhere
  // The heartbeats a closed tab no longer sends. A beat is delivered before the other page's clock moves: on a slow runner a
  // beat that came late made a live peer look gone for 3 missed beats (seen once on CI: coordinator 3 instead of 2).
  for (let beat = 0; beat < 6; beat++)
    for (const page of rest) {
      await page.clock.fastForward(1200);
      await delivered();
    }
  for (const page of rest) await expect(page.locator('body')).toHaveAttribute('data-coordinator', '2');
  await expect(b.locator('body')).toHaveAttribute('data-handover', 'done'); // the spectator acknowledged it
  for (const page of rest) await page.context().close();
});
