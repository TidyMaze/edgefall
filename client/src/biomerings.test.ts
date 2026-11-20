import { describe, expect, it } from 'vitest';
import { OUTER, OUTER_ABOVE, outerField, ringName, ringTint } from './biomerings';

// #1741, #1755: the outer biomes lie in organic patches, where a large-scale noise field of the cell is high: no centre, no distance.
const cells = (step: number, half: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let q = -half; q <= half; q += step) for (let r = -half; r <= half; r += step) out.push([q, r]);
  return out;
};

describe('the outer biomes (#1741, #1755)', () => {
  it('is a pure field of the cell, between 0 and 1, smooth from cell to cell', () => {
    expect(outerField(37, -91)).toBe(outerField(37, -91));
    for (const [q, r] of cells(23, 400)) {
      const v = outerField(q, r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(outerField(q + 1, r) - v)).toBeLessThan(0.05);
    }
  });
  it('covers a share of the map, in both halves of every direction (no centre)', () => {
    const all = cells(10, 440);
    const share = (pick: (c: [number, number]) => boolean): number => {
      const some = all.filter(pick);
      return some.filter(([q, r]) => outerField(q, r) > OUTER_ABOVE).length / some.length;
    };
    expect(share(() => true)).toBeGreaterThan(0.3);
    expect(share(() => true)).toBeLessThan(0.6);
    const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dq, dr] of sides) {
      const half = share(([q, r]) => q * dq + r * dr > 0);
      expect(half).toBeGreaterThan(0.1);
      expect(half).toBeLessThan(0.9);
    }
  });
  it('names the outer biome where the field is high, the biome itself elsewhere', () => {
    const [high, low] = [cells(5, 400).find(([q, r]) => outerField(q, r) > OUTER_ABOVE)!, cells(5, 400).find(([q, r]) => outerField(q, r) <= OUTER_ABOVE)!];
    expect(ringName('forest', high[0], high[1])).toBe(OUTER.forest.name);
    expect(ringName('forest', low[0], low[1])).toBe('Forest');
    expect(new Set(Object.values(OUTER).map((o) => o.name)).size).toBe(6);
  });
  it("leans a colour toward the outer biome's where the field is high, leaves it elsewhere", () => {
    const [high, low] = [cells(5, 400).find(([q, r]) => outerField(q, r) > OUTER_ABOVE)!, cells(5, 400).find(([q, r]) => outerField(q, r) <= OUTER_ABOVE)!];
    expect(ringTint(0x808080, 'desert', low[0], low[1])).toBe(0x808080);
    expect(ringTint(0x808080, 'desert', high[0], high[1])).not.toBe(0x808080);
  });
});
