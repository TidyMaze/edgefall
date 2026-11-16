import './test/openworldwasm';
import { relief, terrace } from './landshape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { axialTo3D, type Axial } from './board';
import { BIOMES, type Biome, cellAtPoint, CHUNK, chunkOf, neighbours, OFF_WORLD, type Terrain, type Tile, TROOP, World } from './openworld';
import { RECRUIT_MAX } from './openworldrecruit';
import { FRAME_REACH, FRAME_SHARE } from './openworldcamera';
import { FightState } from './openworldfight';
import { WORLD_LOOKS } from './daynight';
import { GLIDE_MS, NUDGE_MS, ROLL_ZOOM, TROOP_DELAY } from './openworldglide';
import { OPEN_WORLD_POINT_LIGHTS } from './quality';
import { NEON_GLOSS, setNeonWorldOn } from './neonlook';
import { SUN, sunPosition } from './tablezero';
import {
  BIOME_LOOK,
  CAPACITY,
  groundColour,
  footprint,
  GROUND,
  GROUNDS,
  groundRadius,
  HI_CAPACITY,
  HI_RADIUS,
  loadModels,
  LOOK,
  SODIUM,
  MARBLE_LOOK,
  MAX_REACH,
  MAX_ZOOM,
  MOST,
  OpenWorldView,
  PROPS,
  reachAt,
  reachFor,
  STEP,
  hexLift,
  LIFT_MAX,
  topOf,
  variety,
  WATER,
  maxZoomFor,
  MARBLE,
  type Played,
  waterColor,
  WANDER_GLIDE_MS, BIOME_MIX, biomeGround } from './openworldview';

// Every chunk of the square -3..3 is the same: the terrain code runs 0 to 7 along the cells, the height 0 to 3.
function bytes(cx: number, cy: number): Uint8Array {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([i % 4, i % 8, 0], i * 3);
  return out;
}
// Grass everywhere, each cell at its level from `levels` (`base` for the others): a chunk of the square -half..half (#988).
function stepped(levels: Map<string, number>, base = 3, half = 3): (cx: number, cy: number) => Uint8Array {
  return (cx, cy) => {
    if (Math.abs(cx) > half || Math.abs(cy) > half) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const q = cx * CHUNK + (i % CHUNK);
      const r = cy * CHUNK + Math.floor(i / CHUNK);
      out.set([levels.get(`${q},${r}`) ?? base, 2, 0], i * 3);
    }
    return out;
  };
}
// Every chunk of the world is grass, flat: the loaded square is as wide as the reach asks for.
function grass(): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, 0], i * 3);
  return out;
}
// Whether the reach at zoom `k` goes past MAX_REACH at some yaw, every degree (#1026).
const someYawReaches = (aspect: number, k: number): boolean => {
  for (let deg = 0; deg < 360; deg++) if (reachAt(aspect, k, (deg * Math.PI) / 180) > MAX_REACH) return true;
  return false;
};
// Zooms by `scale` and lands the drawn zoom on it at once, as reduced motion does: the follow is tested on its own (#1333).
const zoomed = (view: OpenWorldView, scale: number): void => {
  view.zoomBy(scale);
  view.follow(0, true);
};
const ground = (view: OpenWorldView) => GROUNDS.reduce((sum, g) => sum + mesh(view, `terrain-${g}`).count, 0);
// `expect(a).not.toBe(b)` deep-compares two scene objects to word its hint (seconds on a mesh): identity is all that is asked.
const isNot = (a: unknown, b: unknown): void => expect(Object.is(a, b)).toBe(false);
const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
const counts = (view: OpenWorldView, prefix: string, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, mesh(view, `${prefix}-${n}`).count]));

describe('the Open world view (docs/specs/openworld.md section 2)', () => {
  it('draws every cell of the chunks around the hero as a ground column and its props on top', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(1600, 900); // a 16:9 screen sees the ground three chunks out at the closest view
    view.show([0, 0]);
    const cells = 49 * CHUNK * CHUNK;
    const ground = counts(view, 'terrain', GROUNDS);
    // Codes 0 to 7 repeat 32 times a chunk: water, sand, grass, rock, peak, boulder, tree and wall.
    expect(ground).toEqual({ water: cells / 8, sand: cells / 8, grass: (cells / 8) * 2, rock: (cells / 8) * 3, peak: cells / 8 });
    // walls and caps are a sparse prop: a real world fills nothing like their capacity, this one (one cell in eight) grows them (#1010)
    expect(counts(view, 'prop', ['mountain', 'tree', 'boulder', 'wall', 'cap'])).toEqual({
      mountain: cells / 8,
      tree: cells / 8,
      boulder: cells / 8,
      wall: cells / 8,
      cap: cells / 8,
    });
  });

  it('draws no ground and no prop past the edge of a chunk the edge crosses (#1440)', () => {
    // Every other cell is past the edge: the bridge's off-the-world byte.
    const edged = (cx: number, cy: number): Uint8Array => {
      const out = bytes(cx, cy);
      for (let i = 1; i < out.length / 3; i += 2) out.set([0, OFF_WORLD, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(edged));
    view.resize(1600, 900);
    view.show([0, 0]);
    const cells = 49 * CHUNK * CHUNK;
    // The cells left are the even ones, codes 0, 2, 4 and 6: water, grass (height 2), peak and tree (on grass).
    expect(counts(view, 'terrain', GROUNDS)).toEqual({ water: cells / 8, sand: 0, grass: cells / 4, rock: 0, peak: cells / 8 });
    expect(counts(view, 'prop', ['mountain', 'tree', 'boulder', 'wall'])).toEqual({ mountain: cells / 8, tree: cells / 8, boulder: 0, wall: 0 });
  });

  it('loads the chunks only when the hero leaves the loaded square, the chunks it has are kept (#1046)', () => {
    const load = vi.fn(bytes);
    const view = new OpenWorldView(new World(load));
    view.resize(1600, 900); // at 16:9 the reach of the closest view does not move with the hero inside its chunk
    view.show([0, 0]);
    const loaded = load.mock.calls.length;
    view.show([1, 1]);
    expect(load).toHaveBeenCalledTimes(loaded);
    view.show([CHUNK, 0]); // the next chunk, but the square still covers the hero's ball: its centre and chunks are kept
    expect(load).toHaveBeenCalledTimes(loaded);
    view.show([4 * CHUNK - 1, 0]); // out of the square (its last cell is past the edge): re-centred on its chunk, so the chunks around it load
    expect(load.mock.calls.length).toBeGreaterThan(loaded);
  });

  it('puts the hero on its cell and the camera above and behind it, looking at it', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]); // code 18 % 8 = 2: grass, height 2
    const hero = view.scene.getObjectByName('hero')!;
    const p = axialTo3D(2, 1);
    expect(hero.position.x).toBeCloseTo(p.x);
    expect(hero.position.z).toBeCloseTo(p.z);
    expect(hero.position.y).toBeCloseTo(topOf('grass', 2, 2, 1) + 0.3);
    expect(view.camera.position.x).toBeCloseTo(p.x);
    expect(view.camera.position.y).toBeGreaterThan(hero.position.y);
    expect(view.camera.position.z).toBeGreaterThan(p.z);
  });

  it('finds the cell under the centre of the screen: the one the hero is on', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(800, 600);
    view.show([2, 1]);
    expect(view.camera.aspect).toBeCloseTo(800 / 600);
    expect(view.pick(0, 0)).toEqual([2, 1]);
    expect(view.pick(0.5, 0)).toEqual([2, 1]); // a point off the ring of the hero is no move (#988)
  });

  it('raises each cell by the relief of its biome on show (#1735)', () => {
    const desert = (cx: number, cy: number): Uint8Array => {
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([3, 2, BIOMES.indexOf('desert')], i * 3);
      return Math.abs(cx) > 2 || Math.abs(cy) > 2 ? new Uint8Array() : out;
    };
    new OpenWorldView(new World(desert));
    for (let q = 0; q < 12; q++) expect(topOf('grass', 3, q, 1) - 0.2 - 3 * STEP - hexLift(q, 1)).toBeCloseTo(terrace(q, 1, 'desert'));
  });

  it('lifts a cell by its height, water lies low, and varies props by cell without chance', () => {
    expect(topOf('water', 0, 0, 0)).toBeLessThan(topOf('grass', 0, 0, 0));
    expect(topOf('grass', 3, 0, 0)).toBeGreaterThan(topOf('grass', 1, 0, 0));
    // The eight levels 0 to 7 are one step apart: level 0 is 0.2 (land), a peak (level 7) stands 7 steps up, water lies at 0.08.
    expect(topOf('grass', 0, 0, 0)).toBeCloseTo(0.2 + hexLift(0, 0));
    expect(topOf('peak', 7, 0, 0)).toBeCloseTo(0.2 + 7 * STEP + hexLift(0, 0));
    for (let level = 0; level < 7; level++) expect(topOf('sand', level + 1, 3, 4) - topOf('sand', level, 3, 4)).toBeCloseTo(STEP);
    expect(topOf('sand', 2, 0, 0)).toBeCloseTo(0.2 + 2 * STEP - STEP / 2 + hexLift(0, 0)); // the beach: half a step nearer the water (#1732)
    expect(topOf('water', 7, 3, 4)).toBeCloseTo(0.08); // water stays flat, whatever the cell (#1418)
    expect(variety(3, 4)).toBe(variety(3, 4));
    const draws = new Set([0, 1, 2, 3, 4, 5].map((q) => variety(q, -q)));
    expect(draws.size).toBeGreaterThan(2);
    for (const d of draws) expect(d).toBeGreaterThanOrEqual(0), expect(d).toBeLessThan(1);
    expect(Object.keys(LOOK)).toEqual([...GROUNDS]);
  });

  it('lifts each land cell by a small, fixed hex lift, the same for the same cell and varied over cells (#1418)', () => {
    const values = new Set<number>();
    for (let q = -20; q <= 20; q++) {
      for (let r = -20; r <= 20; r++) {
        const lift = hexLift(q, r);
        expect(hexLift(q, r)).toBe(lift);
        expect(lift).toBeGreaterThanOrEqual(0);
        expect(lift).toBeLessThanOrEqual(LIFT_MAX);
        values.add(lift);
      }
    }
    expect(LIFT_MAX).toBeLessThan(STEP / 4); // uneven ground, never a step
    expect(values.size).toBeGreaterThan(1000); // 1681 cells, almost all different
    expect(Math.max(...values)).toBeGreaterThan(LIFT_MAX * 0.9);
    expect(Math.min(...values)).toBeLessThan(LIFT_MAX * 0.1);
  });

  it('draws each column to its lifted top, and the props, with the hero, stand on that top: nothing floats or sinks (#1418)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    const world = new World(bytes);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let columns = 0;
    let trees = 0;
    for (const g of GROUNDS) {
      const m = mesh(view, `terrain-${g}`);
      const cells = cellsOf(view, `terrain-${g}`);
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, matrix);
        matrix.decompose(pos, new THREE.Quaternion(), scale);
        const tile = world.tile(cells[i]![0], cells[i]![1])!;
        expect(scale.y).toBeCloseTo(topOf(GROUND[tile.terrain], tile.height, cells[i]![0], cells[i]![1]), 5);
        expect(pos.y).toBeCloseTo(scale.y / 2, 5); // the foot stays on the floor of the world
        columns++;
      }
    }
    const treeMesh = mesh(view, 'prop-tree');
    const treeCells = cellsOf(view, 'prop-tree');
    for (let i = 0; i < treeMesh.count; i++) {
      treeMesh.getMatrixAt(i, matrix);
      matrix.decompose(pos, new THREE.Quaternion(), scale);
      const tile = world.tile(treeCells[i]![0], treeCells[i]![1])!;
      expect(pos.y - scale.y / 2).toBeCloseTo(topOf(GROUND[tile.terrain], tile.height, treeCells[i]![0], treeCells[i]![1]), 5);
      trees++;
    }
    expect(columns).toBeGreaterThan(100);
    expect(trees).toBeGreaterThan(0);
    const lifted = [0, 1, 2, 3, 4, 5].map((q) => topOf('grass', 1, q, 7) - topOf('grass', 1, 0, 0));
    expect(new Set(lifted).size).toBeGreaterThan(1);
    expect(topOf('water', 1, 5, 5)).toBe(topOf('water', 1, 6, 9)); // water stays flat
    expect(view.scene.getObjectByName('hero')!.position.y).toBeCloseTo(topOf('grass', 2, 2, 1) + 0.3, 6);
  });

  it('scales its sun, its sky light and its neon lamps by the Lights and Lamps sliders, across the day (#1727)', () => {
    setNeonWorldOn(true); // the neon look has the lamps
    const view = new OpenWorldView(new World(grass), new FightState());
    const lights = () => {
      const found: THREE.Light[] = [];
      view.scene.traverse((o) => void ((o as THREE.Light).isLight && found.push(o as THREE.Light)));
      return found;
    };
    const kind = (k: string) => lights().find((l) => (l as unknown as Record<string, boolean>)[k])!;
    const lamps = () => lights().filter((l) => l.name === 'neon accent');
    const [sun, sky, lamp] = [kind('isDirectionalLight').intensity, kind('isHemisphereLight').intensity, lamps()[0]!.intensity];
    expect(lamps()).toHaveLength(2);
    view.setLevels(0.5, 2);
    expect(kind('isDirectionalLight').intensity).toBeCloseTo(sun * 0.5);
    expect(kind('isHemisphereLight').intensity).toBeCloseTo(sky * 0.5);
    expect(lamps().map((l) => l.userData.power)).toEqual([lamp * 2, lamp * 2]); // the base power the pulse drives (neonfx.ts)
    view.setLevels(0.5, 2); // twice the same levels, the same lights
    expect(lamps()[0]!.userData.power).toBe(lamp * 2);
    view.setTime(18 * 3_600_000, false); // another time of day keeps the factor
    const dusk = new OpenWorldView(new World(grass), new FightState());
    dusk.setTime(18 * 3_600_000, false);
    let duskSun = 0;
    dusk.scene.traverse((o) => void ((o as THREE.DirectionalLight).isDirectionalLight && (duskSun = (o as THREE.Light).intensity)));
    expect(kind('isDirectionalLight').intensity).toBeCloseTo(duskSun * 0.5);
    view.setLevels(1, 1);
    expect(lamps()[0]!.userData.power).toBe(lamp);
    setNeonWorldOn(false);
  });

  it('is lit by the sun of the arena, which follows the hero and casts its soft shadow on the high tier only (#1364)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    let sun!: THREE.DirectionalLight;
    view.scene.traverse((o) => void ((o as THREE.DirectionalLight).isDirectionalLight && (sun = o as THREE.DirectionalLight)));
    expect(sun.color.getHex()).toBe(SUN.colour);
    expect(sun.target.position.toArray()).toEqual(view.focusPoint.toArray());
    expect(sun.position.clone().sub(view.focusPoint).toArray().map((v) => +v.toFixed(3))).toEqual(sunPosition().map((v) => +v.toFixed(3)));
    expect(sun.castShadow).toBe(false); // off until the tier is known
    view.setShadows(true);
    expect([sun.castShadow, sun.shadow.camera.right]).toEqual([true, 14]);
    view.setShadows(false);
    expect(sun.castShadow).toBe(false);
  });

  it('widens the sun\'s shadow with the zoom, so its rectangle stays past the screen at every zoom, and the sun keeps behind it (#1478)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    let sun!: THREE.DirectionalLight;
    view.scene.traverse((o) => void ((o as THREE.DirectionalLight).isDirectionalLight && (sun = o as THREE.DirectionalLight)));
    view.setShadows(true);
    const cam = sun.shadow.camera;
    expect([cam.right, cam.left, cam.top, cam.bottom, cam.far]).toEqual([14, -14, 14, -14, 90]); // the closest zoom is as sharp as before
    zoomed(view, MAX_ZOOM);
    const k = view.drawnZoom;
    expect(k).toBeGreaterThan(5);
    expect([cam.right, cam.left, cam.top, cam.bottom]).toEqual([14 * k, -14 * k, 14 * k, -14 * k]);
    expect(cam.far).toBeCloseTo(90 * k);
    expect(sun.position.clone().sub(view.focusPoint).length()).toBeCloseTo(30 * k); // the sun stands back so the near plane clips nothing
    zoomed(view, 1 / MAX_ZOOM);
    expect([cam.right, sun.position.clone().sub(view.focusPoint).length()]).toEqual([14, expect.closeTo(30)]);
    view.setShadows(false);
    zoomed(view, MAX_ZOOM);
    view.setShadows(true); // switched on at a wide zoom: it starts wide
    expect(cam.right).toBeCloseTo(14 * view.drawnZoom);
  });

  it('casts the shadows of the hero, the props, the marbles and the towers, on the ground, and not the ground nor the sparks (#1364)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    view.setLairs([[0, 0]], []);
    const flags = (name: string): [boolean, boolean] => [mesh(view, name).castShadow, mesh(view, name).receiveShadow];
    expect(flags('prop-tree')).toEqual([true, true]);
    expect(flags('troop')).toEqual([true, true]);
    expect(flags('terrain-grass')).toEqual([false, true]);
    expect(flags('particles')).toEqual([false, false]);
    expect(view.scene.getObjectByName('hero')!.castShadow).toBe(true);
    expect(view.scene.getObjectByName('lair-0')!.children.every((o) => o.castShadow)).toBe(true);
    view.useModels({ low: { mountain: new THREE.BoxGeometry() }, high: {} }); // a replaced mesh keeps its flags
    expect(flags('prop-mountain')).toEqual([true, true]);
  });

  it('swaps the procedural shapes for the models it is given, and keeps the others', () => {
    const view = new OpenWorldView(new World(bytes));
    const tree = mesh(view, 'prop-tree').geometry;
    const mountain = new THREE.BoxGeometry();
    view.useModels({ low: { mountain }, high: {} });
    // the mesh draws the model's shape, from its own copy of the geometry (#991)
    expect(mesh(view, 'prop-mountain').geometry.getAttribute('position').count).toBe(mountain.getAttribute('position').count);
    isNot(mesh(view, 'prop-mountain').geometry, mountain);
    expect(mesh(view, 'prop-tree').geometry).toBe(tree);
  });

  it('draws a model that paints its own colours with them, untinted, and keeps the tint of the others', () => {
    const view = new OpenWorldView(new World(bytes));
    const painted = new THREE.BoxGeometry();
    painted.setAttribute('color', new THREE.BufferAttribute(new Float32Array(painted.getAttribute('position').count * 3), 3));
    view.useModels({ low: { mountain: painted, tree: new THREE.BoxGeometry() }, high: { mountain: painted } });
    const paintedMaterial = mesh(view, 'prop-mountain').material as THREE.MeshStandardMaterial;
    expect(paintedMaterial.vertexColors).toBe(true);
    expect(paintedMaterial.color.getHex()).toBe(0xffffff);
    expect(paintedMaterial.emissive.getHex()).toBe(0x000000);
    const detailedMaterial = mesh(view, 'prop-mountain-hi').material as THREE.MeshStandardMaterial;
    expect(detailedMaterial.vertexColors).toBe(true);
    expect(detailedMaterial.color.getHex()).toBe(0xffffff);
    const plainMaterial = mesh(view, 'prop-tree').material as THREE.MeshStandardMaterial;
    expect(plainMaterial.vertexColors).toBe(false);
    expect(plainMaterial.color.getHex()).toBe(0x2fb5a0);
  });
});

describe('loading the Blender models (client/models/openworld.glb, openworld-hi.glb, #989)', () => {
  const sceneOf = (names: string[]) => {
    const scene = new THREE.Group();
    for (const name of names) {
      const m = new THREE.Mesh(new THREE.BoxGeometry());
      m.name = name;
      scene.add(m);
    }
    return scene;
  };
  const urls = { low: '/assets/pbr/openworld.glb', high: '/assets/pbr/openworld-hi.glb' };
  // each file holds its own names: the low-poly `ow_<prop>`, the detailed `ow_<prop>_hi`
  const files: Record<string, THREE.Group> = {
    [urls.low]: sceneOf(['ow_mountain', 'ow_tree', 'ow_wall']),
    [urls.high]: sceneOf(['ow_mountain_hi', 'ow_tree_hi', 'ow_boulder_hi', 'ow_wall_hi']),
  };

  it('takes the geometry of each model by its name: the low-poly ones from one file, the detailed ones from the other', async () => {
    const loader = { loadAsync: vi.fn(async (url: string) => ({ scene: files[url]! })) };
    const models = await loadModels(urls, loader);
    expect(loader.loadAsync).toHaveBeenCalledWith(urls.low);
    expect(loader.loadAsync).toHaveBeenCalledWith(urls.high);
    expect(Object.keys(models.low).sort()).toEqual(['mountain', 'tree', 'wall']);
    expect(Object.keys(models.high).sort()).toEqual(['mountain', 'tree', 'wall']); // the boulder is the 20-triangle shell, whatever the file holds (#1315)
  });

  it('keeps the low-poly models when only the detailed file fails: the low-poly props draw every cell', async () => {
    const loader = { loadAsync: async (url: string) => (url === urls.high ? Promise.reject(new Error('404')) : { scene: files[url]! }) };
    const models = await loadModels(urls, loader);
    expect(Object.keys(models.low).sort()).toEqual(['mountain', 'tree', 'wall']);
    expect(models.high).toEqual({});
  });

  it('reads each biome\'s own tree and boulder from the biomes file, with the low-poly props (#1733)', async () => {
    const biomes = '/assets/pbr/openworld-biomes.glb';
    const all: Record<string, THREE.Group> = { ...files, [biomes]: sceneOf(['ow_tree_forest', 'ow_boulder_desert', 'ow_tree']) }; // a plain name there is not read
    const models = await loadModels({ ...urls, biomes }, { loadAsync: async (url: string) => ({ scene: all[url]! }) });
    expect(models.low.tree_forest).toBeDefined();
    expect(models.low.boulder_desert).toBeDefined();
    expect(models.low.tree).toBe((files[urls.low]!.getObjectByName('ow_tree') as THREE.Mesh).geometry);
  });

  it('gives none when both loads fail, so the procedural shapes stay', async () => {
    const loader = { loadAsync: async () => Promise.reject(new Error('404')) };
    expect(await loadModels(urls, loader)).toEqual({ low: {}, high: {} });
  });
});

// Every chunk of the square -3..3 is one terrain code: 4 a peak, 5 a boulder, 6 a tree, 7 a wall.
function all(terrain: number): (cx: number, cy: number) => Uint8Array {
  return (cx, cy) => {
    if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, terrain, 0], i * 3);
    return out;
  };
}
const hexDistance = ([q1, r1]: Axial, [q2, r2]: Axial): number => {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};
/** The cell of each instance of a mesh, read back from its matrices. */
const cellsOf = (view: OpenWorldView, name: string): Axial[] => {
  const m = mesh(view, name);
  const matrix = new THREE.Matrix4();
  const out: Axial[] = [];
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, matrix);
    const p = new THREE.Vector3().setFromMatrixPosition(matrix);
    out.push(cellAtPoint(p.x, p.z));
  }
  return out;
};
const box = () => new THREE.BoxGeometry();

describe('the detailed props near the hero (#989)', () => {
  it('has a detailed mesh per modelled prop, holding the cells within HI_RADIUS of the hero: 3r(r+1)+1', () => {
    expect(HI_RADIUS).toBe(8);
    expect(HI_CAPACITY).toBe(3 * HI_RADIUS * (HI_RADIUS + 1) + 1);
    const view = new OpenWorldView(new World(bytes));
    for (const prop of ['mountain', 'tree', 'boulder', 'wall']) {
      expect(mesh(view, `prop-${prop}-hi`).instanceMatrix.count).toBe(HI_CAPACITY);
    }
  });

  it('draws the cells within HI_RADIUS of the hero with the detailed mesh, the others with the low-poly one, each in exactly one', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    view.show([0, 0]);
    const near = cellsOf(view, 'prop-mountain-hi');
    const far = cellsOf(view, 'prop-mountain');
    const cells = 49 * CHUNK * CHUNK;
    expect(near).toHaveLength(HI_CAPACITY); // every cell of the hex of radius 8 is loaded
    expect(new Set(near.map(String)).size).toBe(HI_CAPACITY);
    expect(near.every((c) => hexDistance(c, [0, 0]) <= HI_RADIUS)).toBe(true);
    expect(far.every((c) => hexDistance(c, [0, 0]) > HI_RADIUS)).toBe(true);
    expect(new Set([...near, ...far].map(String)).size).toBe(cells);
    expect(near.length + far.length).toBe(cells);
  });

  it('moves the split with the hero: a step to a neighbour rebuilds it, so the cells now in reach are detailed', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: {}, high: { mountain: box() } });
    view.show([0, 0]);
    expect(cellsOf(view, 'prop-mountain-hi')).not.toContainEqual([9, 0]);
    view.show([1, 0]); // (9, 0) is 8 cells from here, 9 from the first cell
    expect(cellsOf(view, 'prop-mountain-hi')).toContainEqual([9, 0]);
    expect(cellsOf(view, 'prop-mountain-hi')).not.toContainEqual([-8, 0]); // 9 from here, 8 from the first cell
  });

  it('draws only the low-poly props until the detailed models arrive, then rebuilds with them at once', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(view.drawn['prop-mountain-hi']).toBe(0);
    expect(view.drawn['prop-mountain']).toBe(49 * CHUNK * CHUNK);
    view.useModels({ low: {}, high: { mountain: box() } }); // no hero step: the view rebuilds the split itself
    expect(view.drawn['prop-mountain-hi']).toBe(HI_CAPACITY);
    expect(view.drawn['prop-mountain']).toBe(49 * CHUNK * CHUNK - HI_CAPACITY);
  });

  it('keeps every cell on the low-poly mesh when the detailed models did not load', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: {} });
    view.show([0, 0]);
    expect(view.drawn['prop-mountain-hi']).toBe(0);
    expect(view.drawn['prop-mountain']).toBe(49 * CHUNK * CHUNK);
  });
});

describe('the chunks of the view stay cached after a far walk (#1034)', () => {
  // A world of water everywhere, so every edge cell of the view reads its neighbours in the chunks outside the view (`waterColor`).
  const water = (): Uint8Array => {
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([0, 0, 0], i * 3);
    return out;
  };

  it('a rebuild at the widest zoom loads each chunk once, after the walk has filled the cache past CACHE_LIMIT and come back', () => {
    const load = vi.fn((_cx: number, _cy: number) => water());
    const view = new OpenWorldView(new World(load));
    view.resize(1600, 900);
    zoomed(view, MAX_ZOOM * 2);
    for (let step = 0; step < 12; step++) view.show([step * 4 * CHUNK, 0]); // 12 jumps of 4 chunks: 441 + 11 * 84 chunks seen, more than the cache holds
    load.mockClear();
    view.show([0, 0]); // back to the spawn: a full rebuild around it
    const keys = load.mock.calls.map(([cx, cy]) => `${cx},${cy}`);
    expect(new Set(keys).size).toBe(keys.length); // no chunk of the rebuild is loaded again: none was evicted while in use
    expect(view.reach).toBe(MAX_REACH);
  });
});

describe('a step rebuilds only the props, the ground columns do not depend on the hero (#1034)', () => {
  // The instances a mesh draws, matrices and colours, as numbers: what the browser shows.
  const drawnOf = (m: THREE.InstancedMesh) => ({
    count: m.count,
    matrices: Array.from(m.instanceMatrix.array.slice(0, m.count * 16)),
    colours: Array.from(m.instanceColor!.array.slice(0, m.count * 3)),
  });
  const everyMesh = (view: OpenWorldView): string[] => [...GROUNDS.map((g) => `terrain-${g}`), 'prop-mountain', 'prop-tree', 'prop-boulder', 'prop-wall', 'prop-cap', 'prop-mountain-hi', 'prop-tree-hi', 'prop-boulder-hi', 'prop-wall-hi'].filter((n) => view.scene.getObjectByName(n));

  it('a step to a neighbour writes the props only: the ground meshes keep their instances (their buffers are not rewritten)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(1600, 900);
    view.show([0, 0]);
    const grounds = GROUNDS.map((g) => mesh(view, `terrain-${g}`));
    const versions = grounds.map((m) => [m.instanceMatrix.version, m.instanceColor!.version]);
    const propVersion = mesh(view, 'prop-tree').instanceMatrix.version;
    view.show([1, 0]); // no detailed model: no prop switches between its meshes, so none is written (#1054)
    expect(grounds.map((m) => [m.instanceMatrix.version, m.instanceColor!.version])).toEqual(versions);
    expect(mesh(view, 'prop-tree').instanceMatrix.version).toBe(propVersion);
  });

  it('a step draws the same instances as a fresh build at the new hero: the same set, the look does not change (#1054 moves them)', () => {
    const models = { low: { mountain: box() }, high: { mountain: box() } };
    const stepped = new OpenWorldView(new World(bytes));
    stepped.resize(1600, 900);
    stepped.useModels(models);
    stepped.show([0, 0]);
    stepped.show([1, 0]);
    const fresh = new OpenWorldView(new World(bytes));
    fresh.resize(1600, 900);
    fresh.useModels(models);
    fresh.show([1, 0]);
    for (const name of everyMesh(fresh)) expect(setOf(mesh(stepped, name)), name).toEqual(setOf(mesh(fresh, name)));
  });
});

// The instances of a mesh as a set of matrix and colour strings: a step moves an instance to a free index, so the order differs.
const setOf = (m: THREE.InstancedMesh): string[] =>
  Array.from({ length: m.count }, (_, i) => `${m.instanceMatrix.array.slice(i * 16, i * 16 + 16).join()}|${m.instanceColor!.array.slice(i * 3, i * 3 + 3).join()}`).sort();
// The instances of a mesh by the cell they stand on, as their matrix and colour.
const byCell = (view: OpenWorldView, name: string): Map<string, string> => {
  const m = mesh(view, name);
  const out = new Map<string, string>();
  cellsOf(view, name).forEach(([q, r], i) => {
    out.set(`${q},${r}`, `${m.instanceMatrix.array.slice(i * 16, i * 16 + 16).join()}|${m.instanceColor!.array.slice(i * 3, i * 3 + 3).join()}`);
  });
  return out;
};

describe('a step moves only the props near the hero (#1054)', () => {
  afterEach(() => vi.restoreAllMocks());
  // The cells of a box of 41 x 41 cells around `centre`: the widest ball around it and its neighbours.
  const around = (centre: Axial = [0, 0]): Axial[] => {
    const cells: Axial[] = [];
    for (let q = centre[0] - 20; q <= centre[0] + 20; q++) for (let r = centre[1] - 20; r <= centre[1] + 20; r++) cells.push([q, r]);
    return cells;
  };
  const ballOf = (centre: Axial, cell: Axial) => hexDistance(cell, centre) <= HI_RADIUS;
  const meshNames = (view: OpenWorldView): string[] =>
    [...GROUNDS.map((g) => `terrain-${g}`), 'prop-mountain', 'prop-tree', 'prop-boulder', 'prop-wall', 'prop-cap', 'prop-mountain-hi', 'prop-tree-hi', 'prop-boulder-hi', 'prop-wall-hi'].filter((n) => view.scene.getObjectByName(n));

  it('writes only the props whose detail changes: the cells within HI_RADIUS of exactly one of the old and the new hero cell', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    view.show([0, 0]);
    const write = vi.spyOn(THREE.InstancedMesh.prototype, 'setMatrixAt');
    view.show([1, 0]);
    const switching = around().filter((cell) => ballOf([0, 0], cell) !== ballOf([1, 0], cell)).length;
    expect(write).toHaveBeenCalledTimes(switching); // one write per prop that moves, not one per prop of the 441 chunks
    expect(switching).toBeLessThan(60);
  });

  it('keeps the far props and the near ones that stay near as they are: the same instance on the same cell', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    view.show([0, 0]);
    const plain = byCell(view, 'prop-mountain');
    const detailed = byCell(view, 'prop-mountain-hi');
    view.show([1, 0]);
    const plainAfter = byCell(view, 'prop-mountain');
    const detailedAfter = byCell(view, 'prop-mountain-hi');
    for (const cell of around()) {
      const key = `${cell[0]},${cell[1]}`;
      if (ballOf([0, 0], cell) === ballOf([1, 0], cell)) {
        const before = ballOf([0, 0], cell) ? detailed : plain;
        const after = ballOf([1, 0], cell) ? detailedAfter : plainAfter;
        if (before.has(key)) expect(after.get(key), key).toBe(before.get(key));
      }
    }
  });

  it('a prop that leaves the radius goes back to its plain mesh, and one that comes within it is drawn in detail', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    view.show([0, 0]);
    expect(cellsOf(view, 'prop-mountain-hi')).toContainEqual([-8, 0]); // 8 from the origin
    view.show([1, 0]); // 9 from here
    expect(cellsOf(view, 'prop-mountain-hi')).not.toContainEqual([-8, 0]);
    expect(cellsOf(view, 'prop-mountain')).toContainEqual([-8, 0]);
    expect(cellsOf(view, 'prop-mountain-hi')).toContainEqual([9, 0]); // 8 from here, 9 from the origin
    expect(cellsOf(view, 'prop-mountain')).not.toContainEqual([9, 0]);
    expect(view.drawn['prop-mountain-hi']).toBe(HI_CAPACITY);
    view.show([0, 0]); // back: the cell returns to the detailed mesh
    expect(cellsOf(view, 'prop-mountain-hi')).toContainEqual([-8, 0]);
    expect(cellsOf(view, 'prop-mountain')).not.toContainEqual([-8, 0]);
  });

  it('writes nothing when no detailed model has arrived: every prop stays on its plain mesh', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: {} });
    view.show([0, 0]);
    const write = vi.spyOn(THREE.InstancedMesh.prototype, 'setMatrixAt');
    view.show([1, 0]);
    expect(write).not.toHaveBeenCalled();
  });

  it('moves a prop only where there is one on the world: a cell of another terrain or off the world writes nothing', () => {
    const world = new World(bytes); // the chunks -3..3 are on the world: q runs from -48 to 63, the cells past it are off the world
    const view = new OpenWorldView(world);
    view.resize(1600, 900);
    const models = { mountain: box(), tree: box(), boulder: box(), wall: box() };
    view.useModels({ low: models, high: models });
    view.show([58, 0]); // the hero's ball reaches past the edge of the world at q = 63
    const write = vi.spyOn(THREE.InstancedMesh.prototype, 'setMatrixAt');
    view.show([59, 0]);
    const expected = around([58, 0]).filter((cell) => {
      const tile = world.tile(cell[0], cell[1]);
      return tile !== undefined && ['peak', 'tree', 'boulder', 'wall'].includes(tile.terrain) && ballOf([58, 0], cell) !== ballOf([59, 0], cell);
    }).length;
    expect(write).toHaveBeenCalledTimes(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('a chunk rebuild still resets everything: every ground and prop is laid again, not only the ones that move', () => {
    const view = new OpenWorldView(new World(all(4)));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    view.show([0, 0]);
    view.show([1, 0]);
    const reach = view.reach;
    const write = vi.spyOn(THREE.InstancedMesh.prototype, 'setMatrixAt');
    view.show([reach * CHUNK, 0]); // the edge of the square, still on the world: the square moves, so the grounds and every prop are written
    expect(view.centreChunk).toEqual([reach, 0]);
    expect(write).toHaveBeenCalledTimes(2 * ground(view));
    expect((view.drawn['prop-mountain'] ?? 0) + (view.drawn['prop-mountain-hi'] ?? 0)).toBe(ground(view));
  });

  it('keeps the instances of a walk the same as a fresh build at the last cell, as a set, on every mesh', () => {
    const models = { low: { mountain: box(), tree: box(), boulder: box(), wall: box() }, high: { mountain: box(), tree: box(), boulder: box(), wall: box() } };
    const path: Axial[] = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [7, 4], [8, 4], [9, 5], [10, 6], [11, 6], [12, 7], [12, 8], [11, 9], [10, 10], [9, 10], [8, 11], [7, 12], [6, 12]];
    const world = new World(bytes); // one world for every view: its chunks are parsed once
    const walked = new OpenWorldView(world);
    walked.resize(1600, 900);
    walked.useModels(models);
    for (const cell of path) {
      walked.show(cell);
      const fresh = new OpenWorldView(world);
      fresh.resize(1600, 900);
      fresh.useModels(models);
      fresh.show(cell);
      for (const name of meshNames(fresh)) expect(setOf(mesh(walked, name)).join('\n'), `${name} at ${cell}`).toBe(setOf(mesh(fresh, name)).join('\n')); // strings: toEqual walks thousands of entries
    }
  });

  it('a step that needs more instances than its mesh holds grows the mesh and keeps the instances it had (#1054)', () => {
    // Peaks on every chunk of the widest square (21 x 21 chunks) but one: the hole at chunk (2, 0) empties one cell of the ball around (24, 0).
    const holed = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > MAX_REACH || Math.abs(cy) > MAX_REACH || (cx === 2 && cy === 0)) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(holed));
    view.resize(1600, 900);
    view.useModels({ low: { mountain: box() }, high: { mountain: box() } });
    zoomed(view, MAX_ZOOM * 2); // the widest zoom: the square is MAX_REACH chunks around the origin, and its build sizes the mesh exactly
    view.show([0, 0]);
    const laid = mesh(view, 'prop-mountain');
    expect(view.reach).toBe(MAX_REACH);
    expect(laid.count).toBe(laid.instanceMatrix.count); // the plain props of the square fill the mesh: no slack
    view.show([24, 0]); // the ball around (24, 0) holds one cell fewer than the origin's: one plain prop more than the mesh has room for
    const grown = mesh(view, 'prop-mountain');
    isNot(grown, laid);
    expect(view.drawn['prop-mountain']).toBe(laid.count + 1);
    expect(view.drawn['prop-mountain-hi']).toBe(HI_CAPACITY - 1);
    expect(cellsOf(view, 'prop-mountain')).toContainEqual([-8, 0]); // a plain prop that the grown mesh keeps
    expect(new Set(cellsOf(view, 'prop-mountain').map(String)).size).toBe(view.drawn['prop-mountain']);
  });
  it('a troop longer than its mesh grows the troop mesh, and the marbles stand on the new cells', () => {
    const full = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > MAX_REACH || Math.abs(cy) > MAX_REACH) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(full));
    view.resize(1600, 900);
    view.show([0, 0]);
    const before = mesh(view, 'troop');
    const troop: Axial[] = Array.from({ length: CAPACITY.troop + 1 }, (_, i) => [i - CAPACITY.troop, 0] as Axial);
    view.join(troop);
    isNot(mesh(view, 'troop'), before);
    expect(mesh(view, 'troop').count).toBe(troop.length);
  });
});

describe('the troop and the enemies on screen', () => {
  it('draws the troop where it stands and the enemy marbles around the hero', () => {
    const foes = (cx: number, cy: number): Int32Array => (cx === 0 && cy === 0 ? Int32Array.of(5, 5, 6, 5) : new Int32Array());
    const view = new OpenWorldView(new World(bytes, foes));
    view.show([0, 0], [[1, 0], [0, 1], [-1, 1]]);
    expect(mesh(view, 'troop').count).toBe(3);
    expect(mesh(view, 'enemies').count).toBe(2);
    expect(view.enemyCount).toBe(2);
    const m = new THREE.Matrix4();
    mesh(view, 'enemies').getMatrixAt(1, m);
    const at = new THREE.Vector3().setFromMatrixPosition(m);
    expect(at.x).toBeCloseTo(axialTo3D(6, 5).x);
    expect(at.z).toBeCloseTo(axialTo3D(6, 5).z);
  });

  it('draws the enemies as they stand now: a generated one that was pushed is gone, the pushed one is where it stands', () => {
    const foes = (cx: number, cy: number): Int32Array => (cx === 0 && cy === 0 ? Int32Array.of(5, 5, 6, 5) : new Int32Array());
    const fight = new FightState();
    const view = new OpenWorldView(new World(bytes, foes), fight);
    view.show([0, 0]);
    expect(view.enemyCount).toBe(2);
    fight.apply([[5, 5]], [[5, 4]], []); // the push of the generated enemy (5,5) to (5,4), and nothing else
    view.updateEnemies();
    expect(mesh(view, 'enemies').count).toBe(2);
    expect(view.enemyCount).toBe(2);
    const m = new THREE.Matrix4();
    mesh(view, 'enemies').getMatrixAt(0, m); // the generated (6,5) stays
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(axialTo3D(6, 5).x);
    mesh(view, 'enemies').getMatrixAt(1, m); // the pushed one, on (5,4)
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(axialTo3D(5, 4).x);
    expect(new THREE.Vector3().setFromMatrixPosition(m).z).toBeCloseTo(axialTo3D(5, 4).z);
  });

  it('draws the enemies of a fight a build takes too: a pushed enemy of the loaded square is in the first draw', () => {
    const fight = new FightState();
    fight.apply([], [[1, 0]], []);
    const view = new OpenWorldView(new World(bytes), fight);
    view.show([0, 0]);
    expect(view.enemyCount).toBe(1);
  });
});

describe('the zoom of the Open world camera (#976)', () => {
  const hero = (view: OpenWorldView) => view.scene.getObjectByName('hero')!;
  const back = (view: OpenWorldView) => view.camera.position.z - hero(view).position.z;

  it('starts at the closest view and zooms out to twice the distance, no further nor closer', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    expect(view.zoom).toBe(1);
    expect(view.camera.position.y).toBeCloseTo(14 + view.focusHeight); // the camera rides the height it looks at (#988)
    expect(back(view)).toBeCloseTo(11);
    zoomed(view, 0.5); // closer than the default: no
    expect(view.zoom).toBe(1);
    zoomed(view, 1.5);
    expect(view.zoom).toBeCloseTo(1.5);
    expect(view.camera.position.y).toBeCloseTo(21 + view.focusHeight);
    zoomed(view, 2 / 1.5);
    expect(view.camera.position.y).toBeCloseTo(28 + view.focusHeight); // the camera rides the height it looks at (#988)
    expect(back(view)).toBeCloseTo(22);
    zoomed(view, 1e9);
    expect(view.zoom).toBe(maxZoomFor(1)); // the default screen is square: its own widest zoom (#1027)
  });

  it('moves the fog and the far plane with the zoom, so the edge of the loaded chunks stays hidden', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    const fog = view.scene.fog as THREE.Fog;
    // the fog starts at the hero's depth, the middle of the ground in view, and ends past the farthest corner of the footprint
    expect(fog.near).toBeCloseTo(Math.hypot(14, 11));
    expect(fog.far).toBeGreaterThan(fog.near);
    expect(view.camera.far).toBeGreaterThan(fog.far);
    expect(view.camera.near).toBeCloseTo(0.1);
    zoomed(view, 2);
    expect(fog.near).toBeCloseTo(2 * Math.hypot(14, 11));
    expect(view.camera.far).toBeGreaterThan(fog.far);
    expect(view.camera.near).toBeCloseTo(0.2); // the near plane too: the depth precision stays
  });

  it('under the neon look the Open world marbles take the arena finish: the white hero, troop and the black foes (#1553)', () => {
    // The arena's numbers (NEON_GLOSS, the rim of neonMarbleRim): the same gloss and glow on the marbles of both worlds.
    const marbles = (): { hero: THREE.Material; troop: THREE.Material; foes: THREE.Material } => {
      const view = new OpenWorldView(new World(bytes));
      view.show([2, 1]);
      const at = (name: string): THREE.Material => (view.scene.getObjectByName(name) as THREE.Mesh).material as THREE.Material;
      return { hero: at('hero'), troop: at('troop'), foes: at('enemies') };
    };
    const plain = marbles();
    expect((plain.hero as THREE.MeshStandardMaterial).roughness, 'the default look keeps its own gloss (MARBLE_LOOK.hero)').toBe(0.08);
    setNeonWorldOn(true);
    try {
      const neon = marbles();
      expect((neon.hero as THREE.MeshStandardMaterial).roughness).toBe(NEON_GLOSS.roughness.white);
      expect((neon.troop as THREE.MeshStandardMaterial).roughness).toBe(NEON_GLOSS.roughness.white);
      expect((neon.foes as THREE.MeshStandardMaterial).roughness).toBe(NEON_GLOSS.roughness.black);
      expect((neon.hero as THREE.Material & { emissiveNode?: unknown }).emissiveNode, 'the rim on the hero').toBeDefined();
      expect((neon.foes as THREE.Material & { emissiveNode?: unknown }).emissiveNode, 'the rim on the foes').toBeDefined();
    } finally {
      setNeonWorldOn(false);
    }
  });

  it('under the neon look the fog ends further out than in the default look: the far ground keeps its colour to the screen edge (#1424)', () => {
    const fogFar = (): number => {
      const view = new OpenWorldView(new World(bytes));
      view.show([2, 1]);
      return (view.scene.fog as THREE.Fog).far;
    };
    const plain = fogFar();
    setNeonWorldOn(true);
    try {
      expect(fogFar()).toBeGreaterThan(plain * 1.2);
    } finally {
      setNeonWorldOn(false);
    }
    expect(fogFar()).toBe(plain);
  });

  it('keeps the camera behind the hero as it walks, at the zoom it has', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    zoomed(view, 2);
    view.show([3, 1]);
    expect(view.camera.position.y).toBeCloseTo(28 + view.focusHeight); // the camera rides the height it looks at (#988)
    expect(back(view)).toBeCloseTo(22);
  });

  it('picks the cell under the pointer at every zoom', () => {
    for (const level of [1, 1.5, 2]) {
      const world = new World(bytes);
      const view = new OpenWorldView(world);
      view.resize(800, 600);
      view.show([2, 1]);
      zoomed(view, level);
      for (const cell of [[2, 1], ...neighbours([2, 1])] as Axial[]) {
        const p = axialTo3D(cell[0], cell[1]);
        const tile = world.tile(cell[0], cell[1])!;
        const ndc = new THREE.Vector3(p.x, topOf(GROUND[tile.terrain], tile.height, cell[0], cell[1]), p.z).project(view.camera);
        expect(view.pick(ndc.x, ndc.y)).toEqual(cell);
      }
    }
  });

  it('picks the neighbour under the pointer on its own column top, 0 to 3 levels above and below the hero, close and far (#988)', () => {
    for (const zoom of [1, MAX_ZOOM]) {
      for (const d of neighbours([0, 0]) as Axial[]) {
        for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
          // A cell lower than the ring hides behind it when it lies behind the hero: the ray to its top runs into the ring's
          // columns, so only the two cells in front (`d[1] === 1`, nearest the camera) are clicked below the ring's level.
          if (k < 0 && d[1] !== 1) continue;
          // The hero stands on level 3 and one neighbour on 3 + k: every other cell of the ring is level 3.
          const view = new OpenWorldView(new World(stepped(new Map([[`${d[0]},${d[1]}`, 3 + k]]), 3, 1)));
          view.resize(800, 600);
          view.show([0, 0]);
          zoomed(view, zoom);
          const p = axialTo3D(d[0], d[1]);
          const ndc = new THREE.Vector3(p.x, topOf('grass', 3 + k, d[0], d[1]), p.z).project(view.camera);
          expect(view.pick(ndc.x, ndc.y), `${d} at level ${3 + k}, zoom ${zoom}`).toEqual(d);
        }
      }
    }
  });

  it('picks a far cell under the pointer on the ground, whatever its distance from the hero (#1137)', () => {
    for (const zoom of [1, 2]) {
      const world = new World(stepped(new Map([['6,1', 4]]))); // flat, a step up on (6, 1)
      const view = new OpenWorldView(world);
      view.resize(800, 600);
      view.show([2, 1]);
      zoomed(view, zoom);
      for (const cell of [[6, 1], [-3, -2], [2, 5], [4, -1]] as Axial[]) {
        const p = axialTo3D(cell[0], cell[1]);
        const tile = world.tile(cell[0], cell[1])!;
        const ndc = new THREE.Vector3(p.x, topOf(GROUND[tile.terrain], tile.height, cell[0], cell[1]), p.z).project(view.camera);
        expect(view.pickGround(ndc.x, ndc.y), `${cell} at zoom ${zoom}`).toEqual(cell);
      }
    }
  });

  it('gives no far cell when the ray misses the ground or lands off the loaded world (#1137)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(800, 600);
    view.show([CHUNK * 4 - 1, 0]);
    expect(view.pickGround(0.99, 0)).toBeNull(); // chunk 4 is not loaded
    view.camera.position.set(0, 10, 0);
    view.camera.lookAt(0, 20, 0); // every ray climbs
    view.camera.updateMatrixWorld();
    expect(view.pickGround(0, 0)).toBeNull();
  });

  it('gives the hero its own cell, no move, when the pointer is on no cell of the hero ring', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(800, 600);
    view.show([0, 0]);
    expect(view.pick(1, 1)).toEqual([0, 0]);
  });

  it('skips a neighbour off the loaded world: the pick at the centre is the hero on the edge of the world', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(800, 600);
    view.show([CHUNK * 4 - 1, 0]); // the last cell of chunk 3: the cells to its right are in chunk 4, not loaded
    expect(view.pick(0, 0)).toEqual([CHUNK * 4 - 1, 0]);
  });

  it('gives the hero its own cell when the ray misses every top, a camera looking up away from the ground (#988)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(800, 600);
    view.show([2, 1]);
    view.camera.position.set(0, 10, 0);
    view.camera.lookAt(0, 20, 0); // every ray climbs: no top plane below it is ever reached
    view.camera.updateMatrixWorld();
    expect(view.pick(0, 0)).toEqual([2, 1]);
  });

  it('follows the camera height to a step up a cliff: not at once, on the top within 0.6 s, never past it (#988, #1333)', () => {
    const view = new OpenWorldView(new World(stepped(new Map([['1,0', 3]]), 0)));
    view.resize(800, 600);
    view.show([0, 0]);
    expect(view.focusHeight).toBeCloseTo(view.scene.getObjectByName('hero')!.position.y);
    view.show([1, 0]); // a step onto a cell 3 levels up: the top is 3 * STEP higher
    const top = view.scene.getObjectByName('hero')!.position.y;
    expect(top - view.focusHeight).toBeCloseTo(3 * STEP + hexLift(1, 0) + terrace(1, 0) - hexLift(0, 0) - terrace(0, 0)); // the terrace inside a level too (#1718, #1732)
    const start = view.focusHeight;
    expect(view.follow(1 / 60, false)).toBe(true);
    expect(view.focusHeight).toBeGreaterThan(start);
    expect(view.focusHeight).toBeLessThan(top - 0.1); // not at its target at once
    let highest = view.focusHeight;
    // The spring of rate 25 closes all but (1 + 25 t) exp(-25 t) of the gap: on the top well within 40 frames (0.67 s).
    for (let frame = 1; frame < 40; frame++) {
      view.follow(1 / 60, false);
      highest = Math.max(highest, view.focusHeight);
    }
    expect(Math.abs(view.focusHeight - top)).toBeLessThanOrEqual(0.01); // on the top after 0.67 s
    expect(highest).toBeLessThanOrEqual(top); // the follow never overshoots
    expect(view.follow(1 / 60, false)).toBe(false); // settled: nothing to draw
    expect(view.focusHeight).toBe(top);
  });

  it('jumps to the top at once when the follow is instant (reduced motion, #988)', () => {
    const view = new OpenWorldView(new World(stepped(new Map([['1,0', 3]]), 0)));
    view.show([0, 0]);
    view.show([1, 0]);
    expect(view.follow(1 / 60, true)).toBe(true);
    expect(view.focusHeight).toBe(view.scene.getObjectByName('hero')!.position.y);
  });
});

describe('the camera frames the tower the hero walks to on a narrow screen (#1534)', () => {
  it('looks a share of the way to a tower within the reach on a portrait screen, and at the hero on a landscape one', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(390, 844);
    view.show([0, 0]);
    view.setGoal([3, 0]);
    view.follow(1, true);
    expect(view.focusPoint.x).toBeCloseTo(axialTo3D(3, 0).x * FRAME_SHARE);
    view.resize(1600, 900);
    view.follow(1, true);
    expect(view.focusPoint.x).toBeCloseTo(0);
  });

  it('looks at the hero alone with no goal, or with a tower beyond the reach', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(390, 844);
    view.show([0, 0]);
    view.setGoal(null);
    view.follow(1, true);
    expect(view.focusPoint.x).toBeCloseTo(0);
    view.setGoal([FRAME_REACH + 1, 0]);
    view.follow(1, true);
    expect(view.focusPoint.x).toBeCloseTo(0);
  });
});

describe('the loaded chunks cover the ground in view, at every aspect and zoom (#976)', () => {
  const screens: Record<string, [number, number]> = {
    '9/16': [900, 1600],
    '4/3': [800, 600],
    '16/9': [1600, 900],
    '21/9': [2100, 900],
    '32/9': [3840, 1080],
  };
  for (const [name, [width, height]] of Object.entries(screens)) {
    for (const zoom of [1, 2, 4, maxZoomFor(width / height)]) {
      for (const hero of [[0, 0], [CHUNK - 1, -CHUNK]] as Axial[]) {
        it(`keeps the four corners of the footprint inside the loaded square: ${name}, zoom ${zoom}, hero ${hero}`, () => {
          const view = new OpenWorldView(new World(grass));
          view.resize(width, height);
          view.show(hero);
          zoomed(view, zoom); // a wide screen stops sooner: the zoom is the widest it allows
          const [hq, hr] = view.centreChunk; // the square is around its centre, which the hero's chunk may not be (#1046)
          for (const p of footprint(view.camera)) {
            const [cq, cr] = chunkOf(cellAtPoint(p.x, p.z));
            expect(Math.abs(cq - hq)).toBeLessThanOrEqual(view.reach);
            expect(Math.abs(cr - hr)).toBeLessThanOrEqual(view.reach);
          }
        });
      }
    }
  }

  it('gives the reach in whole chunks: the radius in cells, rounded up to chunks, one chunk of margin', () => {
    expect(reachFor(0)).toBe(1);
    expect(reachFor(CHUNK)).toBe(2);
    expect(reachFor(CHUNK + 0.5)).toBe(3);
  });

  it('stops the zoom where the reach reaches MAX_REACH on a 16:9 screen, and no further', () => {
    expect(maxZoomFor(16 / 9)).toBe(MAX_ZOOM);
    expect(reachAt(16 / 9, MAX_ZOOM)).toBe(MAX_REACH);
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, 1e9);
    expect(view.zoom).toBe(MAX_ZOOM);
    expect(view.maxZoom).toBe(MAX_ZOOM);
  });

  it('stops a wide screen sooner, where its reach reaches MAX_REACH: the largest zoom whose reach fits', () => {
    const limit = maxZoomFor(32 / 9);
    expect(limit).toBeLessThan(MAX_ZOOM);
    expect(reachAt(32 / 9, limit)).toBeLessThanOrEqual(MAX_REACH);
    expect(someYawReaches(32 / 9, limit + 0.05)).toBe(true); // a turn of the camera needs the limit (#1026)
  });

  it('follows the aspect on a resize: a narrower screen lets the zoom go further, a wider one brings it back', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, 1e9);
    const wide = view.zoom;
    view.resize(3840, 1080);
    expect(view.zoom).toBeLessThan(wide);
    expect(view.zoom).toBe(maxZoomFor(32 / 9));
    expect(view.reach).toBeLessThanOrEqual(MAX_REACH);
    view.resize(900, 1600);
    expect(view.maxZoom).toBe(maxZoomFor(9 / 16));
    expect(view.maxZoom).toBeGreaterThan(MAX_ZOOM);
  });

  it('lets a portrait phone zoom out past MAX_ZOOM, up to where its reach reaches MAX_REACH (#1027)', () => {
    for (const aspect of [9 / 16, 3 / 4, 360 / 740, 390 / 844]) {
      const limit = maxZoomFor(aspect);
      expect(limit).toBeGreaterThan(MAX_ZOOM);
      expect(reachAt(aspect, limit)).toBeLessThanOrEqual(MAX_REACH);
      expect(someYawReaches(aspect, limit + 0.05)).toBe(true);
    }
  });

  it('gives a limit that never grows with the width of the screen, from portrait to ultra-wide (#1027)', () => {
    const limits = [9 / 16, 3 / 4, 1, 16 / 9, 21 / 9].map(maxZoomFor);
    expect(limits).toEqual([...limits].sort((a, b) => b - a));
    expect(maxZoomFor(16 / 9)).toBe(MAX_ZOOM); // the 16:9 screen keeps its limit
  });
});

describe('the instance capacity of each mesh (#976): no waste, and no write past the end', () => {
  it('sizes the troop at the troop and the recruits it can hold (#1531), and each other mesh at its measured maximum, not the widest view', () => {
    const view = new OpenWorldView(new World(grass));
    expect(mesh(view, 'troop').instanceMatrix.count).toBe(TROOP + RECRUIT_MAX);
    expect(mesh(view, 'enemies').instanceMatrix.count).toBe(CAPACITY.enemies);
    expect(mesh(view, 'prop-mountain').instanceMatrix.count).toBe(CAPACITY.mountain);
    expect(mesh(view, 'terrain-grass').instanceMatrix.count).toBe(CAPACITY.grass);
  });

  it('grows a mesh to draw every peak of the widest view, past its capacity, up to the most cells', () => {
    const peaks = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 40 || Math.abs(cy) > 40) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3); // every cell a peak
      return out;
    };
    const view = new OpenWorldView(new World(peaks));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, MAX_ZOOM); // the widest view holds more peaks than the mountains' capacity: the mesh grows
    expect(mesh(view, 'prop-mountain').count).toBe(MOST);
    expect(view.drawn['prop-mountain']).toBe(MOST);
  });

  it('grows the enemies to draw every one of them, and counts the ones drawn', () => {
    const crowd = Int32Array.from({ length: 2 * (CAPACITY.enemies + 10) }, () => 5); // every enemy on the cell (5, 5)
    const view = new OpenWorldView(new World(grass, (cx, cy) => (cx === 0 && cy === 0 ? crowd : new Int32Array())));
    view.show([0, 0]);
    expect(mesh(view, 'enemies').count).toBe(CAPACITY.enemies + 10);
    expect(view.enemyCount).toBe(CAPACITY.enemies + 10);
  });

  // #1010: a mesh past its initial capacity grows; only the theoretical most cells of the widest view are dropped.
  const filled = (code: number) => (cx: number, cy: number): Uint8Array => {
    if (Math.abs(cx) > 40 || Math.abs(cy) > 40) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([0, code, 0], i * 3); // every cell of one terrain, flat
    return out;
  };

  it('draws every water cell of the widest view, past the capacity of the water mesh (#1010)', () => {
    const view = new OpenWorldView(new World(filled(0))); // code 0: water
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, MAX_ZOOM);
    const side = 2 * view.reach + 1;
    expect(view.drawn['terrain-water']).toBe(side * side * CHUNK * CHUNK);
    expect(view.drawn['terrain-water']).toBeGreaterThan(CAPACITY.water);
    expect(mesh(view, 'terrain-water').instanceColor).not.toBeNull(); // the colour of each lake, kept through the growth
  });

  it('draws every tree of the widest view, past the capacity of the tree mesh (#1010)', () => {
    const view = new OpenWorldView(new World(filled(6))); // code 6: tree
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, MAX_ZOOM);
    const side = 2 * view.reach + 1;
    expect(view.drawn['prop-tree']).toBe(side * side * CHUNK * CHUNK);
    expect(view.drawn['prop-tree']).toBeGreaterThan(CAPACITY.tree);
  });

  it('grows the troop past its capacity too, so no marble of the troop is dropped (#1010)', () => {
    const view = new OpenWorldView(new World(grass));
    const troop = Array.from({ length: TROOP + 5 }, (_, i): Axial => [i % 5, 0]);
    view.show([0, 0], troop);
    expect(view.drawn.troop).toBe(TROOP + 5);
  });

  it('clamps the enemies at the most cells of the widest view, past the capacity they grow to (#1010)', () => {
    const crowd = Int32Array.from({ length: 2 * (MOST + 5) }, () => 5);
    const view = new OpenWorldView(new World(grass, (cx, cy) => (cx === 0 && cy === 0 ? crowd : new Int32Array())));
    view.show([0, 0]);
    expect(view.enemyCount).toBe(MOST);
  });
});

describe('the far zoom is real 3D, with no overview (#976)', () => {
  const hero = (view: OpenWorldView) => view.scene.getObjectByName('hero')!;

  it('keeps the chunks, the props, the fog and the hero drawn at the widest zoom', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([2, 1]);
    zoomed(view, MAX_ZOOM);
    expect(view.scene.fog).not.toBeNull();
    expect(mesh(view, 'terrain-grass').visible).toBe(true);
    expect(mesh(view, 'prop-tree').visible).toBe(true);
    expect(hero(view).visible).toBe(true);
  });

  it('loads the chunks the camera sees: the reach grows with the zoom, and a small zoom step rebuilds nothing', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(view.reach).toBe(3);
    expect(ground(view)).toBe((2 * 3 + 1) ** 2 * CHUNK * CHUNK);
    const version = mesh(view, 'terrain-grass').instanceMatrix.version;
    zoomed(view, 1.01); // the reach is still two chunks: the same chunks, not rebuilt
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBe(version);
    zoomed(view, 4);
    expect(view.reach).toBeGreaterThan(2);
    expect(ground(view)).toBe((2 * view.reach + 1) ** 2 * CHUNK * CHUNK);
  });

  it('keeps every chunk of the widest zoom within the capacity of the instanced meshes', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, MAX_ZOOM);
    expect(reachFor(groundRadius(view.camera, hero(view).position))).toBeLessThanOrEqual(MAX_REACH);
    expect(view.reach).toBeLessThanOrEqual(MAX_REACH);
    // every cell of the square is grass here: the grass mesh grows to hold all of them, and no more than the most
    const square = (2 * view.reach + 1) ** 2 * CHUNK * CHUNK;
    expect(mesh(view, 'terrain-grass').count).toBe(square);
    expect(mesh(view, 'terrain-grass').instanceMatrix.count).toBe(square);
    expect(square).toBeLessThanOrEqual(MOST);
  });

  it('rebuilds the chunks only when the hero leaves the square at a far zoom, with the reach of the zoom (#1046)', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, 4);
    const reach = view.reach;
    const version = mesh(view, 'terrain-grass').instanceMatrix.version;
    const propVersion = mesh(view, 'prop-tree').instanceMatrix.version;
    view.show([1, 1]); // the same chunk: the reach is kept, and only the props that switch between detailed and plain are written (#1054)
    expect(view.reach).toBe(reach);
    expect(mesh(view, 'prop-tree').instanceMatrix.version).toBe(propVersion); // no tree here, and no detailed model: nothing switches
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBe(version); // the grounds do not depend on the hero (#1034)
    view.show([CHUNK, 0]); // the next chunk, still inside the square at this zoom: the centre and the grounds are kept (#1046)
    expect(view.centreChunk).toEqual([0, 0]);
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBe(version);
    view.show([(reach + 1) * CHUNK, 0]); // a chunk past the square: rebuilt around it, with the same reach
    expect(view.centreChunk).toEqual([reach + 1, 0]);
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBeGreaterThan(version);
    expect(view.reach).toBe(reach);
    expect(ground(view)).toBe((2 * reach + 1) ** 2 * CHUNK * CHUNK);
  });

  it('gives the visible ground radius from the camera, the field of view and the aspect', () => {
    const view = new OpenWorldView(new World(bytes));
    view.resize(1600, 900);
    view.show([0, 0]);
    const radius = groundRadius(view.camera, hero(view).position);
    expect(radius).toBeGreaterThan(CHUNK);
    expect(radius).toBeLessThan(2 * CHUNK);
    zoomed(view, 4);
    expect(groundRadius(view.camera, hero(view).position) / radius).toBeCloseTo(4, 0); // the camera stands at the hero's height, so almost linear
  });

  it('reaches far past the loaded chunks when a corner of the screen looks past the horizon, so the reach is capped', () => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 1, 0);
    camera.lookAt(0, 10, -1); // up: the sky fills the screen
    camera.updateMatrixWorld();
    expect(groundRadius(camera, new THREE.Vector3())).toBeGreaterThan(1000);
    expect(reachFor(groundRadius(camera, new THREE.Vector3()))).toBeGreaterThan(MAX_REACH);
  });

  it('publishes the instances drawn per mesh, the ground, the props, the troop and the enemies', () => {
    const view = new OpenWorldView(new World(bytes, (cx, cy) => (cx === 0 && cy === 0 ? Int32Array.of(5, 5) : new Int32Array())));
    view.show([0, 0], [[1, 0]]);
    const drawn = view.drawn;
    expect(drawn['terrain-grass']).toBe(mesh(view, 'terrain-grass').count);
    expect(drawn['prop-tree']).toBeGreaterThan(0);
    expect(drawn.troop).toBe(1);
    expect(drawn.enemies).toBe(1);
  });
});

// Every cell of the square -3..3 of chunks is the terrain code `code(q, r)`.
const terrain = (code: (q: number, r: number) => number) => (cx: number, cy: number): Uint8Array => {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, code(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / CHUNK)), 0], i * 3);
  return out;
};
const WATER_CODE = 0;
const GRASS_CODE = 2;
const color = (hex: number) => new THREE.Color(hex);

describe('the water (docs/specs/openworld.md section 2): depth, a glossy surface, a slow glow', () => {
  it('colours a cell by its depth: the middle of a lake is deep, a lone water cell is shore', () => {
    expect(waterColor(new World(terrain(() => WATER_CODE)), 0, 0).getHex()).toBe(color(WATER.deep).getHex());
    const lone = new World(terrain((q, r) => (q === 0 && r === 0 ? WATER_CODE : GRASS_CODE)));
    expect(waterColor(lone, 0, 0).getHex()).toBe(color(WATER.shore).getHex());
  });

  it('gets lighter with each neighbour that is land', () => {
    const wet = new Set(neighbours([0, 0]).slice(0, 3).map(([q, r]) => `${q},${r}`));
    const half = new World(terrain((q, r) => (q === 0 && r === 0) || wet.has(`${q},${r}`) ? WATER_CODE : GRASS_CODE));
    expect(waterColor(half, 0, 0).getHex()).toBe(color(WATER.shore).lerp(color(WATER.deep), 0.5).getHex());
  });

  it('treats a cell off the loaded world as land', () => {
    const none = new World(() => new Uint8Array());
    expect(waterColor(none, 0, 0).getHex()).toBe(color(WATER.shore).getHex());
  });

  it('paints each water cell of the view with its depth', () => {
    const lone = new OpenWorldView(new World(terrain((q, r) => (q === 0 && r === 0 ? WATER_CODE : GRASS_CODE))));
    lone.show([0, 0]);
    const paint = new THREE.Color();
    mesh(lone, 'terrain-water').getColorAt(0, paint);
    expect(paint.getHex()).toBe(color(WATER.shore).getHex());
    const sea = new OpenWorldView(new World(terrain(() => WATER_CODE)));
    sea.show([0, 0]);
    mesh(sea, 'terrain-water').getColorAt(0, paint);
    expect(paint.getHex()).toBe(color(WATER.deep).getHex());
  });

  it('has a glossy water surface: a low roughness, so the sun catches it', () => {
    const view = new OpenWorldView(new World(terrain(() => WATER_CODE)));
    expect((mesh(view, 'terrain-water').material as THREE.MeshStandardMaterial).roughness).toBeLessThan(0.5);
  });

  it('knows whether a lake is in view', () => {
    const dry = new OpenWorldView(new World(terrain(() => GRASS_CODE)));
    dry.show([0, 0]);
    expect(dry.hasWater).toBe(false);
    const wet = new OpenWorldView(new World(terrain(() => WATER_CODE)));
    wet.show([0, 0]);
    expect(wet.hasWater).toBe(true);
  });

  it('lakes have no glow of their own: a black emissive, and nothing breathes it (#1315)', () => {
    expect(LOOK.water.emissive).toBe(0x000000);
    const view = new OpenWorldView(new World(terrain(() => WATER_CODE)));
    view.show([0, 0]);
    const water = mesh(view, 'terrain-water').material as THREE.MeshStandardMaterial;
    expect(water.emissive.getHex()).toBe(0x000000);
    expect(water.emissiveIntensity).toBe(1);
    expect('glow' in view).toBe(false);
  });

  it('draws a boulder as a broken shell half sunk in the ground, a low jagged dome and a shard, never a ball like a marble (#1315, #1557)', () => {
    const view = new OpenWorldView(new World(terrain(() => GRASS_CODE)));
    const boulder = mesh(view, 'prop-boulder');
    const position = boulder.geometry.getAttribute('position');
    expect((boulder.geometry.index?.count ?? position.count) / 3).toBe(24);
    const material = boulder.material as THREE.MeshStandardMaterial;
    expect(material.emissive.getHex()).toBe(0x000000);
    expect(material.color.getHex()).toBe(0x3a3631); // warm charcoal: shows on slate, never a black marble
    expect(material.roughness).toBe(1); // matte
    expect(material.vertexColors).toBe(true);
    const points = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
    const [xs, ys, zs] = [points.map((p) => p.x), points.map((p) => p.y), points.map((p) => p.z)];
    const extent = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(Math.min(...ys)).toBeCloseTo(-0.25, 5); // laid 0.2 over the ground at 0.8 high: its foot on the ground
    expect(Math.min(extent(xs), extent(zs)) / (extent(ys) * 0.8)).toBeGreaterThan(1.6); // squat: a marble is as tall as it is wide
    const foot = points.filter((p) => p.y < -0.249).map((p) => Math.hypot(p.x, p.z));
    expect(Math.max(...foot) / Math.min(...foot)).toBeGreaterThan(1.25); // a jagged rim, not a circle
    const shade = boulder.geometry.getAttribute('color');
    const normal = boulder.geometry.getAttribute('normal');
    const ups = Array.from({ length: shade.count }, (_, i) => [normal.getY(i) > 0.5, shade.getX(i)] as const);
    expect(ups.some(([up]) => up)).toBe(true);
    for (const [up, value] of ups) expect(value).toBeCloseTo(up ? 1.15 : 1); // the top faces are 15 % lighter
    for (let f = 0; f < position.count; f += 3) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, f);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.y).toBeGreaterThan(-0.01); // nothing faces the ground it sits in
    }
    expect(mesh(view, 'prop-boulder-hi').geometry.getAttribute('position').count).toBe(position.count); // near the hero it is the same shell
  });

  it("rims a boulder in the look's rim colour, a fresnel on its edge, when the look gives one (#1557)", () => {
    const plain = mesh(new OpenWorldView(new World(terrain(() => GRASS_CODE))), 'prop-boulder').material as THREE.MeshStandardNodeMaterial;
    expect(plain.emissiveNode ?? null).toBeNull();
    Object.assign(PROPS.boulder, { rim: 0x7fd6e8 });
    try {
      const rimmed = mesh(new OpenWorldView(new World(terrain(() => GRASS_CODE))), 'prop-boulder').material as THREE.MeshStandardNodeMaterial;
      expect(rimmed.emissiveNode).toBeTruthy();
      expect(rimmed.vertexColors).toBe(true);
    } finally {
      Object.assign(PROPS.boulder, { rim: 0 });
    }
  });

  it("rings a wall's walkway with the sodium edge, a hex ring the merlons stand in, under their tops (#1173, #1557)", () => {
    const world = new World(terrain((q, r) => (q === 2 && r === 0 ? 7 : GRASS_CODE)));
    const view = new OpenWorldView(world);
    view.show([0, 0]);
    const cap = mesh(view, 'prop-cap');
    const position = cap.geometry.getAttribute('position');
    const radii = Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getZ(i)));
    expect(Math.min(...radii)).toBeGreaterThan(0.29); // a hole the merlons stand in
    expect(Math.max(...radii)).toBeCloseTo(0.54, 5); // a rim past the wall's side
    expect((cap.geometry.index?.count ?? position.count) / 3).toBeLessThanOrEqual(24);
    const [m, rim] = [new THREE.Matrix4(), new THREE.Vector3()];
    cap.getMatrixAt(0, m);
    m.decompose(rim, new THREE.Quaternion(), new THREE.Vector3());
    const [q, r] = cellsOf(view, 'prop-cap')[0]!;
    const above = rim.y - topOf('rock', world.tile(q, r)!.height, q, r);
    expect(above).toBeGreaterThan(0.5); // over the walkway
    expect(above).toBeLessThan(0.9); // under the merlons' tops, the wall's 0.9
  });

  it('draws a tree as a matte teal outcrop, emissive off, as the world spec allows no glow on a prop (#1315)', () => {
    const view = new OpenWorldView(new World(terrain(() => GRASS_CODE)));
    const material = mesh(view, 'prop-tree').material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0x2fb5a0); // Slag Teal
    expect(material.emissive.getHex()).toBe(0x000000);
  });
});

/** The geometries and the materials of the meshes of a view's scene, each once. */
const objectsOf = (view: OpenWorldView) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  view.scene.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    geometries.add((object as THREE.Mesh).geometry);
    materials.add((object as THREE.Mesh).material as THREE.Material);
  });
  return { geometries, materials };
};

describe('the Open world view frees its GPU objects (#981)', () => {
  it('disposes its lights, which free the sun\'s shadow map and the renderer\'s node of each, so a world left leaves no texture behind (#1520)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const lights: THREE.Light[] = [];
    view.scene.traverse((object) => (object as THREE.Light).isLight && lights.push(object as THREE.Light));
    expect(lights.length).toBeGreaterThan(0);
    const freed = lights.map((light) => {
      const seen = vi.fn();
      light.addEventListener('dispose', seen);
      return seen;
    });
    view.dispose();
    freed.forEach((seen) => expect(seen).toHaveBeenCalledOnce());
  });

  it('tells the renderer each of its meshes is gone, so it drops their draw records and the instance buffers they hold (#1722)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const meshes: THREE.Mesh[] = [];
    view.scene.traverse((object) => (object as THREE.Mesh).isMesh && meshes.push(object as THREE.Mesh));
    expect(meshes.some((m) => (m as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
    const gone = meshes.map((mesh) => {
      const seen = vi.fn();
      mesh.addEventListener('dispose', seen); // what three's RenderObject listens to (a geometry's dispose keeps it)
      return seen;
    });
    view.dispose();
    gone.forEach((seen) => expect(seen).toHaveBeenCalledOnce());
    expect(view.scene.children).toEqual([]); // the scene three's render list keeps holds nothing
  });

  it('disposes every geometry of its scene once, the models it was given included, and keeps its materials: the renderer keeps their compiled programs for the next entry (#1710)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.useModels({ low: { tree: new THREE.BoxGeometry() }, high: { tree: new THREE.BoxGeometry() } });
    view.show([0, 0]);
    const { geometries, materials } = objectsOf(view);
    expect(geometries.size).toBeGreaterThan(5);
    view.drain(); // a frame has drawn since the models came: what they replaced is freed (#1017)
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, 'dispose');
    const detailed = mesh(view, 'prop-tree-hi'); // the detailed meshes are freed with the rest (#989)
    view.dispose();
    expect(disposeGeometry.mock.calls.length).toBe(geometries.size);
    expect(new Set(disposeGeometry.mock.contexts)).toEqual(geometries);
    expect(materials.size).toBeGreaterThan(0);
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(disposeGeometry.mock.contexts).toContain(detailed.geometry);
    vi.restoreAllMocks();
  });
});

describe('the Open world view frees the instance buffers of each mesh (#991)', () => {
  const instanced = (view: OpenWorldView): THREE.InstancedMesh[] => {
    const out: THREE.InstancedMesh[] = [];
    view.scene.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) out.push(object as THREE.InstancedMesh);
    });
    return out;
  };

  it('gives each instanced mesh its own geometry: a shared one frees the instance buffers of only one of its meshes', () => {
    const view = new OpenWorldView(new World(grass));
    view.useModels({ low: { tree: box() }, high: { tree: box() } });
    view.show([0, 0]);
    const meshes = instanced(view);
    expect(meshes.length).toBeGreaterThan(5);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(meshes.length);
  });

  it('a grown mesh takes a geometry of its own, and the geometry it replaces is disposed with it', () => {
    const peaks = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 40 || Math.abs(cy) > 40) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(peaks));
    view.resize(1600, 900);
    view.show([0, 0]);
    const before = mesh(view, 'prop-mountain').geometry;
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    zoomed(view, MAX_ZOOM);
    expect(mesh(view, 'prop-mountain').count).toBe(MOST);
    isNot(mesh(view, 'prop-mountain').geometry, before);
    view.drain();
    expect(disposeGeometry.mock.contexts).toContain(before);
    expect(new Set(instanced(view).map((m) => m.geometry)).size).toBe(instanced(view).length);
    vi.restoreAllMocks();
  });
});

describe('a replaced geometry is freed after the frame that may use it, not at once (#1017)', () => {
  it('keeps a model geometry that replaces a procedural one until the next draw, then frees it', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const procedural = mesh(view, 'prop-mountain').geometry;
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    view.useModels({ low: { mountain: new THREE.BoxGeometry() }, high: {} });
    expect(disposeGeometry.mock.contexts).not.toContain(procedural);
    view.drain();
    expect(disposeGeometry.mock.contexts).toContain(procedural);
    vi.restoreAllMocks();
  });

  it('keeps the geometry and the mesh that a growth replaces until the next draw, then frees them', () => {
    const peaks = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 40 || Math.abs(cy) > 40) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(peaks));
    view.resize(1600, 900);
    view.show([0, 0]);
    const old = mesh(view, 'prop-mountain');
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const disposeMesh = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');
    zoomed(view, MAX_ZOOM);
    isNot(mesh(view, 'prop-mountain'), old);
    expect(disposeGeometry.mock.contexts).not.toContain(old.geometry);
    expect(disposeMesh.mock.contexts).not.toContain(old);
    view.drain();
    expect(disposeGeometry.mock.contexts).toContain(old.geometry);
    expect(disposeMesh.mock.contexts).toContain(old);
    vi.restoreAllMocks();
  });

  it('a model swap replaces the mesh, with a material of its own, so the geometry it frees holds no buffer of a mesh still drawn (#1017)', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const old = mesh(view, 'prop-mountain');
    view.useModels({ low: { mountain: new THREE.BoxGeometry() }, high: {} });
    isNot(mesh(view, 'prop-mountain'), old);
    isNot(mesh(view, 'prop-mountain').material, old.material);
  });

  it('a growth replaces the mesh with a material of its own, and frees the replaced material after the draw (#1017)', () => {
    const peaks = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 40 || Math.abs(cy) > 40) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 4, 0], i * 3);
      return out;
    };
    const view = new OpenWorldView(new World(peaks));
    view.resize(1600, 900);
    view.show([0, 0]);
    const old = mesh(view, 'prop-mountain');
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, 'dispose');
    zoomed(view, MAX_ZOOM);
    isNot(mesh(view, 'prop-mountain').material, old.material);
    expect(disposeMaterial.mock.contexts).not.toContain(old.material);
    view.drain();
    expect(disposeMaterial.mock.contexts).toContain(old.material);
    vi.restoreAllMocks();
  });

  it('frees what it still holds when it is disposed before any draw', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const procedural = mesh(view, 'prop-mountain').geometry;
    view.useModels({ low: { mountain: new THREE.BoxGeometry() }, high: {} });
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    view.dispose();
    expect(disposeGeometry.mock.contexts).toContain(procedural);
    vi.restoreAllMocks();
  });

  it('frees a replaced geometry once, however often it is drained', () => {
    const view = new OpenWorldView(new World(bytes));
    view.show([0, 0]);
    const procedural = mesh(view, 'prop-mountain').geometry;
    view.useModels({ low: { mountain: new THREE.BoxGeometry() }, high: {} });
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    view.drain();
    view.drain();
    expect(disposeGeometry.mock.contexts.filter((g) => g === procedural)).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('the biomes look (openworld-terrain.md section 4, #984)', () => {
  const at = (height: number, terrain: Terrain, biome: Biome): Tile => ({ height, terrain, biome });
  // The chunks of the square -2..2, each one biome by its column (`cx` mod 5 is the biome code), with a tree or a boulder
  // every other cell on the low ground (heights 3 and 4): five biomes, each with its props.
  const biomeOf = (cx: number) => BIOMES[((cx % 5) + 5) % 5]!;
  const byBiome = (cx: number, cy: number): Uint8Array => {
    if (Math.abs(cx) > 2 || Math.abs(cy) > 2) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([3 + (i % 2), i % 2 ? 5 : 6, BIOMES.indexOf(biomeOf(cx))], i * 3);
    return out;
  };
  const colourOf = (view: OpenWorldView, name: string): number[] => {
    const m = mesh(view, name);
    return Array.from({ length: m.count }, (_, i) => new THREE.Color().fromArray(m.instanceColor!.array, i * 3).getHex());
  };

  it('lays a biome\'s own tree and boulder once its model is in, the plain ones before, untinted; a break takes it out (#1733)', () => {
    const world = new World(byBiome);
    const view = new OpenWorldView(world);
    view.show([0, 0]);
    const trees = mesh(view, 'prop-tree').count;
    expect(mesh(view, 'prop-tree_forest').count).toBe(0); // no model yet: the plain tree
    const painted = (): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry();
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
      return g;
    };
    view.useModels({ low: { tree_forest: painted(), boulder_tundra: painted() }, high: {} });
    view.show([0, 0]);
    expect(mesh(view, 'prop-tree_forest').count).toBeGreaterThan(0);
    expect(mesh(view, 'prop-boulder_tundra').count).toBeGreaterThan(0);
    expect(mesh(view, 'prop-tree').count).toBeLessThan(trees); // the forest's trees left the plain mesh
    expect(mesh(view, 'prop-boulder_desert').count).toBe(0); // no model for it: the desert keeps the plain boulder
    const forest = mesh(view, 'prop-tree_forest');
    expect(new THREE.Color().fromArray(forest.instanceColor!.array, 0).getHex()).toBe(0xffffff); // the model's own colours, untinted
    // A forest tree in view: the cell (CHUNK, 0) is in column cx = 1, the forest, its first cell a tree (code 6).
    const cell: [number, number] = [CHUNK, 0];
    expect(world.tile(...cell)).toMatchObject({ terrain: 'tree', biome: 'forest' });
    expect(view.hasProp(cell, 'tree')).toBe(true);
    const n = forest.count;
    world.smash(...cell);
    view.smash(cell, 'tree', 100, false);
    expect(mesh(view, 'prop-tree_forest').count).toBe(n - 1);
    expect(view.hasProp(cell, 'tree')).toBe(false);
  });

  it('colours the grass of every height by its biome, and mixes the biome into its shore, uplands and peaks (#1734)', () => {
    expect(groundColour(at(3, 'grass', 'meadow'), 'grass')).toBe(LOOK.grass.color);
    expect(groundColour(at(4, 'grass', 'tundra'), 'grass')).toBe(BIOME_LOOK.tundra.ground);
    expect(groundColour(at(3, 'tree', 'desert'), 'grass')).toBe(BIOME_LOOK.desert.ground); // a tree stands on the grass of its biome
    expect(groundColour(at(5, 'grass', 'desert'), 'grass')).toBe(BIOME_LOOK.desert.ground); // the uplands too (#1734)
    for (const ground of ['sand', 'rock', 'peak'] as const) {
      const mixed = new THREE.Color(LOOK[ground].color).lerp(new THREE.Color(BIOME_LOOK.badlands.ground), BIOME_MIX[ground]).getHex();
      expect(groundColour(at(6, ground, 'badlands'), ground), ground).toBe(mixed);
      expect(biomeGround(ground, 'badlands')).toBe(mixed);
      expect(groundColour(at(6, ground, 'tundra'), ground)).not.toBe(groundColour(at(6, ground, 'desert'), ground)); // each biome reads on its rock
    }
    expect(groundColour(at(0, 'water', 'tundra'), 'water')).toBe(LOOK.water.color); // water keeps its colour (waterColor)
  });

  it('gives each biome its own low ground, the meadow the grass of before', () => {
    expect(BIOME_LOOK.meadow.ground).toBe(LOOK.grass.color);
    expect(new Set(BIOMES.map((biome) => BIOME_LOOK[biome].ground)).size).toBe(BIOMES.length);
  });

  it('tints the trees and the boulders: whitish in tundra, warm in desert and badlands, neutral elsewhere', () => {
    expect(BIOME_LOOK.meadow.prop).toBe(0xffffff);
    expect(BIOME_LOOK.forest.prop).toBe(0xffffff);
    expect(BIOME_LOOK.tundra.prop).toBe(0xdde8ee);
    expect(BIOME_LOOK.desert.prop).toBe(0xf0d4ae);
    expect(BIOME_LOOK.badlands.prop).toBe(0xe8aa90);
    expect(BIOME_LOOK.archipelago.prop).toBe(0xffffff);
  });

  it('gives the islands of the archipelago a fresh green of their own (#1442)', () => {
    expect(BIOME_LOOK.archipelago.ground).toBe(0x5c7d58);
  });

  it('paints the low ground and the props of each cell with its biome, one colour per instance', () => {
    const view = new OpenWorldView(new World(byBiome));
    view.resize(1600, 900);
    view.show([0, 0]);
    for (const name of ['terrain-grass', 'prop-tree', 'prop-boulder']) {
      expect(mesh(view, name).instanceColor!.count).toBe(mesh(view, name).instanceMatrix.count);
    }
    const grounds = new Set(colourOf(view, 'terrain-grass'));
    for (const biome of ['meadow', 'tundra', 'desert', 'badlands', 'forest'] as const) {
      expect(grounds.has(BIOME_LOOK[biome].ground)).toBe(true);
    }
    const trees = new Set(colourOf(view, 'prop-tree'));
    for (const biome of ['tundra', 'desert', 'badlands'] as const) expect(trees.has(BIOME_LOOK[biome].prop)).toBe(true);
    expect(colourOf(view, 'prop-boulder').length).toBeGreaterThan(0);
  });

  it('keeps the colours when the meshes grow to hold a wide view (#1010)', () => {
    const view = new OpenWorldView(new World(byBiome));
    view.resize(1600, 900);
    view.show([0, 0]);
    const before = mesh(view, 'terrain-grass').instanceMatrix.count;
    zoomed(view, MAX_ZOOM); // the widest zoom
    view.show([0, 0]);
    const grounds = mesh(view, 'terrain-grass');
    expect(grounds.instanceMatrix.count).toBeGreaterThanOrEqual(before);
    expect(grounds.instanceColor!.count).toBe(grounds.instanceMatrix.count);
    expect(new Set(colourOf(view, 'terrain-grass')).size).toBeGreaterThan(1);
  });
});

describe("the troop's push animation (docs/specs/openworld.md section 4, #967)", () => {
  // The push of the e2e fixture: the hero rolls from (0,0) to (1,0), the line of three (the hero and the troop's first two
  // marbles) pushes the enemy (2,0) on to (3,0), and the hero and the troop follow it. The third troop marble stays.
  const pushOf = (): Played => ({
    from: [[1, 0], [0, 0], [-1, 0], [-2, 0]],
    foes: [[2, 0]],
    push: { troop: [[2, 0], [1, 0], [0, 0], [-2, 0]], enemies: [[3, 0]], ejected: [], homes: [], dir: [1, 0] },
  });
  const SQUARE = (cx: number, cy: number): Uint8Array => (Math.abs(cx) > 3 || Math.abs(cy) > 3 ? new Uint8Array() : grass());
  // The view once the push is played: the state the mode draws at once, on the final cells.
  function settled(played: Played, load = SQUARE, standing: Axial[] = []): OpenWorldView {
    const fight = new FightState();
    fight.apply([], standing, []); // enemies already on the board before the push
    fight.apply(played.foes, played.push.enemies, played.push.ejected);
    const view = new OpenWorldView(new World(load), fight);
    view.show(played.push.troop[0]!, played.push.troop.slice(1));
    view.updateEnemies();
    return view;
  }
  // The drawn place of a marble: an instance of an instanced mesh, or the mesh itself (the hero, the ejected marble).
  function placeOf(view: OpenWorldView, name: string, index = 0): THREE.Vector3 {
    const object = view.scene.getObjectByName(name)!;
    if (!(object instanceof THREE.InstancedMesh)) return object.position.clone();
    const m = new THREE.Matrix4();
    object.getMatrixAt(index, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  }
  const inCell = (point: THREE.Vector3, [q, r]: Axial): boolean =>
    Math.abs(point.x - axialTo3D(q, r).x) < 1e-6 && Math.abs(point.z - axialTo3D(q, r).z) < 1e-6;
  const between = (v: number, a: number, b: number): boolean => (v - a) * (v - b) < 0;
  afterEach(() => vi.restoreAllMocks());

  it('lunges the pushing line from the old cells to the new ones: on the old cell at the start, between at the middle, on the new one at the end', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0);
    view.tick(0);
    expect(inCell(placeOf(view, 'hero'), [1, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 0), [0, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 1), [-1, 0])).toBe(true);
    view.tick(200);
    expect(between(placeOf(view, 'hero').x, axialTo3D(1, 0).x, axialTo3D(2, 0).x)).toBe(true);
    view.tick(400);
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 0), [1, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 1), [0, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 2), [-2, 0])).toBe(true); // the marble out of the line does not move
  });

  it('holds every marble still for the hold on the contact frame: the lunge and the slide stop, then go on late by the hold, and the push ends that much later (#1561)', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0, 1, 50);
    view.tick(160); // the contact: 40 % of the lunge
    const at = placeOf(view, 'hero').x;
    view.tick(190);
    expect(placeOf(view, 'hero').x).toBe(at);
    expect(inCell(placeOf(view, 'enemies'), [2, 0])).toBe(true); // the enemy has not started to slide
    view.tick(210);
    expect(placeOf(view, 'hero').x).toBe(at);
    view.tick(260);
    expect(placeOf(view, 'hero').x).toBeGreaterThan(at);
    expect(view.tick(430)).toBe(true); // 400 ms of lunge are not enough any more
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(false);
    view.tick(460); // the slide ends at 410 ms, 460 ms with the hold
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
    expect(inCell(placeOf(view, 'enemies'), [3, 0])).toBe(true);
    expect(view.tick(461)).toBe(false);
  });

  it('a snap during the hold ends the push on its final cells at once, the hold delays nothing (#1561)', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0, 1, 50);
    view.tick(180);
    view.snap();
    expect(view.animating).toBe(false);
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
    expect(inCell(placeOf(view, 'enemies'), [3, 0])).toBe(true);
  });

  it('bursts four sparks at the contact cell when the push moves an enemy, born at the contact, and none when no enemy moves (#1561)', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0, 1, 50);
    view.sparkle(170, false, true); // the low tier has no ambient particle, the burst stays: born at the contact, 160 ms
    expect(view.sparkCount).toBe(4);
    const alone: Played = { ...pushOf(), foes: [], push: { ...pushOf().push, enemies: [] } };
    const none = settled(alone);
    none.playPush(alone, 0, 1, 50);
    none.sparkle(170, false, true);
    expect(none.sparkCount).toBe(0);
  });

  it('overshoots the new cell by a tenth of a cell at the end of the lunge, then settles back on it', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0);
    const cell = axialTo3D(2, 0).x - axialTo3D(1, 0).x;
    view.tick(320);
    expect(placeOf(view, 'hero').x - axialTo3D(1, 0).x).toBeCloseTo(1.1 * cell, 3);
    view.tick(340);
    expect(between(placeOf(view, 'hero').x, axialTo3D(2, 0).x, axialTo3D(1, 0).x + 1.1 * cell)).toBe(true);
    view.tick(380);
    expect(between(placeOf(view, 'hero').x, axialTo3D(2, 0).x, axialTo3D(1, 0).x + 1.1 * cell)).toBe(true);
  });

  it('slides the pushed enemy one cell once the lunge reaches contact (40 % of it): on its cell before, on the next one at the end', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0);
    view.tick(150);
    expect(inCell(placeOf(view, 'enemies'), [2, 0])).toBe(true);
    view.tick(285);
    expect(between(placeOf(view, 'enemies').x, axialTo3D(2, 0).x, axialTo3D(3, 0).x)).toBe(true);
    view.tick(410);
    expect(inCell(placeOf(view, 'enemies'), [3, 0])).toBe(true);
  });

  it('an enemy of the fight that the push leaves where it is does not move while the others slide', () => {
    const played: Played = { ...pushOf(), foes: [[2, 0], [9, 9]], push: { ...pushOf().push, enemies: [[3, 0], [9, 9]] } };
    const view = settled(played, SQUARE, [[9, 9]]);
    view.playPush(played, 0);
    view.tick(285);
    const drawn = Array.from({ length: view.enemyCount }, (_, i) => placeOf(view, 'enemies', i));
    expect(drawn.some((p) => inCell(p, [9, 9]))).toBe(true);
    expect(drawn.some((p) => inCell(p, [3, 0]) || between(p.x, axialTo3D(2, 0).x, axialTo3D(3, 0).x))).toBe(true);
  });

  it('a push by the troop alone leaves the hero where it is, and animates the marbles that move', () => {
    const played: Played = {
      from: [[-5, 0], [3, 0], [2, 0]],
      foes: [[1, 0]],
      push: { troop: [[-5, 0], [2, 0], [1, 0]], enemies: [[0, 0]], ejected: [], homes: [], dir: [-1, 0] },
    };
    const view = settled(played);
    view.playPush(played, 0);
    view.tick(200);
    expect(inCell(placeOf(view, 'hero'), [-5, 0])).toBe(true);
    expect(between(placeOf(view, 'troop', 0).x, axialTo3D(3, 0).x, axialTo3D(2, 0).x)).toBe(true);
    expect(between(placeOf(view, 'enemies').x, axialTo3D(1, 0).x, axialTo3D(0, 0).x)).toBe(true);
  });

  it('an ejected enemy slides into the water cell, then sinks below the ground while it shrinks to nothing, and is hidden at the end', () => {
    const played: Played = {
      from: [[1, 0], [0, 0], [-1, 0]],
      foes: [[2, 0]],
      push: { troop: [[2, 0], [1, 0], [0, 0]], enemies: [], ejected: [[2, 0]], homes: [[2, 0]], dir: [1, 0] },
    };
    const view = settled(played);
    view.playPush(played, 0);
    view.tick(0);
    expect(view.ejected.visible).toBe(true);
    expect(inCell(view.ejected.position, [2, 0])).toBe(true);
    expect(view.ejected.scale.x).toBe(1);
    view.tick(410); // the slide is over, the fall starts
    expect(inCell(view.ejected.position, [3, 0])).toBe(true);
    expect(view.ejected.scale.x).toBe(1);
    const high = view.ejected.position.y;
    view.tick(560);
    expect(view.ejected.scale.x).toBeGreaterThan(0);
    expect(view.ejected.scale.x).toBeLessThan(1);
    expect(view.ejected.position.y).toBeLessThan(high);
    view.tick(710);
    expect(view.ejected.scale.x).toBe(0);
    expect(view.ejected.position.y).toBeLessThan(0.2 + STEP); // below the ground
    expect(view.ejected.visible).toBe(false);
  });

  it('an ejected enemy pushed off the world keeps its height as it sinks, the cell beyond having no ground', () => {
    const played: Played = {
      from: [[62, 0], [61, 0], [60, 0]],
      foes: [[63, 0]],
      push: { troop: [[63, 0], [62, 0], [61, 0]], enemies: [], ejected: [[63, 0]], homes: [[63, 0]], dir: [1, 0] },
    };
    const view = settled(played);
    view.playPush(played, 0);
    view.tick(410);
    const ground = topOf('grass', 1, 63, 0) + MARBLE;
    expect(view.ejected.position.y).toBeCloseTo(ground, 6);
    view.tick(560);
    expect(view.ejected.position.y).toBeLessThan(ground);
    expect(view.ejected.scale.x).toBeLessThan(1);
  });

  it('a snap puts every marble on its final cell at once, hides the ejected marble and ends the animation', () => {
    const played: Played = {
      from: [[1, 0], [0, 0], [-1, 0]],
      foes: [[2, 0]],
      push: { troop: [[2, 0], [1, 0], [0, 0]], enemies: [], ejected: [[2, 0]], homes: [[2, 0]], dir: [1, 0] },
    };
    const view = settled(played);
    view.playPush(played, 0);
    view.tick(100);
    expect(view.animating).toBe(true);
    view.snap();
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 0), [1, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 1), [0, 0])).toBe(true);
    expect(view.ejected.visible).toBe(false);
    expect(view.animating).toBe(false);
    expect(view.tick(100)).toBe(false);
  });

  it('the camera follows the hero where it is drawn: the point it looks at moves with the lunge and ends on the hero cell', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0);
    const frames = (from: number, to: number): void => {
      for (let t = from; t <= to; t += 16) {
        view.tick(t);
        view.follow(0.016, false);
      }
    };
    frames(16, 200);
    expect(between(view.focusPoint.x, axialTo3D(1, 0).x, axialTo3D(2, 0).x)).toBe(true);
    frames(216, 800);
    expect(inCell(view.focusPoint, [2, 0])).toBe(true);
  });

  it('has no record once the animation has ended, and none before a push', () => {
    const view = settled(pushOf());
    expect(view.animating).toBe(false);
    expect(view.tick(0)).toBe(false);
    view.playPush(pushOf(), 0);
    expect(view.animating).toBe(true);
    expect(view.tick(410)).toBe(true); // the frame that ends it draws the final cells
    expect(view.tick(411)).toBe(false);
    expect(view.animating).toBe(false);
  });

  it('an enemy that is not drawn has no record, and the push still plays its hero and troop', () => {
    const view = new OpenWorldView(new World(SQUARE)); // no fight: the enemies of the push are not drawn
    view.show([2, 0], [[1, 0], [0, 0], [-2, 0]]);
    view.playPush(pushOf(), 0);
    expect(view.tick(400)).toBe(true); // the lunge is the whole push
    expect(view.tick(410)).toBe(false);
    expect(view.animating).toBe(false);
  });

  it('a slow factor stretches every duration, the lunge included', () => {
    const view = settled(pushOf());
    view.playPush(pushOf(), 0, 10);
    view.tick(400);
    expect(between(placeOf(view, 'hero').x, axialTo3D(1, 0).x, axialTo3D(2, 0).x)).toBe(true);
    view.tick(4100);
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
    expect(view.animating).toBe(false);
  });

  it('disposes the ejected marble\'s geometry with the rest of the view and keeps its material, as the others (#1710)', () => {
    const view = settled(pushOf());
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, 'dispose');
    view.dispose();
    expect(disposeGeometry.mock.contexts).toContain(view.ejected.geometry);
    expect(disposeMaterial.mock.contexts).not.toContain(view.ejected.material);
  });
});

describe('the camera turns around the hero by its yaw (#1026)', () => {
  const DEG = Math.PI / 180;

  it('sits on the back side of the hero at each yaw: the offset from the hero turns with it, and the camera looks at it', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    for (const yaw of [0, 30 * DEG, 90 * DEG, -60 * DEG]) {
      view.turnTo(yaw);
      const dx = view.camera.position.x - view.focusPoint.x;
      const dz = view.camera.position.z - view.focusPoint.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0);
      expect(Math.atan2(dx, dz)).toBeCloseTo(yaw, 6); // the back at yaw 0 is +z, as before
    }
  });

  it('picks the cell under the pointer at each yaw: a neighbour of the hero is the one its screen point picks', () => {
    const world = new World(grass);
    const view = new OpenWorldView(world);
    view.resize(1600, 900);
    for (const yaw of [0, 30 * DEG, 60 * DEG, 90 * DEG, -120 * DEG]) {
      view.turnTo(yaw);
      view.show([0, 0]);
      for (const cell of neighbours([0, 0])) {
        const p = axialTo3D(cell[0], cell[1]);
        const tile = world.tile(cell[0], cell[1])!;
        const ndc = new THREE.Vector3(p.x, topOf(GROUND[tile.terrain], tile.height, cell[0], cell[1]), p.z).project(view.camera);
        expect(view.pick(ndc.x, ndc.y)).toEqual(cell);
      }
    }
  });

  it('follows the yaw to its goal, one frame at a time, and settles on it; a goal wraps into (-pi, pi]', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(view.yaw).toBe(0);
    view.turn(Math.PI);
    view.turn(Math.PI / 2 + 0.1); // 3pi/2 + 0.1 wraps to -pi/2 + 0.1
    expect(view.yaw).toBeCloseTo(-Math.PI / 2 + 0.1);
    const before = view.camera.position.x;
    expect(view.follow(0.05, false)).toBe(true); // moving toward the goal
    expect(view.camera.position.x).not.toBeCloseTo(before);
    while (view.follow(0.5, false));
    expect(view.follow(0.5, false)).toBe(false);
    expect(Math.atan2(view.camera.position.x - view.focusPoint.x, view.camera.position.z - view.focusPoint.z)).toBeCloseTo(-Math.PI / 2 + 0.1, 6);
  });

  it('draws the yaw it has reached (#1448): behind the goal while it turns, on it once settled, at once with reduced motion', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(view.drawnYaw).toBe(0);
    view.turn(1);
    expect(view.drawnYaw).toBe(0); // the goal moved, the camera has not yet
    view.follow(0.05, false);
    expect(view.drawnYaw).toBeGreaterThan(0);
    expect(view.drawnYaw).toBeLessThan(1);
    while (view.follow(0.5, false));
    expect(view.drawnYaw).toBeCloseTo(1, 6);
    view.turn(1);
    view.follow(0.016, true);
    expect(view.drawnYaw).toBeCloseTo(2, 6);
  });

  it('snaps to the goal at once with reduced motion, and a turn back to zero is the reset', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    view.turn(1);
    expect(view.follow(0.016, true)).toBe(true);
    expect(Math.atan2(view.camera.position.x - view.focusPoint.x, view.camera.position.z - view.focusPoint.z)).toBeCloseTo(1, 6);
    view.turn(-view.yaw);
    view.follow(0.016, true);
    expect(view.yaw).toBe(0);
    expect(view.camera.position.x).toBeCloseTo(view.focusPoint.x, 6);
  });

  it('draws the widest zoom at every turn with its reach within MAX_REACH: no edge of the loaded chunks shows (#1026)', () => {
    const screens: [number, number][] = [
      [900, 1600],
      [2100, 900],
    ];
    for (const [width, height] of screens) {
      const view = new OpenWorldView(new World(grass));
      view.resize(width, height);
      view.show([0, 0]);
      zoomed(view, 1e9);
      for (let deg = 0; deg < 360; deg += 1) {
        view.turnTo(deg * DEG);
        expect(reachAt(width / height, view.drawnZoom, view.yaw)).toBeLessThanOrEqual(MAX_REACH);
      }
    }
  });

  it('loads the chunks of the ground in view at the widest zoom and any yaw, within the reach budget', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(390, 844);
    view.show([0, 0]);
    for (const yaw of [0, 30 * DEG, 60 * DEG, 90 * DEG]) {
      view.turnTo(yaw);
      zoomed(view, 1e9);
      expect(view.reach).toBeLessThanOrEqual(MAX_REACH);
    }
  });
});

describe('the step glide of the hero and the troop (docs/specs/openworld.md section 4, #1040)', () => {
  const GRASS = (cx: number, cy: number): Uint8Array => (Math.abs(cx) > 3 || Math.abs(cy) > 3 ? new Uint8Array() : grass());
  // The pushing line of the glide's push: the hero and three troop marbles, the enemy (2,0) on to (3,0).
  const pushLine = (): Played => ({
    from: [[1, 0], [0, 0], [-1, 0], [-2, 0]],
    foes: [[2, 0]],
    push: { troop: [[2, 0], [1, 0], [0, 0], [-2, 0]], enemies: [[3, 0]], ejected: [], homes: [], dir: [1, 0] },
  });
  // The drawn place of a marble: the hero, or an instance of the troop.
  function placeOf(view: OpenWorldView, name: 'hero' | 'troop', index = 0): THREE.Vector3 {
    const object = view.scene.getObjectByName(name)!;
    if (!(object instanceof THREE.InstancedMesh)) return object.position.clone();
    const m = new THREE.Matrix4();
    object.getMatrixAt(index, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  }
  const inCell = (point: THREE.Vector3, [q, r]: Axial): boolean =>
    Math.abs(point.x - axialTo3D(q, r).x) < 1e-6 && Math.abs(point.z - axialTo3D(q, r).z) < 1e-6;
  const between = (v: number, a: number, b: number): boolean => (v - a) * (v - b) < 0;
  const xOf = (cell: Axial): number => axialTo3D(cell[0], cell[1]).x;
  // The view on the spawn (0,0), the troop behind it: the state before a step.
  const standing = (): OpenWorldView => {
    const view = new OpenWorldView(new World(GRASS));
    view.show([0, 0], [[-1, 0], [-2, 0]]);
    return view;
  };

  it('glides the hero from its old cell to the new one: on the old cell at the start, between at the middle, on the new one at the end', () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    expect(view.tick(0)).toBe(true);
    expect(inCell(placeOf(view, 'hero'), [0, 0])).toBe(true);
    view.tick(GLIDE_MS / 2);
    expect(between(placeOf(view, 'hero').x, xOf([0, 0]), xOf([1, 0]))).toBe(true);
    view.tick(GLIDE_MS);
    expect(inCell(placeOf(view, 'hero'), [1, 0])).toBe(true);
    expect(view.tick(GLIDE_MS + 10)).toBe(false); // landed: nothing moves
  });

  it("glides each troop marble to the cell of the one before it, the first from the hero's old cell", () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(GLIDE_MS / 2);
    expect(between(placeOf(view, 'troop', 0).x, xOf([-1, 0]), xOf([0, 0]))).toBe(true);
    expect(between(placeOf(view, 'troop', 1).x, xOf([-2, 0]), xOf([-1, 0]))).toBe(true);
    view.tick(GLIDE_MS);
    expect(inCell(placeOf(view, 'troop', 0), [0, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 1), [-1, 0])).toBe(true);
  });

  it('the troop follows the hero a little later and lands with it, and hops (#1100)', () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(TROOP_DELAY * 2);
    expect(inCell(placeOf(view, 'troop', 1), [-2, 0])).toBe(true); // the second marble has not started
    expect(between(placeOf(view, 'hero').x, xOf([0, 0]), xOf([1, 0]))).toBe(true);
    view.tick(GLIDE_MS / 2);
    expect(placeOf(view, 'hero').y).toBeGreaterThan(placeOf(view, 'troop', 1).y - 1); // drawn, hopping
    view.tick(GLIDE_MS);
    expect(inCell(placeOf(view, 'troop', 1), [-1, 0])).toBe(true);
  });

  it('chains a held step from the place the hero has mid-glide: no snap back to the cell it left', () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(60);
    const mid = placeOf(view, 'hero').x;
    view.show([2, 0], [[1, 0], [0, 0]], { now: 60, span: GLIDE_MS });
    view.tick(60);
    expect(placeOf(view, 'hero').x).toBeCloseTo(mid, 9);
    view.tick(60 + GLIDE_MS);
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
  });

  it('stands the marbles on their cells at once when a show has no glide: a world entered, a fixture, reduced motion', () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]]);
    expect(view.tick(0)).toBe(false);
    expect(inCell(placeOf(view, 'hero'), [1, 0])).toBe(true);
    expect(inCell(placeOf(view, 'troop', 0), [0, 0])).toBe(true);
  });

  it('rolls the hero at the close zoom: its turn is drawn once it has rolled', () => {
    const view = standing();
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(GLIDE_MS);
    const hero = view.scene.getObjectByName('hero')!;
    expect(hero.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1);
  });

  it('draws no roll and no squash at the far zoom: the hero only slides there', () => {
    const view = new OpenWorldView(new World(GRASS));
    view.resize(1600, 900);
    zoomed(view, MAX_ZOOM);
    expect(view.drawnZoom).toBeGreaterThan(ROLL_ZOOM);
    view.show([0, 0], [[-1, 0], [-2, 0]]);
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(GLIDE_MS / 2);
    const hero = view.scene.getObjectByName('hero')!;
    expect(hero.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    expect(hero.scale.x).toBe(1);
    expect(hero.scale.y).toBe(1);
  });

  it('waits for the step to land before the push lunges, and lunges from the cells the step took', () => {
    const view = new OpenWorldView(new World(GRASS));
    view.show([0, 0], [[-1, 0], [-2, 0], [-3, 0]]);
    view.show([1, 0], [[0, 0], [-1, 0], [-2, 0]], { now: 0, span: GLIDE_MS });
    view.playPush(pushLine(), 0);
    view.tick(GLIDE_MS / 2);
    expect(between(placeOf(view, 'hero').x, xOf([0, 0]), xOf([1, 0]))).toBe(true); // still the step
    view.tick(GLIDE_MS);
    expect(inCell(placeOf(view, 'hero'), [1, 0])).toBe(true); // the lunge starts on the cell the step took
    view.tick(GLIDE_MS + 200);
    expect(between(placeOf(view, 'hero').x, xOf([1, 0]), xOf([2, 0]))).toBe(true);
    view.tick(GLIDE_MS + 540);
    expect(inCell(placeOf(view, 'hero'), [2, 0])).toBe(true);
  });

  it('a push that carries the hero on takes its end as the hero cell: the pick reads the new cell', () => {
    const view = new OpenWorldView(new World(GRASS));
    view.show([0, 0], [[-1, 0], [-2, 0], [-3, 0]]);
    view.show([1, 0], [[0, 0], [-1, 0], [-2, 0]]);
    view.playPush(pushLine(), 0);
    view.tick(10_000);
    view.follow(10, false); // a long frame: the camera is on the hero
    expect(view.pick(0, 0)).toEqual([2, 0]);
  });

  it('reports the glide while a marble moves, and not once it has landed', () => {
    const view = standing();
    expect(view.gliding).toBe(false);
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    view.tick(10);
    expect(view.gliding).toBe(true);
    view.tick(GLIDE_MS + 10); // the landing draws the last cell
    expect(view.gliding).toBe(true);
    view.tick(GLIDE_MS + 20);
    expect(view.gliding).toBe(false);
  });

  it('leaves a marble that is on its cell where it stands: a glide to the cells it has keeps nothing moving', () => {
    const view = standing();
    view.show([0, 0], [[-1, 0], [-2, 0]], { now: 0, span: GLIDE_MS });
    expect(view.tick(0)).toBe(false);
    expect(view.gliding).toBe(false);
  });

  it('stands a first world on its cell at once, with no glide in from the origin', () => {
    const view = new OpenWorldView(new World(GRASS));
    view.show([1, 0], [[0, 0], [-1, 0]], { now: 0, span: GLIDE_MS });
    expect(view.tick(0)).toBe(false);
    expect(inCell(placeOf(view, 'hero'), [1, 0])).toBe(true);
    expect(view.focusHeight).toBeCloseTo(placeOf(view, 'hero').y, 9);
  });

  it('a push that carries the hero on to the next chunk draws the chunks around the hero where it ends, as a view shown there does', () => {
    // no ground west of the chunk -2: the chunks drawn depend on the chunk the hero is in
    const edge = (cx: number, cy: number): Uint8Array => (cx <= -2 || Math.abs(cy) > 3 ? new Uint8Array() : grass());
    const a = CHUNK - 1;
    const pushed: Played = {
      from: [[a, 0], [a - 1, 0], [a - 2, 0], [a - 3, 0]],
      foes: [[a + 1, 0]],
      push: { troop: [[a + 1, 0], [a, 0], [a - 1, 0], [a - 3, 0]], enemies: [[a + 2, 0]], ejected: [], homes: [], dir: [1, 0] },
    };
    const view = new OpenWorldView(new World(edge));
    view.show([a, 0], [[a - 1, 0], [a - 2, 0], [a - 3, 0]]);
    view.playPush(pushed, 0);
    view.tick(10_000);
    const fresh = new OpenWorldView(new World(edge));
    fresh.show([a + 1, 0], [[a, 0], [a - 1, 0], [a - 3, 0]]);
    const terrain = (v: OpenWorldView) => Object.entries(v.drawn).filter(([name]) => name.startsWith('terrain'));
    expect(terrain(view)).toEqual(terrain(fresh));
  });

  it('nudges the hero toward the cell a blocked step names, and back on its own cell', () => {
    const view = standing();
    const x0 = placeOf(view, 'hero').x;
    view.nudge([0, 0], [1, 0], 0, NUDGE_MS);
    expect(view.tick(NUDGE_MS / 2)).toBe(true);
    expect(placeOf(view, 'hero').x).toBeGreaterThan(x0);
    view.tick(NUDGE_MS);
    expect(placeOf(view, 'hero').x).toBeCloseTo(x0, 9);
    expect(inCell(placeOf(view, 'hero'), [0, 0])).toBe(true);
  });
});

describe('the stripe of the marbles fades with the zoom, and the materials keep it (#1043)', () => {
  it('draws the stripe at full strength up to zoom 2.5, half at 2.75, and none at 3 where the roll stops', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(view.stripeFade).toBe(1);
    zoomed(view, 2.75);
    expect(view.zoom).toBeCloseTo(2.75);
    expect(view.stripeFade).toBeCloseTo(0.5);
    zoomed(view, 3 / 2.75);
    expect(view.stripeFade).toBe(0);
    expect(view.drawnZoom).toBeCloseTo(ROLL_ZOOM);
  });

  it('gives the hero, the troop, the foes and the ejected marble a stripe in their own material, with no swap when the zoom changes', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    const names = ['hero', 'troop', 'enemies'];
    const before = names.map((name) => (view.scene.getObjectByName(name) as THREE.Mesh).material);
    const all = [...before, view.ejected.material];
    for (const material of all) expect((material as THREE.MeshStandardNodeMaterial).colorNode).not.toBeNull();
    expect(new Set(all).size).toBe(4);
    zoomed(view, 2);
    const after = names.map((name) => (view.scene.getObjectByName(name) as THREE.Mesh).material);
    after.forEach((material, i) => expect(material).toBe(before[i]));
  });
});

describe('the marbles wear the skins of the ship (#1176)', () => {
  const skin = (): THREE.MeshStandardMaterial => Object.assign(new THREE.MeshStandardMaterial({ color: 0x445566 }), { map: new THREE.Texture() });
  it('dresses the hero and the troop in the player skin, the foes and the ejected marble in the shell skin, each with its own ring', () => {
    const player = skin();
    const shell = skin();
    const view = new OpenWorldView(new World(grass), new FightState(), { player, shell });
    const of = (m: THREE.Material | THREE.Material[]) => (m as THREE.MeshStandardNodeMaterial);
    const hero = of((view.scene.getObjectByName('hero') as THREE.Mesh).material);
    const troop = of((view.scene.getObjectByName('troop') as THREE.Mesh).material);
    const foes = of((view.scene.getObjectByName('enemies') as THREE.Mesh).material);
    expect([hero.map, troop.map]).toEqual([player.map, player.map]);
    expect([foes.map, of(view.ejected.material).map]).toEqual([shell.map, shell.map]);
    for (const m of [hero, troop, foes]) expect(m.colorNode).not.toBeNull(); // the ring is the one cue of the team
  });

  it('changes the skins of the marbles in place when Settings changes them (#1726)', () => {
    const view = new OpenWorldView(new World(grass), new FightState(), { player: skin(), shell: skin() });
    const of = (name: string) => (view.scene.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardNodeMaterial;
    const before = [of('hero'), of('troop'), of('enemies'), view.ejected.material as THREE.MeshStandardNodeMaterial];
    const versions = before.map((m) => m.version);
    const [player, shell] = [skin(), skin()];
    player.roughness = 0.11;
    shell.color.set(0x112233);
    view.setSkins({ player, shell });
    expect([of('hero'), of('troop'), of('enemies'), view.ejected.material]).toEqual(before); // the same materials, their ring kept
    expect([before[0]!.map, before[1]!.map, before[0]!.roughness]).toEqual([player.map, player.map, 0.11]);
    expect([before[2]!.map, before[3]!.map, before[2]!.color.getHex()]).toEqual([shell.map, shell.map, 0x112233]);
    before.forEach((m, i) => expect(m.version).toBeGreaterThan(versions[i]!)); // compiled again with the new maps
    for (const m of before.slice(0, 3)) expect(m.colorNode).not.toBeNull();
  });

  it('keeps the plain looks of the marbles when no skin is given', () => {
    const view = new OpenWorldView(new World(grass));
    expect(((view.scene.getObjectByName('hero') as THREE.Mesh).material as THREE.MeshStandardNodeMaterial).map).toBeNull();
  });
});

describe('the loaded chunks keep their centre while the hero paces along a chunk line (#1046)', () => {
  const DEG = Math.PI / 180;
  // The farthest ground in view from the hero's cell, as the view draws it (the camera as it stands now).
  const radiusAt = (view: OpenWorldView, cell: Axial): number => {
    const p = axialTo3D(cell[0], cell[1]);
    return groundRadius(view.camera, new THREE.Vector3(p.x, 0, p.z));
  };
  // Whether the square of `reach` chunks around the chunk `centre` covers every cell of the hex ball of `radius` around `hero`.
  const coversBall = (centre: Axial, reach: number, hero: Axial, radius: number): boolean =>
    [0, 1].every((i) => hero[i]! - radius >= (centre[i]! - reach) * CHUNK && hero[i]! + radius < (centre[i]! + reach + 1) * CHUNK);

  it('pacing across a chunk line at the widest zoom rebuilds no chunk: the centre and the grounds are kept', () => {
    const load = vi.fn(() => grass());
    const view = new OpenWorldView(new World(load));
    view.resize(1600, 900);
    view.show([0, 0]);
    zoomed(view, 1e9);
    const loaded = load.mock.calls.length;
    const version = mesh(view, 'terrain-grass').instanceMatrix.version;
    for (let i = 0; i < 10; i++) {
      view.show([-1, 0]); // across the line between the chunks 0 and -1
      view.show([0, 0]);
    }
    for (let i = 0; i < 10; i++) {
      view.show([0, -1]); // and across the line between the chunks 0 and -1 on the other axis
      view.show([0, 0]);
    }
    expect(load).toHaveBeenCalledTimes(loaded);
    expect(view.centreChunk).toEqual([0, 0]);
    expect(view.reach).toBe(MAX_REACH);
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBe(version);
  });

  it('re-centres the square on the hero chunk only when the square no longer covers the hero ball, and keeps it until then', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    let kept = 0;
    let recentred = 0;
    for (let q = 1; q <= 6 * CHUNK; q++) {
      const before = view.centreChunk;
      const hero: Axial = [q, 0];
      view.show(hero);
      const radius = radiusAt(view, hero);
      expect(view.reach).toBe(reachFor(radius));
      if (coversBall(before, reachFor(radius), hero, radius)) {
        kept++;
        expect(view.centreChunk).toEqual(before);
      } else {
        recentred++;
        expect(view.centreChunk).toEqual(chunkOf(hero));
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(recentred).toBeGreaterThan(0);
  });

  it('covers the ground in view with the loaded square at every zoom and turn, while the hero walks past the chunk lines (#976, #1046)', () => {
    const heroes: Axial[] = [[0, 0], [CHUNK - 1, 0], [CHUNK, -1], [CHUNK + 5, -CHUNK], [2 * CHUNK - 1, -CHUNK + 1], [3 * CHUNK, 0]];
    for (const zoom of [1, 4, maxZoomFor(16 / 9)]) {
      for (let deg = 0; deg < 360; deg += 90) {
        const view = new OpenWorldView(new World(grass));
        view.resize(1600, 900);
        view.turnTo(deg * DEG);
        zoomed(view, zoom);
        for (const hero of heroes) {
          view.show(hero);
          const [cq, cr] = view.centreChunk;
          expect(view.reach).toBeLessThanOrEqual(MAX_REACH);
          for (const p of footprint(view.camera)) {
            const [pq, pr] = chunkOf(cellAtPoint(p.x, p.z));
            expect(Math.abs(pq - cq)).toBeLessThanOrEqual(view.reach);
            expect(Math.abs(pr - cr)).toBeLessThanOrEqual(view.reach);
          }
        }
      }
    }
  });

  it('a push that carries the hero out of the loaded square re-centres the chunks on its end cell (#1040, #1046)', () => {
    // the first cell east of the centre chunk that the square no longer covers, at the closest zoom on 16:9
    const probe = new OpenWorldView(new World(grass));
    probe.resize(1600, 900);
    probe.show([0, 0]);
    let edge = 0;
    while (probe.centreChunk[0] === 0) probe.show([++edge, 0]);
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]); // from the probe's start: the camera's height (it follows the tops, #1718) is the probe's, so is the square
    view.show([edge - 1, 0], [[edge - 2, 0]]); // the last cell the square covers
    expect(view.centreChunk).toEqual([0, 0]);
    const played: Played = {
      from: [[edge - 1, 0], [edge - 2, 0]],
      foes: [],
      push: { troop: [[edge, 0], [edge - 1, 0]], enemies: [], ejected: [], homes: [], dir: [1, 0] },
    };
    view.playPush(played, 0);
    view.tick(10_000);
    view.follow(10, false); // the chunks follow the point the camera looks at
    expect(view.centreChunk).toEqual(chunkOf([edge, 0]));
  });
});

describe('the particles of the Open world (#1110)', () => {
  // A grass world whose biome code is `code` (0 meadow, 4 badlands) everywhere in the square -3..3 of chunks.
  const biomeOf = (code: number) => (cx: number, cy: number) => {
    if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, code], i * 3);
    return out;
  };
  const sparks = (view: OpenWorldView) => mesh(view, 'particles');
  /** Runs the particles in frames of 16 ms from `from` to `to` ms and returns the last answer. */
  const run = (view: OpenWorldView, to: number, reduced = false, from = 0): boolean => {
    let live = false;
    for (let t = from; t <= to; t += 16) live = view.sparkle(t, reduced);
    return live;
  };

  it('drifts pollen near the hero in a meadow: some instances are drawn, never past the pool', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.show([0, 0]);
    expect(run(view, 3000)).toBe(true);
    expect(sparks(view).count).toBeGreaterThan(5);
    expect(sparks(view).count).toBeLessThanOrEqual(sparks(view).instanceMatrix.count);
    expect(view.scene.children).toContain(sparks(view));
  });

  it('draws no ambient particle on the low tier, and a step still puffs its dust (#1104)', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.show([0, 0]);
    expect(view.sparkle(0, false, true)).toBe(false);
    expect(sparks(view).count).toBe(0);
    view.puff(100);
    expect(view.sparkle(120, false, true)).toBe(true);
    expect(sparks(view).count).toBe(5);
  });

  it('draws none in the badlands, and none under reduced motion', () => {
    const bad = new OpenWorldView(new World(biomeOf(4)));
    bad.show([0, 0]);
    expect(run(bad, 3000)).toBe(false);
    expect(sparks(bad).count).toBe(0);
    const still = new OpenWorldView(new World(biomeOf(0)));
    still.show([0, 0]);
    expect(run(still, 3000, true)).toBe(false);
    expect(sparks(still).count).toBe(0);
  });

  it('empties the pool past ROLL_ZOOM, and draws once more to erase the last particles', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(run(view, 2000)).toBe(true);
    zoomed(view, MAX_ZOOM);
    expect(view.drawnZoom).toBeGreaterThan(ROLL_ZOOM);
    expect(view.sparkle(2100, false)).toBe(true); // the frame that erases them
    expect(sparks(view).count).toBe(0);
    expect(view.sparkle(2116, false)).toBe(false);
  });

  it('clears the particles at once when reduced motion comes on', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.show([0, 0]);
    run(view, 1000);
    expect(sparks(view).count).toBeGreaterThan(0);
    view.sparkle(1016, true);
    expect(sparks(view).count).toBe(0);
  });

  it('puffs dust under the hero at a step, and not past ROLL_ZOOM', () => {
    const view = new OpenWorldView(new World(biomeOf(4)));
    view.resize(1600, 900);
    view.show([0, 0]);
    view.puff(100);
    expect(view.sparkle(120, false)).toBe(true);
    expect(sparks(view).count).toBe(5);
    expect(run(view, 600, false, 136)).toBe(false); // gone after 350 ms
    expect(sparks(view).count).toBe(0);
    zoomed(view, MAX_ZOOM);
    view.puff(2000);
    expect(view.sparkle(2016, false)).toBe(false);
  });

  describe('the camera offsets (#1103)', () => {
    const PUNCH_QUARTER = 50;
    const lit = (): OpenWorldView => {
      const view = new OpenWorldView(new World(bytes));
      view.resize(800, 600);
      view.show([0, 0]);
      return view;
    };
    const centreOf = (view: OpenWorldView): Axial => (view as unknown as { centre: Axial }).centre;
    const pos = (view: OpenWorldView): number[] => view.camera.position.toArray();

    it('punches the zoom in, then back exactly, and never moves the chunk centre or the reach', () => {
      const view = lit();
      const base = pos(view);
      const reach = view.camera.projectionMatrix.toArray();
      const zoom = view.zoom;
      const centre = centreOf(view);
      view.punch(1000);
      expect(view.offsets(1100)).toBe(true);
      const dist = (p: number[]): number => Math.hypot(p[0]! - view.focusPoint.x, p[1]! - view.focusPoint.y, p[2]! - view.focusPoint.z);
      expect(dist(pos(view))).toBeLessThan(dist(base) * 0.98);
      expect(view.zoom).toBe(zoom);
      expect(centreOf(view)).toEqual(centre);
      expect(view.offsets(1250)).toBe(true); // the frame that puts the base back
      expect(pos(view)).toEqual(base);
      expect(view.camera.projectionMatrix.toArray()).toEqual(reach);
      expect(view.camera.view?.enabled ?? false).toBe(false);
      expect(view.offsets(1266)).toBe(false);
      expect(centreOf(view)).toEqual(centre);
    });

    it('shakes the image by pixels and clears the view offset at the end', () => {
      const view = lit();
      view.shake(0);
      view.offsets(17);
      expect(view.camera.view?.enabled).toBe(true);
      expect(Math.abs(view.camera.view!.offsetX)).toBeGreaterThan(0);
      expect(Math.abs(view.camera.view!.offsetX)).toBeLessThanOrEqual(2);
      view.offsets(300);
      expect(view.camera.view?.enabled).toBe(false);
    });

    it('tells what it draws: the punched zoom, the shake in pixels, the chunk centre', () => {
      const view = lit();
      const rest = view.probe();
      expect(rest.eye).toEqual(view.camera.position.toArray()); // where the camera is (#1333)
      expect(rest.shake).toBe(0);
      expect(rest.zoom).toBe(view.drawnZoom);
      view.punch(0);
      view.shake(0);
      view.offsets(PUNCH_QUARTER);
      const moving = view.probe();
      expect(moving.zoom).toBeLessThan(rest.zoom);
      expect(moving.shake).not.toBe(0);
      expect(moving.centre).toEqual(rest.centre);
      expect(moving.reach).toBe(rest.reach);
    });

    it('draws the camera at a given time first when asked, as a frame at that time would, #1436', () => {
      const view = lit();
      const rest = view.probe();
      view.punch(0);
      expect(view.probe().zoom).toBe(rest.zoom); // no frame ran since the punch: the camera shows the last one
      expect(view.probe(PUNCH_QUARTER).zoom).toBeLessThan(rest.zoom);
      expect(view.probe(1000).zoom).toBe(rest.zoom); // the punch is over: exactly the base
    });

    it('snaps to the base on a resize', () => {
      const view = lit();
      view.shake(0);
      view.offsets(50);
      view.resize(400, 300);
      expect(view.camera.view?.enabled).toBe(false);
      expect(view.offsets(60)).toBe(false);
    });
  });

  // #1147: a boulder on (1, 0) and an isolated tree on (0, 2) of the badlands; the cell is broken in the world first, as the hero does.
  describe('breaking an obstacle', () => {
    const withProps = (cx: number, cy: number) => {
      const out = biomeOf(4)(cx, cy); // the badlands: no pollen in the way of the count
      if (cx === 0 && cy === 0) {
        out.set([1, 5, 4], 1 * 3);
        out.set([1, 6, 4], 2 * CHUNK * 3); // (0, 2): a tree with no tree beside it
      }
      return out;
    };
    const standing = (models = false) => {
      const world = new World(withProps);
      const view = new OpenWorldView(world);
      if (models) view.useModels({ low: {}, high: { boulder: new THREE.BoxGeometry(), tree: new THREE.BoxGeometry() } });
      view.show([0, 0]);
      return { world, view };
    };

    it('takes the prop out of the scene, from the low-poly mesh', () => {
      const { world, view } = standing();
      expect(mesh(view, 'prop-boulder').count).toBe(1);
      world.smash(1, 0);
      view.smash([1, 0], 'boulder', 100, false);
      expect(mesh(view, 'prop-boulder').count).toBe(0);
    });

    it('says whether the prop of a cell is drawn: a boulder or a tree laid, not one broken, none on open ground, none off the laid chunks', () => {
      const { world, view } = standing(true);
      expect(view.hasProp([1, 0], 'boulder')).toBe(true);
      expect(view.hasProp([0, 2], 'tree')).toBe(true);
      expect(view.hasProp([2, 0], 'boulder')).toBe(false); // nothing there
      expect(view.hasProp([1, 0], 'grass')).toBe(false); // open ground has no prop
      expect(view.hasProp([900, 900], 'boulder')).toBe(false); // far from every chunk laid
      world.smash(1, 0);
      view.smash([1, 0], 'boulder', 100, false);
      expect(view.hasProp([1, 0], 'boulder')).toBe(false);
      expect(new OpenWorldView(new World(withProps)).hasProp([1, 0], 'boulder')).toBe(false); // nothing shown yet
    });

    it('takes it out of the detailed mesh near the hero, and a tree too', () => {
      const { world, view } = standing(true);
      expect(mesh(view, 'prop-boulder-hi').count).toBe(1);
      world.smash(1, 0);
      view.smash([1, 0], 'boulder', 100, false);
      expect(mesh(view, 'prop-boulder-hi').count).toBe(0);
      world.smash(0, 2);
      view.smash([0, 2], 'tree', 100, false);
      expect(mesh(view, 'prop-tree-hi').count).toBe(0);
    });

    it('throws shards of its colour that fall away, and only a fade under reduced motion', () => {
      const { world, view } = standing();
      world.smash(1, 0);
      view.smash([1, 0], 'boulder', 100, false);
      expect(view.sparkle(120, false)).toBe(true);
      expect(sparks(view).count).toBe(6);
      expect(run(view, 1200, false, 136)).toBe(false); // gone in under a second
      const still = standing();
      still.world.smash(1, 0);
      still.view.smash([1, 0], 'boulder', 100, true);
      expect(still.view.sparkle(120, true)).toBe(true);
      expect(sparks(still.view).count).toBe(1); // the prop fades in place: reduced motion does not clear it
      expect(run(still.view, 1200, true, 136)).toBe(false);
    });

    it('throws no shards past ROLL_ZOOM', () => {
      const { world, view } = standing();
      view.resize(1600, 900);
      zoomed(view, MAX_ZOOM);
      world.smash(1, 0);
      view.smash([1, 0], 'boulder', 100, false);
      expect(view.sparkle(120, false)).toBe(false);
    });
  });

  it('allocates nothing in a frame: the mesh and its buffers are the same objects', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.show([0, 0]);
    const first = sparks(view);
    const buffer = first.instanceMatrix.array;
    run(view, 2000);
    expect(sparks(view)).toBe(first);
    expect(sparks(view).instanceMatrix.array).toBe(buffer);
  });

  it('frees the particles mesh with the view', () => {
    const view = new OpenWorldView(new World(biomeOf(0)));
    view.show([0, 0]);
    const dispose = vi.spyOn(sparks(view).geometry, 'dispose');
    view.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('the refined look of the Open world (#1138)', () => {
  it('draws every ground with the hex edge material: a dark seam on land, a light line on the water', () => {
    const view = new OpenWorldView(new World(terrain(() => WATER_CODE)));
    for (const ground of GROUNDS) {
      const material = mesh(view, `terrain-${ground}`).material as THREE.MeshStandardNodeMaterial;
      expect(material.isMeshStandardNodeMaterial, ground).toBe(true);
      expect(material.colorNode, ground).not.toBeNull();
      expect(material.map, ground).toBeNull(); // no texture
    }
  });

  it('grades the terrain toward the ship (#1173): low saturation on every ground and biome, the lake without a glow', () => {
    const saturation = (hex: number): number => {
      const [r, g, b] = [hex >> 16, (hex >> 8) & 255, hex & 255].map((v) => v / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    };
    for (const ground of GROUNDS) if (ground !== 'water') expect(saturation(LOOK[ground].color), ground).toBeLessThanOrEqual(0.3);
    for (const biome of BIOMES) expect(saturation(BIOME_LOOK[biome].ground), biome).toBeLessThanOrEqual(0.35);
    expect(saturation(WATER.shore)).toBeLessThanOrEqual(0.4);
    expect(saturation(WATER.deep)).toBeLessThanOrEqual(0.5);
    expect(LOOK.grass.color).toBe(0x446957);
    expect(LOOK.rock.color).toBe(0x4b4f55);
    expect(LOOK.water.emissive).toBe(0x000000); // no glow (#1315)
    expect(WATER).toEqual({ shore: 0x5392a5, deep: 0x2a516e });
    expect(BIOME_LOOK.desert.ground).toBe(0xaa9469);
    expect(BIOME_LOOK.tundra.ground).toBe(0xc4d0d8);
  });

  it('fogs toward the sky of the time of day (the day\'s at the start, #1496) and edges the walls in the one hazard colour, sodium (#1173)', () => {
    const view = new OpenWorldView(new World(bytes));
    expect(view.scene.fog!.color.getHex()).toBe(WORLD_LOOKS.day.sky);
    expect((view.scene.background as THREE.Color).getHex()).toBe(WORLD_LOOKS.day.sky);
    expect(SODIUM).toBe(0xd9822b);
  });

  it('gives the marbles their ring colours: cyan on the hero and the troop, amber on the foes, all glossy', () => {
    expect(MARBLE_LOOK.hero.stripe).toBe(0x6fa8dc);
    expect(MARBLE_LOOK.troop.stripe).toBe(0x6fa8dc);
    expect(MARBLE_LOOK.foes.stripe).toBe(0xffb000);
    const view = new OpenWorldView(new World(bytes));
    for (const [name, look] of [['hero', MARBLE_LOOK.hero], ['troop', MARBLE_LOOK.troop], ['enemies', MARBLE_LOOK.foes]] as const) {
      const material = (view.scene.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(material.color.getHex(), name).toBe(look.base);
      expect(material.roughness, name).toBe(look.roughness);
      expect(look.roughness, name).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('the light budget of the Open world (#849, #1234)', () => {
  it('lights the scene with a hemisphere and a sun, and no more point lights than the budget', () => {
    const view = new OpenWorldView(new World(() => new Uint8Array(CHUNK * CHUNK)));
    let points = 0;
    view.scene.traverse((o) => void ((o as THREE.PointLight).isPointLight && points++));
    expect(points).toBeLessThanOrEqual(OPEN_WORLD_POINT_LIGHTS);
  });
});

describe('the flat tops of the low tier (#1234)', () => {
  const EDGE_RING = 444; // the edge cells of the 7 x 7 chunks of terrain: a neighbour is missing, their sides stay
  // The triangles the ground meshes hold now: an indexed geometry draws its index count, a column 24 triangles, a top 6.
  const triangles = (view: OpenWorldView): number => {
    let sum = 0;
    view.scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (m.isInstancedMesh && m.name.startsWith('terrain-')) sum += m.count * (m.geometry.index!.count / 3);
    });
    return sum;
  };
  const flats = (view: OpenWorldView): number => GROUNDS.reduce((sum, g) => sum + mesh(view, `terrain-${g}-flat`).count, 0);
  const lowView = (load: (cx: number, cy: number) => Uint8Array): OpenWorldView => {
    const view = new OpenWorldView(new World(load));
    view.resize(1600, 900);
    view.useFlatTops(true);
    return view;
  };

  it('holds a flat top in 7 vertices, a centre and 6 corners, on the plane of its column top: a software renderer pays each vertex of each instance', () => {
    const view = lowView(stepped(new Map(), 1, 4));
    view.show([0, 0]);
    const top = mesh(view, 'terrain-grass-flat').geometry;
    expect(top.attributes.position!.count).toBe(7);
    expect(top.attributes.normal!.count).toBe(7);
    expect(top.index!.count).toBe(18);
    for (let i = 0; i < 7; i++) {
      expect(top.attributes.normal!.getY(i)).toBeCloseTo(1);
      expect(top.attributes.position!.getY(i)).toBeCloseTo(0.5);
    }
  });

  it('draws a cell no neighbour lies below as its top alone, and the other cells as columns', () => {
    const view = lowView(stepped(new Map([['0,0', 3]]), 1, 4));
    view.show([0, 0]);
    const cells = 49 * CHUNK * CHUNK;
    expect(ground(view)).toBe(1); // the raised cell has six lower neighbours: its sides show
    expect(flats(view)).toBe(cells - 1); // the ring round it is not above any neighbour, the rest is flat
    expect(triangles(view)).toBe(24 + 6 * (cells - 1));
  });

  it('keeps the low tier flat: no hex lift, so the flat tops keep their cells and triangles, and the high tier lifts again (#1418)', () => {
    const view = lowView(stepped(new Map(), 1, 4));
    expect(hexLift(3, 4)).toBe(0);
    expect(topOf('grass', 1, 3, 4)).toBeCloseTo(0.2 + STEP);
    view.show([0, 0]);
    expect(hexLift(3, 4)).toBe(0);
    view.useFlatTops(false);
    expect(hexLift(3, 4)).toBeGreaterThan(0);
    view.useFlatTops(true);
    new OpenWorldView(new World(bytes));
    expect(hexLift(3, 4)).toBeGreaterThan(0); // a new view starts lifted
  });

  it('keeps the sides of a land cell next to water, water being lower than land', () => {
    const view = lowView(terrain((q, r) => (q === 0 && r === 0 ? GRASS_CODE : WATER_CODE)));
    view.show([0, 0]);
    expect(mesh(view, 'terrain-grass').count).toBe(1);
    expect(mesh(view, 'terrain-water-flat').count).toBeGreaterThan(0);
    expect(mesh(view, 'terrain-water').count).toBe(EDGE_RING);
  });

  it('draws full columns on the high tier, as before', () => {
    const view = new OpenWorldView(new World(stepped(new Map(), 1, 4)));
    view.resize(1600, 900);
    view.show([0, 0]);
    expect(flats(view)).toBe(0);
    expect(ground(view)).toBe(49 * CHUNK * CHUNK);
  });

  it('draws the world again as columns when the flat tops are switched off', () => {
    const view = lowView(stepped(new Map(), 1, 4));
    view.show([0, 0]);
    view.useFlatTops(false);
    view.show([0, 0]);
    expect(flats(view)).toBe(0);
    expect(ground(view)).toBe(49 * CHUNK * CHUNK);
  });

  it('still knows the lake when every cell is a flat top', () => {
    const wet = lowView(terrain(() => WATER_CODE));
    wet.show([0, 0]);
    expect(mesh(wet, 'terrain-water').count).toBe(EDGE_RING);
    expect(wet.hasWater).toBe(true);
  });

  it('draws sand as flat tops when no sand cell has a lower neighbour', () => {
    const sand = lowView(terrain(() => 1));
    sand.show([0, 0]);
    expect(mesh(sand, 'terrain-sand').count).toBe(EDGE_RING);
    expect(mesh(sand, 'terrain-sand-flat').count).toBeGreaterThan(0);
  });

  it('keeps the sides of a cell at the edge of the world, where the neighbour is missing', () => {
    const view = lowView((cx, cy) => (cx === 0 && cy === 0 ? grass() : new Uint8Array()));
    view.show([0, 0]);
    expect(ground(view)).toBeGreaterThan(0);
    expect(flats(view)).toBeGreaterThan(0);
  });
});

describe('the camera follows the hero butter-smooth, on the frame clock (#1333)', () => {
  /** The frame times of a busy page, in ms: 21, 13 and 16.7 in turn. */
  const DTS = [21, 13, 16.7];

  /** The worst change of the camera's acceleration from a frame to the next, in units per second cubed: 0 for a camera whose
   * speed changes smoothly, large for a step in its speed (a snap, a hard start) or its acceleration. */
  const jerk = (eyes: THREE.Vector3[], ts: number[]): number => {
    const velocity = (i: number) => eyes[i]!.clone().sub(eyes[i - 1]!).divideScalar((ts[i]! - ts[i - 1]!) / 1000);
    const acceleration = (i: number) => velocity(i).sub(velocity(i - 1)).divideScalar((ts[i]! - ts[i - 2]!) / 2000);
    let worst = 0;
    for (let i = 3; i < eyes.length; i++) worst = Math.max(worst, acceleration(i).sub(acceleration(i - 1)).length() / ((ts[i]! - ts[i - 1]!) / 1000));
    return worst;
  };

  /** Runs `count` frames of the view from `t` ms, as the mode does: `before(now)` (the steps), the follow, the marbles; returns the
   * camera's place and the time of each frame. */
  const run = (view: OpenWorldView, count: number, before: (now: number) => void = () => {}, instant = false, t = 0) => {
    const eyes = [view.camera.position.clone()];
    const ts = [t];
    for (let i = 0; i < count; i++) {
      const dt = DTS[i % DTS.length]!;
      t += dt;
      before(t);
      view.follow(dt / 1000, instant);
      view.tick(t);
      eyes.push(view.camera.position.clone());
      ts.push(t);
    }
    return { eyes, ts };
  };

  it('follows a walk that speeds up to the cruise pace with no step: the camera keeps a small jerk while the hero speed jumps', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    // the steps of a held walk (#1290): from rest, then at 140, 125, 110, 95 and 80 ms a step, end to end
    const spans = [140, 140, 125, 110, 95, 80, 80, 80, 80];
    let due = 5;
    let cell = 0;
    const { eyes, ts } = run(view, 80, (now) => {
      while (cell < spans.length && now >= due) {
        const span = spans[cell]!;
        cell++;
        view.show([cell, 0], [], { now: due, span, pace: cell === 1 ? 'start' : 'walk' });
        due += span;
      }
    });
    expect(cell).toBe(spans.length);
    expect(jerk(eyes, ts)).toBeLessThan(10_000); // about 50 000 when the camera was on the hero itself
    expect(view.focusPoint.x).toBeCloseTo(axialTo3D(spans.length, 0).x, 2); // it lands on the hero once the walk is over
  });

  it('starts from rest on a tap, whose glide starts at full speed: the first frame barely moves', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    const start = view.camera.position.clone();
    const { eyes, ts } = run(view, 40, (now) => now === 21 && view.show([1, 0], [], { now: 0, span: GLIDE_MS, pace: 'tap' }));
    expect(eyes[2]!.distanceTo(start)).toBeLessThan(0.05 * axialTo3D(1, 0).x); // the hero is a third of a cell on
    expect(jerk(eyes, ts)).toBeLessThan(10_000);
  });

  it('eases the zoom from rest to its goal and lands on it exactly; reduced motion lands at once', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    view.zoomBy(2);
    expect(view.zoom).toBe(2); // the goal, at once
    const { eyes, ts } = run(view, 60);
    expect(eyes[1]!.distanceTo(eyes[0]!)).toBeLessThan(0.05 * 18); // the camera goes back 18 units, all at once before #1333
    expect(jerk(eyes, ts)).toBeLessThan(50_000);
    expect(view.drawnZoom).toBe(2);
    expect(view.follow(0.016, false)).toBe(false); // settled
    view.zoomBy(0.5);
    expect(view.follow(0.016, true)).toBe(true);
    expect(view.drawnZoom).toBe(1);
  });

  it('turns 60 degrees from rest and lands on the yaw exactly; reduced motion lands at once', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    const angle = () => Math.atan2(view.camera.position.x - view.focusPoint.x, view.camera.position.z - view.focusPoint.z);
    view.turn(Math.PI / 3);
    const { eyes, ts } = run(view, 60);
    expect(eyes[1]!.distanceTo(eyes[0]!)).toBeLessThan(0.05 * 11); // the arc is 11 units: 1.8 on the first frame with the ease of #1026
    expect(jerk(eyes, ts)).toBeLessThan(50_000);
    expect(angle()).toBeCloseTo(Math.PI / 3, 9);
    expect(view.follow(0.016, false)).toBe(false); // settled
    view.turn(-Math.PI / 3);
    expect(view.follow(0.016, true)).toBe(true);
    expect(angle()).toBeCloseTo(0, 9);
  });

  it('a turn the long way round goes the short way: from 170 degrees to -170 it turns 20 degrees, through 180', () => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.show([0, 0]);
    const DEG = Math.PI / 180;
    view.turnTo(170 * DEG);
    view.turn(20 * DEG);
    const angles: number[] = [];
    run(view, 60, () => angles.push(Math.abs(Math.atan2(view.camera.position.x - view.focusPoint.x, view.camera.position.z - view.focusPoint.z))));
    expect(Math.min(...angles)).toBeGreaterThan(169 * DEG);
    expect(view.yaw).toBeCloseTo(-170 * DEG, 9);
  });
});

describe('the ground in view only, on a software renderer (#1483)', () => {
  // Software WebGL pays about 7 microseconds for each instance it draws, in view or not, and 15 in 16 of the loaded ground lies out of view.
  const CELLS = 49 * CHUNK * CHUNK;
  const laid = (view: OpenWorldView): Set<string> => {
    const out = new Set<string>();
    view.scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh || !m.name.startsWith('terrain-')) return;
      for (let i = 0; i < m.count; i++) out.add(`${Math.round(m.instanceMatrix.array[i * 16 + 12]! * 100)},${Math.round(m.instanceMatrix.array[i * 16 + 14]! * 100)}`);
    });
    return out;
  };
  // Every cell of the 7 x 7 chunks around `centre` whose middle lies on the screen is laid: the number of them, or -1 when one is not.
  const onScreenAreLaid = (view: OpenWorldView, centre: Axial): number => {
    const have = laid(view);
    view.camera.updateMatrixWorld();
    const point = new THREE.Vector3();
    let seen = 0;
    for (let q = (centre[0] - 3) * CHUNK; q < (centre[0] + 4) * CHUNK; q++) {
      for (let r = (centre[1] - 3) * CHUNK; r < (centre[1] + 4) * CHUNK; r++) {
        const p = axialTo3D(q, r);
        point.set(p.x, 0, p.z).project(view.camera);
        if (Math.abs(point.x) > 1.02 || Math.abs(point.y) > 1.02 || point.z > 1) continue;
        seen++;
        if (!have.has(`${Math.round(p.x * 100)},${Math.round(p.z * 100)}`)) return -1;
      }
    }
    return seen;
  };
  const cullView = (): OpenWorldView => {
    const view = new OpenWorldView(new World(grass));
    view.resize(1600, 900);
    view.cullGround(true);
    return view;
  };

  it('lays the ground of the screen and a margin only, a fifth of the loaded chunks at most, and a view that does not ask for it lays them whole', () => {
    const whole = new OpenWorldView(new World(grass));
    whole.resize(1600, 900);
    whole.show([0, 0]);
    expect(laid(whole).size).toBe(CELLS);
    const view = cullView();
    view.show([0, 0]);
    expect(laid(view).size).toBeLessThan(CELLS / 5);
    expect(onScreenAreLaid(view, [0, 0])).toBeGreaterThan(500);
    expect(mesh(view, 'terrain-grass').instanceMatrix.count).toBeLessThan(3000); // not the 66 000 columns the chunks may bring: 18 MB of buffers a build uploads
    expect(mesh(view, 'prop-mountain').instanceMatrix.count).toBeLessThan(3000);
    expect(mesh(whole, 'terrain-grass').instanceMatrix.count).toBeGreaterThan(3000);
  });

  it('lays every column that shows on the screen, its top or its foot, on tall ground, at the closest and the widest zoom and at every turn', () => {
    const tall = (cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([(i * 7 + cx * 3 + cy * 5) % 11, 2, 0], i * 3); // grass, heights 0 to 10: tops up to 5.2
      return out;
    };
    const world = new World(tall);
    const shows = (view: OpenWorldView): number => {
      const have = laid(view);
      view.camera.updateMatrixWorld();
      const point = new THREE.Vector3();
      let missing = 0;
      for (let q = -3 * CHUNK; q < 4 * CHUNK; q++) {
        for (let r = -3 * CHUNK; r < 4 * CHUNK; r++) {
          const p = axialTo3D(q, r);
          const top = topOf('grass', world.tile(q, r)!.height, q, r);
          const corners = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((k) => [0.56 * Math.sin((k * Math.PI) / 3), 0.56 * Math.cos((k * Math.PI) / 3)])];
          const inView = corners.some(([dx, dz]) => [0, top].some((y) => {
            point.set(p.x + dx!, y, p.z + dz!).project(view.camera);
            return Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z <= 1;
          }));
          if (inView && !have.has(`${Math.round(p.x * 100)},${Math.round(p.z * 100)}`)) missing++;
        }
      }
      return missing;
    };
    for (const [width, height] of [[1600, 900], [900, 1600], [1200, 500]] as const) {
      const view = new OpenWorldView(world);
      view.resize(width, height);
      view.cullGround(true);
      view.show([0, 0]);
      for (const scale of [1, 4]) {
        zoomed(view, scale);
        for (let deg = 0; deg < 360; deg += 30) {
          view.turnTo((deg * Math.PI) / 180);
          expect(shows(view), `${width}x${height} zoom ${scale} turn ${deg}`).toBe(0);
        }
      }
    }
  });

  it('lays the ground again when the hero walks, the camera turns or the zoom moves, so what the screen shows is always laid', () => {
    const view = cullView();
    view.show([0, 0]);
    view.show([20, 6]);
    view.follow(0, true);
    expect(onScreenAreLaid(view, chunkOf([20, 6]))).toBeGreaterThan(500);
    view.turnTo(Math.PI / 2);
    expect(onScreenAreLaid(view, chunkOf([20, 6]))).toBeGreaterThan(500);
    zoomed(view, 1.5);
    expect(onScreenAreLaid(view, chunkOf([20, 6]))).toBeGreaterThan(500);
  });

  it('keeps the laid ground while the screen moves less than the margin', () => {
    const view = cullView();
    view.show([0, 0]);
    const version = mesh(view, 'terrain-grass').instanceMatrix.version;
    view.follow(0.001, false);
    expect(mesh(view, 'terrain-grass').instanceMatrix.version).toBe(version);
  });

  it('lays the whole chunks again when it is switched off', () => {
    const view = cullView();
    view.show([0, 0]);
    view.cullGround(false);
    view.cullGround(false);
    view.show([0, 0]);
    expect(laid(view).size).toBe(CELLS);
  });
});

describe('the wandering marbles are rolled to their next cell (#1511)', () => {
  const SQUARE = (cx: number, cy: number): Uint8Array => (Math.abs(cx) > 3 || Math.abs(cy) > 3 ? new Uint8Array() : grass());
  const group = (cx: number, cy: number): Int32Array => (cx === 0 && cy === 0 ? Int32Array.of(5, 5, 6, 5) : new Int32Array());
  const foe = (view: OpenWorldView, index = 0): THREE.Vector3 => {
    const m = new THREE.Matrix4();
    (view.scene.getObjectByName('enemies') as THREE.InstancedMesh).getMatrixAt(index, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const standing = (): { view: OpenWorldView; fight: FightState } => {
    const fight = new FightState();
    const view = new OpenWorldView(new World(SQUARE, group), fight);
    view.show([0, 0]);
    view.updateEnemies();
    return { view, fight };
  };
  afterEach(() => vi.restoreAllMocks());

  it('lays the marbles on the cells the clock gives and rolls each from its old cell, over the glide', () => {
    const { view, fight } = standing();
    fight.apply([[5, 5], [6, 5]], [[5, 6], [6, 6]], []); // the group steps one cell
    view.wander(1000, false);
    expect(view.animating).toBe(true);
    view.tick(1000);
    expect(foe(view).x).toBeCloseTo(axialTo3D(5, 5).x, 5); // still on the old cell at the start
    view.tick(1000 + WANDER_GLIDE_MS / 2);
    expect(foe(view).z).toBeGreaterThan(axialTo3D(5, 5).z);
    expect(foe(view).z).toBeLessThan(axialTo3D(5, 6).z);
    view.tick(1000 + WANDER_GLIDE_MS);
    view.tick(1000 + WANDER_GLIDE_MS + 1);
    expect(foe(view).z).toBeCloseTo(axialTo3D(5, 6).z, 5);
    expect(view.animating).toBe(false);
  });

  it('jumps under reduced motion, when nothing moved, and when the marbles are not the same ones', () => {
    const { view, fight } = standing();
    fight.apply([[5, 5], [6, 5]], [[5, 6], [6, 6]], []);
    view.wander(1000, true);
    expect(view.animating).toBe(false);
    expect(foe(view).z).toBeCloseTo(axialTo3D(5, 6).z, 5);
    view.wander(2000, false); // nothing moved since
    expect(view.animating).toBe(false);
    fight.apply([[5, 6]], [], [[5, 6]]); // one marble gone: the list is another one
    view.wander(3000, false);
    expect(view.animating).toBe(false);
  });

  it('keeps a push being drawn going, and the glide slowed by the page', () => {
    const { view, fight } = standing();
    const push: Played = { from: [[1, 0]], foes: [[5, 5]], push: { troop: [[2, 0]], enemies: [[5, 5]], ejected: [], homes: [], dir: [1, 0] } };
    view.playPush(push, 0);
    const end = view.animating;
    fight.apply([[5, 5], [6, 5]], [[5, 6], [6, 6]], []);
    view.wander(100, false, 2);
    expect(end).toBe(true);
    view.tick(100 + WANDER_GLIDE_MS); // twice the time: half way
    expect(foe(view).z).toBeLessThan(axialTo3D(5, 6).z);
    expect(view.animating).toBe(true);
  });
});
