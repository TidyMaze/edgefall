// The exit of the dock (#1517, docs/specs/ui.md section "One door grammar"): one control in the dock's first slot that leaves the screen
// shown, on every screen but the Hub. Its label names where it leads: the Open world when the player came from it, otherwise the Hub.

/** Where the exit leads, or none: only the Hub at home (and a table a new player has not unlocked the ship for) has no exit. */
export type Exit = 'world' | 'hub' | null;

/** What the page shows. `place` is the Hub or the run of a town or a gate (not a table played from it). `home` is the Hub, or the first table of a
 * new player, where the ship is not open yet: the Hub is where the player starts, so it leads nowhere (#1697: no Modes menu, the exit is the
 * way to the ship from a table, a fight, a run, a room and the Open world). */
export interface Where {
  world: boolean;
  wild: boolean;
  lair: boolean;
  place: boolean;
  home: boolean;
}

/** The short word the dock shows, and the name a screen reader hears. */
export const EXIT_LABEL = { world: 'World', hub: 'Hub' } as const;
export const EXIT_NAME = { world: 'Back to the Open world', hub: 'Back to the hub' } as const;

/** Where the exit of the screen shown leads. Browser Back goes to the same place (backnav.ts). */
export function exitOf(w: Where): Exit {
  if (w.world) return 'hub';
  if (w.wild || w.lair || w.place) return 'world';
  return w.home ? null : 'hub';
}
