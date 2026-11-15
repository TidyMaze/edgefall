// Browser Back and the Android Back gesture (#1564, docs/specs/ui.md section "Browser Back"). The page keeps one history entry
// while a screen other than the one it started on is shown. Back pops it, and the page runs the way out that screen already has:
// no routing table of screens, no address per mode.

import type { Exit } from './exitslot';

/** The screen shown: a plain table, the Hub, a mode (a fight, a run, the Trainer, a battle royale, the Open world), or an online room. */
export type Screen = 'table' | 'hub' | 'mode' | 'room';

/** The way out Back takes: the exit of the dock (it leads to the Open world or the Hub), or the Hub, or the table (New game, from the Hub),
 * or `leave` (the browser goes on back) or `stay`. */
export type Way = 'exit' | 'table' | 'leave' | 'stay';

/** Whether the screen shown asks for a history entry of its own: not the base screen, not a room (its address is its entry, and Back there
 * drops the address as it did), and not when the page holds one already. */
export function needsEntry(screen: Screen, base: Screen, holds: boolean): boolean {
  return screen !== base && screen !== 'room' && !holds;
}

/** What Back does once it popped the entry, on the screen it left. `forward` is a landing on an entry of ours (Forward): nothing to leave. */
export function backWay(screen: Screen, base: Screen, exit: Exit, forward: boolean): Way {
  if (forward || screen === 'room') return 'stay';
  if (screen === base) return 'leave'; // the mode's own button took the page back to the base screen: the entry is a stale one
  if (exit) return 'exit'; // the same place as the exit of the dock (#1517)
  return screen === 'hub' ? 'table' : 'leave'; // only the Hub has no exit (#1697)
}
