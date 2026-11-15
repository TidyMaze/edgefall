// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog } from './royale';
import { generateKeys, type Wire } from './moverecord';
import { parseRoyale, ROOM_JUDGE, RoyaleNet, seedOf } from './royale-net';
import { OnlineSession } from './session';
import { boot, type Game } from './test/harness';
import type { Transport } from './transport';

// The online battle royale on the harness (#504, docs/specs/tech.md section 6): Invite, in an offline battle royale,
// opens a room of 6 seats with its invite link, the creator starts the game, each round a target press or Hold commits the order and the
// round resolves on every peer once each seat revealed or the deadline passed. The other player is a real session and
// RoyaleNet on the other end of the room, with its own engine. Date is frozen in this file: a round deadline passes only
// when a test moves it on, so a loaded machine never lets one pass between two steps (#705).

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => byId<HTMLButtonElement>(id);
const data = (): DOMStringMap => document.body.dataset;
const presence = (): string => document.querySelector('#hud .presence')?.textContent ?? '';
const items = (selector: string): string[] => [...byId('hud').querySelectorAll(selector)].map((li) => li.textContent!);

/** Settles until `ok` holds: signatures are checked on the real Web Crypto, and the deadlines tick every 100 ms. */
async function until(game: Game, ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await game.settle();
  expect(ok()).toBe(true);
}

/** The other player: a session of the room's 6 seats and its rounds, with its own engine, on `transport`. */
async function player(transport: Transport, room: string, side: number) {
  const { Royale, engine_version } = await import('edgefall-wasm');
  const keys = await generateKeys();
  const royale = new Royale(6, seedOf(room));
  const session: OnlineSession = new OnlineSession({
    game: room,
    side,
    seatCount: 6,
    engine: engine_version(),
    keys,
    transport,
    judge: ROOM_JUDGE,
    onMove: () => {},
    onRefuse: () => {},
    beat: { ms: 5000, now: Date.now, every: () => {} }, // the join order: who coordinates
    onOther: (m, key, peer) => {
      const message = parseRoyale(m);
      if (message) return net.receive(message, key, peer);
    },
  });
  const net: RoyaleNet<InstanceType<typeof Royale>> = new RoyaleNet({
    game: room,
    keys,
    royale,
    roundMs: 60_000,
    now: Date.now,
    connected: () => true,
    send: (m, to) => transport.send(m, to),
    coordinator: () => session.coordinator,
    roster: () => session.seats.roster(),
  });
  return { session, net, royale, transport };
}

/** The other end of the hook transport (?net=hook): what the page sends to `__netOut`, what it gets on `__netIn`. */
function hookEnd(heard: Wire[] = []): Transport {
  const w = window as unknown as Record<string, (...args: unknown[]) => void>;
  return {
    state: 'open',
    send: (message) => w.__netIn!(message, 'host'),
    onRecord: (cb) =>
      (w.__netOut = (message) => {
        heard.push(message as Wire);
        cb(message as Wire, 'page');
      }),
    onState: () => {},
    onLeave: () => {},
    close: () => {},
  };
}

/** Starts a battle royale from the mode menu and presses Invite. */
function invite(game: Game): void {
  button('battle-royale').click();
  button('royale-invite').click();
}

/** Boots and opens a room; a second player joins once the page's session exists. */
async function hosted(url = '?bot=off', reducedMotion = true) {
  const game = await boot(url, { reducedMotion });
  invite(game);
  await until(game, () => data().seat === 'player');
  const other = await player(game.peer()!, game.room()!, 2);
  await until(game, () => presence().startsWith('2 players in'));
  return { game, other };
}

/** The creator starts, and both are in round 1. */
async function started(url?: string, reducedMotion?: boolean) {
  const { game, other } = await hosted(url, reducedMotion);
  button('royale-start').click();
  await until(game, () => data().net === 'choosing' && other.net.phase === 'choosing');
  return { game, other };
}

describe('Battle royale online (#504)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('Invite scrolls the button column back to the top, so no button above the link is left out of reach (#839)', async () => {
    const game = await boot('?bot=off');
    button('battle-royale').click();
    byId('online').scrollTop = 40;
    button('royale-invite').click();
    await until(game, () => data().seat === 'player'); // the link shows once the keys are made
    expect(byId('online').scrollTop).toBe(0);
  });

  it('Invite opens a room of 6 seats: its invite link, the arena in the lobby, Start for the creator alone', async () => {
    const game = await boot('?bot=off');
    button('battle-royale').click();
    expect(button('royale-invite').hidden).toBe(false); // in the offline game
    button('royale-invite').click();
    await until(game, () => data().seat === 'player'); // once its keys are made, the page is in the room
    const room = game.room()!;
    expect(location.hash).toMatch(new RegExp(`^#royale=${room}&key=[\\w-]{8}$`)); // the creator key's fingerprint (#1323)
    expect(new URL(byId<HTMLInputElement>('invite').value).hash).toBe(location.hash);
    expect(byId('invite').hidden).toBe(false);
    expect(byId('invite-label').textContent).toBe('Invite link: send it to the other players');
    expect(byId('invite-copy').hidden).toBe(false); // Copy closes the link (#839)
    expect(data().online).toBe('royale');
    expect(data().royale).toBe('1');
    expect(data().net).toBe('lobby');
    expect(game.turn()).toBe('Battle royale · Round 1');
    expect(presence()).toBe('1 player in. Start: bots take the empty seats');
    expect(items('.initiative li')).toEqual(['You', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'Bot 6']);
    expect(button('royale-start').hidden).toBe(false);
    expect(button('royale-hold').disabled).toBe(true);
    expect(button('royale-invite').hidden).toBe(true); // in the room already
    game.click(-4, 8); // no order before the start
    expect(game.hook('__rings')).toEqual([]);
    expect(game.hook('__targets')).toEqual([]);
    for (const [type, [q, r]] of [['pointerdown', [-4, 8]], ['pointermove', [-4, 7]]] as const) {
      const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', q, r);
      document.querySelector('canvas')!.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
    }
    expect(game.hook('__rings')).toEqual([]); // nor by a drag (#1646)
    await player(game.peer()!, room, 2);
    await until(game, () => presence() === '2 players in. Start: bots take the empty seats');
    expect(items('.initiative li')[1]).toBe('Player 2');
  });

  it('Start opens round 1; a target press locks our order, the round resolves once the other player commits', async () => {
    const { game, other } = await started();
    expect(button('royale-start').hidden).toBe(true);
    expect(presence()).toBe('Your order: a move or Hold');
    game.click(-2, 6);
    game.click(-2, 5); // (-2, 6) NW: the order is committed, not played yet
    await until(game, () => data().net === 'locked');
    expect(presence()).toBe('Order locked, waiting for the others...');
    expect(button('royale-hold').disabled).toBe(true);
    expect(data().royale).toBe('1');
    await other.net.play([]);
    await until(game, () => data().royale === '2');
    expect(items('.reveal li').slice(0, 2)).toEqual(['You: moved', 'Player 2: held']);
    await until(game, () => other.royale.state_hash() !== '' && data().desync === '0' && other.net.round === 2);
    expect(other.net.desync).toBe(0);
    expect(game.hook('__rings')).toEqual([]);
  });

  it('the second page takes round 1 the same: seat 1 moved, seat 2 held, and its board is the first page\'s (#1481)', async () => {
    // The second page is a session with its own engine: a second DOM page cannot share this window. Its reveal is read from
    // its round log, the same log the page's reveal is built from (main.ts parseLog(game.round_log())).
    const { game, other } = await started();
    game.click(-2, 6);
    game.click(-2, 5);
    await until(game, () => data().net === 'locked');
    await other.net.play([]);
    await until(game, () => data().royale === '2');
    await until(game, () => other.net.round === 2 && data().desync === '0');
    const turns = parseLog(other.royale.round_log())!.turns.sort((x, y) => x.seat - y.seat);
    expect(turns.slice(0, 2).map((t) => t.outcome)).toEqual(['moved', 'held']);
    expect(other.royale.state_hash()).not.toBe('');
    expect(other.net.desync).toBe(0);
  });

  it('Hold commits a hold, a silent player holds at the deadline, and the round plays out on the arena', async () => {
    const { game } = await started('?bot=off&round=300', false);
    button('royale-hold').click();
    await until(game, () => data().net === 'locked');
    vi.advanceTimersByTime(300); // the other player said nothing: the deadline passes
    await until(game, () => data().royale === '2');
    expect(data().reveal).toBe('turn');
    game.frame(10_000);
    expect(data().reveal).toBe('done');
    expect(items('.reveal li').slice(0, 2)).toEqual(['You: held', 'Player 2: held']);
  });

  it('counts the order deadline down on the plate, from each round start (#673)', async () => {
    const deadline = (): string => document.querySelector('#hud .presence + .deadline')?.textContent ?? '';
    const lobby = await hosted('?bot=off&round=1500');
    expect(deadline()).toBe(''); // no round yet
    button('royale-start').click();
    await until(lobby.game, () => data().net === 'choosing');
    expect(deadline()).toBe('Order deadline: 2 s');
    await new Promise((done) => setTimeout(done, 250)); // real ticks of the 100 ms interval on an unchanged second: no redraw
    vi.advanceTimersByTime(600);
    await until(lobby.game, () => deadline() === 'Order deadline: 1 s'); // redrawn as the seconds pass
    expect(byId('hud').querySelector('.deadline')!.className).toBe('deadline short');
    vi.advanceTimersByTime(900);
    await until(lobby.game, () => data().royale === '2'); // nobody committed: round 1 resolves at its deadline
    expect(deadline()).toBe('Order deadline: 2 s'); // and counts again from round 2's start
  });

  it('an invite link takes the first free seat, waits for the start, and reports a desync', async () => {
    const room = 'abc_DEF-123';
    const game = await boot(`?bot=off&net=hook#royale=${room}`);
    await game.online();
    expect(data().seat).toBe('pending');
    const heard: Wire[] = [];
    const host = await player(hookEnd(heard), room, 1);
    const netOpen = (window as unknown as Record<string, () => void>).__netOpen!;
    netOpen();
    await until(game, () => data().seat === 'player');
    expect(presence()).toBe('2 players in. Waiting for the start...');
    expect(button('royale-start').hidden).toBe(true);
    expect(items('.initiative li').slice(0, 2)).toEqual(['Player 1', 'You']);
    await host.net.start();
    await until(game, () => data().net === 'choosing');
    host.transport.send({ kind: 'start', game: room } as unknown as Wire); // malformed: ignored
    host.transport.send({ kind: 'hello' } as unknown as Wire); // refused, for the diagnostics
    await host.net.play([]);
    button('royale-hold').click();
    await until(game, () => data().royale === '2');
    host.transport.send({ kind: 'hash', game: room, round: 1, hash: 'not ours' });
    await until(game, () => data().desync === '1');
    expect(presence()).toBe("Desync after round 1: a peer's game differs");
    netOpen(); // the connection is back after a drop: the page asks for the rounds it may have missed
    await until(game, () => heard.some((m) => (m as { kind?: string }).kind === 'behind'));
  });

  it('Play online leaves the room: closed, no round, no Start; the round on its way is not resolved', async () => {
    const { game, other } = await started();
    const old = game.peer()!;
    button('royale-hold').click();
    await until(game, () => data().net === 'locked');
    await other.net.play([]); // its commit and reveal are on their way to the page
    byId('play-online').click();
    await game.settle();
    expect(old.state).toBe('closed');
    expect(data().net).toBeUndefined();
    expect(data().royale).toBeUndefined();
    expect(button('royale-start').hidden).toBe(true);
    expect(button('royale-hold').hidden).toBe(true);
    expect(button('royale-invite').hidden).toBe(true);
    await until(game, () => data().online === 'Black');
  });
});
