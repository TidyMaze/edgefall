// The lobby's offer after a wait with no peer (#1529). Pure: the caller passes the elapsed time and the peers in the room, so a
// test moves time without waiting. The 20 s and every text of the offer sit here.

export const BOT_OFFER_MS = 20000; // 20 s with no peer: the lobby offers a bot game while the room stays open
export const BOT_BUTTON = 'Play the bot while you wait';
export const SWITCH_LINE = 'A player joined the room: switch to it';

/** `wait`: keep waiting; `offer`: nobody joined, offer the bot game; `joined`: a peer is in, no offer. */
export type LobbyState = 'wait' | 'offer' | 'joined';

export function lobbyState(elapsedMs: number, peers: number, waitMs = BOT_OFFER_MS): LobbyState {
  if (peers > 0) return 'joined';
  return elapsedMs >= waitMs ? 'offer' : 'wait';
}

/** The wait before the offer: 20 s, or the `lobbywait` URL parameter (ms) under navigator.webdriver, so an e2e or unit test sees
 * the offer at once. A player never gets a shortened one. */
export function lobbyWaitMs(search: string, webdriver: boolean): number {
  const ms = Number(new URLSearchParams(search).get('lobbywait'));
  return webdriver && Number.isInteger(ms) && ms >= 50 ? ms : BOT_OFFER_MS;
}

/** The bot game of a lobby: the same boss and seed as a boss room (Boss with a partner, Boss vs a player), null for a table (Play online, Ranked). */
export function botGameOf(fight: { id: string; seed: number } | null): { id: string; seed: number } | null {
  return fight && { id: fight.id, seed: fight.seed };
}
