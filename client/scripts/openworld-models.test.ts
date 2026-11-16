import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Open world props (#1138): the tree and the boulder are vertex-coloured meshes, no texture, under the art budget, with the node
// names the view looks them up by (openworldview.ts `readModels`). The mountain and the wall are clean low-poly models (#1160): a
// few big flat planes in two to four flat tones, under a triangle budget, in the box the view lays them in.
const read = (file: string) => readFileSync(fileURLToPath(new URL(`../models/${file}`, import.meta.url)));
const json = (data: Buffer) =>
  JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString()) as {
    nodes: { name: string; mesh: number }[];
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { count: number; min?: number[]; max?: number[]; bufferView: number; byteOffset?: number; componentType: number }[];
    bufferViews: { byteOffset?: number }[];
    images?: unknown[];
  };

/** The triangle budget of the clean props (#1160): the mountain is two peaks of 9 to 12 triangles, the wall a bevelled block. */
const BUDGET = { mountain: 24, wall: 60 } as const;
/** The box the view lays each prop in (openworldview.ts `lay`): the old models' boxes, within a hair. */
const BOX = {
  mountain: { min: [-0.55, -0.5, -0.45], max: [0.55, 0.5, 0.46] },
  wall: { min: [-0.434, -0.5, -0.5], max: [0.434, 0.5, 0.5] },
} as const;

describe.each([
  ['openworld.glb', ''],
  ['openworld-hi.glb', '_hi'],
])('%s', (file, suffix) => {
  const data = read(file);
  const model = json(data);
  const node = (prop: string) => model.nodes.find((n) => n.name === `ow_${prop}${suffix}`)!;
  const primitive = (prop: string) => model.meshes[node(prop).mesh]!.primitives[0]!;
  const faces = (prop: string) => model.accessors[primitive(prop).indices]!.count / 3;

  it('holds the four props under the names the view reads, each with vertex colours and no texture', () => {
    for (const prop of ['mountain', 'tree', 'boulder', 'wall']) {
      expect(node(prop), prop).toBeDefined();
      expect(primitive(prop).attributes, prop).toHaveProperty('COLOR_0');
    }
    expect(model.images ?? []).toEqual([]);
  });

  it('draws the boulder as 6 to 8 flat facets and the tree as a few cone facets', () => {
    expect(faces('boulder')).toBeGreaterThanOrEqual(6);
    expect(faces('boulder')).toBeLessThanOrEqual(8);
    expect(faces('tree')).toBeLessThan(100);
  });

  it('draws the mountain and the wall as few big planes, under their triangle and vertex budgets', () => {
    for (const prop of ['mountain', 'wall'] as const) {
      expect(faces(prop), prop).toBeGreaterThanOrEqual(8);
      expect(faces(prop), prop).toBeLessThanOrEqual(BUDGET[prop]);
      // flat shading: at most three vertices of its own per triangle
      expect(model.accessors[primitive(prop).attributes.POSITION!]!.count, prop).toBeLessThanOrEqual(faces(prop) * 3);
    }
  });

  it('keeps the box, the origin and the unit scale the view lays the mountain and the wall in', () => {
    for (const prop of ['mountain', 'wall'] as const) {
      const { min, max } = model.accessors[primitive(prop).attributes.POSITION!]!;
      for (let axis = 0; axis < 3; axis++) {
        expect(min![axis]!, `${prop} min ${axis}`).toBeGreaterThanOrEqual(BOX[prop].min[axis]!);
        expect(max![axis]!, `${prop} max ${axis}`).toBeLessThanOrEqual(BOX[prop].max[axis]!);
      }
      expect(min![1], `${prop} sits on its base`).toBeCloseTo(-0.5, 2);
      expect(max![1], `${prop} reaches its top`).toBeCloseTo(0.5, 2);
      expect(node(prop), prop).not.toHaveProperty('scale');
      expect(node(prop), prop).not.toHaveProperty('translation');
    }
  });

  it('paints the mountain and the wall in two to four flat tones, no noise', () => {
    // the vertex colours are normalised unsigned shorts (Blender's export)
    const rgba = (accessor: number) => {
      const a = model.accessors[accessor]!;
      expect(a.componentType).toBe(5123);
      const start = 20 + data.readUInt32LE(12) + 8 + (model.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
      return Array.from({ length: a.count * 4 }, (_, i) => data.readUInt16LE(start + i * 2) / 65535);
    };
    for (const prop of ['mountain', 'wall'] as const) {
      const colours = new Set<string>();
      const values = rgba(primitive(prop).attributes.COLOR_0!);
      for (let i = 0; i < values.length; i += 4) colours.add(values.slice(i, i + 3).map((c) => c.toFixed(2)).join(','));
      expect(colours.size, prop).toBeGreaterThanOrEqual(2);
      expect(colours.size, prop).toBeLessThanOrEqual(4);
    }
  });

  it('stays within the art budget of a prop file: under 20 KB', () => {
    expect(statSync(fileURLToPath(new URL(`../models/${file}`, import.meta.url))).size).toBeLessThan(20_000);
  });
});

// The landmark of a boss lair (#1171): one model each for the open lair (a spire crowned with a gold gem) and the beaten one (a short
// stump with a green band), in `openworld-lair.glb`: vertex colours, no texture, a few big flat planes, on its base at the origin.
describe('openworld-lair.glb', () => {
  const data = read('openworld-lair.glb');
  const model = json(data);
  const node = (name: string) => model.nodes.find((n) => n.name === name)!;
  const primitive = (name: string) => model.meshes[node(name).mesh]!.primitives[0]!;
  const box = (name: string) => model.accessors[primitive(name).attributes.POSITION!]!;
  const faces = (name: string) => model.accessors[primitive(name).indices]!.count / 3;
  const tones = (name: string) => {
    const a = model.accessors[primitive(name).attributes.COLOR_0!]!;
    const start = 20 + data.readUInt32LE(12) + 8 + (model.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
    expect(a.componentType).toBe(5126);
    const out = new Set<string>();
    for (let i = 0; i < a.count; i++) {
      const [r, g, b] = [0, 1, 2].map((c) => data.readFloatLE(start + (i * 3 + c) * 4)); // linear floats, RGB
      out.add(`${r!.toFixed(2)},${g!.toFixed(2)},${b!.toFixed(2)}`);
    }
    return out;
  };

  it('holds the open and the beaten landmark, painted by vertex colours, no texture', () => {
    for (const name of ['ow_lair', 'ow_lair_beaten']) expect(primitive(name).attributes, name).toHaveProperty('COLOR_0');
    expect(model.images ?? []).toEqual([]);
  });

  it('draws each in under 72 flat triangles', () => {
    for (const name of ['ow_lair', 'ow_lair_beaten']) {
      expect(faces(name), name).toBeLessThanOrEqual(72);
      expect(box(name).count, name).toBeLessThanOrEqual(faces(name) * 3);
    }
  });

  it('stands on its base at the origin, the open one tall and the beaten one a lower stump, both inside a cell wide plinth', () => {
    expect(box('ow_lair').min![1]).toBeCloseTo(0, 2);
    expect(box('ow_lair_beaten').min![1]).toBeCloseTo(0, 2);
    expect(box('ow_lair').max![1]).toBeGreaterThanOrEqual(5);
    expect(box('ow_lair_beaten').max![1]).toBeLessThan(box('ow_lair').max![1]! / 2 + 0.5);
    expect(box('ow_lair_beaten').max![1]).toBeGreaterThanOrEqual(2);
    for (const name of ['ow_lair', 'ow_lair_beaten']) expect(box(name).max![0], name).toBeLessThanOrEqual(0.9);
  });

  it('is gold while open and green once beaten, in a few flat tones', () => {
    const open = tones('ow_lair');
    const beaten = tones('ow_lair_beaten');
    expect(open.size).toBeLessThanOrEqual(6);
    expect(beaten.size).toBeLessThanOrEqual(6);
    const has = (set: Set<string>, test: (r: number, g: number, b: number) => boolean) =>
      [...set].some((t) => test(...(t.split(',').map(Number) as [number, number, number])));
    expect(has(open, (r, g, b) => r > 0.8 && g > 0.2 && b < 0.05)).toBe(true);
    expect(has(open, (r, g) => g > 0.3 && g > r)).toBe(false);
    expect(has(beaten, (r, g) => g > 0.4 && g > r * 2)).toBe(true);
    expect(has(beaten, (r, g, b) => r > 0.8 && b < 0.05 && g > 0.2)).toBe(false);
  });

  it('stays within the art budget of a prop file: under 20 KB', () => {
    expect(statSync(fileURLToPath(new URL('../models/openworld-lair.glb', import.meta.url))).size).toBeLessThan(20_000);
  });
});

// #1733: each biome's own tree and boulder, in `openworld-biomes.glb`: vertex colours, no texture, under 40 triangles each (instanced by the
// thousand), in the box of the plain prop (one unit high, a cell's footprint), under the names the view reads (`BIOME_PROPS`).
describe('openworld-biomes.glb', () => {
  const model = json(read('openworld-biomes.glb'));
  const NAMES = ['tree_meadow', 'tree_forest', 'tree_tundra', 'tree_archipelago', 'boulder_desert', 'boulder_badlands', 'boulder_tundra'];
  it('holds the seven biome props, each painted, untextured, small and in the box', () => {
    expect(model.images ?? []).toEqual([]);
    for (const name of NAMES) {
      const node = model.nodes.find((n) => n.name === `ow_${name}`);
      expect(node, name).toBeDefined();
      const primitive = model.meshes[node!.mesh]!.primitives[0]!;
      expect(primitive.attributes, name).toHaveProperty('COLOR_0');
      expect(model.accessors[primitive.indices]!.count / 3, name).toBeLessThanOrEqual(40);
      const { min, max } = model.accessors[primitive.attributes.POSITION!]!;
      expect(min![1]!, name).toBeCloseTo(-0.5, 1);
      expect(max![1]!, name).toBeCloseTo(0.5, 1);
      for (const axis of [0, 2]) expect(Math.max(-min![axis]!, max![axis]!), name).toBeLessThanOrEqual(0.36);
    }
  });
});

