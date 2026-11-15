// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TALL_BAYS } from './test/shipbays';
import { floorsOf } from './hubroll';
import { nextGoal } from './hubview';
import { goalBay, goalLabel, goalWords, paintGoalText, pathD, placeGoal, wayTag } from './hubgoal';

// The next goal of the Hub Cutaway (#1695): its bay, its words, the tag of the marble, the route and the beacon on the window. The goal itself is the game's own (hubview.ts nextGoal).

const floors = floorsOf(TALL_BAYS, 0);
const bay = (deck: string, room: string) => TALL_BAYS.find((b) => b.deck === deck && b.room === room)!;
const BEATEN_ALL = ['echo', 'hull', 'choir', 'chaplain', 'ballast'];

describe('the bay of the goal', () => {
  it('is the House table while the first win is awaited, whatever the progress says', () => {
    expect(goalBay(nextGoal([], false), true)).toEqual({ deck: 'mess', room: 'bot' });
  });
  it('follows the game: The Echo, then the run on the Cargo deck, then the seat of the first deck not beaten', () => {
    expect(goalBay(nextGoal([], false), false)).toEqual({ deck: 'mess', room: 'echo' });
    expect(goalBay(nextGoal(['echo'], false), false)).toEqual({ deck: 'cargo', room: 'run' });
    expect(goalBay(nextGoal(['echo'], true), false)).toEqual({ deck: 'cargo', room: 'hull' });
    expect(goalBay(nextGoal(['echo', 'hull', 'choir'], true), false)).toEqual({ deck: 'chapel', room: 'chaplain' });
  });
  it('is none once all five are beaten', () => {
    expect(goalBay(nextGoal(BEATEN_ALL, true), false)).toBeNull();
  });
});

describe('the name of the goal room', () => {
  it("is the room's name on its plate, for the tag", () => {
    expect(goalLabel({ deck: 'mess', room: 'echo' })).toBe('The Echo');
    expect(goalLabel({ deck: 'cargo', room: 'run' })).toBe('Mining cut');
    expect(goalLabel({ deck: 'mess', room: 'bot' })).toBe('House table');
  });
});

describe('the words of the goal', () => {
  it("are the game's own line for the goal line, and a title and a place for the card", () => {
    expect(goalWords(nextGoal(['echo'], false), false)).toEqual({ line: 'Next goal: start a rogue-lite run on the Cargo deck.', title: 'Start a rogue-lite run', where: 'Cargo deck' });
    expect(goalWords(nextGoal([], false), false)).toEqual({ line: 'Next goal: beat The Echo on the Mess deck.', title: 'Beat The Echo', where: 'Mess deck' });
  });
  it('name the first win while it is awaited', () => {
    expect(goalWords(nextGoal([], false), true)).toEqual({ line: 'Next goal: win your first game against the bot at the House table.', title: 'Win your first game', where: 'House table, Mess deck' });
  });
  it("are the game's sentence alone when no room is left, with nothing to roll to", () => {
    expect(goalWords(nextGoal(BEATEN_ALL, true), false)).toEqual({ line: 'All bosses beaten. Try the Daily or a run.', title: 'All bosses beaten', where: 'Try the Daily or a run.' });
  });
});

describe("the marble's tag", () => {
  it('points up the lift to the deck when the goal is on another deck and the marble stands at the lift', () => {
    expect(wayTag(floors, { x: 0, y: 1.4 }, bay('cargo', 'run'), 'Run')).toEqual({ dir: 'up', text: 'Ride up to Cargo' });
    expect(wayTag(floors, { x: 0, y: 8.08 }, bay('mess', 'echo'), 'Echo')).toEqual({ dir: 'down', text: 'Ride down to Mess' });
  });
  it('points along the floor to the lift first when the marble stands in a bay of another deck', () => {
    expect(wayTag(floors, { x: 0.58, y: 1.4 }, bay('cargo', 'run'), 'Run')).toEqual({ dir: 'left', text: 'Lift to Cargo' });
    expect(wayTag(floors, { x: -2, y: 1.4 }, bay('cargo', 'run'), 'Run')).toEqual({ dir: 'right', text: 'Lift to Cargo' });
  });
  it('names the room when the goal is on this deck, and says here at the goal', () => {
    expect(wayTag(floors, { x: 0, y: 2.78 }, bay('cargo', 'run'), 'Run')).toEqual({ dir: 'right', text: 'Run' });
    expect(wayTag(floors, { x: 2.58, y: 2.78 }, bay('cargo', 'assembly'), 'Line')).toEqual({ dir: 'left', text: 'Line' });
    expect(wayTag(floors, { x: 2.58, y: 2.78 }, bay('cargo', 'run'), 'Run')).toEqual({ dir: 'here', text: 'Run is here' });
  });
  it('points up when the goal is on another floor of this deck', () => {
    expect(wayTag(floors, { x: 0, y: 2.78 }, bay('cargo', 'hull'), 'Hull')).toEqual({ dir: 'up', text: 'Hull' });
  });
});

describe('the route path', () => {
  it('is a polyline through the points of the window, empty for fewer than two', () => {
    expect(pathD([{ x: 1, y: 2 }, { x: 3.5, y: 4 }, { x: 5, y: 6 }])).toBe('M1 2L3.5 4L5 6');
    expect(pathD([{ x: 1, y: 2 }])).toBe('');
    expect(pathD([])).toBe('');
  });
});

const dom = () => {
  document.body.innerHTML =
    '<div id="g" hidden><svg><path/></svg><i class="ring"></i><i class="ring"></i><span class="tag"></span></div><button id="line" hidden></button><aside id="card" hidden><b></b><span></span><button>Go</button></aside>';
  return { root: document.getElementById('g')!, line: document.getElementById('line')!, card: document.getElementById('card')! };
};

describe('the goal on the window', () => {
  it('paints the beacon, the route and the tag, and hides the lot when there is no goal', () => {
    const { root } = dom();
    placeGoal(root, { route: [{ x: 10, y: 20 }, { x: 10, y: 80 }], ring: { x: 5, y: 60, w: 40, h: 30 }, tag: { x: 10, y: 20, dir: 'up', text: 'Ride up to Cargo' } }, 390);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('path')!.getAttribute('d')).toBe('M10 20L10 80');
    const rings = [...root.querySelectorAll<HTMLElement>('.ring')];
    expect(rings.map((r) => [r.style.left, r.style.top, r.style.width, r.style.height])).toEqual([['5px', '60px', '40px', '30px'], ['5px', '60px', '40px', '30px']]);
    const tag = root.querySelector<HTMLElement>('.tag')!;
    expect(tag.textContent).toBe('Ride up to Cargo');
    expect(tag.dataset.dir).toBe('up');
    expect(tag.style.left).toBe('56px'); // kept whole in the window
    expect(tag.style.top).toBe('20px');
    placeGoal(root, { route: null, ring: null, tag: null }, 390);
    expect(root.hidden).toBe(true);
  });
  it('keeps the tag whole in the window, and the beacon alone when the route and the tag wait for a roll to end', () => {
    const { root } = dom();
    placeGoal(root, { route: null, ring: { x: 5, y: 60, w: 40, h: 30 }, tag: null }, 390);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('path')!.getAttribute('d')).toBe('');
    expect(root.querySelector<HTMLElement>('.tag')!.hidden).toBe(true);
    placeGoal(root, { route: null, ring: null, tag: { x: 200, y: 20, dir: 'here', text: 'Run is here' } }, 390);
    expect(root.querySelector<HTMLElement>('.tag')!.style.left).toBe('200px');
    placeGoal(root, { route: null, ring: null, tag: { x: 500, y: 20, dir: 'here', text: 'Run is here' } }, 390);
    expect(root.querySelector<HTMLElement>('.tag')!.style.left).toBe('334px');
    expect(root.querySelectorAll<HTMLElement>('.ring')[0]!.hidden).toBe(true);
  });
  it('writes the goal line and the card, which are idle when no room is left', () => {
    const { line, card } = dom();
    paintGoalText(line, card, goalWords(nextGoal(['echo'], false), false), 'cargo:run');
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe('Next goal: start a rogue-lite run on the Cargo deck.');
    expect(line.dataset.bay).toBe('cargo:run');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('b')!.textContent).toBe('Start a rogue-lite run');
    expect(card.querySelector('span')!.textContent).toBe('Cargo deck');
    expect(card.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    paintGoalText(line, card, goalWords(nextGoal(BEATEN_ALL, true), false), null);
    expect(line.dataset.bay).toBeUndefined();
    expect((line as HTMLButtonElement).disabled).toBe(true);
    expect(card.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    paintGoalText(line, card, null, null);
    expect(line.hidden && card.hidden).toBe(true);
  });
});
