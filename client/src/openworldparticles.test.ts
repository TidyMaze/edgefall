import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMBIENT, capFor, BURST, FADE, PUFF, ParticlePool, SHARDS, SPLASH, type Look } from './openworldparticles';

const hero = { x: 0, y: 1, z: 0 };
/** A look that spends the warm start and spawns nothing. */
const QUIET: Look = { ...AMBIENT.tundra!, rate: 0, life: 0 };
const pose = { x: 0, y: 0, z: 0, s: 0, colour: 0 };
/** Steps the pool every 16 ms from `from` up to `to` ms. */
function run(pool: ParticlePool, look: Look | undefined, to: number, from = 0): void {
  if (from === 0) pool.step(-16, hero, QUIET); // no warm start here: the pool is empty at 0
  for (let t = from; t <= to; t += 16) pool.step(t, hero, look);
}

describe('the air of every biome (#1736)', () => {
  it('drifts its own motes in each of the six biomes: embers rise in the badlands, spray over the archipelago', () => {
    expect(Object.keys(AMBIENT).sort()).toEqual(['archipelago', 'badlands', 'desert', 'forest', 'meadow', 'tundra']);
    expect(AMBIENT.badlands!.rise).toBeGreaterThan(0);
    expect(new Set(Object.values(AMBIENT).map((a) => a!.colour)).size).toBe(6);
  });
});

describe('capFor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is 64 on a desktop, 24 on a touch phone, 64 where there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
    expect(capFor()).toBe(24);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(capFor()).toBe(64);
    vi.stubGlobal('matchMedia', undefined);
    expect(capFor()).toBe(64);
  });
});

describe('ParticlePool', () => {
  it('has its cap of slots from the start and none alive', () => {
    const pool = new ParticlePool(8);
    expect(pool.cap).toBe(8);
    expect(pool.alive(0)).toBe(0);
  });

  it('spawns ambient particles near the hero at the look rate, and no more than the cap', () => {
    const pool = new ParticlePool(64);
    run(pool, AMBIENT.tundra, 2000);
    const n = pool.alive(2000);
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThanOrEqual(64);
    for (let i = 0; i < pool.cap; i++) {
      if (!pool.pose(i, 2000, pose)) continue;
      expect(Math.hypot(pose.x - hero.x, pose.z - hero.z)).toBeLessThanOrEqual(7);
    }
  });

  it('starts a biome already alive, most of the pool, at random points of the particles life', () => {
    const pool = new ParticlePool(64);
    pool.step(0, hero, AMBIENT.tundra);
    expect(pool.alive(0)).toBeGreaterThanOrEqual(40);
    expect(pool.alive(0)).toBeLessThanOrEqual(64);
  });

  it('warms up on the first look, not on a first frame without one, and again after a clear', () => {
    const pool = new ParticlePool(64);
    pool.step(0, hero, undefined);
    pool.step(16, hero, AMBIENT.tundra);
    expect(pool.alive(16)).toBeGreaterThanOrEqual(40);
    pool.clear();
    pool.step(32, hero, AMBIENT.tundra);
    expect(pool.alive(32)).toBeGreaterThanOrEqual(40);
  });

  it('never grows past a small cap, and drops the spawn that finds no slot', () => {
    const pool = new ParticlePool(3);
    run(pool, AMBIENT.tundra, 3000);
    expect(pool.alive(3000)).toBe(3);
  });

  it('moves a particle as a pure function of time: snow falls, pollen rises, a leaf falls', () => {
    for (const [biome, dir] of [['tundra', -1], ['meadow', 1], ['forest', -1]] as const) {
      const pool = new ParticlePool(1);
      pool.step(-1, hero, QUIET);
      pool.step(0, hero, { ...AMBIENT[biome]!, rate: 1000 });
      expect(pool.pose(0, 1000, pose)).toBe(true);
      const y0 = pose.y;
      expect(pool.pose(0, 1400, pose)).toBe(true);
      expect(Math.sign(pose.y - y0)).toBe(dir);
      const second = { ...pose };
      pool.pose(0, 1400, pose);
      expect(pose).toEqual(second); // same time, same pose
    }
  });

  it('fades a particle in at its birth and out at its end, and frees the slot after its life', () => {
    const look = { ...AMBIENT.tundra!, rate: 1000 };
    const pool = new ParticlePool(1);
    pool.step(-1, hero, QUIET);
    pool.step(0, hero, look);
    expect(pool.pose(0, 0, pose)).toBe(true);
    expect(pose.s).toBe(0); // just born
    pool.pose(0, look.life / 2, pose);
    expect(pose.s).toBeCloseTo(look.size, 5);
    pool.pose(0, look.life - 10, pose);
    expect(pose.s).toBeLessThan(look.size);
    expect(pose.s).toBeGreaterThan(0);
    expect(pool.pose(0, look.life + 1, pose)).toBe(false);
    expect(pool.alive(look.life + 1)).toBe(0);
  });

  it('lets the particles finish and spawns no new one when the biome has no look', () => {
    const pool = new ParticlePool(64);
    run(pool, AMBIENT.forest, 2000);
    const n = pool.alive(2000);
    expect(n).toBeGreaterThan(0);
    run(pool, undefined, 2200, 2016);
    expect(pool.alive(2200)).toBe(n);
    run(pool, undefined, 9000, 2216);
    expect(pool.alive(9000)).toBe(0);
  });

  it('caps what a long pause of the frames owes (a hidden tab)', () => {
    const pool = new ParticlePool(64);
    pool.step(-1, hero, QUIET);
    pool.step(0, hero, AMBIENT.tundra);
    pool.step(600000, hero, AMBIENT.tundra);
    expect(pool.alive(600000)).toBeLessThanOrEqual(3);
  });

  it('bursts a few sparks at the contact of a push, never more than the burst holds alive, from the slots of the pool (#1561)', () => {
    const pool = new ParticlePool(64);
    pool.burst(2, 1, 3, 100);
    expect(pool.alive(100)).toBe(BURST.count);
    expect(BURST.count).toBeLessThanOrEqual(4);
    pool.burst(2, 1, 3, 150); // a second hit while the first still lives adds none
    expect(pool.alive(150)).toBe(BURST.count);
    expect(pool.alive(100 + BURST.look.life + 1)).toBe(0);
    pool.burst(2, 1, 3, 1000); // once they are gone, the next hit bursts again
    expect(pool.alive(1000)).toBe(BURST.count);
  });

  it('puffs a few dust particles outward from a point that are gone in under half a second', () => {
    const pool = new ParticlePool(64);
    pool.puff(2, 1, 3, 100);
    expect(pool.alive(100)).toBe(PUFF.count);
    pool.pose(0, 300, pose);
    expect(Math.hypot(pose.x - 2, pose.z - 3)).toBeGreaterThan(0.01);
    expect(PUFF.look.life).toBeLessThan(500);
    expect(pool.alive(100 + PUFF.look.life + 1)).toBe(0);
  });

  it('shatters a prop into shards of its colour that fly outward, fall, and are gone in under a second (#1147)', () => {
    const pool = new ParticlePool(64);
    pool.shatter(2, 1, 3, 100, 0x6b7480, false);
    expect(pool.alive(100)).toBe(SHARDS.count);
    pool.pose(0, 400, pose);
    expect(Math.hypot(pose.x - 2, pose.z - 3)).toBeGreaterThan(0.1);
    expect(pose.y).toBeLessThan(1);
    expect(pose.colour).toBe(0x6b7480);
    expect(SHARDS.look.life).toBeLessThan(1000);
    expect(pool.alive(100 + SHARDS.look.life + 1)).toBe(0);
  });

  it('fades a prop in place under reduced motion: one still particle that clear() spares only when asked to keep fades (#1147)', () => {
    const pool = new ParticlePool(64);
    pool.shatter(2, 1, 3, 100, 0x2fb5a0, true);
    expect(pool.alive(100)).toBe(1);
    pool.pose(0, 200, pose);
    expect([pose.x, pose.y, pose.z]).toEqual([2, 1, 3]);
    expect(pose.s).toBeGreaterThan(0);
    expect(FADE.life).toBeLessThan(500);
    pool.clear(true);
    expect(pool.alive(100)).toBe(1);
    pool.clear();
    expect(pool.alive(100)).toBe(0);
    pool.shatter(0, 0, 0, 100, 0, false);
    pool.clear(true);
    expect(pool.alive(100)).toBe(0); // shards are not fades
  });

  it('clears every particle at once', () => {
    const pool = new ParticlePool(64);
    run(pool, AMBIENT.tundra, 2000);
    pool.puff(0, 0, 0, 2000);
    pool.clear();
    expect(pool.alive(2000)).toBe(0);
    expect(pool.pose(0, 2000, pose)).toBe(false);
  });

  it('has a look for every biome, each within the desktop cap (#1736: the badlands and the archipelago too)', () => {
    expect(Object.keys(AMBIENT).sort()).toEqual(['archipelago', 'badlands', 'desert', 'forest', 'meadow', 'tundra']);
    for (const look of Object.values(AMBIENT)) expect(look.rate * (look.life / 1000)).toBeLessThanOrEqual(56);
  });
});

describe('the splash of the water (#1101)', () => {
  const at = (pool: ParticlePool, i: number, now: number) => (pool.pose(i, now, pose) ? { ...pose } : null);

  it('throws 6 droplets up 0.3 and back down into the cell, in 600 ms, from a start in the future', () => {
    const pool = new ParticlePool(24);
    pool.splash(2, 0.1, 3, 1000);
    expect(at(pool, 0, 900)).toBeNull(); // not born yet
    expect(pool.alive(1000)).toBe(SPLASH.count);
    const peak = Math.max(...Array.from({ length: 60 }, (_, k) => at(pool, 0, 1000 + k * 10)?.y ?? -9));
    expect(peak - 0.1).toBeGreaterThan(0.2);
    expect(peak - 0.1).toBeLessThan(0.4);
    expect(at(pool, 0, 1590)!.y).toBeLessThan(0.15); // back at the water
    expect(pool.alive(1600)).toBe(0);
  });

  it('forgets a droplet that has not been born yet when it is cleared', () => {
    const pool = new ParticlePool(24);
    pool.splash(0, 0, 0, 5000);
    pool.clear();
    expect(pool.alive(4000)).toBe(0);
    expect(at(pool, 0, 5100)).toBeNull();
  });
});
