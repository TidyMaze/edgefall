// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, startBoss } from './test/harness';
import { BOSS_PROPS, bossProp } from './bossprops';

// The terrace wears the kit prop of the boss in the fight (coverage.md rows 5 to 17, #1374): one mesh, off the dish, none for
// a boss that has no piece here, none in the room, none outside a fight.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const names = ['The Echo', 'The Hull', 'The Alien', 'The Choir', 'The Magnetizer', 'The Unstable Core', 'The Chaplain', 'The Stalker', 'The Swarm'];

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
const props = (scene: THREE.Scene): THREE.Object3D[] => scene.getObjectsByProperty('name', 'boss-prop');
const fight = (name: string): void => {
  startBoss(name);
};

describe('main.ts boss props (#1374)', () => {
  it('has a test for every boss of the kit and The Pulsar', () => {
    expect(names).toHaveLength(Object.keys(BOSS_PROPS).length);
  });

  // One page boot per fight, one test per fight: a single test of all twenty boots ran into the 30 s timeout on a loaded machine (#1628).
  for (const [look, expected] of [['', 1], ['&scene=room', 0]] as const) {
    for (const name of [...names, 'The Pulsar']) {
      it(`${name} ${look ? 'in the room' : 'on the terrace'}: ${name === 'The Pulsar' || !expected ? 'no prop' : 'one prop of the kit'}${look === '' && name === 'The Echo' ? ', on its spot' : ''}`, async () => {
        const scene = catchScene();
        const game = await boot(`?bot=off${look}`, { reducedMotion: true });
        expect(props(scene())).toHaveLength(0); // no fight, no prop
        fight(name);
        await vi.waitFor(() => expect(document.body.dataset.scene).toBe(look ? 'room' : 'table-zero'));
        if (name === 'The Pulsar') await vi.waitFor(() => expect(scene().getObjectsByProperty('name', 'pulsar')).toHaveLength(6)); // the kit file came
        else if (expected) await vi.waitFor(() => expect(props(scene())).toHaveLength(1)); // the kit file comes and redraws the board
        expect(props(scene())).toHaveLength(name === 'The Pulsar' ? 0 : expected);
        if (name === 'The Echo' && look === '') {
          const spot = bossProp('echo')!;
          expect([props(scene())[0]!.position.x, props(scene())[0]!.position.z]).toEqual([spot.x, spot.z]);
        }
      });
    }
  }
});
