// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Axial, Move } from './board';
import './test/openworldwasm';
import { boot, type Game, startBoss } from './test/harness';

// Browser Back and the Android Back gesture (#1564, docs/specs/ui.md section "Browser Back"): a screen other than the one the page
// started on holds one history entry, and Back runs the way out the screen already has: a mode goes to the Hub, the Hub to the table,
// Back to the hub / Back to the Open world where the screen shows them.

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const marked = (): boolean => (history.state as { ab?: number } | null)?.ab === 1;
const hubOn = (): boolean => data().hub !== undefined;
/** Presses Back and waits for the page's popstate. */
const realBack = history.back.bind(history);
async function pressBack(game: Game): Promise<() => number> {
  const popped = new Promise((done) => window.addEventListener('popstate', done, { once: true }));
  realBack();
  const leave = vi.spyOn(history, 'back').mockImplementation(() => undefined); // the page's own call to go on back, which would leave the page: counted, not made
  await popped;
  await game.settle();
  game.frame(); // the frame that asks for the entry of the screen Back landed on
  return () => leave.mock.calls.length;
}
async function pick(game: Game, id: string): Promise<void> {
  byId(id).click();
  await game.settle();
  game.frame();
}
const bossPick = async (game: Game): Promise<void> => {
  startBoss('The Echo');
  await game.settle();
  game.frame();
};
/** Plays the first legal single-marble move of the side to move by two clicks, as a player does. */
async function playMove(game: Game): Promise<void> {
  const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
  game.click(...move.cells[0]!);
  game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
  await game.settle();
  game.frame(1000); // the slide ends
}
const MODES: [string, (game: Game) => Promise<void>, () => boolean][] = [
  ['Battle royale', (g) => pick(g, 'battle-royale'), () => !byId('royale-hold').hidden],
  ['Rogue-lite run', (g) => pick(g, 'roguelite'), () => !byId('run-map').hidden],
  ['Daily challenge', (g) => pick(g, 'daily'), () => data().boss !== undefined],
  ['Trainer', (g) => pick(g, 'trainer'), () => data().trainer !== undefined],
  ['Boss fight', bossPick, () => data().boss !== undefined],
  ['Open world', (g) => pick(g, 'openworld'), () => data().openworld !== undefined],
];

vi.setConfig({ testTimeout: 8000 });

describe('main.ts, browser Back (#1564)', () => {
  it.each(MODES)('%s holds one history entry and Back goes to the Hub', async (_name, enter, on) => {
    const game = await boot('?bot=off&openworld=7');
    expect(marked()).toBe(false);
    await enter(game);
    expect(on()).toBe(true);
    expect(marked()).toBe(true);
    await pressBack(game);
    expect(on()).toBe(false);
    expect(hubOn()).toBe(true);
    expect(game.hud()).toContain('Hub');
  });

  it('Back from the table of a page that began on the Hub goes to the Hub: the exit of the plain table leads there too (#1697)', async () => {
    const game = await boot('/'); // no query: a new player lands on the Hub, the base screen
    await game.settle();
    expect(hubOn()).toBe(true);
    byId('new-game').click();
    await game.settle();
    game.frame();
    expect(hubOn()).toBe(false);
    expect(byId('exit').hidden).toBe(false);
    expect(byId('exit').dataset.label).toBe('Hub');
    await pressBack(game);
    expect(hubOn()).toBe(true);
  });

  it('Back from the Hub goes to the table, and a Back on the table leaves the page', async () => {
    const game = await boot('?bot=off');
    await pick(game, 'ship');
    expect(hubOn()).toBe(true);
    expect(marked()).toBe(true);
    const left = await pressBack(game);
    expect(hubOn()).toBe(false);
    expect(game.hud()).toContain('Black to move');
    expect(marked()).toBe(false);
    expect(left()).toBe(0); // the table is the base screen: the page stays
  });

  it('Back from the Hub puts the saved table game back: its moves stay on the board and in the store', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { indexedDB });
    await playMove(game);
    await playMove(game);
    await game.settle();
    await pick(game, 'ship');
    expect(hubOn()).toBe(true);
    await pressBack(game);
    await game.settle();
    expect(hubOn()).toBe(false);
    expect(game.hook('__plies')).toBe(2);
    expect(game.hud()).toContain('Black to move');
    expect((await boot('?bot=off', { indexedDB })).hook('__plies')).toBe(2); // the store still holds the game
  });

  it('Back from the Hub after a mode that took the engine still brings the saved table game', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { indexedDB });
    await playMove(game);
    await game.settle();
    await bossPick(game);
    await pressBack(game); // the Hub
    await pressBack(game); // the table
    await game.settle();
    expect(hubOn()).toBe(false);
    expect(data().boss).toBeUndefined();
    expect(game.hook('__plies')).toBe(1);
    expect(game.hud()).toContain('White to move');
  });

  it('Back from the Hub brings a saved Stalker fight back under its fog, and a saved game against the bot with its bot', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?nodes=50', { indexedDB });
    startBoss('The Stalker');
    await playMove(game);
    game.frame();
    await pressBack(game); // the Hub
    await pressBack(game); // the saved fight
    await game.settle();
    expect(hubOn()).toBe(false);
    expect(game.hook<{ visible: Axial[] } | null>('__stalker')!.visible.length).toBeGreaterThan(0);
    expect(game.hook('__plies')).toBeGreaterThan(0);
    const bot = await boot('?nodes=50', { indexedDB: new IDBFactory() });
    await playMove(bot);
    await pick(bot, 'ship');
    await pressBack(bot);
    await bot.settle();
    expect(hubOn()).toBe(false);
    expect(bot.hook<number>('__plies')).toBeGreaterThan(0);
  });

  it('a mode left by its own button to the Hub keeps its entry, and Back then goes to the table', async () => {
    const game = await boot('?bot=off');
    await bossPick(game);
    await pick(game, 'ship');
    expect(marked()).toBe(true);
    await pressBack(game);
    expect(hubOn()).toBe(false);
    expect(game.hud()).toContain('Black to move');
  });

  it('a mode left by New game leaves a stale entry: the Back on the table is the browser\'s own and leaves at once', async () => {
    const game = await boot('?bot=off');
    await pick(game, 'ship');
    byId('new-game').click();
    expect(hubOn()).toBe(false);
    const left = await pressBack(game);
    expect(hubOn()).toBe(false);
    expect(left()).toBe(1); // one press, not two
  });

  it('the page started on the Hub: Back from a mode lands on it, and the next Back leaves the page', async () => {
    const game = await boot('/');
    expect(hubOn()).toBe(true);
    await bossPick(game);
    expect(marked()).toBe(true);
    const left = await pressBack(game);
    expect(hubOn()).toBe(true);
    expect(marked()).toBe(false);
    expect(left()).toBe(0);
  });

  it('the Hub exit is the way out of a table opened from the Hub, mid-fight or not, and Back takes it', async () => {
    const game = await boot('?bot=off', { deck: true });
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [1, 0], beaten: [] }));
    await pick(game, 'ship');
    game.click(2, 0); // the boss door of the Mess: the fight is on, the exit leads to the Hub
    game.frame();
    expect(data().boss).toBe('echo');
    expect(byId('exit').dataset.label).toBe('Hub');
    await pressBack(game);
    expect(hubOn()).toBe(true);
    expect(data().hub).toBe('mess 2,0'); // the marble on the door's cell, as Back to the hub puts it
  });

  it('Back from a town of the Open world goes back to the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    await pick(game, 'openworld');
    const [q, r] = data().openworldPlaces!.split(' ').find((p) => p.startsWith('town:'))!.slice(5).split(',').map(Number) as unknown as Axial;
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    game.frame();
    expect(hubOn()).toBe(true);
    expect(byId('exit').dataset.label).toBe('World');
    await pressBack(game);
    expect(hubOn()).toBe(false);
    expect(data().openworld).toBeDefined();
  });

  it('Back in the fight of a boss lair goes back to the world, as the exit of the dock does', async () => {
    const game = await boot('?bot=off&openworld=7');
    await pick(game, 'openworld');
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    document.getElementById('hub-confirm-yes')?.click(); // a tower or a gate opens its bay first: Enter starts the fight or the run (#1694)
    game.frame();
    expect(data().boss).toBeDefined();
    expect(byId('exit').dataset.label).toBe('World'); // the fight is on
    await pressBack(game);
    await game.settle();
    expect(data().boss).toBeUndefined();
    expect(hubOn()).toBe(false);
    expect(data().openworld).toBeDefined();
  });

  describe('the exit of a fight in progress asks twice, Back never (#1517)', () => {
    /** One ply of the fight, played as a player does: a single marble one cell. */
    const fightPly = (game: Game): void => {
      const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
      const [mq, mr] = move.cells[0]!;
      game.click(mq, mr);
      game.click(mq + (move.dir === 2 ? 1 : -1), mr + (move.dir === 2 ? -1 : 1));
    };
    const intoLair = async (game: Game): Promise<void> => {
      await pick(game, 'openworld');
      const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
      (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      document.getElementById('hub-confirm-yes')?.click(); // a tower or a gate opens its bay first: Enter starts the fight or the run (#1694)
      game.frame();
      expect(data().boss).toBeDefined();
    };
    it('leaves a lair fight with no ply played at the first press', async () => {
      const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
      await intoLair(game);
      byId('exit').click();
      await game.settle();
      expect(data().boss).toBeUndefined();
      expect(data().openworld).toBeDefined();
    });
    it('asks for a second press once a ply is played: Sure? in the first slot, the fight stays, and the second press leaves', async () => {
      const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
      await intoLair(game);
      fightPly(game);
      byId('exit').click();
      expect(byId('exit').dataset.label).toBe('Sure?');
      expect(byId('exit').classList.contains('confirm')).toBe(true);
      expect(data().boss).toBeDefined();
      byId('exit').click();
      await game.settle();
      expect(data().boss).toBeUndefined();
      expect(data().openworld).toBeDefined();
      expect(byId('exit').classList.contains('confirm')).toBe(false);
    });
    it('lapses as New game\'s does, and the label is World again', async () => {
      const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
      await intoLair(game);
      fightPly(game);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // after the setup, which waits on real timers
      try {
        byId('exit').click();
        vi.advanceTimersByTime(4001);
        expect(byId('exit').classList.contains('confirm')).toBe(false);
        byId('exit').click();
        expect(byId('exit').dataset.label).toBe('Sure?'); // asked again, nothing left
        expect(data().boss).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
    it('asks for a boss fight of the menu too, whose exit is the Hub', async () => {
      const game = await boot('?bot=off');
      await bossPick(game);
      fightPly(game);
      byId('exit').click();
      expect(byId('exit').dataset.label).toBe('Sure?');
      expect(hubOn()).toBe(false);
      byId('exit').click();
      await game.settle();
      expect(hubOn()).toBe(true);
    });
    it('asks nothing of a table game, which is saved', async () => {
      const game = await boot('?bot=off', { deck: true });
      localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: [] }));
      await pick(game, 'ship');
      game.click(-1, -1);
      await playMove(game);
      byId('exit').click();
      await game.settle();
      expect(hubOn()).toBe(true);
    });
    it('Back asks nothing: it leaves the fight at once', async () => {
      const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
      await intoLair(game);
      fightPly(game);
      await pressBack(game);
      await game.settle();
      expect(data().boss).toBeUndefined();
      expect(data().openworld).toBeDefined();
    });
  });

  it('Back once the fight of a boss lair is won goes back to the world, as its button does', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    const { Encounter } = await import('edgefall-wasm');
    await pick(game, 'openworld');
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    document.getElementById('hub-confirm-yes')?.click(); // a tower or a gate opens its bay first: Enter starts the fight or the run (#1694)
    const won = (): number => (game.hook<number>('__plies') > 0 ? 1 : 0);
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(won);
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(won);
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [mq, mr] = move.cells[0]!;
    game.click(mq, mr);
    game.click(mq + (move.dir === 2 ? 1 : -1), mr + (move.dir === 2 ? -1 : 1));
    game.frame();
    expect(byId('exit').dataset.label).toBe('World');
    await pressBack(game);
    await game.settle();
    expect(hubOn()).toBe(false);
    expect(data().openworld).toBeDefined();
  });

  it('Back in a wild fight of the Open world is Flee: the hero is back in the world', async () => {
    const { world_enemies } = await import('edgefall-wasm');
    const world = (() => {
      for (let n = 1; n < 100; n++) {
        for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as Axial[]) {
          const flat = world_enemies(n, cx, cy);
          for (let i = 0; i < flat.length; i += 2) if (Math.max(Math.abs(flat[i]!), Math.abs(flat[i + 1]!), Math.abs(flat[i]! + flat[i + 1]!)) <= 10) return { seed: n, home: [flat[i]!, flat[i + 1]!] as Axial };
        }
      }
      throw new Error('no seed');
    })();
    const game = await boot(`?bot=off&openworld=${world.seed}`, { reducedMotion: true });
    await pick(game, 'openworld');
    const beside: Axial = [world.home[0] + 1, world.home[1]];
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: beside, troop: [] });
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    await new Promise((done) => setTimeout(done, 400)); // the wipe closes, the arena opens
    await game.settle();
    game.frame();
    expect(byId('wild-flee').hidden).toBe(false);
    await pressBack(game);
    await game.settle();
    expect(byId('wild-flee').hidden).toBe(true);
    expect(data().openworld).toBeDefined();
  });

  it('writing the online address fires popstate in Chrome: the room is not left', async () => {
    const game = await boot('?bot=off&net=hook');
    window.addEventListener('hashchange', () => window.dispatchEvent(new PopStateEvent('popstate', { state: null }))); // Chrome fires it with the write
    byId('play-online').click();
    await game.online();
    await game.settle();
    expect(location.hash).not.toBe('');
    expect(data().online).toBeDefined();
    expect(hubOn()).toBe(false);
  });

  it('an online room keeps what the browser does: Back drops the address and the room stays', async () => {
    const game = await boot('?bot=off&net=hook');
    byId('play-online').click();
    await game.online();
    game.frame();
    expect(location.hash).not.toBe('');
    await pressBack(game);
    expect(location.hash).toBe('');
    expect(data().online).toBeDefined();
    expect(hubOn()).toBe(false);
  });
});
