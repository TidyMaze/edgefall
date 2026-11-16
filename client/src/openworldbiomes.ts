// The biomes as the player meets them (#1742): a line naming the biome entered and what is left there. Tower `k` stands in the biome `k mod 6`
// (the sextant order of `BIOMES`, openworld.md section 7), and so does lore log `k` (section 12).
import { BIOMES, type Biome } from './openworld';

const NAMES: Readonly<Record<Biome, string>> = { meadow: 'Meadow', forest: 'Forest', tundra: 'Tundra', desert: 'Desert', badlands: 'Badlands', archipelago: 'Archipelago' };

/** The name of `biome`, then its towers beaten of `towers` (`beaten` the numbers beaten) and its logs found of `logs` (`found`); the name alone when it holds none. */
export function biomeLine(biome: Biome, towers: number, beaten: readonly number[], logs: number, found: readonly number[], name: string = NAMES[biome]): string {
  const at = BIOMES.indexOf(biome);
  const here = (n: number): number[] => Array.from({ length: n }, (_, k) => k).filter((k) => k % 6 === at);
  const mine = here(towers);
  const notes = here(logs);
  if (mine.length + notes.length === 0) return name;
  return `${name} · towers ${mine.filter((k) => beaten.includes(k)).length}/${mine.length} · logs ${notes.filter((k) => found.includes(k)).length}/${notes.length}`;
}
