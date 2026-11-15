// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { boot, type Game, startBoss } from './test/harness';
import { SKINS } from './skins';
import { tonalMarble } from './look';

// The Alien on the harness (#588, game-design.md section 7.7): its eggs drawn on their cells with a counter above
// each, facing the camera, the pulse on 1, the crush and the hatch. ?bot=off plays both sides from a fixture: fight
// seed 7 and the quiet forward moves below lay the first egg on (2, 1) at ply 4, within 3 cells of a Black marble.

type Move = { cells: Axial[]; dir: number };
type Egg = { cell: Axial; left: number; glow: boolean };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const SEED = 7;
const CRUSH_SEED = 10; // a seed whose first egg a single Black marble can reach
const FIRST_EGG: Axial = [2, 1];

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

/** Starts the fight against The Alien from the mode menu, on fight seed `seed`. */
function fightAlien(game: Game, seed = SEED): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(seed);
    return a;
  });
  startBoss('The Alien');
}

const eggs = (game: Game): Egg[] => game.hook<Egg[]>('__eggs');
const to = ({ cells, dir }: Move): Axial => [cells[0]![0] + DIRS[dir]![0], cells[0]![1] + DIRS[dir]![1]];

/** Plays `mv` by two clicks: its marble, then the cell it goes to, and lets its slide end. */
function play(game: Game, mv: Move): void {
  const [q, r] = mv.cells[0]!;
  game.click(q, r);
  game.click(...to(mv));
  game.frame(1000);
}

/** One quiet ply: the first one-marble move forward of the side to move (NW or NE for Black, SE or SW for the Alien)
 * that ends on no egg, else the first one-marble move that ends on no egg. */
function quiet(game: Game): void {
  const forward = game.hook<number>('__plies') % 2 === 0 ? [4, 2] : [5, 3];
  const laid = eggs(game).map((e) => String(e.cell));
  const spare = game.hook<Move[]>('__legal').filter((m) => m.cells.length === 1 && !laid.includes(String(to(m))));
  play(game, spare.find((m) => forward.includes(m.dir)) ?? spare[0]!);
}

function plies(game: Game, n: number): void {
  for (let i = 0; i < n; i++) quiet(game);
}

describe('main.ts The Alien (#588)', () => {
  it('plays on the Cargo deck with its Tally line, and lays an egg at ply 4 with a counter of 4 facing the camera', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightAlien(game);
    expect(body().boss).toBe('alien');
    expect(body().deck).toBe('cargo');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Alien');
    expect(game.hud()).toContain('Brood on file. It bred while the count was open.');
    expect(body().eggs).toBe('0');
    expect(game.hook('__notches')).toEqual({ lit: 2, dark: 0, glyph: true }); // P2 after 2 ejections (#621)
    plies(game, 3);
    expect(eggs(game)).toEqual([]);
    plies(game, 1);
    expect(eggs(game)).toEqual([{ cell: FIRST_EGG, left: 4, glow: false }]);
    expect(body().eggs).toBe('1');
    expect(body().eggCounters).toBe('4');
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Eggs hatch: 1 in 4 turns');
    const counters = scene().getObjectsByProperty('type', 'Sprite') as THREE.Sprite[];
    expect(counters).toHaveLength(1); // a sprite always faces the camera
    expect(counters[0]!.material.depthTest).toBe(false); // never hidden behind a marble
    const egg = scene().getObjectsByProperty('name', 'egg');
    expect(egg).toHaveLength(1);
    expect(counters[0]!.position.y).toBeGreaterThan(egg[0]!.position.y);
    expect([counters[0]!.position.x, counters[0]!.position.z]).toEqual([egg[0]!.position.x, egg[0]!.position.z]);
  });

  it('lays an egg in the Alien colour of the worn shell skin, with a shell map of its own, never the pale of my marbles (#1402)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room&look=terrace', { reducedMotion: true }); // the terrace's egg: the neon look's egg has no shell map (#1424)
    fightAlien(game);
    plies(game, 4);
    const egg = scene().getObjectByName('egg') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(egg.material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(game.hook<number>('__eggShade')).toBe(SKINS.find((s) => s.id === 'scarab')!.color);
    game.openSettings();
    byId('setting-shell-skin').click(); // Black porcelain
    game.settle();
    expect(game.hook<number>('__eggShade')).toBe(SKINS.find((s) => s.id === 'obsidian')!.color);
  });

  it('takes the tonal tone of the Alien in the tonal look (#1402)', async () => {
    const game = await boot('?bot=off&scene=room&look=tonal', { reducedMotion: true });
    fightAlien(game);
    plies(game, 4);
    expect(game.hook<number>('__eggShade')).toBe(tonalMarble(1, SKINS.find((s) => s.id === 'scarab')!.color));
  });

  it('the counter goes down after each player move, pulses on 1, then the egg hatches into an Alien marble', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&look=terrace'); // the terrace's egg counter: the neon look draws its own egg (#1424)
    fightAlien(game);
    plies(game, 4);
    const counts: number[] = [];
    for (let ply = 5; ply <= 10; ply++) {
      quiet(game);
      counts.push(eggs(game)[0]!.left);
    }
    expect(counts).toEqual([3, 3, 2, 2, 1, 1]); // a boss turn does not count
    expect(eggs(game)[0]).toEqual({ cell: FIRST_EGG, left: 1, glow: true });
    expect(body().eggCounters).toBe('1,3'); // the second egg, laid at ply 8
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Eggs hatch: 1 in 1 turn · 1 in 3 turns');
    expect(scene().getObjectsByProperty('name', 'egg-glow')).toHaveLength(1);
    const glow = new Set<number>();
    for (let n = 0; n < 4; n++) {
      game.frame(250);
      glow.add(game.hook<number>('__eggGlow'));
    }
    expect(glow.size).toBeGreaterThan(1); // it pulses
    quiet(game); // ply 11: the hatch, at the start of the boss turn
    expect(eggs(game).map((e) => e.cell)).not.toContainEqual(FIRST_EGG);
    expect(body().eggs).toBe('1');
    const alien = game.hook<Move[]>('__legal'); // the Alien's turn: the new marble can move
    expect(alien.some((m) => String(m.cells) === String(FIRST_EGG))).toBe(true);
    expect(game.hook('__notches')).toEqual({ lit: 2, dark: 0, glyph: true }); // a hatch is no ejection (#621)
  });

  it('the glow on 1 holds still under reduced motion', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightAlien(game);
    plies(game, 10);
    expect(eggs(game)[0]!.glow).toBe(true);
    const glow = new Set<number>();
    for (let n = 0; n < 4; n++) {
      game.frame(250);
      glow.add(game.hook<number>('__eggGlow'));
    }
    expect(glow.size).toBe(1);
  });

  it('a marble that ends its move on an egg crushes it: no counter, no hatch', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightAlien(game, CRUSH_SEED);
    plies(game, 4);
    const egg = eggs(game)[0]!.cell;
    play(game, game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && String(to(m)) === String(egg))!); // a Black marble onto the egg
    expect(eggs(game)).toEqual([]);
    expect(body().eggs).toBe('0');
    expect(body().eggCounters).toBe('');
    expect(byId('hud').querySelector('.boss .tell')).toBeNull();
    plies(game, 6); // to ply 11, when it would have hatched: no Alien marble on its cell
    expect(game.hook<Move[]>('__legal').some((m) => String(m.cells) === String(egg))).toBe(false);
  });

  it('a game that is no Alien fight draws no egg', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__eggs')).toEqual([]);
    expect(body().eggs).toBe('0');
  });
});
