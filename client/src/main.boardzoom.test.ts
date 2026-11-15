// @vitest-environment jsdom
import { describe, expect, it, onTestFinished } from 'vitest';
import { boot, type Game, startBoss } from './test/harness';

// #1567: a phone held upright has a one-tap board zoom, kept per device: the whole board, or a closer view of all 61 cells.
// Desktop, landscape and the boards with props off the 61 cells keep their views and show no button.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const zoom = (): HTMLButtonElement => byId('board-zoom') as HTMLButtonElement;

function windowOf(width: number, height: number): void {
  const inner = { innerWidth, innerHeight };
  Object.assign(window, { innerWidth: width, innerHeight: height });
  onTestFinished(() => void Object.assign(window, inner));
}

/** The width in px of the marble of the middle cell, 0.92 of the cell spacing. */
const marble = (game: Game): number => {
  const a = game.hook<{ x: number; y: number }>('__cellToScreen', 0, 0);
  const b = game.hook<{ x: number; y: number }>('__cellToScreen', 1, 0);
  return 0.92 * Math.hypot(b.x - a.x, b.y - a.y);
};

describe('main.ts the board zoom (#1567)', () => {
  it('a button toggles the whole board and the closer view, pressed and saved, and the whole board comes back', async () => {
    windowOf(390, 844);
    const game = await boot('?bot=off');
    expect([zoom().hidden, zoom().getAttribute('aria-pressed'), zoom().getAttribute('aria-label')]).toEqual([false, 'false', 'Zoom the board']);
    const whole = marble(game);
    zoom().click();
    expect(zoom().getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ab-alone.board-zoom')).toBe('on');
    expect(marble(game)).toBeGreaterThan(whole);
    expect(game.hook<{ x: number }>('__cellToScreen', 0, 0).x).toBeCloseTo(195, 3);
    zoom().click();
    expect(zoom().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('ab-alone.board-zoom')).toBe('off');
    expect(marble(game)).toBeCloseTo(whole, 6);
  });

  it('opens on the closer view when the player left it on', async () => {
    windowOf(390, 844);
    const whole = marble(await boot('?bot=off'));
    const booting = boot('?bot=off');
    localStorage.setItem('ab-alone.board-zoom', 'on'); // the harness empties the storage as a boot starts
    const game = await booting;
    expect(zoom().getAttribute('aria-pressed')).toBe('true');
    expect(marble(game)).toBeGreaterThan(whole);
  });

  it('shows no button and keeps the view held sideways and on a desktop window, whatever was saved', async () => {
    for (const [width, height] of [[844, 390], [1280, 720]] as const) {
      windowOf(width, height);
      const off = marble(await boot('?bot=off'));
      const booting = boot('?bot=off');
      localStorage.setItem('ab-alone.board-zoom', 'on');
      const game = await booting;
      expect(zoom().hidden).toBe(true);
      expect(marble(game)).toBeCloseTo(off, 6);
    }
  });

  it('hides the button, and leaves the view alone, in the Hub and in a Pulsar fight', async () => {
    windowOf(390, 844);
    const booting = boot('?bot=off');
    localStorage.setItem('ab-alone.board-zoom', 'on');
    const game = await booting;
    expect(zoom().hidden).toBe(false);
    startBoss('The Pulsar');
    expect(zoom().hidden).toBe(true);
    byId('view-reset').click();
    expect(zoom().hidden).toBe(true);
  });
});
