// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TALL_BAYS } from './test/shipbays';
import { bayButtons, focusBay, paintBays, placeBays, placeLift, placeVeil } from './hubbays';
import { shipState } from './hubcutaway';

// The bays of the Hub Cutaway as tap targets (#1691): a button per bay with its name and state, a locked deck dark and unnamed, set pieces none.

const html = (beaten: string[] = [], waiting = false, goal: string | null = null, medals: Record<string, number> = {}, spark = false): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = bayButtons(TALL_BAYS, { ...shipState(beaten, waiting, goal) }, beaten, medals, waiting, spark);
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
    expect(bay(waiting, 'mess:bot').dataset.state).toBe('goal'); // the House table is the goal while the first win is awaited (#1692)
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

describe('a small phone', () => {
  const box = (y: number) => ({ min: { x: 0, y, z: -1 }, max: { x: 1, y: y + 1, z: 0 } });
  const at = (x: number, y: number) => ({ x: x * 60, y: 700 - y * 60 });
  const bays = [
    { deck: 'mess' as const, room: 'echo', box: box(0) }, // window y 700 to 640
    { deck: 'mess' as const, room: 'dual', box: box(3) }, // 520 to 460
    { deck: 'mess' as const, room: 'daily', box: box(5.5) }, // 370 to 310: over the top of the room
  ];
  it('draws as a button only the bays whole in the room, and every bay when the whole ship is drawn', () => {
    const root = html();
    placeBays(root, bays, at, { top: 400, bottom: 710, up: true, down: false, seenUp: false, seenDown: false });
    expect([bay(root, 'mess:echo').hidden, bay(root, 'mess:dual').hidden, bay(root, 'mess:daily').hidden]).toEqual([false, false, true]);
    placeBays(root, bays, at, { top: 400, bottom: 700, up: true, down: false, seenUp: false, seenDown: false }); // the foot of a bay on the edge is whole
    expect(bay(root, 'mess:echo').hidden).toBe(false);
    placeBays(root, bays, at, { top: 400, bottom: 699, up: true, down: false, seenUp: false, seenDown: false });
    expect(bay(root, 'mess:echo').hidden).toBe(true);
    placeBays(root, bays, at, null);
    expect([bay(root, 'mess:echo').hidden, bay(root, 'mess:daily').hidden]).toEqual([false, false]);
  });
  it('puts the lift buttons over the shaft in the strips above and below the room, a 44 px target each, shown only with a follow camera', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-lift="up"></button><button data-lift="down"></button>';
    const [up, down] = [...root.querySelectorAll<HTMLButtonElement>('button')];
    placeLift(root, { top: 108, bottom: 522, up: true, down: false, seenUp: false, seenDown: false }, 120, 360);
    expect(root.hidden).toBe(false);
    expect([up!.style.left, up!.style.top, up!.style.width, up!.style.height, up!.disabled]).toEqual(['98px', '62px', '44px', '44px', false]);
    expect([down!.style.top, down!.disabled]).toEqual(['524px', true]);
    expect([up!.dataset.seen, down!.dataset.seen]).toEqual(['false', 'false']);
    placeLift(root, { top: 108, bottom: 522, up: true, down: true, seenUp: true, seenDown: false }, 120, 360);
    expect([up!.dataset.seen, down!.dataset.seen]).toEqual(['true', 'false']); // the floor above is in view: its button fades
    placeLift(root, { top: 108, bottom: 522, up: false, down: true, seenUp: false, seenDown: false }, 2, 360); // never off the window
    expect([up!.style.left, up!.disabled, down!.disabled]).toEqual(['0px', true, false]);
    placeLift(root, { top: 108, bottom: 522, up: false, down: true, seenUp: false, seenDown: false }, 359, 360);
    expect(up!.style.left).toBe('316px');
    placeLift(root, null, 120, 360);
    expect(root.hidden).toBe(true);
  });
});

describe('the sky over the ship', () => {
  it('covers the window above and below the room of a small phone, and is hidden for the whole ship', () => {
    const root = document.createElement('div');
    root.innerHTML = '<i></i><i></i>';
    const [top, bottom] = [...root.querySelectorAll('i')];
    placeVeil(root, { top: 168, bottom: 504, up: true, down: true, seenUp: false, seenDown: false }, 640);
    expect(root.hidden).toBe(false);
    expect([top!.style.height, bottom!.style.top, bottom!.style.height]).toEqual(['168px', '504px', '136px']);
    placeVeil(root, { top: 168, bottom: 700, up: true, down: true, seenUp: false, seenDown: false }, 640);
    expect(bottom!.style.height).toBe('0px');
    placeVeil(root, null, 640);
    expect(root.hidden).toBe(true);
  });
});

describe('the deck of the marble and the focus on a small phone', () => {
  const box = (y: number) => ({ min: { x: 0, y, z: -1 }, max: { x: 1, y: y + 1, z: 0 } });
  const at = (x: number, y: number) => ({ x: x * 60, y: 700 - y * 60 });
  const bays = [
    { deck: 'mess' as const, room: 'echo', box: box(0) },
    { deck: 'cargo' as const, room: 'hull', box: box(3) },
  ];
  it('marks the buttons of the deck the marble is on, and none when it is nowhere', () => {
    const root = html(['echo']);
    placeBays(root, bays, at, null, { deck: 'cargo' });
    expect([bay(root, 'mess:echo').dataset.here, bay(root, 'cargo:hull').dataset.here]).toEqual(['false', 'true']);
    placeBays(root, bays, at);
    expect(bay(root, 'cargo:hull').dataset.here).toBe('false');
  });
  it('moves the focus of a bay the camera hid to the bay of the marble, and keeps one still in view', () => {
    const root = html(['echo']);
    document.body.append(root);
    const near = { top: 0, bottom: 800, up: true, down: false, seenUp: false, seenDown: false };
    bay(root, 'cargo:hull').focus();
    placeBays(root, bays, at, { ...near, top: 600 }, { deck: 'mess', bay: { deck: 'mess', room: 'echo' } }); // the Cargo bay is above the room: hidden
    expect(document.activeElement).toBe(bay(root, 'mess:echo'));
    placeBays(root, bays, at, near, { deck: 'mess', bay: { deck: 'mess', room: 'echo' } }); // the focus is on a bay in view: it stays
    expect(document.activeElement).toBe(bay(root, 'mess:echo'));
    bay(root, 'cargo:hull').focus();
    placeBays(root, bays, at, near, { deck: 'mess', bay: { deck: 'mess', room: 'echo' } });
    (document.activeElement as HTMLElement).blur(); // the browser drops the focus to the page once it has hidden the bay
    placeBays(root, bays, at, { ...near, top: 600 }, { deck: 'mess', bay: { deck: 'mess', room: 'echo' } });
    expect(document.activeElement).toBe(bay(root, 'mess:echo'));
    (document.activeElement as HTMLElement).blur();
    placeBays(root, bays, at, near, null); // not a marble's page
    expect(document.activeElement).toBe(document.body);
    root.remove();
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

describe('the locked look and the first-win spark (#1692)', () => {
  it('a bay that waits for the first win has a padlock of its own, a lit one none', () => {
    const waiting = html([], true);
    expect(bay(waiting, 'mess:echo').querySelector('.cut-lock')).not.toBeNull();
    expect(bay(waiting, 'mess:daily').querySelector('.cut-lock')).not.toBeNull();
    expect(bay(waiting, 'mess:bot').querySelector('.cut-lock')).toBeNull();
    expect(bay(waiting, 'mess:logs').querySelector('.cut-lock')).toBeNull();
  });
  it('the spark marks the bays the first win lit, not the tables or the dark decks', () => {
    const lit = html([], false, 'echo', {}, true);
    expect(bay(lit, 'mess:daily').dataset.spark).toBe('1');
    expect(bay(lit, 'mess:echo').dataset.spark).toBe('1');
    expect(bay(lit, 'mess:bot').dataset.spark).toBeUndefined();
    expect(bay(lit, 'cargo:hull').dataset.spark).toBeUndefined(); // a dark deck
    expect(bay(html(), 'mess:daily').dataset.spark).toBeUndefined();
  });
});
