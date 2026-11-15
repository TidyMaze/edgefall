// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, startBoss } from './test/harness';
import { deckPropGeometry } from './deckprop';

// The page draws the prop of the deck in play on the arena (#1551): the Hull's Cargo crane in its fight, the Mess's hoods at the table,
// none in the hub, none in the room.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && !scene) scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}
/** The positions of a prop's mesh: the page has its own copy of the module, so the geometry is compared by its points. */
const shape = (mesh: THREE.Mesh): number[] => [...mesh.geometry.attributes.position!.array];
const prop = (scene: THREE.Scene): THREE.Mesh => scene.getObjectByName('deck-prop') as THREE.Mesh;
const fight = (name: string): void => {
  startBoss(name);
};

describe('main.ts deck props (#1551)', () => {
  it('draws the Mess prop at the table and the Cargo prop in The Hull fight', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    await vi.waitFor(() => expect(prop(scene()).visible).toBe(true));
    expect(shape(prop(scene()))).toEqual([...deckPropGeometry('mess').attributes.position!.array]);
    expect(document.body.dataset.deckProp).toBe('true');
    fight('The Hull');
    await vi.waitFor(() => expect(shape(prop(scene()))).toEqual([...deckPropGeometry('cargo').attributes.position!.array]));
    expect(prop(scene()).visible).toBe(true);
  });

  it('draws none in the room', async () => {
    const scene = catchScene();
    await boot('?bot=off&scene=room', { reducedMotion: true });
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('room'));
    expect(prop(scene()).visible).toBe(false);
  });
});
