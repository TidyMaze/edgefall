// @vitest-environment jsdom
import './test/openworldwasm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { CHUNK } from './openworld';
import { BLEND_MS, CYCLE_MS, WORLD_LOOKS, clockLine, PHASE_MS } from './daynight';
import { OpenWorldMode } from './openworldmode';
import { worldSaves } from './openworldsave';
import { memoryStore } from './savegame';
import { stopLeftIntervalsAfterEach } from './test/intervals';
import { BIOME_SKY, SKY_MIX } from './openworldview';
stopLeftIntervalsAfterEach();

// The time of day of the Open world (docs/specs/openworld.md section 11, #1496): counted while the world is open, saved with it.
const MIN = 60_000;
const grass = (_seed: number, cx: number, cy: number): Uint8Array => {
  if (Math.abs(cx) > 2 || Math.abs(cy) > 2) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([1, 2, 4], i * 3);
  return out;
};
const body = () => document.body.dataset;
const made = (reduced = true, saves = worldSaves(memoryStore(), 1)) => new OpenWorldMode(grass, () => new Int32Array(), async () => ({ low: {}, high: {} }), () => reduced, saves);
const background = (m: OpenWorldMode): number => ((m.scene as THREE.Scene).background as THREE.Color).getHex();
/** The hour's sky leaning toward the air of the hero's biome, as the view draws it (#1736). */
const air = (m: OpenWorldMode, sky: number): number => new THREE.Color(sky).lerp(new THREE.Color(BIOME_SKY[m.biome!]), SKY_MIX).getHex();

afterEach(() => {
  for (const key of Object.keys(body())) delete body()[key];
});

describe('the world\'s clock on the plate (#1743)', () => {
  it('shows the hour, the phase and the time to the next, and follows the clock', () => {
    const clock = document.body.appendChild(Object.assign(document.createElement('p'), { id: 'openworld-clock' }));
    const m = made();
    m.enter(1, 800, 600);
    m.frame(() => {}, 1000);
    expect(clock.textContent).toBe(clockLine(m.timeOfDay));
    m.setTime(PHASE_MS.day + 1000);
    m.frame(() => {}, 1016);
    expect(clock.textContent).toMatch(/ · Dusk · night in /);
    clock.remove();
  });
});

describe('the time of day in the Open world mode', () => {
  it('opens at the start of day and marks the phase on the page', () => {
    const m = made();
    m.enter(7, 800, 600);
    expect(m.timeOfDay).toBe(0);
    expect(m.phase).toBe('day');
    expect(body().openworldPhase).toBe('day');
    expect(background(m)).toBe(air(m, WORLD_LOOKS.day.sky));
  });

  it('counts the time of the frames, and marks the phase and draws again when it changes', () => {
    const m = made();
    m.enter(7, 800, 600);
    const render = vi.fn();
    m.frame(render, 1000);
    m.frame(render, 1100); // a first frame draws; later ones draw only a change
    expect(m.timeOfDay).toBe(100);
    expect(render).toHaveBeenCalledTimes(1);
    m.setTime(6 * MIN - 150);
    m.frame(render, 1200);
    expect(body().openworldPhase).toBe('day');
    m.frame(render, 1300);
    expect(m.phase).toBe('dusk');
    expect(body().openworldPhase).toBe('dusk');
    expect(background(m)).toBe(air(m, WORLD_LOOKS.dusk.sky));
    expect(render.mock.calls.length).toBeGreaterThan(1);
  });

  it('counts no more than a quarter second for one frame: a stalled tab does not skip the day', () => {
    const m = made();
    m.enter(7, 800, 600);
    m.frame(vi.fn(), 1000);
    m.frame(vi.fn(), 1000 + 60 * MIN);
    expect(m.timeOfDay).toBe(250);
  });

  it('wraps at the end of the cycle', () => {
    const m = made();
    m.enter(7, 800, 600);
    m.setTime(CYCLE_MS - 10);
    m.frame(vi.fn(), 1000);
    m.frame(vi.fn(), 1100);
    expect(m.timeOfDay).toBe(90);
    expect(m.phase).toBe('day');
  });

  it('the test hook sets the time of day: the phase, the page mark and the draw follow', () => {
    const m = made();
    m.enter(7, 800, 600);
    const render = vi.fn();
    m.frame(render);
    m.setTime(9 * MIN);
    expect(body().openworldPhase).toBe('night');
    expect(background(m)).toBe(air(m, WORLD_LOOKS.night.sky));
    m.frame(render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('blends the sky over the end of a phase, and holds still under reduced motion', () => {
    const blended = made(false);
    blended.enter(7, 800, 600);
    blended.setTime(6 * MIN - BLEND_MS / 2);
    expect(background(blended)).not.toBe(air(blended, WORLD_LOOKS.day.sky));
    const still = made(true);
    still.enter(7, 800, 600);
    still.setTime(6 * MIN - BLEND_MS / 2);
    expect(background(still)).toBe(air(still, WORLD_LOOKS.day.sky));
  });

  it('counts nothing while the world is left, and takes the mark off the page', () => {
    const m = made();
    m.enter(7, 800, 600);
    m.setTime(9 * MIN);
    m.leave();
    expect(body().openworldPhase).toBeUndefined();
    expect(m.frame(vi.fn(), 5000)).toBe(false);
    expect(m.timeOfDay).toBe(9 * MIN);
    expect(m.phase).toBe('night'); // the lair that started a fight reads it after the world is left
  });

  it('leaving a world that is not open saves nothing and throws nothing', () => {
    const m = made();
    expect(() => m.leave()).not.toThrow();
    expect(m.timeOfDay).toBe(0);
  });

  it('saves the time of day when the world is left, and opens at it again', async () => {
    const saves = worldSaves(memoryStore(), 1);
    const m = made(true, saves);
    await m.open(7, 800, 600);
    m.setTime(8 * MIN);
    m.leave();
    const back = await saves.load(7);
    expect(back!.time).toBe(8 * MIN);
    const again = made(true, saves);
    await again.open(7, 800, 600);
    expect(again.timeOfDay).toBe(8 * MIN);
    expect(body().openworldPhase).toBe('night');
  });

  it('an old save without a time opens at the start of day', async () => {
    const store = memoryStore();
    const saves = worldSaves(store, 1);
    await saves.put(7, [0, 0], [], new (await import('./openworldfight')).FightState(), 0);
    store.data.set('openworld:7', { ...(store.data.get('openworld:7') as object), record: 4, time: undefined });
    const m = made(true, saves);
    await m.open(7, 800, 600);
    expect(m.timeOfDay).toBe(0);
  });
});
