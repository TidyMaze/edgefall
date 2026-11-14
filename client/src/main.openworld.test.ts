// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { indexedDbStore } from './idb';
import { GLIDE_MS } from './openworldglide';
import { OPEN_WORLD_POINT_LIGHTS } from './quality';
import { NEON_OPEN_WORLD_POINT_LIGHTS } from './neonfx';
import { SLIDE_MS } from './slide';
import './test/openworldwasm';
import { world_can_break } from 'edgefall-wasm';
import { boot, type Game } from './test/harness';
import { signBeaten, signBreak, signLair } from './worldevents';
import { generateKeys } from './moverecord';
import { BREAK_BYTES, encodeBreak, encodeTroop } from './worldpeers';
import { decode, encodeHello, encodePos, PUBLIC_SEED } from './worldpeers';

// The Open world mode (#962, docs/specs/openworld.md): its entry is in the mode menu for everyone (#1000), ?openworld=<seed>
// fixes the seed, it draws its own scene in place of the board's, and body[data-openworld] and [data-openworld-at] name
// the seed and the hero's cell, read by the e2e tests.

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset; // the page swaps the body at each boot
const press = (key: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

// The menu's click reads the saved world first: IndexedDB answers in a few tasks.
/** Escape lands in the Hub (#1605): Browser Back from the Hub goes on to the table. */
const toTable = async (game: Game): Promise<void> => {
  game.frame(); // the frame that pushes the entry of the Hub
  const popped = new Promise((done) => window.addEventListener('popstate', done, { once: true }));
  history.back();
  await popped;
  await game.settle();
};
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};

const release = (key: string): void => {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
};

// The test hooks of the Open world, on a webdriver page only (docs/specs/openworld.md section 6).
type Cells = [number, number][];
type Hooks = { __openworldFixture?: (f: { hero: [number, number]; troop: Cells; enemies: Cells }) => void; __openworldEnemies?: () => Cells; __openworldCamera?: (at?: number) => { zoom: number; shake: number; centre: number[]; reach: number } };
const hooks = () => window as unknown as Hooks;

describe('the Open world mode', () => {
  it('the troop pushes the enemy in front of it after a step, through the engine: the hero, the troop and the enemy move, #967', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    hooks().__openworldFixture!({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    press('ArrowRight'); // the hero rolls onto (1,0): the line (1,0), (0,0), (-1,0) pushes the enemy (2,0) on to (3,0)
    expect(data().openworldAt).toBe('2,0');
    expect(data().openworldPush).toBe('1');
    expect(data().openworldTroop).toBe('1,0 0,0');
    expect(hooks().__openworldEnemies!()).toEqual([[3, 0]]);
  });

  it('the fresh hook opens the world again from the spawn, reads no save and unfolds the plate, so a spec can share one page (#1481)', async () => {
    const game = await boot('?bot=off&openworld=7');
    const fresh = (): Promise<void> => (window as unknown as { __openworldFresh: () => Promise<void> }).__openworldFresh();
    game.openModes();
    byId('openworld').click();
    await settle();
    hooks().__openworldFixture!({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    press('ArrowRight');
    expect(data().openworldAt).toBe('2,0');
    press('Escape'); // leaving saves the world at 2,0
    await settle();
    await fresh(); // the world is not active: it is entered
    await settle();
    expect(data().openworld).toBe('7');
    expect(data().openworldAt).toBe('0,0'); // the spawn, not the saved 2,0
    expect(hooks().__openworldEnemies!()).not.toEqual([[3, 0]]);
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
      press(key);
      release(key);
      await settle();
    }
    expect(byId('openworld-hud').dataset.folded).toBe('1'); // 3 steps folded the plate
    await fresh(); // the world is active: it is left, then entered
    await settle();
    expect(data().openworldAt).toBe('0,0');
    expect(byId('openworld-hud').dataset.folded).toBeUndefined(); // the plate is shown again
  });

  it('reads the frames the world has drawn since the open through a test hook: none in a page that has not drawn it, #1601', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    expect((window as unknown as { __openworldDrawn: () => number }).__openworldDrawn()).toBe(0); // jsdom has no WebGL: the mode counts the draws (openworldmodewander.test.ts)
  });

  it('builds the world programs behind the veil before its first frame, then draws it and lifts the veil, #1582', async () => {
    let compiled = (): void => {};
    const game = await boot('?bot=off&openworld=7', { compile: () => new Promise<void>((done) => (compiled = done)) });
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
    expect(data().veil).toBe('on'); // the compile runs from the open on, after a draw of the hero alone
    const draws = game.draws();
    game.frame(); // a frame during the compile draws nothing
    expect(game.draws()).toBe(draws);
    expect(data().veil).toBe('on');
    compiled();
    await settle();
    expect(game.draws()).toBe(draws + 2); // the shadow pass of each half of the scene, still veiled
    expect(data().veil).toBe('on');
    game.frame();
    expect(game.draws()).toBe(draws + 3);
    expect(data().veil).toBeUndefined();
  });

  it('reads what the camera draws through a test hook, at rest: the shake is 0, #1103', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const camera = hooks().__openworldCamera!();
    expect(camera.shake).toBe(0);
    expect(camera.zoom).toBeGreaterThan(0);
    expect(camera.centre).toHaveLength(2);
    expect(hooks().__openworldCamera!(performance.now() + 5000).shake).toBe(0); // given a time, it draws the camera at it first (#1436)
  });

  it('reads a scene mesh\'s look through a test hook: an instanced mesh with its colours, a plain one without, #1558', async () => {
    const game = await boot('?bot=off&openworld=7');
    const mesh = (window as unknown as { __openworldMesh: (name: string) => { count: number; instance: number[] | null } }).__openworldMesh;
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(mesh('enemies').instance).toHaveLength(3); // an instanced mesh: its first colour, r g b
    expect(mesh('hero').instance).toBeNull(); // the hero is one plain mesh: no instance colours
    expect(() => (window as unknown as { __openworldZoom: (scale: number) => void }).__openworldZoom(0.5)).not.toThrow(); // the zoom hook, as the wheel: a close capture
  });

  it('counts the point lights of the scene it draws: none in the Open world, within the budget (#1234)', async () => {
    const game = await boot('?bot=off&openworld=7&scene=room');
    const cost = () => (window as unknown as { __renderCost: { pointLights: number } }).__renderCost;
    expect(cost().pointLights).toBeGreaterThan(OPEN_WORLD_POINT_LIGHTS);
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(cost().pointLights).toBeLessThanOrEqual(NEON_OPEN_WORLD_POINT_LIGHTS); // the default neon look's two accents, lit since the open builds its programs with them (#1582)
  });

  it('exposes no test hook on a page that is not a webdriver one', async () => {
    delete hooks().__openworldFixture;
    await boot('?bot=off&openworld=7', { webdriver: false });
    expect(hooks().__openworldFixture).toBeUndefined();
  });

  it('is in the mode menu without any parameter, and a click enters the public world, #1305', async () => {
    const game = await boot('?bot=off');
    expect(byId('openworld').hidden).toBe(false);
    expect(press('Escape').defaultPrevented).toBe(false); // not on: the keys are the page's
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(data().openworld).toBe(String(PUBLIC_SEED));
    expect(data().openworldAt).toBe('0,0');
  });

  it('enters a world by its seed, rolls the hero by the arrow keys, and leaves on Escape', async () => {
    const game = await boot('?bot=off&openworld=7');
    expect(byId('openworld').hidden).toBe(false);
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(data().openworld).toBe('7');
    expect(data().openworldAt).toBe('0,0');
    await game.settle(); // the models load: none on the empty scene of the harness
    game.frame();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(data().openworldAt).toBe('1,0');
    expect(press('a').defaultPrevented).toBe(false);
    byId('openworld').ownerDocument.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
    game.frame();
    press('m'); // the map open: Escape closes it first and the world stays (#1605)
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(data().openworld).toBe('7');
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(data().openworld).toBeUndefined();
    expect(game.hud()).toContain('Hub'); // Escape presses the exit of the dock, as Browser Back does: the Hub, not the table beneath (#1605)
  });

  it('Escape closes the terminal reader opened from the log archive in the world, then the sheets of the page, and only then leaves it, #1591', async () => {
    const game = await boot('?bot=off&openworld=7');
    localStorage.setItem('ab-alone.lore-read', 'cargo-assay');
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
    game.frame();
    press('ArrowRight');
    expect(data().openworldAt).toBe('1,0');
    game.openSettings();
    byId('setting-log-archive').click();
    document.querySelector<HTMLButtonElement>('.setting-archive button')!.click();
    expect(data().reading).toBe('cargo-assay');
    press('Escape'); // the reader closes, the world stays where it was
    expect(data().reading).toBeUndefined();
    expect(byId('reader').hidden).toBe(true);
    expect(data().openworld).toBe('7');
    expect(data().openworldAt).toBe('1,0');
    game.openSettings(); // the settings menu too: its Escape closes it only
    expect(byId('settings').getAttribute('aria-expanded')).toBe('true');
    press('Escape');
    expect(byId('settings').getAttribute('aria-expanded')).toBe('false');
    expect(data().openworld).toBe('7');
    game.openModes(); // and the Game modes menu
    expect(byId('modes').getAttribute('aria-expanded')).toBe('true');
    press('Escape');
    expect(byId('modes').getAttribute('aria-expanded')).toBe('false');
    expect(data().openworld).toBe('7');
    press('Escape'); // no sheet open: the world is left
    expect(data().openworld).toBeUndefined();
  });

  it('rolls the hero by a press on the screen, and keeps the board out of it', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    document.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointerdown', { clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true }));
    expect(data().openworldAt).toBe('0,0'); // the centre is the hero's own cell
  });

  it('takes a world of its own when no seed is given, and keeps the hub keys out while it is on', async () => {
    const game = await boot('?bot=off&openworld');
    game.openModes();
    byId('ship').click();
    const hub = data().hub;
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(Number(data().openworld)).toBeGreaterThan(0);
    press('ArrowRight');
    expect(data().hub).toBe(hub); // the hub's marble did not roll
    expect(data().openworldAt).toBe('1,0');
  });

  it('rolls the hero on the diagonal while a vertical and a horizontal arrow are held, and lets go on keyup or blur, #977', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    press('ArrowLeft'); // (0, -1), up-left (#1273)
    press('ArrowUp'); // Left and Up held: up-left on the next step of the cadence (#1059)
    game.frame(GLIDE_MS);
    expect(data().openworldAt).toBe('0,-2');
    release('ArrowLeft');
    game.frame(GLIDE_MS); // Left let go: a single Up, north-east at the default camera, (1, -3)
    expect(data().openworldAt).toBe('1,-3');
    window.dispatchEvent(new Event('blur')); // the window loses focus: nothing is held any more
    press('ArrowRight'); // single, not up-right with the Up still held: (2, -3)
    expect(data().openworldAt).toBe('2,-3');
  });

  it('steps an arrow at its keydown, ignores the key repeat, and walks on the frames while it is held, #1059', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(data().openworldAt).toBe('1,0'); // the first step, on the keydown
    const repeat = new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true });
    window.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true); // no page scroll on the repeat either
    expect(data().openworldAt).toBe('1,0'); // and no step
    game.frame(GLIDE_MS);
    expect(data().openworldAt).toBe('2,0'); // the cadence of the held arrow
    release('ArrowRight');
    game.frame(GLIDE_MS);
    expect(data().openworldAt).toBe('2,0'); // let go: no more steps
  });

  it('turns the Open world camera with a right-button drag and with a twist of two fingers, and shows no menu over it, #1026', async () => {
    const game = await boot('?bot=off&openworld=7');
    const canvas = document.querySelector('canvas')!;
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false); // not the Open world: the board keeps its menu
    game.openModes();
    byId('openworld').click();
    await settle();
    const at = (type: string, id: number, x: number, y: number, button = 0) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'pointerId', { value: id });
      canvas.dispatchEvent(e);
    };
    const yawOf = () => Number(data().openworldYaw);
    at('pointerdown', 5, 300, 300, 2); // the right button turns the camera, it does not roll the hero
    expect(data().openworldAt).toBe('0,0');
    at('pointermove', 5, 340, 300, 2); // 40 px to the right: 20 degrees
    expect(yawOf()).toBe(-10); // from the default, -30
    at('pointerup', 5, 340, 300, 2); // released: it settles on the nearest resting angle (#1251, #1254)
    expect(yawOf()).toBe(-30);
    at('pointermove', 5, 360, 300, 2); // no turn after the release
    expect(yawOf()).toBe(-30);
    const shown = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    canvas.dispatchEvent(shown);
    expect(shown.defaultPrevented).toBe(true);
    at('pointerdown', 6, 600, 300);
    at('pointerdown', 7, 700, 300); // two fingers, a quarter turn of the pair
    at('pointermove', 7, 700, 400); // 45 degrees on, from -30 to 15
    expect(yawOf()).toBe(15);
    at('pointerup', 6, 600, 300); // a finger up: it settles on 30 degrees
    expect(yawOf()).toBe(30);
    at('pointerup', 7, 700, 400);
    expect(yawOf()).toBe(30);
  });

  it('the camera turn is saved when the world is left and resumes when it is entered again, #1026', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(data().openworldYaw).toBe('-30');
    press('q');
    expect(data().openworldYaw).toBe('30');
    press('Escape'); // leaving saves the world with its turn
    await settle();
    game.openModes();
    byId('openworld').click(); // the saved world is read
    await settle();
    expect(data().openworldYaw).toBe('30');
  });

  it('zooms the Open world out with the wheel and with a pinch, #976', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const canvas = document.querySelector('canvas')!;
    const zoomOf = () => Number(data().openworldZoom);
    const wheel = (deltaY: number) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
    const finger = (type: string, id: number, x: number) => {
      const e = new MouseEvent(type, { clientX: x, clientY: 300, bubbles: true });
      Object.defineProperty(e, 'pointerId', { value: id });
      canvas.dispatchEvent(e);
    };
    wheel(1000);
    expect(zoomOf()).toBeGreaterThan(2.5); // far out, still the 3D view
    wheel(-1000);
    expect(zoomOf()).toBe(1);
    finger('pointermove', 9, 100); // a hover, no finger down: nothing
    finger('pointerdown', 1, 300);
    finger('pointermove', 1, 300); // one finger moves, not apart: nothing
    expect(zoomOf()).toBe(1);
    finger('pointerdown', 2, 700); // two fingers 400 apart
    finger('pointermove', 2, 500); // 200 apart: the camera goes back
    expect(zoomOf()).toBe(2);
    finger('pointermove', 2, 700); // 400 apart again: closer
    expect(zoomOf()).toBe(1);
    finger('pointerup', 1, 300);
    finger('pointerup', 2, 700);
  });

  // The save of the Open world (#968): the menu resumes the last world played, a seed in the URL resumes its own, `new` starts afresh.
  const openFrom = async (url: string, indexedDB: IDBFactory) => {
    const game = await boot(url, { indexedDB });
    game.openModes();
    byId('openworld').click();
    await settle();
    return game;
  };

  it('the menu entry resumes the last world played: its seed, the hero where it was left', async () => {
    const idb = new IDBFactory();
    const game = await openFrom('?bot=off', idb);
    const seed = data().openworld!;
    press('ArrowRight'); // the hero rolls to (1,0)
    game.frame();
    await settle();
    expect(data().openworldSaved).toBe('1');
    await openFrom('?bot=off', idb);
    expect(data().openworld).toBe(seed);
    expect(data().openworldAt).toBe('1,0');
  });

  it('the menu entry opens the public world when the last one has no save of its own', async () => {
    const idb = new IDBFactory();
    const game = await openFrom('?bot=off&openworld=7', idb);
    press('ArrowRight');
    game.frame();
    await settle();
    await indexedDbStore().delete('openworld:7');
    await openFrom('?bot=off', idb);
    expect(data().openworld).toBe(String(PUBLIC_SEED));
    expect(data().openworldAt).toBe('0,0');
  });

  it('keeps the menu of a profile with a saved public world, so the Open world does not lead it (#1612)', async () => {
    const idb = new IDBFactory();
    const game = await openFrom('?bot=off', idb);
    press('ArrowRight');
    game.frame();
    await settle();
    expect(data().openworldSaved).toBe('1');
    await boot('?bot=off', { indexedDB: idb });
    expect(byId('open-world-entry').hidden).toBe(true);
  });

  it('a seed in the URL resumes its own save', async () => {
    const idb = new IDBFactory();
    const game = await openFrom('?bot=off&openworld=7', idb);
    press('ArrowRight');
    game.frame();
    await settle();
    await openFrom('?bot=off&openworld=7', idb);
    expect(data().openworld).toBe('7');
    expect(data().openworldAt).toBe('1,0');
  });

  it('?openworld=new starts a fresh random world, although a last world is saved', async () => {
    const idb = new IDBFactory();
    const game = await openFrom('?bot=off', idb);
    const seed = data().openworld!;
    press('ArrowRight');
    game.frame();
    await settle();
    await openFrom('?bot=off&openworld=new', idb);
    expect(data().openworld).not.toBe(seed);
    expect(data().openworldAt).toBe('0,0');
  });

  it('counts the frames really drawn in its FPS readout: 50 FPS at 20 ms a frame, #1064', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('setting-fps').click();
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
    game.frame(20); // the first draw
    press('ArrowRight'); // a glide: every frame draws
    release('ArrowRight');
    for (let i = 0; i < 6; i++) game.frame(20);
    expect(byId('fps').textContent).toBe('50 FPS');
  });

  it('moves the Open world on the time of the animation frame, not the moment its callback runs, #1333', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const { OpenWorldMode } = await import('./openworldmode'); // the page's own module: the harness loads a fresh one at each boot
    const frame = vi.spyOn(OpenWorldMode.prototype, 'frame');
    const at = performance.now();
    game.frame(16);
    expect(frame).toHaveBeenLastCalledWith(expect.any(Function), at + 16);
  });

  it('reads idle in its FPS readout when a still scene draws nothing, and the diagnostics follow, #1064', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true }); // no water to animate: a still scene draws once
    byId('setting-fps').click();
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
    for (let i = 0; i < 40; i++) game.frame(20);
    expect(byId('fps').textContent).toBe('idle');
    press('ArrowRight');
    release('ArrowRight');
    for (let i = 0; i < 3; i++) game.frame(20); // a step and nothing after it
    expect(byId('fps').textContent).toBe('idle');
    byId('copy-diagnostics').click();
    await game.settle();
    expect(JSON.parse(byId<HTMLTextAreaElement>('diagnostics').value).environment.fps).toBe(0);
  });
});

// The board's keys in the Open world (#1063): none reaches the board game, its replay, its selection or its moves, and
// leaving the world gives the board back as it was.
describe('the board keys in the Open world, #1063', () => {
  const canvasKey = (key: string): void => {
    document.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  /** Two plies by two clicks each, the slides let go. */
  const playTwo = (game: Game): void => {
    for (let i = 0; i < 2; i++) {
      const mv = game.hook<{ cells: Axial[]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
      game.click(...mv.cells[0]!);
      const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
      game.click(...target.cell);
      game.frame(SLIDE_MS);
    }
  };
  const enterWorld = async (game: Game): Promise<void> => {
    game.openModes();
    byId('openworld').click();
    await settle();
    await game.settle();
  };

  it('the arrows roll the hero and do not open the replay of the board', async () => {
    const game = await boot('?bot=off&openworld=7');
    playTwo(game);
    const turn = game.turn();
    await enterWorld(game);
    press('ArrowLeft');
    expect(data().openworldAt).toBe('0,-1');
    expect(byId('replay-bar').hidden).toBe(true);
    expect(game.turn()).toBe(turn);
    expect(game.hook('__plies')).toBe(2);
  });

  it('the board selection and moves ignore Tab, Q, E, A, S, D, Enter on the focused canvas', async () => {
    const game = await boot('?bot=off&openworld=7');
    await enterWorld(game);
    document.querySelector('canvas')!.focus();
    canvasKey('Tab');
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    for (const key of ['q', 'e', 'a', 's', 'd', 'Enter']) canvasKey(key);
    expect(data().ghosts).not.toBe('1');
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    expect(game.hook('__plies')).toBe(0);
  });

  it('a replay open before the Open world stays as it was while the world is open, and Escape is not the board\'s Live', async () => {
    const game = await boot('?bot=off&openworld=7');
    playTwo(game);
    byId('replay').click();
    byId('replay-prev').click();
    const shown = byId('replay-label').textContent;
    await enterWorld(game);
    press('ArrowRight'); // the Open world's arrow: the board's replay does not step
    press('m');
    press('Escape'); // closes the map: the world stays and the replay is not Live
    expect(data().openworld).toBe('7');
    expect(byId('replay-label').textContent).toBe(shown);
    expect(byId('replay-bar').hidden).toBe(false);
    press('Escape'); // leaves the Open world for the Hub, as its exit does (#1605)
    expect(data().openworld).toBeUndefined();
    expect(data().hub).toBeDefined();
  });

  it('the board takes its keys back once the Open world is left', async () => {
    const game = await boot('?bot=off&openworld=7');
    await enterWorld(game);
    press('Escape');
    expect(data().openworld).toBeUndefined();
    await toTable(game);
    document.querySelector('canvas')!.focus();
    canvasKey('Tab');
    expect(game.hook<Axial[]>('__rings').length).toBeGreaterThan(0);
  });

  it('the Steering setting is on by default, names the mode in the HUD, and flips, #1137', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const row = byId('setting-steering');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(byId('openworld-mode').textContent).toContain('Steering on');
    row.click();
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(byId('openworld-mode').textContent).toContain('Steering off');
    row.click();
    expect(byId('openworld-mode').textContent).toContain('Steering on');
  });

  it('a drag of the camera ends a walk to a far cell without error, #1137', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const canvas = document.querySelector('canvas')!;
    const at = (type: string, id: number, x: number, y: number, button = 0) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'pointerId', { value: id });
      canvas.dispatchEvent(e);
    };
    at('pointerdown', 5, 300, 300, 2);
    at('pointermove', 5, 340, 300, 2);
    expect(data().openworldRoute).toBe('0');
    at('pointerup', 5, 340, 300, 2);
  });
});

// The public world online (#1305): one fixed seed, one room, the other heroes' markers and edge indicators. New world and any other
// seed stay private and offline. An automated page stays offline unless it asks for the hook transport or the opt-in.
describe('the public Open world online', () => {
  const peersRoot = () => byId<HTMLElement>('openworld-peers');
  const enter = async (url: string, options?: Parameters<typeof boot>[1]) => {
    const game = await boot(url, options);
    game.openModes();
    byId('openworld').click();
    await settle();
    return game;
  };

  it('joins its room after Accept, greets a peer, sends the step, and shows a far hero at the screen edge', async () => {
    const game = await boot('?bot=off&consent');
    game.openModes();
    byId('openworld').click();
    await settle();
    expect(byId('consent').hidden).toBe(false); // asked first
    expect(game.world()).toBeNull(); // nothing contacted before Accept
    byId('consent-accept').click();
    await settle();
    const room = game.world()!;
    expect(room.room).toBe(`ow:${PUBLIC_SEED}:0`);
    expect(data().openworld).toBe(String(PUBLIC_SEED));
    game.frame(16); // the hero's place goes out
    room.join('p');
    const sent = room.sent.map(([d, to]) => [decode(d), to] as const);
    expect(sent.map(([m, to]) => [m!.t, to])).toEqual([['pos', undefined], ['troop', undefined], ['hello', 'p'], ['pos', 'p'], ['troop', 'p']]);
    expect(sent[0]![0]).toEqual({ t: 'pos', q: 0, r: 0, seq: 0 });
    expect((sent[1]![0] as { offsets: unknown[] }).offsets).toHaveLength(15); // the troop starts at 15 marbles
    expect(room.sent[1]![0]).toHaveLength(33); // 3 + 2 * 15 bytes
    room.data(encodeHello(), 'p');
    room.data(encodeHello(), 'p');
    room.data(encodePos(200, 0, 0), 'p');
    game.frame(16);
    expect(peersRoot().hidden).toBe(false);
    expect(peersRoot().dataset.edges).toBe('200');
    expect(peersRoot().children[0]!.getAttribute('aria-label')).toBe('Another hero, 200 tiles away');
    room.data(encodeHello(), 'q');
    room.data(encodePos(1, 0, 0), 'q');
    room.data(encodeTroop([[1, 0], [0, 1]]), 'q'); // the army of a second hero, next to ours
    game.frame(16);
    expect(peersRoot().dataset.peers).toBe('2'); // two heroes, however many marbles
    press('ArrowRight');
    game.frame(300);
    const [q, r] = data().openworldAt!.split(',').map(Number) as [number, number]; // the step, maybe carried on by the troop's push
    expect(q).toBeGreaterThan(0);
    expect(decode(room.sent.filter(([d]) => d[1] === 2).at(-1)![0])).toEqual({ t: 'pos', q, r, seq: 1 });
    expect(decode(room.sent.filter(([d]) => d[1] === 4).at(-1)![0])).toMatchObject({ t: 'troop' }); // the troop followed the hero
    expect(peersRoot().dataset.edges).toBe(String(Math.max(Math.abs(200 - q), Math.abs(r), Math.abs(200 - q + r))));
    press('Escape'); // leaving the world leaves the room and clears the screen
    expect(room.closed).toBe(true);
    expect(peersRoot().hidden).toBe(true);
  });

  it('Stay solo opens the same world with no room', async () => {
    const game = await boot('?bot=off&consent');
    game.openModes();
    byId('openworld').click();
    await settle();
    byId('consent-stay').click();
    await settle();
    expect(data().openworld).toBe(String(PUBLIC_SEED));
    expect(game.world()).toBeNull();
    expect(peersRoot().hidden).toBe(true);
    expect(localStorage.getItem('ab-alone.online-consent')).toBeNull();
  });

  it('an automated page stays offline in the public world unless it asks for the opt-in or the hook', async () => {
    const game = await enter('?bot=off');
    expect(data().openworld).toBe(String(PUBLIC_SEED));
    expect(game.world()).toBeNull();
  });

  it('asks a real browser too, and a private seed never asks nor connects', async () => {
    const real = await boot('?bot=off&unlock', { webdriver: false });
    real.openModes();
    byId('openworld').click();
    await settle();
    expect(byId('consent').hidden).toBe(false);
    byId('consent-stay').click();
    await settle();
    const private7 = await enter('?bot=off&consent&openworld=7');
    expect(byId('consent').hidden).toBe(true);
    expect(private7.world()).toBeNull();
  });

  it('under ?net=hook the test page drives the room: Hello out on a join, a far hero in, no network', async () => {
    const w = window as unknown as Record<string, unknown>;
    const out: [number[], string | undefined][] = [];
    const game = await boot(`?bot=off&net=hook&openworld=${PUBLIC_SEED}`);
    game.openModes();
    w.__netPeerOut = (d: Uint8Array, to?: string) => out.push([Array.from(d), to]);
    byId('openworld').click();
    await settle();
    (w.__netPeerJoin as (p: string) => void)('p');
    expect(out).toContainEqual([[2, 1], 'p']);
    (w.__netPeerIn as (d: number[], p: string) => void)([2, 1], 'p');
    (w.__netPeerIn as (d: number[], p: string) => void)(Array.from(encodePos(0, 60, 0)), 'p');
    expect(peersRoot().dataset.edges).toBeUndefined(); // drawn by the next frame
    game.frame(16);
    expect(peersRoot().dataset.edges).toBe('60');
  });

  // The player's controls (#1305): a public name, Hide, and the connection status, in the HUD of the public world only.
  const joined = async (): Promise<Game> => {
    const game = await boot('?bot=off&consent');
    game.openModes();
    byId('openworld').click();
    await settle();
    byId('consent-accept').click();
    await settle();
    return game;
  };
  const netText = () => byId<HTMLElement>('openworld-net').textContent;

  it('shows the connection status and the controls in the public world, and none in a private one', async () => {
    await joined();
    expect(byId('openworld-online').hidden).toBe(false);
    expect(netText()).toBe('Online: nobody else here yet.');
    expect(byId('openworld-hide').textContent).toBe('Hide');
    await enter('?bot=off&openworld=7');
    expect(byId('openworld-online').hidden).toBe(true);
  });

  it('sends a typed public name in a new Hello, keeps it for the next visit, and cuts it at 16 characters', async () => {
    const game = await joined();
    const room = game.world()!;
    const input = byId<HTMLInputElement>('openworld-name');
    input.value = '  Ana\u0000  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(decode(room.sent.at(-1)![0])).toEqual({ t: 'hello', name: 'Ana' });
    expect(localStorage.getItem('ab-alone.public-name')).toBe('Ana');
    input.value = 'x'.repeat(30);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(localStorage.getItem('ab-alone.public-name')).toBe('x'.repeat(16));
    expect(input.maxLength).toBe(16);
  });

  it('greets with the stored name and fills the field from it', async () => {
    const game = await boot('?bot=off&consent');
    localStorage.setItem('ab-alone.public-name', 'Zed'); // the boot clears the storage
    game.openModes();
    byId('openworld').click();
    await settle();
    byId('consent-accept').click();
    await settle();
    expect(byId<HTMLInputElement>('openworld-name').value).toBe('Zed');
    game.world()!.join('p');
    expect(decode(game.world()!.sent[0]![0])).toEqual({ t: 'hello', name: 'Zed' });
    localStorage.removeItem('ab-alone.public-name');
  });

  it('keys typed in the name field are the field\'s: the hero does not walk, the camera does not turn, Escape does not leave', async () => {
    await joined();
    const at = data().openworldAt;
    const input = byId<HTMLInputElement>('openworld-name');
    for (const key of ['ArrowRight', 'q', 'Escape']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(data().openworldAt).toBe(at);
    expect(data().openworld).toBe(String(PUBLIC_SEED));
  });

  it('the Say menu opens, sends the index of an emote or phrase once per 2 s, and lists the heroes nearby (#1671)', async () => {
    const game = await joined();
    const room = game.world()!;
    expect(byId('openworld-emotes').hidden).toBe(true);
    byId('openworld-emote').click();
    expect(byId('openworld-emotes').hidden).toBe(false);
    expect(byId('openworld-emote').getAttribute('aria-expanded')).toBe('true');
    const buttons = [...byId('openworld-emotes').querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Wave', 'GG', 'Follow me', 'Hello', 'Duel?', 'Thanks']);
    buttons[3]!.click();
    expect(decode(room.sent.at(-1)![0])).toEqual({ t: 'emote', id: 3 });
    const count = room.sent.length;
    buttons[4]!.click(); // inside 2 s: dropped
    expect(room.sent).toHaveLength(count);
    expect(byId('openworld-hud').dataset.say).toBe(''); // the plate shrinks while the menu is open
    byId('openworld-emote').click();
    expect(byId('openworld-emotes').hidden).toBe(true);
    expect(byId('openworld-hud').dataset.say).toBeUndefined();
    byId('openworld-emote').click();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    byId('openworld-emote').dispatchEvent(esc);
    expect(byId('openworld-emotes').hidden).toBe(true); // Escape closes the menu
    expect(data().openworld).toBe(String(PUBLIC_SEED)); // and does not leave the world
    byId('openworld-emote').dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true })); // another key with the menu shut: nothing
    byId('openworld-emote').click();
    byId('openworld-emote').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); // another key with the menu open: kept
    expect(byId('openworld-emotes').hidden).toBe(false);
    byId('openworld-hide').click();
    expect(byId('openworld-emotes').hidden).toBe(true); // Hide closes it
    expect((byId('openworld-emote') as HTMLButtonElement).disabled).toBe(true);
    byId('openworld-hide').click();
    expect((byId('openworld-emote') as HTMLButtonElement).disabled).toBe(false);
    const again = game.world()!; // Show joined a new room
    again.data(encodeHello('<b>Ana</b>'), 'p');
    again.data(encodePos(5, 0, 0), 'p');
    game.frame(16);
    const items = [...byId('openworld-nearby').querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual(['<b>Ana</b>, 5 tiles away']); // text, never markup
    expect(byId('openworld-nearby').querySelector('b')).toBeNull();
  });

  it('Hide leaves the room and Show joins a new one', async () => {
    const game = await joined();
    const first = game.world()!;
    byId('openworld-hide').click();
    expect(first.closed).toBe(true);
    expect(netText()).toBe('Hidden: nobody sees you and you see nobody.');
    expect(byId('openworld-hide').textContent).toBe('Show');
    expect(byId('openworld-hide').getAttribute('aria-pressed')).toBe('true');
    byId('openworld-hide').click();
    expect(game.world()).not.toBe(first);
    expect(game.world()!.closed).toBe(false);
    expect(byId('openworld-hide').textContent).toBe('Hide');
    expect(byId('openworld-hide').getAttribute('aria-pressed')).toBe('false');
  });

  it('tells the player when the connection to another hero fails', async () => {
    const game = await joined();
    game.world()!.error('could not connect to peer p after exchanging SDP');
    expect(netText()).toContain('the direct connection failed');
  });

  // The signed break events (#1305): what the hero breaks goes out signed with its stored key, what a peer broke opens here.
  const obstacleBeside = (skip = 0): { hero: [number, number]; cell: [number, number] } => {
    const around: [number, number][] = [[-1, 0], [1, 0]]; // beside it on its row: a plain Right or Left arrow steps onto it
    for (let q = -30; q <= 30; q++) {
      for (let r = -30; r <= 30; r++) {
        if (!world_can_break(PUBLIC_SEED, q, r)) continue;
        const free = around.map(([dq, dr]): [number, number] => [q + dq, r + dr]).find(([a, b]) => !world_can_break(PUBLIC_SEED, a, b));
        if (free && skip-- === 0) return { hero: free, cell: [q, r] };
      }
    }
    throw new Error('no boulder or tree near the spawn');
  };

  it('signs the obstacle the hero breaks with its stored key and sends 106 bytes; a peer applies the same event once', async () => {
    const game = await joined();
    const room = game.world()!;
    const { hero, cell } = obstacleBeside();
    const canBreak = (window as unknown as { __openworldCanBreak: (seed: number, q: number, r: number) => boolean }).__openworldCanBreak; // the test hook of the e2e
    expect(canBreak(PUBLIC_SEED, cell[0], cell[1])).toBe(true);
    expect(canBreak(PUBLIC_SEED, 0, 0)).toBe(false); // the spawn clearing
    const fixture = () => hooks().__openworldFixture!({ hero, troop: [], enemies: [] });
    fixture();
    const key = hero[0] < cell[0] ? 'ArrowRight' : 'ArrowLeft';
    press(key);
    release(key);
    game.frame(300);
    expect(data().openworldBroken).toBe('1');
    for (let i = 0; i < 40 && !room.sent.some(([d]) => d.length === BREAK_BYTES); i++) await new Promise((done) => setTimeout(done, 10));
    const sent = room.sent.find(([d]) => d.length === BREAK_BYTES)!;
    expect(sent[1]).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('ab-alone.world-key')!).pub).toHaveLength(43);
    // a peer breaks another obstacle: it opens here, once
    const other = obstacleBeside(1).cell;
    const keys = await generateKeys();
    const event = await signBreak(keys, PUBLIC_SEED, other[0], other[1]);
    room.data(encodeBreak(event), 'p');
    for (let i = 0; i < 40 && data().openworldBroken === '1'; i++) await new Promise((done) => setTimeout(done, 10));
    expect(data().openworldBroken).toBe('2');
  });

  it('a peer beats an enemy of the world: it is gone here, once (#1305)', async () => {
    const game = await joined();
    const room = game.world()!;
    const isEnemy = (window as unknown as { __openworldIsEnemy: (seed: number, q: number, r: number) => boolean }).__openworldIsEnemy; // the test hook of the e2e
    let cell: [number, number] | undefined;
    for (let q = -40; q <= 40 && !cell; q++) for (let r = -40; r <= 40 && !cell; r++) if (isEnemy(PUBLIC_SEED, q, r)) cell = [q, r];
    const event = await signBeaten(await generateKeys(), PUBLIC_SEED, cell![0], cell![1]);
    room.data(encodeBreak(event), 'p');
    for (let i = 0; i < 40 && data().openworldBeaten !== '1'; i++) await new Promise((done) => setTimeout(done, 10));
    expect(data().openworldBeaten).toBe('1');
  });

  it('a peer takes a boss lair: it is heard, but not filed as beaten here (#1305, a stranger cannot finish the world)', async () => {
    const game = await joined();
    const room = game.world()!;
    const lairs = (window as unknown as { __openworldLairs: (seed: number) => [number, number][] }).__openworldLairs(PUBLIC_SEED); // the test hook of the e2e
    const [q, r] = lairs[0]!;
    const event = await signLair(await generateKeys(), PUBLIC_SEED, q, r);
    room.data(encodeBreak(event), 'p');
    for (let i = 0; i < 200 && data().openworldLairsHeard !== '0'; i++) await new Promise((done) => setTimeout(done, 10));
    expect(data().openworldLairsHeard).toBe('0'); // the event landed
    expect(data().openworldLairsBeaten).toBe('');
  });
});

describe('the map of the Open world (#1411)', () => {
  it('the Map button opens and closes it, and so do M and Escape; Escape with the map shut leaves the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const button = byId('openworld-map-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.focus();
    button.click();
    expect(document.getElementById('openworld-map')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).not.toBe(button); // the keys and the pad go back to the world
    button.click();
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(press('m').defaultPrevented).toBe(true);
    expect(document.getElementById('openworld-map')).not.toBeNull();
    press('Escape');
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(data().openworld).toBe('7');
    press('m');
    press('Escape');
    press('Escape');
    expect(data().openworld).toBeUndefined();
  });
});

describe('the teleporters of the Open world (#1412)', () => {
  it('the Teleport button shows on the spawn\'s teleporter and opens the map in the choice of a teleporter, T too; it closes it again', async () => {
    const game = await boot('?bot=off&openworld=7');
    game.openModes();
    byId('openworld').click();
    await settle();
    const button = byId('openworld-teleport');
    expect(button.hidden).toBe(true);
    hooks().__openworldFixture!({ hero: [2, -1], troop: [], enemies: [] });
    expect(button.hidden).toBe(false);
    button.focus();
    button.click();
    expect(byId('openworld-map-note').textContent).toBe('Choose a teleporter');
    expect(document.activeElement).not.toBe(button); // the keys and the pad go back to the world
    button.click();
    expect(document.getElementById('openworld-map')).toBeNull();
    expect(press('t').defaultPrevented).toBe(true);
    expect(document.getElementById('openworld-map')).not.toBeNull();
  });

  it('gives the e2e tests every teleporter of a world, the spawn\'s first', async () => {
    await boot('?bot=off&openworld=7');
    const all = (window as unknown as { __openworldTeleporters: (seed: number) => number[] }).__openworldTeleporters(7);
    expect(all.slice(0, 2)).toEqual([2, -1]);
    expect(all.length).toBe(2 * 34); // one a square of 8 x 8 chunks (#1444) that has an island in the archipelago (#1442)
  });

  it('gives the e2e tests every town and dungeon gate of a world, the spawn town first, and the mode publishes them (#1514)', async () => {
    await boot('?bot=off&openworld=7');
    const all = (window as unknown as { __openworldPlaces: (seed: number) => number[] }).__openworldPlaces(7);
    expect(all.slice(0, 3)).toEqual([0, 0, 0]);
    expect(all).toHaveLength(3 * 10); // five towns then five dungeon gates
    expect(document.body.dataset.openworldPlaces!.split(' ')).toHaveLength(10);
  });

  it('gives the e2e tests the pad of every tower of a world, and the mode adds the pad of a tower beaten to the teleporters (#1531)', async () => {
    await boot('?bot=off&openworld=7');
    await settle();
    const hooks = window as unknown as { __openworldPads: (seed: number) => number[]; __openworldFixture: (f: object) => void };
    const pads = hooks.__openworldPads(7);
    expect(pads).toHaveLength(2 * 15);
    const towers = document.body.dataset.openworldLairs!.split(' ').map((c) => c.split(',').map(Number));
    expect(Math.abs(pads[0]! - towers[0]![0]!) + Math.abs(pads[1]! - towers[0]![1]!)).toBeGreaterThan(0);
    hooks.__openworldFixture({ hero: [pads[0]!, pads[1]!], troop: [], enemies: [], beaten: [0], recruits: 2 });
    expect(document.body.dataset.openworldTeleporters!.split(' ')).toContain(`${pads[0]},${pads[1]}`);
    expect(document.body.dataset.openworldRecruits).toBe('2');
  });
});

describe('the Open world on a machine with no GPU (#1483)', () => {
  // A player's page (webdriver off after the boot): the resolution steps down while the Open world's frames are slow, on a software
  // renderer only, a GPU page keeps its ratio.
  const slowWalk = async (software: string): Promise<string | undefined> => {
    const game = await boot(`?bot=off&openworld=7&software=${software}`);
    game.openModes();
    byId('openworld').click();
    await settle();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(data().ratio).toBe('1');
    for (let i = 0; i < 30; i++) game.frame(100);
    return data().ratio;
  };

  it('steps its resolution down on slow frames when the renderer is software, to half', async () => {
    expect(await slowWalk('on')).toBe('0.5');
  });

  it('keeps the resolution of a GPU page, slow frames or not', async () => {
    expect(await slowWalk('off')).toBe('1');
  });
});
