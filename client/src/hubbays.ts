// The bays of the Hub Cutaway as tap targets (#1691): one button per bay over the ship, wall to wall, with the name of its room (the short one on a phone, the full one and its
// line in a window, ui.css) and its state; a deck not open is dark and unnamed. A set piece (hold, crates, nave) has no button. Strings and DOM only: the page projects the boxes.
import type { Deck } from './deck';
import { roomAt } from './hub';
import { cellOf, type Bay } from './hubroll';
import { roomState, type ShipState } from './hubcutaway';
import { roomLabel } from './hubview';

const title = (deck: Deck): string => deck[0]!.toUpperCase() + deck.slice(1);
/** The names a phone's bay has room for (one line of 10 px in a bay 43 px wide): the long short names of the plates are cut down. */
const PHONE: Readonly<Record<string, string>> = { ballast: 'Ballast', railyard: 'Rails', magnetizer: 'Magnet', assembly: 'Line', core: 'Core', dual: 'Dual', chaplain: 'Chaplain', hotseat: 'Crew', 'bridge:logs': 'Notice', 'cargo:logs': 'Assay' };
const LOCK = '<svg class="cut-lock" viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="6" width="10" height="8" rx="1.5"/><path d="M3.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none"/></svg>';

/** The buttons of `bays`, from the state of the ship (`st`) and what the old Hub plates say (`roomLabel`): the bosses beaten, their `medals`, and whether the first win is `waiting`. */
export function bayButtons(bays: readonly Bay[], st: ShipState, beaten: readonly string[], medals: Readonly<Record<string, number>>, waiting: boolean): string {
  const locked = new Set<string>(); // the decks that already show their padlock: one on the beam of each
  return bays
    .flatMap(({ deck, room }) => {
      const cell = cellOf(deck, room);
      if (!cell) return [];
      const state = roomState(room, deck, st);
      const key = `data-bay="${deck}:${room}" data-state="${state}"`;
      if (state === 'dark') {
        const lock = locked.has(deck) ? '' : LOCK;
        locked.add(deck);
        return [`<button type="button" class="cut-bay" ${key} aria-label="${title(deck)} deck, locked">${lock}</button>`];
      }
      const door = roomAt(deck, cell)!;
      const { name, state: line } = roomLabel(deck, door, beaten, medals, waiting);
      const short = PHONE[`${deck}:${room}`] ?? PHONE[room] ?? roomLabel(deck, door, beaten, medals, false).short; // the phone's sign is the name alone: the dim and the aria-label say locked
      return [`<button type="button" class="cut-bay" ${key} aria-label="${name}, ${line}"><b>${name}</b><small>${line}</small><span class="short">${short}</span></button>`];
    })
    .join('');
}

export interface BayBox {
  deck: Deck;
  room: string;
  box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
}

/** Puts each button on the window rect of its bay: `project` gives the window point of a point of the scene; the front face of the box is the bay. */
export function placeBays(root: HTMLElement, boxes: readonly BayBox[], project: (x: number, y: number, z: number) => { x: number; y: number }): void {
  for (const { deck, room, box } of boxes) {
    const button = root.querySelector<HTMLElement>(`[data-bay="${deck}:${room}"]`);
    if (!button) continue;
    const a = project(box.min.x, box.min.y, box.max.z);
    const b = project(box.max.x, box.max.y, box.max.z);
    button.style.left = `${Math.min(a.x, b.x)}px`;
    button.style.top = `${Math.min(a.y, b.y)}px`;
    button.style.width = `${Math.abs(b.x - a.x)}px`;
    button.style.height = `${Math.abs(b.y - a.y)}px`;
  }
}

/** Gives the keyboard focus to the button of the bay the marble stands in, if it is one (the lift is none). */
export function focusBay(root: HTMLElement, bay: { deck: Deck; room: string } | undefined): void {
  if (bay) root.querySelector<HTMLElement>(`[data-bay="${bay.deck}:${bay.room}"]`)?.focus();
}

/** Sets the buttons when they changed: a button that is rebuilt loses the focus of the keyboard. */
export function paintBays(root: HTMLElement, html: string): void {
  if (root.dataset.painted === html) return;
  root.dataset.painted = html;
  root.innerHTML = html;
}
