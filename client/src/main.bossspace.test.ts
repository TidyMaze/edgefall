// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, startBoss } from './test/harness';
import { ACT_SPACE, BOSS_SPACE } from './bossspace';
import { LEGACY_UNLOCKED } from './collector';
import { newRun } from './roguelite';
import { NEON_LIGHT } from './neonlook';
import { TERRACE_LOOK } from './boardlook';

// A boss fight is drawn in its own space (#1551): the sun of its row of the table, on both looks, and the arena light on a page with no fight.

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
const sun = (scene: THREE.Scene): THREE.DirectionalLight => scene.getObjectsByProperty('isDirectionalLight', true)[0] as THREE.DirectionalLight;
const fight = (name: string): void => {
  startBoss(name);
};

describe('main.ts boss spaces (#1551)', () => {
  for (const [look, arena] of [['', NEON_LIGHT.sun], ['&look=terrace', TERRACE_LOOK.sun]] as const) {
    it(`The Hull lights its fight with its own sun${look ? ' on the terrace look' : ''}, the page keeping the arena light before it`, async () => {
      const scene = catchScene();
      const game = await boot(`?bot=off${look}`, { reducedMotion: true });
      expect(sun(scene()).color.getHex()).toBe(arena);
      fight('The Hull');
      await vi.waitFor(() => expect(document.body.dataset.boss).toBe('hull'));
      expect(sun(scene()).color.getHex()).toBe(BOSS_SPACE.hull!.sun);
    });
  }

  // Seed 3: boss 9 ends act 1 (nodes 0, 2, 6 lead to it) and node 10 is the first fight of act 2 (roguelite-biomes.spec.ts).
  const run = (path: number[], extra: object = {}) => ({ ...newRun(3, 3, LEGACY_UNLOCKED), enemies: true, exits: true, path, fighting: true, ...extra });

  it('lights a fight of a run with the space of its act, a boss of the run with its own, and the page with the arena light before and after (#1551)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    expect(sun(scene()).color.getHex()).toBe(NEON_LIGHT.sun);
    await game.hook('__run', run([0, 2, 6, 9, 10], { biomes: [1] })); // act 2, the Forest
    expect(document.body.dataset.space).toBe('forest');
    expect(sun(scene()).color.getHex()).toBe(ACT_SPACE.forest!.sun);
    await game.hook('__run', run([0, 2, 6, 9, 10], { biomes: [4] })); // saved in another biome: reloaded as that one
    expect(sun(scene()).color.getHex()).toBe(ACT_SPACE.badlands!.sun);
    await game.hook('__run', run([0, 2, 6], { exits: false })); // a run saved before the exits: act 1, the Meadow
    expect(document.body.dataset.space).toBe('meadow');
    expect(sun(scene()).color.getHex()).toBe(ACT_SPACE.meadow!.sun);
    await game.hook('__run', run([0, 2, 6, 9])); // the boss of act 1
    expect(document.body.dataset.space).toBe(document.body.dataset.boss);
    expect(sun(scene()).color.getHex()).toBe(BOSS_SPACE[document.body.dataset.boss!]!.sun);
    game.hook('__deck', 'mess'); // a game that is not a run's
    expect(document.body.dataset.space).toBeUndefined();
    expect(sun(scene()).color.getHex()).toBe(NEON_LIGHT.sun);
  });
});
