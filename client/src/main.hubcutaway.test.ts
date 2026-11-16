// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot, type Game } from './test/harness';

// The Hub, the only one (#1697), is a 2D menu since #1729: one titled group of tiles per deck, no 3D ship. The tiles themselves are tested in hubbays.test.ts; here the wiring of the page.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
function ship(game: Game): void {
  byId('ship').click();
}
const cutawayFiles = (game: Game): string[] => game.models().filter((m) => m.startsWith('hub-cutaway'));
const tile = (key: string): HTMLElement | null => document.querySelector<HTMLElement>(`#ship-bays [data-bay="${key}"]`);

describe('the 2D Hub on the page (#1729)', () => {
  it('is a menu of the decks in the Hub only, with no ship file asked for', async () => {
    const game = await boot('?bot=off');
    expect(byId('ship-bays').hidden).toBe(true);
    ship(game);
    await game.settle();
    expect(document.body.dataset.hubCutaway).toBe('true');
    expect(byId('ship-bays').hidden).toBe(false);
    expect([...document.querySelectorAll<HTMLElement>('#ship-bays section.hub-deck')].map((d) => d.dataset.deck)).toEqual(['mess', 'cargo', 'furnace', 'chapel', 'bridge']);
    expect(cutawayFiles(game)).toEqual([]); // no 3D ship
  });

  it('says through window.__shipDrawn whether the Hub menu is shown: not outside the Hub', async () => {
    const game = await boot('?bot=off');
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(false);
    ship(game);
    await game.settle();
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(true);
    game.hook('__startMode', 'arena');
    await game.settle();
    expect((window as unknown as { __shipDrawn: boolean }).__shipDrawn).toBe(false);
    expect(document.body.dataset.hubCutaway).toBe('false');
  });

  it('marks the House table for a new player and the next boss once the first win is in', async () => {
    const fresh = await boot('?bot=off&newplayer');
    fresh.hook('__startMode', 'hub'); // the Ship entry of the menu is locked for a new player
    await fresh.settle();
    expect(tile('mess:bot')!.dataset.state).not.toBe('dark');
    expect(tile('mess:echo')!.dataset.state).toBe('locked'); // the first win awaited (#1692)
    const game = await boot('?bot=off');
    ship(game);
    await game.settle();
    expect(tile('mess:echo')!.dataset.state).toBe('goal');
    expect(document.querySelector('#ship-bays [data-deck="cargo"] .hub-locked')).not.toBeNull();
  });

  it('opens the room at a tap on its tile, and a shut deck takes none', async () => {
    const game = await boot('?bot=off');
    ship(game);
    await game.settle();
    tile('mess:bot')!.click(); // the House table: a game against the bot, at once
    await game.settle();
    expect(document.body.dataset.hubCutaway).toBe('false');
  });
});
