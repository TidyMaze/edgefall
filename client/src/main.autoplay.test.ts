// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DELAY_MS } from './autoplay';
import { boot, type Game, startBoss } from './test/harness';

// Auto-play on the harness (#792): the toggle of the fight HUD, the bot playing the player's side after a short delay
// in a bot game, at the hot-seat table, in a boss fight with its medal and in the offline battle royale.

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const auto = (): HTMLButtonElement => byId('auto-play');
const plies = (game: Game): number => game.hook<number>('__plies');
const timers = (): void => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
afterEach(() => vi.useRealTimers());

/** One auto-played move: its delay, the bot's search, then the slide of the move. */
async function move(game: Game): Promise<void> {
  await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS);
  game.frame(1000);
  await vi.advanceTimersByTimeAsync(0);
}
function fightBoss(game: Game, name: string): void {
  startBoss(name);
}
const medal = (id: string): void => localStorage.setItem('ab-alone.medals', JSON.stringify({ [id]: 7 }));

describe('main.ts, auto-play, #792', () => {
  it('plays the human side of a bot game, one move per delay, and the bot answers each', async () => {
    const game = await boot('?nodes=50');
    expect(auto().hidden).toBe(false);
    expect(auto().disabled).toBe(false);
    expect(auto().getAttribute('aria-pressed')).toBe('false');
    timers();
    auto().click();
    expect(auto().getAttribute('aria-pressed')).toBe('true');
    expect(plies(game)).toBe(0);
    await move(game); // the human side
    expect(plies(game)).toBe(1);
    await move(game); // the bot's reply comes at once, the next auto-played move waits for its delay
    await move(game);
    expect(plies(game)).toBeGreaterThanOrEqual(3);
  });

  it('stops at once: a move being searched is dropped, the board answers clicks again', async () => {
    const game = await boot('?nodes=50');
    timers();
    auto().click();
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS / 2);
    auto().click(); // off while the move is awaited
    expect(auto().getAttribute('aria-pressed')).toBe('false');
    await move(game);
    expect(plies(game)).toBe(0);
    await move(game);
    expect(plies(game)).toBe(0);
    expect(byId('hint').disabled).toBe(false); // the bot no longer thinks
  });

  it('reports the bot busy while its move is searched, and idle once the move is dropped (#1624)', async () => {
    const game = await boot('?nodes=50');
    const busy = (): boolean => game.hook<boolean>('__botBusy');
    expect(busy()).toBe(false);
    timers();
    auto().click();
    expect(busy()).toBe(true);
    auto().click(); // off while the move is searched: it is dropped
    await move(game);
    expect(busy()).toBe(false);
  });

  it('starts again after a stop', async () => {
    const game = await boot('?nodes=50');
    timers();
    auto().click();
    auto().click();
    auto().click(); // the first request is still pending: the second toggle waits for it
    await move(game);
    expect(plies(game)).toBe(1);
  });

  it('plays both sides of the hot-seat table, either side', async () => {
    const game = await boot('?nodes=50', { deck: true });
    byId('ship').click();
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: [] }));
    byId('ship').click();
    game.click(-1, -1); // hot-seat
    timers();
    auto().click();
    await move(game);
    await move(game);
    expect(plies(game)).toBe(2); // Black, then White
  });

  it('is off when the game is over or replaced, and never shown online', async () => {
    const game = await boot('?nodes=50');
    auto().click();
    byId('new-game').click();
    byId('new-game').click(); // confirmed: a new game
    expect(auto().getAttribute('aria-pressed')).toBe('false');
    expect(game.hud()).not.toBe('');
    byId('play-online').click();
    await game.online();
    expect(auto().hidden).toBe(true);
  });

  it('is hidden in the hub, and with ?bot=off: no bot to play', async () => {
    const game = await boot('?nodes=50');
    byId('ship').click();
    expect(auto().hidden).toBe(true);
    await boot('?bot=off');
    expect(auto().hidden).toBe(true);
  });

  it('is greyed with the reason against a boss without its medal, and plays the player once the medal is earned', async () => {
    const game = await boot('?nodes=50');
    fightBoss(game, 'The Echo');
    expect(auto().hidden).toBe(false);
    expect(auto().disabled).toBe(true);
    expect(byId('auto-reason').hidden).toBe(false);
    expect(byId('auto-reason').textContent).toBe('Beat The Echo once to unlock Auto-play against it');
    medal('echo');
    fightBoss(game, 'The Echo');
    expect(auto().disabled).toBe(false);
    expect(byId('auto-reason').hidden).toBe(true);
    timers();
    auto().click();
    await move(game); // the player's move
    await move(game); // the boss's reply
    expect(plies(game)).toBe(2);
  });

  it('plays the player rounds of the offline battle royale', async () => {
    const game = await boot('?nodes=50');
    byId('battle-royale').click();
    expect(auto().disabled).toBe(false);
    const round = (): string => game.turn();
    const before = round();
    timers();
    auto().click();
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS);
    const first = round();
    expect(first).not.toBe(before);
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS); // the reveal of the round is still on: no new order over it
    expect(round()).toBe(first);
    game.frame(100_000); // its end
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS);
    expect(round()).not.toBe(first);
    auto().click(); // off
    const after = round();
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS * 3);
    expect(round()).toBe(after);
  });
});
