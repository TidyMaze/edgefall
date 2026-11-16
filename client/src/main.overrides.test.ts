// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from './test/harness';

// A saved sceneoverrides.json (#875): the kiosk light's power over what lighttuning.ts tunes (100).
vi.mock('./sceneoverrides.json', () => ({ default: { power: { kioskGreenLight: 70 } } }));

afterEach(() => vi.unstubAllEnvs());

const spyScene = (): { scene: () => THREE.Scene } => {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene) scene ??= this;
    return add.apply(this, objects);
  });
  return { scene: () => scene! };
};

describe('main.ts, the saved scene overrides (#875)', () => {
  it('applies them after the tuning, under the sliders\' levels (lights 250 %), on every deck', async () => {
    const { scene } = spyScene();
    const game = await boot('?bot=off');
    const key = (): number => (scene().getObjectByName('kioskGreenLight') as THREE.Light).intensity;
    expect(key()).toBeCloseTo(70 * 2.5);
    game.hook('__setTier', 'low'); // the lights made again
    expect(key()).toBeCloseTo(70 * 2.5);
  });

  it('saves the panel through the dev server: the tuning behind the sliders, only what is off lighttuning.ts', async () => {
    await boot('?bot=off&lights');
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    document.querySelector<HTMLButtonElement>('#light-panel button[aria-label="Save to sceneoverrides.json"]')!.click();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method]).toEqual(['/__sceneoverrides', 'POST']);
    const { power } = JSON.parse(init.body as string);
    expect(power.kioskGreenLight).toBe(70); // 175 at 250 %, back to the file's 70
    expect(power.viewportRimLight).toBeUndefined(); // the tuned power
  });

  it('says so when the dev server refuses the save or cannot be reached, the click no longer looking like a success (#875)', async () => {
    await boot('?bot=off&lights');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = (): void => document.querySelector<HTMLButtonElement>('#light-panel button[aria-label="Save to sceneoverrides.json"]')!.click();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad power', { status: 400 })));
    save();
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    save();
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
  });

  it('has no Save button in the production build', async () => {
    vi.stubEnv('DEV', false);
    await boot('?bot=off&lights');
    expect(document.querySelector('#light-panel button[aria-label="Save to sceneoverrides.json"]')).toBeNull();
  });
});
