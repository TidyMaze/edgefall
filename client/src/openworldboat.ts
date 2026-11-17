// The small low-poly boat a marble of the hero or the troop rides on water (#1441, docs/specs/openworld.md section 4): a hull and a sail
// of 18 triangles, one geometry and one material shared by every boat (one instanced mesh of the view). It bobs gently, held still under
// reduced motion, and turns to the way its marble sails. The shape, the bob and the turn are pure, so the unit tests read them.
import * as THREE from 'three/webgpu';
import { softLook, softSolid } from './softlook';

/** The colours of the boat: a dark wooden hull and a pale sail, read on the dark water of the neon world. */
export const BOAT_LOOK = { hull: 0x6b4426, sail: 0xf1ead8 };
/** The bob: how high a boat rises and falls, in world units, and its period in ms. Far under the marble's size, so it reads as calm. */
export const BOB_AMP = 0.03;
export const BOB_MS = 2600;
/** How far in cells a marble goes before its boat turns to that way: more than the lean of a blocked step (0.2), so a lean never turns it. */
export const TURN = 0.3;
/** How deep the hull sits in the water, in world units. */
export const DRAFT = 0.06;

/** Where a boat last turned (x, z) and its turn about the vertical, in radians (0: the bow on +x). */
export type Wake = { x: number; z: number; yaw: number };

/** Turns the boat of a marble now drawn at (`x`, `z`) to the way it went since `wake`, once it went `TURN` cells or more. */
export function steer(wake: Wake, x: number, z: number): void {
  const dx = x - wake.x;
  const dz = z - wake.z;
  if (Math.hypot(dx, dz) < TURN) return;
  wake.yaw = Math.atan2(-dz, dx); // a turn of yaw about +y takes the bow (+x) to (cos yaw, -sin yaw)
  wake.x = x;
  wake.z = z;
}

/** The rise of the boat of marble `i` at `now` (ms), each marble on its own phase; 0 when `now` is null (reduced motion, the low tier). */
export const bob = (now: number | null, i: number): number => (now === null ? 0 : BOB_AMP * Math.sin((2 * Math.PI * now) / BOB_MS + i * 1.9));

/** The boat of a marble of `radius`: its keel at y = 0, its bow on +x, longer and wider than the marble, a triangular sail at the bow
 * that stands over the marble's top. Flat faces, each coloured by its vertices. */
export function boatGeometry(radius: number): THREE.BufferGeometry {
  const deck = 0.6 * radius;
  const [bow, stern, beam] = [1.45 * radius, -1.2 * radius, 1.15 * radius];
  const outline: [number, number][] = [[bow, 0], [0.2 * radius, beam], [stern, 0.8 * beam], [stern, -0.8 * beam], [0.2 * radius, -beam]];
  const top = outline.map(([x, z]) => new THREE.Vector3(x, deck, z));
  const keel = outline.map(([x, z]) => new THREE.Vector3(0.6 * x, 0, 0.55 * z));
  const positions: number[] = [];
  const colours: number[] = [];
  const centre = new THREE.Vector3(0, deck / 2, 0);
  const normal = new THREE.Vector3();
  // One triangle, wound so that its face looks along `out` (the outside of the hull, or a side of the sail).
  const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3, hex: number): void => {
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const [p, q] = normal.dot(out) >= 0 ? [b, c] : [c, b];
    const colour = new THREE.Color(hex);
    for (const v of [a, p, q]) {
      positions.push(v.x, v.y, v.z);
      colours.push(colour.r, colour.g, colour.b);
    }
  };
  const outward = (...vs: THREE.Vector3[]): THREE.Vector3 => vs.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(vs.length).sub(centre);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < outline.length - 1; i++) {
    face(top[0]!, top[i]!, top[i + 1]!, up, BOAT_LOOK.hull);
    face(keel[0]!, keel[i]!, keel[i + 1]!, up.clone().negate(), BOAT_LOOK.hull);
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    face(top[i]!, keel[i]!, keel[j]!, outward(top[i]!, keel[i]!, keel[j]!), BOAT_LOOK.hull);
    face(top[i]!, keel[j]!, top[j]!, outward(top[i]!, keel[j]!, top[j]!), BOAT_LOOK.hull);
  }
  const mast = 1.15 * radius;
  const sail = [new THREE.Vector3(mast, deck, -0.75 * radius), new THREE.Vector3(mast, deck, 0.75 * radius), new THREE.Vector3(mast, deck + 2.2 * radius, 0)];
  face(sail[0]!, sail[1]!, sail[2]!, new THREE.Vector3(1, 0, 0), BOAT_LOOK.sail);
  face(sail[0]!, sail[1]!, sail[2]!, new THREE.Vector3(-1, 0, 0), BOAT_LOOK.sail);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals(); // not indexed: each face its own normal, flat
  return geometry;
}

/** The one material of every boat: its colours are the vertices', flat shaded as the props are. */
export const boatMaterial = (): THREE.MeshStandardMaterial => softLook() ? (softSolid() as unknown as THREE.MeshStandardMaterial) : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
