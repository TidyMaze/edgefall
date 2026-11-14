// The roll of the marble in the Hub Cutaway (#1691): the floors of the ship from its bays, a route between two places (along a floor, up or down the lift),
// its steps and its time, the arrow keys, and the map between a bay and the room of the old Hub (hub.ts) that opens when the marble arrives. Pure: no DOM, no three.js.
import type { Axial } from './board';
import { DECK_NAMES, type Deck } from './deck';
import { roomsOf, type Door, type Spot } from './hub';

export interface Pos {
  x: number;
  y: number;
}
/** A bay of the ship: its deck, its room and where its floor is, in the units of the Blender file. */
export interface Bay extends Pos {
  deck: Deck;
  room: string;
}
/** A row of bays: its deck, the height of its floor, and its columns (the bays' and the lift's), left to right. */
export interface Floor {
  deck: Deck;
  y: number;
  xs: number[];
  lift: number; // the column of the lift shaft (the file puts it in the middle of the ship)
}
export interface Route {
  points: Pos[];
  steps: number;
}

export const STEP_MS = 160; // a step is one bay passed or one level ridden
export const TRIP_CAP_MS = 800; // the longest trip takes no more
export const FADE_MS = 150; // reduced motion: no roll, the marble fades in where it goes


export const tripMs = (steps: number): number => Math.min(steps * STEP_MS, TRIP_CAP_MS);

/** The floors of the ship, low to high. */
export function floorsOf(bays: readonly Bay[], lift: number): Floor[] {
  const rows = new Map<number, Floor>();
  for (const { deck, x, y } of bays) {
    const floor = rows.get(y) ?? { deck, y, xs: [lift], lift };
    floor.xs.push(x);
    rows.set(y, floor);
  }
  return [...rows.values()].map((f) => ({ ...f, xs: [...new Set(f.xs)].sort((a, b) => a - b) })).sort((a, b) => a.y - b.y);
}

const passed = (floor: Floor, a: number, b: number): number => floor.xs.filter((x) => x > Math.min(a, b) && x < Math.max(a, b)).length;
const here = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
const indexOf = (floors: readonly Floor[], y: number): number => floors.findIndex((f) => f.y === y);

/** The way from `from` to `to`: along the floor, or to the lift, up or down it, and along the other floor; its steps are the bays passed and the levels ridden. */
export function route(floors: readonly Floor[], from: Pos, to: Pos): Route {
  if (here(from, to)) return { points: [from], steps: 0 };
  const a = indexOf(floors, from.y);
  const b = indexOf(floors, to.y);
  if (a === b) return { points: [from, to], steps: Math.max(1, passed(floors[a]!, from.x, to.x)) };
  const { lift } = floors[a]!;
  const points = [from, { x: lift, y: from.y }, { x: lift, y: to.y }, to].filter((p, i, all) => i === 0 || !here(p, all[i - 1]!));
  return { points, steps: passed(floors[a]!, from.x, lift) + Math.abs(a - b) + passed(floors[b]!, lift, to.x) };
}

/** The point at `p` (0 to 1) of the length of a route. */
export function along(points: readonly Pos[], p: number): Pos {
  const lens = points.slice(1).map((q, i) => Math.hypot(q.x - points[i]!.x, q.y - points[i]!.y));
  let left = Math.min(Math.max(p, 0), 1) * lens.reduce((sum, n) => sum + n, 0);
  let i = 0;
  while (i < lens.length - 1 && left > lens[i]!) left -= lens[i++]!;
  const a = points[i]!;
  const b = points[i + 1] ?? a;
  const t = lens[i] ? Math.min(left / lens[i]!, 1) : 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A tap on `bay` from `from`: the route to the bay when its deck is open, else to the hatch of the top open deck, where the marble bumps. */
export function plan(floors: readonly Floor[], open: ReadonlySet<string>, from: Pos, bay: Bay): { route: Route; bump: boolean } {
  if (open.has(bay.deck)) return { route: route(floors, from, { x: bay.x, y: bay.y }), bump: false };
  const top = floors.filter((f) => open.has(f.deck)).at(-1)!;
  return { route: route(floors, from, { x: top.lift, y: top.y }), bump: true };
}

/** Where an arrow key takes the marble: one column along a floor, one level in the lift (from the lift only); null where it cannot go or for another key. */
export function arrow(floors: readonly Floor[], at: Pos, key: string): Pos | null {
  const floor = floors[indexOf(floors, at.y)]!;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const sign = key === 'ArrowLeft' ? -1 : 1;
    const x = (sign < 0 ? [...floor.xs].reverse() : floor.xs).find((c) => (c - at.x) * sign > 0);
    return x === undefined ? null : { x, y: at.y };
  }
  if ((key !== 'ArrowUp' && key !== 'ArrowDown') || at.x !== floor.lift) return null;
  const next = floors[indexOf(floors, at.y) + (key === 'ArrowUp' ? 1 : -1)];
  return next ? { x: floor.lift, y: next.y } : null;
}

/** The bay a room of the old Hub is: a boss by its id, a terminal as the logs, the partner room as coop, any other room by its kind. */
export const roomKey = (door: Door): string => (door.kind === 'boss' ? door.boss : door.kind === 'terminal' ? 'logs' : door.kind === 'together' ? 'coop' : door.kind);

/** The cell of the old Hub's room that a bay opens (the first terminal for the logs), null for a set piece with no room (hold, crates, nave). */
export const cellOf = (deck: Deck, room: string): Axial | null => roomsOf(deck).find((r) => roomKey(r.door) === room)?.cell ?? null;

/** The cell of the lift that goes up from `deck`, the hatch a locked deck bumps at. */
export const liftUpCell = (deck: Deck): Axial =>
  roomsOf(deck).find((r) => r.door.kind === 'lift' && DECK_NAMES.indexOf(r.door.to) > DECK_NAMES.indexOf(deck))!.cell;

export const bayAt = (bays: readonly Bay[], at: Pos): Bay | undefined => bays.find((b) => here(b, at));

const foot = (floors: readonly Floor[], deck: Deck): Pos => {
  const { lift, y } = floors.find((f) => f.deck === deck)!;
  return { x: lift, y };
};

/** Where the marble of a saved spot stands: in the bay of its room, else at the foot of the lift of its deck. */
export function posOfSpot(floors: readonly Floor[], bays: readonly Bay[], { deck, cell }: Spot): Pos {
  const room = roomsOf(deck).find((r) => r.cell[0] === cell[0] && r.cell[1] === cell[1]);
  const bay = room && bays.find((b) => b.deck === deck && b.room === roomKey(room.door));
  return bay ? { x: bay.x, y: bay.y } : foot(floors, deck);
}
