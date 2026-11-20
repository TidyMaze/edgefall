// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './test/openworldwasm';
import { world_chunk } from 'edgefall-wasm';
import { OpenWorldMode } from './openworldmode';
import { worldSaves } from './openworldsave';
import { memoryStore } from './savegame';
import { stopLeftIntervalsAfterEach } from './test/intervals';
stopLeftIntervalsAfterEach();

// #1104: each biome of the Open world drifts its own particles (pollen, leaves, snow, dust) and the desert shimmers. Seed 1 has a
// cell of each (found with `world_chunk`). The page marks what is drawn on a webdriver page. This was an e2e spec
// (e2e/openworld-ambience.spec.ts): a frame cost seconds on the CI runner, and the mode draws the same on the real world here.
const CELL = { forest: [36, -115], tundra: [73, -74], desert: [-85, 14], meadow: [-7, 0] } as const; // open ground of the biome and its six neighbours (#1755)
const body = () => document.body.dataset;
const mode = (reduced = false) => new OpenWorldMode(world_chunk, () => new Int32Array(), async () => ({ low: {}, high: {} }), () => reduced, worldSaves(memoryStore(), 1));
const stand = (m: OpenWorldMode, cell: readonly [number, number], at: number): void => {
  m.fixture({ hero: [...cell], troop: [], enemies: [] });
  m.frame(vi.fn(), at);
  m.frame(vi.fn(), at + 16);
};

afterEach(() => {
  delete document.body.dataset.tier;
  delete (navigator as { webdriver?: boolean }).webdriver;
});

describe('the ambience of the biomes of the Open world (#1104)', () => {
  it('each biome drifts its own particles and the desert shimmers', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = mode();
    m.enter(1, 480, 270);
    let at = 1000;
    for (const biome of ['forest', 'tundra', 'desert', 'meadow'] as const) {
      stand(m, CELL[biome], (at += 1000));
      expect(Number(body().openworldParticles), biome).toBeGreaterThan(2);
      expect(Number(body().openworldParticles), biome).toBeLessThanOrEqual(64);
      if (biome === 'desert') expect(body().openworldMotion).toContain('shimmer');
      else expect(body().openworldMotion ?? '').not.toContain('shimmer'); // the shimmer clears a frame after the hero leaves the desert
    }
  });

  it('no particle is drawn under reduced motion, #1110', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = mode(true);
    m.enter(1, 480, 270);
    stand(m, CELL.forest, 1000);
    m.frame(vi.fn(), 2500);
    expect(Number(body().openworldParticles ?? 0)).toBe(0);
  });

  it('nothing drifts or shimmers on the low tier', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    document.body.dataset.tier = 'low';
    const m = mode();
    m.enter(1, 480, 270);
    stand(m, CELL.forest, 2000);
    expect(Number(body().openworldParticles ?? 0)).toBe(0);
    stand(m, CELL.desert, 4000);
    expect(body().openworldMotion ?? '').toBe('');
  });
});

// #1101, #1102: seed 1 has a lake with a forest beside it at (26, 21): the shore foam and the trees move, with no extra draw. The
// two-frames-differ pixel checks of the former e2e spec (e2e/openworld-motion.spec.ts) are the draws counted here: a frame is drawn
// each time while something moves (and its time is set for the shaders), and a stilled loop draws once and rests.
describe('the water and the trees of seed 1 move, reduced motion and the low tier move nothing (#1101, #1102)', () => {
  const at = (m: OpenWorldMode): void => m.fixture({ hero: [26, 21], troop: [], enemies: [] });

  it('marks the water and the trees, and draws every frame', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = mode();
    m.enter(1, 480, 270);
    at(m);
    const render = vi.fn();
    m.frame(render, 1000);
    m.frame(render, 1016);
    m.frame(render, 1032);
    expect(body().openworldMotion).toBe('water,trees');
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('moves nothing under reduced motion: no mark, and the frames after the first draw nothing', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = mode(true);
    m.enter(1, 480, 270);
    at(m);
    const render = vi.fn();
    m.frame(render, 1000);
    m.frame(render, 2500);
    m.frame(render, 4000);
    expect(body().openworldMotion).toBe('');
    expect(render.mock.calls.length).toBeLessThanOrEqual(2); // the fixture's move is drawn once, then it rests
    const drawn = render.mock.calls.length;
    m.frame(render, 5500);
    expect(render).toHaveBeenCalledTimes(drawn);
  });

  it('draws no foam, ripple or sway on the low tier', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    document.body.dataset.tier = 'low';
    const m = mode();
    m.enter(1, 480, 270);
    at(m);
    m.frame(vi.fn(), 1000);
    m.frame(vi.fn(), 1016);
    expect(body().openworldMotion).toBe('');
  });

  it('names the biome under the hero for the music, none before the world is drawn, #1571', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const m = mode();
    expect(m.biome).toBeNull();
    m.enter(1, 480, 270);
    for (const biome of ['forest', 'tundra', 'desert', 'meadow'] as const) {
      stand(m, CELL[biome], 1000);
      expect(m.biome).toBe(biome);
    }
  });
});
