// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { resetView, type View } from './camera';
import { SHOCK_MS, SHOCK_RADIUS, type Pulsar } from './pulsar';
import { boot, type Game, startBoss } from './test/harness';

// The Pulsar on the harness (#675, game-design.md section 7.10): the six pulsars, the charge of the active one (its
// glow, counter and chevrons), the HUD line, and the pulse: the ring grows, the pushed marbles slide and the ones past
// the rim fall. ?bot=off plays both sides from the fixture of the core tests: fight seed 2, whose first pulsar pushes
// NW. The pulse after ply 5 throws the lone boss marble on (4, -4) off and leaves the pairs at the bottom left; the
// ones after plies 9 and 13 eject 2 more: P2, force 3.

type Shock = { radius: number; opacity: number; x: number; z: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const [E, W, SW, NW, SE] = [0, 1, 3, 4, 5];
const FIXTURE: [number, number, number][] = [
  [-2, 2, NW], [4, -3, SW], [-1, 2, NW], [0, -2, SW], [0, 2, NW], [3, -3, E], [-2, 1, NW], [-1, -1, W], [-1, 1, NW],
  [-2, -1, W], [0, 1, NW], [-3, -1, SE], [-2, 0, NW],
];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const pulsar = (game: Game) => game.hook<(Pulsar & { charging: boolean }) | null>('__pulsar');
const shock = (game: Game) => game.hook<Shock | null>('__shock');
const marbleAt = (game: Game, q: number, r: number): unknown => game.hook('__marbleTurn', q, r);

/** Catches the scene main.ts builds: call before boot. */
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && !scene) scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}

/** Starts the fight against The Pulsar from the mode menu, on fight seed 2. */
function fightPulsar(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(2);
    return a;
  });
  startBoss('The Pulsar');
}

/** Plays ply `k` of the fixture by two clicks. */
function play(game: Game, k: number): void {
  const [q, r, dir] = FIXTURE[k]!;
  game.click(q, r);
  game.click(q + DIRS[dir]![0], r + DIRS[dir]![1]);
}

/** Plays plies `from` to `to` (excluded) of the fixture, the slides and pulses run to their end. */
function plies(game: Game, from: number, to: number): void {
  for (let k = from; k < to; k++) {
    play(game, k);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);

describe('main.ts The Pulsar ripples (#741)', () => {
  it('the pulsar that fires next turn loops two small faint rings while the player thinks', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightPulsar(game);
    plies(game, 0, 2);
    expect(body().ripples).toBe('0'); // 2 turns away
    plies(game, 2, 3);
    expect(body().ripples).toBe('2');
    const rings = named(scene(), 'pulsar-ripple') as THREE.Mesh[];
    expect(rings).toHaveLength(2);
    const [lit] = named(scene(), 'pulsar-charging');
    expect([rings[0]!.position.x, rings[0]!.position.z]).toEqual([lit!.position.x, lit!.position.z]); // on that pulsar
    game.frame(0);
    const before = rings[0]!.scale.x;
    game.frame(400);
    expect(rings[0]!.scale.x).toBeGreaterThan(before);
    expect(rings[0]!.scale.x).toBeLessThan(SHOCK_RADIUS / 3);
    plies(game, 3, 5); // the pulse fires: the ripples stop
    expect(body().ripples).toBe('0');
    expect(named(scene(), 'pulsar-ripple')).toHaveLength(0);
  });

  it('with reduced motion it is one static faint ring', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightPulsar(game);
    plies(game, 0, 3);
    expect(body().ripples).toBe('1');
    const [ring] = named(scene(), 'pulsar-ripple') as THREE.Mesh[];
    const before = ring!.scale.x;
    game.frame(400);
    expect(ring!.scale.x).toBe(before);
  });
});

describe('main.ts The Pulsar in space (#1146)', () => {
  const walls = (scene: THREE.Scene): THREE.Object3D[] => scene.getObjectsByProperty('name', 'wall-north');

  it('draws the fight in space: the stars and the glow show, the bay is hidden, the board stays; leaving the fight brings the bay back', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    const [space] = named(scene(), 'pulsar-space');
    expect(space!.visible).toBe(false); // the bay at first
    expect(walls(scene())[0]!.layers.isEnabled(0)).toBe(true);
    fightPulsar(game);
    expect(space!.visible).toBe(true);
    expect(space!.children.map((c) => c.type)).toEqual(['Mesh']); // the sheet of stars and glow
    expect(walls(scene())[0]!.layers.isEnabled(0)).toBe(false); // the walls, gantry, lamps and props
    expect(named(scene(), 'pulsar')).toHaveLength(6); // the board and its beacons stay
    expect((scene().background as THREE.Color).getHex()).toBe(0x000000);
    byId('ship').click(); // the ship's hub: no fight
    expect(space!.visible).toBe(false);
    expect(walls(scene())[0]!.layers.isEnabled(0)).toBe(true);
  });

  it('keeps the fight in space after a settings toggle and a late bay load (#1189)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    fightPulsar(game);
    byId('settings').click();
    byId('setting-clear-board').click(); // drawProps rebuilds the bay's meshes
    expect(walls(scene())[0]!.layers.isEnabled(0)).toBe(false);
    game.hook('__mountBay', null); // the bay glb finishing late
    expect(walls(scene())[0]!.layers.isEnabled(0)).toBe(false);
    expect((scene().background as THREE.Color).getHex()).toBe(0x000000);
  });
});
describe('main.ts The Pulsar (#675)', () => {
  it.each([
    ['&scene=room', ['pulsar-base', 'pulsar-core', 'pulsar-beam-in', 'pulsar-beam-out']],
    ['', ['pulsar-base', 'pulsar-core']], // the terrace's pylon and its core (#1374)
  ])('plays on the Bridge with its Tally line, six pulsars, the one 2 turns from its pulse charging %s', async (look, parts) => {
    const scene = catchScene();
    const game = await boot(`?bot=off${look}`, { reducedMotion: true });
    fightPulsar(game);
    expect(body().boss).toBe('pulsar');
    expect(body().deck).toBe('bridge');
    expect(game.hud()).toContain('Beacons on schedule. One pulse at a time, each counted.');
    expect(tell()).toBe('Pulse in 3 turns, force 2');
    expect(pulsar(game)).toEqual({ id: NW, left: 3, force: 2, charging: false });
    expect(named(scene(), 'pulsar')).toHaveLength(6);
    expect(named(scene(), 'pulse-chevron')).toHaveLength(0); // no charge yet
    expect(body().pulseCounter).toBe('');
    const [model] = named(scene(), 'pulsar');
    expect(model!.children.map((c) => c.name)).toEqual(parts);
    plies(game, 0, 1);
    expect(tell()).toBe('Pulse in 2 turns, force 2');
    expect(named(scene(), 'pulsar')).toHaveLength(5);
    const [lit] = named(scene(), 'pulsar-charging');
    expect(lit!.position.z).toBeGreaterThan(4); // off the bottom corner, pushing NW
    expect(named(scene(), 'pulse-chevron')).toHaveLength(9);
    const [counter] = named(scene(), 'pulse-counter') as THREE.Sprite[];
    expect(counter!.material.depthTest).toBe(false); // never hidden behind a marble
    expect([counter!.position.x, counter!.position.z]).toEqual([lit!.position.x, lit!.position.z]);
    expect(body().pulseCounter).toBe('2');
    plies(game, 1, 2);
    expect(body().pulseCounter).toBe('2'); // a boss turn counts nothing
    plies(game, 2, 3);
    expect(body().pulseCounter).toBe('1');
  });

  it('the pulse plays after the move: the ring grows, the lone boss marble falls, the pair stays, the core spins', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightPulsar(game);
    plies(game, 0, 4);
    const core = named(scene(), 'pulsar-core')[0]!;
    const spin = core.rotation.y;
    game.frame(300);
    expect(core.rotation.y).not.toBe(spin);
    play(game, 4); // the player's 3rd move: the pulse
    expect(body().sliding).toBe('1');
    expect(marbleAt(game, 4, -4)).not.toBeNull(); // the move slides first, on the board before the pulse
    expect(body().pulses).toBeUndefined();
    game.frame(1000); // the move slide ends: the pulse plays
    expect(body().pulses).toBe('1');
    expect(body().pulsing).toBe('1');
    expect(body().sliding).toBe('1'); // the lone (1, 3) slides up a cell
    expect(body().ejecting).toBe('tumble'); // (4, -4) falls off the top
    expect(marbleAt(game, 4, -4)).toBeNull();
    expect(marbleAt(game, 1, 2)).not.toBeNull();
    expect(shock(game)!.radius).toBeLessThan(1);
    game.frame(SHOCK_MS / 2);
    expect(shock(game)!.radius).toBeGreaterThan(SHOCK_RADIUS / 2);
    game.frame(SHOCK_MS);
    expect(shock(game)).toBeNull();
    expect(body().pulsing).toBeUndefined();
    expect(marbleAt(game, -4, 4)).not.toBeNull(); // the pair resists
    expect(marbleAt(game, -4, 3)).not.toBeNull();
    expect(game.hud()).toContain('1/6');
    expect(tell()).toBe('Pulse in 2 turns, force 2');
  });

  it('under reduced motion the ring shows whole and the marbles jump, and 3 ejections raise the force to 3', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightPulsar(game);
    for (let k = 0; k < 5; k++) play(game, k);
    expect(body().pulses).toBe('1');
    expect(body().sliding).toBeUndefined();
    expect(shock(game)!.radius).toBe(SHOCK_RADIUS);
    for (let k = 5; k < 13; k++) play(game, k); // the next pulse comes while the ring still shows
    expect(body().pulses).toBe('3');
    expect(game.hud()).toContain('3/6');
    expect(byId('hud').querySelector('.notch.active')!.textContent).toBe('P2');
    expect(tell()).toBe('Pulse in 4 turns, force 3');
    expect(pulsar(game)!.charging).toBe(false); // the rest
  });

  it('a click ends the ring at once, and a new fight during the move slide drops the pulse', async () => {
    const game = await boot('?bot=off');
    fightPulsar(game);
    plies(game, 0, 4);
    play(game, 4);
    game.frame(1000);
    expect(shock(game)).not.toBeNull();
    dispatchEvent(new PointerEvent('pointerdown')); // a click skips the effect
    expect(shock(game)).toBeNull();

    fightPulsar(game);
    plies(game, 0, 4);
    play(game, 4);
    fightPulsar(game); // Retry by the menu while the move slides
    game.frame(1000);
    expect(shock(game)).toBeNull();
    expect(body().pulses).toBeUndefined(); // none of the new fight's: the switch drops the first fight's count (#1275)
    expect(marbleAt(game, 4, -4)).not.toBeNull(); // the start position
  });

  it('a game that is no Pulsar fight draws no pulsar', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    expect(pulsar(game)).toBeNull();
    expect(named(scene(), 'pulsar')).toHaveLength(0);
    expect(tell()).toBeUndefined();
  });

  // Bug #691: the bottom pulsars and the counter of the charging one were cut off at the edge of a desktop window, the
  // side ones on a phone held upright.
  for (const [width, height] of [
    [1280, 720],
    [375, 812],
  ] as const) {
    it(`the fight opens on a view where every pulsar and its counter lie in a ${width}x${height} window`, async () => {
      const inner = { innerWidth, innerHeight };
      Object.assign(window, { innerWidth: width, innerHeight: height });
      onTestFinished(() => void Object.assign(window, inner));
      const game = await boot('?bot=off');
      fightPulsar(game);
      plies(game, 0, 1);
      type Rect = { x: number; y: number; width: number; height: number };
      const rects = game.hook<{ pulsar: Rect; counter: Rect }[]>('__pulsarRects');
      expect(rects).toHaveLength(6);
      const inside = (r: Rect): boolean => r.width > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height;
      expect(rects.map(({ pulsar, counter }) => [inside(pulsar), inside(counter)])).toEqual(Array(6).fill([true, true]));
      const fitted = game.hook<View>('__view');
      expect(fitted.distance).toBeGreaterThan(resetView().distance); // drawn back
      document.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
      expect(game.hook<View>('__view').distance).toBeLessThan(fitted.distance);
      byId('view-reset').click();
      expect(game.hook<View>('__view')).toEqual(fitted); // Reset view goes back to it
    });
  }

  type Rect = { x: number; y: number; width: number; height: number };
  /** Sets the window size, and puts it back when the test ends. */
  function windowOf(width: number, height: number): void {
    const inner = { innerWidth, innerHeight };
    Object.assign(window, { innerWidth: width, innerHeight: height });
    onTestFinished(() => void Object.assign(window, inner));
  }
  /** The pulsars and counters drawn outside a window of this size. */
  function hidden(game: Game, width: number, height: number): number[] {
    const off = (r: Rect): boolean => r.x < 0 || r.y < 0 || r.x + r.width > width || r.y + r.height > height;
    const rects = game.hook<{ pulsar: Rect; counter: Rect }[]>('__pulsarRects');
    expect(rects).toHaveLength(6);
    return rects.flatMap(({ pulsar, counter }, id) => ([pulsar, counter].some(off) ? [id] : []));
  }

  // Bug #696: the view was fitted at the start of the fight and on Reset view only, so turning a phone upright put the
  // side pulsars off screen. A new window size fits the view again until the player moves the camera himself; then
  // his view stays, and Reset view fits it to the window.
  it('a new window size fits the view again, until the player moves the camera', async () => {
    windowOf(812, 375);
    const game = await boot('?bot=off&scene=room'); // the fit logic of the room: the terrace fits its pylons further out (#1374)
    fightPulsar(game);
    plies(game, 0, 1);
    windowOf(375, 812);
    dispatchEvent(new Event('resize'));
    expect(hidden(game, 375, 812)).toEqual([]);
    const upright = game.hook<View>('__view');
    windowOf(812, 375);
    dispatchEvent(new Event('resize'));
    expect(game.hook<View>('__view').distance).toBeLessThan(upright.distance); // sideways needs less room
    document.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
    const own = game.hook<View>('__view');
    windowOf(375, 812);
    dispatchEvent(new Event('resize'));
    expect(game.hook<View>('__view')).toEqual(own); // the player's view stays
    byId('view-reset').click();
    expect(game.hook<View>('__view')).toEqual(upright);
    windowOf(812, 375);
    dispatchEvent(new Event('resize'));
    expect(game.hook<View>('__view').distance).toBeLessThan(upright.distance); // fitted again
  });
});
