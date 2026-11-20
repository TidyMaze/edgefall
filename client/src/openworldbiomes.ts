// The biomes as the player meets them (#1742): a line naming the biome entered and what is left there. The towers and the lore logs of a biome
// are counted from the biome of their own cell, read from the world tile (#1755: tower `k` of the roster is on the cell its tier gives it, so
// its biome is not `k mod 6`; the engine draws the logs in `BIOMES[k % 6]`, but the tile is the truth for both).
import type { Biome } from './openworld';

const NAMES: Readonly<Record<Biome, string>> = { meadow: 'Meadow', forest: 'Forest', tundra: 'Tundra', desert: 'Desert', badlands: 'Badlands', archipelago: 'Archipelago' };

/** The name of `biome`, then its towers beaten (`towers` the biome of each tower's cell by number, `beaten` the numbers beaten) and its logs
 * found (`logs` the biome of each log's cell, `found` the numbers found; `undefined` for a log with no cell); the name alone when it holds none. */
export function biomeLine(biome: Biome, towers: readonly (Biome | undefined)[], beaten: readonly number[], logs: readonly (Biome | undefined)[], found: readonly number[], name: string = NAMES[biome]): string {
  const here = (all: readonly (Biome | undefined)[]): number[] => all.flatMap((b, k) => (b === biome ? [k] : []));
  const mine = here(towers);
  const notes = here(logs);
  if (mine.length + notes.length === 0) return name;
  return `${name} · towers ${mine.filter((k) => beaten.includes(k)).length}/${mine.length} · logs ${notes.filter((k) => found.includes(k)).length}/${notes.length}`;
}
