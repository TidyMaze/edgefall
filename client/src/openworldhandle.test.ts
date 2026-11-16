import { describe, expect, it, vi } from 'vitest';
import { OpenWorldHandle, type OpenWorldParts } from './openworldhandle';
import type { OpenWorldMode } from './openworldmode';

// What the page holds in place of the Open world until its code is loaded (#1578): the mode is "off" for every question
// the page asks each frame and each key, and the first open loads it.

/** A mode that answers every call with its own name, so a test sees what the handle forwards. */
function fakeMode(): { mode: OpenWorldMode; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const method = (name: string, result?: unknown) => (...args: unknown[]) => (calls.push([name, args]), result);
  const mode = {
    active: true,
    phase: 'dusk',
    biome: 'forest',
    scene: { name: 'world' },
    eye: { name: 'eye' },
    props: PROPS,
    yaw: 1.5,
    mapShown: true,
    asking: true,
    open: method('open', Promise.resolve()),
    leave: method('leave'),
    resize: method('resize'),
    refreshMode: method('refreshMode'),
    reskin: method('reskin', Promise.resolve()),
    setLevels: method('setLevels'),
    press: method('press'),
    orbit: method('orbit'),
    cancelWalk: method('cancelWalk'),
    zoom: method('zoom'),
    settle: method('settle'),
    panMap: method('panMap'),
    hold: method('hold'),
    key: method('key', true),
    release: method('release'),
    turn: method('turn'),
    toggleMap: method('toggleMap'),
    teleport: method('teleport'),
    frame: method('frame', true),
  } as unknown as OpenWorldMode;
  return { mode, calls };
}

const parts = (mode: OpenWorldMode): OpenWorldParts => ({ mode, saves: {} as OpenWorldParts['saves'], peers: {} as OpenWorldParts['peers'] });

const PROPS = Promise.resolve();

describe('OpenWorldHandle, #1578', () => {
  it('stands for a world that is off until its code is loaded: nothing is active, drawn or held', async () => {
    const handle = new OpenWorldHandle(async () => {
      throw new Error('never loaded');
    });
    expect(handle.active).toBe(false);
    expect(handle.phase).toBe('day');
    expect(handle.biome).toBeNull();
    expect(handle.scene).toBeNull();
    expect(handle.eye).toBeNull();
    await expect(handle.props).resolves.toBeUndefined(); // no world yet: nothing to wait for (#1582)
    expect(handle.yaw).toBe(0);
    expect(handle.mapShown).toBe(false);
    expect(handle.asking).toBe(false);
    expect(handle.key('ArrowUp', false)).toBe(false);
    expect(handle.frame(() => {}, 1)).toBe(false);
    // the questions of every pointer, key, resize and setting are answered with nothing to do
    handle.resize(1, 2);
    handle.refreshMode();
    handle.reskin();
    handle.press(1, 2, 3, 4);
    handle.orbit(5);
    handle.cancelWalk();
    handle.zoom(2);
    handle.settle();
    handle.panMap(1, 2);
    handle.hold([]);
    handle.release('a');
    handle.turn(1);
    handle.toggleMap();
    handle.teleport();
    handle.leave();
    expect(() => handle.loaded).toThrow('The Open world is not loaded');
  });

  it('loads its code at the first open and opens the world there, then at every later one without loading again', async () => {
    const { mode, calls } = fakeMode();
    const load = vi.fn(async () => parts(mode));
    const handle = new OpenWorldHandle(load);
    expect(load).not.toHaveBeenCalled();
    handle.setLevels(0.5, 2); // the sliders, moved before the world loaded (#1727)
    await handle.open(7, 800, 600, false, 'tower');
    expect(load).toHaveBeenCalledOnce();
    expect(calls).toEqual([['setLevels', [0.5, 2]], ['open', [7, 800, 600, false, 'tower']]]);
    calls.length = 0;
    handle.setLevels(1, 3);
    expect(calls).toEqual([['setLevels', [1, 3]]]);
    calls.length = 0;
    await handle.open(8, 1, 2);
    expect(load).toHaveBeenCalledOnce();
    expect(handle.loaded.mode).toBe(mode);
  });

  it('answers from the mode once it is loaded', async () => {
    const { mode, calls } = fakeMode();
    const handle = new OpenWorldHandle(async () => parts(mode));
    await handle.open(1, 2, 3);
    calls.length = 0;
    expect(handle.active).toBe(true);
    expect(handle.phase).toBe('dusk');
    expect(handle.biome).toBe('forest');
    expect(handle.scene).toEqual({ name: 'world' });
    expect(handle.eye).toEqual({ name: 'eye' });
    expect(handle.props).toBe(PROPS);
    expect(handle.yaw).toBe(1.5);
    expect(handle.mapShown).toBe(true);
    expect(handle.asking).toBe(true);
    expect(handle.key('ArrowUp', true)).toBe(true);
    const render = (): void => {};
    expect(handle.frame(render, 5)).toBe(true);
    handle.resize(1, 2);
    handle.refreshMode();
    handle.reskin();
    handle.press(1, 2, 3, 4);
    handle.orbit(5);
    handle.cancelWalk();
    handle.zoom(2);
    handle.settle();
    handle.panMap(1, 2);
    handle.hold(['a']);
    handle.release('a');
    handle.turn(1);
    handle.toggleMap();
    handle.teleport();
    handle.leave();
    expect(calls).toEqual([
      ['key', ['ArrowUp', true]],
      ['frame', [render, 5]],
      ['resize', [1, 2]],
      ['refreshMode', []],
      ['reskin', []],
      ['press', [1, 2, 3, 4]],
      ['orbit', [5]],
      ['cancelWalk', []],
      ['zoom', [2]],
      ['settle', []],
      ['panMap', [1, 2]],
      ['hold', [['a']]],
      ['release', ['a']],
      ['turn', [1]],
      ['toggleMap', []],
      ['teleport', []],
      ['leave', []],
    ]);
  });
});
