// The hub on screen (docs/specs/game-design.md section 3.5, #521): the board main.ts draws the map with, the cell an
// arrow key rolls the marble to, and the HUD plate. Pure: no DOM, no three.js.
import { CELLS, VANISHED, type Axial } from './board';
import { DECK_NAMES, deckOf, type Deck } from './deck';
import { modeLabel, terminalLabel } from './doorlabels';
import { medalLabel } from './medals';
import { doorLocked, LOCK_LINE } from './unlock';
import { BOSS_IDS } from './tally';
import { bossOpen, canEnter, HUB_CELLS, neighbours, roomAt, roomsOf, type Door, type Spot } from './hub';

/** The bridge board with a hole on every cell off the hub map: the frame shrinks to the map, the other discs hide. */
export const HUB_BOARD: readonly number[] = CELLS.map(([q, r]) =>
  HUB_CELLS.some(([hq, hr]) => hq === q && hr === r) ? 0 : VANISHED,
);

// Left and right roll along the row. The rows are offset, so up and down zigzag to keep the column: up-right from an
// even row, up-left from an odd one, and down goes back the same way.
const ARROWS: Record<string, (odd: boolean) => Axial> = {
  ArrowLeft: () => [-1, 0],
  ArrowRight: () => [1, 0],
  ArrowUp: (odd) => (odd ? [0, -1] : [1, -1]),
  ArrowDown: (odd) => (odd ? [-1, 1] : [0, 1]),
};

/** The neighbour an arrow key rolls the marble to, maybe off the map (hub.ts step keeps it put then); `null` for any
 * other key. */
export function arrowCell([q, r]: Axial, key: string): Axial | null {
  const dir = ARROWS[key]?.(r % 2 !== 0);
  return dir ? [q + dir[0], r + dir[1]] : null;
}

const title = (deck: string): string => deck[0]!.toUpperCase() + deck.slice(1);
const BOSS_NAMES: Record<string, string> = {
  echo: 'The Echo',
  hull: 'The Hull',
  choir: 'The Choir',
  chaplain: 'The Chaplain',
  ballast: 'The Ballast Mind',
  alien: 'The Alien',
  railyard: 'The Rail Yard',
  magnetizer: 'The Magnetizer',
  pulsar: 'The Pulsar',
  overseer: 'The Overseer',
  assembly: 'The Assembly Line',
  core: 'The Unstable Core',
  dual: 'The Dual Room',
  stalker: 'The Stalker',
  swarm: 'The Swarm',
};

export function bossTitle(boss: string): string {
  return BOSS_NAMES[boss] ?? 'Boss';
}

const DESCRIPTORS: Record<Exclude<Door['kind'], 'lift' | 'boss'>, string> = {
  bot: 'Practice match against AI',
  hotseat: '2 players, one screen',
  online: 'Peer-to-peer 1v1 match',
  royale: 'Multi-player battle royale',
  terminal: 'Hub archive and audio log',
  medals: 'Every boss, its medal and best turns',
  daily: 'One boss and one seed a day',
  run: 'Three acts, one army of 14',
  together: 'Two players, one army, a boss',
  ranked: 'Online 1v1, Elo and tiers',
  world: 'A generated hex world',
  trainer: 'Waves against the bot, one more each',
};

/** The line under a boss's name (#1547): the seat of a deck is the boss that opens the lift to the next one (the rail names it), any other boss of the deck is a station
 * and never locks a lift. */
const bossLine = (deck: Deck, boss: string): string => `boss, ${title(deck)} ${bossOf(deck) === boss ? 'seat' : 'station'}`;

/** The name and the plain line of a room of the hub (#1547): the name in the ship's own voice, and what the room does. */
function plain(deck: Deck, door: Door): { name: string; line: string } {
  if (door.kind === 'lift') return { name: `Lift to ${title(door.to)}`, line: `Transit to ${title(door.to)}` };
  if (door.kind === 'boss') return { name: bossTitle(door.boss), line: bossLine(deck, door.boss) };
  const { name, line } = door.kind === 'terminal' ? terminalLabel(door.lore) : modeLabel(door.kind);
  return { name, line };
}

/** Reachability hint for a hovered hub cell relative to the marble's position (#628). */
export function reachabilityText(from: Axial, target: Axial): string {
  if (from[0] === target[0] && from[1] === target[1]) return 'Current position';
  const isNeighbour = neighbours(from).some(([q, r]) => q === target[0] && r === target[1]);
  return isNeighbour ? 'Click to move' : 'Out of reach (roll closer)';
}

/** Name, purpose subtitle and reachability affordance of any hub cell hovered by the player (#628). */
export function hubTargetText(at: Spot, hovered: Axial): { name: string; desc: string; reach: string } {
  const door = roomAt(at.deck, hovered);
  const room = door && plain(at.deck, door);
  const name = room ? room.name : 'Deck floor';
  const desc = !door ? 'Open transit corridor' : door.kind === 'boss' || door.kind === 'lift' ? room!.line : DESCRIPTORS[door.kind];
  const reach = reachabilityText(at.cell, hovered);
  return { name, desc, reach };
}

/** The HUD plate in the hub: the deck, the room the marble stands on, Tally's line, and target inspection (#628). */
export function hubHtml({ deck, cell }: Spot, tally = '', hover: Axial | null = null, contract = '', banked = ''): string {
  const door = roomAt(deck, cell);
  const here = door && plain(deck, door);
  const room = !here ? '' : here.name + (door.kind === 'lift' ? '' : ` · ${here.line}`);
  const posted = contract ? `<div class="hub-contract">${contract}</div>` : ''; // the town's contract (#1618), above Tally's line
  const logged = banked ? `<div class="hub-banked">${banked}</div>` : ''; // the blueprints the last dungeon banked (#1622)
  const line = tally ? `<div class="tally">${tally}</div>` : '';
  const preview = hover
    ? (() => {
        const { name, desc, reach } = hubTargetText({ deck, cell }, hover);
        return `<div class="hub-preview">Target: ${name} · ${desc} <span class="affordance">(${reach})</span></div>`;
      })()
    : '';
  return `<div class="turn"><span>Hub · ${title(deck)}</span></div><small>${room}</small>${posted}${logged}${line}${preview}`;
}

/** Tally's line when a roll to `to` bumps a locked lift next to the marble (#523), else ''. */
export function bumpLine(at: Spot, to: Axial, beaten: readonly string[]): string {
  const door = roomAt(at.deck, to);
  const next = neighbours(at.cell).some(([q, r]) => q === to[0] && r === to[1]);
  if (door?.kind !== 'lift' || !next || canEnter(door, beaten)) return '';
  return `Lift to ${title(door.to)}: locked. This deck's boss is still on the books.`;
}

// The deck plan (#1249): every room wears a label plate, always shown: its name and a short state, or a short label alone
// on a phone. A lift-shaft rail lists the five decks and the boss pips count the bosses beaten.
export interface RoomLabel {
  name: string;
  state: string;
  short: string;
  mark: '' | 'locked' | 'beaten';
}

/** The plate of a room of `deck`: a lift points up or down to its deck, a boss door names its boss and says its seat or station, and once it is
 * beaten its medal's best turns (`medals`, boss id -> turns, medals.ts); any other room wears its name of the ship and its plain line (doorlabels.ts, #1547). A phone
 * shows the boss's name without "The". */
export function roomLabel(deck: Deck, door: Door, beaten: readonly string[], medals: Readonly<Record<string, number>> = {}, waiting = false): RoomLabel {
  if (waiting && doorLocked(door.kind)) {
    // Until the first win (#1665): a boss or a mode room keeps its name and says what opens it; a lift and a table are never locked.
    const { name, short } = door.kind === 'boss' ? { name: bossTitle(door.boss), short: bossTitle(door.boss).replace(/^The /, '') } : modeLabel(door.kind);
    return { name, state: LOCK_LINE, short: `${short} locked`, mark: 'locked' };
  }
  if (door.kind === 'boss') {
    const boss = bossTitle(door.boss);
    const won = beaten.includes(door.boss);
    const turns = medals[door.boss];
    const medal = turns === undefined ? 'beaten' : medalLabel(turns);
    return { name: boss, state: won ? medal : bossLine(deck, door.boss), short: boss.replace(/^The /, ''), mark: won ? 'beaten' : '' };
  }
  if (door.kind === 'lift') {
    const open = canEnter(door, beaten);
    const arrow = DECK_NAMES.indexOf(door.to) > DECK_NAMES.indexOf(deck) ? '▲' : '▼';
    const to = title(door.to);
    return { name: `Lift ${arrow} ${to}`, state: open ? 'open' : 'locked', short: `${arrow} ${open ? to : 'Locked'}`, mark: open ? '' : 'locked' };
  }
  const { name, line, short } = door.kind === 'terminal' ? terminalLabel(door.lore) : modeLabel(door.kind);
  return { name, state: line, short, mark: '' };
}

/** The deck next to `deck` on the way to `to`: the lift a player takes from here toward a goal on another deck (#1526). */
const wayTo = (deck: Deck, to: Deck): Deck => DECK_NAMES[DECK_NAMES.indexOf(deck) + Math.sign(DECK_NAMES.indexOf(to) - DECK_NAMES.indexOf(deck))]!;

/** The plates of the deck, one per room on its cell, and YOU on the marble's floor cell; on a room its plate is marked, and the room of the next `goal` is marked when it is on this deck: the deck's own boss door (not the Dual Room's) or the Rogue-lite room. A goal on another deck marks the lift on its way (`wayTo`). Then every other plate is quiet, but the one under the marble (#1526). */
export function labelsHtml({ deck, cell: [mq, mr] }: Spot, beaten: readonly string[], medals: Readonly<Record<string, number>> = {}, goal: Goal | null = null, waiting = false): string {
  const goalRoom = (door: Door): boolean => {
    if (!goal?.deck || (waiting && doorLocked(door.kind))) return false; // a locked door is never the amber plate (#1665)
    if (goal.deck !== deck) return door.kind === 'lift' && door.to === wayTo(deck, goal.deck);
    return goal.room === 'run' ? door.kind === 'run' : door.kind === 'boss' && door.boss === bossOf(deck);
  };
  const goalOnDeck = roomsOf(deck).some(({ door }) => goalRoom(door)); // the goal room is the loud plate, the others are quiet (#1526)
  const plates = roomsOf(deck).map(({ cell: [q, r], door }) => {
    const { name, state, short, mark } = roomLabel(deck, door, beaten, medals, waiting);
    const here = q === mq && r === mr;
    const attrs = `${mark ? ` data-mark="${mark}"` : ''}${goalRoom(door) ? ' data-goal' : ''}${here ? ' data-here' : ''}${goalOnDeck && !goalRoom(door) && !here ? ' data-quiet' : ''}`;
    return `<div class="hub-label" data-cell="${q},${r}" data-kind="${door.kind}"${attrs}><b>${name}</b><small>${state}</small><span class="short">${short}</span></div>`;
  });
  if (!roomAt(deck, [mq, mr])) plates.push(`<div class="hub-label you" data-cell="${mq},${mr}">You</div>`);
  return plates.join('');
}

const bossOf = (deck: Deck): string => roomsOf(deck).flatMap(({ door }) => (door.kind === 'boss' ? [door.boss] : []))[0]!;
/** A deck by its boss: beaten (from the boss menu too), else open once its lift is, else locked. */
const deckState = (deck: Deck, beaten: readonly string[]): 'beaten' | 'open' | 'locked' =>
  beaten.includes(bossOf(deck)) ? 'beaten' : canEnter({ kind: 'lift', to: deck }, beaten) ? 'open' : 'locked';

/** The next thing to do (#1524, docs/specs/ui.md section 4.7): `text` for the Hub's line, and the `room` of the `deck` it points to, `null` when
 * it points to none. */
export interface Goal {
  text: string;
  deck: Deck | null;
  room: 'boss' | 'run' | null;
}

/** The deck that holds the Rogue-lite room (hub.ts), the first one The Echo opens. */
const RUN_DECK: Deck = 'cargo';

const goalOf = (room: 'boss' | 'run', deck: Deck): Goal => ({
  text: room === 'run' ? `Start a rogue-lite run on the ${title(deck)} deck.` : `Beat ${bossTitle(bossOf(deck))} on the ${title(deck)} deck.`,
  deck,
  room,
});

/** The path of a new player, from what the player has done: The Echo first, then a first rogue-lite run (`ran`, on the Cargo deck, the one The Echo
 * opens), then the boss of the first deck not beaten, in deck order. It names only a boss the rail names already (its lift is open), never one above
 * the progress. Town training (Decision #1513) is not on the path yet. Once all five are beaten it points to no room. */
export function nextGoal(beaten: readonly string[], ran: boolean): Goal {
  if (!beaten.includes(bossOf(DECK_NAMES[0]))) return goalOf('boss', DECK_NAMES[0]);
  if (!ran) return goalOf('run', RUN_DECK);
  const deck = DECK_NAMES.find((d) => !beaten.includes(bossOf(d)));
  return deck ? goalOf('boss', deck) : { text: 'All bosses beaten. Try the Daily or a run.', deck: null, room: null };
}

/** The first boss not beaten, in deck order: its name, null when none is left. Its lift is open, as the rail says (the notice board, #1528). */
export function nextBossTitle(beaten: readonly string[]): string | null {
  const deck = DECK_NAMES.find((d) => !beaten.includes(bossOf(d)));
  return deck ? bossTitle(bossOf(deck)) : null;
}

/** The lift-shaft rail: the five decks from the Bridge down, each with its state, and where the marble is; under them the line of the next `goal`, and its deck's row ringed. */
export function railHtml(at: Deck, beaten: readonly string[], goal: Goal | null = null, waiting = false): string {
  const rows = DECK_NAMES.map((deck, i) => {
    const state = deckState(deck, beaten);
    const boss = bossTitle(bossOf(deck));
    const line = state === 'locked' ? 'Lift locked' : waiting && state === 'open' ? 'Seat: win your first game' : `Seat: ${boss} ${state === 'beaten' ? 'beaten' : 'waits'}`;
    const here = deck === at;
    return `<li data-deck="${deck}" data-state="${state}"${deck === goal?.deck ? ' data-goal' : ''}${here ? ' aria-current="location"' : ''}><span class="n">0${i + 1}</span><b>${title(deck)}</b><small>${line}${here ? ' · you are here' : ''}</small></li>`;
  });
  return `<h2>Lift shaft</h2><ul>${rows.reverse().join('')}</ul>${goal ? `<p class="goal"><span class="lead">Next goal: </span>${goal.text}</p>` : ''}`;
}

/** The boss pips: the count of medals out of the whole roster, as every screen says it (#1527), then a pip per deck in deck order, titled by its deck and boss. */
export function pipsHtml(beaten: readonly string[], medals: Readonly<Record<string, number>>): string {
  const states = DECK_NAMES.map((deck) => [deck, bossTitle(bossOf(deck)), deckState(deck, beaten)] as const);
  const count = BOSS_IDS.filter((id) => medals[id] !== undefined).length;
  const pips = states.map(([deck, boss, state]) => `<span class="pip" data-state="${state}" title="${title(deck)} deck, ${boss}: ${state}"></span>`);
  return `<span class="count">Medals ${count} / ${BOSS_IDS.length}</span>${pips.join('')}`;
}
