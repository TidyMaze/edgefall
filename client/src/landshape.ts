// The land's drawn relief (#1718) and the places that shape it (#1719), drawn only: the levels, the walk and the rules stay the engine's.
// A tabletop diorama terraformed by its landmarks: a tower stands on a mound, a dungeon gate in a hollow, a teleporter or a town's light
// pools its colour on the cells round it. Pure functions of the cells and the landmark list: the same picture for every player.
import * as THREE from 'three/webgpu';
import type { Axial } from './board';
import type { Biome } from './openworld';
import { hexDistance } from './worldpeers';

/** The rise inside a level (#1718): a smooth bump over the land, up to `height`, its hills about `span` cells apart, so the cells of one
 * level read as slopes, not as one flat step. Under a step of the relief, so a level never reads above the next. */
export const RELIEF = { height: 0.5, span: 5, terrace: 0.3 } as const; // under STEP (0.6): a level's highest cell stays under the next level's lowest
/** How much lower the coast's sand stands than its level (#1732): half a step, a beach by the water. */
export const BEACH = 0.3;

/** The three shapes (#1719), in rings round the landmark: `reach` rings, the lift (world units) at the landmark, and the colour share. */
export const MOUND = { reach: 3, lift: 1.1, colour: 0x6f7480, share: 0.45 } as const;
export const HOLLOW = { reach: 2, lift: -1, colour: 0x120f0c, share: 0.6 } as const;
export const POOL = { reach: 2, share: 0.32 } as const;

export interface Landmarks {
  lairs: readonly Axial[];
  gates: readonly Axial[];
  lights: readonly { cell: Axial; colour: THREE.ColorRepresentation }[]; // teleporters and towns
}

/** What a landmark does to one cell: its lift and the colour its top leans to, by `share` (0 to 1). */
export interface Shaping {
  lift: number;
  colour: THREE.ColorRepresentation;
  share: number;
}

const key = (q: number, r: number): string => `${q},${r}`;

/** A stable 0 to 1 draw per lattice point (the same hash family as the cells' own lift, #1418). */
function lattice(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x2c1b3c6d) ^ Math.imul(j | 0, 0x297a2d39);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}
const ease = (t: number): number => t * t * (3 - 2 * t);

/** The rise of the cell `(q, r)` inside its level, from 0 to `RELIEF.height`: value noise on a lattice `span` cells wide, eased between
 * its points, so neighbours differ by little and a hill spans a few cells. */
/** The terrace of a cell inside its level (#1732): none or half a step up, where the relief passes its middle, so each level of the engine
 * reads as two flat terraces (sixteen in all instead of eight). */
export function terrace(q: number, r: number, biome?: Biome): number {
  const look = biome ? BIOME_RELIEF[biome] : PLAIN;
  if (look.dunes) return Math.sin((q + r * 0.5) * 1.6 + relief(q, r, 6) * 6) > 0 ? RELIEF.terrace : 0; // bands across q, bent by the relief
  return relief(q, r, look.span) >= RELIEF.height * look.at ? RELIEF.terrace : 0;
}
/** Each biome's relief signature (#1735), on the same two terraces: the lattice's width (wider: wider hills) and the share of the relief
 * under the upper terrace (higher: more low ground), or dunes in bands. */
const PLAIN = { span: RELIEF.span, at: 0.5, dunes: false };
export const BIOME_RELIEF: Readonly<Record<Biome, { span: number; at: number; dunes: boolean }>> = {
  meadow: { span: 9, at: 0.5, dunes: false }, // wide rolling hills
  forest: { span: 3, at: 0.5, dunes: false }, // tight rises under the trees
  tundra: { span: 4, at: 0.66, dunes: false }, // low ground cut by ridges
  desert: { span: 6, at: 0.5, dunes: true }, // dunes in bands
  badlands: { span: 10, at: 0.36, dunes: false }, // wide plateaus, few low cuts
  archipelago: PLAIN,
};

export function relief(q: number, r: number, span: number = RELIEF.span): number {
  const x = q / span;
  const y = r / span;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = ease(x - i);
  const v = ease(y - j);
  const top = lattice(i, j) + (lattice(i + 1, j) - lattice(i, j)) * u;
  const bottom = lattice(i, j + 1) + (lattice(i + 1, j + 1) - lattice(i, j + 1)) * u;
  return (top + (bottom - top) * v) * RELIEF.height;
}

/** The cells the landmarks shape, each by its nearest landmark (a tie goes to the tower, then the gate, then the light). A mound and a
 * hollow fall off as the square of the rings, so the slope is steep near the landmark and soft at its edge; a pool fades evenly. */
export function shapeLand(marks: Landmarks): Map<string, Shaping> {
  const shaped = new Map<string, { ring: number; shaping: Shaping }>();
  const spread = (centre: Axial, reach: number, shaping: (fade: number) => Shaping): void => {
    for (let dq = -reach; dq <= reach; dq++) {
      for (let dr = -reach; dr <= reach; dr++) {
        const cell: Axial = [centre[0] + dq, centre[1] + dr];
        const ring = hexDistance(centre, cell);
        if (ring > reach) continue;
        const k = key(cell[0], cell[1]);
        const was = shaped.get(k);
        if (was && was.ring <= ring) continue;
        shaped.set(k, { ring, shaping: shaping(1 - ring / (reach + 1)) });
      }
    }
  };
  for (const cell of marks.lairs) spread(cell, MOUND.reach, (f) => ({ lift: MOUND.lift * f * f, colour: MOUND.colour, share: MOUND.share * f }));
  for (const cell of marks.gates) spread(cell, HOLLOW.reach, (f) => ({ lift: HOLLOW.lift * f * f, colour: HOLLOW.colour, share: HOLLOW.share * f }));
  for (const { cell, colour } of marks.lights) spread(cell, POOL.reach, (f) => ({ lift: 0, colour, share: POOL.share * f }));
  return new Map([...shaped].map(([k, { shaping }]) => [k, shaping]));
}

/** The shaping of the cell `(q, r)` in `shaped`, or none. */
export const shapingAt = (shaped: ReadonlyMap<string, Shaping>, q: number, r: number): Shaping | undefined => shaped.get(key(q, r));

/** `colour` leaned toward the cell's shaping colour by its share. */
export function shadeTop(colour: number, shaping: Shaping | undefined): number {
  if (!shaping || shaping.share <= 0) return colour;
  return new THREE.Color(colour).lerp(new THREE.Color(shaping.colour), shaping.share).getHex();
}
