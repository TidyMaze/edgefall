// The public Open world room of the MCP server (docs/specs/mcp.md section 7.2): the agent as a named hero, over a fake PeerNet
// that records what the room would see. The wire format is the client's own (client/src/worldpeers.ts), read back here with it.
import { describe, expect, test } from 'vitest';
import type { PeerNet } from '../../client/src/p2p';
import { decode, encodeBreak, encodeHello, encodePos, encodeTroop, KEEPALIVE_MS, MAX_NAME, SEND_MS } from '../../client/src/worldpeers';
import { bossIds, worldRules } from './engine';
import type { Result, ToolError } from './game';
import { OpenWorld } from './world';
import { WorldRoom } from './worldroom';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function failure(result: Result<unknown>): ToolError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** A room as the browsers see it: what the agent sent (to whom), and the hooks to make peers come, talk and leave. */
function fakeNet() {
  const sent: { data: Uint8Array; to?: string }[] = [];
  let join: (peer: string) => void = () => {};
  let leave: (peer: string) => void = () => {};
  let data: (bytes: Uint8Array, peer: string) => void = () => {};
  let error: (message: string) => void = () => {};
  const net: PeerNet = {
    send: (bytes, to) => void sent.push({ data: bytes, to }),
    onData: (cb) => (data = cb),
    onJoin: (cb) => (join = cb),
    onLeave: (cb) => (leave = cb),
    onError: (cb) => (error = cb),
    close: () => void (closed = true),
  };
  let closed = false;
  return {
    net,
    sent,
    isClosed: () => closed,
    join: (peer: string) => join(peer),
    leave: (peer: string) => leave(peer),
    say: (peer: string, bytes: Uint8Array) => data(bytes, peer),
    error: (message: string) => error(message),
  };
}

/** A clock the test moves: `sleep` advances it, `every` registers a tick the test runs by hand with `tick`. */
function fakeTime() {
  const time = { now: 1000, ticks: [] as (() => void)[], stopped: 0 };
  return {
    time,
    clock: () => time.now,
    sleep: async (ms: number) => void (time.now += ms),
    every: (fn: () => void) => {
      time.ticks.push(fn);
      return () => void time.stopped++;
    },
    tick: (ms: number) => {
      time.now += ms;
      for (const fn of time.ticks) fn();
    },
  };
}

const SEED = 1305;
const rules = worldRules();

/** A cell the hero can walk to from the spawn, `n` steps away, or the nearest farther one. */
function reachable(n: number): [number, number] {
  let best: { cell: [number, number]; length: number } | null = null;
  for (let q = -12; q <= 12; q++) {
    for (let r = -12; r <= 12; r++) {
      const length = rules.world_path(SEED, 0, 0, q, r, new Int32Array(), new Int32Array()).length / 2;
      if (length >= n && (!best || length < best.length)) best = { cell: [q, r], length };
    }
  }
  return best!.cell;
}

function setup(during?: (ms: number, count: number) => void) {
  const room = fakeNet();
  const t = fakeTime();
  let slept = 0;
  const sleep = async (ms: number) => {
    during?.(ms, ++slept);
    await t.sleep(ms);
  };
  const opened: string[] = [];
  const world = new OpenWorld(rules, bossIds);
  const worldRoom = new WorldRoom(world, rules, (id) => (opened.push(id), room.net), { clock: t.clock, sleep, every: t.every });
  return { room, t, opened, world, worldRoom };
}

const posOf = (bytes: Uint8Array) => {
  const m = decode(bytes);
  return m?.t === 'pos' ? [m.q, m.r] : null;
};

describe('join_world_room', () => {
  test('joins the public room ow:1305:0 as Claude, the hero on the spawn of the public world', () => {
    const { worldRoom, opened, world } = setup();
    expect(value(worldRoom.join({}))).toEqual({ room: 'ow:1305:0', name: 'Claude', hero: '(0,0)', heroes: 0 });
    expect(opened).toEqual(['ow:1305:0']);
    expect(value(world.state({})).seed).toBe(SEED);
  });

  test('takes a public name, cleaned and cut as the browser does, and Claude when it is empty', () => {
    expect(value(setup().worldRoom.join({ name: '  Ada‮  ' })).name).toBe('Ada');
    expect(value(setup().worldRoom.join({ name: '' })).name).toBe('Claude');
    expect(value(setup().worldRoom.join({ name: 'x'.repeat(40) })).name).toBe('x'.repeat(MAX_NAME));
  });

  test('a second join while in the room is already_in_world_room, and nothing else is opened', () => {
    const { worldRoom, opened } = setup();
    value(worldRoom.join({}));
    expect(failure(worldRoom.join({})).code).toBe('already_in_world_room');
    expect(opened).toHaveLength(1);
  });

  test('a transport that cannot start is transport_failed and the agent is not in the room', () => {
    const t = fakeTime();
    const worldRoom = new WorldRoom(new OpenWorld(rules, bossIds), rules, () => {
      throw new Error('no WebRTC here');
    }, { clock: t.clock, sleep: t.sleep, every: t.every });
    expect(failure(worldRoom.join({}))).toEqual({ code: 'transport_failed', message: 'Error: no WebRTC here' });
    expect(failure(worldRoom.heroes()).code).toBe('no_world_room');
  });

  test('greets each peer that joins with its Hello (version 2, the name) and its place, as a browser does', () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({ name: 'Claude' }));
    room.join('peer-a');
    expect(room.sent).toHaveLength(3); // the first place, to everyone, then the greeting
    expect(room.sent[1]).toEqual({ data: encodeHello('Claude'), to: 'peer-a' });
    expect(posOf(room.sent[2]!.data)).toEqual([0, 0]);
    expect(room.sent[2]!.to).toBe('peer-a');
  });

  test('the place goes out at once, then only a keepalive every 5 s while the agent stands still', () => {
    const { worldRoom, room, t } = setup();
    value(worldRoom.join({}));
    expect(room.sent.map((s) => posOf(s.data))).toEqual([[0, 0]]); // first position, to everyone
    expect(room.sent[0]!.to).toBeUndefined();
    t.tick(SEND_MS);
    t.tick(SEND_MS);
    expect(room.sent).toHaveLength(1);
    t.tick(KEEPALIVE_MS);
    expect(room.sent).toHaveLength(2);
    expect(posOf(room.sent[1]!.data)).toEqual([0, 0]);
  });
});

describe('world_heroes', () => {
  test('without a room is no_world_room', () => {
    expect(failure(setup().worldRoom.heroes()).code).toBe('no_world_room');
  });

  test('lists the heroes that said Hello and gave a place, nearest first, with their name and distance', () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    expect(value(worldRoom.heroes())).toEqual({ you: '(0,0)', heroes: [], note: 'no other hero seen yet' });
    room.say('far', encodeHello('Far'));
    room.say('near', encodeHello('Near'));
    room.say('silent', encodeHello('Silent')); // no place yet: not listed
    room.say('far', encodePos(8, -3, 1));
    room.say('near', encodePos(2, 1, 1));
    expect(value(worldRoom.heroes())).toEqual({
      you: '(0,0)',
      heroes: [
        { id: 'near', name: 'Near', cell: '(2,1)', distance: 3 },
        { id: 'far', name: 'Far', cell: '(8,-3)', distance: 8 },
      ],
    });
  });

  test('refuses what a browser refuses: a message of another version, a position without a Hello', () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    room.say('ghost', encodePos(1, 1, 1)); // no Hello first
    room.say('old', Uint8Array.of(1, 2, 0, 0, 0, 0, 0));
    expect(value(worldRoom.heroes()).heroes).toEqual([]);
  });

  test('a boulder break or a troop from a browser is not a position: the hero keeps its last cell', () => {
    const { worldRoom, room, t } = setup();
    value(worldRoom.join({}));
    room.say('a', encodeHello('A'));
    room.say('a', encodePos(2, 1, 1));
    t.tick(1000); // past the gap a browser keeps between two messages
    room.say('a', encodeBreak({ kind: 'break', seed: SEED, q: 3, r: 3, pub: 'A'.repeat(43), sig: 'A'.repeat(86) }));
    t.tick(1000);
    room.say('a', encodeTroop([[1, 0]]));
    expect(value(worldRoom.heroes()).heroes).toEqual([{ id: 'a', name: 'A', cell: '(2,1)', distance: 3 }]);
  });

  test('a hero that left, or stayed silent for 10 s, is no longer listed', () => {
    const { worldRoom, room, t } = setup();
    value(worldRoom.join({}));
    room.say('a', encodeHello('A'));
    room.say('a', encodePos(1, 0, 1));
    room.say('b', encodeHello('B'));
    room.say('b', encodePos(2, 0, 1));
    room.leave('a');
    expect(value(worldRoom.heroes()).heroes.map((h) => h.id)).toEqual(['b']);
    t.tick(10_001);
    expect(value(worldRoom.heroes()).heroes).toEqual([]);
  });

  test('a join error of the connection is told in the list, so the agent can say it', () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    expect(value(worldRoom.heroes()).problem).toBeUndefined();
    room.error('ICE failed');
    expect(value(worldRoom.heroes()).problem).toBe('a connection problem, still trying');
    room.join('peer'); // a peer connected after all
    expect(value(worldRoom.heroes()).problem).toBeUndefined();
  });

  test('a join error is current for 30 s, longer than the retry; an error every 20 s never flickers to the note (#1677)', () => {
    const { worldRoom, room, t } = setup();
    value(worldRoom.join({}));
    room.error('ICE failed');
    for (let i = 0; i < 3; i++) {
      t.tick(20_000);
      expect(value(worldRoom.heroes()).problem).toBe('a connection problem, still trying');
      expect(value(worldRoom.heroes()).note).toBeUndefined();
      room.error('ICE failed');
    }
    t.tick(30_001); // no new error
    const after = value(worldRoom.heroes());
    expect(after.problem).toBeUndefined();
    expect(after.note).toBe('no other hero seen yet');
    room.error('again');
    expect(value(worldRoom.heroes()).problem).toBe('a connection problem, still trying');
  });
});

describe('world_visit', () => {
  test('without a room is no_world_room', async () => {
    expect(failure(await setup().worldRoom.visit({ q: 1, r: 0 })).code).toBe('no_world_room');
  });

  test('needs a hero or a cell, and knows its heroes', async () => {
    const { worldRoom } = setup();
    value(worldRoom.join({}));
    expect(failure(await worldRoom.visit({})).code).toBe('bad_target');
    expect(failure(await worldRoom.visit({ q: 1 })).code).toBe('bad_target');
    expect(failure(await worldRoom.visit({ hero: 'nobody' })).code).toBe('unknown_hero');
  });

  test('walks a cell at a time, sending each place no faster than 4 a second, and ends on the cell', async () => {
    const { worldRoom, room, t, world } = setup();
    value(worldRoom.join({}));
    const [q, r] = reachable(3);
    const walked = value(await worldRoom.visit({ q, r }));
    expect(walked.hero).toBe(`(${q},${r})`);
    expect(walked.steps).toBeGreaterThanOrEqual(3);
    expect(walked.arrived).toBe(true);
    const places = room.sent.filter((s) => !s.to).map((s) => posOf(s.data));
    expect(places).toHaveLength(walked.steps + 1); // the spawn, then one per step
    expect(places.at(-1)).toEqual([q, r]);
    expect(places.map((p) => p![0]).length).toBe(places.length);
    expect(value(world.state({})).hero).toBe(`(${q},${r})`);
    // 4 Hz at most: the clock moved by SEND_MS per step.
    expect(t.time.now - 1000).toBe(walked.steps * SEND_MS);
  });

  test('a push of the troop that moves the hero sends the cell the hero is on after it, as a browser does', async () => {
    // A fight whose first push moves the hero one cell east of the cell it stepped to.
    let pushed: number[] = [];
    class Pushing extends rules.WorldFight {
      override troop_push(_seed: number, troop: Int32Array) {
        if (pushed.length > 0) return undefined;
        pushed = [troop[0]! + 1, troop[1]!];
        return { troop: Int32Array.from([...pushed, ...troop.slice(2)]), ejected: new Int32Array(), dir: Int32Array.of(1, 0) } as never;
      }
    }
    const room = fakeNet();
    const t = fakeTime();
    const pushing = { ...rules, WorldFight: Pushing };
    const worldRoom = new WorldRoom(new OpenWorld(pushing, bossIds), pushing, () => room.net, { clock: t.clock, sleep: t.sleep, every: t.every });
    value(worldRoom.join({}));
    value(await worldRoom.visit({ q: 1, r: 0 }));
    const places = room.sent.filter((s) => !s.to).map((s) => posOf(s.data));
    expect(places[1]).toEqual(pushed);
  });

  test('walks to a hero by its id and stops next to it, following it when it moves', async () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    const [q, r] = reachable(4);
    room.say('p', encodeHello('Player'));
    room.say('p', encodePos(q, r, 1));
    const walked = value(await worldRoom.visit({ hero: 'p' }));
    expect(walked.arrived).toBe(true);
    const here = JSON.parse(walked.hero.replace(/\((-?\d+),(-?\d+)\)/, '[$1,$2]')) as [number, number];
    const gap = Math.max(Math.abs(here[0] - q), Math.abs(here[1] - r), Math.abs(here[0] + here[1] - q - r));
    expect(gap).toBe(1);
    expect(walked.target).toBe(`(${q},${r})`);
  });

  test('a hero that is already next to the agent is arrived with no step', async () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    room.say('p', encodeHello('P'));
    room.say('p', encodePos(1, 0, 1));
    expect(value(await worldRoom.visit({ hero: 'p' }))).toMatchObject({ steps: 0, arrived: true, hero: '(0,0)' });
  });

  test('a cell the hero is on, or no way to a cell, is no_path', async () => {
    const { worldRoom } = setup();
    value(worldRoom.join({}));
    expect(failure(await worldRoom.visit({ q: 0, r: 0 })).code).toBe('no_path');
    expect(failure(await worldRoom.visit({ q: 30000, r: 30000 })).code).toBe('no_path');
  });

  test('stops after 40 steps and says it has not arrived, so the agent calls again', async () => {
    const { worldRoom, world } = setup();
    value(worldRoom.join({}));
    const [q, r] = reachable(4);
    world.walk = () => ({ ok: true, value: { steps: 1, pushes: [], state: {} as never } }); // a hero that never gets there
    expect(value(await worldRoom.visit({ q, r }))).toMatchObject({ steps: 40, arrived: false, hero: '(0,0)' });
  });

  test('a path cut by the world while walking is blocked, nothing sent beyond the place reached', async () => {
    const { worldRoom, world } = setup();
    value(worldRoom.join({}));
    const [q, r] = reachable(4);
    const original = world.walk.bind(world);
    let calls = 0;
    world.walk = (input) => (++calls === 2 ? { ok: false, error: { code: 'no_path', message: 'an enemy' } } : original(input));
    const result = await worldRoom.visit({ q, r });
    expect(failure(result).code).toBe('blocked');
  });

  test('a hero that leaves while the agent walks to it ends the walk with unknown_hero', async () => {
    let leave = () => {};
    const { worldRoom, room } = setup((_ms, count) => count === 2 && leave());
    leave = () => room.leave('p');
    value(worldRoom.join({}));
    const [q, r] = reachable(5);
    room.say('p', encodeHello('P'));
    room.say('p', encodePos(q, r, 1));
    expect(failure(await worldRoom.visit({ hero: 'p' })).code).toBe('unknown_hero');
  });

  test('a hero at a cell with no way there is no_path', async () => {
    const { worldRoom, room } = setup();
    value(worldRoom.join({}));
    room.say('p', encodeHello('P'));
    room.say('p', encodePos(30000, 30000, 1));
    expect(failure(await worldRoom.visit({ hero: 'p' })).code).toBe('no_path');
  });

  test('leaving while walking ends the walk: the agent is no longer in the room', async () => {
    let leave = () => {};
    const { worldRoom } = setup((_ms, count) => count === 1 && leave());
    leave = () => void worldRoom.leave();
    value(worldRoom.join({}));
    const [q, r] = reachable(3);
    expect(failure(await worldRoom.visit({ q, r })).code).toBe('no_world_room');
  });

  test('new_world replacing the public world is world_changed for the list and the walk', async () => {
    const { worldRoom, world } = setup();
    value(worldRoom.join({}));
    world.newWorld({ seed: 5 });
    expect(failure(worldRoom.heroes()).code).toBe('world_changed');
    expect(failure(await worldRoom.visit({ q: 1, r: 0 })).code).toBe('world_changed');
  });
});

describe('leave_world_room', () => {
  test('without a room is no_world_room', () => {
    expect(failure(setup().worldRoom.leave()).code).toBe('no_world_room');
  });

  test('closes the room, stops the keepalive, and the agent can join again', () => {
    const { worldRoom, room, t } = setup();
    value(worldRoom.join({}));
    expect(value(worldRoom.leave())).toEqual({ left: true });
    expect(room.isClosed()).toBe(true);
    expect(t.time.stopped).toBe(1);
    expect(failure(worldRoom.heroes()).code).toBe('no_world_room');
    expect(value(worldRoom.join({})).room).toBe('ow:1305:0');
  });
});

describe('the default timers', () => {
  test('without options the clock is Date.now, the sleep a timer and the tick an interval that does not keep the process alive', async () => {
    const room = fakeNet();
    const worldRoom = new WorldRoom(new OpenWorld(rules, bossIds), rules, () => room.net);
    value(worldRoom.join({}));
    const [q, r] = reachable(1);
    const started = Date.now();
    value(await worldRoom.visit({ q, r }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(SEND_MS - 20);
    value(worldRoom.leave());
  });
});
