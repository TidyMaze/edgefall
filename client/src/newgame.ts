// The New game button of a local game (#230, docs/specs/ui.md section 4). With no move played there is nothing
// to lose: a press starts over at once. Once a move is played, the first press asks for a confirmation: the
// button reads "Confirm new game" for CONFIRM_MS, and only a second press in that time starts the new game.

/** How long the button waits for the confirming press, in ms. */
export const CONFIRM_MS = 4000;

/** Until when (ms, on the clock of the presses) a press confirms the new game; null while none is asked for. */
export type Confirm = number | null;

/** A press at `now` on a game of `plies` moves: whether the new game starts, and the confirmation after it. */
export function pressNewGame(confirm: Confirm, now: number, plies: number): { start: boolean; confirm: Confirm } {
  if (plies === 0 || (confirm !== null && now < confirm)) return { start: true, confirm: null };
  return { start: false, confirm: now + CONFIRM_MS };
}

/** The button label: it asks for the confirmation while one is pending. */
export const newGameLabel = (confirm: Confirm): string => (confirm === null ? 'New game' : 'Confirm new game');
