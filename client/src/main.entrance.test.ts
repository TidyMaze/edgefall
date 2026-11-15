// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { BOSS_SPACE } from './bossspace';
import { ENTRANCE_MS } from './entrance';
import { LEGACY_UNLOCKED } from './collector';
import { newRun, parseMap, pick, type MapNode } from './roguelite';
import { NEON_LIGHT } from './neonlook';
import { boot, type Game, startBoss } from './test/harness';

// The entrance beat of a boss fight (#1551, motion.md story 9): the camera comes from the boss's side, the light of the space rises from
// dark and a card names the boss and its deck, for about a second and a half. Any press or key ends it, reduced motion has none, a fight
// that comes back from a reload does not replay it. A page under automation has none unless it asks with ?entrance (as ?locks).

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
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
const sun = (scene: THREE.Scene): THREE.DirectionalLight => scene.getObjectsByProperty('isDirectionalLight', true)[0] as THREE.DirectionalLight;
function fight(name: string): void {
  startBoss(name);
}
const full = (id: string): number => NEON_LIGHT.sunIntensity * BOSS_SPACE[id]!.intensity;

describe('main.ts boss entrance (#1551)', () => {
  it('plays when a boss is picked: the card, the dark light and the camera, then ends on its own with the light back', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&entrance');
    fight('The Hull');
    expect(body().entrance).toBe('rise');
    expect(byId('boss-entrance').hidden).toBe(false);
    expect(byId('boss-entrance-name').textContent).toBe('The Hull');
    expect(byId('boss-entrance-deck').textContent).toBe('Cargo deck');
    expect(sun(scene()).intensity).toBeCloseTo(full('hull') * BOSS_SPACE.hull!.dark);
    game.frame(ENTRANCE_MS / 2);
    expect(body().entrance).toBe('rise');
    expect(sun(scene()).intensity).toBeGreaterThan(full('hull') * 0.2);
    game.frame(ENTRANCE_MS);
    expect(body().entrance).toBeUndefined();
    expect(byId('boss-entrance').hidden).toBe(true);
    expect(sun(scene()).intensity).toBeCloseTo(full('hull'));
  });

  it('is never blocking: a press, a key or the wheel ends it at once on the final framing and the light', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&entrance');
    for (const press of [() => dispatchEvent(new Event('pointerdown')), () => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })), () => dispatchEvent(new Event('wheel'))]) {
      fight('The Choir');
      expect(body().entrance).toBe('rise');
      press();
      expect(body().entrance).toBeUndefined();
      expect(byId('boss-entrance').hidden).toBe(true);
      expect(sun(scene()).intensity).toBeCloseTo(full('choir'));
    }
  });

  it('has none under reduced motion, and none on a page under automation that did not ask', async () => {
    const calm = await boot('?bot=off&entrance', { reducedMotion: true });
    fight('The Hull');
    expect(body().entrance).toBeUndefined();
    expect(byId('boss-entrance').hidden).toBe(true);
    const plain = await boot('?bot=off');
    fight('The Hull');
    expect(body().entrance).toBeUndefined();
    expect(byId('boss-entrance').hidden).toBe(true);
  });

  it('plays again on Retry, with each boss its own move, and not on a mode or a new game', async () => {
    const game = await boot('?bot=off&entrance');
    fight('The Pulsar');
    expect(body().entrance).toBe('pull');
    game.frame(ENTRANCE_MS);
    byId('boss-retry').click();
    expect(body().entrance).toBe('pull');
    game.frame(ENTRANCE_MS);
    game.hook('__startMode', 'run');
    expect(body().entrance).toBeUndefined();
    byId('new-game').click();
    expect(body().entrance).toBeUndefined();
  });

  it('ends when the deck changes under it, and does not play for a fight that comes back from a reload', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?entrance', { indexedDB });
    fight('The Stalker');
    expect(body().entrance).toBe('drop');
    game.hook('__deck', 'mess');
    game.frame(16);
    expect(body().entrance).toBeUndefined();
    expect(byId('boss-entrance').hidden).toBe(true);
    const move = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    game.click(...game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    await game.settle();
    const again = await boot('?entrance', { indexedDB });
    expect(again.hook<number>('__plies')).toBeGreaterThan(0);
    expect(body().entrance).toBeUndefined();
    expect(byId('boss-entrance').hidden).toBe(true);
  });

  it('plays when a run walks into its act boss, not when the run is loaded in the fight', async () => {
    const { boss_ids, run_map } = await import('edgefall-wasm');
    const game = await boot('?bot=off&entrance&nodes=50');
    let nodes: MapNode[] = [];
    let path: number[] = [];
    for (let seed = 0; !path.length; seed++) {
      nodes = parseMap(run_map(seed));
      path = [0];
      for (let n = nodes[0]!; n.kind !== 'boss'; ) {
        const i = nodes.findIndex((m) => m.act === n.act && m.row === n.row + 1 && m.col === n.links[0]);
        path.push(i);
        n = nodes[i]!;
      }
    }
    expect(boss_ids().length).toBe(15);
    const state = { ...newRun(0, 3, LEGACY_UNLOCKED), enemies: false, path: path.slice(0, -1) };
    await game.hook('__run', state);
    expect(body().entrance).toBeUndefined(); // the map
    byId('run-map').querySelector<HTMLButtonElement>(`button[data-node="${path[path.length - 1]}"]`)!.click();
    expect(body().run).toBe('bonus'); // the bonus room first (#1473), then the boss
    byId('run-map').querySelector<HTMLButtonElement>('button[data-bonus]')!.click();
    expect(body().run).toBe('fight');
    expect(byId('boss-entrance').hidden).toBe(false);
    expect(body().entrance).toBeDefined();
    game.frame(ENTRANCE_MS);
    await game.hook('__run', pick({ ...state, path: path.slice(0, -1) }, path[path.length - 1]!)); // loaded in the fight, as a reload does
    expect(body().entrance).toBeUndefined();
  });
});
