// Why the engine refused a move, in cells (#1676). The engine only throws `Move(Blocked)`; this replays the checks of
// `check` in crates/edgefall-core/src/moves.rs on the board bytes to name the marbles and cells involved. It judges
// nothing: the engine already refused, the reason code stays first in the message.
import { BOARD_CELLS } from './board';
import type { Cell, Move } from './notation';

const VECTORS: Cell[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const NAMES = ['E', 'W', 'NE', 'SW', 'NW', 'SE'];
const NAMES_OF: Record<number, string> = { 0: 'empty', 1: 'a Black marble', 2: 'a White marble', 8: 'a core', 9: 'the Overseer' };

const name = ([q, r]: Cell): string => `(${q},${r})`;
const list = (cells: Cell[]): string => cells.map(name).join('');

/** The engine value of a cell, `undefined` off the board: a vanished cell is off the board for the engine too. */
function valueAt(board: ArrayLike<number>, [q, r]: Cell): number | undefined {
  const i = BOARD_CELLS.findIndex(([x, y]) => x === q && y === r);
  return i < 0 || i >= board.length || board[i] === 3 ? undefined : board[i];
}

const what = (board: ArrayLike<number>, cell: Cell): string => {
  const v = valueAt(board, cell);
  return `${name(cell)} is ${v === undefined ? 'off the board' : (NAMES_OF[v] ?? `a seat marble (${v})`)}`;
};

/** The sentence after the engine code, `reason` being `Move(Blocked)` and the like; `''` when there is nothing to add.
 * `own` is the mark of the mover, `Black` or `White`. */
export function explain(reason: string, move: Move, board: ArrayLike<number>, own: string): string {
  if (move.cells.length === 0) return '';
  const ownValue = own === 'Black' ? 1 : 2;
  const code = /^Move\((\w+)\)$/.exec(reason)?.[1];
  const group = [...move.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const [dq, dr] = VECTORS[move.dir]!;
  const step = ([q, r]: Cell, k: number): Cell => [q + dq! * k, r + dr! * k];
  const axis = group.length > 1 ? [group[1]![0] - group[0]![0], group[1]![1] - group[0]![1]] : [dq!, dr!];
  const forward = dq === axis[0] && dr === axis[1];
  const inline = group.length === 1 || forward || (dq === -axis[0]! && dr === -axis[1]!);
  if (code === 'NotOwnMarble') {
    return `you play ${own}: ${group.filter((c) => valueAt(board, c) !== ownValue).map((c) => what(board, c)).join(', ')}`;
  }
  if (code === 'NotALine') return `${list(group)} are not 2 or 3 adjacent marbles on one line`;
  const front = forward || group.length === 1 ? group[group.length - 1]! : group[0]!;
  if (code === 'OffBoard') {
    const edge = inline ? front : group.find((c) => valueAt(board, step(c, 1)) === undefined)!;
    return `${NAMES[move.dir]} of ${name(edge)} is off the board`;
  }
  if (!inline) {
    if (code !== 'Blocked') return '';
    const blocking = group.map((c) => step(c, 1)).filter((c) => valueAt(board, c) !== 0);
    return `sideways move: ${blocking.map((c) => what(board, c)).join(', ')}; every target cell must be empty`;
  }
  const lead = step(front, 1);
  let run = 0;
  // Like the engine: every cell that is not yours, not empty and not the Overseer is pushed, cores and seats too.
  for (let v = valueAt(board, lead); v !== undefined && v !== ownValue && v !== 0 && v !== 9; v = valueAt(board, step(lead, run))) run++;
  const pushed = Array.from({ length: run }, (_, i) => step(lead, i));
  if (code === 'Blocked') return `${what(board, lead)}; only a marble of the opponent can be pushed, into an empty cell behind`;
  if (code === 'NotStrongEnough') {
    return `${list(group)} (${group.length} marble${group.length > 1 ? 's' : ''}) push ${list(pushed)} (${run}): the pushed side weighs as much or more (a heavy marble or a charge counts extra)`;
  }
  if (code === 'PushBlocked') {
    return `the push of ${list(pushed)} is stopped: ${what(board, step(lead, run))}, or a core, anchor or shield`;
  }
  return '';
}
