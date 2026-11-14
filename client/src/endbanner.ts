// End-of-game banner (#282): from the result, the draw reason, the mode and the viewer's side to the
// banner texts and the animation id the page puts in `body[data-over]`. Pure, so every combination is
// unit tested. Texts are short, in TALLY's accounting tone (world.md section 2).
import { sideName } from './glass';

export type EndMode = 'local' | 'bot' | 'boss' | 'online';
export type EndAnim = 'win' | 'loss' | 'draw';

export interface EndInput {
  status: number; // 0 running, 1 Black wins, 2 White wins, 3 draw
  reason: number; // draw reason: 1 threefold repetition, 2 anti-stalling, 3 neither side can move (engine draw_reason)
  mode: EndMode;
  side: number; // the viewer's side: 1 Black, 2 White, 0 both or none (hot-seat, spectator)
  glass: number; // the side wearing the pale glass, named White (sideName)
}

export interface EndBanner {
  title: string;
  line: string; // the reason
  anim: EndAnim;
}

export function endBanner({ status, reason, mode, side, glass }: EndInput): EndBanner | null {
  if (status === 0) return null;
  const boss = mode === 'boss';
  if (status === 3) {
    // The plate may not grow over the board (phone-layout e2e): the boss line fits one line of the plate.
    const [lost, what] =
      reason === 2
        ? ['100 plies idle: a defeat.', '100 plies without an ejection. Tally calls it even.']
        : reason === 3
          ? ['No move left: a defeat.', 'Neither side can move. Tally calls it even.']
          : ['Repeated 3 times: a defeat.', 'Same position three times. Tally closes the page.'];
    if (boss) return { title: 'Defeat', line: lost, anim: 'loss' };
    return { title: 'Draw', line: what, anim: 'draw' };
  }
  if (side === 0) return { title: `${sideName(status, glass)} wins`, line: 'The books balance.', anim: 'win' };
  if (status === side) {
    return boss
      ? { title: 'Victory', line: 'The seat is empty.', anim: 'win' }
      : { title: 'You win', line: 'The books balance.', anim: 'win' };
  }
  return boss
    ? { title: 'Defeat', line: 'The seat holds.', anim: 'loss' }
    : { title: 'You lose', line: 'Tally strikes your name.', anim: 'loss' };
}

/** A place from 1: "1st" to "6th". */
export const ordinal = (place: number): string => `${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}`;

/** The battle royale's banner (#503, rules.md section 10.4) from the standings, null while the game runs: first place,
 * one seat since #641, wins, any other place is named. The line gives the points the player scored. */
export function royaleBanner(standings: readonly { seat: number; place: number; points: number }[], you: number): EndBanner | null {
  const mine = standings.find((s) => s.seat === you);
  if (!mine) return null;
  const points = `${mine.points} point${mine.points === 1 ? '' : 's'}`;
  return mine.place === 1
    ? { title: 'You win', line: `${points}. The books balance.`, anim: 'win' }
    : { title: `You place ${ordinal(mine.place)}`, line: `${points}. Tally strikes your name.`, anim: 'loss' };
}
