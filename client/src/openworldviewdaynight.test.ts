import './test/openworldwasm';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CHUNK, World } from './openworld';
import { BLEND_MS, WORLD_LOOKS } from './daynight';
import { NEON, NEON_WHITE_GLOW, NEON_WORLD_LOOKS, setNeonWorldOn } from './neonlook';
import { BIOME_LOOK, BIOME_SKY, CAIRN_LOOK, NEON_SKY_MIX, OpenWorldView, SKY_MIX } from './openworldview';
import { GLOW_SHARE, stripedMaterial, stripeFadeNode } from './openworldstripe';
import { sunPosition } from './tablezero';

// The sky of the Open world follows the time of day (docs/specs/openworld.md section 11, #1496).
const MIN = 60_000;
function flat(cx: number, cy: number): Uint8Array {
  if (Math.abs(cx) > 3 || Math.abs(cy) > 3) return new Uint8Array();
  const out = new Uint8Array(CHUNK * CHUNK * 3);
  for (let i = 0; i < CHUNK * CHUNK; i++) out.set([i % 4, i % 8, 0], i * 3);
  return out;
}
/** The sky as the view draws it over the fixture's meadow (biome 0): the hour's sky leaning toward the meadow's air (#1736). */
const air = (sky: number): number => new THREE.Color(sky).lerp(new THREE.Color(BIOME_SKY.meadow), SKY_MIX).getHex();
/** The same under the look: the meadow's own dark ground, a smaller share, the sky near black. */
const airNeon = (sky: number): number => new THREE.Color(sky).lerp(new THREE.Color(BIOME_LOOK.meadow.ground), NEON_SKY_MIX).getHex();
const made = (): OpenWorldView => {
  const view = new OpenWorldView(new World(flat));
  view.show([0, 0]);
  return view;
};
const lights = (view: OpenWorldView): { sun: THREE.DirectionalLight; hemisphere: THREE.HemisphereLight } => {
  let sun!: THREE.DirectionalLight;
  let hemisphere!: THREE.HemisphereLight;
  view.scene.traverse((o) => {
    if ((o as THREE.DirectionalLight).isDirectionalLight) sun = o as THREE.DirectionalLight;
    if ((o as THREE.HemisphereLight).isHemisphereLight) hemisphere = o as THREE.HemisphereLight;
  });
  return { sun, hemisphere };
};

afterEach(() => setNeonWorldOn(false));

describe('the sky of the Open world view', () => {
  it('starts on the look of day: its sky for the background and the fog, the arena sun, the hemisphere', () => {
    const view = made();
    const { sun, hemisphere } = lights(view);
    const day = WORLD_LOOKS.day;
    expect((view.scene.background as THREE.Color).getHex()).toBe(air(day.sky));
    expect(view.scene.fog!.color.getHex()).toBe(air(day.sky));
    expect([sun.color.getHex(), sun.intensity]).toEqual([day.sun, day.sunIntensity]);
    expect([hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity]).toEqual([day.hemiSky, day.hemiGround, day.hemiIntensity]);
    expect(sun.position.clone().sub(view.focusPoint).toArray().map((v) => +v.toFixed(3))).toEqual(sunPosition(30, day.elevation, day.azimuth).map((v) => +v.toFixed(3)));
  });

  it('turns to the night: the sky, the moonlight, the ambient, the water tint, and draws again once', () => {
    const view = made();
    const { sun, hemisphere } = lights(view);
    expect(view.setTime(9 * MIN, true)).toBe(true);
    const night = WORLD_LOOKS.night;
    expect((view.scene.background as THREE.Color).getHex()).toBe(air(night.sky));
    expect(view.scene.fog!.color.getHex()).toBe(air(night.sky));
    expect([sun.color.getHex(), sun.intensity]).toEqual([night.sun, night.sunIntensity]);
    expect([hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity]).toEqual([night.hemiSky, night.hemiGround, night.hemiIntensity]);
    const water = view.scene.getObjectByName('terrain-water') as THREE.InstancedMesh;
    expect((water.material as THREE.MeshStandardMaterial).color.getHex()).toBe(night.water);
    const flatWater = view.scene.getObjectByName('terrain-water-flat') as THREE.InstancedMesh;
    expect((flatWater.material as THREE.MeshStandardMaterial).color.getHex()).toBe(night.water);
    expect(view.setTime(9.5 * MIN, true)).toBe(false); // the same look: nothing to draw
  });

  it('puts the sun where the look says, and keeps it there as the hero moves', () => {
    const view = made();
    const { sun } = lights(view);
    view.setTime(9 * MIN, true);
    view.show([2, 1]);
    const night = WORLD_LOOKS.night;
    expect(sun.position.clone().sub(view.focusPoint).toArray().map((v) => +v.toFixed(3))).toEqual(sunPosition(30, night.elevation, night.azimuth).map((v) => +v.toFixed(3)));
  });

  it('blends between two phases, and not under reduced motion', () => {
    const view = made();
    view.setTime(6 * MIN - BLEND_MS / 2, true);
    const mid = (view.scene.background as THREE.Color).getHex();
    expect(mid).not.toBe(air(WORLD_LOOKS.day.sky));
    expect(mid).not.toBe(air(WORLD_LOOKS.dusk.sky));
    view.setTime(6 * MIN - BLEND_MS / 2, false);
    expect((view.scene.background as THREE.Color).getHex()).toBe(air(WORLD_LOOKS.day.sky));
  });

  it('keeps the hero, the troop, the teleporters and the lairs lit at night: the glow follows the look', () => {
    const view = made();
    view.setTeleporters([[1, 1]]);
    view.setLogs([[2, 1]], []);
    view.setPlaces([{ kind: 'town', cell: [1, 2] }, { kind: 'dungeon', cell: [2, 2] }]);
    const glow = (name: string): number => ((view.scene.getObjectByName(name) as THREE.InstancedMesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
    const day = glow('teleporter-pad');
    const dayLog = glow('log-stake');
    const dayPlace = glow('town-pad');
    view.setTime(9 * MIN, true);
    expect(glow('town-pad')).toBeGreaterThan(dayPlace);
    expect(glow('gate-pad')).toBeGreaterThan(dayPlace);
    expect(glow('teleporter-pad')).toBeGreaterThan(day);
    expect(glow('town-hut')).toBeGreaterThan(dayPlace); // the huts' windows
    expect(glow('cairn')).toBeGreaterThan(CAIRN_LOOK.emissive); // the caps
    expect(glow('log-stake')).toBeGreaterThan(dayLog);
    expect(view.shine.value).toBe(1);
    view.setTime(MIN, true);
    expect(glow('teleporter-pad')).toBe(day);
    expect(glow('log-stake')).toBe(dayLog);
    expect(glow('town-pad')).toBe(dayPlace);
    expect(view.shine.value).toBe(0);
  });

});

describe('the sky of the Open world under the neon look (#1536)', () => {
  it('starts on the neon day: the black sky and fog, the cold sun, the violet-white hemisphere', () => {
    setNeonWorldOn(true);
    const view = made();
    const { sun, hemisphere } = lights(view);
    const day = NEON_WORLD_LOOKS.day;
    expect((view.scene.background as THREE.Color).getHex()).toBe(airNeon(NEON.sky));
    expect(view.scene.fog!.color.getHex()).toBe(airNeon(NEON.sky));
    expect([sun.color.getHex(), sun.intensity]).toEqual([day.sun, day.sunIntensity]);
    expect([hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity]).toEqual([day.hemiSky, day.hemiGround, day.hemiIntensity]);
  });

  it('turns to dusk and to night with the clock: the sky, the sun, the ambient, the glow, and draws again once', () => {
    setNeonWorldOn(true);
    const view = made();
    const { sun, hemisphere } = lights(view);
    expect(view.setTime(6 * MIN, true)).toBe(true);
    const dusk = NEON_WORLD_LOOKS.dusk;
    expect((view.scene.background as THREE.Color).getHex()).toBe(airNeon(dusk.sky));
    expect(view.scene.fog!.color.getHex()).toBe(airNeon(dusk.sky));
    expect([sun.color.getHex(), sun.intensity]).toEqual([dusk.sun, dusk.sunIntensity]);
    expect(hemisphere.color.getHex()).toBe(dusk.hemiSky);
    expect(view.shine.value).toBe(dusk.glow);
    const tint = (name: string) => ((view.scene.getObjectByName(name) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.r;
    expect([tint('starfield'), tint('sky-glow'), tint('terrain-water')]).toEqual([dusk.stars, dusk.horizon, new THREE.Color(dusk.water).r]);
    expect(view.setTime(9 * MIN, true)).toBe(true);
    const night = NEON_WORLD_LOOKS.night;
    expect([tint('starfield'), tint('sky-glow'), tint('terrain-water')]).toEqual([night.stars, night.horizon, new THREE.Color(night.water).r]);
    const motes = (view.scene.getObjectByName('particles') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(motes.opacity).toBeCloseTo(0.4); // half at night: no snow on the dark ground
    view.sparkle(1000, false);
    expect((view.scene.background as THREE.Color).getHex()).toBe(airNeon(night.sky));
    expect([sun.color.getHex(), sun.intensity]).toEqual([night.sun, night.sunIntensity]);
    expect([hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity]).toEqual([night.hemiSky, night.hemiGround, night.hemiIntensity]);
    expect(view.shine.value).toBe(1);
    expect(view.setTime(9.5 * MIN, true)).toBe(false); // the same look: nothing to draw
  });

  it('lights the white hero and troop more of their own at night than the terrace does, so the hero stays near white under the cyan moon', () => {
    setNeonWorldOn(true);
    const neon = made();
    setNeonWorldOn(false);
    const terrace = made();
    const share = (view: OpenWorldView, name: string) => (view.scene.getObjectByName(name) as THREE.Mesh).material as THREE.Material;
    expect(share(neon, 'hero').userData.glowShare).toBe(NEON_WHITE_GLOW);
    expect(share(neon, 'troop').userData.glowShare).toBe(NEON_WHITE_GLOW);
    expect(share(terrace, 'hero').userData.glowShare).toBe(GLOW_SHARE);
    expect(share(neon, 'enemies').userData.glowShare).toBe(0); // the foes do not shine
  });

  it('puts the neon sun where the night says, and keeps it there as the hero moves', () => {
    setNeonWorldOn(true);
    const view = made();
    const { sun } = lights(view);
    view.setTime(9 * MIN, true);
    view.show([2, 1]);
    const night = NEON_WORLD_LOOKS.night;
    expect(sun.position.clone().sub(view.focusPoint).toArray().map((v) => +v.toFixed(3))).toEqual(sunPosition(30, night.elevation, night.azimuth).map((v) => +v.toFixed(3)));
  });
});

describe('the glow of a marble (#1496)', () => {
  it('a striped marble with a glow emits its colour in proportion to it, none without', () => {
    const look = { base: 0xcfe8ff, stripe: 0x6fa8dc, roughness: 0.1 };
    const fade = stripeFadeNode();
    expect(stripedMaterial(look, fade).emissiveNode).toBeNull();
    const view = made();
    expect(stripedMaterial(look, fade, undefined, view.shine).emissiveNode).not.toBeNull();
  });
});
