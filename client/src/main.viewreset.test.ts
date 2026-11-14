// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot } from './test/harness';

// #1681: a floating Reset view button over the board, shown only once the camera has moved, so the way back to the
// default view (the board edge readable) is one press, not three menus deep.

const chip = (): HTMLButtonElement => document.getElementById('view-reset') as HTMLButtonElement;
const wheel = (): void => void document.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true }));

describe('main.ts the floating Reset view (#1681)', () => {
  it('hidden at the default view, shown once the camera moved, and a press brings the view back and hides it', async () => {
    const game = await boot('?bot=off');
    expect([chip().hidden, chip().textContent, chip().getAttribute('aria-label')]).toEqual([true, 'Reset view', 'Reset view']);
    wheel();
    expect(chip().hidden).toBe(false);
    const zoomed = game.hook('__cellToScreen', 4, -4);
    chip().click();
    expect(chip().hidden).toBe(true);
    expect(game.hook('__cellToScreen', 4, -4)).not.toEqual(zoomed);
  });

  it('a resize never shows it on an unmoved camera, keeps it on a moved one, and a reset then stays hidden through a resize', async () => {
    const inner = { innerWidth, innerHeight };
    try {
      await boot('?bot=off');
      Object.assign(window, { innerWidth: 400, innerHeight: 800 }); // a phone held upright
      dispatchEvent(new Event('resize'));
      expect(chip().hidden).toBe(true); // never moved
      wheel();
      Object.assign(window, { innerWidth: 1000, innerHeight: 700 });
      dispatchEvent(new Event('resize'));
      expect(chip().hidden).toBe(false); // still moved
      chip().click();
      expect(chip().hidden).toBe(true);
      Object.assign(window, { innerWidth: 400, innerHeight: 800 });
      dispatchEvent(new Event('resize'));
      expect(chip().hidden).toBe(true); // the default, refitted
    } finally {
      Object.assign(window, inner);
    }
  });

  it('the menu Reset view hides it too', async () => {
    await boot('?bot=off');
    wheel();
    expect(chip().hidden).toBe(false);
    (document.getElementById('reset-view') as HTMLButtonElement).click();
    expect(chip().hidden).toBe(true);
  });
});
