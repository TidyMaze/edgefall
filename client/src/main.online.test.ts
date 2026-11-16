// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMove, moveForClick, parseMoves, type Axial } from './board';
import { generateKeys, signCoordinator, signHello, type Report, type Wire } from './moverecord';
import { RankedSeal, type Seal } from './rankedseal';
import { bothSigned, type SharedResult } from './boardfeed';
import { SIGNALING_TIMEOUT_MS } from './netcounters';
import { OnlineSession } from './session';
import { fingerprint } from './invite';
import { boot, type Game, startBoss } from './test/harness';
import type { Transport } from './transport';

// The online part of main.ts on the harness (src/test/harness.ts, decision #445): Play online and the invite link,
// the session's callbacks as the HUD shows them, rematch, connectivity, Copy diagnostics and the service worker.
// The opponent is a real OnlineSession on the other end of the room, with its own engine.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const presence = (): string => document.querySelector('#hud .presence')?.textContent ?? '';

/** Settles until `ok` holds: signatures are checked on the real Web Crypto, which takes a few tasks. */
/** Settles until `ok`, for 5 s of real time at most: a count of turns ran out on a loaded CI runner before the room's key was made (main red on e325e8d3). */
async function until(game: Game, ok: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!ok() && Date.now() < end) await game.settle();
  expect(ok()).toBe(true);
}

/** The other player: a session with its own engine on `transport`, which plays a move by its cells. `version` is
 * added to the engine version its Hello carries, so it can run another one (#526). */
async function opponent(transport: Transport, room: string, side: number, version = 0, onOther?: (m: Wire, key: string) => void | Promise<void>) {
  const { Engine, engine_version } = await import('edgefall-wasm');
  let engine = new Engine();
  const keys = await generateKeys();
  const reports: Report[] = []; // the page's match reports (#1317)
  const session = new OnlineSession({
    game: room,
    side,
    engine: engine_version() + version,
    keys,
    transport,
    judge: {
      to_move: () => engine.to_move(),
      play: (mv) => engine.play(mv),
      status: () => engine.status(),
      restart: () => (engine = new Engine()),
    },
    onMove: () => {},
    onRefuse: () => {},
    onReport: (r) => reports.push(r),
    onOther,
    beat: { ms: 5000, now: Date.now, every: () => {} }, // sends the join order the coordinator migration needs
  });
  const play = async (from: Axial, to: Axial): Promise<void> => {
    const record = encodeMove(moveForClick(parseMoves(engine.legal_moves()), [from], to)!);
    engine.play(Int32Array.from(record));
    await session.send(record);
  };
  // What this player says of the finished game: the board it sees, unless the test lies about it.
  const report = (rating: number, hash = Array.from(engine.board()).join(',')) => session.report({ hash, status: engine.status(), rating });
  return { session, keys, play, reports, report };
}

/** Plays a move on the page by its two clicks, then lets its slide end. */
function click(game: Game, from: Axial, to: Axial): void {
  game.click(...from);
  game.click(...to);
  game.frame(5000);
}

/** Boots, presses Play online in the mode menu, and seats a White opponent once the page's session exists. */
async function hosted(url = '?bot=off', options: Parameters<typeof boot>[1] = {}) {
  const game = await boot(url, options);
  if (options.audio) dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); // the first gesture unlocks the sound (#1570)
  byId('play-online').click();
  await until(game, () => data().seat === 'player');
  const white = await opponent(game.peer()!, game.room()!, 2);
  await until(game, () => data().opponent === 'here');
  return { game, white };
}

// The shared board asks at the first ranked entry (#1287). These tests answer it once, as declined, after boot (boot clears storage), so the queue starts.
const declineBoard = (): void => localStorage.setItem('ab-alone.board-consent', JSON.stringify({ v: 5, choice: 'declined' }));

/** Presses Ranked and seats a White opponent (#1317). */
async function rankedHosted() {
  const game = await boot('?bot=off');
  declineBoard();
  byId('ranked').click();
  await until(game, () => data().seat === 'player');
  const white = await opponent(game.peer()!, game.room()!, 2);
  await until(game, () => data().opponent === 'here');
  return { game, white };
}

/** Ends the game by threefold repetition, a draw, and waits for the page's report to reach `white`. */
async function drawGame(game: Game, white: Awaited<ReturnType<typeof opponent>>): Promise<void> {
  const there: Axial[][] = [[[0, 2], [0, 1]], [[0, -2], [0, -1]], [[0, 1], [0, 2]], [[0, -1], [0, -2]]];
  for (let ply = 0; ply < 8; ply += 2) {
    const [mine, theirs] = [there[ply % 4]!, there[(ply + 1) % 4]!];
    click(game, mine[0]!, mine[1]!);
    await until(game, () => white.session.signedLog.length === ply + 1);
    await white.play(theirs[0]!, theirs[1]!);
    await until(game, () => game.hook('__plies') === ply + 2 && game.turn() !== 'White to move'); // the HUD too (#952)
    game.frame(5000);
  }
  await until(game, () => white.reports.length === 1);
}

/** The other end of the hook transport (?net=hook): what the page sends to `__netOut`, what it gets on `__netIn`. */
function hookEnd(): Transport & { leave(): void } {
  const w = window as unknown as Record<string, (...args: unknown[]) => void>;
  return {
    state: 'open',
    send: (message) => w.__netIn!(message, 'creator'),
    onRecord: (cb) => (w.__netOut = (message) => cb(message as Wire, 'page')),
    onState: () => {},
    onLeave: () => {},
    close: () => {},
    leave: () => w.__netLeave!('creator'),
  };
}

const calls = (): number => (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.length;
const copied = (): string =>
  (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });
}

afterEach(() => {
  for (const name of ['clipboard', 'onLine', 'serviceWorker']) Reflect.deleteProperty(navigator, name);
  vi.unstubAllEnvs();
});

describe('Play online', () => {
  it('shows the invite link to the room in the address, and waits for an opponent', async () => {
    const game = await boot('?bot=off');
    byId('play-online').click();
    await until(game, () => data().seat === 'player'); // once its keys are made, the link carries their fingerprint (#1323)
    const room = game.room()!;
    expect(room).toMatch(/^[\w-]{22}$/);
    expect(location.hash).toMatch(new RegExp(`^#room=${room}&key=[\\w-]{8}$`));
    const invite = byId<HTMLInputElement>('invite');
    expect(invite.hidden).toBe(false);
    expect(byId('invite-label').hidden).toBe(false);
    expect(new URL(invite.value).hash).toBe(location.hash);
    expect(byId('new-game').hidden).toBe(true);
    expect(byId('boss-retry').hidden).toBe(true);
    expect(data().online).toBe('Black');
    expect(data().opponent).toBe('waiting');
    expect(data().coordinator).toBe('1');
    expect(data().handover).toBe('none');
    expect(presence()).toBe('You are Black. Waiting for an opponent...');
  });

  // The four lobbies a creator can wait in (#1529): a table (Play online, Ranked) or a boss (Fight together, Boss duel).
  const lobbies: [string, (game: Game) => void][] = [
    ['Play online', (game) => byId('play-online').click()],
    ['Ranked', (game) => (declineBoard(), byId('ranked').click())],
    ['Fight together', (game) => (byId('fight-together').click(), bossButton('The Echo').click())],
    ['Boss duel', (game) => (byId('boss-duel').click(), bossButton('The Echo').click())],
  ];
  const bossButton = (name: string): HTMLElement => [...byId('coop-list').querySelectorAll('button')].find((b) => b.textContent === name)!;
  /** Opens a lobby, waits out the 80 ms wait (?lobbywait) with no peer, and returns the page. */
  async function waited(open: (game: Game) => void): Promise<Game> {
    const game = await boot('?bot=off&lobbywait=80');
    open(game);
    await until(game, () => data().seat === 'player');
    await new Promise((done) => setTimeout(done, 150));
    return game;
  }

  for (const [name, open] of lobbies) {
    it(`${name}: after the wait with no peer the lobby offers one button, Play the bot while you wait (#1529)`, async () => {
      const game = await waited(open);
      expect(byId('lobby-offer').hidden).toBe(false);
      expect([...byId('lobby-offer').children].map((el) => el.textContent)).toEqual(['Play the bot while you wait']);
      expect(byId('invite').hidden).toBe(false); // the link stays in the sheet, no second button for it
      const white = await opponent(game.peer()!, game.room()!, 2);
      await until(game, () => data().opponent === 'here');
      expect(byId('lobby-offer').hidden).toBe(true);
      expect(white.session).toBeDefined();
    });

    it(`${name}: Play the bot starts a bot game of the same kind and the room stays open and listening (#1529)`, async () => {
      const game = await waited(open);
      const invite = byId<HTMLInputElement>('invite').value;
      const room = game.room();
      const fightOf = () => {
        const f = game.hook<{ id: string; seed: number } | null>('__fight');
        return f && { id: f.id, seed: f.seed };
      };
      const boss = fightOf();
      byId('lobby-bot').click();
      expect(data().online).toBeUndefined(); // the page plays a bot game, not the room's
      expect(byId('lobby-offer').hidden).toBe(true);
      expect(byId('invite').hidden).toBe(false);
      expect(byId<HTMLInputElement>('invite').value).toBe(invite);
      expect(byId('new-game').hidden).toBe(boss !== null); // a table has New game, a boss has Retry
      expect(fightOf()).toEqual(boss); // the same boss and seed, or none for a table
      expect(game.hook('__plies')).toBe(0);
      expect(byId('room-switch').hidden).toBe(true);
      const white = await opponent(game.peer()!, game.room()!, 2);
      await until(game, () => !byId('room-switch').hidden);
      expect(game.room()).toBe(room);
      expect(byId('room-switch').textContent).toBe('A player joined the room: switch to it');
      expect(byId('hud').querySelector('.rank-badge')).toBeNull(); // a bot game is never rated
      expect(white.reports).toEqual([]);
    });

    it(`${name}: pressing the switch line leaves the bot game for the room, the player in its seat (#1529)`, async () => {
      const game = await waited(open);
      byId('lobby-bot').click();
      await opponent(game.peer()!, game.room()!, 2);
      await until(game, () => !byId('room-switch').hidden);
      byId('room-switch').click();
      expect(byId('room-switch').hidden).toBe(true);
      await until(game, () => data().seat === 'player' && data().opponent === 'here');
      expect(game.hook('__plies')).toBe(0);
      expect(byId('lobby-offer').hidden).toBe(true);
    });
  }

  it('a bot game from Ranked never counts: no rating, no report to the room, nothing stored (#1529)', async () => {
    const game = await waited(lobbies[1]![1]);
    byId('lobby-bot').click();
    const white = await opponent(game.peer()!, game.room()!, 2);
    await until(game, () => !byId('room-switch').hidden);
    click(game, [0, 2], [0, 1]);
    expect(game.hook('__plies')).toBe(1);
    expect(byId('hud').querySelector('.rank-badge')).toBeNull();
    expect(byId('hud').querySelector('.rank-result')).toBeNull();
    expect(white.reports).toEqual([]);
    expect(localStorage.getItem('ab-alone.ranked')).toBeNull();
  });

  it('leaving the bot game closes the room: its link goes and a later peer is not offered a switch (#1529)', async () => {
    const game = await waited(lobbies[0]![1]);
    byId('lobby-bot').click();
    startBoss('The Echo'); // another mode: the bot game is left as it is today
    expect(byId('invite').hidden).toBe(true);
    expect(location.hash).toBe('');
    await opponent(game.peer()!, game.room()!, 2).catch(() => {});
    await game.settle();
    expect(byId('room-switch').hidden).toBe(true);
  });

  it('no switch line shows when nobody joins during the bot game, and New game keeps the room listening (#1529)', async () => {
    const game = await waited(lobbies[0]![1]);
    byId('lobby-bot').click();
    byId('new-game').click();
    expect(byId('room-switch').hidden).toBe(true);
    await opponent(game.peer()!, game.room()!, 2);
    await until(game, () => !byId('room-switch').hidden);
  });

  it('scrolls the button column back to the top, so no button above the link is left out of reach (#839)', async () => {
    const game = await boot('?bot=off');
    byId('online').scrollTop = 40; // the player scrolled down to the mode menu
    byId('play-online').click();
    await until(game, () => data().seat === 'player'); // the link shows once the keys are made
    expect(byId('online').scrollTop).toBe(0);
  });

  it('puts the fingerprint of the key that holds Black in the invite link (#1323)', async () => {
    const { game, white } = await hosted();
    await until(game, () => white.session.seats.keyOf(1) !== ''); // the page saw White's Hello, White may not have seen the page's yet (#1509)
    expect(location.hash).toBe(`#room=${white.session.game}&key=${await fingerprint(white.session.seats.keyOf(1))}`);
  });

  it('as a joiner from a link with a fingerprint, takes Black only from a Hello of that key (#1323)', async () => {
    const { engine_version } = await import('edgefall-wasm');
    const creator = await generateKeys();
    const rival = await generateKeys();
    const game = await boot(`?net=hook#room=the-room&key=${await fingerprint(creator.pub)}`);
    await until(game, () => data().seat === 'pending');
    const end = hookEnd();
    let page = '';
    end.onRecord((m) => (page ||= (m as { kind?: string; pub?: string }).kind === 'hello' ? (m as { pub: string }).pub : ''));
    (window as unknown as Record<string, () => void>).__netOpen!();
    await until(game, () => page !== '');
    const say = async (keys: typeof creator, roster: string[]) =>
      end.send(await signHello(keys, { game: 'the-room', seat: 1, roster, engine: engine_version() }));
    await say(rival, [rival.pub, page]); // signed and first, but not the key of the link
    await game.settle();
    expect(data().seat).toBe('pending');
    await say(creator, [creator.pub, page]);
    await until(game, () => data().seat === 'player');
  });

  it('shows the opponent here once its Hello is verified, then disconnected once the room closes', async () => {
    const { game } = await hosted();
    expect(presence()).toBe('You are Black. White is here.');
    game.peer()!.close();
    await until(game, () => data().opponent === 'gone');
    expect(presence()).toBe('You are Black. White is disconnected.');
    expect(game.hud()).toContain(' · closed');
  });

  it('returns to the Hub at any time via the exit, tearing down online session (#773, #1697)', async () => {
    const { game } = await hosted();
    expect(presence()).toBe('You are Black. White is here.');
    expect(data().online).toBe('Black');
    expect(byId('exit').hidden).toBe(false); // an online room has its way out too (#1697)
    byId('exit').click();
    expect(data().online).toBeUndefined();
    expect(data().seat).toBeUndefined();
    expect(data().opponent).toBeUndefined();
    expect(byId('invite').hidden).toBe(true);
    expect(data().hub).toBeTruthy();
  });

  it('sends our moves to the opponent and replays its moves through the engine', async () => {
    const { game, white } = await hosted();
    click(game, [0, 2], [0, 1]);
    expect(game.hook('__plies')).toBe(1);
    expect(game.turn()).toBe('White to move');
    await until(game, () => white.session.signedLog.length === 1);
    await white.play([0, -2], [0, -1]);
    await until(game, () => game.hook('__plies') === 2 && game.turn() !== 'White to move'); // the HUD too (#952)
    expect(game.turn()).toBe('Black to move');
  });

  it('refuses a message the session cannot read, and says so in the HUD', async () => {
    const { game } = await hosted();
    game.peer()!.send({ kind: 'move' } as unknown as Wire);
    await until(game, () => game.hud().includes(' · refused move: malformed'));
    expect(game.hook('__plies')).toBe(0);
  });

  it('refuses an opponent on another engine version with a note, and keeps waiting for one, #526', async () => {
    const game = await boot('?bot=off');
    byId('play-online').click();
    await until(game, () => data().seat === 'player');
    await opponent(game.peer()!, game.room()!, 2, 1);
    await until(game, () => game.hud().includes(' · refused move: engine-version'));
    expect(data().opponent).toBe('waiting');
    expect(presence()).toBe('You are Black. Waiting for an opponent...');
  });

  it('Ranked queues 1v1 with rank badge and tolerance window, and updates Elo rating on game end (#711)', async () => {
    const game = await boot('?bot=off');
    declineBoard();
    const rankedBtn = byId<HTMLButtonElement>('ranked');
    expect(rankedBtn.disabled).toBe(false);
    rankedBtn.click();
    await until(game, () => data().seat === 'player');
    expect(byId('hud').querySelector('.rank-badge')?.textContent).toContain('Silver');
    expect(byId('hud').querySelector('.rank-queue')?.textContent).toBe('Queue ±100');

    const white = await opponent(game.peer()!, game.room()!, 2);
    await until(game, () => data().opponent === 'here');
    expect(byId('hud').querySelector('.rank-queue')).toBeNull();

    await drawGame(game, white);
    // Rated only once the opponent's signed report is in (#1317).
    expect(byId('hud').querySelector('.rank-delta')).toBeNull();
    expect(byId('hud').querySelector('.rank-result')?.textContent).toBe('Waiting for the opponent report');
    expect(localStorage.getItem('ab-alone.ranked')).toBeNull();
    await white.report(1200);
    await until(game, () => byId('hud').querySelector('.rank-delta') !== null);
    expect(byId('hud').querySelector('.rank-delta')?.textContent).toBe('+0 Elo');
    expect(byId('hud').querySelector('.rank-result')).toBeNull();
    expect(JSON.parse(localStorage.getItem('ab-alone.ranked')!).matches).toHaveLength(1);
    expect(white.reports).toMatchObject([{ side: 1, status: 3, rating: 1200 }]); // ours reached the opponent, signed by our key
  });

  /** A ranked draw with a White opponent that listens for seals (#1287). `whiteJoins`: the opponent plays under a board key too. */
  async function sealedDraw(joined: boolean, whiteJoins: boolean, search = '?bot=off&board=publish') {
    const relays: { url: string; sent: string[] }[] = [];
    // The relays are stubs, whatever the page opens: a test never reaches a real one.
    vi.stubGlobal('WebSocket', class { // eslint-disable-line @typescript-eslint/no-extraneous-class
      private fns: ((e: { data?: string }) => void)[] = [];
      private rec = { url: '', sent: [] as string[] };
      constructor(url: string) {
        this.rec.url = url;
        relays.push(this.rec);
        queueMicrotask(() => this.fns.forEach((f) => f({})));
      }
      addEventListener(type: string, fn: (e: { data?: string }) => void): void {
        if (type === 'open') this.fns.push(fn);
      }
      send(data: string): void {
        this.rec.sent.push(data);
      }
      close(): void {}
    });
    const game = await boot(search);
    localStorage.setItem('ab-alone.board-consent', JSON.stringify({ v: 5, choice: joined ? 'joined' : 'declined' }));
    byId('ranked').click();
    await until(game, () => data().seat === 'player');
    const heard: Seal[] = [];
    const out: { seal?: RankedSeal; result?: SharedResult } = {};
    const transport = game.peer()!;
    const white = await opponent(transport, game.room()!, 2, 0, async (m, key) => {
      heard.push(m as Seal);
      const step = await out.seal?.receive(m, key);
      if (step?.send) transport.send(step.send);
      if (step?.result) out.result = step.result;
    });
    await until(game, () => data().opponent === 'here');
    const board = await generateKeys();
    if (whiteJoins) out.seal = new RankedSeal({ game: white.session.game, side: 2, keys: white.keys, board, name: 'Bob', opponent: white.session.opponent, nowS: () => Math.floor(Date.now() / 1000) });
    await drawGame(game, white);
    if (out.seal) {
      transport.send(await out.seal.intro());
      await out.seal.finish({ moves: white.session.signedLog.map((r) => r.move), status: 3, ejected: [0, 0] });
    }
    await white.report(1200);
    await until(game, () => byId('hud').querySelector('.rank-delta') !== null);
    return { game, heard, out, relays };
  }

  it('with ?board and both seats joined, the seats sign the ranked result together (#1287)', async () => {
    const { game, heard, out, relays } = await sealedDraw(true, true);
    await until(game, () => game.hook('__sealed') !== null);
    await until(game, () => relays.length === 2 && relays.every((r) => r.sent.length === 1));
    expect(relays.map((r) => r.url)).toEqual(['wss://relay.piazza.today', 'wss://relay.bitmacro.cloud']);
    expect(JSON.parse(relays[0]!.sent[0]!)[0]).toBe('EVENT');
    const mine = game.hook('__sealed') as SharedResult;
    expect(await bothSigned(mine)).toBe(true);
    expect(out.result).toEqual(mine);
    expect(mine).toMatchObject({ status: 3, ejected: [0, 0] });
    expect(mine.moves).toHaveLength(8);
    expect(heard.map((s) => s.step)).toEqual(['intro', 'result']);
  });

  it('plain ?board signs but never writes to a relay: publishing needs ?board=publish (#1287)', async () => {
    const { game, relays } = await sealedDraw(true, true, '?bot=off&board');
    await until(game, () => game.hook('__sealed') !== null);
    await game.settle();
    expect(relays).toEqual([]);
  });

  it('a seat that did not join sends no seal and takes none: nothing is signed (#1287)', async () => {
    for (const [joined, whiteJoins] of [[true, false], [false, true]] as const) {
      const { game, heard, relays } = await sealedDraw(joined, whiteJoins);
      await until(game, () => heard.length === (joined ? 1 : 0)); // the intro reached the opponent
      await game.settle();
      expect(relays).toEqual([]); // nothing is published unless both seats joined
      expect(game.hook('__sealed')).toBeNull();
      expect(heard.map((s) => s.step)).toEqual(joined ? ['intro'] : []); // joined alone: its intro is all there is, no result
    }
  });

  it('Ranked rates against the opponent real rating from its report, not a default (#1317)', async () => {
    const { game, white } = await rankedHosted();
    await drawGame(game, white);
    await white.report(1400);
    await until(game, () => byId('hud').querySelector('.rank-delta') !== null);
    const delta = Number(/^[+-]\d+/.exec(byId('hud').querySelector('.rank-delta')!.textContent!)![0]);
    expect(delta).toBeGreaterThan(0); // a draw against a 1400 opponent pays a 1200 player
  });

  it('Ranked refuses a report that differs from ours and rates nothing (#1317)', async () => {
    const { game, white } = await rankedHosted();
    await drawGame(game, white);
    await white.report(1200, 'another board');
    await until(game, () => byId('hud').querySelector('.rank-result')?.textContent === 'Not rated: the reports differ');
    expect(byId('hud').querySelector('.rank-delta')).toBeNull();
    expect(localStorage.getItem('ab-alone.ranked')).toBeNull();
  });

  it('Ranked in Battle royale shows rank badge and updates Battle Royale Elo on placement (#711)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('battle-royale').click();
    declineBoard();
    byId('ranked').click();
    expect(byId('hud').querySelector('.rank-badge')?.textContent).toContain('Silver');
    // Load a finished royale state via __royale hook while in ranked royale mode
    const { Royale } = await import('edgefall-wasm');
    const r = new Royale(6, 7);
    const rounds: number[][] = [];
    while (r.placement().length === 0) {
      r.resolve(new Int32Array());
      rounds.push([]);
    }
    (window as unknown as { __royale(f: { seed: number; rounds: number[][] }): void }).__royale({ seed: 7, rounds });
    expect(byId('hud').querySelector('.rank-delta')?.textContent).toMatch(/^[+-]\d+ Elo$/);
    expect(JSON.parse(localStorage.getItem('ab-alone.ranked')!).matches[0].mode).toBe('royale');
  });

  it('a finished royale game is rated once, however often Ranked is pressed after it', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('battle-royale').click();
    declineBoard();
    byId('ranked').click();
    const { Royale } = await import('edgefall-wasm');
    const r = new Royale(6, 7);
    const rounds: number[][] = [];
    while (r.placement().length === 0) {
      r.resolve(new Int32Array());
      rounds.push([]);
    }
    (window as unknown as { __royale(f: { seed: number; rounds: number[][] }): void }).__royale({ seed: 7, rounds });
    for (let i = 0; i < 3; i++) {
      byId('ranked').click();
    }
    expect(JSON.parse(localStorage.getItem('ab-alone.ranked')!).matches).toHaveLength(1);
  });
});

describe('Rematch', () => {
  it('appears once the game is over, waits for the opponent, then starts a new game, colours swapped', async () => {
    const { game, white } = await hosted();
    const rematch = byId<HTMLButtonElement>('rematch');
    expect(rematch.hidden).toBe(true); // the game runs
    // One marble each, there and back twice: the start position a third time, a draw by threefold repetition.
    const there: Axial[][] = [[[0, 2], [0, 1]], [[0, -2], [0, -1]], [[0, 1], [0, 2]], [[0, -1], [0, -2]]];
    for (let ply = 0; ply < 8; ply += 2) {
      const [mine, theirs] = [there[ply % 4]!, there[(ply + 1) % 4]!];
      click(game, mine[0]!, mine[1]!);
      await until(game, () => white.session.signedLog.length === ply + 1);
      await white.play(theirs[0]!, theirs[1]!);
      // The engine has White's move before the page logged it and refreshed the HUD: wait for the HUD (#952).
      await until(game, () => game.hook('__plies') === ply + 2 && game.turn() !== 'White to move');
      game.frame(5000);
    }
    expect(game.turn()).toBe('Draw');
    expect(rematch.hidden).toBe(false);
    expect(rematch.disabled).toBe(false);

    rematch.click();
    await until(game, () => rematch.disabled);
    expect(game.hud()).toContain('You asked for a rematch. Waiting for White...');
    expect(presence()).toBe('You are Black. White is here.'); // nothing starts on one ask

    await white.session.rematch();
    await until(game, () => data().online === 'White');
    expect(presence()).toBe('You are White. Black is here.');
    expect(game.hook('__plies')).toBe(0);
    expect(game.turn()).toBe('Black to move');
    expect(rematch.hidden).toBe(true);
    expect(document.querySelector('#hud .rematch')).toBeNull();
  });
});

describe('The invite link', () => {
  it('joins as White, is seated by the creator once open, follows its coordinator and sees it leave', async () => {
    const timers: (() => void)[] = [];
    const later = setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
      ms === SIGNALING_TIMEOUT_MS ? timers.push(fn) : later(fn, ms)) as typeof setTimeout);
    clipboard(async () => {});
    const game = await boot('?net=hook#room=the-room');
    expect(game.room()).toBeNull(); // no Trystero room
    await until(game, () => data().seat === 'pending');
    expect(data().online).toBe('White');
    expect(presence()).toBe('Joining as White...');

    // The joiner gives up waiting for the signaling server after a while: the diagnostics say so.
    expect(timers).toHaveLength(1);
    game.frame(SIGNALING_TIMEOUT_MS);
    timers[0]!();

    const end = hookEnd();
    const black = await opponent(end, 'the-room', 1);
    (window as unknown as Record<string, () => void>).__netOpen!();
    await until(game, () => data().seat === 'player' && data().opponent === 'here');
    expect(presence()).toBe('You are White. Black is here.');
    expect(game.hud()).toContain(' · open');
    expect(black.session.seats.roster()).toHaveLength(2);

    // The creator announces itself as coordinator: we follow it and acknowledge.
    end.send(await signCoordinator(black.keys, { game: 'the-room', coordinator: black.keys.pub }));
    await until(game, () => data().handover === 'done');
    expect(data().coordinator).toBe('1');

    end.leave();
    await until(game, () => data().opponent === 'gone');
    expect(presence()).toBe('You are White. Black is disconnected.');

    byId('copy-diagnostics').click();
    await until(game, () => calls() > 0);
    expect(JSON.parse(copied()).events).toContainEqual(
      expect.objectContaining({ event: 'net', data: { failure: 'signaling-timeout' } }),
    );
  });

  it('watches as a spectator when the room is full', async () => {
    const game = await boot('?net=hook#room=full-room');
    await until(game, () => data().seat === 'pending');
    const [creator, other] = [await generateKeys(), await generateKeys()];
    const hello = await signHello(creator, { game: 'full-room', seat: 1, roster: [creator.pub, other.pub], engine: (await import('edgefall-wasm')).engine_version() });
    (window as unknown as Record<string, (m: Wire, peer: string) => void>).__netIn!(hello, 'creator');
    await until(game, () => data().seat === 'spectator');
    expect(data().online).toBe('Spectator');
    expect(presence()).toBe('Room is full, watching');
  });

  it("reports Trystero's join errors in the diagnostics", async () => {
    clipboard(async () => {});
    const game = await boot('?bot=off');
    const p2p = await import('./p2p');
    const transport = vi.spyOn(p2p, 'p2pTransport');
    byId('play-online').click();
    transport.mock.calls[0]![1]!('ICE failed');
    byId('copy-diagnostics').click();
    await until(game, () => calls() > 0);
    expect(JSON.parse(copied()).events).toContainEqual(
      expect.objectContaining({ event: 'net', data: { failure: 'join-error', message: 'ICE failed' } }),
    );
  });
});

describe('Copy on the invite link (#839)', () => {
  /** Boots, presses Play online and waits for the room: the link, its label and Copy show. */
  async function invited() {
    const game = await boot('?bot=off');
    byId('play-online').click();
    await until(game, () => data().seat === 'player'); // the room is open before the test ends
    return game;
  }
  const shown = (): boolean[] => ['invite-label', 'invite', 'invite-copy'].map((id) => !byId(id).hidden);

  it('shows with the link and its label, and Copy is a button named Copy', async () => {
    await invited();
    expect(shown()).toEqual([true, true, true]);
    expect(byId('invite-copy').textContent).toBe('Copy');
    expect(byId('invite-copy').tagName).toBe('BUTTON');
  });

  it('writes the link to the clipboard, then closes the link, its label and Copy', async () => {
    clipboard(async () => {});
    const game = await invited();
    const link = byId<HTMLInputElement>('invite').value;
    byId('invite-copy').click();
    await until(game, () => byId('invite').hidden === true);
    expect(calls()).toBe(1);
    expect(copied()).toBe(link);
    expect(link).toContain(`#room=${game.room()}`);
    expect(shown()).toEqual([false, false, false]);
  });

  it('says the link was copied and gives the focus to the cog (#1190)', async () => {
    clipboard(async () => {});
    const game = await invited();
    byId('invite-copy').focus();
    byId('invite-copy').click();
    await until(game, () => byId('invite').hidden === true);
    expect(game.hud()).toContain('invite link copied');
    expect(document.activeElement).toBe(byId('settings'));
  });

  it('keeps the link shown, selected, when the browser refuses the clipboard', async () => {
    clipboard(async () => {
      throw new Error('denied');
    });
    const game = await invited();
    const link = byId<HTMLInputElement>('invite');
    byId('invite-copy').click();
    await until(game, () => game.hud().includes('invite link selected'));
    expect(shown()).toEqual([true, true, true]);
    expect(document.activeElement).toBe(link);
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
  });

  it('keeps the link shown when the page has no clipboard at all', async () => {
    const game = await invited();
    byId('invite-copy').click();
    await until(game, () => game.hud().includes('invite link selected'));
    expect(shown()).toEqual([true, true, true]);
  });

  it('closes with the room, and shows again with the next one', async () => {
    const game = await invited();
    byId('ship').click(); // Back to the hub
    expect(shown()).toEqual([false, false, false]);
    byId('play-online').click();
    await until(game, () => data().seat === 'player');
    expect(shown()).toEqual([true, true, true]);
  });
});

describe('Connectivity', () => {
  it('disables Play online with a HUD notice while the browser is offline, and enables it back online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const game = await boot('?bot=off');
    const button = byId<HTMLButtonElement>('play-online');
    expect(button.disabled).toBe(true);
    expect(game.hud()).toContain('online play needs a connection');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect(button.disabled).toBe(false);
    expect(game.hud()).not.toContain('online play needs a connection');
  });

  it('keeps an online game its own status when the connection drops', async () => {
    const { game } = await hosted();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect(byId<HTMLButtonElement>('play-online').disabled).toBe(true);
    expect(game.hud()).not.toContain('online play needs a connection');
    expect(presence()).toBe('You are Black. White is here.');
  });
});

describe('Copy diagnostics', () => {
  it('copies the events, the build and the game to the clipboard', async () => {
    clipboard(async () => {});
    const game = await boot('?bot=off');
    byId('copy-diagnostics').click();
    await until(game, () => game.hud().includes(' · diagnostics copied'));
    expect(byId('diagnostics').hidden).toBe(true);
    const text = JSON.parse(copied());
    expect(text).toMatchObject({ app: 'ab-alone', build: expect.stringMatching(/^(dev|[0-9a-f]{12})$/), environment: { mode: 'test', fps: null } });
    expect(text.game.mode).toBe('local');
    expect(text.game.online).toBeUndefined();
  });

  it('copies the online game and the frame rate once the FPS switch is on', async () => {
    clipboard(async () => {});
    const { game } = await hosted();
    byId('setting-fps').click();
    game.frame();
    byId('copy-diagnostics').click();
    await until(game, () => game.hud().includes(' · diagnostics copied'));
    const text = JSON.parse(copied());
    expect(text.environment.fps).toEqual(expect.any(Number));
    expect(text.game.online).toMatchObject({ game: game.room(), side: 1, role: 'player' });
    expect(text.events).toContainEqual(expect.objectContaining({ event: 'net', data: { state: 'connecting' } }));
  });

  it('selects the text in a box to copy by hand when the browser refuses, and hides it on blur', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    const game = await boot('?bot=off');
    const box = byId<HTMLTextAreaElement>('diagnostics');
    byId('copy-diagnostics').click();
    await until(game, () => game.hud().includes(' · diagnostics selected: copy them by hand'));
    expect(box.hidden).toBe(false);
    expect(JSON.parse(box.value).app).toBe('ab-alone');
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    expect(box.scrollTop).toBe(0);
    box.blur();
    expect(box.hidden).toBe(true);
  });

  it('keeps the start of the diagnostics in view in a browser that scrolls to the end of a selection after select() returns (Firefox)', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    const game = await boot('?bot=off');
    const box = byId<HTMLTextAreaElement>('diagnostics');
    const select = box.select.bind(box);
    box.select = () => {
      select();
      setTimeout(() => (box.scrollTop = 508), 0); // the late scroll
    };
    byId('copy-diagnostics').click();
    await until(game, () => game.hud().includes(' · diagnostics selected: copy them by hand'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(box.scrollTop).toBe(0);
  });
});

describe('The service worker', () => {
  const reload = vi.fn();
  // The page's intervals, kept by their period and run by hand: the stub comes after boot, before the registration answers.
  const ticks = new Map<unknown, () => void>();
  const holdIntervals = (): void => {
    vi.stubGlobal('setInterval', (fn: () => void, ms: number) => {
      ticks.set(ms, fn);
      return ms;
    });
    vi.stubGlobal('clearInterval', (id: unknown) => void ticks.delete(id));
  };
  const typingIn = document.createElement('input');
  const visibility = (state: string): void => void Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  beforeEach(() => {
    reload.mockReset();
    const real = window.location;
    vi.stubGlobal(
      'location',
      new Proxy({} as Location, {
        get: (_, key) => {
          if (key === 'reload') return reload;
          const value = Reflect.get(real, key, real);
          return typeof value === 'function' ? value.bind(real) : value;
        },
      }),
    );
    sessionStorage.clear();
    typingIn.type = 'text';
    ticks.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    visibility('visible');
    typingIn.remove();
  });
  function worker(controller: object | null, register: () => Promise<{ update(): Promise<void> | void }>) {
    const listeners: Record<string, () => void> = {};
    const addEventListener = (type: string, fn: () => void): void => void (listeners[type] = fn);
    const sw = { controller, register: vi.fn(register), addEventListener };
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
    vi.stubEnv('PROD', true);
    return { sw, change: () => listeners.controllerchange!() };
  }

  it('is registered on a first visit, and taking control then offers no reload', async () => {
    const update = vi.fn(async () => {});
    const { sw, change } = worker(null, async () => ({ update }));
    const game = await boot('?bot=off');
    await game.settle();
    expect(sw.register).toHaveBeenCalledWith('/sw.js');
    expect(update).not.toHaveBeenCalled();
    change();
    expect(byId('update-banner').hidden).toBe(true);
  });

  /** A later visit: the registration answers once the test holds the intervals. */
  async function laterVisit(update: () => Promise<void>) {
    let answer!: () => void;
    const { change } = worker({}, () => new Promise((done) => (answer = () => done({ update }))));
    const game = await boot('?bot=off');
    holdIntervals();
    document.body.append(typingIn);
    answer();
    await new Promise((done) => setTimeout(done));
    return { change, game };
  }

  it('checks for a new build on a later visit, and offers the reload when one takes over', async () => {
    const update = vi.fn(async () => {});
    const { change } = await laterVisit(update);
    expect(update).toHaveBeenCalledOnce();
    typingIn.focus(); // a field in use is at stake: the banner shows and the reload waits
    change();
    expect(byId('update-banner').hidden).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    ticks.get(1000)!();
    expect(reload).not.toHaveBeenCalled();
    typingIn.blur();
    ticks.get(1000)!();
    expect(reload).toHaveBeenCalledOnce();
    expect(ticks.has(1000)).toBe(false); // the wait ended
  });

  it('reloads at once when nothing is at stake, once per build', async () => {
    const { change } = await laterVisit(async () => {});
    change();
    expect(reload).toHaveBeenCalledOnce();
    change();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload a page that is still starting', async () => {
    let change = (): void => {};
    ({ change } = worker({}, () => {
      change(); // the new build takes over before the start has ended
      return Promise.resolve({ update: async () => {} });
    }));
    const game = await boot('?bot=off');
    await game.settle();
    expect(byId('update-banner').hidden).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the banner alone when the storage fails', async () => {
    const { change } = await laterVisit(async () => {});
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    change();
    expect(byId('update-banner').hidden).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('checks again when the tab comes back and every 15 minutes, and goes on when offline', async () => {
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    await laterVisit(update);
    update.mockClear();
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).not.toHaveBeenCalled();
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(update).toHaveBeenCalledOnce();
    ticks.get(15 * 60_000)!();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('lets the game go on when the registration is refused', async () => {
    const { sw } = worker(null, () => Promise.reject(new Error('blocked')));
    const game = await boot('?bot=off');
    await game.settle();
    expect(sw.register).toHaveBeenCalledOnce();
    expect(game.turn()).toBe('Black to move');
  });
});

// The cues of an online game (#1570, world.md section 7): the page reports each cue it played as `__cues`.
describe('the cues of an online game (#1570)', () => {
  const cues = (game: Game): string[] => game.hook<string[]>('__cues');
  const count = (game: Game, event: string): number => cues(game).filter((c) => c === event).length;

  it('the opponent joining sounds once, not on each redraw of the status', async () => {
    const { game } = await hosted('?bot=off', { audio: true });
    expect(count(game, 'online-join')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(count(game, 'online-join')).toBe(1);
  });

  it('the turn coming back after the opponent moved sounds once, not for the own move', async () => {
    const { game, white } = await hosted('?bot=off', { audio: true });
    click(game, [0, 2], [0, 1]);
    await until(game, () => white.session.signedLog.length === 1);
    expect(count(game, 'turn-start')).toBe(0);
    await white.play([0, -2], [0, -1]);
    await until(game, () => game.hook('__plies') === 2 && count(game, 'turn-start') === 1); // the cue follows the move
    await game.settle();
    expect(count(game, 'turn-start')).toBe(1); // and stays one
  });
});
