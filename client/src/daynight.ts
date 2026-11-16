// The day/night cycle of the Open world (docs/specs/openworld.md section 11, #1496). Data and arithmetic only: the view applies the
// look (openworldview.ts `setTime`), the mode counts the time (openworldmode.ts) and the lair fights read the phase (boardlook.ts).
import { SUN } from './sun';

export type Phase = 'day' | 'dusk' | 'night';

/** How long each phase lasts, in ms of play in the world. */
export const PHASE_MS: Readonly<Record<Phase, number>> = { day: 360_000, dusk: 90_000, night: 180_000 };

/** The phases round one cycle: day, dusk, night, then dusk again (the dawn uses the dusk look). */
const ROUND: readonly Phase[] = ['day', 'dusk', 'night', 'dusk'];
/** Where each phase of the round ends, in ms into the cycle. */
const ENDS: readonly number[] = ROUND.map((_, i) => ROUND.slice(0, i + 1).reduce((sum, phase) => sum + PHASE_MS[phase], 0));
export const CYCLE_MS = ENDS[ENDS.length - 1]!;
/** The end of each phase is a blend into the next one's look, over this long. */
export const BLEND_MS = 30_000;
/** The blend moves in this many steps: a colour changes by about a level a step, so a step is the finest change to draw. */
const STEPS = 255;

/** A time in `[0, CYCLE_MS)`: one cycle wraps into the next, and a time that is not a number is the start of day. */
export const wrapTime = (ms: number): number => (Number.isFinite(ms) ? ((ms % CYCLE_MS) + CYCLE_MS) % CYCLE_MS : 0);

/** The world's clock on the HUD (#1743): the hour of the world (a cycle is a day of 24 hours, the day from 06:00), the phase (the second dusk is
 * the dawn) and the real time left until the next one, in minutes and seconds. */
export function clockLine(ms: number): string {
  const t = wrapTime(ms);
  const i = indexAt(t);
  const hours = (6 + (t / CYCLE_MS) * 24) % 24;
  const hh = String(Math.floor(hours)).padStart(2, '0');
  const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
  const names = ['Day', 'Dusk', 'Night', 'Dawn'];
  const left = Math.ceil((ENDS[i]! - t) / 1000);
  return `${hh}:${mm} · ${names[i]} · ${names[(i + 1) % 4]!.toLowerCase()} in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** The phase at time `ms` of the cycle. */
export function phaseOf(ms: number): Phase {
  return ROUND[indexAt(wrapTime(ms))]!;
}

/** The number in the round of the phase that time `t` (already wrapped) is in. */
function indexAt(t: number): number {
  let index = 0;
  while (t >= ENDS[index]!) index++;
  return index;
}

/** What the world looks like at one time of day. */
export interface WorldLook {
  /** The sky, which the fog fades to. */
  sky: number;
  /** The sun by day, the moon by night: its colour, strength and place in the sky (degrees over the horizon, and round it). */
  sun: number;
  sunIntensity: number;
  elevation: number;
  azimuth: number;
  /** The ambient light: the sky side, the ground side and the strength. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** The colour the water is multiplied by. */
  water: number;
  /** How much the hero, the troop, the lairs and the teleporters shine of their own, 0 (not at all) to 1. */
  glow: number;
  /** The brightness of the neon sky's stars and of its horizon glow, 1 as the look ships them (#1536); the terrace has neither. */
  stars: number;
  horizon: number;
}

/** The three looks. Night stays readable: the moon is a real key light, the ambient is not black, and the things that matter glow. */
export const WORLD_LOOKS: Readonly<Record<Phase, WorldLook>> = {
  day: { sky: 0x93b5d9, sun: SUN.colour, sunIntensity: 3.2, elevation: SUN.elevation, azimuth: SUN.azimuth, hemiSky: 0xcfe0ff, hemiGround: 0x2a2418, hemiIntensity: 0.9, water: 0xffffff, glow: 0, stars: 1, horizon: 1 },
  dusk: { sky: 0x9a5f7a, sun: 0xff9a50, sunIntensity: 3.6, elevation: 14, azimuth: 62, hemiSky: 0xc8a0d0, hemiGround: 0x5a3a40, hemiIntensity: 1.2, water: 0xf0b0b8, glow: 0.4, stars: 1, horizon: 1 },
  night: { sky: 0x060a1c, sun: 0x9db8ff, sunIntensity: 1.3, elevation: 38, azimuth: -30, hemiSky: 0x6a82c8, hemiGround: 0x141a2c, hemiIntensity: 0.65, water: 0x8aa4e0, glow: 1, stars: 1, horizon: 1 },
};

const mixNumber = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The colour `k` of the way from `a` to `b` (0 to 1), channel by channel. */
export function mixHex(a: number, b: number, k: number): number {
  const channel = (shift: number): number => Math.round(mixNumber((a >> shift) & 0xff, (b >> shift) & 0xff, k));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * The look of the world as the time goes: a phase keeps its look through its middle and blends into the next one's over its last
 * `BLEND_MS` (smoothly, ending on that look, so the change of phase is no jump). With no blend (reduced motion) the look switches
 * where the phase changes. One object that `set` writes into: a frame allocates nothing.
 */
export class Sky {
  readonly look: WorldLook;
  /** The three looks this sky moves through: the terrace's (`WORLD_LOOKS`) or the neon look's (`NEON_WORLD_LOOKS`, #1536). */
  private readonly looks: Readonly<Record<Phase, WorldLook>>;
  /** Which look is written: the phase of the round and the blend step. `set` writes when it changes. */
  private stamp = 0;

  constructor(looks: Readonly<Record<Phase, WorldLook>> = WORLD_LOOKS) {
    this.looks = looks;
    this.look = { ...looks.day };
  }

  /** Moves the look to time `ms`; whether it changed. */
  set(ms: number, blend: boolean): boolean {
    const t = wrapTime(ms);
    const index = indexAt(t);
    const left = ENDS[index]! - t;
    const x = blend && left < BLEND_MS ? 1 - left / BLEND_MS : 0;
    const step = Math.round(x * x * (3 - 2 * x) * STEPS);
    const stamp = index * (STEPS + 1) + step;
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    const [from, to, k] = [this.looks[ROUND[index]!], this.looks[ROUND[(index + 1) % ROUND.length]!], step / STEPS];
    const { look } = this;
    look.sky = mixHex(from.sky, to.sky, k);
    look.sun = mixHex(from.sun, to.sun, k);
    look.sunIntensity = mixNumber(from.sunIntensity, to.sunIntensity, k);
    look.elevation = mixNumber(from.elevation, to.elevation, k);
    look.azimuth = mixNumber(from.azimuth, to.azimuth, k);
    look.hemiSky = mixHex(from.hemiSky, to.hemiSky, k);
    look.hemiGround = mixHex(from.hemiGround, to.hemiGround, k);
    look.hemiIntensity = mixNumber(from.hemiIntensity, to.hemiIntensity, k);
    look.water = mixHex(from.water, to.water, k);
    look.glow = mixNumber(from.glow, to.glow, k);
    look.stars = mixNumber(from.stars, to.stars, k);
    look.horizon = mixNumber(from.horizon, to.horizon, k);
    return true;
  }
}
