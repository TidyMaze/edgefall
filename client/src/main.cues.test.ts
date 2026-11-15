// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { LEGACY_UNLOCKED } from './collector';
import { newRun, type Run } from './roguelite';
import { boot, type Game, startBoss } from './test/harness';

// The cues of world.md section 7 (#1570), through the jsdom harness: nobody can listen here, so the page reports each cue
// it played (`__cues`, like `__tellCues` for the tells) and these tests read that list. No cue before the first gesture,
// none with the effects slider at 0.
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const gesture = (): boolean => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
const cues = (game: Game): string[] => game.hook<string[]>('__cues');
const count = (game: Game, event: string): number => cues(game).filter((c) => c === event).length;
const plainRun = (seed: number, best: number): Run => ({ ...newRun(seed, best, LEGACY_UNLOCKED), enemies: false });

/** Starts the fight of the boss named `name` from the boss list. */
function start(game: Game, name: string): void {
  startBoss(name);
}
/** The engine's answers once a ply was played, with `over` as its status: 0 running, 1 Black wins, 2 White wins, 3 draw. */
async function judge(game: Game, kind: 'Encounter' | 'Engine', over: { status: number }): Promise<void> {
  const wasm = await import('edgefall-wasm');
  const status = (): number => (game.hook<number>('__plies') > 0 ? over.status : 0);
  if (kind === 'Encounter') vi.spyOn(wasm.Encounter.prototype, 'result').mockImplementation(status);
  vi.spyOn(wasm[kind].prototype, 'status').mockImplementation(status);
}
/** Plays the first legal one-marble move forward, by two clicks. */
function move(game: Game): void {
  const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
  const [q, r] = mv.cells[0]!;
  game.click(q, r);
  game.click(q + DIRS[mv.dir]![0], r + DIRS[mv.dir]![1]);
}

describe('the UI click (#1570)', () => {
  it('sounds on a button once the sound is on, never before a gesture', async () => {
    const game = await boot('?bot=off', { audio: true });
    expect(cues(game)).toEqual([]);
    gesture();
    game.openSettings();
    expect(cues(game)).toEqual(['click']);
  });

  it('is silent with the effects slider at 0', async () => {
    const game = await boot('?bot=off', { audio: true, storage: { 'ab-alone.volume.effects': '0' } });
    gesture();
    expect(cues(game)).toEqual([]);
  });

  it('does not sound on the board, a slider or the text of the page', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    for (const target of [document.querySelector('canvas')!, byId('hud'), document.body]) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    game.openSettings();
    byId('volume-music').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cues(game)).toEqual(['click']); // the settings button alone
  });

  it('does not sound on the pick of a node of the rogue-lite map, nor on Start: they have their own pick', async () => {
    const game = await boot('?nodes=50&bot=off', { audio: true });
    gesture();
    byId('roguelite').click();
    expect(cues(game)).toEqual(['click']); // the press on the starter
    byId('run-map').querySelector<HTMLButtonElement>('button[data-node]:not(:disabled)')!.click();
    expect(document.body.dataset.pick).toBe('pick');
    expect(cues(game)).toEqual(['click']);
  });
});

describe('the win and the loss (#1570)', () => {
  it('a boss fight won sounds once, not again when the plate is drawn again', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    const over = { status: 0 };
    await judge(game, 'Encounter', over);
    start(game, 'The Echo');
    over.status = 1;
    move(game);
    expect(count(game, 'boss-death')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(game.hud()).toContain('Victory');
    expect([count(game, 'boss-death'), count(game, 'win'), count(game, 'loss')]).toEqual([1, 0, 0]); // the boss death takes the place of the win
  });

  it('a boss fight lost, a draw of it too, sounds the loss', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    const over = { status: 0 };
    await judge(game, 'Encounter', over);
    start(game, 'The Echo');
    over.status = 2;
    move(game);
    expect([count(game, 'win'), count(game, 'loss')]).toEqual([0, 1]);
  });

  it('a game against the bot won sounds the win, a draw its own cue and never the win', async () => {
    for (const [status, win, draw] of [[1, 1, 0], [3, 0, 1]] as const) {
      const game = await boot('?nodes=50', { audio: true });
      gesture();
      await judge(game, 'Engine', { status });
      move(game);
      expect([count(game, 'win'), count(game, 'draw')], `status ${status}`).toEqual([win, draw]);
      game.openSettings();
      byId('setting-flat-hud').click();
      expect([count(game, 'win'), count(game, 'draw')], `status ${status} drawn again`).toEqual([win, draw]);
    }
  });

  it('a draw in a hot seat is silent, like a win there', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    await judge(game, 'Engine', { status: 3 });
    move(game);
    expect(count(game, 'draw')).toBe(0);
  });

  it('a hot seat is silent: nobody there wins or loses', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    await judge(game, 'Engine', { status: 1 });
    move(game);
    expect(document.body.dataset.over).toBe('win');
    expect([count(game, 'win'), count(game, 'loss')]).toEqual([0, 0]);
  });

  it('is silent before a gesture, and with the effects slider at 0', async () => {
    for (const [storage, key] of [[{}, true], [{ 'ab-alone.volume.effects': '0' }, false]] as const) {
      const game = await boot('?bot=off', { reducedMotion: true, audio: true, storage });
      if (!key) gesture();
      await judge(game, 'Encounter', { status: 1 });
      start(game, 'The Echo');
      move(game);
      expect(cues(game)).toEqual([]); // no gesture, or the effects slider at 0: no cue at all, not even a selection
    }
  });

  it('is held back while the Replay shows the end, and sounds once the live game is back', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    const over = { status: 0 };
    await judge(game, 'Encounter', over);
    start(game, 'The Echo');
    move(game);
    byId('replay').click();
    over.status = 1; // the end comes while the Replay is open, as when a peer's move lands
    byId('replay-prev').click();
    byId('replay-next').click();
    expect(count(game, 'boss-death')).toBe(0);
    byId('replay-live').click();
    expect([count(game, 'boss-death'), count(game, 'win')]).toEqual([1, 0]);
  });
});

describe('the boss phase change (#1570)', () => {
  it('sounds once when the phase moves, not on the first sight of the fight nor on a redraw', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    const wasm = await import('edgefall-wasm');
    let phase = 0;
    vi.spyOn(wasm.Encounter.prototype, 'phase').mockImplementation(() => phase);
    start(game, 'The Echo');
    expect(count(game, 'phase')).toBe(0);
    phase = 1;
    move(game);
    expect(count(game, 'phase')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(count(game, 'phase')).toBe(1);
  });

  it('does not sound while the Replay is open', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    const wasm = await import('edgefall-wasm');
    let phase = 0;
    vi.spyOn(wasm.Encounter.prototype, 'phase').mockImplementation(() => phase);
    start(game, 'The Echo');
    move(game);
    byId('replay').click();
    phase = 1;
    byId('replay-prev').click();
    byId('replay-next').click();
    expect(count(game, 'phase')).toBe(0);
  });
});

describe('the rogue-lite reward (#1570)', () => {
  it('sounds when the reward of a won fight comes up, not while it stays, and again for the next', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { audio: true, indexedDB });
    gesture();
    const won = { ...plainRun(1, 3), army: 12, path: [0], reward: true };
    await game.hook('__run', won);
    expect(document.body.dataset.run).toBe('reward');
    expect(count(game, 'reward')).toBe(1);
    byId('run-map').querySelector<HTMLButtonElement>('button[data-offer]')!.click();
    expect(document.body.dataset.run).toBe('map');
    expect(count(game, 'reward')).toBe(1);
    await game.hook('__run', won);
    expect(count(game, 'reward')).toBe(2);
  });
});

// The player walks its columns to the centre while the bots hold: every other set is void at the end of round 25
// (the same file as main.royale.test.ts), and the player wins.
const NW = (...cells: Axial[]): number[] => [0, cells.length, 4, ...[...cells, [0, 0], [0, 0]].slice(0, 3).flat()];
const column = (cells: Axial[], steps: number): number[][] => Array.from({ length: steps }, (_, s) => NW(...cells.map(([q, r]): Axial => [q, r - s])));
const END = {
  seed: 7,
  rounds: [
    ...column([[-4, 8], [-4, 7], [-4, 6]], 3),
    ...column([[-3, 8], [-3, 7], [-3, 6]], 3),
    ...column([[-5, 8], [-5, 7]], 3),
    ...column([[-2, 7], [-2, 6]], 2),
    ...Array.from({ length: 14 }, () => []),
  ],
};

describe('the royale (#1570)', () => {
  const holdAll = (game: Game, rounds: number): void => {
    for (let round = 0; round < rounds && !byId('royale-hold').disabled; round++) {
      byId('royale-hold').click();
      game.frame(10_000);
    }
  };
  async function royale(options: { reducedMotion?: boolean } = {}): Promise<Game> {
    const game = await boot('?bot=off', { audio: true, ...options });
    gesture();
    game.hook('__royale', { seed: 7, rounds: [] }); // a fixed seed: the same bots every time
    return game;
  }

  const heard = (game: Game): string[] => cues(game).filter((c) => c !== 'click' && c !== 'royale-round');

  it('sounds an elimination when a marble set goes out, once for sets that go out together, and the loss at the end', async () => {
    const game = await royale();
    holdAll(game, 80);
    expect(byId('hud').querySelector('.turn')!.textContent).toBe('You place 6th');
    expect(heard(game)).toEqual(['elimination', 'elimination', 'loss']);
  });

  it('plays the same cues under reduced motion, where the arena jumps to each round', async () => {
    const game = await royale({ reducedMotion: true });
    holdAll(game, 80);
    expect(heard(game)).toEqual(['elimination', 'elimination', 'loss']);
  });

  it('sounds a round tick when a round is resolved and the next one is open: after its reveal, once, never for the round a game opens at', async () => {
    const game = await royale();
    expect(count(game, 'royale-round')).toBe(0);
    byId('royale-hold').click();
    expect(count(game, 'royale-round')).toBe(0); // the reveal of the round is playing
    game.frame(10_000);
    expect(count(game, 'royale-round')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(count(game, 'royale-round')).toBe(1);
    byId('royale-hold').click();
    game.frame(10_000);
    expect(count(game, 'royale-round')).toBe(2);
    game.hook('__royale', { seed: 7, rounds: [[], [], []] }); // a game that opens at round 4
    expect(count(game, 'royale-round')).toBe(2);
  });

  it('sounds a round tick at once under reduced motion, where there is no reveal, and none in the draw that has an elimination or the end', async () => {
    const game = await royale({ reducedMotion: true });
    holdAll(game, 80);
    const all = cues(game).filter((c) => c !== 'click');
    const rounds = Number(document.body.dataset.royale) - 1;
    expect(all.filter((c) => c === 'elimination')).toHaveLength(2);
    expect(all.filter((c) => c === 'loss')).toHaveLength(1);
    expect(all).toHaveLength(rounds); // each round sounds one cue: the tick, or the elimination or the end that takes its place
  });

  it('a game file that opens already over sounds its win once, and no elimination for the sets already out', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    game.hook('__royale', END);
    expect(cues(game)).toEqual(['win']);
    game.hook('__royale', END);
    expect(cues(game)).toEqual(['win', 'win']); // a new game of its own
  });
});

describe('the boss intro (#1570)', () => {
  it('sounds once as a fight starts, after the click on the boss, and not when the plate is drawn again', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    start(game, 'The Echo');
    expect(cues(game)).toEqual(['boss-intro']); // the mode menu, the boss list, the intro (the entry starts the fight, then its click bubbles to the page's listener)
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(count(game, 'boss-intro')).toBe(1);
  });

  it('is silent outside a boss fight, and sounds again for the next fight', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true });
    gesture();
    expect(count(game, 'boss-intro')).toBe(0);
    start(game, 'The Echo');
    start(game, 'The Echo');
    expect(count(game, 'boss-intro')).toBe(2);
  });
});

describe('the selection (#1570)', () => {
  it('sounds when the selection changes to a group of marbles, not on a redraw nor when it is cleared', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
    const [q, r] = mv.cells[0]!;
    expect(count(game, 'selection')).toBe(0);
    game.click(q, r);
    expect(count(game, 'selection')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click(); // the plate is drawn again
    expect(count(game, 'selection')).toBe(1);
    game.click(q, r); // a second press takes the selection back
    expect(count(game, 'selection')).toBe(1);
    game.click(q, r);
    expect(count(game, 'selection')).toBe(2);
  });

  it('is silent for the move that clears the selection, and for a press on nothing', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    move(game);
    expect(count(game, 'selection')).toBe(1); // the first press of the two selected the marble, the second played
    game.click(0, 0); // an empty cell of the other side's turn, with nothing selected
    expect(count(game, 'selection')).toBe(1);
  });

  it('is silent before a gesture and with the effects slider at 0', async () => {
    for (const [storage, key] of [[{}, false], [{ 'ab-alone.volume.effects': '0' }, true]] as const) {
      const game = await boot('?bot=off', { audio: true, storage });
      if (key) gesture();
      const [q, r] = game.hook<Move[]>('__legal')[0]!.cells[0]!;
      game.click(q, r);
      expect(cues(game)).toEqual([]);
    }
  });
});

describe('the illegal move (#1570)', () => {
  it('sounds once for a press that is not a legal move after a selection, with the text that says so, never on a hover or without a selection', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
    const [q, r] = mv.cells[0]!;
    game.click(0, 0); // nothing selected: the engine has nothing to refuse
    document.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 })); // a hover
    expect(count(game, 'illegal-move')).toBe(0);
    game.click(q, r);
    game.click(q + 4, r + 4); // far from the marble: no legal move
    expect(game.hud()).toContain('not a legal move');
    expect(count(game, 'illegal-move')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click(); // a redraw does not sound it again
    expect(count(game, 'illegal-move')).toBe(1);
  });
});

describe('the turn start (#1570)', () => {
  it('sounds when the bot has answered and the turn is back to the player, not for the player own move', async () => {
    const game = await boot('?nodes=50', { audio: true });
    gesture();
    move(game);
    expect(count(game, 'turn-start')).toBe(0);
    await game.settle();
    game.frame(5000);
    await game.settle();
    expect(game.hook('__plies')).toBe(2); // the bot answered
    expect(count(game, 'turn-start')).toBe(1);
  });

  it('is silent in a hot seat, where nobody answers', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    for (let ply = 0; ply < 2; ply++) {
      const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!; // either side's first one-marble move
      const [q, r] = mv.cells[0]!;
      game.click(q, r);
      game.click(q + DIRS[mv.dir]![0], r + DIRS[mv.dir]![1]);
      game.frame(5000);
    }
    expect(game.hook('__plies')).toBe(2);
    expect(count(game, 'turn-start')).toBe(0);
  });
});

describe('the shop and the relic (#1570)', () => {
  it('the shop sounds when it comes up, not while it stays, and again for the next one', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { audio: true, indexedDB });
    gesture();
    const shop = { ...plainRun(1, 3), army: 12, path: [0], shop: true };
    await game.hook('__run', shop);
    expect(document.body.dataset.run).toBe('shop');
    expect(count(game, 'shop')).toBe(1);
    byId('run-map').querySelector<HTMLButtonElement>('button[data-leave]')!.click();
    expect(document.body.dataset.run).toBe('map');
    expect(count(game, 'shop')).toBe(1);
    await game.hook('__run', shop);
    expect(count(game, 'shop')).toBe(2);
  });

  it('a relic taken sounds once, not for the relics a run is loaded with', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { audio: true, indexedDB });
    gesture();
    await game.hook('__run', { ...plainRun(3, 3), army: 12, path: [0, 2, 6, 9], reward: true, relic: true });
    expect(document.body.dataset.run).toBe('relic');
    expect(count(game, 'relic')).toBe(0);
    byId('run-map').querySelectorAll<HTMLButtonElement>('button[data-relic]')[1]!.click();
    expect(count(game, 'relic')).toBe(1);
    game.openSettings();
    byId('setting-flat-hud').click();
    expect(count(game, 'relic')).toBe(1);
    await game.hook('__run', { ...plainRun(3, 3), army: 12, relics: [1, 2] });
    expect(count(game, 'relic')).toBe(1);
  });
});
