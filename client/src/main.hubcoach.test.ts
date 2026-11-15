// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot as bootShip, type Game } from './test/harness';

/** The deck is drawn and takes the taps (as before the ship's file has loaded). */
const boot: typeof bootShip = (query, options) => bootShip(query, { deck: true, ...options });

// The first minutes in the Hub (#1522, docs/specs/ui.md sections 4.5 and 4.7): a coach line that says how to move, a tap on a plate that
// walks the marble to its room, and a confirm the first time a mode is entered from the Hub. An automated browser shows none of it
// unless ?firstrun asks, so the specs that walk into rooms boot as before.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const hub = (): string | undefined => document.body.dataset.hub;
const plate = (cell: string): HTMLElement => document.querySelector<HTMLElement>(`#hub-labels [data-cell="${cell}"]`)!;
const press = (key: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};
const COACH_LINE = 'Tap or click a next cell to roll. The arrow keys or the stick do the same.';
const entered = { 'ab-alone.entered': 'yes' };
/** Boots as a player's first launch and skips the cold open: the Hub. */
async function firstHub(storage: Record<string, string> = {}): Promise<Game> {
  const game = await boot('?firstrun', { storage });
  byId('coldopen-skip').click();
  expect(hub()).toBe('mess 0,0');
  return game;
}
/** Lets the walk run: a step every few frames of a timer. */
function walkFor(steps: number): void {
  for (let i = 0; i < steps; i++) vi.advanceTimersByTime(200);
}
const fakeTimers = (): void => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => void vi.useRealTimers());
};

describe('the coach line', () => {
  it('names the place and the way to move the first time the Hub opens, and is shown on the plate, not the HUD', async () => {
    await firstHub();
    expect(byId('hub-coach').hidden).toBe(false);
    expect(byId('hub-coach').textContent).toBe(COACH_LINE);
    expect(document.querySelector('#hud')!.textContent).not.toContain(COACH_LINE);
  });

  it('goes once the player rolled, and does not come back with the Hub, a reload or a new launch', async () => {
    const game = await firstHub();
    game.click(1, 0);
    expect(hub()).toBe('mess 1,0');
    expect(byId('hub-coach').hidden).toBe(true);
    expect(localStorage.getItem('ab-alone.hubcoach')).toBe('done');
    byId('ship').click();
    expect(byId('hub-coach').hidden).toBe(true);
    await boot('?firstrun', { storage: { 'ab-alone.hubcoach': 'done' } });
    expect(byId('hub-coach').hidden).toBe(true);
  });

  it('stays while a roll that goes nowhere (off the map, a locked lift) is the player\'s only try', async () => {
    const game = await firstHub();
    game.click(3, 3); // not a neighbour
    expect(byId('hub-coach').hidden).toBe(false);
    expect(localStorage.getItem('ab-alone.hubcoach')).toBeNull();
  });

  it('is not shown to a player who beat a boss, nor in an automated browser that did not ask for it', async () => {
    await boot('?firstrun', { storage: { 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten: ['echo'] }) } });
    byId('coldopen-skip').click();
    expect(byId('hub-coach').hidden).toBe(true);
    await boot('/');
    expect(hub()).toBe('mess 0,0');
    expect(byId('hub-coach').hidden).toBe(true);
  });

  it('is shown on a touch screen as with a mouse, where no hover exists to say "Tap to move"', async () => {
    await boot('?firstrun', { touch: true });
    byId('coldopen-skip').click();
    expect(byId('hub-coach').hidden).toBe(false);
  });
});

describe('a tap on a plate', () => {
  it('walks the marble to its room one cell at a time, and enters it as a roll onto it does', async () => {
    await firstHub(entered);
    fakeTimers();
    plate('-2,0').click(); // the House table
    expect(hub()).not.toBe('mess 0,0'); // the first step is at once
    expect(hub()).not.toBeUndefined();
    walkFor(5);
    expect(hub()).toBeUndefined(); // on the table: its game started, as a roll onto it does
    expect(byId('hud').textContent).not.toContain('Hub');
  });

  it('stops next to a room when the confirm is due, and asks for the room by name', async () => {
    await firstHub();
    fakeTimers();
    plate('-2,0').click();
    walkFor(5);
    expect(hub()).toBe('mess -1,0');
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('hub-confirm-text').textContent).toBe("Enter House table (play the ship's bot)?");
  });

  it('does nothing on YOU, the marble\'s own cell', async () => {
    await firstHub();
    fakeTimers();
    plate('0,0').click();
    walkFor(3);
    expect(hub()).toBe('mess 0,0');
  });

  it('bumps a locked lift and says so', async () => {
    await firstHub();
    fakeTimers();
    plate('1,-2').click(); // the lift up
    walkFor(6);
    expect(byId('hud').textContent).toContain('locked');
    expect(hub()).not.toBeUndefined();
  });

  it('is cut short by the next tap on a cell, by an arrow key and by leaving the Hub', async () => {
    const game = await firstHub(entered);
    fakeTimers();
    plate('2,0').click();
    game.click(3, 3); // the player takes over
    let at = hub();
    walkFor(10);
    expect(hub()).toBe(at);
    plate('-3,2').click();
    press('ArrowLeft');
    at = hub();
    walkFor(10);
    expect(hub()).toBe(at);
    plate('2,0').click();
    byId('ship').click(); // the Hub again
    at = hub();
    walkFor(10);
    expect(hub()).toBe(at);
  });

  it('restarts toward the plate tapped last', async () => {
    await firstHub(entered);
    fakeTimers();
    plate('-3,2').click();
    plate('2,-1').click(); // a terminal on the other side
    walkFor(8);
    expect(document.body.dataset.reading).toBeDefined();
  });
});

describe('the entry confirm', () => {
  it('holds a tap on a cell next to a room: nothing starts, the marble stays where it was, the confirm names the mode', async () => {
    const game = await firstHub();
    game.click(-1, 0);
    game.click(-2, 0); // the House table
    expect(hub()).toBe('mess -1,0');
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('hub-confirm-text').textContent).toBe("Enter House table (play the ship's bot)?");
    expect(byId('hub-confirm').getAttribute('role')).toBe('alertdialog');
    expect(document.activeElement).toBe(byId('hub-confirm-yes'));
  });

  it('enters the mode on Enter, once: the next entry asks nothing, also after a reload', async () => {
    const game = await firstHub();
    game.click(-1, 0);
    game.click(-2, 0);
    byId('hub-confirm-yes').click();
    expect(hub()).toBeUndefined();
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(localStorage.getItem('ab-alone.entered')).toBe('yes');
    byId('exit').click();
    game.click(-1, 0);
    game.click(-2, 0);
    expect(hub()).toBeUndefined(); // no second ask
  });

  it('is left with Stay or Escape, with the marble where it was, and asks again the next time', async () => {
    const game = await firstHub();
    game.click(-1, 0);
    game.click(-2, 0);
    byId('hub-confirm-no').click();
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(hub()).toBe('mess -1,0');
    expect(localStorage.getItem('ab-alone.entered')).toBeNull();
    game.click(-2, 0);
    const escape = press('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(hub()).toBe('mess -1,0');
    expect(press('Escape').defaultPrevented).toBe(false); // nothing asked: Escape is not taken
  });

  it('goes when the player taps another cell or presses an arrow, and asks nothing for a lift, a terminal or the Medal room', async () => {
    const game = await firstHub();
    game.click(-1, 0);
    game.click(-2, 0);
    game.click(-1, 1);
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(hub()).toBe('mess -1,1');
    game.click(-2, 1); // the Comms desk
    expect(byId('hub-confirm').hidden).toBe(false);
    press('ArrowRight');
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(hub()).toBe('mess 0,1');
    game.click(0, 2); // the Medal room opens its reader, no confirm
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(document.body.dataset.reading).toBeDefined();
  });

  it('is never shown to a player who beat a boss, nor to an automated browser that did not ask', async () => {
    await boot('?firstrun', { storage: { 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: ['echo'] }) } });
    byId('coldopen-skip').click();
    const game = await boot('/');
    game.click(-1, 0);
    game.click(-2, 0);
    expect(hub()).toBeUndefined(); // the game started at once, as the specs that walk into rooms expect
  });
});
