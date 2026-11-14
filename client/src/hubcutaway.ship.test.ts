import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Cutaway, MARBLE_RISE, cutawayFrame, baysOf, bakeShip, liftOf, shipState } from './hubcutaway';

// The bays, the marble and the car of the Hub Cutaway (#1691): the tap targets from the file, the two parts that move, the places kept across a new bake.

const NEW = shipState([], true, 'echo');
const MID = shipState(['echo'], false, 'run');

/** A node of the file: a box with a colour and glow mask in COLOR_0, or none. */
function node(name: string, rgba: number[] | null, at = new THREE.Vector3()): THREE.Mesh {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.getAttribute('position').count;
  if (rgba) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n }, () => rgba).flat()), 4));
  g.deleteAttribute('uv');
  const mesh = new THREE.Mesh(g);
  mesh.name = name;
  mesh.position.copy(at);
  return mesh;
}
const file = (...nodes: THREE.Object3D[]): THREE.Group => new THREE.Group().add(...nodes);
const at = (x: number, y: number) => new THREE.Vector3(x, y, 0);
const full = (): { scene: THREE.Object3D } => ({
  scene: file(
    node('hub_tall_hull', [1, 1, 1, 0]),
    node('hub_tall_bay_mess_bot', [1, 1, 1, 1], at(0.58, 0.24)),
    node('hub_tall_bay_mess_echo', [1, 1, 1, 1], at(1.58, 0.24)),
    node('hub_tall_marble', null, at(0.29, 3)),
    node('hub_tall_car', [1, 1, 1, 1], at(0, 2.78)),
  ),
});
const ready = async (): Promise<Cutaway> => {
  const cut = new Cutaway(async () => full(), () => undefined);
  cut.sync(true, 1000, 700, NEW);
  await Promise.resolve();
  cut.sync(true, 1000, 700, NEW);
  return cut;
};

describe('the room the ship leaves (#1691)', () => {
  it('shrinks to the room between the plate and the dock, and centres in it', () => {
    const box = new THREE.Box3(new THREE.Vector3(-4, 0, 0), new THREE.Vector3(4, 10, 1));
    const free = cutawayFrame(box, 'tall', 390, 844);
    const kept = cutawayFrame(box, 'tall', 390, 844, { top: 100, bottom: 200 });
    expect(kept.scale).toBeLessThanOrEqual(free.scale);
    expect(kept.position.y).toBeGreaterThan(free.position.y); // the middle of the room is over the middle of the window (the dock is taller than the plate)
    expect(cutawayFrame(box, 'tall', 390, 844, { top: 9000, bottom: 9000 }).scale).toBeGreaterThan(0); // never a ship of no size
  });
  it('is passed on by the cutaway when it draws', async () => {
    const cut = new Cutaway(async () => ({ scene: file(node('hub_tall_hull', [1, 1, 1, 0])) }), () => undefined);
    cut.sync(true, 390, 844, NEW);
    await Promise.resolve();
    cut.sync(true, 390, 844, NEW);
    const free = cut.group.position.y;
    cut.sync(true, 390, 844, NEW, { top: 100, bottom: 300 });
    expect(cut.group.position.y).toBeGreaterThan(free);
  });
});

describe('the bays, the marble and the car (#1691)', () => {
  it('bakes the marble and the car apart when asked, each with the place of its node, and with the ship when not', () => {
    const apart = bakeShip(full().scene, NEW, true)!;
    expect(apart.geometry.getAttribute('position').count).toBe(72); // hull and two bays
    expect(apart.marble!.origin.x).toBeCloseTo(0.29);
    expect(apart.marble!.origin.y).toBeCloseTo(3);
    expect(apart.car!.origin.y).toBeCloseTo(2.78);
    expect(apart.marble!.geometry.getAttribute('position').count).toBe(24);
    const together = bakeShip(full().scene, NEW)!;
    expect(together.geometry.getAttribute('position').count).toBe(120);
    expect([together.marble, together.car]).toEqual([null, null]);
  });

  it('reads the bays of a file: deck, room, the floor point of the node and its box', () => {
    const bays = baysOf(full().scene);
    expect(bays.map((b) => [b.deck, b.room, b.x, b.y])).toEqual([['mess', 'bot', 0.58, 0.24], ['mess', 'echo', 1.58, 0.24]]);
    expect(bays[0]!.box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0.58);
  });

  it('draws the marble and the car as meshes of their own, moves them, and keeps them put when the ship is baked again', async () => {
    const cut = await ready();
    expect(cut.bays.length).toBe(2);
    expect(cut.group.children.map((c) => c.name)).toEqual(['hub-cutaway-ship', 'hub-cutaway-marble', 'hub-cutaway-car']);
    const [, marble, car] = cut.group.children as THREE.Mesh[];
    cut.place({ x: 2, y: 1.4 }, 0.5); // on a floor: the car stays
    expect(marble!.position.x).toBeCloseTo(2 - 0.29);
    expect(marble!.position.y).toBeCloseTo(1.4 + MARBLE_RISE - 3);
    expect(marble!.scale.x).toBe(0.5);
    expect(car!.position.y).toBe(0);
    cut.place({ x: 0, y: 3.94 }, 1); // in the shaft: the car goes with it
    expect(car!.position.y).toBeCloseTo(3.94 - 2.78);
    cut.sync(true, 1000, 700, MID); // baked again: the same places
    const [, marble2, car2] = cut.group.children as THREE.Mesh[];
    expect(marble2).not.toBe(marble);
    expect(marble2!.position.y).toBeCloseTo(3.94 + MARBLE_RISE - 3);
    expect(car2!.position.y).toBeCloseTo(3.94 - 2.78);
  });

  it('finds the lift shaft where the car stands, and at 0 for a file with no car', () => {
    expect(liftOf(file(node('hub_wide_car', [1, 1, 1, 1], at(40, 0.24))))).toBe(40);
    expect(liftOf(file(node('hub_wide_hull', null)))).toBe(0);
  });

  it('keeps the shaft of its shell, which the car follows the marble in', async () => {
    const wide = (): { scene: THREE.Object3D } => ({ scene: file(node('hub_wide_hull', [1, 1, 1, 0]), node('hub_wide_marble', null, at(40.29, 0.46)), node('hub_wide_car', [1, 1, 1, 1], at(40, 0.24))) });
    const cut = new Cutaway(async () => wide(), () => undefined);
    cut.sync(true, 1000, 700, NEW);
    await Promise.resolve();
    cut.sync(true, 1000, 700, NEW);
    expect(cut.lift).toBe(40);
    cut.place({ x: 40, y: 1.62 }, 1);
    expect((cut.group.children[2] as THREE.Mesh).position.y).toBeCloseTo(1.62 - 0.24);
  });

  it('gives the bay boxes in the units of the scene, the ship scaled and placed, and a new list for each shell', async () => {
    const cut = await ready();
    const [bot] = cut.bayBoxes();
    expect(bot!.room).toBe('bot');
    expect(bot!.box.getSize(new THREE.Vector3()).x).toBeCloseTo(cut.group.scale.x);
    const first = cut.bays;
    cut.sync(true, 390, 844, NEW); // another shell: no bay until its file is loaded
    expect(cut.bays).toEqual([]);
    await Promise.resolve();
    expect(cut.bays).not.toBe(first);
    expect(cut.bays.length).toBe(2);
  });

  it('places nothing before the ship is baked, and leaves a ship with no marble and no car as it is', async () => {
    const cut = new Cutaway(async () => ({ scene: file(node('hub_tall_hull', [1, 1, 1, 0])) }), () => undefined);
    cut.place({ x: 0, y: 1 }, 1); // no ship yet
    cut.sync(true, 1000, 700, NEW);
    await Promise.resolve();
    cut.sync(true, 1000, 700, NEW);
    cut.place({ x: 0, y: 2 }, 1);
    expect(cut.group.children.length).toBe(1);
  });
});
