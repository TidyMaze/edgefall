// Table Zero, the terrace (#1314): the 1v1 arena of the approved Blender design. Palette, light and activation live here; the
// meshes come from the glTF of `3d-artist` (public/assets/pbr/arena.glb), never rebuilt in code. Art direction: art2/notes-round4.md.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fitView, type View } from './camera';
import { SUN } from './sun';
import { NEON_HIDDEN, NEON_CELL_SCALE, neonVoidGeometry, neonVoidMaterial, neonEdgeGeometry, neonGlow, neonEdgeMaterial, neonMaterial, neonPaint } from './neonlook';

/** The palette the port must match (notes-round4.md). */
export const PALETTE = {
  dish: 0xb4aa81,
  pedestalTop: 0xc9bf9c,
  pedestalSide: 0x8d845f,
  gap: 0x2c3438,
  rim: 0x4b4f55,
  plateau: 0x6a7077,
  cyan: 0x7fd6e8, // the turn bar
  sodium: 0xd9822b, // the last move's edge
  bone: 0xd8d4c8,
  whiteMarble: 0xd4cdb9,
  whiteUnderside: 0x9db8c4,
  /** The soft tone clamp of a white marble's brightest pixel (notes-batchA2.md). */
  whiteClamp: 0xe8e4d6,
  ridges: [0x2c5a63, 0x4a7480, 0x7f9fac],
} as const;

/** AgX, the Blender render's own view transform, at the exposure that lands the dish near #b6ab82 and the gap on #2d3539. */
export const TERRACE_EXPOSURE = 1.5;

export { SUN }; // its data lives in sun.ts, free of three.js (#1498)

/** The direction from the board to the sun, a unit vector written into `out`: x is left of the axis, the camera looks from +z at yaw 0. The Open
 * world's time of day and the lair boards move the sun (`elevation` and `azimuth` in degrees, #1496). */
export function sunDirection(out: THREE.Vector3, elevation: number = SUN.elevation, azimuth: number = SUN.azimuth): THREE.Vector3 {
  const [el, az] = [(elevation * Math.PI) / 180, (azimuth * Math.PI) / 180];
  return out.set(-Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** The sun's position on a sphere of `distance` round the board. */
export function sunPosition(distance = 30, elevation: number = SUN.elevation, azimuth: number = SUN.azimuth): [number, number, number] {
  const v = sunDirection(new THREE.Vector3(), elevation, azimuth).multiplyScalar(distance);
  return [v.x, v.y, v.z];
}

/**
 * The sun's soft shadow (#1364), the render's: a 2048 map over the board and two rings round it (7 cells each way: the far ring and the ridges stay unshaded), very soft and light (the art director's values).
 * The posts, the walls, the plinth and its steps cast it, not the marbles (their pedestal is their contact); the baked ambient occlusion of the vertex colours stays under it.
 */
export const SUN_SHADOW = { size: 1024, extent: 7, near: 1, far: 90, bias: -0.0005, normalBias: 0.04, radius: 9, blurSamples: 8, intensity: 0.85 } as const;

/** Sets the sun's shadow camera and map, on or off (the low tier draws none). */
export function aimSunShadow(sun: THREE.DirectionalLight, on: boolean, reach: number = SUN_SHADOW.extent): void {
  sun.castShadow = on;
  if (!on) return;
  const { size, near, far, bias, normalBias, radius, blurSamples, intensity } = SUN_SHADOW;
  const extent = reach;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near, far });
  sun.shadow.camera.updateProjectionMatrix();
  Object.assign(sun.shadow, { bias, normalBias, radius, blurSamples, intensity });
}

/** Adds the sun and the hemisphere to `group`; both are returned. */
export function addSun(group: THREE.Object3D): [THREE.HemisphereLight, THREE.DirectionalLight] {
  const hemisphere = new THREE.HemisphereLight(SUN.sky, SUN.ground, SUN.hemisphere);
  const sun = new THREE.DirectionalLight(SUN.colour, SUN.intensity);
  sun.position.set(...sunPosition());
  group.add(hemisphere, sun);
  return [hemisphere, sun];
}

/**
 * Every mode is on the terrace (#1374): the room is left for the automated tests, which ask for it with `?scene=room`
 * (`room`, main.ts honours it under `navigator.webdriver` only). Before the arena file is in, or when it failed (`ready`),
 * the board is drawn on a plain background, never in the room.
 */
export function tableZeroActive(s: { room: boolean; ready: boolean }): boolean {
  return s.ready && !s.room;
}

/** What the game draws itself, from its own state: marbles, pedestals, rings and arrows are left out of the arena file. */
const GAME_DRAWN = /^scene_(marble|pedestal|ring|arrow|shadow|row21_lockbar|royale_crack|hub_(prop|ring|shadow|terminal))/; // the lock bar and the royale's cracks follow the game's state; the hub's props stand where its rooms are (hubKit)
/** The turn bars stay meshes of their own: the game lights the one of the side to move. */
const TURN_BAR = /^scene_turnbar/;
/** The dishes: drawn as one instanced mesh, so a cell that vanishes (Hull, Rail Yard) is a hole to the gap and not a dish floating in the air. */
const DISH = /^scene_(cell|ballast_cell|dual_cell|dual_cell_n|hub_cell|royale_cell)_?\d+$/;
/** What a bigger board replaces in the arena file (#1374): the slab, its plinth shadow, the posts. They are drawn apart so a variant board can hide them. */
const BOARD_PART = /^scene_(slab_arena|ao_plinth|post_\d+)$/;
const SLAB = /^scene_(slab_arena|ballast_slab|dual_slab_[ns])$/;

const unlit = new Map<boolean, THREE.MeshBasicMaterial>();
const WHITE = new THREE.Color(1, 1, 1);
/** The lit materials already multiplied by TERRACE_TINT: a material is shared by every mesh of its file, whoever draws it first. */
const tinted = new WeakSet<THREE.Material>();
/**
 * The unlit materials of the file (sky, lamps, bars, haze, shadow): Blender emits their colour from COLOR_0, glTF gives them a white
 * emissive factor over a black base, so three would draw them white. The loader also folds them into one material (they differ by
 * name only), so what tells them apart is the geometry: a mesh with a vertex below full alpha is blended, any other is solid.
 */
export function terraceMaterial(material: THREE.Material, geometry: THREE.BufferGeometry): THREE.Material {
  if ((material as THREE.MeshStandardMaterial).emissive?.getHex() !== 0xffffff) return material;
  const colour = geometry.attributes.color;
  let blended = false;
  for (let i = 0; colour && colour.itemSize === 4 && i < colour.count && !blended; i++) blended = colour.getW(i) < 0.999;
  if (!unlit.has(blended)) unlit.set(blended, new THREE.MeshBasicMaterial({ name: blended ? 'terrace_blended' : 'terrace_solid', vertexColors: true, fog: false, side: THREE.DoubleSide, transparent: blended, color: new THREE.Color().setScalar(1 / TERRACE_EXPOSURE) }));
  // the exposure lights the lit meshes up; an unlit colour is the render's own, so it is scaled back down by it
  return unlit.get(blended)!;
}

/**
 * The arena file has 1,489 nodes: drawn as they are, that is 1,000 calls. This bakes every static node into the world, then
 * draws one mesh per material (5 calls), the turn bars apart. Blended materials draw last and write no depth.
 */
export function mergeByMaterial(root: THREE.Object3D, split = false, neon = false): THREE.Group {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const ofBoard = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const bars: THREE.Mesh[] = [];
  const dishes: THREE.Mesh[] = [];
  const posts: THREE.Vector3[] = [];
  let arenaSlab = false;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || GAME_DRAWN.test(o.name) || (neon && NEON_HIDDEN.test(o.name))) return;
    if (neon && /^scene_post_?\d+$/.test(o.name)) posts.push(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld));
    if (neon && o.name === 'scene_slab_arena') arenaSlab = true;
    if (TURN_BAR.test(o.name)) return void bars.push(mesh);
    if (DISH.test(o.name)) return void dishes.push(mesh);
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    g.deleteAttribute('uv');
    if (neon) neonPaint(o.name, g);
    if (o.name === 'scene_sky_dome') {
      saturateColours(g, SKY_SATURATION, -Infinity, ZENITH_FROM); // the horizon band
      saturateColours(g, ZENITH_SATURATION, ZENITH_FROM, Infinity); // the zenith
    }
    if (SLAB.test(o.name) && !neon) saturateColours(g, RIM_SATURATION); // the rim and the plinth read brown against Blender's grey-taupe
    const lit = (mesh.material as THREE.MeshStandardMaterial).emissive?.getHex() !== 0xffffff; // the file's unlit sky, haze and shadows keep their own material
    const material = neon && lit ? neonMaterial(o.name) : terraceMaterial(mesh.material as THREE.Material, mesh.geometry);
    const into = split && BOARD_PART.test(o.name) ? ofBoard : byMaterial;
    into.set(material, [...(into.get(material) ?? []), g]);
  });
  const bake = (into: THREE.Group, groups: Map<THREE.Material, THREE.BufferGeometry[]>): void => {
    for (const [material, geometries] of groups) {
      const blended = material.transparent;
      if (blended) material.depthWrite = false;
      else if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial && !tinted.has(material) && !neon) (material as THREE.MeshStandardMaterial).color.multiply(TERRACE_TINT);
      tinted.add(material);
      const merged = new THREE.Mesh(mergeGeometries(geometries, false), material);
      merged.frustumCulled = false; // the arena is always in view
      merged.castShadow = merged.receiveShadow = (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true; // the lit board: posts, plinth and plateau shade each other (#1364)
      merged.renderOrder = blended ? 1 : 0;
      into.add(merged);
    }
  };
  const out = new THREE.Group();
  bake(out, byMaterial);
  // With `split`, what a bigger board replaces (slab, plinth shadow, posts, dishes, turn bars) is a group of its own.
  const board = split ? Object.assign(new THREE.Group(), { name: 'terrace_board' }) : out;
  if (split) {
    bake(board, ofBoard);
    out.add(board);
  }
  if (dishes.length) {
    const first = dishes[0]!;
    const material = neon ? neonMaterial('dish') : terraceMaterial(first.material as THREE.Material, first.geometry);
    const matrices = dishes.map((d) => (neon ? d.matrixWorld.clone().scale(new THREE.Vector3(NEON_CELL_SCALE, 1, NEON_CELL_SCALE)) : d.matrixWorld.clone()));
    const geometry = neon ? first.geometry.clone() : first.geometry;
    if (neon) neonPaint(first.name, geometry); // the dish takes the slate, its edge the cyan line in the gap
    const mesh = new THREE.InstancedMesh(geometry, material, dishes.length);
    // The cell edges: the neon look's cyan lines, or in the others a ring in the gap that stays hidden until a lair fight at night lights it (#1496).
    const edges = new THREE.InstancedMesh(neon ? neonEdgeGeometry() : neonEdgeGeometry(0.52, 0.555), neon ? neonEdgeMaterial() : new THREE.MeshBasicMaterial({ name: 'terrace_edge', fog: false, side: THREE.DoubleSide }), dishes.length);
    Object.assign(edges, { frustumCulled: false, name: 'terrace_edges', visible: neon });
    const voids = neon ? Object.assign(new THREE.InstancedMesh(neonVoidGeometry(), neonVoidMaterial(), dishes.length), { frustumCulled: false, name: 'terrace_voids' }) : null; // a pale outline where a cell is gone
    mesh.frustumCulled = false;
    mesh.name = 'terrace_dishes';
    if (!neon) for (let i = 0; i < dishes.length; i++) mesh.setColorAt(i, WHITE); // an instance colour for a look to tint the cell tops by, without a new shader later (#1496)
    mesh.castShadow = mesh.receiveShadow = true; // the lit board (#1364)
    const spot = new THREE.Vector3();
    mesh.userData.show = (shown: (x: number, z: number) => boolean): void => {
      let n = 0;
      let gone = 0;
      for (const m of matrices) {
        if (!shown(...(spot.setFromMatrixPosition(m).toArray().filter((_, i) => i !== 1) as [number, number]))) {
          voids?.setMatrixAt(gone++, m);
          continue;
        }
        edges.setMatrixAt(n, m);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (voids) {
        voids.count = gone;
        voids.instanceMatrix.needsUpdate = true;
      }
      edges.count = n;
      edges.instanceMatrix.needsUpdate = true;
    };
    mesh.userData.show(() => true);
    board.add(mesh);
    board.add(edges);
    if (voids) board.add(voids);
  }
  for (const bar of bars) {
    if (neon) bar.geometry = bar.geometry.clone();
    if (neon) neonPaint(bar.name, bar.geometry);
    bar.material = neon ? neonMaterial(bar.name) : terraceMaterial(bar.material as THREE.Material, bar.geometry);
    bar.matrix.copy(bar.matrixWorld).decompose(bar.position, bar.quaternion, bar.scale);
    board.add(bar);
  }
  if (neon && (posts.length || arenaSlab)) board.add(neonGlow(posts, arenaSlab)); // the violet channel of the rim and the posts' glow
  return out;
}

/**
 * The Blender camera (lights_camera.json, `scene_camera_main`): pitch 50 over the horizon (40 from the vertical), 13.6 away for a
 * board of radius 4, fov 40 as the game's. The hub and the royale are framed from it (#1374).
 */
export const BLENDER_VIEW: View = { azimuth: 0, polar: (40 * Math.PI) / 180, distance: 13.6 };

/** The corners of each cell of a board (a pointy hex of circumradius a half, the file's dish), at each of `heights`, in the world. */
export function boardPoints(cells: readonly (readonly [number, number])[], scale = 1, heights: readonly number[] = [0]): { x: number; y: number; z: number }[] {
  const corners = Array.from({ length: 6 }, (_, k) => [Math.sin((k * Math.PI) / 3) * 0.5, Math.cos((k * Math.PI) / 3) * 0.5] as const);
  return cells.flatMap(([q, r]) =>
    heights.flatMap((y) => corners.map(([dx, dz]) => ({ x: scale * (q + r / 2 + dx), y, z: scale * ((Math.sqrt(3) / 2) * r + dz) }))),
  );
}

/** The Blender camera for a board of `radius` (a radius 4 board is at 13.6), drawn back until `points` are on the window: the play area is never cropped. */
export function fitTerrace(points: readonly { x: number; y: number; z: number }[], radius: number, width: number, height: number, bottom = 0, max?: number): View {
  return fitView({ ...BLENDER_VIEW, distance: (BLENDER_VIEW.distance * radius) / 4 }, points, width, height, bottom, max);
}

/** The props of the hub deck (scene_hub_deck.glb): per kind of prop its ring, the prop and its shadow, each placed relative to the prop; and the bar of a locked lift. */
export interface HubKit {
  parts: Record<string, THREE.Mesh[]>;
  lockbar: THREE.Mesh | null;
}

/** The Hub file's staircase (#1526): its stepped pier, a bar of steps that leads nowhere. Taken out of the Hub's scene, no other node. */
export function withoutHubStaircase(root: THREE.Object3D): THREE.Object3D {
  root.getObjectByName('scene_hub_pier')?.removeFromParent();
  return root;
}

/**
 * The hub file's props, not merged into its board: the game puts one on each room of its deck, whichever cell the file drew it on.
 * A part is a mesh with the file's material (unlit ones as the terrace draws them), placed relative to its prop; the shadow is blended.
 */
export function hubKit(root: THREE.Object3D): HubKit {
  root.updateMatrixWorld(true);
  const found = new Map<string, Record<string, THREE.Mesh>>();
  let lockbar: THREE.Mesh | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const [, part, kind] = /^scene_hub_(prop|ring|shadow)_(\w+)$/.exec(o.name) ?? [];
    if (part) found.set(kind!, { ...found.get(kind!), [part]: mesh });
    else if (o.name === 'scene_row21_lockbar') lockbar = mesh;
  });
  const put = (mesh: THREE.Mesh, prop: THREE.Mesh): THREE.Mesh => {
    const part = mesh.clone();
    part.material = terraceMaterial(mesh.material as THREE.Material, mesh.geometry);
    const lit = (part.material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
    if (lit && !tinted.has(part.material)) (part.material as THREE.MeshStandardMaterial).color.multiply(TERRACE_TINT);
    tinted.add(part.material);
    part.position.setFromMatrixPosition(mesh.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(prop.matrixWorld));
    part.castShadow = part.receiveShadow = lit;
    part.renderOrder = part.material.transparent ? 1 : 0;
    if (part.material.transparent) part.material.depthWrite = false;
    return part;
  };
  const parts: Record<string, THREE.Mesh[]> = {};
  for (const [kind, { prop, ring, shadow }] of found) if (prop) parts[kind] = [prop, ring, shadow].filter((m): m is THREE.Mesh => Boolean(m)).map((m) => put(m, prop));
  const lift = found.get('lift')?.prop;
  return { parts, lockbar: lockbar && lift ? put(lockbar, lift) : null };
}

/** The terrace's default camera, the Blender brief's: pitch 57 (33 from the vertical), 13.6 away, fov 40 as the game's. */
export const TERRACE_VIEW = { azimuth: 0, polar: (33 * Math.PI) / 180, distance: 13.6 } as const;

/** Whether a view is the game's default one, which the terrace replaces by its own and nothing else. */
export function isDefaultView(v: { azimuth: number; polar: number; distance: number }, reset: { azimuth: number; polar: number; distance: number }): boolean {
  return v.azimuth === reset.azimuth && Math.abs(v.polar - reset.polar) < 1e-6 && Math.abs(v.distance - reset.distance) < 1e-6;
}

/**
 * What the black marbles reflect (the room's lamps are gone): a sky ramp from the teal zenith to the orange band, a small white
 * window high on the left, a faint cyan strip low on the right. No sun disc: it made a warm blotch low on every marble.
 */
export function terraceEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const ramp = new THREE.SphereGeometry(50, 24, 16);
  const [top, horizon, band, ground] = [0x35676f, 0x9db8c4, 0xe8a870, 0x5a4636].map((c) => new THREE.Color(c)) as [THREE.Color, THREE.Color, THREE.Color, THREE.Color];
  const n = ramp.attributes.position!.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = ramp.attributes.position!.getY(i) / 50;
    const c = y > 0.25 ? top.clone().lerp(horizon, 1 - (y - 0.25) / 0.75) : y > 0 ? horizon.clone().lerp(band, 1 - y / 0.25) : band.clone().lerp(ground, Math.min(1, -y * 4));
    rgb.set([c.r, c.g, c.b], i * 3);
  }
  ramp.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  env.add(new THREE.Mesh(ramp, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const window = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 7.5), side: THREE.DoubleSide }));
  window.position.set(-20, 24, -28);
  window.lookAt(0, 0, 0);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(40, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.1), side: THREE.DoubleSide }));
  rim.position.set(30, 6, -25);
  rim.lookAt(0, 0, 0);
  env.add(window, rim);
  return env;
}

/** The lit material is multiplied by this: AgX leans the dish pink and the plateau tan; a little green puts the Moss and the dish back (art director). */
export const TERRACE_TINT = new THREE.Color(0.965, 1.08, 0.96);
/** The horizon band of the sky dome, 30 percent more saturated (art director): the dome's own vertex colours. */
export const SKY_SATURATION = 1.3;
/** Above this height the dome is the zenith: 20 percent less saturated, the teal read too cyan (art director). */
const ZENITH_FROM = 20;
const ZENITH_SATURATION = 0.8;
/** The slab (rim, plinth steps): 25 percent less saturated (art director). */
const RIM_SATURATION = 0.75;

/** Pushes the colours of a geometry away from their grey by `k` (1 leaves them), for the vertices whose height is in [`from`, `to`). */
export function saturateColours(geometry: THREE.BufferGeometry, k: number, from = -Infinity, to = Infinity): void {
  const colour = geometry.attributes.color!;
  for (let i = 0; i < colour.count; i++) {
    const y = geometry.attributes.position!.getY(i);
    if (y < from || y >= to) continue;
    const grey = 0.2126 * colour.getX(i) + 0.7152 * colour.getY(i) + 0.0722 * colour.getZ(i);
    colour.setXYZ(i, Math.max(0, grey + (colour.getX(i) - grey) * k), Math.max(0, grey + (colour.getY(i) - grey) * k), Math.max(0, grey + (colour.getZ(i) - grey) * k));
  }
}
