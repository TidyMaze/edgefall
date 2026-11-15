// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { boot, type Game, startBoss } from './test/harness';

// The Magnetizer on the harness (#645, #671, game-design.md section 7.9): the + and − glyphs over the polarized
// marbles, the announce one turn ahead, the ring on a fresh one, the HUD line, and the repulsions played in the engine's
// order, the pair's glyphs fading out. ?bot=off plays both sides from the fixture of the core tests: fight seed 120,
// quiet boss moves on the right, the player walks the centre column up. The starts of turns 3 and 6 polarize two of its
// marbles, + then −; on turn 6 the second steps next to the first, which shoves the boss column of 3 off at
// (0, -4), and both lose their sign. Three marbles in line then push the rest of the column off twice: P2.

type Pole = { cell: Axial; sign: number; fresh: boolean };
type Announce = { cell: Axial; sign: number } | null;
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const NE = 2;
const SW = 3;
const NW = 4;
const SE = 5;
const FIXTURE: [Axial[], number][] = [
  [[[0, 2]], NW], [[[4, -3]], SE], [[[0, 1]], NW], [[[4, -2]], SE], [[[0, 0]], NW], [[[4, -1]], SE], [[[0, 3]], NW],
  [[[3, -3]], SE], [[[0, 2]], NW], [[[3, -2]], SE], [[[0, 1]], NW], [[[4, -4]], SE], [[[0, 1]], NW], [[[4, -3]], SE],
  [[[0, 0]], NW], [[[3, -4]], SE], [[[-1, 2]], NE], [[[3, -3]], SE], [[[0, 1]], NW], [[[4, -2]], SE],
  [[[0, -2], [0, -1], [0, 0]], NW], [[[4, 0]], SW], [[[0, -3], [0, -2], [0, -1]], NW],
];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const poles = (game: Game): Pole[] => game.hook<Pole[]>('__polarities');
const announce = (game: Game): Announce => game.hook<Announce>('__announce');

/** Catches the scene main.ts builds: call before boot. */
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && !scene) scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}

/** Starts the fight against The Magnetizer from the mode menu, on fight seed `seed`. */
function fightMagnetizer(game: Game, seed = 120): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(seed);
    return a;
  });
  startBoss('The Magnetizer');
}

/** Plays ply `i` of the fixture by clicks: its marbles, then the cell in front of the first one. */
function ply(game: Game, i: number): void {
  const [cells, dir] = FIXTURE[i]!;
  for (const [q, r] of cells) game.click(q, r);
  game.click(cells[0]![0] + DIRS[dir]![0], cells[0]![1] + DIRS[dir]![1]);
}

/** Plays plies `from` to `to` (excluded) of the fixture, the slides run to their end. */
function plies(game: Game, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    ply(game, i);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

const marbleAt = (game: Game, q: number, r: number): unknown => game.hook('__marbleTurn', q, r);

describe('main.ts The Magnetizer announce blinks (#741)', () => {
  it('the announced marble blinks in opacity about once a second until it gets its sign', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightMagnetizer(game);
    expect(body().announceBlink).toBeUndefined(); // nothing announced yet
    plies(game, 0, 2);
    const seen: number[] = [];
    for (let n = 0; n < 10; n++) {
      game.frame(100);
      seen.push(Number(body().announceBlink));
    }
    expect(Math.min(...seen)).toBeLessThan(0.5);
    expect(Math.max(...seen)).toBeGreaterThan(0.9);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.3);
    expect(scene().getObjectByName('announce-ring')!.visible).toBe(false);
    plies(game, 2, 4); // the start of turn 3: it has its sign
    expect(body().announceBlink).toBeUndefined();
  });

  it('with reduced motion it wears a steady outline instead', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightMagnetizer(game);
    plies(game, 0, 2);
    game.frame(500);
    expect(scene().getObjectByName('announce-ring')!.visible).toBe(true);
    expect(body().announceBlink).toBe('1.00');
  });
});

describe('main.ts The Magnetizer (#645, #671)', () => {
  it('announces the marble a turn ahead with an indicator over it, then draws its glyph with the ring', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightMagnetizer(game);
    expect(body().boss).toBe('magnetizer');
    expect(body().deck).toBe('furnace');
    expect(game.hud()).toContain('Poles on file. Charge against charge, entered as a push.');
    expect(tell()).toBe('Polarity in 2 turns');
    plies(game, 0, 2); // the start of turn 2: turn 3 is announced
    const coming = announce(game)!;
    expect(Math.abs(coming.sign)).toBe(1);
    expect(poles(game)).toEqual([]);
    expect(tell()).toBe('Polarity next turn');
    const indicator = scene().getObjectByName('announce') as THREE.Sprite;
    expect(indicator.material.depthTest).toBe(false);
    expect(indicator.position.y).toBeGreaterThan(1);
    plies(game, 2, 3);
    const followed = announce(game)!; // it follows its marble
    expect(followed.sign).toBe(coming.sign);
    plies(game, 3, 4); // the start of turn 3
    expect(poles(game)).toEqual([{ cell: followed.cell, sign: coming.sign, fresh: true }]);
    expect(announce(game)).toBeNull();
    expect(scene().getObjectByName('announce')).toBeUndefined();
    expect(tell()).toBe('Polarity in 3 turns');
    plies(game, 4, 5); // the ring lasts until the next ply
    expect(poles(game).map((p) => p.fresh)).toEqual([false]);
  });

  it('a marble stepping next to its opposite shoves the boss column of 3: the pair slides apart, its glyphs fade', async () => {
    const game = await boot('?bot=off');
    fightMagnetizer(game);
    plies(game, 0, 10);
    expect(poles(game)).toHaveLength(2);
    const ejections = Number(body().ejections ?? 0);
    ply(game, 10); // turn 6: the second marble steps next to the first
    expect(body().sliding).toBe('1');
    expect(marbleAt(game, 0, -4)).not.toBeNull(); // the move slides first, on the board before the repulsion
    expect(poles(game)).toHaveLength(2);
    expect(body().repulsions).toBeUndefined();
    game.frame(1000); // the move slide ends: the repulsion plays
    expect(body().repulsions).toBe('1');
    expect(body().sliding).toBe('1');
    expect(Number(body().ejections)).toBe(ejections + 1);
    expect(body().ejecting).toBe('tumble');
    expect(poles(game)).toEqual([]); // the pair is spent
    expect(game.hook<number[]>('__fading')).toEqual([1, 1]);
    game.frame(100);
    const half = game.hook<number[]>('__fading');
    expect(half).toHaveLength(2);
    expect(half[0]).toBeGreaterThan(0);
    expect(half[0]).toBeLessThan(1);
    game.frame(1000);
    expect(game.hook('__fading')).toEqual([]);
    expect(body().sliding).toBeUndefined();
    expect(game.hud()).toContain('1/6');
  });

  it('reduced motion jumps to the board after the repulsions, and 3 ejections bring P2', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightMagnetizer(game);
    plies(game, 0, 11);
    expect(body().repulsions).toBeUndefined();
    expect(game.hud()).toContain('1/6');
    expect(marbleAt(game, 0, -2)).not.toBeNull();
    expect(poles(game)).toEqual([]);
    plies(game, 11, 23);
    expect(game.hud()).toContain('3/6');
    expect(tell()).toBe('Polarity in 3 turns'); // turn 12 of P2: the next one is turn 15 (#1237)
  });

  it('a new fight during the repulsions draws its own board', async () => {
    const game = await boot('?bot=off');
    fightMagnetizer(game);
    plies(game, 0, 10);
    ply(game, 10);
    fightMagnetizer(game); // Retry by the menu while the move slides
    game.frame(1000);
    game.frame(1000);
    expect(poles(game)).toEqual([]);
    expect(body().repulsions).toBeUndefined();
    expect(marbleAt(game, 0, 2)).not.toBeNull(); // the start position
  });

  it('a game that is no Magnetizer fight draws no polarity and no announce', async () => {
    const game = await boot('?bot=off');
    expect(poles(game)).toEqual([]);
    expect(announce(game)).toBeNull();
    expect(tell()).toBeUndefined();
  });
});
