// @vitest-environment jsdom
import * as THREE from 'three';
import type * as THREEWebGPU from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { terraceDeckLook } from './boardlook';
import { framing } from './camera';
import { deckOf } from './deck';
import { neonSkyOf } from './neonlook';
import { encodeMove, type Move } from './board';
import { loadProgress, saveProgress } from './progress';
import { boot, type Game } from './test/harness';
import { BOSS_IDS } from './tally';

// The start of main.ts on the harness (src/test/harness.ts): the service worker's New version button, the renderer
// and its textures, the view and the fog, the theme, the UI scale, safe mode, the settings menu with its toggles and
// volume sliders, the FPS readout and the mode menu.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const row = (id: string): HTMLButtonElement => byId(`setting-${id}`);
const root = document.documentElement;
const style = (name: string): string => root.style.getPropertyValue(name);
const key = (k: string): void => void dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const press = (target: EventTarget): void => void target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

/** The scene, the camera and the renderer of the next draw. */
async function drawn(
  game: Game,
): Promise<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREEWebGPU.WebGPURenderer }> {
  const { WebGPURenderer } = await import('three/webgpu');
  const render = vi.spyOn(WebGPURenderer.prototype, 'render');
  game.hook('__drawNext'); // asked, as the browser checks ask: the throttle holds an unasked one 4 times the last cost
  game.frame(1000); // past the gap the loop keeps between two draws under automation
  const [scene, camera] = render.mock.lastCall as unknown as [THREE.Scene, THREE.PerspectiveCamera];
  const renderer = render.mock.contexts.at(-1) as THREEWebGPU.WebGPURenderer;
  render.mockRestore();
  return { scene, camera, renderer };
}

/** Every material of the meshes in the scene. */
function materials(scene: THREE.Scene): THREE.MeshStandardMaterial[] {
  const all: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) all.push(...((Array.isArray(m) ? m : [m]) as THREE.MeshStandardMaterial[]));
  });
  return all;
}

/** The Copy diagnostics text, selected in its box: jsdom has no clipboard. */
async function diagnostics(game: Game): Promise<{ environment: Record<string, unknown>; events: { event: string; data?: unknown }[] }> {
  byId('copy-diagnostics').click();
  await game.settle();
  return JSON.parse(byId<HTMLTextAreaElement>('diagnostics').value);
}

/** Boots with the stored settings set after the harness clears the storage, before main.ts reads them. */
async function bootWith(stored: Record<string, string>, url = '?bot=off', options?: Parameters<typeof boot>[1]): Promise<Game> {
  const booting = boot(url, options);
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  return booting;
}

describe('the service worker (#193)', () => {
  function serviceWorker(controller: object | null) {
    const update = vi.fn(async () => {});
    const listeners: Record<string, () => void> = {};
    const worker = {
      controller,
      register: vi.fn(async () => ({ update })),
      addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'serviceWorker');
      vi.unstubAllEnvs();
    });
    return { worker, update, listeners };
  }

  it('offers New version when a new build takes over a page it controlled, and the button reloads', async () => {
    vi.stubEnv('PROD', true);
    const { worker, update, listeners } = serviceWorker({});
    const game = await boot('?bot=off');
    await game.settle();
    expect(worker.register).toHaveBeenCalledWith('/sw.js');
    expect(update).toHaveBeenCalledOnce(); // the check for a new build at each load
    const button = byId<HTMLButtonElement>('update');
    expect(button.hidden).toBe(true);
    listeners.controllerchange!();
    expect(button.hidden).toBe(false);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    button.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offers nothing when the first install takes control', async () => {
    vi.stubEnv('PROD', true);
    const { worker, update, listeners } = serviceWorker(null);
    const game = await boot('?bot=off');
    await game.settle();
    expect(worker.register).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    listeners.controllerchange!();
    expect(byId('update').hidden).toBe(true);
  });

  it('lets the game go on when the registration is refused', async () => {
    vi.stubEnv('PROD', true);
    const { worker } = serviceWorker({});
    worker.register.mockRejectedValueOnce(new Error('blocked'));
    const game = await boot('?bot=off');
    await game.settle();
    expect(worker.register).toHaveBeenCalledOnce();
    expect(game.turn()).toBe('Black to move');
  });

  it('is not registered by the dev server', async () => {
    const { worker, listeners } = serviceWorker({});
    await boot('?bot=off');
    expect(worker.register).not.toHaveBeenCalled();
    expect(listeners.controllerchange).toBeUndefined();
  });
});

describe('the renderer and its textures', () => {
  // Bug #585: the e2e tests take a canvas in the page for a page that is ready. It joins the page once the HUD is filled,
  // after every listener and page hook, not while the textures and the saved game still load.
  it('puts the canvas in the page only once the page is ready, bug #585', async () => {
    let hud: string | null = null;
    const append = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <T extends Node>(this: Node, child: T): T {
      if (child instanceof HTMLCanvasElement && this === document.body) hud = byId('hud').textContent;
      return append.call(this, child) as T;
    });
    await boot('?bot=off');
    expect(hud).toContain('Black to move');
  });

  it('does not draw the room while the boot veil is up and the terrace is off (#1481)', async () => {
    const game = await boot('?bot=off&scene=room');
    const { WebGPURenderer } = await import('three/webgpu');
    const render = vi.spyOn(WebGPURenderer.prototype, 'render');
    document.body.dataset.veil = 'on';
    game.hook('__drawNext');
    game.frame(1000);
    expect(render).not.toHaveBeenCalled();
    delete document.body.dataset.veil;
    game.hook('__drawNext');
    game.frame(2000);
    expect(render).toHaveBeenCalled();
    render.mockRestore();
  });

  it('draws the generated textures, and frames the whole board in the window', async () => {
    const game = await boot('?bot=off&scene=room');
    const { scene, camera } = await drawn(game);
    const backdrop = scene.background as THREE.Texture;
    expect(backdrop.isTexture).toBe(true);
    expect(backdrop.colorSpace).toBe('srgb');
    expect(backdrop.wrapS).not.toBe(1000); // RepeatWrapping: the backdrop is not tiled
    const deck = materials(scene).find((m) => m.roughnessMap)!;
    expect(deck.map!.colorSpace).toBe('srgb');
    expect([deck.map!.wrapS, deck.map!.wrapT, deck.roughnessMap!.wrapS]).toEqual([1000, 1000, 1000]);
    expect(deck.roughnessMap!.colorSpace).not.toBe('srgb');
    expect(document.body.lastElementChild).toBeInstanceOf(HTMLCanvasElement); // the renderer's canvas
    expect(camera.aspect).toBe(innerWidth / innerHeight);
    expect(camera.fov).toBe(framing(innerWidth, innerHeight));
    expect(camera.position.length()).toBeGreaterThan(0); // the reset view, looking at the board
    expect(game.hook('__draws')).toBe(1);
  });

  it('gives the marbles no reflections under automation (#416), and the bay itself, once it is in, to a player (#864)', async () => {
    const reflection = async (webdriver: boolean): Promise<THREE.Texture | null> => {
      const game = await boot('?bot=off&scene=room', { webdriver });
      await vi.waitFor(() => expect(document.body.dataset.bay).toBe('ready'));
      const { scene } = await drawn(game);
      const reflecting = materials(scene).filter((m) => m.envMap);
      expect(reflecting.every((m) => m.envMap === reflecting[0]!.envMap)).toBe(true); // one capture, shells and glass alike
      const glass = materials(scene).find((m) => (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial)!;
      if (glass.envMap) expect(reflecting).toContain(glass);
      return glass.envMap;
    };
    expect(await reflection(true)).toBeNull();
    const env = await reflection(false);
    expect(env?.isTexture).toBe(true);
    const made = env!.userData as { scene: THREE.Scene; options: { position: THREE.Vector3 } };
    expect(made.scene.name).toBe('edgefall-scene'); // the whole lit room, not a studio
    expect(made.options.position.y).toBeGreaterThan(1); // from above the marbles, at the middle of the board
    expect([made.options.position.x, made.options.position.z]).toEqual([0, 0]);
  });

  it('gives the black marbles of the terrace the reflection of its own sky, to a player and not under automation (#1314)', async () => {
    const reflection = async (webdriver: boolean): Promise<THREE.Texture | null> => {
      const game = await boot('?bot=off&look=terrace', { webdriver }); // pins the terrace look's sky reflection (#1314)
      await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
      const { scene } = await drawn(game);
      const shell = materials(scene).find((m) => m.color.getHex() === 0x0a0c0f)!;
      return shell.envMap;
    };
    expect(await reflection(true)).toBeNull();
    const env = await reflection(false);
    expect((env!.userData as { scene: THREE.Scene }).scene.children).toHaveLength(3); // a sky ramp, a window, a cyan strip: no lamps
  });

  it('wears the neon look by default: black sky and stars, slate marbles and pedestals, the edge lines (#1424)', async () => {
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { scene } = await drawn(game);
    const terrace = scene.getObjectByName('terrace')!;
    expect((scene.background as THREE.Color).getHex()).toBe(neonSkyOf(deckOf('local')).getHex()); // the boot deck's key, not the plain black (#1551)
    expect(terrace.getObjectByName('starfield')).toBeDefined();
    expect(terrace.getObjectByName('terrace_edges')).toBeDefined();
    expect(materials(scene).some((m) => m.color.getHex() === 0x14161a)).toBe(true); // the black marble
    expect(materials(scene).some((m) => m.color.getHex() === 0xf2f0ea)).toBe(true); // the white one
  });

  it('draws the board closer on a phone by default: about 85 % of the width, not 65 % with ?look=terrace (#1424)', async () => {
    const distance = async (search: string): Promise<number> => {
      vi.stubGlobal('innerWidth', 390);
      vi.stubGlobal('innerHeight', 844);
      const game = await boot(search);
      await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
      return (game.hook('__view') as { distance: number }).distance;
    };
    expect(await distance('?bot=off&look=terrace')).toBe(18);
    expect(await distance('?bot=off')).toBe(13.8);
  });

  it('leaves the terrace as it was with ?look=terrace (#1424)', async () => {
    const game = await boot('?bot=off&look=terrace');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { scene } = await drawn(game);
    const terrace = scene.getObjectByName('terrace')!;
    expect(terrace.getObjectByName('starfield')).toBeUndefined();
    expect(terrace.getObjectByName('terrace_edges')!.visible).toBe(false); // the lair fight at night lights it (#1496)
    expect((scene.background as THREE.Color).getHex()).toBe(terraceDeckLook('mess')!.background); // the Mess's own surround (#1551)
  });

  it('reports the WebGL2 backend in the diagnostics', async () => {
    const game = await boot('?bot=off');
    const report = await diagnostics(game);
    expect(report.environment.backend).toBe('WebGL2');
    expect(report.events.find((e) => e.event === 'start')?.data).toMatchObject({ backend: 'WebGL2' });
  });

  it('reports the render cost in the diagnostics and on window.__renderCost (#851)', async () => {
    const game = await boot('?bot=off');
    game.frame(1000); // a frame that draws
    const report = (await diagnostics(game)) as unknown as { renderCost: string };
    const cost = (window as unknown as { __renderCost: { calls: number; pointLights: number; tier: string; text: string } }).__renderCost;
    expect(report.renderCost).toMatch(/^draw calls: \d+\ntriangles: \d+\ngeometries: \d+\ntextures: \d+\npoint lights: \d+\ntier: \w+\npixel ratio: [\d.]+$/);
    expect(cost.text).toBe(report.renderCost);
    expect(cost).toMatchObject({ calls: 7, triangles: 300, geometries: 5, textures: 2, tier: 'high' });
    expect(cost.pointLights).toBe(0); // the terrace is lit by a sun alone, and a hidden lamp is not counted (#1314)
  });

  it('plays a 1v1 game on the terrace, and keeps the room for the hub, a fight or ?scene=room (#1314)', async () => {
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { scene } = await drawn(game);
    expect(scene.getObjectByName('terrace')!.visible).toBe(true);
    expect(game.hook('__terrace')).toBe(scene.getObjectByName('terrace')); // the hook of the browser checks
    expect(document.body.dataset.scene).toBe('table-zero');
  });

  it('shows the hint on the terrace: the marbles it takes wear the kit\'s hint ring, apart from the selection ring, which clears the hint (#301, #1314)', async () => {
    const game = await boot('?bot=off&nodes=50');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    byId('hint').click();
    await game.settle();
    expect(document.body.dataset.hint).toBe('shown');
    const { scene } = await drawn(game);
    const rings: THREE.Mesh[] = [];
    scene.traverse((o) => void (o.name === 'hint-ring' && rings.push(o as THREE.Mesh)));
    expect(rings.length).toBeGreaterThan(0);
    expect(Math.abs(rings[0]!.position.y - (0.091 - 0.11))).toBeLessThan(1e-6); // the kit's hint ring, flat on the dish
  });

  it('never shows the room to a player: a missing arena file leaves the board on a plain background, the discs drawn (#1374)', async () => {
    const game = await boot('?bot=off', { missing: ['arena.glb'] });
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { scene } = await drawn(game);
    expect(scene.getObjectByName('terrace')?.visible).toBe(true);
    expect(game.hook('__frame')).toMatchObject({ drawn: false }); // no dishes of the glTF, the room's plate and rim are away too
    const cells: THREE.InstancedMesh[] = [];
    scene.traverse((o) => void ((o as THREE.InstancedMesh).isInstancedMesh && cells.push(o as THREE.InstancedMesh)));
    expect(cells.some((c) => c.visible && c.count > 0 && c.geometry.attributes.position!.count > 0)).toBe(true);
  });

  it('honours ?scene=room under automation or in a dev build only, a production page for a player ignores it (#1374)', async () => {
    vi.stubEnv('DEV', false);
    await boot('?bot=off&scene=room', { webdriver: false });
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
  });

  it('keeps the room in a 1v1 game when ?scene=room asks for it (#1314)', async () => {
    const game = await boot('?bot=off&scene=room');
    const { scene } = await drawn(game);
    expect([document.body.dataset.scene, scene.getObjectByName('terrace')!.visible]).toEqual(['room', false]);
  });

  it('sets the camera to an exact view for a browser check, and shows the terrace to a player at its own default (#1314)', async () => {
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { camera } = await drawn(game);
    expect(camera.position.length()).toBeCloseTo(13.6); // the terrace's pitch 57 and distance 13.6
    game.hook('__setView', { azimuth: Math.PI / 2, polar: 1, distance: 6 });
    expect(camera.position.length()).toBeCloseTo(6);
    expect(camera.position.x).toBeGreaterThan(5); // from the +x side at 90 degrees of yaw
  });

  it('draws the marks of a move with the kit on the terrace: selection ring, target ring and arrow, last-move ring (#1314)', async () => {
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const { scene } = await drawn(game);
    const rested = (y: number): number => {
      let n = 0;
      scene.traverse((o) => void ((o as THREE.Mesh).isMesh && Math.abs(o.position.y - (y - 0.11)) < 1e-6 && n++)); // on the lifted marbles' group
      return n;
    };
    game.click(0, 2); // a black marble: selected, its targets shown
    game.frame(1000);
    expect([rested(0.078) >= 2, rested(0.08) >= 1]).toEqual([true, true]);
    game.click(1, 2); // played: the last move's ring where it landed
    game.frame(1000);
    expect(rested(0.108)).toBeGreaterThanOrEqual(1);
    expect(game.hook<{ marbles: unknown[] }>('__bloodAt', 0).marbles).toHaveLength(28); // the marbles alone: not a pedestal nor a ring
  });

  it('keeps the last drawn frame cost over the idle frames that follow it (the draw calls read 0 before)', async () => {
    const game = await boot('?bot=off');
    const calls = () => (window as unknown as { __renderCost: { calls: number; triangles: number } }).__renderCost;
    game.frame(1000); // a frame that draws
    game.frame(1000); // a still frame draws nothing: three zeroes the counts before it unless told not to
    game.frame(1000);
    expect(calls()).toMatchObject({ calls: 7, triangles: 300 });
  });

  describe('on a WebGPU renderer that loads no texture', () => {
    // A renderer of its own in place of the harness's: WebGPU, and every texture load fails.
    function renderer(): { options: unknown[]; draw: () => THREE.Scene } {
      const options: unknown[] = [];
      let loop: ((now: number) => void) | null = null;
      let scene: THREE.Scene | null = null;
      vi.doMock('three/webgpu', async (importOriginal) => ({
        ...(await importOriginal<typeof import('three/webgpu')>()),
        WebGPURenderer: class {
          domElement = document.createElement('canvas');
          // A render pool as three's WebGPU backend makes it for ?gpustats (#1645): one frame of two passes, 4.2 ms long.
          backend = {
            isWebGPUBackend: true,
            timestampQueryPool: {
              render: {
                queryOffsets: new Map([['a:f1', 0], ['b:f1', 2]]),
                resultBuffer: { getMappedRange: (): ArrayBuffer => BigUint64Array.from([1n, 3_000_000n, 2n, 4_200_001n]).buffer },
                async _resolveQueries(): Promise<number> {
                  this.resultBuffer.getMappedRange();
                  return 99;
                },
              },
            },
          };
          shadowMap = { enabled: false, type: 0 };
          samples: number;
          info = { autoReset: true, reset(): void {}, render: { calls: 7, triangles: 300 }, memory: { geometries: 5, textures: 2 } };
          constructor(o: unknown) {
            options.push(o);
            this.samples = (o as { antialias: boolean }).antialias ? 4 : 0;
          }
          init = async (): Promise<void> => {};
          hasFeature = (): boolean => true; // the timestamp query, for ?gpustats (#1581)
          resolveTimestampsAsync = async (): Promise<number> => this.backend.timestampQueryPool.render._resolveQueries();
          setPixelRatio(): void {}
          setSize(): void {}
          getMaxAnisotropy = (): number => 1;
          render(s: THREE.Scene): void {
            scene = s;
          }
          setAnimationLoop(fn: (now: number) => void): void {
            loop = fn;
          }
        },
      }));
      vi.doMock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
        KTX2Loader: class {
          detectSupport = (): this => this;
          loadAsync = async (): Promise<never> => Promise.reject(new Error('404'));
        },
      }));
      return { options, draw: () => (loop!(0), scene!) };
    }

    it('reads the GPU time of the drawn frames with ?gpustats (#1581)', async () => {
      const booting = boot('?bot=off&scene=room&gpustats');
      const { draw } = renderer();
      await booting;
      draw();
      await vi.waitFor(() => expect(Object.keys((window as unknown as { __gpuCost: { modes: object } }).__gpuCost.modes).length).toBeGreaterThan(0));
      const w = window as unknown as { __gpuCost: { metric: string; modes: Record<string, { avg: number }> }; __renderCost: { gpu: object } };
      expect(w.__renderCost.gpu).toEqual(w.__gpuCost); // the GPU time is in the render cost too
      expect(w.__gpuCost.metric).toBe('frame-span');
      expect(Object.values(w.__gpuCost.modes)[0]!.avg).toBeCloseTo(4.2); // the frame's span, not three's 99 ms sum (#1645)
    });

    it('keeps the flat look and reports WebGPU', async () => {
      const booting = boot('?bot=off&scene=room');
      const { options, draw } = renderer();
      const game = await booting;
      expect(options).toEqual([{ antialias: false, forceWebGL: false, trackTimestamp: false }]);
      const scene = draw();
      expect((scene.background as THREE.Color).getHex()).toBe(neonSkyOf(deckOf('local')).getHex()); // the sky takes the deck's key (#1551)
      expect(materials(scene).some((m) => m.map && !(m.map as THREE.CanvasTexture).isCanvasTexture)).toBe(false);
      expect((await diagnostics(game)).environment.backend).toBe('WebGPU');
    });

    it.each([
      ['low', false],
      ['high', true],
    ])('asks for the normal maps on the %s tier: %s (#849)', async (tier, asked) => {
      const requested: string[] = [];
      const booting = boot(`?bot=off&quality=${tier}&scene=room`);
      renderer();
      vi.doMock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
        KTX2Loader: class {
          detectSupport = (): this => this;
          loadAsync = async (url: string): Promise<never> => {
            requested.push(url);
            return Promise.reject(new Error('404'));
          };
        },
      }));
      await booting;
      expect(requested.some((u) => u.endsWith('-normal.ktx2'))).toBe(asked);
      expect(requested.some((u) => u.endsWith('deck-albedo.ktx2'))).toBe(true);
    });

    it('is asked for the WebGL2 backend by ?backend=webgl', async () => {
      const booting = boot('?bot=off&backend=webgl');
      const { options } = renderer();
      await booting;
      expect(options).toEqual([{ antialias: false, forceWebGL: true, trackTimestamp: false }]);
    });

    const bevel = (scene: THREE.Scene) => materials(scene).find((m) => m.color.getHex() === 0xc4cacf && m.metalness === 0.3)!;

    it('lifts the cell bevel under FXAA, which softens its thin ring (#857)', async () => {
      const booting = boot('?bot=off&quality=low', { webdriver: false });
      const { draw } = renderer();
      await booting;
      expect(bevel(draw()).emissive.getHex()).toBe(0x7f8993);
    });

    it('keeps the cell bevel as it was under MSAA on a touch screen (#857)', async () => {
      vi.stubGlobal('devicePixelRatio', 3);
      const booting = boot('?bot=off&quality=low', { webdriver: false, touch: true });
      const { draw } = renderer();
      await booting;
      expect(bevel(draw()).emissive.getHex()).toBe(0x25292d);
    });

    it('keeps the cell bevel as it was on a Retina desktop, drawn at 1.5 with neither MSAA nor FXAA (#857)', async () => {
      vi.stubGlobal('devicePixelRatio', 3);
      const booting = boot('?bot=off&quality=low', { webdriver: false });
      const { draw } = renderer();
      await booting;
      expect(bevel(draw()).emissive.getHex()).toBe(0x25292d);
    });

    it('drops MSAA on a Retina screen drawn at 1.5 (#844)', async () => {
      vi.stubGlobal('devicePixelRatio', 2);
      const booting = boot('?bot=off&quality=low', { webdriver: false }); // low: no reflections, the stub has no PMREM
      const { options } = renderer();
      await booting;
      expect(options).toEqual([{ antialias: false, forceWebGL: false, trackTimestamp: false }]);
    });

    it('has no MSAA on a 1x desktop screen either: FXAA smooths it, MSAA cost 27 FPS against 108 (#857)', async () => {
      const booting = boot('?bot=off&quality=low', { webdriver: false });
      const { options } = renderer();
      await booting;
      expect(options).toEqual([{ antialias: false, forceWebGL: false, trackTimestamp: false }]);
    });

    it('drops MSAA on a 3x desktop screen drawn at 1.5: the edges are too fine to show (#844)', async () => {
      vi.stubGlobal('devicePixelRatio', 3);
      const booting = boot('?bot=off&quality=low', { webdriver: false });
      const { options } = renderer();
      await booting;
      expect(options).toEqual([{ antialias: false, forceWebGL: false, trackTimestamp: false }]);
    });

    it('keeps MSAA on a DPR-3 phone, a touch screen: its 1.5 shows the steps, its tiled GPU resolves MSAA cheaply (#868)', async () => {
      vi.stubGlobal('devicePixelRatio', 3);
      vi.stubGlobal('innerWidth', 500);
      const booting = boot('?bot=off&quality=low', { webdriver: false, touch: true });
      const { options } = renderer();
      await booting;
      expect(options).toEqual([{ antialias: true, forceWebGL: false, trackTimestamp: false }]);
    });
  });
});

describe('the adaptive resolution (#843)', () => {
  const ratio = (): string | undefined => document.body.dataset.ratio;
  const frames = (game: Game, ms: number): void => {
    for (let i = 0; i < 30; i++) game.frame(ms);
  };

  it('starts a high-tier player at 1.5 on a Retina screen, then steps down to 1 while the frames are slow', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const game = await boot('?bot=off&quality=high', { webdriver: false });
    expect(ratio()).toBe('1.5');
    frames(game, 16);
    expect(ratio()).toBe('1.5');
    frames(game, 40);
    expect(ratio()).toBe('1.25');
    frames(game, 40);
    expect(ratio()).toBe('1');
    frames(game, 40);
    expect(ratio()).toBe('1');
  });

  it('starts a phone at 1.5 too, not at 1: a DPR-3 screen stretched each drawn pixel 3 times', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    vi.stubGlobal('innerWidth', 500);
    await boot('?bot=off', { webdriver: false });
    expect(document.body.dataset.tier).toBe('high'); // the desktop's tier (#882)
    expect(ratio()).toBe('1.5');
  });

  it('starts again from the top when the window changes size', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const game = await boot('?bot=off&quality=high', { webdriver: false });
    frames(game, 40);
    expect(ratio()).toBe('1.25');
    dispatchEvent(new Event('resize'));
    expect(ratio()).toBe('1.5');
  });

  it('keeps half the pixels under automation, however slow the frames', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const game = await boot('?bot=off');
    expect(ratio()).toBe('0.5');
    frames(game, 200);
    expect(ratio()).toBe('0.5');
  });
});

describe('the view and the fog', () => {
  it('fogs the rim, and Clear board takes the fog off and saves it', async () => {
    const game = await boot('?bot=off&scene=room');
    const { scene } = await drawn(game);
    const fog = scene.fog as THREE.Fog;
    expect(fog.near).toBeGreaterThan(0);
    expect(fog.far).toBeGreaterThan(fog.near);
    expect(fog.color.getHex()).toBe(0x1c1612);
    expect(document.body.dataset.clear).toBe('off');
    expect(row('clear-board').getAttribute('aria-pressed')).toBe('false');
    row('clear-board').click();
    expect(scene.fog).toBeNull();
    expect(document.body.dataset.clear).toBe('on');
    expect(row('clear-board').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ab-alone.clear-board')).toBe('on');
  });

  it('Clear board off, then on again, brings back the same fog and saves the choice as off (#1481)', async () => {
    const game = await boot('?bot=off&scene=room');
    const { scene } = await drawn(game);
    const before = scene.fog as THREE.Fog;
    const { near, far, color } = { near: before.near, far: before.far, color: before.color.getHex() };
    row('clear-board').click();
    expect(scene.fog).toBeNull();
    row('clear-board').click();
    const again = scene.fog as THREE.Fog;
    expect(again.near).toBe(near);
    expect(again.far).toBe(far);
    expect(again.color.getHex()).toBe(color);
    expect(document.body.dataset.clear).toBe('off');
    expect(row('clear-board').getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('ab-alone.clear-board')).toBe('off');
  });

  it('tints the fog to match the active deck atmosphere (#665)', async () => {
    const game = await boot('?bot=off&scene=room');
    const { scene } = await drawn(game);
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.getHex()).toBe(0x1c1612);
    expect(fog.far).toBeGreaterThanOrEqual(45);

    game.hook('__deck', 'cargo');
    expect(fog.color.getHex()).toBe(0x12161a);

    game.hook('__deck', 'furnace');
    expect(fog.color.getHex()).toBe(0x20120d);
  });

  it('starts clear when saved so, and on the saved quality tier', async () => {
    const game = await bootWith({ 'ab-alone.clear-board': 'on', 'ab-alone.tier': 'low' });
    expect((await drawn(game)).scene.fog).toBeNull();
    expect(document.body.dataset.clear).toBe('on');
    expect(document.body.dataset.tier).toBe('low');
  });

  it('gives a phone the desktop\'s tier, picked from the device and not saved (#882)', async () => {
    vi.stubGlobal('innerWidth', 500);
    await boot('?bot=off');
    expect(document.body.dataset.tier).toBe('high');
    expect(localStorage.getItem('ab-alone.tier')).toBeNull();
  });

  it('thins the fog farther on the high tier', async () => {
    const far = async (tier: string): Promise<number> => {
      const game = await bootWith({ 'ab-alone.tier': tier }, '?bot=off&scene=room');
      const fog = (await drawn(game)).scene.fog as THREE.Fog;
      return fog.far - fog.near;
    };
    expect(await far('high')).toBeLessThan(await far('low'));
  });
});

describe('the Theme row: theme, UI scale and safe mode', () => {
  it('starts on Dark, cycles Light, System, Dark, then flips safe mode once the scale is at its cap', async () => {
    await boot('?bot=off');
    const theme = row('theme');
    expect(theme.textContent).toBe('Theme: Dark'); // nothing stored: dark (#1184), index.html sets data-theme itself
    expect(theme.getAttribute('aria-pressed')).toBe('true'); // safe mode, on by default
    expect([style('--end-peak'), style('--end-duration')]).toEqual(['0.2', '1.6s']);
    theme.click();
    expect([theme.textContent, root.dataset.theme, localStorage.getItem('ab-alone.theme')]).toEqual(['Theme: Light', 'light', 'light']);
    theme.click(); // System: the 1024 by 768 window has room for 150 %, so the scale steps up first (#927)
    expect([theme.textContent, root.dataset.theme, localStorage.getItem('ab-alone.theme'), style('--ui-scale')]).toEqual(['Theme: System', undefined, 'system', '1.25']);
    expect(theme.getAttribute('aria-pressed')).toBe('true');
    for (let i = 0; i < 3; i++) theme.click(); // a theme cycle: the scale reaches its cap
    expect(style('--ui-scale')).toBe('1.5');
    for (let i = 0; i < 3; i++) theme.click(); // at the cap, the next cycle flips safe mode and the scale is 100 % again
    expect([theme.textContent, root.dataset.theme]).toEqual(['Theme: System', undefined]);
    expect(theme.getAttribute('aria-pressed')).toBe('false');
    expect([style('--end-peak'), style('--end-duration')]).toEqual(['1', '1.6s']); // the full win light
    expect(localStorage.getItem('ab-alone.safe-mode')).toBe('off');
    expect(style('--ui-scale')).toBe('1');
  });

  it('starts on the saved theme and safe mode', async () => {
    await bootWith({ 'ab-alone.theme': 'light', 'ab-alone.safe-mode': 'off' }); // index.html sets data-theme itself
    expect(row('theme').textContent).toBe('Theme: Light');
    expect(row('theme').getAttribute('aria-pressed')).toBe('false');
    expect(style('--end-peak')).toBe('1');
  });

  it('steps the UI scale up on a large window, and saves it', async () => {
    vi.stubGlobal('innerWidth', 1600);
    vi.stubGlobal('innerHeight', 900);
    await boot('?bot=off');
    expect(style('--ui-scale')).toBe('1');
    for (let i = 0; i < 3; i++) row('theme').click(); // Dark, Light, System and the next scale
    expect(style('--ui-scale')).toBe('1.25');
    expect(localStorage.getItem('ab-alone.ui-scale')).toBe('125');
    expect(row('theme').getAttribute('aria-pressed')).toBe('true'); // safe mode stays
  });

  it('applies a saved UI scale at the cap of the window', async () => {
    await bootWith({ 'ab-alone.ui-scale': '200' });
    expect(style('--ui-scale')).toBe('1.5'); // 1024 by 768: 150 % at most (#927)
  });

  it('applies a saved UI scale the window has room for', async () => {
    vi.stubGlobal('innerWidth', 1600);
    vi.stubGlobal('innerHeight', 900);
    await bootWith({ 'ab-alone.ui-scale': '150' });
    expect(style('--ui-scale')).toBe('1.5');
  });
});

describe('the settings toggles', () => {
  it('are in five groups under visible headings, every item with a visible label, Advanced collapsed (#1566)', async () => {
    await boot('?bot=off');
    const menu = byId('settings-menu');
    const sections = [...menu.querySelectorAll(':scope > .setting-section')];
    expect(sections.map((s) => s.querySelector('.setting-heading')!.textContent)).toEqual(['Sound', 'Display', 'Accessibility', 'Controls', 'Advanced']);
    expect((menu.querySelector('details.setting-section') as HTMLDetailsElement).open).toBe(false);
    const group = (id: string): string => byId(id).closest('.setting-section')!.querySelector('.setting-heading')!.textContent!;
    expect([group('setting-steering'), group('setting-guide'), group('setting-difficulty'), group('difficulty-note')]).toEqual(['Controls', 'Controls', 'Controls', 'Controls']);
    expect([group('setting-reduced-motion'), group('setting-flat-hud'), group('setting-clear-board'), group('setting-fps')]).toEqual(['Accessibility', 'Accessibility', 'Display', 'Advanced']);
    for (const button of menu.querySelectorAll('button')) expect(button.textContent!.trim(), button.id).not.toBe(''); // a name to read, not an icon alone
  });

  it('lists every item with its icon, its name for screen readers and as a tooltip', async () => {
    await boot('?bot=off');
    const ids = [...byId('settings-menu').querySelectorAll('button')].map((b) => b.id);
    expect(ids).toEqual([
      'setting-sound', // Sound (#1566)
      'setting-transcript',
      'setting-log-archive',
      'setting-ledger', // #1585
      'setting-theme', // Display
      'setting-shell-skin',
      'setting-glass-skin',
      'setting-clear-board',
      'level-reset', // after the light sliders, which are no buttons (#899)
      'setting-reduced-motion', // Accessibility
      'setting-flat-hud',
      'setting-palette',
      'setting-difficulty', // Controls
      'setting-steering',
      'setting-guide',
      'setting-fps', // Advanced
      'setting-render-mode',
      'setting-free-cam',
      'setting-export-game',
      'setting-import-game',
      'copy-diagnostics', // the last row of Advanced (#1032)
      'setting-reset-all', // the last row of Settings (#1684), then the confirm page's two buttons
      'reset-erase',
      'reset-cancel',
    ]);
    const sound = row('sound');
    expect(sound.querySelector('svg')).not.toBeNull();
    expect([sound.textContent, sound.getAttribute('aria-label'), sound.title]).toEqual(['Sound', 'Sound', 'Sound']);
    expect(sound.hasAttribute('aria-pressed')).toBe(false); // an action, not a toggle
    expect(row('export-game').textContent).toBe('Export game');
  });

  it('follows the system reduced motion until the player presses Reduced motion', async () => {
    const booting = boot('?bot=off');
    const system = { matches: false, change: (): void => {} };
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      get matches() {
        return system.matches;
      },
      addEventListener: (_: string, fn: () => void) => { if (media.includes('reduced-motion')) system.change = fn; },
    }));
    await booting;
    expect(root.dataset.motion).toBeUndefined();
    system.matches = true;
    system.change();
    expect(root.dataset.motion).toBe('reduced');
    expect(row('reduced-motion').getAttribute('aria-pressed')).toBe('true');
    row('reduced-motion').click(); // the player's choice now wins over the system
    expect(root.dataset.motion).toBeUndefined();
    expect(localStorage.getItem('ab-alone.reduced-motion')).toBe('off');
    system.matches = false;
    system.change();
    row('reduced-motion').click();
    expect(root.dataset.motion).toBe('reduced');
    expect(row('reduced-motion').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ab-alone.reduced-motion')).toBe('on');
  });

  it('applies a stored Reduced motion choice at boot, whatever the system says, the unit of the reload e2e (#1481)', async () => {
    await bootWith({ 'ab-alone.reduced-motion': 'on' });
    expect(root.dataset.motion).toBe('reduced');
    expect(row('reduced-motion').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps motion on at boot when the player turned Reduced motion off under a system setting that asks for none', async () => {
    await bootWith({ 'ab-alone.reduced-motion': 'off' }, '?bot=off', { reducedMotion: true });
    expect(root.dataset.motion).toBeUndefined();
    expect(row('reduced-motion').getAttribute('aria-pressed')).toBe('false');
  });

  it('starts with motion cut when the system asks for it', async () => {
    await boot('?bot=off', { reducedMotion: true });
    expect(root.dataset.motion).toBe('reduced');
    expect(row('reduced-motion').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes every game-critical value as text on the plate with Flat HUD', async () => {
    const game = await boot('?bot=off');
    expect(byId('hud').querySelector('.flat')).toBeNull();
    row('flat-hud').click();
    expect(byId('hud').querySelector('.flat')?.textContent).toContain('Turn: ');
    expect(row('flat-hud').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ab-alone.flat-hud')).toBe('on');
    row('flat-hud').click();
    expect(game.hud()).not.toContain('Ejected: ');
  });

  it('puts the next dark skin on the enemy shells, and saves it', async () => {
    const game = await boot('?bot=off');
    const skinned = async (asset: string): Promise<boolean> => {
      await game.settle(); // the skin's maps load after the press
      return materials((await drawn(game)).scene).some((m) => m.isMeshStandardMaterial && m.map?.name === `skin-${asset}-albedo.ktx2`);
    };
    expect(row('shell-skin').textContent).toBe('Shell: Leather');
    expect(await skinned('Porcelain003')).toBe(false);
    row('shell-skin').click();
    expect(row('shell-skin').textContent).toBe('Shell: Black porcelain');
    expect(localStorage.getItem('ab-alone.shell-skin')).toBe('obsidian');
    expect(await skinned('Porcelain003')).toBe(true);
  });

  it('starts on the saved skins, and loads their maps rather than the default ones', async () => {
    const game = await bootWith({ 'ab-alone.shell-skin': 'slag', 'ab-alone.glass-skin': 'pearl' });
    expect(row('shell-skin').textContent).toBe('Shell: Lava');
    expect(row('glass-skin').textContent).toBe('Glass: Porcelain');
    await game.settle();
    const maps = materials((await drawn(game)).scene).map((m) => m.map?.name);
    expect(maps).toContain('skin-Lava002-albedo.ktx2');
    expect(maps).toContain('skin-Porcelain001-albedo.ktx2');
    expect(maps).not.toContain('skin-Leather027-albedo.ktx2');
    expect(game.hook('__shellPulse')).toBe(0); // only the default shell glows with the heat
  });

  it("puts the next pale skin on the player's glass, in the group of the shell skin, and saves it", async () => {
    const game = await boot('?bot=off');
    expect(row('glass-skin').parentElement).toBe(row('shell-skin').parentElement);
    expect(row('glass-skin').parentElement!.querySelector('.setting-heading')!.textContent).toBe('Display');
    const skinned = async (asset: string): Promise<boolean> => {
      await game.settle(); // the skin's maps load after the press
      return materials((await drawn(game)).scene).some(
        (m) => (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && m.map?.name === `skin-${asset}-albedo.ktx2`,
      );
    };
    expect(row('glass-skin').textContent).toBe('Glass: Marble');
    expect(await skinned('GlazedTerracotta003')).toBe(false);
    row('glass-skin').click();
    expect(row('glass-skin').textContent).toBe('Glass: Terracotta');
    expect(localStorage.getItem('ab-alone.glass-skin')).toBe('frost');
    expect(await skinned('GlazedTerracotta003')).toBe(true);
  });

  it('switches to the next colorblind palette, an Accessibility item, and saves it', async () => {
    const game = await boot('?bot=off');
    expect(row('palette').closest('.setting-section')!.querySelector('.setting-heading')!.textContent).toBe('Accessibility'); // the colour-blind palettes (#1566)
    expect(row('palette').textContent).toBe('Palette: Default');
    expect(root.dataset.palette).toBe('default');
    const accent = style('--accent');
    row('palette').click();
    expect(row('palette').textContent).toBe('Palette: Protan');
    expect([root.dataset.palette, game.hook('__palette')]).toEqual(['protan', 'protan']);
    expect(style('--accent')).not.toBe(accent);
    expect(localStorage.getItem('ab-alone.palette')).toBe('protan');
  });

  it('sets the inline accent and hazard only on the dark theme, and re-applies them when the theme changes (#923)', async () => {
    await bootWith({ 'ab-alone.theme': 'light', 'ab-alone.palette': 'protan' });
    expect([style('--accent'), style('--hazard')]).toEqual(['#0b5d8a', '#7a5a00']); // the on-cream pair
    row('palette').click(); // deutan
    expect(style('--accent')).toBe('#1e40af');
    for (let i = 0; i < 3; i++) row('palette').click(); // back to default: ui.css's own light colours win
    expect([style('--accent'), style('--hazard')]).toEqual(['', '']);
    row('theme').click(); // light to system (jsdom matches no light query), then the dark pair is back
    expect([style('--accent'), style('--hazard')]).toEqual(['#7fd6e8', '#d9822b']);
  });

  it('follows the system theme for the accent pair when the theme is System', async () => {
    const booting = bootWith({ 'ab-alone.theme': 'system' });
    const system = { matches: true, change: (): void => {} };
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      get matches() {
        return media.includes('prefers-color-scheme') && system.matches;
      },
      addEventListener: (_: string, fn: () => void) => (system.change = fn),
    }));
    await booting;
    expect(style('--accent')).toBe('');
    system.matches = false;
    system.change();
    expect(style('--accent')).toBe('#7fd6e8');
  });

  it('starts on the saved palette', async () => {
    const game = await bootWith({ 'ab-alone.palette': 'tritan' });
    expect(row('palette').textContent).toBe('Palette: Tritan');
    expect(game.hook('__palette')).toBe('tritan');
  });

  it('cycles difficulty and saves it to localStorage', async () => {
    await boot('?bot=off');
    expect(row('difficulty').textContent).toBe('Difficulty: 50%'); // a fresh profile plays on Easy (#1664)
    row('difficulty').click();
    expect(row('difficulty').textContent).toBe('Difficulty: 100%');
    expect(localStorage.getItem('ab-alone.difficulty')).toBe('normal');
    row('difficulty').click();
    expect(row('difficulty').textContent).toBe('Difficulty: 200%');
    expect(localStorage.getItem('ab-alone.difficulty')).toBe('hard');
    row('difficulty').click();
    expect(row('difficulty').textContent).toBe('Difficulty: 50%');
    expect(localStorage.getItem('ab-alone.difficulty')).toBe('easy');
  });

  it('the difficulty control says what each level changes, in its line, tooltip and name (#1538)', async () => {
    await boot('?bot=off');
    const note = (): string => document.getElementById('difficulty-note')!.textContent!;
    expect(note()).toBe('Easy: half the boss search; hover tells always on.');
    expect(row('difficulty').title).toBe('Difficulty: easy (50%). Easy: half the boss search; hover tells always on.');
    expect(row('difficulty').getAttribute('aria-label')).toBe(row('difficulty').title);
    row('difficulty').click();
    expect(note()).toBe('Normal: full boss search; hover tells on hover.');
    row('difficulty').click();
    expect(note()).toBe('Hard: double the boss search; hover tells off.');
  });

  it('starts on the saved difficulty', async () => {
    await bootWith({ 'ab-alone.difficulty': 'hard' });
    expect(row('difficulty').textContent).toBe('Difficulty: 200%');
  });

  it('keeps working, unsaved, when the storage is blocked', async () => {
    const booting = boot('?bot=off');
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    onTestFinished(() => void Object.defineProperty(globalThis, 'localStorage', storage));
    await booting;
    row('clear-board').click();
    expect(document.body.dataset.clear).toBe('on');
    Object.defineProperty(globalThis, 'localStorage', storage);
    expect(localStorage.getItem('ab-alone.clear-board')).toBeNull();
  });
});

describe('the volume sliders (#438)', () => {
  it('opens on Sound, the music slider focused, until the menu closes', async () => {
    const game = await boot('?bot=off');
    game.openSettings();
    const menu = byId('settings-menu');
    row('sound').click();
    expect(menu.dataset.page).toBe('volume');
    expect(document.activeElement).toBe(byId('volume-music'));
    const names = [...menu.querySelectorAll('.setting-volume span')].map((s) => s.textContent);
    expect(names).toEqual(['Music', 'Ambience', 'Effects', 'Voice']);
    game.openSettings(); // closes
    game.openSettings();
    expect(menu.dataset.page).toBeUndefined();
  });

  it('starts the music at 0 under automation, the harness default (#990)', async () => {
    await boot('?bot=off');
    expect((byId('volume-music') as HTMLInputElement).value).toBe('0');
    expect((byId('volume-effects') as HTMLInputElement).value).toBe('100');
  });

  it('starts the music at 100 in a normal browser (#990)', async () => {
    await boot('?bot=off', { webdriver: false });
    expect((byId('volume-music') as HTMLInputElement).value).toBe('100');
  });

  it('a music volume the player saved wins over the automated default (#990)', async () => {
    await bootWith({ 'ab-alone.volume.music': '70' });
    expect((byId('volume-music') as HTMLInputElement).value).toBe('70');
  });

  it('shows the saved volumes and saves a moved slider', async () => {
    await bootWith({ 'ab-alone.volume.voice': '40' });
    const slider = (bus: string): HTMLInputElement => byId(`volume-${bus}`);
    expect([slider('music').value, slider('voice').value]).toEqual(['0', '40']);
    slider('effects').value = '25';
    slider('effects').dispatchEvent(new Event('input'));
    expect(localStorage.getItem('ab-alone.volume.effects')).toBe('25');
  });

  it('starts the sound when a slider moves up from 0', async () => {
    const game = await bootWith({ 'ab-alone.sound': 'off' }, '?bot=off', { audio: true });
    expect((byId('volume-music') as HTMLInputElement).value).toBe('0'); // a Sound off saved before the sliders
    key('a'); // a gesture with every bus at 0 starts nothing
    expect(game.hook('__audio')).toBe('none');
    (byId('volume-music') as HTMLInputElement).value = '60';
    byId('volume-music').dispatchEvent(new Event('input'));
    expect(game.hook('__audio')).toBe('running');
    expect(localStorage.getItem('ab-alone.volume.music')).toBe('60');
  });
});

describe('the light sliders', () => {
  it('are rows of the Display group, then the reset button, and Copy diagnostics is the last row of the menu', async () => {
    await boot('?bot=off');
    const menu = byId('settings-menu');
    expect([...menu.querySelectorAll('.setting-lights')].map((s) => s.textContent)).toEqual(['Bloom', 'Lamps', 'Lights']);
    expect(byId('level-reset').previousElementSibling).toBe(byId('level-lights').parentElement); // then the reset button
    expect(byId('level-reset').closest('.setting-section')!.querySelector('.setting-heading')!.textContent).toBe('Display');
    expect(menu.querySelector('details:last-of-type')!.lastElementChild).toBe(byId('copy-diagnostics')); // the clipboard is the last row (#1032)
  });

  it('go back to their defaults with the reset button, saved and applied at once (#899)', async () => {
    const booting = boot('?bot=off');
    localStorage.setItem('ab-alone.light.lights', '85');
    localStorage.setItem('ab-alone.light.lamps', '5');
    localStorage.setItem('ab-alone.light.bloom', '15');
    await booting;
    const sliders = (): string[] => ['bloom', 'lamps', 'lights'].map((l) => (byId(`level-${l}`) as HTMLInputElement).value);
    expect(sliders()).toEqual(['15', '5', '85']);
    byId('level-reset').click();
    expect(sliders()).toEqual(['20', '25', '215']);
    expect(['bloom', 'lamps', 'lights'].map((l) => localStorage.getItem(`ab-alone.light.${l}`))).toEqual(['20', '25', '215']);
  });
});

describe('the sound', () => {
  it('starts on the first gesture, a key, a mouse press or a touch', async () => {
    for (const gesture of [() => key('a'), () => press(document.body), () => dispatchEvent(new Event('pointerup'))]) {
      const game = await boot('?bot=off', { audio: true });
      expect(game.hook('__audio')).toBe('none');
      gesture();
      expect(game.hook('__audio')).toBe('running');
    }
  });

  it('stays silent in a browser without Web Audio', async () => {
    const game = await boot('?bot=off');
    key('a');
    expect(game.hook('__audio')).toBe('none');
  });

  it('plays a boss tell once when it appears, and only after a gesture', async () => {
    const choir = async (gesture: boolean): Promise<unknown[]> => {
      const game = await boot('?bot=off', { audio: true });
      if (gesture) key('a');
      game.openModes();
      byId('boss-fight').click();
      [...byId('boss-list').querySelectorAll('button')].find((b) => b.textContent === 'The Choir')!.click();
      row('flat-hud').click(); // a redraw of the same tell plays nothing new
      return game.hook('__tellCues');
    };
    expect(await choir(false)).toEqual([]);
    expect(await choir(true)).toEqual(['choir']);
  });
});

describe('the FPS readout (#426)', () => {
  it('is off by default: the box stays hidden and empty', async () => {
    const game = await boot('?bot=off');
    expect(row('fps').getAttribute('aria-pressed')).toBe('false');
    expect(row('fps').parentElement!.querySelector('.setting-heading')!.textContent).toBe('Advanced'); // a developer tool (#1566)
    expect(row('fps').parentElement!.children[1]).toBe(row('fps'));
    game.frame(20);
    expect(byId('fps').hidden).toBe(true);
    expect(byId('fps').textContent).toBe('');
  });

  it('shows the frames per second of the last frames once on, and starts over when turned on again', async () => {
    const game = await boot('?bot=off');
    row('fps').click();
    expect(byId('fps').hidden).toBe(false);
    expect(row('fps').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ab-alone.fps')).toBe('on');
    game.frame(20);
    expect(byId('fps').textContent).toBe('0 FPS'); // one frame: no time between two yet
    for (let i = 0; i < 5; i++) game.frame(20);
    expect(byId('fps').textContent).toBe('50 FPS');
    row('fps').click();
    expect([byId('fps').hidden, localStorage.getItem('ab-alone.fps')]).toEqual([true, 'off']);
    row('fps').click();
    game.frame(20);
    expect(byId('fps').textContent).toBe('0 FPS');
  });

  it('starts on when saved on', async () => {
    const game = await bootWith({ 'ab-alone.fps': 'on' });
    expect(byId('fps').hidden).toBe(false);
    expect(row('fps').getAttribute('aria-pressed')).toBe('true');
    game.frame(10);
    game.frame(10);
    expect(byId('fps').textContent).toBe('100 FPS');
  });
});

describe.each([
  { name: 'settings', button: 'settings', menu: 'settings-menu', open: (g: Game) => g.openSettings() },
  { name: 'mode', button: 'modes', menu: 'mode-menu', open: (g: Game) => g.openModes() },
])('the $name menu', ({ button, menu, open }) => {
  it('is enabled once ready, opened and closed by its button', async () => {
    const game = await boot('?bot=off');
    const b = byId<HTMLButtonElement>(button);
    expect(b.disabled).toBe(false);
    expect(byId(menu).hidden).toBe(true);
    open(game);
    expect([byId(menu).hidden, b.getAttribute('aria-expanded')]).toEqual([false, 'true']);
    open(game);
    expect([byId(menu).hidden, b.getAttribute('aria-expanded')]).toEqual([true, 'false']);
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    const game = await boot('?bot=off');
    key('Escape'); // closed: nothing happens
    expect(byId(menu).hidden).toBe(true);
    open(game);
    key('Enter');
    expect(byId(menu).hidden).toBe(false);
    key('Escape');
    expect(byId(menu).hidden).toBe(true);
    expect(byId(button).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(byId(button));
  });

  it('closes on a press outside it, not on a press in it or on its button', async () => {
    const game = await boot('?bot=off');
    press(byId('hud')); // closed: nothing happens
    open(game);
    press(byId(menu).firstElementChild!);
    press(byId(button));
    expect(byId(menu).hidden).toBe(false);
    press(byId('hud'));
    expect(byId(menu).hidden).toBe(true);
  });
});

it('shows the mode menu icon on its button', async () => {
  await boot('?bot=off');
  expect(byId('modes').querySelector('svg')).not.toBeNull();
});

it("draws a hovered move's ghost on a fresh game, the fight's own in a boss fight", async () => {
  const ghosts = async (boss: string | null): Promise<string | undefined> => {
    const game = await boot('?bot=off');
    if (boss) {
      game.openModes();
      byId('boss-fight').click();
      [...byId('boss-list').querySelectorAll('button')].find((b) => b.textContent === boss)!.click();
    }
    const mv = game.hook<{ cells: [number, number][]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    const target = game.hook<{ cell: [number, number]; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
    const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', ...target.cell);
    document.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    return document.body.dataset.ghosts;
  };
  expect(Number(await ghosts(null))).toBeGreaterThan(0);
  expect(Number(await ghosts('The Choir'))).toBeGreaterThan(0);
});

it('mounts the progressive PBR spaceship bay into propsGroup (#648, #660)', async () => {
  const game = await boot('?bot=off');
  const dummyBay = {
    scene: new THREE.Group(),
    materials: {
      deck: new THREE.MeshStandardMaterial(),
      bulkhead: new THREE.MeshStandardMaterial(),
      grate: new THREE.MeshStandardMaterial(),
    },
  };
  game.hook('__mountBay', dummyBay);
  game.hook('__setTier', 'low'); // calls applyLook() and drawProps() with currentBay active
  game.hook('__mountBay', null);
});

it('keeps the bay lights when a setting redraws the props (#787)', async () => {
  const game = await boot('?bot=off');
  const dummyBay = {
    scene: new THREE.Group(),
    materials: {
      deck: new THREE.MeshStandardMaterial(),
      bulkhead: new THREE.MeshStandardMaterial(),
      grate: new THREE.MeshStandardMaterial(),
    },
  };
  game.hook('__mountBay', dummyBay);
  const lights = () => {
    let n = 0;
    dummyBay.scene.parent!.traverse((o) => void (o instanceof THREE.PointLight && n++));
    return n;
  };
  const before = lights();
  game.hook('__setTier', 'low'); // applyLook() clears and redraws the props
  expect(lights()).toBe(before);
});

it('hangs no neon tube over the board, the gantry tubes light it unseen (#956)', async () => {
  const game = await boot('?bot=off');
  const bay = { scene: new THREE.Group(), materials: { deck: new THREE.MeshStandardMaterial(), bulkhead: new THREE.MeshStandardMaterial(), grate: new THREE.MeshStandardMaterial() } };
  for (const mounted of [null, bay]) {
    game.hook('__mountBay', mounted);
    const { scene } = await drawn(game);
    for (const tube of ['neon-gantry-north', 'neon-gantry-south']) {
      expect(scene.getObjectByName(tube)!.visible).toBe(false);
      const lights = scene.getObjectsByProperty('name', `${tube} light`);
      expect(lights.length).toBeGreaterThan(0);
      expect(lights.every((light) => light.visible)).toBe(true);
    }
  }
});

it('disposes the props a setting replaces, so the settings never leak geometries or materials (#846)', async () => {
  const game = await boot('?bot=off');
  const { scene } = await drawn(game);
  const props = scene.getObjectByName('console-screen')!.parent!;
  const meshes = () => props.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
  const old = meshes();
  const spies = old.flatMap((m) => [vi.spyOn(m.geometry, 'dispose'), vi.spyOn(m.material as THREE.Material, 'dispose')]);
  for (let i = 0; i < 3; i++) game.hook('__setTier', i % 2 ? 'high' : 'low');
  expect(old.length).toBeGreaterThan(20);
  expect(spies.every((spy) => spy.mock.calls.length > 0)).toBe(true); // everything the first look made is disposed
  const standing = meshes();
  const live = standing.flatMap((m) => [vi.spyOn(m.geometry, 'dispose'), vi.spyOn(m.material as THREE.Material, 'dispose')]);
  game.hook('__setTier', 'low'); // the same look again
  expect(live.every((spy) => spy.mock.calls.length > 0)).toBe(true);
  expect(meshes()).toHaveLength(standing.length); // leaves the same number of props
});

it('honors query quality param and allows setting tier live (#655)', async () => {
  const game = await boot('?bot=off&quality=high');
  expect(document.body.dataset.tier).toBe('high');
  game.hook('__setTier', 'low');
  expect(document.body.dataset.tier).toBe('low');
  game.hook('__setTier', 'high');
  expect(document.body.dataset.tier).toBe('high');
});

it('marks the page once the spaceship bay is in the scene, never while it is missing (#661)', async () => {
  let game = await boot('?bot=off', { missing: ['spaceship-bay.glb'] });
  await game.settle();
  expect(document.body.dataset.bay).toBeUndefined();
  game = await boot('?bot=off');
  await game.settle();
  expect(document.body.dataset.bay).toBe('ready');
});

it('shows a loading plate from the first paint, fades it once the bay is in and hides it after the fade (#901)', async () => {
  const game = await boot('?bot=off', { webdriver: false });
  const plate = byId('loading');
  expect(plate.getAttribute('role')).toBe('status');
  expect(plate.textContent).toBe('Loading');
  expect(plate.querySelector('.hex')!.getAttribute('aria-hidden')).toBe('true');
  await game.settle();
  expect(plate.classList.contains('done')).toBe(true); // the fade
  await vi.waitFor(() => expect(plate.hidden).toBe(true)); // reduced motion has no transition to wait for
  plate.classList.remove('done');
  game.hook('__mountBay', null); // a second mount leaves the hidden plate alone
  expect(plate.classList.contains('done')).toBe(false);
});

it('hides the loading plate at once under automation, so a check waiting on data-bay never sees it fade (#901)', async () => {
  const game = await boot('?bot=off');
  await game.settle();
  expect(document.body.dataset.bay).toBe('ready');
  expect(byId('loading').hidden).toBe(true);
});

it('hides the loading plate even when the bay is missing, so the page never loads forever (#901)', async () => {
  const game = await boot('?bot=off', { missing: ['spaceship-bay.glb'] });
  await game.settle();
  await vi.waitFor(() => expect(byId('loading').hidden).toBe(true));
});

describe('the Open world first, and Quick game (#1612, Decision #1513)', () => {
  const entries = (): string[] => [...byId('mode-menu').querySelectorAll('button')].map((b) => b.id).filter((id) => id !== 'update');

  it('leads the mode menu with the Open world on a fresh profile', async () => {
    await boot('?bot=off');
    expect(entries()[0]).toBe('openworld');
    expect(entries()).toContain('play-online');
  });

  it('keeps Play online first in the menu of a profile with a boss beaten', async () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveProgress(store, { at: loadProgress(store).at, beaten: [BOSS_IDS[0]!] });
    await bootWith({ 'ab-alone.progress': data.get('ab-alone.progress')! }, '?bot=off');
    expect(entries()[0]).toBe('play-online');
  });

  it('shows a one-tap Open world button in the dock on a fresh profile, and it enters the world', async () => {
    const game = await boot('?bot=off');
    const entry = byId<HTMLButtonElement>('open-world-entry');
    expect(entry.hidden).toBe(false);
    expect(byId('dock').contains(entry)).toBe(true);
    entry.click();
    await game.settle();
    expect(byId('openworld-hud').hidden).toBe(false);
  });

  it('hides that Open world button from a profile with a boss beaten', async () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveProgress(store, { at: loadProgress(store).at, beaten: [BOSS_IDS[0]!] });
    await bootWith({ 'ab-alone.progress': data.get('ab-alone.progress')! }, '?bot=off');
    expect(byId('open-world-entry').hidden).toBe(true);
  });

  it('puts a Quick game button in the dock, enabled, that starts a new game from any screen', async () => {
    const game = await boot('?bot=off');
    const quick = byId<HTMLButtonElement>('quick-game');
    expect(quick.disabled).toBe(false);
    expect(quick.hidden).toBe(false);
    expect(byId('dock').contains(quick)).toBe(true);
    quick.click();
    await game.settle();
    expect(game.hook('__plies')).toBe(0);
  });

  it('asks for a second press before Quick game drops an unfinished game, as New game does (#1612)', async () => {
    const game = await boot('?bot=off');
    const first = encodeMove((game.hook('__legal') as Move[])[0]!);
    game.hook('__playMoves', [first]); // one ply: an unfinished game
    byId<HTMLButtonElement>('quick-game').click();
    await game.settle();
    expect(game.hook('__plies')).toBe(1);
    expect(byId<HTMLButtonElement>('quick-game').textContent).toMatch(/Confirm/); // the question sits on the button pressed
    byId<HTMLButtonElement>('quick-game').click();
    await game.settle();
    expect(game.hook('__plies')).toBe(0);
  });
  it('opens an invite link at once on a fresh profile: the table is joined, and the menu still leads with the Open world (#1612)', async () => {
    await boot('?net=hook#room=the-room');
    await vi.waitFor(() => expect(document.body.dataset.seat).toBe('pending'));
    expect(byId('open-world-entry').hidden).toBe(false);
  });
  it('hides Quick game in a boss fight, and a press on it leaves the fight standing (#1612)', async () => {
    const game = await boot('?bot=off');
    game.openModes();
    byId('boss-fight').click();
    [...byId('boss-list').querySelectorAll('button')].find((b) => b.textContent!.startsWith('The Echo'))!.click();
    expect(document.body.dataset.boss).toBeTruthy();
    expect(byId<HTMLButtonElement>('quick-game').hidden).toBe(true);
    byId<HTMLButtonElement>('quick-game').click();
    await game.settle();
    expect(document.body.dataset.boss).toBeTruthy();
  });
});

describe('the mode-entry probe (#1582)', () => {
  it('times the first frame after each entry the hook starts, and reset clears them', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    game.hook('__modeReset');
    game.hook('__enterMode', 'arena');
    game.frame(1000);
    expect(game.hook<Record<string, number[]>>('__modeProbe')).toEqual({ arena: [expect.any(Number)] });
    game.hook('__modeReset');
    expect(game.hook('__modeProbe')).toEqual({});
    expect(game.hook('__modeMarks')).toEqual({});
  });
});
