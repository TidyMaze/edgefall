// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_STATIONS } from './stations';
import './test/openworldwasm';
import { boot, type Game } from './test/harness';

// The sounding stations (#1577, world.md section 7, Spatial), through the jsdom harness: nobody can listen here, so the page
// reports the stations that sound and their gain and pan (`__stations`) and these tests read it. The listener is the camera.
interface Heard {
  id: string;
  kind: string;
  gain: number;
  pan: number;
}
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const gesture = (): boolean => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
const heard = (game: Game): Heard[] => (game.frame(), game.hook<Heard[]>('__stations'));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const LOUD = { 'ab-alone.volume.ambience': '100' };

describe('the stations of the Hub sound near the camera (#1577)', () => {
  it('plays none before the first gesture, then the terminals and the lift near the camera, at most MAX_STATIONS', async () => {
    const game = await boot('', { audio: true, storage: LOUD });
    expect(heard(game)).toEqual([]); // no context before a gesture
    gesture();
    const now = heard(game);
    expect(now.length).toBeGreaterThan(0);
    expect(now.length).toBeLessThanOrEqual(MAX_STATIONS);
    for (const station of now) {
      expect(['terminal', 'machinery']).toContain(station.kind);
      expect(station.gain).toBeGreaterThan(0);
      expect(Math.abs(station.pan)).toBeLessThanOrEqual(0.8);
    }
  });

  it('plays none with the ambience slider at 0', async () => {
    const game = await boot('', { audio: true, storage: { 'ab-alone.volume.ambience': '0', 'ab-alone.volume.music': '100' } });
    gesture();
    expect(heard(game)).toEqual([]);
  });

  it('plays none on a board game: no station there', async () => {
    const game = await boot('?bot=off', { audio: true, storage: LOUD });
    gesture();
    byId('hotseat')?.click();
    byId('battle-royale').click();
    expect(heard(game)).toEqual([]);
  });
});

describe('the stations of the Open world sound near the camera (#1577)', () => {
  it('plays the spawn town, a town station, from the first frames of a world', async () => {
    const game = await boot('?bot=off&openworld=7', { audio: true, storage: LOUD });
    gesture();
    await settle();
    const now = heard(game);
    expect(now.map((s) => s.kind)).toContain('town');
    expect(now.length).toBeLessThanOrEqual(MAX_STATIONS);
  });
});
