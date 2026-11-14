// Pure board logic for the client: no DOM, no three.js, no WASM. Encodings come from the header of
// crates/edgefall-wasm/src/lib.rs.

export type Axial = readonly [q: number, r: number];

/** A move as the bridge sees it: 1 to 3 marbles in line, one direction code. */
export interface Move {
  cells: Axial[];
  dir: number;
}

export const RADIUS = 4;
export const MOVE_STRIDE = 8;
/** Board value of a cell a boss removed (The Hull): no disc, no marble, never a target. */
export const VANISHED = 3;

/** Board value of a core of The Overseer, a passive marble both sides push (#635). */
export const CORE_CODE = 8;
/** Board value of The Overseer itself, on the centre cell: nothing moves it (#635). */
export const OVERSEER_CODE = 9;

/** `1` Black or `2` White: a marble, not an empty or vanished cell. */
export const isMarble = (value: number | undefined): boolean => value === 1 || value === 2;

/** Neighbour deltas, the index is the bridge direction code: E, W, NE, SW, NW, SE. */
export const DIRECTIONS: readonly Axial[] = [
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, 1],
  [0, -1],
  [0, 1],
];

/** The cells of a hex board of this radius in the bridge order: rows from r=-radius, q ascending
 * inside a row. Radius 8 is the battle royale arena (217 cells). */
export function cellsFor(radius: number): Axial[] {
  const cells: Axial[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = Math.max(-radius, -radius - r); q <= Math.min(radius, radius - r); q++) {
      cells.push([q, r]);
    }
  }
  return cells;
}

/** The 61 cells of the standard board. */
export const CELLS: readonly Axial[] = cellsFor(RADIUS);

const ring = ([q, r]: Axial): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
/** The cells a board array holds, in the bridge order: the 61, then each ring beyond them in turn, row by row: ring 5 of
 * The Ballast Mind's radius 5 board (#564), rings 5 to 7 of The Dual Room's radius 7 scan (#947, #955). A board of 61
 * values stops before ring 5, one of 91 before ring 6. */
export const BOARD_CELLS: readonly Axial[] = [CELLS, ...[5, 6, 7].map((k) => cellsFor(k).filter((c) => ring(c) === k))].flat();

/** Pointy-top layout: E is +x, rows go down the screen with +r (+z). `spacing` is the distance
 * between two neighbour centres. */
export function axialTo3D(q: number, r: number, spacing = 1): { x: number; y: number; z: number } {
  return { x: spacing * (q + r / 2), y: 0, z: spacing * (Math.sqrt(3) / 2) * r };
}

/** Index of a cell in the bridge board array, `-1` off the board. */
export function cellIndex(q: number, r: number, cells: readonly Axial[] = BOARD_CELLS): number {
  return cells.findIndex(([cq, cr]) => cq === q && cr === r);
}

export function cellAt(index: number, cells: readonly Axial[] = BOARD_CELLS): Axial | undefined {
  return cells[index];
}

/** Splits the flat `legal_moves` array into moves. */
export function parseMoves(flat: ArrayLike<number>): Move[] {
  if (flat.length % MOVE_STRIDE !== 0) {
    throw new Error(`move array length ${flat.length} is not a multiple of ${MOVE_STRIDE}`);
  }
  const moves: Move[] = [];
  for (let i = 0; i < flat.length; i += MOVE_STRIDE) {
    const cells: Axial[] = [];
    for (let k = 0; k < flat[i]!; k++) cells.push([flat[i + 2 + 2 * k]!, flat[i + 3 + 2 * k]!]);
    moves.push({ cells, dir: flat[i + 1]! });
  }
  return moves;
}

/** One record for `Engine.play`, unused coordinates padded with 0. */
export function encodeMove(mv: Move): number[] {
  const record = [mv.cells.length, mv.dir, 0, 0, 0, 0, 0, 0];
  mv.cells.forEach(([q, r], i) => {
    record[2 + 2 * i] = q;
    record[3 + 2 * i] = r;
  });
  return record;
}

/** Direction code from one cell to a neighbour, `-1` if they are not neighbours. */
export function directionBetween(from: Axial, to: Axial): number {
  return DIRECTIONS.findIndex(([dq, dr]) => from[0] + dq === to[0] && from[1] + dr === to[1]);
}

const same = (a: Axial, b: Axial): boolean => a[0] === b[0] && a[1] === b[1];

/** True for 1 to 3 distinct cells that are contiguous on one axis, in any order. Selection UX
 * only: the engine stays the judge of legality. */
export function isGroup(cells: readonly Axial[]): boolean {
  if (cells.length < 1 || cells.length > 3) return false;
  const has = (q: number, r: number): boolean => cells.some((c) => c[0] === q && c[1] === r);
  return DIRECTIONS.some(([dq, dr]) => {
    const starts = cells.filter(([q, r]) => !has(q - dq, r - dr));
    if (starts.length !== 1) return false;
    const [q0, r0] = starts[0]!;
    return cells.every((_, i) => has(q0 + i * dq, r0 + i * dr));
  });
}

/** Click on an own marble: deselect it if selected, else add it when the group stays valid. A
 * deselect that would leave a gap clears the selection. */
export function toggleSelection(selection: readonly Axial[], cell: Axial): Axial[] {
  if (selection.some((c) => same(c, cell))) {
    const rest = selection.filter((c) => !same(c, cell));
    return rest.length > 0 && !isGroup(rest) ? [] : rest;
  }
  const next = [...selection, cell];
  return isGroup(next) ? next : [...selection];
}

/** Legal moves of exactly this group that a click on `target` can play: the target is a neighbour
 * of one group marble in the move direction and not part of the group. */
function movesTo(moves: Move[], selection: readonly Axial[], target: Axial): Move[] {
  if (selection.length === 0 || selection.some((c) => same(c, target))) return [];
  return moves.filter((mv) => {
    const [dq, dr] = DIRECTIONS[mv.dir]!;
    return (
      mv.cells.length === selection.length &&
      mv.cells.every((c) => selection.some((s) => same(s, c))) &&
      selection.some(([q, r]) => same([q + dq, r + dr], target))
    );
  });
}

/** A click on an own marble two cells from the one selected, in line, with our marble between: the whole line of 3 (#1679).
 * Anything else keeps the selection. */
export function fillLine(selection: readonly Axial[], cell: Axial, owns: (c: Axial) => boolean): Axial[] {
  if (selection.length !== 1) return [...selection];
  const [q, r] = selection[0]!;
  const dir = DIRECTIONS.find(([dq, dr]) => cell[0] === q + 2 * dq && cell[1] === r + 2 * dr);
  if (!dir) return [...selection];
  const mid: Axial = [q + dir[0], r + dir[1]];
  return owns(mid) ? [selection[0]!, mid, cell] : [...selection];
}

/** The legal move for "selected group, then clicked target cell", or null. */
export function moveForClick(moves: Move[], selection: readonly Axial[], target: Axial): Move | null {
  return movesTo(moves, selection, target)[0] ?? null;
}

/** Cells to highlight for the selected group: every target of a legal move of that group, in
 * direction-code order, each with the direction of the move a click on it plays. */
export function groupTargets(moves: Move[], selection: readonly Axial[]): { cell: Axial; dir: number }[] {
  const targets: { cell: Axial; dir: number }[] = [];
  for (const [dq, dr] of DIRECTIONS) {
    for (const [q, r] of selection) {
      const cell: Axial = [q + dq, r + dr];
      const mv = moveForClick(moves, selection, cell);
      if (mv && !targets.some((x) => same(x.cell, cell))) targets.push({ cell, dir: mv.dir });
    }
  }
  return targets;
}

/** Turn about +y that points a flat arrow drawn along +x the way of a direction code, on the board. */
export function arrowYaw(dir: number): number {
  const { x, z } = axialTo3D(...DIRECTIONS[dir]!);
  return -Math.atan2(z, x);
}
