import { describe, expect, it } from 'vitest';
import { BLEND_MS, CYCLE_MS, PHASE_MS, Sky, WORLD_LOOKS, mixHex, phaseOf, wrapTime, clockLine } from './daynight';

// The day/night cycle of the Open world (docs/specs/openworld.md section 11, #1496): day 6 min, dusk 1.5 min, night 3 min, dusk 1.5 min.
const MIN = 60_000;
const HALF = 128 / 255; // the middle of a blend: step 128 of 255

describe('the cycle', () => {
  it('lasts 12 minutes: day 6, dusk 1.5, night 3, dusk again 1.5', () => {
    expect(PHASE_MS).toEqual({ day: 6 * MIN, dusk: 1.5 * MIN, night: 3 * MIN });
    expect(CYCLE_MS).toBe(12 * MIN);
  });

  it('reads the phase from the time of day, dawn using the dusk look', () => {
    expect(phaseOf(0)).toBe('day');
    expect(phaseOf(6 * MIN - 1)).toBe('day');
    expect(phaseOf(6 * MIN)).toBe('dusk');
    expect(phaseOf(7.5 * MIN - 1)).toBe('dusk');
    expect(phaseOf(7.5 * MIN)).toBe('night');
    expect(phaseOf(10.5 * MIN - 1)).toBe('night');
    expect(phaseOf(10.5 * MIN)).toBe('dusk');
    expect(phaseOf(12 * MIN - 1)).toBe('dusk');
    expect(phaseOf(12 * MIN)).toBe('day');
  });

  it('wraps a time into one cycle, and reads garbage as the start of day', () => {
    expect(wrapTime(13 * MIN)).toBe(MIN);
    expect(wrapTime(-MIN)).toBe(11 * MIN);
    expect(wrapTime(Number.NaN)).toBe(0);
    expect(wrapTime(Infinity)).toBe(0);
    expect(phaseOf(25 * MIN)).toBe('day');
  });
});

describe('the colours', () => {
  it('mixes two colours channel by channel', () => {
    expect(mixHex(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixHex(0x102030, 0x304050, 0.5)).toBe(0x203040);
  });
});

describe('the sky', () => {
  it('starts on the look of day and holds a phase look through the middle of the phase', () => {
    const sky = new Sky();
    expect(sky.look).toEqual(WORLD_LOOKS.day);
    expect(sky.set(MIN, true)).toBe(false); // nothing changed: day, no blend yet
    expect(sky.set(9 * MIN, true)).toBe(true); // the middle of the night
    expect(sky.look).toEqual(WORLD_LOOKS.night);
    expect(sky.set(9.5 * MIN, true)).toBe(false); // the same look again
  });

  it('blends into the next phase over the last stretch of a phase, smoothly and ending on the next look', () => {
    const sky = new Sky();
    sky.set(6 * MIN - BLEND_MS - 1, true);
    expect(sky.look).toEqual(WORLD_LOOKS.day);
    sky.set(6 * MIN - BLEND_MS / 2, true);
    expect(sky.look.sky).toBe(mixHex(WORLD_LOOKS.day.sky, WORLD_LOOKS.dusk.sky, HALF));
    expect(sky.look.sunIntensity).toBeCloseTo((WORLD_LOOKS.day.sunIntensity + WORLD_LOOKS.dusk.sunIntensity) / 2, 1);
    sky.set(6 * MIN - 1, true);
    expect(sky.look.sky).toBe(WORLD_LOOKS.dusk.sky);
    sky.set(6 * MIN, true); // the phase changes where the blend ended: no jump
    expect(sky.look).toEqual(WORLD_LOOKS.dusk);
  });

  it('blends the dusk into the night, and the night into the dawn dusk, and the dawn dusk into the day', () => {
    const sky = new Sky();
    for (const [at, from, to] of [[7.5, 'dusk', 'night'], [10.5, 'night', 'dusk'], [12, 'dusk', 'day']] as const) {
      sky.set(at * MIN - 1, true);
      expect(sky.look.sky, `${from} to ${to}`).toBe(WORLD_LOOKS[to].sky);
      sky.set(at * MIN - BLEND_MS / 2, true);
      expect(sky.look.sky, `${from} to ${to}`).toBe(mixHex(WORLD_LOOKS[from].sky, WORLD_LOOKS[to].sky, HALF));
    }
  });

  it('switches the look at the change of phase with no blend under reduced motion', () => {
    const sky = new Sky();
    expect(sky.set(6 * MIN - 1000, false)).toBe(false);
    expect(sky.look).toEqual(WORLD_LOOKS.day);
    expect(sky.set(6 * MIN, false)).toBe(true);
    expect(sky.look).toEqual(WORLD_LOOKS.dusk);
  });

  it('changes by at most one step of 256 between two reads, so a blend is not drawn more often than it shows', () => {
    const sky = new Sky();
    let changes = 0;
    for (let t = 6 * MIN - BLEND_MS; t < 6 * MIN; t += 16) if (sky.set(t, true)) changes++;
    expect(changes).toBeLessThanOrEqual(257);
    expect(changes).toBeGreaterThan(100);
  });

  it('keeps night readable: the moonlight and the ambient are not black, and the night glows', () => {
    const { night, day } = WORLD_LOOKS;
    expect(night.hemiIntensity).toBeGreaterThanOrEqual(0.5);
    expect(night.sunIntensity).toBeGreaterThanOrEqual(1);
    expect(night.glow).toBe(1);
    expect(day.glow).toBe(0);
  });

  it('reads its looks from the table it is given, the neon look has its own (#1536)', () => {
    const looks = { day: { ...WORLD_LOOKS.night }, dusk: WORLD_LOOKS.dusk, night: WORLD_LOOKS.night };
    const sky = new Sky(looks);
    expect(sky.look).toEqual(looks.day);
    sky.set(6 * MIN, true);
    expect(sky.look).toEqual(looks.dusk);
  });
});

// #1743: the world's clock on the HUD: the hour of the world (a cycle is a day of 24 hours, the day starting at 06:00), the phase, and the
// real time left until the next phase.
describe('the clock line of the world (#1743)', () => {
  it('reads the hour, the phase and the time to the next phase', () => {
    expect(clockLine(0)).toBe('06:00 · Day · dusk in 6:00');
    expect(clockLine(PHASE_MS.day - 5_000)).toMatch(/^\d\d:\d\d · Day · dusk in 0:05$/);
    expect(clockLine(PHASE_MS.day)).toMatch(/ · Dusk · night in 1:30$/);
    expect(clockLine(PHASE_MS.day + PHASE_MS.dusk)).toMatch(/ · Night · dawn in 3:00$/);
    expect(clockLine(PHASE_MS.day + PHASE_MS.dusk + PHASE_MS.night)).toMatch(/ · Dawn · day in 1:30$/);
    expect(clockLine(CYCLE_MS / 2)).toBe('18:00 · Dusk · night in 1:30'); // half the cycle: 18:00, the day ends
  });
});

