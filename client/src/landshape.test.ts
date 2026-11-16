import { describe, expect, it } from 'vitest';
import { BEACH, BIOME_RELIEF, GLOW, glowTint, HOLLOW, MOUND, POOL, RELIEF, relief, shadeTop, shapeLand, shapingAt, terrace } from './landshape';
import * as THREE from 'three';
import { STEP } from './openworldview';

// #1732: twice the levels: the rise inside a level is two terraces, flat, 0 or half a step up; the coast's sand stands half a step lower, by the water.
// #1735: each biome has its own relief signature, on the same two terraces a level: rolling hills in the meadow, tight rises in the forest,
// ridges over low ground in the tundra, dunes in bands in the desert, wide plateaus in the badlands.
describe('the relief of each biome (#1735)', () => {
  const runs = (biome: Parameters<typeof terrace>[2]): { up: number; run: number } => {
    let up = 0, cells = 0, changes = 0;
    for (let r = -60; r <= 60; r += 3) {
      let last = -1;
      for (let q = -60; q <= 60; q++) {
        const t = terrace(q, r, biome);
        up += t > 0 ? 1 : 0;
        cells++;
        if (last >= 0 && t !== last) changes++;
        last = t;
      }
    }
    return { up: up / cells, run: cells / Math.max(1, changes) };
  };
  it('keeps the two terraces in every biome', () => {
    for (const biome of Object.keys(BIOME_RELIEF) as (keyof typeof BIOME_RELIEF)[]) {
      const seen = new Set<number>();
      for (let q = -40; q <= 40; q++) for (let r = -40; r <= 40; r += 4) seen.add(terrace(q, r, biome));
      expect(seen, biome).toEqual(new Set([0, STEP / 2]));
    }
  });
  it('rolls wide in the meadow and tight in the forest, rises in ridges over low tundra, bands the desert, lifts wide plateaus in the badlands', () => {
    const [meadow, forest, tundra, desert, badlands] = (['meadow', 'forest', 'tundra', 'desert', 'badlands'] as const).map(runs);
    expect(meadow!.run).toBeGreaterThan(forest!.run * 1.8); // wide hills against tight rises
    expect(tundra!.up).toBeLessThan(0.35); // mostly low, a few ridges
    expect(badlands!.up).toBeGreaterThan(0.55); // mostly up: plateaus
    expect(badlands!.run).toBeGreaterThan(forest!.run * 1.8);
    // the dunes: bands across the q axis, a crest every few cells
    expect(desert!.run).toBeGreaterThan(1.2);
    expect(desert!.run).toBeLessThan(4);
  });
  it('keeps the plain relief where no biome is given (the archipelago too)', () => {
    for (let q = -10; q <= 10; q++) expect(terrace(q, 3)).toBe(terrace(q, 3, 'archipelago'));
  });
});

describe('the terraces of a level (#1732)', () => {
  it('lifts a cell by none or by half a step, both on a fair share of the land, so each level of the engine reads as two', () => {
    const all: number[] = [];
    for (let q = -60; q <= 60; q += 2) for (let r = -60; r <= 60; r += 2) all.push(terrace(q, r));
    expect(new Set(all)).toEqual(new Set([0, STEP / 2]));
    const up = all.filter((t) => t > 0).length / all.length;
    expect(up).toBeGreaterThan(0.25);
    expect(up).toBeLessThan(0.75);
    expect(terrace(7, -3)).toBe(terrace(7, -3));
  });

  it('keeps the upper terrace under the next level, and the beach half a step down', () => {
    expect(STEP / 2).toBeLessThan(STEP);
    expect(RELIEF.terrace).toBe(STEP / 2);
    expect(BEACH).toBe(STEP / 2);
  });
});

describe('the rise inside a level (#1718)', () => {
  it('stays between 0 and RELIEF.height, under a step, and is the same every call', () => {
    const all: number[] = [];
    for (let q = -40; q <= 40; q += 3) for (let r = -40; r <= 40; r += 3) all.push(relief(q, r));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...all)).toBeLessThan(RELIEF.height);
    expect(RELIEF.height + 0.08).toBeLessThan(STEP); // with the cell's own lift (LIFT_MAX), a level's top stays under the next level's
    expect(relief(7, -3)).toBe(relief(7, -3));
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThan(RELIEF.height / 2); // hills and dips, not one height
  });

  it('changes by little from a cell to its neighbour: slopes, not noise', () => {
    let steepest = 0;
    for (let q = -30; q <= 30; q++) for (let r = -30; r <= 30; r++) steepest = Math.max(steepest, Math.abs(relief(q + 1, r) - relief(q, r)), Math.abs(relief(q, r + 1) - relief(q, r)));
    expect(steepest).toBeLessThan(RELIEF.height / 2);
  });
});

describe('the land the landmarks shape (#1719)', () => {
  it('raises a mound under a tower, highest under it and gone past its reach', () => {
    const shaped = shapeLand({ lairs: [[10, 10]], gates: [], lights: [] });
    const lift = (q: number, r: number) => shapingAt(shaped, q, r)?.lift ?? 0;
    expect(lift(10, 10)).toBeCloseTo(MOUND.lift);
    expect(lift(11, 10)).toBeLessThan(lift(10, 10));
    expect(lift(13, 10)).toBeGreaterThan(0); // ring 3
    expect(shapingAt(shaped, 14, 10)).toBeUndefined(); // ring 4
    expect(shapingAt(shaped, 10, 10)!.share).toBeCloseTo(MOUND.share);
  });

  it('sinks a hollow round a gate, pools a light round a town or a teleporter, and the nearest landmark wins', () => {
    const shaped = shapeLand({ lairs: [[0, 0]], gates: [[3, 0]], lights: [{ cell: [-3, 0], colour: 0x19e6ff }] });
    expect(shapingAt(shaped, 3, 0)!.lift).toBeCloseTo(HOLLOW.lift);
    expect(shapingAt(shaped, 2, 0)!.lift).toBeLessThan(0); // ring 1 of the gate, ring 2 of the tower: the gate is nearer
    expect(shapingAt(shaped, -3, 0)).toEqual({ lift: 0, colour: 0x19e6ff, share: POOL.share });
    expect(shapingAt(shaped, -2, 0)).toMatchObject({ lift: 0, colour: 0x19e6ff }); // ring 2 of the tower, ring 1 of the light: the light is nearer
    expect(shapingAt(shaped, -1, 0)!.lift).toBeGreaterThan(0); // ring 1 of the tower, ring 2 of the light
    expect(shapingAt(shaped, 0, 0)!.lift).toBeCloseTo(MOUND.lift);
  });

  it('lights the cells and props round a tower amber and round a gate ember, fading with the rings; a light pool casts none (#1749)', () => {
    const shaped = shapeLand({ lairs: [[0, 0]], gates: [[20, 0]], lights: [{ cell: [-20, 0], colour: 0x19e6ff }] });
    expect(shapingAt(shaped, 0, 0)!.glow).toEqual({ colour: GLOW.tower, share: GLOW.share });
    expect(shapingAt(shaped, 2, 0)!.glow!.share).toBeLessThan(GLOW.share);
    expect(shapingAt(shaped, 20, 0)!.glow!.colour).toBe(GLOW.gate);
    expect(glowTint(0x808080, shapingAt(shaped, -20, 0))).toBe(0x808080);
    expect(glowTint(0x808080, undefined)).toBe(0x808080);
    const lit = new THREE.Color(glowTint(0x808080, shapingAt(shaped, 0, 0)));
    expect(lit.r).toBeGreaterThan(lit.b); // amber
    expect(shadeTop(0x808080, shapingAt(shaped, 0, 0))).not.toBe(shadeTop(0x808080, { ...shapingAt(shaped, 0, 0)!, glow: undefined }));
  });

  it('leans a top colour toward its shaping, and leaves an unshaped one as it is', () => {
    expect(shadeTop(0x808080, undefined)).toBe(0x808080);
    expect(shadeTop(0x808080, { lift: 0, colour: 0x000000, share: 0 })).toBe(0x808080);
    expect(shadeTop(0xffffff, { lift: 0, colour: 0x000000, share: 0.5 })).not.toBe(0xffffff);
  });
});
