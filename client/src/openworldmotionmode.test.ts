// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './test/openworldwasm';
import { CHUNK } from './openworld';
import { OpenWorldMode } from './openworldmode';
import { worldSaves } from './openworldsave';
import { memoryStore } from './savegame';
import { OpenWorldView } from './openworldview';
import { stopLeftIntervalsAfterEach } from './test/intervals';
import { holdMotes } from './test/holdmotes';

holdMotes(); // the motes of each biome drift since #1736: held, these tests see the water's and the trees' motion alone
stopLeftIntervalsAfterEach();

// The mode drives the water and tree motion (#1101, #1102): the loops draw every frame while their element is in view and motion is on,
// the ripple follows a step, and reduced motion and the low tier switch it all off.
// The square -3..3 of chunks in the badlands (no ambient particles): `code(i)` is the terrain of the i-th cell of a chunk.
const world = (code: (i: number) => number) => (_seed: number, cx: number, cy: number): Uint8Array => {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, code(i), 4], i * 3);
  return out;
};
const forest = world((i) => (i % 5 === 0 ? 6 : 2));
const lake = world(() => 0);
const bank = world((i) => (i % CHUNK < 2 ? 2 : 0)); // land on the left, a lake on the right of each chunk
const flat = world(() => 2);
const mode = (load: (seed: number, cx: number, cy: number) => Uint8Array, reduced: boolean) =>
  new OpenWorldMode(load, () => new Int32Array(), async () => ({ low: {}, high: {} }), () => reduced, worldSaves(memoryStore(), 1));

afterEach(() => {
  vi.restoreAllMocks();
  delete document.body.dataset.tier;
  delete document.body.dataset.openworldMotion;
  delete (navigator as { webdriver?: boolean }).webdriver;
});

describe('the water and the trees move in the Open world (#1101, #1102)', () => {
  it('draws every frame while trees are in view and motion is on, and sets the time the shaders read', () => {
    const animate = vi.spyOn(OpenWorldView.prototype, 'animate');
    const m = mode(forest, false);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 1000);
    m.frame(render, 1016);
    m.frame(render, 1032);
    expect(render).toHaveBeenCalledTimes(3);
    expect(animate).toHaveBeenLastCalledWith(1032, false);
  });

  it('draws nothing at rest under reduced motion, trees or not', () => {
    const m = mode(forest, true);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 1000);
    m.frame(render, 1016);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('is calm on the low tier: the trees and the lake draw nothing at rest, the glow is held (#1234)', () => {
    document.body.dataset.tier = 'low';
    const animate = vi.spyOn(OpenWorldView.prototype, 'animate');
    const trees = mode(forest, false);
    trees.enter(1, 800, 600);
    const render = vi.fn();
    trees.frame(render, 1000);
    trees.frame(render, 1016);
    expect(render).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenLastCalledWith(1016, true);
    const water = mode(lake, false);
    water.enter(1, 800, 600);
    water.frame(render, 2000);
    water.frame(render, 2016);
    expect(render).toHaveBeenCalledTimes(2); // one first frame each, none after (the lake's glow used to draw every frame on low)
  });

  it('draws once more when the loop is stilled, then rests', () => {
    const m = mode(forest, false);
    m.enter(1, 800, 600);
    const render = vi.fn();
    m.frame(render, 1000);
    document.body.dataset.tier = 'low';
    m.frame(render, 1016);
    m.frame(render, 1032);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('spawns a ripple at a step next to water, none under reduced motion or on the low tier', () => {
    const ripple = vi.spyOn(OpenWorldView.prototype, 'ripple');
    const live = mode(bank, false);
    live.enter(1, 800, 600);
    live.key('ArrowRight');
    live.release('ArrowRight');
    expect(ripple).toHaveBeenCalledTimes(1);
    expect(ripple.mock.calls[0]![3]).toBe(false);
    ripple.mockClear();
    document.body.dataset.tier = 'low';
    const low = mode(bank, false);
    low.enter(1, 800, 600);
    low.key('ArrowRight');
    low.release('ArrowRight');
    expect(ripple.mock.calls[0]![3]).toBe(true);
    ripple.mockClear();
    const still = mode(bank, true);
    still.enter(1, 800, 600);
    still.key('ArrowRight');
    still.release('ArrowRight');
    expect(ripple).not.toHaveBeenCalled();
  });

  it('writes what moves under webdriver only, for the browser checks, and drops it on leaving', () => {
    const m = mode(forest, false);
    m.enter(1, 800, 600);
    m.frame(vi.fn(), 1000);
    expect(document.body.dataset.openworldMotion).toBeUndefined();
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    m.frame(vi.fn(), 1016);
    expect(document.body.dataset.openworldMotion).toBe('trees');
    m.leave();
    expect(document.body.dataset.openworldMotion).toBeUndefined();
    const bare = mode(flat, false);
    bare.enter(1, 800, 600);
    bare.frame(vi.fn(), 2000);
    expect(document.body.dataset.openworldMotion).toBe('');
  });
});
