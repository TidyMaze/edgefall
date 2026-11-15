// The bay a tower or a gate of the Open world opens the ship on (#1694): the room of the boss (a tower) or the Mining cut (a gate), and the floor cell beside it where the marble stands.
import type { Axial } from './board';
import { deckOf, type Deck } from './deck';
import { neighbours, roomAt, type Spot } from './hub';
import { cellOf } from './hubroll';
import { bossTitle } from './hubview';

export interface BayEntry {
  deck: Deck;
  /** The room's key (hubroll.ts `roomKey`): a boss id, or `run`. */
  room: string;
  /** The room's cell, the one the confirm asks about. */
  cell: Axial;
  /** The floor cell beside it: the spot the marble opens on, one roll from the room. */
  at: Spot;
}

function entry(deck: Deck, room: string): BayEntry {
  const cell = cellOf(deck, room)!;
  return { deck, room, cell, at: { deck, cell: neighbours(cell).find((n) => !roomAt(deck, n))! } };
}

/** The bay of the boss a tower guards, on the boss's deck. */
export const towerBay = (boss: string): BayEntry => entry(deckOf('boss', boss), boss);

/** The bay of the Mining cut, which a gate opens. */
export const gateBay = (): BayEntry => entry('cargo', 'run');

/** What a visit says of where it came from: the exit's label and name, the line under the title, the name of the plate's fold button. `boss` is the tower's boss, null for a gate. */
export function visitCue(boss: string | null): { label: string; exit: string; origin: string; panel: string } {
  if (!boss) return { label: 'Gate', exit: 'Back to the gate', origin: 'You came in by a dungeon gate.', panel: 'HUD panel, from the dungeon gate' };
  const name = bossTitle(boss);
  return { label: 'Tower', exit: `Back to ${name}'s tower`, origin: `You came in by ${name}'s tower.`, panel: `HUD panel, from ${name}'s tower` };
}
