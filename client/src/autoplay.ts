// Auto-play (#792, docs/specs/ui.md section 4.3): a toggle in the fight HUD lets the bot play the player's side. This is
// the rule of when the toggle is shown and when it is greyed; main.ts holds the loop.

/** The pause before each auto-played move, so the player can follow the game and stop it. */
export const AUTO_DELAY_MS = 700;

export interface AutoMode {
  /** A versus room, a co-op fight or an online battle royale: never auto-played. */
  online: boolean;
  /** The name of the boss when the fight is a boss fight, null otherwise. */
  boss: string | null;
  /** The Trainer (#1159): the score is the player's own, never auto-played. */
  trainer?: boolean;
  /** A rogue-lite run (#1675): Auto-play and leaving cost the run, said before they are used. */
  run?: boolean;
}

/** The line under Auto-play in a run (#1675): what Auto-play and leaving cost, said before they happen. */
export const RUN_AUTO_WARNING = 'Auto-play marks the run and the Daily does not rank it. A draw loses the run, and so does leaving for the Hub or another mode.';

/** Not shown, or shown with `reason` when it is greyed. */
export type AutoState = { shown: false } | { shown: true; reason: string | null; warn?: string };

/** The state of the toggle: hidden online, greyed in the Trainer and against a boss whose medal (#791) the player has
 * not earned yet. */
export function autoPlayState(mode: AutoMode, medal: boolean): AutoState {
  if (mode.online) return { shown: false };
  if (mode.trainer) return { shown: true, reason: 'Not in the Trainer' };
  if (mode.boss !== null && !medal) return { shown: true, reason: `Beat ${mode.boss} once to unlock Auto-play against it` };
  if (mode.run) return { shown: true, reason: null, warn: RUN_AUTO_WARNING };
  return { shown: true, reason: null };
}
