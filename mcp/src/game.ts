// The tools of docs/specs/mcp.md sections 4 to 7: a local game against the bot or a boss (`new_game`, `get_state`,
// `legal_moves`, `play_move`, `resign`) and an online room (`create_room`, `join_room`, `wait_for_opponent_move`).
// One game at a time. The engine is the only judge: this holds no rule, it asks the engine and turns its codes into
// words. Resign is the one thing the engine does not model (rules.md OPEN-12).
import { randomUUID } from 'node:crypto';
import { SITE } from '../../client/src/daily';
import { bossSeatFromHash, creatorFromHash, fingerprint, inviteUrl, newRoomId, roomFromHash } from '../../client/src/invite';
import { generateKeys, type Keys } from '../../client/src/moverecord';
import { SIGNALING_TIMEOUT_MS } from '../../client/src/netcounters';
import type { Judge } from '../../client/src/session';
import type { Transport } from '../../client/src/transport';
import { ascii, asciiKey, boardText, marbles } from './board';
import { bossState, type BossLike, type BossState } from './boss';
import type { Outcome } from './world';
import { formatMove, fromRecord, fromRecords, parseMove, toRecord } from './notation';
import { Room, type RoomEvent } from './online';
import { explain } from './refusal';

/** What the session uses of both `Engine` and `Encounter` in edgefall-wasm. */
interface Playable {
  to_move(): number;
  legal_moves(): Int32Array;
  /** Throws the engine's reason when the move is illegal, the game is then unchanged. */
  play(mv: Int32Array): void;
  ejected(side: number): number;
  win_ejections(side: number): number;
  board(): Uint8Array;
  status(): number;
  draw_reason(): number;
  /** The side whose turn passed after the last ply, as it had no legal move: `0` none (#1301). */
  passed(): number;
  free(): void;
}

/** What the session uses of `Engine`: a game against the bot. */
export interface EngineLike extends Playable {
  best_move(nodes: number): Int32Array;
}

/** What the session uses of `Encounter`: a fight against a boss. */
export interface EncounterLike extends Playable, BossLike {
  boss_move(): Int32Array;
  /** The reply the boss announces for a move, empty when it announces nothing. */
  tell_move(mv: Int32Array): Int32Array;
  /** The bonus plies the last move added after it (The Echo), empty for the other bosses. */
  last_bonuses(): Int32Array;
  /** The free moves The Echo offers the player now (#958), empty for the other bosses. */
  free_moves(): Int32Array;
}

/** Search budget of the bot in positions per move, `BOT_NODES` of client/src/bot.ts. */
export const BOT_NODES = 20000;

const BLACK = 1;
const WHITE = 2;
const RUNNING = 0;

export type Side = 'black' | 'white';
export type Status = 'running' | 'black_won' | 'white_won' | 'draw';
export type DrawReason = null | 'repetition' | 'no_ejection_cap' | 'blocked';

const STATUSES: Status[] = ['running', 'black_won', 'white_won', 'draw'];
const DRAW_REASONS: DrawReason[] = [null, 'repetition', 'no_ejection_cap', 'blocked'];

/** Side code of edgefall-wasm: `1` Black, anything else White, as the engine reads it. */
export function sideName(code: number): Side {
  return code === BLACK ? 'black' : 'white';
}

export function statusName(code: number): Status {
  return STATUSES[code]!;
}

export function drawReasonName(code: number): DrawReason {
  return DRAW_REASONS[code] as DrawReason;
}

export type ErrorCode =
  | 'no_game'
  | 'unknown_boss'
  | 'game_over'
  | 'not_your_turn'
  | 'bad_move'
  | 'illegal_move'
  | 'no_room'
  | 'already_in_room'
  | 'room_full'
  | 'room_not_found'
  | 'transport_failed'
  | 'not_supported'
  | 'no_world'
  | 'blocked'
  | 'no_path'
  | 'bad_save'
  | 'no_world_room'
  | 'already_in_world_room'
  | 'world_changed'
  | 'unknown_hero'
  | 'bad_target'
  | 'no_run'
  | 'not_now'
  | 'bad_choice';

export interface ToolError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export interface State {
  game_id: string;
  mode: 'bot' | 'boss' | 'online';
  you: Side;
  to_move: Side;
  status: Status;
  draw_reason: DrawReason;
  /** The side whose turn passed after the last ply, as it had marbles but no legal move (#1301), else null. */
  passed: Side | null;
  resigned: boolean;
  ejected: Record<Side, number>;
  win_ejections: Record<Side, number>;
  ascii: string;
  /** How to read a cell of `ascii` as the `(q,r)` of `play_move`, and the marbles of each side in that notation. */
  ascii_key: string;
  marbles: { black: string[]; white: string[] };
  board: string;
  last_moves: string[];
  boss: BossState | null;
}

export interface LegalMoves {
  to_move: Side;
  moves: string[];
  /** The reply a boss announces per move, empty against the bot and the bosses that announce nothing. */
  announces: Record<string, string>;
  /** The free moves The Echo offers now, also in `moves`: playing one keeps the turn, any other move declines them (#958). */
  free: string[];
  count: number;
}

export interface Played {
  played: string;
  /** The bot or boss reply, `null` when the game ended on the agent's move, after a free move, and always online. */
  reply: string | null;
  /** The bonus plies The Echo played after the agent's move, in order (#859); the agent's own are offered (#958). */
  bonuses: string[];
  state: State;
}

export interface NewGameInput {
  boss?: string;
  seed?: number;
  bot_nodes?: number;
}

export interface PlayMoveInput {
  move: string;
}

export interface CreateRoomInput {
  /** A duel: this boss, whose seat (White) the joiner plays (#1316). Without it a 1v1 room. */
  boss?: string;
  seed?: number;
}

export interface RoomInfo {
  room: string;
  /** The link a human opens in the client. */
  invite: string;
  you: Side;
  /** The agent's Ed25519 public key, base64url. */
  pub: string;
}

export interface JoinRoomInput {
  /** A room code or an invite link. */
  room: string;
}

export interface WaitInput {
  timeout_s?: number;
}

export interface Waited {
  event: RoomEvent;
  /** Only for `opponent_moved`: the last move, `null` when the opponent took its seat and nobody moved yet. */
  move?: string | null;
  state: State;
}

interface Game {
  id: string;
  engine: Playable;
  /** The bot or boss move for the current position, `null` online. */
  reply: (() => Int32Array) | null;
  boss: { id: string; encounter: EncounterLike } | null;
  room: Room | null;
  resigned: boolean;
  /** Every ply in notation, oldest first, bot moves included. */
  plies: string[];
}

/** Plies shown in `last_moves`. */
const LAST_MOVES = 6;

/** The room creator holds seat 1 (Black), a joiner asks for seat 2 (White), as in the client. */
const CREATOR = 1;
const JOINER = 2;

/** Seconds `wait_for_opponent_move` waits by default. */
const WAIT_S = 30;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });

/** The one game of the server: local, or in an online room. */
export class Session {
  private game: Game | null = null;
  /** The agent's key, made once per process and kept in memory (docs/specs/mcp.md section 7). */
  private keys: Keys | null = null;

  constructor(
    private readonly newEngine: () => EngineLike,
    private readonly newEncounter: (boss: string, seed: number) => EncounterLike,
    private readonly newTransport: (room: string) => Transport,
  ) {}

  /**
   * Drops any game in progress and starts one against the bot, or against `boss` with `seed`. The agent is Black and
   * moves first. An unknown boss keeps the game in progress.
   */
  newGame({ boss, seed = 0, bot_nodes = BOT_NODES }: NewGameInput): Result<State> {
    if (boss === undefined) return ok(this.runFight(this.newEngine(), bot_nodes));
    let encounter: EncounterLike;
    try {
      encounter = this.newEncounter(boss, seed);
    } catch (reason) {
      return fail('unknown_boss', String(reason));
    }
    return ok(this.runBoss(boss, encounter));
  }

  /** Drops any game in progress and starts the fight of `engine` against the bot, which searches `nodes` positions per
   * move: a game, or the army's fight of a rogue-lite run (mcp/src/run.ts). The agent is Black. */
  runFight(engine: EngineLike, nodes: number): State {
    return this.begin({ ...this.fresh(), engine, reply: () => engine.best_move(nodes), boss: null });
  }

  /** Drops any game in progress and starts the fight of `encounter`, the boss `id`: a boss fight, or an act boss of a run. */
  runBoss(id: string, encounter: EncounterLike): State {
    return this.begin({ ...this.fresh(), engine: encounter, reply: () => encounter.boss_move(), boss: { id, encounter } });
  }

  private fresh() {
    return { id: randomUUID(), resigned: false, plies: [], room: null };
  }

  private begin(game: Game): State {
    this.replace(game);
    return state(game);
  }

  /**
   * Opens a room as Black. The game starts once a second peer has taken the other seat. With a `boss` the room is a
   * duel on that boss and seed: the other seat is the boss's, played by a mind and judged by the same encounter (#1316).
   */
  createRoom({ boss, seed = 0 }: CreateRoomInput = {}): Promise<Result<RoomInfo>> {
    return this.openRoom(newRoomId((bytes) => crypto.getRandomValues(bytes)), CREATOR, undefined, boss === undefined ? undefined : { boss, seed });
  }

  /** Joins a room made by a human or by another agent, once its creator gave the agent a seat. */
  joinRoom({ room }: JoinRoomInput): Promise<Result<RoomInfo>> {
    const hash = room.includes('#') ? room.slice(room.indexOf('#')) : '';
    const duel = bossSeatFromHash(hash); // the link names the boss whose seat the agent takes (#1316)
    const id = duel ? duel.room : hash ? roomFromHash(hash) : room;
    if (!id) return Promise.resolve(fail('room_not_found', `not a room code or an invite link: ${room}`));
    return this.openRoom(id, JOINER, creatorFromHash(hash), duel ?? undefined); // seat 1 binds only to the link's key (#1323)
  }

  /** Waits until the opponent moved, the game ended, the opponent left or a desync, or `timeout_s` passed. */
  async waitForOpponentMove({ timeout_s = WAIT_S }: WaitInput): Promise<Result<Waited>> {
    const game = this.game;
    if (!game?.room) return fail('no_room', 'not in a room: call create_room or join_room first');
    const room = game.room;
    const event = (await room.until(() => room.event(over(game)), timeout_s * 1000)) ?? 'timeout';
    const move = event === 'opponent_moved' ? { move: game.plies.at(-1) ?? null } : {};
    return ok({ event, ...move, state: state(game) });
  }

  getState(): Result<State> {
    return this.withGame((game) => ok(state(game)));
  }

  /** The game's id and, for a local boss fight the agent won, its boss: the Open world reads it for its lairs (#1292). */
  outcome(): Outcome | null {
    if (!this.game) return null;
    const { game_id, mode, status, boss } = state(this.game);
    return { game: game_id, boss: mode === 'boss' && status === 'black_won' ? boss!.id : null };
  }

  legalMoves(): Result<LegalMoves> {
    return this.withGame((game) => {
      // The engine lists no move once the game is over. A resign is not in the engine, so it is checked here.
      const legal = game.resigned ? [] : fromRecords(game.engine.legal_moves());
      const announces: Record<string, string> = {};
      if (game.boss && game.engine.to_move() === BLACK) {
        for (const move of legal) {
          const reply = game.boss.encounter.tell_move(toRecord(move));
          if (reply.length > 0) announces[formatMove(move)] = formatMove(fromRecord(reply));
        }
      }
      const moves = legal.map(formatMove);
      const free = game.boss && !game.resigned && game.engine.to_move() === BLACK ? fromRecords(game.boss.encounter.free_moves()).map(formatMove) : [];
      return ok({ to_move: sideName(game.engine.to_move()), moves, announces, free, count: moves.length });
    });
  }

  /**
   * Plays the agent's move, then the bot's or boss's reply in the same call, so the agent is to move again. Online, the
   * move is signed and sent: the reply comes through `wait_for_opponent_move`.
   */
  playMove({ move }: PlayMoveInput): Result<Played> {
    return this.withGame((game) => {
      if (over(game)) return gameOver();
      const parsed = parseMove(move);
      if (!parsed.ok) return fail('bad_move', parsed.message);
      return this.deliver(game, toRecord(parsed.move), formatMove(parsed.move));
    });
  }

  /** Plays a tactic of a rogue-lite run, `record` (client/src/roguelite.ts `tacticRecord`) named `name` in the plies: the
   * engine judges it, and the bot replies when the tactic costs the move (a Swap). */
  playTactic(record: Int32Array, name: string): Result<Played> {
    return this.withGame((game) => (over(game) ? gameOver() : this.deliver(game, record, name)));
  }

  /** Plays the record `mine`, then the bot's or boss's replies, and says what was played as `played`. */
  private deliver(game: Game, mine: Int32Array, played: string): Result<Played> {
    if (game.room && !game.room.session.canPlay()) {
      return fail('not_your_turn', 'the opponent is to move, or not seated: call wait_for_opponent_move');
    }
    const before = game.engine.board();
    const mover = game.engine.to_move() === BLACK ? 'Black' : 'White';
    try {
      game.engine.play(mine);
    } catch (reason) {
      let why = '';
      try {
        why = explain(String(reason), fromRecord(mine), before, mover);
      } catch {
        // The explanation is a courtesy: the engine's code alone is the answer.
      }
      return fail('illegal_move', why ? `${String(reason)}: ${why}` : String(reason));
    }
    game.plies.push(played);
    const echoed = game.boss ? fromRecords(game.boss.encounter.last_bonuses()).map(formatMove) : [];
    let reply: string | null = null;
    if (game.room) void game.room.session.send(Array.from(mine));
    // A free move of The Echo keeps the agent to move: no reply (#958). A bot with no move passes: no reply, and an
    // agent with no move passes too, so the bot replies again (#1301).
    else {
      while (!over(game) && game.engine.to_move() !== BLACK) {
        const record = game.reply!();
        game.engine.play(record);
        reply = formatMove(fromRecord(record));
        game.plies.push(reply);
      }
    }
    return ok({ played, reply, bonuses: echoed, state: state(game) });
  }

  /** The bot or boss wins. The engine is not asked, it has no resign. Online it waits for rules.md OPEN-12. */
  resign(): Result<State> {
    return this.withGame((game) => {
      if (game.room) return fail('not_supported', 'resign online waits for an owner decision (rules.md OPEN-12)');
      if (over(game)) return gameOver();
      game.resigned = true;
      return ok(state(game));
    });
  }

  private withGame<T>(run: (game: Game) => Result<T>): Result<T> {
    return this.game ? run(this.game) : fail('no_game', 'no game started: call new_game first');
  }

  /** Drops the game in progress, and leaves its room. */
  private replace(next: Game): void {
    this.game?.engine.free();
    this.game?.room?.close();
    this.game = next;
  }

  /** A joiner waits for the creator to seat it. Until the room is open, the game in progress stays. */
  private async openRoom(id: string, side: number, creator?: string, fight?: { boss: string; seed: number }): Promise<Result<RoomInfo>> {
    if (this.game?.room) return fail('already_in_room', 'already in a room: call new_game to leave it');
    let encounter: EncounterLike | undefined;
    if (fight) {
      try {
        encounter = this.newEncounter(fight.boss, fight.seed);
      } catch (reason) {
        return fail('unknown_boss', String(reason));
      }
    }
    this.keys ??= await generateKeys();
    let transport: Transport;
    try {
      transport = this.newTransport(id);
    } catch (reason) {
      encounter?.free();
      return fail('transport_failed', String(reason));
    }
    const engine = encounter ?? this.newEngine();
    const boss = fight && encounter ? { id: fight.boss, encounter } : null;
    const game: Game = { id, engine, reply: null, boss, room: null, resigned: false, plies: [] };
    const room = (game.room = new Room(id, side, this.keys, transport, judge(game), creator));
    if (side === JOINER) {
      const seated = () => (room.session.role === 'pending' ? undefined : room.session.role);
      const role = await room.until(seated, SIGNALING_TIMEOUT_MS);
      if (role !== 'player') {
        room.close();
        game.engine.free();
        return role
          ? fail('room_full', 'both seats of the room are taken')
          : fail('room_not_found', `no peer answered within ${SIGNALING_TIMEOUT_MS / 1000} s`);
      }
    }
    this.replace(game);
    return ok({ room: id, invite: inviteUrl(SITE, id, fight, side === CREATOR ? await fingerprint(this.keys.pub) : creator, fight !== undefined), you: sideName(room.session.side), pub: this.keys.pub });
  }
}

/** The engine as the judge of the room: a move from the opponent is played on it, or refused. */
function judge(game: Game): Judge {
  return {
    to_move: () => game.engine.to_move(),
    play: (mv) => {
      game.engine.play(mv);
      game.plies.push(formatMove(fromRecord(mv)));
    },
    status: () => game.engine.status(),
    // Rematch is not exposed (docs/specs/mcp.md section 7): the agent never asks, so a new game never starts.
    /* v8 ignore next */
    restart: () => {},
  };
}

function over(game: Game): boolean {
  return game.resigned || game.engine.status() !== RUNNING;
}

function gameOver(): Result<never> {
  return fail('game_over', 'the game has ended: call new_game to play again');
}

function state(game: Game): State {
  const { engine } = game;
  const board = engine.board();
  const boss = game.boss && bossState(game.boss.id, game.boss.encounter);
  if (boss && game.resigned) boss.result = 'lost';
  return {
    game_id: game.id,
    mode: game.room ? 'online' : boss ? 'boss' : 'bot',
    you: game.room ? sideName(game.room.session.side) : 'black',
    to_move: sideName(engine.to_move()),
    // The agent is Black against the bot or a boss (section 4.1), so a resign is a White win. No resign online.
    status: game.resigned ? 'white_won' : statusName(engine.status()),
    draw_reason: drawReasonName(engine.draw_reason()),
    passed: engine.passed() ? sideName(engine.passed()) : null,
    resigned: game.resigned,
    ejected: { black: engine.ejected(BLACK), white: engine.ejected(WHITE) },
    win_ejections: { black: engine.win_ejections(BLACK), white: engine.win_ejections(WHITE) },
    ascii: ascii(board),
    ascii_key: asciiKey(board),
    marbles: marbles(board),
    board: boardText(board),
    last_moves: game.plies.slice(-LAST_MOVES),
    boss,
  };
}
