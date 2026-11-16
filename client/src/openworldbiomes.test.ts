import { describe, expect, it } from 'vitest';
import { biomeLine } from './openworldbiomes';

// #1742: entering a biome names it and tells what is left there: the towers beaten of its own (tower k stands in the biome k mod 6, as the lore
// logs: openworld.md sections 7 and 12) and the logs found.
describe('the line of a biome (#1742)', () => {
  it('names the biome and counts its towers beaten and its logs found', () => {
    // 15 towers: k = 1, 7, 13 in the forest (k mod 6 = 1); 12 logs: k = 1, 7
    expect(biomeLine('forest', 15, [1, 2, 13], 12, [7])).toBe('Forest · towers 2/3 · logs 1/2');
    expect(biomeLine('archipelago', 15, [], 12, [])).toBe('Archipelago · towers 0/2 · logs 0/2');
    expect(biomeLine('meadow', 0, [], 0, [])).toBe('Meadow');
    expect(biomeLine('forest', 15, [], 12, [], 'Jungle')).toBe('Jungle · towers 0/3 · logs 0/2'); // the outer ring's name (#1741)
  });
});
