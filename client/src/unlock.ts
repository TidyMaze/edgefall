// The first-win lock (#1665, docs/specs/ui.md section 4.10): a new player first plays a normal game against the bot, and the Open world, the
// bosses, the runs and the other modes unlock after the first win. Pure data and functions: main.ts gives the storage, paints the menu and
// shows the card. The MCP has no browser profile and is not touched (mcp.md).
import { read, write, type Store } from './quality';

const FIRST_WIN_KEY = 'ab-alone.firstwin';

export const firstWon = (store: Store): boolean => read(store, FIRST_WIN_KEY) === '1';
export const markFirstWin = (store: Store): void => write(store, FIRST_WIN_KEY, '1');

/** The settings keys, and the guide's: a profile that holds only these never played (Settings opens on a new player's menu). Every other `ab-alone.*` key is a record of play. */
const SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'ab-alone.difficulty', 'ab-alone.palette', 'ab-alone.sound', 'ab-alone.theme', 'ab-alone.reduced-motion', 'ab-alone.tier', 'ab-alone.quality',
  'ab-alone.clear-board', 'ab-alone.fps', 'ab-alone.shell-skin', 'ab-alone.glass-skin', 'ab-alone.safe-mode', 'ab-alone.ui-scale', 'ab-alone.flat-hud',
  'ab-alone.hud-folded', 'ab-alone.board-zoom', 'ab-alone.steering', 'ab-alone.look', 'ab-alone.transcript',
  'ab-alone.guide', // reading the guide is not play: a careful new player still needs the win (#1665)
]);
const SETTINGS_PREFIXES = ['ab-alone.volume.', 'ab-alone.light.']; // the mixer and the lights

/** The records of play, for a store that cannot list its keys. */
const RECORDS = [
  'ab-alone.firstrun', 'ab-alone.daily', 'ab-alone.daily-days', 'ab-alone.ranked', 'ab-alone.roguelite', 'ab-alone.roguelite.ascension', 'ab-alone.roguelite.runes',
  'ab-alone.boss-tally', 'ab-alone.story', 'ab-alone.roguelite.history', 'ab-alone.roguelite.daily', 'ab-alone.roguelite.seen',
  'ab-alone.ranked.board', 'ab-alone.ranked.rivals', 'ab-alone.world-key', 'ab-alone.world-events', 'ab-alone.board-name', 'ab-alone.public-name',
];

const playKey = (key: string): boolean => key.startsWith('ab-alone.') && !SETTINGS_KEYS.has(key) && !SETTINGS_PREFIXES.some((prefix) => key.startsWith(prefix));

/** Whether the store holds a record of play: any `ab-alone.*` key but the settings, when the store lists its keys (localStorage does), else the known records. */
function playedBefore(store: Store): boolean {
  const list = store as Partial<Pick<Storage, 'length' | 'key'>> | null;
  if (list && typeof list.length === 'number' && typeof list.key === 'function') {
    for (let i = 0; i < list.length; i++) if (playKey(list.key(i)!) && read(store, list.key(i)!)) return true; // an empty value is a cleared mark (ab-alone.wild at every boot), not a record
    return false;
  }
  return RECORDS.some((key) => read(store, key) !== null);
}

/** Whether the profile played before the lock existed, or already won: nobody loses access. `saved`: a saved local game, run or Open world; `beaten`: bosses beaten. */
export const existingPlayer = (store: Store, saved: boolean, beaten: number): boolean => firstWon(store) || beaten > 0 || saved || playedBefore(store);

/** Whether the lock is on: a profile that is not an existing player, unless `?unlock`. An automated page (every e2e spec) is open, unless `?newplayer` asks for a new player's menu. */
export function isLocked(search: string, automated: boolean, existing: boolean): boolean {
  const query = new URLSearchParams(search);
  if (existing || query.has('unlock')) return false;
  return !automated || query.has('newplayer');
}

/** The starter buttons that wait for the first win (#1697, no menu): a press on one of them, whatever calls it (a bay, the pad's Enter, `.click()` as `?openworld=` does), starts nothing. Settings, the guide, New game, Play online and an invite link never wait. */
const LOCKED_STARTERS: readonly string[] = ['openworld', 'daily', 'roguelite', 'battle-royale', 'ranked', 'leaderboard', 'fight-together', 'boss-duel', 'ship', 'trainer'];

/** Marks (or clears) `data-locked` on the starters of `root` that wait for the first win: a press on one starts nothing (main.ts guards the page). The mark lives in the page, so a page that is gone leaves no guard behind. */
export function markStarters(root: ParentNode, locked: boolean): void {
  for (const id of LOCKED_STARTERS) {
    const entry = root.querySelector<HTMLElement>(`#${id}`)!;
    if (locked) entry.dataset.locked = LOCK_LINE;
    else delete entry.dataset.locked;
  }
}
export const LOCK_LINE = 'Win your first game to unlock';
export const LOCK_BANNER = 'Win your first game vs the bot'; // the Hub's goal while locked

/** The Hub's rooms that wait for the first win: the bosses and every mode room, but the tables, the online desk, the terminals and the lifts. */
const LOCKED_DOORS: ReadonlySet<string> = new Set(['boss', 'daily', 'run', 'together', 'ranked', 'world', 'trainer', 'royale']);
export const doorLocked = (kind: string): boolean => LOCKED_DOORS.has(kind);

/** What a finished game is, for the first win. */
export interface GameKind {
  bot: boolean;
  fight: boolean;
  run: boolean;
  trainer: boolean;
  online: boolean;
  wild: boolean;
  replaying: boolean;
  undone?: boolean; // the game had an Undo (#1672)
}

/** Whether a game over counts as the first win: the player beat the bot in a standard game (`anim` is the end banner's: a loss or a draw unlocks nothing),
 * not a boss, a run, the Trainer, an online room, a wild fight or a replay. */
export const firstWinGame = (anim: string | undefined, game: GameKind): boolean =>
  anim === 'win' && game.bot && !game.fight && !game.run && !game.trainer && !game.online && !game.wild && !game.replaying && !game.undone;

/** The card of the first win. */
export const UNLOCK_CARD = { title: 'You won.', text: 'Unlocked: Open world, Bosses, Runs, Daily, Royale, Ranked, Leaderboard', world: 'Open world', hub: 'Hub', dismiss: 'Dismiss' } as const;

/** The card of the first win on the Hub Cutaway (#1692): the Mess is lit, and the next boss is the goal (`next`, null when none is left). */
export const SHIP_UNLOCK_TEXT = (next: string | null): string => (next ? `The Mess is open. Next: beat ${next}.` : 'The Mess is open.');
/** Tally's line when a tap on a bay that waits for the first win starts nothing (#1692). */
export const LOCKED_BAY_LINE = 'Locked until your first win. Beat the bot at the House table.';
