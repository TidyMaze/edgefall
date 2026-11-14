// The board of edgefall-wasm (`Engine.board()`, 61, 91 or 169 cell values) as text for the agent: `board`, one character per
// cell, and `ascii`, the board as `render` in edgefall-cli prints it (docs/specs/mcp.md section 4.2).
import type { Cell } from './notation';

const RADIUS = 4;

/** The 61 cells in edgefall-wasm board order: row by row from `r = -4` to `r = 4`, `q` ascending inside a row. */
export const CELLS: Cell[] = [];
for (let r = -RADIUS; r <= RADIUS; r++) {
  for (let q = Math.max(-RADIUS, -RADIUS - r); q <= Math.min(RADIUS, RADIUS - r); q++) CELLS.push([q, r]);
}

const ring = ([q, r]: Cell): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

/** Ring `k` of a board, row by row from `r = -k`, `q` ascending inside a row. */
const ringCells = (k: number): Cell[] => {
  const cells: Cell[] = [];
  for (let r = -k; r <= k; r++) {
    for (let q = -k; q <= k; q++) {
      if (Math.abs(q + r) <= k && ring([q, r]) === k) cells.push([q, r]);
    }
  }
  return cells;
};

/** The cells in edgefall-wasm board order: the 61 of the standard board, then each ring beyond in turn: ring 5 of The
 * Ballast Mind's radius 5 board (91 cells, #572), rings 6 and 7 of The Dual Room's radius 7 scan (169 cells, #947, #955). */
export const BOARD_CELLS: Cell[] = [CELLS, ...[5, 6, 7].map(ringCells)].flat();

/** Cell values of edgefall-wasm: `0` empty, `1` Black, `2` White, `3` vanished, then `4` to `7` the battle royale
 * seats (never on a boss board), `8` a core and `9` the Overseer (The Overseer, #635). */
const BOARD_MARKS = '.BWx????cO';
/** edgefall-cli shows a vanished cell like a cell off the board: blank. */
const ASCII_MARKS = '.BW ????cO';

export function boardText(board: ArrayLike<number>): string {
  return Array.from(board, (value) => BOARD_MARKS[value]).join('');
}

/** A header with columns (1 to 9 for radius 4, 0 to A for radius 5, 0 to E for The Dual Room's radius 7), then rows a
 * to i (k for radius 5, o for radius 7). */
export function ascii(board: ArrayLike<number>): string {
  const radius = ({ 91: 5, 169: 7 } as Record<number, number>)[board.length] ?? RADIUS;
  const size = 2 * radius + 1;
  const grid = Array.from({ length: size }, () => Array<string>(size).fill(' '));
  BOARD_CELLS.slice(0, board.length).forEach(([q, r], i) => {
    grid[r + radius]![q + radius] = ASCII_MARKS[board[i]!]!;
  });
  const rowLabels = 'abcdefghijklmno';
  const columns = Array.from({ length: size }, (_, k) => (k + (radius === RADIUS ? 1 : 0)).toString(36).toUpperCase());
  const header = `  ${columns.join(' ')}`;
  const rows = grid.map((slots, row) => `${rowLabels[row]} ${slots.join(' ')}`.trimEnd());
  return [header, ...rows].join('\n');
}

/** The marbles of each side as cells in the notation `play_move` takes, `(q,r)`, in board order (#1676). */
export function marbles(board: ArrayLike<number>): { black: string[]; white: string[] } {
  const cells = BOARD_CELLS.slice(0, board.length);
  const of = (value: number): string[] => cells.filter((_, i) => board[i] === value).map(([q, r]) => `(${q},${r})`);
  return { black: of(1), white: of(2) };
}

/** How to turn a row letter and a column of `ascii` into the `(q,r)` of a move: `r` from the row, `q` from the column. */
export function asciiKey(board: ArrayLike<number>): string {
  const radius = ({ 91: 5, 169: 7 } as Record<number, number>)[board.length] ?? RADIUS;
  const first = radius === RADIUS ? 1 : 0;
  return `a cell is (q,r): r from its row letter (a is ${-radius}, then +1 per letter), q = its column header - ${radius + first} (digits then letters, A is 10)`;
}
