// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, type Game, startBoss } from './test/harness';

// Bug #957: the board's centre sits in the middle of the window on every view a fight opens on and on Reset view, the
// HUD plate does not push it aside (#695 is gone): the player folds the plate instead. The Dual Room's two rooms lie
// either side of the origin. Held upright it is centred too (#1387).

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const SIZES = [
  [1280, 720], // desktop
  [375, 812], // phone upright
  [812, 375], // phone sideways
] as const;

/** Sets the window size, and puts it back when the test ends. */
function windowOf(width: number, height: number): void {
  const inner = { innerWidth, innerHeight };
  Object.assign(window, { innerWidth: width, innerHeight: height });
  onTestFinished(() => void Object.assign(window, inner));
}

/** Starts the fight against `boss` from the mode menu. */
function fight(game: Game, boss: string): void {
  startBoss(boss);
}

/** Where the axial point (q, r) is drawn in the window. */
const drawn = (game: Game, q: number, r: number): { x: number; y: number } => game.hook('__cellToScreen', q, r);

describe('main.ts the board centred in the window (#957)', () => {
  for (const [width, height] of SIZES)
    it(`a fight opens, and Reset view goes back, on the board centre in the middle of a ${width}x${height} window`, async () => {
      windowOf(width, height);
      const game = await boot('?bot=off');
      const centreY = height / 2;
      for (const boss of ['The Choir', 'The Pulsar', 'The Dual Room']) {
        // The plate as Chromium lays it out: before #957 the view slid aside off it.
        vi.spyOn(byId('hud'), 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 16, y: 16, width: 230, height: 175 }));
        fight(game, boss);
        expect(drawn(game, 0, 0).x).toBeCloseTo(width / 2, 3);
        expect(drawn(game, 0, 0).y).toBeCloseTo(centreY, 3);
        document.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
        byId('view-reset').click();
        expect(drawn(game, 0, 0).x).toBeCloseTo(width / 2, 3);
        expect(drawn(game, 0, 0).y).toBeCloseTo(centreY, 3);
      }
    });
});

describe('main.ts the screen point of a cell (#1259)', () => {
  it('__cellToScreen draws a point lifted above the cell higher in the window', async () => {
    const game = await boot('?bot=off');
    const lifted = game.hook<{ x: number; y: number }>('__cellToScreen', -4, 0, 0.76);
    expect(lifted.y).toBeLessThan(drawn(game, -4, 0).y);
  });
});
