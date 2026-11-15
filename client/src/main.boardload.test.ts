// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { Axial } from './board';
import { NEON_LIGHT } from './neonlook';
import { TERRACE_EXPOSURE } from './tablezero';
import { neighbours } from './openworld';
import './test/openworldwasm';
import { world_enemies } from 'edgefall-wasm';
import { boot, type Game } from './test/harness';

// #1520, docs/specs/openworld.md section 17: a page that opens in the Open world fetches none of the files that only the board needs (the
// bay of the room, the arena, its kit and its slabs, about 620 KB). They are asked for when the world is left for a fight or the ship.

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const BOARD_FILES = ['spaceship-bay.glb', 'arena.glb', 'kit-arena.glb', 'kit-ring-hint.glb', 'kit-boss.glb', 'slab-ballast.glb', 'slab-dual.glb', 'slab-hub.glb', 'slab-royale.glb'];
const boardFiles = (game: Game): string[] => game.models().filter((name) => BOARD_FILES.includes(name));
// The deck set (#1603, 60 KB): the steel, the plate, the rim and the crack take it at the first board draw, not at the entry.
const DECK_FILES = ['deck-albedo.ktx2', 'deck-roughness.ktx2', 'crack-decal.ktx2', 'deck-mess-roughness.ktx2', 'deck-mess.ktx2', 'deck-mess-normal.ktx2'];
const deckFiles = (game: Game): string[] => game.textures().filter((name) => DECK_FILES.includes(name));
const hooks = () => window as unknown as { __openworldFixture: (f: { hero: Axial; troop: Axial[] }) => void };
/** The first seed with a generated marble within 10 cells of the spawn, and where it starts (as main.wild.test.ts). */
const { seed, home } = (() => {
  for (let n = 1; n < 100; n++) {
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as Axial[]) {
      const flat = world_enemies(n, cx, cy);
      for (let i = 0; i < flat.length; i += 2) if (Math.max(Math.abs(flat[i]!), Math.abs(flat[i + 1]!), Math.abs(flat[i]! + flat[i + 1]!)) <= 10) return { seed: n, home: [flat[i]!, flat[i + 1]!] as Axial };
    }
  }
  throw new Error('no seed');
})();
afterEach(() => vi.useRealTimers());
/** Frames of the animation loop, with the tasks of a load in between. */
async function frames(game: Game, n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await game.settle();
    game.frame();
  }
}

describe('the files of the board (#1520)', () => {
  it('a page opened in the world fetches no file of the board, and its Loading plate leaves with the first world frame', async () => {
    const game = await boot('?bot=off&openworld=7');
    await game.settle();
    expect(data().openworldAt).toBe('0,0');
    expect(game.models()).toContain('openworld.glb');
    expect(boardFiles(game)).toEqual([]);
    expect(deckFiles(game)).toEqual([]);
    expect(data().bay).toBeUndefined();
    expect(byId('loading').hidden).toBe(false);
    game.frame();
    expect(byId('loading').hidden).toBe(true);
    expect(data().veil).toBeUndefined();
  });

  it('a page opened in the world draws it with the tone mapping and the exposure of the terrace, which the world shared with the board when this was in first', async () => {
    const game = await boot('?bot=off&openworld=7&look=terrace'); // the terrace's tone mapping: the neon default has its own (#1424)
    await game.settle();
    game.frame();
    expect(game.tone()).toEqual({ mapping: THREE.AgXToneMapping, exposure: TERRACE_EXPOSURE });
    const neon = await boot('?bot=off&openworld=7&look=neon');
    await neon.settle();
    neon.frame();
    expect(neon.tone()).toEqual({ mapping: THREE.NoToneMapping, exposure: NEON_LIGHT.exposure });
  });

  it('a page that does not open in the world fetches them at the load, as before', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(boardFiles(game).sort()).toEqual([...BOARD_FILES].sort());
    expect(data().bay).toBe('ready');
  });

  it('a page that does not open in the world fetches the deck set at the load, as before (#1603)', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(deckFiles(game)).toEqual(expect.arrayContaining(DECK_FILES.slice(0, 5)));
    expect(data().deckSet).toBe('mess');
  });

  it('the deck set waits for the first board draw, and the board is drawn flat where its files do not load (#1603)', async () => {
    const game = await boot('?bot=off&openworld=7', { missing: ['crack-decal.ktx2', 'deck-albedo.ktx2', 'deck-mess-normal.ktx2'] });
    await game.settle();
    expect(deckFiles(game)).toEqual([]);
    byId('ship').click(); // the board is asked for: its deck set with it
    expect(deckFiles(game)).toEqual(expect.arrayContaining(['deck-roughness.ktx2', 'deck-mess-roughness.ktx2', 'deck-mess.ktx2']));
    await frames(game);
    expect(data().scene).toBe('table-zero');
    expect(data().deckSet).toBeUndefined(); // no albedo: the steel stays flat, as it does at the load when the file fails
  });

  it('on the high tier the deck set brings the normal map of the deck in play, with the first board draw (#1603)', async () => {
    const game = await boot('?bot=off&openworld=7&quality=high');
    await game.settle();
    expect(deckFiles(game)).toEqual([]);
    byId('ship').click();
    expect(deckFiles(game)).toEqual(expect.arrayContaining(['deck-mess-normal.ktx2']));
    await frames(game);
    expect(data().deckSet).toBe('mess');
  });

  it('the deck set dresses the steel with its albedo and roughness when the normal map of the deck fails (#1603)', async () => {
    const game = await boot('?bot=off&openworld=7&quality=high', { missing: ['deck-mess-normal.ktx2'] });
    await game.settle();
    byId('ship').click();
    await frames(game);
    expect(data().deckSet).toBe('mess');
  });

  it('a page that comes back to a wild fight opens in the world and fetches none either', async () => {
    const game = await boot('?bot=off', { storage: { 'ab-alone.wild': '7' } });
    await game.settle();
    expect(data().openworld).toBe('1305'); // the public world: the seed of the mark is read under no automation only
    expect(boardFiles(game)).toEqual([]);
  });

  it('the touch of a wild marble asks for them with the wipe, and the arena stands on the terrace once they are in', async () => {
    const game = await boot(`?bot=off&openworld=${seed}`);
    byId('openworld').click();
    await game.settle();
    expect(boardFiles(game)).toEqual([]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: neighbours(home)[0]!, troop: [] });
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    expect(boardFiles(game).sort()).toEqual([...BOARD_FILES].sort()); // asked for as the wipe closes, half a second before the fight
    expect(deckFiles(game)).toEqual(expect.arrayContaining(DECK_FILES.slice(0, 4))); // the deck set comes with them (#1603)
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
    await frames(game);
    expect(data().openworld).toBeUndefined();
    expect(data().scene).toBe('table-zero');
    expect(data().bay).toBe('ready');
  });

  it('leaving the world for the ship asks for them, and the canvas stays veiled until the terrace is drawn', async () => {
    const game = await boot('?bot=off&openworld=7');
    await game.settle();
    game.frame();
    expect(data().veil).toBeUndefined();
    byId('ship').click();
    expect(boardFiles(game).sort()).toEqual([...BOARD_FILES].sort());
    expect(data().veil).toBe('on'); // no room under the world, no blank board: nothing is shown until the terrace is drawn
    expect(document.querySelector<HTMLCanvasElement>('canvas')!.style.opacity).toBe('0');
    await frames(game);
    expect(data().veil).toBeUndefined();
    expect(data().scene).toBe('table-zero');
  });

  it('Escape leaves the world for the board, which asks for its files and stays veiled until they are drawn', async () => {
    const game = await boot('?bot=off&openworld=7');
    await game.settle();
    expect(boardFiles(game)).toEqual([]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(data().openworld).toBeUndefined();
    expect(boardFiles(game).sort()).toEqual([...BOARD_FILES].sort());
    expect(data().veil).toBe('on');
    await frames(game);
    expect(data().veil).toBeUndefined();
    expect(data().scene).toBe('table-zero');
  });

  it('rolling onto a town leaves the world before the page is told, and the page asks for the files all the same', async () => {
    const game = await boot('?bot=off&openworld=7');
    await game.settle();
    const [q, r] = data()
      .openworldPlaces!.split(' ')
      .find((place) => place.startsWith('town:'))!
      .slice('town:'.length)
      .split(',')
      .map(Number) as unknown as Axial;
    hooks().__openworldFixture({ hero: [q - 1, r], troop: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(data().hub).toBeTruthy();
    expect(boardFiles(game).sort()).toEqual([...BOARD_FILES].sort());
    await frames(game);
    expect(data().scene).toBe('table-zero');
  });

  it('asks only once, however often the world is left', async () => {
    const game = await boot('?bot=off&openworld=7');
    await game.settle();
    expect(boardFiles(game)).toEqual([]);
    byId('ship').click();
    await game.settle();
    byId('openworld').click();
    await game.settle();
    byId('ship').click();
    await game.settle();
    expect(boardFiles(game)).toHaveLength(BOARD_FILES.length);
  });
});
