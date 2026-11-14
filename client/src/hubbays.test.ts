// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TALL_BAYS } from './test/shipbays';
import { bayButtons, focusBay, paintBays, placeBays } from './hubbays';
import { shipState } from './hubcutaway';

// The bays of the Hub Cutaway as tap targets (#1691): a button per bay with its name and state, a locked deck dark and unnamed, set pieces none.

const html = (beaten: string[] = [], waiting = false, goal: string | null = null, medals: Record<string, number> = {}): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = bayButtons(TALL_BAYS, { ...shipState(beaten, waiting, goal) }, beaten, medals, waiting);
  return root;
};
const bay = (root: HTMLElement, key: string): HTMLElement => root.querySelector<HTMLElement>(`[data-bay="${key}"]`)!;

describe('the bay buttons', () => {
  it('are one per bay with a room, none for the set pieces (hold, crates, nave)', () => {
    const root = html(['echo', 'hull', 'choir', 'chaplain']);
    expect(root.querySelectorAll('button').length).toBe(TALL_BAYS.length - 3);
    for (const key of ['cargo:hold', 'cargo:crates', 'chapel:nave']) expect(bay(root, key)).toBeNull();
  });
  it('name the room with its short label for a phone and its full name and line for a window, and say it to a screen reader', () => {
    const echo = bay(html(), 'mess:echo');
    expect(echo.getAttribute('aria-label')).toBe('The Echo, boss, Mess seat');
    expect(echo.querySelector('b')!.textContent).toBe('The Echo');
    expect(echo.querySelector('small')!.textContent).toBe('boss, Mess seat');
    expect(echo.querySelector('.short')!.textContent).toBe('Echo');
    expect(echo.getAttribute('type')).toBe('button');
  });
  it('carry the state: the goal, a beaten boss with its medal, a bay that waits for the first win, an open one', () => {
    const root = html(['echo'], false, 'hull', { echo: 12 });
    expect(bay(root, 'cargo:hull').dataset.state).toBe('goal');
    expect(bay(root, 'mess:echo').dataset.state).toBe('beaten');
    expect(bay(root, 'mess:echo').querySelector('small')!.textContent).toMatch(/12/);
    expect(bay(root, 'mess:bot').dataset.state).toBe('lit');
    const waiting = html([], true);
    expect(bay(waiting, 'mess:echo').dataset.state).toBe('locked');
    expect(bay(waiting, 'mess:echo').getAttribute('aria-label')).toMatch(/win/i);
    expect(bay(waiting, 'mess:bot').dataset.state).toBe('lit');
  });
  it('give a phone one short name per bay, cut down where the plate\'s is too long, and never the locked line', () => {
    const waiting = html([], true);
    expect(bay(waiting, 'mess:echo').querySelector('.short')!.textContent).toBe('Echo'); // not "Echo locked"
    const open = html(['echo', 'hull', 'choir', 'chaplain']);
    const shorts = [...open.querySelectorAll('.short')].map((e) => e.textContent!);
    expect(bay(open, 'furnace:core').querySelector('.short')!.textContent).toBe('Core');
    expect(bay(open, 'bridge:ballast').querySelector('.short')!.textContent).toBe('Ballast');
    expect(shorts.filter((t) => t.length > 8)).toEqual([]);
  });
  it('wear one padlock on the beam of each deck that is not open, and none on an open one', () => {
    const root = html();
    expect(root.querySelectorAll('svg.cut-lock').length).toBe(4); // Cargo, Furnace, Chapel, Bridge
    expect(bay(root, 'mess:echo').querySelector('svg')).toBeNull();
    expect(html(['echo', 'hull', 'choir', 'chaplain']).querySelectorAll('svg.cut-lock').length).toBe(0);
  });
  it('of a deck that is not open are dark and unnamed, but still tappable to bump', () => {
    const dark = bay(html(), 'furnace:choir');
    expect(dark.dataset.state).toBe('dark');
    expect(dark.textContent).toBe('');
    expect(dark.getAttribute('aria-label')).toBe('Furnace deck, locked');
  });
});

describe('placing the buttons', () => {
  it('puts each on the screen rect of its bay, the front face of its box', () => {
    const root = html();
    const box = (min: number[], max: number[]) => ({ min: { x: min[0]!, y: min[1]!, z: min[2]! }, max: { x: max[0]!, y: max[1]!, z: max[2]! } });
    const hold = { deck: 'cargo' as const, room: 'hold', box: box([0, 0, 0], [1, 1, 0]) }; // a set piece: no button
    placeBays(root, [hold, { deck: 'mess', room: 'echo', box: box([0, 0, -1], [1, 1.2, 0]) }], (x, y) => ({ x: 100 + x * 60, y: 700 - y * 60 }));
    const echo = bay(root, 'mess:echo');
    expect([echo.style.left, echo.style.top, echo.style.width, echo.style.height]).toEqual(['100px', '628px', '60px', '72px']);
    expect(bay(root, 'mess:bot').style.left).toBe(''); // a bay with no box is left as it is
  });
});

describe('the focus', () => {
  it('goes to the button of the bay the marble stands in, and nowhere for the lift or a bay with no button', () => {
    const root = html();
    document.body.append(root);
    focusBay(root, { deck: 'mess', room: 'echo' });
    expect(document.activeElement).toBe(bay(root, 'mess:echo'));
    focusBay(root, undefined);
    focusBay(root, { deck: 'cargo', room: 'hold' });
    expect(document.activeElement).toBe(bay(root, 'mess:echo'));
    root.remove();
  });
});

describe('painting', () => {
  it('replaces the buttons only when they changed, so the focus stays on the one pressed', () => {
    const root = document.createElement('div');
    paintBays(root, '<button data-bay="a">A</button>');
    const first = root.querySelector('button')!;
    paintBays(root, '<button data-bay="a">A</button>');
    expect(root.querySelector('button')).toBe(first);
    paintBays(root, '<button data-bay="a">B</button>');
    expect(root.querySelector('button')).not.toBe(first);
    paintBays(root, '');
    expect(root.innerHTML).toBe('');
  });
});
