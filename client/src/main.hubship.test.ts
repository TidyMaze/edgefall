// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, type Game } from './test/harness';

// The Hub as a place to tap: since #1729 a 2D menu, a tile per room, a tap opens the room as the old deck's plate did, the first-entry confirm kept; the deck's invisible discs take no click.
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
async function ship(query = '?bot=off', beaten: string[] = [], options: Parameters<typeof boot>[1] = {}): Promise<Game> {
  const game = await boot(query, { ...options, storage: { ...progress(beaten), ...options.storage } });
  game.hook('__startMode', 'hub');
  await game.settle();
  expect(document.body.dataset.hubCutaway).toBe('true');
  return game;
}

describe('the bays as buttons', () => {
  it('are tiles with their names in the 2D Hub, a shut deck with none (#1729)', async () => {
    await ship();
    expect(bay('mess:echo').getAttribute('aria-label')).toBe('The Echo, boss, Mess seat');
    expect(bay('cargo:crates')).toBeNull(); // a set piece
    expect(bay('furnace:choir')).toBeNull(); // a shut deck: one line says why, no tile
  });

  it('is rolled on the model beneath by the test hook, as the bays\' arrival does (#1697)', async () => {
    const game = await ship();
    game.hook('__roll', 1, 0);
    expect(hub()).toBe('mess 1,0');
    game.hook('__roll', 3, 3); // not a neighbour: the marble stays
    expect(hub()).toBe('mess 1,0');
  });

  it('is the plain click where no ship is drawn: on a table, and on the deck while the ship loads (#1697)', async () => {
    const table = await boot('?bot=off');
    table.hook('__roll', 0, 2);
    table.hook('__roll', 0, 1);
    expect(table.hook<number>('__plies')).toBe(1);
    const deck = await boot('?bot=off', { deck: true, storage: progress([]) });
    deck.hook('__startMode', 'hub');
    await deck.settle();
    deck.hook('__roll', 1, 0);
    expect(hub()).toBe('mess 1,0');
  });

  it('leave the old deck\'s invisible discs no click', async () => {
    const game = await ship();
    game.click(1, 0);
    game.click(-2, 0);
    expect(hub()).toBe('mess 0,0');
  });
});

describe('a tap on a bay', () => {
  it('starts the room at once, as the plate did, for a player who beat a boss: no marble rolls there (#1729)', async () => {
    await ship('?bot=off', ['echo']);
    bay('mess:bot').click();
    expect(hub()).toBeUndefined(); // the House table started: the Hub is left
    expect(byId('hud').textContent).not.toContain('Hub');
  });

  it('asks the first-entry confirm before a room, and enters it on Enter', async () => {
    const game = await boot('?firstrun&bot=off');
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
    const game = await boot('?firstrun&bot=off');
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
    const game = await ship('?bot=off', ['echo']);
    const run = frames(game);
    bay('cargo:hull').click();
    run(400);
    run(400);
    expect(hub()).toBeUndefined(); // The Hull started
    expect(document.body.dataset.deck).toBe('cargo');
  });



  it('fades in where it goes under reduced motion', async () => {
    const game = await ship('?bot=off', ['echo'], { reducedMotion: true });
    const run = frames(game);
    bay('mess:bot').click();
    run(100);
    run(100);
    expect(hub()).toBeUndefined();
  });
});

describe('the logs bay', () => {
  it('its Read the log row opens the first log of the deck not read yet, the first one when none is read (#1693)', async () => {
    const game = await ship('?bot=off', ['echo']);
    const run = frames(game);
    bay('mess:logs').click();
    run(800);
    byId('bay-row-1').click();
    expect(document.body.dataset.reading).toBe('mess-house-rule');
  });
  it('skips a log already read', async () => {
    const game = await ship('?bot=off', ['echo'], { storage: { 'ab-alone.lore-read': 'mess-house-rule' } });
    const run = frames(game);
    bay('mess:logs').click();
    run(800);
    byId('bay-row-1').click();
    expect(document.body.dataset.reading).toBe('mess-corner-table');
  });
});

describe('a small phone', () => {
  it('hides the lift buttons with the ship', async () => {
    const game = await ship('?bot=off', ['echo']);
    game.hook('__startMode', 'arena');
    await game.settle();
    expect(byId('ship-lift').hidden).toBe(true);
    expect(byId('ship-veil').hidden).toBe(true);
  });
});

describe('a locked bay of a new player (#1692)', () => {
  it('says why on a tap and on the keyboard, starts nothing and leaves the Hub as it is', async () => {
    const game = await ship('?bot=off&newplayer', [], { storage: { 'ab-alone.progress': '' } }); // no record of play: a new player
    const run = frames(game);
    const at = hub();
    for (const room of ['mess:daily', 'mess:echo']) {
      byId('hud').textContent = '';
      if (room === 'mess:echo') bay(room).focus(); // a keyboard press on a focused button is a click
      bay(room).click();
      run(2000);
      expect(byId('hud').textContent).toContain('Locked until your first win');
      expect(hub()).toBeDefined();
      expect(hub()).toMatch(/^mess /);
    }
    expect(at).toMatch(/^mess /);
  });
});
