// @vitest-environment jsdom
import './test/openworldwasm';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { axialTo3D } from './board';
import { CHUNK, World } from './openworld';
import { ROLL_ZOOM } from './openworldglide';
import { FOAM_GAIN } from './openworldmotion';
import { BIOME_DETAIL, SURFACE_DETAIL } from './openworldedge';
import { MAX_ZOOM, OpenWorldView, type Played } from './openworldview';
import { holdMotes } from './test/holdmotes';

holdMotes(); // the motes of each biome drift since #1736: held, these tests see the water's and the trees' motion alone

// The water and the trees move (#1101, #1102, docs/specs/openworld-animation.md sections 3 and 4).
// Zooms by `scale` and lands the drawn zoom on it at once, as reduced motion does: the follow is tested on its own (#1333).
const zoomed = (view: OpenWorldView, scale: number): void => {
  view.zoomBy(scale);
  view.follow(0, true);
};
const WATER_CODE = 0;
const GRASS_CODE = 2;
const TREE_CODE = 6;
const SAND_CODE = 1;
const DESERT = 3;
const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
// The square -3..3 of chunks in `biome` (4, the badlands, has no ambient particles), every cell of the terrain code `code(q, r)`.
const world = (code: (q: number, r: number) => number, biome = 4) => (cx: number, cy: number): Uint8Array => {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, code(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / CHUNK)), biome], i * 3);
  return out;
};
const lake = (): OpenWorldView => {
  const view = new OpenWorldView(new World(world((q) => (q >= 3 ? WATER_CODE : GRASS_CODE))));
  view.resize(1600, 900);
  view.show([2, 0]);
  return view;
};
const forest = (): OpenWorldView => {
  const view = new OpenWorldView(new World(world((q, r) => ((q + r) % 5 === 0 ? TREE_CODE : GRASS_CODE))));
  view.resize(1600, 900);
  view.show([0, 0]);
  return view;
};

describe('the water and the trees move (#1101, #1102)', () => {
  afterEach(() => delete (window as { __openworldSlow?: number }).__openworldSlow);

  it('gives the water a foam and ripple glow and the trees, low and detailed, a vertex lean: no other prop, no new mesh', () => {
    const view = new OpenWorldView(new World(world(() => GRASS_CODE)));
    expect((mesh(view, 'terrain-water').material as THREE.MeshStandardNodeMaterial).emissiveNode).not.toBeNull();
    for (const name of ['prop-tree', 'prop-tree-hi']) expect((mesh(view, name).material as THREE.MeshStandardNodeMaterial).positionNode, name).not.toBeNull();
    for (const name of ['prop-mountain', 'prop-boulder', 'prop-wall', 'prop-cap']) {
      expect((mesh(view, name).material as THREE.MeshStandardNodeMaterial).positionNode ?? null, name).toBeNull();
    }
    // every ground has a vertex term since #1347: the widening of the prisms that closes their gap (it moves nothing by itself, see the shimmer test)
    expect((mesh(view, 'terrain-grass').material as THREE.MeshStandardNodeMaterial).positionNode).not.toBeNull();
  });

  it('keeps the palette (#1173): the tree keeps its colours, the water has no glow (#1315)', () => {
    const view = new OpenWorldView(new World(world(() => GRASS_CODE)));
    const tree = mesh(view, 'prop-tree').material as THREE.MeshStandardMaterial;
    expect([tree.color.getHex(), tree.emissive.getHex()]).toEqual([0x2fb5a0, 0x000000]);
    expect((mesh(view, 'terrain-water').material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });

  it('runs a loop while a lake is in view and motion is on: the time and the amplitudes go to the shaders', () => {
    const view = lake();
    expect(view.animate(1234, false)).toBe(true);
    const u = view.uniforms;
    expect([u.time.value, u.foam.value, u.sway.value]).toEqual([1234, FOAM_GAIN, 1]);
    expect(view.alive).toBe('water');
  });

  it('runs a loop while trees are in view, and none when there is nothing to move', () => {
    const trees = forest();
    expect(trees.animate(10, false)).toBe(true);
    expect(trees.alive).toBe('trees');
    const bare = new OpenWorldView(new World(world(() => GRASS_CODE)));
    bare.show([0, 0]);
    expect(bare.animate(10, false)).toBe(false);
    expect(bare.alive).toBe('');
  });

  it('wobbles the sand of the desert only: a vertex term of the sand ground, no other, and the hero in the desert starts it (#1104)', () => {
    const sand = (biome: number) => {
      const view = new OpenWorldView(new World(world(() => SAND_CODE, biome)));
      view.show([0, 0]);
      return view;
    };
    const view = sand(DESERT);
    expect((mesh(view, 'terrain-sand').material as THREE.MeshStandardNodeMaterial).positionNode).not.toBeNull();
    // the other grounds carry only the widening of the prisms (#1347), a different node from the sand's wobble: the wobble is on the sand's own
    // node and its uniform below (`shimmer`) is 0 away from the desert
    for (const name of ['terrain-grass', 'terrain-rock', 'terrain-peak', 'terrain-water']) {
      expect((mesh(view, name).material as THREE.MeshStandardNodeMaterial).positionNode, name).not.toBe((mesh(view, 'terrain-sand').material as THREE.MeshStandardNodeMaterial).positionNode);
    }
    expect(view.animate(100, false)).toBe(true);
    expect(view.uniforms.shimmer.value).toBe(1);
    expect(view.alive).toBe('shimmer');
    expect(sand(2).animate(100, false)).toBe(false); // sand in a meadow does not shimmer
    expect(sand(2).alive).toBe('');
  });

  it('stills the shimmer when calm or past ROLL_ZOOM, and names it after water and trees', () => {
    const view = new OpenWorldView(new World(world((q, r) => (q >= 3 ? WATER_CODE : (q + r) % 5 === 0 ? TREE_CODE : SAND_CODE), DESERT)));
    view.resize(1600, 900);
    view.show([0, 0]);
    view.animate(0, false);
    expect(view.alive).toBe('water,trees,shimmer');
    view.animate(16, true);
    expect([view.uniforms.shimmer.value, view.alive]).toEqual([0, '']);
    view.animate(32, false);
    zoomed(view, MAX_ZOOM);
    view.animate(48, false);
    expect(view.uniforms.shimmer.value).toBe(0);
  });

  it('names both when a lake and trees are in view', () => {
    const view = new OpenWorldView(new World(world((q, r) => (q >= 3 ? WATER_CODE : (q + r) % 5 === 0 ? TREE_CODE : GRASS_CODE))));
    view.resize(1600, 900);
    view.show([0, 0]);
    view.animate(0, false);
    expect(view.alive).toBe('water,trees');
  });

  it('is off when calm (reduced motion, the low tier): the amplitudes are 0, no loop, and no ripple is born', () => {
    const view = lake();
    view.animate(0, false);
    expect(view.animate(16, true)).toBe(true); // the frame that erases the motion
    expect([view.uniforms.foam.value, view.uniforms.sway.value]).toEqual([0, 0]);
    expect(view.animate(32, true)).toBe(false);
    expect(view.alive).toBe('');
    view.ripple([2, 0], [3, 0], 40, true);
    expect(view.ripples).toBe(0);
  });

  it('is off past ROLL_ZOOM, and draws once more to erase it', () => {
    const view = forest();
    view.animate(0, false);
    zoomed(view, MAX_ZOOM);
    expect(view.drawnZoom).toBeGreaterThan(ROLL_ZOOM);
    expect(view.animate(16, false)).toBe(true);
    expect([view.uniforms.foam.value, view.uniforms.sway.value]).toEqual([0, 0]);
    expect(view.animate(32, false)).toBe(false);
  });

  it('spawns a ripple where the hero steps next to water, gone after 600 ms, and a fifth replaces the oldest', () => {
    const view = lake();
    view.ripple([1, 0], [2, 0], 100, false);
    view.animate(100, false);
    const spot = view.uniforms.ripples[0]!.value;
    expect(spot.x).toBeCloseTo(axialTo3D(2, 0).x, 4);
    expect(spot.y).toBeCloseTo(axialTo3D(2, 0).z, 4);
    expect(spot.z).toBe(100);
    expect(view.ripples).toBe(1);
    expect(view.animate(701, false)).toBe(true); // the lake keeps drawing; the ripple is over
    expect(view.ripples).toBe(0);
    for (let k = 0; k < 5; k++) view.ripple([1, 0], [2, 0], 1000 + k, false);
    expect(view.ripples).toBe(4);
  });

  it('spawns no ripple away from water, with no lake in view, or past ROLL_ZOOM', () => {
    const far = lake();
    far.ripple([-4, 0], [-5, 0], 0, false);
    expect(far.ripples).toBe(0);
    const dry = new OpenWorldView(new World(world(() => GRASS_CODE)));
    dry.show([0, 0]);
    dry.ripple([0, 0], [1, 0], 0, false);
    expect(dry.ripples).toBe(0);
    const wide = lake();
    zoomed(wide, MAX_ZOOM);
    wide.ripple([1, 0], [2, 0], 0, false);
    expect(wide.ripples).toBe(0);
  });

  it('stretches a ripple by the slow check', () => {
    (window as { __openworldSlow?: number }).__openworldSlow = 3;
    const view = lake();
    view.animate(0, false);
    expect(view.uniforms.span.value).toBe(1800);
  });

  it('splashes 6 droplets where an ejected enemy falls, when the fall starts, and none past ROLL_ZOOM', () => {
    const played: Played = {
      from: [[1, 0], [0, 0], [-1, 0]],
      foes: [[2, 0]],
      push: { troop: [[2, 0], [1, 0], [0, 0]], enemies: [], ejected: [[2, 0]], homes: [[2, 0]], dir: [1, 0] },
    };
    const view = lake();
    view.show([1, 0], [[0, 0], [-1, 0]]);
    view.updateEnemies();
    view.playPush(played, 0);
    view.sparkle(100, false);
    expect(mesh(view, 'particles').count).toBe(0); // the fall has not started
    view.sparkle(470, false);
    expect(mesh(view, 'particles').count).toBe(6);
    view.sparkle(1100, false);
    expect(mesh(view, 'particles').count).toBe(0);
    zoomed(view, MAX_ZOOM);
    view.playPush(played, 2000);
    view.sparkle(2470, false);
    expect(mesh(view, 'particles').count).toBe(0);
  });
});

describe('the striation of the land (#1555)', () => {
  it('follows the biome the hero stands in, and is stronger on a phone, off on the low tier', () => {
    const view = new OpenWorldView(new World(world(() => GRASS_CODE, DESERT)));
    view.resize(1280, 720);
    view.show([0, 0]);
    view.animate(0, true); // calm too: the striation is no motion, it holds under reduced motion
    expect([view.surface.frequency.value, view.surface.warp.value]).toEqual([BIOME_DETAIL.desert.frequency, BIOME_DETAIL.desert.warp]);
    expect(view.surface.amplitude.value).toBe(SURFACE_DETAIL.amplitude);
    view.resize(390, 844);
    expect(view.surface.amplitude.value).toBe(SURFACE_DETAIL.phone);
    view.useSurfaceDetail(false);
    expect(view.surface.amplitude.value).toBe(0);
    view.resize(1280, 720);
    expect(view.surface.amplitude.value).toBe(0); // the low tier holds through a resize
    view.useSurfaceDetail(true);
    expect(view.surface.amplitude.value).toBe(SURFACE_DETAIL.amplitude);
  });
});
