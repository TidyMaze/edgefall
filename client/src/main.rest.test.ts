// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { boot } from './test/harness';
import { LIGHT_TUNING } from './lighttuning';
import { TUBE_SPACING } from './neonlight';
import { RING } from './ringlamp';

const RING_LIGHTS = Math.ceil((2 * Math.PI * RING.radius) / TUBE_SPACING);

// What the other main.*.test.ts files leave out of main.ts: a browser check asking for the next draw (#435), and a
// deck whose own texture set did not load (#401, #440).

describe('main.ts, __drawNext', () => {
  it('under automation, a draw asked for after a slow one waits 100 ms, not 4 times its cost', async () => {
    const game = await boot('?bot=off');
    const now = vi.mocked(performance.now);
    const clock = now.getMockImplementation()!;
    now.mockImplementation(() => clock() + 200); // the first draw takes 200 ms (the shaders compile)
    game.frame();
    now.mockImplementation(clock);
    expect(game.draws()).toBe(1);
    game.frame(100);
    expect(game.draws()).toBe(1); // a slow draw holds the next for 4 times its cost
    expect(game.hook('__drawNext')).toBe(1); // the draws so far
    game.frame(16); // 116 ms after the slow draw
    expect(game.draws()).toBe(2);
    expect(game.hook('__draws')).toBe(2);
    game.frame(16); // asked once only: back to every 100 ms
    expect(game.draws()).toBe(2);
  });
});

describe('main.ts, ?lights', () => {
  it('shows a power slider per light and neon tube', async () => {
    await boot('?bot=off&lights');
    const names = [...document.querySelectorAll('#light-panel label')].map((l) => l.firstChild!.textContent!.trim());
    expect(names).toEqual(expect.arrayContaining(['kioskGreenLight', 'corner-neon ×4', 'corner-neon light ×4']));
  });

  it.each([
    [true, 3],
    [false, 3],
  ])('on WebGPU %s, lights a 7.5 m neon tube with a row of %i lights: WebGL gets the same light (#882)', async (webgpu, count) => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off', { webgpu });
    let lights = 0;
    scene!.traverse((o) => void (o.name === 'corner-neon-nw light' && lights++));
    expect(lights).toBe(count);
  });

  it('points the free camera at a light from its row in the panel', async () => {
    const game = await boot('?bot=off&lights');
    expect(game.hook('__freeCamActive')).toBe(false);
    document.querySelector<HTMLButtonElement>('#light-panel button[aria-label="Point the camera at kioskGreenLight"]')!.click();
    expect(game.hook('__freeCamActive')).toBe(true);
    expect(document.getElementById('setting-free-cam')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the live scene in the three.js Editor from its button (#872), and logs a refusal', async () => {
    const openInEditor = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('POST answered 404'));
    vi.doMock('./editorexport', () => ({ openInEditor }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off&lights');
    vi.doUnmock('./editorexport');
    const button = document.querySelector<HTMLButtonElement>('#light-panel button.editor')!;
    button.click();
    expect(openInEditor).toHaveBeenCalledWith(scene, expect.objectContaining({ isCamera: true }), expect.anything());
    button.click();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(new Error('POST answered 404')));
  });

  it('has no Editor button outside the dev server, where its endpoint does not exist (#872)', async () => {
    vi.stubEnv('DEV', false);
    await boot('?bot=off&lights');
    vi.unstubAllEnvs();
    expect(document.querySelector('#light-panel')).not.toBeNull();
    expect(document.querySelector('#light-panel button.editor')).toBeNull();
  });

  it('puts the bloom strength, radius and threshold last', async () => {
    await boot('?bot=off&lights');
    const bloom = [...document.querySelectorAll('#light-panel details')].at(-1)!;
    expect([...bloom.querySelectorAll('label')].map((l) => l.firstChild!.textContent!.trim())).toEqual(['bloom radius', 'bloom strength', 'bloom threshold']);
  });

  it('has no bloom knobs when the bloom does not build', async () => {
    vi.doMock('three/addons/tsl/display/BloomNode.js', () => ({
      bloom: () => {
        throw new Error('no bloom');
      },
    }));
    await boot('?bot=off&lights');
    vi.doUnmock('three/addons/tsl/display/BloomNode.js');
    expect(document.querySelector('#light-panel')!.textContent).not.toContain('bloom');
  });

  it('has no panel without it', async () => {
    await boot('?bot=off');
    expect(document.getElementById('light-panel')).toBeNull();
  });
});

describe('main.ts, the tuned lights', () => {
  it('lights the room as tuned (lighttuning.ts), with or without the panel', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off');
    // The tuned power, times the sliders' default levels (quality.ts): lamps 25 %, lights 250 %.
    expect(scene!.getObjectByName('key')).toBeUndefined(); // no spotlight: the room's own lights light the scene (#877)
    expect(((scene!.getObjectByName('corner-neon-nw') as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(
      LIGHT_TUNING['corner-neon']! * 0.25,
    );
    expect((scene!.getObjectByName('kioskGreenLight') as THREE.Light).intensity).toBeCloseTo(LIGHT_TUNING.kioskGreenLight! * 2.5);
  });
});

describe('main.ts, the lights of the room (#845)', () => {
  it('keeps the neon tubes\' rows, the ring lamp\'s, the console screen and one viewport light, and no other', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off&scene=room');
    const named: string[] = [];
    scene!.traverse((o) => void ((o as THREE.Light).isLight && !o.name.includes('neon') && !o.name.startsWith('ring-lamp') && o.parent?.name !== 'terrace' && named.push(o.name)));
    expect(named.sort()).toEqual(['kioskGreenLight', 'viewportRimLight']);
  });
});

describe('main.ts, the lighting system (#882)', () => {
  it.each([
    [true, 'clustered'],
    [false, 'culled'],
  ])('on WebGPU %s, shades each pixel with only the lights that reach it: %s lighting', async (webgpu, kind) => {
    const made: string[] = [];
    vi.doMock('./culledlighting', () => ({ CulledLighting: class { constructor() { made.push('culled'); } } }));
    vi.doMock('three/examples/jsm/lighting/ClusteredLighting.js', () => ({
      ClusteredLighting: class { constructor() { made.push('clustered'); } },
    }));
    await boot('?bot=off', { webgpu });
    vi.doUnmock('./culledlighting');
    vi.doUnmock('three/examples/jsm/lighting/ClusteredLighting.js');
    expect(made).toEqual([kind]);
  });
});

describe('main.ts, the ring lamp (#879)', () => {
  it.each([
    [true, RING_LIGHTS],
    [false, RING_LIGHTS],
  ])('hangs the ring lamp over the board, on WebGPU %s lit by %i point lights tuned with the tubes\' (lighttuning.ts)', async (webgpu, count) => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off', { webgpu });
    const named = (name: string): THREE.Object3D[] => {
      const found: THREE.Object3D[] = [];
      scene!.traverse((o) => void (o.name === name && found.push(o)));
      return found;
    };
    expect([named('ring-lamp').length, named('ring-lamp face').length, named('ring-lamp cable').length]).toEqual([1, 1, 3]);
    const lights = named('ring-lamp light') as THREE.PointLight[];
    expect(lights).toHaveLength(count);
    expect(lights[0]!.intensity).toBeCloseTo(LIGHT_TUNING['ring-lamp light']! * 2.5); // at the lights' default level
  });
});

describe('main.ts, the light sliders', () => {
  it('scales the tuned lights, lamps and bloom as saved, as a slider moves, and when the lights are made again', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    const booting = boot('?bot=off&lights&look=terrace'); // pins the terrace look's light values (#1424)
    localStorage.setItem('ab-alone.light.lights', '200');
    localStorage.setItem('ab-alone.light.lamps', '50');
    const game = await booting;
    const kiosk = (): number => (scene!.getObjectByName('kioskGreenLight') as THREE.Light).intensity;
    const neon = (): number => ((scene!.getObjectByName('corner-neon-nw') as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
    const scaled = [LIGHT_TUNING.kioskGreenLight! * 2, LIGHT_TUNING['corner-neon']! / 2];
    expect([kiosk(), neon()]).toEqual(scaled);
    const bloom = document.getElementById('level-bloom') as HTMLInputElement;
    expect(bloom.value).toBe('20'); // its default level (quality.ts)
    bloom.value = '300';
    bloom.dispatchEvent(new Event('input'));
    expect(localStorage.getItem('ab-alone.light.bloom')).toBe('300');
    game.hook('__setTier', 'low'); // the props and their lights made again, the panel with them
    expect([kiosk(), neon()]).toEqual(scaled);
    const strength = document.querySelector<HTMLInputElement>('#light-panel input[aria-label="bloom strength power"]')!;
    expect(strength.value).toBe(String((LIGHT_TUNING['bloom strength']! * 300) / 100));
  });
});

describe('main.ts, the room props', () => {
  it('rounds the edges of the box props within their size', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off');
    const column = scene!.getObjectByName('corner-neon-nw') as THREE.Mesh;
    expect(column.geometry).toBeInstanceOf(RoundedBoxGeometry);
    column.geometry.computeBoundingBox();
    expect(column.geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([0.14, 7.5, 0.14].map((v) => expect.closeTo(v)));
  });
});

describe('main.ts, the deck textures', () => {
  type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** The material of the cells main.ts draws, caught when it adds them to its scene: call before boot. */
  function catchCells(): () => THREE.MeshStandardMaterial {
    let cell: Mesh | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene)
        cell ??= (objects.find((o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry) as Mesh) ?? null;
      return add.apply(this, objects);
    });
    return () => cell!.material;
  }
  const name = (t: THREE.Texture | null): string | null => t?.name ?? null;

  it('the cells wear the Mess texture set when it loads', async () => {
    const cells = catchCells();
    await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.deckSet).toBe('mess'));
    expect(name(cells().map)).toBe('deck-mess.ktx2');
    expect(name(cells().normalMap)).toBe('deck-mess-normal.ktx2');
  });

  it('the Mess cells wear the concrete roughness, the other decks the shared one', async () => {
    const cells = catchCells();
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.deckSet).toBe('mess'));
    expect(name(cells().roughnessMap)).toBe('deck-mess-roughness.ktx2');
    expect(cells().roughnessMap!.wrapS).toBe(THREE.RepeatWrapping);
    expect(cells().roughnessMap!.colorSpace).not.toBe('srgb');
    game.hook('__deck', 'cargo');
    await vi.waitFor(() => expect(document.body.dataset.deckSet).toBe('cargo'));
    expect(name(cells().roughnessMap)).toBe('deck-roughness.ktx2');
    game.hook('__deck', 'mess');
    expect(name(cells().roughnessMap)).toBe('deck-mess-roughness.ktx2');
  });

  it('the Mess cells keep the shared roughness when the concrete one does not load', async () => {
    const cells = catchCells();
    await boot('?bot=off', { missing: ['deck-mess-roughness.ktx2'] });
    await vi.waitFor(() => expect(document.body.dataset.deckSet).toBe('mess'));
    expect(name(cells().roughnessMap)).toBe('deck-roughness.ktx2');
  });

  it('the board plate wears the metalness map of Metal051A, tiled like its albedo', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off&scene=room');
    const plates: Mesh[] = [];
    scene!.traverse((o) => (o as Mesh).material?.metalnessMap?.name === 'board-metalness.ktx2' && plates.push(o as Mesh));
    expect(plates).toHaveLength(1);
    expect([plates[0]!.material.metalness, plates[0]!.material.metalnessMap!.repeat.x]).toEqual([1, 0.15]);
  });

  it('the board plate wears the brushed Metal051A at a large scale, not the small floor tiles', async () => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene) scene ??= this;
      return add.apply(this, objects);
    });
    await boot('?bot=off&scene=room');
    const maps: THREE.Texture[] = [];
    scene!.traverse((o) => {
      const m = (o as Mesh).material;
      if (m && !Array.isArray(m) && m.map) maps.push(m.map);
    });
    const plate = maps.filter((t) => t.name === 'board-albedo.ktx2');
    expect(plate.length).toBeGreaterThan(0);
    expect(plate.every((t) => t.repeat.x === 0.15 && t.repeat.y === 0.15)).toBe(true);
  });

  it('without its own set, a deck keeps the shared steel albedo and no normal map', async () => {
    const cells = catchCells();
    const game = await boot('?bot=off', {
      missing: ['deck-mess.ktx2', 'deck-mess-normal.ktx2', 'deck-mess-roughness.ktx2', 'deck-cargo.ktx2'],
    });
    await vi.waitFor(() => expect(document.body.dataset.deckSet).toBe('steel'));
    expect(name(cells().map)).toBe('deck-albedo.ktx2');
    expect(cells().normalMap).toBeNull();
    expect(name(cells().roughnessMap)).toBe('deck-roughness.ktx2');
    game.hook('__deck', 'cargo'); // its normal map loads, its albedo does not: still no normal map to swap
    await vi.waitFor(() => expect(document.body.dataset.deck).toBe('cargo'));
    await game.settle();
    expect(document.body.dataset.deckSet).toBe('steel');
    expect(name(cells().map)).toBe('deck-albedo.ktx2');
    expect(cells().normalMap).toBeNull();
  });
});

describe('main.ts, the airborne particles', () => {
  it('drift with their deck each frame, and one leaving the volume comes back inside it', async () => {
    let points: THREE.Points | null = null;
    const add = THREE.Object3D.prototype.add;
    vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      points ??= (objects.find((o) => o instanceof THREE.Points) as THREE.Points) ?? null;
      return add.apply(this, objects);
    });
    const game = await boot('?bot=off', { webdriver: false });
    game.hook('__deck', 'furnace'); // steam, rising: drift [0.02, 0.12, -0.02]
    const pos = points!.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 10, 7.45, 0); // just under the top of the volume
    pos.setXYZ(1, 10, 3, 0);
    game.frame(); // the first frame moves by 16 ms
    game.frame(100); // then by at most 80 ms
    expect(pos.getX(1)).toBeCloseTo(10 + 0.02 * 0.96);
    expect(pos.getY(1)).toBeCloseTo(3 + 0.12 * 0.96);
    expect(pos.getZ(1)).toBeCloseTo(-0.02 * 0.96);
    expect(pos.getY(0)).toBeLessThanOrEqual(6.7); // 7.45 + 0.115 left the top: back somewhere in the volume
    expect(pos.getY(0)).toBeGreaterThanOrEqual(-0.3);
    expect(Math.hypot(pos.getX(0), pos.getZ(0))).toBeGreaterThanOrEqual(5.5);
    expect(Math.hypot(pos.getX(0), pos.getZ(0))).toBeLessThanOrEqual(17);
    expect(pos.version).toBeGreaterThan(0); // sent to the GPU again
  });
});

describe('main.ts, free camera and wireframe modes', () => {
  const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
  const pointer = (type: string, x: number, y: number, pointerId = 1): void => {
    canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
  };

  it('toggles free camera and cycles render modes in settings and via keyboard', async () => {
    const game = await boot('?bot=off');
    const freeCamBtn = document.getElementById('setting-free-cam') as HTMLButtonElement;
    const renderModeBtn = document.getElementById('setting-render-mode') as HTMLButtonElement;
    const resetViewBtn = document.getElementById('view-reset') as HTMLButtonElement;

    expect(game.hook('__freeCamActive')).toBe(false);
    expect(game.hook('__renderMode')).toBe('normal');
    expect(game.hook('__clayActive')).toBe(false);
    expect(game.hook('__wireframeActive')).toBe(false);

    // Toggle freeCam on with 'c' key
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(game.hook('__freeCamActive')).toBe(true);

    // Resize event while freeCam active routes to updateFreeCamCamera
    window.dispatchEvent(new Event('resize'));

    // Pointer move updates freeCam
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 110, 120);
    pointer('pointerup', 110, 120);

    // Key movement updates camera on frame
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    game.frame(16);
    // Unhandled key while freecam active
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true }));
    // Frame without movement keys (freeCam.update returns false)
    game.frame(16);

    // Escape exits freeCam
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(game.hook('__freeCamActive')).toBe(false);

    // Keyup when freeCam is inactive
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));

    // Reset view when freeCam is already inactive
    resetViewBtn.click();

    // Toggle freeCam via button
    freeCamBtn.click();
    expect(game.hook('__freeCamActive')).toBe(true);

    // Reset view turns off freeCam
    resetViewBtn.click();
    expect(game.hook('__freeCamActive')).toBe(false);

    // Toggle freeCam off via button
    freeCamBtn.click();
    expect(game.hook('__freeCamActive')).toBe(true);
    freeCamBtn.click();
    expect(game.hook('__freeCamActive')).toBe(false);

    // Cycle render modes with 'x' key: normal -> clay -> wireframe -> normal
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(game.hook('__renderMode')).toBe('clay');
    expect(game.hook('__clayActive')).toBe(true);
    expect(game.hook('__wireframeActive')).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(game.hook('__renderMode')).toBe('wireframe');
    expect(game.hook('__wireframeActive')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(game.hook('__renderMode')).toBe('normal');
    expect(game.hook('__wireframeActive')).toBe(false);

    // Cycle render modes via settings cyclic button
    renderModeBtn.click();
    expect(game.hook('__renderMode')).toBe('clay');

    renderModeBtn.click();
    expect(game.hook('__renderMode')).toBe('wireframe');

    renderModeBtn.click();
    expect(game.hook('__renderMode')).toBe('normal');

    // Toggle and cycle via hooks
    game.hook('__setRenderMode', 'clay');
    expect(game.hook('__renderMode')).toBe('clay');

    game.hook('__cycleRenderMode');
    expect(game.hook('__renderMode')).toBe('wireframe');

    game.hook('__toggleWireframe', false);
    expect(game.hook('__renderMode')).toBe('normal');

    game.hook('__toggleWireframe', true);
    expect(game.hook('__renderMode')).toBe('wireframe');

    game.hook('__toggleWireframe');
    expect(game.hook('__renderMode')).toBe('normal');

    game.hook('__toggleFreeCam', true);
    expect(game.hook('__freeCamActive')).toBe(true);
    game.hook('__toggleFreeCam', false);
    expect(game.hook('__freeCamActive')).toBe(false);
  });
});
