// The neon look (#1424): direction A "Circuit Slab" of the sci-fi mockups (art/mockups/neon), dark slate cells in dark gaps, neon on
// edges only. Colours, materials, light and sky: the same board, geometry, rules and camera. The default look (#1424): `?look=terrace` is the way back to the terrace, for that visit only;
// it is never stored.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, clamp, color, dot, float, mix, normalize, normalView, positionViewDirection, output, pow, reflect, smoothstep, vec3, vec4 } from 'three/tsl';
import type { Deck } from './deck';
import type { Space } from './bossspace';
import { mixHex, type Phase, type WorldLook } from './daynight';

/** The approved numbers (mock/mock.js, directions.json). Neon is on edges, lines and lamps, never on a cell top. */
export const NEON = {
  sky: 0x04050c,
  cell: 0x5d6a82,
  gap: 0x0a0e18,
  /** The albedo of the gap floor: the hemisphere lights it up about three times, so it reads near `gap` on the screen. */
  gapFloor: 0x020307,
  /** The ground, lit about as it is painted: near the board and far from it, darker than a cell top and lighter than the rim. */
  ground: 0x1d2433,
  groundFar: 0x131824,
  plateau: 0x1d2433,
  rim: 0x0f1320,
  rimLight: 0x39466a,
  slab: 0x171c2b,
  cyan: 0x19e6ff,
  violet: 0x9a6bff,
  turn: 0x5fd0e6,
  crystal: 0x6a609f, // 30 % less saturated than the mockup's #7a62d8: never the loudest object
  pedestalRing: 0x7fd6e8,
  boulder: 0x2c2f36,
  blackMarble: 0x14161a,
  whiteMarble: 0xf2f0ea,
  /** The target arrow (#1508): the terrace's near-black, flat, so it reads 3:1 on the slate cell at phone size. */
  arrow: 0x0b0d0f,
} as const;

/** The target arrow's material (#1508): under the neon look, the flat near-black `NEON.arrow` (the kit's grey read 2.0:1 on phone);
 * the terrace keeps the kit's own arrow. */
const neonArrowMaterial = new THREE.MeshBasicMaterial({ name: 'neon_target_arrow', color: NEON.arrow });
export const targetArrowMaterial = (neon: boolean, kit: THREE.Material): THREE.Material => (neon ? neonArrowMaterial : kit);

/** The mock's light: a cold sun low on the left, a violet-tinted hemisphere, ACES at 1.15. */
export const NEON_LIGHT = { sun: 0xe8f0ff, sunIntensity: 3.2, elevation: 24, azimuth: 50, sky: 0x9a6bff, skyMix: 0xe8eeff, skyAmount: 1, ground: 0x2a3347, hemisphere: 2.9, exposure: 1 } as const;

/** The key of each deck under the neon look (#1551, art.md Decks): `key` is the violet rim's colour, `accent` the posts' glow. Palette tokens only (art.md, artpalette.test.ts). */
export const DECK_KEY: Record<Deck, { key: number; accent: number }> = {
  mess: { key: 0xd8d4c8, accent: 0xf2f0ea }, // a warm lamp, the worn laminate
  cargo: { key: 0x7fd6e8, accent: 0x5fd0e6 }, // cold slate, the ore dust
  furnace: { key: 0xd9822b, accent: 0x6a609f }, // sodium glow, the steam
  chapel: { key: 0x6a609f, accent: 0x9a6bff }, // candles, wood and wire
  bridge: { key: 0xe8f0ff, accent: 0x19e6ff }, // cold white, too clean
};
/** The key of a rogue-lite fight (#1554, art.md Decks): the violet of the run's own marks, on any deck, so the rim and the posts
 * tell a run's fight from a plain match on the same Mess arena at a glance. */
export const RUN_KEY: { key: number; accent: number } = { key: NEON.violet, accent: NEON.violet };
/** What a run's board says (#1554): its act (0 for the first) and whether an elite is being fought. */
export interface RunCue {
  act: number;
  elite: boolean;
}
/** An elite's posts: the palette's hazard sodium (art.md), a second hue on the violet of the run, the harsher fight. */
export const ELITE_ACCENT = 0xd9822b;
const DANGER = 0xff6b5a; // the palette's danger red
/** The run's key for `cue`: the violet leans to the danger red a quarter more each act, three quarters from the fourth act on, so a
 * later act reads redder and the stakes higher on the rim, the slab edge and the posts. An elite fight is all hazard sodium, rim and
 * posts, the harsher fight read from across the screen (art-opus, #1554 round 1). */
export function runKey({ act, elite }: RunCue): { key: number; accent: number } {
  if (elite) return { key: ELITE_ACCENT, accent: ELITE_ACCENT };
  const key = new THREE.Color(RUN_KEY.key).lerp(new THREE.Color(DANGER), Math.min(act, 3) / 4).getHex();
  return { key, accent: key };
}
/** The slab takes this much of its deck's key over the slate (`NEON.slab`), and the sky this much over `NEON.sky` (#1551). */
export const SLAB_TINT = 0.12;
/** The ground outside the board and the sky take this much of the key (#1551: the deck's identity is the surround). */
export const GROUND_TINT = 0.4;
/** The Hub's ground takes none (#1639): 0.4 of a pale key read pale grey round its deck, not the dark ground of art.md 1; its rim, posts, slab and sky still say the deck. */
export const HUB_GROUND_TINT = 0;
export const SKY_TINT = 0.25;
/** The brightest channel of the rim and the posts' glow: above 1, unlit (the rim read dim at 1.2). */
export const NEON_GLOW = 2.2;

/** The Open world's day, dusk and night under the neon look (#1536, the clock of daynight.ts). Day is the look above, as shipped. Dusk: the
 * sky takes a third of the violet over the black, the sun and the ambient lean violet too (no warm wash on the white marbles, art-1518),
 * the stars fade to half and the horizon glow doubles, the lakes take the violet. Night: the sky stays black, the moon is the pedestal
 * ring's cyan, the stars come out at 1.8, the horizon dims, the lakes go cyan, and the glow of the lairs, the marbles and the grid is
 * full. Only palette tokens, and mixes of them (art.md, section 1). */
/** The share of its colour a white marble of the Open world shines with at full glow under the neon look (the terrace's is 0.35): the
 * hero reads at #e0ded8 or above under the cyan moon (#1536 art, measured #e4f2f3 at 390). */
export const NEON_WHITE_GLOW = 0.8;

/** The Open world's day light (#1687), one place to tune: a warm sun high enough (52 degrees, the arena's is 24) that the shadows of the trees and rocks are short
 * blobs and never long diagonal bands across the ground, and a warm earth-tinted ambient in place of the cold violet-grey one. */
export const WORLD_DAY = { sun: 0xffe3bf, sunIntensity: 3.4, elevation: 52, azimuth: 50, hemiSky: 0xfff1de, hemiGround: 0x5a4d3c, hemiIntensity: 3.3 } as const;

export const NEON_WORLD_LOOKS: Readonly<Record<Phase, WorldLook>> = {
  day: { sky: NEON.sky, ...WORLD_DAY, water: 0xffffff, glow: 0, stars: 1, horizon: 1 },
  dusk: { sky: mixHex(NEON.sky, NEON.violet, 0.35), sun: mixHex(NEON_LIGHT.sun, NEON.violet, 0.45), sunIntensity: 2.4, elevation: 14, azimuth: 62, hemiSky: mixHex(NEON_LIGHT.skyMix, NEON.violet, 0.4), hemiGround: NEON.ground, hemiIntensity: 2.2, water: mixHex(0xffffff, NEON.violet, 0.35), glow: 0.4, stars: 0.5, horizon: 2 },
  night: { sky: NEON.sky, sun: NEON.pedestalRing, sunIntensity: 1.7, elevation: 38, azimuth: -30, hemiSky: NEON.rimLight, hemiGround: NEON.groundFar, hemiIntensity: 2.2, water: mixHex(mixHex(0xffffff, NEON.cyan, 0.3), NEON.sky, 0.5), glow: 1, stars: 1.8, horizon: 0.6 }, // the land 1.4:1 over the lakes (#1656)
};

/** The dishes are drawn this much smaller across: the gap between two cells (1 - the flat-to-flat of a 0.5 hexagon, 0.134) grows by 40 %, so the cyan line keeps its width and its dark floor at 390 px. */
/** The grid line of the neon look (#1535), one constant for the arena's cell gaps and the Open world's ground: a band `width` world units wide (the gap of the arena's hexagon, `outer` - `inner`), lit at `glow` in `colour`. */
export const NEON_LINE = { colour: NEON.cyan, glow: 1.4, inner: 0.53, outer: 0.56, width: 0.56 - 0.53 } as const;

export const NEON_CELL_SCALE = (1 - (1 - Math.sqrt(3) / 2) * 1.4) / (Math.sqrt(3) / 2);

/** Whether the Open world wears the look (set by `applyNeonWorld`, read by the world's view). */
let worldOn = false;
export const neonWorldOn = (): boolean => worldOn;
export const setNeonWorldOn = (on: boolean): void => {
  worldOn = on;
};

/** The neon look is the default (#1424): no `look` in the address, or `?look=neon`. `?look=terrace` is the way back to the terrace
 * look, for that visit only. The board looks `pbr` and `tonal` keep the terrace scene, as before. */
export function neonLookOn(search: string): boolean {
  const look = new URLSearchParams(search).get('look');
  return look === null || look === 'neon';
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const linear = (hex: number): THREE.Color => new THREE.Color(hex);

/** Where the sun stands, `distance` from what it lights: low on the left, or where a boss space puts it. */
export function neonSunPosition(distance = 30, elevation: number = NEON_LIGHT.elevation, azimuth: number = NEON_LIGHT.azimuth): [number, number, number] {
  const [el, az] = [(elevation * Math.PI) / 180, (azimuth * Math.PI) / 180];
  return [-distance * Math.cos(el) * Math.sin(az), distance * Math.sin(el), distance * Math.cos(el) * Math.cos(az)];
}

/** The sun and the hemisphere of the neon look; a boss space (#1551) changes the sun's colour, place and strength, and leans the hemisphere's sky to its key. */
export function lightNeon(sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight, space: Space | null = null): void {
  sun.color.set(space ? space.sun : NEON_LIGHT.sun);
  sun.intensity = NEON_LIGHT.sunIntensity * (space ? space.intensity : 1);
  sun.position.set(...(space ? neonSunPosition(30, space.elevation, space.azimuth) : neonSunPosition()));
  hemisphere.color.copy(linear(NEON_LIGHT.sky).lerp(linear(NEON_LIGHT.skyMix), NEON_LIGHT.skyAmount));
  if (space) hemisphere.color.lerp(linear(space.surround), space.sky * 0.2);
  hemisphere.groundColor.copy(linear(NEON_LIGHT.ground));
  hemisphere.intensity = NEON_LIGHT.hemisphere;
}

/** The sun and the hemisphere of the Open world's neon day (`WORLD_DAY`, #1687): the place of the sun is the view's own, set each frame from the sky. */
export function lightWorldDay(sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight): void {
  sun.color.set(WORLD_DAY.sun);
  sun.intensity = WORLD_DAY.sunIntensity;
  hemisphere.color.set(WORLD_DAY.hemiSky);
  hemisphere.groundColor.set(WORLD_DAY.hemiGround);
  hemisphere.intensity = WORLD_DAY.hemiIntensity;
}

/** Fine stars on a black sky: one draw call, a tiny triangle each facing the board, no haze (a Points sprite is not drawn by this renderer). */
export function neonStars(count = 1400, radius = 240): THREE.Mesh {
  const position = new Float32Array(count * 9);
  const colour = new Float32Array(count * 9);
  let s = 17;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const [centre, up, side] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < count; i++) {
    const [az, y] = [rnd() * Math.PI * 2, 0.02 + rnd() * rnd() * 0.98]; // denser near the horizon, where the camera looks
    const r = Math.sqrt(1 - y * y);
    centre.set(Math.cos(az) * r, y, Math.sin(az) * r);
    side.set(-Math.sin(az), 0, Math.cos(az));
    up.crossVectors(centre, side);
    const size = (0.25 + rnd() * 0.25) * (radius / 240);
    centre.multiplyScalar(radius);
    position.set([...centre.clone().addScaledVector(side, -size).toArray(), ...centre.clone().addScaledVector(side, size).toArray(), ...centre.clone().addScaledVector(up, size * 1.6).toArray()], i * 9);
    const k = 0.35 + rnd() * 0.65;
    for (let v = 0; v < 3; v++) colour.set([0.85 * k, 0.88 * k, k], i * 9 + v * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  const stars = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  stars.name = 'starfield';
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  return stars;
}

/** What the neon look leaves out of the arena file: the dome, clouds, haze, fog rings and the sun disc, the planet. The sky is black. */
export const NEON_HIDDEN = /^scene_(sky_|fogring|fogline)/;

type Paint = (g: THREE.BufferGeometry) => void;

function eachColour(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => THREE.Color): void {
  const c = g.attributes.color!;
  const v = new THREE.Vector3();
  for (let i = 0; i < c.count; i++) {
    const out = fn(v.set(c.getX(i), c.getY(i), c.getZ(i)));
    c.setXYZ(i, out.r, out.g, out.b);
  }
}

/** Keeps the file's light and shade (its bevels and baked occlusion), in `target` where the file was `ref`. */
const tone =
  (target: number, ref: number): Paint =>
  (g) => {
    const [t, r] = [linear(target), linear(ref)];
    const k = luma(r.r, r.g, r.b);
    eachColour(g, (v) => t.clone().multiplyScalar(luma(v.x, v.y, v.z) / k));
  };

/** The file's darkest colour becomes `dark`, its brightest `light`, the rest between. */
const ramp =
  (dark: number, light: number, lo: number, hi: number): Paint =>
  (g) => {
    const [d, l] = [linear(dark), linear(light)];
    const [a, b] = [linear(lo), linear(hi)].map((c) => luma(c.r, c.g, c.b)) as [number, number];
    eachColour(g, (v) => d.clone().lerp(l, THREE.MathUtils.clamp((luma(v.x, v.y, v.z) - a) / (b - a), 0, 1)));
  };

/** Like `tone`, with the colour going from `near` (round the board) to `far` (the plain), by distance from the board's centre. */
const distanceTone =
  (near: number, far: number, ref: number): Paint =>
  (g) => {
    const [a, b, r] = [linear(near), linear(far), linear(ref)];
    const k = luma(r.r, r.g, r.b);
    const p = g.attributes.position!;
    const c = g.attributes.color!;
    for (let i = 0; i < c.count; i++) {
      const t = THREE.MathUtils.clamp((Math.hypot(p.getX(i), p.getZ(i)) - 12) / 30, 0, 1);
      const out = a.clone().lerp(b, t).multiplyScalar(luma(c.getX(i), c.getY(i), c.getZ(i)) / k);
      c.setXYZ(i, out.r, out.g, out.b);
    }
  };

/** One flat colour, whatever the file had. */
const flatColour =
  (hex: number): Paint =>
  (g) => {
    const c = linear(hex);
    eachColour(g, () => c);
  };

/** The paint of each node of the arena file, by name (the means and extremes read from arena.glb). */
const RULES: [RegExp, Paint][] = [
  [/^scene_(cell|ballast_cell|dual_cell|dual_cell_n|hub_cell|royale_cell)_?\d+$/, tone(NEON.cell, 0xb3a98a)],
  [/^scene_(slab_arena|ballast_slab|dual_slab_[ns]|slab_hub|royale_slab)$/, ramp(NEON.gapFloor, NEON.rim, 0x2a3540, 0xa29e9a)],
  [/^scene_post/, ramp(NEON.slab, NEON.rimLight, 0x3b3b3d, 0xd8d4c8)],
  [/^scene_col_map_b/, distanceTone(NEON.ground, NEON.groundFar, 0x818d8d)],
  [/^scene_col_plateau/, distanceTone(NEON.plateau, NEON.groundFar, 0x746d59)],
  [/^scene_(cairn|crew)/, tone(NEON.boulder, 0x918f89)],
  [/^scene_outcrop/, tone(NEON.crystal, 0x38938b)],
  [/^scene_tower_body/, ramp(NEON.gapFloor, NEON.rim, 0x35383b, 0x797a78)],
  [/^scene_tower_lamp/, flatColour(NEON.violet)],
  [/^scene_wall_claim/, ramp(NEON.gap, NEON.rimLight, 0x000000, 0xd9d4c8)],
  [/^scene_ridge/, tone(0x131a28, 0x8ba1a9)],
  [/^scene_turnbar/, flatColour(NEON.turn)],
  [/^kit_pedestal/, flatColour(NEON.plateau)],
];

/** Repaints the geometry of the node `name` in place; a node the look does not know keeps its colours. */
export function neonPaint(name: string, geometry: THREE.BufferGeometry): void {
  RULES.find(([re]) => re.test(name))?.[1](geometry);
}

/** The slab of each deck's board (every deck's arena, ballast, dual, hub and royale slab). */
const SLAB = /^scene_(slab_arena|ballast_slab|dual_slab_[ns]|slab_hub|royale_slab)$/;
/** The ground outside the board, one material, tinted per deck. */
const GROUND = /^scene_col_(map_b|plateau)/;

/** The lit materials: the glass of the cells, the slate of the rest, the slab (tinted per deck); and the lamps, which no light touches. */
const lit = new Map<string, THREE.Material>();
export function neonMaterial(name: string): THREE.Material {
  const kind = /^scene_tower_lamp/.test(name) ? 'lamp' : /^scene_(cell|ballast_cell|dual_cell|hub_cell|royale_cell)/.test(name) || name === 'dish' ? 'glass' : /^scene_turnbar/.test(name) ? 'bar' : SLAB.test(name) ? 'slab' : GROUND.test(name) ? 'ground' : 'slate';
  if (!lit.has(kind)) {
    lit.set(
      kind,
      kind === 'lamp' || kind === 'bar'
        ? new THREE.MeshBasicMaterial({ name: `neon_${kind}`, vertexColors: true, fog: false, color: new THREE.Color().setScalar(kind === 'lamp' ? 2.2 : 0.8) })
        : new THREE.MeshStandardMaterial({ name: `neon_${kind}`, vertexColors: true, roughness: kind === 'glass' ? 0.42 : 0.7, metalness: 0.1 }),
    );
  }
  return lit.get(kind)!;
}

/** The rim of the black shell (#1552): a fresnel glow in the cyan ring's colour, so the shell's edge reads on the dark gap
 * it stands over (0x0a0e18, 1.1:1 without it). `strength` scales the glow, `power` narrows it to the silhouette. */
export const NEON_RIM = { colour: NEON.pedestalRing, strength: 2.2, power: 2 } as const;

/** The sun's highlight on a marble under the neon look (#1553): sharper than the terrace's (black 0.3 and specular 0.12, white 0.6). */
export const NEON_GLOSS = { roughness: { black: 0.3, white: 0.4 }, specularIntensity: 0.5 } as const;
/** The soft rim of the white marble (#1553): a pale cool edge, weaker than the black shell's cyan, so the white does not bloom. */
export const NEON_WHITE_RIM = { colour: 0xbfd0e0, strength: 0.35, power: 3 } as const;
/** The white marble's shade under the neon look (#1553, slice B): its colour is `floor` on the side away from the sun and `lit` on the
 * side facing it, by the normal in view space (a colour node, no map, no pass). `lit` below 1 keeps the lit cap off 255 (clipped
 * at 255 before, measured on the bot game). `light` is the sun's side, left and up, in view space. */
export const NEON_WHITE_SHADE = { floor: 0.5, lit: 0.85, light: [-0.5, 0.7, 0.5] as const } as const;
/** The marble an Open world's enemies or hero wear (#1558): under the neon look and the default skin, the arena's own marble (the terrace's
 * black shell or white glass, with its rim); a skin the player chose, or the look off, is worn as it is. */
export function neonShellFor<M>(neon: boolean, defaultSkin: boolean, terrace: M, worn: M): M {
  return neon && defaultSkin ? terrace : worn;
}

/** The dark line round the Open world's hero under the look (#1656): near black where the fresnel passes `from`, full from `to` (2.6 px
 * on the 15.7 px hero at 390 px), so the white reads on the brightest grounds, where it fell to 3.9:1. */
export const NEON_HERO_RIM = { colour: 0x0b0f18, from: 0.38, to: 0.45 } as const;

/** Draws `NEON_HERO_RIM` on a marble's silhouette, in place of what the light, the gloss and the glow give there: the line stays near
 * black in every light. The look off, nothing changes. */
export function neonHeroRim<M extends THREE.Material & { outputNode?: unknown }>(material: M, on: boolean): M {
  if (!on) return material;
  const edge = smoothstep(NEON_HERO_RIM.from, NEON_HERO_RIM.to, float(1).sub(abs(dot(normalView, positionViewDirection))));
  material.outputNode = mix(output, vec4(color(NEON_HERO_RIM.colour), output.a), edge);
  material.userData.heroRim = true;
  return material;
}

/** The marbles under the neon look (#1552, #1553): a fresnel rim on both colours (cyan on the black shell, a soft pale edge on the
 * white) and the sharper highlight of `NEON_GLOSS`. The look off, the material is left as it is. */
export function neonMarbleRim<M extends THREE.Material>(side: 'black' | 'white', material: M, on: boolean): M {
  if (!on) return material;
  const rim = side === 'black' ? NEON_RIM : NEON_WHITE_RIM;
  // A TSL emissive node, not onBeforeCompile: the renderer is WebGPU (its WebGL 2 fallback too), which never runs that hook.
  // The node replaces the emissive, so the marble's own glow is its base: its emissive node (the Open world's glow), else its emissive.
  const own = (material as { emissiveNode?: ReturnType<typeof color> }).emissiveNode;
  const base = (own ?? color('emissive' in material ? (material.emissive as THREE.Color) : new THREE.Color(0))) as ReturnType<typeof color>;
  const fresnel = float(1).sub(abs(dot(normalView, positionViewDirection)));
  const gloss: Record<string, number> = { roughness: NEON_GLOSS.roughness[side] };
  if (material instanceof THREE.MeshPhysicalMaterial) gloss.specularIntensity = NEON_GLOSS.specularIntensity;
  // The white's lit cap clipped at 255 (#1553, measured): its colour falls to `floor` on the side away from the sun, the volume back.
  // Its colour is the marble's colour node when it has one (the Open world's stripe), so the shade keeps the stripe.
  const [lx, ly, lz] = NEON_WHITE_SHADE.light;
  const facing = clamp(dot(normalView, normalize(vec3(lx, ly, lz))), 0, 1);
  const tint = (material as { colorNode?: ReturnType<typeof color> }).colorNode ?? color((material as unknown as THREE.MeshStandardMaterial).color);
  const shade = side === 'white' ? { colorNode: tint.mul(mix(float(NEON_WHITE_SHADE.floor), float(NEON_WHITE_SHADE.lit), facing)) } : {};
  return Object.assign(material, {
    ...gloss,
    ...shade,
    emissiveNode: (color(rim.colour).mul(fresnel.pow(float(rim.power))).mul(float(rim.strength)) as ReturnType<typeof color>).add(base),
  });
}

/** The reflection of the sky on a marble (#1553), the same under both looks: a soft sky on the upper half of the sphere that grows
 * toward the edge, and a window of the sun, small and bright. `sky` and `spot` scale them per side; the white takes a hint, so it does
 * not bloom. `light` is the sun's side in view space, left and up, as `NEON_WHITE_SHADE.light`. */
export const NEON_SHEEN = { black: { sky: 0.6, spot: 3 }, white: { sky: 0.06, spot: 0.4 }, tint: 0xa8cfe6, light: [-0.5, 0.7, 0.5] as const, tight: 40 } as const;

/** Adds the sheen to the marble's emissive, whatever it holds (its glow, the neon rim): a colour node of the reflection vector, with
 * no envMap (left out under automation and on the low tier, where the black shell was a flat disc), no map and no draw call. */
export function marbleSheen<M extends THREE.Material>(side: 'black' | 'white', material: M): M {
  const { sky, spot } = NEON_SHEEN[side];
  const own = (material as { emissiveNode?: ReturnType<typeof color> }).emissiveNode;
  const base = (own ?? color('emissive' in material ? (material.emissive as THREE.Color) : new THREE.Color(0))) as ReturnType<typeof color>;
  const view = normalView;
  const r = reflect(positionViewDirection.negate(), view);
  const [lx, ly, lz] = NEON_SHEEN.light;
  const window = pow(clamp(dot(r, normalize(vec3(lx, ly, lz))), 0, 1), float(NEON_SHEEN.tight));
  const up = clamp(r.y, 0, 1);
  const edge = float(0.5).add(float(1).sub(abs(dot(view, positionViewDirection))));
  const lift = color(NEON_SHEEN.tint).mul(up.mul(edge).mul(float(sky)).add(window.mul(float(spot))));
  return Object.assign(material, { emissiveNode: base.add(lift as unknown as typeof base) });
}

/** The thin cyan hexagon of a cell, drawn in its gap: the brightest line of the board. One instance per cell. */
export function neonEdgeGeometry(inner: number = NEON_LINE.inner, outer: number = NEON_LINE.outer, y = 0.07, turn = 0): THREE.BufferGeometry {
  const position: number[] = [];
  const at = (r: number, k: number): [number, number, number] => [Math.sin((k * Math.PI) / 3 + turn) * r, y, Math.cos((k * Math.PI) / 3 + turn) * r];
  for (let k = 0; k < 6; k++) position.push(...at(inner, k), ...at(outer, k), ...at(outer, k + 1), ...at(inner, k), ...at(outer, k + 1), ...at(inner, k + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  return g;
}

export const neonEdgeMaterial = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ name: 'neon_edge', color: new THREE.Color(NEON_LINE.colour).multiplyScalar(NEON_LINE.glow), fog: false, side: THREE.DoubleSide });

/** The kit's pedestal under a marble, in slate with a thin cyan ring on its rim (60 % cyan): a copy, the file's own stays as it is. */
export function neonPedestal(pedestal: THREE.Mesh): THREE.Mesh {
  const copy = pedestal.clone();
  const disc = pedestal.geometry.clone();
  const source = disc.attributes.color!;
  disc.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: source.count }, (_, i) => [source.getX(i), source.getY(i), source.getZ(i)]).flat(), 3)); // the file's may be 8 bit or have an alpha
  neonPaint(pedestal.name, disc);
  const ring = new THREE.RingGeometry(0.345, 0.37, 36).rotateX(-Math.PI / 2).translate(0, 0.1125, 0);
  const ringColour = linear(NEON.plateau).lerp(linear(NEON.pedestalRing), 0.6);
  ring.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: ring.attributes.position!.count }, () => ringColour.toArray()).flat(), 3));
  const parts = [disc, ring].map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(flat.attributes)) if (!['position', 'normal', 'color'].includes(name)) flat.deleteAttribute(name);
    return flat;
  });
  copy.geometry = mergeGeometries(parts, false);
  copy.material = neonMaterial('slate');
  return copy;
}

/** The glow of the rim (the deck's key) and of the posts (its accent): one material each, brightest channel at 1.2 (unlit). */
const glows = new Map<'rim' | 'post', THREE.MeshBasicMaterial>();
const glowColour = (hex: number): THREE.Color => {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(NEON_GLOW / Math.max(...c.toArray()));
};
function glowMaterial(kind: 'rim' | 'post'): THREE.MeshBasicMaterial {
  if (!glows.has(kind)) {
    const deck = DECK_KEY.mess;
    glows.set(kind, new THREE.MeshBasicMaterial({ name: `neon_${kind}`, color: glowColour(kind === 'rim' ? deck.key : deck.accent), fog: false, side: THREE.DoubleSide }));
  }
  return glows.get(kind)!;
}

/** The sky of a deck under the neon look: `NEON.sky` with a little of the deck's key (#1551). */
export const neonSkyOf = (deck: Deck, space: Space | null = null): THREE.Color =>
  new THREE.Color(NEON.sky).lerp(new THREE.Color(space ? space.surround : DECK_KEY[deck].key), space ? space.sky : SKY_TINT);

/** The deck in play under the neon look (#1551): the slab takes its key over the slate, the rim glows in its key, the posts in its accent. The Hub (`hub`) keeps its ground dark (#1639). */
export function neonDeckLook(deck: Deck, run: RunCue | null = null, space: Space | null = null, hub = false): void {
  const { key, accent } = run ? runKey(run) : (space ?? DECK_KEY[deck]);
  // The slab's vertex colours run from the gap floor up to the rim: the rim's colour times this is the tinted slate.
  const [slab, top] = [new THREE.Color(NEON.slab).lerp(new THREE.Color(key), SLAB_TINT), new THREE.Color(NEON.rim)];
  (neonMaterial('scene_slab_arena') as THREE.MeshStandardMaterial).color.setRGB(slab.r / top.r, slab.g / top.g, slab.b / top.b);
  const ground = new THREE.Color(NEON.ground).lerp(new THREE.Color(space ? space.surround : key), hub ? HUB_GROUND_TINT : space ? space.ground : GROUND_TINT);
  const base = new THREE.Color(NEON.ground);
  (neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color.setRGB(ground.r / base.r, ground.g / base.g, ground.b / base.b);
  glowMaterial('rim').color.copy(glowColour(key));
  glowMaterial('post').color.copy(glowColour(accent));
}

/** The violet channel along the inner top edge of the slab's rim (about 0.05 of a cell wide) and a glowing band and tip on each post, unlit at 1.2. */
export function neonGlow(posts: readonly THREE.Vector3[], rim: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'neon_glow';
  const postGlow = glowMaterial('post');
  if (rim) group.add(new THREE.Mesh(neonEdgeGeometry(4.93, 4.98, 0.158, Math.PI / 6), glowMaterial('rim'))); // the rim's inner top edge (slab_arena: a flat-top hexagon of 4.9)
  for (const p of posts) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.147, 0.147, 0.05, 8, 1, true), postGlow);
    band.position.set(p.x, p.y + 0.7, p.z);
    const tip = new THREE.Mesh(new THREE.CircleGeometry(0.098, 8).rotateX(-Math.PI / 2), postGlow);
    tip.position.set(p.x, p.y + 1.075, p.z);
    group.add(band, tip);
  }
  return group;
}

/** The tells of the bosses under the look (#1424). Measured on the rendered game against a cell (about #5b6b8c), 3:1: a thin line is
 * mostly anti-aliased pixels, so every tell is thick and solid, either near black (`ink`) or bright (`sodium`), and never tone mapped. */
export const NEON_TELL = {
  ink: 0x05060a,
  /** The outline of a fogged cell: pale cyan (the cyan of the edge lines reads 1.6:1 on a cell once thin and anti-aliased). */
  outline: 0xe6ffff,
  sodium: 0xfff0c0,
  /** The tube of the rings round a marble or on a cell (the game's is 0.025). */
  ringTube: 0.11,
  /** The Choir's glyphs and the Rail Yard's chevrons, drawn this much larger. */
  glyph: 1,
  chevron: 2.4,
  /** The Alien's counter plate, drawn this much larger. */
  plate: 2.2,
  /** The plate stands this much higher, clear of the egg. */
  plateLift: 0.25,
  /** The fog is outlined on every fogged cell (1, the game's own veil is unaffected) or on the sight edge only (0). */
  fogRings: 0,
  /** The sides of the rings: a hexagon, the shape of a cell, in place of the game's circle (the Choir's next army reads apart from its Tenor ring). */
  ringSides: 6,
  /** The radius of the rings: smaller, so that the rings of two neighbours do not join (the game's is 0.42). */
  ringRadius: 0.42,
  /** The cracks of the battle royale are one cream band: no decal on its cells. */
  arenaDecal: 0,
  /** The inner radius of the Pulsar's shockwave ring, of 1 (the game's is 0.96). */
  shockInner: 0.92,
  /** The egg is drawn this much larger: a small egg is mostly anti-aliased pixels. */
  egg: 1.3,
  /** The shockwave of a Pulsar is drawn at 0.05, under the dish tops (0.1): this much higher. */
  lift: 0.07,
  /** The cracks of the battle royale are drawn at the arena's local 0.003, under the dish tops at 0.1 (the arena is half size): this much higher. */
  arenaLift: 0.22,
  /** The glow under an egg about to hatch never falls below this (it pulses with the game's own). */
  glowFloor: 1,
  /** The opacity of the Stalker's fog. */
  fog: 0.97,
  /** The glow of a cell about to void in the battle royale: sodium and opaque, the game's is the palette's hazard at 55 %. */
  breachTint: 0xfff0c0,
  breachMix: 1,
  breachOpacity: 1,
} as const;
const GAME_TELL = { ringTube: 0.025, glyph: 1, chevron: 1, plate: 1, plateLift: 0, fogRings: 1, shockInner: 0.96, ringSides: 32, ringRadius: 0.42, arenaDecal: 1, egg: 1, lift: 0, arenaLift: 0, glowFloor: 0, breachTint: 0, breachMix: 0, breachOpacity: 0.55 } as const;
/** The sizes the tells are drawn with: the look's, or the game's own. */
export const tellLook = (on: boolean): { readonly [K in keyof typeof GAME_TELL]: number } => (on ? NEON_TELL : GAME_TELL);

/** The mask of a crack, a DataTexture of `size` pixels (plain bytes, no canvas): seven forking fissures from the middle, 19 % of the width thick. */
export function neonCrackMap(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const segments: [number, number, number, number][] = [];
  [0, 51, 103, 154, 206, 257, 309].forEach((deg, arm) => {
    let [x, y, a] = [0, 0, (deg * Math.PI) / 180];
    for (let k = 0; k < 3; k++) {
      a += (((arm + k) % 3) - 1) * 0.28; // the fissure bends
      const [nx, ny] = [x + Math.cos(a) * 0.16, y + Math.sin(a) * 0.16];
      segments.push([x, y, nx, ny]);
      [x, y] = [nx, ny];
    }
  });
  const half = 0.095;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const [px, py] = [(i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5];
      const near = segments.some(([ax, ay, bx, by]) => {
        const [dx, dy] = [bx - ax, by - ay];
        const t = THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= half;
      });
      data.set([near ? 255 : 0, near ? 255 : 0, near ? 255 : 0, 255], (j * size + i) * 4);
    }
  const map = new THREE.DataTexture(data, size, size);
  map.needsUpdate = true;
  return map;
}

/** The materials the look dresses (main.ts): the Hull's crack, the Alien's egg and its glow, the Rail Yard's chevrons, the Swarm's marks, the pale tells of the Choir (their colour is the palette's, set at each draw: only the tone mapping is the look's). */
export interface TellMaterials {
  crack: THREE.MeshBasicMaterial;
  egg: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  chevron: THREE.MeshBasicMaterial;
  arrival: THREE.MeshBasicMaterial;
  pale: THREE.MeshBasicMaterial;
}
export function neonTells(m: TellMaterials): void {
  m.crack.alphaMap = neonCrackMap();
  m.crack.color.setHex(NEON_TELL.sodium); // cream on the slate, not black
  m.egg.map = null; // an unlit near-black egg: lit, its sheen came up to the cell's own light
  m.egg.color.setHex(0xffffff); // the vertex colours decide: near black for the body, bone for the collar
  m.egg.vertexColors = true;
  m.egg.emissive.setHex(NEON_TELL.ink);
  m.egg.roughness = 1;
  m.egg.metalness = 0;
  for (const sodium of [m.glow, m.chevron, m.arrival]) sodium.color.setHex(NEON_TELL.sodium);
  for (const material of Object.values(m)) {
    material.toneMapped = false;
    material.needsUpdate = true;
  }
}

/** The Stalker's veil: one cell's worth, a near-black hexagon in a cyan outline of the cell's own shape (vertex colours). */
export function neonFogGeometry(): THREE.BufferGeometry {
  const position: number[] = [];
  const colour: number[] = [];
  const at = (r: number, k: number, y: number): [number, number, number] => [Math.sin((k * Math.PI) / 3) * r, y, Math.cos((k * Math.PI) / 3) * r];
  const paint = (hex: number, n: number): void => {
    const c = linear(hex);
    for (let i = 0; i < n; i++) colour.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < 6; k++) position.push(0, 0, 0, ...at(0.5, k, 0), ...at(0.5, k + 1, 0));
  paint(NEON_TELL.ink, 18);
  for (let k = 0; k < 6; k++) position.push(...at(0.24, k, 0.002), ...at(0.52, k, 0.002), ...at(0.52, k + 1, 0.002), ...at(0.24, k, 0.002), ...at(0.52, k + 1, 0.002), ...at(0.24, k + 1, 0.002));
  paint(NEON_TELL.outline, 36);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
  return g;
}
export function neonVeil(material: THREE.MeshBasicMaterial, veil: THREE.InstancedMesh): void {
  veil.geometry = neonFogGeometry();
  material.vertexColors = true;
  material.color.setHex(0xffffff);
  material.opacity = NEON_TELL.fog;
  material.toneMapped = false;
  material.needsUpdate = true;
}

/** The Alien's egg: an ovoid near black with a bone collar ring round its middle, so it is no black marble. One geometry, vertex colours. */
export function neonEggGeometry(scale = NEON_TELL.egg): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.17, 24, 16).scale(1, 1.35, 1).scale(scale, scale, scale).translate(0, 0.23 * scale, 0).toNonIndexed();
  const collar = new THREE.TorusGeometry(0.19 * scale, 0.06 * scale, 6, 24).rotateX(Math.PI / 2).translate(0, 0.23 * scale, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
    const c = linear(hex);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position!.count }, () => c.toArray()).flat(), 3));
    g.deleteAttribute('uv');
    return g;
  };
  return mergeGeometries([paint(body, NEON_TELL.ink), paint(collar, 0xffffff)])!;
}

/** A hexagonal fill a little wider than a cell: the cells about to void in the battle royale make one continuous band. */
export function neonBreachGeometry(): THREE.BufferGeometry {
  const position: number[] = [];
  const at = (k: number): [number, number, number] => [Math.sin((k * Math.PI) / 3) * 0.53, 0, Math.cos((k * Math.PI) / 3) * 0.53];
  for (let k = 0; k < 6; k++) position.push(0, 0, 0, ...at(k), ...at(k + 1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  return g;
}

/** 1 when a cell of the board has a neighbour that `seen` says is in sight, else 0: the sight edge of the Stalker's fog. */
export const nextToSight = (q: number, r: number, seen: (q: number, r: number) => boolean): number =>
  Number([[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]].some(([a, b]) => seen(q + a!, r + b!)));

/** The pale outline of a cell that is gone (a Hull void), over the dark floor. */
export const neonVoidGeometry = (): THREE.BufferGeometry => neonEdgeGeometry(0.3, 0.52, 0.075);
export const neonVoidMaterial = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ name: 'neon_void', color: 0xe6ffff, fog: false, toneMapped: false, side: THREE.DoubleSide });
