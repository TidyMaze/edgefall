import './test/openworldwasm';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CHUNK, World } from './openworld';
import { boatMaterial } from './openworldboat';
import { edgeMaterial } from './openworldedge';
import { stripedMaterial } from './openworldstripe';
import { OpenWorldView } from './openworldview';
import { setSoftLook, shareIfSoft, softSolid } from './softlook';

// #1710: on a software renderer the Open world's lit materials are one Lambert program, not twenty PBR ones.
const flat = (cx: number, cy: number): Uint8Array => {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([2, 2, 0], i * 3);
  return out;
};
const painted = (g: THREE.BoxGeometry): THREE.BoxGeometry => {
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(0.5), 3));
  return g;
};
const meshes = (view: OpenWorldView): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  view.scene.traverse((o) => void ((o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh)));
  return out;
};
const MARBLES = ['hero', 'troop', 'enemies', 'ejected'];
const LOOK = { base: 0xffffff, stripe: 0, roughness: 0.5 } as never;
afterEach(() => setSoftLook(false));

describe('the Open world on a software renderer (#1710)', () => {
  it('draws every lit mesh but the marbles with one flat Lambert layout: vertex colours, a normal, a four-float colour', () => {
    setSoftLook(true);
    const view = new OpenWorldView(new World(flat));
    view.setLairs([[4, 1], [0, 3]], [1]);
    view.useModels({ low: { lair: painted(new THREE.BoxGeometry(1, 5, 1)), lair_beaten: painted(new THREE.BoxGeometry(1, 2, 1)) }, high: {} });
    view.setLairs([[4, 1], [0, 3]], [1]);
    const lit = meshes(view).filter((m) => !MARBLES.includes(m.name) && !(m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial && m.geometry);
    expect(lit.length).toBeGreaterThan(20);
    for (const m of lit) {
      const material = m.material as THREE.MeshLambertMaterial;
      expect([m.name, material.type, material.flatShading, material.vertexColors]).toEqual([m.name, 'MeshLambertMaterial', true, true]);
      expect([m.name, m.geometry.getAttribute('color').itemSize, m.geometry.hasAttribute('normal')]).toEqual([m.name, 4, true]);
    }
    for (const m of meshes(view).filter((x) => MARBLES.includes(x.name))) expect((m.material as THREE.Material).type).toBe('MeshLambertNodeMaterial');
  });

  it('keeps the GPU look when the lighter look is off', () => {
    const view = new OpenWorldView(new World(flat));
    view.setLairs([[4, 1]], []);
    const lit = meshes(view).filter((m) => !MARBLES.includes(m.name) && (m.material as THREE.Material).type.startsWith('MeshLambert'));
    expect(lit).toHaveLength(0);
    expect((view.scene.getObjectByName('terrain-grass') as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(boatMaterial().type).toBe('MeshStandardMaterial');
    expect(stripedMaterial(LOOK, 1 as never).type).toBe('MeshStandardNodeMaterial');
    shareIfSoft(new THREE.Group());
  });

  it('gives a ground, a boat and a marble the lighter material, the marble with its stripe and no glow where it has none', () => {
    setSoftLook(true);
    expect(edgeMaterial({ emissive: 0x123456, roughness: 1, gain: 0 }).type).toBe('MeshLambertMaterial');
    expect(boatMaterial().type).toBe('MeshLambertMaterial');
    const marble = stripedMaterial(LOOK, 1 as never);
    expect(marble.type).toBe('MeshLambertNodeMaterial');
    expect(marble.emissiveNode).not.toBeNull();
    expect(softSolid({ color: 1, emissive: 2, emissiveIntensity: 3 }).emissiveIntensity).toBe(3);
    expect(softSolid().color.getHex()).toBe(0xffffff);
  });
});
