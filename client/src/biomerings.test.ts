import { describe, expect, it } from 'vitest';
import { OUTER, OUTER_RING, ringName, ringTint } from './biomerings';

// #1741: rings by distance inside each sextant: past OUTER_RING cells from the spawn each biome turns to its harsh outer biome, 12 in all.
describe('the outer ring of the biomes (#1741)', () => {
  it('names the outer biome past OUTER_RING cells, the biome itself within', () => {
    expect(ringName('forest', OUTER_RING, 0)).toBe('Forest');
    expect(ringName('forest', OUTER_RING + 1, 0)).toBe(OUTER.forest.name);
    expect(new Set(Object.values(OUTER).map((o) => o.name)).size).toBe(6);
  });
  it('leans a colour toward the outer biome\'s past the ring, leaves it within', () => {
    expect(ringTint(0x808080, 'desert', 10, 10)).toBe(0x808080);
    expect(ringTint(0x808080, 'desert', 0, -OUTER_RING - 5)).not.toBe(0x808080);
  });
});
