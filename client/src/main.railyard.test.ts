// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { JUMP_MS, PASS_MS, type Train } from './railyard';
import { boot, type Game, startBoss } from './test/harness';

// The Rail Yard on the harness (#626, game-design.md section 7.8): the announced train's rails, chevrons and counter,
// the count down after each player move, the pass that knocks both sides' marbles off its line, and the phase after 3
// ejections. ?bot=off plays both sides from a fixture: fight seed 77 announces the first train, at the end of the player's turn 1, on the diagonal
// q + r = 0, from (4, -4) to (-4, 4), with 3 marbles of each side on it.

type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const SEED = 77;

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

/** Starts the fight against The Rail Yard from the mode menu, on fight seed `SEED`. */
function fightRailYard(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(SEED);
    return a;
  });
  startBoss('The Rail Yard');
}

const trains = (game: Game): Train[] => game.hook<Train[]>('__trains');
const to = ({ cells, dir }: Move): Axial => [cells[0]![0] + DIRS[dir]![0], cells[0]![1] + DIRS[dir]![1]];

/** One quiet ply, once the last slide is over: the first one-marble move of the side to move that starts and ends off
 * every announced line. */
function quiet(game: Game): void {
  game.frame(1000);
  const rails = trains(game).flatMap((t) => t.cells.map(String));
  const off = (c: Axial): boolean => !rails.includes(String(c));
  const mv = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && off(m.cells[0]!) && off(to(m)))!;
  game.click(...mv.cells[0]!);
  game.click(...to(mv));
}

function plies(game: Game, n: number): void {
  for (let i = 0; i < n; i++) quiet(game);
}

const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);
const activePhase = (): string => byId('hud').querySelector('.notch.active')!.textContent!;

describe('main.ts The Rail Yard (#626)', () => {
  it('plays on the Cargo deck with its Tally line, the first train announced on turn 2 with its rails, chevrons and counter', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightRailYard(game);
    expect(body().boss).toBe('railyard');
    expect(body().deck).toBe('cargo');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Rail Yard');
    expect(game.hud()).toContain('Freight on schedule. Nothing on the line stops it.');
    expect(trains(game)).toEqual([]); // none at the start
    expect(body().trains).toBe('0');
    plies(game, 1); // the end of the player's turn 1
    expect(trains(game)).toEqual([expect.objectContaining({ line: 22, left: 5, dir: 3 })]);
    expect(trains(game)[0]!.cells[0]).toEqual([4, -4]);
    expect(body().trains).toBe('1');
    expect(body().trainCounters).toBe('5');
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Trains pass: 1 in 5 turns');
    expect(named(scene(), 'chevron')).toHaveLength(9); // one per cell of the line
    expect(named(scene(), 'edge-chevron')).toHaveLength(2); // where it enters and leaves
    expect(named(scene(), 'rail')).toHaveLength(2);
    const [counter] = named(scene(), 'train-counter') as THREE.Sprite[];
    expect(counter!.material.depthTest).toBe(false); // never hidden behind a marble
    const entry = named(scene(), 'edge-chevron')[0]!;
    expect([counter!.position.x, counter!.position.z]).toEqual([entry.position.x, entry.position.z]);
    expect(counter!.position.y).toBeGreaterThan(entry.position.y);
  });

  it.each([['', 2], ['&scene=room', 0]])('counts down after each player move, then the train passes and ejects the marbles of both sides on its line%s', async (look, buffers) => {
    const scene = catchScene();
    const game = await boot(`?bot=off${look}`);
    fightRailYard(game);
    plies(game, 1);
    const counts: string[] = [body().trainCounters!];
    for (let ply = 2; ply <= 10; ply++) {
      quiet(game);
      counts.push(body().trainCounters!);
    }
    expect(counts).toEqual(['5', '5', '4', '4', '3', '3', '2', '2', '1', '1']); // a boss turn does not count
    expect(activePhase()).toBe('P1');
    quiet(game); // the player's 6th move: the train passes before the boss replies
    expect(body().trains).toBe('0');
    expect(body().passing).toBe('1');
    expect(game.hook('__passes')).toEqual([expect.objectContaining({ line: 22 })]);
    const [train] = named(scene(), 'train');
    expect(train!.children.map((c) => c.name)).toContain('loco-cab');
    expect(train!.children.filter((c) => c.name.endsWith('-ore'))).toHaveLength(2);
    const start = train!.position.clone();
    expect(body().ejecting).toBe('tumble'); // the 6 marbles wait on their cells for the train
    expect(named(scene(), 'rail')).toHaveLength(2); // on its rails, which stay until it is gone
    const stops = named(scene(), 'rail')[0]!.parent!.children.filter((c) => ((c as THREE.Mesh).geometry as THREE.BoxGeometry).parameters?.height === 0.1);
    expect(stops).toHaveLength(buffers); // a buffer stop of the boss kit at each end of its line on the terrace (#1374)
    game.frame(PASS_MS / 2);
    expect(train!.position.distanceTo(start)).toBeGreaterThan(3); // it runs the line
    game.frame(PASS_MS);
    expect(body().passing).toBe('0');
    expect(named(scene(), 'train')).toHaveLength(0);
    expect(named(scene(), 'rail')).toHaveLength(0);
    expect(body().ejecting).toBeUndefined();
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Rail Yard');
    expect([...byId('hud').querySelectorAll('.pips > span')].map((side) => side.querySelectorAll('.out').length)).toEqual([3, 3]); // 3 boss marbles for the player, 3 of the player's for the boss
    expect(activePhase()).toBe('P2'); // the 3 boss marbles count for the player: P2 after 3 ejections
    expect(game.hook<Move[]>('__legal').some((m) => String(m.cells) === '3,-3')).toBe(false); // gone from the line
  });

  it('under reduced motion the train jumps across, and a click ends the pass at once', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightRailYard(game);
    plies(game, 11);
    const [train] = named(scene(), 'train');
    const start = train!.position.clone();
    game.frame(JUMP_MS / 4);
    expect(train!.position.equals(start)).toBe(true); // no slide
    game.frame(JUMP_MS / 2);
    expect(train!.position.distanceTo(start)).toBeGreaterThan(10); // past the exit
    expect(body().ejecting).toBe('fade');
    game.frame(JUMP_MS);
    expect(body().passing).toBe('0');

    const again = await boot('?bot=off');
    fightRailYard(again);
    plies(again, 11);
    expect(body().passing).toBe('1');
    dispatchEvent(new PointerEvent('pointerdown')); // a click skips the effect
    expect(body().passing).toBe('0');
  });

  it('a game that is no Rail Yard fight draws no train', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__trains')).toEqual([]);
    expect(body().trains).toBe('0');
  });
});
