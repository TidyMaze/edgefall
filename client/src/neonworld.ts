// The neon look of the Open world (#1424, `?look=neon`): the ground, props, lairs and marbles of the circuit slab, from the approved
// numbers of the mockup (mock.js, buildWorld). Colours, materials, light and sky only: the geometry, the camera and the draw count
// are the game's. The palette changes the very constants the 3D view and the minimap read, so the map follows it.
import * as THREE from 'three';
import { NEON, setNeonWorldOn } from './neonlook';
import type { Biome } from './openworld';

/** The world's own tones under the look (#1656): the beach and the rock of every biome; the water in three, the shallows on the cells
 * next to land, darker than any ground, the deep open water darker still, and the foam line on the coast's edge; the troop's marble, light enough to read 4.5:1 on the brightest lit ground. */
export const WORLD = { sand: 0x4a4232, rock: 0x35312b, shallow: 0x0e2a40, deep: 0x06142a, foam: 0x5f87a3, wall: 0x171c2b, boulder: 0x14161a, mountain: 0x2a3347, troop: 0xeef4fa } as const;
/** Each biome's ground (its grass at every height) and the accent its trees and boulders take (#1656): six dark grounds told apart by
 * luminance or by a hue a colour-blind player keeps (the art director's pair rule, neonworld.palette.test.ts). */
export const NEON_BIOME: Record<Biome, { ground: number; prop: number }> = {
  meadow: { ground: 0x3a7448, prop: 0x6dffa8 },
  forest: { ground: 0x1e4a3e, prop: 0xc8ff3f },
  tundra: { ground: 0x4b6c83, prop: 0xffffff },
  desert: { ground: 0x4f3f22, prop: 0xffcf6b },
  badlands: { ground: 0x863c4d, prop: 0xffb0a0 },
  archipelago: { ground: 0x6456b3, prop: 0xff9ae6 },
};
/** The ambient motes of the Open world: a very dim cool grey-blue (half the brightness of the first slate). */
const MOTE = 0x2b3648;
/** The dark seam between the ground cells with the look: the band along an edge keeps 30 % of the colour (the game's own is 78 %). */
export const WORLD_EDGE_GAIN = -0.7;

/** A tile of circuit traces, 512 px, drawn with 1 px lines on a 16 px grid (axis and diagonal runs ending in a dot): the world ground repeats it, dim violet. Plain bytes, no canvas. */
export function neonTraces(size = 512): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const put = (x: number, y: number): void => {
    const wrap = (v: number): number => ((v % size) + size) % size;
    const i = (wrap(y) * size + wrap(x)) * 4;
    data.set([255, 255, 255, 255], i);
  };
  let s = 9;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1]] as const;
  const grid = 16;
  for (let i = 0; i < 18; i++) {
    let x = Math.floor((rnd() * size) / grid) * grid;
    let y = Math.floor((rnd() * size) / grid) * grid;
    for (let k = 0; k < 6; k++) {
      const [dx, dy] = dirs[Math.floor(rnd() * dirs.length)]!;
      const run = (2 + Math.floor(rnd() * 5)) * grid;
      for (let t = 0; t < run; t++) put(x + dx * t, y + dy * t);
      x += dx * run;
      y += dy * run;
    }
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + ox!, y + oy!); // the node at the end of a trace
  }
  const tile = new THREE.DataTexture(data, size, size);
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
  tile.generateMipmaps = true;
  tile.minFilter = THREE.LinearMipmapLinearFilter;
  tile.magFilter = THREE.LinearFilter;
  tile.needsUpdate = true;
  return tile;
}

/** The soft shadows of the Open world under the look: about 30 % dark (#1687: 55 % made the trees' shadows read as bands), so the darkest floor stays above #0f1424. */
export const WORLD_SHADOW = 0.3;

type Colours = Record<string, number>;
/** The palette objects the view and the minimap hold (openworldview.ts), handed in so this file needs no import of the view. */
export interface WorldPalette {
  LOOK: Record<string, { color: number; emissive: number }>;
  WATER: Colours;
  BIOME_LOOK: Record<string, { ground: number; prop: number }>;
  PROPS: Record<string, { color: number; emissive: number; rim?: number }>;
  MARBLE_LOOK: Record<string, { base: number; stripe: number; roughness: number }>;
  LAIR_LOOK: { open: number; beaten: number; height: number };
  TELEPORTER_LOOK: { colour: number; ring: number };
  /** The ambient motes of each biome: only their colour is the look's. */
  AMBIENT: Partial<Record<string, { colour: number }>>;
}

const snapshot = new WeakMap<WorldPalette['LOOK'], string>();

/** Puts the palette on, or gives the game's own back (what was there when it was first put on). */
export function applyNeonWorld(on: boolean, p: WorldPalette): void {
  // Only the colours (and a boulder's rim) are copied and written back: a prop's geometry stays the view's own.
  const colours = (props: WorldPalette['PROPS']): WorldPalette['PROPS'] =>
    Object.fromEntries(Object.entries(props).map(([name, { color, emissive, rim }]) => [name, rim === undefined ? { color, emissive } : { color, emissive, rim }]));
  const motes = (a: WorldPalette['AMBIENT']): WorldPalette['AMBIENT'] => Object.fromEntries(Object.entries(a).map(([name, look]) => [name, { colour: look!.colour }]));
  if (!snapshot.has(p.LOOK)) snapshot.set(p.LOOK, JSON.stringify({ ...p, PROPS: colours(p.PROPS), AMBIENT: motes(p.AMBIENT) }));
  const base = JSON.parse(snapshot.get(p.LOOK)!) as WorldPalette;
  setNeonWorldOn(on);
  const from = on ? neonPalette(base) : base;
  for (const k of ['LOOK', 'BIOME_LOOK', 'PROPS', 'MARBLE_LOOK'] as const) for (const [name, value] of Object.entries(from[k])) Object.assign(p[k][name]!, value);
  for (const [name, look] of Object.entries(from.AMBIENT)) Object.assign(p.AMBIENT[name]!, look);
  Object.assign(p.WATER, from.WATER);
  Object.assign(p.LAIR_LOOK, from.LAIR_LOOK);
  Object.assign(p.TELEPORTER_LOOK, from.TELEPORTER_LOOK);
}

/** The game's palette with the neon one on top. */
function neonPalette(base: WorldPalette): WorldPalette {
  const out = JSON.parse(JSON.stringify(base)) as WorldPalette;
  Object.assign(out.LOOK.sand!, { color: WORLD.sand });
  Object.assign(out.LOOK.grass!, { color: NEON_BIOME.meadow.ground }); // a grass cell takes its own biome's ground (groundColour)
  Object.assign(out.LOOK.rock!, { color: WORLD.rock });
  Object.assign(out.LOOK.peak!, { color: WORLD.rock });
  out.WATER = { shore: WORLD.shallow, deep: WORLD.deep };
  for (const [biome, look] of Object.entries(NEON_BIOME)) out.BIOME_LOOK[biome] = { ...look };
  Object.assign(out.PROPS.mountain!, { color: WORLD.mountain, emissive: 0 });
  Object.assign(out.PROPS.tree!, { color: NEON.crystal, emissive: 0 }); // calm: the quietest violet of the map
  Object.assign(out.PROPS.boulder!, { color: WORLD.boulder, emissive: 0, rim: NEON.rimLight }); // a dark shell with a slate rim: cyan stays the marbles' (#1557 art round 3)
  Object.assign(out.PROPS.wall!, { color: WORLD.wall, emissive: 0 }); // the cap keeps the sodium seam
  Object.assign(out.MARBLE_LOOK.hero!, { base: NEON.whiteMarble, stripe: NEON.pedestalRing });
  Object.assign(out.MARBLE_LOOK.troop!, { base: WORLD.troop, stripe: NEON.pedestalRing });
  Object.assign(out.MARBLE_LOOK.foes!, { base: NEON.blackMarble });
  Object.assign(out.LAIR_LOOK, { open: NEON.violet, beaten: NEON.cyan });
  Object.assign(out.TELEPORTER_LOOK, { colour: NEON.crystal }); // a pad is quieter than a marble
  for (const look of Object.values(out.AMBIENT)) look!.colour = MOTE; // calm motes: a cool slate, never a bright colour on the map
  return out;
}

/** The map is read on the ship's black, not in the 3D light: the dark terrain of the look is lifted (x14 in linear light) so the darkest, the rock, stays 3:1 over the map's back.
 * A brighter colour is lifted less, just to its brightest channel's full, so no channel clips and each ground keeps its hue (#1656). */
export const MAP_LIFT = 14;
export function mapColour(hex: number): number {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(Math.min(MAP_LIFT, 1 / Math.max(c.r, c.g, c.b))).getHex();
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const linear = (hex: number): THREE.Color => new THREE.Color(hex);

/** A copy of `geometry` with float RGB vertex colours, each given by `paint` from its file colour and its place between the file's darkest and brightest. */
function repaint(geometry: THREE.BufferGeometry, paint: (c: THREE.Color, t: number) => THREE.Color): THREE.BufferGeometry {
  const out = geometry.clone();
  const src = out.attributes.color!;
  const values = Array.from({ length: src.count }, (_, i) => new THREE.Color(src.getX(i), src.getY(i), src.getZ(i)));
  const lights = values.map((c) => luma(c.r, c.g, c.b));
  const [lo, hi] = [Math.min(...lights), Math.max(...lights)];
  out.setAttribute('color', new THREE.Float32BufferAttribute(values.flatMap((c, i) => paint(c, hi === lo ? 1 : (lights[i]! - lo) / (hi - lo)).toArray()), 3));
  return out;
}

const between = (dark: number, light: number, t: number): THREE.Color => linear(dark).lerp(linear(light), t);

/** The model of a prop in the neon look: the file's light and shade in slate, the tree a calm violet crystal, the wall's sodium seam and the lair's lamp kept as lamps. */
export function neonProp(prop: string, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.hasAttribute('color')) return geometry;
  if (prop === 'mountain') return repaint(geometry, (_, t) => (t > 0.5 ? between(0x39466a, NEON.pedestalRing, t * 2 - 1) : between(0x1b2233, 0x39466a, t * 2))); // a cyan line on the ridges (#1557)
  if (prop === 'tree') return repaint(geometry, (_, t) => between(0x5c6048, 0xd2dca8, t));
  if (prop === 'wall') return repaint(geometry, (c, t) => (t > 0.5 ? c : between(0x0f1320, 0x2a3347, t * 2)));
  const gem = prop === 'lair_beaten' ? NEON.cyan : NEON.violet; // the lair's lamp: lit more than the slate it stands on
  return repaint(geometry, (_, t) => (t > 0.55 ? linear(gem).multiplyScalar(1.6) : between(0x1f2840, 0x4a5a80, t / 0.55)));
}
