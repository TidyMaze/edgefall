// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindAsk } from './openworldask';
import type { OpenWorldMode } from './openworldmode';

// The dialog of a wild marble in the way (#1662): shown by the mode (`onAsk`), no focus taken, Enter fights, Escape backs away.
function page() {
  document.body.innerHTML = `<canvas tabindex="0" id="c"></canvas><p id="openworld-live"></p>
    <div id="openworld-ask" hidden><p id="openworld-ask-text">A wild marble is in your way.</p>
    <button id="openworld-ask-fight">Fight</button><button id="openworld-ask-back">Back away</button></div>`;
  const mode = { startFight: vi.fn(), backAway: vi.fn(), onAsk: (_: boolean) => {} };
  const canvas = document.getElementById('c')!;
  const outside = vi.fn();
  document.addEventListener('keydown', outside);
  bindAsk(mode as unknown as OpenWorldMode, canvas);
  const box = document.getElementById('openworld-ask')!;
  const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { mode, canvas, box, outside, press };
}

describe('the question of a wild marble in the way (#1662)', () => {
  it('opens shown and announced without taking the focus, and closing hides it; the focus goes back to the canvas only from the dialog (#1762)', () => {
    const { mode, canvas, box } = page();
    expect(box.hidden).toBe(true);
    mode.onAsk(true);
    expect(box.hidden).toBe(false);
    expect(document.activeElement).not.toBe(document.getElementById('openworld-ask-fight')); // a held key keeps walking
    canvas.focus();
    expect(document.getElementById('openworld-live')!.textContent).toBe('Wild marble in your way. Fight or back away.');
    mode.onAsk(false);
    expect(box.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
    mode.onAsk(true);
    document.getElementById('openworld-ask-fight')!.focus(); // tabbed to Fight, then the dialog closes
    mode.onAsk(false);
    expect(document.activeElement).toBe(canvas);
    mode.onAsk(false); // closed with the focus elsewhere: it stays there
    expect(document.activeElement).toBe(canvas);
  });

  it("Enter fights and Escape backs away, the page sees neither; another key is the page's", () => {
    const { mode, press, outside } = page();
    mode.onAsk(true);
    document.getElementById('openworld-ask-fight')!.focus();
    expect(press('Enter')).toBe(false);
    expect(mode.startFight).toHaveBeenCalledTimes(1);
    expect(press('Escape')).toBe(false);
    expect(mode.backAway).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    expect(press('Tab')).toBe(true);
    expect(outside).toHaveBeenCalledTimes(1);
  });

  it('the buttons answer by a click', () => {
    const { mode } = page();
    mode.onAsk(true);
    document.getElementById('openworld-ask-back')!.click();
    expect(mode.backAway).toHaveBeenCalledTimes(1);
    document.getElementById('openworld-ask-fight')!.click();
    expect(mode.startFight).toHaveBeenCalledTimes(1);
  });
});
