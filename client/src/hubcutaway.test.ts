import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { framing } from './camera';
import { Cutaway, CUTAWAY_VIEW, FILL, GLOW, baysOf, bakeShip, liftOf, cutawayFile, cutawayFrame, glowOf, goalRoom, partOf, roomState, shellFor, shipMaterial, shipState, type ShipState } from './hubcutaway';

const fs = 'node:fs/promises'; // untyped: the client has no Node types
const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: URL): Promise<Uint8Array> };

const NEW = shipState([], true, 'echo'); // a new player: the Mess alone, the first win awaited
const MID = shipState(['echo'], false, 'run'); // The Echo beaten: Mess and Cargo
const LATE = shipState(['echo', 'hull', 'choir', 'chaplain', 'dual'], false, 'ballast'); // all five decks
const glow = (name: string, st: ShipState): number | null => {
  const c = glowOf(partOf(name)!, st);
  return c && c.getHex();
};
const col = (hex: number, k = 1): number => new THREE.Color(hex).multiplyScalar(k).getHex();

describe('the flag and the shell (#1689)', () => {
  it('chooses the tall shell under 600 px wide or 500 px high, the wide one above', () => {
    expect([shellFor(390, 844), shellFor(599, 900), shellFor(1000, 499), shellFor(600, 500), shellFor(1000, 700)]).toEqual(['tall', 'tall', 'tall', 'wide', 'wide']);
    expect(cutawayFile('tall')).toBe('hub-cutaway-tall');
  });
});

describe('the state of the ship (#1689)', () => {
  it('opens the Mess for a new player and a deck once the seat boss of the deck below is beaten', () => {
    expect([...NEW.open]).toEqual(['mess']);
    expect(NEW.waiting).toBe(true);
    expect([...MID.open]).toEqual(['mess', 'cargo']);
    expect([...LATE.open]).toEqual(['mess', 'cargo', 'furnace', 'chapel', 'bridge']);
  });

  it('points the goal at a seat boss, the Rogue-lite room, or nothing', () => {
    expect(goalRoom({ deck: 'chapel', room: 'boss' })).toBe('chaplain');
    expect(goalRoom({ deck: 'cargo', room: 'run' })).toBe('run');
    expect(goalRoom({ deck: null, room: null })).toBeNull();
    expect(goalRoom({ deck: null, room: 'boss' })).toBeNull();
  });

  it('tells a room dark, locked, goal, beaten or lit', () => {
    expect(roomState('hull', 'cargo', NEW)).toBe('dark'); // a shut deck
    expect(roomState('echo', 'mess', NEW)).toBe('locked'); // a boss, the first win awaited
    expect(roomState('bot', 'mess', NEW)).toBe('goal'); // the first win's goal (#1692); not a boss nor a waiting mode: playable at once
    expect(roomState('run', 'cargo', MID)).toBe('goal');
    expect(roomState('echo', 'mess', MID)).toBe('beaten');
    expect(roomState('dual', 'mess', MID)).toBe('lit');
  });
});

describe('the parts of the file (#1689)', () => {
  it('reads the part of a node from its name', () => {
    expect(partOf('hub_tall_hull')).toEqual({ kind: 'hull', deck: null, room: '', variant: null });
    expect(partOf('hub_wide_marble')).toMatchObject({ kind: 'marble' });
    expect(partOf('hub_tall_bay_mess_bot')).toEqual({ kind: 'bay', deck: 'mess', room: 'bot', variant: null });
    expect(partOf('hub_tall_prop_chapel_stalker_shut')).toEqual({ kind: 'prop', deck: 'chapel', room: 'stalker', variant: 'shut' });
    expect(partOf('hub_tall_prop_chapel_stalker_open.001')).toMatchObject({ variant: 'open' });
    expect(partOf('hub_tall_shaft_cargo1')).toEqual({ kind: 'shaft', deck: 'cargo', room: '1', variant: null });
    expect(partOf('hub_tall_hatch_chapel')).toEqual({ kind: 'hatch', deck: 'chapel', room: '', variant: null });
    expect(partOf('hub_tall_seal_cargo_hull')).toMatchObject({ kind: 'seal', room: 'hull' });
    expect(partOf('Cube')).toBeNull();
    expect(partOf('hub_tall_bay_nowhere_bot')).toBeNull();
  });

  it('lights a deck with its lamp, off while it is dark', () => {
    expect(glow('hub_tall_bay_mess_bot', NEW)).toBe(col(0xffb000)); // the House table: the goal (#1692)
    expect(glow('hub_tall_bay_mess_hotseat', NEW)).toBe(col(0xffe3bf));
    expect(glow('hub_tall_bay_cargo_hull', LATE)).toBe(col(0x7fd6e8));
    expect(glow('hub_tall_bay_furnace_core', LATE)).toBe(col(0xd9822b));
    expect(glow('hub_tall_bay_chapel_stalker', LATE)).toBe(col(0x9a6bff));
    expect(glow('hub_tall_bay_bridge_pulsar', LATE)).toBe(col(0xe8f0ff));
    expect(glow('hub_tall_bay_cargo_hull', NEW)).toBe(0); // locked deck near black
    expect(glow('hub_tall_bay_cargo_hold', NEW)).toBe(0);
    expect(glow('hub_tall_bay_cargo_hold', MID)).toBe(col(0x7fd6e8));
  });

  it('gives a bay its state: locked is nearly dark, the goal amber, a lit and a beaten one the lamp', () => {
    expect(glow('hub_tall_bay_mess_echo', NEW)).toBe(col(0xffe3bf, 0.05));
    expect(glow('hub_tall_bay_cargo_run', MID)).toBe(col(0xffb000));
    expect(glow('hub_tall_bay_mess_echo', MID)).toBe(col(0xffe3bf));
  });

  it('gives a prop its state', () => {
    expect(glow('hub_tall_prop_mess_bot', NEW)).toBe(col(0xffb000)); // the goal while the first win is awaited (#1692)
    expect(glow('hub_tall_prop_mess_hotseat', NEW)).toBe(col(0x19e6ff)); // a mode room
    expect(glow('hub_tall_prop_mess_medals', NEW)).toBe(col(0xffd43b));
    expect(glow('hub_tall_prop_mess_dual', MID)).toBe(col(0x9a6bff)); // a boss room
    expect(glow('hub_tall_prop_cargo_run', MID)).toBe(col(0xffb000)); // the goal
    expect(glow('hub_tall_prop_cargo_hull', NEW)).toBe(col(0x39466a, 0.15)); // a dark deck
    expect(glow('hub_tall_prop_mess_daily', NEW)).toBe(col(0x9aa3a8, 0.2)); // locked
  });

  it('shows a boss door shut until it is beaten, then open with its seal', () => {
    expect(glow('hub_tall_prop_mess_dual_shut', MID)).toBe(col(0x9a6bff));
    expect(glow('hub_tall_prop_mess_dual_open', MID)).toBeNull();
    expect(glow('hub_tall_prop_mess_echo_shut', MID)).toBeNull();
    expect(glow('hub_tall_prop_mess_echo_open', MID)).toBe(col(0x9a6bff));
    expect(glow('hub_tall_seal_mess_echo', MID)).toBe(col(0xffd43b));
    expect(glow('hub_tall_seal_mess_dual', MID)).toBeNull();
    expect(glow('hub_tall_prop_mess_bot_shut', MID)).toBe(col(0x19e6ff)); // a variant on a room that is no boss: shown
  });

  it('lights a set piece with its deck, the candles in sodium, dim while the deck is shut', () => {
    expect(glow('hub_tall_set_cargo_hold', MID)).toBe(col(0x7fd6e8));
    expect(glow('hub_tall_set_chapel_nave', LATE)).toBe(col(0xd9822b));
    expect(glow('hub_tall_set_chapel_nave', MID)).toBe(col(0x39466a, 0.15));
  });

  it('lights the lift: the shaft of an open deck, the hatch up, the car', () => {
    expect(glow('hub_tall_shaft_mess0', NEW)).toBe(col(0x19e6ff, 0.9));
    expect(glow('hub_tall_shaft_cargo0', NEW)).toBe(col(0x39466a, 0.25));
    expect(glow('hub_tall_hatch_cargo', MID)).toBe(col(0xd9822b)); // the deck above (Furnace) is shut: sodium, full as Cargo is open
    expect(glow('hub_tall_hatch_chapel', LATE)).toBe(col(0x19e6ff));
    expect(glow('hub_tall_hatch_chapel', NEW)).toBe(col(0xd9822b, 0.25)); // neither open
    expect(glow('hub_tall_car', LATE)).toBe(col(0x19e6ff));
    expect(glow('hub_tall_hatch_bridge', LATE)).toBe(col(0xd9822b)); // no deck above
  });

  it('lights the outside: mast, window, nozzles, Airlock, cable, Hollow and the marble', () => {
    expect(glow('hub_tall_mast', LATE)).toBe(col(0xe8f0ff));
    expect(glow('hub_tall_mast', NEW)).toBe(col(0xff6b5a, 0.6));
    expect(glow('hub_tall_window', LATE)).toBe(col(0xe8f0ff));
    expect(glow('hub_tall_window', NEW)).toBe(col(0x39466a, 0.12));
    expect(glow('hub_tall_nozzles', NEW)).toBe(col(0xd9822b));
    expect(glow('hub_tall_airlock', NEW)).toBe(col(0x9aa3a8, 0.25));
    expect(glow('hub_tall_airlock', LATE)).toBe(col(0x7fd6e8));
    expect(glow('hub_tall_cable', MID)).toBe(col(0xffb000)); // the goal
    expect(glow('hub_tall_cable', LATE)).toBe(col(0x7fd6e8));
    expect(glow('hub_tall_cable', NEW)).toBe(col(0x9aa3a8, 0.25));
    expect(glow('hub_tall_hollow', NEW)).toBe(col(0xffe3bf));
    expect(glow('hub_tall_marble', NEW)).toBe(col(0xf2f0ea));
    expect(glow('hub_tall_hull', NEW)).toBe(0xffffff);
  });
});

/** A node of the file: a box of `n` vertices, `rgba` its colour and glow mask in COLOR_0 (itemSize 4), or none. */
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

describe('baking the ship (#1689)', () => {
  it('bakes the nodes of the state into one geometry: the base colour, and the glow mask times the state colour times GLOW', () => {
    const root = file(node('hub_tall_hull', [0.1, 0.2, 0.3, 0], new THREE.Vector3(0, 0, 0)), node('hub_tall_bay_mess_bot', [0.5, 0.5, 0.5, 0.5], new THREE.Vector3(10, 0, 0)), node('Cube', null));
    const baked = bakeShip(root, NEW)!;
    const g = baked.geometry;
    expect(g.getAttribute('position').count).toBe(48); // two boxes, the Cube left out
    expect(g.getAttribute('color').itemSize).toBe(3);
    expect([...g.getAttribute('color').array.slice(0, 3)].map((v) => +v.toFixed(2))).toEqual([0.1, 0.2, 0.3]);
    expect([...g.getAttribute('emit').array.slice(0, 3)]).toEqual([0, 0, 0]); // the hull never glows
    const lamp = new THREE.Color(0xffe3bf);
    expect(g.getAttribute('emit').getX(24)).toBeCloseTo(lamp.r * 0.5 * GLOW, 5);
    expect(g.getAttribute('position').getX(24)).toBeGreaterThan(9); // in world space
    expect(baked.hull.getCenter(new THREE.Vector3()).x).toBe(0); // the box of the hull alone
  });

  it('bakes the nodes that share one mesh (the bay) each at its own place, and leaves the file as it was', () => {
    const first = node('hub_tall_bay_mess_bot', [1, 1, 1, 1], new THREE.Vector3(10, 0, 0));
    const second = node('hub_tall_bay_mess_online', [1, 1, 1, 1], new THREE.Vector3(20, 0, 0));
    second.geometry = first.geometry;
    const baked = bakeShip(file(first, second), NEW)!.geometry;
    expect(baked.getAttribute('position').getX(0)).toBeCloseTo(10.5);
    expect(baked.getAttribute('position').getX(24)).toBeCloseTo(20.5);
    expect(first.geometry.getAttribute('position').getX(0)).toBeCloseTo(0.5);
    expect(bakeShip(file(first, second), NEW)!.geometry.getAttribute('position').getX(24)).toBeCloseTo(20.5); // and again, in another state
  });

  it('leaves out a part the state does not show, and a mesh of no part', () => {
    const root = file(node('hub_tall_hull', [1, 1, 1, 0]), node('hub_tall_prop_mess_echo_open', [1, 1, 1, 1]), node('hub_tall_prop_mess_echo_shut', [1, 1, 1, 1]));
    expect(bakeShip(root, MID)!.geometry.getAttribute('position').count).toBe(48); // hull and the open door: the shut one is out
    expect(bakeShip(file(node('Cube', null)), NEW)).toBeNull();
  });

  it('glows white on the marble, which has no colour layer, and with a colour layer of three components', () => {
    const rgb = node('hub_tall_bay_mess_bot', null);
    rgb.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 3).fill(0.4), 3));
    const baked = bakeShip(file(node('hub_tall_marble', null), rgb), NEW)!.geometry;
    expect(baked.getAttribute('emit').getX(0)).toBeCloseTo(0.6);
    expect(baked.getAttribute('color').getX(0)).toBe(1);
    expect(baked.getAttribute('emit').getX(24)).toBe(0); // no mask: no glow
    expect(baked.getAttribute('color').getX(24)).toBeCloseTo(0.4);
  });

  it('keeps white and no glow on a part with no colour layer', () => {
    const baked = bakeShip(file(node('hub_tall_bay_mess_bot', null)), NEW)!.geometry;
    expect([baked.getAttribute('color').getX(0), baked.getAttribute('emit').getX(0)]).toEqual([1, 0]);
  });

  it('draws the ship with one material that takes the glow from the vertices', () => {
    expect(shipMaterial()).toBe(shipMaterial());
    expect(shipMaterial().vertexColors).toBe(true);
    expect(shipMaterial().emissiveNode).toBeTruthy();
  });
});

describe('framing the ship (#1689)', () => {
  it('puts the hull at the middle of the window, scaled to fill its share, whichever side is tight', () => {
    const box = new THREE.Box3(new THREE.Vector3(-4, 0, 0), new THREE.Vector3(4, 10, 1));
    const wide = cutawayFrame(box, 'wide', 1000, 700);
    const seenH = 2 * CUTAWAY_VIEW.distance * Math.tan((framing(1000, 700) * Math.PI) / 360);
    expect(wide.scale).toBeCloseTo((FILL.wide * seenH) / 10); // the height is the tight side
    expect(wide.position.y).toBeCloseTo(-5 * wide.scale);
    expect(wide.position.z).toBeCloseTo(-wide.scale); // the cut face (the box's front, z 1) stands at the camera's target
    const phone = cutawayFrame(box, 'tall', 390, 844);
    const seenW = (2 * CUTAWAY_VIEW.distance * Math.tan((framing(390, 844) * Math.PI) / 360) * 390) / 844;
    expect(phone.scale).toBeCloseTo(Math.min((FILL.tall * seenW) / 8, (FILL.tall * 2 * CUTAWAY_VIEW.distance * Math.tan((framing(390, 844) * Math.PI) / 360)) / 10));
  });
});

describe('the cutaway on the terrace (#1689)', () => {
  const shell = (): { scene: THREE.Object3D } => ({ scene: file(node('hub_tall_hull', [1, 1, 1, 0]), node('hub_tall_bay_mess_bot', [1, 1, 1, 1])) });

  it('loads nothing while it is off', () => {
    const load = vi.fn(async () => shell());
    const cut = new Cutaway(load, () => undefined);
    expect(cut.sync(false, 1000, 700, NEW)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(cut.group.visible).toBe(false);
    expect(cut.shell).toBeNull();
  });

  it('loads the shell of the window once, draws it as one mesh, and bakes again only when the state changes', async () => {
    const load = vi.fn(async () => shell());
    const loaded = vi.fn();
    const cut = new Cutaway(load, loaded);
    expect(cut.sync(true, 1000, 700, NEW)).toBe(false); // the file is on its way
    await Promise.resolve();
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('hub-cutaway-wide');
    expect(cut.sync(true, 1000, 700, NEW)).toBe(true);
    expect(cut.shell).toBe('wide');
    const mesh = cut.group.children[0] as THREE.Mesh;
    expect(cut.group.children.length).toBe(1);
    expect(cut.sync(true, 1000, 700, NEW)).toBe(true);
    expect(cut.group.children[0]).toBe(mesh); // same state: the same mesh
    cut.sync(true, 1000, 700, MID);
    expect(cut.group.children[0]).not.toBe(mesh);
    expect(cut.group.children.length).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cut.group.scale.x).toBeGreaterThan(0);
    expect(cut.sync(false, 1000, 700, NEW)).toBe(false);
    expect(cut.group.visible).toBe(false);
  });

  it('drops the shell and asks for the other one when the window crosses 600 x 500, one loaded at a time', async () => {
    const load = vi.fn(async () => shell());
    const cut = new Cutaway(load, () => undefined);
    cut.sync(true, 1000, 700, NEW);
    await Promise.resolve();
    cut.sync(true, 1000, 700, NEW);
    const geometry = (cut.group.children[0] as THREE.Mesh).geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    cut.sync(true, 390, 844, NEW);
    expect(dispose).toHaveBeenCalled();
    expect(cut.group.children.length).toBe(0);
    expect(cut.shell).toBeNull();
    expect(load).toHaveBeenLastCalledWith('hub-cutaway-tall');
    await Promise.resolve();
    expect(cut.sync(true, 390, 844, NEW)).toBe(true);
    expect(cut.shell).toBe('tall');
  });

  it('ignores a file that arrives after the window changed shell, and stays off on a file that fails', async () => {
    let late!: (v: { scene: THREE.Object3D }) => void;
    const first = new Promise<{ scene: THREE.Object3D }>((resolve) => (late = resolve));
    const load = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(shell());
    const loaded = vi.fn();
    const cut = new Cutaway(load, loaded);
    cut.sync(true, 1000, 700, NEW);
    cut.sync(true, 390, 844, NEW); // the shell changed before the first file came
    late(shell());
    await Promise.resolve();
    await Promise.resolve();
    expect(loaded).toHaveBeenCalledTimes(1); // the tall one only
    expect(cut.shell).toBe('tall');
    const failing = new Cutaway(() => Promise.reject(new Error('404')), loaded);
    expect(failing.sync(true, 1000, 700, NEW)).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(failing.sync(true, 1000, 700, NEW)).toBe(false);
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when the file holds no part of the ship', async () => {
    const cut = new Cutaway(async () => ({ scene: file(node('Cube', null)) }), () => undefined);
    cut.sync(true, 1000, 700, NEW);
    await Promise.resolve();
    expect(cut.sync(true, 1000, 700, NEW)).toBe(false);
    expect(cut.group.children.length).toBe(0);
  });
});

describe('the exported files (#1689)', () => {
  const parse = async (name: string): Promise<THREE.Object3D> => {
    const bytes = await readFile(new URL(`../models/${name}.glb`, import.meta.url));
    return new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '', (gltf) => resolve(gltf.scene), reject));
  };

  it.each([['tall'], ['wide']] as const)('bakes the %s shell into one mesh in every state, within the triangle budget', async (layout) => {
    const scene = await parse(`hub-cutaway-${layout}`);
    const names = new Set<string>();
    scene.traverse((o) => (o as THREE.Mesh).isMesh && names.add(o.name));
    expect([...names].every((n) => partOf(n) !== null)).toBe(true); // every node is a part the game knows
    for (const st of [NEW, MID, LATE]) {
      const baked = bakeShip(scene, st)!;
      const tris = baked.geometry.getIndex()!.count / 3;
      expect(tris).toBeGreaterThan(2500);
      expect(tris).toBeLessThan(4400);
      expect(baked.hull.getSize(new THREE.Vector3()).x).toBeGreaterThan(5);
    }
    // the ten bosses beaten show their open door and seal, the others the shut one
    const lateTris = bakeShip(scene, LATE)!.geometry.getIndex()!.count;
    const newTris = bakeShip(scene, NEW)!.geometry.getIndex()!.count;
    expect(lateTris).not.toBe(newTris);
  });
  // #1728: a bay's node stands at its left corner in the file (its box spans x to x + 1): the marble stood on the bay's edge, half on the
  // next one. Every bay's marble point is the middle of its box, and the lift's foot the middle of the shaft, where the file's marble is.
  it.each([['tall'], ['wide']] as const)('puts the marble in the middle of every bay of the %s shell and of its lift shaft', async (layout) => {
    const scene = await parse(`hub-cutaway-${layout}`);
    const bays = baysOf(scene);
    expect(bays.length).toBeGreaterThan(30);
    for (const bay of bays) {
      const middle = bay.box.getCenter(new THREE.Vector3());
      expect(bay.x, `${bay.deck} ${bay.room}`).toBeCloseTo(middle.x, 3);
      expect(bay.y, `${bay.deck} ${bay.room}`).toBeCloseTo(bay.box.min.y, 3); // on its floor
    }
    let shaft = 0;
    let marble = 0;
    scene.traverse((o) => {
      if (/_shaft_/.test(o.name)) shaft = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).x;
      if (/_marble$/.test(o.name)) marble = o.getWorldPosition(new THREE.Vector3()).x;
    });
    expect(liftOf(scene)).toBeCloseTo(shaft, 2);
    expect(liftOf(scene)).toBeCloseTo(marble, 2);
  });
});

describe('the goal while the first win is awaited (#1692)', () => {
  it('is the House table, whatever goal is given; after it the given goal', () => {
    expect(shipState([], true, null).goal).toBe('bot');
    expect(shipState([], true, 'echo').goal).toBe('bot');
    expect(shipState([], false, 'echo').goal).toBe('echo');
  });
});
