import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { framing } from './camera';
import { Cutaway, CUTAWAY_VIEW, DIM, MIN_BAY, STRIP, bakeShip, cutawayFrame, followFrame, shipState } from './hubcutaway';

// The Hub Cutaway on a small phone and its light (#1691): the decks other than the marble's at 70 %, and a camera that frames the floors around the marble when the whole ship
// would leave a bay under 46 px, and follows the marble up the lift.

const ALL = shipState(['echo', 'hull', 'choir', 'chaplain'], false, null);
const FLOORS: [string, number][] = [['mess_bot', 0.24], ['mess_echo', 1.4], ['cargo_hull', 2.78], ['cargo_alien', 3.94], ['furnace_choir', 5.32], ['chapel_chaplain', 6.7], ['bridge_ballast', 8.08], ['mess_online', 0.24]];

/** A box of the file: a bay is 1 x 1.16 from its node up, the hull a dome wider than the bays. */
function node(name: string, size: [number, number], x: number, y: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n }, () => [0.5, 0.5, 0.5, 1]).flat()), 4));
  g.deleteAttribute('uv');
  g.translate(0.5, 0.5, 0); // the node stands at the foot of its box, as in the file
  const mesh = new THREE.Mesh(g);
  mesh.name = name;
  mesh.scale.set(size[0], size[1], 1);
  mesh.position.set(x, y, 0);
  return mesh;
}
const ship = (): { scene: THREE.Object3D } => ({
  scene: new THREE.Group().add(node('hub_tall_hull', [9, 12], -1.5, -1), ...FLOORS.map(([k, y], i) => node(`hub_tall_bay_${k}`, [1, 1.16], 0.58 + (i % 3), y)), node('hub_tall_marble', [0.4, 0.4], 0, 3), node('hub_tall_car', [0.5, 1], -0.5, 2.78)),
});
async function ready(width: number, height: number, state = ALL, inset = { top: 60, bottom: 70 }): Promise<Cutaway> {
  const cut = new Cutaway(async () => ship(), () => undefined);
  cut.sync(true, width, height, state, inset);
  await Promise.resolve();
  cut.sync(true, width, height, state, inset);
  return cut;
}
const emitOf = (cut: Cutaway, vertex: number): number => ((cut.group.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry).getAttribute('emit').getX(vertex);
const colorOf = (cut: Cutaway, vertex: number): number => ((cut.group.children[0] as THREE.Mesh).geometry as THREE.BufferGeometry).getAttribute('color').getX(vertex);

describe('the light of the decks', () => {
  it('lists the vertices of each part with its deck, null for the hull', () => {
    const baked = bakeShip(ship().scene, ALL, true)!;
    expect(baked.spans[0]).toEqual({ deck: null, count: 24 });
    expect(baked.spans[1]).toEqual({ deck: 'mess', count: 24 });
    expect(baked.spans.length).toBe(1 + FLOORS.length);
  });
  it('keeps the deck under the marble at full light and drops the others to 70 %, the hull and the marble untouched', async () => {
    const cut = await ready(1000, 700);
    const mess = 24 * 1;
    const cargo = 24 * 3;
    expect(DIM).toBe(0.5);
    const mesh = cut.group.children[0];
    cut.place({ x: 0.58, y: 2.78 }, 1); // the Cargo
    const fullCargo = emitOf(cut, cargo);
    const dimMess = emitOf(cut, mess);
    expect(fullCargo).toBeGreaterThan(0);
    expect(colorOf(cut, mess)).toBeCloseTo(0.5 * DIM, 5);
    expect(colorOf(cut, cargo)).toBeCloseTo(0.5, 5);
    expect(colorOf(cut, 0)).toBe(0.5); // the hull
    cut.place({ x: 0.58, y: 0.24 }, 1); // the Mess
    expect(cut.group.children[0]).toBe(mesh); // the same mesh: the arrays are rewritten, nothing is baked again
    expect(emitOf(cut, mess)).toBeCloseTo(dimMess / DIM, 5);
    expect(emitOf(cut, cargo)).toBeCloseTo(fullCargo * DIM, 5);
    expect(colorOf(cut, cargo)).toBeCloseTo(0.5 * DIM, 5);
  });
  it('picks the deck of the nearest floor while the marble rides the lift, and keeps the light through a new bake', async () => {
    const cut = await ready(1000, 700);
    cut.place({ x: -0.5, y: 3.0 }, 1); // between Cargo's floors: Cargo
    expect(colorOf(cut, 24 * 3)).toBeCloseTo(0.5, 5);
    cut.place({ x: -0.5, y: 7.9 }, 1); // near the Bridge
    expect(colorOf(cut, 24 * 7)).toBeCloseTo(0.5, 5);
    expect(colorOf(cut, 24 * 3)).toBeCloseTo(0.5 * DIM, 5);
    cut.sync(true, 1000, 700, shipState(['echo'], false, 'run'), { top: 60, bottom: 70 }); // baked again
    expect(colorOf(cut, 24 * 7)).toBeCloseTo(0.5, 5);
  });
  it('lights nothing apart before a marble is placed, and a ship with no bay has no focus', async () => {
    const cut = await ready(1000, 700);
    expect(colorOf(cut, 24 * 3)).toBeCloseTo(0.5, 5);
    const empty = new Cutaway(async () => ({ scene: new THREE.Group().add(node('hub_tall_hull', [9, 12], 0, 0)) }), () => undefined);
    empty.sync(true, 1000, 700, ALL);
    await Promise.resolve();
    empty.sync(true, 1000, 700, ALL);
    empty.place({ x: 0, y: 1 }, 1);
    expect(colorOf(empty, 0)).toBe(0.5);
  });
});

describe('a marble placed before the ship is baked', () => {
  it('moves no light and no camera, and is lit when the ship is baked', async () => {
    const cut = new Cutaway(async () => ship(), () => undefined);
    cut.sync(true, 1000, 700, ALL); // asks for the file
    await Promise.resolve();
    cut.place({ x: 0.58, y: 2.78 }, 1); // the bays are known, the ship is not baked
    expect(cut.group.children.length).toBe(0);
    cut.sync(true, 1000, 700, ALL);
    expect(colorOf(cut, 24)).toBeCloseTo(0.5 * DIM, 5); // the Mess, the marble in the Cargo
  });
});

describe('the lift column on the window', () => {
  it('is the shaft of the file with the ship scaled and placed, at the front of the bays, and the front plane of the ship before its file is loaded', async () => {
    const cut = await ready(360, 640);
    cut.place({ x: 0.58, y: 0.24 }, 1);
    const p = cut.liftWorld();
    expect(p.x).toBeCloseTo(-0.5 * cut.group.scale.x + cut.group.position.x); // the car's node stands at x -0.5
    expect(p.z).toBeCloseTo(cut.bayBoxes()[0]!.box.max.z);
    expect(new Cutaway(async () => ship(), () => undefined).liftWorld().z).toBe(0);
  });
});

describe('framing the floors around the marble on a small phone', () => {
  const seenH = (w: number, h: number): number => 2 * CUTAWAY_VIEW.distance * Math.tan((framing(w, h) * Math.PI) / 360);
  const inset = { top: 60, bottom: 70 };

  it('keeps the whole ship while every bay is 46 px or more, as for a window', async () => {
    const cut = await ready(1400, 900);
    cut.place({ x: 0.58, y: 0.24 }, 1);
    expect(cut.follow).toBeNull();
    expect(cut.group.scale.x).toBeGreaterThan(0);
  });
  it('zooms in until the smallest bay is 46 px, and puts the marble floor in the room of the window', async () => {
    const cut = await ready(360, 640);
    cut.place({ x: 0.58, y: 0.24 }, 1);
    expect(cut.follow).not.toBeNull();
    const whole = cutawayFrame(new THREE.Box3(new THREE.Vector3(-6, -1, -1), new THREE.Vector3(3, 11, 1)), 'tall', 360, 640, inset);
    expect(cut.group.scale.x).toBeGreaterThan(whole.scale);
    const px = (cut.group.scale.x * 640) / seenH(360, 640); // a bay is 1 unit wide
    expect(px).toBeGreaterThanOrEqual(MIN_BAY - 0.5);
    expect(cut.follow).toEqual({ top: inset.top + STRIP, bottom: 640 - inset.bottom - STRIP, up: true, down: false, seenUp: expect.any(Boolean), seenDown: false });
  });
  it('follows the marble up the lift and stops at the ends of the ship', async () => {
    const cut = await ready(360, 640);
    cut.place({ x: 0.58, y: 0.24 }, 1);
    const ys: number[] = [];
    for (const y of [0.24, 1.4, 2.78, 3.94, 5.32, 6.7, 8.08]) {
      cut.place({ x: -0.5, y }, 1);
      ys.push(cut.group.position.y);
    }
    expect(ys[0]).toBe(ys[1]); // the room holds the three lowest floors
    for (let i = 1; i < ys.length - 1; i++) expect(ys[i + 1]).toBeLessThanOrEqual(ys[i]!); // the ship goes down as the marble goes up
    expect(ys[6]).toBeLessThan(ys[3]!); // up to the top floor
    const top = ys[6]!;
    cut.place({ x: -0.5, y: 8.5 }, 1); // beyond the last floor: the ship does not slide on
    expect(cut.group.position.y).toBeCloseTo(top);
    cut.place({ x: -0.5, y: 8.08 }, 1);
    expect(ys[3]).toBeLessThan(ys[1]!); // in between it follows
    expect(cut.follow).toMatchObject({ up: false, down: true });
    cut.place({ x: -0.5, y: 3.94 }, 1);
    expect(cut.follow).toMatchObject({ up: true, down: true });
  });
  it('is not used by the pure frame when the whole ship is enough, and is the same one the cutaway draws', () => {
    const bays = FLOORS.map(([, y], i) => ({ box: new THREE.Box3(new THREE.Vector3(0.58 + (i % 3), y, -0.5), new THREE.Vector3(1.58 + (i % 3), y + 1.16, 0.5)) }));
    const hull = new THREE.Box3(new THREE.Vector3(-6, -1, -1), new THREE.Vector3(3, 11, 1));
    const whole = cutawayFrame(hull, 'tall', 390, 844, inset);
    const big = followFrame(hull, bays, whole.scale * 4, 3, 390, 844, inset); // bays already large
    expect(big).toBeNull();
    const small = followFrame(hull, bays, whole.scale, 3, 390, 844, inset);
    expect(small).not.toBeNull();
    expect(small!.scale).toBeGreaterThan(whole.scale);
  });
  it('says whether the floor the lift goes to is whole in the room already', async () => {
    const cut = await ready(360, 640);
    cut.place({ x: -0.5, y: 3.94 }, 1); // in the middle: the floors next to it are in view
    expect(cut.follow).toMatchObject({ up: true, down: true, seenUp: true, seenDown: true });
    cut.place({ x: -0.5, y: 0.24 }, 1);
    expect(cut.follow).toMatchObject({ seenUp: true, seenDown: false });
    expect(cut.deck).toBe('mess');
  });
  it('shows the whole room when the ship is shorter than it, centred', () => {
    const bays = [0, 1].map((i) => ({ box: new THREE.Box3(new THREE.Vector3(i * 2, i * 1.2, -0.5), new THREE.Vector3(i * 2 + 1, i * 1.2 + 1.16, 0.5)) }));
    const hull = new THREE.Box3(new THREE.Vector3(-6, -1, -1), new THREE.Vector3(9, 4, 1));
    const f = followFrame(hull, bays, 0.01, 0, 360, 640, { top: 60, bottom: 70 })!;
    const f2 = followFrame(hull, bays, 0.01, 1.2, 360, 640, { top: 60, bottom: 70 })!;
    expect(f.position.y).toBeCloseTo(f2.position.y); // two floors fit: nothing to follow
  });
});
