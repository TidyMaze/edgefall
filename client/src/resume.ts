// A reload for a new version keeps the player's place (#1717): just before it, the page notes the boss fight in progress (its moves) or
// the Open world it is in, in the tab's session store; the next start takes the note once and puts the player back. A local game, a run
// and the world's own save come back by their own saves already; this note only says where the player was.
import { read, write, type Store } from './quality';

export type ResumeNote = { kind: 'fight'; id: string; seed: number; mirror: boolean; moves: number[][] } | { kind: 'world'; seed: number };

const KEY = 'ab-alone.update-resume';

/** Notes where the player is, for the start after the reload; nothing when there is no note to keep. */
export function keepForReload(store: Store, note: ResumeNote | null): void {
  if (note) write(store, KEY, JSON.stringify(note));
}

const isMoves = (moves: unknown): moves is number[][] =>
  Array.isArray(moves) && moves.every((move) => Array.isArray(move) && move.every((n) => Number.isInteger(n)));

/** The note left before the reload, once: it is cleared as it is read. A note that does not parse is none. */
export function takeResume(store: Store): ResumeNote | null {
  const raw = read(store, KEY);
  if (!raw) return null;
  write(store, KEY, '');
  try {
    const note = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (note.kind === 'world' && Number.isInteger(note.seed)) return { kind: 'world', seed: note.seed as number };
    if (note.kind === 'fight' && typeof note.id === 'string' && Number.isInteger(note.seed) && typeof note.mirror === 'boolean' && isMoves(note.moves))
      return { kind: 'fight', id: note.id, seed: note.seed as number, mirror: note.mirror, moves: note.moves };
  } catch {
    // a broken note is no note
  }
  return null;
}

/** The tab's session store, which a reload keeps; none when the browser blocks it (the reload then starts afresh). */
export function tabStore(): Store {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** What the page is in when a new version is ready. */
export interface Place {
  fight: { id: string; seed: number; mirror: boolean; daily: boolean } | null;
  moves: number[][];
  world: number | null; // the seed of the Open world the player is in
  lair: boolean; // a fight of a tower or a wild marble of the world: it goes back to the world, not to the fight
  lost: boolean; // an online room, ranked, a royale or a Trainer run: a reload leaves it
}

/** The page before its start ends: nothing to note. */
export const NOWHERE: Place = { fight: null, moves: [], world: null, lair: false, lost: false };

/** The page's state, as main.ts holds it. `others`: the online room, ranked, the royale, the Trainer run, each null when off. */
export interface Raw {
  fight: { id: string; seed: number; daily?: unknown; mirror?: boolean } | null;
  history: readonly number[][];
  worldActive: boolean;
  worldSeed: number;
  lair: { seed: number } | null;
  wild: { seed: number } | null;
  others: readonly unknown[];
}

/** Where the player is: a tower's or a wild marble's fight belongs to its world. */
export const placeOf = (raw: Raw): Place => ({
  fight: raw.fight ? { id: raw.fight.id, seed: raw.fight.seed, mirror: raw.fight.mirror === true, daily: raw.fight.daily !== undefined } : null,
  moves: raw.history.map((move) => [...move]),
  world: raw.worldActive ? raw.worldSeed : (raw.lair?.seed ?? raw.wild?.seed ?? null),
  lair: raw.lair !== null || raw.wild !== null,
  lost: raw.others.some((other) => other !== null),
});

/** The fight to start again after the reload, replayed to its last move by `replay`: none for no note, an unknown boss or moves that do not replay. */
export function fightToResume<E>(note: ResumeNote | null, bosses: readonly string[], replay: (id: string, seed: number, mirror: boolean, moves: number[][]) => E | null): { id: string; seed: number; mirror: boolean; moves: number[][]; engine: E } | null {
  if (note?.kind !== 'fight' || !bosses.includes(note.id)) return null;
  const engine = replay(note.id, note.seed, note.mirror, note.moves);
  return engine ? { id: note.id, seed: note.seed, mirror: note.mirror, moves: note.moves, engine } : null;
}

/** The world to enter again after the reload, or null. */
export const worldToResume = (note: ResumeNote | null): number | null => (note?.kind === 'world' ? note.seed : null);

/** The note for the reload: a boss fight with its moves (not the daily, whose attempt is counted), else the Open world; else none. */
export function noteFor(place: Place): ResumeNote | null {
  if (place.lost) return null;
  if (place.fight && !place.fight.daily && !place.lair) return { kind: 'fight', id: place.fight.id, seed: place.fight.seed, mirror: place.fight.mirror, moves: place.moves };
  if (place.world !== null) return { kind: 'world', seed: place.world };
  return null;
}

/** Whether the banner must say a reload leaves the game in progress: what no note and no save brings back. */
export const leavesGame = (place: Place): boolean => place.lost || (place.fight !== null && (place.fight.daily || place.lair));

/** The banner's line (#1717). */
export const bannerText = (leaves: boolean): string => (leaves ? 'New version ready. Reloading now leaves this game.' : 'New version ready. Reloading keeps where you are.');
