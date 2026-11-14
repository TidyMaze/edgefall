import { describe, expect, it } from 'vitest';
import {
  BOARD_CELLS,
  CELLS,
  DIRECTIONS,
  MOVE_STRIDE,
  arrowYaw,
  axialTo3D,
  cellAt,
  cellIndex,
  cellsFor,
  directionBetween,
  encodeMove,
  groupTargets,
  isGroup,
  moveForClick,
  parseMoves,
  toggleSelection,
  type Move,
} from './board';

describe('axialTo3D', () => {
  it('puts the centre at the origin', () => {
    expect(axialTo3D(0, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('moves E along +x and SE down the screen (+z)', () => {
    expect(axialTo3D(1, 0)).toEqual({ x: 1, y: 0, z: 0 });
    const se = axialTo3D(0, 1);
    expect(se.x).toBeCloseTo(0.5);
    expect(se.z).toBeCloseTo(Math.sqrt(3) / 2);
  });

  it('keeps all 6 neighbours at exactly the spacing', () => {
    for (const [dq, dr] of DIRECTIONS) {
      const p = axialTo3D(dq, dr, 2);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(2);
    }
  });
});

describe('cell order of the bridge', () => {
  it('has 61 cells', () => {
    expect(CELLS).toHaveLength(61);
  });

  it('indexes rows from r=-4, q ascending', () => {
    expect(cellIndex(0, -4)).toBe(0);
    expect(cellIndex(-1, -3)).toBe(5);
    expect(cellIndex(0, 0)).toBe(30);
    expect(cellIndex(-2, 2)).toBe(45);
    expect(cellIndex(0, 4)).toBe(60);
  });

  it('round-trips every cell', () => {
    CELLS.forEach(([q, r], i) => {
      expect(cellIndex(q, r)).toBe(i);
      expect(cellAt(i)).toEqual([q, r]);
    });
  });

  it('rejects cells off the board', () => {
    expect(cellIndex(10, 0)).toBe(-1);
    expect(cellIndex(-9, -1)).toBe(-1);
    expect(cellIndex(0, 10)).toBe(-1);
    expect(cellIndex(5, 0, CELLS)).toBe(-1);
    expect(cellAt(169)).toBeUndefined();
  });

  it('goes on past the 61 with the outer ring of The Ballast Mind\'s radius 5 board (#564), rows from r=-5', () => {
    expect(BOARD_CELLS.slice(0, 61)).toEqual(CELLS);
    const ring = BOARD_CELLS.slice(61, 91);
    expect(ring.every(([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 5)).toBe(true);
    expect(ring).toEqual(cellsFor(5).filter(([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 5));
    expect(cellIndex(0, -5)).toBe(61);
    expect(cellIndex(5, 0)).toBeGreaterThan(61);
    expect(cellAt(90)).toEqual([0, 5]);
  });

  it('goes on with rings 6 and 7 of the radius 7 board of The Dual Room (#947, #955), each row by row, so no index shifts', () => {
    const ringOf = ([q, r]: readonly [number, number]): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    expect(BOARD_CELLS).toHaveLength(169);
    for (let k = 6; k <= 7; k++) {
      const start = cellsFor(k - 1).length;
      expect(BOARD_CELLS.slice(start, cellsFor(k).length)).toEqual(cellsFor(k).filter((c) => ringOf(c) === k));
    }
    expect(cellIndex(0, -6)).toBe(91);
    expect(cellAt(168)).toEqual([0, 7]);
    expect(cellIndex(8, 0)).toBe(-1);
  });
});

describe('a board of any radius (#501)', () => {
  it('radius 4 gives the 61 cells of today, in the same order', () => {
    expect(cellsFor(4)).toEqual(CELLS);
  });

  it.each([
    [3, 37],
    [4, 61],
    [8, 217],
  ])('radius %i has %i cells, rows from r=-radius, q ascending', (radius, count) => {
    const cells = cellsFor(radius);
    expect(cells).toHaveLength(count);
    expect(cells[0]).toEqual([0, -radius]);
    expect(cells[radius]).toEqual([radius, -radius]);
    expect(cells[radius + 1]).toEqual([-1, 1 - radius]);
    expect(cells[(count - 1) / 2]).toEqual([0, 0]);
    expect(cells[count - 1]).toEqual([0, radius]);
  });

  it.each([3, 4, 8])('radius %i round-trips every cell and rejects the ring outside it', (radius) => {
    const cells = cellsFor(radius);
    cells.forEach(([q, r], i) => {
      expect(cellIndex(q, r, cells)).toBe(i);
      expect(cellAt(i, cells)).toEqual([q, r]);
    });
    expect(cellIndex(radius + 1, 0, cells)).toBe(-1);
    expect(cellIndex(0, -radius - 1, cells)).toBe(-1);
    expect(cellIndex(-radius, -1, cells)).toBe(-1);
    expect(cellAt(cells.length, cells)).toBeUndefined();
  });
});

describe('moves records', () => {
  const flat = Int32Array.from([1, 0, 0, 4, 0, 0, 0, 0, 3, 2, -1, 3, 0, 3, 1, 3]);

  it('parses back-to-back records, dropping unused coordinates', () => {
    expect(parseMoves(flat)).toEqual([
      { cells: [[0, 4]], dir: 0 },
      { cells: [[-1, 3], [0, 3], [1, 3]], dir: 2 },
    ]);
  });

  it('rejects a flat array that is not a multiple of the stride', () => {
    expect(() => parseMoves(Int32Array.from([1, 2, 3]))).toThrow();
  });

  it('encodes a move into one padded record that parseMoves reads back', () => {
    const mv: Move = { cells: [[-1, 3], [0, 3]], dir: 5 };
    const record = encodeMove(mv);
    expect(record).toEqual([2, 5, -1, 3, 0, 3, 0, 0]);
    expect(record).toHaveLength(MOVE_STRIDE);
    expect(parseMoves(Int32Array.from(record))).toEqual([mv]);
  });
});

describe('directionBetween', () => {
  it('maps each neighbour delta to the bridge direction code', () => {
    expect(directionBetween([0, 0], [1, 0])).toBe(0); // E
    expect(directionBetween([0, 0], [-1, 0])).toBe(1); // W
    expect(directionBetween([0, 0], [1, -1])).toBe(2); // NE
    expect(directionBetween([0, 0], [-1, 1])).toBe(3); // SW
    expect(directionBetween([0, 0], [0, -1])).toBe(4); // NW
    expect(directionBetween([0, 0], [0, 1])).toBe(5); // SE
  });

  it('is -1 for the same cell and for non-neighbours', () => {
    expect(directionBetween([2, 1], [2, 1])).toBe(-1);
    expect(directionBetween([0, 0], [2, 0])).toBe(-1);
    expect(directionBetween([0, 0], [1, 1])).toBe(-1);
  });
});

describe('isGroup', () => {
  it('accepts 1 marble, and 2 or 3 contiguous marbles on each axis in any click order', () => {
    expect(isGroup([[0, 0]])).toBe(true);
    expect(isGroup([[0, 0], [1, 0]])).toBe(true);
    expect(isGroup([[1, 0], [0, 0]])).toBe(true);
    expect(isGroup([[0, 0], [1, -1], [2, -2]])).toBe(true);
    expect(isGroup([[0, 1], [0, -1], [0, 0]])).toBe(true);
  });

  it('refuses nothing, 4 marbles, a gap, a triangle and a bend', () => {
    expect(isGroup([])).toBe(false);
    expect(isGroup([[0, 0], [1, 0], [2, 0], [3, 0]])).toBe(false);
    expect(isGroup([[0, 0], [2, 0]])).toBe(false);
    expect(isGroup([[0, 0], [1, 0], [3, 0]])).toBe(false);
    expect(isGroup([[0, 0], [1, 0], [0, 1]])).toBe(false);
    expect(isGroup([[0, 0], [1, 0], [1, 1]])).toBe(false);
  });
});

describe('toggleSelection', () => {
  it('selects a first marble and grows the group up to 3', () => {
    expect(toggleSelection([], [0, 0])).toEqual([[0, 0]]);
    expect(toggleSelection([[0, 0]], [1, 0])).toEqual([[0, 0], [1, 0]]);
    expect(toggleSelection([[0, 0], [1, 0]], [2, 0])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('ignores a marble that would break the group: not aligned, a gap, or a 4th', () => {
    expect(toggleSelection([[0, 0]], [2, 0])).toEqual([[0, 0]]);
    expect(toggleSelection([[0, 0], [1, 0]], [0, 1])).toEqual([[0, 0], [1, 0]]);
    expect(toggleSelection([[0, 0], [1, 0], [2, 0]], [3, 0])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('deselects a selected marble on a second click', () => {
    expect(toggleSelection([[0, 0]], [0, 0])).toEqual([]);
    expect(toggleSelection([[0, 0], [1, 0]], [1, 0])).toEqual([[0, 0]]);
    expect(toggleSelection([[0, 0], [1, 0], [2, 0]], [2, 0])).toEqual([[0, 0], [1, 0]]);
  });

  it('clears the selection when removing the middle marble would leave a gap', () => {
    expect(toggleSelection([[0, 0], [1, 0], [2, 0]], [1, 0])).toEqual([]);
  });
});

describe('moveForClick and groupTargets', () => {
  const single: Move = { cells: [[0, 4]], dir: 4 };
  const pair: Move = { cells: [[0, 4], [0, 3]], dir: 4 };
  const pairBroadside: Move = { cells: [[0, 4], [0, 3]], dir: 0 };
  const trio: Move = { cells: [[0, 4], [0, 3], [0, 2]], dir: 4 };
  const moves = [single, pair, pairBroadside, trio];

  it('plays the move whose group is exactly the selection, whatever the click order', () => {
    expect(moveForClick(moves, [[0, 4]], [0, 3])).toBe(single);
    expect(moveForClick(moves, [[0, 3], [0, 4]], [0, 2])).toBe(pair);
    expect(moveForClick(moves, [[0, 4], [0, 3], [0, 2]], [0, 1])).toBe(trio);
  });

  it('accepts either marble neighbour for a broadside move', () => {
    expect(moveForClick(moves, [[0, 4], [0, 3]], [1, 4])).toBe(pairBroadside);
    expect(moveForClick(moves, [[0, 4], [0, 3]], [1, 3])).toBe(pairBroadside);
  });

  it('is null for an empty selection, a cell inside the group, or no legal move', () => {
    expect(moveForClick(moves, [], [0, 3])).toBeNull();
    expect(moveForClick(moves, [[0, 4], [0, 3]], [0, 3])).toBeNull();
    expect(moveForClick(moves, [[0, 4], [0, 3]], [-1, 3])).toBeNull();
    expect(moveForClick(moves, [[2, 2]], [2, 1])).toBeNull();
  });

  it('lists the target cells of the selected group, without duplicates, each with the direction a click plays', () => {
    expect(groupTargets(moves, [[0, 4], [0, 3]])).toEqual([
      { cell: [1, 4], dir: 0 },
      { cell: [1, 3], dir: 0 }, // also NE of (0, 4), but a click on it plays the broadside E
      { cell: [0, 2], dir: 4 },
    ]);
    expect(groupTargets(moves, [[0, 4]])).toEqual([{ cell: [0, 3], dir: 4 }]);
    expect(groupTargets(moves, [])).toEqual([]);
  });
});

describe('arrowYaw', () => {
  // A flat arrow drawn along +x, turned about +y by the yaw, points from a cell to its neighbour in that direction.
  it('turns the arrow from +x towards the neighbour of each direction', () => {
    DIRECTIONS.forEach(([dq, dr], dir) => {
      const to = axialTo3D(dq, dr);
      const yaw = arrowYaw(dir);
      expect(Math.cos(yaw)).toBeCloseTo(to.x);
      expect(-Math.sin(yaw)).toBeCloseTo(to.z);
    });
  });

  it('is 0 for E and a sixth of a turn for SE', () => {
    expect(arrowYaw(0)).toBeCloseTo(0);
    expect(arrowYaw(5)).toBeCloseTo(-Math.PI / 3);
  });
});
