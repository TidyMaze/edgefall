// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type Axial } from './board';
import { boot, type Game } from './test/harness';

// Selecting a line and previewing its move (#1679): the far end selects the line, the HUD counts it, a touch screen
// previews on a first tap and plays on a second.

type Move = { cells: Axial[]; dir: number };
const legal = (game: Game): Move[] => game.hook<Move[]>('__legal');
const rings = (game: Game): Axial[] => game.hook<Axial[]>('__rings');
const plies = (game: Game): number => game.hook<number>('__plies');
const screen = (game: Game, q: number, r: number): { x: number; y: number } => game.hook('__cellToScreen', q, r);
const hudText = (): string => document.getElementById('hud')!.textContent ?? '';
const pill = (): HTMLElement => document.getElementById('tap-play')!;
const dirOf = (d: number): Axial => ([[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]] as Axial[])[d]!;
const targetOf = (cell: Axial, d: number): Axial => [cell[0] + dirOf(d)[0], cell[1] + dirOf(d)[1]];
const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
function tap(game: Game, cell: Axial, pointerType: string): void {
  const at = screen(game, ...cell);
  for (const type of ['pointerdown', 'pointerup'])
    canvas().dispatchEvent(new PointerEvent(type, { clientX: at.x, clientY: at.y, pointerId: 1, pointerType, bubbles: true }));
}
const trio = (game: Game): Move => legal(game).find((m) => m.cells.length === 3)!;
const target = (m: Move): Axial => {
  const d = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]][m.dir]!;
  return [m.cells[0]![0] + d[0]!, m.cells[0]![1] + d[1]!];
};

describe('selecting a line (#1679)', () => {
  it('selects the whole line from its two ends and says how many marbles', async () => {
    const game = await boot('?bot=off');
    const mv = trio(game);
    const ends = [mv.cells[0]!, mv.cells[2]!].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    game.click(...ends[0]!);
    expect(hudText()).toContain('1 marble selected: pick an arrow');
    game.click(...ends[1]!);
    expect(rings(game).length).toBe(3);
    expect(hudText()).toContain('3 marbles selected: pick an arrow');
  });

  it('keeps one marble when the far marble is not two cells in line', async () => {
    const game = await boot('?bot=off');
    game.click(0, 4);
    game.click(0, 0); // empty centre: no line
    expect(rings(game)).toEqual([[0, 4]]);
  });
});

describe('the tap preview on a touch screen (#1679)', () => {
  it('shows the move on the first tap and plays it on the second', async () => {
    const game = await boot('?bot=off');
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    tap(game, target(mv), 'touch');
    expect(plies(game)).toBe(0);
    expect(hudText()).toContain('Tap the arrow again to play');
    tap(game, target(mv), 'touch');
    expect(plies(game)).toBe(1);
  });

  it('plays at once with a mouse, and ignores a tap that is not a legal target', async () => {
    const game = await boot('?bot=off');
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    tap(game, [0, 0], 'touch'); // not a target of this marble: the click refuses it
    expect(plies(game)).toBe(0);
    tap(game, target(mv), 'mouse');
    expect(plies(game)).toBe(1);
  });

  it('a tap without a selection selects, as before', async () => {
    const game = await boot('?bot=off');
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    tap(game, mv.cells[0]!, 'touch');
    expect(rings(game).length).toBe(1);
  });

  it('does not intervene in the guided first match: one tap plays, no count in the HUD', async () => {
    const game = await boot('?firstrun', { touch: true });
    document.getElementById('coldopen-begin')!.click();
    game.click(0, 2);
    expect(hudText()).not.toContain('marble selected');
    tap(game, [0, 1], 'touch');
    expect(plies(game)).toBe(1);
  });

  it('the hint and the Play pill appear after the first tap only, and a tap on another arrow moves the preview without playing', async () => {
    const game = await boot('?bot=off');
    const two = legal(game).filter((m) => m.cells.length === 1 && m.cells[0]![0] === legal(game).find((x) => x.cells.length === 1)!.cells[0]![0]);
    const cell = two[0]!.cells[0]!;
    const dirs = legal(game).filter((m) => m.cells.length === 1 && m.cells[0]!.join() === cell.join()).map((m) => m.dir);
    expect(dirs.length).toBeGreaterThan(1);
    game.click(...cell);
    expect(hudText()).not.toContain('Tap the arrow again');
    expect(pill().hidden).toBe(true);
    tap(game, targetOf(cell, dirs[0]!), 'touch');
    expect(pill().hidden).toBe(false);
    const first = pill().style.left;
    tap(game, targetOf(cell, dirs[1]!), 'touch');
    expect(plies(game)).toBe(0);
    expect(pill().style.left).not.toBe(first);
    expect(hudText()).toContain('Tap the arrow again to play');
  });

  it('keeps the pill still under reduced motion', async () => {
    const game = await boot('?bot=off', { storage: { 'ab-alone.motion': 'reduced' } });
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    tap(game, target(mv), 'touch');
    expect(pill().hidden).toBe(false);
    expect(pill().className === 'still' || pill().className === '').toBe(true);
  });

  it('a deselect drops the preview and its ghost: the next tap previews, and does not play', async () => {
    const game = await boot('?bot=off');
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    tap(game, target(mv), 'touch');
    game.click(...mv.cells[0]!); // deselect
    expect(pill().hidden).toBe(true);
    expect(document.body.dataset.ghosts).toBe('0');
    game.click(...mv.cells[0]!);
    tap(game, target(mv), 'touch');
    expect(plies(game)).toBe(0);
    expect(pill().hidden).toBe(false);
  });

  it('an Undo drops the preview: after it, a reselected marble previews again and does not play', async () => {
    const game = await boot('?nodes=50', { storage: { 'ab-alone.difficulty': 'normal' } });
    await game.settle();
    const start = legal(game).filter((m) => m.cells.length === 1);
    const played = start[0]!;
    game.click(...played.cells[0]!);
    game.click(...targetOf(played.cells[0]!, played.dir));
    await game.settle();
    game.frame(5000);
    await game.settle();
    game.frame(5000);
    const now = legal(game).filter((m) => m.cells.length === 1);
    const common = now.find((m) => start.some((s) => s.cells[0]!.join() === m.cells[0]!.join() && s.dir === m.dir))!;
    game.click(...common.cells[0]!);
    tap(game, targetOf(common.cells[0]!, common.dir), 'touch');
    expect(pill().hidden).toBe(false);
    (document.getElementById('undo') as HTMLButtonElement).click();
    expect(pill().hidden).toBe(true);
    game.click(...common.cells[0]!);
    tap(game, targetOf(common.cells[0]!, common.dir), 'touch');
    expect(plies(game)).toBe(0);
    expect(pill().hidden).toBe(false);
  });

  it('a boss fight has rule lines of its own: no count and no tap hint over them, the pill still shows', async () => {
    const game = await boot('?bot=off');
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => ((a as Uint32Array).fill(42), a));
    game.openModes();
    document.getElementById('boss-fight')!.click();
    [...document.getElementById('boss-list')!.querySelectorAll('button')].find((b) => b.textContent!.startsWith('The Echo'))!.click();
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    expect(document.querySelector('.pick-note')).toBeNull();
    tap(game, target(mv), 'touch');
    expect(document.querySelector('.pick-note')).toBeNull();
    expect(pill().hidden).toBe(false);
  });

  async function preview(game: Game): Promise<{ mv: Move; cell: Axial }> {
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    tap(game, target(mv), 'touch');
    expect(pill().hidden).toBe(false);
    return { mv, cell: target(mv) };
  }

  it('a zoom, a resize or the window turning drops the preview: the next tap previews again and does not play', async () => {
    const game = await boot('?bot=off');
    const { mv } = await preview(game);
    canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(pill().hidden).toBe(true);
    tap(game, target(mv), 'touch');
    expect(plies(game)).toBe(0);
    expect(pill().hidden).toBe(false);
    window.dispatchEvent(new Event('resize'));
    expect(pill().hidden).toBe(true);
  });

  it('the Hub entry drops the preview: no pill over the Hub', async () => {
    const game = await boot('?bot=off');
    await preview(game);
    game.openModes();
    document.getElementById('ship')!.click();
    expect(pill().hidden).toBe(true);
  });

  describe('the pill stays 8 px inside the window and clear of the plate', () => {
    const rects = (dock: Partial<DOMRect>, size = { width: 60, height: 30 }): void => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return (this.id === 'tap-play' ? size : this.id === 'hud-dock' ? dock : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
      });
    };
    it('goes below the arrow when the plate would be above it', async () => {
      const game = await boot('?bot=off');
      rects({ left: 0, right: 5000, bottom: 5000 });
      const { cell } = await preview(game);
      expect(parseFloat(pill().style.top)).toBeCloseTo(Math.min(screen(game, ...cell).y + 34, innerHeight - 8 - 15), 0);
    });
    it('stays above the arrow when the plate is not over it, or the plate is elsewhere', async () => {
      const game = await boot('?bot=off');
      rects({ left: 0, right: 5000, bottom: 0 });
      const { cell } = await preview(game);
      expect(parseFloat(pill().style.top)).toBeCloseTo(screen(game, ...cell).y - 34, 0);
    });
    it('keeps the pill above the arrow when the plate is high but to the side', async () => {
      const game = await boot('?bot=off');
      rects({ left: 9000, right: 9500, bottom: 5000 });
      const { cell } = await preview(game);
      expect(parseFloat(pill().style.top)).toBeCloseTo(screen(game, ...cell).y - 34, 0);
    });
    it('keeps a pill as wide as the room 8 px from both edges', async () => {
      const game = await boot('?bot=off');
      rects({ left: 0, right: 0, bottom: 0 }, { width: innerWidth - 16, height: 30 });
      await preview(game);
      expect(parseFloat(pill().style.left)).toBeCloseTo(innerWidth / 2, 0);
    });
  });
});
