// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LEGACY_UNLOCKED } from './collector';
import { pulseRate } from './scenes';
import { newRun } from './roguelite';
import './test/openworldwasm';
import { boot, type Game, startBoss } from './test/harness';

// The scene of the music (#1571, world.md section 7), through the jsdom harness: nobody can listen here, so the page reports
// the scene it plays (`__scene`, like `__tension` for the drones) and these tests read it. The loop of the page names the scene
// every frame; no layer before the first gesture, none with the music slider at 0.
interface Scene {
  id: string | null;
  phase: number;
  layers: number;
  pulse: number;
  room: boolean;
  track: boolean;
}
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const gesture = (): boolean => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
const scene = (game: Game): Scene => (game.frame(), game.hook<Scene>('__scene'));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const LOUD = { 'ab-alone.volume.music': '100' }; // under automation the music starts at 0 (readMix), as e2e pages would play it out loud
const CELL = { forest: [36, -115], desert: [-85, 14], meadow: [-7, 0] } as const; // one cell of each biome of seed 1 (openworldambiencemode.test.ts)

function start(game: Game, name: string): void {
  startBoss(name);
}

describe('the scene of the music, per mode (#1571)', () => {
  it('names the hub on a fresh page, and starts its layers at the first gesture, not before', async () => {
    const game = await boot('', { audio: true, storage: LOUD });
    expect(scene(game)).toMatchObject({ id: 'hub', layers: 0 }); // no context before a gesture
    gesture();
    expect(scene(game)).toMatchObject({ id: 'hub', layers: 1, room: true, track: true });
  });

  it('names the bot scene on a game of the board', async () => {
    const game = await boot('?bot=off', { audio: true, storage: LOUD });
    gesture();
    expect(scene(game)).toMatchObject({ id: 'bot', layers: 1 });
  });

  it('names the boss, its own pulse, and speeds the pulse up when the phase moves', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, audio: true, storage: LOUD });
    gesture();
    const wasm = await import('edgefall-wasm');
    let phase = 0;
    vi.spyOn(wasm.Encounter.prototype, 'phase').mockImplementation(() => phase);
    start(game, 'The Echo');
    expect(scene(game)).toMatchObject({ id: 'boss:echo', phase: 0, pulse: pulseRate(0), track: false });
    phase = 2;
    expect(scene(game)).toMatchObject({ id: 'boss:echo', phase: 2, pulse: pulseRate(2) });
  });

  it('names the royale, and the map then the fight of a rogue-lite run', async () => {
    const game = await boot('?bot=off', { audio: true, storage: LOUD });
    gesture();
    byId('battle-royale').click();
    expect(scene(game).id).toBe('royale');
    byId('roguelite').click();
    expect(scene(game).id).toBe('run-map');
    await game.hook('__run', { ...newRun(1, 3, LEGACY_UNLOCKED), enemies: false, path: [0], fighting: true });
    expect(scene(game).id).toBe('run-fight');
  });

  it('plays no layer with the music and the ambience sliders at 0', async () => {
    const storage = { 'ab-alone.volume.music': '0', 'ab-alone.volume.ambience': '0' };
    const game = await boot('?bot=off', { audio: true, storage });
    gesture();
    start(game, 'The Echo');
    expect(scene(game)).toMatchObject({ id: 'boss:echo', layers: 0 });
  });
});

describe('the scene of the music in the Open world, by biome and hour (#1571)', () => {
  type Hooks = { __openworldFixture: (f: { hero: [number, number]; troop: [number, number][]; enemies: [number, number][] }) => void; __openworldTime: (ms: number) => void };
  const hooks = (): Hooks => window as unknown as Hooks;
  async function enter(): Promise<Game> {
    const game = await boot('?bot=off&openworld=1', { audio: true, storage: LOUD });
    gesture();
    byId('openworld').click();
    await settle();
    return game;
  }
  const stand = (cell: readonly [number, number]): void => hooks().__openworldFixture({ hero: [...cell], troop: [], enemies: [] });

  it('names the biome under the hero and the hour of the day, and plays the wind, not the room tone', async () => {
    const game = await enter();
    stand(CELL.desert);
    expect(scene(game)).toMatchObject({ id: 'world:desert:day', layers: 2, room: false, track: false });
    stand(CELL.forest);
    expect(scene(game).id).toBe('world:forest:day');
    hooks().__openworldTime(360_000); // dusk
    expect(scene(game).id).toBe('world:forest:dusk');
    hooks().__openworldTime(450_000); // night
    expect(scene(game).id).toBe('world:forest:night');
  });

  it('leaves for the ship scene when the player leaves the world', async () => {
    const game = await enter();
    stand(CELL.meadow);
    expect(scene(game).id).toBe('world:meadow:day');
    startBoss('The Echo');
    expect(scene(game).id).toMatch(/^boss:/);
  });
});
