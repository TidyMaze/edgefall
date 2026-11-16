import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain Node script, no type declarations
import { OUTPUT, SOURCE, packModel } from './pack-models.mjs';

/** The JSON chunk of a .glb: its header is 12 bytes, then the chunk length, its type, and the JSON. */
const json = (glb: Buffer): { extensionsRequired?: string[] } =>
  JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));

const PUBLIC = new URL('../public/', import.meta.url);
const models = (dir: URL): string[] =>
  readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith('.glb'));

describe('pack-models', () => {
  it('ships every glTF model of the page meshopt-compressed (#61)', () => {
    expect(models(PUBLIC)).toEqual(['assets/pbr/arena.glb', 'assets/pbr/hub-cutaway-tall.glb', 'assets/pbr/hub-cutaway-wide.glb', 'assets/pbr/kit-arena.glb', 'assets/pbr/kit-boss.glb', 'assets/pbr/kit-ring-hint.glb', 'assets/pbr/openworld-biomes.glb', 'assets/pbr/openworld-hi.glb', 'assets/pbr/openworld-lair.glb', 'assets/pbr/openworld.glb', 'assets/pbr/slab-ballast.glb', 'assets/pbr/slab-dual.glb', 'assets/pbr/slab-hub.glb', 'assets/pbr/slab-royale.glb', 'assets/pbr/spaceship-bay.glb']);
    for (const file of models(PUBLIC)) {
      expect(json(readFileSync(new URL(file, PUBLIC))).extensionsRequired).toContain('EXT_meshopt_compression');
    }
  });

  it('keeps the committed models identical to the packed sources, which stay out of public/', async () => {
    expect(models(SOURCE)).toEqual(['arena.glb', 'hub-cutaway-tall.glb', 'hub-cutaway-wide.glb', 'kit-arena.glb', 'kit-boss.glb', 'kit-ring-hint.glb', 'openworld-biomes.glb', 'openworld-hi.glb', 'openworld-lair.glb', 'openworld.glb', 'slab-ballast.glb', 'slab-dual.glb', 'slab-hub.glb', 'slab-royale.glb', 'spaceship-bay.glb']);
    for (const name of models(SOURCE)) {
      expect(readFileSync(new URL(name, OUTPUT))).toEqual(await packModel(readFileSync(new URL(name, SOURCE))));
    }
  });

  it('runs as `bun run scripts/pack-models.mjs`', async () => {
    const written = new Map<string, Buffer>();
    vi.doMock('node:fs', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs')>()),
      writeFileSync: (url: URL, buf: Buffer) => written.set(fileURLToPath(url), buf),
    }));
    const log: unknown[][] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...line) => void log.push(line));
    const argv = process.argv[1];
    process.argv[1] = fileURLToPath(new URL('./pack-models.mjs', import.meta.url)); // as `bun run scripts/pack-models.mjs`
    vi.resetModules();
    try {
      await import('./pack-models.mjs');
    } finally {
      process.argv[1] = argv;
      vi.doUnmock('node:fs');
      spy.mockRestore();
    }
    const files = ['arena.glb', 'hub-cutaway-tall.glb', 'hub-cutaway-wide.glb', 'kit-arena.glb', 'kit-boss.glb', 'kit-ring-hint.glb', 'openworld-biomes.glb', 'openworld-hi.glb', 'openworld-lair.glb', 'openworld.glb', 'slab-ballast.glb', 'slab-dual.glb', 'slab-hub.glb', 'slab-royale.glb', 'spaceship-bay.glb'].map((name) => fileURLToPath(new URL(name, OUTPUT)));
    expect([...written.keys()]).toEqual(files);
    for (const file of files) expect(written.get(file)).toEqual(readFileSync(file));
    expect(log).toEqual([['public/assets/pbr/arena.glb'], ['public/assets/pbr/hub-cutaway-tall.glb'], ['public/assets/pbr/hub-cutaway-wide.glb'], ['public/assets/pbr/kit-arena.glb'], ['public/assets/pbr/kit-boss.glb'], ['public/assets/pbr/kit-ring-hint.glb'], ['public/assets/pbr/openworld-biomes.glb'], ['public/assets/pbr/openworld-hi.glb'], ['public/assets/pbr/openworld-lair.glb'], ['public/assets/pbr/openworld.glb'], ['public/assets/pbr/slab-ballast.glb'], ['public/assets/pbr/slab-dual.glb'], ['public/assets/pbr/slab-hub.glb'], ['public/assets/pbr/slab-royale.glb'], ['public/assets/pbr/spaceship-bay.glb']]);
  });
});
