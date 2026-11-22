import './test/openworldwasm';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { axialTo3D, type Axial } from './board';
import { CHUNK, World } from './openworld';
import { ICON } from './openworldlairicon';
import { GROUND, OpenWorldView, PLACE_LOOK, TELEPORTER_LOOK, topOf } from './openworldview';

/** The part `name` of a landmark drawn in one call (`mergedParts` of openworldview.ts, #1647), as a geometry of its positions. */
function landmarkShape(geometry: THREE.BufferGeometry, name: string): THREE.BufferGeometry {
  const [start, count] = (geometry.userData.parts as Record<string, [number, number]>)[name]!;
  const position = geometry.attributes.position!.array as Float32Array;
  return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(position.slice(start * 3, (start + count) * 3), 3));
}

/** The part `name` of a landmark of several colours (`landmarkGeometry`): its shape, and the colour, glow and roughness written on its
 * first vertex (the same on all of its vertices). */
function landmarkPart(geometry: THREE.BufferGeometry, name: string): { geometry: THREE.BufferGeometry; colour: THREE.Color; glow: THREE.Color; roughness: number } {
  const [start] = (geometry.userData.parts as Record<string, [number, number]>)[name]!;
  const colour = new THREE.Color().fromBufferAttribute(geometry.attributes.color as THREE.BufferAttribute, start);
  const glow = new THREE.Color().fromBufferAttribute(geometry.attributes.glow as THREE.BufferAttribute, start);
  return { geometry: landmarkShape(geometry, name), colour, glow, roughness: geometry.attributes.roughness!.getX(start) };
}

// Grass everywhere in the square -12..12 of chunks, at level 2, and level 5 on (3, 0).
function grass(cx: number, cy: number): Uint8Array {
  if (Math.abs(cx) > 12 || Math.abs(cy) > 12) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const q = cx * CHUNK + (i % CHUNK);
    const r = cy * CHUNK + Math.floor(i / CHUNK);
    out.set([q === 3 && r === 0 ? 5 : 2, 2, 0], i * 3);
  }
  return out;
}

// The marker of a place in the world (#1593): the teleporter's pad, green on a town and orange on a dungeon gate (the map icons' colours).
describe('the marker of a town and a dungeon gate (#1593)', () => {
  const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
  const placed = (view: OpenWorldView, name: string): THREE.Vector3[] =>
    Array.from({ length: mesh(view, name).count }, (_, i) => {
      const m = new THREE.Matrix4();
      mesh(view, name).getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixPosition(m);
    });

  it('stands a green pad on each town and an orange one on each gate of the loaded chunks, none farther, on the lifted ground', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    const far: Axial = [(view.reach + 1) * CHUNK, 0];
    view.setPlaces([
      { kind: 'town', cell: [3, 0] },
      { kind: 'dungeon', cell: [-2, 1] },
      { kind: 'town', cell: far },
    ]);
    const towns = placed(view, 'town-pad');
    expect(towns).toHaveLength(1);
    const p = axialTo3D(3, 0);
    expect([towns[0]!.x, towns[0]!.y, towns[0]!.z]).toEqual([expect.closeTo(p.x), expect.closeTo(topOf(GROUND.grass, 5, 3, 0)), expect.closeTo(p.z)]);
    expect(placed(view, 'gate-pad')).toHaveLength(1);
    expect((mesh(view, 'town-pad').material as THREE.MeshStandardMaterial).emissive.getStyle()).toBe(new THREE.Color(ICON.town).getStyle());
    expect(landmarkPart(mesh(view, 'gate-pad').geometry, 'arch').glow.getStyle()).toBe(new THREE.Color(ICON.dungeon).getStyle()); // the glow is on the vertices (#1760)
    expect(mesh(view, 'town-pad').castShadow).toBe(true);
  });

  it('lays the ones of the new chunks when the loaded square moves', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    const far: Axial = [(view.reach + 1) * CHUNK + 3, 0];
    view.setPlaces([{ kind: 'dungeon', cell: far }]);
    expect(mesh(view, 'gate-pad').count).toBe(0);
    view.show(far);
    expect(mesh(view, 'gate-pad').count).toBe(1);
  });
});

// The silhouette of a town and a gate from far away (#1518): a tall green spire on each town, a wide orange arch on each gate.
describe('the silhouette of a town and a gate from far away (#1518)', () => {
  const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
  const size = (view: OpenWorldView, name: string, part: string): THREE.Vector3 => {
    const geometry = landmarkShape(mesh(view, name).geometry, part);
    geometry.computeBoundingBox();
    return geometry.boundingBox!.getSize(new THREE.Vector3());
  };

  it('stands a spire on each town and an arch on each gate, on the same cell and top as its pad', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    view.setPlaces([
      { kind: 'town', cell: [3, 0] },
      { kind: 'dungeon', cell: [-2, 1] },
    ]);
    // the spire and the arch are parts of their pad's mesh, drawn with it in one call (#1647)
    expect(view.scene.getObjectByName('town-spire') ?? view.scene.getObjectByName('gate-arch')).toBeUndefined();
    expect([mesh(view, 'town-pad').count, mesh(view, 'gate-pad').count]).toEqual([1, 1]);
    expect(size(view, 'town-pad', 'spire').y).toBeGreaterThan(size(view, 'town-pad', 'pad').y * 10);
    expect(size(view, 'gate-pad', 'arch').y).toBeGreaterThan(size(view, 'gate-pad', 'pad').y * 5);
  });

  it('the spire is tall and narrow, the arch wide and low, and both glow in the colour of their kind', () => {
    const view = new OpenWorldView(new World(grass));
    const spire = size(view, 'town-pad', 'spire');
    const arch = size(view, 'gate-pad', 'arch');
    expect(spire.y).toBeGreaterThanOrEqual(2);
    expect(spire.y).toBeGreaterThan(spire.x * 3);
    expect(arch.x).toBeGreaterThan(arch.y * 1.5);
    expect((mesh(view, 'town-pad').material as THREE.MeshStandardMaterial).emissive.getStyle()).toBe(new THREE.Color(PLACE_LOOK.spire.colour).getStyle());
    expect(landmarkPart(mesh(view, 'gate-pad').geometry, 'arch').glow.getStyle()).toBe(new THREE.Color(PLACE_LOOK.arch.colour).getStyle());
    expect([PLACE_LOOK.spire.colour, PLACE_LOOK.arch.colour]).toEqual([ICON.town, ICON.dungeon]); // the colours of their pads: one material each
    expect(PLACE_LOOK.spire.colour).toBe('#19e6ff'); // the art spec's neon cyan (docs/specs/art.md section 1)
    expect(PLACE_LOOK.arch.colour).toBe('#d9822b'); // the art spec's sodium hazard (docs/specs/art.md section 1)
  });
});

// The gate reads as a mouth going down (#1518): treads under the arch, darker step by step toward the back, the last one the gap floor.
describe('the mouth of a dungeon gate (#1518)', () => {
  const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
  const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it('lies flat on each gate pad, under the arch, inside the pad, and gets darker toward the back, down to the gap floor', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    view.setPlaces([
      { kind: 'town', cell: [3, 0] },
      { kind: 'dungeon', cell: [-2, 1] },
    ]);
    // one gate = one draw call (#1760): the mouth is a part of the gate's mesh, with the pad and the arch
    expect(view.scene.getObjectByName('gate-mouth')).toBeUndefined();
    const gate = mesh(view, 'gate-pad');
    expect(gate.count).toBe(1);
    const placedGates: THREE.Mesh[] = [];
    view.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('gate')) placedGates.push(o as THREE.Mesh); });
    expect(placedGates).toEqual([gate]);
    expect(gate.castShadow).toBe(false); // the frame draws it once, not twice
    const [start, n] = (gate.geometry.userData.parts as Record<string, [number, number]>).mouth!;
    const all = gate.geometry.attributes as { position: THREE.BufferAttribute; color: THREE.BufferAttribute; glow: THREE.BufferAttribute };
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute((all.position.array as Float32Array).slice(start * 3, (start + n) * 3), 3));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeGreaterThan(0.08); // over the pad's top
    expect(box.max.y).toBeLessThan(0.1); // flat
    for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.5); // inside the pad
    expect(box.max.x - box.min.x).toBeLessThan(PLACE_LOOK.arch.radius * 2); // between the arch's legs
    expect(n / 3).toBeLessThanOrEqual(24);
    // the tone by depth: the front tread is the lightest, the last one at the back the gap floor
    const byZ = new Map<number, number>();
    for (let i = start; i < start + n; i++) {
      const z = Math.round(all.position.getZ(i) * 100);
      byZ.set(z, Math.min(byZ.get(z) ?? 9, luma(all.color.getX(i), all.color.getY(i), all.color.getZ(i))));
      expect([all.glow.getX(i), all.glow.getY(i), all.glow.getZ(i)]).toEqual([0, 0, 0]); // the mouth does not glow
    }
    const tones = [...byZ.entries()].sort(([a], [b]) => b - a).map(([, l]) => l);
    expect(tones[0]).toBeGreaterThan(tones[tones.length - 1]! * 4);
    const floor = new THREE.Color(PLACE_LOOK.mouth.floor);
    expect(tones[tones.length - 1]).toBeCloseTo(luma(floor.r, floor.g, floor.b), 5);
    expect(PLACE_LOOK.mouth.floor).toBe('#020307'); // the art spec's gap floor
    expect((gate.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    // the pad and the arch keep the arch's colour, glowing
    const arch = new THREE.Color(PLACE_LOOK.arch.colour);
    const [pStart] = (gate.geometry.userData.parts as Record<string, [number, number]>).pad!;
    expect(new THREE.Color().fromBufferAttribute(all.glow, pStart).getHex()).toBe(arch.getHex());
  });
});

// The town reads as a place (#1518): a ring of six small huts round the spire, on the corners between the cells round the pad.
describe('the huts of a town (#1518)', () => {
  const mesh = (view: OpenWorldView, name: string) => view.scene.getObjectByName(name) as THREE.InstancedMesh;
  const matrix = (m: THREE.InstancedMesh, i: number): THREE.Matrix4 => {
    const out = new THREE.Matrix4();
    m.getMatrixAt(i, out);
    return out;
  };

  it('stands six huts round each town of the loaded chunks, facing the spire, on the highest of the three cells at their corner', () => {
    const view = new OpenWorldView(new World(grass));
    view.show([0, 0]);
    view.setPlaces([
      { kind: 'town', cell: [2, 0] },
      { kind: 'dungeon', cell: [-2, 1] },
      { kind: 'town', cell: [-3, 0] },
      { kind: 'town', cell: [(view.reach + 1) * CHUNK, 0] },
    ]);
    const huts = mesh(view, 'town-hut');
    expect(huts.count).toBe(12);
    expect(view.scene.getObjectByName('town-window')).toBeUndefined(); // the windows are parts of the huts' mesh (#1647)
    const centre = axialTo3D(2, 0);
    const top = ([q, r]: Axial): number => topOf(GROUND.grass, q === 3 && r === 0 ? 5 : 2, q, r);
    // the three cells at each corner, counterclockwise from the east: (3, 0), next to the town, stands at level 5 and lifts two huts
    const corners: Axial[][] = [
      [[3, 0], [2, 1], [3, 1]],
      [[2, 1], [1, 1], [1, 2]],
      [[1, 1], [1, 0], [0, 1]],
      [[1, 0], [2, -1], [1, -1]],
      [[2, -1], [3, -1], [3, -2]],
      [[3, -1], [3, 0], [4, -1]],
    ];
    const heights: number[] = [];
    for (let i = 0; i < 6; i++) {
      const m = matrix(huts, i);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeCloseTo(2 / Math.sqrt(3), 5);
      expect(p.y).toBeCloseTo(Math.max(...corners[i]!.map(top)), 5);
      heights.push(p.y);
      const facing = new THREE.Vector3(0, 0, 1).transformDirection(m);
      const inward = new THREE.Vector3(centre.x - p.x, 0, centre.z - p.z).normalize();
      expect(facing.dot(inward)).toBeGreaterThan(0.999);
    }
    expect(heights.filter((y) => Math.abs(y - top([3, 0])) < 1e-5)).toHaveLength(2);
  });

  it('is a slate hut with a pyramid roof and a lit cyan window front and back, the window the only light, few triangles', () => {
    const view = new OpenWorldView(new World(grass));
    const hut = mesh(view, 'town-hut');
    const tris = (g: THREE.BufferGeometry): number => g.attributes.position!.count / 3;
    expect(tris(hut.geometry)).toBeLessThanOrEqual(40); // the hut and its windows, in one mesh (#1647)
    const [body, window] = ['hut', 'window'].map((name) => landmarkPart(hut.geometry, name));
    body!.geometry.computeBoundingBox();
    const box = body!.geometry.boundingBox!;
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThanOrEqual(0.4); // clear of the marbles round it (0.58 away, 0.3 round)
    expect(box.min.y).toBeLessThan(-0.2); // a plinth into the lower ground, so it never floats
    expect([body!.glow.getHex(), body!.roughness]).toEqual([0, expect.closeTo(0.8)]);
    expect(body!.colour.getStyle()).toBe(new THREE.Color(PLACE_LOOK.hut.colour).getStyle());
    expect(PLACE_LOOK.hut.colour).toBe('#5d6a82'); // the art spec's cell slate
    expect(window!.glow.getStyle()).toBe(new THREE.Color(PLACE_LOOK.spire.colour).getStyle());
    expect(window!.colour.getStyle()).toBe(new THREE.Color(PLACE_LOOK.spire.colour).getStyle());
    expect(window!.roughness).toBeCloseTo(0.4);
    expect((hut.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(TELEPORTER_LOOK.emissive); // the windows glow as the pads do
    window!.geometry.computeBoundingBox();
    expect(window!.geometry.boundingBox!.max.z).toBeGreaterThan(PLACE_LOOK.hut.width / 2); // on the hut's front face
    expect(window!.geometry.boundingBox!.min.z).toBeLessThan(-PLACE_LOOK.hut.width / 2); // and its back one
  });
});
