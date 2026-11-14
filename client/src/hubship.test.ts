import { describe, expect, it, vi } from 'vitest';
import { TALL_BAYS } from './test/shipbays';
import { ShipWalk, type ShipHost } from './hubship';
import { cellOf, liftUpCell, type Bay, type Pos } from './hubroll';
import type { Deck } from './deck';
import type { Spot } from './hub';

// The marble of the Hub Cutaway (#1691): a tap rolls it along the floors and up the lift, a locked hatch bumps it, a tap or a key ends a roll, reduced motion fades it.

const LIFT_X = 0;
function setup(open: Deck[] = ['mess', 'cargo', 'furnace', 'chapel', 'bridge'], reduced = false) {
  let t = 1000;
  let queued: (() => void) | null = null;
  let bays: readonly Bay[] = TALL_BAYS;
  const placed: [Pos, number][] = [];
  const arrived: Spot[] = [];
  const settled: (Bay | undefined)[] = [];
  const host: ShipHost = {
    bays: () => bays,
    lift: () => LIFT_X,
    open: () => new Set(open),
    place: (pos, scale) => placed.push([pos, scale]),
    arrive: (spot) => arrived.push(spot),
    reduced: () => reduced,
    now: () => t,
    frame: (cb) => ((queued = cb), 7),
    unframe: vi.fn(),
    settle: (bay) => settled.push(bay),
  };
  const walk = new ShipWalk(host);
  /** Advances the clock by `ms` and runs the frame asked for. */
  const advance = (ms: number): void => {
    t += ms;
    const cb = queued;
    queued = null;
    cb?.();
  };
  return { walk, host, placed, arrived, settled, advance, pending: () => queued !== null, swap: (next: readonly Bay[]) => (bays = next) };
}
const ECHO: Spot = { deck: 'mess', cell: cellOf('mess', 'echo')! };

describe('the marble of a saved spot', () => {
  it('is put in its bay once the ship is there, and again when the ship changes (another shell)', () => {
    const s = setup();
    s.walk.sync(ECHO);
    expect(s.walk.at).toEqual({ x: 0.58, y: 1.4 });
    expect(s.placed.at(-1)).toEqual([{ x: 0.58, y: 1.4 }, 1]);
    s.placed.length = 0;
    s.walk.sync(ECHO); // the same ship: nothing moves
    expect(s.placed).toEqual([]);
    s.swap([]); // a shell not loaded yet: nothing to place
    s.walk.sync(ECHO);
    expect(s.placed).toEqual([]);
    s.swap([...TALL_BAYS]);
    s.walk.sync({ deck: 'cargo', cell: [0, 0] });
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 2.78 });
  });
});

describe('entering the Hub again', () => {
  it('puts the marble back on the saved spot, and ends a roll on the way', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('mess:daily');
    s.walk.reset();
    s.walk.sync({ deck: 'mess', cell: cellOf('mess', 'bot')! });
    expect(s.walk.at).toEqual({ x: 0.58, y: 0.24 });
    expect(s.arrived).toEqual([]);
  });
});

describe('a tap on a bay', () => {
  it('rolls the marble there in 160 ms a step and opens the room on arrival, after focusing its bay', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('mess:daily'); // from Echo (0.58) to Daily (2.58): Dual is passed, one step
    expect(s.arrived).toEqual([]);
    s.advance(80);
    expect(s.placed.at(-1)![0].x).toBeCloseTo(1.58);
    expect(s.arrived).toEqual([]);
    s.advance(80);
    expect(s.placed.at(-1)![0]).toEqual({ x: 2.58, y: 1.4 });
    expect(s.settled.at(-1)!.room).toBe('daily');
    expect(s.arrived).toEqual([{ deck: 'mess', cell: cellOf('mess', 'daily')! }]);
  });
  it('rides the lift to another deck, the trip capped at 0.8 s', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('bridge:trainer');
    s.advance(400);
    expect(s.placed.at(-1)![0].x).toBe(LIFT_X); // halfway: in the shaft
    expect(s.arrived).toEqual([]);
    s.advance(400);
    expect(s.arrived).toEqual([{ deck: 'bridge', cell: cellOf('bridge', 'trainer')! }]);
  });
  it('opens the room at once when the marble is in the bay already', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('mess:echo');
    expect(s.arrived).toEqual([{ deck: 'mess', cell: cellOf('mess', 'echo')! }]);
    expect(s.pending()).toBe(false);
  });
  it('bumps at the hatch of the top open deck when its deck is shut: the arrival is the lift up of that deck', () => {
    const s = setup(['mess']);
    s.walk.sync(ECHO);
    s.walk.tap('cargo:run');
    s.advance(200);
    expect(s.arrived).toEqual([{ deck: 'mess', cell: liftUpCell('mess') }]);
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 1.4 });
  });
  it('does nothing for a bay that is not there, or a set piece', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('mess:nothing');
    s.walk.tap('cargo:crates');
    expect(s.pending()).toBe(false);
    expect(s.arrived).toEqual([]);
  });
  it('during a roll ends it: the marble stands where it was going, no room opens, and the new tap starts from there', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.tap('mess:daily');
    s.advance(40);
    s.walk.tap('mess:logs');
    expect(s.host.unframe).toHaveBeenCalledWith(7);
    expect(s.arrived).toEqual([]);
    s.advance(800); // from Daily (2.58) to Logs (-1): a long trip, capped at 800 ms
    expect(s.arrived).toEqual([{ deck: 'mess', cell: cellOf('mess', 'logs')! }]);
  });
});

describe('reduced motion', () => {
  it('puts the marble where it goes and fades it in over 150 ms', () => {
    const s = setup(undefined, true);
    s.walk.sync(ECHO);
    s.walk.tap('cargo:run');
    expect(s.placed.at(-1)).toEqual([{ x: 2.58, y: 2.78 }, 0]);
    s.advance(75);
    expect(s.placed.at(-1)).toEqual([{ x: 2.58, y: 2.78 }, 0.5]);
    s.advance(75);
    expect(s.arrived).toEqual([{ deck: 'cargo', cell: cellOf('cargo', 'run')! }]);
  });
});

describe('arrow keys', () => {
  it('move one column along the floor, and focus the bay the marble is in, opening nothing', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.key('ArrowRight');
    s.advance(160);
    expect(s.walk.at).toEqual({ x: 1.58, y: 1.4 });
    expect(s.settled.at(-1)!.room).toBe('dual');
    expect(s.arrived).toEqual([]);
  });
  it('ride the lift up and down from its column', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.key('ArrowLeft'); // the lift column
    s.advance(160);
    expect(s.settled.at(-1)).toBeUndefined(); // no bay there
    s.walk.key('ArrowUp');
    s.advance(160);
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 2.78 });
    s.walk.key('ArrowDown');
    s.advance(160);
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 1.4 });
  });
  it('bump a shut hatch: the lift up of the deck, Tally says her line', () => {
    const s = setup(['mess']);
    s.walk.sync({ deck: 'mess', cell: [0, 0] });
    s.walk.key('ArrowUp'); // the first floor of the Mess is under its second one: a ride
    s.advance(160);
    expect(s.arrived).toEqual([]);
    s.walk.key('ArrowUp'); // the hatch to Cargo
    expect(s.arrived).toEqual([{ deck: 'mess', cell: liftUpCell('mess') }]);
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 1.4 });
  });
  it('go nowhere past the end of a floor, and a roll in progress ends first', () => {
    const s = setup();
    s.walk.sync({ deck: 'mess', cell: cellOf('mess', 'world')! });
    s.walk.key('ArrowLeft');
    expect(s.pending()).toBe(false);
    s.walk.key('ArrowRight');
    s.walk.key('ArrowRight'); // ends the first roll where it was going, and goes on from there
    s.advance(160);
    expect(s.walk.at).toEqual({ x: LIFT_X, y: 0.24 });
  });
});

describe('leaving', () => {
  it('cancel with no roll does nothing', () => {
    const s = setup();
    s.walk.sync(ECHO);
    s.walk.cancel();
    expect(s.host.unframe).not.toHaveBeenCalled();
  });
});
