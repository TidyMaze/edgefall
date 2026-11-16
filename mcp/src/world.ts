// The Open world tools of docs/specs/mcp.md section 5: start a world from a seed, read a short window of it, walk a step or to a
// cell, teleport. Every rule is the Rust core's, called in the client's order (`OpenWorldMode.roll` of client/src/openworldmode.ts):
// the map, the enemies, the lairs, the teleporters and the path (`world_chunk`, `world_enemies`, `world_lairs`, `world_teleporters`,
// `world_path`), the step (`world_enter`, `world_flock`) and the troop's push after it (`WorldFight`); the teleport is the client's
// own code (client/src/openworldteleport.ts). This holds the hero, the troop, the broken cells, the fight and the lairs
// beaten and the cells discovered, saves them in the client's format (client/src/openworldsave.ts), and turns the engine's codes into words.
import { decodeDiscovered, Discovered, type DiscoveredSave } from '../../client/src/openworlddiscovered';
import { BIOMES, type Biome, startTroop } from '../../client/src/openworld';
import { recruitCell } from '../../client/src/openworldrecruit';
import { addResources, type Army, breakYield, ejectYield, lairYield, NO_ARMY, NO_RESOURCES, type Resources } from '../../client/src/openworldresources';
import { teleport } from '../../client/src/openworldteleport';
import { endingLine } from '../../client/src/tally';
import { DIRECTIONS } from './notation';
import type { ErrorCode, Result } from './game';

/** What the Open world uses of edgefall-wasm. */
export interface WorldRules {
  /** `[height, terrain, biome]` bytes per cell of a 16 x 16 chunk, empty off the world. */
  world_chunk(seed: number, cx: number, cy: number): Uint8Array;
  /** `q, r` pairs of the enemies that start in a chunk. */
  world_enemies(seed: number, cx: number, cy: number): Int32Array;
  /** `q, r` pairs of the boss lairs, lair 0 first. */
  world_lairs(seed: number): Int32Array;
  /** `q, r` pairs of the teleporters, the spawn's first (#1412). */
  world_teleporters(seed: number): Int32Array;
  /** `q, r` pairs of the pad beside each tower, in the order of `world_lairs` (#1531): the teleporter a tower beaten through the world leaves. */
  world_pads(seed: number): Int32Array;
  /** The walk from a cell to a cell: `q, r` pairs, the start left out, empty when there is none. */
  world_path(seed: number, fromQ: number, fromR: number, toQ: number, toR: number, blocked: Int32Array, broken: Int32Array): Int32Array;
  /** What the step from `(q, r)` to `(tq, tr)` does: 0 refused, 1 rolls, 2 breaks. `terrain` is the code of the cell, -1 off the world. */
  world_enter(q: number, r: number, tq: number, tr: number, terrain: number, occupied: boolean, rise: number): number;
  /** The troop after the hero steps from `(q, r)` to `(tq, tr)`, flocking over `ground`: `q, r` pairs. */
  world_flock(seed: number, tick: number, troop: Int32Array, step: Int32Array, ground: Int32Array, goals: Int32Array): Int32Array;
  /** The version of the world generator: a save of another version does not hold this world. */
  world_version(): number;
  /** The enemies of a fight as the pushes left them: a new one has no push, `restore` gives the fight of a save. */
  WorldFight: { new (): Fight; restore(removed: Int32Array, added: Int32Array, beaten: number): Fight; push_reach(): number };
}

/** What the Open world uses of the bridge's `WorldFight` (edgefall-core `worldoverlay`). */
export interface Fight {
  occupied(generated: Int32Array, q: number, r: number): boolean;
  around(chunks: Int32Array, q: number, r: number, radius: number): Int32Array;
  herd_goals(seed: number, troop: Int32Array, chunks: Int32Array, broken: Int32Array): Int32Array;
  troop_push(seed: number, troop: Int32Array, chunks: Int32Array, broken: Int32Array, tick: number): { troop: Int32Array; ejected: Int32Array; dir: Int32Array } | undefined;
  removed(): Int32Array;
  added(): Int32Array;
  beaten(): number;
}

/** The game of the session, as the lairs read it: its id, and the boss of a local boss fight the agent won, else `null`. */
export interface Outcome {
  game: string;
  boss: string | null;
}

type Cell = [q: number, r: number];
export type Direction = (typeof DIRECTIONS)[number];

/** A world as the client saves it (`worldSaves().put` of client/src/openworldsave.ts, record 7), cells as `[q, r]`. */
export interface WorldSave {
  record?: number;
  version: number;
  seed: number;
  hero: Cell;
  troop: Cell[];
  /** The enemies the pushes moved: the generated ones gone (`"q,r"`), the ones on other cells, the number ejected. */
  fight: { removed: string[]; added: Cell[]; beaten: number };
  /** The camera's turn in the client, kept as it was. */
  yaw: number;
  broken: Cell[];
  /** The numbers of the lairs beaten. */
  lairs: number[];
  /** The cells discovered (#1411), a bitset per chunk; a save from before has none, and the cells round the hero are discovered. */
  discovered?: DiscoveredSave;
  /** The time of day (#1496), ms into the client's 12 minute cycle, kept as it was: the server's world has no clock. A save from before has none (the start of day). */
  time?: number;
  /** The lore logs the client found (#1589), kept as they were: the server exposes none. A save from before has none. */
  logs?: number[];
  /** The marbles that joined the troop after a push ejected one (#1531), up to the client's cap. A save from before has none. */
  recruits?: number;
  /** What the client gathered (#1655): wood, ore, parts and shards. A save from before has none. */
  resources?: Resources;
  /** The army of the client's Workshop (#1655), kept as it was: the server has no Workshop. A save from before has none. */
  army?: Army;
  savedAt?: number;
}

export interface NewWorldInput {
  seed?: number;
  /** Resume this save instead, its seed included. */
  save?: WorldSave;
}

export interface WorldStateInput {
  radius?: number;
}

export interface StepInput {
  direction: Direction;
}

export interface WalkInput {
  q: number;
  r: number;
}

export interface Row {
  r: number;
  /** The q of the first cell. */
  q0: number;
  cells: string;
}

export interface WorldState {
  seed: number;
  hero: string;
  troop: string[];
  /** Obstacles the hero has broken. */
  broken: number;
  /** Enemy marbles the troop has ejected. */
  beaten: number;
  /** The marbles that joined the troop after a push ejected one (#1531), up to the cap of 5. */
  recruits: number;
  /** What the hero gathered (#1655, openworld.md section 19): wood from a tree, ore from a boulder, parts from an ejection, shards from a lair beaten. */
  resources: Resources;
  /** The cells discovered: within 10 cells of every cell the hero stood on, as the client's map shows them (#1411). */
  discovered: number;
  /** The enemy marbles inside the window. */
  enemies: string[];
  lairs: { boss: string; cell: string; distance: number; beaten: boolean }[];
  /** The teleporters discovered (#1412), the only ones `world_teleport` goes to, and their distance from the hero (0: it stands on it). */
  teleporters: { cell: string; distance: number }[];
  /** Tally's line of the client once every lair is beaten (#1175), the world's end; absent before. */
  ending?: string;
  window: { radius: number; rows: Row[] };
}

/** The troop's push after a step: its direction and the enemy it ejected, none or one. */
export interface Push {
  direction: Direction;
  ejected: string[];
  /** The cell of the marble that joined the troop because of it (#1531), `null` when none did: the cap is reached or no cell round the hero is free. */
  recruit: string | null;
}

export interface Stepped {
  moved: boolean;
  /** The obstacle this step broke. */
  smashed: 'boulder' | 'tree' | null;
  /** The push the troop made after the step, `null` when none was legal. */
  push: Push | null;
  /** Set when the step was onto a lair: the hero stays, start the boss fight with `new_game`. */
  lair?: { index: number; boss: string; start: string };
  state: WorldState;
}

export interface Walked {
  steps: number;
  /** The pushes the troop made on the way. */
  pushes: Push[];
  state: WorldState;
}

/** Cells of the window in each direction by default, and at most. */
const RADIUS = 3;
/** The search radius of a path, `PATH_REACH` of the client. */
const PATH_REACH = 40;
const CHUNK = 16;
/** The step of each direction, in the order of `DIRECTIONS`. */
const DELTAS: Cell[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];

/** The terrain codes of the bridge by letter, the window's legend: water, sand, grass, rock, peak, boulder, tree, wall. */
const LETTERS = '~sgrPotW';
const NAMES = ['water', 'sand', 'grass', 'rock', 'peak', 'boulder', 'tree', 'wall'];
/** The record of the client's save (`RECORD` of client/src/openworldsave.ts) and the crew of its ending line (`MARBLES` of
 * client/src/trainer.ts). */
const RECORD = 8;
const CREW = 6;
const WATER = 0;
const BOULDER = 5;
const ROCK = 3;
const GRASS = 2;
/** The ground a marble stands on: sand, grass and rock. */
const OPEN = [1, GRASS, ROCK];
/** The answers of `world_enter`. */
const REFUSED = 0;
const BREAKS = 2;
/** The terrain byte of a cell past the edge, in a chunk the edge crosses (`OFF_WORLD` of the bridge, #1440). */
const OFF_WORLD = 255;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });
const text = ([q, r]: Cell): string => `(${q},${r})`;
const same = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1];
const flat = (cells: Cell[]): Int32Array => Int32Array.from(cells.flat());
const hex = (a: Cell, b: Cell): number => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] - b[0] + a[1] - b[1])) / 2;
const toward = (at: Cell, direction: Direction): Cell => {
  const step = DELTAS[DIRECTIONS.indexOf(direction)]!;
  return [at[0] + step[0], at[1] + step[1]];
};

interface Play {
  seed: number;
  hero: Cell;
  troop: Cell[];
  broken: Cell[];
  fight: Fight;
  lairs: number[];
  yaw: number;
  discovered: Discovered;
  time: number;
  /** The numbers of the lore logs found, from the save resumed (#1589). */
  logs: number[];
  /** The marbles that joined the troop (#1531). */
  recruits: number;
  resources: Resources;
  army: Army;
  /** The hero's steps so far: with the seed it fixes the flock's ties. */
  tick: number;
}

/** The one Open world of the server. */
export class OpenWorld {
  private play: Play | null = null;
  private readonly chunks = new Map<string, Uint8Array>();
  private readonly groups = new Map<string, Cell[]>();
  private lairCells: Cell[] = [];
  /** The teleporters the seed places, and the pad beside each tower by number (#1531): the network is the first plus the pads of the lairs beaten. */
  private seedTeleporters: Cell[] = [];
  private padCells: Cell[] = [];
  /** The lair the hero last stepped onto, its boss and the session's game then: a fight of that boss won since beats the lair. */
  private entered: { lair: number; boss: string; before: string | null } | null = null;

  constructor(
    private readonly rules: WorldRules,
    private readonly bossIds: () => string[],
    private readonly games: { outcome(): Outcome | null } = { outcome: () => null },
  ) {}

  /** Starts the world of `seed`, the hero on the spawn and the troop round it, no push yet, or resumes `save`, and drops the world in
   * progress. A save of another world version is refused and the world in progress kept. */
  newWorld({ seed = 0, save }: NewWorldInput): Result<WorldState> {
    const version = this.rules.world_version();
    if (save && save.version !== version) return fail('bad_save', `the save is of world version ${save.version}, this world is version ${version}: start a new world`);
    const discovered = decodeDiscovered(save?.discovered ?? []);
    if (!discovered) return fail('bad_save', 'the discovered cells of the save do not decode: start a new world');
    this.chunks.clear();
    this.groups.clear();
    this.entered = null;
    if (save) {
      const { removed, added, beaten } = save.fight;
      const fight = this.rules.WorldFight.restore(Int32Array.from(removed.flatMap((key) => key.split(',').map(Number))), flat(added), beaten);
      this.play = { seed: save.seed, hero: save.hero, troop: save.troop, broken: [...save.broken], fight, lairs: [...save.lairs], yaw: save.yaw, discovered: Discovered.from(discovered), time: save.time ?? 0, logs: [...(save.logs ?? [])], recruits: save.recruits ?? 0, resources: { ...(save.resources ?? NO_RESOURCES) }, army: save.army ?? NO_ARMY, tick: 0 };
    } else {
      this.play = { seed, hero: [0, 0], troop: [], broken: [], fight: new this.rules.WorldFight(), lairs: [], yaw: 0, discovered: new Discovered(), time: 0, logs: [], recruits: 0, resources: { ...NO_RESOURCES }, army: NO_ARMY, tick: 0 };
      this.play.troop = startTroop((cell) => this.standable([cell[0], cell[1]], false)).map(([q, r]): Cell => [q, r]); // the client's own start (`Hero`): same cells, same order
    }
    this.play.discovered.reveal(this.play.hero); // a save from before the discovery: the cells round the hero, as the client
    this.lairCells = pairs(this.rules.world_lairs(this.play.seed));
    this.seedTeleporters = pairs(this.rules.world_teleporters(this.play.seed));
    this.padCells = pairs(this.rules.world_pads(this.play.seed));
    return ok(this.view(RADIUS));
  }

  state({ radius = RADIUS }: WorldStateInput): Result<WorldState> {
    if (!this.play) return this.none();
    this.back();
    return ok(this.view(radius));
  }

  /** The world in the client's save format: `new_world` with it, or the client, resumes it. */
  save(): Result<WorldSave> {
    const play = this.play;
    if (!play) return this.none();
    this.back();
    const { seed, hero, troop, broken, fight, lairs, yaw, discovered, time, logs, recruits, resources, army } = play;
    const removed = pairs(fight.removed()).map(([q, r]) => `${q},${r}`);
    const added = pairs(fight.added());
    return ok({ record: RECORD, version: this.rules.world_version(), seed, hero, troop, fight: { removed, added, beaten: fight.beaten() }, yaw, broken: [...broken], lairs: [...lairs], discovered: discovered.toJSON(), time, logs: [...logs], recruits, resources: { ...resources }, army, savedAt: Date.now() });
  }

  /** Rolls the hero one cell, then the troop pushes. Water is sailed (#1441); an enemy, a wall, a peak or a tree beside a tree
   * refuses it; a boulder or a tree is broken. Onto a lair the hero stays and the lair's boss is named, where the client starts its fight. */
  step({ direction }: StepInput): Result<Stepped> {
    const play = this.play;
    if (!play) return this.none();
    this.back();
    const to = toward(play.hero, direction);
    const lair = this.lairCells.findIndex((cell) => same(cell, to));
    if (lair >= 0) {
      const boss = this.bossOf(lair);
      this.entered = { lair, boss, before: this.games.outcome()?.game ?? null };
      return ok({ moved: false, smashed: null, push: null, lair: { index: lair, boss, start: `new_game ${JSON.stringify({ boss })}` }, state: this.view(RADIUS) });
    }
    const rolled = this.roll(to);
    if (!rolled) return fail('blocked', `cannot enter ${text(to)}: ${this.reason(to)}`);
    return ok({ moved: true, ...rolled, state: this.view(RADIUS) });
  }

  /** Walks the hero to a far cell by the engine's path, round the obstacles and the enemies, up to 40 cells away, one step at a time
   * as the client's walk: the troop pushes after each step, and a step a push made impossible ends the walk there. */
  walk({ q, r }: WalkInput): Result<Walked> {
    if (!this.play) return this.none();
    this.back();
    const route = this.route([q, r]);
    if (route.length === 0) return fail('no_path', `no way to ${text([q, r])}: it is the hero's cell, a lair, an enemy, off the world, farther than ${PATH_REACH} cells or walled in`);
    const pushes: Push[] = [];
    let steps = 0;
    for (const cell of route) {
      const rolled = this.roll(cell);
      if (!rolled) break;
      steps++;
      if (rolled.push) pushes.push(rolled.push);
    }
    return ok({ steps, pushes, state: this.view(RADIUS) });
  }

  /** Teleports the hero from the teleporter it stands on to the discovered one on `(q, r)`, the troop on the free cells round it and
   * no push, by the client's rules (`teleport` of client/src/openworldteleport.ts). A refused teleport changes nothing. */
  teleport({ q, r }: WalkInput): Result<WorldState> {
    const play = this.play;
    if (!play) return this.none();
    this.back();
    const moved = teleport(this.network(), (cq, cr) => play.discovered.has(cq, cr), play.hero, [q, r], play.troop.length, this.free);
    if ('refused' in moved) return fail('blocked', moved.refused);
    play.hero = [...moved.hero];
    play.troop = moved.troop.map(([q, r]): Cell => [q, r]);
    play.discovered.reveal(play.hero);
    return ok(this.view(RADIUS));
  }

  /** The teleporters of the world, as the client's mode has them: the seed's, then the pad of each lair beaten through the world (#1531). */
  private network(): Cell[] {
    const pads = this.play!.lairs.flatMap((lair) => (this.padCells[lair] ? [this.padCells[lair]!] : []));
    return [...this.seedTeleporters, ...pads];
  }

  /** The boss of lair `k`: boss `k` of the roster, round it, as the client's (client/src/main.ts). */
  private bossOf(k: number): string {
    const ids = this.bossIds();
    return ids[k % ids.length]!;
  }

  /** The agent is back in the world (the client's "Back to the Open world", #1170): a fight of the lair's boss started after the step
   * onto the lair and won beats that lair. */
  private back(): void {
    const entered = this.entered;
    if (!entered) return;
    const now = this.games.outcome();
    if (!now || now.game === entered.before || now.boss !== entered.boss) return;
    this.entered = null;
    if (this.play!.lairs.includes(entered.lair)) return;
    this.play!.lairs.push(entered.lair);
    this.play!.resources = addResources(this.play!.resources, lairYield()); // the shards of a tower beaten (#1655)
  }

  private none(): Result<never> {
    return fail('no_world', 'no world started: call new_world first');
  }

  /** The engine's path from the hero to `to`, the enemies and the lairs in the way. */
  private route(to: Cell): Cell[] {
    const { seed, hero, broken } = this.play!;
    const blocked = [...this.enemiesAround(hero, PATH_REACH), ...this.lairCells];
    return pairs(this.rules.world_path(seed, hero[0], hero[1], to[0], to[1], flat(blocked), flat(broken)));
  }

  /** The client's step (`Hero.step` of client/src/openworld.ts, then `OpenWorldMode.troopPush`): the engine says whether the hero enters
   * `to` (`world_enter`); then an obstacle there is broken, the troop flocks (`world_flock`) and plays its push when one is
   * legal (`WorldFight.troop_push`), the hero and the troop taking the cells it gives. `null` when the step is refused: nothing changes. */
  private roll(to: Cell): { smashed: 'boulder' | 'tree' | null; push: Push | null } | null {
    const play = this.play!;
    const { hero, fight, seed } = play;
    const code = this.terrain(to[0], to[1]);
    const sailed = code === WATER || this.terrain(hero[0], hero[1]) === WATER; // water is sailed onto and off, whatever the land's height (#1744)
    const entry = this.rules.world_enter(hero[0], hero[1], to[0], to[1], code ?? -1, this.occupied(to), sailed ? 0 : this.height(to[0], to[1]) - this.height(hero[0], hero[1])); // a cliff too high is refused
    if (entry === REFUSED) return null;
    const smashed = entry === BREAKS ? (NAMES[code!] as 'boulder' | 'tree') : null;
    if (smashed) {
      play.broken.push(to);
      play.resources = addResources(play.resources, breakYield(smashed, this.biome(to))); // wood or ore (#1655)
    }
    const sailing = code === WATER;
    const goals = fight.herd_goals(seed, flat([to, ...play.troop]), this.chunksAround(to, this.rules.WorldFight.push_reach()), flat(play.broken));
    const around = (cell: Cell): Cell[] => DELTAS.map((d): Cell => [cell[0] + d[0], cell[1] + d[1]]);
    // The followers the herd sends hop twice, so the ground reaches two cells round them.
    const sent = Array.from({ length: goals.length / 3 }, (_, k) => around(play.troop[goals[3 * k]!]!).flatMap(around)).flat();
    const ground = [hero, ...play.troop].flatMap((cell) => [cell, ...around(cell)]).concat(sent).filter((cell) => this.standable(cell, sailing));
    play.troop = pairs(this.rules.world_flock(seed, play.tick++, flat(play.troop), Int32Array.of(hero[0], hero[1], to[0], to[1]), flat(ground), goals));
    play.hero = to;
    play.discovered.reveal(to); // the cells within 10 of the hero, as the client's `mark` (#1411)
    const out = fight.troop_push(seed, flat([to, ...play.troop]), this.chunksAround(to, this.rules.WorldFight.push_reach()), flat(play.broken), play.tick);
    if (!out) return { smashed, push: null };
    const [pushedHero, ...pushedTroop] = pairs(out.troop);
    play.hero = pushedHero!;
    play.troop = pushedTroop;
    play.discovered.reveal(play.hero);
    const direction = DIRECTIONS[DELTAS.findIndex((d) => same(d, [out.dir[0]!, out.dir[1]!]))]!;
    const ejected = pairs(out.ejected);
    play.resources = addResources(play.resources, ejectYield(play.hero, ejected.length)); // parts (#1655)
    // A marble ejected joins the troop (the client's `OpenWorldMode.recruit`, #1531), on the free cell nearest the hero.
    const recruit = ejected.length > 0 ? recruitCell(play.hero, play.troop, play.recruits, this.free) : null;
    if (recruit) {
      play.troop = [...play.troop, [recruit[0], recruit[1]] as Cell];
      play.recruits++;
    }
    return { smashed, push: { direction, ejected: ejected.map(text), recruit: recruit && text([recruit[0], recruit[1]]) } };
  }

  /** Whether a marble can stand on a cell: open ground, no enemy, no lair (the troop's cells round a teleporter, and a recruit's, as the client's `free`). */
  private readonly free = ([q, r]: Readonly<Cell>): boolean => OPEN.includes(this.terrain(q, r)!) && !this.occupied([q, r]) && !this.lairCells.some((l) => same(l, [q, r]));

  /** Whether a follower may stand on a cell: the open ground, no enemy on it; water only while the hero sails (the client's `Hero.standable`). */
  private standable(cell: Cell, sailing: boolean): boolean {
    const code = this.terrain(cell[0], cell[1]);
    return code !== undefined && (OPEN.includes(code) || (sailing && code === WATER)) && !this.occupied(cell);
  }

  /** Why the hero cannot enter `to`, in words. */
  private reason(to: Cell): string {
    if (this.occupied(to)) return 'an enemy stands there';
    const code = this.terrain(to[0], to[1]);
    return code === undefined ? 'off the world' : `${NAMES[code]} in the way`;
  }

  /** Whether an enemy marble stands on `cell` now, the pushes included. */
  private occupied(cell: Cell): boolean {
    const generated = this.generated(Math.floor(cell[0] / CHUNK), Math.floor(cell[1] / CHUNK));
    return this.play!.fight.occupied(flat(generated), cell[0], cell[1]);
  }

  /** The height level of a cell (the first byte of the bridge's chunk), 0 off the world. */
  private height(q: number, r: number): number {
    return this.byte(q, r, 0) ?? 0;
  }

  /** The byte `i` of the cell `(q, r)` in the bridge's chunk (0 height, 1 terrain, 2 biome), its chunk read once; `undefined` off the world. */
  private byte(q: number, r: number, i: number): number | undefined {
    const [cx, cy] = [Math.floor(q / CHUNK), Math.floor(r / CHUNK)];
    const key = `${cx},${cy}`;
    let cells = this.chunks.get(key);
    if (!cells) this.chunks.set(key, (cells = this.rules.world_chunk(this.play!.seed, cx, cy)));
    return cells[((r - cy * CHUNK) * CHUNK + (q - cx * CHUNK)) * 3 + i];
  }

  /** The terrain code of a cell with the broken obstacles turned to ground, `undefined` off the world. */
  private terrain(q: number, r: number): number | undefined {
    const code = this.byte(q, r, 1);
    if (code === undefined || code === OFF_WORLD) return undefined;
    // Only a boulder or a tree is ever broken: it is the ground it stood on now (client/src/openworld.ts `LEFT`).
    if (!this.play!.broken.some((cell) => same(cell, [q, r]))) return code;
    return code === BOULDER ? ROCK : GRASS;
  }

  /** The biome of a cell, as the client reads it (the third byte of the bridge's chunk, `BIOMES` of client/src/openworld.ts). */
  private biome([q, r]: Cell): Biome {
    const [cx, cy] = [Math.floor(q / CHUNK), Math.floor(r / CHUNK)];
    this.terrain(q, r); // reads the chunk
    return BIOMES[this.chunks.get(`${cx},${cy}`)![((r - cy * CHUNK) * CHUNK + (q - cx * CHUNK)) * 3 + 2]!]!;
  }

  /** The enemies the seed puts on the chunk `(cx, cy)`, before any push. */
  private generated(cx: number, cy: number): Cell[] {
    const key = `${cx},${cy}`;
    let cells = this.groups.get(key);
    if (!cells) this.groups.set(key, (cells = pairs(this.rules.world_enemies(this.play!.seed, cx, cy))));
    return cells;
  }

  /** The chunks that reach the cells within `radius` of `at`, in the bridge's list: `cx, cy, n`, then the `n` generated enemies. */
  private chunksAround(at: Cell, radius: number): Int32Array {
    const chunks: number[] = [];
    for (let cy = Math.floor((at[1] - radius) / CHUNK); cy <= Math.floor((at[1] + radius) / CHUNK); cy++) {
      for (let cx = Math.floor((at[0] - radius) / CHUNK); cx <= Math.floor((at[0] + radius) / CHUNK); cx++) {
        const cells = this.generated(cx, cy);
        chunks.push(cx, cy, cells.length, ...cells.flat());
      }
    }
    return Int32Array.from(chunks);
  }

  /** The enemy marbles within `radius` cells of `at` now, the pushes included (`WorldFight.around`). */
  private enemiesAround(at: Cell, radius: number): Cell[] {
    return pairs(this.play!.fight.around(this.chunksAround(at, radius), at[0], at[1], radius));
  }

  private view(radius: number): WorldState {
    const { seed, hero, troop, broken, fight, lairs, discovered, recruits, resources } = this.play!;
    const size = Math.min(Math.max(radius, 1), 8);
    const enemies = this.enemiesAround(hero, size);
    const rows: Row[] = [];
    for (let dr = -size; dr <= size; dr++) {
      const [lo, hi] = [Math.max(-size, -dr - size), Math.min(size, -dr + size)];
      let cells = '';
      for (let dq = lo; dq <= hi; dq++) cells += this.letter([hero[0] + dq, hero[1] + dr], hero, troop, enemies);
      rows.push({ r: hero[1] + dr, q0: hero[0] + lo, cells });
    }
    return {
      seed,
      hero: text(hero),
      troop: troop.map(text),
      broken: broken.length,
      beaten: fight.beaten(),
      recruits,
      resources: { ...resources },
      discovered: discovered.count,
      enemies: enemies.map(text),
      lairs: this.lairCells.map((cell, k) => ({ boss: this.bossOf(k), cell: text(cell), distance: hex(hero, cell), beaten: lairs.includes(k) })),
      teleporters: this.network().filter(([q, r]) => discovered.has(q, r)).map((cell) => ({ cell: text(cell), distance: hex(hero, cell) })),
      // The client's ending (`OpenWorldMode.showTally`): every lair beaten, counted as the client counts them.
      ...(this.lairCells.length > 0 && lairs.length >= this.lairCells.length ? { ending: endingLine(CREW) } : {}),
      window: { radius: size, rows },
    };
  }

  /** One cell of the window: the hero H, the troop T, an enemy E, a lair L, else its terrain letter, `?` off the world. */
  private letter(cell: Cell, hero: Cell, troop: Cell[], enemies: Cell[]): string {
    if (same(cell, hero)) return 'H';
    if (troop.some((t) => same(t, cell))) return 'T';
    if (enemies.some((e) => same(e, cell))) return 'E';
    if (this.lairCells.some((l) => same(l, cell))) return 'L';
    const code = this.terrain(cell[0], cell[1]);
    return code === undefined ? '?' : LETTERS[code]!;
  }
}

/** The `q, r` pairs of a flat list. */
function pairs(flatList: ArrayLike<number>): Cell[] {
  return Array.from({ length: flatList.length / 2 }, (_, i): Cell => [flatList[2 * i]!, flatList[2 * i + 1]!]);
}
