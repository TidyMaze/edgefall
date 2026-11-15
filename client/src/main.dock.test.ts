// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { boot, type Game, startBoss } from './test/harness';

// The thumb dock on the harness (#1032, docs/specs/thumb-dock.md): the Goal sheet opens above the dock, Game modes and
// Settings are one sheet at a time, Esc and a tap outside close the Goal sheet, and Copy diagnostics is the last row of
// the settings list.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Starts the first boss of the Boss fight list: the Goal control shows in the dock from the start of the fight. */
function startFight(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(1);
    return a;
  });
  startBoss('The Echo');
}

/** Moves the first move of the fight, so the Goal control is no longer greyed out (it is the goal before the first move). */
function playFirstMove(game: Game): void {
  const legal = game.hook<{ cells: [number, number][]; dir: number }[]>('__legal');
  const mv = legal.find((m) => m.cells.length === 1)!;
  const [q, r] = mv.cells[0]!;
  game.click(q, r);
  const target = game.hook<{ cell: [number, number]; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
  game.click(...target.cell);
  expect(game.hook('__plies')).toBe(1);
}

describe('the thumb dock', () => {
  it('the Goal sheet shows the goal above the dock, and a second press closes it', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    const goal = byId('boss-goal');
    expect(goal.getAttribute('aria-expanded')).toBe('false');
    expect(byId('goal-sheet').hidden).toBe(true);
    goal.click();
    expect(byId('goal-sheet').hidden).toBe(false);
    expect(byId('goal-sheet').textContent).not.toBe('');
    expect(goal.getAttribute('aria-expanded')).toBe('true');
    goal.click();
    expect(byId('goal-sheet').hidden).toBe(true);
  });

  it('Esc closes the Goal sheet and gives the focus back to Goal', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    byId('boss-goal').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(byId('goal-sheet').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('boss-goal'));
  });

  it('Esc with no Goal sheet open leaves the focus where it is', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    byId('view-reset').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(byId('view-reset'));
  });

  it('a tap outside the Goal sheet and its button closes it, a tap inside keeps it open', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    byId('boss-goal').click();
    byId('goal-sheet').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('goal-sheet').hidden).toBe(false);
    byId('boss-goal').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('goal-sheet').hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('goal-sheet').hidden).toBe(true);
  });

  it('a press whose target is not a node (the window) counts as outside, and throws nothing (CI, #1032)', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    byId('boss-goal').click();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(byId('goal-sheet').hidden).toBe(true);
    game.openSettings();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(byId('settings-menu').hidden).toBe(true);
    window.dispatchEvent(new PointerEvent('pointerdown'));
  });

  it('a tap outside does nothing while no Goal sheet is open', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('goal-sheet').hidden).toBe(true);
  });

  it('one sheet at a time: Settings closes the Goal sheet, and Goal closes Settings', async () => {
    const game = await boot('?bot=off');
    startFight(game);
    playFirstMove(game);
    byId('boss-goal').click();
    expect(byId('goal-sheet').hidden).toBe(false);
    game.openSettings();
    expect(byId('goal-sheet').hidden).toBe(true);
    expect(byId('settings-menu').hidden).toBe(false);
    byId('boss-goal').click();
    expect(byId('settings-menu').hidden).toBe(true);
    expect(byId('goal-sheet').hidden).toBe(false);
  });

  it('Copy diagnostics is the last row of the settings list, with its label', async () => {
    const game = await boot('?bot=off');
    game.openSettings();
    const menu = byId('settings-menu');
    const copy = byId('copy-diagnostics');
    expect(copy.parentElement).toBe(menu.querySelector('details.setting-section')); // the Advanced group, the last of the menu (#1566)
    expect(menu.querySelector('details:last-of-type')!.lastElementChild).toBe(copy);
    expect(copy.getAttribute('aria-label')).toBe('Copy diagnostics');
    expect(copy.querySelector('span')!.textContent).toBe('Copy diagnostics');
  });
});

// The lobby sheet (#1044, docs/specs/thumb-dock.md section 1): the lobby controls sit in a sheet above the dock, the Lobby
// control toggles it, it opens by itself while a lobby waits, and Hold stays in the dock.
describe('the lobby sheet (#1044)', () => {
  /** Starts an offline battle royale: Invite shows in the lobby sheet. */
  function battleRoyale(game: Game): void {
    byId('battle-royale').click();
  }

  /** Presses Invite and waits until the page is the creator of the room. */
  async function invite(game: Game): Promise<void> {
    byId('royale-invite').click();
    for (let i = 0; i < 200 && document.body.dataset.seat !== 'player'; i++) await game.settle();
  }

  it('the battle royale dock holds Hold and Lobby, the lobby controls sit in the sheet and not in the top column', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    expect(byId('dock').contains(byId('royale-hold'))).toBe(true);
    expect(byId('dock').contains(byId('lobby'))).toBe(true);
    expect(byId('lobby-sheet').contains(byId('royale-invite'))).toBe(true);
    expect(byId('online').contains(byId('royale-invite'))).toBe(false);
    expect(byId('lobby').hidden).toBe(false); // Invite shows offline
    expect(byId('lobby-sheet').hidden).toBe(true); // closed, and not opened by itself offline
  });

  it('the Lobby control toggles the lobby sheet, and aria-expanded follows', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    byId('lobby').click();
    expect(byId('lobby-sheet').hidden).toBe(false);
    expect(byId('lobby').getAttribute('aria-expanded')).toBe('true');
    byId('lobby').click();
    expect(byId('lobby-sheet').hidden).toBe(true);
    expect(byId('lobby').getAttribute('aria-expanded')).toBe('false');
  });

  it('the Lobby control does nothing with no lobby control to show', async () => {
    await boot('?bot=off');
    byId('lobby').click();
    expect(byId('lobby-sheet').hidden).toBe(true);
    expect(byId('lobby').hidden).toBe(true);
  });

  it('Esc closes the lobby sheet and gives the focus back to Lobby', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    byId('lobby').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(byId('lobby-sheet').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('lobby'));
  });

  it('a tap outside the lobby sheet and its button closes it, a tap inside keeps it open', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    byId('lobby').click();
    byId('lobby-sheet').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('lobby-sheet').hidden).toBe(false);
    byId('lobby').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('lobby-sheet').hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('lobby-sheet').hidden).toBe(true);
  });

  it('a press whose target is not a node (the window) counts as outside, and throws nothing', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    byId('lobby').click();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(byId('lobby-sheet').hidden).toBe(true);
    expect(game).toBeTruthy();
  });

  it('one sheet at a time: Settings closes the lobby sheet', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    byId('lobby').click();
    expect(byId('lobby-sheet').hidden).toBe(false);
    game.openSettings();
    expect(byId('lobby-sheet').hidden).toBe(true);
    expect(byId('settings-menu').hidden).toBe(false);
  });

  it('while a lobby waits, the Lobby control carries a steady accent, and the sheet never opens by itself', async () => {
    const game = await boot('?bot=off');
    battleRoyale(game);
    await invite(game);
    expect(byId('royale-start').hidden).toBe(false); // the creator waits: Start is in the sheet
    expect(byId('lobby').dataset.waiting).toBe('true');
    expect(byId('lobby-sheet').hidden).toBe(true); // the board stays clear: the player taps Lobby
    byId('lobby').click();
    expect(byId('lobby-sheet').hidden).toBe(false);
    expect(byId('royale-start').hidden).toBe(false);
  });

  it('an online 1v1 shows the invite link in the open lobby sheet at once, and a tap outside keeps it open (bug)', async () => {
    const game = await boot('?bot=off');
    byId('play-online').click();
    for (let i = 0; i < 200 && document.body.dataset.seat !== 'player'; i++) await game.settle();
    expect(byId('lobby-sheet').hidden).toBe(false);
    expect(byId('lobby').getAttribute('aria-expanded')).toBe('true');
    expect(byId('lobby-sheet').contains(byId('invite'))).toBe(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(byId('lobby-sheet').hidden).toBe(false);
  });
});
