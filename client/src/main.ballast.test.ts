// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import type { View } from './camera';
import { boot, type Game, startBoss } from './test/harness';

// The Ballast Mind on the harness (#749, game-design.md section 7.5): every 2 turns it borrows an effect of another
// boss, named in the HUD during the turn before. ?bot=off plays both sides, one-marble moves, so no boss search runs.
// Fight seed 0 borrows the Magnetizer's polarity, 4 the Hull's crack, 6 the Pulsar's pulse, 2 the Chaplain's check,
// 3 the Swarm's wave.

type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const tell = (): string => byId('hud').querySelector('.boss .tell')?.textContent ?? '';

function fightBallast(game: Game, seed: number): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(seed);
    return a;
  });
  startBoss('The Ballast Mind');
}

/** Plays `n` plies, the first one-marble move of the side to move each time, the slides run to their end. */
function plies(game: Game, n: number): void {
  for (let k = 0; k < n; k++) {
    const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
    const [q, r] = mv.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[mv.dir]![0], r + DIRS[mv.dir]![1]);
    for (let f = 0; f < 4; f++) game.frame(1000);
  }
}

describe('main.ts The Ballast Mind announce (#749)', () => {
  it.each([
    [0, "Next turn: the Magnetizer's polarity"],
    [4, "Next turn: the Hull's crack"],
    [6, "Next turn: the Pulsar's pulse"],
    [2, "Next turn: the Chaplain's conversion check"],
    [3, "Next turn: the Swarm's wave"],
  ])('fight seed %i names its effect during turn 2 only', async (seed, text) => {
    const game = await boot('?bot=off');
    fightBallast(game, seed);
    plies(game, 1);
    expect(tell()).not.toContain('Next turn');
    plies(game, 1);
    expect(tell()).toContain(text);
    plies(game, 1);
    expect(tell()).toContain(text);
    plies(game, 1);
    expect(tell()).not.toContain('Next turn');
  });

  it('plays the borrowed pulse with the Pulsar shockwave', async () => {
    const game = await boot('?bot=off');
    fightBallast(game, 6);
    plies(game, 3);
    expect(document.body.dataset.pulses).toBeUndefined();
    plies(game, 1);
    expect(document.body.dataset.pulses).toBe('1');
  });
});

describe('main.ts The Ballast Mind marks (#838)', () => {
  type Fired = { effect: number; cells: Axial[] } | null;

  it('shows the announced pulse on its pulsar, rippling, one turn ahead', async () => {
    const game = await boot('?bot=off');
    fightBallast(game, 6);
    plies(game, 1);
    expect(game.hook('__pulsar')).toBeNull();
    expect(document.body.dataset.ripples).toBe('0');
    plies(game, 1);
    expect(game.hook('__pulsar')).toMatchObject({ left: 1, charging: true });
    expect(Number(document.body.dataset.ripples)).toBeGreaterThan(0);
    expect(document.body.dataset.pulseCounter).toBe('1');
    expect(game.hook<unknown[]>('__pulsarRects')).toHaveLength(1); // only the pulsar that fires, no chevrons of the radius 4 board
    plies(game, 2);
    expect(game.hook('__pulsar')).toBeNull();
    expect(document.body.dataset.ripples).toBe('0');
  });

  it.each([
    [6, 1, "Fired: the Pulsar's pulse"],
    [4, 0, "Fired: the Hull's crack"],
    [2, 3, "Fired: the Chaplain's conversion check"],
    [0, 2, "Fired: the Magnetizer's polarity"],
    [3, 4, "Fired: the Swarm's wave"],
  ])('fight seed %i fires effect %i, named in the HUD with a mark on each cell it touched', async (seed, effect, text) => {
    const game = await boot('?bot=off');
    fightBallast(game, seed);
    plies(game, 3);
    expect(game.hook<Fired>('__fired')).toBeNull();
    expect(tell()).not.toContain('Fired');
    plies(game, 1);
    const fired = game.hook<Fired>('__fired')!;
    expect(fired.effect).toBe(effect);
    expect(tell()).toContain(text);
    expect(document.body.dataset.fired).toBe(String(fired.cells.length));
    if (effect === 0) expect(fired.cells).toEqual(game.hook<{ cell: Axial }[]>('__cracks').map((c) => c.cell));
    // A check that flipped nothing: no mark.
    if (effect === 3) expect(fired.cells).toEqual([]);
    else expect(fired.cells.length).toBeGreaterThan(0);
    plies(game, 1);
    expect(game.hook<Fired>('__fired')).toBeNull();
    expect(document.body.dataset.fired).toBe('0');
    expect(tell()).not.toContain('Fired');
  });
});

describe('main.ts The Ballast Mind on the terrace (#1374)', () => {
  it('opens from the Blender camera, drawn back to a radius 5 board, whenever the terrace comes', async () => {
    const game = await boot('?bot=off');
    fightBallast(game, 0);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const view = game.hook<View>('__view');
    expect(view.azimuth).toBe(0);
    expect(view.polar).toBeCloseTo((40 * Math.PI) / 180);
    expect(view.distance).toBeGreaterThanOrEqual((13.6 * 5) / 4 - 1e-9);
  });
});
