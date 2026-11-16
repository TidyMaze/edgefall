import { describe, expect, it } from 'vitest';
import { FOREST_SIGHT, MIRAGE, fogScale, seenThrough } from './biomerules';

// #1739: a light rule per biome: the forest's fog closes in (short sight), the desert's mirage hides the far marbles.
describe('the light rules of the biomes (#1739)', () => {
  it('closes the fog in over the forest only', () => {
    expect(fogScale('forest')).toBe(FOREST_SIGHT);
    expect(FOREST_SIGHT).toBeLessThan(1);
    for (const biome of ['meadow', 'tundra', 'desert', 'badlands', 'archipelago'] as const) expect(fogScale(biome)).toBe(1);
  });
  it('shows a marble of the desert only within the mirage\'s reach of the hero, every marble elsewhere', () => {
    expect(seenThrough('desert', [0, 0], [MIRAGE, 0])).toBe(true);
    expect(seenThrough('desert', [0, 0], [MIRAGE + 1, 0])).toBe(false);
    expect(seenThrough('meadow', [0, 0], [40, 0])).toBe(true);
  });
});
