// The rings of the biomes (#1741): past `OUTER_RING` cells from the spawn each sextant's biome turns to a harsher one, so the further the
// hero goes the newer the land: 12 biomes to see. A look only: the rules (the props' breaks, the wild marbles, the resources) stay the
// sextant's biome's, and the generated world and its saves are unchanged.
import * as THREE from 'three';
import type { Biome } from './openworld';
import { hexDistance } from './worldpeers';

/** The distance from the spawn past which a biome is its outer one, in cells: about half the towers stand past it. */
export const OUTER_RING = 250;

const NAMES: Readonly<Record<Biome, string>> = { meadow: 'Meadow', forest: 'Forest', tundra: 'Tundra', desert: 'Desert', badlands: 'Badlands', archipelago: 'Archipelago' };

/** The outer biome of each: its name and the colour its ground and props lean to, by `share`. */
export const OUTER: Readonly<Record<Biome, { name: string; colour: number; share: number }>> = {
  meadow: { name: 'Steppe', colour: 0xb8a35a, share: 0.45 },
  forest: { name: 'Jungle', colour: 0x1f7a3a, share: 0.5 },
  tundra: { name: 'Crystal plain', colour: 0x9fd8ff, share: 0.5 },
  desert: { name: 'Salt flats', colour: 0xece6da, share: 0.55 },
  badlands: { name: 'Volcanic field', colour: 0x3a2a2a, share: 0.55 },
  archipelago: { name: 'Swamp', colour: 0x4a5a3a, share: 0.5 },
};

const outer = (q: number, r: number): boolean => hexDistance([0, 0], [q, r]) > OUTER_RING;

/** The name of the biome the cell `(q, r)` of `biome` shows: the outer one past the ring. */
export const ringName = (biome: Biome, q: number, r: number): string => (outer(q, r) ? OUTER[biome].name : NAMES[biome]);

/** `colour` of the cell `(q, r)` of `biome`, leaned toward its outer biome's past the ring. */
export function ringTint(colour: number, biome: Biome, q: number, r: number): number {
  return outer(q, r) ? new THREE.Color(colour).lerp(new THREE.Color(OUTER[biome].colour), OUTER[biome].share).getHex() : colour;
}
