// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { boot, type Game } from './test/harness';

// The Hub Cutaway (#1689): behind `?hub=cutaway`, off by default. With the flag off its files are never asked for and the deck is as it was.
// The ship itself (bake, states, shells) is tested in hubcutaway.test.ts; here the wiring of the page: the flag, the shell asked for, the camera and the plates.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
function ship(game: Game): void {
  byId('ship').click();
}
/** The Cutaway class of the page just booted (the harness resets the modules at each boot). */
const cutawayClass = async (): Promise<typeof import('./hubcutaway').Cutaway> => (await import('./hubcutaway')).Cutaway;
const cutawayFiles = (game: Game): string[] => game.models().filter((m) => m.startsWith('hub-cutaway'));

describe('the Hub Cutaway on the page (#1689)', () => {
  it('asks for no cutaway file and leaves the deck as it is while the flag is off, also under ?look=cutaway', async () => {
    for (const query of ['?bot=off', '?bot=off&look=cutaway']) {
      const game = await boot(query);
      ship(game);
      await game.settle();
      expect(cutawayFiles(game)).toEqual([]);
      expect(document.body.dataset.hubCutaway).toBeUndefined();
      expect(document.body.dataset.hub).toBe('mess 0,0');
    }
  });

  it('is the default page (#1696): no query draws the ship, ?hub=classic keeps the deck', async () => {
    const on = await boot('?bot=off', { defaultHub: true });
    ship(on);
    await on.settle();
    expect(cutawayFiles(on).length).toBeGreaterThan(0);
    const off = await boot('?bot=off&hub=classic', { defaultHub: true });
    ship(off);
    await off.settle();
    expect(cutawayFiles(off)).toEqual([]);
  });

  it('asks for the shell of the window with the flag on, one at a time, and draws the ship in the Hub only', async () => {
    const game = await boot('?bot=off&hub=cutaway');
    const sync = vi.spyOn((await cutawayClass()).prototype, 'sync');
    expect(cutawayFiles(game)).toEqual([]); // not in the Hub yet: nothing asked for
    ship(game);
    await game.settle();
    expect(cutawayFiles(game)).toEqual(['hub-cutaway-wide.glb']); // jsdom's window is 1024 x 768
    expect(sync.mock.calls.at(-1)![0]).toBe(true);
    sync.mockRestore();
  });

  it('frames the whole ship while it is drawn, hides the plates, and gives the deck back when it goes', async () => {
    const game = await boot('?bot=off&hub=cutaway&newplayer');
    const sync = vi.spyOn((await cutawayClass()).prototype, 'sync').mockReturnValue(true);
    game.hook('__startMode', 'hub'); // the Ship entry of the menu is locked for a new player
    await game.settle();
    expect(document.body.dataset.hubCutaway).toBe('true');
    const state = sync.mock.calls.at(-1)![3];
    expect(state.waiting).toBe(true); // a new player: the first win awaited
    expect(state.goal).toBe('bot'); // the House table (#1692)
    expect([...state.open]).toEqual(['mess']);
    sync.mockReturnValue(false);
    dispatchEvent(new Event('resize'));
    expect(document.body.dataset.hubCutaway).toBe('false');
    sync.mockRestore();
  });

  it('says through window.__shipDrawn whether the ship is in the scene: not with the flag off, not outside the Hub', async () => {
    await boot('?bot=off');
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(false);
    const game = await boot('?bot=off&hub=cutaway');
    ship(game);
    await game.settle();
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(true);
    game.hook('__startMode', 'arena');
    await game.settle();
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(false);
  });

  it('points the ship at the next goal once the first win is not awaited', async () => {
    const game = await boot('?bot=off&hub=cutaway');
    const sync = vi.spyOn((await cutawayClass()).prototype, 'sync').mockReturnValue(false);
    ship(game);
    await game.settle();
    expect(sync.mock.calls.at(-1)![3]).toMatchObject({ waiting: false, goal: 'echo' });
    sync.mockRestore();
  });
});
