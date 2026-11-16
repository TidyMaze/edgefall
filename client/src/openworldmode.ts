// The Open world mode (docs/specs/openworld.md): the world of a seed, the hero in it, and the view that draws them, as one
// thing main.ts switches on and off. It draws itself with the page's renderer while it is on, and the page's board stays
// untouched.
import type * as THREE from 'three/webgpu';
import { axialTo3D, type Axial } from './board';
import { PhaseWatch, StepWatch, type WorldCue } from './cues';
import { phaseOf, type Phase, wrapTime, clockLine } from './daynight';
import { type Biome, chunkOf, Hero, neighbours, same, type Tile, WALKABLE, World } from './openworld';
import { FightState } from './openworldfight';
import { GLIDE_MS, NUDGE_MS, slowBy, stepMs, type Pace } from './openworldglide';
import { HIT_HOLD_MS } from './openworldhit';
import type { WorldSave, WorldSaves } from './openworldsave';
import type { MarbleSkins } from './openworldstripe';
import { endingLine, ledgerLine } from './tally';
import { MARBLES } from './trainer';
import { Discovered } from './openworlddiscovered';
import { WorldMap } from './openworldmap';
import { CLAIM_NOTE, contractLine, goalCell, goalLines } from './openworldgoal';
import { drawMinimap, RADIUS as MAP_RADIUS, windowCells, type MinimapCell, type MinimapData } from './openworldminimap';
import { RECRUIT_MAX, recruitCell } from './openworldrecruit';
import { WORLD_LOGS } from './lorelogs';
import { addResources, type Army, breakYield, ejectYield, logYield, NO_ARMY, NO_RESOURCES, resourceLine, type Resources } from './openworldresources';
import { hubHelpOn, markHubCoachDone, walkLessonDue, WALK_LESSON } from './hubcoach';
import type { Store } from './quality';
import { enter, heroStep } from './openworldstep';
import { pairs, teleport, teleporterNear } from './openworldteleport';
import type { PeerHost } from './worldnet';
import type { Source } from './stations';
import { PlaceTransition, placeTitle, type PlaceKind } from './placetransition';
import { MAX_REACH, OpenWorldView, shapeWorld, TELEPORTER_LOOK, type Played, type PropModels } from './openworldview';
import { ICON } from './openworldlairicon';
import { twistOf } from './openworldtwist';
import { placesReached, type PlaceLineKind } from './placelines';
import { biomeLine } from './openworldbiomes';

/** The walk of the hero to a far cell, the bridge's `world_path` (docs/specs/openworld.md section 4): the seed, the cell the hero
 * stands on, the cell asked for, the cells it cannot enter (enemies, lairs) and the broken cells (#1154), as `q, r` pairs; its answer
 * is the cells to walk, the start left out, empty when there is no way. */
export type WalkPath = (seed: number, from: Axial, to: Axial, blocked: Int32Array, broken: Int32Array) => Int32Array;

/** The walk to the nearest tower, the bridge's `world_dungeon` (#1291): the seed, the hero's cell, the lairs beaten, the cells it cannot
 * enter (enemies, lairs) and the broken cells; its answer is the lair's number then the cells to walk, empty when no tower has a way. */
export type DungeonPath = (seed: number, from: Axial, beaten: Int32Array, blocked: Int32Array, broken: Int32Array) => Int32Array;

/** The enemies near the hero that a walk goes round: the radius of the path search. */
const PATH_REACH = 40;
/** How often a hidden tab hands the peers host the hero (#1371): the host sends no more than its own caps allow. */
const KEEPALIVE_TICK_MS = 1000;


/** How long, in ms, no wild fight starts after a world opens (#1511): the marble just fled from, a reload, a loss, and the marble next to the
 * hero when the world is entered. */
export const FLEE_GRACE_MS = 5000;

/** The most time of day one frame counts, in ms: a tab that was stalled does not skip the day (#1496). */
const MAX_DAY_STEP_MS = 250;

/** The cells as the bridge takes them: `q, r` pairs. */
const flat = (cells: readonly Axial[]): Int32Array => Int32Array.from(cells.flat());
/** Resolves in a task of its own: the page draws and answers input before what follows (#1582). */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settled = (): void => {};
/** A world made for an entry and its view, before the mode takes them (#1582). */
interface Made {
  world: World;
  fight: FightState;
  ticked: number;
  view: OpenWorldView;
}

/** The places as the bridge gives them (#1514): `kind, q, r` triples, kind 0 a town and 1 a dungeon gate. */
const placesIn = (flatPlaces: Int32Array): { cell: Axial; kind: 'town' | 'dungeon' }[] =>
  Array.from({ length: flatPlaces.length / 3 }, (_, i) => ({ kind: flatPlaces[3 * i] === 0 ? 'town' : 'dungeon', cell: [flatPlaces[3 * i + 1]!, flatPlaces[3 * i + 2]!] as Axial }));

/** The camera turns by a step of Q or E, and by a px of a right-button drag, in radians (#1026). */
export const TURN_STEP = Math.PI / 3;
/** The camera rests at this angle plus a multiple of TURN_STEP, so screen up runs along a straight line of hexes, not the zigzag between
 * two (#1254). The default is the one that rolls up to the north-east, as the keyboard always did on an even row. */
export const REST_OFFSET = Math.PI / 6;
export const DEFAULT_YAW = -REST_OFFSET;
/** The resting angle nearest to `yaw`. */
export const restYaw = (yaw: number): number => Math.round((yaw - REST_OFFSET) / TURN_STEP) * TURN_STEP + REST_OFFSET;
export const ORBIT_PER_PX = Math.PI / 360;
const TURNS = new Map<string, number>([
  ['q', TURN_STEP],
  ['Q', TURN_STEP],
  ['e', -TURN_STEP],
  ['E', -TURN_STEP],
]);
/** The keys that step the hero. */
/** The distance in cells between two cells of the hex grid. */
const cellDistance = (a: Axial, b: Axial): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] - b[0] + a[1] - b[1]));
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** The keys that open and close the map (#1411); Escape closes it too. */
const MAP_KEYS = new Set(['m', 'M']);
/** The keys of the Teleport action (#1412): on a teleporter they open the map in the choice of a teleporter, and close it again. */
const TELEPORT_KEYS = new Set(['t', 'T']);
/** The keys that open and close the controls hint of the HUD (#1530). */
const HELP_KEYS = new Set(['h', 'H']);
/** The ground a marble can stand on: the troop arrives on it round a teleporter (#1412). */

export { twistOf };

/** How long the banner of a biome entered stays (#1742). */
export const BANNER_MS = 3000;

export class OpenWorldMode {
  active = false;
  /** The page's storage: the one lesson of the roll (#1604) is shown only with one, and its key is saved in it. */
  store: Store = null;
  private lesson = false; // the lesson is on in the world entered (not yet rolled)
  hero: Hero | null = null;
  /** The online layer of the public world (#1305): told of each world entered and left, and of each frame. None draws solo. */
  peers: PeerHost | null = null;
  /** What the page plays for a step of the hero, a pickup and the phase of the day moving (#1570, world.md section 7). */
  cue: (event: WorldCue) => void = () => {};
  private readonly steps = new StepWatch();
  private readonly phases = new PhaseWatch();
  /** The tick of the clock the enemy marbles wander by (#1511): the same on every peer. The default stands them where they start. */
  wander: () => number = () => 0;
  /** The tick the marbles stand at now. */
  private ticked = 0;
  /** What starts a wild fight with the marble that touches the hero (#1511): the seed, the cell the marble starts on and the special marbles and the relics
   * the army brings (#1655). The page plays the transition and the fight, and brings the hero back to this world when it ends. */
  onWild: (seed: number, home: Axial, brought: number[], relics: number[]) => void = () => {};
  /** The page clock (ms) before which no wild fight starts: a world that just opened gives 5 s to walk away. 0 when none is due. */
  private calmUntil = 0;
  /** Frames drawn since the world opened: a spec waits for the first one before it looks at the wild fight (#1601, `__openworldDrawn`). */
  drawn = 0;
  /** Whether a wild fight has started: the hero takes no more steps while the page plays the transition. */
  private fighting = false;
  /** The prompt shown when a wild marble touches the hero (#1662): the home of the group asked about, the world paused until Fight or Back away. */
  private asked: { home: Axial; at: Axial; from: Axial | null } | null = null;
  /** The home of the group the hero backed away from (#1662): it asks nothing until the hero leaves contact. */
  private declined: Axial | null = null;
  /** Tells the page the prompt opened (true) or closed (false) (#1662). */
  onAsk: (open: boolean) => void = () => {};
  /** The timer that keeps the hero alive for the room while the tab is hidden (#1371). */
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private view: OpenWorldView | null = null;
  private world: World | null = null;
  /** The seed of the world entered, the enemies as the pushes left them, and the pushes played so far. */
  private seed = 0;
  private fight = new FightState();
  private pushes = 0;
  /** The boss lairs of the world entered, by number, and the numbers of the ones beaten (#1170). */
  /** The transition into a tower, a gate or a town and back (#1519). */
  private readonly transition = new PlaceTransition(() => this.reduced());
  private lairs: Axial[] = [];
  private beaten: number[] = [];
  /** Lairs other heroes reported taken (#1305): drawn beaten for the visit, never counted, filed or saved, since no fight proves them. */
  private heard: number[] = [];
  /** The teleporters of the world entered (#1412), the spawn's first, then the pad of each tower beaten through the world (#1531). */
  private teleporters: Axial[] = [];
  /** The teleporters the seed places, and the pad beside each tower by number (#1531): the network is the first, plus the pads of the towers beaten. */
  private seedTeleporters: Axial[] = [];
  private pads: Axial[] = [];
  /** The lore logs of the world entered (#1589), by number, and the numbers of the ones found. */
  private logs: Axial[] = [];
  /** The towns and dungeon gates of the world entered (#1514), with the dungeon tier of a gate (#1532, 0 for a town). */
  private places: { cell: Axial; kind: 'town' | 'dungeon' }[] = [];
  private placeRings: number[] = [];
  /** The ring of each tower of the world entered, by number (#1532). */
  private rings: number[] = [];
  private found: number[] = [];
  /** The marbles that joined the troop after a push ejected one (#1531), at most `RECRUIT_MAX`. */
  private recruits = 0;
  /** What the world's own actions gathered (#1655), saved with the world, and the army the Workshop will fill (slice 2), kept as saved. */
  private resources: Resources = NO_RESOURCES;
  private army: Army = NO_ARMY;
  private dirty = false;
  /** Whether the world changed since its last save, and how many saves the page has stored (`openworldSaved`, #968). */
  private unsaved = false;
  private writes = 0;
  /** The time of the last frame, in ms: the camera's ease runs on the time between frames. */
  private clock = 0;
  /** The arrow keys held down: a vertical and a horizontal one together roll a diagonal. */
  private readonly held = new Set<string>();
  /** The arrows the stick holds (#1025): they count as held keys do. */
  private pad: readonly string[] = [];
  /** The time of the next step while an arrow is held, in ms: the frame loop makes it (#1059), Infinity while none is. */
  private nextStep = Infinity;
  /** Whether the last step was one of a held walk, so the next one takes over its speed instead of starting from rest (#1065). */
  private cruising = false;
  /** The steps made in the walk under way: the cadence speeds up with them (#1290). */
  private walked = 0;
  /** The cells of the walk to a far cell (#1137) still to take, the next first; empty when no such walk is on. */
  private route: Axial[] = [];
  /** The props are read once for the page: every entry reuses them. */
  private modelsOnce?: Promise<PropModels>;
  /** The cells the hero has discovered (#1411), and the full screen map of them, made when it first opens. */
  private discovered = new Discovered();
  private worldMap: WorldMap | null = null;
  /** The window's size, for the map. */
  private size: [number, number] = [0, 0];
  /** The time of day (#1496), in ms into the 12 minute cycle: counted by the frames while the world is open, saved with it, and kept after the
   * world is left so the lair that started a fight can read its phase. */
  private tod = 0;
  /** The time of the last frame counted into it, 0 before the first one of a visit. */
  private counted = 0;

  /** `load` reads a chunk of a seed's world, `models` the low-poly and the detailed props: the first draw does not wait for them.
   * `reduced` tells whether the page asks for reduced motion, which holds the water still. */
  constructor(
    private readonly load: (seed: number, cx: number, cy: number) => Uint8Array,
    private readonly loadEnemies: (seed: number, cx: number, cy: number) => Int32Array,
    private readonly models: () => Promise<PropModels>,
    private readonly reduced: () => boolean,
    private readonly saves: WorldSaves,
    /** The boss lairs of a seed's world: `q, r` pairs (the bridge's `world_lairs`), and what starts a lair, given its seed and number. */
    private readonly lairsOf: (seed: number) => Int32Array = () => new Int32Array(),
    private readonly onLair: (seed: number, lair: number, brought: number[], relics: number[]) => void = () => {}, // the special marbles and the relics the army brings (#1655)
    /** The skins of the ship the marbles wear, read when a world opens (#1176): none draws the plain looks. */
    private readonly skins?: () => Promise<MarbleSkins>,
    /** The medals the player holds and the bosses there are, read from the shared medal store when a world opens (#1171). */
    private readonly medals: () => { have: number; total: number } = () => ({ have: 0, total: 0 }),
    /** Tally's line for the HUD when a world opens, empty when it has been shown already (#1171). */
    private readonly tally: () => string = () => '',
    /** The path of a walk to a far cell, the bridge's `world_path` (#1137): none gives no way. */
    private readonly path: WalkPath = () => new Int32Array(),
    /** Whether steering is on (the Settings item, #1137): the held arrows slide round obstacles and a far tap walks there. */
    private readonly steering: () => boolean = () => true,
    /** Called with the scene of a world left, after its view is freed: the renderer frees what it keeps per scene, the lights node's textures (#1258). */
    private readonly releaseScene: (scene: THREE.Scene) => void = () => {},
    /** The walk to the nearest tower, for the HUD's Dungeon button (#1291). */
    private readonly dungeonPath: DungeonPath = () => new Int32Array(),
    /** The teleporters of a seed's world: `q, r` pairs (the bridge's `world_teleporters`, #1412). */
    private readonly teleportersOf: (seed: number) => Int32Array = () => new Int32Array(),
    /** The ids of the bosses round the roster: lair k is boss k, counted round (#1438). */
    private readonly bossIds: () => readonly string[] = () => [],
    /** The lore logs of a seed's world: `q, r` pairs (the bridge's `world_logs`, #1589), and what files the id of a log read in the archive. */
    private readonly logsOf: (seed: number) => Int32Array = () => new Int32Array(),
    private readonly read: (id: string) => void = () => {},
    /** The towns and dungeon gates of a seed's world: `kind, q, r` triples (the bridge's `world_places`, #1514). */
    private readonly placesOf: (seed: number) => Int32Array = () => new Int32Array(),
    /** What starts a town or a dungeon gate rolled onto (#1593), given the seed of the world and the kind. */
    private readonly onPlace: (seed: number, kind: 'town' | 'dungeon', index: number, biome: Biome, contract: string) => void = () => {},
    /** The stage of the story (#1546): the clamp of Tally's lines is open from stage 7. */
    private readonly stage: () => number = () => 1,
    /** The rings of a seed's world (the bridge's `world_rings`, #1532): the ring of each tower by number, then one per place (0 for a town, the
     * gate's dungeon tier). None puts every tower in the first ring. */
    private readonly ringsOf: (seed: number) => Uint8Array = () => new Uint8Array(),
    /** The pad beside each tower of a seed's world: `q, r` pairs in the order of the lairs (the bridge's `world_pads`, #1531). */
    private readonly padsOf: (seed: number) => Int32Array = () => new Int32Array(),
    /** The name of a boss by its id, for the title of a tower entered (#1519). */
    private readonly bossName: (id: string) => string = () => '',
    /** Tally's line of the first kind of place reached not filed yet, empty when there is none (#1315, `firstNewLine` of placelines.ts). */
    private readonly placeLine: (kinds: readonly PlaceLineKind[]) => string = () => '',
    /** The cairns of a chunk of a seed's world: `q, r` pairs (the bridge's `world_cairns`, #1533). */
    private readonly cairnsOf: (seed: number, cx: number, cy: number) => Int32Array = () => new Int32Array(),
  ) {}

  /** Opens the world of `seed`: its saved state when `resume` (the default) and a save of this version is there, else the spawn.
   * The save is read before the first draw, and the seed is remembered as the last world played (#968). */
  async open(seed: number, width: number, height: number, resume = true, from?: PlaceKind): Promise<void> {
    const saved = resume ? await this.saves.load(seed) : null;
    const made = this.make(seed, saved, await this.skins?.());
    // The build in three tasks, the world and its view, its first chunks, the rest: one froze the page 0.23 s at 4x CPU (#1582)
    await nextTask();
    made.view.resize(width, height);
    await nextTask();
    this.enter(seed, width, height, saved, undefined, made);
    if (from) this.transition.back(from); // back from a tower, a gate or a town: the matching transition (#1519)
    void this.saves.remember(seed);
  }

  /** Enters the world of `seed` with the hero, the troop and the fight of `saved` (a save of this seed), or on the spawn. */
  enter(seed: number, width: number, height: number, saved: WorldSave | null = null, skins?: MarbleSkins, made = this.make(seed, saved, skins)): void {
    this.flush(); // the world left (another seed entered over it) is saved first
    this.peers?.leave();
    this.freeView();
    this.seed = seed;
    const { world, view } = made;
    this.world = world;
    this.fight = made.fight;
    this.fighting = false;
    this.asked = null;
    this.declined = null;
    this.onAsk(false);
    this.calmUntil = Infinity; // the marble next to the hero when the world opens does not fight for 5 s from its first draw (#1511, frame)
    this.ticked = made.ticked;
    this.pushes = 0;
    const flatLairs = this.lairsOf(seed);
    this.lairs = Array.from({ length: flatLairs.length / 2 }, (_, i): Axial => [flatLairs[2 * i]!, flatLairs[2 * i + 1]!]);
    this.beaten = saved ? [...saved.lairs] : [];
    this.heard = [];
    this.seedTeleporters = pairs(this.teleportersOf(seed));
    this.pads = pairs(this.padsOf(seed));
    this.teleporters = this.network();
    this.logs = pairs(this.logsOf(seed));
    this.places = placesIn(this.placesOf(seed));
    const rings = Array.from(this.ringsOf(seed));
    this.rings = rings.slice(0, this.lairs.length);
    this.placeRings = this.places.map((_, i) => rings[this.lairs.length + i] ?? 0);
    this.found = saved ? [...saved.logs] : [];
    this.recruits = saved?.recruits ?? 0;
    this.plateRecruits(false);
    this.resources = saved?.resources ?? NO_RESOURCES;
    this.army = saved?.army ?? NO_ARMY;
    this.plateResources();
    this.discovered = saved ? Discovered.from(saved.discovered) : new Discovered(); // a save from before: the cells round the hero, by `mark`
    this.counted = 0;
    this.tod = saved?.time ?? 0; // an older save, or a new world, starts at the start of day (#1496)
    this.hero = new Hero(world, this.fight, this.seed);
    if (saved) {
      this.hero.at = saved.hero;
      this.hero.troop = saved.troop;
    }
    this.view = view;
    this.size = [width, height];
    view.resize(width, height);
    view.turnTo(saved ? restYaw(saved.yaw) : DEFAULT_YAW); // the camera opens at the angle the world was left at, or the default (#1026, #1254)
    // The land the landmarks shape (#1719), before the ground is laid: a mound under each tower, a hollow round each gate, a pool of light round each town and teleporter.
    shapeWorld({
      lairs: this.lairs,
      gates: this.places.filter((p) => p.kind === 'dungeon').map((p) => p.cell),
      lights: [...this.places.filter((p) => p.kind === 'town').map((p) => ({ cell: p.cell, colour: ICON.town })), ...this.teleporters.map((cell) => ({ cell, colour: TELEPORTER_LOOK.colour }))],
    });
    view.show(this.hero.at, this.hero.troop);
    this.drawLairs();
    view.setTeleporters(this.teleporters);
    view.setPlaces(this.places);
    view.setLogs(this.logs, this.found);
    this.peers?.enter(seed, view.scene, view.camera, world);
    this.showLesson();
    this.keepAlive();
    const medals = document.getElementById('openworld-medals'); // the HUD's medal count (#1171)
    if (medals) {
      const { have, total } = this.medals();
      medals.textContent = `Medals ${have} / ${total}`;
    }
    this.showTally(true);
    this.active = true;
    this.refreshMode();
    this.dirty = true;
    this.mark(String(seed));
    this.modelsOnce ??= this.models();
    void this.modelsOnce.then((models) => {
      if (this.view !== view) return; // left before the models arrived
      view.useModels(this.lowTier() ? { ...models, high: {} } : models); // the low tier draws the low-poly props everywhere, no detailed set (#1234)
      this.dirty = true;
      this.mark(String(seed)); // the detailed props drawn now are published too (#989)
    });
  }

  /** The world of `seed` and its view, made apart from the mode, whose world open now is not touched: the first half of an entry's
   * build (#1582). `saved` is a save of this seed, or none for the spawn. */
  private make(seed: number, saved: WorldSave | null, skins?: MarbleSkins): Made {
    const world = new World(
      (cx, cy) => this.load(seed, cx, cy),
      (cx, cy) => this.loadEnemies(seed, cx, cy),
      (cx, cy) => this.cairnsOf(seed, cx, cy),
    );
    if (saved) world.restore(saved.broken); // before any cell is read: the broken obstacles stay broken (#1147)
    const fight = saved ? FightState.fromJSON(saved.fight) : new FightState();
    const ticked = this.wander();
    fight.setClock(seed, ticked); // the marbles stand where the clock has them from the first draw (#1511)
    const view = new OpenWorldView(world, fight, skins);
    view.setTime(saved?.time ?? 0, !this.reduced()); // an older save, or a new world, starts at the start of day (#1496)
    view.useFlatTops(this.lowTier()); // the low tier draws a ground cell no neighbour lies below as its top alone (#1234)
    view.cullGround(document.body.dataset.software === 'on'); // a software renderer lays the ground in view only (#1483)
    view.useSurfaceDetail(!this.lowTier()); // the land's striation, on the high tier only (#1555)
    view.setLevels(this.levels.lights, this.levels.lamps); // the Settings sliders (#1727)
    view.setShadows(document.body.dataset.tier === 'high'); // the sun's soft shadow round the hero, on the High tier only (#1364, #1715)
    return { world, fight, ticked, view };
  }

  /** Settles once the props' models are in the view the world opened with, at once before any world: the page builds the world's
   * programs after them, as the ones a first render built froze it 0.4 s at 4x CPU (#1582). */
  get props(): Promise<void> {
    return Promise.resolve(this.modelsOnce).then(settled);
  }

  /** The camera the hero is seen through, the listener's of the sounding stations (#1577): only while the world is open. */
  get ears(): THREE.Camera {
    return this.view!.camera;
  }

  /** The towns, dungeon gates and towers of the world entered, which sound near the listener (#1577, `stations.ts`). */
  get stations(): Source[] {
    const at = ([q, r]: Axial) => axialTo3D(q, r);
    return [
      ...this.places.map(({ cell, kind }): Source => ({ id: `${kind}:${cell}`, kind: kind === 'town' ? 'town' : 'gate', ...at(cell) })),
      ...this.lairs.map((cell): Source => ({ id: `tower:${cell}`, kind: 'tower', ...at(cell) })),
    ];
  }

  /** The biome of the hero's cell, null before the world is drawn (#1571). */
  get biome(): Biome | null {
    return this.view?.heroBiome ?? null;
  }

  /** The time of day, and its phase: `day`, `dusk` or `night` (#1496). */
  get timeOfDay(): number {
    return this.tod;
  }

  get phase(): Phase {
    return phaseOf(this.tod);
  }

  /** The test hook: sets the time of day (docs/specs/openworld.md section 6). The sky changes at once. */
  setTime(ms: number): void {
    this.tod = wrapTime(ms);
    this.view!.setTime(this.tod, !this.reduced());
    this.persist();
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
  }

  /** The scene drawn now, none outside the mode: the render-cost readout counts its lights (#1234). */
  get scene(): THREE.Scene | null {
    return this.view?.scene ?? null;
  }

  /** The camera of the scene drawn now, none outside the mode: the page builds the world's programs with it (#1582). */
  get eye(): THREE.Camera | null {
    return this.view?.camera ?? null;
  }

  /** Frees the view drawn now, if any, and hands its scene to the renderer to release (#1258). */
  private freeView(): void {
    if (!this.view) return;
    this.view.dispose();
    this.releaseScene(this.view.scene);
  }

  /**
   * A hidden tab gets no animation frame, and the frame is what sends the place and the keepalive, so the other heroes dropped
   * it after 10 s (#1371). While hidden, a timer (a hidden tab's runs at least once a second) hands the host the hero instead:
   * the host's own cap and keepalive decide what is sent, so a hidden tab sends no more than a visible one.
   */
  private keepAlive(): void {
    this.stopKeepAlive();
    this.keepalive = setInterval(() => {
      if (document.hidden) this.peers?.frame(performance.now(), this.hero!.at);
    }, KEEPALIVE_TICK_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepalive !== null) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  leave(): void {
    if (this.active) this.persist(); // the time of day counted since the last save (#1496)
    this.flush();
    this.stopKeepAlive();
    this.peers?.leave();
    this.active = false;
    this.asked = null;
    this.declined = null;
    this.onAsk(false);
    this.held.clear();
    this.freeView();
    document.getElementById('openworld-minimap')?.remove(); // the minimap goes with the world (#1275)
    this.closeMap(); // and so does the map (#1411)
    this.view = null;
    this.world = null;
    this.dirty = false;
    this.pad = [];
    this.route = [];
    this.nextStep = Infinity;
    this.cruising = false;
    this.walked = 0;
    delete document.body.dataset.openworldRoute;
    delete document.body.dataset.openworld;
    delete document.body.dataset.openworldAt;
    delete document.body.dataset.openworldTroop;
    delete document.body.dataset.openworldEnemies;
    delete document.body.dataset.openworldBeaten;
    delete document.body.dataset.openworldRecruits;
    this.recruits = 0;
    this.plateRecruits(false);
    this.resources = NO_RESOURCES;
    delete document.body.dataset.openworldResources;
    const gathered = document.getElementById('openworld-resources');
    if (gathered) gathered.textContent = '';
    delete document.body.dataset.openworldPush;
    delete document.body.dataset.openworldZoom;
    delete document.body.dataset.openworldYaw;
    delete document.body.dataset.openworldBroken;
    delete document.body.dataset.openworldLairs;
    delete document.body.dataset.openworldRings;
    delete document.body.dataset.openworldGateRings;
    delete document.body.dataset.openworldPlaces;
    delete document.body.dataset.openworldLairsBeaten;
    delete document.body.dataset.openworldLairsHeard;
    delete document.body.dataset.openworldDrawn;
    delete document.body.dataset.openworldAnim;
    delete document.body.dataset.openworldGlide;
    delete document.body.dataset.openworldParticles;
    delete document.body.dataset.openworldMotion;
    delete document.body.dataset.openworldDiscovered;
    delete document.body.dataset.openworldTeleporters;
    delete document.body.dataset.openworldLogs;
    delete document.body.dataset.openworldLogsFound;
    this.named = null; // the next world names its biome again (#1742)
    clearTimeout(this.bannerTimer);
    const banner = document.getElementById('openworld-biome');
    if (banner) banner.hidden = true;
    delete document.body.dataset.openworldPhase;
    this.showTeleport(false);
    this.closeLog();
  }

  /** The New world control (#1021): the world entered is left without its save, which is discarded, and a random world is entered
   * on the spawn in its place. Returns its seed, which the page shows and the URL takes. */
  async newWorld(width: number, height: number): Promise<number> {
    const left = this.seed;
    this.unsaved = false; // the world left is discarded, not saved again
    await this.saves.discard(left);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    await this.open(seed, width, height, false);
    return seed;
  }

  /** What the camera draws now (the browser checks read it, #1103). */
  camera(at?: number): ReturnType<OpenWorldView['probe']> {
    return this.view!.probe(at);
  }

  /** The enemy marbles near the hero now, the pushed ones where they stand (the browser checks read them). */
  enemies(): Axial[] {
    return this.fight.nearHero(this.world!, this.hero!.at);
  }

  /** Tally's line in the HUD (#1171): the ending once every lair is beaten (#1175), the ledger line of the seats on file while some are
   * (#1315), else the page's line (`fresh`: asked for, which may use it up). */
  private showTally(fresh: boolean): void {
    const tally = document.getElementById('openworld-tally');
    if (!tally) return;
    const [filed, total] = [this.beaten.length, this.lairs.length];
    if (total > 0 && filed >= total) tally.textContent = endingLine(MARBLES, this.stage());
    else if (!fresh) tally.textContent = '';
    else tally.textContent = filed > 0 ? ledgerLine(filed, total, this.stage()) : this.claim();
  }

  /** The page's first-visit line, with its explanation (#1530): the line names a claim, which says nothing to a player who has not met the word. */
  private claim(): string {
    const line = this.tally();
    return line && `${line} ${CLAIM_NOTE}`;
  }

  /** The ring of tower `lair` (#1532): the first when the world has no rings. */
  private ringOf(lair: number): number {
    return this.rings[lair] ?? 1;
  }

  /** The ring to beat (#1532): the nearest ring that still holds a tower not beaten. */
  private ringToBeat(): number {
    return Math.min(...this.lairs.flatMap((_, i) => (this.beaten.includes(i) ? [] : [this.ringOf(i)])));
  }

  /** The towers guidance is on (#1532): the ones not beaten in the ring to beat, which the arrows, the bearing and the Nearest tower button point at. */
  private guided(): boolean[] {
    const ring = this.ringToBeat();
    return this.lairs.map((_, i) => !this.beaten.includes(i) && this.ringOf(i) === ring);
  }

  /** The objective and the bearing in the HUD (#1530), written when they change: called with the minimap, so on a step, a beaten tower and a
   * camera turn. */
  private showGoal(): void {
    const guided = this.guided();
    const state = {
      hero: this.hero!.at,
      yaw: this.view!.drawnYaw,
      lairs: this.lairs.map((cell, i) => ({ cell, beaten: this.beaten.includes(i), guided: guided[i] })),
      logsLeft: this.logs.length - this.found.length,
    };
    this.view!.setGoal(goalCell(state)); // the camera frames the tower the goal names (#1534)
    const { goal, bearing } = goalLines(state);
    for (const [id, line] of [['openworld-goal', goal], ['openworld-bearing', bearing]] as const) {
      const out = document.getElementById(id);
      if (out && out.textContent !== line) out.textContent = line;
    }
  }

  /** The one lesson of the roll (#1604): the controls open on the entry while the lesson is due, and its line says it (the Hub's coach says the same). */
  private showLesson(): void {
    this.lesson = this.store !== null && hubHelpOn(location.search, navigator.webdriver) && walkLessonDue(this.store);
    const line = document.getElementById('openworld-lesson');
    if (line) {
      line.hidden = !this.lesson;
      line.textContent = WALK_LESSON;
    }
    const controls = document.getElementById('openworld-controls') as HTMLDetailsElement | null;
    if (controls && this.lesson) controls.open = true;
  }

  /** The first roll ends the lesson for good: its line goes and the key is saved, so the Hub does not show it either. */
  private endLesson(): void {
    this.lesson = false;
    markHubCoachDone(this.store!);
    const line = document.getElementById('openworld-lesson');
    if (line) line.hidden = true;
  }

  /** The H key (#1530): opens the controls hint of the HUD, or closes it. A folded plate is shown first, with the hint open. The player's choice stays
   * as it was left: nothing else opens or closes it. */
  private toggleControls(): void {
    const controls = document.getElementById('openworld-controls') as HTMLDetailsElement | null;
    if (!controls) return;
    const folded = document.getElementById('openworld-hud')?.dataset.folded;
    if (folded) document.getElementById('openworld-chip')?.click();
    controls.open = folded ? true : !controls.open;
  }

  /** A test fixture (webdriver pages only, docs/specs/openworld.md section 6): the hero on `hero`, the troop on `troop`, and the
   * enemies of the loaded square replaced by `enemies`, none pushed (without `enemies`, the generated ones stay, wandering, and a marble that
   * touches the hero starts a wild fight); `beaten` (#1175) sets the lairs beaten, `recruits` (#1531) the marbles that joined the troop, `resources` and `army` (#1655) the stock of the Workshop. A fixture ends the calm of a world just opened (#1511). */
  fixture({ hero, troop, enemies, beaten, recruits, resources, army }: { hero: Axial; troop: Axial[]; enemies?: Axial[]; beaten?: number[]; recruits?: number; resources?: Resources; army?: Army }): void {
    this.calmUntil = 0;
    if (resources || army) {
      this.resources = resources ?? this.resources; // the stock of the world (#1655): a spec loads the one it needs, it never gathers by walking
      this.army = army ?? this.army;
      this.plateResources();
      this.persist();
    }
    if (recruits !== undefined) {
      this.recruits = Math.min(recruits, RECRUIT_MAX); // the recruits of the world (#1531)
      this.plateRecruits(false);
    }
    this.view!.snap();
    if (beaten) {
      this.beaten = [...beaten];
      this.teleporters = this.network();
      this.view!.setTeleporters(this.teleporters);
      this.drawLairs();
      this.showTally(false);
      this.persist();
    }
    this.hero!.at = hero;
    this.hero!.troop = troop;
    this.view!.show(hero, troop); // first: the loaded square may keep its centre, which the enemies are hidden around (#1046)
    if (enemies) {
      const [cx, cy] = this.view!.centreChunk;
      this.fight.reset();
      this.fight.hide(this.world!, cx, cy, MAX_REACH);
      this.fight.apply([], enemies, []);
    }
    this.view!.updateEnemies();
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
    this.wild(); // a marble the hero was put next to fights at once
  }

  /** The Lights and Lamps sliders of Settings as factors of their defaults (#1727): kept for the worlds opened next, and applied to the open one. */
  setLevels(lights: number, lamps: number): void {
    this.levels = { lights, lamps };
    this.view?.setLevels(lights, lamps);
    this.dirty = true;
  }
  private levels = { lights: 1, lamps: 1 };

  /** Settings changed a skin (#1726): the open world's marbles wear the skins read again; no world open, nothing to dress. */
  async reskin(): Promise<void> {
    if (!this.view || !this.skins) return;
    const skins = await this.skins();
    this.view?.setSkins(skins);
    this.dirty = true; // drawn again with them
  }

  /** Shows the steering mode in the HUD (#1137), and drops a walk when steering is off: called when a world opens and when the
   * Settings item changes. */
  refreshMode(): void {
    if (!this.active) return;
    const on = this.steering();
    if (!on) this.cancelWalk();
    const line = document.getElementById('openworld-mode');
    if (line) line.textContent = on ? 'Steering on: the hero goes round obstacles, tap a far cell to walk there.' : 'Steering off: one step at a time.';
  }

  /** Another hero ejected the enemy that starts on `cell` (#1305, a signed event checked by the peers host): it is beaten for the visit,
   * as a push of this hero would have left it, wherever it wandered to (#1511). No generated enemy starting there, or one gone already, does nothing. */
  remoteBeaten(cell: Axial): void {
    if (!this.world || !this.view || !this.fight.alive(this.world, cell)) return;
    this.fight.apply([cell], [], [cell]);
    this.view.updateEnemies();
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
  }

  /** Another hero broke the obstacle on `cell` (#1305, a signed event checked by the peers host): the cell is open for good, its prop
   * leaves the scene and the shards fly when it is drawn. A cell that holds no boulder or tree (broken already) does nothing. */
  remoteBreak(cell: Axial): void {
    const [world, view] = [this.world, this.view];
    if (!world || !view) return;
    const terrain = world.tile(cell[0], cell[1])?.terrain;
    if (terrain !== 'boulder' && terrain !== 'tree') return;
    const drawn = view.hasProp(cell, terrain);
    world.smash(cell[0], cell[1]);
    if (drawn) view.smash(cell, terrain, performance.now(), this.reduced());
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
  }

  /** Another hero took the boss lair on `cell` (#1305, a signed event checked by the peers host): the lair shows beaten for the visit, but it is not filed, counted
   * towards the ending or saved: only a fight of this hero does that. A cell that is no lair of this world, or a lair beaten already, does nothing. */
  remoteLair(cell: Axial): void {
    const lair = this.lairs.findIndex((c) => same(c, cell));
    if (!this.view || lair < 0 || this.beaten.includes(lair) || this.heard.includes(lair)) return;
    this.heard.push(lair);
    this.drawLairs();
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
  }

  /** The teleporter network (#1531): the seed's teleporters, then the pad beside each tower beaten through the world (`beaten`, not the towers other
   * heroes took). */
  private network(): Axial[] {
    return [...this.seedTeleporters, ...this.beaten.flatMap((lair) => (this.pads[lair] ? [this.pads[lair]!] : []))];
  }

  private drawLairs(): void {
    this.view!.setLairs(this.lairs, [...new Set([...this.beaten, ...this.heard])]);
  }

  /** A new window size: the view follows it, and the zoom it may have been clamped to is published (#976). */
  resize(width: number, height: number): void {
    this.size = [width, height];
    if (this.mapShown) this.worldMap!.resize(width, height);
    this.view?.snap();
    this.view?.resize(width, height);
    this.dirty = true;
    if (this.active) this.mark(document.body.dataset.openworld!);
  }

  /** An arrow key rolls the hero one cell, or on the diagonal while a vertical and a horizontal arrow are both held;
   * opposite arrows held together do nothing. The first arrow down steps at once, then the held arrows step on their own
   * cadence (`beat`, #1059): the system's key repeat (`repeat`) is ignored. Escape leaves. M opens the map (#1411), T the choice of a
   * teleporter (#1412): while the map is open, M, T and Escape close it, Enter picks the ringed teleporter in the choice, and the other
   * keys are not the mode's. Reports whether the key was the mode's. */
  key(key: string, repeat = false): boolean {
    if (this.fighting) return false; // the transition into a wild fight takes the keys (#1511)
    if (this.asked && (key === 'Enter' || key === 'Escape')) return key === 'Enter' ? this.startFight() : this.backAway(), true; // the prompt's keys (#1662)
    if (this.mapShown && key === 'Enter' && this.worldMap!.choosing) return this.choose(this.worldMap!.chosen), true; // the ringed teleporter (#1412)
    if (this.mapShown) return (key === 'Escape' || MAP_KEYS.has(key) || TELEPORT_KEYS.has(key)) && (this.toggleMap(), true);
    if (MAP_KEYS.has(key)) return this.toggleMap(), true;
    if (TELEPORT_KEYS.has(key)) return this.teleport(), true;
    if (HELP_KEYS.has(key)) return this.toggleControls(), true;
    if (key === 'Escape') return this.leave(), true;
    this.cancelWalk(); // any key ends a walk to a far cell (#1137)
    if (key === 'r' || key === 'R') return this.turn(DEFAULT_YAW - this.view!.yaw), true; // back to the default angle (#1026)
    const turn = TURNS.get(key);
    if (turn !== undefined) return this.turn(turn), true;
    if (!ARROWS.has(key)) return false;
    if (!repeat && !this.asked) this.arrows(() => this.held.add(key)); // the world waits for the answer (#1662)
    return true;
  }

  /** The camera's yaw round the hero, in radians: the stick reads its drag in it (`heldKeys`). */
  get yaw(): number {
    return this.view!.yaw;
  }

  /** The stick (#1025, #1026) holds the arrows of its drag, none when the thumb lets go: the hero steps by them on the cadence of the
   * held arrows, as by the keys (#1059). Nothing while the mode is off. */
  hold(keys: readonly string[]): void {
    if (!this.active || this.asked) return;
    if (keys.length > 0) this.route = []; // the stick takes over from a walk to a far cell (#1137)
    this.arrows(() => (this.pad = [...keys]));
  }

  /** Ends a walk to a far cell (#1137): a key, a drag of the camera or the stick. The step under way finishes. */
  cancelWalk(): void {
    if (this.route.length === 0) return;
    this.arrows(() => (this.route = []));
    this.mark(document.body.dataset.openworld!);
  }

  /** Turns the camera by `by` radians round the hero: the Q and E keys, a right-button drag (`orbit`) and a twist. The view eases to
   * the new angle, and the angle is saved with the world (#1026). */
  turn(by: number): void {
    this.view!.turn(by);
    this.dirty = true;
    this.persist();
    this.mark(document.body.dataset.openworld!);
  }

  /** Settles the camera on the nearest resting angle (30 degrees plus a multiple of 60): a drag or a twist turns freely while held, and ends here (#1251, #1254). */
  settle(): void {
    this.turn(restYaw(this.view!.yaw) - this.view!.yaw);
  }

  /** A drag of the right button by `px` pixels to the right turns the camera by ORBIT_PER_PX a px (#1026). */
  orbit(px: number): void {
    this.turn(px * ORBIT_PER_PX);
  }

  /** An arrow key let go; no argument (the window lost focus) lets go of all of them. The walk ends with the last one: the step
   * under way finishes, and no step follows (#1059). */
  release(key?: string): void {
    this.arrows(() => {
      if (key === undefined) {
        this.held.clear();
        this.pad = [];
      } else this.held.delete(key);
    });
  }

  /** A press at `x`, `y` pixels of a `width` x `height` screen rolls the hero onto the cell under it when it is next to it; with
   * steering on, a far cell is walked to, round the obstacles (#1137). */
  press(x: number, y: number, width: number, height: number): void {
    if (this.asked) return;
    const [nx, ny] = [(x / width) * 2 - 1, 1 - (y / height) * 2];
    const near = this.view!.pick(nx, ny);
    if (!this.steering() || !same(near, this.hero!.at)) return void this.roll(near);
    const target = this.view!.pickGround(nx, ny);
    if (target && !same(target, this.hero!.at) && !neighbours(this.hero!.at).some((n) => same(n, target))) this.walkTo(target);
    else this.roll(near);
  }

  /** Walks the hero to the far cell `to` (#1137): the bridge finds the way round the obstacles, and the hero takes it one cell a
   * glide, at the steady speed of a held walk. Nothing when there is no way. */
  private walkTo(to: Axial): void {
    const hero = this.hero!;
    const blocked = Int32Array.from([...this.fight.enemiesAround(this.world!, hero.at, PATH_REACH).flat(), ...this.landmarks()]);
    const cells = this.path(this.seed, hero.at, to, blocked, flat(this.world!.broken));
    const route = Array.from({ length: cells.length / 2 }, (_, i): Axial => [cells[2 * i]!, cells[2 * i + 1]!]);
    if (route.length > 0) this.arrows(() => (this.route = route));
  }

  /** The cells a walk goes round, `q, r` pairs: the lairs, and the towns and gates (#1593), which are entered by a roll onto them. */
  private landmarks(): number[] {
    return [...this.lairs.flat(), ...this.places.flatMap(({ cell }) => cell)];
  }

  /** The HUD's Dungeon button (#1291): walks the hero to the nearest tower with a way, the unbeaten first, by the route of a tap to
   * walk; the HUD's note says when there is none. Returns whether a walk began. */
  dungeon(): boolean {
    const hero = this.hero!;
    const blocked = Int32Array.from([...this.fight.enemiesAround(this.world!, hero.at, PATH_REACH).flat(), ...this.landmarks()]);
    const guided = this.guided();
    const later = this.lairs.flatMap((_, i) => (this.beaten.includes(i) || guided[i] ? [] : [i])); // the towers of a farther ring: tried last, as the beaten
    const cells = this.dungeonPath(this.seed, hero.at, Int32Array.from([...this.beaten, ...later].sort((a, b) => a - b)), blocked, flat(this.world!.broken));
    const note = document.getElementById('openworld-dungeon-note');
    if (note) note.textContent = cells.length > 0 ? '' : 'No tower in reach: walk on and try again.';
    if (cells.length === 0) return false;
    const route = Array.from({ length: (cells.length - 1) / 2 }, (_, i): Axial => [cells[2 * i + 1]!, cells[2 * i + 2]!]);
    this.arrows(() => (this.route = route));
    return true;
  }

  /** Opens the map of the cells discovered (#1411) over the world, on the hero, or closes it: the HUD's Map button, M, the pad's View.
   * The hero ends its walk and lets go of the arrows held: it stays while the map is open. Nothing outside a world. */
  toggleMap(): void {
    if (!this.active || this.asked) return; // the prompt is modal (#1662)
    if (this.mapShown) return this.closeMap();
    this.openMap(false);
  }

  /** The map, made when it first opens, opened on the hero; `choose` for the choice of a teleporter (#1412), where a click picks the
   * teleporter near the cell under it. */
  private openMap(choose: boolean): void {
    this.cancelWalk();
    this.release();
    if (!this.worldMap) {
      const map = new WorldMap((centre, radius) => this.mapData(windowCells(this.seen, centre, radius)));
      map.pick = (cell) => void (map.choosing && this.choose(teleporterNear(this.discoveredTeleporters(), cell)));
      this.worldMap = map;
    }
    this.worldMap.open(this.hero!.at, ...this.size, choose);
    document.getElementById('openworld-map-button')?.setAttribute('aria-expanded', 'true');
  }

  /** The Teleport action (#1412): the HUD's Teleport button, T and the pad's Y. On a teleporter it opens the map in the choice of a
   * teleporter, and closes it again; nothing off a teleporter or outside a world. */
  teleport(): void {
    if (!this.active || this.asked) return; // the prompt is modal (#1662)
    if (this.mapShown) return this.closeMap();
    if (this.onTeleporter()) this.openMap(true);
  }

  /** Whether the hero stands on a teleporter. */
  private onTeleporter(): boolean {
    return this.teleporters.some((cell) => same(cell, this.hero!.at));
  }

  /** The teleporters discovered so far: the ones on a discovered cell (#1411), so the save needs nothing more. */
  private discoveredTeleporters(): Axial[] {
    return this.teleporters.filter(([q, r]) => this.discovered.has(q, r));
  }

  /** The choice of the teleporter `to` on the map (#1412), none for a click on no teleporter: the hero and the troop move there by the
   * rules of openworldteleport.ts, with no glide and no push, and the map closes; a refused one is said in the map's caption. */
  private choose(to: Axial | null): void {
    if (!to) return this.worldMap!.note('No discovered teleporter there');
    const hero = this.hero!;
    const moved = teleport(this.teleporters, (q, r) => this.discovered.has(q, r), hero.at, to, hero.troop.length, this.free);
    if ('refused' in moved) return this.worldMap!.note(moved.refused);
    this.closeMap();
    hero.at = moved.hero;
    hero.troop = moved.troop;
    this.view!.snap();
    this.view!.show(hero.at, hero.troop);
    this.dirty = true;
    this.persist();
    this.mark(document.body.dataset.openworld!);
  }

  /** Whether a marble can stand on `cell` now: open ground, no enemy, no lair (the troop's cells round a teleporter, #1412). */
  private readonly free = ([q, r]: Axial): boolean =>
    WALKABLE.has(this.world!.tile(q, r)?.terrain ?? 'water') && !this.fight.occupied(this.world!, q, r) && !this.lairs.some((cell) => same(cell, [q, r])) && !this.places.some(({ cell }) => same(cell, [q, r]));

  /** Shows the HUD's Teleport button while the hero stands on a teleporter. */
  private showTeleport(on: boolean): void {
    const button = document.getElementById('openworld-teleport');
    if (button) button.hidden = !on;
  }

  /** Whether the map is open. */
  get mapShown(): boolean {
    return this.worldMap?.shown ?? false;
  }

  /** The pad's stick pans the open map as a drag of `dx`, `dy` px. */
  panMap(dx: number, dy: number): void {
    this.worldMap!.pan(dx, dy);
  }

  private closeMap(): void {
    this.worldMap?.close();
    document.getElementById('openworld-map-button')?.setAttribute('aria-expanded', 'false');
  }

  /** The camera's yaw the minimap and the map were last drawn at (#1448). */
  private mapYaw = 0;

  /** The tile of a discovered cell, `void` when it is off the world (`World.tile` has none, #1453), none for a cell not discovered:
   * the minimap and the map draw only these. */
  private readonly seen = (q: number, r: number): Tile | 'void' | undefined => (this.discovered.has(q, r) ? (this.world!.tile(q, r) ?? 'void') : undefined);

  /** What the minimap and the map draw, with the `cells` given: the hero, the troop, the enemies near the hero on discovered cells and the
   * lairs, which are landmarks seen from afar. */
  private mapData(cells: MinimapCell[]): MinimapData {
    const { world, hero } = this;
    const bosses = this.bossIds();
    const guided = this.guided();
    return {
      cells,
      hero: hero!.at,
      troop: hero!.troop,
      enemies: this.fight.enemiesAround(world!, hero!.at, MAP_RADIUS).filter(([q, r]) => this.discovered.has(q, r)),
      lairs: this.lairs.flatMap((cell, i) =>
        guided[i] || this.beaten.includes(i) || this.discovered.has(cell[0], cell[1]) ? [{ cell, beaten: this.beaten.includes(i), boss: bosses[i % bosses.length], guided: guided[i] }] : [], // a farther ring's tower shows once its cell is discovered (#1532)
      ),
      teleporters: this.discoveredTeleporters(),
      places: this.places,
      logs: this.logs.flatMap((cell, i) => (this.discovered.has(cell[0], cell[1]) ? [{ cell, found: this.found.includes(i) }] : [])),
      yaw: (this.mapYaw = this.view!.drawnYaw), // the camera's drawn yaw: the map turns with it (#1448)
    };
  }

  /** Zooms the Open world camera by `scale`: more than 1 further out, less than 1 closer (#976). While the map is open it zooms the map. */
  zoom(scale: number): void {
    if (this.mapShown) return this.worldMap!.zoom(scale);
    this.view!.snap();
    this.view!.zoomBy(scale);
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
  }

  /** Moves the camera after the hero (`follow`), then draws the scene when something changed since the last draw (the follow
   * included, until it settles), and every frame while a lake is in view and motion is on. `now` is the frame time in ms: the page
   * passes the animation frame's own time, so every frame is drawn at an even step of the clock (#1333). Returns
   * whether it drew: the FPS readout counts the frames really rendered (#1064). */
  frame(render: (scene: THREE.Scene, camera: THREE.Camera) => void, now = performance.now()): boolean {
    if (!this.view) return false; // left: nothing to draw
    this.flush(); // at most one save a frame, of the state the frame ends on (#968)
    const seconds = (now - this.clock) / 1000;
    this.clock = now;
    const reduced = this.reduced();
    if (this.counted > 0) this.tod = wrapTime(this.tod + Math.min(now - this.counted, MAX_DAY_STEP_MS)); // the world's time passes while it is open, a stalled frame counts a quarter second at most (#1496)
    this.counted = now;
    if (this.view.setTime(this.tod, !reduced)) this.dirty = true; // the sky and the sun, drawn again as they change
    this.markPhase();
    this.nameBiome(); // the biome entered (#1742)
    if (this.slide && now >= this.slide.at) {
      const { to } = this.slide;
      this.slide = null;
      this.sliding = true; // one slide: it does not slide again
      this.roll(to, now);
      this.sliding = false;
    }
    if (this.phases.changed(this.view, this.phase)) this.cue('time-of-day'); // dusk, night, day: the first sight of a world is silent
    this.stepWander(now);
    if (this.calmUntil > 0 && now >= this.calmUntil) {
      this.calmUntil = 0;
      this.wild(); // the calm is over: a marble that has stayed next to the hero fights
    }
    if (this.view!.follow(seconds, reduced)) this.dirty = true; // the camera follows the hero, its turn and its zoom (#988, #1026, #1333)
    if (this.view!.drawnYaw !== this.mapYaw) this.drawMap(); // the minimap and the map turn with the camera, only while it turns (#1448)
    this.beat(now); // the held arrows walk on, one step per GLIDE_MS: before the tick, so the step begun is drawn by this frame (#1065)
    if (!this.view) return false; // the step walked onto a lair and left the mode
    if (this.view!.tick(now)) this.dirty = true; // the marbles of a push in between their cells, drawn every frame (#967)
    this.anim();
    if (this.peers?.frame(now, this.hero!.at, this.hero!.troop, this.view!.bobAt)) this.dirty = true; // the other heroes: sent, received, drawn (#1305)
    if (this.view!.offsets(now)) this.dirty = true; // the camera's punch and shake, on top of the follow (#1103)
    const sparks = this.view!.sparkle(now, reduced, this.lowTier()); // the particles of the biome (#1110): they keep the scene live while any drifts
    this.countSparks();
    const loops = this.view!.animate(now, reduced || this.lowTier()); // the foam, the ripples and the trees' sway (#1101, #1102)
    this.countMotion();
    if (!this.dirty && !sparks && !loops) return false;
    this.dirty = false;
    render(this.view!.scene, this.view!.camera);
    this.drawn++;
    if (this.calmUntil === Infinity) this.calmUntil = now + FLEE_GRACE_MS; // the calm starts on the first draw, so a slow page (software GL) gets its 5 s (#1511)
    this.view!.drain(); // what this frame replaced is no longer in use by it (#1017)
    return true;
  }

  /** Changes the arrows held, by the keys or by the stick. The first arrow down steps the hero at once, and the cadence starts; no
   * arrow left held stops it (#1059). A second arrow changes the direction on the next step, with no step of its own. */
  private arrows(update: () => void): void {
    const idle = this.idle();
    update();
    if (this.idle()) {
      this.nextStep = Infinity;
      if (!idle) this.stop(performance.now()); // the walk ends: the step under way slows to a rest (#1065)
    } else if (idle) {
      const now = performance.now();
      this.nextStep = now + GLIDE_MS;
      this.stepHeld(now);
    }
  }

  /** The walk stops at `now` (ms), by a release, a blocked step or arrows that cancel: the next step starts from rest, and the glide
   * under way slows to a rest on its cell, on time (#1065). */
  private stop(now: number): void {
    this.cruising = false;
    this.walked = 0;
    this.view!.brake(now);
  }

  /** Whether no arrow is held, by a key or by the stick. */
  private idle(): boolean {
    return this.held.size === 0 && this.pad.length === 0 && this.route.length === 0;
  }

  /** The cadence of the held arrows: one step every GLIDE_MS, made by the frame loop at `now` (ms), never by a key repeat (#1059).
   * The schedule keeps its own clock, so a frame late by part of a step does not stretch the walk: the average is one cell per
   * GLIDE_MS, whatever the refresh rate. More than a step behind (a hidden tab), it restarts from the frame. */
  private beat(now: number): void {
    if (now < this.nextStep) return;
    const late = now - this.nextStep > stepMs(this.walked);
    // A step is made at its due time, not at the frame that makes it: the glides chain end to end whatever the frame rate (#1065).
    const due = late ? now : this.nextStep;
    if (late) {
      this.cruising = false; // a hidden tab: the walk starts again from rest
      this.walked = 0;
    }
    this.nextStep = due + stepMs(this.walked); // the next step is due when this one's glide ends (#1290)
    this.stepHeld(due);
    if (this.walked === 0 && this.nextStep !== Infinity) this.nextStep = due + GLIDE_MS; // a blocked step restarts the walk: the retry is at the first pace
  }

  /** One step in the direction of the arrows held now (`heroStep`), made at `at` (ms): a blocked one slides round the obstacle, and leans
   * the hero (`lean`) only when no side is free; arrows that cancel stop the walk. */
  private stepHeld(at: number): void {
    if (this.held.size === 0 && this.pad.length === 0) return this.stepRoute(at);
    const free = (to: Axial): boolean => enter(this.world!, this.fight, this.hero!.at, to) !== 'refused';
    const keys = new Set([...this.held, ...this.pad]);
    const to = heroStep(this.hero!.at, keys, this.view!.yaw, this.steering(), free);
    if (to) this.roll(to, at, this.cruising ? 'walk' : 'start');
    else this.stop(at);
  }

  /** The next cell of the walk to a far cell (#1137), at `at` (ms), by the same `Hero.step` as any step: a refused step ends the walk,
   * and so does its last cell. */
  private stepRoute(at: number): void {
    const to = this.route.shift()!;
    const moved = this.roll(to, at, this.cruising ? 'walk' : 'start');
    if (!moved) this.route = [];
    if (this.route.length > 0) return;
    if (this.active) this.mark(document.body.dataset.openworld!);
    this.nextStep = Infinity;
    if (moved) this.stop(at);
  }

  /** The hero steps to `to`, at `at` (ms); `pace` is the pace of its glide: a `tap` (a press on the screen) eases out, the steps of
   * the held arrows keep one speed (#1065). */
  private roll(to: Axial, at = performance.now(), pace: Pace = 'tap'): boolean {
    if (this.fighting || this.asked) return false;
    this.closeLog(); // the next move closes the panel of a log (#1589)
    const lair = this.lairs.findIndex((cell) => same(cell, to));
    const next = neighbours(this.hero!.at).some((n) => same(n, to));
    if (lair >= 0 && next) return this.enterLair(lair), false;
    const place = this.places.find(({ cell }) => same(cell, to));
    if (place && next) return this.enterPlace(place), false; // a town or a dungeon gate is entered as a lair is (#1593)
    const from = this.hero!.at;
    if (!this.hero!.step(to)) return this.lean(to, at), false;
    this.cruising = pace !== 'tap';
    if (this.lesson) this.endLesson(); // the first roll of the lesson (#1604)
    const span = pace === 'tap' ? GLIDE_MS : stepMs(this.walked);
    this.walked = pace === 'tap' ? 0 : this.walked + 1;
    if (this.hero!.smashed) {
      this.view!.smash(to, this.hero!.smashed, at, this.reduced()); // an obstacle broken on the way (#1147)
      this.peers?.broke(to); // and told to the other heroes (#1305)
      this.gather(breakYield(this.hero!.smashed, this.world!.tile(to[0], to[1])!.biome)); // wood or ore (#1655)
    }
    this.view!.snap(); // a step during a push's animation ends it first (#967)
    const now = this.reduced() ? null : at;
    if (now !== null) this.view!.puff(now); // dust from the cell it leaves (#1110)
    if (now !== null) this.view!.ripple(from, this.hero!.at, now, this.lowTier()); // a ring on the water next to it (#1101)
    this.view!.show(this.hero!.at, this.hero!.troop, now === null ? undefined : { now, span: span * slowBy(), pace }); // the step glides (#1040)
    const played = this.wild(from) ? null : this.troopPush(); // a marble that touches the hero fights: the troop does not push it (#1511)
    const joined = played !== null && this.recruit(played);
    if (played) this.gather(ejectYield(this.hero!.at, played.push.ejected.length)); // parts for the marbles ejected (#1655)
    this.view!.updateEnemies();
    const log = this.logs.findIndex((cell) => same(cell, this.hero!.at));
    const picked = joined || (log >= 0 && !this.found.includes(log)); // a marble joins the troop, or a log is found for the first time (#1570)
    if (log >= 0) this.readLog(log); // rolled onto a lore log (#1589)
    // One cue for the move: the pickup, else the step, which a walk to a far cell sounds only for its last cell and a fast walk one in two.
    if (picked) this.cue('pickup');
    else if (this.route.length === 0 && this.steps.due(at)) this.cue('step');
    if (played && now !== null) {
      this.view!.playPush(played, now, slowBy(), HIT_HOLD_MS * slowBy()); // the push lunges once the step has landed, holding its contact frame (#1561)
      const landed = now + span * slowBy();
      this.view!.punch(landed); // the camera feels the push (#1103)
      if (played.push.ejected.length > 0) this.view!.shake(landed); // and shakes when an enemy is ejected
      if (joined) this.view!.join(this.hero!.troop); // the recruit stands beside the hero while the push is drawn (#1531)
    } else if (played) this.view!.show(this.hero!.at, this.hero!.troop); // reduced motion: the marbles jump
    this.dirty = true;
    this.persist();
    this.mark(document.body.dataset.openworld!);
    this.fileReached();
    this.slideOnIce(from, played !== null, at + span * slowBy()); // the tundra's ice (#1739)
    return true;
  }

  /** The tundra's ice (#1739): a roll that ends on a tundra cell, with nothing broken nor pushed, slides one cell more the same way once the
   * glide has landed, when that cell is free; the slide itself does not slide again. */
  private slideOnIce(from: Axial, pushed: boolean, landed: number): void {
    const at = this.hero!.at;
    if (this.sliding || pushed || this.hero!.smashed || this.world!.tile(at[0], at[1])?.biome !== 'tundra') return;
    const beyond: Axial = [2 * at[0] - from[0], 2 * at[1] - from[1]];
    const free = enter(this.world!, this.fight, at, beyond) === 'rolls' && !this.lairs.some((cell) => same(cell, beyond)) && !this.places.some(({ cell }) => same(cell, beyond));
    if (free) this.slide = { to: beyond, at: landed };
  }
  private slide: { to: Axial; at: number } | null = null;
  private sliding = false;

  /** Tally files the first town, gate, tower or remembered biome the hero reaches (#1315) in the HUD's line, once per kind. */
  private fileReached(): void {
    const at = this.hero!.at;
    const sites = [
      ...this.places.map(({ kind, cell }) => ({ kind: kind === 'town' ? ('town' as const) : ('gate' as const), cell })),
      ...this.lairs.map((cell) => ({ kind: 'tower' as const, cell })),
    ];
    const line = this.placeLine(placesReached(at, sites, this.world!.tile(at[0], at[1])!.biome));
    const tally = document.getElementById('openworld-tally');
    if (line && tally) tally.textContent = line;
  }

  /** The hero rolled onto the lore log `log` (#1589): its panel opens, it is marked found in the world and read in the archive. It never holds a move. */
  private readLog(log: number): void {
    const { id, title, body } = WORLD_LOGS[log]!;
    if (!this.found.includes(log)) {
      this.found.push(log);
      this.gather(logYield()); // a shard for a log found (#1655)
      this.view!.setLogs(this.logs, this.found);
      this.persist();
    }
    this.read(id);
    const panel = document.getElementById('openworld-log');
    if (panel) {
      document.getElementById('openworld-log-title')!.textContent = title;
      document.getElementById('openworld-log-body')!.textContent = body;
      panel.hidden = false;
    }
    document.body.dataset.openworldLog = id; // read by the browser checks
  }

  /** Closes the panel of a lore log. */
  private closeLog(): void {
    const panel = document.getElementById('openworld-log');
    if (panel) panel.hidden = true;
    delete document.body.dataset.openworldLog;
  }

  /** The hero walks onto the lair `lair` (#1170): the world is saved with the hero on the lair's entrance, the cell it came from, and
   * left; the page starts the boss fight. */
  private enterLair(lair: number): void {
    const seed = this.seed;
    const ids = this.bossIds();
    this.transition.enter('tower', placeTitle('tower', ids.length > 0 ? this.bossName(ids[lair % ids.length]!) : '')); // over the fight that starts at once (#1519)
    this.persist();
    this.leave();
    this.onLair(seed, lair, [...this.army.brought], [...this.army.relicsBrought]);
  }

  /** The hero rolls onto a town or a dungeon gate (#1593): the world is saved with the hero on the entrance, as for a lair, and left; the page
   * opens the Hub or starts the run. It is told the place's index among those of its kind (#1516), the spawn town 0, and the biome of its ground (#1597). */
  private enterPlace(place: { cell: Axial; kind: 'town' | 'dungeon' }): void {
    const seed = this.seed;
    const index = this.places.filter(({ kind }) => kind === place.kind).indexOf(place); // the place among those of its kind: the spawn town is 0 (#1516)
    const biome = this.world!.tile(place.cell[0], place.cell[1])!.biome; // the ground the gate stands in: its run begins in that biome (#1597)
    const contract = place.kind === 'town' ? this.contractOf(place.cell) : ''; // the town's posted contract (#1618), read before the view is left
    this.transition.enter(place.kind, placeTitle(place.kind, '')); // over the Hub or the run that starts at once (#1519)
    this.persist();
    this.leave();
    this.onPlace(seed, place.kind, index, biome, contract);
  }

  /** The posted contract of the town at `town` (#1618, section 18): the nearest tower of the ring to beat, by its boss and ring, as the Nearest
   * tower button points. */
  private contractOf(town: Axial): string {
    const guided = this.guided();
    const ids = this.bossIds();
    return contractLine({
      hero: town,
      yaw: this.view!.drawnYaw,
      lairs: this.lairs.map((cell, i) => ({ cell, beaten: this.beaten.includes(i), guided: guided[i], name: this.bossName(ids[i % ids.length]!), ring: this.ringOf(i) })),
    });
  }

  /** A blocked step leans the hero toward the cell it cannot take, and back: nothing under reduced motion (#1040). */
  private lean(to: Axial, at: number): void {
    this.stop(at);
    if (!this.reduced()) this.view!.nudge(this.hero!.at, to, at, NUDGE_MS * slowBy());
  }

  /** The troop's attack after a step: the engine plays the legal push, if there is one, on the hero, the troop and the enemies near
   * the hero (`FightState.troopPush`). The hero and the troop take the cells it gives (the hero's first). Returns the push as it was
   * played, from the cells before it, for its animation; `null` when no push was legal. */
  private troopPush(): Played | null {
    const played = this.fight.troopPush(this.world!, this.seed, [this.hero!.at, ...this.hero!.troop], this.world!.broken, this.hero!.tick);
    if (!played) return null;
    const [hero, ...troop] = played.push.troop;
    this.hero!.at = hero!;
    this.hero!.troop = troop;
    this.pushes++;
    for (const cell of played.push.homes) this.peers?.beaten(cell); // an enemy beaten is told to the other heroes (#1305), by the cell it started on (#1511)
    return played;
  }

  /** A marble the push ejected joins the troop (#1531): the free cell nearest the hero takes it, up to `RECRUIT_MAX`. Reports whether one joined. */
  private recruit({ push }: Played): boolean {
    if (push.ejected.length === 0) return false;
    const hero = this.hero!;
    const cell = recruitCell(hero.at, hero.troop, this.recruits, this.free);
    if (!cell) return false;
    hero.troop = [...hero.troop, cell];
    this.recruits++;
    this.plateRecruits(true);
    return true;
  }

  /** The hero gathered `got` (#1655): it is added to the counts, told on the plate and saved with the world. */
  private gather(got: Resources): void {
    this.resources = addResources(this.resources, got);
    this.plateResources();
    this.persist();
  }

  /** The plate's line of the counts and the page's mark (`openworldResources`: wood, ore, parts, shards). */
  private plateResources(): void {
    const { wood, ore, parts, shards } = this.resources;
    document.body.dataset.openworldResources = `${wood},${ore},${parts},${shards}`;
    const line = document.getElementById('openworld-resources');
    if (line) line.textContent = resourceLine(this.resources);
  }

  /** The plate's line of the recruits (#1531): hidden while there are none, else "Recruits n / 5", with the joining told when one just did. */
  private plateRecruits(joined: boolean): void {
    const line = document.getElementById('openworld-recruits');
    if (!line) return;
    line.hidden = this.recruits === 0;
    line.textContent = `${joined ? 'A marble joins the troop. ' : ''}Recruits ${this.recruits} / ${RECRUIT_MAX}`;
  }

  /** Marks the world as changed: it is saved by the next frame, or when the mode is left. */
  private persist(): void {
    this.unsaved = true;
  }

  /** Saves the world as it is now, when it changed since the last save. The write is not waited for: a storage that fails is no
   * game error, and the save is counted (`openworldSaved`) only once it is stored. */
  private flush(): void {
    if (!this.unsaved) return;
    this.unsaved = false;
    const { at, troop } = this.hero!;
    void this.saves.put(this.seed, at, troop, this.fight, this.view!.yaw, this.world!.broken, this.beaten, this.discovered.toJSON(), this.tod, this.found, this.recruits, this.resources, this.army).then((stored) => {
      if (stored) document.body.dataset.openworldSaved = String(++this.writes);
    });
  }

  /** The marbles take a step when the clock has ticked (#1511): the fight is told the tick, and the view lays them on their new cells and
   * rolls the ones that stepped. It waits for a push being drawn to end, since the push holds the cells it was played on. Called by the
   * frame, and by the test hook that sets the clock (`snap`: it ends a push or a roll being drawn first, so the cells are final). */
  stepWander(now = performance.now(), snap = false): void {
    const tick = this.wander();
    if (snap) this.view?.snap();
    if (tick === this.ticked || !this.view || this.view.animating || this.asked) return;
    this.ticked = tick;
    this.fight.setHeld(this.hero!.troop);
    this.fight.setClock(this.seed, tick);
    this.view.wander(now, this.reduced(), slowBy());
    this.dirty = true;
    this.mark(document.body.dataset.openworld!);
    this.wild(); // a marble that walked up to the hero fights
  }

  /** Asks (#1662) when a generated marble no push has moved touches the hero (within one cell) and no calm is due: the walk ends, the world is
   * saved with the hero where it stands and waits for Fight (`startFight`, #1511) or Back away (`backAway`). `from` is the cell the hero stepped
   * from, null when it stood still. A group the hero backed away from asks nothing until the hero has left contact. Reports whether it asked. */
  private wild(from: Axial | null = null): boolean {
    if (this.fighting || this.asked || !this.view) return false;
    const touching = this.fight.wildContact(this.world!, this.hero!.at);
    if (!touching) return (this.declined = null), false;
    if (this.calmUntil > 0) return false;
    if (this.declined && same(this.declined, touching.home)) return false;
    this.declined = null;
    this.closeMap(); // a map open when the marble arrives: Esc and the keys answer the prompt, not the map
    this.asked = { home: touching.home, at: touching.at, from };
    this.held.clear();
    this.pad = [];
    this.route = [];
    this.nextStep = Infinity;
    this.persist();
    this.onAsk(true);
    return true;
  }

  /** Whether a prompt waits for the answer: the world is paused (#1662). */
  get asking(): boolean {
    return this.asked !== null;
  }

  /** Fight, the prompt's answer (#1662): the wild fight starts, with the seed, the cell the marble starts on and what the army brings. */
  startFight(): void {
    const asked = this.asked;
    if (!asked) return;
    this.asked = null;
    this.fighting = true;
    this.onAsk(false);
    this.onWild(this.seed, asked.home, [...this.army.brought], [...this.army.relicsBrought]);
  }

  /** Back away, the prompt's answer (#1662): the hero goes back to the cell it came from, or when it stood still to the free neighbour
   * farthest from the marble (none free: it stays); the group asks nothing until contact is remade, and the marbles are calm for 5 s. */
  backAway(): void {
    const asked = this.asked;
    if (!asked) return;
    this.asked = null;
    this.declined = asked.home;
    this.calmUntil = performance.now() + FLEE_GRACE_MS;
    this.onAsk(false);
    const hero = this.hero!;
    const free = (to: Axial): boolean => enter(this.world!, this.fight, hero.at, to) === 'rolls' && !this.lairs.some((cell) => same(cell, to)) && !this.places.some(({ cell }) => same(cell, to));
    const farthest = neighbours(hero.at).filter(free).sort((a, b) => cellDistance(b, asked.at) - cellDistance(a, asked.at))[0];
    const to = asked.from && free(asked.from) ? asked.from : farthest;
    if (to) this.roll(to);
  }

  /** The mark of a push being drawn (`openworldAnim`, for the browser checks): set while the view draws it, removed otherwise. */
  private anim(): void {
    if (this.view?.animating) document.body.dataset.openworldAnim = '1';
    else delete document.body.dataset.openworldAnim;
    // The mark of a glide (#1040), for the browser checks only: the hero's drawn place while its marbles move, removed once they land.
    if (!navigator.webdriver) return;
    if (this.view?.gliding) document.body.dataset.openworldGlide = `${this.view.focusPoint.x.toFixed(2)},${this.view.focusPoint.z.toFixed(2)},${this.view.heroY.toFixed(3)}`;
    else delete document.body.dataset.openworldGlide;
  }

  /** Whether the page is on the low quality tier, where the effects of the water and the trees are off (#1101). */
  private lowTier(): boolean {
    return document.body.dataset.tier === 'low';
  }

  /** What moves (`openworldMotion`: `water`, `trees`, both or empty), for the browser checks only. */
  private countMotion(): void {
    if (!navigator.webdriver) return;
    if (document.body.dataset.openworldMotion !== this.view!.alive) document.body.dataset.openworldMotion = this.view!.alive;
  }

  /** The particles drawn (`openworldParticles`), for the browser checks only: written when the count changes. */
  private countSparks(): void {
    if (!navigator.webdriver) return;
    const count = String(this.view!.sparkCount);
    if (document.body.dataset.openworldParticles !== count) document.body.dataset.openworldParticles = count;
  }

  /** The minimap's canvas, made on the first draw and left at the end of the body: the page's own canvas stays the first one (`querySelector('canvas')`). */
  private mapCanvas(): HTMLCanvasElement {
    let canvas = document.getElementById('openworld-minimap') as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = Object.assign(document.createElement('canvas'), { id: 'openworld-minimap', width: 288, height: 288 });
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Minimap of the Open world');
      document.body.append(canvas);
    }
    return canvas;
  }

  /** Draws the minimap (#1410) from the world as it is: called by `mark`, so on a step, a push and a camera turn, never on a frame. The
   * cells not discovered stay dark (#1411). The map, when open, is drawn again too. */
  private drawMap(): void {
    this.showGoal();
    if (this.mapShown) this.worldMap!.draw();
    const canvas = this.mapCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawMinimap(ctx, canvas.width, this.mapData(windowCells(this.seen, this.hero!.at)));
  }

  private mark(seed: string): void {
    this.anim();
    this.discovered.reveal(this.hero!.at); // the cells within 10 of the hero (#1411): saved with the step that reached them
    document.body.dataset.openworldDiscovered = String(this.discovered.count);
    this.drawMap();
    document.body.dataset.openworld = seed;
    const shown = document.getElementById('openworld-seed'); // the HUD's seed, to read or share (#1021)
    if (shown) shown.textContent = seed;
    document.body.dataset.openworldAt = this.hero!.at.join(',');
    document.body.dataset.openworldTroop = this.hero!.troop.map((c) => c.join(',')).join(' ');
    document.body.dataset.openworldEnemies = String(this.view!.enemyCount);
    document.body.dataset.openworldBeaten = String(this.fight.beaten);
    document.body.dataset.openworldRecruits = String(this.recruits); // #1531
    document.body.dataset.openworldPush = String(this.pushes);
    document.body.dataset.openworldZoom = String(this.view!.zoom);
    document.body.dataset.openworldRoute = String(this.route.length); // the cells of a walk to a far cell still to take (#1137)
    document.body.dataset.openworldBroken = String(this.world!.broken.length); // the obstacles broken (#1147)
    document.body.dataset.openworldLairs = this.lairs.map((c) => c.join(',')).join(' ');
    document.body.dataset.openworldPlaces = this.places.map(({ kind, cell }) => `${kind}:${cell.join(',')}`).join(' '); // #1514
    document.body.dataset.openworldRings = this.rings.join(' '); // #1532
    document.body.dataset.openworldGateRings = this.placeRings.filter((_, i) => this.places[i]!.kind === 'dungeon').join(' ');
    document.body.dataset.openworldLairsBeaten = this.beaten.join(' ');
    document.body.dataset.openworldLairsHeard = this.heard.join(' '); // reported by others, not counted
    document.body.dataset.openworldTeleporters = this.discoveredTeleporters().map((c) => c.join(',')).join(' '); // #1412
    this.showTeleport(this.onTeleporter());
    document.body.dataset.openworldLogs = this.logs.filter(([q, r]) => this.discovered.has(q, r)).map((c) => c.join(',')).join(' '); // #1589
    document.body.dataset.openworldLogsFound = this.found.join(' ');
    document.body.dataset.openworldYaw = String(Math.round((this.view!.yaw * 180) / Math.PI)); // the turn, in degrees (#1026)
    document.body.dataset.openworldDrawn = JSON.stringify(this.view!.drawn);
    this.markPhase();
  }

  /** The phase on the page (`openworldPhase`, #1496), written when it changes. */
  /** The biome the banner last named (#1742). */
  private named: Biome | null = null;
  private bannerTimer = 0;
  /** Names the biome the hero enters, with what is left there (`biomeLine`), for 3 s: at the first sight of a world, and at each border. */
  private nameBiome(): void {
    const biome = this.biome;
    const banner = document.getElementById('openworld-biome');
    if (!biome || biome === this.named || !banner) return;
    this.named = biome;
    banner.textContent = biomeLine(biome, this.lairs.length, this.beaten, this.logs.length, this.found);
    banner.hidden = false;
    banner.classList.remove('fade');
    void banner.offsetWidth; // the fade starts again
    banner.classList.add('fade');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (banner.hidden = true), BANNER_MS);
  }

  private markPhase(): void {
    if (document.body.dataset.openworldPhase !== this.phase) document.body.dataset.openworldPhase = this.phase;
    const clock = document.getElementById('openworld-clock');
    const line = clockLine(this.tod); // the world's hour, its phase and the time to the next (#1743)
    if (clock && clock.textContent !== line) clock.textContent = line;
  }
}
