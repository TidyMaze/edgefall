// The resources of the Open world (#1655, Decision #1654, docs/specs/openworld.md section 19): wood, ore, parts and shards, gathered from what the hero
// already does in the world. This holds the numbers alone and imports nothing that loads the engine, so the MCP server (mcp/src/world.ts) uses it too.
import type { Axial } from './board';
import type { Biome, Terrain } from './openworld';

/** What the world's own actions have gathered, saved with the world. */
export interface Resources {
  wood: number;
  ore: number;
  parts: number;
  shards: number;
}

/** The army the Workshop will hold (slice 2 of #1655): the special marbles owned and brought, the relics owned and brought, as codes of the engine.
 * It is saved from record 8 on, empty, so the Workshop does not bump the record again. */
export interface Army {
  specials: number[];
  brought: number[];
  relics: number[];
  relicsBrought: number[];
}

export const NO_RESOURCES: Resources = { wood: 0, ore: 0, parts: 0, shards: 0 };
export const NO_ARMY: Army = { specials: [], brought: [], relics: [], relicsBrought: [] };

/** The numbers of the yields (TUNE): what a source gives, and the factor of the biome or the ring that doubles it. */
export const TUNE = { tree: 1, boulder: 1, eject: 1, wild: 3, tower: 5, log: 1, bonus: 2 } as const;
/** The distance from the spawn where the ring 2, 3, 4 and 5 start: halfway between the medians of the towers of two rings (openworld.md section 15). */
const RING_FROM = [231, 286, 340, 392] as const;
/** The rings whose parts are doubled. */
const DEEP_RING = 4;

const MOST = 1_000_000_000; // a count a save may hold at most

/** The ring (1 to 5) of a cell: the ring whose towers stand nearest to its distance from the spawn. */
export function ringOfCell([q, r]: Axial): number {
  const distance = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  return 1 + RING_FROM.filter((from) => distance >= from).length;
}

const deep = (cell: Axial): number => (ringOfCell(cell) >= DEEP_RING ? TUNE.bonus : 1);

/** The resource each biome is known for (#1737): the forest's wood and the badlands' ore come twice from their own obstacle, the tundra's ice
 * gives shards and the desert's buried scrap parts, whatever breaks there; the meadow and the archipelago give the plain yield. */
export const BIOME_RESOURCE: Readonly<Partial<Record<Biome, keyof Resources>>> = { forest: 'wood', badlands: 'ore', tundra: 'shards', desert: 'parts' };

/** What breaking an obstacle of `terrain` in `biome` gives: wood from a tree, ore from a boulder, twice where the biome is known for it; the
 * tundra's shards and the desert's parts in their place (#1737). */
export function breakYield(terrain: Terrain, biome: Biome): Resources {
  if (terrain !== 'tree' && terrain !== 'boulder') return NO_RESOURCES;
  const plain = terrain === 'tree' ? 'wood' : 'ore';
  const own = BIOME_RESOURCE[biome];
  if (own === plain) return { ...NO_RESOURCES, [plain]: TUNE[terrain] * TUNE.bonus };
  return { ...NO_RESOURCES, [own === 'shards' || own === 'parts' ? own : plain]: TUNE[terrain] };
}

/** What `count` enemies ejected by a push of the troop at `cell` give: parts, twice in the rings 4 and 5. */
export const ejectYield = (cell: Axial, count: number): Resources => ({ ...NO_RESOURCES, parts: count * TUNE.eject * deep(cell) });

/** What a wild fight won gives, the marble starting on `home`: parts, twice in the rings 4 and 5. */
export const wildYield = (home: Axial): Resources => ({ ...NO_RESOURCES, parts: TUNE.wild * deep(home) });

/** What a tower or a lair beaten from the world gives. */
export const lairYield = (): Resources => ({ ...NO_RESOURCES, shards: TUNE.tower });

/** What a lore log found gives. */
export const logYield = (): Resources => ({ ...NO_RESOURCES, shards: TUNE.log });

/** The two counts added, field by field. */
export const addResources = (a: Resources, b: Resources): Resources => ({ wood: a.wood + b.wood, ore: a.ore + b.ore, parts: a.parts + b.parts, shards: a.shards + b.shards });

/** The plate's line of the counts. */
export const resourceLine = ({ wood, ore, parts, shards }: Resources): string => `Wood ${wood} · Ore ${ore} · Parts ${parts} · Shards ${shards}`;

const whole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MOST;

/** The counts in `raw`, none when a record is from before them (`undefined`); `null` when it is not four whole numbers from 0. */
export function decodeResources(raw: unknown): Resources | null {
  if (raw === undefined) return { ...NO_RESOURCES };
  if (typeof raw !== 'object' || raw === null) return null;
  const { wood, ore, parts, shards } = raw as Record<keyof Resources, unknown>;
  return whole(wood) && whole(ore) && whole(parts) && whole(shards) ? { wood, ore, parts, shards } : null;
}

/** The most the army holds: 6 special marbles owned, 3 brought to a fight (4 with the Quartermaster), 2 relics brought, any number of relics (the
 * rogue-lite has 12). */
const LIMITS: Record<keyof Army, number> = { specials: 6, brought: 4, relics: 100, relicsBrought: 2 };

/** The army in `raw`, empty when a record is from before it (`undefined`); `null` when it is not four lists of codes within the limits. */
export function decodeArmy(raw: unknown): Army | null {
  if (raw === undefined) return { specials: [], brought: [], relics: [], relicsBrought: [] };
  if (typeof raw !== 'object' || raw === null) return null;
  const army = raw as Record<keyof Army, unknown>;
  for (const key of Object.keys(LIMITS) as (keyof Army)[]) {
    const list = army[key];
    if (!Array.isArray(list) || list.length > LIMITS[key] || !list.every(whole)) return null;
  }
  return { specials: [...(army.specials as number[])], brought: [...(army.brought as number[])], relics: [...(army.relics as number[])], relicsBrought: [...(army.relicsBrought as number[])] };
}
