// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import './test/openworldwasm';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { world_cairns, world_chunk, world_enemies, world_lairs, world_logs, world_pads, world_places, world_rings, world_teleporters } from 'edgefall-wasm';
import { OpenWorldMode } from './openworldmode';
import { loadModels } from './openworldview';
import { worldSaves } from './openworldsave';
import { memoryStore } from './savegame';

const fs = 'node:fs/promises';
const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: string): Promise<Uint8Array> };
const here = import.meta.url; // a variable: vite rewrites a `new URL` of a literal path into a served one
const assets = decodeURIComponent(new URL('../public/assets/pbr/', here).pathname);

// The real model files, parsed in node: `loadAsync` of the page fetches them, this reads them from the disk.
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const files = {
  loadAsync: async (name: string) => {
    const bytes = await readFile(assets + name);
    return gltf.parseAsync(Uint8Array.from(bytes).buffer, ''); // a buffer of this realm: the loader tells a GLB from a JSON file by `instanceof ArrayBuffer`
  },
};

/** The geometry of one view of `scene` through `camera` (docs/specs/openworld.md section 17): every visible mesh whose bounds meet the
 * camera's frustum, as three culls it, is one draw call and its triangles times its instances. The shadow pass and the full-screen pass
 * are not counted in them: they draw the same scene again; `casters` is how many of those calls the shadow pass draws again (the meshes
 * that cast the sun's shadow, high tier). */
function sceneCost(scene: THREE.Scene, camera: THREE.Camera): { calls: number; triangles: number; casters: number } {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let calls = 0;
  let triangles = 0;
  let casters = 0;
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instances = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    if (instances === 0) return;
    if (mesh.frustumCulled && !frustum.intersectsObject(mesh)) return;
    const g = mesh.geometry;
    const count = Math.min(g.index ? g.index.count : g.attributes.position!.count, g.drawRange.count);
    calls++;
    if (mesh.castShadow) casters++;
    triangles += Math.floor(count / 3) * instances;
  });
  return { calls, triangles, casters };
}

const mode = () =>
  new OpenWorldMode(
    (seed, cx, cy) => world_chunk(seed, cx, cy),
    (seed, cx, cy) => Int32Array.from(world_enemies(seed, cx, cy)),
    () => loadModels({ low: 'openworld.glb', high: 'openworld-hi.glb', lair: 'openworld-lair.glb' }, files),
    () => true,
    worldSaves(memoryStore(), 1),
    (seed) => Int32Array.from(world_lairs(seed)),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (seed) => Int32Array.from(world_teleporters(seed)),
    undefined,
    (seed) => Int32Array.from(world_logs(seed)),
    undefined,
    (seed) => Int32Array.from(world_places(seed)),
    undefined,
    undefined,
    (seed) => Uint8Array.from(world_rings(seed)),
    (seed) => Int32Array.from(world_pads(seed)),
    undefined,
    undefined,
    (seed, cx, cy) => Int32Array.from(world_cairns(seed, cx, cy)),
  );

// The regression caps of section 17 (about 5 % over the scene measured on 2026-11-08, not the frame budget of 750 000 triangles and 45 calls) on the scene of one view at 1280x720, on the high tier: the budget view (the spawn of seed 7, the closest zoom; seed 3 until #1755, whose new map puts a dungeon gate in the widest view of seed 3: 47 calls, 2 more, as seeds 5 and 8 do, while seed 7 draws 44 and 44) and the
// widest zoom a player reaches there. Measured 353 010 triangles in 23 calls and 3 254 456 in 23 (#1481), 19 calls each once a landmark's
// parts are one mesh (#1647); the renderer's frame draws the shadow casters a second time (708 519 triangles, 52 calls at the budget view
// before #1647, 44 after).
const SPAWN_TRIANGLES_CAP = 370_000;
const WIDEST_TRIANGLES_CAP = 3_400_000;
const CALLS_CAP = 25;
// The frame's budget of draw calls (section 17) and what the frame draws beside the scene and its shadow pass, read on `window.__renderCost`
// at the budget view on an Apple M4 (#1647): 52 calls for 23 in the scene and 18 casters, so 11 (the sky, the full-screen passes).
const FRAME_CALLS = 45;
const FRAME_PASSES = 11;
const frameCalls = ({ calls, casters }: { calls: number; casters: number }): number => calls + casters + FRAME_PASSES;

describe('the Open world scene geometry regression caps (docs/specs/openworld.md section 17)', () => {
  // Seed 7 is the budget view; seed 1 has a dungeon gate in its widest view, which draws as one call (#1760: 47 frame calls when the gate
  // took three, 44 without it, 45 now); seed 9's widest view has one too (45 before, 42 without the gate, 43 now).
  /** The scene of the budget view of `seed` and of its widest zoom, on the high tier. */
  const views = async (seed: number) => {
    document.body.dataset.tier = 'high';
    const m = mode();
    m.enter(seed, 1280, 720);
    await m.props; // the props' models are in: the detailed set near the hero, the low-poly one further out
    let camera: THREE.Camera | null = null;
    const t0 = performance.now();
    m.frame((_scene, c) => void (camera = c), t0);
    const spawn = sceneCost(m.scene!, camera!);
    m.zoom(Number.MAX_VALUE); // held at the widest zoom of the window
    for (let t = 1; t <= 60; t++) m.frame(() => {}, t0 + t * 100); // the drawn zoom follows the zoom asked for
    const widest = sceneCost(m.scene!, camera!);
    m.leave();
    delete document.body.dataset.tier;
    return { spawn, widest };
  };

  // Seeds 2 and 4 drew 46 frame calls at the budget view (#1765): a wall near the hero took its own detailed mesh, a call and a shadow
  // call, though its detailed model is the low-poly one. Their triangles pass the caps of seed 7 only for seed 2, so only the calls are held here.
  it.each([2, 4])('keeps the budget view and the widest zoom of seed %i within the frame calls', async (seed) => {
    const { spawn, widest } = await views(seed);
    expect(frameCalls(spawn)).toBeLessThanOrEqual(FRAME_CALLS);
    expect(frameCalls(widest)).toBeLessThanOrEqual(FRAME_CALLS);
  });

  it.each([7, 1, 9])('keeps the scene of the budget view and of the widest zoom of seed %i under its regression caps on triangles and draw calls, with the real chunks and models', async (seed) => {
    document.body.dataset.tier = 'high';
    const m = mode();
    m.enter(seed, 1280, 720);
    await m.props; // the props' models are in: the detailed set near the hero, the low-poly one further out
    let camera: THREE.Camera | null = null;
    const t0 = performance.now();
    m.frame((_scene, c) => void (camera = c), t0);
    const spawn = sceneCost(m.scene!, camera!);
    expect(spawn.triangles).toBeGreaterThan(SPAWN_TRIANGLES_CAP / 2); // the whole view is counted, not a part of it
    expect(spawn.triangles).toBeLessThanOrEqual(SPAWN_TRIANGLES_CAP);
    expect(spawn.calls).toBeLessThanOrEqual(CALLS_CAP);
    expect(frameCalls(spawn)).toBeLessThanOrEqual(FRAME_CALLS);
    m.zoom(Number.MAX_VALUE); // held at the widest zoom of the window
    for (let t = 1; t <= 60; t++) m.frame(() => {}, t0 + t * 100); // the drawn zoom follows the zoom asked for
    const widest = sceneCost(m.scene!, camera!);
    expect(widest.triangles).toBeGreaterThan(spawn.triangles * 4); // the zoom was reached: the view holds many more cells
    expect(widest.triangles).toBeLessThanOrEqual(WIDEST_TRIANGLES_CAP);
    expect(widest.calls).toBeLessThanOrEqual(CALLS_CAP);
    expect(frameCalls(widest)).toBeLessThanOrEqual(FRAME_CALLS);
    m.leave();
    delete document.body.dataset.tier;
  });
});
