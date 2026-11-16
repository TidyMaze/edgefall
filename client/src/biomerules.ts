// The light rules of the biomes (#1739): each biome plays a little differently, in what the hero sees. The forest's fog closes in, and the
// desert's mirage hides the marbles past a few cells until the hero comes near.
import type { Axial } from './board';
import type { Biome } from './openworld';
import { hexDistance } from './worldpeers';

/** The share of the fog's reach over the forest: the trees close the sight in. */
export const FOREST_SIGHT = 0.6;
/** How far the hero sees a marble in the desert's haze, in cells. */
export const MIRAGE = 8;

/** The fog's reach over `biome`, as a share of the usual one. */
export const fogScale = (biome: Biome): number => (biome === 'forest' ? FOREST_SIGHT : 1);

/** Whether a marble on `cell` shows to a hero on `hero` in `biome`: always, but in the desert past `MIRAGE` cells. */
export const seenThrough = (biome: Biome, hero: Axial, cell: Axial): boolean => biome !== 'desert' || hexDistance(hero, cell) <= MIRAGE;
