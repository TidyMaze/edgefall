// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { BLACK_WINS, WHITE_WINS } from '../e2e/end-games';
import { gameFileText } from './gamefile';
import { boot, type Game } from './test/harness';


// The first-win lock on main.ts (#1665, docs/specs/ui.md section 4.10): a new player plays the normal game first; the other modes unlock after the first win.

/** The starter buttons that wait for the first win (#1697). */
const LOCKED_IDS = ['openworld', 'daily', 'roguelite', 'battle-royale', 'ranked', 'leaderboard', 'fight-together', 'boss-duel', 'ship', 'trainer'];
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const unlocked = (): string | undefined => document.body.dataset.unlocked;
const flag = (): string | null => localStorage.getItem('ab-alone.firstwin');
const card = (): HTMLElement => byId('unlock');
const progress = (beaten: string[]): string => JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten });

/** Opens a finished game as the player's own game against the bot, through the import file. */
async function finish(game: Game, moves: number[][]): Promise<void> {
  const input = byId<HTMLInputElement>('import-file');
  Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: true, moves })], 'g.json')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await game.settle();
}

describe('the landing of a new player', () => {
  it('is the standard board against the bot (the guided first match, #1663), with no cold open and no Hub, and the other modes locked', async () => {
    await boot('/', { webdriver: false });
    expect(byId('coldopen').hidden).toBe(true);
    expect(document.body.dataset.firstrun).toBe('match');
    expect(document.body.dataset.hub).toBeUndefined();
    expect(unlocked()).toBe('0');
    expect(byId('exit').hidden).toBe(true); // the ship is not open yet: the table has no way out
  });

  it('presses on a locked entry start nothing, the menu stays as it is', async () => {
    const game = await boot('/', { webdriver: false });
    for (const id of LOCKED_IDS) byId(id).click();
    expect(document.body.dataset.hub).toBeUndefined();
    expect(document.body.dataset.boss).toBeUndefined();
    expect(document.body.dataset.openworld).toBeUndefined();
    expect(document.body.dataset.run).toBeUndefined();
    expect(document.body.dataset.unlocked).toBe('0');
  });

  it('a Hub opened by a hook wears the lock on its boss and mode doors, and rolling onto one starts nothing; a table still starts', async () => {
    const game = await boot('?newplayer');
    game.hook('__enterMode', 'hub');
    expect(document.body.dataset.hub).toBe('mess 0,0');
    const plate = (cell: string): HTMLElement => document.querySelector<HTMLElement>(`#hub-labels [data-cell="${cell}"]`)!;
    expect(plate('2,0').dataset.mark).toBe('locked'); // The Dual Room
    expect(plate('2,0').textContent).toContain('Win your first game to unlock');
    expect(plate('-2,0').dataset.mark).toBeUndefined(); // the House table
    game.click(1, 0);
    game.click(2, 0);
    expect(document.body.dataset.boss).toBeUndefined();
    expect(document.body.dataset.hub).toBe('mess 2,0');
    game.click(1, 0);
    game.click(0, 0);
    game.click(-1, 0);
    game.click(-2, 0);
    expect(document.body.dataset.hub).toBeUndefined(); // the table started a game
  });
});

describe('who is locked', () => {
  it('an automated page is open, and ?newplayer gives it a new player', async () => {
    await boot('/');
    expect(unlocked()).toBe('1');
    await boot('?newplayer');
    expect(unlocked()).toBe('0');
  });

  it.each([
    ['the first-win flag', { 'ab-alone.firstwin': '1' }],
    ['a boss beaten', { 'ab-alone.progress': progress(['echo']) }],
    ['the first run done', { 'ab-alone.firstrun': 'done' }],
    ['a daily record', { 'ab-alone.daily': '{}' }],
    ['a rating', { 'ab-alone.ranked': '{}' }],
    ['a run history', { 'ab-alone.roguelite': '2' }],
  ])('%s opens everything at once, with no card', async (_, storage) => {
    await boot('/?newplayer', { storage });
    expect(unlocked()).toBe('1');
    expect(card().hidden).toBe(true);
  });

  it('a saved local game opens everything at once', async () => {
    const indexedDB = new IDBFactory();
    const first = await boot('?newplayer&bot=off', { indexedDB });
    expect(unlocked()).toBe('0');
    const move = first.hook<{ cells: [number, number][]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    first.click(...move.cells[0]!);
    first.click(...first.hook<{ cell: [number, number]; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    first.frame(1000);
    await first.settle();
    await boot('?newplayer&bot=off', { indexedDB });
    expect(unlocked()).toBe('1');
  });

  it('?unlock saves the flag and opens the lock', async () => {
    await boot('?unlock', { webdriver: false });
    expect(unlocked()).toBe('1');
    expect(flag()).toBe('1');
    expect(card().hidden).toBe(true);
  });
});

describe('the first win', () => {
  it('a win against the bot saves the flag, opens the lock and shows the card once', async () => {
    const game = await boot('?newplayer');
    expect(card().hidden).toBe(true);
    await finish(game, BLACK_WINS);
    expect(flag()).toBe('1');
    expect(unlocked()).toBe('1');
    expect(card().hidden).toBe(false);
    expect(byId('unlock-title').textContent).toBe('You won.');
    expect(byId('unlock-text').textContent).toBe('The Mess is open. Next: beat The Echo.');
    expect(card().getAttribute('role')).toBe('dialog');
    byId('unlock-dismiss').click();
    expect(card().hidden).toBe(true);
    game.hook('__startMode', 'arena'); // the first win landed in the ship: a table again
    await finish(game, BLACK_WINS); // another win does not show it again
    expect(card().hidden).toBe(true);
  });

  it('the card leads to the Open world, and has no Hub button: the ship is where the player lands (#1692)', async () => {
    const game = await boot('?newplayer');
    await finish(game, BLACK_WINS);
    expect(document.getElementById('unlock-hub')).toBeNull(); // the ship is where the player lands (#1692)
    expect(document.body.dataset.hub).toMatch(/^mess /);
    const again = await boot('?newplayer');
    await finish(again, BLACK_WINS);
    byId('unlock-world').click();
    expect(card().hidden).toBe(true);
    await again.settle();
    expect(document.body.dataset.openworld).toBeTruthy(); // the world opens over the ship
  });

  it('a loss unlocks nothing', async () => {
    const game = await boot('?newplayer');
    await finish(game, WHITE_WINS);
    expect(document.body.dataset.over).toBe('loss');
    expect(flag()).toBeNull();
    expect(unlocked()).toBe('0');
    expect(card().hidden).toBe(true);
  });

  it('a game at a hot-seat table is not a win against the bot', async () => {
    const game = await boot('?newplayer&bot=off');
    const input = byId<HTMLInputElement>('import-file');
    Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: false, moves: BLACK_WINS })], 'g.json')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await game.settle();
    expect(document.body.dataset.over).toBe('win');
    expect(flag()).toBeNull();
    expect(card().hidden).toBe(true);
  });
});

describe('the returning player, whatever the record', () => {
  it.each([
    ['ab-alone.boss-tally', '{"echo":{"won":1,"lost":2}}'],
    ['ab-alone.story', '2'],
    ['ab-alone.roguelite.history', '[{"seed":123456,"floor":4,"won":false}]'],
    ['ab-alone.ranked.board', '[{"name":"Mira","rating":1215}]'],
    ['ab-alone.world-key', '{"pub":"mkTc6xq3q8e0j6pQ9wz1G4yH7Kd2n5RvB8sLaUfXoYE","priv":"jwk"}'],
    ['ab-alone.public-name', 'Mira'],
  ])('%s alone opens everything, with no card', async (key, value) => {
    await boot('/?newplayer', { storage: { [key]: value } });
    expect(unlocked()).toBe('1');
    expect(card().hidden).toBe(true);
  });
  it('the guide alone is reading, not play: the profile stays locked and the win is still needed', async () => {
    await boot('/?newplayer', { storage: { 'ab-alone.guide': 'seen', 'ab-alone.transcript': 'on' } });
    expect(unlocked()).toBe('0');
  });
  it('a run saved in progress opens everything at once', async () => {
    const indexedDB = new IDBFactory();
    const first = await boot('?bot=off', { indexedDB });
    await first.hook<Promise<void>>('__enterMode', 'run'); // a real run, saved at its start
    await first.settle();
    await boot('?newplayer&bot=off', { indexedDB });
    expect(unlocked()).toBe('1');
  });
  it('a saved Open world opens everything at once', async () => {
    const indexedDB = new IDBFactory();
    const first = await boot('?bot=off', { indexedDB });
    byId('openworld').click();
    for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done)); // the menu reads the saved world first
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); // one step of the hero, saved
    first.frame();
    for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
    expect(document.body.dataset.openworldSaved).toBe('1'); // a real world save of the public seed
    await boot('?newplayer&bot=off', { indexedDB });
    expect(unlocked()).toBe('1');
  });
  it('a profile with only settings stays locked', async () => {
    await boot('/?newplayer', { storage: { 'ab-alone.difficulty': 'hard', 'ab-alone.palette': 'default', 'ab-alone.sound': 'off', 'ab-alone.reduced-motion': 'on', 'ab-alone.volume.music': '30' } });
    expect(unlocked()).toBe('0');
  });
  it('a first visit writes no record of play: the next visit is still a new player', async () => {
    await boot('/', { webdriver: false });
    const kept = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!]));
    await boot('/', { webdriver: false, storage: kept });
    expect(unlocked()).toBe('0');
  });
});

describe('every way into a locked mode', () => {
  it('the Hub and Trainer buttons, the dock Open world, and a link ?openworld= of a real player start nothing', async () => {
    const game = await boot('/?openworld=7', { webdriver: false });
    expect(document.body.dataset.openworld).toBeUndefined();
    expect(unlocked()).toBe('0');
    for (const id of ['ship', 'trainer', 'openworld']) byId(id).click();
    expect(document.body.dataset.hub).toBeUndefined();
    expect(document.body.dataset.trainer).toBeUndefined();
    expect(document.body.dataset.openworld).toBeUndefined();
  });
});

describe('the Hub names the first move', () => {
  it('the Hub goal reads the first win, and no door is the amber goal', async () => {
    const game = await boot('?newplayer');
    game.hook('__enterMode', 'hub');
    expect(document.querySelector('#hub-rail .goal')!.textContent).toBe('Next goal: Win your first game vs the bot');
    expect(document.querySelector('#hub-labels [data-goal]')).toBeNull();
  });
  it('the board and the Mess seat point to the first win while locked, not to The Echo', async () => {
    const game = await boot('?newplayer');
    game.hook('__enterMode', 'hub');
    expect(document.querySelector('#hub-board .next')!.textContent).toBe('Next: win your first game vs the bot.');
    expect(document.querySelector('#hub-rail [data-deck="mess"] small')!.textContent).toBe('Seat: win your first game · you are here');
    expect(document.getElementById('hub-board')!.textContent).not.toContain('Echo');
    expect(document.getElementById('hub-rail')!.textContent).not.toContain('Echo waits');
  });
  it('the card makes Open world the focus and lists the Leaderboard', async () => {
    const game = await boot('?newplayer');
    await finish(game, BLACK_WINS);
    expect(document.activeElement).toBe(byId('unlock-world'));
    expect(byId('unlock-text').textContent).toBe('The Mess is open. Next: beat The Echo.');
  });
});

describe('the first win on the Hub Cutaway (#1692)', () => {
  it('lands in the ship, names the goal on the card, sparks the lit bays for a moment and drops the Hub button', async () => {
    const game = await boot('?newplayer');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const input = byId<HTMLInputElement>('import-file');
      Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: true, moves: BLACK_WINS })], 'g.json')], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.advanceTimersByTimeAsync(1);
      expect(byId('unlock-text').textContent).toBe('The Mess is open. Next: beat The Echo.');
      expect(document.getElementById('unlock-hub')).toBeNull(); // the ship is where the player lands (#1692)
      expect(document.body.dataset.hub).toMatch(/^mess /); // the player lands in the ship
      expect(document.body.dataset.firstrun).toBeUndefined();
      await vi.advanceTimersByTimeAsync(3000); // the spark ends: the bays are rebuilt without it
      expect(byId('ship-bays').querySelector('[data-spark]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    await game.settle();
  });
});

describe('leaving before the first win lands in the ship (#1692)', () => {
  it('a player who starts another mode within the tick is not pulled back, and one who leaves the ship ends the spark', async () => {
    const game = await boot('?newplayer');
    const held = new Map<number, () => void>(); // the first win's two timers (the landing and the spark's end), held to be run by hand
    let id = 1000;
    const real = { set: window.setTimeout, clear: window.clearTimeout };
    vi.stubGlobal('setTimeout', (fn: () => void, ms?: number, ...rest: unknown[]) => (/landTimer|sparkTimer/.test(String(fn)) ? (held.set(++id, fn), id) : real.set.call(window, fn, ms, ...rest)));
    vi.stubGlobal('clearTimeout', (h?: number) => (held.delete(h as number) ? undefined : real.clear.call(window, h)));
    try {
      const input = byId<HTMLInputElement>('import-file');
      Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: true, moves: BLACK_WINS })], 'g.json')], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(held.size).toBe(1)); // the landing is waiting
      game.hook('__startMode', 'arena'); // leaves within the tick
      expect(held.size).toBe(0);
      expect(document.body.dataset.hub).toBeUndefined();
      game.hook('__startMode', 'hub');
      expect(held.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    await game.settle();
  });

  it('lands, sparks, and leaving the ship drops the spark timer', async () => {
    const game = await boot('?newplayer');
    const held = new Map<number, () => void>();
    let id = 1000;
    const real = { set: window.setTimeout, clear: window.clearTimeout };
    vi.stubGlobal('setTimeout', (fn: () => void, ms?: number, ...rest: unknown[]) => (/landTimer|sparkTimer/.test(String(fn)) ? (held.set(++id, fn), id) : real.set.call(window, fn, ms, ...rest)));
    vi.stubGlobal('clearTimeout', (h?: number) => (held.delete(h as number) ? undefined : real.clear.call(window, h)));
    try {
      const input = byId<HTMLInputElement>('import-file');
      Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: true, moves: BLACK_WINS })], 'g.json')], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(held.size).toBe(1));
      const [landing, run] = [...held][0]!;
      held.delete(landing); // it fires once
      run(); // the landing
      expect(document.body.dataset.hub).toMatch(/^mess /);
      expect(held.size).toBe(1); // the spark's end
      game.hook('__startMode', 'arena');
      expect(held.size).toBe(0); // dropped with the ship
    } finally {
      vi.unstubAllGlobals();
    }
    await game.settle();
  });
});
