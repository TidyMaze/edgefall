// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { REPEAT_DELAY } from './gamepad';
import { boot, type Game } from './test/harness';

// The gamepad on main.ts (#1252): it drives the keyboard's paths, the focus walk of the menus and the board's keys.

type Move = { cells: Axial[]; dir: number };
const A = 0, B = 1, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, VIEW = 8, START = 9, R3 = 11, DOWN = 13, LEFT = 14, RIGHT = 15;
const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
const rings = (game: Game): Axial[] => game.hook<Axial[]>('__rings');
const plies = (game: Game): number => game.hook<number>('__plies');
const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** A fake pad of the standard layout; `hold` sets what is held from the next frame on, `tap` presses and releases. */
function plugPad(game: Game): { hold: (buttons: number[], axes?: number[], values?: Record<number, number>) => void; tap: (button: number) => void; unplug: () => void } {
  let pads: unknown[] = [];
  Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
  const hold = (buttons: number[], axes = [0, 0, 0, 0], values: Record<number, number> = {}): void => {
    const pressed = Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: values[i] ?? (buttons.includes(i) ? 1 : 0) }));
    pads = [{ connected: true, mapping: 'standard', axes, buttons: pressed }];
    game.frame();
  };
  return {
    hold,
    tap: (button) => {
      hold([button]);
      hold([]);
    },
    unplug: () => {
      pads = [];
      game.frame();
      Reflect.deleteProperty(navigator, 'getGamepads');
    },
  };
}

// The Open world (#1252): the walk, the camera and the zoom on the Open world's own paths.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const data = (): DOMStringMap => document.body.dataset;
async function openWorldOn(game: Game): Promise<void> {
  byId('openworld').click();
  await settle();
}

describe('the gamepad in the Open world', () => {
  it('the left stick walks the hero and lets go when it rests, the D-pad and LB RB leave the focus alone', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    const focused = document.activeElement;
    expect(data().openworldAt).toBe('0,0');
    pad.hold([], [1, 0, 0, 0]);
    expect(data().openworldAt).not.toBe('0,0');
    pad.hold([]);
    expect(document.activeElement).toBe(focused);
    pad.unplug();
  });

  it('the stick is read in the yaw of the camera: the same push goes elsewhere after a turn', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    pad.hold([], [0, -1, 0, 0]);
    pad.hold([]);
    const first = data().openworldAt;
    pad.tap(RB);
    pad.tap(RB);
    pad.tap(RB);
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [], enemies: [] });
    pad.hold([], [0, -1, 0, 0]);
    pad.hold([]);
    expect(data().openworldAt).not.toBe(first);
    pad.unplug();
  });

  it('LB and RB turn the camera one step (Q and E), R3 resets it, and none of them moves the focus', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    const focused = document.activeElement;
    pad.tap(LB);
    expect(data().openworldYaw).toBe('30');
    pad.tap(RB);
    pad.tap(RB);
    expect(data().openworldYaw).toBe('-90');
    pad.tap(R3);
    expect(data().openworldYaw).toBe('-30');
    expect(document.activeElement).toBe(focused);
    pad.unplug();
  });

  it('the triggers zoom the Open world, the right stick does not touch the board view', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    const view = JSON.stringify(game.hook('__view'));
    const zoom = Number(data().openworldZoom);
    pad.hold([], [0, 0, 1, 0]);
    pad.hold([], undefined, { [LT]: 1 }); // out: the closest the camera goes is 1
    expect(Number(data().openworldZoom)).toBeGreaterThan(zoom);
    expect(JSON.stringify(game.hook('__view'))).toBe(view);
    pad.unplug();
  });

  it('View opens and closes the map; while it is open the stick pans it and the triggers zoom it, the hero and the camera stay (#1411)', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    pad.tap(VIEW);
    expect(document.getElementById('openworld-map')).not.toBeNull();
    const zoom = data().openworldZoom;
    pad.hold([], [1, 0, 0, 0]);
    pad.hold([]);
    pad.hold([], undefined, { [RT]: 1 });
    pad.hold([]);
    expect(data().openworldAt).toBe('0,0');
    expect(data().openworldZoom).toBe(zoom);
    pad.tap(B); // Back closes the map, as Escape does
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(data().openworld).toBe('7');
    pad.tap(VIEW);
    pad.tap(VIEW);
    expect(document.getElementById('openworld-map')).toBeNull();
    pad.unplug();
  });

  it('on a teleporter Y opens the map in the choice of a teleporter, and A picks the ringed one (#1412)', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    const fixture = (hero: Axial): void => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero, troop: [], enemies: [] });
    expect(data().openworldTeleporters).toBe('2,-1'); // only the spawn's is discovered
    const [q, r] = (await import('edgefall-wasm')).world_teleporters(7).slice(2, 4);
    const target: Axial = [q!, r!];
    fixture(target); // the hero goes there: it is discovered
    fixture([2, -1]); // and back on the spawn's
    pad.tap(Y);
    expect(byId('openworld-map-note').textContent).toBe('Choose a teleporter');
    pad.tap(A);
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(data().openworldAt).toBe(target.join(','));
    pad.unplug();
  });

  it('with the focus on a control, the stick and LB RB walk the focus and the hero stays', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    byId('openworld-dungeon').focus();
    pad.hold([], [1, 0, 0, 0]);
    pad.hold([]);
    pad.tap(RB);
    expect(data().openworldAt).toBe('0,0');
    expect(data().openworldYaw).toBe('-30');
    expect(document.activeElement).not.toBe(byId('openworld-dungeon'));
    pad.tap(R3); // a reset off the canvas is still the camera's
    pad.unplug();
  });

  it('the stick walks onto a lair, the pad plays the fight, and Back to the Open world is reached and pressed with the pad', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    const { Encounter } = await import('edgefall-wasm');
    const pad = plugPad(game);
    await openWorldOn(game);
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as [number, number];
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    pad.hold([], [0.9, -0.5, 0, 0]); // right and up in the default camera: the east step
    pad.hold([]);
    byId('hub-confirm-yes').click(); // the lair's bay asks first (#1694)
    expect(data().boss).toBeTruthy();
    const won = (): number => (plies(game) > 0 ? 1 : 0);
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(won);
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(won);
    canvas().focus();
    pad.tap(RB);
    const mv = game.hook<Move[]>('__legal').find((m) => m.cells.join() === rings(game).join())!;
    const angle = [0, 180, 60, 240, 120, 300][mv.dir]! * (Math.PI / 180);
    pad.hold([], [Math.cos(angle), -Math.sin(angle), 0, 0]);
    pad.hold([]);
    pad.tap(A);
    expect(byId('exit').hidden).toBe(false);
    const walkTo = (id: string): void => {
      for (let i = 0; i < 60 && document.activeElement !== byId(id); i++) pad.tap(RB);
      expect(document.activeElement).toBe(byId(id));
    };
    walkTo('exit'); // Back to the Open world is the first slot of the dock (#1517)
    pad.tap(A);
    await settle();
    expect(data().openworldAt).toBe(`${q - 1},${r}`);
    vi.restoreAllMocks();
    pad.unplug();
  });

  it('B leaves the Open world, as Esc does', async () => {
    const game = await boot('?bot=off&openworld=7');
    const pad = plugPad(game);
    await openWorldOn(game);
    pad.tap(B);
    expect(data().openworld).toBeUndefined();
    pad.unplug();
  });

  it('R3 on the board does nothing', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    pad.tap(R3);
    expect(plies(game)).toBe(0);
    pad.unplug();
  });
});

describe('the gamepad', () => {
  it('Start opens the settings menu and gives the focus to its button, B closes it', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    pad.tap(START);
    expect(byId('settings-menu').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('settings'));
    pad.tap(B);
    expect(byId('settings-menu').hidden).toBe(true);
    pad.unplug();
  });

  it('the D-pad walks the focus off the board, A presses the focused button', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    byId('hud-fold').focus();
    pad.tap(DOWN);
    expect(document.activeElement).not.toBe(byId('hud-fold'));
    pad.tap(LEFT); // back
    expect(document.activeElement).toBe(byId('hud-fold'));
    pad.tap(RB); // off the board, RB and LB walk the focus as Tab and Shift+Tab
    expect(document.activeElement).not.toBe(byId('hud-fold'));
    pad.tap(LB);
    expect(document.activeElement).toBe(byId('hud-fold'));
    pad.tap(A);
    expect(byId('hud-fold').getAttribute('aria-expanded')).toBe('false');
    pad.unplug();
  });

  it('on the board RB selects a group, the stick picks its direction, A plays it; the hints name the pad', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    canvas().focus();
    pad.tap(RB);
    expect(game.hud()).toContain('group 1 of');
    expect(game.hud()).toContain('LB RB to switch');
    expect(document.body.dataset.pad).toBe('');
    const mv = game.hook<Move[]>('__legal').find((m) => m.cells.join() === rings(game).join())!;
    const angle = [0, 180, 60, 240, 120, 300][mv.dir]! * (Math.PI / 180);
    pad.hold([], [Math.cos(angle), -Math.sin(angle), 0, 0]);
    pad.hold([]);
    expect(game.hud()).toContain('A to play');
    pad.tap(A);
    expect(plies(game)).toBe(1);
    pad.unplug();
  });

  it('RB past the last group leaves the board for the next control, as Tab does', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    canvas().focus();
    for (let i = 0; i < 60 && document.activeElement === canvas(); i++) pad.tap(RB);
    expect(document.activeElement).not.toBe(canvas());
    expect(rings(game)).toEqual([]);
    pad.unplug();
  });

  it('B backs out of the direction on the board, the D-pad aims there', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    canvas().focus();
    pad.tap(RB);
    pad.tap(RIGHT);
    expect(game.hud()).toMatch(/east/);
    pad.tap(B);
    expect(game.hud()).not.toMatch(/east/);
    expect(rings(game).length).toBeGreaterThan(0);
    pad.unplug();
  });

  it('a key press or a mouse move gives the keyboard hints back', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    canvas().focus();
    pad.tap(RB);
    canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.body.dataset.pad).toBeUndefined();
    expect(game.hud()).not.toContain('LB RB');
    pad.tap(RB);
    expect(document.body.dataset.pad).toBe('');
    dispatchEvent(new MouseEvent('mousemove'));
    expect(document.body.dataset.pad).toBeUndefined();
    pad.unplug();
  });

  it('the right stick orbits the camera, the right trigger zooms in', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    const before = game.hook<{ azimuth: number; distance: number }>('__view');
    pad.hold([], [0, 0, 1, 0]);
    pad.hold([], [0, 0, 1, 0]);
    expect(game.hook<{ azimuth: number }>('__view').azimuth).not.toBe(before.azimuth);
    pad.hold([], undefined, { [RT]: 1 });
    expect(game.hook<{ distance: number }>('__view').distance).toBeLessThan(before.distance);
    pad.unplug();
  });

  it('a pad that disconnects while held changes nothing', async () => {
    const game = await boot('?bot=off');
    const pad = plugPad(game);
    canvas().focus();
    pad.hold([RB]);
    const held = rings(game);
    pad.unplug();
    game.frame(REPEAT_DELAY);
    expect(rings(game)).toEqual(held);
    expect(plies(game)).toBe(0);
  });
});
