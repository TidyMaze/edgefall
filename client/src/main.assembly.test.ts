// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import type { Belts } from './assembly';
import { SLAM_MS } from './assembly';
import { boot, type Game, startBoss } from './test/harness';

// The Assembly Line on the harness (#744, game-design.md section 7.12): the three belts with their rollers, plates,
// ribs, chevrons and counter, the HUD line, the marbles the belts carry and drop, the reversal, the phases, the announced
// strike and its slam. ?bot=off plays both sides from the fixture of the core tests: fight seed 1, whose centre belt
// first runs toward +q. A boss marble falls off the east end after ply 7, the belt reverses after turn 5 (ply 9), P2
// starts after ply 19, P3 after ply 29, the presses are announced after ply 31 and strike a Black marble after ply 33.

const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const [E, W, NE, SW, NW, SE] = [0, 1, 2, 3, 4, 5];
const FIXTURE: [number, number, number][] = [
  [-4, 3, NE], [2, -2, SE], [-4, 4, NW], [2, -1, SE], [-4, 3, NW], [3, 0, E], [-4, 2, SE], [0, -2, SW], [-4, 3, NW],
  [-1, -1, SW], [-4, 2, SE], [-3, 0, W], [-4, 3, NW], [-1, -3, SW], [-4, 2, SE], [-2, -2, SW], [-4, 3, NW], [-3, -1, SW],
  [-4, 2, SE], [1, -2, SW], [-4, 3, NW], [-1, -1, W], [-4, 2, SE], [0, -3, SW], [-4, 3, NW], [-1, -2, SW], [-4, 2, SE],
  [1, -3, SW], [-4, 3, NW], [0, -4, SW], [-4, 2, NE], [-1, -3, E], [-3, 2, NW],
];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const belts = (game: Game) => game.hook<Belts | null>('__belts');
const phase = (): string => byId('hud').querySelector('.notch.active')!.textContent!;

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

/** Starts the fight against The Assembly Line from the mode menu, on fight seed 1. */
function fightAssembly(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(1);
    return a;
  });
  startBoss('The Assembly Line');
}

/** Plays ply `k` of the fixture by two clicks. */
function play(game: Game, k: number): void {
  const [q, r, dir] = FIXTURE[k]!;
  game.click(q, r);
  game.click(q + DIRS[dir]![0], r + DIRS[dir]![1]);
}

/** Plays plies `from` to `to` (excluded) of the fixture, the slides and falls run to their end. */
function plies(game: Game, from: number, to: number): void {
  for (let k = from; k < to; k++) {
    play(game, k);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);

describe('main.ts The Assembly Line (#744)', () => {
  it('plays on the Cargo deck with its Tally line and three belts: strips, rollers, ribs, plates, chevrons and a counter', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightAssembly(game);
    expect(body().boss).toBe('assembly');
    expect(body().deck).toBe('cargo');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Assembly Line');
    expect(game.hud()).toContain('Throughput on file. Every belt runs to the edge.');
    expect(tell()).toBe('Belts reverse in 5 turns');
    expect(belts(game)!.left).toBe(5);
    expect(body().beltDirs).toBe('1,0,0'); // only the centre belt runs, toward +q
    expect(body().beltCounter).toBe('5');
    expect(body().beltStrikes).toBe('-1,-1,-1');
    expect(named(scene(), 'belt')).toHaveLength(3);
    expect(named(scene(), 'belt-roller')).toHaveLength(6);
    expect(named(scene(), 'belt-plate')).toHaveLength(12); // 4 strike slots on each belt
    expect(named(scene(), 'belt-rib')).toHaveLength(56);
    expect(named(scene(), 'belt-chevron')).toHaveLength(9); // the centre belt only
    expect(named(scene(), 'belt-strike')).toHaveLength(0);
    const [counter] = named(scene(), 'belt-counter') as THREE.Sprite[];
    expect(counter!.material.depthTest).toBe(false); // never hidden behind a marble
    expect(counter!.position.x).toBeGreaterThan(4); // over the east roller, inside the terrace's rim (#1374); the room's stood past it at 5
    const belt = named(scene(), 'belt')[0]!;
    expect([belt.position.x, belt.position.z, belt.scale.x]).toEqual([0, 0, 10]);
  });

  it('a boss marble reaches the east end and falls off, credited to the player, then the belt reverses after turn 5', async () => {
    const game = await boot('?bot=off');
    fightAssembly(game);
    plies(game, 0, 6);
    expect(body().beltCounter).toBe('2');
    expect(body().ejecting).toBeUndefined();
    play(game, 6); // the player's 4th move: the white marble on (4, 0) is carried off, after the move's own slide
    game.frame(1000); // the move's slide ends: the belts play
    expect(body().ejecting).toBe('tumble');
    expect(body().ejections).toBe('1');
    expect(body().beltTurns).toBe('2');
    expect(body().beltCounter).toBe('1');
    for (let n = 0; n < 4; n++) game.frame(1000);
    expect(body().ejecting).toBeUndefined();
    expect(game.hook('__marbleTurn', 4, 0)).toBeNull();
    expect([...byId('hud').querySelectorAll('.pips > span')].map((s) => s.querySelectorAll('.out').length)).toEqual([1, 0]);
    plies(game, 7, 9); // the boss ply, then the player's 5th move
    expect(body().beltCounter).toBe('5');
    expect(body().beltDirs).toBe('-1,0,0');
    expect(tell()).toBe('Belts reverse in 5 turns');
  });

  it('the ribs scroll the way the belt runs', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightAssembly(game);
    const rib = named(scene(), 'belt-rib')[0]!;
    game.frame(100);
    const x = rib.position.x;
    game.frame(300);
    expect(rib.position.x).not.toBe(x);
  });

  it('under reduced motion the ribs hold still', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightAssembly(game);
    const rib = named(scene(), 'belt-rib')[0]!;
    game.frame(100);
    const x = rib.position.x;
    game.frame(400);
    expect(rib.position.x).toBe(x);
  });

  it('a game that is no Assembly Line fight draws no belts', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__belts')).toBeNull();
    expect(body().beltCounter).toBe('');
  });

  it.each(['&scene=room', ''])('runs the side belts from P2 against the centre belt, then announces a strike per belt from P3 and slams on it %s', async (look) => {
    const scene = catchScene();
    const game = await boot(`?bot=off${look}`);
    fightAssembly(game);
    plies(game, 0, 19);
    expect(phase()).toBe('P2');
    expect(body().beltDirs).toBe('1,-1,-1'); // the side belts run from the next turn, against the centre belt
    expect(named(scene(), 'belt-chevron')).toHaveLength(9 + 8 + 8);
    plies(game, 19, 29);
    expect(phase()).toBe('P3');
    plies(game, 29, 31);
    expect(body().beltStrikes).toBe('0,7,1');
    expect(tell()).toBe('Belts reverse in 4 turns · press strikes next turn');
    expect(named(scene(), 'belt-strike')).toHaveLength(3);
    expect(named(scene(), 'belt-press')).toHaveLength(3);
    plies(game, 31, 32); // the boss ply
    expect(body().beltStrikes).toBe('0,7,1');
    play(game, 32); // the player's marble steps onto the lower belt, where the press strikes it
    game.frame(1000); // the move's slide ends: the belts and the press play
    expect(body().burns).toBe('1');
    expect(body().slams).toBe('1');
    const [press] = named(scene(), 'belt-slam');
    expect(press!.position.y + press!.userData.base).toBeGreaterThan(1); // the gantry of the terrace stands on its base (#1374)
    game.frame(SLAM_MS / 3);
    expect(press!.position.y).toBeLessThan(0.5);
    game.frame(SLAM_MS);
    expect(named(scene(), 'belt-slam')).toHaveLength(0);
    for (let n = 0; n < 4; n++) game.frame(1000);
    expect(body().beltStrikes).toBe('-1,-1,-1');
    expect([...byId('hud').querySelectorAll('.pips > span')].map((s) => s.querySelectorAll('.out').length)).toEqual([5, 1]);
  });

  it('under reduced motion no press slams, and a click ends a slam at once', async () => {
    const reduced = await boot('?bot=off', { reducedMotion: true });
    fightAssembly(reduced);
    plies(reduced, 0, 33);
    expect(body().burns).toBe('1');
    expect(body().slams).toBeUndefined();

    const scene = catchScene();
    const game = await boot('?bot=off');
    fightAssembly(game);
    plies(game, 0, 32);
    play(game, 32);
    game.frame(1000);
    expect(named(scene(), 'belt-slam')).toHaveLength(1);
    dispatchEvent(new PointerEvent('pointerdown'));
    expect(named(scene(), 'belt-slam')).toHaveLength(0);
  });
});
