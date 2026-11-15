// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { encodeMove, parseMoves, type Axial, type Move } from './board';
import { resetView, type View } from './camera';
import { seatAfter } from './coop';
import { bossSeatFromHash, coopFromHash } from './invite';
import { generateKeys } from './moverecord';
import { BOSS_IDS } from './tally';
import { OnlineSession } from './session';
import { boot, type Game } from './test/harness';
import type { Wire } from './moverecord';
import type { Transport } from './transport';

// Co-op boss fights online on the harness (docs/specs/coop-boss.md, #529): the encounter is the judge of the room.
// Every page plays the boss reply to each human move itself, before it handles the next message. The partner is a
// real OnlineSession on the other end of the room, with its own encounter. The creator opens the room with Fight
// together in the mode menu (#530), the partner joins with the co-op invite link.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const calm = { reducedMotion: true }; // no slide: the boss reply never waits for one
const ECHO = { boss: 'echo', seed: 7 };

/** Settles until `ok` holds: signatures are checked on the real Web Crypto, which takes a few tasks. */
async function until(game: Game, ok: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ok(); i++) await game.settle();
  expect(ok()).toBe(true);
}

/** The first legal one-marble move forward (NE or NW for Black at the bottom) in `moves`. */
const forward = (moves: Move[]): Move => moves.find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;

/** Plays `mv` on the page by its two clicks: its marble, then the cell it goes to. */
function play(game: Game, mv: Move): void {
  const [q, r] = mv.cells[0]!;
  const [dq, dr] = ([[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]] as Axial[])[mv.dir]!;
  game.click(q, r);
  game.click(q + dq, r + dr);
}

/** The partner: a session on `transport` with its own encounter, which plays the boss reply to every human move at
 * once, as every peer does. `fight` is the boss and seed it believes the room has, and a Retry restarts it. */
async function partner(transport: Transport, room: string, side: number, fight = ECHO) {
  const { Encounter, engine_version } = await import('edgefall-wasm');
  let encounter = new Encounter(fight.boss, fight.seed);
  const history: number[][] = [];
  const apply = (mv: ArrayLike<number>): void => {
    encounter.play(Int32Array.from(mv));
    history.push(Array.from(mv));
  };
  const human = (mv: ArrayLike<number>): void => {
    apply(mv);
    if (encounter.status() === 0 && encounter.to_move() === 2) apply(encounter.boss_move()); // none after a free move (#958)
  };
  const session = new OnlineSession({
    game: room,
    side,
    engine: engine_version(),
    keys: await generateKeys(),
    transport,
    judge: {
      to_move: () => encounter.to_move(),
      play: human,
      status: () => encounter.status(),
      restart: () => {
        encounter = new Encounter(fight.boss, fight.seed);
        history.length = 0;
      },
      mover: () => seatAfter(history.length - encounter.free_taken(), 2),
    },
    onMove: () => {},
    onRefuse: () => {},
  });
  const send = async (record: number[]): Promise<void> => {
    human(record);
    await session.send(record);
  };
  return { session, history, legal: () => parseMoves(encounter.legal_moves()), send };
}

/** The page as a joiner on `?net=hook`, and the other end of its hook transport: the partner made on that end is the
 * creator, and the page's Hello goes out only once `open` runs, after the partner listens (as in main.online.test.ts). */
async function invited(hash: string) {
  const game = await boot(`?bot=off&net=hook${hash}`, calm);
  const w = window as unknown as Record<string, (...args: unknown[]) => void>;
  await until(game, () => typeof w.__netIn === 'function'); // the hook transport comes up with the room: a slow page has none yet when the partner greets (#1608)
  const end: Transport & { leave(): void } = {
    state: 'open',
    send: (message) => w.__netIn!(message, 'creator'),
    onRecord: (cb) => (w.__netOut = (message) => cb(message as Wire, 'page')),
    onState: () => {},
    onLeave: () => {},
    close: () => {},
    leave: () => w.__netLeave!('creator'),
  };
  return { game, end, open: () => w.__netOpen!() };
}

/** Presses Fight together in the mode menu, then the boss called `name` in the list it opens. */
function fightTogether(game: Game, name: string): void {
  byId('fight-together').click();
  [...byId('coop-list').querySelectorAll('button')].find((b) => b.textContent === name)!.click();
}

/** The status line of the online room under the turn line. */
const presence = (): string => document.querySelector('#hud .presence')?.textContent ?? '';

/** Opens a co-op room against The Echo with Fight together and seats the partner once the page's session exists. The
 * partner reads the boss and the seed from the invite link, as a joiner does. */
async function hosted(storage: Record<string, string> = {}) {
  const game = await boot('?bot=off', { ...calm, storage });
  fightTogether(game, 'The Echo');
  await until(game, () => data().seat === 'player');
  const two = await partner(game.peer()!, game.room()!, 2, coopFromHash(location.hash)!);
  await until(game, () => data().opponent === 'here');
  return { game, two };
}

describe('co-op: the encounter judges the room', () => {
  it('Fight together lists the bosses, and picking one opens a co-op room: the invite carries the boss and a random seed', async () => {
    const game = await boot('?bot=off', calm);
    const button = byId('fight-together');
    const list = byId('coop-list');
    expect(list.hidden).toBe(true);
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toHaveLength(BOSS_IDS.length); // every boss of the roster
    button.click();
    expect(list.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    [...list.querySelectorAll('button')].find((b) => b.textContent === 'The Echo')!.click();
    expect(list.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await until(game, () => data().seat === 'player'); // the link shows once the keys are made: it carries their fingerprint (#1323)
    const room = game.room()!;
    expect(location.hash).toMatch(new RegExp(`^#room=${room}&boss=echo&seed=(0|[1-9]\\d*)&key=[\\w-]{8}$`));
    expect(new URL(byId<HTMLInputElement>('invite').value).hash).toBe(location.hash);
    expect(byId('invite').hidden).toBe(false);
    expect(byId('invite-label').textContent).toBe('Invite link: send it to your partner');
    expect(game.hook('__fight')).toEqual({ id: 'echo', seed: coopFromHash(location.hash)!.seed });
    expect(data().online).toBe('Black');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Echo');
    expect(presence()).toBe('Waiting for a partner...');
    expect(game.hud()).toContain('Mirror logged.'); // Tally's line of the boss, as in solo, without the name (#1038)
    byId('play-online').click(); // a versus room after it: the label is the versus one again
    await until(game, () => byId('invite-label').textContent === 'Invite link: send it to your opponent');
    expect(byId('rematch').textContent).toBe('Rematch'); // and its button, Retry in co-op (#531)
    expect(byId('rematch').getAttribute('aria-label')).toBe('Rematch');
    expect(byId('rematch').dataset.label).toBe('Rematch');
  });

  it('a co-op boss shows its rating at its own budget, not scaled by the difficulty setting (#1611)', async () => {
    await hosted({ 'ab-alone.difficulty': 'hard' });
    expect(document.querySelector('#hud .bot-rating')?.textContent).toBe('Boss ~1000 · Easy'); // The Echo, 100 positions
  });

  it('disables Fight together while the browser is offline, as Play online, and enables it back online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await boot('?bot=off', calm);
    expect(byId<HTMLButtonElement>('fight-together').disabled).toBe(true);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect(byId<HTMLButtonElement>('fight-together').disabled).toBe(false);
    Reflect.deleteProperty(navigator, 'onLine');
  });

  it("says Your turn or Partner's turn on the human plies, the boss turn as in solo, and names the partner", async () => {
    const { game, two } = await hosted();
    expect(game.turn()).toBe('Your turn');
    expect(presence()).toBe('Your partner is here.');
    const held: (() => void)[] = [];
    const post = Worker.prototype.postMessage;
    const spy = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, req) {
      held.push(() => post.call(this, req));
    });
    play(game, forward(game.hook('__legal')));
    await until(game, () => held.length === 1);
    expect(game.turn()).toBe('White to move'); // the boss reply is being computed
    spy.mockRestore();
    held.pop()!();
    await until(game, () => game.hook('__plies') === 2 && two.history.length === 2); // the partner heard our move: its turn starts there
    expect(game.turn()).toBe("Partner's turn");
    await two.send(encodeMove(forward(two.legal())));
    await until(game, () => game.hook('__plies') === 4);
    expect(game.turn()).toBe('Your turn');
  });

  it('plays the boss reply to our move at once, then the partner plays its ply and gets its own reply', async () => {
    const { game, two } = await hosted();
    play(game, forward(game.hook('__legal')));
    await until(game, () => game.hook('__plies') === 2 && two.history.length === 2);
    expect(game.hook('__history')).toEqual(two.history);
    await two.send(encodeMove(forward(two.legal())));
    await until(game, () => game.hook('__plies') === 4);
    expect(game.hook('__history')).toEqual(two.history);
    expect(game.hud()).not.toContain('refused');
  });

  it("does nothing on a click during the partner's ply: no selection, no note", async () => {
    const { game, two } = await hosted();
    play(game, forward(game.hook('__legal')));
    await until(game, () => game.hook('__plies') === 2 && two.history.length === 2);
    const [q, r] = forward(game.hook('__legal')).cells[0]!;
    game.click(q, r);
    expect(game.hook('__rings')).toEqual([]);
    expect(game.hud()).not.toContain('waiting for opponent');
  });

  it("holds the partner's move that comes while our boss reply is still being computed, then plays both in order", async () => {
    const { game, two } = await hosted();
    const held: (() => void)[] = [];
    const post = Worker.prototype.postMessage;
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, req) {
      held.push(() => post.call(this, req));
    });
    play(game, forward(game.hook('__legal')));
    await until(game, () => two.history.length === 2 && held.length === 1); // the partner has the reply, we do not yet
    await two.send(encodeMove(forward(two.legal())));
    for (let i = 0; i < 5; i++) await game.settle();
    expect(game.hook('__plies')).toBe(1); // the partner's move waits behind our reply
    expect(game.hud()).not.toContain('refused');
    await until(game, () => {
      for (const reply of held.splice(0)) reply();
      return game.hook('__plies') === 4;
    });
    expect(game.hook('__history')).toEqual(two.history);
  });

  it('refuses the move of a partner whose engine disagrees, and the fight waits for that partner', async () => {
    const { game, end, open } = await invited('#room=R0&boss=overseer&seed=7');
    const one = await partner(end, 'R0', 1, { boss: 'echo', seed: 7 }); // its link was edited by hand: another board
    open();
    await until(game, () => data().seat === 'player' && data().opponent === 'here');
    const ours = game.hook<Move[]>('__legal').map((m) => encodeMove(m).join());
    await one.send(encodeMove(one.legal().find((m) => !ours.includes(encodeMove(m).join()))!));
    await until(game, () => game.hud().includes(' · refused move: illegal'));
    expect(game.hook('__plies')).toBe(0);
    const [q, r] = forward(game.hook('__legal')).cells[0]!;
    game.click(q, r);
    expect(game.hook('__rings')).toEqual([]); // still the partner's ply
  });

  it('asks no boss reply after a human move that ends the fight', async () => {
    const { game } = await hosted({ 'ab-alone.difficulty': 'normal' });
    const { Encounter } = await import('edgefall-wasm');
    const { play: played, status } = Encounter.prototype;
    let over = false;
    vi.spyOn(Encounter.prototype, 'play').mockImplementation(function (this: InstanceType<typeof Encounter>, mv) {
      played.call(this, mv);
      over = true; // as the last ejection would
    });
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(function (this: InstanceType<typeof Encounter>) {
      return over ? 1 : status.call(this);
    });
    const post = vi.spyOn(Worker.prototype, 'postMessage');
    play(game, forward(game.hook('__legal')));
    for (let i = 0; i < 5; i++) await game.settle();
    expect(game.hook('__plies')).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('co-op: the invite link', () => {
  it('joins the fight as the second seat: the creator plays first, then us, each move followed by its boss reply', async () => {
    const { game, end, open } = await invited('#room=R0&boss=echo&seed=7');
    expect(game.hook('__fight')).toEqual({ id: 'echo', seed: 7 });
    const one = await partner(end, 'R0', 1);
    open();
    await until(game, () => data().seat === 'player' && data().opponent === 'here');
    expect(game.turn()).toBe("Partner's turn");
    await one.send(encodeMove(forward(one.legal())));
    await until(game, () => game.hook('__plies') === 2);
    expect(game.turn()).toBe('Your turn');
    play(game, forward(game.hook('__legal')));
    await until(game, () => game.hook('__plies') === 4 && one.history.length === 4);
    expect(game.hook('__history')).toEqual(one.history);
    end.leave();
    await until(game, () => data().opponent === 'gone'); // the partner's presence, not our own seat's
    expect(presence()).toBe('Your partner is disconnected.');
  });

  it('starts nothing for an unknown boss', async () => {
    const game = await boot('?bot=off#room=R0&boss=nobody&seed=7', calm);
    expect(game.room()).toBeNull();
    expect(data().seat).toBeUndefined();
    expect(game.hook('__fight')).toBeNull();
  });
});

describe('co-op: the end of the fight', () => {
  // The Echo's mirror of each move is a bonus move for the other side (#859), offered to the players (#958). Its search
  // is scripted to step east from (0,-1): our seat goes up, the partner and our seat then take the free move west and
  // step back east, and the 7th move brings a position back a third time, a draw by repetition, a Defeat against the
  // boss (e2e/fight-end.ts).
  const up = { cells: [[0, 2]] as Axial[], dir: 4 };
  const free = { cells: [[0, 1]] as Axial[], dir: 1 };
  const east = { cells: [[-1, 1]] as Axial[], dir: 0 };
  async function defeat(game: Game, two: Awaited<ReturnType<typeof partner>>): Promise<void> {
    const { Encounter } = await import('edgefall-wasm');
    vi.spyOn(Encounter.prototype, 'boss_move').mockReturnValue(Int32Array.from(encodeMove({ cells: [[0, -1]], dir: 0 })));
    play(game, up);
    await until(game, () => game.hook('__plies') === 2 && two.history.length === 2); // the partner heard our move before it plays its own
    await two.send(encodeMove(free)); // the partner's turn: its free move first, no boss reply
    await until(game, () => game.hook('__plies') === 3);
    await two.send(encodeMove(east));
    await until(game, () => game.hook('__plies') === 5);
    play(game, free);
    play(game, east);
    await until(game, () => game.hook('__plies') === 7 && two.history.length === 7);
  }

  it('ends on both engines at once: a position a third time is a draw by repetition, a Defeat against the boss', async () => {
    const { game, two } = await hosted();
    await defeat(game, two);
    await until(game, () => game.turn() === 'Defeat'); // the end is judged after the last move
    expect(game.hook('__history')).toEqual(two.history);
    expect(game.turn()).toBe('Defeat');
    expect(data().over).toBe('loss');
  });

  it('ends in a shared Retry: once both seats asked, the same fight restarts with seat 1 first, attempt 2 (#531)', async () => {
    const { game, two } = await hosted();
    const fight = game.hook('__fight');
    const retry = byId<HTMLButtonElement>('rematch');
    expect(game.hud()).toContain('Boss with a partner · attempt 1');
    await defeat(game, two);
    expect(retry.hidden).toBe(false);
    expect(retry.textContent).toBe('Retry');
    expect(retry.getAttribute('aria-label')).toBe('Retry'); // the accessible name is the visible label (#1068, WCAG 2.5.3)
    expect(retry.dataset.label).toBe('Retry');
    await two.session.rematch();
    await until(game, () => game.hud().includes('Your partner asks for a retry.'));
    expect(game.hook('__plies')).toBe(7); // nothing starts on one ask

    retry.click();
    await until(game, () => game.hook('__plies') === 0);
    expect(game.turn()).toBe('Your turn');
    expect(game.hud()).toContain('Boss with a partner · attempt 2');
    expect(game.hook('__fight')).toEqual(fight); // the same boss and seed
    expect(data().online).toBe('Black'); // no colour swap
    expect(retry.hidden).toBe(true);
    expect(document.querySelector('#hud .rematch')).toBeNull();
    play(game, up);
    await until(game, () => game.hook('__plies') === 2 && two.history.length === 2);
    expect(game.hook('__history')).toEqual(two.history); // both engines restarted the same encounter
    expect(game.hud()).not.toContain('refused');
  });
});

// Bug #695: a co-op fight against The Pulsar opens on the view of the solo fight, drawn back so every pulsar and its
// counter fit the window, off the HUD plate (#691), and a new window size fits it again (#696).
describe('co-op: the view of a Pulsar fight', () => {
  it('opens drawn back as in solo, and a new window size fits it again', async () => {
    const game = await boot('?bot=off&scene=room', calm);
    fightTogether(game, 'The Pulsar');
    await until(game, () => data().seat === 'player');
    const fitted = game.hook<View>('__view');
    expect(fitted.distance).toBeGreaterThan(resetView().distance);
    const inner = { innerWidth, innerHeight };
    Object.assign(window, { innerWidth: 375, innerHeight: 812 });
    dispatchEvent(new Event('resize'));
    Object.assign(window, inner);
    expect(game.hook<View>('__view').distance).toBeGreaterThan(fitted.distance); // upright needs more room
  });
});

describe('boss duel: the joiner plays the boss (#1316)', () => {
  it('Boss duel opens the shared list as a duel and Fight together opens it back as a co-op, one list at a time', async () => {
    const game = await boot('?bot=off', calm);
    const list = byId('coop-list');
    byId('boss-duel').click();
    expect(list.hidden).toBe(false);
    byId('boss-duel').click(); // pressed again: closes
    expect(list.hidden).toBe(true);
    byId('boss-duel').click();
    byId('fight-together').click(); // opened by Boss duel: Fight together keeps it open, as a co-op list
    expect(list.hidden).toBe(false);
    byId('boss-duel').click(); // and Boss duel turns it back into a duel list, still open
    expect(list.hidden).toBe(false);
    [...list.querySelectorAll('button')].find((b) => b.textContent === 'The Echo')!.click();
    await until(game, () => data().seat === 'player');
    expect(location.hash).toMatch(/&boss=echo&seed=\d+&seat=boss&key=[\w-]{8}$/);
    expect(byId('invite-label').textContent).toBe('Invite link: send it to your boss player');
    expect(presence()).toBe('You fight the boss. Waiting for the boss seat...');
    expect(byId('rematch').hidden).toBe(true);
    byId('play-online').click(); // a versus room after it: the duel is over
    await until(game, () => byId('invite-label').textContent === 'Invite link: send it to your opponent');
    expect(presence()).not.toContain('boss');
  });

  it('the hero page asks no bot for a boss reply to its move: the boss seat answers from the room (#1485)', async () => {
    const game = await boot('?bot=off', calm);
    byId('boss-duel').click();
    [...byId('coop-list').querySelectorAll('button')].find((b) => b.textContent === 'The Echo')!.click();
    await until(game, () => data().seat === 'player');
    await partner(game.peer()!, game.room()!, 2, bossSeatFromHash(location.hash)!);
    await until(game, () => data().opponent === 'here');
    const asked = vi.spyOn(Worker.prototype, 'postMessage');
    play(game, forward(game.hook('__legal')));
    for (let i = 0; i < 10; i++) await game.settle(); // a boss reply would be asked of the worker by now
    expect(asked).not.toHaveBeenCalled(); // no search for the boss on the hero page
    expect(game.hook('__plies')).toBe(1); // it waits for the boss player's move from the room
    asked.mockRestore();
  });

  it('a link with seat=boss seats us as the boss, White: the hero moves, then we answer, no boss reply is computed', async () => {
    const { game, end, open } = await invited('#room=R1&boss=echo&seed=7&seat=boss');
    expect(game.hook('__fight')).toEqual({ id: 'echo', seed: 7 });
    const hero = await partner(end, 'R1', 1);
    open();
    await until(game, () => data().seat === 'player' && data().opponent === 'here');
    expect(presence()).toBe('You are the boss. The hero is here.');
    expect(game.turn()).toBe("Hero's turn");
    await hero.send(encodeMove(forward(hero.legal())));
    await until(game, () => game.hook<number>('__plies') >= 1 && game.turn() === 'Your turn'); // the turn line follows the move
    expect(game.hook('__plies')).toBe(1); // the boss seat answers: no reply was computed for it (the helper's own engine did, its page does not)
    expect(game.turn()).toBe('Your turn');
    expect(byId('rematch').hidden).toBe(true);
    expect(document.querySelector('#hud .boss')?.textContent).toContain('Boss vs a player');
  });

  it('starts nothing for a seat=boss link with an unknown boss', async () => {
    const game = await boot('?bot=off#room=R0&boss=nobody&seed=7&seat=boss', calm);
    expect(game.room()).toBeNull();
    expect(data().seat).toBeUndefined();
  });
});
