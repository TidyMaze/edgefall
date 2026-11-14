// The public Open world room (docs/specs/mcp.md section 7.2, #1365): the agent as a named hero among the players. It speaks the
// browser's wire format (client/src/worldpeers.ts: a version 2 Hello with a name, a 7 byte position, 4 a second at most, a
// keepalive every 5 s) over the browser's own PeerNet (client/src/p2p.ts), and keeps the others in the browser's own `Peers`
// table, so it refuses what a browser refuses. It holds no rule of its own: the hero moves in the server's OpenWorld.
import type { PeerNet } from '../../client/src/p2p';
import {
  cleanName,
  decode,
  encodeHello,
  hexDistance,
  Peers,
  PUBLIC_SEED,
  roomOf,
  Sender,
  SEND_MS,
} from '../../client/src/worldpeers';
import type { ErrorCode, Result } from './game';
import type { OpenWorld, WorldRules, WorldState } from './world';

/** What the room needs of the clock and the timers: the tests move them by hand. */
export interface RoomOptions {
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Runs `fn` every `ms` and returns the function that stops it. */
  every?: (fn: () => void, ms: number) => () => void;
}

export interface Joined {
  room: string;
  name: string;
  hero: string;
  /** The heroes in the room with a place when the agent joined: none, as a room is joined cold. */
  heroes: number;
}

export interface Hero {
  /** The peer id: what `world_visit` takes. */
  id: string;
  name: string;
  cell: string;
  distance: number;
}

export interface Heroes {
  you: string;
  /** The heroes with a known place, the nearest first. */
  heroes: Hero[];
  /** What is wrong with the connection, when something is: absent when all is well. */
  problem?: string;
  /** Said when the list is empty and no error is current: no hero seen yet, which says nothing about the connection. */
  note?: string;
}

export interface VisitInput {
  hero?: string;
  q?: number;
  r?: number;
}

export interface Visited {
  steps: number;
  /** Where the agent stands, `(q,r)`. */
  hero: string;
  /** The cell it walked to, or that of the hero it followed. */
  target: string;
  /** False when 40 steps were not enough: call again. */
  arrived: boolean;
}

interface Running {
  net: PeerNet;
  sender: Sender;
  peers: Peers;
  name: string;
  /** When the last join error came, in clock ms: `null` when none. */
  problemAt: number | null;
  stop: () => void;
}

type Cell = readonly [q: number, r: number];

/** The most steps of one `world_visit`, the engine's search reach. */
const MAX_STEPS = 40;
const ANONYMOUS = 'Claude';
const PROBLEM = 'a connection problem, still trying';
/** A join error counts for this long (ms), longer than the 15 s retry of the browser: PeerNet has no "joined" signal, only a peer joining clears it sooner. */
const PROBLEM_MS = 30_000;
const ALONE = 'no other hero seen yet';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });
const text = ([q, r]: Cell): string => `(${q},${r})`;
const cellOf = (hero: string): Cell => {
  const [q, r] = hero.slice(1, -1).split(',');
  return [Number(q), Number(r)];
};
const changed = (): Result<never> => fail('world_changed', 'new_world replaced the public world: call leave_world_room, then join_world_room');
/** The peer transport of a server started with none (the tests): joining is a transport error. `main.ts` passes `p2pPeers`. */
export const refusePeers = (): never => {
  throw new Error('no peer transport: the server was started without one');
};
const none = (): Result<never> => fail('no_world_room', 'not in the public world room: call join_world_room first');

export class WorldRoom {
  private running: Running | null = null;
  private readonly opts: Required<RoomOptions>;

  constructor(
    private readonly world: OpenWorld,
    private readonly rules: WorldRules,
    private readonly open: (room: string) => PeerNet,
    opts: RoomOptions = {},
  ) {
    this.opts = {
      clock: opts.clock ?? Date.now,
      sleep: opts.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
      every:
        opts.every ??
        ((fn, ms) => {
          const timer = setInterval(fn, ms);
          timer.unref(); // an idle room never keeps the server process alive
          return () => clearInterval(timer);
        }),
    };
  }

  /**
   * Enters the public world (seed 1305) with the hero on the spawn, drops the world in progress, and joins its room under
   * `name`. It acts for the user of the agent, who asked for it: docs/privacy.md, docs/specs/mcp.md section 7.2.
   */
  join({ name }: { name?: string }): Result<Joined> {
    if (this.running) return fail('already_in_world_room', 'already in the public world room: call leave_world_room first');
    let net: PeerNet;
    try {
      net = this.open(roomOf(PUBLIC_SEED));
    } catch (reason) {
      return fail('transport_failed', String(reason));
    }
    // A new world always starts: its value is the state, the hero on the spawn.
    const hero = (this.world.newWorld({ seed: PUBLIC_SEED }) as { ok: true; value: WorldState }).value.hero;
    const run: Running = { net, sender: new Sender(), peers: new Peers(), name: cleanName(name ?? '') || ANONYMOUS, problemAt: null } as Running; // `stop` is set with the timer, below
    net.onJoin((peer) => {
      run.problemAt = null;
      net.send(encodeHello(run.name), peer);
      net.send(run.sender.now()!, peer); // the place is set before any peer can join
    });
    net.onData((data, peer) => {
      const message = decode(data);
      if (message?.t === 'hello') run.peers.hello(peer, this.opts.clock(), message.name);
      else if (message?.t === 'pos') run.peers.position(peer, message, this.opts.clock()); // a break or a troop is not a place: the agent's state does not need them
    });
    net.onLeave((peer) => run.peers.leave(peer));
    net.onError(() => (run.problemAt = this.opts.clock()));
    this.running = run;
    const [q, r] = cellOf(hero);
    run.sender.set(q, r);
    this.pump(run);
    run.stop = this.opts.every(() => this.pump(run), SEND_MS);
    return ok({ room: roomOf(PUBLIC_SEED), name: run.name, hero, heroes: 0 });
  }

  /** The heroes of the room with a known place, the nearest to the agent first. */
  heroes(): Result<Heroes> {
    const run = this.running;
    if (!run) return none();
    run.peers.expire(this.opts.clock());
    const at = this.at();
    if (!at) return changed();
    const heroes = run.peers.cells(at).map(({ peer, cell, name }) => ({ id: peer, name, cell: text(cell), distance: hexDistance(at, cell) }));
    const now = this.opts.clock();
    if (run.problemAt !== null && now - run.problemAt <= PROBLEM_MS) return ok({ you: text(at), heroes, problem: PROBLEM });
    return ok({ you: text(at), heroes, ...(heroes.length === 0 && { note: ALONE }) });
  }

  /**
   * Walks to a hero, to stand next to it, or to a cell, a step at a time at the rate of a browser: one cell and one position
   * message every 250 ms, never more. A hero is followed where it goes. At most 40 steps: `arrived` is false when they were
   * not enough.
   */
  async visit({ hero, q, r }: VisitInput): Promise<Result<Visited>> {
    const run = this.running;
    if (!run) return none();
    if (hero === undefined && (q === undefined || r === undefined)) return fail('bad_target', 'give a hero id from world_heroes, or both q and r');
    let steps = 0;
    let target: Cell = [q ?? 0, r ?? 0];
    for (;;) {
      if (hero !== undefined) {
        const found = run.peers.cells().find((h) => h.peer === hero);
        if (!found) return fail('unknown_hero', `no hero ${hero} in the room: call world_heroes`);
        target = found.cell;
      }
      const at = this.at();
      if (!at) return changed();
      const done = (arrived: boolean): Result<Visited> => ok({ steps, hero: text(at), target: text(target), arrived });
      if (hero !== undefined && hexDistance(at, target) <= 1) return done(true);
      if (steps === MAX_STEPS) return done(false);
      const path = this.rules.world_path(PUBLIC_SEED, at[0], at[1], target[0], target[1], new Int32Array(), new Int32Array());
      if (path.length === 0) {
        if (steps > 0 && hexDistance(at, target) === 0) return done(true);
        return fail('no_path', `no way to ${text(target)}: it is the hero's cell, off the world, farther than 40 cells or walled in`);
      }
      await this.opts.sleep(SEND_MS);
      if (this.running !== run) return none(); // left while walking
      const step = this.world.walk({ q: path[0]!, r: path[1]! });
      if (!step.ok) return fail('blocked', `the way to ${text(target)} is blocked after ${steps} steps: ${step.error.message}`);
      steps++;
      const now = this.at()!; // where the step left the hero: the troop's push after it can move it on (world.ts)
      run.sender.set(now[0], now[1]);
      this.pump(run);
    }
  }

  /** Leaves the room: the peers drop the hero after 10 s, as when a browser closes. */
  leave(): Result<{ left: true }> {
    const run = this.running;
    if (!run) return none();
    this.running = null;
    run.stop();
    run.net.close();
    return ok({ left: true });
  }

  /** What a browser does every frame: forgets the silent peers, sends the place when it is due. */
  private pump(run: Running): void {
    const now = this.opts.clock();
    run.peers.expire(now);
    const message = run.sender.due(now);
    if (message) run.net.send(message);
  }

  /** Where the hero stands in the server's world, `null` once `new_world` replaced the public world. */
  private at(): Cell | null {
    const state = (this.world.state({ radius: 1 }) as { ok: true; value: WorldState }).value;
    return state.seed === PUBLIC_SEED ? cellOf(state.hero) : null;
  }
}
