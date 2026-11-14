import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { color as tslColor } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { neonShellFor, NEON, NEON_CELL_SCALE, NEON_HIDDEN, NEON_LIGHT, WORLD_DAY, lightNeon, targetArrowMaterial, neonEdgeGeometry, neonGlow, neonEdgeMaterial, neonLookOn, neonMaterial, neonPaint, neonPedestal, neonStars, NEON_TELL, nextToSight, neonBreachGeometry, neonEggGeometry, neonVoidGeometry, neonVoidMaterial, neonCrackMap, neonFogGeometry, neonTells, neonVeil, tellLook, NEON_RIM, NEON_GLOSS, NEON_WHITE_RIM, NEON_WHITE_SHADE, NEON_SHEEN, neonMarbleRim, marbleSheen, NEON_HERO_RIM, neonHeroRim } from './neonlook';
import { mixHex } from './daynight';
import { mergeByMaterial } from './tablezero';
import { scalePower } from './lightpanel';
import { DECK_NAMES } from './deck';
import { DECK_KEY, ELITE_ACCENT, GROUND_TINT, HUB_GROUND_TINT, NEON_GLOW, NEON_WORLD_LOOKS, RUN_KEY, neonDeckLook, runKey, neonSkyOf, neonSunPosition } from './neonlook';
import { ACT_SPACE, BOSS_SPACE } from './bossspace';

const ACT1 = { act: 0, elite: false }; // a plain fight of act 1 of a run (#1554)

const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** A geometry whose vertex colours go from `dark` to `light` (hex, as the file's linear values). */
const painted = (...hexes: number[]): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  const colours = hexes.flatMap((h) => new THREE.Color(h).toArray());
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hexes.length * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colours), 3));
  return g;
};
const at = (g: THREE.BufferGeometry, i: number): THREE.Color => new THREE.Color().fromBufferAttribute(g.attributes.color!, i);

describe('the neon look (#1424)', () => {
  it('draws the target arrow near-black under the neon look; the terrace keeps the kit arrow (#1508)', () => {
    const kit = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const arrow = targetArrowMaterial(true, kit) as THREE.MeshBasicMaterial;
    expect(arrow).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(arrow.color.getHex()).toBe(NEON.arrow);
    expect(targetArrowMaterial(false, kit)).toBe(kit);
  });

  it('is the default look: on with no look or ?look=neon, off for ?look=terrace and the board looks (#1424)', () => {
    for (const s of ['', '?bot=off', '?look=neon']) expect(neonLookOn(s)).toBe(true);
    for (const s of ['?look=terrace', '?bot=off&look=terrace', '?look=tonal', '?look=pbr', '?look=']) expect(neonLookOn(s)).toBe(false);
  });

  it('puts the brightest colour of a cell on the slate, and keeps its bevel darker', () => {
    const g = painted(0xb3a98a, 0x4f4b3b);
    neonPaint('scene_cell_07', g);
    expect(at(g, 0).getHex()).toBe(NEON.cell);
    expect(lum(at(g, 1))).toBeLessThan(lum(at(g, 0)));
  });

  it('ramps the slab from the gap to the rim, and clamps outside the file range', () => {
    const g = painted(0x2a3540, 0xa29e9a, 0xffffff, 0x000000);
    neonPaint('scene_slab_arena', g);
    expect([at(g, 0).getHex(), at(g, 1).getHex(), at(g, 2).getHex(), at(g, 3).getHex()]).toEqual([NEON.gapFloor, NEON.rim, NEON.rim, NEON.gapFloor]);
  });

  it('outlines the Open world hero in a near black line, 2 px or more at 390 px, under the look only (#1656)', () => {
    const glass = (): THREE.MeshStandardMaterial => neonMarbleRim('white', new THREE.MeshStandardMaterial({ color: NEON.whiteMarble }), true);
    const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lumOf = (hex: number): number => [0.2126, 0.7152, 0.0722].reduce((sum, w, i) => sum + w * lin(((hex >> (16 - 8 * i)) & 255) / 255), 0);
    expect((lumOf(NEON.whiteMarble) + 0.05) / (lumOf(NEON_HERO_RIM.colour) + 0.05)).toBeGreaterThanOrEqual(7);
    // the line is dark from a fresnel of `to`: on a sphere `radius` px round it is radius * (1 - sqrt(1 - (1 - to)^2)) px wide; the hero is 15.7 px round at 390 (#1656)
    expect(15 * (1 - Math.sqrt(1 - (1 - NEON_HERO_RIM.to) ** 2))).toBeGreaterThanOrEqual(2);
    expect(NEON_HERO_RIM.from).toBeLessThan(NEON_HERO_RIM.to);
    const plain = glass();
    expect(neonHeroRim(plain, false)).toBe(plain);
    expect([plain.outputNode ?? null, plain.userData.heroRim]).toEqual([null, undefined]); // the look off: nothing changes
    const lined = neonHeroRim(glass(), true);
    expect(lined.userData.heroRim).toBe(true);
    expect((lined.outputNode as { isNode?: boolean }).isNode).toBe(true); // the line replaces the lit colour, the gloss and the glow
  });

  it('draws the rim on the black shell under the neon look only, the white side too, softer (#1552, #1553)', () => {
    // The rim is a node (the renderer is WebGPU, its WebGL 2 fallback too: onBeforeCompile is not run there, #1552).
    const shell = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({ color: NEON.blackMarble });
    const glass = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: NEON.whiteMarble, roughness: 0.6 });
    const emissive = (material: THREE.Material): unknown => (material as THREE.Material & { emissiveNode?: { isNode?: boolean } }).emissiveNode;
    expect((emissive(neonMarbleRim('black', shell(), true)) as { isNode: boolean }).isNode).toBe(true);
    expect((emissive(neonMarbleRim('white', glass(), true)) as { isNode: boolean }).isNode).toBe(true);
    expect(emissive(neonMarbleRim('black', shell(), false))).toBeUndefined();
    expect(emissive(neonMarbleRim('white', glass(), false))).toBeUndefined();
    expect((emissive(neonMarbleRim('black', new THREE.MeshBasicMaterial(), true)) as { isNode: boolean }).isNode).toBe(true); // no emissive of its own: black
    expect(NEON_WHITE_RIM.strength).toBeLessThan(NEON_RIM.strength);
    expect(NEON_WHITE_RIM.colour).not.toBe(NEON_RIM.colour);
  });

  it('shades the stripe of an Open world marble and adds the rim to its glow, neither replaced (#1553, the Open world)', () => {
    // The Open world's marble is a stripe (its colour node) and a glow (its emissive node): the white's shade multiplies the stripe,
    // and the rim adds to the glow.
    const marble = Object.assign(new THREE.MeshStandardMaterial({ color: NEON.whiteMarble }), { colorNode: tslColor(0x6fa8dc), emissiveNode: tslColor(0x222222) });
    const stripe = marble.colorNode as Node;
    const glow = marble.emissiveNode as Node;
    neonMarbleRim('white', marble, true);
    // A node reaches another when the other is one of its inputs, at any depth: the stripe and the glow are inside the new nodes.
    const reaches = (node: Node, target: Node, depth = 0): boolean => node === target || (depth < 8 && Object.values(node).some((v) => (v as Node)?.isNode === true && reaches(v as Node, target, depth + 1)));
    expect(reaches(marble.colorNode as Node, stripe), 'the stripe is shaded, not replaced').toBe(true);
    expect(reaches(marble.emissiveNode as Node, glow), 'the glow is kept under the rim').toBe(true);
  });

  it("the Open world marbles wear the arena's black shell under the neon look when the default skin is worn, the worn skin otherwise (#1558)", () => {
    const terrace = { name: 'terrace' };
    const worn = { name: 'worn' };
    expect(neonShellFor(true, true, terrace, worn), 'neon, default skin: the arena marble').toBe(terrace);
    expect(neonShellFor(true, false, terrace, worn), 'neon, a skin the player chose: worn as it is').toBe(worn);
    expect(neonShellFor(false, true, terrace, worn), 'the look off: the worn skin, as before').toBe(worn);
  });

  it('gives both marble colours a sharper sun highlight under the neon look, none under the terrace (#1553)', () => {
    // The terrace's own numbers (terraceShell 0.3 and 0.12, terraceGlass 0.6): the look only changes them when it is on.
    const shell = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({ color: NEON.blackMarble, roughness: 0.3, specularIntensity: 0.12 });
    const glass = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: NEON.whiteMarble, roughness: 0.6 });
    const on = neonMarbleRim('black', shell(), true) as THREE.MeshPhysicalMaterial;
    expect(on.specularIntensity, 'black highlight').toBe(NEON_GLOSS.specularIntensity);
    expect(on.specularIntensity, 'black highlight above the terrace').toBeGreaterThan(0.12);
    expect(on.roughness, 'black roughness').toBe(NEON_GLOSS.roughness.black);
    const white = neonMarbleRim('white', glass(), true) as THREE.MeshStandardMaterial;
    expect(white.roughness, 'white highlight').toBe(NEON_GLOSS.roughness.white);
    expect(white.roughness, 'white roughness below the terrace').toBeLessThan(0.6);
    expect(white.roughness, 'white keeps its shading, not a mirror').toBeGreaterThanOrEqual(0.35);
    const off = neonMarbleRim('black', shell(), false) as THREE.MeshPhysicalMaterial;
    expect(off.specularIntensity, 'terrace black unchanged').toBe(0.12);
    expect(off.roughness, 'terrace black roughness unchanged').toBe(0.3);
    const offWhite = neonMarbleRim('white', glass(), false) as THREE.MeshStandardMaterial;
    expect(offWhite.roughness, 'terrace white unchanged').toBe(0.6);
  });

  it('shades the white marble by its normal under the neon look, so its lit side does not clip (#1553 slice B)', () => {
    // Measured on the bot game at 960x540: the white's lit cap sat at 255 (clipped), its volume gone. A colour node darkens the
    // side away from the sun, the look only; the black shell keeps its colour, the terrace keeps its white as it is.
    const glass = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: NEON.whiteMarble, roughness: 0.6 });
    const shade = (material: THREE.Material): unknown => (material as THREE.Material & { colorNode?: { isNode?: boolean } }).colorNode;
    expect((shade(neonMarbleRim('white', glass(), true)) as { isNode: boolean }).isNode).toBe(true);
    expect(shade(neonMarbleRim('white', glass(), false))).toBeUndefined();
    expect(shade(neonMarbleRim('black', new THREE.MeshPhysicalMaterial({ color: NEON.blackMarble }), true))).toBeUndefined();
    expect(NEON_WHITE_SHADE.floor, 'the shaded side keeps some light').toBeGreaterThan(0.4);
    expect(NEON_WHITE_SHADE.floor, 'the shaded side is darker than the lit one').toBeLessThan(NEON_WHITE_SHADE.lit);
    expect(NEON_WHITE_SHADE.lit, 'the lit side is below the clip').toBeLessThan(1);    const [x, y] = NEON_WHITE_SHADE.light;
    expect(x, 'the sun stands on the left, as the neon sun does').toBeLessThan(0);
    expect(y, 'the sun stands above the marble, as the neon sun does').toBeGreaterThan(0);
  });

  it('lights a reflection of the sky on both marbles, under both looks, with no map and no envMap (#1553)', () => {
    // The arena's envMap is left out under automation and on the low tier, so the black shell was a flat disc there (the report's
    // captures). The sheen is a colour node of the reflection vector: no texture, no draw call, the same on every tier.
    const shell = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({ color: NEON.blackMarble, roughness: 0.3 });
    const glass = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: NEON.whiteMarble, emissive: 0x2a2a2a });
    const emissive = (material: THREE.Material): Node => (material as THREE.Material & { emissiveNode: Node }).emissiveNode;
    expect(emissive(marbleSheen('black', shell())).isNode).toBe(true);
    expect(emissive(marbleSheen('white', glass())).isNode).toBe(true);
    // The marble's own glow and its rim stay under the sheen: it adds, never replaces.
    const rimmed = neonMarbleRim('black', shell(), true);
    const rim = emissive(rimmed);
    const reaches = (node: Node, target: Node, depth = 0): boolean => node === target || (depth < 8 && Object.values(node).some((v) => (v as Node)?.isNode === true && reaches(v as Node, target, depth + 1)));
    expect(reaches(emissive(marbleSheen('black', rimmed)), rim), 'the rim is kept').toBe(true);
    const material = shell();
    expect(marbleSheen('black', material), 'the same material comes back').toBe(material);
    expect((marbleSheen('black', new THREE.MeshBasicMaterial()) as unknown as { emissiveNode: Node }).emissiveNode.isNode, 'a material with no emissive of its own').toBe(true);
    // The black shell takes the sky, the white only a hint: the white does not bloom back to flat white.
    expect(NEON_SHEEN.black.sky).toBeGreaterThan(0);
    expect(NEON_SHEEN.black.spot).toBeGreaterThan(NEON_SHEEN.white.spot);
    expect(NEON_SHEEN.white.sky).toBeLessThan(NEON_SHEEN.black.sky);
    expect(NEON_SHEEN.white.spot, 'the white keeps its shading').toBeLessThan(0.5);
    const [x, y] = NEON_SHEEN.light;
    expect(x, 'the sun stands on the left').toBeLessThan(0);
    expect(y, 'the sun stands above').toBeGreaterThan(0);
  });

  it('paints the ground, the lamps and the turn bar, and leaves an unknown node alone', () => {
    const ground = painted(0x818d8d);
    neonPaint('scene_col_map_b00', ground);
    expect(at(ground, 0).getHex()).toBe(NEON.ground);
    const lamp = painted(0x8e5e40);
    neonPaint('scene_tower_lamp_3', lamp);
    expect(at(lamp, 0).getHex()).toBe(NEON.violet);
    const bar = painted(0x6ab4c3);
    neonPaint('scene_turnbar_black', bar);
    expect(at(bar, 0).getHex()).toBe(NEON.turn);
    const other = painted(0x123456);
    neonPaint('something_else', other);
    expect(at(other, 0).getHex()).toBe(0x123456);
  });

  it('hides the sky of the file, fog and clouds', () => {
    for (const n of ['scene_sky_dome', 'scene_sky_cloud_01', 'scene_fogring_0', 'scene_fogline']) expect(NEON_HIDDEN.test(n)).toBe(true);
    expect(NEON_HIDDEN.test('scene_cell_00')).toBe(false);
  });

  it('shares one material per kind: glass, slate, lamp, bar', () => {
    const [glass, slate, lamp, bar] = ['dish', 'scene_post_1', 'scene_tower_lamp_0', 'scene_turnbar_white'].map(neonMaterial);
    expect(glass).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((glass as THREE.MeshStandardMaterial).roughness).toBeLessThan((slate as THREE.MeshStandardMaterial).roughness);
    expect(lamp).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(bar).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(neonMaterial('scene_cell_04')).toBe(glass);
    expect(neonMaterial('scene_slab_arena')).not.toBe(slate); // the slab has its own material, tinted per deck (#1551)
  });

  it('lights with a cold sun low on the left and a neutral cool hemisphere', () => {
    const [sun, hemi] = [new THREE.DirectionalLight(), new THREE.HemisphereLight()];
    lightNeon(sun, hemi);
    expect(sun.intensity).toBe(NEON_LIGHT.sunIntensity);
    expect(sun.position.x).toBeLessThan(0);
    expect(sun.position.y).toBeCloseTo(30 * Math.sin((NEON_LIGHT.elevation * Math.PI) / 180));
    expect(hemi.intensity).toBe(NEON_LIGHT.hemisphere);
    expect(hemi.color.b).toBeGreaterThanOrEqual(hemi.color.r);
  });

  it('draws fine stars above the horizon, one mesh', () => {
    const stars = neonStars(50);
    expect(stars.name).toBe('starfield');
    const scene = new THREE.Scene(); // its name holds no 'neon': the light sliders scale the meshes called so, and the stars have no emissive power
    scene.add(stars);
    expect(() => scalePower(scene, { bloom: 100, lamps: 100, lights: 100 })).not.toThrow();
    expect(stars.geometry.attributes.position!.count).toBe(150);
    for (let i = 0; i < 150; i += 3) expect(stars.geometry.attributes.position!.getY(i)).toBeGreaterThan(0);
  });

  it('draws a cyan hexagon in the gap of each cell, brighter than the cell', () => {
    expect(neonEdgeGeometry().attributes.position!.count).toBe(36);
    expect(neonEdgeMaterial().color.b).toBeGreaterThan(1);
  });

  it('copies the pedestal in slate with a thin cyan ring, and leaves the file mesh as it was', () => {
    const geometry = painted(0xd8d4c8, 0xd8d4c8, 0xd8d4c8);
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2)); // dropped
    const file = Object.assign(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()), { name: 'kit_pedestal_flat' });
    const copy = neonPedestal(file);
    expect(at(copy.geometry, 0).getHex()).toBe(NEON.plateau);
    const colours = copy.geometry.attributes.color!;
    expect(colours.count).toBeGreaterThan(3); // the disc and its ring
    expect(at(copy.geometry, colours.count - 1).b).toBeGreaterThan(at(copy.geometry, 0).b); // the ring is bluer than the slate
    expect(copy.geometry.attributes.uv).toBeUndefined();
    expect(at(file.geometry, 0).getHex()).toBe(0xd8d4c8);
    expect(copy.material).toBe(neonMaterial('slate'));
  });

  it('glows: a violet channel on the rim and a band and a tip on each post, unlit above 1', () => {
    const glow = neonGlow([new THREE.Vector3(1, 0, 2), new THREE.Vector3(-1, 0, 2)], true);
    expect(glow.children).toHaveLength(5);
    expect(Math.max(...((glow.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.toArray())).toBeGreaterThan(1);
    expect(glow.children[1]!.position.toArray()).toEqual([1, 0.7, 2]);
    expect(neonGlow([], false).children).toHaveLength(0);
  });

  it('gives each deck its own key colour, from the palette, and its own slab tint (#1551)', () => {
    const keys = DECK_NAMES.map((d) => DECK_KEY[d].key);
    expect(new Set(keys).size).toBe(DECK_NAMES.length);
    const tints = DECK_NAMES.map((d) => {
      neonDeckLook(d);
      return (neonMaterial('scene_slab_arena') as THREE.MeshStandardMaterial).color.toArray().join(); // not a hex: the tint is a multiplier of the rim, above 1
    });
    expect(new Set(tints).size).toBe(DECK_NAMES.length);
    const grounds = DECK_NAMES.map((d) => {
      neonDeckLook(d);
      return (neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color.toArray().join();
    });
    expect(new Set(grounds).size).toBe(DECK_NAMES.length); // the ground outside the board too (#1551)
    expect(new Set(DECK_NAMES.map((d) => neonSkyOf(d).getHexString())).size).toBe(DECK_NAMES.length); // the sky too (#1551)
    neonDeckLook('mess');
  });

  it('lays the Hub on the dark neon ground of art.md 1, not the pale surround of a fight (#1639)', () => {
    const groundOf = (): THREE.Color => new THREE.Color(NEON.ground).multiply((neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color);
    for (const d of DECK_NAMES) {
      neonDeckLook(d, null, null, true);
      const hub = groundOf();
      expect(hub.getHex()).toBe(new THREE.Color(NEON.ground).lerp(new THREE.Color(DECK_KEY[d].key), HUB_GROUND_TINT).getHex());
      expect(hub.getHex(), d).toBe(NEON.ground); // #1d2433, not the pale grey of #1639
      neonDeckLook(d);
      expect(groundOf().getHex()).toBe(new THREE.Color(NEON.ground).lerp(new THREE.Color(DECK_KEY[d].key), GROUND_TINT).getHex());
    }
    neonDeckLook('mess');
  });

  it('glows the rim in the deck key and the posts in its accent, the brightest channel at NEON_GLOW (#1551)', () => {
    neonDeckLook('cargo');
    const glow = neonGlow([new THREE.Vector3(1, 0, 2)], true);
    const [rim, post] = [glow.children[0], glow.children[1]].map((m) => (m as THREE.Mesh).material as THREE.MeshBasicMaterial);
    expect(Math.max(...rim!.color.toArray())).toBeCloseTo(NEON_GLOW);
    expect(rim!.color.getHex()).toBe(new THREE.Color(DECK_KEY.cargo.key).multiplyScalar(NEON_GLOW / Math.max(...new THREE.Color(DECK_KEY.cargo.key).toArray())).getHex());
    expect(post!.color.getHex()).toBe(new THREE.Color(DECK_KEY.cargo.accent).multiplyScalar(NEON_GLOW / Math.max(...new THREE.Color(DECK_KEY.cargo.accent).toArray())).getHex());
    neonDeckLook('mess');
  });

  it('glows the rim and the posts violet in a rogue-lite fight, on any deck, and the deck key again after (#1554)', () => {
    const glowHex = (hex: number): number => new THREE.Color(hex).multiplyScalar(NEON_GLOW / Math.max(...new THREE.Color(hex).toArray())).getHex();
    const colours = (): number[] => {
      const [rim, post] = neonGlow([new THREE.Vector3(1, 0, 2)], true).children.map((m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex());
      return [rim!, post!];
    };
    neonDeckLook('mess', ACT1);
    expect(colours()).toEqual([glowHex(RUN_KEY.key), glowHex(RUN_KEY.accent)]);
    expect(RUN_KEY.key).toBe(NEON.violet);
    neonDeckLook('mess');
    expect(colours()[0]).toBe(glowHex(DECK_KEY.mess.key));
  });

  it('leans the violet of a run toward the danger red act by act, the fourth act and later the most, and makes an elite all hazard sodium, rim and posts (#1554)', () => {
    const glowHex = (hex: number): number => new THREE.Color(hex).multiplyScalar(NEON_GLOW / Math.max(...new THREE.Color(hex).toArray())).getHex();
    const redness = (hex: number): number => new THREE.Color(hex).r / new THREE.Color(hex).b;
    const keys = [0, 1, 2, 3].map((act) => runKey({ act, elite: false }).key);
    expect(keys[0]).toBe(RUN_KEY.key);
    expect(new Set(keys.map(glowHex)).size).toBe(4); // still four apart once glowing
    for (let i = 1; i < 4; i++) expect(redness(keys[i]!)).toBeGreaterThan(redness(keys[i - 1]!));
    expect(keys[3]).toBe(new THREE.Color(NEON.violet).lerp(new THREE.Color(0xff6b5a), 0.75).getHex()); // three quarters to the danger token
    expect(runKey({ act: 6, elite: false })).toEqual(runKey({ act: 3, elite: false }));
    expect(runKey({ act: 0, elite: false }).accent).toBe(RUN_KEY.key); // a plain fight: violet posts
    expect(runKey({ act: 2, elite: true })).toEqual({ key: ELITE_ACCENT, accent: ELITE_ACCENT });
    expect(ELITE_ACCENT).toBe(0xd9822b); // the palette's sodium
    neonDeckLook('mess', { act: 2, elite: true });
    const [rim, post] = neonGlow([new THREE.Vector3(1, 0, 2)], true).children.map((m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex());
    expect([rim, post]).toEqual([glowHex(ELITE_ACCENT), glowHex(ELITE_ACCENT)]);
    neonDeckLook('mess');
  });
});

describe('the neon look of the terrace file (#1424)', () => {
  const piece = (name: string, x = 0, colours = [0xb3a98a, 0x4f4b3b]): THREE.Mesh => {
    const g = painted(...colours);
    const mesh = Object.assign(new THREE.Mesh(g, new THREE.MeshStandardMaterial()), { name });
    mesh.position.set(x, 0, 1);
    return mesh;
  };
  it('paints, hides the sky, gives the dishes their edges and the bars their own material', () => {
    const root = new THREE.Group();
    root.add(piece('scene_cell_00'), piece('scene_cell_01', 2), piece('scene_sky_dome'), piece('scene_slab_arena'), piece('scene_turnbar_black'), piece('scene_post_0', 5));
    const out = mergeByMaterial(root, false, true);
    const dishes = out.getObjectByName('terrace_dishes') as THREE.InstancedMesh;
    const edges = out.getObjectByName('terrace_edges') as THREE.InstancedMesh;
    expect(dishes.material).toBe(neonMaterial('dish'));
    expect(at(dishes.geometry, 0).getHex()).toBe(NEON.cell);
    expect([dishes.count, edges.count]).toEqual([2, 2]);
    const first = new THREE.Matrix4();
    dishes.getMatrixAt(0, first);
    expect(new THREE.Vector3().setFromMatrixScale(first).x).toBeCloseTo(NEON_CELL_SCALE); // the gap is 40 % wider
    expect(new THREE.Vector3().setFromMatrixPosition(first).x).toBe(0); // about its own centre
    expect(NEON_CELL_SCALE).toBeCloseTo(0.938, 3);
    dishes.userData.show((x: number) => x === 2);
    expect([dishes.count, edges.count]).toEqual([1, 1]); // a vanished cell loses its edge too
    expect((out.getObjectByName('terrace_voids') as THREE.InstancedMesh).count).toBe(1); // and wears a pale outline
    const bar = out.children.find((c) => c.name === 'scene_turnbar_black') as THREE.Mesh;
    expect(bar.material).toBe(neonMaterial('scene_turnbar_black'));
    expect(out.getObjectByName('neon_glow')!.children).toHaveLength(3); // the rim channel, a band and a tip
    expect(out.getObjectByName('neon_glow')!.parent).toBe(out); // not split: the board is the file itself
    // the sky mesh is not merged: the slab (lit, its own tint per deck) and the posts' slate are
    expect((out.children as THREE.Mesh[]).filter((m) => m.isMesh && m.name === '').length).toBe(2);
  });
  it('leaves the dish alone without the look', () => {
    const root = new THREE.Group();
    root.add(piece('scene_cell_00'));
    const out = mergeByMaterial(root);
    expect(out.getObjectByName('terrace_edges')!.visible).toBe(false); // a hidden glow under the dishes, for the lair fight at night (#1496)
  });
});

describe('the tells of the neon look (#1424)', () => {
  it("is the game's own sizes without the look, thick and lifted with it", () => {
    expect(tellLook(false)).toEqual({ ringTube: 0.025, glyph: 1, chevron: 1, plate: 1, plateLift: 0, fogRings: 1, shockInner: 0.96, ringSides: 32, ringRadius: 0.42, arenaDecal: 1, egg: 1, lift: 0, arenaLift: 0, glowFloor: 0, breachTint: 0, breachMix: 0, breachOpacity: 0.55 });
    expect(tellLook(true)).toBe(NEON_TELL);
    expect(NEON_TELL.ringTube).toBeGreaterThan(0.025 * 2); // a thin line is mostly anti-aliased pixels
    expect(NEON_TELL.lift).toBeGreaterThan(0.1 - 0.05); // the shock ring (0.05) clears the dish tops (0.1)
    expect(NEON_TELL.arenaLift * 0.5).toBeGreaterThan(0.1); // the arena is drawn at half size
    expect(NEON_TELL.glowFloor).toBe(1); // the glow under an egg on 1 is steady, never a flicker
  });
  it('draws the crack as a thick mask: lines from the middle, none in the corners', () => {
    const map = neonCrackMap(64);
    const data = map.image.data as Uint8Array;
    const at = (x: number, y: number): number => data[(y * 64 + x) * 4 + 1]!;
    expect(at(32, 32)).toBe(255); // the middle, where every crack meets
    expect(at(0, 0)).toBe(0);
    expect(at(63, 63)).toBe(0);
    let lit = 0;
    for (let i = 0; i < 64 * 64; i++) if (data[i * 4 + 1] === 255) lit++;
    expect(lit / (64 * 64)).toBeGreaterThan(0.2); // thick: more than a hairline
    expect(lit / (64 * 64)).toBeLessThan(0.7);
    expect(map.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });
  it('dresses the materials of the tells', () => {
    const m = {
      crack: new THREE.MeshBasicMaterial({ color: 0x777777 }),
      egg: new THREE.MeshStandardMaterial({ map: new THREE.Texture(), roughness: 0.55 }),
      glow: new THREE.MeshBasicMaterial({ color: 0x777777 }),
      chevron: new THREE.MeshBasicMaterial({ color: 0xf0a830 }),
      arrival: new THREE.MeshBasicMaterial({ color: 0xff7a3d }),
      pale: new THREE.MeshBasicMaterial({ color: 0xd8d4c8 }),
    };
    neonTells(m);
    expect(m.crack.color.getHex()).toBe(NEON_TELL.sodium);
    expect(m.crack.alphaMap).toBeInstanceOf(THREE.DataTexture);
    expect(m.egg.map).toBeNull(); // no speckled shell: a near-black egg
    expect(m.egg.color.getHex()).toBe(0xffffff);
    expect(m.egg.vertexColors).toBe(true);
    expect(m.egg.emissive.getHex()).toBe(NEON_TELL.ink);
    expect(m.egg.roughness).toBe(1);
    for (const sodium of [m.glow, m.chevron, m.arrival]) expect(sodium.color.getHex()).toBe(NEON_TELL.sodium);
    for (const material of Object.values(m)) expect(material.toneMapped).toBe(false); // the colour on the screen is the colour chosen
  });
  it('wears the fog as a near-opaque dark hexagon in a cyan outline, one geometry', () => {
    const geometry = neonFogGeometry();
    const colour = geometry.attributes.color!;
    const hexes = new Set(Array.from({ length: colour.count }, (_, i) => new THREE.Color(colour.getX(i), colour.getY(i), colour.getZ(i)).getHex()));
    expect([...hexes].sort()).toEqual([NEON_TELL.outline, NEON_TELL.ink].sort()); // the disc and its outline
    const material = new THREE.MeshBasicMaterial({ opacity: 0.9, transparent: true });
    const veil = new THREE.InstancedMesh(new THREE.CircleGeometry(0.46), material, 2);
    neonVeil(material, veil);
    expect(veil.geometry.attributes.color).toBeDefined();
    expect(material.vertexColors).toBe(true);
    expect(material.opacity).toBe(NEON_TELL.fog);
    expect(material.toneMapped).toBe(false);
  });
  it('gives the egg a bone collar on a near-black ovoid, the breach a hexagon wider than a cell, the void a pale outline', () => {
    const egg = neonEggGeometry();
    const colour = egg.attributes.color!;
    const hexes = new Set(Array.from({ length: colour.count }, (_, i) => new THREE.Color(colour.getX(i), colour.getY(i), colour.getZ(i)).getHex()));
    expect([...hexes].sort()).toEqual([0xffffff, NEON_TELL.ink].sort());
    const breach = neonBreachGeometry();
    breach.computeBoundingBox();
    expect(breach.boundingBox!.max.z).toBeGreaterThan(0.5); // past the cell's own edge: the cells join
    expect(neonVoidGeometry().attributes.position!.count).toBe(36);
    expect(neonVoidMaterial().color.getHex()).toBe(0xe6ffff);
    const seen = (q: number, r: number): boolean => q === 0 && r === 0;
    expect(nextToSight(1, 0, seen)).toBe(1); // a cell touching the sight is on its edge
    expect(nextToSight(2, 0, seen)).toBe(0); // one deeper in the fog is not
    expect(NEON_TELL.fogRings).toBe(0);
  });
});

describe('the Open world under the neon look: day, dusk and night (#1536)', () => {
  it('its day is the look the neon look ships: the black sky, the cold sun, the violet-white hemisphere, no glow', () => {
    const day = NEON_WORLD_LOOKS.day;
    // #1687: the world's day is warm and high (52 degrees: short shadows, no long diagonal bands), not the arena's cold low sun
    expect([day.sky, day.sun, day.sunIntensity, day.elevation, day.azimuth]).toEqual([NEON.sky, WORLD_DAY.sun, WORLD_DAY.sunIntensity, WORLD_DAY.elevation, WORLD_DAY.azimuth]);
    expect([day.hemiSky, day.hemiGround, day.hemiIntensity, day.glow]).toEqual([WORLD_DAY.hemiSky, WORLD_DAY.hemiGround, WORLD_DAY.hemiIntensity, 0]);
    expect(WORLD_DAY.elevation).toBeGreaterThan(NEON_LIGHT.elevation * 2);
  });

  it('dusk takes the violet sky and violet light, and night the pedestal ring moon, in readable light', () => {
    const { day, dusk, night } = NEON_WORLD_LOOKS;
    expect(dusk.sky).toBe(mixHex(NEON.sky, NEON.violet, 0.35)); // a third of the violet: dusk read weakly at a fifth (#1536 art)
    expect(dusk.sun).toBe(mixHex(NEON_LIGHT.sun, NEON.violet, 0.45));
    expect(dusk.hemiSky).toBe(mixHex(NEON_LIGHT.skyMix, NEON.violet, 0.4));
    expect(night.sky).toBe(NEON.sky);
    expect(night.sun).toBe(NEON.pedestalRing);
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity);
    expect(night.hemiIntensity).toBeGreaterThanOrEqual(1);
    expect([dusk.glow, night.glow]).toEqual([0.4, 1]);
  });

  it('phases the sky and the lakes with the clock: the stars out at night, the horizon glowing at dusk, the lakes violet then cyan (#1536)', () => {
    const { day, dusk, night } = NEON_WORLD_LOOKS;
    expect([day.stars, dusk.stars, night.stars]).toEqual([1, 0.5, 1.8]);
    expect([day.horizon, dusk.horizon, night.horizon]).toEqual([1, 2, 0.6]);
    expect(day.water).toBe(0xffffff);
    expect(dusk.water).toBe(mixHex(0xffffff, NEON.violet, 0.35));
    expect(night.water).toBe(mixHex(mixHex(0xffffff, NEON.cyan, 0.3), NEON.sky, 0.5)); // the lakes darker by night: the land reads 1.4:1 over them (#1656)
  });
  it('lights a boss space with its own sun, colour, place and strength, the hemisphere leaning to its key, and gives the neon light back without one (#1551)', () => {
    const [sun, hemisphere, plain] = [new THREE.DirectionalLight(), new THREE.HemisphereLight(), new THREE.HemisphereLight()];
    lightNeon(new THREE.DirectionalLight(), plain);
    const space = BOSS_SPACE.hull!;
    lightNeon(sun, hemisphere, space);
    expect(sun.color.getHex()).toBe(space.sun);
    expect(sun.intensity).toBeCloseTo(NEON_LIGHT.sunIntensity * space.intensity);
    expect(sun.position.toArray()).toEqual(neonSunPosition(30, space.elevation, space.azimuth));
    expect(hemisphere.color.getHex()).not.toBe(plain.color.getHex());
    lightNeon(sun, hemisphere);
    expect([sun.color.getHex(), sun.intensity, hemisphere.color.getHex()]).toEqual([NEON_LIGHT.sun, NEON_LIGHT.sunIntensity, plain.color.getHex()]);
    expect(sun.position.toArray()).toEqual(neonSunPosition());
  });

  it('gives a boss space its own rim, posts, slab, ground and sky, a run fight keeping its violet rim (#1551)', () => {
    const glowHex = (hex: number): number => new THREE.Color(hex).multiplyScalar(NEON_GLOW / Math.max(...new THREE.Color(hex).toArray())).getHex();
    const colours = (): number[] => neonGlow([new THREE.Vector3(1, 0, 2)], true).children.slice(0, 2).map((m) => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex());
    const ground = (): string => (neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color.toArray().join();
    const space = BOSS_SPACE.chaplain!;
    neonDeckLook('mess');
    const plainGround = ground();
    neonDeckLook('chapel', null, space);
    expect(colours()).toEqual([glowHex(space.key), glowHex(space.accent)]);
    expect(ground()).not.toBe(plainGround);
    neonDeckLook('chapel', ACT1, space);
    expect(colours()[0]).toBe(glowHex(RUN_KEY.key));
    expect(neonSkyOf('chapel', space).getHex()).toBe(new THREE.Color(NEON.sky).lerp(new THREE.Color(space.surround), space.sky).getHex());
    expect(neonSkyOf('chapel', null).getHex()).toBe(neonSkyOf('chapel').getHex());
    neonDeckLook('mess');
  });

  it('gives a rogue-lite act its own ground and sky on top of the violet rim and posts, which stay (#1551)', () => {
    const ground = (): string => (neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color.toArray().join();
    const glow = (): number => ((neonGlow([new THREE.Vector3(1, 0, 2)], true).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
    neonDeckLook('mess', ACT1);
    const [violetGround, violetRim] = [ground(), glow()];
    const grounds = new Set(Object.values(ACT_SPACE).map((space) => (neonDeckLook('mess', ACT1, space), expect(glow()).toBe(violetRim), ground())));
    expect(grounds.size).toBe(Object.keys(ACT_SPACE).length); // six acts, six grounds
    expect(grounds.has(violetGround)).toBe(false); // none the run's plain violet one
    neonDeckLook('mess');
  });
});
