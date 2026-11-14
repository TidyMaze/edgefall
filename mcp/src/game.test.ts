import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { WALLED_IN } from '../../client/src/test/blockedline';
import { bossIds, newEncounter, newEngine, runRules } from './engine';
import { BOT_NODES, drawReasonName, Session, sideName, statusName, type EncounterLike, type EngineLike, type Result, type State, type ToolError } from './game';
import { formatMove, fromRecord, fromRecords, parseMove, toRecord } from './notation';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function failure(result: Result<unknown>): ToolError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

function record(move: string): Int32Array {
  const parsed = parseMove(move);
  if (!parsed.ok) throw new Error(parsed.message);
  return toRecord(parsed.move);
}

/** A local game never opens a transport: online play is online.test.ts. */
function noNetwork(): never {
  throw new Error('no network in a local game');
}

/** Search budget of the bot in these tests when no reply is scripted, small so the suite stays fast. */
const CHEAP = 30;

/**
 * Real engines whose bot replies come from `replies` while it lasts, then from a cheap real search. Records the node
 * budget the session asks for and how many engines were freed.
 */
function engines(replies: string[] = [], make: () => EngineLike = newEngine) {
  const spy = { nodes: [] as number[], freed: 0 };
  const factory = (): EngineLike => {
    const engine = make();
    return new Proxy(engine, {
      get(target, key) {
        if (key === 'best_move') {
          return (nodes: number) => {
            spy.nodes.push(nodes);
            const next = replies.shift();
            return next === undefined ? target.best_move(CHEAP) : record(next);
          };
        }
        if (key === 'free') {
          return () => {
            spy.freed += 1;
            target.free();
          };
        }
        const member = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
  };
  return { factory, spy };
}

function session(replies: string[] = []): Session {
  return new Session(engines(replies).factory, newEncounter, noNetwork);
}

/** Plays the agent moves one by one and returns the last answer. */
function playAll(game: Session, moves: string[]) {
  let last;
  for (const move of moves) last = value(game.playMove({ move }));
  return last!;
}

const START_ASCII = [
  '  1 2 3 4 5 6 7 8 9',
  'a         W W W W W',
  'b       W W W W W W',
  'c     . . W W W . .',
  'd   . . . . . . . .',
  'e . . . . . . . . .',
  'f . . . . . . . .',
  'g . . B B B . .',
  'h B B B B B B',
  'i B B B B B',
].join('\n');
const START_BOARD = `${'W'.repeat(11)}..WWW..${'.'.repeat(25)}..BBB..${'B'.repeat(11)}`;

// A threefold repetition: Black and White each move one marble out and back (crates/edgefall-cli tests). The start
// position comes back for the third time on the bot's fourth move.
const AGENT_LOOP = ['(1,3)>NE', '(2,2)>SW', '(1,3)>NE', '(2,2)>SW'];
const BOT_LOOP = ['(2,-2)>SE', '(2,-1)>NW', '(2,-2)>SE', '(2,-1)>NW'];

describe('codes of edgefall-wasm, as words (docs/specs/mcp.md section 3.3)', () => {
  test('sides', () => {
    expect(sideName(1)).toBe('black');
    expect(sideName(2)).toBe('white');
  });

  test('status', () => {
    expect([0, 1, 2, 3].map(statusName)).toEqual(['running', 'black_won', 'white_won', 'draw']);
  });

  test('draw reason', () => {
    expect([0, 1, 2, 3].map(drawReasonName)).toEqual([null, 'repetition', 'no_ejection_cap', 'blocked']);
  });
});

describe('new_game', () => {
  test('starts a game against the bot: the agent is Black and moves first', () => {
    const state = value(session().newGame({}));
    expect(state).toEqual({
      game_id: expect.any(String),
      mode: 'bot',
      you: 'black',
      to_move: 'black',
      status: 'running',
      draw_reason: null,
      passed: null,
      resigned: false,
      ejected: { black: 0, white: 0 },
      win_ejections: { black: 6, white: 6 },
      ascii: START_ASCII,
      ascii_key: expect.stringContaining('q = its column header - 5'),
      marbles: { black: expect.any(Array), white: expect.any(Array) },
      board: START_BOARD,
      last_moves: [],
      boss: null,
    });
    expect(state.game_id).not.toBe('');
  });

  test('drops the game in progress: a new id, a fresh board, the old engine freed', () => {
    const { factory, spy } = engines();
    const game = new Session(factory, newEncounter, noNetwork);
    const first = value(game.newGame({ bot_nodes: CHEAP }));
    value(game.playMove({ move: '(1,3)>NE' }));
    const second = value(game.newGame({}));
    expect(second.game_id).not.toBe(first.game_id);
    expect(second.last_moves).toEqual([]);
    expect(second.board).toBe(START_BOARD);
    expect(spy.freed).toBe(1);
  });

  test('the bot searches 20000 positions per move by default (BOT_NODES of the client)', () => {
    const { factory, spy } = engines();
    const game = new Session(factory, newEncounter, noNetwork);
    value(game.newGame({}));
    value(game.playMove({ move: '(1,3)>NE' }));
    expect(BOT_NODES).toBe(20000);
    expect(spy.nodes).toEqual([20000]);
  });

  test('bot_nodes sets the bot search budget', () => {
    const { factory, spy } = engines();
    const game = new Session(factory, newEncounter, noNetwork);
    value(game.newGame({ bot_nodes: 7 }));
    value(game.playMove({ move: '(1,3)>NE' }));
    expect(spy.nodes).toEqual([7]);
  });
});

describe('get_state', () => {
  test('no_game before new_game', () => {
    expect(failure(session().getState())).toEqual({ code: 'no_game', message: expect.stringContaining('new_game') });
  });

  test('is the state new_game returned, then follows the moves', () => {
    const game = session(['(2,-2)>SE']);
    const started = value(game.newGame({}));
    expect(value(game.getState())).toEqual(started);
    const { state } = value(game.playMove({ move: '(1,3)>NE' }));
    expect(value(game.getState())).toEqual(state);
    expect(state.to_move).toBe('black');
    expect(state.last_moves).toEqual(['(1,3)>NE', '(2,-2)>SE']);
    expect(state.ascii.split('\n').slice(3, 9)).toEqual([
      'c     . . W W . . .',
      'd   . . . . . W . .',
      'e . . . . . . . . .',
      'f . . . . . . . .',
      'g . . B B B . B',
      'h B B B B B .',
    ]);
  });
});

describe('legal_moves', () => {
  test('no_game before new_game', () => {
    expect(failure(session().legalMoves()).code).toBe('no_game');
  });

  test('the engine list for Black at the start, in notation', () => {
    const game = session();
    value(game.newGame({}));
    const legal = value(game.legalMoves());
    expect(legal.to_move).toBe('black');
    expect(legal.announces).toEqual({});
    expect(legal.count).toBe(newEngine().legal_moves().length / 8);
    expect(legal.moves).toHaveLength(legal.count);
    expect(legal.moves).toContain('(1,3)>NE');
    expect(legal.moves.some((move) => /^(\(-?\d,-?\d\)){3}>/.test(move))).toBe(true);
    expect(new Set(legal.moves).size).toBe(legal.count);
  });

  test('every listed move is accepted by play_move', () => {
    const { moves } = value((() => {
      const game = session();
      value(game.newGame({}));
      return game.legalMoves();
    })());
    for (const move of moves) {
      const game = session(['(2,-2)>SE']);
      value(game.newGame({}));
      expect(value(game.playMove({ move })).played).toBe(move);
    }
  });
});

describe('play_move', () => {
  test('no_game before new_game', () => {
    expect(failure(session().playMove({ move: '(1,3)>NE' })).code).toBe('no_game');
  });

  test('plays the agent move, then the bot reply from the engine search', () => {
    const game = session();
    value(game.newGame({ bot_nodes: CHEAP }));
    const answer = value(game.playMove({ move: '(1,3)>NE' }));
    expect(answer.played).toBe('(1,3)>NE');
    expect(answer.reply).toEqual(expect.any(String));
    expect(parseMove(answer.reply!).ok).toBe(true);
    expect(answer.state.to_move).toBe('black');
    expect(answer.state.last_moves).toEqual(['(1,3)>NE', answer.reply]);
  });

  test('played is the move as the engine took it, in canonical notation', () => {
    const game = session(['(2,-2)>SE']);
    value(game.newGame({}));
    expect(value(game.playMove({ move: ' (+1,03)>NE\n' })).played).toBe('(1,3)>NE');
  });

  test('bad_move carries the ParseError text of edgefall-cli, the state is unchanged', () => {
    const game = session();
    const before = value(game.newGame({}));
    const cases: [string, string][] = [
      ['', 'empty input'],
      ['(1,3)NE', "missing '>' before the direction"],
      ['>NE', "no cell before '>'"],
      ['(1;3)>NE', 'cell must look like (q,r), for example (0,0)'],
      ['(1,3)>ne', 'direction must be E, W, NE, SW, NW or SE'],
    ];
    for (const [move, message] of cases) {
      expect(failure(game.playMove({ move }))).toEqual({ code: 'bad_move', message });
    }
    expect(value(game.getState())).toEqual(before);
  });

  test('illegal_move carries the engine reason, the state is unchanged', () => {
    const game = session();
    const before = value(game.newGame({}));
    expect(failure(game.playMove({ move: '(0,0)>E' }))).toEqual({
      code: 'illegal_move',
      message: 'Move(NotOwnMarble): you play Black: (0,0) is empty',
    });
    expect(failure(game.playMove({ move: '(0,-4)>SE' }))).toEqual({
      code: 'illegal_move',
      message: 'Move(NotOwnMarble): you play Black: (0,-4) is a White marble',
    });
    const start = value(game.getState()).marbles;
    expect(start.black).toHaveLength(14);
    expect(start.black).toContain('(0,4)');
    expect(start.white).toContain('(0,-4)');
    expect(failure(game.playMove({ move: '(0,4)(0,3)(0,2)(0,1)>NW' }))).toEqual({
      code: 'illegal_move',
      message: 'marble count must be 1 to 3',
    });
    expect(failure(game.playMove({ move: '(9,9)>E' })).code).toBe('illegal_move');
    expect(value(game.getState())).toEqual(before);
  });

  test('last_moves keeps the last 6 plies, oldest first, bot moves included', () => {
    const game = session([...BOT_LOOP]);
    value(game.newGame({}));
    const { state } = playAll(game, AGENT_LOOP.slice(0, 3));
    expect(state.last_moves).toEqual(['(1,3)>NE', '(2,-2)>SE', '(2,2)>SW', '(2,-1)>NW', '(1,3)>NE', '(2,-2)>SE']);
  });

  test('a draw on the bot move ends the game: status, draw reason, no more moves', () => {
    const game = session([...BOT_LOOP]);
    value(game.newGame({}));
    const last = playAll(game, AGENT_LOOP);
    expect(last.reply).toBe('(2,-1)>NW');
    expect(last.state.status).toBe('draw');
    expect(last.state.draw_reason).toBe('repetition');
    expect(last.state.last_moves).toEqual(['(2,2)>SW', '(2,-1)>NW', '(1,3)>NE', '(2,-2)>SE', '(2,2)>SW', '(2,-1)>NW']);
    expect(value(game.legalMoves())).toEqual({ to_move: 'black', moves: [], announces: {}, free: [], count: 0 });
    expect(failure(game.playMove({ move: '(1,3)>NE' })).code).toBe('game_over');
  });

  test('a game that ends on the agent move gets no reply', () => {
    // One more Black move first, so the position that comes back three times is one after a Black move.
    const { factory, spy } = engines([...BOT_LOOP]);
    const game = new Session(factory, newEncounter, noNetwork);
    value(game.newGame({}));
    const last = playAll(game, ['(-2,2)>NW', ...AGENT_LOOP]);
    expect(last.played).toBe('(2,2)>SW');
    expect(last.reply).toBeNull();
    expect(last.state.status).toBe('draw');
    expect(last.state.draw_reason).toBe('repetition');
    expect(last.state.to_move).toBe('white');
    expect(spy.nodes).toHaveLength(4);
  });
});

describe('resign', () => {
  test('no_game before new_game', () => {
    expect(failure(session().resign()).code).toBe('no_game');
  });

  test('the bot wins, resigned is set, nothing else changes', () => {
    const game = session(['(2,-2)>SE']);
    value(game.newGame({}));
    const { state: before } = value(game.playMove({ move: '(1,3)>NE' }));
    const after = value(game.resign());
    expect(after).toEqual({ ...before, status: 'white_won', resigned: true });
    expect(value(game.getState())).toEqual(after);
  });

  test('a resigned game is over: no moves, no play, no second resign, until new_game', () => {
    const game = session();
    value(game.newGame({}));
    value(game.resign());
    expect(value(game.legalMoves()).moves).toEqual([]);
    expect(failure(game.playMove({ move: '(1,3)>NE' }))).toEqual({ code: 'game_over', message: expect.stringContaining('new_game') });
    expect(failure(game.resign()).code).toBe('game_over');
    const fresh = value(game.newGame({}));
    expect(fresh.resigned).toBe(false);
    expect(fresh.status).toBe('running');
  });

  test('a finished game cannot be resigned', () => {
    const game = session([...BOT_LOOP]);
    value(game.newGame({}));
    playAll(game, AGENT_LOOP);
    expect(failure(game.resign()).code).toBe('game_over');
    expect(value(game.getState()).resigned).toBe(false);
  });
});

/** The state without its random game id, to compare two games. */
function position({ game_id: _, ...rest }: State) {
  return rest;
}

describe('a boss fight (docs/specs/mcp.md sections 4.3 and 5)', () => {
  test('new_game with a boss: mode boss, the generic boss object, the board and threshold of the engine', () => {
    const state = value(session().newGame({ boss: 'choir', seed: 3 }));
    expect(state).toMatchObject({ mode: 'boss', you: 'black', to_move: 'black', status: 'running', last_moves: [] });
    expect(state.boss).toMatchObject({ id: 'choir', name: 'The Choir', phase: 0, phases: 3, result: 'playing' });
    // The Choir plays on the standard board (no x cell) and is won at 6 ejections like any boss (#747).
    expect(state.board.split('').filter((cell) => cell === 'x')).toHaveLength(0);
    expect(state.win_ejections).toEqual({ black: 6, white: 6 });
  });

  test('unknown_boss carries the engine reason, the game in progress is kept', () => {
    const game = session();
    const before = value(game.newGame({}));
    expect(failure(game.newGame({ boss: 'nope' }))).toEqual({ code: 'unknown_boss', message: 'unknown boss nope' });
    expect(value(game.getState())).toEqual(before);
  });

  test('The Ballast Mind joins the game with its radius 5 board and 91 cells (#572)', () => {
    const game = session();
    const state = value(game.newGame({ boss: 'ballast', seed: 7 }));
    expect(state.mode).toBe('boss');
    expect(state.board).toHaveLength(91);
    expect(state.ascii).toContain('0 1 2 3 4 5 6 7 8 9 A');
    expect(state.win_ejections).toEqual({ black: 12, white: 12 });
    expect(state.boss).toMatchObject({ id: 'ballast', name: 'The Ballast Mind', phase: 0, phases: 3, result: 'playing' });
  });

  test('play_move plays the boss reply (Encounter.boss_move) after the agent move, bot_nodes is ignored', () => {
    const { factory, spy } = engines();
    const game = new Session(factory, newEncounter, noNetwork);
    value(game.newGame({ boss: 'hull', seed: 5, bot_nodes: 7 }));
    const answer = value(game.playMove({ move: '(1,3)>NE' }));
    const reference = newEncounter('hull', 5);
    reference.play(record('(1,3)>NE'));
    expect(answer.reply).toBe(formatMove(fromRecord(reference.boss_move())));
    expect(answer.state.last_moves).toEqual(['(1,3)>NE', answer.reply]);
    expect(answer.state.to_move).toBe('black');
    expect(spy.nodes).toEqual([]);
  });

  // The Ballast Mind searches 150 000 nodes a move: its determinism is tested at start (#572). A boss search is the
  // slow part, so each game asks for one boss reply: the engine tests the whole fight for each boss (#693).
  test.each(bossIds().filter((id) => id !== 'ballast'))('the same boss id and seed always give the same fight: %s', (boss) => {
    let searches = 0;
    const counted = (id: string, seed: number): EncounterLike => {
      const encounter = newEncounter(id, seed);
      const search = encounter.boss_move.bind(encounter);
      encounter.boss_move = () => {
        searches += 1;
        return search();
      };
      return encounter;
    };
    const games = [0, 1].map(() => new Session(engines().factory, counted, noNetwork));
    const starts = games.map((game) => value(game.newGame({ boss, seed: 11 })));
    expect(position(starts[1]!)).toEqual(position(starts[0]!));
    const move = value(games[0]!.legalMoves()).moves[0]!;
    const [first, second] = games.map((game) => value(game.playMove({ move })));
    expect(second!.reply).toBe(first!.reply);
    expect(position(second!.state)).toEqual(position(first!.state));
    expect(searches).toBe(2);
  });

  test('legal_moves: the Echo announces the bonus mirror each move gives it, the other bosses announce nothing', () => {
    const echo = session();
    value(echo.newGame({ boss: 'echo' }));
    const legal = value(echo.legalMoves());
    expect(Object.keys(legal.announces)).toEqual(legal.moves);
    // The point reflection through the centre, legal for every move of the symmetric start (Encounter.tell_move).
    expect(legal.announces['(1,3)>NE']).toBe('(-1,-3)>SW');
    const hull = session();
    value(hull.newGame({ boss: 'hull' }));
    expect(value(hull.legalMoves()).announces).toEqual({});
  });

  test('the Echo offers the agent a free move: listed in legal_moves.free, playing it keeps the turn, no reply (#958)', () => {
    const game = session();
    value(game.newGame({ boss: 'echo', seed: 7 }));
    expect(value(game.legalMoves()).free).toEqual([]);
    const { reply } = value(game.playMove({ move: '(1,3)>NE' }));
    const reference = newEncounter('echo', 7);
    reference.play(record('(1,3)>NE'));
    reference.play(record(reply!));
    const free = fromRecords(reference.free_moves()).map(formatMove);
    expect(free).toHaveLength(1);
    const legal = value(game.legalMoves());
    expect(legal.free).toEqual(free);
    expect(legal.moves).toContain(free[0]);
    expect(legal.announces[free[0]!]).toBeUndefined();
    const taken = value(game.playMove({ move: free[0]! }));
    expect(taken).toMatchObject({ played: free[0], reply: null, bonuses: [] });
    expect(taken.state.to_move).toBe('black');
    expect(value(game.legalMoves()).free).toEqual([]);
    expect(value(game.playMove({ move: value(game.legalMoves()).moves[0]! })).reply).not.toBeNull();
  });

  test('legal_moves.free is empty against the bot and the other bosses', () => {
    const hull = session();
    value(hull.newGame({ boss: 'hull' }));
    value(hull.playMove({ move: '(1,3)>NE' }));
    expect(value(hull.legalMoves()).free).toEqual([]);
    const bot = session();
    value(bot.newGame({}));
    expect(value(bot.legalMoves()).free).toEqual([]);
  });

  test('resign against a boss: the fight is lost', () => {
    const game = session();
    value(game.newGame({ boss: 'echo' }));
    expect(value(game.resign())).toMatchObject({ status: 'white_won', resigned: true, boss: { result: 'lost' } });
  });
});

describe('a side with no legal move passes its turn (#1301, rules.md section 7)', () => {
  test('the bot walled in passes: no reply, the agent is to move again and the state says who passed', () => {
    const { Engine } = createRequire(import.meta.url)('../engine/edgefall_wasm.js') as typeof import('../engine/edgefall_wasm');
    const plies = WALLED_IN.map((r) => formatMove(fromRecord(r)));
    const agent = plies.filter((_, i) => i % 2 === 0);
    const bot = plies.filter((_, i) => i % 2 === 1);
    const game = new Session(engines(bot, () => Engine.trainer(1, 6)).factory, newEncounter, noNetwork);
    value(game.newGame({}));
    const before = playAll(game, agent.slice(0, -1));
    expect(before.state.passed).toBeNull();
    const last = value(game.playMove({ move: agent.at(-1)! }));
    expect(last.reply).toBeNull();
    expect(last.state.to_move).toBe('black');
    expect(last.state.status).toBe('running');
    expect(last.state.passed).toBe('white');
    expect(value(game.legalMoves()).count).toBeGreaterThan(0);
  });
});

describe('the outcome the Open world reads for its lairs (#1292)', () => {
  /** A real encounter whose status is Black's win. */
  function won(boss: string, seed: number): EncounterLike {
    const encounter = newEncounter(boss, seed);
    return new Proxy(encounter, {
      get(target, key) {
        if (key === 'status') return () => 1;
        const member = Reflect.get(target, key);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
  }

  test('no game, no outcome', () => {
    expect(session().outcome()).toBeNull();
  });

  test('a game against the bot or a boss fight not won has the game id and no boss', () => {
    const game = session();
    const bot = value(game.newGame({}));
    expect(game.outcome()).toEqual({ game: bot.game_id, boss: null });
    const fight = value(game.newGame({ boss: 'hull' }));
    expect(game.outcome()).toEqual({ game: fight.game_id, boss: null });
    value(game.resign());
    expect(game.outcome()).toEqual({ game: fight.game_id, boss: null });
  });

  test('a boss fight the agent won names its boss', () => {
    const game = new Session(engines().factory, won, noNetwork);
    const fight = value(game.newGame({ boss: 'choir' }));
    expect(game.outcome()).toEqual({ game: fight.game_id, boss: 'choir' });
  });
});

describe('a fight of a rogue-lite run (docs/specs/mcp.md section 5, Rogue-lite tools)', () => {
  test('runFight drops the game in progress for the engine given, the bot replies at the budget asked', () => {
    const { factory, spy } = engines();
    const game = new Session(factory, newEncounter, noNetwork);
    const first = value(game.newGame({}));
    const army = factory();
    const fight = game.runFight(army, 77);
    expect(fight.mode).toBe('bot');
    expect(fight.game_id).not.toBe(first.game_id);
    expect(spy.freed).toBe(1);
    value(game.playMove({ move: '(1,3)>NE' }));
    expect(spy.nodes).toEqual([77]);
  });

  test('runBoss starts the encounter given as a boss fight, the boss replies', () => {
    const game = new Session(engines().factory, newEncounter, noNetwork);
    const fight = game.runBoss('hull', newEncounter('hull', 4));
    expect(fight).toMatchObject({ mode: 'boss', boss: { id: 'hull', result: 'playing' } });
    expect(value(game.playMove({ move: '(1,3)>NE' })).reply).not.toBeNull();
  });

  test('playTactic plays the tactic record, then the bot replies when it is its turn', () => {
    const game = new Session(engines().factory, newEncounter, noNetwork);
    expect(failure(game.playTactic(Int32Array.of(0, 1, 0, 0, 0, 0, 0, 0), 'Reinforce')).code).toBe('no_game');
    game.runFight(runRules().fight(14, 10, [[0, 2, 1]], 0), 30);
    const swap = Int32Array.of(0, 3, 0, 2, -1, 2, 0, 0); // a Heavy trades places with a plain marble
    const played = value(game.playTactic(swap, 'Swap (0,2)(-1,2)'));
    expect(played.played).toBe('Swap (0,2)(-1,2)');
    expect(played.reply).not.toBeNull(); // a Swap costs the move: the bot answers
    expect(played.state.last_moves[0]).toBe('Swap (0,2)(-1,2)');
    expect(played.state.to_move).toBe('black');
    const refused = failure(game.playTactic(Int32Array.of(0, 3, -4, 3, -3, 3, 0, 0), 'Swap (-4,3)(-3,3)')); // two plain marbles
    expect(refused.code).toBe('illegal_move');
  });

  test('a tactic that keeps the turn gets no reply', () => {
    const game = new Session(engines().factory, newEncounter, noNetwork);
    game.runFight(runRules().fight(12, 10, [], 0), 30);
    const played = value(game.playTactic(Int32Array.of(0, 1, 0, 0, 0, 0, 0, 0), 'Reinforce'));
    expect(played.reply).toBeNull();
  });

  test('playTactic is refused once the game is over', () => {
    const game = new Session(engines().factory, newEncounter, noNetwork);
    game.runFight(runRules().fight(12, 10, [], 0), 30);
    value(game.resign());
    expect(failure(game.playTactic(Int32Array.of(0, 2, 0, 0, 0, 0, 0, 0), 'Freeze')).code).toBe('game_over');
  });
});

describe('a refusal that cannot be explained (#1676)', () => {
  test('explain failing leaves the engine code alone', () => {
    let armed = false;
    const make = (): EngineLike =>
      new Proxy(newEngine(), {
        get(target, key) {
          if (key === 'board' && armed) return () => ({ get length(): number { throw new Error('boom'); } });
          const member = Reflect.get(target, key);
          return typeof member === 'function' ? member.bind(target) : member;
        },
      });
    const game = new Session(engines([], make).factory, newEncounter, noNetwork);
    value(game.newGame({}));
    armed = true;
    expect(failure(game.playMove({ move: '(0,0)>E' }))).toEqual({ code: 'illegal_move', message: 'Move(NotOwnMarble)' });
  });
});
