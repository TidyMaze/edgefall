// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { BRIDGE, BRIDGE_HEIGHT, BRIDGE_MS, DROP_MS, DUAL_AZIMUTH, DUAL_POLAR, type DualState } from './dual';
import { BLOOD_MS } from './blood';
import { RIM_LIGHT } from './frame';
import { SLIDE_MS } from './slide';
import type { View } from './camera';
import { boot, type Game, startBoss } from './test/harness';
import { BRIDGE_AT, RETURN_AT, RETURN_CELL, SEED } from './test/dual-game';
import { dualGame } from './test/dual-fixture';

// The Dual Room on the harness (#947, #955, game-design.md section 7.15): its two rooms side by side with the void
// between them, the mark of an announced return, the returning marble dropping onto it, and the bridge's cells lowered
// into the void at the 5th ejection. ?bot=off plays the recorded fight of the wasm tests through the __playMoves hook
// (fight seed 1).

type Shown = {
  state: DualState | null;
  bridge: (number | null)[]; // the bridge cells' heights over their place, null while they are the void
  mark: [number, number] | null;
  drop: { cell: [number, number]; y: number } | null;
};
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const dual = (game: Game) => game.hook<Shown>('__dual');
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);
const played = (game: Game, from: number, to: number): number => game.hook<number>('__playMoves', dualGame().slice(from, to));

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

/** Starts the fight against The Dual Room on the fixture's fight seed, through the test hook. `asPlayer`: the page then stops being under automation (the hook needs it to start the fight, a bay is the player's way), so that the loop draws as a player's page does. */
function fightDual(game: Game, asPlayer = false): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(SEED);
    return a;
  });
  startBoss('The Dual Room');
  if (asPlayer) Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
}

/** Plays the first `to` plies of the recorded fight by clicks, as a player's page does without the test hooks; after
 * the last one the clock runs on until its slide is over. */
function clickPlies(game: Game, to: number): void {
  const DIRS = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
  for (const [k, record] of dualGame().slice(0, to).entries()) {
    const cells = Array.from({ length: record[0]! }, (_, i): [number, number] => [record[2 + 2 * i]!, record[3 + 2 * i]!]);
    const [dq, dr] = DIRS[record[1]!]!;
    // A target cell only this move reaches: a broadside's target can be another direction's too.
    const legal = game.hook<{ cells: [number, number][]; dir: number }[]>('__legal').filter(
      (m) => m.cells.length === cells.length && m.cells.every(([q, r]) => cells.some(([cq, cr]) => cq === q && cr === r)),
    );
    const reach = (dir: number): string[] => cells.map(([q, r]) => `${q + DIRS[dir]![0]!},${r + DIRS[dir]![1]!}`);
    const target = cells
      .map(([q, r]): [number, number] => [q + dq!, r + dr!])
      .find(([q, r]) => !cells.some(([cq, cr]) => cq === q && cr === r) && legal.every((m) => m.dir === record[1] || !reach(m.dir).includes(`${q},${r}`)))!;
    for (const [q, r] of cells) game.click(q, r);
    game.click(...target);
    expect(game.hook('__plies')).toBe(k + 1);
    if (k < to - 1) for (let n = 0; n < 4; n++) game.frame(1000);
  }
  for (let n = 0; n < 15; n++) game.frame(16); // the move's slide is over, its effects still run
  expect(document.body.dataset.sliding).not.toBe('1');
}

describe('main.ts The Dual Room (#947, #955)', () => {
  it('opens on its two rooms side by side, the void between them, on the Mess deck', async () => {
    const game = await boot('?bot=off&scene=room', { reducedMotion: true });
    expect(dual(game).state).toBeNull();
    fightDual(game);
    expect(game.hook('__fight')).toMatchObject({ id: 'dual', seed: SEED });
    expect(document.body.dataset.deck).toBe('mess');
    expect(game.hook<{ azimuth: number; polar: number }>('__view')).toMatchObject({ azimuth: DUAL_AZIMUTH, polar: DUAL_POLAR });
    expect(game.hook<{ radius: number; holes: number }>('__frame')).toMatchObject({ radius: 7, holes: BRIDGE.length });
    const none = BRIDGE.map(() => null);
    expect(dual(game)).toEqual({ state: { bridged: false, coming: null, room: 0 }, bridge: none, mark: null, drop: null });
    expect(document.body.dataset.bridge).toBe('void');
    expect(document.body.dataset.dualRoom).toBe('south');
    expect(tell()).toBe('Ejected marbles come back in the other room · the bridge comes at 5');
  });

  it('marks the cell of an announced return, then drops the marble onto it', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: false });
    fightDual(game);
    played(game, 0, RETURN_AT);
    for (let n = 0; n < 4; n++) game.frame(1000);
    expect(dual(game).mark).toEqual(RETURN_CELL);
    expect(named(scene(), 'return-mark')).toHaveLength(1);
    expect(tell()).toBe('Its marble comes back on the mark next turn · the bridge comes at 5');
    played(game, RETURN_AT, RETURN_AT + 1);
    for (let n = 0; n < 3 && dual(game).drop === null; n++) game.frame(100); // the move's slide first
    const drop = dual(game).drop!;
    expect(drop.cell).toEqual(RETURN_CELL);
    expect(drop.y).toBeGreaterThan(0);
    expect(document.body.dataset.returns).toBe('1');
    game.frame(DROP_MS / 2);
    game.frame(1);
    expect(dual(game).drop!.y).toBeGreaterThan(0);
    expect(dual(game).drop!.y).toBeLessThan(drop.y);
    game.frame(DROP_MS);
    game.frame(16);
    expect(dual(game).drop).toBeNull();
    expect(game.hook('__marbleTurn', ...RETURN_CELL)).not.toBeNull();
  });

  it('a Retry during the fall ends it on the new fight', async () => {
    const game = await boot('?bot=off', { reducedMotion: false });
    fightDual(game);
    played(game, 0, RETURN_AT + 1);
    expect(dual(game).drop).not.toBeNull();
    byId('boss-retry').click();
    game.frame(DROP_MS);
    game.frame(16);
    expect(dual(game).drop).toBeNull();
    expect(game.hook('__plies')).toBe(0);
  });

  it('marks the return of a player marble in the light of the glass', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    // A player marble walks to the south room's rim, (1, 2), and the boss pushes it off from there. The rooms are played
    // in turn (#992): each side steps back and forth in the north room meanwhile.
    const plies = [
      [1, 4, -1, 6, 0, 0, 0, 0],
      [1, 1, -2, 2, 0, 0, 0, 0],
      [1, 5, 5, -6, 0, 0, 0, 0],
      [1, 0, 2, -2, 0, 0, 0, 0],
      [1, 2, -1, 5, 0, 0, 0, 0],
      [1, 0, -3, 2, 0, 0, 0, 0],
      [1, 4, 5, -5, 0, 0, 0, 0],
      [1, 1, 3, -2, 0, 0, 0, 0],
      [1, 2, 0, 4, 0, 0, 0, 0],
      [1, 1, -2, 2, 0, 0, 0, 0],
      [1, 5, 5, -6, 0, 0, 0, 0],
      [1, 0, 2, -2, 0, 0, 0, 0],
      [1, 4, 1, 3, 0, 0, 0, 0],
      [2, 0, -1, 2, 0, 2, 0, 0],
    ];
    expect(game.hook<number>('__playMoves', plies)).toBe(plies.length);
    expect(dual(game).state!.coming!.side).toBe(1);
    const [mark] = named(scene(), 'return-mark') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    expect(mark!.material.color.getHex()).toBe(RIM_LIGHT.glass);
    expect(tell()).toBe('Your marble comes back on the mark next turn · the bridge comes at 5');
  });

  it('leaving for the battle royale during the fall ends it, with no marble left to drop', async () => {
    const game = await boot('?bot=off', { reducedMotion: false });
    fightDual(game);
    played(game, 0, RETURN_AT + 1);
    expect(dual(game).drop).not.toBeNull();
    byId('battle-royale').click();
    game.frame(DROP_MS);
    game.frame(16);
    expect(dual(game).drop).toBeNull();
  });

  it('reduced motion: the returning marble is on its cell at once', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    played(game, 0, RETURN_AT + 1);
    for (let n = 0; n < 4; n++) game.frame(16);
    expect(dual(game).drop).toBeNull();
    expect(document.body.dataset.returns).toBe('1');
    expect(game.hook('__marbleTurn', ...RETURN_CELL)).not.toBeNull();
  });

  it('the 5th ejection lowers the bridge into the void, then it is in place; Retry opens the void again', async () => {
    const game = await boot('?bot=off', { reducedMotion: false });
    fightDual(game);
    played(game, 0, BRIDGE_AT - 1);
    played(game, BRIDGE_AT - 1, BRIDGE_AT);
    expect(document.body.dataset.bridge).toBe('lowering');
    expect(game.hook<{ holes: number }>('__frame').holes).toBe(0);
    game.frame(SLIDE_MS / 2); // the push slides first, the bridge waits up high till it is over
    expect(dual(game).bridge).toEqual(BRIDGE.map(() => BRIDGE_HEIGHT));
    game.frame(SLIDE_MS); // the slide ends: the bridge starts down
    game.frame(BRIDGE_MS / 2);
    const half = dual(game).bridge[0]!;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(BRIDGE_HEIGHT);
    game.frame(BRIDGE_MS);
    game.frame(16);
    expect(dual(game).bridge).toEqual([0, 0, 0, 0, 0]);
    expect(document.body.dataset.bridge).toBe('up');
    expect(dual(game).state).toEqual({ bridged: true, coming: null, room: null });
    expect(tell()).toBe('The bridge is up, ejected marbles are gone');
    byId('boss-retry').click();
    expect(document.body.dataset.bridge).toBe('void');
    expect(game.hook<{ holes: number }>('__frame').holes).toBe(BRIDGE.length);
    expect(dual(game).bridge).toEqual(BRIDGE.map(() => null));
  });

  it('a Retry while the bridge comes down ends it, and the next bridge comes down from the top', async () => {
    const game = await boot('?bot=off', { reducedMotion: false });
    fightDual(game);
    played(game, 0, BRIDGE_AT);
    game.frame(SLIDE_MS * 2);
    expect(dual(game).bridge[0]).toBeGreaterThan(0);
    byId('boss-retry').click();
    expect(dual(game).bridge).toEqual(BRIDGE.map(() => null));
    expect(document.body.dataset.bridge).toBe('void');
    played(game, 0, BRIDGE_AT);
    expect(dual(game).bridge).toEqual(BRIDGE.map(() => BRIDGE_HEIGHT));
  });

  it('reduced motion: the bridge is in place at once', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    played(game, 0, BRIDGE_AT);
    game.frame(16);
    expect(dual(game).bridge).toEqual([0, 0, 0, 0, 0]);
    expect(document.body.dataset.bridge).toBe('up');
  });

  it('the page of a player keeps drawing while the returning marble falls (#848)', async () => {
    const game = await boot('?bot=off&quality=low&entrance', { reducedMotion: false }); // no dust drifting
    fightDual(game, true);
    clickPlies(game, RETURN_AT + 1);
    expect(dual(game).drop).not.toBeNull();
    const before = game.draws();
    for (let n = 0; n < 6; n++) game.frame(16);
    expect(game.draws() - before).toBe(6);
    expect(dual(game).drop).not.toBeNull();
  });

  it('the page of a player keeps drawing while the bridge comes down (#848)', async () => {
    const game = await boot('?bot=off&quality=low&entrance', { reducedMotion: false });
    fightDual(game, true);
    clickPlies(game, BRIDGE_AT);
    // Past the push's slide, the ejection and its splash: the bridge comes down alone, after the slide, longer than them.
    for (let elapsed = 15 * 16; elapsed <= BLOOD_MS; elapsed += 16) game.frame(16);
    expect(document.body.dataset.bridge).toBe('lowering');
    const before = game.draws();
    for (let n = 0; n < 6; n++) game.frame(16);
    expect(game.draws() - before).toBe(6);
    expect(document.body.dataset.bridge).toBe('lowering');
  });

  it('dims the room out of turn, which changes after each pair of plies, and none once the bridge is up (#992)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    const dim = (): THREE.InstancedMesh[] => named(scene(), 'dual-dim') as THREE.InstancedMesh[];
    expect(dim()).toHaveLength(1);
    expect(dim()[0]!.count).toBe(37);
    played(game, 0, 1);
    expect(document.body.dataset.dualRoom).toBe('south');
    played(game, 1, 2);
    expect(document.body.dataset.dualRoom).toBe('north');
    expect(dual(game).state!.room).toBe(1);
    played(game, 2, BRIDGE_AT);
    expect(document.body.dataset.dualRoom).toBeUndefined();
    expect(dim()).toHaveLength(0);
  });

  it('refuses a click on a marble of the room out of turn and says which room plays (#992)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    game.click(2, -7); // a player marble of the north room
    expect(game.hook<[number, number][]>('__rings')).toEqual([]);
    expect(game.hud()).toContain(' · the south room plays this turn');
    expect(document.body.classList.contains('refused')).toBe(true); // the turn line shakes
    game.click(-2, 7); // one of the south room
    expect(game.hook<[number, number][]>('__rings')).toEqual([[-2, 7]]);
    expect(game.hud()).not.toContain('plays this turn');
  });

  it('another boss, the hub and the battle royale show no void, no bridge and no mark', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    startBoss('The Echo');
    expect(dual(game)).toEqual({ state: null, bridge: [0, 0, 0, 0, 0], mark: null, drop: null });
    expect(document.body.dataset.bridge).toBeUndefined();
    expect(document.body.dataset.dualRoom).toBeUndefined();
    fightDual(game);
    byId('ship').click();
    expect(document.body.dataset.bridge).toBeUndefined();
    fightDual(game);
    byId('battle-royale').click();
    expect(document.body.dataset.bridge).toBeUndefined();
  });
});

describe('main.ts The Dual Room on the terrace (#1374)', () => {
  let plainDistance = 0;
  it('opens from the Blender camera, drawn back until both rooms fit', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const view = game.hook<View>('__view');
    expect(view.azimuth).toBe(0);
    expect(view.polar).toBeCloseTo((40 * Math.PI) / 180);
    expect(view.distance).toBeGreaterThanOrEqual(13.6);
    plainDistance = view.distance;
  });

  it('draws back farther when the dock runs along the bottom, so no marble of the player room lies under it (#1716)', async () => {
    const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.id === 'dock' ? { top: innerHeight - 66, height: 66, bottom: innerHeight, left: 0, right: 400, width: 400, x: 0, y: innerHeight - 66 } : { top: 0, height: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0 }) as DOMRect;
    });
    onTestFinished(() => box.mockRestore());
    const game = await boot('?bot=off', { reducedMotion: true });
    fightDual(game);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    expect(game.hook<View>('__view').distance).toBeGreaterThan(plainDistance);
  });
});
