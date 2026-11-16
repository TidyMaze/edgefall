import { afterAll, beforeAll } from 'vitest';
import { AMBIENT } from '../openworldparticles';

/** Holds every biome's own motes for the file it is called in (#1736: each biome drifts some): a test of what the view or the mode
 * draws sees only what it moves itself. */
export function holdMotes(): void {
  const rates = new Map<string, number>();
  beforeAll(() => {
    for (const [biome, look] of Object.entries(AMBIENT)) {
      rates.set(biome, look!.rate);
      look!.rate = 0;
    }
  });
  afterAll(() => {
    for (const [biome, rate] of rates) AMBIENT[biome as keyof typeof AMBIENT]!.rate = rate;
  });
}
