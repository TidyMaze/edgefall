// The outer biomes (#1741, #1755): where a large-scale noise field of the cell is high, each biome turns to a harsher one, so the land
// has patches of the newer look: 12 biomes to see. The field is a pure function of the cell, the same for every player and every seed,
// with no centre. A look only: the rules (the props' breaks, the wild marbles, the resources) stay the biome's, and the generated
// world and its saves are unchanged.
import * as THREE from 'three';
import type { Biome } from './openworld';

/** The field is above this where a biome is its outer one: a little under half the map. */
export const OUTER_ABOVE = 0.52;
/** The scales of the field's two levels, in cells, and the weight of the first. */
const OUTER_SCALES = [160, 56] as const;
const OUTER_WEIGHT = 0.65;

/** A hash of a lattice point to [0, 1). */
function lattice(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise at `scale` cells with a smoothstep between the lattice points. */
function valueNoise(q: number, r: number, scale: number): number {
  const [x, y] = [Math.floor(q / scale), Math.floor(r / scale)];
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const [tx, ty] = [smooth((q - x * scale) / scale), smooth((r - y * scale) / scale)];
  const top = lattice(x, y) + (lattice(x + 1, y) - lattice(x, y)) * tx;
  const bottom = lattice(x, y + 1) + (lattice(x + 1, y + 1) - lattice(x, y + 1)) * tx;
  return top + (bottom - top) * ty;
}

/** The outer field at the cell `(q, r)`, from 0 to 1. */
export const outerField = (q: number, r: number): number => OUTER_WEIGHT * valueNoise(q, r, OUTER_SCALES[0]) + (1 - OUTER_WEIGHT) * valueNoise(q, r, OUTER_SCALES[1]);

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

const outer = (q: number, r: number): boolean => outerField(q, r) > OUTER_ABOVE;

/** The name of the biome the cell `(q, r)` of `biome` shows: the outer one where the field is high. */
export const ringName = (biome: Biome, q: number, r: number): string => (outer(q, r) ? OUTER[biome].name : NAMES[biome]);

/** `colour` of the cell `(q, r)` of `biome`, leaned toward its outer biome's where the field is high. */
export function ringTint(colour: number, biome: Biome, q: number, r: number): number {
  return outer(q, r) ? new THREE.Color(colour).lerp(new THREE.Color(OUTER[biome].colour), OUTER[biome].share).getHex() : colour;
}
