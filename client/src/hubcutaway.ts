// The Hub Cutaway (#1689): the ship as a diorama of decks and bays, behind `?hub=cutaway` (off by default). Two shells of one kit (art/blender/hub-cutaway.blend,
// exported by art/blender/export_cutaway.py): tall under 600 px wide or 500 px high, wide above. The file holds every state of every part, one node per part named
// hub_<layout>_<part>_<deck>_<room>; the game picks the nodes of the state and bakes the whole ship into ONE mesh, the colour of a deck and a state a per-vertex
// glow (no material per state). The marble and the lift's car are two more meshes (they move, hubship.ts, #1691); the bays are the tap targets (hubbays.ts).
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { framing, type View } from './camera';
import { DECK_NAMES, type Deck } from './deck';
import type { Bay, Pos } from './hubroll';
import { NEON } from './neonlook';

export type Layout = 'tall' | 'wide';

/** `?hub=cutaway`: the flag is its own parameter, `?look=` is read by the neon look as the old terrace. */
export const cutawayOn = (search: string): boolean => new URLSearchParams(search).get('hub') === 'cutaway';

/** The tall shell under 600 px wide or 500 px high, else the wide one. */
export const shellFor = (width: number, height: number): Layout => (width < 600 || height < 500 ? 'tall' : 'wide');

export const cutawayFile = (layout: Layout): string => `hub-cutaway-${layout}`;

// The colours of the Blender scene (hubcut.py PAL): the game's palette, per deck the lamp.
const COLOURS = {
  off: 0x000000,
  cyan: NEON.cyan,
  accent: 0x7fd6e8,
  violet: NEON.violet,
  rimlight: NEON.rimLight,
  white: NEON.whiteMarble,
  sodium: 0xd9822b,
  amber: 0xffb000,
  warm: 0xffe3bf,
  bridge: 0xe8f0ff,
  gold: 0xffd43b,
  danger: 0xff6b5a,
  muted: 0x9aa3a8,
} as const;
type Tone = keyof typeof COLOURS;
const LAMP: Record<Deck, Tone> = { mess: 'warm', cargo: 'accent', furnace: 'sodium', chapel: 'violet', bridge: 'bridge' }; // warm Mess, cyan Cargo, sodium Furnace, violet Chapel, cold white Bridge
export const GLOW = 1.7; // the emission strength of the glow material of the Blender scene
const MARBLE_GLOW = 0.6; // the marble's own emission: the only white thing in the ship

const SEATS = ['echo', 'hull', 'choir', 'chaplain', 'ballast'];
const BOSSES: ReadonlySet<string> = new Set([...SEATS, 'dual', 'alien', 'railyard', 'assembly', 'swarm', 'magnetizer', 'core', 'overseer', 'stalker', 'pulsar']);
const WAITS: ReadonlySet<string> = new Set(['royale', 'daily', 'world', 'run', 'coop', 'ranked', 'trainer']); // the mode rooms that wait for the first win
const DECOR: ReadonlySet<string> = new Set(['hold', 'crates', 'nave', 'vents', 'console']); // set pieces: lit with the deck, no state of their own

/** What the ship shows: the decks open, the bosses beaten, the next goal (a room id), and whether the first win is still awaited. */
export interface ShipState {
  open: ReadonlySet<string>;
  beaten: ReadonlySet<string>;
  goal: string | null;
  waiting: boolean;
}

type RoomState = 'dark' | 'locked' | 'goal' | 'beaten' | 'lit';
/** The state of a room: dark when its deck is shut, locked while the first win is awaited (the bosses and the mode rooms), the goal, beaten, else lit. */
export function roomState(room: string, deck: string, st: ShipState): RoomState {
  if (!st.open.has(deck)) return 'dark';
  if (st.waiting && (BOSSES.has(room) || WAITS.has(room))) return 'locked';
  if (st.goal === room) return 'goal';
  return st.beaten.has(room) ? 'beaten' : 'lit';
}

/** The state of a ship from the game's progress: Mess is open, a deck opens once the boss of the deck below it is beaten (hub.ts canEnter). */
export function shipState(beaten: readonly string[], locked: boolean, goal: string | null): ShipState {
  const open = DECK_NAMES.filter((_, i) => i === 0 || beaten.includes(SEATS[i - 1]!));
  return { open: new Set(open), beaten: new Set(beaten), goal, waiting: locked };
}

/** The room the next goal points to: the seat boss of its deck, or the Rogue-lite room; none when it points to none. */
export const goalRoom = (goal: { deck: Deck | null; room: 'boss' | 'run' | null }): string | null =>
  goal.room === 'run' ? 'run' : goal.room === 'boss' && goal.deck ? SEATS[DECK_NAMES.indexOf(goal.deck)]! : null;

export interface Part {
  kind: string; // bay, prop, set, seal, shaft, hatch, or a part of the ship alone (hull, mast, ...)
  deck: Deck | null;
  room: string; // the room, or the tier of a shaft
  variant: 'shut' | 'open' | null; // a boss door in one of its two states
}

const NODE = /^hub_(?:tall|wide)_(bay|prop|set|seal|shaft|hatch)_(mess|cargo|furnace|chapel|bridge)(\d|_[a-z]+)?(?:_(shut|open))?(?:\.\d+)?$/;
const ALONE = /^hub_(?:tall|wide)_(hull|mast|window|nozzles|airlock|cable|hollow|car|marble)(?:\.\d+)?$/;

/** What a node of the file is, from its name; null for a node of no part of the ship. */
export function partOf(name: string): Part | null {
  const alone = ALONE.exec(name);
  if (alone) return { kind: alone[1]!, deck: null, room: '', variant: null };
  const m = NODE.exec(name);
  if (!m) return null;
  return { kind: m[1]!, deck: m[2] as Deck, room: (m[3] ?? '').replace(/^_/, ''), variant: (m[4] as Part['variant']) ?? null };
}

const hex = (tone: Tone, k = 1): THREE.Color => new THREE.Color(COLOURS[tone]).multiplyScalar(k);

/** The glow colour of a part in a state (the object colour of the Blender scene), null when the state does not show the part. */
export function glowOf(part: Part, st: ShipState): THREE.Color | null {
  const deck = part.deck;
  const top = st.open.has('bridge');
  switch (part.kind) {
    case 'mast':
      return top ? hex('bridge') : hex('danger', 0.6);
    case 'window':
      return top ? hex('bridge') : hex('rimlight', 0.12);
    case 'nozzles':
      return hex('sodium');
    case 'airlock':
      return roomState('world', 'mess', st) === 'locked' ? hex('muted', 0.25) : hex('accent');
    case 'cable': {
      const s = roomState('run', 'cargo', st);
      return s === 'goal' ? hex('amber') : s === 'lit' || s === 'beaten' ? hex('accent') : hex('muted', 0.25);
    }
    case 'hollow':
      return hex('warm');
    case 'car':
      return hex('cyan');
    case 'marble':
      return hex('white');
    case 'shaft':
      return st.open.has(deck!) ? hex('cyan', 0.9) : hex('rimlight', 0.25);
    case 'hatch': {
      const above = DECK_NAMES[DECK_NAMES.indexOf(deck!) + 1];
      return above && st.open.has(above) ? hex('cyan') : hex('sodium', st.open.has(deck!) ? 1 : 0.25);
    }
    case 'hull':
      return new THREE.Color(1, 1, 1);
  }
  const opened = st.open.has(deck!);
  const decor = DECOR.has(part.room);
  if (part.kind === 'set') return opened ? hex(part.room === 'nave' ? 'sodium' : LAMP[deck!]) : hex('rimlight', 0.15);
  if (part.kind === 'bay' && decor) return opened ? hex(LAMP[deck!]) : hex('off');
  const s = roomState(part.room, deck!, st);
  const boss = BOSSES.has(part.room);
  if (part.kind === 'seal') return s === 'beaten' ? hex('gold') : null;
  if (part.kind === 'bay') return s === 'dark' ? hex('off') : s === 'locked' ? hex(LAMP[deck!], 0.05) : s === 'goal' ? hex('amber') : hex(LAMP[deck!]);
  if (boss && part.variant !== null && (part.variant === 'open') !== (s === 'beaten')) return null; // a boss door is shut, or open once beaten
  if (s === 'dark') return hex('rimlight', 0.15);
  if (s === 'locked') return hex('muted', 0.2);
  if (s === 'goal') return hex('amber');
  return part.room === 'medals' ? hex('gold') : boss ? hex('violet') : hex('cyan');
}

/** A part that moves (the marble, the lift's car): its baked geometry and where its node stood, the origin it moves from. */
export interface Mover {
  geometry: THREE.BufferGeometry;
  origin: THREE.Vector3;
}

/** The ship and its marble as one geometry: the nodes of the state baked into world space, `color` the base and `emit` the glow (the glow mask of the file times the
 * colour of the state, times GLOW). `hull` is the bounding box of the hull alone, the frame of the camera. */
export function bakeShip(root: THREE.Object3D, st: ShipState, apart = false): { geometry: THREE.BufferGeometry; hull: THREE.Box3; marble: Mover | null; car: Mover | null } | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const movers: { marble: Mover | null; car: Mover | null } = { marble: null, car: null };
  const hull = new THREE.Box3();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const part = mesh.isMesh ? partOf(mesh.name) : null;
    const tint = part && glowOf(part, st);
    if (!part || !tint) return;
    const source = mesh.geometry;
    const base = source.getAttribute('color'); // the base colour (rgb) and the glow mask (alpha)
    const n = source.getAttribute('position').count;
    const color = new Float32Array(n * 3).fill(1);
    const emit = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (part.kind === 'marble') emit.fill(MARBLE_GLOW, i * 3, i * 3 + 3);
      else if (base) {
        color.set([base.getX(i), base.getY(i), base.getZ(i)], i * 3);
        const glow = (base.itemSize === 4 ? base.getW(i) : 0) * GLOW;
        emit.set([tint.r * glow, tint.g * glow, tint.b * glow], i * 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.getAttribute('position').clone()); // a mesh is shared by the nodes that instance it: never moved in place
    geometry.setAttribute('normal', source.getAttribute('normal').clone());
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geometry.setAttribute('emit', new THREE.BufferAttribute(emit, 3));
    geometry.setIndex(source.index);
    geometry.applyMatrix4(mesh.matrixWorld);
    if (apart && (part.kind === 'marble' || part.kind === 'car')) movers[part.kind] = { geometry, origin: new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld) }; // apart: they move
    else parts.push(geometry);
    if (part.kind === 'hull') hull.expandByObject(mesh);
  });
  if (!parts.length) return null;
  return { geometry: mergeGeometries(parts, false), hull, ...movers };
}

let material: THREE.MeshStandardNodeMaterial | null = null;
/** The one material of the ship: lit vertex colour, its roughness the Blender scene's, the glow from the `emit` attribute of each vertex. */
export function shipMaterial(): THREE.MeshStandardNodeMaterial {
  if (!material) {
    material = new THREE.MeshStandardNodeMaterial({ name: 'hub_cutaway', vertexColors: true, roughness: 0.85, metalness: 0 });
    material.emissiveNode = attribute('emit', 'vec3');
  }
  return material;
}

/** The camera of the ship: straight at the cut, a little above it, drawn back so that the ship, scaled, fills `FILL` of the window. */
export const CUTAWAY_VIEW: View = { azimuth: 0, polar: 1.36, distance: 12 };
export const FILL: Record<Layout, number> = { tall: 0.9, wide: 0.85 }; // of the width on a phone, of the height in a window
/** The pixels of the window the ship leaves to what stands over it at the top and the bottom (#1691). */
export interface Inset {
  top: number;
  bottom: number;
}
export const NO_INSET: Inset = { top: 0, bottom: 0 };
/** The scale and the position that put the cut face of the hull of `box` at the middle of a `width` x `height` window seen from `CUTAWAY_VIEW`. */
export function cutawayFrame(box: THREE.Box3, layout: Layout, width: number, height: number, inset: Inset = NO_INSET): { scale: number; position: THREE.Vector3 } {
  const tanV = Math.tan((framing(width, height) * Math.PI) / 360);
  const seenH = 2 * CUTAWAY_VIEW.distance * tanV;
  const seenW = seenH * (width / height);
  const size = box.getSize(new THREE.Vector3());
  const room = Math.max(0.3, (height - inset.top - inset.bottom) / height); // the share of the height the ship may take: the plate on top and the dock below keep their own
  const scale = FILL[layout] * Math.min(seenW / size.x, (seenH * room) / size.y);
  const middle = box.getCenter(new THREE.Vector3());
  const position = new THREE.Vector3(-middle.x, -middle.y, -box.max.z).multiplyScalar(scale); // the cut, not the middle of the hull's depth, at the target of the camera
  position.y -= ((inset.top - inset.bottom) / 2) * (seenH / height); // and the middle of the room left, not of the window
  return { scale, position };
}

/** The bays of a shell as the file places them: each with the floor point the marble stands on and its box (in the file's units), the tap target. */
export interface BayBox extends Bay {
  box: THREE.Box3;
}
export function baysOf(root: THREE.Object3D): BayBox[] {
  root.updateMatrixWorld(true);
  const bays: BayBox[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const part = mesh.isMesh ? partOf(mesh.name) : null;
    if (part?.kind !== 'bay') return;
    const at = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    bays.push({ deck: part.deck!, room: part.room, x: at.x, y: at.y, box: new THREE.Box3().setFromObject(mesh) });
  });
  return bays;
}
/** The x of the lift shaft: where the car's node stands, 0 for a file with none. */
export function liftOf(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  let x = 0;
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && partOf(node.name)?.kind === 'car') x = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).x;
  });
  return x;
}
export const MARBLE_RISE = 0.22; // the marble's centre above the floor it stands on (the file: 3.0 on a floor at 2.78)

/** The ship on the terrace: one shell loaded at a time, the one of the window; its state baked into one mesh, again when the state changes. */
export class Cutaway {
  readonly group = new THREE.Group();
  private layout: Layout | null = null;
  private source: THREE.Object3D | null = null;
  private key = '';
  private mesh: THREE.Mesh | null = null;
  private hull = new THREE.Box3();
  private asked = 0;
  private marble: THREE.Mesh | null = null;
  private car: THREE.Mesh | null = null;
  private movers: { marble: Mover | null; car: Mover | null } = { marble: null, car: null };
  private at: { pos: Pos; scale: number } | null = null;
  private carY: number | null = null;
  /** The bays of the shell loaded, a new array for each shell (the marble's host tells a new ship by it); empty before the file is loaded. */
  bays: readonly BayBox[] = [];
  /** The column of the lift shaft (the x of the car's node), the file puts it in the middle of the ship. */
  lift = 0;

  constructor(
    private readonly load: (file: string) => Promise<{ scene: THREE.Object3D }>,
    private readonly loaded: () => void,
  ) {
    this.group.name = 'hub-cutaway';
    this.group.visible = false;
  }

  /** Shows the ship of the window's shell in `state`, or hides it (`on` false); true when the ship is drawn. A file that does not load leaves the ship off. */
  sync(on: boolean, width: number, height: number, state: ShipState, inset: Inset = NO_INSET): boolean {
    if (!on) return (this.group.visible = false);
    const layout = shellFor(width, height);
    if (layout !== this.layout) {
      this.drop();
      this.layout = layout;
      const asked = ++this.asked;
      this.load(cutawayFile(layout)).then(
        ({ scene }) => {
          if (asked !== this.asked) return;
          this.source = scene;
          this.bays = baysOf(scene);
          this.lift = liftOf(scene);
          this.loaded();
        },
        () => undefined,
      );
    }
    if (!this.source) return (this.group.visible = false);
    const key = JSON.stringify([this.layout, [...state.open].sort(), [...state.beaten].sort(), state.goal, state.waiting]);
    if (key !== this.key) {
      this.key = key;
      this.clear();
      const baked = bakeShip(this.source, state, true);
      if (baked) {
        this.mesh = this.add(baked.geometry, 'hub-cutaway-ship');
        this.movers = baked;
        this.marble = baked.marble && this.add(baked.marble.geometry, 'hub-cutaway-marble');
        this.car = baked.car && this.add(baked.car.geometry, 'hub-cutaway-car');
        this.hull = baked.hull;
        this.put();
      }
    }
    const frame = cutawayFrame(this.hull, layout, width, height, inset);
    this.group.scale.setScalar(frame.scale);
    this.group.position.copy(frame.position);
    return (this.group.visible = this.mesh !== null);
  }

  private add(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
    const mesh = Object.assign(new THREE.Mesh(geometry, shipMaterial()), { frustumCulled: false, name });
    this.group.add(mesh);
    return mesh;
  }

  private clear(): void {
    for (const mesh of [this.mesh, this.marble, this.car]) {
      mesh?.geometry.dispose();
      if (mesh) this.group.remove(mesh);
    }
    this.mesh = this.marble = this.car = null;
  }

  /** Puts the marble at `pos` (the floor point of a bay or of the lift, in the file's units), at `scale` 0 to 1; the lift's car goes with it while it is in the shaft. */
  place(pos: Pos, scale: number): void {
    this.at = { pos, scale };
    if (pos.x === this.lift) this.carY = pos.y;
    this.put();
  }

  private put(): void {
    const { marble, car } = this.movers;
    if (this.at && this.marble) {
      this.marble.position.set(this.at.pos.x - marble!.origin.x, this.at.pos.y + MARBLE_RISE - marble!.origin.y, 0);
      this.marble.scale.setScalar(Math.max(this.at.scale, 0.001));
    }
    if (this.car && this.carY !== null) this.car.position.set(0, this.carY - car!.origin.y, 0);
  }

  /** The boxes of the bays as the window sees them (the scene's units, the ship's scale and place applied), for the tap targets. */
  bayBoxes(): { deck: Deck; room: string; box: THREE.Box3 }[] {
    this.group.updateWorldMatrix(true, false);
    return this.bays.map(({ deck, room, box }) => ({ deck, room, box: box.clone().applyMatrix4(this.group.matrixWorld) }));
  }

  /** The shell on show, null before its file is loaded. */
  get shell(): Layout | null {
    return this.source ? this.layout : null;
  }

  private drop(): void {
    this.clear();
    this.bays = [];
    this.at = this.carY = null; // the places belong to the shell: the next one is given its own
    this.source = null;
    this.key = '';
  }
}
