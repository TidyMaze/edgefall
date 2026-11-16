// The edge of an Open world ground cell (#1138): the top of each hex prism gets a thin band along its six edges, a soft dark seam on
// land so the cells read as tidy tiles, a soft light line on water. It is a colour node of the ground's material (no texture, no
// extra mesh, no extra draw call): the band is computed from the prism's own position, before the instance moves it.
import * as THREE from 'three/webgpu';
import { abs, attribute, color, float, fwidth, length, materialColor, max, mix, positionLocal, positionWorld, sin, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { Biome } from './openworld';

/** The radius of a ground prism (a hex of side 0.56 tiles the grid of spacing 1 with a thin gap) and its apothem. */
export const HEX_RADIUS = 0.56;
export const HEX_APOTHEM = HEX_RADIUS * Math.cos(Math.PI / 6);
/** The width of the band along an edge, in world units. */
export const EDGE_WIDTH = 0.07;
/** How much the band changes the cell's colour: a share of it taken away on land, added on water. */
export const EDGE_GAIN = { land: -0.22, water: 0.5 };

/** The surface detail of the land (#1555): a striation of two waves over the top of each cell, a share of its colour lighter or darker,
 * in world space so the bands run across the cells. Procedural: no texture, no draw call, and the hue of the cell is kept. */
export const SURFACE_DETAIL = { amplitude: 0.05, phone: 0.12, glow: 0.15, frequency: 2.1, warp: 1.3, warpFrequency: 0.37 } as const;
/** The widest screen (CSS px) that takes the phone's amplitude: at 390 the bands of 0.12 read faint (#1555). */
export const PHONE_WIDTH = 600;
/** The striation of each biome (#1555): its frequency (bands per world unit, times 2 pi) and how much the bands bend. The meadow keeps
 * the first slice's; the forest's are dense and wavy, the tundra's long and straight drifts, the desert's wide bent dunes, the
 * badlands' tight straight strata, the archipelago's soft swells. */
export const BIOME_DETAIL: Record<Biome, { frequency: number; warp: number }> = {
  meadow: { frequency: SURFACE_DETAIL.frequency, warp: SURFACE_DETAIL.warp },
  forest: { frequency: 3.2, warp: 2.2 },
  tundra: { frequency: 1.4, warp: 0.4 },
  desert: { frequency: 1, warp: 2.6 },
  badlands: { frequency: 3.8, warp: 0.2 },
  archipelago: { frequency: 1.7, warp: 1.8 },
};
/** The direction of the striation (a unit vector in x, z). */
const STRIPE = [0.6, 0.8] as const;

/** The plain form of the striation's factor at the point `(x, z)` in `biome`: the colour of a land top times it, within `1 +- amplitude`. */
export const surfaceDetail = (x: number, z: number, biome: Biome = 'meadow'): number => {
  const { amplitude, warpFrequency } = SURFACE_DETAIL;
  const { frequency, warp } = BIOME_DETAIL[biome];
  return 1 + amplitude * Math.sin((x * STRIPE[0] + z * STRIPE[1]) * frequency + Math.sin(z * warpFrequency) * warp);
};

/** The zooms the striation fades over (#1714): full up to `from`, none from `to`, where its bands are a few pixels wide and read as stripes. */
export const DETAIL_FADE = { from: 2, to: 4 } as const;

/** The amplitude of the striation: none on the low tier (`on` false), the phone's on a screen `width` px wide or narrower, faded out by a wide `zoom`. */
export const surfaceAmplitude = (on: boolean, width: number, zoom = 1): number => {
  if (!on) return 0;
  const fade = Math.min(1, Math.max(0, (DETAIL_FADE.to - zoom) / (DETAIL_FADE.to - DETAIL_FADE.from)));
  return (width <= PHONE_WIDTH ? SURFACE_DETAIL.phone : SURFACE_DETAIL.amplitude) * fade;
};

/** The uniforms of the striation, shared by the land materials: set by the view (the tier, the screen, the hero's biome), no recompile. */
export interface SurfaceUniforms {
  amplitude: THREE.UniformNode<'float', number>;
  frequency: THREE.UniformNode<'float', number>;
  warp: THREE.UniformNode<'float', number>;
}
export const surfaceUniforms = (): SurfaceUniforms => ({ amplitude: uniform(SURFACE_DETAIL.amplitude), frequency: uniform(SURFACE_DETAIL.frequency), warp: uniform(SURFACE_DETAIL.warp) });

/** The edges of a `CylinderGeometry` prism of six sides have their normals at 30, 90 and 150 degrees from +z. */
const NORMALS = [0, 1, 2].map((k) => [Math.sin(Math.PI / 6 + (k * Math.PI) / 3), Math.cos(Math.PI / 6 + (k * Math.PI) / 3)] as const);

/** The distance from the point `(x, z)` of a prism's top to the nearest edge of its hex (the plain form of the shader's maths). */
export const edgeDistance = (x: number, z: number): number => HEX_APOTHEM - Math.max(...NORMALS.map(([nx, nz]) => Math.abs(x * nx + z * nz)));

/** The shader's `edgeDistance`: the distance of a point of the top to its hex's nearest edge, from the prism's own position (before the
 * instance moves it), so a band along the edges costs no texture. */
export function edgeDistanceNode() {
  const position = attribute('position', 'vec3');
  const flat = vec2(position.x, position.z);
  const across = NORMALS.map(([nx, nz]) => abs(flat.dot(vec2(nx, nz))));
  return float(HEX_APOTHEM).sub(max(max(across[0]!, across[1]!), across[2]!));
}

/** The band fades out between these widths on screen, in pixels: at 1 px or less it beats against the pixel grid (moire, #1347). */
export const FADE_FROM_PX = 0.75;
export const FADE_TO_PX = 2;

/** The share of the band kept when it is `widthPx` pixels wide on screen (the plain form of the shader's maths). */
export const edgeFade = (widthPx: number): number => {
  const t = Math.min(1, Math.max(0, (widthPx - FADE_FROM_PX) / (FADE_TO_PX - FADE_FROM_PX)));
  return t * t * (3 - 2 * t);
};

/** The share a prism's radius grows by at the widest zoom: 2 % past the radius 1 / sqrt(3) of a hex that tiles the grid of spacing 1 with no gap,
 * so neighbours overlap a hair and no crack is left at a corner. The gap shows as dark dots that shimmer once under a pixel (#1347). */
export const GAP_FILL = (1.02 / Math.sqrt(3)) / HEX_RADIUS - 1;
/** The zoom the gap starts to close at, and the zoom it is closed at. */
export const GAP_FROM_ZOOM = 1.8;
export const GAP_TO_ZOOM = 3;

/** The share the prisms' radius grows by at `zoom` (the plain form of the `widen` uniform): 0 at the close view, `GAP_FILL` from `GAP_TO_ZOOM`. */
export const gapFill = (zoom: number): number => {
  const t = Math.min(1, Math.max(0, (zoom - GAP_FROM_ZOOM) / (GAP_TO_ZOOM - GAP_FROM_ZOOM)));
  return GAP_FILL * t * t * (3 - 2 * t);
};

/** The neon look's traces (#1424), all in the ground's shader: no mesh, no draw call. `hero` is where the hero stands (x, z). */
export interface NeonGrid {
  hero: THREE.UniformNode<'vec2', THREE.Vector2>;
  traces: THREE.Texture;
}
/** The look's numbers: each trace is its own cell's ground `trace` lighter in linear light, so at most 1.2:1 over it, and no colour of
 * its own (#1656; the cyan grid line is the arena's alone); quieter far from the hero (full within `NEAR`, a fifth past `FAR`), and the far
 * ground darker, and a `floor` of light (linear RGB) under the darkest rock and water so no ground reads as the sky colour #04050c at the
 * screen edge. */
export const NEON_GRID = { trace: 0.2, quiet: 0.2, near: 6, far: 18, farDim: 0.55, traceScale: 1 / 40, floor: [0.0008, 0.0015, 0.003] } as const;

/** A ground material: white until an instance colours it (the colour comes per cell), with the edge band of `gain` on the top face and
 * the `emissiveNode` given in place of the plain emissive colour. */
export function edgeMaterial(look: { emissive: number; roughness: number; gain: number; emissiveNode?: THREE.Node; positionNode?: THREE.Node; widen?: THREE.UniformNode<'float', number>; neon?: NeonGrid; detail?: SurfaceUniforms }): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: look.emissive, roughness: look.roughness });
  const distance = edgeDistanceNode();
  const band = float(1).sub(smoothstep(0, EDGE_WIDTH, distance));
  const pixel = fwidth(distance).max(1e-6); // the world length of a pixel across the edge: a wide zoom thins the band under it
  const fade = smoothstep(FADE_FROM_PX, FADE_TO_PX, float(EDGE_WIDTH).div(pixel));
  const top = step(0.5, attribute('normal', 'vec3').y); // the sides of the column keep their colour
  const shaded = materialColor.mul(float(1).add(band.mul(top).mul(fade).mul(look.gain)));
  let lift: THREE.Node | null = null;
  if (look.detail) {
    // the striation on the tops of the land only (`top`), the sides keep their colour (#1555): procedural, so it works on WebGPU and WebGL2 alike
    const flatWorld = vec2(positionWorld.x, positionWorld.z);
    const { amplitude, frequency, warp } = look.detail;
    const wave = sin(flatWorld.dot(vec2(STRIPE[0], STRIPE[1])).mul(frequency).add(sin(flatWorld.y.mul(SURFACE_DETAIL.warpFrequency)).mul(warp)));
    material.colorNode = shaded.mul(float(1).add(wave.mul(amplitude).mul(top)));
    // under the neon night the lit colour is near black, so a share of it barely moves: the light bands also glow a share of the cell's
    // own colour, so they read on a phone (#1555 art round 1)
    lift = materialColor.mul(max(wave, 0).mul(amplitude).mul(top).mul(SURFACE_DETAIL.glow));
  } else material.colorNode = shaded;
  if (look.emissiveNode) material.emissiveNode = look.emissiveNode; // the water's foam and ripples (#1101)
  if (look.neon) {
    const { hero, traces } = look.neon;
    const flatWorld = vec2(positionWorld.x, positionWorld.z);
    const near = float(1).sub(smoothstep(NEON_GRID.near, NEON_GRID.far, length(flatWorld.sub(hero)))); // 1 round the hero, 0 far out
    const quiet = mix(float(NEON_GRID.quiet), float(1), near);
    const circuit = texture(traces, flatWorld.mul(NEON_GRID.traceScale)).r.mul(NEON_GRID.trace).mul(top).mul(quiet); // the cell's own colour, a share lighter (#1656)
    material.colorNode = (material.colorNode as ReturnType<typeof vec3>).mul(mix(float(NEON_GRID.farDim), float(1), near)).mul(float(1).add(circuit)); // the far ground is darker
    let emissive: THREE.Node = color(new THREE.Color(...NEON_GRID.floor));
    if (look.emissiveNode) emissive = (emissive as ReturnType<typeof vec3>).add(look.emissiveNode as ReturnType<typeof vec3>);
    if (lift) emissive = (emissive as ReturnType<typeof vec3>).add(lift as ReturnType<typeof vec3>);
    material.emissiveNode = emissive;
  }
  // The desert's shimmer (#1104) and the widening of the prisms (#1347). The position node reads the position after the instance moved it:
  // the corner is pushed out from the cell's centre by its own local position, not scaled from the world's origin.
  if (look.widen) {
    const moved = (look.positionNode ?? positionLocal) as typeof positionLocal;
    material.positionNode = moved.add(vec3(attribute('position', 'vec3').x, 0, attribute('position', 'vec3').z).mul(look.widen));
  } else if (look.positionNode) material.positionNode = look.positionNode;
  return material;
}
