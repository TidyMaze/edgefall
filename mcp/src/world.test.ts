import { describe, expect, test } from 'vitest';
import { Discovered, SIGHT } from '../../client/src/openworlddiscovered';
import { Hero, World } from '../../client/src/openworld';
import { FightState } from '../../client/src/openworldfight';
import { RECRUIT_MAX, recruitCell } from '../../client/src/openworldrecruit';
import { breakYield, NO_ARMY, NO_RESOURCES } from '../../client/src/openworldresources';
import { decodeWorld, RECORD, worldSaves } from '../../client/src/openworldsave';
import { memoryStore } from '../../client/src/savegame';
import { endingLine } from '../../client/src/tally';
import { MARBLES } from '../../client/src/trainer';
import { bossIds, worldRules } from './engine';
import type { Result, ToolError } from './game';
import { OpenWorld, type Outcome, type WorldSave, type WorldRules } from './world';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function failure(result: Result<unknown>): ToolError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** The real rules of the engine, with the lairs of the world put at `lairs` (q, r pairs) when given, and the game of `games`. */
function world(lairs?: number[], games?: { outcome(): Outcome | null }, pads?: number[]): OpenWorld {
  const rules: WorldRules = lairs ? { ...worldRules(), world_lairs: () => Int32Array.from(lairs) } : worldRules();
  return new OpenWorld(pads ? { ...rules, world_pads: () => Int32Array.from(pads) } : rules, bossIds, games);
}

const chunks = new Map<string, Uint8Array>();

/** The terrain code of the engine at a cell of seed `seed`, `-1` off the world. Chunks are read once. */
function code(seed: number, q: number, r: number): number {
  const cx = Math.floor(q / 16);
  const cy = Math.floor(r / 16);
  const key = `${seed},${cx},${cy}`;
  if (!chunks.has(key)) chunks.set(key, worldRules().world_chunk(seed, cx, cy));
  const cells = chunks.get(key)!;
  return cells.length === 0 ? -1 : cells[((r - cy * 16) * 16 + (q - cx * 16)) * 3 + 1]!;
}

/** The client's own run of a seed (no save): `Hero.step` then `FightState.troopPush`, as `OpenWorldMode.roll` calls them, for the moves `dirs`.
 * Cells as the MCP writes them. The fixtures of the tests below come from here, not from the MCP. */
function clientRun(seed: number, dirs: string[]): { hero: string; troop: string[] } {
  const rules = worldRules();
  const w = new World((cx, cy) => rules.world_chunk(seed, cx, cy), (cx, cy) => rules.world_enemies(seed, cx, cy));
  const fight = new FightState();
  const hero = new Hero(w, fight, seed);
  for (const d of dirs) {
    const [dq, dr] = STEPS[d]!;
    if (!hero.step([hero.at[0] + dq!, hero.at[1] + dr!])) throw new Error(`the client refuses ${d}`);
    const played = fight.troopPush(w, seed, [hero.at, ...hero.troop], w.broken, hero.tick);
    if (played) {
      const [at, ...troop] = played.push.troop;
      hero.at = at!;
      hero.troop = troop;
    }
  }
  return { hero: `(${hero.at[0]},${hero.at[1]})`, troop: hero.troop.map(([q, r]) => `(${q},${r})`) };
}

const SEEDS = Array.from({ length: 12 }, (_, seed) => seed);

const STEPS: Record<string, [number, number]> = { E: [1, 0], W: [-1, 0], NE: [1, -1], SW: [-1, 1], NW: [0, -1], SE: [0, 1] };

/** An open cell and a direction towards a cell of a terrain in `codes`, near the spawn of the world `seed`, found by the engine's own cells. */
function beside(
  seed: number,
  codes: number[],
  keep: (q: number, r: number) => boolean = () => true,
): { at: [number, number]; dir: string } | null {
  for (let r = -20; r <= 20; r++) {
    for (let q = -20; q <= 20; q++) {
      if (![1, 2, 3].includes(code(seed, q, r))) continue;
      for (const [dir, [dq, dr]] of Object.entries(STEPS)) {
        if (codes.includes(code(seed, q + dq, r + dr)) && keep(q + dq, r + dr)) return { at: [q, r], dir };
      }
    }
  }
  return null;
}

/** A world with the hero beside a cell of a terrain in `codes` (`beside`, `keep` made for the seed), on the first seed where the walk
 * there arrives: a push of the troop on the way can stop it. */
function standBeside(codes: number[], keep?: (seed: number) => (q: number, r: number) => boolean): { open: OpenWorld; spot: { at: [number, number]; dir: string } } {
  for (const seed of SEEDS) {
    const spot = beside(seed, codes, keep?.(seed));
    if (!spot) continue;
    const open = world();
    value(open.newWorld({ seed }));
    const [q, r] = spot.at;
    if (q !== 0 || r !== 0) open.walk({ q, r });
    if (value(open.state({})).hero === `(${q},${r})`) return { open, spot };
  }
  throw new Error(`no seed has the hero beside ${codes}`);
}

describe('before a world is started', () => {
  test('every tool says there is no world', () => {
    const open = world();
    for (const result of [open.state({}), open.step({ direction: 'E' }), open.walk({ q: 1, r: 0 }), open.teleport({ q: 2, r: -1 }), open.save()]) {
      expect(failure(result).code).toBe('no_world');
    }
  });
});

describe('a new world', () => {
  test('puts the hero on the spawn with the troop round it, and lists the lairs', () => {
    const open = world();
    const state = value(open.newWorld({ seed: 0 }));
    expect(state.seed).toBe(0);
    expect(state.hero).toBe('(0,0)');
    expect(state.troop).toHaveLength(15);
    expect(state.broken).toBe(0);
    expect(state.lairs).toHaveLength(15);
    expect(state.lairs[0]).toEqual({ boss: bossIds()[0], cell: '(185,-12)', distance: 185, beaten: false }); // the nearest tower is the Echo's (#1532)
    expect(Math.min(...state.lairs.map((lair: { distance: number }) => lair.distance))).toBe(185);
    expect(state.ending).toBeUndefined();
  });

  test('starts the troop as the client does: the same cells in the same order, for several seeds (#1504)', () => {
    const rules = worldRules();
    for (const seed of SEEDS) {
      const client = new Hero(new World((cx, cy) => rules.world_chunk(seed, cx, cy), (cx, cy) => rules.world_enemies(seed, cx, cy)), new FightState(), seed);
      const state = value(world().newWorld({ seed }));
      expect(state.troop).toEqual(client.troop.map(([q, r]) => `(${q},${r})`));
    }
  });

  test('the seed defaults to 0 and the same seed gives the same world', () => {
    const open = world();
    expect(value(open.newWorld({}))).toEqual(value(open.newWorld({ seed: 0 })));
    expect(value(open.newWorld({ seed: 7 })).lairs).not.toEqual(value(open.newWorld({ seed: 0 })).lairs);
  });

  test('the window is a hex of cells round the hero, one row per r', () => {
    const state = value(world().newWorld({ seed: 0 }));
    expect(state.window.radius).toBe(3);
    expect(state.window.rows.map((row) => [row.r, row.q0, row.cells.length])).toEqual([
      [-3, 0, 4],
      [-2, -1, 5],
      [-1, -2, 6],
      [0, -3, 7],
      [1, -3, 6],
      [2, -3, 5],
      [3, -3, 4],
    ]);
    const middle = state.window.rows[3]!.cells;
    expect(middle[3]).toBe('H');
    expect(middle[2]).toBe('T');
    expect(middle[4]).toBe('T');
    expect(middle[0]).toBe('g');
  });

  test('a larger radius widens the window', () => {
    const open = world();
    value(open.newWorld({ seed: 0 }));
    expect(value(open.state({ radius: 8 })).window.rows).toHaveLength(17);
  });

  test('a cell off the world is a question mark', () => {
    const rules: WorldRules = { ...worldRules(), world_chunk: (seed, cx, cy) => (cx < 0 ? new Uint8Array() : worldRules().world_chunk(seed, cx, cy)) };
    const open = new OpenWorld(rules, bossIds);
    const rows = value(open.newWorld({ seed: 0 })).window.rows;
    expect(rows[3]!.cells).toBe('???HTTg');
  });

  test('a cell past the edge, in a chunk the edge crosses, is a question mark (#1440)', () => {
    // The chunks west of the spawn hold only cells past the edge: the bridge's off-the-world byte, 255.
    const edge = new Uint8Array(16 * 16 * 3).map((_, i) => (i % 3 === 1 ? 255 : 0));
    const rules: WorldRules = { ...worldRules(), world_chunk: (seed, cx, cy) => (cx < 0 ? edge : worldRules().world_chunk(seed, cx, cy)) };
    const open = new OpenWorld(rules, bossIds);
    const rows = value(open.newWorld({ seed: 0 })).window.rows;
    expect(rows[3]!.cells).toBe('???HTTg');
    const error = failure(open.step({ direction: 'W' }));
    expect(error.message).toContain('off the world');
  });
});

describe('a step', () => {
  test('rolls the hero onto the open cell, the troop flocks round it', () => {
    const open = world();
    value(open.newWorld({ seed: 0 }));
    const moved = value(open.step({ direction: 'E' }));
    expect(moved.moved).toBe(true);
    expect(moved.push).toBeNull();
    expect(moved.state.hero).toBe('(1,0)');
    expect(moved.state.beaten).toBe(0);
    expect(moved.state.troop).toEqual(clientRun(0, ['E']).troop);
    expect(value(open.state({})).hero).toBe('(1,0)');
  });

  test('a cell the hero cannot enter refuses the step and changes nothing', () => {
    const { open, spot } = standBeside([4, 7]);
    const [q, r] = spot.at;
    const before = value(open.state({}));
    const error = failure(open.step({ direction: spot.dir as 'E' }));
    expect(error.code).toBe('blocked');
    expect(value(open.state({}))).toEqual(before);
  });

  test('the hero sails onto water like onto open ground, the troop flocks round it (#1441)', () => {
    const { open, spot } = standBeside([0]);
    const [q, r] = spot.at;
    const [dq, dr] = STEPS[spot.dir]!;
    const moved = value(open.step({ direction: spot.dir as 'E' }));
    expect(moved.moved).toBe(true);
    expect(moved.push).toBeNull();
    expect(moved.state.hero).toBe(`(${q + dq},${r + dr})`);
    expect(moved.state.troop).not.toContain(moved.state.hero);
  });

  test('a boulder is broken by rolling into it and the cell is rock after', () => {
    const { open, spot } = standBeside([5]);
    const [q, r] = spot.at;
    const broken = value(open.state({})).broken;
    const moved = value(open.step({ direction: spot.dir as 'E' }));
    expect(moved.smashed).toBe('boulder');
    expect(moved.state.broken).toBe(broken + 1);
    const [dq, dr] = STEPS[spot.dir]!;
    expect(moved.state.hero).toBe(`(${q + dq},${r + dr})`);
    const here = value(open.state({ radius: 1 })).window.rows.find((row) => row.r === r + dr)!;
    expect(here.cells).toContain('H');
    expect(value(open.step({ direction: spot.dir as 'E' })).smashed).toBeNull();
  });

  test('a tree with no tree beside it is broken, the cell is grass after', () => {
    const lone = (seed: number) => (q: number, r: number) => Object.values(STEPS).every(([dq, dr]) => code(seed, q + dq, r + dr) !== 6);
    const { open, spot } = standBeside([6], lone);
    const [q, r] = spot.at;
    const broken = value(open.state({})).broken;
    const moved = value(open.step({ direction: spot.dir as 'E' }));
    expect(moved.smashed).toBe('tree');
    expect(moved.state.broken).toBe(broken + 1);
    const [dq, dr] = STEPS[spot.dir]!;
    // Walk 8 cells away, along the first line that is open, so the troop has left the cell: it shows as grass.
    const away = Object.values(STEPS).map(([sq, sr]) => open.walk({ q: q + dq + 8 * sq, r: r + dr + 8 * sr })).find((walk) => walk.ok);
    expect(away).toBeTruthy();
    const left = value(open.state({ radius: 8 })).window.rows.find((row) => row.r === r + dr)!;
    expect(left.cells[q + dq - left.q0]).toBe('g');
  });

  test('a tree next to another tree is broken too (#1510)', () => {
    const crowded = (seed: number) => (q: number, r: number) => Object.values(STEPS).some(([dq, dr]) => code(seed, q + dq, r + dr) === 6);
    const { open, spot } = standBeside([6], crowded);
    expect(value(open.step({ direction: spot.dir as 'E' })).smashed).toBe('tree');
  });

  test('a cell off the world refuses the step', () => {
    const rules: WorldRules = { ...worldRules(), world_path: () => new Int32Array() };
    const open = new OpenWorld({ ...rules, world_chunk: () => new Uint8Array() }, bossIds);
    value(open.newWorld({ seed: 0 }));
    const error = failure(open.step({ direction: 'W' }));
    expect(error.message).toContain('off the world');
  });

  test('onto a lair does not move: the state names the boss to fight and how to start it', () => {
    const open = world([3, 0, 0, 9, 0, -9]);
    value(open.newWorld({ seed: 0 }));
    value(open.walk({ q: 2, r: 0 }));
    const entered = value(open.step({ direction: 'E' }));
    expect(entered.moved).toBe(false);
    expect(entered.push).toBeNull();
    expect(entered.lair).toEqual({ index: 0, boss: bossIds()[0], start: `new_game {"boss":"${bossIds()[0]}"}` });
    expect(entered.state.hero).toBe('(2,0)');
    expect(value(open.step({ direction: 'W' })).lair).toBeUndefined();
  });

  test('a lair past the roster is the boss of its number round the roster, as in the client', () => {
    const far = Array.from({ length: bossIds().length }, (_, k) => [100 + k, -200]).flat();
    const open = world([...far, 1, 0]);
    value(open.newWorld({ seed: 0 }));
    expect(value(open.step({ direction: 'E' })).lair).toMatchObject({ index: bossIds().length, boss: bossIds()[0] });
  });
});

describe('a walk', () => {
  test('goes to a far cell by the engine path, the troop flocks along it', () => {
    const open = world();
    value(open.newWorld({ seed: 0 }));
    const walked = value(open.walk({ q: 4, r: 0 }));
    expect(walked.steps).toBe(4);
    expect(walked.state.hero).toBe('(4,0)');
    expect(walked.state.troop).toEqual(clientRun(0, ['E', 'E', 'E', 'E']).troop);
  });

  test('walks over a boulder it breaks on the way', () => {
    // The first seed where the walk onto a boulder arrives: a push of the troop on the way can stop it.
    const walked = SEEDS.flatMap((seed) => {
      const spot = beside(seed, [5]);
      if (!spot) return [];
      const open = world();
      value(open.newWorld({ seed }));
      const [dq, dr] = STEPS[spot.dir]!;
      const [q, r] = [spot.at[0] + dq, spot.at[1] + dr];
      const walk = open.walk({ q, r });
      return walk.ok && walk.value.state.hero === `(${q},${r})` ? [walk.value] : [];
    })[0];
    expect(walked).toBeTruthy();
    expect(walked!.state.broken).toBeGreaterThanOrEqual(1);
  });

  test('sails to a water cell by the engine path (#1441)', () => {
    const lake = SEEDS.flatMap((seed) => {
      const spot = beside(seed, [0]);
      if (!spot) return [];
      const [dq, dr] = STEPS[spot.dir]!;
      return [{ seed, to: [spot.at[0] + dq, spot.at[1] + dr] as const }];
    })[0]!;
    const open = world();
    value(open.newWorld({ seed: lake.seed }));
    const walked = value(open.walk({ q: lake.to[0], r: lake.to[1] }));
    expect(walked.steps).toBeGreaterThan(0);
    expect(code(lake.seed, ...lake.to)).toBe(0);
  });

  test('stays when the cell is the hero, a lair, an enemy, off the world or too far', () => {
    const open = world([3, 0, 0, 9, 0, -9]);
    value(open.newWorld({ seed: 1 }));
    for (const [q, r] of [[0, 0], [3, 0], [6, 6], [-5000, 0], [100, 0]]) {
      expect(failure(open.walk({ q: q!, r: r! })).code).toBe('no_path');
    }
    expect(value(open.state({})).hero).toBe('(0,0)');
  });
});

// Seed 1 has an enemy group at (6,6), (7,5), (8,4). The values below are what the client gives for the same seed and moves:
// `Hero.step` (client/src/openworld.ts) then `FightState.troopPush` (client/src/openworldfight.ts), as `OpenWorldMode.roll` calls them.
describe('the same seed and moves as the client', () => {
  const PUSHED = clientRun(1, [...Array<string>(6).fill('SE'), ...Array<string>(4).fill('E')]);

  test('six steps SE then four E: the fourth E brings the troop beside the group and it pushes it east', () => {
    const open = world();
    value(open.newWorld({ seed: 1 }));
    for (let i = 0; i < 6; i++) value(open.step({ direction: 'SE' }));
    for (let i = 0; i < 2; i++) expect(value(open.step({ direction: 'E' })).push).toBeNull();
    const near = value(open.step({ direction: 'E' }));
    expect(near.state.hero).toBe('(3,6)');
    expect(near.state.troop).toEqual(clientRun(1, [...Array<string>(6).fill('SE'), ...Array<string>(3).fill('E')]).troop);
    expect(near.state.enemies).toEqual(['(6,6)']);
    const pushed = value(open.step({ direction: 'E' }));
    expect(pushed.moved).toBe(true);
    expect(pushed.push).toEqual({ direction: 'E', ejected: [], recruit: null });
    expect(pushed.state).toMatchObject({ ...PUSHED, beaten: 0, enemies: ['(7,5)', '(8,4)', '(7,6)'] });
    const row = value(open.state({ radius: 2 })).window.rows.find((r) => r.r === 6)!;
    expect(row.cells[7 - row.q0]).toBe('E');
    const again = value(open.step({ direction: 'E' })); // the troop's next push takes the hero on, as the client's run does
    expect(again.state.hero).toBe(clientRun(1, [...Array<string>(6).fill('SE'), ...Array<string>(5).fill('E')]).hero);
    const refused = failure(open.step({ direction: 'NW' }));
    expect(refused.code).toBe('blocked');
    expect(refused.message).toContain('an enemy stands there');
  });

  test('a walk to (5,6) takes the same path and ends on the push, the hero on (5,6)', () => {
    const open = world();
    value(open.newWorld({ seed: 1 }));
    const walked = value(open.walk({ q: 5, r: 6 }));
    expect(walked.steps).toBe(10);
    expect(walked.pushes).toEqual([{ direction: 'E', ejected: [], recruit: null }]);
    expect(walked.state).toMatchObject(PUSHED);
  });
});

type Way = Parameters<OpenWorld['step']>[0]['direction'];

describe('the troop herds a foe to the water, as the client does (#1506)', () => {
  // Seed 1: a foe on (9,-30), sand with the water three cells away (12,-33). The hero walks there by the engine's path then steps W and E.
  const rules = { ...worldRules(), world_enemies: (_seed: number, cx: number, cy: number) => (cx === 0 && cy === -2 ? Int32Array.of(9, -30) : new Int32Array()) };
  const path = Array.from(rules.world_path(1, 0, 0, 8, -30, new Int32Array(), new Int32Array()));
  const walk = Array.from({ length: path.length / 2 }, (_, i) => {
    const [dq, dr] = [path[2 * i]! - (i === 0 ? 0 : path[2 * i - 2]!), path[2 * i + 1]! - (i === 0 ? 0 : path[2 * i - 1]!)];
    return Object.entries(STEPS).find(([, d]) => d[0] === dq && d[1] === dr)![0] as Way;
  });
  const dirs: Way[] = [...walk, ...Array.from({ length: 20 }, (_, i): Way => (i % 2 === 0 ? 'W' : 'E'))];
  const text = (cells: readonly (readonly number[])[]) => cells.map(([q, r]) => `(${q},${r})`);

  test('the real client Hero and the MCP give the same hero, troop and foe after every step, and the foe ends in the water', () => {
    const w = new World((cx, cy) => rules.world_chunk(1, cx, cy), (cx, cy) => rules.world_enemies(1, cx, cy));
    const fight = new FightState();
    const hero = new Hero(w, fight, 1);
    const open = new OpenWorld(rules, bossIds);
    value(open.newWorld({ seed: 1 }));
    let herded = 0;
    for (const d of dirs) {
      const [dq, dr] = STEPS[d]!;
      expect(hero.step([hero.at[0] + dq!, hero.at[1] + dr!])).toBe(true);
      const played = fight.troopPush(w, 1, [hero.at, ...hero.troop], w.broken, hero.tick);
      if (played) {
        const [at, ...troop] = played.push.troop;
        hero.at = at!;
        hero.troop = troop;
        if (played.push.enemies.length > 0) herded++;
        const cell = played.push.ejected.length > 0 ? recruitCell(hero.at, hero.troop, hero.troop.length - 15, ([q, r]) => [1, 2, 3].includes(terrainOf(w, q, r)) && !fight.occupied(w, q, r)) : null;
        if (cell) hero.troop = [...hero.troop, cell]; // the mode's recruit (#1531)
      }
      const mcp = value(open.step({ direction: d })).state;
      expect(mcp.hero).toBe(`(${hero.at[0]},${hero.at[1]})`);
      expect(mcp.troop).toEqual(text(hero.troop));
      expect(value(open.state({ radius: 8 })).enemies).toEqual(text(fight.enemiesAround(w, hero.at, 8)));
      expect(mcp.beaten).toBe(fight.beaten);
    }
    expect(herded).toBeGreaterThanOrEqual(2); // the foe was pushed along the sand before it fell
    expect(fight.beaten).toBe(1);
    expect(value(open.state({ radius: 8 })).enemies).toEqual([]);
    expect(value(open.state({})).recruits).toBe(1);
  });
});

/** The terrain code of a cell of the client's world `w`, `-1` off it. */
function terrainOf(w: World, q: number, r: number): number {
  const terrain = w.tile(q, r)?.terrain;
  return terrain === undefined ? -1 : ['water', 'sand', 'grass', 'rock'].indexOf(terrain);
}

// A marble a push ejects joins the troop (#1531, docs/specs/openworld.md section 16): the rule of client/src/openworldrecruit.ts.
describe('a recruit', () => {
  // Seed 1: the hero on (11,-29) steps NW to (11,-30); the foe on (12,-30) has water behind it, and the lone hero shoves it in.
  const rules = { ...worldRules(), world_enemies: (_seed: number, cx: number, cy: number) => (cx === 0 && cy === -2 ? Int32Array.of(12, -30) : new Int32Array()) };
  const resume = (recruits?: number): OpenWorld => {
    const open = new OpenWorld(rules, bossIds);
    value(open.newWorld({ seed: 1 }));
    const save = value(open.save());
    value(open.newWorld({ save: { ...save, hero: [11, -29], troop: [], ...(recruits === undefined ? {} : { recruits }) } }));
    return open;
  };

  test('a push that ejects a marble brings one, told in the push and in the state, saved in the record 8', () => {
    const open = resume();
    const stepped = value(open.step({ direction: 'NW' }));
    expect(stepped.push?.ejected).toHaveLength(1);
    expect(stepped.push?.recruit).toMatch(/^\(-?\d+,-?\d+\)$/);
    expect(stepped.state.recruits).toBe(1);
    expect(stepped.state.troop).toEqual([stepped.push!.recruit]);
    const save = value(open.save());
    expect(save.record).toBe(RECORD);
    expect(save.recruits).toBe(1);
    expect(save.troop).toHaveLength(1);
  });

  test('past the cap the marble is ejected and nothing joins; a save of the client resumes with its recruits', () => {
    const open = resume(RECRUIT_MAX);
    const stepped = value(open.step({ direction: 'NW' }));
    expect(stepped.push?.ejected).toHaveLength(1);
    expect(stepped.push?.recruit).toBeNull();
    expect(stepped.state.recruits).toBe(RECRUIT_MAX);
    expect(value(open.save()).recruits).toBe(RECRUIT_MAX);
  });

  test('a push that ejects nothing recruits nothing, and a save from before the recruits resumes with none', () => {
    const open = world();
    value(open.newWorld({ seed: 1 }));
    expect(value(open.state({})).recruits).toBe(0);
    const old = value(open.save());
    const { recruits: _recruits, ...before } = old;
    expect(value(world().newWorld({ save: { ...before, record: 6 } })).recruits).toBe(0);
  });
});

const VERSION = worldRules().world_version();

/** Seed 1 walked to (5,6): the troop pushed the enemy group on the way, so the fight has enemies removed and added (see above). */
function pushed(): OpenWorld {
  const open = world();
  value(open.newWorld({ seed: 1 }));
  value(open.walk({ q: 5, r: 6 }));
  return open;
}

describe("a save and its resume, in the client's format (client/src/openworldsave.ts)", () => {
  test('save_world gives the world as the client saves it, and the client reads it back', () => {
    const save = value(pushed().save());
    expect(save.record).toBe(RECORD);
    expect(save.version).toBe(VERSION);
    expect(Number.isFinite(save.savedAt)).toBe(true);
    expect(save.fight.removed.length).toBeGreaterThan(0);
    expect(save.fight.added.length).toBeGreaterThan(0);
    expect(decodeWorld(save, 1, VERSION)).toEqual({
      version: VERSION,
      seed: 1,
      hero: [5, 6],
      troop: clientRun(1, [...Array<string>(6).fill('SE'), ...Array<string>(4).fill('E')]).troop.map((t) => t.slice(1, -1).split(',').map(Number)),
      fight: save.fight,
      yaw: 0,
      broken: [],
      lairs: [],
      discovered: save.discovered,
      time: 0,
      logs: [],
      recruits: 0,
      resources: NO_RESOURCES,
      army: NO_ARMY,
      savedAt: save.savedAt,
    });
    const seen = Discovered.from(save.discovered!);
    expect(seen.has(5 + SIGHT, 6)).toBe(true); // round the hero, as the client discovers it (#1411)
    expect(seen.has(0 - SIGHT, 0)).toBe(true); // and round the spawn it walked from
    expect(seen.has(5 + SIGHT + 1, 6)).toBe(false);
    expect(FightState.fromJSON(save.fight).toJSON()).toEqual(save.fight);
  });

  test('new_world with a save resumes the world: the same state, and the same moves give the same results after', () => {
    const open = pushed();
    const [resumed, again] = [world(), world()];
    const save = value(open.save());
    expect(value(resumed.newWorld({ save }))).toEqual(value(open.state({})));
    value(again.newWorld({ save }));
    // the flock's step count starts again at 0 on a resume (as the client's), so two resumes of one save agree
    for (const direction of ['NE', 'NE', 'W', 'SE', 'E'] as const) expect(resumed.step({ direction })).toEqual(again.step({ direction }));
    expect(resumed.walk({ q: 0, r: 0 })).toEqual(again.walk({ q: 0, r: 0 }));
  });

  test('a save the client wrote resumes as it was, and saves back to the same record', async () => {
    const store = memoryStore();
    const fight = FightState.fromJSON({ removed: ['6,6'], added: [[7, 6]], beaten: 1 });
    const seen = new Discovered();
    seen.reveal([30, 30]);
    seen.reveal([6, 6]);
    await worldSaves(store, VERSION).put(1, [6, 6], [[5, 6], [4, 6]], fight, 0.75, [[2, 3]], [0, 2], seen.toJSON(), 0, [3, 7]); // two lore logs found (#1589)
    const record = store.data.get('openworld:1') as WorldSave;
    const open = world();
    const state = value(open.newWorld({ save: record }));
    expect(state).toMatchObject({ seed: 1, hero: '(6,6)', troop: ['(5,6)', '(4,6)'], broken: 1, beaten: 1 });
    expect(state.enemies).toContain('(7,6)');
    expect(state.enemies).not.toContain('(6,6)');
    expect(state.lairs.map((lair) => lair.beaten)).toEqual(state.lairs.map((_, k) => k === 0 || k === 2));
    expect({ ...value(open.save()), savedAt: 0 }).toEqual({ ...record, savedAt: 0 }); // the logs found come back as the client wrote them
    expect(value(open.save()).logs).toEqual([3, 7]);
  });

  test('a save from before the lore logs (record 5) resumes with none found (#1589)', () => {
    const { logs: _logs, ...old } = value(pushed().save());
    const open = world();
    value(open.newWorld({ save: { ...old, record: 5 } }));
    expect(value(open.save()).logs).toEqual([]);
  });

  test('a save from before the discovered cells (record 3) resumes with the cells round the hero discovered (#1411)', () => {
    const { discovered: _discovered, ...old } = value(pushed().save());
    const state = value(world().newWorld({ save: { ...old, record: 3 } }));
    expect(state.discovered).toBe(3 * SIGHT * (SIGHT + 1) + 1);
  });

  test('a save whose discovered cells do not decode is refused and the world in progress is kept', () => {
    const open = pushed();
    const error = failure(open.newWorld({ save: { ...value(open.save()), discovered: [[0, 0, '!!']] } }));
    expect(error.code).toBe('bad_save');
    expect(value(open.state({})).hero).toBe('(5,6)');
  });

  test('a save of another world version is refused and the world in progress is kept', () => {
    const open = pushed();
    const before = value(open.state({}));
    const error = failure(open.newWorld({ save: { ...value(open.save()), version: VERSION + 1 } }));
    expect(error.code).toBe('bad_save');
    expect(error.message).toContain(`version ${VERSION + 1}`);
    expect(value(open.state({}))).toEqual(before);
  });
});

/** The session's game as a test sets it. */
function games(): { now: Outcome | null; outcome(): Outcome | null } {
  return {
    now: null,
    outcome() {
      return this.now;
    },
  };
}

// The client's "Back to the Open world" (client/src/main.ts, #1170): a boss fight started from a lair and won beats that lair.
describe('a lair fight won, back in the world', () => {
  const BOSS = bossIds()[0]!;

  test('a fight of the lair boss started after the step onto it and won beats that lair once the agent is back', () => {
    const session = games();
    const open = world([1, 0, 9, 0], session);
    value(open.newWorld({ seed: 0 }));
    session.now = { game: 'before', boss: null };
    expect(value(open.step({ direction: 'E' })).lair?.boss).toBe(BOSS);
    session.now = { game: 'fight', boss: null }; // started, not won yet
    expect(value(open.state({})).lairs.map((lair) => lair.beaten)).toEqual([false, false]);
    session.now = { game: 'fight', boss: BOSS };
    expect(value(open.state({})).lairs.map((lair) => lair.beaten)).toEqual([true, false]);
    expect(value(open.save()).lairs).toEqual([0]);
  });

  test('a fight won before the step, a fight of another boss, or no game beats nothing', () => {
    const session = games();
    const open = world([1, 0, 9, 0], session);
    value(open.newWorld({ seed: 0 }));
    session.now = { game: 'won', boss: BOSS };
    value(open.step({ direction: 'E' }));
    expect(value(open.state({})).lairs[0]!.beaten).toBe(false);
    session.now = { game: 'other', boss: bossIds()[1]! };
    expect(value(open.walk({ q: 2, r: 1 })).state.lairs[0]!.beaten).toBe(false);
    session.now = null;
    expect(value(open.step({ direction: 'W' })).state.lairs[0]!.beaten).toBe(false);
  });

  test('a world with no session never beats a lair', () => {
    const open = world([1, 0]);
    value(open.newWorld({ seed: 0 }));
    value(open.step({ direction: 'E' }));
    expect(value(open.state({})).lairs[0]!.beaten).toBe(false);
  });

  test("every lair beaten: the ending, Tally's line of the client (#1175); a lair beaten again counts once", () => {
    const session = games();
    const open = world([1, 0], session);
    value(open.newWorld({ seed: 0 }));
    for (const game of ['first', 'again']) {
      value(open.step({ direction: 'E' }));
      expect(value(open.state({})).ending).toBe(game === 'first' ? undefined : endingLine(MARBLES));
      session.now = { game, boss: BOSS };
      expect(value(open.state({})).ending).toBe(endingLine(MARBLES));
    }
    expect(value(open.save()).lairs).toEqual([0]);
  });

  test('a world with no lair has no ending', () => {
    expect(value(world([]).newWorld({ seed: 0 })).ending).toBeUndefined();
  });
});

// The pad of a tower beaten through the world (#1531, docs/specs/openworld.md section 15): a teleporter beside it, in the network of the client.
describe('the pad of a tower beaten', () => {
  const BOSS = bossIds()[0]!;
  const PAD = '(1,-1)';

  test('a lair won from the world adds its pad to the teleporters, a save carries the lair and resumes with the pad', () => {
    const session = games();
    const open = world([1, 0], session, [1, -1]);
    value(open.newWorld({ seed: 0 }));
    session.now = { game: 'before', boss: null };
    value(open.step({ direction: 'E' }));
    expect(value(open.state({})).teleporters.map((t) => t.cell)).toEqual(['(2,-1)']);
    session.now = { game: 'fight', boss: BOSS };
    expect(value(open.state({})).teleporters.map((t) => t.cell)).toEqual(['(2,-1)', PAD]);
    const saved = value(open.save());
    expect(saved.lairs).toEqual([0]);
    const again = world([1, 0], undefined, [1, -1]);
    expect(value(again.newWorld({ save: saved })).teleporters.map((t) => t.cell)).toEqual(['(2,-1)', PAD]);
  });

  /** A new world of seed 0 saved, with the lairs `lairs` beaten and the hero on the spawn pad. */
  const saveOf = (open: OpenWorld, lairs: number[]): WorldSave => {
    value(open.newWorld({ seed: 0 }));
    return { ...value(open.save()), lairs, hero: [2, -1] };
  };

  test('the hero teleports from the spawn pad to the pad of a beaten tower, by the rules of the client', () => {
    const open = world([1, 0], undefined, [1, -1]);
    const resumed = value(open.newWorld({ save: saveOf(open, [0]) }));
    expect(resumed.teleporters.map((t) => t.cell)).toEqual(['(2,-1)', PAD]);
    expect(value(open.teleport({ q: 1, r: -1 })).hero).toBe(PAD);
  });

  test('a tower past the pads the engine gave, or an engine with none, adds nothing', () => {
    const short = world([1, 0, 9, 0], undefined, [1, -1]);
    expect(value(short.newWorld({ save: saveOf(short, [1]) })).teleporters.map((t) => t.cell)).toEqual(['(2,-1)']);
    const none = world([1, 0], undefined, []);
    expect(value(none.newWorld({ save: saveOf(none, [0]) })).teleporters.map((t) => t.cell)).toEqual(['(2,-1)']);
  });
});

// The cells discovered (#1411): within 10 cells of the hero, as the client's mode discovers them, counted in the state.
describe('the cells discovered', () => {
  const DISC = 3 * SIGHT * (SIGHT + 1) + 1;

  test('a new world has the disc round the spawn discovered; the steps and a walk discover more, a refused step none', () => {
    const open = world();
    expect(value(open.newWorld({ seed: 1 })).discovered).toBe(DISC);
    const walked = value(open.walk({ q: 5, r: 6 })).state.discovered;
    expect(walked).toBeGreaterThan(DISC);
    expect(value(open.state({})).discovered).toBe(walked);
  });
});

describe('the teleporters (#1412)', () => {
  const [q, r] = worldRules().world_teleporters(7).slice(2, 4) as unknown as [number, number];
  const far = `(${q},${r})`;

  test("world_state lists the teleporters discovered, the spawn's at first, with their distance from the hero", () => {
    const open = world();
    expect(value(open.newWorld({ seed: 7 })).teleporters).toEqual([{ cell: '(2,-1)', distance: 2 }]);
  });

  test('a teleport needs the hero on a teleporter and another one discovered, by the rules of the client', () => {
    const open = world();
    const save = value((open.newWorld({ seed: 7 }), open.save()));
    expect(failure(open.teleport({ q: 2, r: -1 }))).toEqual({ code: 'blocked', message: 'the hero stands on no teleporter' });
    value(open.walk({ q: 2, r: -1 }));
    expect(failure(open.teleport({ q, r })).message).toBe(`the teleporter on ${far} is not discovered yet`);
    expect(failure(open.teleport({ q: 3, r: -1 })).message).toBe('no teleporter on (3,-1)');
    value(open.newWorld({ save: { ...save, hero: [q, r] } })); // the hero on the far one: it is discovered
    expect(value(open.state({})).teleporters).toEqual([{ cell: '(2,-1)', distance: hex([q, r], [2, -1]) }, { cell: far, distance: 0 }]);
    const moved = value(open.teleport({ q: 2, r: -1 }));
    expect(moved.hero).toBe('(2,-1)');
    expect(moved.troop).toHaveLength(15);
    expect(moved.troop.slice(0, 2)).toEqual(['(1,-1)', '(1,0)']); // the free cells round it, the nearest first
    expect(value(open.teleport({ q, r })).hero).toBe(far);
  });
});

/** The axial distance between two cells. */
function hex(a: [number, number], b: [number, number]): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] - b[0] + a[1] - b[1])) / 2;
}

// The resources of the Open world (#1655, docs/specs/openworld.md section 19): gathered as the client gathers them, carried in the state and the save.
describe('the resources', () => {
  const BIOMES = ['meadow', 'forest', 'tundra', 'desert', 'badlands', 'archipelago'];
  const biomeAt = (seed: number, q: number, r: number): string => {
    const cx = Math.floor(q / 16);
    const cy = Math.floor(r / 16);
    return BIOMES[worldRules().world_chunk(seed, cx, cy)[((r - cy * 16) * 16 + (q - cx * 16)) * 3 + 2]!]!;
  };
  const stock = { wood: 12, ore: 7, parts: 20, shards: 2 };

  test('a new world has none, in the state and in the save', () => {
    const open = world();
    expect(value(open.newWorld({ seed: 1 })).resources).toEqual(NO_RESOURCES);
    expect(value(open.save()).resources).toEqual(NO_RESOURCES);
    expect(value(open.save()).army).toEqual(NO_ARMY);
  });

  test('a boulder or a tree broken gives what its biome is known for, as in the client (#1737)', () => {
    for (const [code, terrain] of [[5, 'boulder'], [6, 'tree']] as const) {
      const { open, spot } = standBeside([code]);
      const [dq, dr] = STEPS[spot.dir]!;
      const biome = biomeAt(1, spot.at[0] + dq!, spot.at[1] + dr!);
      const had = { ...value(open.state({})).resources }; // the walk to the spot may have broken others
      expect(value(open.step({ direction: spot.dir as 'E' })).smashed).not.toBeNull();
      const now = value(open.state({})).resources;
      const gained = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v - had[k as keyof typeof had]]));
      expect(gained, `${terrain} in the ${biome}`).toEqual(breakYield(terrain, biome as Parameters<typeof breakYield>[1]));
    }
  });

  test('a marble the push ejects gives a part', () => {
    const rules = { ...worldRules(), world_enemies: (_seed: number, cx: number, cy: number) => (cx === 0 && cy === -2 ? Int32Array.of(12, -30) : new Int32Array()) };
    const open = new OpenWorld(rules, bossIds);
    value(open.newWorld({ seed: 1 }));
    value(open.newWorld({ save: { ...value(open.save()), hero: [11, -29], troop: [] } }));
    expect(value(open.step({ direction: 'NW' })).push?.ejected).toHaveLength(1);
    expect(value(open.state({})).resources).toEqual({ ...NO_RESOURCES, parts: 1 });
  });

  test('a lair won from the world gives five shards, once', () => {
    const session = games();
    const open = world([1, 0], session);
    value(open.newWorld({ seed: 0 }));
    for (const game of ['first', 'again']) {
      session.now = { game: `before ${game}`, boss: null };
      value(open.step({ direction: 'E' }));
      session.now = { game, boss: bossIds()[0]! };
      expect(value(open.state({})).resources).toEqual({ ...NO_RESOURCES, shards: 5 });
    }
  });

  test('a save of the client resumes with its resources and its army, and carries them back; a save from before has none', () => {
    const army = { specials: [1], brought: [1], relics: [2], relicsBrought: [2] };
    const open = world();
    value(open.newWorld({ seed: 1 }));
    const save = value(open.save());
    expect(value(open.newWorld({ save: { ...save, resources: stock, army } })).resources).toEqual(stock);
    const back = value(open.save());
    expect(back.resources).toEqual(stock);
    expect(back.army).toEqual(army);
    expect(decodeWorld(back, 1, VERSION)!.resources).toEqual(stock);
    const { resources: _r, army: _a, ...before } = save;
    const old = value(world().newWorld({ save: { ...before, record: 7 } }));
    expect(old.resources).toEqual(NO_RESOURCES);
  });
});
