import { describe, expect, it } from 'vitest';
import { DECK_NAMES, deckOf } from './deck';
import { neighbours, roomAt } from './hub';
import { gateBay, towerBay, visitCue } from './hubentry';
import { cellOf } from './hubroll';
import { BOSS_IDS } from './tally';

// The bay a tower or a gate of the Open world opens the ship on (#1694): the boss's room, or the Mining cut of Cargo, and the floor cell beside it the marble stands on.

describe('towerBay', () => {
  it.each(BOSS_IDS)('%s: the room of its boss on its deck, a floor cell beside it', (id) => {
    const bay = towerBay(id);
    expect(bay.deck).toBe(deckOf('boss', id));
    expect(DECK_NAMES).toContain(bay.deck);
    expect(bay.room).toBe(id);
    expect(bay.cell).toEqual(cellOf(bay.deck, id));
    expect(roomAt(bay.deck, bay.at.cell)).toBeUndefined();
    expect(neighbours(bay.cell).some((n) => n[0] === bay.at.cell[0] && n[1] === bay.at.cell[1])).toBe(true);
    expect(bay.at.deck).toBe(bay.deck);
  });
});

describe('gateBay', () => {
  it('is the Mining cut of Cargo', () => {
    const bay = gateBay();
    expect([bay.deck, bay.room]).toEqual(['cargo', 'run']);
    expect(roomAt('cargo', bay.cell)).toEqual({ kind: 'run' });
    expect(roomAt('cargo', bay.at.cell)).toBeUndefined();
  });
});
