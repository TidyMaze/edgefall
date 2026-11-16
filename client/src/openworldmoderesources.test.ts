// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './test/openworldwasm';
import { world_chunk } from 'edgefall-wasm';
import { CHUNK } from './openworld';
import { FightState } from './openworldfight';
import { DEFAULT_YAW, OpenWorldMode } from './openworldmode';
import { worldSaves } from './openworldsave';
import { memoryStore } from './savegame';
import { stopLeftIntervalsAfterEach } from './test/intervals';
stopLeftIntervalsAfterEach();

// The resources of the Open world mode (#1655, Decision #1654, docs/specs/openworld.md section 19). Seed 1: the hero on (0, 2) steps ArrowLeft onto
// (0, 1), a boulder of the meadow. `made` is the same world with that cell given another terrain and biome.
const TERRAIN = { tree: 6, boulder: 5 } as const;
const BIOME = { meadow: 0, forest: 1, tundra: 2, desert: 3, badlands: 4 } as const;
const made = (terrain: keyof typeof TERRAIN, biome: keyof typeof BIOME) => (seed: number, cx: number, cy: number): Uint8Array => {
  const out = world_chunk(seed, cx, cy).slice();
  if (cx === 0 && cy === 0) out.set([out[(1 * CHUNK + 0) * 3]!, TERRAIN[terrain], BIOME[biome]], (1 * CHUNK + 0) * 3);
  return out;
};
const real = (seed: number, cx: number, cy: number): Uint8Array => world_chunk(seed, cx, cy);
const nobody = (): Int32Array => new Int32Array();
const mode = (load = made('boulder', 'meadow'), saves = worldSaves(memoryStore(), 1)) =>
  new OpenWorldMode(load, nobody, async () => ({ low: {}, high: {} }), () => true, saves);
const body = () => document.body.dataset;
const line = () => document.getElementById('openworld-resources')!;
const tap = (m: OpenWorldMode, key: string): void => {
  m.key(key);
  m.release(key);
};
const beside = (m: OpenWorldMode): OpenWorldMode => {
  m.enter(1, 800, 600);
  m.fixture({ hero: [0, 2], troop: [], enemies: [] });
  return m;
};
const settle = () => new Promise((done) => setTimeout(done));

beforeEach(() => {
  document.body.innerHTML = '<p id="openworld-resources"></p>';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  for (const key of Object.keys(body())) delete body()[key];
});

describe('the hero gathers from what it breaks (#1655)', () => {
  it('a new world has none, and the plate says so', () => {
    const m = mode();
    m.enter(1, 800, 600);
    expect(line().textContent).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 0');
    expect(body().openworldResources).toBe('0,0,0,0');
  });

  it.each([
    ['boulder', 'meadow', 'Wood 0 · Ore 1 · Parts 0 · Shards 0', '0,1,0,0'],
    ['boulder', 'desert', 'Wood 0 · Ore 0 · Parts 1 · Shards 0', '0,0,1,0'], // the desert's buried scrap (#1737)
    ['boulder', 'tundra', 'Wood 0 · Ore 0 · Parts 0 · Shards 1', '0,0,0,1'], // the tundra's ice (#1737)
    ['boulder', 'badlands', 'Wood 0 · Ore 2 · Parts 0 · Shards 0', '0,2,0,0'],
    ['tree', 'meadow', 'Wood 1 · Ore 0 · Parts 0 · Shards 0', '1,0,0,0'],
    ['tree', 'forest', 'Wood 2 · Ore 0 · Parts 0 · Shards 0', '2,0,0,0'],
  ] as const)('a %s broken in the %s is counted on the plate: %s', (terrain, biome, text, data) => {
    const m = beside(mode(made(terrain, biome)));
    tap(m, 'ArrowLeft');
    expect(body().openworldBroken).toBe('1');
    expect(line().textContent).toBe(text);
    expect(body().openworldResources).toBe(data);
  });

  it('a step that breaks nothing gathers nothing', () => {
    const m = beside(mode());
    tap(m, 'ArrowRight');
    expect(body().openworldResources).toBe('0,0,0,0');
  });

  it('a marble the troop ejects gives a part (seed 1, the shove of the recruits)', () => {
    const m = mode(real);
    m.enter(1, 800, 600);
    m.fixture({ hero: [11, -29], troop: [], enemies: [[12, -30]] });
    tap(m, 'ArrowLeft');
    expect(body().openworldBeaten).toBe('1');
    expect(line().textContent).toBe('Wood 0 · Ore 0 · Parts 1 · Shards 0');
  });

  it('a push that ejects nothing gives no part', () => {
    const m = mode(real);
    m.enter(1, 800, 600);
    m.fixture({ hero: [11, -29], troop: [], enemies: [[40, 40]] });
    tap(m, 'ArrowLeft');
    expect(body().openworldResources).toBe('0,0,0,0');
  });

  it('leaving the world clears the count and the plate line', () => {
    const m = beside(mode());
    tap(m, 'ArrowLeft');
    m.leave();
    expect(body().openworldResources).toBeUndefined();
    expect(line().textContent).toBe('');
  });
});

describe('what is gathered is saved with the world, and is gathered once (#1655)', () => {
  it('a reload keeps the count, and the broken cell yields nothing a second time', async () => {
    const saves = worldSaves(memoryStore(), 1);
    const first = beside(mode(made('boulder', 'badlands'), saves));
    tap(first, 'ArrowLeft');
    first.frame(vi.fn());
    await settle();
    expect((await saves.load(1))!.resources).toEqual({ wood: 0, ore: 2, parts: 0, shards: 0 });
    first.leave();
    const again = mode(made('boulder', 'badlands'), saves);
    await again.open(1, 800, 600);
    expect(line().textContent).toBe('Wood 0 · Ore 2 · Parts 0 · Shards 0');
    again.fixture({ hero: [0, 2], troop: [], enemies: [] });
    tap(again, 'ArrowLeft'); // the cell is broken ground now
    tap(again, 'ArrowRight');
    tap(again, 'ArrowLeft');
    expect(line().textContent).toBe('Wood 0 · Ore 2 · Parts 0 · Shards 0');
  });

  it('a save of record 7 opens with zero resources', async () => {
    const store = memoryStore();
    store.data.set('openworld:1', { record: 7, version: 1, seed: 1, hero: [0, 0], troop: [], fight: { removed: [], added: [], beaten: 0 }, yaw: 0, broken: [], lairs: [], discovered: [], time: 0, logs: [], recruits: 0, savedAt: 1 });
    const m = mode(made('boulder', 'meadow'), worldSaves(store, 1));
    await m.open(1, 800, 600);
    expect(line().textContent).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 0');
  });

  it('keeps the army of the save, empty, so the next save does not lose it', async () => {
    const saves = worldSaves(memoryStore(), 1);
    const army = { specials: [1], brought: [1], relics: [], relicsBrought: [] };
    await saves.put(1, [0, 2], [], new FightState(), DEFAULT_YAW, [], [], [], 0, [], 0, { wood: 4, ore: 0, parts: 0, shards: 0 }, army);
    const m = mode(made('tree', 'meadow'), saves);
    await m.open(1, 800, 600);
    m.fixture({ hero: [0, 2], troop: [], enemies: [] });
    tap(m, 'ArrowLeft');
    m.frame(vi.fn());
    await settle();
    const back = (await saves.load(1))!;
    expect(back.army).toEqual(army);
    expect(back.resources.wood).toBe(5);
  });
});

describe('the fixture loads the stock of the Workshop (#1655)', () => {
  it('sets the resources and the army, the plate says the counts, and the world saves them', async () => {
    const saves = worldSaves(memoryStore(), 1);
    const m = mode(made('boulder', 'meadow'), saves);
    await m.open(1, 800, 600);
    const army = { specials: [1, 9], brought: [9], relics: [], relicsBrought: [] };
    m.fixture({ hero: [0, 2], troop: [], enemies: [], resources: { wood: 3, ore: 4, parts: 5, shards: 6 }, army });
    expect(line().textContent).toBe('Wood 3 · Ore 4 · Parts 5 · Shards 6');
    m.frame(vi.fn());
    await settle();
    const back = (await saves.load(1))!;
    expect([back.resources, back.army]).toEqual([{ wood: 3, ore: 4, parts: 5, shards: 6 }, army]);
    m.fixture({ hero: [0, 2], troop: [], enemies: [], army: { ...army, brought: [] } }); // the army alone keeps the resources
    expect(body().openworldResources).toBe('3,4,5,6');
    m.fixture({ hero: [0, 2], troop: [], enemies: [], resources: { wood: 1, ore: 1, parts: 1, shards: 1 } }); // the resources alone keep the army
    expect(body().openworldResources).toBe('1,1,1,1');
  });
});

describe('a lore log found gives a shard, once (#1655)', () => {
  it('the first time only', () => {
    const none = Array.from({ length: 11 }, () => undefined) as [];
    const grass = (_seed: number, cx: number, cy: number): Uint8Array => {
      if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
      const out = new Uint8Array(CHUNK * CHUNK * 3);
      for (let i = 0; i < CHUNK * CHUNK; i++) out.set([2, 2, 0], i * 3);
      return out;
    };
    document.body.innerHTML += '<div id="openworld-log" hidden><h2 id="openworld-log-title"></h2><p id="openworld-log-body"></p></div>';
    const m = new OpenWorldMode(grass, nobody, async () => ({ low: {}, high: {} }), () => true, worldSaves(memoryStore(), 1), ...none, () => Int32Array.of(4, 0, 0, 5), vi.fn());
    m.enter(7, 800, 600);
    m.fixture({ hero: [3, 0], troop: [], enemies: [] });
    tap(m, 'ArrowRight');
    expect(body().openworldLogsFound).toBe('0');
    expect(line().textContent).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 1');
    tap(m, 'ArrowLeft');
    tap(m, 'ArrowRight'); // the same log again
    expect(line().textContent).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 1');
  });
});
