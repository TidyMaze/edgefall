// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { encodeMove, groupTargets, moveForClick, parseMoves, type Axial } from './board';
import { RIM_LIGHT } from './frame';
import { GLASS_SKINS } from './glassskins';
import { DEFAULT_SKIN, SKINS, skinById } from './skins';
import { generateKeys } from './moverecord';
import { OnlineSession } from './session';
import { BOSS_IDS } from './tally';
import { boot, type Game, startBoss as startBossById } from './test/harness';

// The board drawing and the HUD of main.ts (#451): the materials and skins, the steel frame and its rim light, the
// boss phase notches, the tally marks, refresh, the ghosts and the HUD plate, with their browser hooks. The scene the
// page draws is caught when main.ts builds it, so a test reads what the renderer would draw.

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** Catches the scene main.ts builds: call before boot. */
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && this.name === 'edgefall-scene') scene = this;
    else if (this instanceof THREE.Scene && !scene) scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}

/** The parts of the drawn scene: the groups follow the steel frame (plate, near rim, far rim) in the order main.ts
 * adds them. */
function parts(scene: THREE.Scene) {
  const meshes = scene.children.filter((c): c is Mesh => c instanceof THREE.Mesh);
  const [plate, near, far] = meshes.filter((m) => m.geometry instanceof THREE.ExtrudeGeometry);
  const at = scene.children.indexOf(far!);
  const [notches, tally1, tally2, marbles, ghosts] = scene.children.slice(at + 1, at + 6) as THREE.Group[];
  const discs = meshes.filter((m) => m.geometry instanceof THREE.CylinderGeometry && !(m instanceof THREE.InstancedMesh));
  const spheres = (group: THREE.Object3D): Mesh[] =>
    group.children.filter((c): c is Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry);
  return {
    plate: plate!,
    near: near!,
    far: far!,
    notches: notches!,
    tallies: [tally1!, tally2!],
    marbles: marbles!,
    ghosts: ghosts!,
    discs,
    spheres,
  };
}

/** The marbles drawn on the board: the shells (MeshStandardMaterial) or the glass (MeshPhysicalMaterial). */
const isGlass = (m: Mesh): boolean => m.material instanceof THREE.MeshPhysicalMaterial;
function drawn(scene: THREE.Scene): { shells: Mesh[]; glass: Mesh[] } {
  const { marbles, spheres } = parts(scene);
  return { shells: spheres(marbles).filter((m) => !isGlass(m)), glass: spheres(marbles).filter(isGlass) };
}

/** Plays one move of the side to move by two clicks: the marble on `from` (the first single-marble move when none)
 * one step toward `to` (its first target when none). Returns the two cells. The slide ends before it returns. */
function step(game: Game, from?: Axial, to?: Axial): [Axial, Axial] {
  const cell = from ?? game.hook<{ cells: Axial[] }[]>('__legal').find((m) => m.cells.length === 1)!.cells[0]!;
  game.click(...cell);
  const target = to ?? game.hook<{ cell: Axial }[]>('__targets')[0]!.cell;
  game.click(...target);
  game.frame(2000);
  return [cell, target];
}

type Play = (from?: Axial, to?: Axial) => Promise<[Axial, Axial]>;

/** Plays a marble of each side out and back twice: the start position comes back a third time, a draw. */
async function repeat(black: Play, white: Play): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const [b, bt] = await black();
    const [w, wt] = await white();
    await black(bt, b);
    await white(wt, w);
  }
}
const both = (game: Game): Play => async (from, to) => step(game, from, to);

function setting(id: string): void {
  document.getElementById(`setting-${id}`)!.click();
}

/** Moves the pointer over a cell of the board, or off it when `cell` is null. */
function hoverOver(game: Game, cell: Axial | null): void {
  const { x, y } = cell ? game.hook<{ x: number; y: number }>('__cellToScreen', ...cell) : { x: 1, y: 1 };
  document.querySelector('body > canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
}

/** Lets the page work until `done` holds: crypto and the bot answer on later tasks. */
async function until(game: Game, done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await game.settle();
  expect(done()).toBe(true);
}

describe('main.ts board and HUD', () => {
  it('has no light of its own at the scene root: the room\'s tubes and lamps light it, and no bar hangs behind the north wall (#876, #877)', async () => {
    const scene = catchScene();
    await boot('?bot=off');
    expect(scene().children.filter((c) => c instanceof THREE.Light)).toEqual([]);
    expect(scene().children.some((c) => c instanceof THREE.Group && c.children.length > 0 && c.children.every((m) => m.position.z === -23.2))).toBe(false);
  });

  it('draws the 169 cells and their bevels with 2 instanced meshes, the discs kept for picking only (#885)', async () => {
    const scene = catchScene();
    await boot('?bot=off&look=terrace'); // the terrace's mesh count: the neon look draws its own board (#1424)
    const drawn = scene().children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.geometry.type !== 'SphereGeometry');
    expect(drawn.map((m) => [m.count, m.geometry.type])).toEqual([[169, 'CylinderGeometry'], [169, 'TorusGeometry']]);
    const { discs } = parts(scene());
    expect(drawn[0]!.material).toBe(discs[0]!.material);
    const camera = new THREE.Camera();
    expect(discs.some((d) => d.layers.test(camera.layers))).toBe(false); // the camera draws the instances, not the discs
  });

  it('draws the 14 shells and the 14 glass marbles with one instanced mesh each, where the marbles stand (#885)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    game.frame();
    const { shells, glass } = drawn(scene());
    const instanced = scene().children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.visible && c.geometry.type === 'SphereGeometry');
    expect(instanced.map((m) => [m.material, m.count])).toEqual(expect.arrayContaining([[shells[0]!.material, 14], [glass[0]!.material, 14]]));
    expect(instanced).toHaveLength(2);
    const camera = new THREE.Camera();
    expect([...shells, ...glass].some((m) => m.layers.test(camera.layers))).toBe(false);
  });

  it('dresses the cells, the frame and the enemy shells in the loaded textures, and the glass', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    await game.settle(); // the skins' maps load after the first frame
    const { discs, plate, near } = parts(scene());
    expect(discs).toHaveLength(169); // the 61, then ring 5 for The Ballast Mind (#564), rings 6 and 7 for The Dual Room (#947, #955)
    expect(discs.filter((d) => d.visible)).toHaveLength(61);
    expect(discs[0]!.material.map).toBeInstanceOf(THREE.Texture);
    expect(discs[0]!.material.normalMap).toBeInstanceOf(THREE.Texture);
    // The cell beds keep the deck texture's own colour and stay matte: a dark metal tint turned them black, and the
    // marbles no longer read 3:1 against them (#787).
    expect(discs[0]!.material.color.getHex()).toBe(0xffffff);
    expect(discs[0]!.material.metalness).toBe(0);
    expect(plate.material.map).toBeInstanceOf(THREE.Texture);
    expect(near.material.map).toBeInstanceOf(THREE.Texture);
    const { shells, glass } = drawn(scene());
    expect([shells.length, glass.length]).toEqual([14, 14]);
    // The default skins wear their ambientCG maps, tiled round the sphere, the albedo in sRGB, in their own colours.
    const leather = shells[0]!.material;
    expect([leather.map, leather.normalMap, leather.roughnessMap].map((t) => t?.name)).toEqual([
      'skin-Leather027-albedo.ktx2', 'skin-Leather027-normal.ktx2', 'skin-Leather027-roughness.ktx2',
    ]);
    expect(leather.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(leather.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(leather.map!.wrapS).toBe(THREE.RepeatWrapping);
    const { tile } = skinById(DEFAULT_SKIN);
    expect(leather.map!.repeat.toArray()).toEqual([tile, tile / 2]);
    expect(glass[0]!.material.map?.name).toBe('skin-Marble025-albedo.ktx2');
    expect(shells[0]!.children).toHaveLength(0);
    expect(glass[0]!.children).toHaveLength(0); // no core: the opaque sphere would hide it (#885)
  });

  it('wears every map its asset ships on each of the 20 skins, in its own colours, opaque', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    game.openSettings();
    // What each ambientCG zip ships besides colour, normal and roughness (displacement is skipped: the normal map carries the relief).
    const shipped: Record<string, string[]> = {
      Lava002: ['emission'], Lava001: ['emission'], Fabric004: ['metalness'], Metal027: ['metalness'], Metal028: ['metalness'],
      Rock025: ['ao'], Styrofoam004: ['ao'],
    };
    const slots = { albedo: 'map', normal: 'normalMap', roughness: 'roughnessMap', metalness: 'metalnessMap', ao: 'aoMap', emission: 'emissiveMap' } as const;
    for (const [side, skins, mesh] of [
      ['shell', SKINS, () => drawn(scene()).shells[0]!],
      ['glass', GLASS_SKINS, () => drawn(scene()).glass[0]!],
    ] as const) {
      for (const skin of skins) {
        await game.settle();
        const m = mesh().material;
        const kinds = ['albedo', 'normal', 'roughness', ...shipped[skin.asset] ?? []];
        expect(kinds, skin.id).toEqual(['albedo', 'normal', 'roughness', ...skin.extra]);
        for (const [kind, slot] of Object.entries(slots)) {
          const texture = m[slot as keyof typeof m] as THREE.Texture | null;
          expect(texture?.name, `${skin.id} ${slot}`).toBe(kinds.includes(kind) ? `skin-${skin.asset}-${kind}.ktx2` : undefined);
          if (texture) expect(texture.colorSpace, `${skin.id} ${slot}`).toBe(kind === 'albedo' || kind === 'emission' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
        }
        expect(m.color.getHex(), skin.id).toBe(0xffffff);
        expect(m.metalness, skin.id).toBe(kinds.includes('metalness') ? 1 : 0);
        if (kinds.includes('emission')) expect([m.emissive.getHex(), m.emissiveIntensity], skin.id).toEqual([0xffffff, 1]);
        expect([m.transparent, m.opacity, m.depthWrite], skin.id).toEqual([false, 1, true]);
        setting(`${side}-skin`);
      }
    }
  });

  it('keeps the flat colour where a skin map is missing, the maps that loaded still on', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room', { missing: ['skin-Leather027-normal.ktx2'] });
    await game.settle();
    const { material } = drawn(scene()).shells[0]!;
    expect(material.normalMap).toBeNull();
    expect(material.map?.name).toBe('skin-Leather027-albedo.ktx2');
  });

  it('leaves the skins their own colours under a colour-blind palette', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    game.openSettings();
    setting('palette'); // Protan
    const { shells, glass } = drawn(scene());
    expect([shells[0]!.material.color.getHex(), glass[0]!.material.color.getHex()]).toEqual([0xffffff, 0xffffff]);
  });

  it('draws The Ballast Mind on its radius 5 board (#564): 85 discs round six void pillars, a frame of radius 5', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&look=terrace'); // the terrace's discs and pillars: the neon look draws its own board (#1424)
    const shown = (): number => parts(scene()).discs.filter((d) => d.visible).length;
    startBossById('ballast');
    expect(shown()).toBe(85);
    expect(game.hook('__frame')).toMatchObject({ radius: 5, holes: 6 });
    const { shells, glass } = drawn(scene());
    expect(shells.length + glass.length).toBe(32); // 16 each (#838)
    // A marble of ring 5 moves by two clicks, like any other.
    const ring5 = game.hook<{ cells: Axial[] }[]>('__legal').find((m) => m.cells.length === 1 && Math.abs(m.cells[0]![0]) === 5)!;
    step(game, ring5.cells[0]);
    expect(game.hook('__plies')).toBe(1);
    startBossById('echo'); // back on 61 cells, ring 5 hides again
    expect(shown()).toBe(61);
    expect(game.hook('__frame')).toMatchObject({ radius: 4, holes: 0 });
  });

  it('swaps the cells normal map with the albedo on a deck change (#440)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    const { discs } = parts(scene());
    const initialNormal = discs[0]!.material.normalMap;
    expect(initialNormal).toBeInstanceOf(THREE.Texture);
    game.hook('__deck', 'cargo');
    await vi.waitFor(() => expect(discs[0]!.material.normalMap).not.toBe(initialNormal));
    expect(discs[0]!.material.normalMap).toBeInstanceOf(THREE.Texture);
  });

  it('disables airborne particles under automation by default (#443)', async () => {
    const scene = catchScene();
    await boot('?bot=off', { webdriver: true });
    const points = scene().children.find((c): c is THREE.Points => c instanceof THREE.Points);
    expect(points?.visible ?? false).toBe(false);
  });

  it('draws airborne particles outside the board volume per deck, off under clear board (#443)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { webdriver: false });
    const points = scene().children.find((c): c is THREE.Points => c instanceof THREE.Points)!;
    expect(points).toBeDefined();
    expect(points.visible).toBe(true);

    // Every particle position is outside the board volume (never over a cell or marble)
    const pos = points.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      expect(dist >= 5.0 || y > 2.0 || y < -0.3, `particle ${i} at (${x}, ${y}, ${z}) inside board`).toBe(true);
    }

    // Switching to Bridge (which has 0 particles): visible becomes false
    game.hook('__deck', 'bridge');
    await vi.waitFor(() => expect(points.visible).toBe(false));

    // Switching back to Mess: visible becomes true
    game.hook('__deck', 'mess');
    await vi.waitFor(() => expect(points.visible).toBe(true));

    // Toggling clear board: particles turn off
    game.openSettings();
    document.getElementById('setting-clear-board')!.click();
    await vi.waitFor(() => expect(points.visible).toBe(false));
  });

  it('keeps the flat steel look when the textures fail to load', async () => {
    // A texture made by the loader cannot take its colour space: the load fails as a missing file would.
    onTestFinished(() => void Reflect.deleteProperty(THREE.Texture.prototype, 'colorSpace'));
    Object.defineProperty(THREE.Texture.prototype, 'colorSpace', {
      configurable: true,
      set(value: string) {
        if (new Error().stack!.includes('loadAsync')) throw new Error('no such file');
        Object.defineProperty(this, 'colorSpace', { value, writable: true, configurable: true, enumerable: true });
      },
    });
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    const { discs, plate, near } = parts(scene());
    expect(discs[0]!.material.map).toBeNull();
    expect(discs[0]!.material.normalMap).toBeNull();
    expect(discs[0]!.material.color.getHex()).toBe(0x4a5258);
    expect(plate.material.map).toBeNull();
    expect(near.material.map).toBeNull();
    expect(drawn(scene()).shells[0]!.material.normalMap).toBeNull();
    expect(game.hook('__frame')).toMatchObject({ drawn: true });
  });

  it('dresses the Black shells in the next skin at each press, its maps loaded when worn, a lava lit, a seen skin reused', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    const black = (): Mesh => drawn(scene()).shells[0]!;
    const scarab = black().material;
    game.openSettings();
    setting('shell-skin'); // Black porcelain
    expect(black().material).not.toBe(scarab);
    expect(black().material.map).toBeNull(); // flat until its maps arrive
    await game.settle();
    expect(black().material.map?.name).toBe('skin-Porcelain003-albedo.ktx2');
    expect(black().material.emissiveMap).toBeNull();
    setting('shell-skin'); // Lava is lit by its emission map
    await game.settle();
    expect(black().material.emissiveMap?.name).toBe('skin-Lava002-emission.ktx2');
    expect(black().material.emissive.getHex()).toBe(0xffffff);
    for (let i = 0; i < 8; i++) setting('shell-skin'); // round to Leather
    expect(black().material).toBe(scarab);
    setting('shell-skin');
    const obsidian = black().material;
    for (let i = 0; i < 10; i++) setting('shell-skin');
    expect(black().material).toBe(obsidian);
  });

  it('dresses the White marbles in the next white skin at each press, its maps loaded when worn, a seen skin reused', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    const white = (): Mesh => drawn(scene()).glass[0]!; // local play: White wears the glass
    const marble = white().material;
    game.openSettings();
    setting('glass-skin'); // Terracotta
    expect(white().material).not.toBe(marble);
    expect(white().material.map).toBeNull(); // flat until its maps arrive
    await game.settle();
    expect(white().material.map?.name).toBe('skin-GlazedTerracotta003-albedo.ktx2');
    expect(white().material.normalMap?.name).toBe('skin-GlazedTerracotta003-normal.ktx2');
    for (let i = 0; i < 9; i++) setting('glass-skin'); // round to Marble
    expect(white().material).toBe(marble);
  });

  it('puts no core in the glass marbles: their opaque skin hides it, and each was a draw call (#885)', async () => {
    const scene = catchScene();
    await boot('?nodes=100');
    const { glass } = drawn(scene());
    expect(glass.length).toBeGreaterThan(0);
    for (const marble of glass) expect(marble.children).toHaveLength(0);
  });

  it('draws the frame round the board and lights the rim at the end of the side to move', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    expect(game.hook('__frame')).toEqual({ radius: 4, holes: 0, drawn: true, lit: { near: RIM_LIGHT.shell, far: 0 } });
    expect(document.body.dataset.rim).toBe('near');
    const before = parts(scene()).plate.geometry;
    step(game);
    expect(game.hook('__frame')).toMatchObject({ lit: { near: 0, far: RIM_LIGHT.glass } });
    expect(document.body.dataset.rim).toBe('far');
    expect(parts(scene()).plate.geometry).toBe(before); // the same board: the frame is not rebuilt
  });

  it('puts the rim light out and shows the end banner once the game is drawn', async () => {
    const game = await boot('?bot=off');
    expect(document.body.dataset.over).toBeUndefined();
    await repeat(both(game), both(game));
    expect(document.body.dataset.over).toBe('draw');
    expect(document.body.dataset.rim).toBe('off');
    expect(game.hook('__frame')).toMatchObject({ lit: { near: 0, far: 0 } });
    expect(game.hud()).toContain('Draw');
  });

  it('scratches a tally mark per marble lost, and ends a lost game on the banner and the score', async () => {
    const game = await boot('?nodes=100');
    await game.hook<Promise<number>>('__playTurns', 30, [4]); // the player marches one way, the bot pushes six off
    expect(document.body.dataset.over).toBe('loss');
    expect(game.hud()).toContain('You lose');
    expect(game.hud()).toContain('White ejected 0/6 · Black ejected 6/6');
    expect(game.hook('__tally')).toEqual([
      { marked: 6, slots: 6 },
      { marked: 0, slots: 6 },
    ]);
  });

  it('frees the renderer record of the tally marks a redraw replaces, so a fight leaves none behind (#1520)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    const { tallies } = parts(scene());
    const old = tallies.flatMap((group) => [...group.children]);
    expect(old.length).toBeGreaterThan(0);
    const freed = old.map((mesh) => {
      const seen = vi.fn();
      mesh.addEventListener('dispose', seen);
      return seen;
    });
    startBossById('choir'); // a new fight draws the tally again
    freed.forEach((seen) => expect(seen).toHaveBeenCalledOnce());
  });

  it('draws no phase notch outside a boss fight, and the phase notches and threshold glyph in one', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__notches')).toEqual({ lit: 0, dark: 0, glyph: false });
    startBossById('echo');
    const notches = game.hook<{ lit: number; dark: number; glyph: boolean }>('__notches');
    expect(notches.glyph).toBe(true);
    expect(notches.lit + notches.dark).toBeGreaterThan(0);
  });

  it('scratches six tally slots per side in a 1v1 and in The Choir', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__tally')).toEqual([
      { marked: 0, slots: 6 },
      { marked: 0, slots: 6 },
    ]);
    startBossById('choir');
    expect(game.hook('__tally')).toEqual([
      { marked: 0, slots: 6 },
      { marked: 0, slots: 6 },
    ]);
  });

  it('counts in the hooks only what the scene draws', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    startBossById('echo');
    const { notches, tallies, plate } = parts(scene());
    scene().remove(notches, ...tallies);
    expect(game.hook('__notches')).toEqual({ lit: 0, dark: 0, glyph: false });
    expect(game.hook('__tally')).toEqual([
      { marked: 0, slots: 0 },
      { marked: 0, slots: 0 },
    ]);
    plate.visible = false;
    expect(game.hook('__frame')).toMatchObject({ drawn: false });
  });

  it('gives each marble its own turn, carried by its slide, and the first turns back in a new game', async () => {
    const game = await boot('?bot=off');
    const cell = game.hook<{ cells: Axial[] }[]>('__legal').find((m) => m.cells.length === 1)!.cells[0]!;
    const start = game.hook<number[]>('__marbleTurn', ...cell);
    expect(start).toHaveLength(4);
    const [, to] = step(game, cell);
    expect(game.hook('__marbleTurn', ...cell)).toBeNull(); // an empty cell
    expect(game.hook('__marbleTurn', ...to)).not.toEqual(start); // rolled on its way
    const newGame = document.getElementById('new-game')!;
    newGame.click();
    newGame.click(); // confirmed
    expect(game.hook('__plies')).toBe(0);
    expect(game.hook('__marbleTurn', ...cell)).toEqual(start);
  });

  it('draws the hovered move as ghost marbles, and none off the board', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    const mv = game.hook<{ cells: Axial[] }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    const target = game.hook<{ cell: Axial }[]>('__targets')[0]!.cell;
    hoverOver(game, target);
    const ghosts = parts(scene()).ghosts;
    expect(document.body.dataset.ghosts).toBe('1');
    expect(ghosts.children).toHaveLength(1);
    hoverOver(game, target); // the same cell: nothing to redraw
    expect(ghosts.children).toHaveLength(1);
    hoverOver(game, null);
    expect(document.body.dataset.ghosts).toBe('0');
    expect(ghosts.children).toHaveLength(0);
  });

  it('shows who plays and the goal at the start of a match, gone after the first move (#1568)', async () => {
    const local = await boot('?bot=off');
    expect(local.hud()).toContain('Two players, one board. Eject 6 to win.');
    step(local);
    expect(local.hud()).not.toContain('Eject 6 to win');
    const bot = await boot('?nodes=1');
    expect(bot.hud()).toContain('You vs Bot. Eject 6 to win.');
    startBossById('hull');
    expect(bot.hud()).toContain('Rim on file.'); // #1038: the boss bar names the boss, the line keeps its flavour
    await bot.settle(); // the bot's pending answers arrive before the test ends
  });

  it('adds the flat HUD to the plate while its setting is on', async () => {
    const game = await boot('?bot=off');
    const plain = game.hud();
    expect(plain).not.toContain('Turn: Black');
    game.openSettings();
    setting('flat-hud');
    expect(game.hud()).toContain('Turn: BlackEjected: Black 0/6, White 0/6');
    setting('flat-hud');
    expect(game.hud()).toBe(plain);
  });

  it('opens holes in the frame where The Hull makes cells vanish', async () => {
    const scene = catchScene();
    const game = await boot('?nodes=1&look=terrace'); // counts the terrace look's 109 holes; the neon default gives 110 (#1424)
    startBossById('hull');
    await game.hook<Promise<number>>('__playTurns', 6, [0, 1, 2, 3, 4, 5]); // a crack at ply 8, its cell gone at ply 11
    const vanished = Number(document.body.dataset.vanished);
    expect(vanished).toBeGreaterThan(0);
    expect(game.hook('__frame')).toMatchObject({ holes: vanished, drawn: true, dishes: 61 - vanished }); // on the terrace, one dish fewer per hole (#1374)
    expect(parts(scene()).discs.filter((d) => !d.visible)).toHaveLength(vanished + 108); // rings 5 to 7 are off this board (#564, #947, #955)
    await game.settle();
  });

  it('shows the online mode on the plate, and the rematch asks once an online game is over', async () => {
    const game = await boot('?bot=off');
    document.getElementById('play-online')!.click();
    await until(game, () => document.body.dataset.seat === 'player');
    expect(game.hud()).toContain('You vs your opponent, online. Eject 6 to win.');
    // The opponent: a second session on the other end of the room, with its own engine.
    const { Engine, engine_version } = await import('edgefall-wasm');
    const theirs = new Engine();
    const them = new OnlineSession({
      game: game.room()!,
      side: 2,
      engine: engine_version(),
      keys: await generateKeys(),
      transport: game.peer()!,
      judge: {
        to_move: () => theirs.to_move(),
        play: (mv) => theirs.play(mv),
        status: () => theirs.status(),
        restart: () => {},
      },
      onMove: () => {},
      onRefuse: () => {},
    });
    await until(game, () => document.body.dataset.opponent === 'here');
    expect(document.getElementById('lobby-sheet')!.hidden).toBe(true); // the opponent is in: the lobby folds
    const rematch = document.getElementById('rematch')!;
    expect(rematch.hidden).toBe(true);
    const white: Play = async (from, to) => {
      const moves = parseMoves(theirs.legal_moves());
      const cell = from ?? moves.find((m) => m.cells.length === 1)!.cells[0]!;
      const target = to ?? groupTargets(moves, [cell])[0]!.cell;
      const record = encodeMove(moveForClick(moves, [cell], target)!);
      const [plies, turn] = [game.hook<number>('__plies'), game.turn()];
      theirs.play(Int32Array.from(record));
      await them.send(record);
      // The engine has the move before the page logged it and refreshed the HUD: wait for the HUD too (#952).
      await until(game, () => game.hook<number>('__plies') === plies + 1 && game.turn() !== turn);
      game.frame(2000);
      return [cell, target];
    };
    const black: Play = async (from, to) => {
      const cells = step(game, from, to);
      await until(game, () => theirs.to_move() === 2); // our move reached them
      return cells;
    };
    await repeat(black, white);
    expect(document.body.dataset.over).toBe('draw');
    expect(rematch.hidden).toBe(false);
    rematch.click();
    await until(game, () => game.hud().includes('You asked for a rematch. Waiting for White...'));
  });

  it('shows the online mode to a player invited in a room, still waiting for a seat', async () => {
    const game = await boot('?bot=off#room=abcdefgh');
    await until(game, () => document.body.dataset.seat === 'pending');
    expect(game.room()).toBe('abcdefgh');
    expect(game.hud()).toContain('You vs your opponent, online. Eject 6 to win.');
  });

  it('draws target arrows without adding dynamic PointLights to avoid shader recompilation stalls (#777)', async () => {
    const game = await boot('?bot=off');
    const legal = game.hook<{ cells: Axial[] }[]>('__legal');
    const marble = legal.find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...marble);
    const targets = game.hook<{ cell: Axial }[]>('__targets');
    expect(targets.length).toBeGreaterThan(0);
    const marbles = game.hook<THREE.Group>('__marbles');
    const lights = marbles.children.filter((child) => child instanceof THREE.PointLight);
    expect(lights.length).toBe(0);
  });

  it('draws the target arrows dark on their luminous ring (#787)', async () => {
    const game = await boot('?bot=off&scene=room');
    const legal = game.hook<{ cells: Axial[] }[]>('__legal');
    game.click(...legal.find((m) => m.cells.length === 1)!.cells[0]!);
    const arrow = game.hook<THREE.Group>('__marbles').children.find(
      (child) => child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial,
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
    expect(arrow!.material.color.getHex()).toBe(0x0b0d0f);
  });
});
