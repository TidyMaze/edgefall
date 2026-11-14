// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { axialTo3D } from './board';
import { BOB_AMP, DRAFT } from './openworldboat';
import { hexLift, topOf } from './openworldview';
import { edgeSpot, peerColour, PeersLayer } from './worldpeersview';

describe('edgeSpot', () => {
  it('is inside when the point is on screen', () => {
    const spot = edgeSpot(0.2, -0.5, 0.5, 1);
    expect(spot.inside).toBe(true);
    expect(spot.left).toBeCloseTo(60, 5); // where it really is, not pushed to the margin
    expect(spot.top).toBeCloseTo(75, 5);
    expect(edgeSpot(1, -1, 0.5, 1).inside).toBe(true); // on the border still counts
  });

  it('puts a point off to the right on the right edge, arrow pointing right', () => {
    const s = edgeSpot(2, 0, 0.5, 1.5);
    expect(s.inside).toBe(false);
    expect(s.left).toBeCloseTo(94, 5); // margin 0.88 -> (0.88 + 1) / 2
    expect(s.top).toBeCloseTo(50, 5);
    expect(s.angle).toBeCloseTo(0, 5);
  });

  it('keeps the direction of a point above and to the left, the screen being wider than high', () => {
    const s = edgeSpot(-2, 1.5, 0.5, 2);
    expect(s.left).toBeCloseTo(6, 5); // both axes scaled by 0.88 / 2: x = -0.88, y = 0.66
    expect(s.top).toBeCloseTo(17, 5);
    // up and to the left on the screen: the angle points to the upper left, in CSS (y down) between -pi and -pi / 2
    expect(s.angle).toBeLessThan(-Math.PI / 2);
    expect(s.angle).toBeGreaterThan(-Math.PI);
  });

  it('a point behind the camera is mirrored, so its arrow points away from the view', () => {
    const s = edgeSpot(0.5, 0.2, 1.5, 1);
    expect(s.inside).toBe(false);
    expect(s.left).toBeLessThan(50);
    expect(s.top).toBeGreaterThan(50);
  });

  it('a point dead behind the centre points down', () => {
    const s = edgeSpot(0, 0, 2, 1);
    expect(s.inside).toBe(false);
    expect(s.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(s.top).toBeCloseTo(94, 5);
  });
});

function setup(wet: (q: number, r: number) => boolean = () => false) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 1000);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  const root = document.createElement('div');
  const tile = (q: number, r: number) => (Math.abs(q) > 20 || Math.abs(r) > 20 ? undefined : { terrain: wet(q, r) ? ('water' as const) : ('grass' as const), height: 1, biome: 'meadow' as const });
  const layer = new PeersLayer(scene, camera, { tile } as never, root);
  return { scene, camera, root, layer };
}

describe('PeersLayer emotes (#1671)', () => {
  it('shows the text of the emote index above a hero in view, as text, and clears it', () => {
    const { root, layer } = setup();
    const hero = { peer: 'a', cell: [1, 0] as [number, number], name: 'Ana', troop: [] };
    expect(layer.update([{ ...hero, say: 4 }], [0, 0])).toBe(true);
    const bubble = root.querySelector('.peer-say')!;
    expect(bubble.textContent).toBe('Duel?');
    expect(root.hidden).toBe(false);
    expect(root.dataset.say).toBe('Duel?');
    expect(layer.update([{ ...hero, say: 4 }], [0, 0])).toBe(false); // same: nothing to draw again
    expect(layer.update([{ ...hero, say: 99 }], [0, 0])).toBe(true); // an index out of the list shows nothing
    expect(root.querySelector('.peer-say')).toBeNull();
    layer.update([{ ...hero, say: 0 }], [0, 0]);
    layer.dispose();
    expect(root.dataset.say).toBeUndefined();
  });
});

describe('PeersLayer', () => {
  it('stands a marker on each peer in view and draws no edge indicator for it', () => {
    const { scene, root, layer } = setup();
    layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [] }], [0, 0]);
    const mesh = scene.getObjectByName('peers') as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(axialTo3D(1, 0).x, 5);
    expect(p.z).toBeCloseTo(axialTo3D(1, 0).z, 5);
    expect(p.y).toBeGreaterThan(0);
    expect(root.children).toHaveLength(0);
    expect(root.hidden).toBe(true);
  });

  it('shows an edge indicator with the distance in tiles for a peer out of view, and no marker on unloaded ground', () => {
    const { scene, root, layer } = setup();
    layer.update([{ peer: 'far', cell: [200, 0], name: '', troop: [] }], [0, 0]);
    expect((scene.getObjectByName('peers') as THREE.InstancedMesh).count).toBe(0); // no tile there: no marker
    expect(root.hidden).toBe(false);
    expect(root.children).toHaveLength(1);
    const edge = root.children[0] as HTMLElement;
    expect(edge.textContent).toContain('200');
    expect(edge.getAttribute('aria-label')).toBe('Another hero, 200 tiles away');
    expect(edge.style.left).not.toBe('');
  });

  it('names a hero: a tag over its marker in view, its name before the distance at the edge, and no tag when anonymous', () => {
    const { root, layer } = setup();
    layer.update(
      [
        { peer: 'a', cell: [1, 0], name: 'Ana', troop: [] },
        { peer: 'b', cell: [-1, 0], name: '', troop: [] },
        { peer: 'far', cell: [200, 0], name: 'Bob', troop: [] },
      ],
      [0, 0],
    );
    const tags = root.querySelectorAll('.peer-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toBe('Ana');
    expect((tags[0] as HTMLElement).style.left).toMatch(/%$/);
    const edge = root.querySelector('.peer-edge')!;
    expect(edge.textContent).toBe('Bob 200');
    expect(edge.getAttribute('aria-label')).toBe('Bob, 200 tiles away');
    expect(root.hidden).toBe(false);
    layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [] }], [0, 0]);
    expect(root.querySelectorAll('.peer-tag')).toHaveLength(0);
    expect(root.hidden).toBe(true);
    layer.update([{ peer: 'a', cell: [1, 0], name: 'Ana', troop: [] }], [0, 0]);
    expect(root.querySelectorAll('.peer-tag')).toHaveLength(1);
    layer.dispose();
    expect(root.querySelectorAll('.peer-tag')).toHaveLength(0);
  });

  it('lifts a marker that shares the hero\'s cell above it, so both show (spawn)', () => {
    const { scene, layer } = setup();
    const heightOf = (cell: [number, number], hero: [number, number]): number => {
      layer.update([{ peer: 'a', cell, name: '', troop: [] }], hero);
      const m = new THREE.Matrix4();
      (scene.getObjectByName('peers') as THREE.InstancedMesh).getMatrixAt(0, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    };
    const apart = heightOf([1, 0], [0, 0]);
    const shared = heightOf([0, 0], [0, 0]);
    expect(shared).toBeCloseTo(apart + 0.75 + hexLift(0, 0) - hexLift(1, 0), 5);
  });

  it('draws the troop of a hero as marbles in its colour, one mesh, and skips the cells on no loaded ground', () => {
    const { scene, layer } = setup();
    const mesh = scene.getObjectByName('peers') as THREE.InstancedMesh;
    layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [[2, 0], [1, 1], [300, 0]] }], [0, 0]);
    expect(mesh.count).toBe(3); // the hero and two marbles; the one at 300 has no tile
    const colour = (i: number) => {
      const c = new THREE.Color();
      mesh.getColorAt(i, c);
      return c.getHex();
    };
    expect(new Set([colour(0), colour(1), colour(2)]).size).toBe(1);
    layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [] }, { peer: 'b', cell: [-1, 0], name: '', troop: [] }], [0, 0]);
    expect(colour(0)).not.toBe(colour(1)); // another hero, another colour
    expect(colour(0)).toBe(peerColour('a').getHex());
  });

  it('draws nothing for nobody, and tags and arrows wear the colour of their hero', () => {
    const { scene, root, layer } = setup();
    expect(layer.update([], [0, 0])).toBe(false);
    expect((scene.getObjectByName('peers') as THREE.InstancedMesh).count).toBe(0);
    layer.update([{ peer: 'a', cell: [1, 0], name: 'Ana', troop: [] }, { peer: 'b', cell: [200, 0], name: '', troop: [] }], [0, 0]);
    const hex = (peer: string) => `#${peerColour(peer).getHexString()}`;
    expect((root.querySelector('.peer-tag') as HTMLElement).style.color).toBe(new THREE.Color(hex('a')).getStyle().replace(/,/g, ', '));
    expect((root.querySelector('.peer-edge') as HTMLElement).style.color).toBe(new THREE.Color(hex('b')).getStyle().replace(/,/g, ', '));
  });

  it('draws at most MAX_PEERS heroes with a full troop each: one capacity, no growth', () => {
    const { scene, layer } = setup();
    const six: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    const peers = Array.from({ length: 20 }, (_, i) => ({ peer: `p${i}`, cell: [i - 10, 3] as [number, number], name: '', troop: six.map(([dq, dr]): [number, number] => [i - 10 + dq, 3 + dr]) }));
    layer.update(peers, [0, 0]);
    expect((scene.getObjectByName('peers') as THREE.InstancedMesh).count).toBeLessThanOrEqual(140);
  });

  it('counts heroes, not marbles, in the page mark, and lifts a marble that shares a cell with our own troop', () => {
    const { root, scene, layer } = setup();
    layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [[2, 0], [3, 0]] }], [0, 0], [[0, 0], [2, 0]]);
    expect(root.dataset.peers).toBe('1');
    expect(root.dataset.marbles).toBe('3'); // the hero and its two marbles
    expect(root.dataset.armies).toBe('a:3'); // as received, in view or not
    const m = new THREE.Matrix4();
    const y = (i: number) => {
      (scene.getObjectByName('peers') as THREE.InstancedMesh).getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    };
    expect(y(1)).toBeCloseTo(y(2) + 0.75 + hexLift(2, 0) - hexLift(3, 0), 5); // (2, 0) is one of ours: lifted; (3, 0) is not
  });

  it('says one tile in the singular, reuses its elements, and drops the ones it no longer needs', () => {
    const { root, layer } = setup();
    layer.update([{ peer: 'a', cell: [0, -25], name: '', troop: [] }], [0, -24]);
    expect(root.children[0]!.getAttribute('aria-label')).toBe('Another hero, 1 tile away');
    const first = root.children[0];
    layer.update(
      [
        { peer: 'a', cell: [0, -25], name: '', troop: [] },
        { peer: 'b', cell: [200, 0], name: '', troop: [] },
      ],
      [0, -24],
    );
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toBe(first);
    layer.update([], [0, 0]);
    expect(root.children).toHaveLength(0);
    expect(root.hidden).toBe(true);
  });

  it('writes the page marks the browser checks read, and frees the marker and the indicators on dispose', () => {
    const { scene, root, layer } = setup();
    layer.update(
      [
        { peer: 'a', cell: [1, 0], name: '', troop: [] },
        { peer: 'b', cell: [200, 0], name: '', troop: [] },
      ],
      [0, 0],
    );
    expect(root.dataset.peers).toBe('2');
    expect(root.dataset.edges).toBe('200');
    layer.dispose();
    expect(scene.getObjectByName('peers')).toBeUndefined();
    expect(root.children).toHaveLength(0);
    expect(root.hidden).toBe(true);
    expect(root.dataset.peers).toBeUndefined();
    expect(root.dataset.marbles).toBeUndefined();
    expect(root.dataset.armies).toBeUndefined();
  });

  it('reports a change of what it draws, and none when the same list comes again', () => {
    const { layer } = setup();
    expect(layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [] }], [0, 0])).toBe(true);
    expect(layer.update([{ peer: 'a', cell: [1, 0], name: '', troop: [] }], [0, 0])).toBe(false);
    expect(layer.update([{ peer: 'a', cell: [2, 0], name: '', troop: [] }], [0, 0])).toBe(true);
  });

  describe('boats', () => {
    const wet = (q: number) => q >= 1;
    const peer = (cell: [number, number], troop: [number, number][] = []) => [{ peer: 'a', cell, name: '', troop }];
    const boats = (scene: THREE.Scene) => scene.getObjectByName('peer-boats') as THREE.InstancedMesh;
    const at = (mesh: THREE.InstancedMesh, i: number) => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      return new THREE.Vector3().setFromMatrixPosition(m);
    };

    it('floats a boat under a hero and a troop marble on water, and none under one on land', () => {
      const { scene, root, layer } = setup(wet);
      layer.update(peer([1, 0], [[0, 0], [2, 0]]), [5, 5]);
      expect(boats(scene).count).toBe(2);
      expect(root.dataset.boats).toBe('2'); // for the browser checks
      const p = at(boats(scene), 0);
      expect(p.x).toBeCloseTo(axialTo3D(1, 0).x, 5);
      expect(p.y).toBeCloseTo(topOf('water', 0, 0, 0) - DRAFT, 5);
      expect(at(boats(scene), 1).x).toBeCloseTo(axialTo3D(2, 0).x, 5);
      layer.update(peer([0, 0]), [5, 5]);
      expect(boats(scene).count).toBe(0);
    });

    it('bobs with the time given, and holds still without it', () => {
      const { scene, layer } = setup(wet);
      layer.update(peer([1, 0]), [5, 5], [[5, 5]], 650); // a quarter of the period 2600 ms: the top of the bob
      expect(at(boats(scene), 0).y).toBeCloseTo(topOf('water', 0, 0, 0) - DRAFT + BOB_AMP, 3);
      layer.update(peer([1, 0]), [5, 5], [[5, 5]], null);
      expect(at(boats(scene), 0).y).toBeCloseTo(topOf('water', 0, 0, 0) - DRAFT, 5);
    });

    it('turns the boat to the way its hero went, and keeps it when the hero stays', () => {
      const { scene, layer } = setup(wet);
      const yaw = () => new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(rotationOf(boats(scene)))).y;
      layer.update(peer([1, 0]), [5, 5]);
      const first = yaw();
      layer.update(peer([1, 1]), [5, 5]);
      expect(yaw()).not.toBeCloseTo(first, 2);
      const turned = yaw();
      layer.update(peer([1, 1]), [5, 5]);
      expect(yaw()).toBeCloseTo(turned, 5);
    });

    it('frees the boats on dispose', () => {
      const { scene, root, layer } = setup(wet);
      layer.update(peer([1, 0]), [5, 5]);
      layer.dispose();
      expect(boats(scene)).toBeUndefined();
      expect(root.dataset.boats).toBeUndefined();
    });
  });
});

function rotationOf(mesh: THREE.InstancedMesh): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  return new THREE.Matrix4().extractRotation(m);
}
