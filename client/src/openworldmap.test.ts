// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { COLOURS, terrainColour, type MinimapData } from './openworldminimap';
import { MAX_UNIT, MIN_UNIT, UNIT, WorldMap } from './openworldmap';

// The map of the Open world (#1411, docs/specs/openworld.md section 9): full screen, drawn by the minimap's drawing, panned and zoomed.

const W = 800;
const H = 600;

/** A 2D context that records the colours it fills with. */
function withContext(): { fills: string[] } {
  const fills: string[] = [];
  const ctx = { fillStyle: '' } as Record<string, unknown>;
  for (const name of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'moveTo', 'lineTo', 'closePath', 'clip', 'fillText', 'stroke']) ctx[name] = () => {};
  ctx.fill = ctx.fillRect = () => fills.push(ctx.fillStyle as string);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { fills };
}

/** A source of map data that records what it was asked for. */
function source(over: Partial<MinimapData> = {}) {
  const asked: { centre: Axial; radius: number }[] = [];
  const read = (centre: Axial, radius: number): MinimapData => {
    asked.push({ centre, radius });
    return { cells: [[0, 0, 'sand']], hero: [0, 0], troop: [], enemies: [], lairs: [], teleporters: [], logs: [], places: [], yaw: 0, ...over };
  };
  return { asked, read, last: () => asked[asked.length - 1]! };
}

// jsdom has no PointerEvent: a mouse event carries the pointer fields the map reads.
function pointer(type: string, target: EventTarget, x: number, y: number, id = 1): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
}

beforeEach(() => {
  withContext();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const opened = (over: Partial<MinimapData> = {}, hero: Axial = [0, 0]) => {
  const src = source(over);
  const map = new WorldMap(src.read);
  map.open(hero, W, H);
  return { map, src, root: document.getElementById('openworld-map')! };
};

describe('the map\'s key of the biomes (#1750)', () => {
  it('lists the six biomes with the colour of their ground', () => {
    const { map } = opened();
    const items = [...document.querySelectorAll<HTMLElement>('#openworld-map-legend li')];
    expect(items.map((li) => li.textContent)).toEqual(['Meadow', 'Forest', 'Tundra', 'Desert', 'Badlands', 'Archipelago']);
    expect(items[1]!.querySelector('i')!.style.background).not.toBe(items[3]!.querySelector('i')!.style.background);
    map.close();
  });
});

describe('WorldMap', () => {
  it('opens full screen over the page on the hero, a canvas of the window size, and closes', () => {
    const { map, src, root } = opened({}, [5, -3]);
    expect(map.shown).toBe(true);
    const canvas = root.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([W, H]);
    expect(root.getAttribute('aria-label')).toBe('Map of the Open world');
    expect(src.last().centre).toEqual([5, -3]);
    expect(src.last().radius).toBeGreaterThanOrEqual(Math.hypot(W, H) / 2 / UNIT / (Math.sqrt(3) / 2));
    map.close();
    expect(map.shown).toBe(false);
    expect(document.getElementById('openworld-map')).toBeNull();
  });

  it('draws the cells, the hero and the lairs with the minimap drawing', () => {
    const fills = withContext().fills;
    opened({ lairs: [{ cell: [3, 0], beaten: false }] });
    expect(fills).toContain(COLOURS.back);
    expect(fills).toContain(terrainColour('sand'));
    expect(fills).toContain(COLOURS.hero);
    expect(fills).toContain(COLOURS.lair);
  });

  it('pans with a drag: the ground follows the pointer, in the yaw of the camera', () => {
    const { src, root } = opened();
    pointer('pointerdown', root, 100, 100);
    pointer('pointermove', root, 100 + 5 * UNIT, 100);
    pointer('pointerup', root, 100 + 5 * UNIT, 100);
    expect(src.last().centre).toEqual([-5, 0]);
    const turned = opened({ yaw: Math.PI / 2 });
    turned.map.pan(0, 5 * UNIT); // at a quarter turn screen down is +q on the ground: the view moves back along q
    expect(turned.src.last().centre).toEqual([-5, 0]);
    const flat = opened();
    flat.map.pan(0, 5 * UNIT); // unturned, screen down is +r (and half a cell of -q per row)
    expect(flat.src.last().centre).toEqual([3, -6]);
  });

  it('zooms with the wheel and with a pinch, within its bounds', () => {
    const { map, src, root } = opened();
    const start = src.last().radius;
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    root.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(src.last().radius).toBeGreaterThan(start);
    for (let i = 0; i < 50; i++) map.zoom(2);
    const widest = src.last().radius;
    map.zoom(2);
    expect(src.last().radius).toBe(widest);
    expect(widest).toBeLessThanOrEqual(Math.ceil(Math.hypot(W, H) / 2 / MIN_UNIT / (Math.sqrt(3) / 2)) + 2);
    for (let i = 0; i < 50; i++) map.zoom(0.5);
    expect(src.last().radius).toBeLessThanOrEqual(Math.ceil(Math.hypot(W, H) / 2 / MAX_UNIT / (Math.sqrt(3) / 2)) + 2);
    const near = src.last().radius;
    for (let i = 0; i < 2; i++) map.zoom(2);
    const before = src.last().radius;
    pointer('pointerdown', root, 300, 300, 1);
    pointer('pointerdown', root, 400, 300, 2);
    pointer('pointermove', root, 500, 300, 2); // the fingers spread: closer
    expect(src.last().radius).toBeLessThan(before);
    expect(src.last().radius).toBeGreaterThanOrEqual(near);
    pointer('pointerup', root, 500, 300, 2);
    pointer('pointerup', root, 300, 300, 1);
  });

  it('hands a click on a cell to `pick`, the cell under the pointer; a drag or a pinch picks nothing', () => {
    const { map, root } = opened({}, [2, 2]);
    const pick = vi.fn();
    map.pick = pick;
    pointer('pointerdown', root, W / 2 + UNIT, H / 2);
    pointer('pointerup', root, W / 2 + UNIT, H / 2);
    expect(pick).toHaveBeenCalledWith([3, 2]);
    pick.mockClear();
    pointer('pointerdown', root, 10, 10);
    pointer('pointermove', root, 60, 10);
    pointer('pointerup', root, 60, 10);
    pointer('pointerdown', root, 10, 10, 1);
    pointer('pointerdown', root, 20, 10, 2);
    pointer('pointerup', root, 20, 10, 2);
    pointer('pointerup', root, 10, 10, 1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('picks nothing by default, forgets a cancelled pointer and ignores a pointer it never saw go down', () => {
    const { src, root } = opened();
    pointer('pointerdown', root, 10, 10);
    pointer('pointerup', root, 10, 10); // the default pick: nothing happens
    const asks = src.asked.length;
    pointer('pointermove', root, 50, 50, 9);
    expect(src.asked).toHaveLength(asks);
    pointer('pointerdown', root, 10, 10);
    pointer('pointercancel', root, 10, 10);
    pointer('pointermove', root, 50, 50);
    expect(src.asked).toHaveLength(asks);
  });

  it('opens in the choice of a teleporter (#1412): a caption says so, and the teleporter nearest its middle, the hero\'s left out, is chosen', () => {
    const { map, root, src } = opened({ teleporters: [[0, 0], [9, 0], [-20, 0]] });
    const caption = root.querySelector<HTMLElement>('#openworld-map-note')!;
    expect(caption.hidden).toBe(true);
    expect([map.choosing, map.chosen]).toEqual([false, null]);
    map.open([0, 0], W, H, true);
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toBe('Choose a teleporter');
    expect(caption.getAttribute('role')).toBe('status');
    expect([map.choosing, map.chosen]).toEqual([true, [9, 0]]);
    map.pan(15 * UNIT, 0); // the middle moves 15 cells west
    expect(map.chosen).toEqual([-20, 0]);
    map.note('Not discovered yet');
    expect(caption.textContent).toBe('Not discovered yet');
    map.close();
    map.open([0, 0], W, H);
    expect([caption.hidden, map.choosing, map.chosen]).toEqual([true, false, null]);
    expect(src.asked.length).toBeGreaterThan(0);
  });

  it('chooses nothing when no other teleporter is discovered', () => {
    const { map } = opened({ teleporters: [[0, 0]] });
    map.open([0, 0], W, H, true);
    expect(map.chosen).toBeNull();
  });

  it('follows a new window size, and draws nothing while closed or without a 2D context', () => {
    const { map, src, root } = opened();
    map.resize(400, 300);
    expect([root.querySelector('canvas')!.width, root.querySelector('canvas')!.height]).toEqual([400, 300]);
    map.close();
    const asks = src.asked.length;
    map.draw();
    expect(src.asked).toHaveLength(asks);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    map.open([0, 0], W, H);
    expect(src.asked).toHaveLength(asks);
  });
});
