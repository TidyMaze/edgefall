// The marble of the Hub Cutaway (#1691): a tap on a bay rolls it along the floors and up or down the lift (160 ms a step, a trip capped at 0.8 s), a shut hatch
// bumps it back, a tap or a key during a roll ends it, an arrow key moves it by hand, reduced motion has no roll but a 150 ms fade. The page gives the
// host: the bays, the decks open, the clock and the frame; the marble draws through `place`, a room opens through `arrive` (hub.ts spot).
import type { Spot } from './hub';
import { FADE_MS, along, arrow, bayAt, cellOf, floorsOf, liftUpCell, plan, posOfSpot, route, tripMs, type Bay, type Floor, type Pos, type Route } from './hubroll';

export interface ShipHost {
  bays(): readonly Bay[];
  /** The column of the lift shaft in the file. */
  lift(): number;
  open(): ReadonlySet<string>;
  /** The ids of the lore logs already read: the logs bay opens the first one not in it. */
  read(): readonly string[];
  /** Draws the marble at `pos` at `scale` (1, or 0 to 1 while it fades in). */
  place(pos: Pos, scale: number): void;
  /** The roll ended on the room of this spot of the old Hub, or on a shut hatch (the lift up of the top open deck). */
  arrive(spot: Spot): void;
  reduced(): boolean;
  now(): number;
  frame(cb: () => void): number;
  unframe(id: number): void;
  /** The marble stands still: the bay under it, if any, takes the focus. */
  settle(bay: Bay | undefined): void;
}

interface Roll {
  points: Pos[];
  end: Pos;
  spot: Spot | null;
  t0: number;
  dur: number;
  fade: boolean;
  id: number;
}

export class ShipWalk {
  private seen: readonly Bay[] | null = null;
  private floors: Floor[] = [];
  private pos: Pos = { x: 0, y: 0 };
  private roll: Roll | null = null;

  constructor(private readonly host: ShipHost) {}

  /** Where the marble stands, in the units of the Blender file. */
  get at(): Pos {
    return this.pos;
  }

  /** The floors and where the marble stands, for the route and the tag of the goal; null before the ship is there and during a roll (the marble is between two floors). */
  get stage(): { floors: readonly Floor[]; at: Pos } | null {
    return this.roll || this.floors.length === 0 ? null : { floors: this.floors, at: this.pos };
  }

  /** Puts the marble on the spot saved by the Hub, when the ship is new (first draw, another shell). */
  sync(spot: Spot): void {
    const bays = this.host.bays();
    if (bays === this.seen || bays.length === 0) return; // the same ship, or none loaded yet
    this.cancel();
    this.seen = bays;
    this.floors = floorsOf(bays, this.host.lift());
    this.pos = posOfSpot(this.floors, bays, spot);
    this.host.place(this.pos, 1);
  }

  /** The Hub was entered: the marble goes back to the spot the Hub saved, at the next `sync`. */
  reset(): void {
    this.cancel();
    this.seen = null;
  }

  /** A tap on the bay `deck:room`: the marble rolls there, the room opens on arrival; a shut deck bumps at its hatch. */
  tap(key: string): void {
    const bay = this.host.bays().find((b) => `${b.deck}:${b.room}` === key);
    const cell = bay && cellOf(bay.deck, bay.room, this.host.read());
    if (!bay || !cell) return;
    this.cancel();
    const { route: path, bump } = plan(this.floors, this.host.open(), this.pos, bay);
    const top = this.floors.find((f) => f.y === path.points.at(-1)!.y)!.deck; // the deck of the end: the bay's, or the top open one
    this.run(path, bump ? { deck: top, cell: liftUpCell(top) } : { deck: bay.deck, cell });
  }

  /** An arrow key: one column along a floor, one level in the lift; nothing opens. A shut hatch bumps. */
  key(key: string): void {
    this.cancel();
    const to = arrow(this.floors, this.pos, key);
    if (to) this.go(to);
  }

  /** The lift buttons of a small phone: from wherever the marble stands, to the lift and one floor up (1) or down (-1); nothing opens, a shut hatch bumps. */
  ride(dir: 1 | -1): void {
    this.cancel();
    const at = this.floors.findIndex((f) => f.y === this.pos.y);
    const next = this.floors[at + dir];
    if (next) this.go({ x: next.lift, y: next.y });
  }

  private go(to: Pos): void {
    const deck = this.floors.find((f) => f.y === to.y)!.deck;
    if (this.host.open().has(deck)) return this.run(route(this.floors, this.pos, to), null);
    const from = this.floors.find((f) => f.y === this.pos.y)!.deck;
    this.host.arrive({ deck: from, cell: liftUpCell(from) });
  }

  /** Ends the roll in progress where it was going; no room opens. */
  cancel(): void {
    const roll = this.roll;
    if (!roll) return;
    this.host.unframe(roll.id);
    this.roll = null;
    this.pos = roll.end;
    this.host.place(roll.end, 1);
  }

  private run(path: Route, spot: Spot | null): void {
    const fade = this.host.reduced();
    const dur = path.steps === 0 ? 0 : fade ? FADE_MS : tripMs(path.steps);
    this.roll = { points: path.points, end: path.points.at(-1)!, spot, t0: this.host.now(), dur, fade, id: 0 };
    this.tick();
  }

  private readonly tick = (): void => {
    const roll = this.roll!;
    const k = roll.dur === 0 ? 1 : Math.min((this.host.now() - roll.t0) / roll.dur, 1);
    this.host.place(roll.fade ? roll.end : along(roll.points, k), roll.fade ? k : 1);
    if (k < 1) {
      roll.id = this.host.frame(this.tick);
      return;
    }
    this.roll = null;
    this.pos = roll.end;
    this.host.settle(bayAt(this.host.bays(), roll.end));
    if (roll.spot) this.host.arrive(roll.spot);
  };
}
