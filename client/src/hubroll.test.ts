import { describe, expect, it } from 'vitest';
import { TALL_BAYS } from './test/shipbays';
import { FADE_MS, STEP_MS, TRIP_CAP_MS, along, arrow, bayAt, cellOf, floorsOf, liftUpCell, plan, posOfSpot, roomKey, route, tripMs } from './hubroll';
import { roomsOf } from './hub';
import { DECK_NAMES } from './deck';

// The roll of the marble in the Hub Cutaway (#1691): floors from the bays, routes and their steps, the time of a trip, and the map between a bay and the room of the old Hub.

const LIFT_X = 0; // the tall shell's shaft
const floors = floorsOf(TALL_BAYS, LIFT_X);
const MESS0 = { x: -2, y: 0.24 }; // World
const BRIDGE0 = { x: -2, y: 8.08 }; // Trainer
const ALL = new Set<string>(DECK_NAMES);

describe('floors', () => {
  it('are the rows of bays, low to high, each with its columns and the lift column', () => {
    expect(floors.map((f) => [f.deck, f.y])).toEqual([['mess', 0.24], ['mess', 1.4], ['cargo', 2.78], ['cargo', 3.94], ['furnace', 5.32], ['chapel', 6.7], ['bridge', 8.08]]);
    expect(floors[0]!.xs).toEqual([-2, -1, LIFT_X, 0.58, 1.58, 2.58]);
  });
});

describe('time of a trip', () => {
  it('is 160 ms a step, capped at 0.8 s: the longest trip of 11 steps takes 800 ms', () => {
    expect([STEP_MS, TRIP_CAP_MS, FADE_MS]).toEqual([160, 800, 150]);
    expect(tripMs(0)).toBe(0);
    expect(tripMs(1)).toBe(160);
    expect(tripMs(5)).toBe(800);
    expect(tripMs(11)).toBe(800);
  });
});

describe('a route', () => {
  it('along a floor counts the bays passed, and one step at least', () => {
    const r = route(floors, MESS0, { x: 2.58, y: 0.24 });
    expect(r.points).toEqual([MESS0, { x: 2.58, y: 0.24 }]);
    expect(r.steps).toBe(4); // Royale, the lift, Bot, Hotseat
    expect(route(floors, { x: 0.58, y: 0.24 }, { x: 1.58, y: 0.24 }).steps).toBe(1);
  });
  it('is no step when the marble is there already', () => {
    expect(route(floors, MESS0, MESS0)).toEqual({ points: [MESS0], steps: 0 });
  });
  it('between floors goes to the lift, rides it, and goes on: bays passed plus levels ridden', () => {
    const r = route(floors, MESS0, BRIDGE0);
    expect(r.points).toEqual([MESS0, { x: LIFT_X, y: 0.24 }, { x: LIFT_X, y: 8.08 }, BRIDGE0]);
    expect(r.steps).toBe(1 + 6 + 1); // Royale, six levels, Ranked
    expect(route(floors, { x: LIFT_X, y: 0.24 }, { x: LIFT_X, y: 1.4 })).toEqual({ points: [{ x: LIFT_X, y: 0.24 }, { x: LIFT_X, y: 1.4 }], steps: 1 }); // from the lift: no bay passed
  });
});

describe('along a route', () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
  it('is the point at that part of its length, clamped to its ends', () => {
    expect(along(points, 0)).toEqual({ x: 0, y: 0 });
    expect(along(points, 0.25)).toEqual({ x: 2, y: 0 });
    expect(along(points, 0.75)).toEqual({ x: 4, y: 2 });
    expect(along(points, 2)).toEqual({ x: 4, y: 4 });
    expect(along(points, -1)).toEqual({ x: 0, y: 0 });
  });
  it('is the one point of a route with none to roll', () => {
    expect(along([{ x: 1, y: 2 }], 0.5)).toEqual({ x: 1, y: 2 });
  });
});

describe('a tap on a bay', () => {
  it('rolls to it when its deck is open', () => {
    const p = plan(floors, ALL, { x: LIFT_X, y: 0.24 }, TALL_BAYS.find((b) => b.deck === 'cargo' && b.room === 'run')!);
    expect(p.bump).toBe(false);
    expect(p.route.points.at(-1)).toEqual({ x: 2.58, y: 2.78 });
  });
  it('rolls to the hatch of the top open deck when its deck is shut, and bumps there', () => {
    const p = plan(floors, new Set(['mess']), MESS0, TALL_BAYS.find((b) => b.deck === 'bridge' && b.room === 'pulsar')!);
    expect(p.bump).toBe(true);
    expect(p.route.points.at(-1)).toEqual({ x: LIFT_X, y: 1.4 });
  });
});

describe('an arrow key', () => {
  it('moves one column along a floor, and nowhere past its ends', () => {
    expect(arrow(floors, { x: -2, y: 0.24 }, 'ArrowRight')).toEqual({ x: -1, y: 0.24 });
    expect(arrow(floors, { x: -1, y: 0.24 }, 'ArrowRight')).toEqual({ x: LIFT_X, y: 0.24 });
    expect(arrow(floors, { x: 0.58, y: 0.24 }, 'ArrowLeft')).toEqual({ x: LIFT_X, y: 0.24 });
    expect(arrow(floors, { x: -2, y: 0.24 }, 'ArrowLeft')).toBeNull();
    expect(arrow(floors, { x: 2.58, y: 0.24 }, 'ArrowRight')).toBeNull();
  });
  it('rides the lift up and down, and only from the lift', () => {
    expect(arrow(floors, { x: LIFT_X, y: 0.24 }, 'ArrowUp')).toEqual({ x: LIFT_X, y: 1.4 });
    expect(arrow(floors, { x: LIFT_X, y: 1.4 }, 'ArrowDown')).toEqual({ x: LIFT_X, y: 0.24 });
    expect(arrow(floors, { x: LIFT_X, y: 0.24 }, 'ArrowDown')).toBeNull();
    expect(arrow(floors, { x: LIFT_X, y: 8.08 }, 'ArrowUp')).toBeNull();
    expect(arrow(floors, { x: -2, y: 0.24 }, 'ArrowUp')).toBeNull();
  });
  it('is none for another key', () => {
    expect(arrow(floors, { x: -2, y: 0.24 }, 'a')).toBeNull();
  });
});

describe('the rooms of the old Hub, by bay', () => {
  it('every bay that is not a set piece has its room on the deck of the old map', () => {
    const decor = new Set(['hold', 'crates', 'nave']);
    for (const bay of TALL_BAYS) expect(cellOf(bay.deck, bay.room) !== null, `${bay.deck} ${bay.room}`).toBe(!decor.has(bay.room));
  });
  it('maps logs to the first terminal, coop to the partner room, the others by kind or boss', () => {
    expect(cellOf('mess', 'logs')).toEqual(roomsOf('mess').find((r) => r.door.kind === 'terminal')!.cell);
    expect(roomKey({ kind: 'together' })).toBe('coop');
    expect(roomKey({ kind: 'boss', boss: 'echo' })).toBe('echo');
    expect(roomKey({ kind: 'terminal', lore: 'x' })).toBe('logs');
    expect(roomKey({ kind: 'bot' })).toBe('bot');
    expect(cellOf('furnace', 'coop')).toEqual(roomsOf('furnace').find((r) => r.door.kind === 'together')!.cell);
  });
  it('the lift up of a deck is the cell of its lift to the deck above', () => {
    expect(liftUpCell('mess')).toEqual(roomsOf('mess').find((r) => r.door.kind === 'lift')!.cell);
  });
});

describe('the marble of a saved spot', () => {
  it('stands in the bay of its room, else at the foot of the lift of its deck', () => {
    expect(posOfSpot(floors, TALL_BAYS, { deck: 'mess', cell: cellOf('mess', 'echo')! })).toEqual({ x: 0.58, y: 1.4 });
    expect(posOfSpot(floors, TALL_BAYS, { deck: 'cargo', cell: [0, 0] })).toEqual({ x: LIFT_X, y: 2.78 });
  });
  it('finds the bay under a position, if any', () => {
    expect(bayAt(TALL_BAYS, { x: 0.58, y: 1.4 })!.room).toBe('echo');
    expect(bayAt(TALL_BAYS, { x: LIFT_X, y: 1.4 })).toBeUndefined();
  });
});
