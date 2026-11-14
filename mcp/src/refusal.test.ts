import { describe, expect, test } from 'vitest';
import { BOARD_CELLS, CELLS } from './board';
import { bossIds, newEncounter, newEngine } from './engine';
import { fromRecords, parseMove, toRecord } from './notation';
import type { EngineLike } from './game';
import { explain } from './refusal';

/** A 61-cell board with the given marks (1 Black, 2 White, 3 vanished, 9 other), the rest empty. */
function bytes(marks: Record<string, number>): Uint8Array {
  return Uint8Array.from(CELLS, ([q, r]) => marks[`${q},${r}`] ?? 0);
}

function why(reason: string, move: string, marks: Record<string, number>, own = 'Black'): string {
  const parsed = parseMove(move);
  if (!parsed.ok) throw new Error(parsed.message);
  return explain(reason, parsed.move, bytes(marks), own);
}

describe('explain a refusal in cells (#1676)', () => {
  test('NotOwnMarble names each cell that is not the mover\'s and what is on it', () => {
    expect(why('Move(NotOwnMarble)', '(0,0)>E', { '0,0': 2 })).toBe('you play Black: (0,0) is a White marble');
    expect(why('Move(NotOwnMarble)', '(0,0)(1,0)>E', { '0,0': 1, '1,0': 2 }, 'White')).toBe(
      'you play White: (0,0) is a Black marble',
    );
    expect(why('Move(NotOwnMarble)', '(0,0)(1,0)(2,0)>E', { '1,0': 3, '2,0': 9 })).toBe(
      'you play Black: (0,0) is empty, (1,0) is off the board, (2,0) is the Overseer',
    );
    expect(why('Move(NotOwnMarble)', '(0,0)>E', { '0,0': 5 })).toBe('you play Black: (0,0) is a seat marble (5)');
    expect(why('Move(NotOwnMarble)', '(9,9)(5,0)>E', {})).toBe('you play Black: (5,0) is off the board, (9,9) is off the board');
  });

  test('NotALine and OffBoard', () => {
    expect(why('Move(NotALine)', '(2,0)(0,0)>E', {})).toBe('(0,0)(2,0) are not 2 or 3 adjacent marbles on one line');
    expect(why('Move(OffBoard)', '(4,0)>E', { '4,0': 1 })).toBe('E of (4,0) is off the board');
    expect(why('Move(OffBoard)', '(-1,4)(0,4)>SE', { '-1,4': 1, '0,4': 1 })).toBe('SE of (-1,4) is off the board');
    expect(why('Move(OffBoard)', '(2,0)(3,0)(4,0)>E', {})).toBe('E of (4,0) is off the board');
    expect(why('Move(OffBoard)', '(3,0)(4,0)>SE', {})).toBe('SE of (4,0) is off the board');
    expect(why('Move(OffBoard)', '(3,0)(4,0)>NE', {})).toBe('NE of (4,0) is off the board');
  });

  test('Blocked: sideways names the cells, inline names the cell in front', () => {
    expect(why('Move(Blocked)', '(0,0)(1,0)>SE', { '0,0': 1, '1,0': 1, '0,1': 2, '1,1': 3 })).toBe(
      'sideways move: (0,1) is a White marble, (1,1) is off the board; every target cell must be empty',
    );
    const inline = 'only a marble of the opponent can be pushed, into an empty cell behind';
    expect(why('Move(Blocked)', '(0,0)>E', { '0,0': 1, '1,0': 1 })).toBe(`(1,0) is a Black marble; ${inline}`);
    expect(why('Move(Blocked)', '(0,0)(1,0)>W', { '0,0': 1, '1,0': 1, '-1,0': 8 })).toBe(`(-1,0) is a core; ${inline}`);
  });

  test('NotStrongEnough and PushBlocked name the pushed line', () => {
    expect(why('Move(NotStrongEnough)', '(0,0)>E', { '0,0': 1, '1,0': 2 })).toBe(
      '(0,0) (1 marble) push (1,0) (1): the pushed side weighs as much or more (a heavy marble or a charge counts extra)',
    );
    expect(why('Move(NotStrongEnough)', '(0,0)(1,0)>E', { '0,0': 1, '1,0': 1, '2,0': 2, '3,0': 2, '4,0': 1 })).toBe(
      '(0,0)(1,0) (2 marbles) push (2,0)(3,0) (2): the pushed side weighs as much or more (a heavy marble or a charge counts extra)',
    );
    expect(why('Move(PushBlocked)', '(0,0)(1,0)>E', { '0,0': 1, '1,0': 1, '2,0': 2, '3,0': 1 })).toBe(
      'the push of (2,0) is stopped: (3,0) is a Black marble, or a core, anchor or shield',
    );
  });

  test('a line of cores is pushed like marbles, as the engine counts it', () => {
    expect(why('Move(NotStrongEnough)', '(0,0)>E', { '0,0': 1, '1,0': 8, '2,0': 8 })).toContain('push (1,0)(2,0) (2)');
  });

  test('nothing to add for another reason, a sideways move that is not Blocked, or no cell', () => {
    expect(why('Move(TooManyMarbles)', '(0,0)(1,0)(2,0)(3,0)>E', {})).toBe('');
    expect(why('Move(Other)', '(0,0)>E', {})).toBe('');
    expect(why('Move(Other)', '(0,0)(1,0)>SE', {})).toBe('');
    expect(why('marble count must be 1 to 3', '(0,0)>E', {})).toBe('');
    expect(explain('Move(OffBoard)', { cells: [], dir: 0 }, bytes({}), 'Black')).toBe('');
  });
});

describe('explain agrees with the real engine', () => {
  const NOTE = /^Move\((NotOwnMarble|NotALine|OffBoard|Blocked|NotStrongEnough|PushBlocked)\)$/;

  /** A move as a key, its cells in sorted order. */
  const keyOf = (m: { cells: number[][]; dir: number }): string =>
    [...m.cells].sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!).join(';') + '>' + m.dir;

  /** Every move of the mover's marbles, as a line of 1 to 3 cells in any direction: legal or not. */
  function candidates(board: Uint8Array, mover: number): string[] {
    const cells = BOARD_CELLS.slice(0, board.length);
    const mine = new Set(cells.filter((_, i) => board[i] === mover).map(([q, r]) => `${q},${r}`));
    const axes = [[1, 0], [1, -1], [0, 1]];
    const out: string[] = [];
    for (const [q, r] of cells) {
      if (!mine.has(`${q},${r}`)) continue;
      for (const [aq, ar] of axes) {
        for (let n = 1; n <= 3; n++) {
          const line = Array.from({ length: n }, (_, k) => `(${q + aq! * k},${r + ar! * k})`).join('');
          if (n === 1 && (aq !== 1 || ar !== 0)) continue;
          for (const dir of ['E', 'W', 'NE', 'SW', 'NW', 'SE']) out.push(`${line}>${dir}`);
        }
      }
    }
    return out;
  }

  function check(engine: Pick<EngineLike, 'board' | 'to_move' | 'legal_moves' | 'play'>): number {
    const board = engine.board();
    const mover = engine.to_move();
    const legal = new Set(fromRecords(engine.legal_moves()).map(keyOf));
    let refused = 0;
    for (const text of candidates(board, mover)) {
      const parsed = parseMove(text);
      if (!parsed.ok) throw new Error(parsed.message);
      if (legal.has(keyOf(parsed.move))) continue;
      let reason = '';
      try {
        engine.play(toRecord(parsed.move));
        throw new Error(`${text} was played`);
      } catch (error) {
        reason = String(error);
      }
      const message = explain(reason, parsed.move, board, mover === 1 ? 'Black' : 'White');
      if (NOTE.test(reason)) {
        expect(message, `${text} ${reason}`).not.toBe('');
        if (/Strong|PushBlocked/.test(reason)) expect(message, text).toMatch(/push(ed)? ?\(-?\d+,-?\d+\)/);
        refused++;
      }
    }
    return refused;
  }

  test('the opening: every refused move gets a sentence naming cells', () => {
    expect(check(newEngine())).toBeGreaterThan(50);
  });

  test('every boss board, cores and seats included, at its start', () => {
    for (const id of bossIds()) check(newEncounter(id, 0));
  });
});
