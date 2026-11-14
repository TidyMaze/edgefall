// Reset everything (#1684): Settings erases every `ab-alone.*` key of localStorage and the saved games' database, then the page reloads as a new
// player's (guided first match, lock on). Only the game's own names are touched. The game uses no sessionStorage key but the reload guard.

const PREFIX = 'ab-alone.';
const DB_NAME = 'ab-alone'; // idb.ts

/** The question of the in-game confirm step. */
export const RESET_ASK = 'Erase all progress and settings? This cannot be undone.';

/** Removes every key that starts with `ab-alone.`, leaves the others, and returns how many went. */
export function eraseKeys(store: Storage | null): number {
  if (!store) return 0;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) if (store.key(i)!.startsWith(PREFIX)) keys.push(store.key(i)!);
  keys.forEach((key) => store.removeItem(key));
  return keys.length;
}

/** Erases the keys and the saved games (the caller stops its timers first), and settles when the database is gone, blocked or failed (the reload follows either way). */
export function eraseAll(store: Storage | null, idb: Pick<IDBFactory, 'deleteDatabase'> | undefined): Promise<void> {
  eraseKeys(store);
  return new Promise<void>((resolve) => {
    try {
      const req = idb!.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve(); // no IndexedDB
    }
  }).then(() => void eraseKeys(store)); // a save that landed while the database went is swept too
}
