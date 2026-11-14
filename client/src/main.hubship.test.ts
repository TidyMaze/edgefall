// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, type Game } from './test/harness';

// The Hub Cutaway as a place to tap (#1691): the bays are buttons over the ship, a tap rolls the marble there (lift between decks) and the room opens as the old deck's plate did,
// the first-entry confirm kept, a shut hatch bumps, a tap or a key ends a roll, the arrow keys move it by hand, and the deck's invisible discs take no click.
// The roll itself (routes, steps, time) is tested in hubroll.test.ts and hubship.test.ts; here the wiring of the page.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const hub = (): string | undefined => document.body.dataset.hub;
const bay = (key: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`#ship-bays [data-bay="${key}"]`)!;
const progress = (beaten: string[]): Record<string, string> => ({ 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten }) });
const press = (key: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

/** The frames the page asks for are run by hand, with the page's clock moved by the same amount. */
function frames(game: Game): (ms: number) => void {
  const queued = new Map<number, () => void>();
  let next = 1;
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => (queued.set(next, cb), next++));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id));
  onTestFinished(() => {
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
  });
  return (ms) => {
    game.frame(ms);
    const due = [...queued.values()];
    queued.clear();
    for (const cb of due) cb();
  };
}
/** The Hub with the ship drawn: its file loaded, the bays on the page. */
async function ship(query = '?bot=off&hub=cutaway', beaten: string[] = [], options: Parameters<typeof boot>[1] = {}): Promise<Game> {
  const game = await boot(query, { ...options, storage: { ...progress(beaten), ...options.storage } });
  game.hook('__startMode', 'hub');
  await game.settle();
  expect(document.body.dataset.hubCutaway).toBe('true');
  return game;
}

describe('the bays as buttons', () => {
  it('are drawn over the ship with their names, a shut deck dark and unnamed, and put on the window', async () => {
    await ship();
    expect(bay('mess:echo').getAttribute('aria-label')).toBe('The Echo, boss, Mess seat');
    expect(bay('cargo:crates')).toBeNull(); // a set piece
    expect(bay('furnace:choir').dataset.state).toBe('dark');
    expect(bay('furnace:choir').textContent).toBe('');
    expect(bay('mess:bot').style.width).not.toBe('');
    expect(Number.parseFloat(bay('mess:bot').style.left)).not.toBeNaN();
  });

  it('are hidden with the flag off and shown with it on', async () => {
    const off = await boot('?bot=off', { storage: progress([]) });
    off.hook('__startMode', 'hub');
    await off.settle();
    expect(byId('ship-bays').hidden).toBe(true);
    await ship();
    expect(byId('ship-bays').hidden).toBe(false);
  });

  it('are none with the flag off, and the old plates stay', async () => {
    const game = await boot('?bot=off', { storage: progress([]) });
    game.hook('__startMode', 'hub');
    await game.settle();
    expect(byId('ship-bays').children.length).toBe(0);
    expect(document.querySelectorAll('#hub-labels [data-cell]').length).toBeGreaterThan(5);
    game.click(1, 0); // the deck's disc takes the click as before
    expect(hub()).not.toBe('mess 0,0');
  });

  it('leave the old deck\'s invisible discs no click', async () => {
    const game = await ship();
    game.click(1, 0);
    game.click(-2, 0);
    expect(hub()).toBe('mess 0,0');
  });
});

describe('a tap on a bay', () => {
  it('rolls the marble there and starts the room as the plate did, for a player who beat a boss', async () => {
    const game = await ship('?bot=off&hub=cutaway', ['echo']);
    const run = frames(game);
    bay('mess:bot').click();
    expect(hub()).toBe('mess 0,0'); // on its way
    run(200);
    expect(hub()).toBeUndefined(); // the House table started: the Hub is left
    expect(byId('hud').textContent).not.toContain('Hub');
  });

  it('asks the first-entry confirm before a room, and enters it on Enter', async () => {
    const game = await boot('?hub=cutaway&firstrun&bot=off');
    byId('coldopen-skip').click();
    await game.settle();
    const run = frames(game);
    bay('mess:bot').click();
    run(200);
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('hub-confirm-text').textContent).toBe("Enter House table (play the ship's bot)?");
    byId('hub-confirm-yes').click();
    expect(hub()).toBeUndefined();
  });

  it('puts the spot back when the player stays on the confirm, and again on Esc', async () => {
    const game = await boot('?hub=cutaway&firstrun&bot=off');
    byId('coldopen-skip').click();
    await game.settle();
    const run = frames(game);
    bay('mess:bot').click();
    run(200);
    expect(byId('hub-confirm').hidden).toBe(false);
    byId('hub-confirm-no').click();
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(hub()).toBe('mess 0,0'); // where the roll started
    bay('mess:bot').click();
    run(200);
    press('Escape');
    expect(hub()).toBe('mess 0,0');
  });

  it('rides the lift to a deck that is open, changing the deck of the marble', async () => {
    const game = await ship('?bot=off&hub=cutaway', ['echo']);
    const run = frames(game);
    bay('cargo:hull').click();
    run(400);
    run(400);
    expect(hub()).toBeUndefined(); // The Hull started
    expect(document.body.dataset.deck).toBe('cargo');
  });

  it('bumps at the hatch of the deck above the last open one, and Tally says her line', async () => {
    const game = await ship();
    const run = frames(game);
    bay('cargo:run').click();
    run(400);
    run(400);
    expect(hub()).toMatch(/^mess /);
    expect(byId('hud').textContent).toContain('Lift to Cargo: locked');
  });

  it('is ended by another tap: no room opens for the first one', async () => {
    const game = await ship('?bot=off&hub=cutaway', ['echo']);
    const run = frames(game);
    bay('mess:daily').click();
    run(40);
    bay('mess:logs').click(); // the first roll ends, the new one starts
    run(800);
    expect(byId('reader').hidden).toBe(false); // the logs terminal opens the reader, the daily did not start
  });

  it('fades in where it goes under reduced motion', async () => {
    const game = await ship('?bot=off&hub=cutaway', ['echo'], { reducedMotion: true });
    const run = frames(game);
    bay('mess:bot').click();
    run(100);
    run(100);
    expect(hub()).toBeUndefined();
  });
});

describe('the arrow keys', () => {
  it('move the marble along a floor and up the lift, open nothing, and bump a shut hatch', async () => {
    const game = await ship();
    const run = frames(game);
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    run(200);
    expect(document.activeElement).toBe(bay('mess:bot')); // the marble stands in the bay: its button has the focus
    expect(hub()).toBe('mess 0,0');
    press('ArrowLeft');
    run(200);
    press('ArrowUp');
    run(200);
    press('ArrowUp'); // the hatch to Cargo is shut
    expect(byId('hud').textContent).toContain('Lift to Cargo: locked');
  });

  it('end a roll on the way', async () => {
    const game = await ship('?bot=off&hub=cutaway', ['echo']);
    const run = frames(game);
    bay('mess:daily').click();
    run(40);
    press('ArrowLeft');
    run(200);
    expect(hub()).toBe('mess 0,0');
  });
});
