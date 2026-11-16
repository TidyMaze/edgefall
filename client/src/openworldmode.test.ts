// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AMBIENT } from './openworldparticles';
import './test/openworldwasm';
import * as THREE from 'three/webgpu';
import type { Axial } from './board';
import { CHUNK, World } from './openworld';
import { DEFAULT_YAW, OpenWorldMode, ORBIT_PER_PX, REST_OFFSET, restYaw, TURN_STEP, twistOf } from './openworldmode';
import { FightState } from './openworldfight';
import { HIT_HOLD_MS } from './openworldhit';
import { BOSS_COLOURS, ICON } from './openworldlairicon';
import { COLOURS, terrainColour } from './openworldminimap';
import { SIGHT } from './openworlddiscovered';
import { worldSaves, type WorldSaves, type WorldSave } from './openworldsave';
import { memoryStore } from './savegame';
import { world_chunk } from 'edgefall-wasm';
import { MAX_ZOOM, maxZoomFor, OpenWorldView, type PropModels, topOf } from './openworldview';
import { CRUISE_MS, GLIDE_MS, NUDGE_MS, stepMs } from './openworldglide';
import { stopLeftIntervalsAfterEach } from './test/intervals';
stopLeftIntervalsAfterEach();

// Grass at height 1 everywhere in the square -3..3 of chunks, a boulder on (0, 1). The badlands have no particles (#1110), so a frame
// with motion on is idle when nothing moves; `meadow` is the same world with pollen.
// The fixture world is the badlands (biome 4), whose embers drift since #1736: held here, so a test of when the mode draws sees only what it moves.
let embers = 0;
beforeAll(() => {
  embers = AMBIENT.badlands!.rate;
  AMBIENT.badlands!.rate = 0;
});
afterAll(() => void (AMBIENT.badlands!.rate = embers));

function bytes(cx: number, cy: number, biome = 4): Uint8Array {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, biome], i * 3);
  if (cx === 0 && cy === 0) out.set([1, 5, biome], CHUNK * 3); // (0, 1)
  return out;
}
const meadow = (_seed: number, cx: number, cy: number): Uint8Array => bytes(cx, cy, 0);
// A lake everywhere in the square -3..3 of chunks.
function sea(_seed: number, cx: number, cy: number): Uint8Array {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 0, 0], i * 3);
  return out;
}
const mode = (
  models: () => Promise<PropModels> = async () => ({ low: {}, high: {} }),
  load: (seed: number, cx: number, cy: number) => Uint8Array = (_seed, cx, cy) => bytes(cx, cy),
  reduced: () => boolean = () => true,
  foes: (seed: number, cx: number, cy: number) => Int32Array = (_seed, cx, cy) =>
    cx === 0 && cy === 0 ? Int32Array.of(5, 5, 6, 5, 7, 5) : new Int32Array(),
  saves: WorldSaves = worldSaves(memoryStore(), 1),
) => new OpenWorldMode(load, foes, models, reduced, saves);
const body = () => document.body.dataset;

afterEach(() => {
  delete body().openworld;
  delete body().openworldAt;
  delete body().openworldTroop;
  delete body().openworldEnemies;
  delete body().openworldZoom;
  delete body().openworldDrawn;
  delete body().openworldBeaten;
  delete body().openworldPush;
});

// One press of an arrow: the key goes down, its step is made at once, and the key comes up (#1059).
const tap = (m: OpenWorldMode, key: string): boolean => {
  const pressed = m.key(key);
  m.release(key);
  return pressed;
};

describe('the Open world mode', () => {
  it('enters on the spawn: marked on the page, drawn once, drawn again only when something changed', () => {
    const m = mode();
    m.enter(42, 800, 600);
    expect(m.active).toBe(true);
    expect(body().openworld).toBe('42');
    expect(body().openworldAt).toBe('0,0');
    expect(body().openworldEnemies).toBe('3');
    expect(body().openworldTroop!.split(' ')).toHaveLength(15);
    const render = vi.fn();
    m.frame(render);
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0]).toBeInstanceOf(THREE.Scene);
    m.resize(400, 300);
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('draws again when the models arrive', async () => {
    let arrive!: (g: PropModels) => void;
    const m = mode(() => new Promise((resolve) => (arrive = resolve)));
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render);
    arrive({ low: {}, high: {} });
    await Promise.resolve();
    await Promise.resolve();
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('draws the detailed props near the hero once their models arrive, and publishes the count (#989)', async () => {
    let arrive!: (g: PropModels) => void;
    const m = mode(() => new Promise((resolve) => (arrive = resolve)));
    m.enter(1, 800, 600);
    expect(JSON.parse(body().openworldDrawn!)['prop-boulder']).toBe(1);
    arrive({ low: {}, high: { boulder: new THREE.BoxGeometry() } });
    await Promise.resolve();
    await Promise.resolve();
    const drawn = JSON.parse(body().openworldDrawn!);
    expect(drawn['prop-boulder-hi']).toBe(1); // the boulder at (0, 1) is near the hero
    expect(drawn['prop-boulder']).toBe(0);
  });

  it('draws the low-poly props everywhere on the low tier, even near the hero (#1234)', async () => {
    document.body.dataset.tier = 'low';
    try {
      let arrive!: (g: PropModels) => void;
      const m = mode(() => new Promise((resolve) => (arrive = resolve)));
      m.enter(1, 800, 600);
      arrive({ low: { boulder: new THREE.BoxGeometry() }, high: { boulder: new THREE.BoxGeometry() } });
      await Promise.resolve();
      await Promise.resolve();
      const drawn = JSON.parse(body().openworldDrawn!);
      expect(drawn['prop-boulder-hi']).toBe(0);
      expect(drawn['prop-boulder']).toBe(1);
    } finally {
      delete document.body.dataset.tier;
    }
  });

  it('draws the ground cells with no lower neighbour as flat tops on the low tier only (#1234)', () => {
    const flat = () => Object.entries(JSON.parse(body().openworldDrawn!) as Record<string, number>).filter(([k]) => k.endsWith('-flat'));
    const sum = () => flat().reduce((total, [, n]) => total + n, 0);
    const high = mode();
    high.enter(1, 800, 600);
    expect(sum()).toBe(0);
    // the striation of the land is the high tier's (#1555)
    const surface = (m: OpenWorldMode) => (m as unknown as { view: { surface: { amplitude: { value: number } } } }).view.surface.amplitude.value;
    expect(surface(high)).toBeGreaterThan(0);
    high.leave();
    document.body.dataset.tier = 'low';
    try {
      const low = mode();
      low.enter(1, 800, 600);
      expect(sum()).toBeGreaterThan(0);
      expect(surface(low)).toBe(0);
    } finally {
      delete document.body.dataset.tier;
    }
  });

  it('hands the sounding stations its camera and the towers, towns and gates of the world (#1577), and its camera probe (#1103)', () => {
    const lairs = new OpenWorldMode((_s, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1), () => Int32Array.of(4, 0));
    lairs.enter(1, 800, 600);
    expect(lairs.ears).toBeInstanceOf(THREE.Camera);
    expect(lairs.stations.filter(({ kind }) => kind === 'tower').map(({ id }) => id)).toEqual(['tower:4,0']);
    expect(lairs.camera().zoom).toBeGreaterThan(0);
    lairs.leave();
    expect(lairs.scene).toBeNull(); // no scene outside the mode (#1234)
  });

  it('rolls the hero on an arrow key, and keeps it before a boulder', () => {
    const m = mode();
    m.enter(1, 800, 600);
    expect(tap(m, 'ArrowRight')).toBe(true);
    expect(m.hero!.at).toEqual([1, 0]);
    expect(body().openworldAt).toBe('1,0');
    expect(tap(m, 'ArrowLeft')).toBe(true);
    expect(tap(m, 'ArrowDown')).toBe(true); // down from the even row 0: (-1, 1) or (0, 1)
    expect(tap(m, 'ArrowDown')).toBe(true);
    expect(m.key('a')).toBe(false);
  });

  it('rolls the hero onto the cell pressed when it is next to it, and ignores a far one', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.press(400, 300, 800, 600); // the centre: the hero's own cell, no move
    expect(m.hero!.at).toEqual([0, 0]);
    m.press(400 + 55, 300, 800, 600); // a cell to the right
    expect(m.hero!.at).toEqual([1, 0]);
    m.press(800, 0, 800, 600); // far away
    expect(m.hero!.at).toEqual([1, 0]);
  });

  it('leaves on Escape and clears its marks', () => {
    const m = mode();
    m.enter(1, 800, 600);
    expect(m.key('Escape')).toBe(true);
    expect(m.active).toBe(false);
    expect(body().openworld).toBeUndefined();
    expect(body().openworldAt).toBeUndefined();
  });

  it('rolls the hero on the diagonal of two held arrows, and keeps walking while they are held', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const m = mode();
    m.enter(1, 800, 600);
    expect(m.key('ArrowLeft')).toBe(true);
    expect(m.hero!.at).toEqual([0, -1]); // Left leans forward, up-left (#1273)
    expect(m.key('ArrowUp')).toBe(true); // Left and Up held: the diagonal rolls on the next step, not at once (#1059)
    expect(m.hero!.at).toEqual([0, -1]);
    clock = GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(m.hero!.at).toEqual([0, -2]); // up-left
    clock = 2 * GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(m.hero!.at).toEqual([0, -3]); // up-left again, the arrows still held
    vi.restoreAllMocks();
  });

  it('does nothing for opposite arrows held together, and a release drops the key', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const m = mode();
    m.enter(1, 800, 600);
    expect(m.key('ArrowLeft')).toBe(true);
    expect(m.hero!.at).toEqual([0, -1]);
    expect(m.key('ArrowRight')).toBe(true); // Left and Right: nothing, on the cadence either
    clock = GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(m.hero!.at).toEqual([0, -1]);
    m.release('ArrowLeft');
    clock = 2 * GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(m.hero!.at).toEqual([1, -1]); // Right alone rolls again
    vi.restoreAllMocks();
  });

  it('forgets the held keys when the window loses focus or the mode is left', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowUp'); // (1, -1) from the even spawn row, Up held
    m.release(); // blur: no key is held any more
    expect(tap(m, 'ArrowLeft')).toBe(true);
    expect(m.hero!.at).toEqual([1, -2]); // a single arrow, not a diagonal with Up
    m.key('ArrowUp'); // held again
    m.key('Escape'); // leaving clears the held keys too
    m.enter(1, 800, 600);
    expect(tap(m, 'ArrowUp')).toBe(true);
    expect(m.hero!.at).toEqual([1, -1]); // single Up from the spawn, Left is not held
  });

  it('clamps the zoom to a wider screen its widest zoom, and publishes the clamped zoom, #976', () => {
    const m = mode();
    m.enter(1, 1600, 900);
    m.zoom(1e9);
    expect(body().openworldZoom).toBe(String(maxZoomFor(1600 / 900)));
    m.resize(3840, 1080);
    expect(body().openworldZoom).toBe(String(maxZoomFor(3840 / 1080)));
    expect(Number(body().openworldZoom)).toBeLessThan(maxZoomFor(1600 / 900));
  });

  it('publishes nothing on a resize after the mode is left', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.leave();
    m.resize(1600, 900);
    expect(body().openworldZoom).toBeUndefined();
  });

  it('zooms the Open world camera, and an entry starts at the closest view again, #976', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.zoom(2);
    expect(body().openworldZoom).toBe('2');
    const camera = (): THREE.Camera => {
      const render = vi.fn();
      m.frame(render);
      return render.mock.calls[0]![1] as THREE.Camera;
    };
    const top = topOf('grass', 1, ...m.hero!.at) + 0.3; // the spawn is grass at height 1 in this file: its column top and the marble on it (#988)
    expect(camera().position.y).toBeCloseTo(28 + top);
    m.enter(1, 800, 600);
    expect(body().openworldZoom).toBe('1');
    expect(camera().position.y).toBeCloseTo(14 + top);
  });

  it('publishes what is drawn at the zoom, the props among it, for the browser checks, #976', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.zoom(2);
    const drawn = JSON.parse(body().openworldDrawn!) as Record<string, number>;
    expect(drawn['terrain-grass']).toBeGreaterThan(0);
    expect(drawn['prop-boulder']).toBeGreaterThan(0);
    expect(drawn.troop).toBe(15);
    expect(drawn.enemies).toBe(3);
  });

  it('rolls the hero onto the cell picked by a click at the widest zoom too, #976', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.zoom(MAX_ZOOM);
    const pick = vi.spyOn(OpenWorldView.prototype, 'pick').mockReturnValue([1, 0]);
    m.press(400, 300, 800, 600);
    expect(pick).toHaveBeenCalled();
    expect(m.hero!.at).toEqual([1, 0]);
    pick.mockRestore();
  });

  it('ignores a resize before it is entered', () => {
    const m = mode();
    m.resize(100, 100);
    expect(m.active).toBe(false);
  });

  it('draws every frame while a lake is in view and motion is on, and the water keeps no glow of its own (#1315)', () => {
    const m = mode(undefined, sea, () => false);
    m.enter(1, 800, 600);
    const glow: number[] = [];
    const render = vi.fn((scene: THREE.Scene) => {
      const water = scene.getObjectByName('terrain-water') as THREE.InstancedMesh;
      glow.push((water.material as THREE.MeshStandardMaterial).emissiveIntensity);
    });
    m.frame(render, 0);
    m.frame(render, 1000);
    m.frame(render, 2000);
    expect(render).toHaveBeenCalledTimes(3);
    expect(glow).toEqual([1, 1, 1]);
  });

  it('holds the lake still on the low tier: a lake alone draws no frame after the first (#1234)', () => {
    document.body.dataset.tier = 'low';
    try {
      const m = mode(undefined, sea, () => false);
      m.enter(1, 800, 600);
      const render = vi.fn();
      m.frame(render, 0);
      m.frame(render, 400);
      m.frame(render, 800);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      delete document.body.dataset.tier;
    }
  });

  it('holds the lake still with reduced motion: drawn only when something changed', () => {
    const m = mode(undefined, sea, () => true);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render);
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(1);
    m.resize(400, 300);
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('draws only when something changed, with motion on, when no lake is in view', () => {
    const m = mode(undefined, (_seed, cx, cy) => bytes(cx, cy), () => false);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render);
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe('a frame frees what it replaced only after its render (#1017)', () => {
  it('drains the view after the frame is rendered, never before', () => {
    const drain = vi.spyOn(OpenWorldView.prototype, 'drain');
    const m = mode();
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain.mock.invocationCallOrder[0]).toBeGreaterThan(render.mock.invocationCallOrder[0]!);
    vi.restoreAllMocks();
  });
});

// The troop's push is the engine's (edgefall-core `worldoverlay`): these tests play it on the seed 1, whose spawn is a clearing, with the
// generated enemy (2,0) of the loader below.
const enemyAt2 = (_seed: number, cx: number, cy: number): Int32Array => (cx === 0 && cy === 0 ? Int32Array.of(2, 0) : new Int32Array());
/** The terrain code of a cell of the world `seed` (`-1` off the world). */
function terrainOf(seed: number, q: number, r: number): number {
  const [cx, cy] = [Math.floor(q / CHUNK), Math.floor(r / CHUNK)];
  const chunk = world_chunk(seed, cx, cy);
  return chunk.length === 0 ? -1 : chunk[((r - cy * CHUNK) * CHUNK + (q - cx * CHUNK)) * 3 + 1]!;
}
/** A water cell of the seed with five open cells (sand, grass, rock) to its west, found in the world itself. */
function shore(seed: number): Axial {
  for (let r = -60; r < 60; r++) {
    for (let q = -60; q < 60; q++) {
      if (terrainOf(seed, q, r) === 0 && [1, 2, 3, 4, 5].every((k) => [1, 2, 3].includes(terrainOf(seed, q - k, r)))) return [q, r];
    }
  }
  throw new Error('no shore');
}
/** An open cell of the seed with an open cell to its east and four water cells to its west, found in the world itself. */
function landing(seed: number): Axial {
  for (let r = -60; r < 60; r++) {
    for (let q = -60; q < 60; q++) {
      const open = [q, q + 1].every((k) => [1, 2, 3].includes(terrainOf(seed, k, r)));
      if (open && [1, 2, 3, 4].every((k) => terrainOf(seed, q - k, r) === 0)) return [q, r];
    }
  }
  throw new Error('no landing');
}
const real = (seed: number, cx: number, cy: number): Uint8Array => world_chunk(seed, cx, cy);

describe('the troop pushes after a step (docs/specs/openworld.md section 4, #967)', () => {
  it('plays the push of a step: the hero and the troop move to the cells of the engine, the enemy moves and the counts are published', () => {
    const m = mode(undefined, undefined, undefined, enemyAt2);
    m.enter(1, 800, 600);
    expect(body().openworldPush).toBe('0');
    expect(tap(m, 'ArrowRight')).toBe(true);
    expect(m.hero!.at).toEqual([2, 0]); // the line (1,0) (0,0) (-1,0) pushed the enemy east, the hero with it
    expect(body().openworldAt).toBe('2,0');
    const troop = body().openworldTroop!.split(' ');
    expect(troop).toHaveLength(15); // the flock after the step, then the push
    expect(new Set(troop).size).toBe(15);
    expect(troop).not.toContain('2,0'); // none on the hero
    expect(body().openworldEnemies).toBe('1');
    expect(m.enemies()).toEqual([[3, 0]]);
    expect(body().openworldPush).toBe('1');
    expect(body().openworldBeaten).toBe('0');
  });

  it('blocks the hero on the cell a pushed enemy now stands on, and frees the cell it stood on', () => {
    const m = mode(undefined, undefined, undefined, enemyAt2);
    m.enter(1, 800, 600);
    tap(m, 'ArrowRight'); // the step pushes the enemy from (2,0) to (3,0), the hero to (2,0)
    expect(m.enemies()).toEqual([[3, 0]]);
    tap(m, 'ArrowRight'); // (3,0) holds the pushed enemy: the hero never rolls onto it (#1137)
    expect(body().openworldAt).not.toBe('3,0');
    expect(m.enemies().length).toBe(1);
  });

  it('plays nothing when no push is legal: the enemies stay and no push is counted', () => {
    const m = mode(undefined, undefined, undefined, (_seed, cx, cy) => (cx === 0 && cy === 0 ? Int32Array.of(-9, 9) : new Int32Array()));
    m.enter(1, 800, 600);
    tap(m, 'ArrowRight');
    expect(body().openworldAt).toBe('1,0');
    expect(body().openworldPush).toBe('0');
    expect(body().openworldEnemies).toBe('1');
    expect(body().openworldBeaten).toBe('0');
  });

  it('counts an ejected enemy as beaten, and its cell is free', () => {
    const [wq, wr] = shore(1);
    const m = mode(undefined, real, () => true, () => new Int32Array());
    m.enter(1, 800, 600);
    m.fixture({ hero: [wq - 3, wr], troop: [[wq - 4, wr], [wq - 5, wr]], enemies: [[wq - 1, wr]] });
    tap(m, 'ArrowRight'); // the line pushes the enemy on to the water
    expect(body().openworldBeaten).toBe('1');
    expect(body().openworldPush).toBe('1');
    expect(body().openworldEnemies).toBe('0');
    expect(m.enemies()).toEqual([]);
  });

  it('pushes from the boats: the troop sails on to the water and its line pushes an enemy on the shore (#1441)', () => {
    const [lq, lr] = landing(1);
    const m = mode(undefined, real, () => true, () => new Int32Array());
    m.enter(1, 800, 600);
    m.fixture({ hero: [lq - 2, lr], troop: [[lq - 3, lr], [lq - 4, lr]], enemies: [[lq, lr]] });
    tap(m, 'ArrowRight'); // the hero sails on to (lq - 1), the line of three boats pushes the enemy on to the land beyond
    expect(m.hero!.at).toEqual([lq, lr]);
    expect(m.enemies()).toEqual([[lq + 1, lr]]);
    expect(body().openworldPush).toBe('1');
  });

  it('pushes after a diagonal step too', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    m.hold(['ArrowUp', 'ArrowRight']); // the stick's diagonal: one step, and the push after it
    expect(body().openworldPush).toBe('1');
    expect(body().openworldAt).toBe('2,0'); // the default camera (-30 degrees) shows the east cell nearest to up-right
  });

  it('starts a fresh fight on each entry: the pushed enemies and the counts are the generated ones again', () => {
    const m = mode(undefined, undefined, undefined, enemyAt2);
    m.enter(1, 800, 600);
    tap(m, 'ArrowRight');
    expect(body().openworldPush).toBe('1');
    m.leave();
    expect(body().openworldPush).toBeUndefined();
    expect(body().openworldBeaten).toBeUndefined();
    m.enter(1, 800, 600);
    expect(body().openworldPush).toBe('0');
    expect(body().openworldEnemies).toBe('1');
    expect(m.enemies()).toEqual([[2, 0]]);
  });

  it('a test fixture replaces the hero, the troop and the enemies of the loaded square, and draws them', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    expect(body().openworldAt).toBe('0,0');
    expect(body().openworldTroop).toBe('-1,0 -2,0');
    expect(body().openworldEnemies).toBe('1');
    expect(m.enemies()).toEqual([[2, 0]]);
  });
});

describe('leaving the Open world frees its view, every time (#981)', () => {
  it('enters and leaves 30 times: each view is disposed, with each of its geometries once, and its materials kept for the renderer to reuse their programs (#1710)', () => {
    const disposeView = vi.spyOn(OpenWorldView.prototype, 'dispose');
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, 'dispose');
    const m = mode();
    for (let i = 0; i < 30; i++) {
      m.enter(i, 800, 600);
      m.frame(() => {});
      m.leave();
    }
    const views = disposeView.mock.contexts as OpenWorldView[];
    expect(views).toHaveLength(30);
    expect(disposeGeometry.mock.calls.length).toBeGreaterThan(30 * 5);
    expect(new Set(disposeGeometry.mock.contexts).size).toBe(disposeGeometry.mock.calls.length); // each geometry once
    for (const view of views) expect(view.scene.children).toEqual([]); // emptied: a scene three keeps holds no mesh (#1722)
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(m.active).toBe(false);
    vi.restoreAllMocks();
  });

  it('does not draw or touch a view once it is left, even when the models arrive late', async () => {
    let arrive!: (g: PropModels) => void;
    const m = mode(() => new Promise((resolve) => (arrive = resolve)));
    m.enter(1, 800, 600);
    m.leave();
    const render = vi.fn();
    arrive({ low: {}, high: {} });
    await Promise.resolve();
    await Promise.resolve();
    m.frame(render);
    expect(render).not.toHaveBeenCalled();
  });
});

describe('the Open world models are loaded once per page (#981)', () => {
  it('loads the models the first time the mode is entered, not on every entry', async () => {
    const models = vi.fn(async (): Promise<PropModels> => ({ low: {}, high: {} }));
    const m = mode(models);
    m.enter(1, 800, 600);
    m.leave();
    m.enter(2, 800, 600);
    m.leave();
    expect(models).toHaveBeenCalledTimes(1);
  });
});

// Grass at height 1, and the cell (1, 0) at height 3: a step up a cliff of 2 levels, the most a step climbs (#988, #1744).
function cliff(_seed: number, cx: number, cy: number): Uint8Array {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, 4], i * 3); // the badlands: no particles (#1110)
  if (cx === 0 && cy === 0) out.set([3, 2, 4], 3); // (1, 0) is index 1 of its chunk
  return out;
}

describe('the tundra\'s ice (#1739)', () => {
  const flat = (biome: number) => (_seed: number, cx: number, cy: number): Uint8Array => {
    if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, biome], i * 3);
    return out;
  };
  it('slides the hero one cell more on the tundra once the step has landed, once; the meadow stops', () => {
    const ice = mode(undefined, flat(2), () => true);
    ice.enter(1, 800, 600);
    ice.fixture({ hero: [0, 0], troop: [], enemies: [] });
    tap(ice, 'ArrowRight');
    ice.release('ArrowRight');
    expect(body().openworldAt).toBe('1,0');
    ice.frame(() => {}, performance.now() + 2000);
    expect(body().openworldAt).toBe('2,0'); // slid one more
    ice.frame(() => {}, performance.now() + 4000);
    expect(body().openworldAt).toBe('2,0'); // and no further
    const grass = mode(undefined, flat(0), () => true);
    grass.enter(1, 800, 600);
    grass.fixture({ hero: [0, 0], troop: [], enemies: [] });
    tap(grass, 'ArrowRight');
    grass.release('ArrowRight');
    grass.frame(() => {}, performance.now() + 2000);
    expect(body().openworldAt).toBe('1,0');
    const route = () => Int32Array.of(1, 0, 2, 0, 3, 0); // the way the engine gives (#1137)
    const held = new OpenWorldMode(flat(2), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1), undefined, undefined, undefined, undefined, undefined, route); // a walk keeps to its cells, no slide between its steps
    held.enter(1, 800, 600);
    held.fixture({ hero: [0, 0], troop: [], enemies: [] });
    (held as unknown as { walkTo: (to: [number, number]) => void }).walkTo([3, 0]); // a walk to a far cell, as the Dungeon button's (#1291)
    for (let t = 1; t <= 40; t++) held.frame(() => {}, performance.now() + t * 100);
    expect(body().openworldAt).toBe('3,0');
  });
});

describe('a cliff too high (#1744)', () => {
  it('refuses a step up more than two levels: the hero never stands on the cliff top', () => {
    const steep = (_seed: number, cx: number, cy: number): Uint8Array => {
      const out = cliff(_seed, cx, cy);
      if (cx === 0 && cy === 0) out.set([4, 2, 4], 3); // (1, 0) three levels up
      return out;
    };
    const m = mode(undefined, steep, () => true);
    m.enter(1, 800, 600);
    tap(m, 'ArrowRight');
    m.release('ArrowRight');
    expect(body().openworldAt).not.toBe('1,0'); // refused (steering may slide it to a free neighbour)
  });
});

describe('the camera eases up a cliff (#988)', () => {
  it('draws every frame while the camera follows to the top of the cliff, then draws nothing once it has settled', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0); // the step starts at the press, on the frames' clock
    const m = mode(undefined, cliff, () => false);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 0);
    tap(m, 'ArrowRight');
    m.release('ArrowRight');
    expect(body().openworldAt).toBe('1,0');
    const drawn: boolean[] = [];
    for (let frame = 1; frame <= 60; frame++) {
      const before = render.mock.calls.length;
      m.frame(render, (frame * 1000) / 60);
      drawn.push(render.mock.calls.length > before);
    }
    clock.mockRestore();
    expect(drawn.slice(0, 20).every(Boolean)).toBe(true); // every frame of the first third of a second
    expect(drawn.slice(40).some(Boolean)).toBe(false); // settled: nothing left to draw
  });

  it('jumps to the top of the cliff at once with reduced motion: one draw, then none', () => {
    const m = mode(undefined, cliff, () => true);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 0);
    render.mockClear();
    tap(m, 'ArrowRight');
    m.release('ArrowRight');
    for (let frame = 1; frame <= 60; frame++) m.frame(render, (frame * 1000) / 60);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("the troop's push animation in the mode (docs/specs/openworld.md section 4, #967)", () => {
  // The fixture of the e2e push: the hero (0,0), the troop (-1,0) and (-2,0), the enemy (2,0). A Right press pushes it on to (3,0).
  const pushing = (reduced = false): OpenWorldMode => {
    const m = mode(undefined, undefined, () => reduced);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0], [-3, 0]], enemies: [[2, 0]] });
    return m;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { __openworldSlow?: number }).__openworldSlow;
  });

  it('plays the animation of the push, and reduced motion plays none', () => {
    const play = vi.spyOn(OpenWorldView.prototype, 'playPush');
    tap(pushing(), 'ArrowRight');
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]![0].push.enemies).toEqual([[3, 0]]);
    expect(play.mock.calls[0]![2]).toBe(1);
    play.mockClear();
    tap(pushing(true), 'ArrowRight');
    expect(play).not.toHaveBeenCalled();
  });

  it('plays the push with the hold on its contact frame, stretched by the slow factor (#1561)', () => {
    const play = vi.spyOn(OpenWorldView.prototype, 'playPush');
    tap(pushing(), 'ArrowRight');
    expect(play.mock.calls[0]![3]).toBe(HIT_HOLD_MS);
    (window as { __openworldSlow?: number }).__openworldSlow = 2;
    play.mockClear();
    tap(pushing(), 'ArrowRight');
    expect(play.mock.calls[0]![3]).toBe(2 * HIT_HOLD_MS);
  });

  it('punches the camera when the push lands, and shakes it only if an enemy is ejected (#1103)', () => {
    const punch = vi.spyOn(OpenWorldView.prototype, 'punch');
    const shake = vi.spyOn(OpenWorldView.prototype, 'shake');
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    tap(pushing(), 'ArrowRight');
    expect(punch).toHaveBeenCalledWith(1000 + GLIDE_MS);
    expect(shake).not.toHaveBeenCalled();
    const [wq, wr] = shore(1);
    const m = mode(undefined, real, () => false, () => new Int32Array());
    m.enter(1, 800, 600);
    m.fixture({ hero: [wq - 3, wr], troop: [[wq - 4, wr], [wq - 5, wr]], enemies: [[wq - 1, wr]] });
    tap(m, 'ArrowRight');
    expect(shake).toHaveBeenCalledWith(1000 + GLIDE_MS);
  });

  it('keeps the camera still under reduced motion: no punch, no shake (#1103)', () => {
    const calls = [vi.spyOn(OpenWorldView.prototype, 'punch'), vi.spyOn(OpenWorldView.prototype, 'shake')];
    tap(pushing(true), 'ArrowRight');
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('draws the frames of the camera offsets, then stops drawing (#1103)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const m = pushing();
    const render = vi.fn();
    m.frame(render, 0);
    tap(m, 'ArrowRight');
    for (const now of [200, 300, 400, 500, 600, 800, 1000]) m.frame(render, now); // the follow settles on the hero after the push
    render.mockClear();
    m.frame(render, 1100);
    expect(render).not.toHaveBeenCalled();
  });

  it('marks the animation while it runs, draws every frame of it, and unmarks it at its end', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0); // the push starts at the press
    const m = pushing();
    const render = vi.fn();
    m.frame(render, 0);
    tap(m, 'ArrowRight');
    expect(body().openworldAnim).toBe('1');
    render.mockClear();
    for (const now of [100, 200, 300, 400]) m.frame(render, now);
    expect(render).toHaveBeenCalledTimes(4);
    m.frame(render, 610); // the step glides 140 ms, the push lunges from its landing, holds 50 ms on the contact and ends at 600 ms: that frame draws the final cells
    expect(body().openworldAnim).toBeUndefined();
    for (const now of [800, 1000]) m.frame(render, now); // the follow settles on the hero
    render.mockClear();
    m.frame(render, 1010);
    expect(render).not.toHaveBeenCalled();
  });

  it('a step during the animation snaps it first, then the new push plays', () => {
    const snap = vi.spyOn(OpenWorldView.prototype, 'snap');
    const play = vi.spyOn(OpenWorldView.prototype, 'playPush');
    const m = pushing();
    snap.mockClear(); // the fixture snaps too
    play.mockClear();
    m.frame(vi.fn(), 0);
    tap(m, 'ArrowRight');
    m.frame(vi.fn(), 100);
    m.release('ArrowRight');
    m.hero!.troop = [[3, -1], [3, -2], [2, -2], [4, -2], [2, -3], [3, -3], [4, -3]]; // the flock after the first push is the engine's: a troop round (3,-1) lets the bridge push again
    tap(m, 'ArrowLeft'); // the hero rolls back (the enemy on (3,0) blocks the way on): the bridge pushes again
    expect(snap).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(2);
    expect(snap.mock.invocationCallOrder[1]).toBeLessThan(play.mock.invocationCallOrder[1]!);
  });

  it('a zoom and a resize during the animation snap it too', () => {
    const snap = vi.spyOn(OpenWorldView.prototype, 'snap');
    const m = pushing();
    snap.mockClear(); // the fixture snaps too
    m.frame(vi.fn(), 0);
    tap(m, 'ArrowRight');
    snap.mockClear();
    m.zoom(1.2);
    expect(snap).toHaveBeenCalledTimes(1);
    m.resize(400, 300);
    expect(snap).toHaveBeenCalledTimes(2);
  });

  it('leaving the mode cancels the animation: no mark, nothing drawn', () => {
    const m = pushing();
    const render = vi.fn();
    m.frame(render, 0);
    tap(m, 'ArrowRight');
    m.key('Escape');
    expect(body().openworldAnim).toBeUndefined();
    render.mockClear();
    m.frame(render, 100);
    expect(render).not.toHaveBeenCalled();
  });

  it('stretches the animation by the slow factor of the page, read when it starts (a webdriver check)', () => {
    const play = vi.spyOn(OpenWorldView.prototype, 'playPush');
    (window as { __openworldSlow?: number }).__openworldSlow = 10;
    tap(pushing(), 'ArrowRight');
    expect(play.mock.calls[0]![2]).toBe(10);
  });
});

describe('the Open world save in the mode (docs/specs/openworld.md section 5, #968)', () => {
  const settle = () => new Promise((done) => setTimeout(done)); // the store's writes are microtasks
  const frameOf = (m: OpenWorldMode) => m.frame(vi.fn());
  // A saved world of seed 7: the hero on (2,0), the troop on (1,0) and (0,0), a generated enemy pushed on to (3,0), one beaten.
  const fightSaved = () => {
    const fight = new FightState();
    fight.apply([], [[3, 0]], [[9, 9]]);
    return fight.toJSON();
  };
  const savedWorld = (): WorldSave => ({ version: 1, seed: 7, hero: [2, 0], troop: [[1, 0], [0, 0]], fight: fightSaved(), yaw: 0, broken: [], lairs: [], discovered: [], time: 0, logs: [], recruits: 0, resources: { wood: 0, ore: 0, parts: 0, shards: 0 }, army: { specials: [], brought: [], relics: [], relicsBrought: [] }, savedAt: 1 });
  const withSaves = (store = memoryStore()) => {
    const saves = worldSaves(store, 1);
    return { store, saves, m: mode(undefined, undefined, undefined, undefined, saves) };
  };

  it('a saved world is applied before the first draw: the hero, the troop, the fight and the beaten count', () => {
    const { m } = withSaves();
    m.enter(7, 800, 600, savedWorld());
    expect(body().openworldAt).toBe('2,0');
    expect(body().openworldTroop).toBe('1,0 0,0');
    expect(body().openworldBeaten).toBe('1');
    expect(m.enemies()).toContainEqual([3, 0]);
    const render = vi.fn();
    m.frame(render);
    expect(render).toHaveBeenCalledOnce();
  });

  it('a step is saved once the frame runs, with the cell it reached and the seed', async () => {
    delete body().openworldSaved;
    const { m, store } = withSaves();
    m.enter(7, 800, 600);
    tap(m, 'ArrowRight');
    expect(store.data.has('openworld:7')).toBe(false); // not before the frame
    frameOf(m);
    await settle();
    expect(store.data.get('openworld:7')).toMatchObject({ version: 1, seed: 7, hero: [1, 0], fight: { removed: [], added: [], beaten: 0 } });
    expect(body().openworldSaved).toBe('1');
  });

  it('a frame with nothing new writes nothing', async () => {
    const { m, saves } = withSaves();
    const put = vi.spyOn(saves, 'put');
    m.enter(7, 800, 600);
    frameOf(m);
    await settle();
    expect(put).not.toHaveBeenCalled();
  });

  it('steps between two frames are one write, of the last state', async () => {
    const { m, saves } = withSaves();
    const put = vi.spyOn(saves, 'put');
    m.enter(7, 800, 600);
    tap(m, 'ArrowRight');
    tap(m, 'ArrowRight');
    tap(m, 'ArrowRight');
    frameOf(m);
    frameOf(m);
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![1]).toEqual([3, 0]);
  });

  it('a push is saved with the step: the enemy pushed on to (3,0) is in the save', async () => {
    const store = memoryStore();
    const m = mode(undefined, undefined, undefined, undefined, worldSaves(store, 1));
    m.enter(7, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0], [-3, 0]], enemies: [[2, 0]] });
    tap(m, 'ArrowRight');
    frameOf(m);
    await settle();
    const saved = store.data.get('openworld:7') as WorldSave;
    expect(saved.hero).toEqual([2, 0]);
    expect(saved.fight.added).toEqual([[3, 0]]);
    expect(saved.troop).toEqual([[1, 0], [0, 0], [-2, 0]]); // the troop the page marks as '1,0 0,0 -2,0' (the removed e2e read it after a reload)
  });

  it('leaving saves the final state at once, before any frame', async () => {
    const { m, store } = withSaves();
    m.enter(7, 800, 600);
    tap(m, 'ArrowRight');
    m.leave();
    await settle();
    expect((store.data.get('openworld:7') as WorldSave).hero).toEqual([1, 0]);
  });

  it('entering another world saves the one entered before', async () => {
    const { m, store } = withSaves();
    m.enter(7, 800, 600);
    tap(m, 'ArrowRight');
    m.enter(8, 800, 600);
    await settle();
    expect((store.data.get('openworld:7') as WorldSave).hero).toEqual([1, 0]);
    expect(store.data.has('openworld:8')).toBe(false);
  });

  it('a save the storage refuses is not counted, and the game goes on', async () => {
    delete body().openworldSaved;
    const broken = worldSaves(
      {
        get: async () => Promise.reject(new Error('blocked')),
        put: async () => Promise.reject(new Error('blocked')),
        delete: async () => Promise.reject(new Error('blocked')),
      },
      1,
    );
    const m = mode(undefined, undefined, undefined, undefined, broken);
    m.enter(7, 800, 600);
    tap(m, 'ArrowRight');
    frameOf(m);
    await settle();
    expect(body().openworldSaved).toBeUndefined();
    expect(body().openworldAt).toBe('1,0');
  });

  it('opens the saved world of a seed and remembers that seed as the last one played', async () => {
    const { m, store, saves } = withSaves();
    store.data.set('openworld:7', savedWorld());
    await m.open(7, 800, 600);
    expect(body().openworldAt).toBe('2,0');
    expect(await saves.last()).toBe(7);
  });

  it('opened with resume off, a world starts on the spawn whatever is saved for its seed', async () => {
    const { m, store } = withSaves();
    store.data.set('openworld:7', savedWorld());
    await m.open(7, 800, 600, false);
    expect(body().openworldAt).toBe('0,0');
  });

  it('a stale save is kept aside, not deleted, when the world opens, which then starts fresh (#1661)', async () => {
    const { m, store } = withSaves();
    store.data.set('openworld:7', { ...savedWorld(), version: 0 });
    await m.open(7, 800, 600);
    expect(body().openworldAt).toBe('0,0');
    expect(store.data.get('openworld:7:refused')).toMatchObject({ version: 0 });
  });
});

// #1021: the New world control starts a random world in place of the one left, its save discarded, and shows its seed.
describe('the New world control (#1021)', () => {
  it('discards the save of the world left, enters a random seed on the spawn and remembers it as the last one', async () => {
    const store = memoryStore();
    const saves = worldSaves(store, 1);
    const m = mode(undefined, undefined, undefined, undefined, saves);
    store.data.set('openworld:7', { version: 1, seed: 7, hero: [2, 0], troop: [], fight: { removed: [], added: [], beaten: 0 }, savedAt: 1 });
    await m.open(7, 800, 600);
    expect(body().openworldAt).toBe('2,0');
    const seed = await m.newWorld(800, 600);
    expect(seed).not.toBe(7);
    expect(body().openworld).toBe(String(seed));
    expect(body().openworldAt).toBe('0,0');
    expect(store.data.has('openworld:7')).toBe(false);
    expect(await saves.last()).toBe(seed);
  });

  it('shows the seed of the world in the HUD, and leaves the page alone when there is no HUD', async () => {
    const out = document.createElement('output');
    out.id = 'openworld-seed';
    document.body.append(out);
    const m = mode();
    await m.open(7, 800, 600);
    expect(out.textContent).toBe('7');
    await m.newWorld(800, 600);
    expect(out.textContent).toBe(body().openworld);
    out.remove();
    await mode().open(8, 800, 600); // no element: nothing to write to
    expect(body().openworld).toBe('8');
  });
});

const DEG = Math.PI / 180;
describe('the resting angles of the camera (#1254)', () => {
  it('the rest offset is 30 degrees, the default is -30, and restYaw gives the nearest resting angle (#1254)', () => {
    expect(REST_OFFSET).toBeCloseTo(Math.PI / 6);
    expect(DEFAULT_YAW).toBeCloseTo(-Math.PI / 6);
    expect(restYaw(0) / DEG).toBeCloseTo(30);
    expect(restYaw(-1.3) / DEG).toBeCloseTo(-90);
    expect(restYaw(80 * DEG) / DEG).toBeCloseTo(90);
  });
});

describe('a held arrow slides round an obstacle instead of leaning (#1137)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('goes round an enemy ahead without a lean, and leans only when the sides are shut too', () => {
    const nudge = vi.spyOn(OpenWorldView.prototype, 'nudge');
    const m = mode(undefined, undefined, () => false, undefined);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [[1, 0]] });
    m.key('ArrowRight');
    m.release('ArrowRight');
    expect(m.hero!.at).toEqual([0, 1]); // at the default camera the intent leans to the south-east side
    expect(nudge).not.toHaveBeenCalled();
    m.fixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [[1, 0], [1, -1], [0, 1]] });
    m.key('ArrowRight');
    m.release('ArrowRight');
    expect(m.hero!.at).toEqual([0, 0]);
    expect(nudge).toHaveBeenCalledTimes(1);
  });
  it('goes round a boulder and stops at the edge of the world', () => {
    const m = mode(undefined, undefined, () => true, undefined);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [], enemies: [] });
    m.key('ArrowDown'); // the boulder of the test world is on (0, 1); down-right-ish steps round it
    m.release('ArrowDown');
    expect(m.hero!.at).not.toEqual([0, 0]);
  });
});

describe('the keys turn the camera by a step, and a drag or a twist turns it too (#1026)', () => {
  it('Q and E turn the view a step each way, R goes back to the default angle, and the yaw is published in degrees', () => {
    const m = mode();
    m.enter(7, 800, 600);
    expect(body().openworldYaw).toBe('-30'); // the default faces a straight line of hexes (#1254)
    expect(m.key('q')).toBe(true);
    expect(body().openworldYaw).toBe('30');
    m.key('q');
    m.key('e');
    expect(body().openworldYaw).toBe('30');
    m.key('r');
    expect(body().openworldYaw).toBe('-30');
    expect(m.key('x')).toBe(false); // not the mode's
  });

  it('the stick reads the yaw of the camera: the goal of the turn, which the keys and the drag set', () => {
    const m = mode();
    m.enter(7, 800, 600);
    expect(m.yaw).toBeCloseTo(DEFAULT_YAW);
    m.key('q');
    expect(m.yaw).toBeCloseTo(DEFAULT_YAW + TURN_STEP);
  });

  it('a drag of the right button turns the view by ORBIT_PER_PX a px, and a twist turns it by its angle, the shortest way', () => {
    const m = mode();
    m.enter(7, 800, 600);
    m.orbit(100);
    expect(body().openworldYaw).toBe(String(Math.round((100 * ORBIT_PER_PX * 180) / Math.PI) - 30));
    expect(twistOf(0, 3)).toBe(3);
    expect(twistOf(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it('the stick holds the keys it reads: a diagonal of two keys is one roll at once, then on the cadence until it lets go (#1059)', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const m = mode();
    m.enter(7, 800, 600);
    m.hold(['ArrowUp', 'ArrowRight']);
    expect(body().openworldAt).toBe('1,0'); // the diagonal at the default camera
    m.hold(['ArrowUp', 'ArrowRight']); // the same keys again: no step of their own
    expect(body().openworldAt).toBe('1,0');
    clock = GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(body().openworldAt).not.toBe('1,0'); // the cadence steps the held stick
    m.hold([]);
    const stopped = body().openworldAt;
    clock = 3 * GLIDE_MS;
    m.frame(vi.fn(), clock);
    expect(body().openworldAt).toBe(stopped);
    vi.restoreAllMocks();
  });

  it('a turn takes 60 degrees, one per hex direction: six presses go all the way round (#1251)', () => {
    expect(TURN_STEP).toBeCloseTo(Math.PI / 3);
    const m = mode();
    m.enter(7, 800, 600);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      m.key('q');
      seen.push(body().openworldYaw!);
    }
    expect(seen).toEqual(['30', '90', '150', '-150', '-90', '-30']);
  });

  it('a drag turns freely while held, then settles on the nearest multiple of 60 degrees on release (#1251)', () => {
    const m = mode();
    m.enter(7, 800, 600);
    m.orbit(100); // 50 degrees: from -30 to 20
    expect(body().openworldYaw).toBe('20');
    m.settle();
    expect(body().openworldYaw).toBe('30');
    m.orbit(-100); // -20
    m.settle();
    expect(body().openworldYaw).toBe('-30');
  });

  it('a saved yaw of 0 (an old save) opens at the nearest resting angle, 30 degrees (#1254)', async () => {
    const saves = worldSaves(memoryStore(), 1);
    await saves.put(7, [0, 0], [[0, 0]], new FightState(), 0);
    const m = mode(undefined, undefined, undefined, undefined, saves);
    await m.open(7, 800, 600);
    expect(body().openworldYaw).toBe('30');
  });

  it('the turn is saved with the world: a frame writes it, and opening the world again applies it', async () => {
    const saves = worldSaves(memoryStore(), 1);
    const m = mode(undefined, undefined, undefined, undefined, saves);
    m.enter(7, 800, 600);
    m.key('q');
    m.frame(() => {}, 0);
    await new Promise((done) => setTimeout(done));
    expect((await saves.load(7))!.yaw).toBeCloseTo(DEFAULT_YAW + TURN_STEP);
    await m.open(7, 800, 600);
    expect(body().openworldYaw).toBe('30');
  });
});

describe('the glide of a step in the mode (docs/specs/openworld.md section 4, #1040)', () => {
  // The hero (0,0) with the troop behind it; the cell (1,0) is free, so a Right press steps onto it.
  const standing = (reduced = false, foes: Axial[] = []): OpenWorldMode => {
    const m = mode(undefined, undefined, () => reduced, undefined);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: foes });
    return m;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { __openworldSlow?: number }).__openworldSlow;
  });

  it('glides the step: the view is shown with the time of the step and the span of the glide', () => {
    const show = vi.spyOn(OpenWorldView.prototype, 'show');
    tap(standing(), 'ArrowRight');
    expect(show.mock.calls.at(-1)![0]).toEqual([1, 0]);
    expect(show.mock.calls.at(-1)![2]).toEqual({ now: expect.any(Number), span: GLIDE_MS, pace: 'start' }); // the first step of a held arrow (#1065)
  });

  it('a held walk speeds up to the cruise pace, each glide lasting until the next step (#1290)', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const show = vi.spyOn(OpenWorldView.prototype, 'show');
    const m = standing();
    const span = (): number => (show.mock.calls.at(-1)![2] as { span: number }).span;
    m.key('ArrowRight');
    const spans = [span()];
    for (let i = 1; i < 8; i++) {
      clock += spans.at(-1)!;
      m.frame(vi.fn(), clock);
      spans.push(span());
    }
    expect(spans).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(stepMs));
    expect(spans.at(-1)).toBe(CRUISE_MS);
    m.release('ArrowRight');
    clock += 1;
    m.frame(vi.fn(), clock);
    m.key('ArrowRight'); // a new press starts from the first pace again
    expect(span()).toBe(GLIDE_MS);
  });

  it('stretches the glide by the slow factor of the page, read when the step starts (a webdriver check)', () => {
    const show = vi.spyOn(OpenWorldView.prototype, 'show');
    (window as { __openworldSlow?: number }).__openworldSlow = 10;
    tap(standing(), 'ArrowRight');
    expect(show.mock.calls.at(-1)![2]).toEqual({ now: expect.any(Number), span: GLIDE_MS * 10, pace: 'start' });
  });

  it('writes the glide mark only under webdriver, the page the browser checks drive: a player never pays for it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const m = standing();
    m.frame(vi.fn(), 0);
    tap(m, 'ArrowRight');
    m.frame(vi.fn(), 60);
    expect(body().openworldGlide).toBeUndefined(); // navigator.webdriver is not set here
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    try {
      m.frame(vi.fn(), 70);
      expect(body().openworldGlide).toMatch(/^-?\d/);
    } finally {
      delete (navigator as { webdriver?: boolean }).webdriver;
    }
  });

  it('marks the glide while the marbles move, with the drawn place of the hero, and unmarks it on landing', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = standing();
    m.frame(vi.fn(), 0);
    tap(m, 'ArrowRight');
    const render = vi.fn();
    m.frame(render, 60);
    expect(body().openworldGlide).toMatch(/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/); // the hero's drawn place and height (the hop), mid-glide
    expect(body().openworldAnim).toBeUndefined(); // a glide is not a push
    m.frame(render, GLIDE_MS + 10); // the frame of the landing draws the last cell
    m.frame(render, GLIDE_MS + 60);
    expect(body().openworldGlide).toBeUndefined();
    delete (navigator as { webdriver?: boolean }).webdriver;
  });

  it('draws nothing of a glide under reduced motion: the step is shown on its cell at once', () => {
    const show = vi.spyOn(OpenWorldView.prototype, 'show');
    const m = standing(true);
    show.mockClear();
    tap(m, 'ArrowRight');
    expect(show.mock.calls.at(-1)![2]).toBeUndefined();
    m.frame(vi.fn(), 10);
    expect(body().openworldGlide).toBeUndefined();
  });

  it('draws the landing frame of a glide, then nothing: the loop goes idle one frame after it lands', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const m = standing();
    m.frame(vi.fn(), 0);
    tap(m, 'ArrowRight');
    const render = vi.fn();
    m.frame(render, GLIDE_MS + 10); // the frame that lands the hero draws its last place
    expect(render).toHaveBeenCalledTimes(1);
    render.mockClear();
    m.frame(render, 600); // the dust of the step (#1110) is gone: the frame that erases it is the last one
    expect(render).toHaveBeenCalledTimes(1);
    render.mockClear();
    m.frame(render, 630);
    expect(render).not.toHaveBeenCalled();
  });

  it('keeps the loop drawing a blocked lean on the cadence while the key is held, and idle after its last 120 ms (#1059)', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const nudge = vi.spyOn(OpenWorldView.prototype, 'nudge');
    const m = standing(false, [[1, 0], [1, -1], [0, 1]]); // a wall of enemies ahead: a Right key leans the hero, each step of the cadence
    m.frame(vi.fn(), 0);
    m.key('ArrowRight'); // at 0 ms: the first lean at once
    const render = vi.fn();
    m.frame(render, GLIDE_MS); // the cadence leans it again
    m.frame(render, 2 * GLIDE_MS);
    expect(nudge).toHaveBeenCalledTimes(3);
    m.release('ArrowRight'); // the last lean began at 280 ms: it is over at 400 ms
    m.frame(render, 2 * GLIDE_MS + NUDGE_MS); // the frame that ends the lean draws its last place
    render.mockClear();
    m.frame(render, 2 * GLIDE_MS + NUDGE_MS + 40);
    expect(render).not.toHaveBeenCalled();
    expect(nudge).toHaveBeenCalledTimes(3); // and no lean after the release
  });

  it('leans the hero toward a cell a blocked step names, for the nudge time, and not under reduced motion', () => {
    const nudge = vi.spyOn(OpenWorldView.prototype, 'nudge');
    tap(standing(false, [[1, 0], [1, -1], [0, 1]]), 'ArrowRight'); // a wall of enemies blocks it
    expect(nudge).toHaveBeenCalledWith([0, 0], [1, 0], expect.any(Number), NUDGE_MS);
    nudge.mockClear();
    tap(standing(true, [[1, 0], [1, -1], [0, 1]]), 'ArrowRight');
    expect(nudge).not.toHaveBeenCalled();
  });
});

// #1059: a held arrow walks on its own. The keydown steps at once; while the arrows are held the frame loop steps one cell per
// GLIDE_MS, from the frame and not from the system's key repeat, which is ignored. A release, a blur or a leave stops the walk.
describe('the held arrows step on their own cadence, one per GLIDE_MS (#1059)', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const at = () => body().openworldAt;

  it('steps on the keydown, then on each GLIDE_MS frame while the key is held, and not between them', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    expect(at()).toBe('1,0'); // the first step, on the keydown itself
    m.frame(vi.fn(), GLIDE_MS - 1);
    expect(at()).toBe('1,0');
    m.frame(vi.fn(), GLIDE_MS);
    expect(at()).toBe('2,0');
    m.frame(vi.fn(), 2 * GLIDE_MS - 1);
    expect(at()).toBe('2,0');
    m.frame(vi.fn(), 2 * GLIDE_MS);
    expect(at()).toBe('3,0');
  });

  it('walks one cell per GLIDE_MS on the frames of a long hold: ten frames, ten cells', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    for (let i = 1; i <= 10; i++) m.frame(vi.fn(), i * GLIDE_MS);
    expect(at()).toBe('11,0');
  });

  it('draws each step of the cadence: the frame that steps renders the hero on its new cell', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    const render = vi.fn();
    m.frame(render, GLIDE_MS);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('a late frame does not stretch the walk: the schedule keeps its own clock, one cell per GLIDE_MS on average', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight'); // the schedule: 140 ms
    m.frame(vi.fn(), 150); // 10 ms late: the next step is due at 280 ms, not 290
    expect(at()).toBe('2,0');
    m.frame(vi.fn(), 285); // 5 ms late
    expect(at()).toBe('3,0');
    m.frame(vi.fn(), 425);
    expect(at()).toBe('4,0');
  });

  it('a hidden tab that comes back more than a step late restarts the walk from the frame, without a burst', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    m.frame(vi.fn(), 1000); // back after a second: one step, and the next one a step later
    expect(at()).toBe('2,0');
    m.frame(vi.fn(), 1100);
    expect(at()).toBe('2,0');
    m.frame(vi.fn(), 1140);
    expect(at()).toBe('3,0');
  });

  it('ignores the system key repeat: a repeat steps nothing and does not restart the cadence', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    clock = 100;
    expect(m.key('ArrowRight', true)).toBe(true); // the repeat is the mode's key, and no step
    expect(at()).toBe('1,0');
    m.frame(vi.fn(), GLIDE_MS); // the cadence of the keydown, not one from the repeat at 100 ms
    expect(at()).toBe('2,0');
  });

  it('a second arrow pressed during a hold rolls the diagonal on the next step, with no step of its own', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    clock = 50;
    m.key('ArrowUp');
    expect(at()).toBe('1,0');
    m.frame(vi.fn(), GLIDE_MS);
    expect(at()).toBe('2,0');
  });

  it('a release stops the walk at the end of the step under way: no step after it', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    clock = 60;
    m.release('ArrowRight');
    m.frame(vi.fn(), GLIDE_MS);
    m.frame(vi.fn(), 3 * GLIDE_MS);
    expect(at()).toBe('1,0');
  });

  it('a blur (no key given) stops the walk at once', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    m.release();
    m.frame(vi.fn(), GLIDE_MS);
    expect(at()).toBe('1,0');
  });

  it('leaving the mode stops the walk, and a world entered again starts with no key held', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.key('ArrowRight');
    m.leave();
    m.frame(vi.fn(), GLIDE_MS); // left: nothing steps
    m.enter(1, 800, 600);
    m.frame(vi.fn(), 2 * GLIDE_MS);
    expect(at()).toBe('0,0');
  });

  it('the stick holds nothing once the mode is left: a hold then steps nothing when the world is entered again', () => {
    const m = mode();
    m.enter(1, 800, 600);
    m.leave();
    m.hold(['ArrowRight']); // the mode is off: the stick's late hold is ignored
    m.enter(1, 800, 600);
    m.frame(vi.fn(), GLIDE_MS);
    expect(m.hero!.at).toEqual([0, 0]);
  });

  it('a lean into a wall is kept on the cadence too, and the next key down leans at once again', () => {
    const nudge = vi.spyOn(OpenWorldView.prototype, 'nudge');
    const m = mode(undefined, undefined, () => false, undefined);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[1, 0], [1, -1], [0, 1]] }); // enemies ahead: a wall
    m.key('ArrowRight');
    expect(nudge).toHaveBeenCalledTimes(1);
    m.release('ArrowRight');
    clock = 10;
    m.key('ArrowRight');
    expect(nudge).toHaveBeenCalledTimes(2);
  });
});

describe('the particles in the mode frame (#1110)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps drawing while pollen drifts in a meadow, with motion on: the scene is live', () => {
    const m = mode(undefined, meadow, () => false);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 0);
    m.frame(render, 400);
    m.frame(render, 800);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('draws no particles on the low tier: only the first frame is drawn (#1104)', () => {
    document.body.dataset.tier = 'low';
    try {
      const m = mode(undefined, meadow, () => false);
      m.enter(1, 800, 600);
      const render = vi.fn();
      m.frame(render, 0);
      m.frame(render, 400);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      delete document.body.dataset.tier;
    }
  });

  it('draws only the first frame under reduced motion, as before', () => {
    const m = mode(undefined, meadow, () => true);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 0);
    m.frame(render, 400);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('puffs dust at a step with motion on, none under reduced motion', () => {
    const puff = vi.spyOn(OpenWorldView.prototype, 'puff');
    const live = mode(undefined, meadow, () => false, undefined);
    live.enter(1, 800, 600);
    live.fixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [] });
    tap(live, 'ArrowRight');
    expect(puff).toHaveBeenCalledTimes(1);
    puff.mockClear();
    const still = mode(undefined, meadow, () => true, undefined);
    still.enter(1, 800, 600);
    still.fixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [] });
    tap(still, 'ArrowRight');
    expect(puff).not.toHaveBeenCalled();
  });

  it('writes the particle count only under webdriver, the page the browser checks drive', () => {
    const m = mode(undefined, meadow, () => false);
    m.enter(1, 800, 600);
    m.frame(vi.fn(), 2000);
    expect(body().openworldParticles).toBeUndefined();
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    try {
      m.frame(vi.fn(), 2400);
      expect(Number(body().openworldParticles)).toBeGreaterThan(0);
      m.leave();
      expect(body().openworldParticles).toBeUndefined();
    } finally {
      delete (navigator as { webdriver?: boolean }).webdriver;
    }
  });
});

// #1147: the hero breaks the boulder on (0, 1): the prop leaves the scene, the shards play, and the broken cell is saved and restored.
describe('the hero breaks a boulder in the mode (#1147)', () => {
  const settle = () => new Promise((done) => setTimeout(done));
  const beside = (reduced = false, saves = worldSaves(memoryStore(), 1)): OpenWorldMode => {
    const m = mode(undefined, undefined, () => reduced, undefined, saves);
    m.enter(1, 800, 600);
    m.fixture({ hero: [0, 2], troop: [[1, 2], [2, 2]], enemies: [] });
    return m;
  };
  afterEach(() => vi.restoreAllMocks());

  it('rolls onto the boulder, takes its prop out of the scene and plays the shards at the time of the step', () => {
    const smash = vi.spyOn(OpenWorldView.prototype, 'smash');
    const m = beside();
    expect(JSON.parse(body().openworldDrawn!)['prop-boulder']).toBe(1);
    expect(tap(m, 'ArrowLeft')).toBe(true);
    expect(m.hero!.at).toEqual([0, 1]);
    expect(smash).toHaveBeenCalledWith([0, 1], 'boulder', expect.any(Number), false);
    expect(JSON.parse(body().openworldDrawn!)['prop-boulder']).toBe(0);
    expect(body().openworldBroken).toBe('1');
  });

  it('plays the fade of reduced motion', () => {
    const smash = vi.spyOn(OpenWorldView.prototype, 'smash');
    tap(beside(true), 'ArrowLeft');
    expect(smash).toHaveBeenCalledWith([0, 1], 'boulder', expect.any(Number), true);
  });

  it('a step that breaks nothing plays no shards', () => {
    const smash = vi.spyOn(OpenWorldView.prototype, 'smash');
    tap(beside(), 'ArrowRight');
    expect(smash).not.toHaveBeenCalled();
  });

  it('a break of another hero (#1305) opens the cell, takes its prop out and plays the shards, and a cell that is no obstacle does nothing', () => {
    const smash = vi.spyOn(OpenWorldView.prototype, 'smash');
    const m = beside();
    const render = vi.fn();
    m.frame(render, 1000);
    m.remoteBreak([1, 2]); // open ground
    m.remoteBreak([900, 900]); // off the loaded world
    expect(smash).not.toHaveBeenCalled();
    m.remoteBreak([0, 1]);
    expect(smash).toHaveBeenCalledWith([0, 1], 'boulder', expect.any(Number), false);
    expect(JSON.parse(body().openworldDrawn!)['prop-boulder']).toBe(0);
    expect(body().openworldBroken).toBe('1');
    m.frame(render, 1016);
    expect(render).toHaveBeenCalledTimes(2); // the break is drawn
    m.remoteBreak([0, 1]); // twice: it is open now
    expect(smash).toHaveBeenCalledTimes(1);
  });

  it('opens a cell whose prop is not drawn without the shards, and does nothing before a world is entered', () => {
    const m = beside(true);
    vi.spyOn(OpenWorldView.prototype, 'hasProp').mockReturnValue(false);
    const smash = vi.spyOn(OpenWorldView.prototype, 'smash');
    m.remoteBreak([0, 1]);
    expect(smash).not.toHaveBeenCalled();
    expect(body().openworldBroken).toBe('1'); // opened all the same
    expect(m.hero!.at).toEqual([0, 2]);
    expect(() => mode().remoteBreak([0, 1])).not.toThrow();
  });

  it('a beaten enemy of another hero (#1305) is gone and counted, named by the cell it starts on, and a cell no enemy starts on does nothing', () => {
    const m = mode();
    m.enter(1, 800, 600);
    const drawn = Number(body().openworldEnemies);
    m.remoteBeaten([4, 4]); // no generated enemy starts there
    expect(body().openworldBeaten).toBe('0');
    m.remoteBeaten([5, 5]);
    expect(body().openworldBeaten).toBe('1');
    expect(body().openworldEnemies).toBe(String(drawn - 1));
    m.remoteBeaten([5, 5]); // twice: it is gone now
    expect(body().openworldBeaten).toBe('1');
  });

  it('tells the peers host which enemy the hero ejected (#1305), and none when nothing was ejected', () => {
    const [wq, wr] = shore(1);
    const peers = { enter: vi.fn(), frame: vi.fn(() => false), leave: vi.fn(), broke: vi.fn(), beaten: vi.fn(), lairWon: vi.fn(), wildWon: vi.fn() };
    const m = mode(undefined, real, () => true, () => new Int32Array());
    m.peers = peers;
    m.enter(1, 800, 600);
    m.fixture({ hero: [wq - 3, wr], troop: [[wq - 4, wr], [wq - 5, wr]], enemies: [[wq - 1, wr]] });
    tap(m, 'ArrowRight'); // the line pushes the enemy on to the water
    expect(peers.beaten).toHaveBeenCalledWith([wq - 1, wr]);
    peers.beaten.mockClear();
    m.fixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    tap(m, 'ArrowLeft'); // a step with no enemy in line
    expect(peers.beaten).not.toHaveBeenCalled();
  });

  it('tells the peers host which cell the hero broke, and none when it broke nothing', () => {
    const peers = { enter: vi.fn(), frame: vi.fn(() => false), leave: vi.fn(), broke: vi.fn(), beaten: vi.fn(), lairWon: vi.fn(), wildWon: vi.fn() };
    const quiet = beside();
    quiet.peers = peers;
    tap(quiet, 'ArrowRight');
    expect(peers.broke).not.toHaveBeenCalled();
    const m = beside();
    m.peers = peers;
    tap(m, 'ArrowLeft');
    expect(peers.broke).toHaveBeenCalledWith([0, 1]);
  });

  it('saves the broken cell with the world, and a world entered from that save has it broken', async () => {
    const store = memoryStore();
    const saves = worldSaves(store, 1);
    const m = beside(false, saves);
    tap(m, 'ArrowLeft');
    m.frame(vi.fn());
    await settle();
    expect(store.data.get('openworld:1')).toMatchObject({ broken: [[0, 1]] });
    const back = (await saves.load(1))!;
    const again = mode(undefined, undefined, undefined, undefined, saves);
    again.enter(1, 800, 600, back);
    expect(JSON.parse(body().openworldDrawn!)['prop-boulder']).toBe(0);
    expect(body().openworldBroken).toBe('1');
    again.leave();
    expect(body().openworldBroken).toBeUndefined();
  });
});

describe('the marbles wear the skins of the ship (#1176)', () => {
  const lookOf = (m: OpenWorldMode, ...names: string[]): THREE.MeshStandardMaterial[] => {
    let found: THREE.MeshStandardMaterial[] = [];
    m.frame((scene) => (found = names.map((name) => (scene.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial)));
    return found;
  };
  const worn = () => {
    const skin = () => Object.assign(new THREE.MeshStandardMaterial(), { map: new THREE.Texture() });
    return { player: skin(), shell: skin() };
  };

  it('reads the skins when a world opens: the hero wears the player skin, the enemies the shell skin', async () => {
    const skins = worn();
    const asked = vi.fn(async () => skins);
    const m = new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), undefined, undefined, asked,
    );
    await m.open(1, 800, 600);
    expect(asked).toHaveBeenCalledTimes(1);
    const [hero, enemies] = lookOf(m, 'hero', 'enemies');
    expect(hero!.map).toBe(skins.player.map);
    expect(enemies!.map).toBe(skins.shell.map);
  });

  it('keeps the Lights and Lamps sliders for the next world and gives them to the open one (#1727)', async () => {
    const m = new OpenWorldMode((_seed, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1));
    const sunOf = () => {
      let sun = 0;
      m.frame((scene) => scene.traverse((o) => void ((o as THREE.DirectionalLight).isDirectionalLight && (sun = (o as THREE.Light).intensity))));
      return sun;
    };
    await m.open(1, 800, 600);
    const tuned = sunOf();
    m.leave();
    m.setLevels(0.5, 1); // no world open: kept
    await m.open(1, 800, 600);
    expect(sunOf()).toBeCloseTo(tuned * 0.5);
    m.setLevels(2, 1); // drawn again with them
    expect(sunOf()).toBeCloseTo(tuned * 2);
  });

  it('reads the skins again when Settings changes one, and does nothing with no world open (#1726)', async () => {
    let skins = worn();
    const asked = vi.fn(async () => skins);
    const m = new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), undefined, undefined, asked,
    );
    await m.reskin(); // no world yet: nothing to dress
    expect(asked).not.toHaveBeenCalled();
    await m.open(1, 800, 600);
    skins = worn();
    await m.reskin();
    expect(asked).toHaveBeenCalledTimes(2);
    const [hero, enemies] = lookOf(m, 'hero', 'enemies');
    expect(hero!.map).toBe(skins.player.map);
    expect(enemies!.map).toBe(skins.shell.map);
  });

  it('keeps the plain looks when a world is entered with no skins', () => {
    const m = mode();
    m.enter(1, 800, 600);
    expect(lookOf(m, 'hero')[0]!.map).toBeNull();
  });
});

describe('tap to walk and the steering setting (#1137, docs/specs/openworld.md section 4)', () => {
  type PathBridge = (seed: number, from: Axial, to: Axial, blocked: Int32Array, broken: Int32Array) => Int32Array;
  let clock = 0;
  const walker = (path: PathBridge, steering: () => boolean = () => true, foes: Int32Array = new Int32Array(), lairs = new Int32Array()) =>
    new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), (_seed, cx, cy) => (cx === 0 && cy === 0 ? foes : new Int32Array()), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), () => lairs, undefined, undefined, undefined, undefined, path, steering,
    );
  const along = (...cells: Axial[]): PathBridge => () => Int32Array.from(cells.flat());
  const far = (cell: Axial | null) => vi.spyOn(OpenWorldView.prototype, 'pickGround').mockReturnValue(cell);
  const tapFar = (m: OpenWorldMode) => m.press(400, 300, 800, 600); // the centre picks the hero's own cell: the far pick decides
  const frameAt = (m: OpenWorldMode, ms: number) => {
    clock = ms;
    m.frame(vi.fn(), clock);
  };
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    document.body.innerHTML = '<output id="openworld-mode"></output>';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('asks the path of the far cell with the enemies and the lairs as blocked and the broken cells, and walks it one cell a glide', () => {
    far([3, 0]);
    const path = vi.fn<PathBridge>(() => Int32Array.of(1, 0, 2, 0, 3, 0));
    const m = walker(path, undefined, Int32Array.of(0, 4), Int32Array.of(9, 9));
    m.enter(5, 800, 600);
    tapFar(m);
    expect(path).toHaveBeenCalledWith(5, [0, 0], [3, 0], Int32Array.of(0, 4, 9, 9), new Int32Array());
    expect(m.hero!.at).toEqual([1, 0]); // the first cell at once
    expect(body().openworldRoute).toBe('2');
    frameAt(m, GLIDE_MS);
    expect(m.hero!.at).toEqual([2, 0]);
    frameAt(m, 2 * GLIDE_MS);
    expect(m.hero!.at).toEqual([3, 0]);
    expect(body().openworldRoute).toBe('0');
    frameAt(m, 5 * GLIDE_MS);
    expect(m.hero!.at).toEqual([3, 0]); // arrived: no step follows
  });

  it('a key cancels the walk, and is itself the next step', () => {
    far([3, 0]);
    const m = walker(along([1, 0], [2, 0], [3, 0]));
    m.enter(1, 800, 600);
    tapFar(m);
    m.key('Shift');
    expect(body().openworldRoute).toBe('0');
    frameAt(m, GLIDE_MS);
    expect(m.hero!.at).toEqual([1, 0]);
  });

  it('a drag (cancelWalk) and the stick cancel the walk; cancelling with no walk does nothing', () => {
    far([3, 0]);
    const m = walker(along([1, 0], [2, 0], [3, 0]));
    m.enter(1, 800, 600);
    m.cancelWalk();
    tapFar(m);
    m.cancelWalk();
    frameAt(m, GLIDE_MS);
    expect(m.hero!.at).toEqual([1, 0]);
    tapFar(m);
    m.hold(['ArrowLeft']);
    expect(body().openworldRoute).toBe('0');
    m.hold([]);
  });

  it('a new far tap replaces the walk under way', () => {
    far([3, 0]);
    let n = 0;
    const m = walker(() => (n++ === 0 ? Int32Array.of(1, 0, 2, 0, 3, 0) : Int32Array.of(2, 0, 2, -1)));
    m.enter(1, 800, 600);
    tapFar(m);
    tapFar(m);
    frameAt(m, GLIDE_MS);
    expect(m.hero!.at).toEqual([2, 0]);
    frameAt(m, 2 * GLIDE_MS);
    expect(m.hero!.at).toEqual([2, -1]);
  });

  it('stops when a step is refused: an enemy on the way, a cell that is no neighbour', () => {
    far([3, 0]);
    const m = walker(along([1, 0], [5, 5], [6, 5]));
    m.enter(1, 800, 600);
    tapFar(m);
    frameAt(m, GLIDE_MS);
    expect(m.hero!.at).toEqual([1, 0]);
    expect(body().openworldRoute).toBe('0');
    frameAt(m, 3 * GLIDE_MS);
    expect(m.hero!.at).toEqual([1, 0]);
  });

  it('does nothing when the pick or the path is empty, and a press next to the hero still rolls it', () => {
    const path = vi.fn<PathBridge>(() => new Int32Array());
    const m = walker(path);
    m.enter(1, 800, 600);
    far(null);
    tapFar(m);
    expect(path).not.toHaveBeenCalled();
    far([3, 0]);
    tapFar(m);
    expect(path).toHaveBeenCalledTimes(1);
    expect(m.hero!.at).toEqual([0, 0]);
    far([1, 0]); // next to the hero: no walk
    tapFar(m);
    expect(path).toHaveBeenCalledTimes(1);
    m.press(400 + 55, 300, 800, 600);
    expect(m.hero!.at).toEqual([1, 0]);
  });

  it('with steering off a held arrow leans against an enemy instead of going round, and a far tap does nothing', () => {
    far([3, 0]);
    const path = vi.fn<PathBridge>(() => Int32Array.of(1, 0));
    let on = true;
    const m = walker(path, () => on, Int32Array.of(1, 0));
    m.enter(1, 800, 600);
    on = false;
    m.refreshMode();
    tapFar(m);
    expect(path).not.toHaveBeenCalled();
    m.key('ArrowRight');
    expect(m.hero!.at).toEqual([0, 0]); // the enemy on (1,0) blocks, no side step
    m.release('ArrowRight');
    on = true;
    m.refreshMode();
    m.key('ArrowRight');
    expect(m.hero!.at).not.toEqual([0, 0]); // on: it slides round
    m.release('ArrowRight');
  });

  it('the HUD names the mode, and turning steering off cancels the walk', () => {
    far([3, 0]);
    let on = true;
    const m = walker(along([1, 0], [2, 0], [3, 0]), () => on);
    m.enter(1, 800, 600);
    const line = () => document.getElementById('openworld-mode')!.textContent;
    expect(line()).toContain('Steering on');
    tapFar(m);
    on = false;
    m.refreshMode();
    expect(line()).toContain('Steering off');
    expect(body().openworldRoute).toBe('0');
    m.leave();
    m.refreshMode(); // left: nothing to show
    document.body.innerHTML = '';
    m.enter(1, 800, 600);
    m.refreshMode(); // no HUD line in the page
  });

  it('a walk step onto a lair opens the lair, as a step by hand, and the frame ends with the mode', () => {
    far([3, 0]);
    const onLair = vi.fn();
    const m = new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), () => Int32Array.of(2, 0), onLair, undefined, undefined, undefined, along([1, 0], [2, 0]),
    );
    m.enter(1, 800, 600);
    tapFar(m);
    frameAt(m, GLIDE_MS); // a path that went through the lair anyway: the lair opens, as for a step by hand
    expect(onLair).toHaveBeenCalledWith(1, 0, [], []); // no special marble nor relic brought
    expect(m.active).toBe(false);
  });

  it('leaving clears the walk and its mark', () => {
    far([3, 0]);
    const m = walker(along([1, 0], [2, 0]));
    m.enter(1, 800, 600);
    tapFar(m);
    m.leave();
    expect(body().openworldRoute).toBeUndefined();
  });
});

describe('the scene of a world is released to the renderer (#1258)', () => {
  const releasing = (release: (scene: THREE.Scene) => void) =>
    new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), undefined, undefined, undefined, undefined, undefined, undefined, undefined, release,
    );

  it('releases the scene on leave, and the scene replaced by another seed entered over it', () => {
    const released: THREE.Scene[] = [];
    const m = releasing((scene) => released.push(scene));
    m.enter(1, 800, 600);
    const first = m.scene;
    m.enter(2, 800, 600);
    expect(released).toEqual([first]);
    const second = m.scene;
    m.leave();
    expect(released).toEqual([first, second]);
  });

  it('builds an opened world in three tasks, the world and its view, its first chunks, the rest, so the page answers between them (#1582)', async () => {
    const m = releasing(() => {});
    const opened = m.open(1, 800, 600, false);
    await new Promise<void>((done) => queueMicrotask(done));
    await Promise.resolve();
    expect(m.active).toBe(false); // the view is made, the chunks wait for the next task
    expect(m.scene).toBeNull();
    const resized = vi.spyOn(OpenWorldView.prototype, 'resize');
    await new Promise((task) => setTimeout(task));
    expect(resized).toHaveBeenCalledWith(800, 600); // its first chunks, in a task of their own
    expect(m.active).toBe(false);
    resized.mockRestore();
    await opened;
    expect(m.active).toBe(true);
    expect(m.scene).toBeInstanceOf(THREE.Scene);
  });

  it('settles its props once their models are in the view, and at once before any world (#1582)', async () => {
    await expect(releasing(() => {}).props).resolves.toBeUndefined();
    let arrive: (models: PropModels) => void = () => {};
    const m = mode(() => new Promise<PropModels>((done) => (arrive = done)));
    m.enter(1, 800, 600);
    let settled = false;
    void m.props.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    const used = vi.spyOn(OpenWorldView.prototype, 'useModels');
    arrive({ low: {}, high: {} });
    await m.props;
    expect(settled).toBe(true);
    expect(used).toHaveBeenCalled(); // the models are in before it settles
    used.mockRestore();
  });

  it('gives the camera of the scene drawn, none before the enter and after the leave (#1582)', () => {
    const m = releasing(() => {});
    expect(m.eye).toBeNull();
    m.enter(1, 800, 600);
    expect(m.eye).toBeInstanceOf(THREE.Camera);
    m.leave();
    expect(m.eye).toBeNull();
  });
});

describe('the Dungeon button walks to the nearest tower (#1291)', () => {
  type Bridge = (seed: number, from: Axial, beaten: Int32Array, blocked: Int32Array, broken: Int32Array) => Int32Array;
  const dungeoner = (dungeon?: Bridge, foes = new Int32Array(), lairs = new Int32Array()) =>
    new OpenWorldMode(
      (_seed, cx, cy) => bytes(cx, cy), (_seed, cx, cy) => (cx === 0 && cy === 0 ? foes : new Int32Array()), async () => ({ low: {}, high: {} }), () => true,
      worldSaves(memoryStore(), 1), () => lairs, undefined, undefined, undefined, undefined, undefined, undefined, undefined, dungeon,
    );
  beforeEach(() => {
    document.body.innerHTML = '<output id="openworld-mode"></output><p id="openworld-dungeon-note"></p>';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('asks for the tower with the beaten lairs, the enemies and lairs as blocked, and walks the cells after the lair number', () => {
    const dungeon = vi.fn<Bridge>(() => Int32Array.of(2, 1, 0, 2, 0, 3, 0));
    const m = dungeoner(dungeon, Int32Array.of(0, 4), Int32Array.of(9, 9));
    m.enter(5, 800, 600);
    expect(m.dungeon()).toBe(true);
    expect(dungeon).toHaveBeenCalledWith(5, [0, 0], new Int32Array(), Int32Array.of(0, 4, 9, 9), new Int32Array());
    expect(m.hero!.at).toEqual([1, 0]);
    expect(body().openworldRoute).toBe('2');
    expect(document.getElementById('openworld-dungeon-note')!.textContent).toBe('');
    m.key('Shift'); // a key cancels it, as for tap to walk
    expect(body().openworldRoute).toBe('0');
  });

  it('says so when no tower is in reach, and does not move', () => {
    const m = dungeoner(); // the default bridge knows no tower
    m.enter(5, 800, 600);
    expect(m.dungeon()).toBe(false);
    expect(document.getElementById('openworld-dungeon-note')!.textContent).toBe('No tower in reach: walk on and try again.');
    expect(m.hero!.at).toEqual([0, 0]);
    document.getElementById('openworld-dungeon-note')!.remove();
    expect(m.dungeon()).toBe(false); // no note in the page: nothing to write to
  });
});

describe('the Open world mode and the online peers (#1305)', () => {
  const host = () => ({ enter: vi.fn(), frame: vi.fn(() => false), leave: vi.fn(), broke: vi.fn(), beaten: vi.fn(), lairWon: vi.fn(), wildWon: vi.fn() });

  it('hands the world entered to the peers host, and tells it when the world is left, by Escape or by another world', () => {
    const m = mode();
    const peers = host();
    m.peers = peers;
    m.enter(42, 800, 600);
    expect(peers.leave).toHaveBeenCalledTimes(1); // the world left, if any, before the new one
    expect(peers.enter).toHaveBeenCalledWith(42, expect.any(THREE.Scene), expect.any(THREE.PerspectiveCamera), expect.any(World));
    m.enter(43, 800, 600);
    expect(peers.enter).toHaveBeenCalledTimes(2);
    peers.leave.mockClear();
    m.key('Escape');
    expect(peers.leave).toHaveBeenCalledTimes(1);
  });

  it('gives the host the hero and the frame time every frame, and draws again when it says the markers changed', () => {
    const m = mode();
    const peers = host();
    m.peers = peers;
    m.enter(42, 800, 600);
    const render = vi.fn();
    m.frame(render, 1000);
    expect(peers.frame).toHaveBeenLastCalledWith(1000, [0, 0], expect.any(Array), null); // reduced motion: the boats of the peers are held still (#1447)
    m.frame(render, 1016);
    expect(render).toHaveBeenCalledTimes(1); // nothing changed
    peers.frame.mockReturnValueOnce(true);
    m.frame(render, 1032);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('works with no host, as solo and the tests of old do', () => {
    const m = mode();
    m.enter(42, 800, 600);
    m.frame(vi.fn(), 1000);
    m.key('Escape');
    expect(m.active).toBe(false);
  });

  describe('a hidden tab keeps its place alive (#1371)', () => {
    const hidden = (value: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    afterEach(() => {
      vi.useRealTimers();
      hidden(false);
    });

    it('a hidden tab gets no animation frame: a timer gives the host the hero every second, and a visible tab leaves it to the frames', () => {
      vi.useFakeTimers();
      const m = mode();
      const peers = host();
      m.peers = peers;
      m.enter(42, 800, 600);
      hidden(false);
      vi.advanceTimersByTime(3000);
      expect(peers.frame).not.toHaveBeenCalled(); // visible: the animation loop sends
      hidden(true);
      vi.advanceTimersByTime(3000);
      expect(peers.frame).toHaveBeenCalledTimes(3);
      expect(peers.frame).toHaveBeenLastCalledWith(expect.any(Number), [0, 0]);
    });

    it('stops with the world: nothing is sent after Escape, nor twice after another world is entered', () => {
      vi.useFakeTimers();
      hidden(true);
      const m = mode();
      const peers = host();
      m.peers = peers;
      m.enter(42, 800, 600);
      m.enter(43, 800, 600);
      vi.advanceTimersByTime(1000);
      expect(peers.frame).toHaveBeenCalledTimes(1); // one timer, not one per world
      m.key('Escape');
      peers.frame.mockClear();
      vi.advanceTimersByTime(5000);
      expect(peers.frame).not.toHaveBeenCalled();
    });

    it('is idle with no host', () => {
      vi.useFakeTimers();
      hidden(true);
      const m = mode();
      m.enter(42, 800, 600);
      vi.advanceTimersByTime(2000);
      m.key('Escape');
      expect(m.active).toBe(false);
    });
  });
});


describe('the minimap of the Open world (#1410, docs/specs/openworld.md section 8)', () => {
  type Ctx = { fillStyle: string; clearRect: ReturnType<typeof vi.fn>; fills: string[] };
  /** A canvas in the page whose 2D context records its clears and the colours it fills with. */
  const withCanvas = (): Ctx => {
    const fills: string[] = [];
    const ctx: Ctx = { fillStyle: '', clearRect: vi.fn(), fills };
    const blank = () => {};
    Object.assign(ctx, {
      save: blank, restore: blank, fillText: blank, beginPath: blank, arc: blank, moveTo: blank, lineTo: blank, closePath: blank, clip: blank, stroke: blank,
      fill() { fills.push(ctx.fillStyle); },
      fillRect() { fills.push(ctx.fillStyle); },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return ctx;
  };
  const lairer = (lairs: Int32Array) =>
    new OpenWorldMode((_s, cx, cy) => bytes(cx, cy), (_s, cx, cy) => (cx === 0 && cy === 0 ? Int32Array.of(5, 5) : new Int32Array()), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1), () => lairs);
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('is drawn when a world opens: the grass, the hero, the troop, an enemy and a lair in the window', () => {
    const ctx = withCanvas();
    lairer(Int32Array.of(8, 0, 40, 0)).enter(42, 800, 600);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    for (const colour of [terrainColour('grass', 'badlands'), COLOURS.hero, COLOURS.troop, COLOURS.enemy, COLOURS.lair]) expect(ctx.fills, colour).toContain(colour);
  });

  it('paints the low grass of the world in the ground of its biome (#1442)', () => {
    const ctx = withCanvas();
    const tundra = (_s: number, cx: number, cy: number): Uint8Array => bytes(cx, cy).map((b, i) => (i % 3 === 0 ? 3 : i % 3 === 2 ? 2 : b));
    mode(undefined, tundra).enter(42, 800, 600);
    expect(ctx.fills).toContain(terrainColour('grass', 'tundra'));
    expect(ctx.fills).not.toContain(terrainColour('grass'));
  });

  it('is redrawn on a step and on a camera turn, never on a frame', () => {
    const ctx = withCanvas();
    const m = mode();
    m.enter(42, 800, 600);
    ctx.clearRect.mockClear();
    const render = vi.fn();
    m.frame(render, 0);
    m.frame(render, 16);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    tap(m, 'ArrowRight');
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    m.turn(TURN_STEP);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });

  it('turns with the camera\'s drawn yaw (#1448): redrawn on the frames of a turn, not at rest, and at once with reduced motion', () => {
    const ctx = withCanvas();
    const m = mode(undefined, undefined, () => false);
    m.enter(42, 800, 600);
    const render = vi.fn();
    let now = 0;
    m.frame(render, now);
    for (let i = 0; i < 90; i++) m.frame(render, (now += 16)); // settle the camera
    m.turn(TURN_STEP);
    ctx.clearRect.mockClear();
    m.frame(render, (now += 16));
    m.frame(render, (now += 16));
    expect(ctx.clearRect).toHaveBeenCalledTimes(2); // one redraw a frame while the yaw changes
    for (let i = 0; i < 90; i++) m.frame(render, (now += 16));
    ctx.clearRect.mockClear();
    m.frame(render, (now += 16));
    m.frame(render, (now += 16));
    expect(ctx.clearRect).not.toHaveBeenCalled(); // at rest: none
    const reduced = mode();
    reduced.enter(42, 800, 600);
    reduced.frame(render, 0);
    reduced.turn(TURN_STEP);
    ctx.clearRect.mockClear();
    reduced.frame(render, 16);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1); // at once: the drawn yaw is the goal after one frame
    reduced.frame(render, 32);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it('a lair another hero took (#1305) is shown beaten, once, and a cell with no lair does nothing', () => {
    const m = lairer(Int32Array.of(8, 0, 40, 0));
    m.enter(42, 800, 600);
    expect(document.body.dataset.openworldLairsBeaten).toBe('');
    m.remoteLair([5, 5]); // no lair there
    expect(document.body.dataset.openworldLairsBeaten).toBe('');
    m.remoteLair([8, 0]);
    expect(document.body.dataset.openworldLairsBeaten).toBe(''); // heard, not filed: no fight of this hero proves it
    m.remoteLair([8, 0]); // twice: heard already
  });

  it('shows a beaten lair in its own colour', () => {
    const ctx = withCanvas();
    const m = lairer(Int32Array.of(8, 0));
    m.enter(42, 800, 600, { version: 1, seed: 42, hero: [0, 0], troop: [[1, 0]], fight: { removed: [], added: [], beaten: 0 }, yaw: 0, broken: [], lairs: [0], discovered: [], time: 0, logs: [], recruits: 0, resources: { wood: 0, ore: 0, parts: 0, shards: 0 }, army: { specials: [], brought: [], relics: [], relicsBrought: [] }, savedAt: 1 });
    expect(ctx.fills).toContain(ICON.done);
    expect(ctx.fills).not.toContain(COLOURS.lair);
  });

  it('is gone when the mode is left', () => {
    withCanvas();
    const m = mode();
    m.enter(42, 800, 600);
    expect(document.getElementById('openworld-minimap')).not.toBeNull();
    m.key('Escape');
    expect(document.getElementById('openworld-minimap')).toBeNull();
  });

  it('leaves out the cells off the world', () => {
    const ctx = withCanvas();
    new OpenWorldMode((_s, cx, cy) => (cx > 0 ? new Uint8Array() : bytes(cx, cy)), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1)).enter(42, 800, 600);
    expect(ctx.fills).toContain(terrainColour('grass', 'badlands'));
  });

  it('makes its canvas at the end of the body, once, and draws nothing when it has no 2D context', () => {
    document.body.innerHTML = '<canvas id="page"></canvas>';
    const m = mode();
    m.enter(42, 800, 600);
    m.enter(43, 800, 600);
    expect(document.querySelectorAll('#openworld-minimap')).toHaveLength(1);
    expect(document.querySelector('canvas')!.id).toBe('page');
    expect(document.body.lastElementChild!.id).toBe('openworld-minimap');
    document.body.innerHTML = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => mode().enter(42, 800, 600)).not.toThrow();
  });
});

describe('the discovered cells and the map of the Open world (#1411, docs/specs/openworld.md section 9)', () => {
  const DISC = 3 * SIGHT * (SIGHT + 1) + 1; // the cells of the hex disc of SIGHT
  /** A 2D context in the page that records the colours it fills with. */
  const withCanvas = (): string[] => {
    const fills: string[] = [];
    const ctx = { fillStyle: '' } as Record<string, unknown>;
    for (const name of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'moveTo', 'lineTo', 'closePath', 'clip', 'fillText', 'stroke']) ctx[name] = () => {};
    ctx.fill = ctx.fillRect = () => fills.push(ctx.fillStyle as string);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    return fills;
  };
  const grass = (fills: string[]): number => fills.filter((c) => c === terrainColour('grass', 'badlands')).length;
  const savedAt = (hero: Axial, discovered: WorldSave['discovered'] = []): WorldSave => ({
    version: 1, seed: 42, hero, troop: [], fight: { removed: [], added: [], beaten: 0 }, yaw: DEFAULT_YAW, broken: [], lairs: [], discovered, time: 0, logs: [], recruits: 0, resources: { wood: 0, ore: 0, parts: 0, shards: 0 }, army: { specials: [], brought: [], relics: [], relicsBrought: [] }, savedAt: 1,
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete body().openworldDiscovered;
    vi.restoreAllMocks();
  });

  it('discovers the cells within 10 of the hero when a world opens, and more as it walks', () => {
    const m = mode();
    m.enter(42, 800, 600);
    expect(body().openworldDiscovered).toBe(String(DISC));
    tap(m, 'ArrowRight');
    expect(Number(body().openworldDiscovered)).toBe(DISC + 2 * SIGHT + 1);
    m.leave();
    expect(body().openworldDiscovered).toBeUndefined();
  });

  it('saves the discovered cells with the world, and a resume brings them back with the cells round the hero', async () => {
    const store = memoryStore();
    const m = mode(undefined, undefined, undefined, undefined, worldSaves(store, 1));
    m.enter(42, 800, 600);
    tap(m, 'ArrowRight');
    m.frame(vi.fn());
    await new Promise((done) => setTimeout(done));
    const saved = (await worldSaves(store, 1).load(42))!;
    const back = mode();
    back.enter(42, 800, 600, { ...saved, hero: [30, 0] }); // the hero stands far off: its disc is added to the saved cells
    expect(Number(body().openworldDiscovered)).toBe(DISC + 2 * SIGHT + 1 + DISC);
  });

  it('migrates a save from before the discovery: the cells round the hero are discovered', () => {
    mode().enter(42, 800, 600, savedAt([20, 0]));
    expect(body().openworldDiscovered).toBe(String(DISC));
  });

  it('the minimap draws only the discovered cells, and the enemies on them; the rest of its window stays dark', () => {
    const fills = withCanvas();
    const foes = (_s: number, cx: number, cy: number) => (cx === 0 && cy === 0 ? Int32Array.of(5, 5, 15, 0) : new Int32Array());
    mode(undefined, undefined, undefined, foes).enter(42, 800, 600);
    expect(grass(fills)).toBe(DISC - 1); // the boulder on (0, 1) is the other one
    expect(fills.filter((c) => c === COLOURS.enemy)).toHaveLength(1); // (5, 5) is 10 away, (15, 0) 15
  });

  it('draws the tower of its boss on each lair (#1438): lair k is boss k counted round the roster, a lair without a roster is a plain tower', () => {
    const fills = withCanvas();
    const lairs = Int32Array.of(2, 0, 4, 0, 6, 0);
    const make = (roster?: () => string[]) =>
      new OpenWorldMode((_s, cx, cy) => bytes(cx, cy), () => new Int32Array(), async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1), () => lairs, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, roster);
    make(() => ['hull', 'echo']).enter(42, 800, 600);
    expect(fills.filter((c) => c === BOSS_COLOURS.hull)).toHaveLength(2); // lairs 0 and 2
    expect(fills.filter((c) => c === BOSS_COLOURS.echo)).toHaveLength(1);
    fills.length = 0;
    make().enter(42, 800, 600);
    expect(fills.filter((c) => c === ICON.unknown)).toHaveLength(3);
  });

  it('opens no map outside a world', () => {
    const m = mode();
    m.toggleMap();
    expect(m.mapShown).toBe(false);
    expect(document.getElementById('openworld-map')).toBeNull();
  });

  it('M opens the map full screen on the discovered cells, M or Escape closes it, and the world stays open', () => {
    const fills = withCanvas();
    document.body.innerHTML = '<button id="openworld-map-button" aria-expanded="false">Map</button>';
    const m = mode();
    m.enter(42, 800, 600);
    expect(m.mapShown).toBe(false);
    fills.length = 0;
    expect(m.key('m')).toBe(true);
    expect(m.mapShown).toBe(true);
    expect(document.getElementById('openworld-map')).not.toBeNull();
    expect(document.getElementById('openworld-map-button')!.getAttribute('aria-expanded')).toBe('true');
    expect(grass(fills)).toBe(DISC - 1);
    expect(m.key('M')).toBe(true);
    expect(m.mapShown).toBe(false);
    expect(document.getElementById('openworld-map-button')!.getAttribute('aria-expanded')).toBe('false');
    m.key('M');
    expect(m.key('Escape')).toBe(true);
    expect(m.mapShown).toBe(false);
    expect(m.active).toBe(true);
  });

  it('while the map is open the hero stays: the arrows and the camera keys are not the mode\'s, a held arrow lets go', () => {
    withCanvas();
    const m = mode();
    m.enter(42, 800, 600);
    m.key('ArrowRight'); // held when the map opens
    const at = body().openworldAt;
    m.toggleMap();
    m.frame(vi.fn(), 10_000);
    expect(body().openworldAt).toBe(at);
    expect(m.key('ArrowLeft')).toBe(false);
    expect(m.key('q')).toBe(false);
    expect(body().openworldAt).toBe(at);
    expect(body().openworldYaw).toBe(String(Math.round((DEFAULT_YAW * 180) / Math.PI)));
    m.toggleMap();
    expect(m.mapShown).toBe(false);
  });

  it('the zoom and the pan go to the map while it is open, the camera keeps its zoom', () => {
    withCanvas();
    const m = mode();
    m.enter(42, 800, 600);
    m.toggleMap();
    const zoom = body().openworldZoom;
    m.zoom(1.5);
    m.panMap(40, 0);
    expect(body().openworldZoom).toBe(zoom);
    m.toggleMap();
    m.zoom(1.5);
    expect(body().openworldZoom).not.toBe(zoom);
  });

  it('is redrawn when the world changes under it and follows the window size; leaving the world closes it', () => {
    const fills = withCanvas();
    const m = mode();
    m.enter(42, 800, 600);
    m.toggleMap();
    fills.length = 0;
    m.remoteBreak([0, 1]); // another hero breaks the boulder: the minimap and the map are drawn again
    expect(grass(fills)).toBe(2 * (DISC - 1));
    m.resize(400, 300);
    const canvas = document.querySelector<HTMLCanvasElement>('#openworld-map canvas')!;
    expect([canvas.width, canvas.height]).toEqual([400, 300]);
    m.leave();
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(m.mapShown).toBe(false);
  });
});
