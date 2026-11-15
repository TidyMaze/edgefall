// The next goal of the Hub Cutaway (#1695): always in sight. Its bay (an amber beacon), a dotted route from the marble, the marble's tag that points the way, and the goal in words (a line over
// the dock on a phone, a card with Go in a window). The goal is the game's own (hubview.ts nextGoal, or the House table while the first win is awaited); this module only shows it.
// Pure strings and DOM: main.ts projects the points and gives the clicks.
import { DECK_NAMES, type Deck } from './deck';
import { goalRoom } from './hubcutaway';
import { roomAt } from './hub';
import { cellOf, route, type Bay, type Floor, type Pos } from './hubroll';
import { roomLabel, type Goal } from './hubview';

const title = (deck: Deck): string => deck[0]!.toUpperCase() + deck.slice(1);

/** The bay of the goal: the House table while the first win is awaited, else the room the game's goal points to; null when it points to none. */
export function goalBay(goal: Goal, locked: boolean): { deck: Deck; room: string } | null {
  if (locked) return { deck: 'mess', room: 'bot' };
  const room = goalRoom(goal);
  return room && goal.deck ? { deck: goal.deck, room } : null;
}

/** The name of the goal's room on its plate (The Echo, House table): the tag says it when the goal is on the marble's deck. */
export const goalLabel = ({ deck, room }: { deck: Deck; room: string }): string => roomLabel(deck, roomAt(deck, cellOf(deck, room)!)!, []).name;

export interface GoalWords {
  line: string; // the goal line of a phone
  title: string; // the card of a window
  where: string;
}
/** The goal in words: "Next goal: start a rogue-lite run on the Cargo deck." for the line, "Start a rogue-lite run" and "Cargo deck" for the card. */
export function goalWords(goal: Goal, locked: boolean): GoalWords {
  if (locked) return { line: 'Next goal: win your first game against the bot at the House table.', title: 'Win your first game', where: 'House table, Mess deck' };
  const m = /^(.*) on the (\w+) deck\.$/.exec(goal.text);
  if (m) return { line: `Next goal: ${m[1]![0]!.toLowerCase()}${m[1]!.slice(1)} on the ${m[2]} deck.`, title: m[1]!, where: `${title(m[2] as Deck)} deck` };
  const [head, ...rest] = goal.text.split('. '); // no room left: the game's sentence alone
  return { line: goal.text, title: head!, where: rest.join('. ') };
}

export interface Tag {
  dir: 'up' | 'down' | 'left' | 'right' | 'here';
  text: string;
}
/** The marble's tag: the way of the first leg of the route (the lift, a floor, the room), and the deck to ride to, or the room (`label`) when the goal is on this deck. */
export function wayTag(floors: readonly Floor[], at: Pos, goal: Bay, label: string): Tag {
  const way = route(floors, at, { x: goal.x, y: goal.y });
  if (way.steps === 0) return { dir: 'here', text: `${label} is here` };
  const next = way.points[1]!;
  const dir = next.y > at.y ? 'up' : next.y < at.y ? 'down' : next.x > at.x ? 'right' : 'left';
  const from = floors.find((f) => f.y === at.y)!.deck;
  if (from === goal.deck) return { dir, text: label };
  const ride = DECK_NAMES.indexOf(goal.deck) > DECK_NAMES.indexOf(from) ? 'up' : 'down';
  return { dir, text: at.x === floors.find((f) => f.y === at.y)!.lift ? `Ride ${ride} to ${title(goal.deck)}` : `Lift to ${title(goal.deck)}` };
}

export const pathD = (points: readonly Pos[]): string => (points.length < 2 ? '' : points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(''));

export interface GoalView {
  route: Pos[] | null; // in window pixels
  ring: { x: number; y: number; w: number; h: number } | null; // the goal's bay, when it is a button in view
  tag: (Tag & Pos) | null; // at the marble
}
const EDGE = 56; // half the widest a tag may be, kept whole in the window

/** Puts the beacon's rings, the route and the tag on the overlay `root`; the overlay is hidden when there is nothing to show. */
export function placeGoal(root: HTMLElement, view: GoalView, width: number): void {
  root.hidden = !view.route && !view.ring && !view.tag;
  root.querySelector('path')!.setAttribute('d', view.route ? pathD(view.route) : '');
  for (const ring of root.querySelectorAll<HTMLElement>('.ring')) {
    ring.hidden = !view.ring;
    if (view.ring) Object.assign(ring.style, { left: `${view.ring.x}px`, top: `${view.ring.y}px`, width: `${view.ring.w}px`, height: `${view.ring.h}px` });
  }
  const tag = root.querySelector<HTMLElement>('.tag')!;
  tag.hidden = !view.tag;
  if (!view.tag) return;
  tag.textContent = view.tag.text;
  tag.dataset.dir = view.tag.dir;
  tag.style.left = `${Math.min(Math.max(view.tag.x, EDGE), width - EDGE)}px`;
  tag.style.top = `${view.tag.y}px`;
}

/** The goal line and the card: the words, the bay a tap rolls to (`data-bay`), idle when the goal points to no room, hidden with no words. */
export function paintGoalText(line: HTMLElement, card: HTMLElement, words: GoalWords | null, key: string | null): void {
  line.hidden = card.hidden = !words;
  if (!words) return;
  line.textContent = words.line;
  card.querySelector('b')!.textContent = words.title;
  card.querySelector('span')!.textContent = words.where;
  for (const el of [line, card.querySelector('button')!] as HTMLButtonElement[]) {
    el.disabled = key === null;
    if (key === null) delete el.dataset.bay;
    else el.dataset.bay = key;
  }
}
