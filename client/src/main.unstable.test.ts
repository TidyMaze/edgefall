// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { FLASH_MS, SWEEP_MS, WARN_COLOR, type Charge, type Core } from './unstable';
import { boot, type Game, startBoss } from './test/harness';

// The Unstable Core on the harness (#751, game-design.md section 7.13): the glowing energy cells, the pips over the
// charged marbles, the weighted push, the overload burst, the collapse of the core, the glowing wedge and the shockwave.
// ?bot=off plays both sides from the fixtures of the core tests: PUSH, a charged pair that pushes three, and FULL, the
// 17-ply fight (fight seed 2): the boss overloads on plies 8 and 10, the core collapses on ply 11 with its 3rd marble
// on it, and the wedge shockwave hits on ply 17 and shoves 4 of the player's rim marbles off.

const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const [E, W, NE, SW, NW, SE] = [0, 1, 2, 3, 4, 5];
const PUSH: [Axial[], number][] = [
  [[[0, 2], [0, 3]], NW],
  [[[-1, -3]], SW],
  [[[0, 1], [0, 2]], NW],
  [[[-2, -2]], NE],
  [[[0, 0], [0, 1]], NW],
  [[[-1, -3]], SW],
  [[[0, -1], [0, 0]], NW],
];
const FULL: [number, number, number][] = [
  [1, 3, NE], [0, -2, SE], [2, 2, SW], [2, -2, SW], [1, 3, NE], [0, -3, SE], [2, 2, SW], [3, -3, SW], [1, 3, NE],
  [1, -2, SW], [2, 2, SW], [2, -2, E], [1, 3, NE], [3, -2, W], [2, 2, SW], [2, -2, E], [1, 3, NE],
];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const unstable = (game: Game) => game.hook<(Core & { pips: Charge[] }) | null>('__unstable');
const sweep = (game: Game) => game.hook<{ scale: number; opacity: number } | null>('__sweep');
const marbleAt = (game: Game, q: number, r: number): unknown => game.hook('__marbleTurn', q, r);
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);

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

/** Starts the fight against The Unstable Core from the mode menu, on fight seed 2. */
function fightCore(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(2);
    return a;
  });
  startBoss('The Unstable Core');
}

/** Plays a move of the group `cells` in direction `dir` by clicks: the marbles, then the cell ahead of the group. */
function move(game: Game, cells: Axial[], dir: number): void {
  for (const [q, r] of cells) game.click(q, r);
  const [dq, dr] = DIRS[dir]!;
  const ahead = cells.map(([q, r]): Axial => [q + dq, r + dr]).find(([q, r]) => !cells.some(([cq, cr]) => cq === q && cr === r))!;
  game.click(...ahead);
}

/** Plays plies `from` to `to` (excluded) of FULL, the slides and effects run to their end. */
function full(game: Game, from: number, to: number): void {
  for (let k = from; k < to; k++) {
    move(game, [[FULL[k]![0], FULL[k]![1]]], FULL[k]![2]);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

function push(game: Game, from: number, to: number): void {
  for (let k = from; k < to; k++) {
    move(game, ...PUSH[k]!);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

const warning = (scene: THREE.Scene): number =>
  (named(scene, 'charge-pip') as THREE.Mesh[]).filter((m) => (m.material as THREE.MeshStandardMaterial).color.getHex() === WARN_COLOR).length;

describe('main.ts The Unstable Core (#751)', () => {
  it('plays on the Furnace with its Tally line, the 7 energy cells glowing and the rule on the plate', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightCore(game);
    expect(body().boss).toBe('core');
    expect(body().deck).toBe('furnace');
    expect(game.hud()).toContain('Charges on file. Four and a marble is written off.');
    expect(tell()).toBe('Charged marbles weigh more · 4 charges blow a marble off');
    expect(named(scene(), 'energy-cell')).toHaveLength(7);
    expect(named(scene(), 'charge-pip')).toHaveLength(0);
    expect(unstable(game)).toEqual({ core: true, collapsing: false, wedge: -1, shockIn: -1, pips: [] });
    const material = (named(scene(), 'energy-cell')[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    game.frame(100);
    expect(material.opacity).toBe(0.5); // steady under reduced motion
  });

  it('the energy cells pulse', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightCore(game);
    const material = (named(scene(), 'energy-cell')[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    game.frame(0);
    const first = material.opacity;
    game.frame(500);
    expect(material.opacity).not.toBe(first);
  });

  it('a marble on the core wears 1 to 3 pips, red at 3, and a charged pair pushes three', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightCore(game);
    push(game, 0, 1);
    expect(named(scene(), 'charge-pip')).toHaveLength(1);
    expect(unstable(game)!.pips).toEqual([{ cell: [0, 1], n: 1 }]);
    push(game, 1, 3);
    expect(named(scene(), 'charge-pip')).toHaveLength(3); // (0, 0) at 2, (0, 1) at 1
    expect(warning(scene())).toBe(0);
    push(game, 3, 6);
    expect(named(scene(), 'charge-pip')).toHaveLength(5); // (0, -1) at 3, (0, 0) at 2
    expect(warning(scene())).toBe(3);
    const pips = named(scene(), 'charge-pip') as THREE.Mesh[];
    expect(pips[0]!.geometry.type).toBe('OctahedronGeometry'); // a shape, not a colour only
    const legal = game.hook<{ cells: Axial[]; dir: number }[]>('__legal');
    expect(legal.some((m) => m.dir === NW && m.cells.length === 2 && m.cells.some(([q, r]) => q === 0 && r === -1))).toBe(true);
    push(game, 6, 7); // 2 charged marbles against 3 plain ones: the last falls off the top
    expect(game.hud()).toContain('1/6');
    expect(marbleAt(game, 0, -2)).not.toBeNull();
    expect(marbleAt(game, 0, -4)).not.toBeNull();
    expect(unstable(game)!.pips.map((p) => p.n)).toEqual([2, 3]);
  });

  it('a boss marble that overloads bursts into a ring and leaves the board for the player', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightCore(game);
    full(game, 0, 7);
    expect(marbleAt(game, 0, -1)).not.toBeNull();
    move(game, [[3, -3]], SW); // the 8th ply, the boss's: its marble on (0, -1) overloads
    expect(marbleAt(game, 0, -1)).not.toBeNull(); // the move slides first on the board before the hook
    expect(body().bursts).toBeUndefined();
    game.frame(1000);
    expect(body().bursts).toBe('1');
    expect(named(scene(), 'burst')).toHaveLength(1);
    expect(marbleAt(game, 0, -1)).toBeNull();
    expect(game.hud()).toContain('1/6');
    game.frame(100);
    const small = (named(scene(), 'burst')[0] as THREE.Mesh).scale.x;
    game.frame(200);
    expect((named(scene(), 'burst')[0] as THREE.Mesh).scale.x).toBeGreaterThan(small);
    game.frame(1000);
    expect(named(scene(), 'burst')).toHaveLength(0);
  });

  it('the core flickers the turn before it collapses, then its marble falls with it and the energy cells go', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightCore(game);
    full(game, 0, 9);
    expect(unstable(game)).toMatchObject({ core: true, collapsing: false });
    full(game, 9, 10); // the boss ply of P2 announces
    expect(unstable(game)).toMatchObject({ core: true, collapsing: true });
    expect(tell()).toBe('The core collapses after your move');
    const material = (named(scene(), 'energy-cell')[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const seen = new Set<number>();
    for (const ms of [0, 130, 260, 390]) {
      game.frame(ms);
      seen.add(material.opacity);
    }
    expect(seen.size).toBe(2); // it flickers
    move(game, [[2, 2]], SW); // ply 11: the core collapses
    game.frame(1000);
    expect(body().bursts).toBe('3'); // plies 8 and 10 overloaded, the 3rd marble falls with the core
    expect(named(scene(), 'energy-cell')).toHaveLength(0);
    expect(marbleAt(game, 0, -1)).toBeNull();
    expect(unstable(game)).toMatchObject({ core: false, collapsing: false, shockIn: 3 });
    expect(tell()).toBe('Shockwave in 3 turns');
    expect(byId('hud').querySelector('.notch.active')!.textContent).toBe('P3');
    expect(game.hud()).toContain('3/6');
  });

  it('the announced wedge glows, then its slice sweeps outward and shoves its marbles, the rim ones fall', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightCore(game);
    full(game, 0, 15);
    expect(named(scene(), 'wedge-glow')).toHaveLength(1);
    expect(tell()).toBe('Shockwave after your move: the glowing wedge');
    expect(unstable(game)).toMatchObject({ wedge: 4, shockIn: 1 });
    const glow = (named(scene(), 'wedge-glow')[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    game.frame(0);
    const lit = glow.opacity;
    game.frame(300);
    expect(glow.opacity).not.toBe(lit);
    full(game, 15, 16);
    move(game, [[1, 3]], NE); // ply 17: the shockwave
    expect(marbleAt(game, -4, 4)).not.toBeNull(); // the move slides first, on the board before the shockwave
    game.frame(1000);
    expect(body().shockwaves).toBe('1');
    expect(sweep(game)!.scale).toBeLessThan(0.1);
    expect(body().sliding).toBe('1'); // the marbles that stay on the board slide a cell
    expect(body().ejecting).toBe('tumble'); // the rim ones fall
    expect(marbleAt(game, -4, 4)).toBeNull();
    expect(marbleAt(game, -3, 3)).toBeNull(); // (-3, 3) moved out
    expect(marbleAt(game, -3, 4)).not.toBeNull(); // to (-3, 4), freed by the rim marble
    game.frame(SWEEP_MS / 2);
    expect(sweep(game)!.scale).toBeGreaterThan(0.5);
    const grown = sweep(game)!.scale;
    game.frame(100);
    expect(sweep(game)!.scale).toBeGreaterThan(grown); // it grows frame by frame (the e2e #751 checked this, now removed)
    game.frame(SWEEP_MS);
    expect(sweep(game)).toBeNull();
    expect(named(scene(), 'wedge-glow')).toHaveLength(0);
    expect(game.hud()).toContain('4/6'); // 4 rim marbles of the player fell: the boss's
    expect(unstable(game)).toMatchObject({ wedge: -1, shockIn: 4 });
  });

  it('under reduced motion the burst and the slice show whole and fade, and a click ends them', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightCore(game);
    full(game, 0, 7);
    move(game, [[3, -3]], SW);
    expect(body().bursts).toBe('1');
    const burst = named(scene(), 'burst')[0] as THREE.Mesh;
    game.frame(0);
    const size = burst.scale.x;
    game.frame(FLASH_MS / 2);
    expect(burst.scale.x).toBe(size);
    dispatchEvent(new PointerEvent('pointerdown')); // a click skips the effect
    expect(named(scene(), 'burst')).toHaveLength(0);
    full(game, 8, 16);
    expect(unstable(game)!.wedge).toBe(4);
    move(game, [[1, 3]], NE);
    expect(body().shockwaves).toBe('1');
    expect(body().sliding).toBeUndefined(); // the marbles jump
    expect(sweep(game)!.scale).toBe(1);
    game.frame(FLASH_MS / 2);
    expect(sweep(game)!.opacity).toBeLessThan(0.8);
    dispatchEvent(new PointerEvent('pointerdown'));
    expect(sweep(game)).toBeNull();
  });

  it('a game that is no Unstable Core fight draws nothing of it', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    expect(unstable(game)).toBeNull();
    expect(named(scene(), 'energy-cell')).toHaveLength(0);
    expect(tell()).toBeUndefined();
  });
});
