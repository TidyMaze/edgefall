// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import * as THREE from 'three';
import { BOSS_IDS } from './tally';
import { boot, type Game } from './test/harness';

// One home for every feature, part 1 (#1693): the Clamp list bay opens a two-row sheet (Ranked, Leaderboard) and the Shift crew bay another (Boss with a partner,
// Boss vs a player, whose boss list is in the sheet). The Modes menu is gone (#1697).

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const bay = (key: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`#ship-bays [data-bay="${key}"]`)!;
const sheet = (): HTMLElement => byId('bay-sheet');
const rows = (): string[] => [...sheet().querySelectorAll<HTMLElement>(':scope > button')].map((b) => b.textContent!);
const progress = (beaten: string[]): Record<string, string> => ({ 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten }) });
const press = (key: string): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

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
/** The test shell has no Clamp list, Shift crew or Medal wall bay (test/harness.ts): they are added to the bays of the shell once it is loaded, as the file of the ship has them. */
async function withBays(): Promise<void> {
  const { Cutaway } = await import('./hubcutaway'); // the class of the page just booted
  const sync = Cutaway.prototype.sync;
  const at = (deck: 'furnace' | 'bridge', room: string, x: number, y: number) => ({ deck, room, x, y, box: new THREE.Box3(new THREE.Vector3(x - 0.5, y - 0.4, -0.1), new THREE.Vector3(x + 0.5, y + 0.4, 0.1)) });
  vi.spyOn(Cutaway.prototype, 'sync').mockImplementation(function (this: InstanceType<typeof Cutaway>, ...args) {
    if (this.bays.length && !this.bays.some((b) => b.room === 'ranked')) {
      const logs = this.bays.find((b) => b.deck === 'mess' && b.room === 'logs')!; // the Medal wall stands next to the Mess's Logs bay, as in the file
      this.bays = [...this.bays, at('furnace', 'coop', -1, 5.32), at('bridge', 'ranked', 0.58, 6.7), { ...at('furnace', 'medals', logs.x - 1, logs.y), deck: 'mess' }];
    }
    return sync.apply(this, args);
  });
}
/** The Hub of a player who beat every boss, the ship drawn; `query` may leave the flag out. */
async function open(query = '?bot=off'): Promise<{ game: Game; run: (ms: number) => void }> {
  const game = await boot(query, { storage: progress([...BOSS_IDS]) });
  await withBays();
  game.hook('__startMode', 'hub');
  await game.settle();
  return { game, run: frames(game) };
}
/** Taps a bay and lets the marble roll there, over the lift when the deck is another. */
function visit(run: (ms: number) => void, key: string): void {
  bay(key).click();
  for (let i = 0; i < 6; i++) run(400);
}

describe('the Logs bay and the Medal wall (#1693, part 2)', () => {
  it('the Logs bay of a deck opens a sheet: Read the log opens its entry, All logs the log archive; the Settings rows are gone', async () => {
    const { run } = await open();
    expect(byId('setting-log-archive').hidden).toBe(true);
    expect(byId('setting-ledger').hidden).toBe(true);
    visit(run, 'mess:logs');
    expect(sheet().hidden).toBe(false);
    expect(sheet().getAttribute('aria-label')).toBe('Logs');
    expect(rows()).toEqual(['Read the log', 'All logs']);
    byId('bay-row-1').click();
    expect(sheet().hidden).toBe(true);
    expect(byId('reader').hidden).toBe(false); // the deck's next log in the terminal reader
    const again = await open();
    visit(again.run, 'mess:logs');
    byId('bay-row-2').click();
    expect(sheet().hidden).toBe(true);
    expect(byId('settings-menu').hidden).toBe(false);
    expect(byId('settings-menu').dataset.page).toBe('archive');
  });

  it('the Medal wall opens a sheet: Medal wall reads the medals, Ledger opens the story lines', async () => {
    const { run } = await open();
    visit(run, 'mess:medals');
    expect(sheet().getAttribute('aria-label')).toBe('Medal wall');
    expect(rows()).toEqual(['Medal wall', 'Ledger']);
    byId('bay-row-1').click();
    expect(byId('reader').hidden).toBe(false);
    const again = await open();
    visit(again.run, 'mess:medals');
    byId('bay-row-2').click();
    expect(byId('settings-menu').dataset.page).toBe('archive');
    expect(document.querySelector('#settings-menu .setting-archive')!.classList.contains('ledger')).toBe(true);
  });
});

describe('the Clamp list sheet', () => {
  it('opens on the bay with Ranked and Leaderboard, starts nothing, and stays in the Hub', async () => {
    const { run } = await open();
    expect(sheet().hidden).toBe(true);
    visit(run, 'bridge:ranked');
    expect(document.body.dataset.hub).toMatch(/^bridge /);
    expect(sheet().hidden).toBe(false);
    expect(sheet().getAttribute('aria-label')).toBe('Clamp list');
    expect(rows()).toEqual(['Ranked', 'Leaderboard']);
  });

  it('Ranked starts the ranked game of its row and closes the sheet; Leaderboard opens the board', async () => {
    const { run } = await open();
    const ranked = vi.fn();
    byId('ranked').addEventListener('click', ranked);
    const board = vi.fn();
    byId('leaderboard').addEventListener('click', board);
    visit(run, 'bridge:ranked');
    byId('bay-row-1').click();
    expect(ranked).toHaveBeenCalledOnce();
    expect(sheet().hidden).toBe(true);
    expect(byId('exit').hidden).toBe(false); // the room is the game's: its exit leads back to the Hub
    const again = await open();
    byId('leaderboard').addEventListener('click', board);
    visit(again.run, 'bridge:ranked');
    byId('bay-row-2').click();
    expect(board).toHaveBeenCalledOnce();
    expect(sheet().hidden).toBe(true);
  });

  it('a row of a locked mode does nothing: the source button is disabled', async () => {
    const { run } = await open();
    visit(run, 'bridge:ranked');
    byId('ranked').disabled = true;
    const ranked = vi.fn();
    byId('ranked').addEventListener('click', ranked);
    byId('bay-row-1').click();
    expect(ranked).not.toHaveBeenCalled();
    byId('leaderboard').setAttribute('disabled', '');
    const board = vi.fn();
    byId('leaderboard').addEventListener('click', board);
    byId('bay-row-2').click();
    expect(board).not.toHaveBeenCalled();
    expect(sheet().hidden).toBe(false); // nothing started: the sheet stays
  });
});

describe('the Shift crew sheet', () => {
  it('opens on the bay with its two rows and the boss list', async () => {
    const { run } = await open();
    visit(run, 'furnace:coop');
    expect(sheet().hidden).toBe(false);
    expect(sheet().getAttribute('aria-label')).toBe('Shift crew');
    expect(rows()).toEqual(['Boss with a partner', 'Boss vs a player']);
    expect(byId('coop-list').parentElement).toBe(sheet());
    expect(byId('coop-list').hidden).toBe(true);
  });

  it('each row opens the boss list, the second as a duel list, and a boss opens the room', async () => {
    const { run } = await open();
    visit(run, 'furnace:coop');
    byId('bay-row-1').click();
    expect(byId('coop-list').hidden).toBe(false);
    expect(byId('bay-row-1').getAttribute('aria-expanded')).toBe('true');
    byId('bay-row-2').click();
    expect(byId('coop-list').hidden).toBe(false);
    expect(byId('bay-row-1').getAttribute('aria-expanded')).toBe('false');
    expect(byId('bay-row-2').getAttribute('aria-expanded')).toBe('true');
    byId('bay-row-2').click();
    expect(byId('coop-list').hidden).toBe(true);
    byId('bay-row-1').click();
    byId('coop-list').click(); // its gap, no boss
    expect(sheet().hidden).toBe(false);
    byId('coop-list').querySelector('button')!.click();
    expect(sheet().hidden).toBe(true);
  });
});

describe('closing a sheet', () => {
  it('Escape, another bay and the cog close it', async () => {
    const { game, run } = await open();
    visit(run, 'bridge:ranked');
    press('Escape');
    expect(sheet().hidden).toBe(true);
    visit(run, 'furnace:coop');
    game.openSettings();
    expect(sheet().hidden).toBe(true);
    visit(run, 'furnace:coop');
    bay('mess:bot').click();
    expect(sheet().hidden).toBe(true);
  });

  it('a press outside closes it, a press in it does not', async () => {
    const { run } = await open();
    visit(run, 'bridge:ranked');
    sheet().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet().hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(sheet().hidden).toBe(true);
  });

  it('opening the Goal sheet or leaving the Hub closes it', async () => {
    const { game, run } = await open();
    visit(run, 'bridge:ranked');
    game.hook('__startMode', 'arena');
    await game.settle();
    expect(sheet().hidden).toBe(true);
  });
});

describe('the sheet holds the boss list (#1697)', () => {
  it('moves the boss list of Boss with a partner and Boss vs a player into the sheet, and no menu is left', async () => {
    await open();
    expect(byId('coop-list').parentElement).toBe(sheet());
    expect(document.getElementById('mode-menu')).toBeNull();
  });
});

describe('the room the ship leaves for the dock (#1697)', () => {
  it('is the dock\'s height from the bottom, 6 px over it, when the dock is drawn (a tower\'s bay holds the exit)', async () => {
    const { run } = await open();
    const { Cutaway } = await import('./hubcutaway');
    const rect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.id === 'dock' ? ({ top: 700, height: 60 } as DOMRect) : rect.call(this);
    });
    const sync = vi.spyOn(Cutaway.prototype, 'sync');
    sync.mockClear(); // the spy of withBays is the same one: its calls so far are the opening's
    window.dispatchEvent(new Event('resize'));
    run(400);
    const inset = sync.mock.calls.at(-1)![4] as { bottom: number };
    expect(inset.bottom).toBeGreaterThanOrEqual(innerHeight - 700 + 6);
  });
});
