// The particles of the Open world (#1110, docs/specs/openworld-animation.md sections 1 and 6): pollen, leaves, snow and heat dust
// drifting round the hero by biome, and the dust puff under a step. One pool of a fixed size, each slot a particle whose pose is a pure
// function of the time (its origin, its speed and its birth), so it is unit-tested; the view draws the pool as one instanced mesh.
import type { Biome } from './openworld';

/** The pool's size: 64 on a desktop, 24 on a touch phone. */
export const CAP_DESKTOP = 64;
export const CAP_PHONE = 24;
/** The cap for this device. */
export const capFor = (): number => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? CAP_PHONE : CAP_DESKTOP);

/** What one kind of particle does: `rate` born a second, each lives `life` ms; it starts `lift` to `lift + spread` above the hero's
 * ground, moves up `rise` cells a second (negative falls) and sways `sway` cells sideways; `size` is its radius in cells. */
export interface Look {
  rate: number;
  life: number;
  lift: number;
  spread: number;
  rise: number;
  sway: number;
  size: number;
  colour: number;
  /** A pull down, in cells a second squared (the splash's droplets fall back); none when absent. */
  gravity?: number;
}

/** The ambient particles by biome, born within `RADIUS` cells of the hero. The badlands and the archipelago have none. */
export const AMBIENT: Partial<Record<Biome, Look>> = {
  meadow: { rate: 12, life: 4000, lift: 0.2, spread: 1.4, rise: 0.12, sway: 0.35, size: 0.14, colour: 0xfff0a0 },
  forest: { rate: 8, life: 6000, lift: 2.2, spread: 0.8, rise: -0.35, sway: 0.5, size: 0.15, colour: 0xe08a2e },
  tundra: { rate: 11, life: 5000, lift: 2.4, spread: 1.0, rise: -0.45, sway: 0.25, size: 0.17, colour: 0xffffff },
  desert: { rate: 14, life: 3000, lift: 0.1, spread: 0.8, rise: 0.15, sway: 0.4, size: 0.14, colour: 0xf0c888 },
  badlands: { rate: 9, life: 3500, lift: 0.1, spread: 1.0, rise: 0.4, sway: 0.3, size: 0.1, colour: 0xff7a4a }, // embers rising off the hot rock (#1736)
  archipelago: { rate: 10, life: 2500, lift: 0.05, spread: 1.2, rise: 0.3, sway: 0.6, size: 0.12, colour: 0xd8f4ff }, // sea spray (#1736)
};

/** The dust puff of a step: `count` grains thrown outward from the cell the hero leaves, gone within `life` ms. */
export const PUFF = {
  count: 5,
  speed: 0.7,
  look: { rate: 0, life: 350, lift: 0, spread: 0, rise: 0.25, sway: 0, size: 0.08, colour: 0xcdbf9e } satisfies Look,
};

/** The splash of an enemy that falls into the water (#1101): `count` droplets that rise 0.3 and fall back in 600 ms (thrown up at 2 cells a second against a
 * gravity of 20/3, the top is 0.3 above the water at 300 ms). */
export const SPLASH = {
  count: 6,
  speed: 0.4,
  look: { rate: 0, life: 600, lift: 0, spread: 0, rise: 2, sway: 0, size: 0.05, colour: 0xbfe8f2, gravity: 20 / 3 } satisfies Look,
};

/** The shards of a broken obstacle (#1147): `count` flakes of the prop's colour thrown outward, falling, gone within `life` ms. */
export const SHARDS = {
  count: 6,
  speed: 1.5,
  look: { rate: 0, life: 700, lift: 0, spread: 0, rise: -0.9, sway: 0, size: 0.14, colour: 0xffffff } satisfies Look,
};
/** The sparks of a push's contact (#1561): `count` grains, never more than that alive from the burst, thrown out from the contact cell. */
export const BURST = {
  count: 4,
  speed: 2,
  look: { rate: 0, life: 300, lift: 0, spread: 0, rise: 0.5, sway: 0, size: 0.14, colour: 0xffe070 } satisfies Look,
};
/** Reduced motion: the prop just fades where it stood, as one particle of its size that does not move. */
export const FADE: Look = { rate: 0, life: 300, lift: 0, spread: 0, rise: 0, sway: 0, size: 0.3, colour: 0xffffff };

/** How far from the hero the ambient particles are born, in cells (the spec's radius of 6). */
const RADIUS = 6;
/** The longest gap between two frames that owes particles, in ms: a hidden tab does not burst on return. */
const MAX_GAP = 250;
/** The shares of a life spent fading in and fading out. */
const FADE_IN = 0.15;
const FADE_OUT = 0.25;

/** The pose of a particle, written by `pose`: its place, its radius (0 at the ends of its life) and its colour. */
export interface ParticlePose {
  x: number;
  y: number;
  z: number;
  s: number;
  colour: number;
}

export class ParticlePool {
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly oz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly grav: Float32Array;
  private readonly sway: Float32Array;
  private readonly phase: Float32Array;
  private readonly size: Float32Array;
  private readonly colour: Uint32Array;
  private readonly born: Float64Array;
  private readonly life: Float32Array;
  /** The slots that hold a fade (#1147): reduced motion keeps them while it clears the rest. */
  private readonly fades: Uint8Array;
  /** The slots that hold a spark of a contact burst (#1561): a burst owes only what its four leave free. */
  private readonly burstSlots: Uint8Array;
  private last = -Infinity;
  private owed = 0;
  private warm = false;
  private seed = 2463534242;

  constructor(readonly cap: number) {
    this.ox = new Float32Array(cap);
    this.oy = new Float32Array(cap);
    this.oz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.sway = new Float32Array(cap);
    this.phase = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.colour = new Uint32Array(cap);
    this.born = new Float64Array(cap).fill(-Infinity); // no slot is alive at any time, past times included
    this.life = new Float32Array(cap);
    this.fades = new Uint8Array(cap);
    this.burstSlots = new Uint8Array(cap);
  }

  /** The next number in `[0, 1)`: a xorshift, so a pool is the same every run and allocates nothing. */
  private random(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  /** How many particles are alive at `now` (ms). */
  alive(now: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (now - this.born[i]! < this.life[i]!) n++;
    return n;
  }

  /** Writes the pose of slot `i` at `now` into `out`; false when the slot holds no live particle. */
  pose(i: number, now: number, out: ParticlePose): boolean {
    const age = now - this.born[i]!;
    const life = this.life[i]!;
    if (!(age >= 0 && age < life)) return false; // not born yet (a splash waits for the fall), or over
    const fade = Math.min(1, age / (life * FADE_IN), (life - age) / (life * FADE_OUT));
    const t = age / 1000;
    out.x = this.ox[i]! + this.vx[i]! * t + this.sway[i]! * Math.sin(this.phase[i]! + age / 700);
    out.y = this.oy[i]! + this.vy[i]! * t - 0.5 * this.grav[i]! * t * t;
    out.z = this.oz[i]! + this.vz[i]! * t;
    out.s = this.size[i]! * fade;
    out.colour = this.colour[i]!;
    return true;
  }

  /** Puts a particle of `look` at the place and speed given, in the first free slot; false (nothing born) when the pool is full. */
  private spawn(look: Look, x: number, y: number, z: number, now: number, vx: number, vz: number, colour = look.colour, fade = 0, burst = 0): boolean {
    for (let i = 0; i < this.cap; i++) {
      if (now - this.born[i]! < this.life[i]!) continue;
      this.ox[i] = x;
      this.oy[i] = y;
      this.oz[i] = z;
      this.vx[i] = vx;
      this.vy[i] = look.rise;
      this.grav[i] = look.gravity ?? 0;
      this.vz[i] = vz;
      this.sway[i] = look.sway;
      this.phase[i] = this.random() * 2 * Math.PI;
      this.size[i] = look.size;
      this.colour[i] = colour;
      this.fades[i] = fade;
      this.burstSlots[i] = burst;
      this.born[i] = now;
      this.life[i] = look.life;
      return true;
    }
    return false;
  }

  /** Born by the frame at `now` (ms): the particles `look` owes since the last frame, round `hero`. No look, no new particle: those
   * alive finish their life. */
  step(now: number, hero: { x: number; y: number; z: number }, look: Look | undefined): void {
    const gap = Math.min(MAX_GAP, now - this.last);
    this.last = now;
    if (!look) {
      this.owed = 0;
      return;
    }
    // The first look of a pool (after a clear too) starts the world already alive: the particles a steady state holds, at random
    // points of their life.
    for (let k = this.warm ? 0 : Math.floor((look.rate * look.life) / 1000); k > 0; k--) this.bear(look, hero, now - this.random() * look.life * 0.9);
    this.warm = true;
    this.owed += (look.rate * gap) / 1000;
    for (; this.owed >= 1; this.owed--) {
      this.bear(look, hero, now);
    }
  }

  /** Born at `at` (ms), somewhere within `RADIUS` cells of `hero`. */
  private bear(look: Look, hero: { x: number; y: number; z: number }, at: number): void {
    const angle = this.random() * 2 * Math.PI;
    const far = Math.sqrt(this.random()) * RADIUS;
    this.spawn(look, hero.x + Math.cos(angle) * far, hero.y + look.lift + this.random() * look.spread, hero.z + Math.sin(angle) * far, at, 0, 0);
  }

  /** The dust puff of a step: `PUFF.count` grains thrown outward from (`x`, `y`, `z`) at `now`. */
  puff(x: number, y: number, z: number, now: number): void {
    for (let k = 0; k < PUFF.count; k++) {
      const angle = ((k + this.random()) / PUFF.count) * 2 * Math.PI;
      this.spawn(PUFF.look, x, y, z, now, Math.cos(angle) * PUFF.speed, Math.sin(angle) * PUFF.speed);
    }
  }

  /** The sparks of a contact at (`x`, `y`, `z`), born at `at` (ms): up to `BURST.count` grains, fewer while the sparks of an earlier burst still live. */
  burst(x: number, y: number, z: number, at: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) if (this.burstSlots[i] && at - this.born[i]! < this.life[i]!) live++;
    for (let k = live; k < BURST.count; k++) {
      const angle = ((k + this.random()) / BURST.count) * 2 * Math.PI;
      this.spawn(BURST.look, x, y, z, at, Math.cos(angle) * BURST.speed, Math.sin(angle) * BURST.speed, BURST.look.colour, 0, 1);
    }
  }

  /** The splash of the water at (`x`, `y`, `z`): `SPLASH.count` droplets that start at `at` (ms), maybe in the future (the fall of an ejected
   * marble starts after the step and the slide). */
  splash(x: number, y: number, z: number, at: number): void {
    for (let k = 0; k < SPLASH.count; k++) {
      const angle = ((k + this.random()) / SPLASH.count) * 2 * Math.PI;
      this.spawn(SPLASH.look, x, y, z, at, Math.cos(angle) * SPLASH.speed, Math.sin(angle) * SPLASH.speed);
    }
  }

  /** A broken prop of `colour` at (`x`, `y`, `z`), at `now` (ms) (#1147): shards thrown outward, or under `reduced` motion one fade. */
  shatter(x: number, y: number, z: number, now: number, colour: number, reduced: boolean): void {
    if (reduced) {
      this.spawn(FADE, x, y, z, now, 0, 0, colour, 1);
      return;
    }
    for (let k = 0; k < SHARDS.count; k++) {
      const angle = ((k + this.random()) / SHARDS.count) * 2 * Math.PI;
      this.spawn(SHARDS.look, x, y, z, now, Math.cos(angle) * SHARDS.speed, Math.sin(angle) * SHARDS.speed, colour);
    }
  }

  /** Ends every particle at once: a far zoom draws none, and reduced motion none but the fades (`keepFades`). */
  clear(keepFades = false): void {
    for (let i = 0; i < this.cap; i++) {
      if (keepFades && this.fades[i]) continue;
      this.life[i] = 0;
      this.born[i] = -Infinity; // a droplet not yet born goes too
    }
    this.owed = 0;
    this.warm = false;
  }
}
