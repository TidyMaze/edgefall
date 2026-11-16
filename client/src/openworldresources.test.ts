import { describe, expect, it } from 'vitest';
import {
  addResources,
  BIOME_RESOURCE,
  breakYield,
  decodeArmy,
  decodeResources,
  ejectYield,
  lairYield,
  logYield,
  NO_ARMY,
  NO_RESOURCES,
  ringOfCell,
  TUNE,
  resourceLine,
  wildYield,
} from './openworldresources';

// The resources of the Open world (#1655, Decision #1654, docs/specs/openworld.md section 19): what each source gives, as pure numbers.
describe('what a source gives (#1655)', () => {
  it('a tree gives wood and a boulder ore, twice in the biomes that grow them', () => {
    expect(breakYield('tree', 'meadow')).toEqual({ ...NO_RESOURCES, wood: TUNE.tree });
    expect(breakYield('tree', 'forest')).toEqual({ ...NO_RESOURCES, wood: 2 * TUNE.tree });
    expect(breakYield('boulder', 'meadow')).toEqual({ ...NO_RESOURCES, ore: TUNE.boulder });
    expect(breakYield('boulder', 'badlands')).toEqual({ ...NO_RESOURCES, ore: 2 * TUNE.boulder });
    expect(breakYield('boulder', 'forest')).toEqual({ ...NO_RESOURCES, ore: TUNE.boulder });
  });

  it('gives each biome its own resource: shards from the tundra\'s ice, parts from the desert\'s buried scrap (#1737)', () => {
    expect(breakYield('tree', 'tundra')).toEqual({ ...NO_RESOURCES, shards: TUNE.tree });
    expect(breakYield('boulder', 'tundra')).toEqual({ ...NO_RESOURCES, shards: TUNE.boulder });
    expect(breakYield('boulder', 'desert')).toEqual({ ...NO_RESOURCES, parts: TUNE.boulder });
    expect(breakYield('tree', 'desert')).toEqual({ ...NO_RESOURCES, parts: TUNE.tree });
    expect(BIOME_RESOURCE).toEqual({ forest: 'wood', badlands: 'ore', tundra: 'shards', desert: 'parts' });
  });

  it('every other terrain gives nothing', () => {
    expect(breakYield('wall', 'forest')).toEqual(NO_RESOURCES);
    expect(breakYield('peak', 'badlands')).toEqual(NO_RESOURCES);
  });

  it('the ring of a cell is the ring whose towers stand nearest its distance from the spawn: 1 to 5', () => {
    expect(ringOfCell([0, 0])).toBe(1);
    expect(ringOfCell([230, 0])).toBe(1);
    expect(ringOfCell([231, 0])).toBe(2);
    expect(ringOfCell([0, -285])).toBe(2);
    expect(ringOfCell([-100, -186])).toBe(3); // distance 286
    expect(ringOfCell([339, 0])).toBe(3);
    expect(ringOfCell([340, 0])).toBe(4);
    expect(ringOfCell([391, 0])).toBe(4);
    expect(ringOfCell([392, 0])).toBe(5);
    expect(ringOfCell([448, 0])).toBe(5);
  });

  it('an ejected enemy gives one part, two in rings 4 and 5; several give the sum', () => {
    expect(ejectYield([10, 10], 1)).toEqual({ ...NO_RESOURCES, parts: TUNE.eject });
    expect(ejectYield([10, 10], 3)).toEqual({ ...NO_RESOURCES, parts: 3 * TUNE.eject });
    expect(ejectYield([340, 0], 1)).toEqual({ ...NO_RESOURCES, parts: 2 * TUNE.eject });
    expect(ejectYield([0, 0], 0)).toEqual(NO_RESOURCES);
  });

  it('a wild fight won gives three parts, doubled in rings 4 and 5', () => {
    expect(wildYield([10, 10])).toEqual({ ...NO_RESOURCES, parts: 3 });
    expect(wildYield([0, -300])).toEqual({ ...NO_RESOURCES, parts: 3 });
    expect(wildYield([0, -350])).toEqual({ ...NO_RESOURCES, parts: 6 });
    expect(wildYield([-440, 0])).toEqual({ ...NO_RESOURCES, parts: 6 });
  });

  it('a tower or lair beaten gives five shards and a lore log found one', () => {
    expect(lairYield()).toEqual({ ...NO_RESOURCES, shards: 5 });
    expect(logYield()).toEqual({ ...NO_RESOURCES, shards: 1 });
  });
});

describe('the counts (#1655)', () => {
  it('adds two counts field by field, leaving both alone', () => {
    const a = { wood: 1, ore: 2, parts: 3, shards: 4 };
    expect(addResources(a, { ...NO_RESOURCES, parts: 3, shards: 1 })).toEqual({ wood: 1, ore: 2, parts: 6, shards: 5 });
    expect(a.parts).toBe(3);
  });

  it('says them on one line for the plate', () => {
    expect(resourceLine({ wood: 12, ore: 7, parts: 20, shards: 2 })).toBe('Wood 12 · Ore 7 · Parts 20 · Shards 2');
    expect(resourceLine(NO_RESOURCES)).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 0');
  });

  it('decodes a saved count, none for a record saved before them, and refuses anything that is not four whole numbers from 0', () => {
    expect(decodeResources(undefined)).toEqual(NO_RESOURCES);
    expect(decodeResources({ wood: 1, ore: 2, parts: 3, shards: 4 })).toEqual({ wood: 1, ore: 2, parts: 3, shards: 4 });
    for (const bad of [null, 5, 'x', {}, { wood: 1, ore: 2, parts: 3 }, { wood: -1, ore: 0, parts: 0, shards: 0 }, { wood: 1.5, ore: 0, parts: 0, shards: 0 }, { wood: '1', ore: 0, parts: 0, shards: 0 }, { wood: 0, ore: 0, parts: 0, shards: 1e12 }]) {
      expect(decodeResources(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the army, empty until the Workshop (#1655)', () => {
  it('starts empty: no special marble owned or brought, no relic', () => {
    expect(NO_ARMY).toEqual({ specials: [], brought: [], relics: [], relicsBrought: [] });
    expect(decodeArmy(undefined)).toEqual(NO_ARMY);
    expect(decodeArmy(undefined)).not.toBe(NO_ARMY);
  });

  it('decodes a saved army, and refuses a wrong shape, a code that is not a whole number or more than the army holds', () => {
    const army = { specials: [1, 1, 3], brought: [1, 3], relics: [0, 4], relicsBrought: [4] };
    expect(decodeArmy(army)).toEqual(army);
    const bad = [
      null,
      7,
      {},
      { ...army, specials: 'x' },
      { ...army, brought: [1.5] },
      { ...army, relics: [-1] },
      { ...army, specials: [1, 1, 1, 1, 1, 1, 1] },
      { ...army, brought: [1, 1, 1, 1, 1] },
      { ...army, relicsBrought: [0, 1, 2] },
      { ...army, relics: Array.from({ length: 101 }, () => 0) },
    ];
    for (const b of bad) expect(decodeArmy(b), JSON.stringify(b)).toBeNull();
  });
});
