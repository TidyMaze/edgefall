// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { IDBFactory } from 'fake-indexeddb';
import { boot, type Game, startBoss } from './test/harness';

// The Stalker as a boss (#1111, docs/specs/stalker.md): picked in the Boss fight list, fogged from the engine's getters
// (sight, visible cells, revealed marbles), the sight on the HUD. The refusal itself is a core test; here the client
// reads what the engine says.

type Shown = { visible: Axial[]; drawn: Axial[]; revealed: Axial[]; last: Axial[] } | null;
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const shown = (game: Game): Shown => game.hook<Shown>('__stalker');

function pickStalker(): void {
  startBoss('The Stalker');
}

describe('main.ts The Stalker boss (#1111)', () => {
  it('is a boss, fogged at sight 3, with the sight on the HUD', async () => {
    const game = await boot('/');
    expect(shown(game)).toBeNull();
    pickStalker();
    const s = shown(game)!;
    expect(s.visible).toHaveLength(41); // sight 3 of the 14 starting marbles
    expect(s.drawn).toEqual([]);
    expect(game.hud()).toContain('Sight 3 · narrows to 2 after 3 more ejections');
    expect(game.hud()).not.toContain('not fogged');
    expect((byId('auto-play') as HTMLButtonElement).disabled).toBe(true);
    expect(byId('auto-reason').textContent).toMatch(/^Beat The Stalker once/); // the boss's medal reason, not the mode's
  });

  it('draws the marbles a refused move revealed, from the engine, and the player plays again', async () => {
    const game = await boot('/', { storage: { 'ab-alone.difficulty': 'normal' } });
    const { Encounter } = await import('edgefall-wasm'); // the harness's instance
    pickStalker();
    const play = vi.spyOn(Encounter.prototype, 'play').mockImplementationOnce(() => {
      throw 'Hidden';
    });
    vi.spyOn(Encounter.prototype, 'revealed').mockReturnValue(Int32Array.from([0, -2]));
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    expect(play).toHaveBeenCalledTimes(1);
    expect(game.hook('__plies')).toBe(0);
    expect(shown(game)!.revealed).toEqual([[0, -2]]);
    expect(shown(game)!.drawn).toEqual([[0, -2]]);
    expect(game.hook('__rings')).toEqual([]);
    vi.restoreAllMocks();
  });

  it('reads the last phase as Sight 1 with nothing left to narrow', async () => {
    const game = await boot('/');
    const { Encounter } = await import('edgefall-wasm');
    vi.spyOn(Encounter.prototype, 'stalker').mockReturnValue(Int32Array.from([1, -1]));
    pickStalker();
    expect(game.hud()).toContain('Sight 1');
    expect(game.hud()).not.toContain('narrows');
    vi.restoreAllMocks();
  });

  it("rings the boss's last move where it landed in sight, and the ring is part of the shown state (#1111)", async () => {
    const game = await boot('/');
    pickStalker();
    expect(shown(game)!.last).toEqual([]);
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    game.frame(300);
    await game.settle();
    game.frame(300);
    expect(game.hook<number>('__plies')).toBeGreaterThanOrEqual(2); // the boss answered
    expect(shown(game)!.last.length).toBeGreaterThan(0); // its marble landed within the sight of three
    byId('replay').click(); // a review shows the position, not the last move of the live game
    game.frame(300);
    expect(shown(game)!.last).toEqual([]);
  });

  it('lets any other error of a move through', async () => {
    const game = await boot('/?bot=off');
    const { Engine } = await import('edgefall-wasm');
    vi.spyOn(Engine.prototype, 'play').mockImplementation(() => {
      throw new Error('broken');
    });
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    expect(() => game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell)).toThrow('broken');
    vi.restoreAllMocks();
  });

  it('comes back under its fog after a reload, and Retry replaces the saved fight (#1122)', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('/', { indexedDB });
    pickStalker();
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    await game.settle();
    const plies = game.hook<number>('__plies');
    expect(plies).toBeGreaterThan(0);
    const history = game.hook('__history');
    const again = await boot('/', { indexedDB });
    expect(again.hook('__history')).toEqual(history);
    expect(again.hud()).toContain('Sight 3');
    expect(shown(again)!.visible.length).toBeGreaterThan(0);
    expect(byId('boss-retry').hidden).toBe(false);
    byId('boss-retry').click(); // a new fight over the same seed: the save starts over
    await again.settle();
    const third = await boot('/', { indexedDB });
    expect(third.hook('__plies')).toBe(0);
    expect(third.hud()).toContain('Sight 3');
  });

  it('does not save the other bosses', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('/', { indexedDB });
    startBoss('The Echo'); // The Echo
    await game.settle();
    const again = await boot('/', { indexedDB });
    expect(shown(again)).toBeNull();
  });
});
