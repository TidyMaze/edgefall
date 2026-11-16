import { describe, expect, it } from 'vitest';
import type { Axial } from './board';
import { WILD_KIND, WILD_SPECIALS, wildPlan } from './openworldwild';

// #1738: a wild marble of a biome fights with that biome's own foes and ground, as a fight of a run in that biome (roguelite.md section 18):
// the biome's hazard opened on the board and two of its special marbles in the bot's army; the meadow keeps the plain army.
describe('the army of a wild fight in each biome (#1738)', () => {
  const white: Axial[] = [[0, -4], [1, -4], [2, -4], [-1, -3]];
  it('keeps the plain army of 14 in the meadow', () => {
    expect(wildPlan('meadow', 14, white)).toBe(14);
  });
  it('stands the biome on the board and gives the bot two of its special marbles, on the first cells of its army', () => {
    expect(wildPlan('forest', 14, white)).toEqual([14, 0, 1, 0, -4, 2, 1, -4, 2]); // Anchors
    expect(wildPlan('badlands', 13, white)).toEqual([13, 0, 4, 0, -4, 1, 1, -4, 1]); // Heavies, one marble less (the Saboteur)
    expect(WILD_SPECIALS).toBe(2);
    expect(WILD_KIND).toEqual({ meadow: 0, forest: 2, tundra: 8, desert: 3, badlands: 1, archipelago: 7 }); // as run_foes deals them
  });
});
