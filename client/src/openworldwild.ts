// The army of a wild fight (#1738): a wild marble met in a biome fights as a fight of a run in that biome does (roguelite.md section 18): the board opens the
// biome's hazard and the bot's army holds two of the biome's special marbles (the kinds `run_foes` deals there). The meadow keeps the plain army.
import type { Axial } from './board';
import { BIOMES, type Biome } from './openworld';

/** The special marble each biome's foes hold (the bridge's kind codes, as `run_foes` deals them): none in the meadow. */
export const WILD_KIND: Readonly<Record<Biome, number>> = { meadow: 0, forest: 2, tundra: 8, desert: 3, badlands: 1, archipelago: 7 };
/** How many of them a wild army holds. */
export const WILD_SPECIALS = 2;

/** The bot's army of a wild fight in `biome` for `Engine.with_foes`: `count` marbles in the standard formation, the biome stood on the board,
 * and its special marbles on the first cells of `white` (the bot's cells of that army); in the meadow, the plain count (`with_army`). */
export function wildPlan(biome: Biome, count: number, white: readonly Axial[]): number | number[] {
  const kind = WILD_KIND[biome];
  if (!kind) return count;
  return [count, 0, BIOMES.indexOf(biome), ...white.slice(0, WILD_SPECIALS).flatMap(([q, r]) => [q, r, kind])];
}
