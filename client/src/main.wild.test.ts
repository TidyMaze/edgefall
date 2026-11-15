// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { FightState } from './openworldfight';
import { neighbours } from './openworld';
import './test/openworldwasm';
import { world_enemies } from 'edgefall-wasm';
import { BOT_NODES, WILD_NODES } from './bot';
import { boot, type Game } from './test/harness';

// The wandering marbles and the wild fights of the Open world (#1511, docs/specs/openworld.md sections 3b and 3c).
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
type Hooks = { __openworldWander: (tick: number | null) => void; __openworldEnemies: () => Axial[]; __openworldFixture: (f: { hero: Axial; troop: Axial[]; enemies?: Axial[] }) => void };
const hooks = () => window as unknown as Hooks;
/** The first seed with a generated marble within the 10 cells the page lists enemies at round the spawn, and where it starts. */
const { seed, home } = (() => {
  for (let n = 1; n < 100; n++) {
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as Axial[]) {
      const flat = world_enemies(n, cx, cy);
      for (let i = 0; i < flat.length; i += 2) if (Math.max(Math.abs(flat[i]!), Math.abs(flat[i + 1]!), Math.abs(flat[i]! + flat[i + 1]!)) <= 10) return { seed: n, home: [flat[i]!, flat[i + 1]!] as Axial };
    }
  }
  throw new Error('no seed');
})();
const beside = neighbours(home)[0]!;

afterEach(() => vi.useRealTimers());

async function openWorld(game: Game, url = `?openworld=${seed}`): Promise<void> {
  void url;
  byId('openworld').click();
  await settle();
}

describe('the clock of the wandering marbles', () => {
  it('stands at tick 0 under automation, moves the marbles when a spec sets another tick, and follows the real clock when asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const game = await boot(`?bot=off&openworld=${seed}`);
    await openWorld(game);
    const start = hooks().__openworldEnemies();
    expect(start.length).toBeGreaterThan(0);
    let away = -1;
    for (let tick = 1; tick < 400 && away < 0; tick++) {
      hooks().__openworldWander(tick);
      if (hooks().__openworldEnemies().some((c, i) => c.join() !== start[i]?.join())) away = tick;
    }
    expect(away).toBeGreaterThan(0);
    hooks().__openworldWander(0);
    expect(hooks().__openworldEnemies()).toEqual(start);
    // The real clock: the tick is the wall time in ticks of FightState.tickMs.
    vi.setSystemTime(away * FightState.tickMs);
    hooks().__openworldWander(null);
    expect(hooks().__openworldEnemies()).not.toEqual(start);
  });
});

describe('a wild fight (#1511)', () => {
  /** A world with the hero put next to the marble that starts on `home`: the wipe closes, then the arena is there. */
  async function met(options: Parameters<typeof boot>[1] = {}): Promise<Game> {
    const game = await boot(`?openworld=${seed}`, options);
    await openWorld(game);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: beside, troop: [] });
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    return game;
  }
  const wipe = (): HTMLElement => byId('wild-wipe');

  it('plays the wipe over the world, then the arena opens against the bot on the board of the hour, with Flee on screen', async () => {
    await met();
    expect([wipe().hidden, wipe().dataset.phase, wipe().dataset.motion]).toEqual([false, 'closing', 'full']);
    expect(data().openworld).toBe(String(seed)); // the world stays under the wipe
    expect(byId('wild-flee').hidden).toBe(true);
    vi.advanceTimersByTime(500);
    expect(data().openworld).toBeUndefined(); // the arena is there
    expect(data().fightBoard).toBe('day');
    expect(wipe().dataset.phase).toBe('opening');
    expect(byId('wild-flee').hidden).toBe(false);
    expect(byId('wild-flee').textContent).toBe('Flee');
    expect(byId('exit').hidden).toBe(true); // Flee holds the first slot of the fight (#1517)
    expect(byId('boss-retry').hidden).toBe(true);
    expect(byId('new-game').hidden).toBe(true);
    vi.advanceTimersByTime(500);
    expect(wipe().hidden).toBe(true); // a second in all
    expect(localStorage.getItem('ab-alone.wild')).toBe(String(seed));
  });

  it('is a plain fade under reduced motion', async () => {
    await met({ reducedMotion: true });
    expect(wipe().dataset.motion).toBe('reduced');
    vi.advanceTimersByTime(250);
    expect(data().openworld).toBeUndefined();
    vi.advanceTimersByTime(250);
    expect(wipe().hidden).toBe(true);
  });

  it('Flee puts the hero back where it stood, takes the arena and the button away, and the marble that was fled from does not fight for 5 s', async () => {
    await met();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    byId('wild-flee').click();
    await settle();
    expect(data().openworld).toBe(String(seed));
    expect(data().openworldAt).toBe(beside.join(','));
    expect(data().fightBoard).toBeUndefined();
    expect(byId('wild-flee').hidden).toBe(true);
    expect(byId('new-game').hidden).toBe(false);
    expect(localStorage.getItem('ab-alone.wild')).toBe('');
    expect(wipe().hidden).toBe(true); // no new fight: the marble is next to the hero, but it is calm
    expect(data().openworldBeaten).toBe('0');
  });

  it('F flees too, only while the fight is on and only outside a text field', async () => {
    const game = await met();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(data().openworld).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    expect(data().openworld).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    await settle();
    expect(data().openworldAt).toBe(beside.join(','));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); // not in a fight: nothing
    expect(game.hud()).toBeDefined();
  });

  it('a win takes the marble out of the world and tells the others; a loss is Flee', async () => {
    const game = await met();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    const { Engine } = await import('edgefall-wasm');
    const won = (): number => (game.hook<number>('__plies') > 0 ? 1 : 0);
    vi.spyOn(Engine.prototype, 'status').mockImplementation(won);
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    expect(byId('wild-flee').hidden).toBe(true);
    expect(byId('exit').hidden).toBe(false);
    expect(byId('exit').textContent).toBe('Back to the Open world');
    expect(game.hud()).toContain('The marble is gone from the world.');
    byId('boss-goal').click(); // the HUD is drawn again: the marble is counted once
    expect(game.hud()).toContain('The marble is gone from the world.');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().openworld).toBe(String(seed));
    expect(data().openworldBeaten).toBe('1');
    expect(hooks().__openworldEnemies().some((c) => c.join() === home.join())).toBe(false);
  });

  it('brings back the local game the player had, with the bot or at the hot-seat table', async () => {
    for (const url of [`?openworld=${seed}`, `?bot=off&openworld=${seed}`]) {
      const game = await boot(url);
      const first = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
      game.click(first.cells[0]![0], first.cells[0]![1]);
      game.click(first.cells[0]![0] + DIRS[first.dir]![0], first.cells[0]![1] + DIRS[first.dir]![1]);
      await game.settle();
      const played = game.hook<number>('__plies');
      expect(played).toBeGreaterThan(0);
      await openWorld(game);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      hooks().__openworldFixture({ hero: beside, troop: [] });
      document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
      vi.advanceTimersByTime(1000);
      expect(game.hook<number>('__plies')).toBe(0); // the wild fight is a fresh game
      vi.useRealTimers();
      byId('wild-flee').click();
      await settle();
      expect(game.hook<number>('__plies')).toBe(played); // and the game of the player is back under the world
      expect(byId('wild-flee').hidden).toBe(true);
    }
  });

  it('a reload during a wild fight puts the player back in the world', async () => {
    const mark = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => (key === 'ab-alone.wild' ? '1305' : null));
    await boot('/');
    await settle();
    expect(data().openworld).toBe('1305');
    mark.mockRestore();
  });

  it('a reload during a wild fight puts the hero back on its cell, with no fight on screen (#1511, #1626)', async () => {
    const store = new IDBFactory();
    const game = await boot(`?openworld=${seed}`, { indexedDB: store });
    await openWorld(game);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: beside, troop: [] });
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(byId('wild-flee').hidden).toBe(false);
    await boot(`?openworld=${seed}`, { indexedDB: store }); // the reload: the same saved world
    await settle();
    expect(data().openworldAt).toBe(beside.join(','));
    expect(byId('wild-flee').hidden).toBe(true);
  });

  it('a marble that walks up to the hero starts the fight on the tick it arrives, and F flees (#1511, #1626)', async () => {
    await openWorld(await boot(`?bot=off&openworld=${seed}`));
    const start = hooks().__openworldEnemies();
    const home = start[0]!;
    let tick = 0;
    let at: Axial | undefined;
    for (let t = 1; t < 400 && !at; t++) {
      hooks().__openworldWander(t);
      at = hooks().__openworldEnemies().find((c) => c.join() !== home.join());
      tick = t;
    }
    expect(at).toBeDefined();
    hooks().__openworldWander(0);
    // A cell beside the walker that is not beside the marble at home: the hero stands there while the marble is still.
    const near = DIRS.map(([a, b]): Axial => [at![0] + a, at![1] + b]).find((c) => Math.max(Math.abs(c[0] - home[0]), Math.abs(c[1] - home[1]), Math.abs(c[0] - home[0] + c[1] - home[1])) >= 2)!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: near, troop: [] });
    vi.advanceTimersByTime(1000);
    expect(data().openworld).toBe(String(seed)); // the marble is at home, two cells off: no fight
    hooks().__openworldWander(tick);
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    vi.advanceTimersByTime(1000);
    expect(data().openworld).toBeUndefined(); // the fight starts on the tick the marble arrives
    expect(byId('wild-flee').hidden).toBe(false);
    vi.useRealTimers();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    await settle();
    expect(data().openworldAt).toBe(near.join(','));
  });

  it('the wild fight is not saved: after Flee the local game is the one the player left, not the fight\'s moves', async () => {
    const game = await met();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(move.cells[0]![0], move.cells[0]![1]);
    game.click(move.cells[0]![0] + DIRS[move.dir]![0], move.cells[0]![1] + DIRS[move.dir]![1]);
    await game.settle();
    expect(game.hook<number>('__plies')).toBeGreaterThan(0);
    byId('wild-flee').click();
    await settle();
    expect(game.hook<number>('__plies')).toBe(0);
  });

  it('the bot of a wild fight searches a modest fixed budget, never more than the test budget', async () => {
    for (const [nodes, expected] of [[50_000, WILD_NODES], [300, 300]] as const) {
      const game = await boot(`?nodes=${nodes}&openworld=${seed}`, { reducedMotion: true });
      const search = vi.spyOn((await import('edgefall-wasm')).Engine.prototype, 'best_move');
      await openWorld(game);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      hooks().__openworldFixture({ hero: beside, troop: [] });
      document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
      vi.advanceTimersByTime(1000);
      vi.useRealTimers();
      const move = game.hook<Move[]>('__legal').filter((m) => m.cells.length === 1).at(-1)!; // not the move of the other tests: the harness keeps the bot's answers
      game.click(move.cells[0]![0], move.cells[0]![1]);
      game.click(move.cells[0]![0] + DIRS[move.dir]![0], move.cells[0]![1] + DIRS[move.dir]![1]);
      await game.settle();
      game.frame(1000);
      await game.settle();
      expect(search).toHaveBeenCalledWith(expected);
      search.mockRestore();
    }
    expect(WILD_NODES).toBeLessThan(BOT_NODES);
  });
});
