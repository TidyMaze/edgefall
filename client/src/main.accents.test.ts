// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { ACCENTS } from './marbles';
import { boot, type Game, startBoss } from './test/harness';

// The boss accents of main.ts (#507): in boss mode the shells of the boss side wear their boss's accent (marbles.ts), a
// child mesh kept upright on the shell whatever its turn, through every palette, safe mode and clear board. The scene
// the page draws is caught when main.ts builds it, so a test reads what the renderer would draw.

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
type Worn = { cell: Axial; accent: string };
const byId = (id: string): HTMLElement => document.getElementById(id)!;

/** Catches the scene main.ts builds: call before boot. */
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

/** Starts the fight against `name` from the mode menu. */
function fightBoss(game: Game, name: string): void {
  startBoss(name);
}

/** The accent meshes drawn in the scene. */
const accents = (scene: THREE.Scene): Mesh[] =>
  Object.values(ACCENTS).flatMap((a) => scene.getObjectsByProperty('name', a.name) as Mesh[]);

/** True when `mesh` faces the world the way it was built: no turn left on it once its parents' turns are applied. */
const upright = (mesh: THREE.Object3D): boolean => {
  mesh.updateWorldMatrix(true, false);
  return mesh.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion()) < 1e-6;
};

describe('main.ts boss accents (#507)', () => {
  it.each([
    ['The Hull', 'hull', 'crown', 14],
    ['The Chaplain', 'chaplain', 'wax', 14],
    ['The Ballast Mind', 'ballast', 'wire', 16], // #564
  ])('against %s every shell of the boss side wears its accent, the glass none', async (name, id, accent, shells) => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    fightBoss(game, name);
    const worn = game.hook<Worn[]>('__accents');
    expect(worn).toHaveLength(shells);
    expect(new Set(worn.map((w) => w.accent))).toEqual(new Set([accent]));
    const drawn = accents(scene());
    expect(drawn).toHaveLength(shells);
    for (const mesh of drawn) {
      expect(mesh.parent).toBeInstanceOf(THREE.Mesh);
      expect((mesh.parent as Mesh).material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial); // a shell, not the glass
      expect(mesh.material.color.getHex()).toBe(ACCENTS[id]!.color);
    }
  });

  it('against The Hull on the terrace the boss side keeps the plain shell: the cracking cell is the tell (#1374)', async () => {
    const game = await boot('?bot=off');
    fightBoss(game, 'The Hull');
    expect(game.hook('__accents')).toEqual([]);
  });

  it('The Echo, The Choir and a game outside boss mode keep the plain shell', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    expect(game.hook('__accents')).toEqual([]);
    for (const name of ['The Echo', 'The Choir']) {
      fightBoss(game, name);
      expect(game.hook('__accents'), name).toEqual([]);
    }
    expect(accents(scene())).toEqual([]);
  });

  it('stays upright on its shell whatever the shell turn, at rest and while the shell rolls', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    fightBoss(game, 'The Hull');
    const drawn = accents(scene());
    expect(drawn.every(upright)).toBe(true);
    expect(drawn.some((mesh) => !upright(mesh.parent!))).toBe(true); // the shells themselves are turned
    // ?bot=off plays both sides: the player's first legal step, then the boss side's, which rolls a shell.
    for (const roll of [2000, 50]) {
      game.click(...game.hook<{ cells: Axial[] }[]>('__legal').find((m) => m.cells.length === 1)!.cells[0]!);
      game.click(...game.hook<{ cell: Axial }[]>('__targets')[0]!.cell);
      game.frame(roll);
    }
    expect(document.body.dataset.sliding).toBe('1'); // mid-slide
    const rolling = accents(scene());
    expect(rolling).toHaveLength(14);
    expect(rolling.every(upright)).toBe(true);
    game.frame(2000);
    expect(document.body.dataset.sliding).toBeUndefined();
    expect(accents(scene()).every(upright)).toBe(true);
  });

  it('survives every palette, safe mode off, clear board on and a new shell skin, never drawn on a ghost', async () => {
    const scene = catchScene();
    const booting = boot('?bot=off');
    localStorage.setItem('ab-alone.safe-mode', 'off');
    localStorage.setItem('ab-alone.clear-board', 'on');
    const game = await booting;
    expect(document.body.dataset.clear).toBe('on');
    fightBoss(game, 'The Chaplain');
    const wax = ACCENTS.chaplain!.color;
    game.openSettings();
    for (let i = 0; i < 5; i++) {
      byId('setting-palette').click();
      expect(game.hook<Worn[]>('__accents'), game.hook('__palette')).toHaveLength(14);
      expect(accents(scene()).every((mesh) => mesh.material.color.getHex() === wax)).toBe(true);
    }
    byId('setting-shell-skin').click();
    expect(game.hook<Worn[]>('__accents')).toHaveLength(14);
    // A hovered move draws its ghosts plain: no accent on the ghost layer.
    const [q, r] = game.hook<{ cells: Axial[] }[]>('__legal')[0]!.cells[0]!;
    game.click(q, r);
    const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', ...game.hook<{ cell: Axial }[]>('__targets')[0]!.cell);
    document.querySelector('body > canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    expect(Number(document.body.dataset.ghosts)).toBeGreaterThan(0);
    expect(accents(scene())).toHaveLength(14);
  });
});
