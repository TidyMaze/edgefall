// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { bothSides, setSoftLook, shareShapes, softLook, softMarble } from './softlook';

const createMockRenderer = (): THREE.WebGPURenderer =>
  ({ domElement: document.createElement('canvas'), backend: { isWebGPUBackend: false }, toneMapping: 0, toneMappingExposure: 1, shadowMap: { enabled: false, type: 0 }, init: async (): Promise<void> => {}, setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), setAnimationLoop: vi.fn() }) as unknown as THREE.WebGPURenderer;

afterEach(() => setSoftLook(false));

describe('the lighter look of a software renderer (#1710)', () => {
  it('is off until main.ts turns it on', () => {
    expect(softLook()).toBe(false);
    setSoftLook(true);
    expect(softLook()).toBe(true);
    setSoftLook(false);
    expect(softLook()).toBe(false);
  });

  it('draws the unlit materials on both sides, so those that differ by side only are one program; a back-face dome and lit materials stay', () => {
    const root = new THREE.Group();
    const [front, back, double] = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map((side) => new THREE.MeshBasicMaterial({ side }));
    const lit = new THREE.MeshLambertMaterial();
    root.add(...[front, back, double, lit].map((m) => new THREE.Mesh(new THREE.BufferGeometry(), m)), new THREE.Group());
    bothSides(root);
    expect([front!.side, back!.side, double!.side, lit.side]).toEqual([THREE.DoubleSide, THREE.BackSide, THREE.DoubleSide, THREE.FrontSide]);
  });

  it('gives a marble its colour and its rim as a steady glow on a Lambert material', () => {
    const marble = softMarble(0x14161a, 0x7fd6e8, 0.25);
    expect(marble).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(marble.color.getHex()).toBe(0x14161a);
    expect(marble.emissive.toArray()).toEqual(new THREE.Color(0x7fd6e8).multiplyScalar(0.25).toArray());
  });
});

describe('the shared program shape of a software renderer (#1710)', () => {
  const geo = (colour: number | null, normal: boolean): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    if (normal) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    if (colour) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * colour).fill(0.5), colour));
    return g;
  };
  it('gives every lit and unlit mesh a normal and a four-float vertex colour, white where it had none, and turns its colours on', () => {
    const root = new THREE.Group();
    const bare = new THREE.Mesh(geo(null, false), new THREE.MeshBasicMaterial());
    const three = new THREE.Mesh(geo(3, true), new THREE.MeshLambertMaterial());
    const four = new THREE.Mesh(geo(4, true), new THREE.MeshBasicMaterial({ vertexColors: true }));
    const twin = new THREE.Mesh(bare.geometry, new THREE.MeshBasicMaterial()); // a shared shape is turned once
    const inst = new THREE.InstancedMesh(geo(null, false), new THREE.MeshBasicMaterial(), 2);
    const std = new THREE.Mesh(geo(null, false), new THREE.MeshStandardMaterial());
    const multi = new THREE.Mesh(geo(null, false), [new THREE.MeshBasicMaterial()]);
    root.add(bare, three, four, twin, inst, std, multi, new THREE.Group());
    shareShapes(root);
    for (const m of [bare, three, four, twin, inst]) {
      const a = m.geometry.attributes;
      expect([a.normal!.itemSize, a.color!.itemSize, (m.material as THREE.MeshBasicMaterial).vertexColors]).toEqual([3, 4, true]);
    }
    expect(Array.from(bare.geometry.attributes.color!.array)).toEqual(new Array(12).fill(1));
    expect(Array.from(three.geometry.attributes.color!.array)).toEqual([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1]);
    expect(four.geometry.attributes.color!.array.length).toBe(12);
    expect(twin.geometry).toBe(bare.geometry);
    expect(std.geometry.attributes.color).toBeUndefined(); // a PBR mesh and a material list are left alone
    expect(multi.geometry.attributes.color).toBeUndefined();
  });
});

describe('the scene of a software renderer (#1710)', () => {
  it('has a Lambert deck prop and no FXAA pass on it; the GPU look keeps the standard prop and its FXAA', async () => {
    const make = async (soft: boolean) => {
      vi.resetModules();
      const { setSoftLook: set } = await import('./softlook');
      set(soft);
      const { SceneRenderer } = await import('./scene');
      return new SceneRenderer({ renderer: createMockRenderer(), devicePixelRatio: 1, webdriver: false } as never);
    };
    const [soft, gpu] = [await make(true), await make(false)];
    const prop = (sr: { scene: THREE.Scene }) => (sr.scene.getObjectByName('deck-prop') as THREE.Mesh).material as THREE.Material;
    expect(prop(soft)).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(prop(gpu)).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(soft.pipeline!.outputColorTransform).toBe(true); // no FXAA: the renderer tones the picture itself
    expect(gpu.pipeline!.outputColorTransform).toBe(false); // FXAA reads the tone-mapped picture
  });

  it('gives the neon materials Lambert on a software renderer, the standard PBR ones otherwise', async () => {
    const kinds = async (soft: boolean) => {
      vi.resetModules();
      const { setSoftLook: set } = await import('./softlook');
      set(soft);
      const { neonMaterial } = await import('./neonlook');
      return ['dish', 'scene_post_1', 'scene_slab_arena', 'scene_col_map_b', 'scene_tower_lamp_0'].map((n) => neonMaterial(n).constructor.name);
    };
    const [soft, gpu] = [await kinds(true), await kinds(false)];
    expect(soft).toEqual(['MeshLambertMaterial', 'MeshLambertMaterial', 'MeshLambertMaterial', 'MeshLambertMaterial', 'MeshBasicMaterial']);
    expect(gpu).toEqual(['MeshStandardMaterial', 'MeshStandardMaterial', 'MeshStandardMaterial', 'MeshStandardMaterial', 'MeshBasicMaterial']);
  });
});
