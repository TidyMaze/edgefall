// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import './test/openworldwasm';
import { world_chunk, world_lairs, world_logs } from 'edgefall-wasm';
import { BIOMES, CHUNK, type Biome } from './openworld';
import { biomeLine } from './openworldbiomes';

// #1742, #1755: entering a biome names it and tells what is left there: the towers beaten of its own and the logs found, counted from the
// biome of each cell (the world tile), since tower `k` of the roster stands on the cell its tier gives it, not in the biome `k mod 6`.
const biomeAt = (seed: number, [q, r]: [number, number]): Biome => {
  const [cx, cy] = [Math.floor(q / CHUNK), Math.floor(r / CHUNK)];
  return BIOMES[world_chunk(seed, cx, cy)[((r - cy * CHUNK) * CHUNK + (q - cx * CHUNK)) * 3 + 2]!]!;
};
const cells = (flat: Int32Array): [number, number][] => Array.from({ length: flat.length / 2 }, (_, i): [number, number] => [flat[2 * i]!, flat[2 * i + 1]!]);

describe('the line of a biome (#1742)', () => {
  it('names the biome and counts its towers beaten and its logs found', () => {
    // 15 towers, 12 logs: k = 1, 7, 13 and 1, 7 in the forest
    const by6 = (n: number): Biome[] => Array.from({ length: n }, (_, k) => BIOMES[k % 6]!);
    expect(biomeLine('forest', by6(15), [1, 2, 13], by6(12), [7])).toBe('Forest · towers 2/3 · logs 1/2');
    expect(biomeLine('archipelago', by6(15), [], by6(12), [])).toBe('Archipelago · towers 0/2 · logs 0/2');
    expect(biomeLine('meadow', [], [], [], [])).toBe('Meadow');
    expect(biomeLine('forest', by6(15), [], by6(12), [], 'Jungle')).toBe('Jungle · towers 0/3 · logs 0/2'); // the outer ring's name (#1741)
    expect(biomeLine('forest', ['desert', undefined, 'forest'], [2], [undefined, 'forest'], [1])).toBe('Forest · towers 1/1 · logs 1/1'); // a log with no cell counts nowhere
  });

  it('counts the real towers and logs of a world by the biome of their cells: the roster is three, three, three, two, two, two and the logs two a biome', () => {
    for (const seed of [1, 2, 3, 7]) {
      const towers = cells(world_lairs(seed)).map((c) => biomeAt(seed, c));
      const logs = cells(world_logs(seed)).map((c) => biomeAt(seed, c));
      expect(towers).toHaveLength(15);
      for (const biome of BIOMES) {
        const line = biomeLine(biome, towers, [], logs, []);
        expect(line, `${biome} of seed ${seed}`).toMatch(/ · towers [0-9]\/([23]) · logs 0\/2$/);
      }
      expect(logs.every((b, k) => b === BIOMES[k % 6])).toBe(true); // the engine draws log k in biome k mod 6
      expect(towers.map((_, k) => k).filter((k) => biomeLine(BIOMES[k % 6]!, towers, [k], logs, [])).length).toBe(15);
      const counts = BIOMES.map((b) => towers.filter((t) => t === b).length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(15);
      expect(counts.every((c) => c === 2 || c === 3)).toBe(true);
    }
  });
});
