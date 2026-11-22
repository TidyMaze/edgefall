import './test/openworldwasm';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { type Axial } from './board';
import { CHUNK, TERRAINS, World } from './openworld';
import { OpenWorldView, shapeWorld } from './openworldview';

// The Open world lays only the chunks that enter the area on a walk, and keeps the others' records (#1756).
describe('a walk lays only the chunks that enter the area (#1756)', () => {
  const treed = (cx: number, cy: number): Uint8Array => {
    if (Math.abs(cx) > 30 || Math.abs(cy) > 30) return new Uint8Array();
    const out = new Uint8Array(CHUNK * CHUNK * 3);
    for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1 + (i % 3), i % 16 === 0 ? TERRAINS.indexOf('tree') : TERRAINS.indexOf('grass'), 0], i * 3);
    return out;
  };
  type Inside = { show: (at: Axial) => void; drawnChunks: string; centre: Axial; laidChunks: Map<number, { kx: number; ky: number; ground: unknown }>; stand: () => void };
  const open = (world = new World(treed)) => {
    const view = new OpenWorldView(world);
    const inside = view as unknown as Inside;
    const stand = vi.spyOn(inside, 'stand');
    view.resize(1600, 900);
    view.show([0, 0]);
    const first = stand.mock.calls.length - (CHUNK * CHUNK) / 16; // the build's, less the one chunk the frame made ahead
    stand.mockClear();
    const again = (): number => {
      inside.drawnChunks = '';
      view.show([0, 0]);
      const n = stand.mock.calls.length;
      stand.mockClear();
      return n;
    };
    return { view, inside, stand, first, again };
  };
  const picture = (view: OpenWorldView): string[] => {
    const out: string[] = [];
    view.scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh || !(m.name.startsWith('terrain-') || m.name.startsWith('prop-'))) return;
      const rows: string[] = [];
      for (let i = 0; i < m.count; i++) rows.push([...m.instanceMatrix.array.slice(i * 16, i * 16 + 16), ...m.instanceColor!.array.slice(i * 3, i * 3 + 3)].map((x) => x.toFixed(3)).join(','));
      out.push(`${m.name}:${m.count}:${rows.sort().join('|')}`);
    });
    return out.sort();
  };
  const fresh = (hero: Axial, flat = false): OpenWorldView => {
    const view = new OpenWorldView(new World(treed));
    view.resize(1600, 900);
    view.useFlatTops(flat);
    view.show(hero);
    return view;
  };

  it('lays the same picture as a fresh view, from the entering chunks alone', () => {
    const { view, inside, stand, first } = open();
    expect(first).toBeGreaterThan(100);
    const reach = view.reach;
    const hero: Axial = [CHUNK * (reach + 2), 0]; // out of the square: the centre moves by several chunks
    const before = inside.centre;
    view.show(hero);
    const moved = Math.abs(inside.centre[0] - before[0]);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(2 * reach + 1); // some chunks stay
    expect(stand.mock.calls.length).toBeLessThanOrEqual(Math.ceil(first * (moved / (2 * reach + 1))) + (2 * reach + 1));
    expect(picture(view)).toEqual(picture(fresh(hero)));
    expect(inside.laidChunks.size).toBeLessThanOrEqual((2 * reach + 5) ** 2); // the chunks that left are dropped, two rings stay ahead
    expect([...inside.laidChunks.values()].every((c) => Math.abs(c.kx - inside.centre[0]) <= reach + 2 && Math.abs(c.ky - inside.centre[1]) <= reach + 2)).toBe(true);
  });

  it('records the ring of chunks ahead, one a frame, so the walk finds its entering chunks ready', () => {
    const { view, inside, stand, first } = open();
    const reach = view.reach;
    expect(inside.laidChunks.size).toBe((2 * reach + 1) ** 2 + 1); // the first frame made one ahead
    for (let i = 0; i < (2 * reach + 5) ** 2; i++) view.show([0, 0]);
    expect(inside.laidChunks.size).toBe((2 * reach + 5) ** 2);
    stand.mockClear();
    const size = inside.laidChunks.size;
    view.show([0, 0]);
    expect(inside.laidChunks.size).toBe(size);
    expect(stand.mock.calls.length).toBe(0); // nothing is left to make
    const centre = inside.centre;
    for (let x = 0; x < CHUNK * (reach + 2) && inside.centre === centre; x += 4) {
      stand.mockClear();
      view.show([x, 0]); // a walk: the square moves one or two chunks at some step
    }
    expect(inside.centre).not.toBe(centre);
    expect(Math.abs(inside.centre[0] - centre[0])).toBeLessThanOrEqual(2);
    expect(stand.mock.calls.length).toBe(0); // its entering chunks were ready: the build only writes
    expect(first).toBeGreaterThan(0);
  });

  it('keeps the ring ahead round the hero\'s chunk while the square lags behind it, so a jump of the square finds its chunks (#1766)', () => {
    const { view, inside } = open();
    const reach = view.reach;
    for (let i = 0; i < (2 * reach + 5) ** 2; i++) view.show([0, 0]);
    const centre = inside.centre;
    view.show([CHUNK, 0]); // one chunk on: the square still covers the ball and keeps its centre
    expect(inside.centre).toBe(centre);
    for (let i = 0; i < 4; i++) view.show([CHUNK, 0]);
    // the chunk two rings past the hero's square edge, which the lagging square's own ring does not reach
    expect(inside.laidChunks.has((centre[0] + reach + 3) * 65536 + centre[1])).toBe(true);
  });

  it('keeps fewer rings ahead when the world cache could not hold the chunks ahead and their halo', () => {
    const probe = open();
    const reach = probe.view.reach;
    const limit = (2 * (reach + 1) + 3) ** 2; // room for one ring ahead and the halo, not two
    const world = new World(treed);
    world.limit = limit;
    const { inside } = open(world);
    for (let i = 0; i < (2 * reach + 5) ** 2; i++) inside.show([0, 0]);
    expect(inside.laidChunks.size).toBe((2 * reach + 3) ** 2);
  });

  it('lays nothing again when the chunks have not changed', () => {
    expect(open().again()).toBe(0);
  });

  it('lays the cells again when the flat tops switch, and back', () => {
    const { view, stand, first, again } = open();
    const high = picture(view);
    view.useFlatTops(true);
    view.show([0, 0]);
    expect(stand.mock.calls.length).toBe(first);
    stand.mockClear();
    expect(again()).toBe(0);
    const flat = picture(view);
    expect(flat).not.toEqual(high);
    expect(flat).toEqual(picture(fresh([0, 0], true)));
    view.useFlatTops(false); // the fresh view's own flag is the module's now
    view.show([0, 0]);
    expect(picture(view)).toEqual(high);
  });

  it('lays the cells again when the lifting flag changes', () => {
    const { view, stand, first } = open();
    view.useFlatTops(true);
    view.show([0, 0]);
    expect(stand.mock.calls.length).toBe(first);
  });

  it('lays the cells again when the landmarks that shape the land change', () => {
    const { first, again } = open();
    shapeWorld({ lairs: [[3, 3]], gates: [], lights: [] });
    expect(again()).toBe(first);
    shapeWorld({ lairs: [], gates: [], lights: [] });
  });

  it('lays the cells again when another view sets the biome reader', () => {
    const { first, again } = open();
    new OpenWorldView(new World(treed));
    expect(again()).toBe(first);
  });

  it('lays the cells again when a prop is broken, and the prop is gone', () => {
    const world = new World(treed);
    const { view, first, again } = open(world);
    const trees = (): number => (view.scene.getObjectByName('prop-tree') as THREE.InstancedMesh).count + (view.scene.getObjectByName('prop-tree-hi') as THREE.InstancedMesh).count;
    const before = trees();
    world.smash(0, 0); // the tree of cell 0 of chunk (0, 0)
    expect(again()).toBe(first - 1);
    expect(trees()).toBe(before - 1);
  });
  it('writes the instances with a Map lookup per mesh change, not one per instance (#1761)', () => {
    const { view, inside, again } = open();
    again(); // the records are kept: the next build only writes
    const instances = (view.scene.children as THREE.InstancedMesh[]).reduce((sum, m) => sum + (m.isInstancedMesh ? m.count : 0), 0);
    const get = vi.spyOn(Map.prototype, 'get');
    inside.drawnChunks = '';
    view.show([0, 0]);
    const calls = get.mock.calls.length;
    get.mockRestore();
    expect(instances).toBeGreaterThan(1000);
    expect(calls).toBeLessThan(instances / 4);
  });

  // The cairns' matrices are kept per chunk beside the ground and prop records (#1767).
  describe('keeps the matrices of the cairns per chunk (#1767)', () => {
    type Cairns = { cairnRecords: (kx: number, ky: number) => Float32Array; laidChunks: Map<number, { cairns: Float32Array | null }>; drawnChunks: string; show: (at: Axial) => void };
    const cairnsOf = (cx: number, cy: number): Int32Array => (Math.abs(cx) <= 30 && Math.abs(cy) <= 30 ? Int32Array.of(cx * CHUNK + 2, cy * CHUNK + 3) : new Int32Array());
    const standing = () => {
      const world = new World(treed, undefined, cairnsOf);
      const view = new OpenWorldView(world);
      view.resize(1600, 900);
      view.show([0, 0]);
      const inside = view as unknown as Cairns;
      return { world, view, inside, made: vi.spyOn(inside, 'cairnRecords') };
    };
    const again = (inside: Cairns): void => {
      inside.drawnChunks = '';
      inside.show([0, 0]);
    };
    const stones = (view: OpenWorldView): string => {
      const m = view.scene.getObjectByName('cairn') as THREE.InstancedMesh;
      return `${m.count}:${[...m.instanceMatrix.array.slice(0, m.count * 16)].map((x) => x.toFixed(3)).join(',')}`;
    };

    it('makes them with the ground of each chunk, in the prefetch too, and writes them without asking again', () => {
      const { view, inside, made } = standing();
      expect([...inside.laidChunks.values()].every((c) => c.cairns !== null)).toBe(true);
      expect((view.scene.getObjectByName('cairn') as THREE.InstancedMesh).count).toBe((2 * view.reach + 1) ** 2);
      made.mockClear();
      const picture = stones(view);
      again(inside);
      expect(made).not.toHaveBeenCalled();
      expect(stones(view)).toBe(picture);
    });

    it('lays the same stones as a fresh view after a walk', () => {
      const { view, inside } = standing();
      const hero: Axial = [CHUNK * (view.reach + 2), 0];
      inside.show(hero);
      const other = new OpenWorldView(new World(treed, undefined, cairnsOf));
      other.resize(1600, 900);
      other.show(hero);
      expect(stones(view)).toBe(stones(other));
    });

    it('makes them again when the landmarks change, the biome reader is set, a prop is broken, or the flat tops switch', () => {
      const { world, view, inside, made } = standing();
      for (const change of [
        () => shapeWorld({ lairs: [[3, 3]], gates: [], lights: [] }),
        () => void new OpenWorldView(new World(treed)),
        () => world.smash(0, 0),
        () => view.useFlatTops(true),
      ]) {
        again(inside); // the records are valid
        made.mockClear();
        change();
        again(inside);
        expect(made.mock.calls.length).toBeGreaterThanOrEqual((2 * view.reach + 1) ** 2);
      }
      shapeWorld({ lairs: [], gates: [], lights: [] });
      view.useFlatTops(false);
    });
  });
});
