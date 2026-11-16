import { float, uniform } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NEON_LINE, neonEdgeGeometry, neonEdgeMaterial } from './neonlook';
import { NEON_GRID, EDGE_GAIN, EDGE_WIDTH, HEX_APOTHEM, HEX_RADIUS, edgeDistance, edgeFade, edgeMaterial, GAP_FILL, gapFill, SURFACE_DETAIL, surfaceDetail, BIOME_DETAIL, PHONE_WIDTH, surfaceAmplitude, surfaceUniforms, DETAIL_FADE } from './openworldedge';
import { BIOMES } from './openworld';

describe('the hex edge of an Open world ground (#1138)', () => {
  it('is 0 on an edge of the prism, the apothem at the centre, and the same on the six edges of the hex', () => {
    expect(HEX_APOTHEM).toBeCloseTo(HEX_RADIUS * Math.cos(Math.PI / 6));
    expect(edgeDistance(0, 0)).toBeCloseTo(HEX_APOTHEM);
    // The middle of the six edges of a prism of CylinderGeometry (vertices at the angles 0, 60, ... from +z).
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const angle = Math.PI / 6 + (k * Math.PI) / 3;
      expect(edgeDistance(HEX_APOTHEM * Math.sin(angle), HEX_APOTHEM * Math.cos(angle))).toBeCloseTo(0);
    }
  });

  it('measures the distance to the nearest edge, and a corner lies on two edges', () => {
    expect(edgeDistance(HEX_APOTHEM / 2, 0)).toBeCloseTo(HEX_APOTHEM / 2);
    expect(edgeDistance(0, HEX_RADIUS)).toBeCloseTo(0);
  });

  it('darkens the land seam a little and lights the water line a little, in a narrow band', () => {
    expect(EDGE_GAIN.land).toBeLessThan(0);
    expect(EDGE_GAIN.land).toBeGreaterThan(-0.5);
    expect(EDGE_GAIN.water).toBeGreaterThan(0);
    expect(EDGE_GAIN.water).toBeLessThanOrEqual(1);
    expect(EDGE_WIDTH).toBeLessThan(HEX_APOTHEM / 4);
  });

  it('is a node material on its look, white until an instance colours it, with no texture', () => {
    const material = edgeMaterial({ emissive: 0x0a5568, roughness: 0.2, gain: EDGE_GAIN.water });
    expect(material.isMeshStandardNodeMaterial).toBe(true);
    expect(material.colorNode).not.toBeNull();
    expect(material.roughness).toBeCloseTo(0.2);
    expect(material.emissive.getHex()).toBe(0x0a5568);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.map).toBeNull();
  });

  it('fades the band out as it gets thinner than a pixel, so a wide zoom shows a flat colour (#1347)', () => {
    expect(edgeFade(0)).toBe(0);
    expect(edgeFade(0.75)).toBe(0); // a band under a pixel beats against the pixel grid
    expect(edgeFade(2)).toBe(1); // a close zoom keeps the whole band
    expect(edgeFade(100)).toBe(1);
    expect(edgeFade(1.4)).toBeGreaterThan(0);
    expect(edgeFade(1.4)).toBeLessThan(1);
    expect(edgeFade(1.6)).toBeGreaterThan(edgeFade(1.2));
  });

  it('widens the prisms to close the gap between them as the zoom goes out, so the gap shows no dark dots at a wide zoom (#1347)', () => {
    expect(gapFill(1)).toBe(0); // the close look keeps its thin gap
    expect(gapFill(1.8)).toBe(0);
    expect(gapFill(6)).toBe(GAP_FILL);
    expect(gapFill(2.4)).toBeGreaterThan(0);
    expect(gapFill(2.4)).toBeLessThan(GAP_FILL);
    expect(gapFill(3)).toBe(GAP_FILL);
    // a full widening takes the radius 2 % past the corner of the cell the grid of spacing 1 gives: the prisms overlap a hair, no crack
    expect(HEX_RADIUS * (1 + GAP_FILL)).toBeCloseTo(1.02 / Math.sqrt(3), 6);
  });

  it('takes a widen uniform and a position node, and gives them as they are when one is missing', () => {
    const shimmer = float(1);
    const look = { emissive: 0, roughness: 0.2, gain: 0 };
    expect(edgeMaterial({ ...look, widen: uniform(0) }).positionNode).not.toBeNull();
    expect(edgeMaterial({ ...look, positionNode: shimmer }).positionNode).toBe(shimmer);
    expect(edgeMaterial({ ...look, positionNode: shimmer, widen: uniform(0) }).positionNode).not.toBe(shimmer);
    expect(edgeMaterial(look).positionNode).toBeNull();
    const glow = float(2);
    expect(edgeMaterial({ ...look, emissiveNode: glow }).emissiveNode).toBe(glow);
  });

  it('draws the neon grid and traces in the shader, with no extra node when the look is off (#1424)', () => {
    const look = { emissive: 0, roughness: 0.2, gain: -0.7 };
    const neon = { hero: uniform(new THREE.Vector2()), traces: new THREE.DataTexture(new Uint8Array(4), 1, 1) };
    const plain = edgeMaterial(look);
    const lit = edgeMaterial({ ...look, neon });
    expect(plain.emissiveNode).toBeNull();
    expect(lit.emissiveNode).not.toBeNull();
    expect(lit.colorNode).not.toBe(plain.colorNode);
    const water = float(2);
    expect(edgeMaterial({ ...look, emissiveNode: water, neon }).emissiveNode).not.toBe(water); // the foam keeps its term, the grid is added
    // no line colour of its own: the traces are a share of the cell's own colour, the cyan line is the arena's alone (#1656)
    expect((lit.emissiveNode as unknown as { node: { value: THREE.Color } }).node.value.toArray()).toEqual(new THREE.Color(...NEON_GRID.floor).toArray());
    expect(NEON_GRID.near).toBeLessThan(NEON_GRID.far);
    // the floor of light keeps the darkest ground off the sky's colour (#04050c) in the screenshot, and stays a hint of colour (#1424)
    expect(Math.max(...NEON_GRID.floor)).toBeLessThan(0.01);
    expect(NEON_GRID.floor[2]).toBeGreaterThan(0.002);
  });

  it('adds a striation to the top of the land, a share of its colour lighter or darker and never a new hue (#1555)', () => {
    const samples: number[] = [];
    for (let x = -20; x <= 20; x += 0.37) for (let z = -20; z <= 20; z += 0.41) samples.push(surfaceDetail(x, z));
    const { amplitude } = SURFACE_DETAIL;
    expect(amplitude).toBeGreaterThan(0);
    expect(amplitude).toBeLessThanOrEqual(0.05); // a surface, not a pattern: at 0.12 the bands drew diagonal stripes over the map at a wide zoom (#1714)
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(1 - amplitude - 1e-9);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1 + amplitude + 1e-9);
    expect(new Set(samples.map((v) => v.toFixed(3))).size).toBeGreaterThan(50); // it varies across the ground
    expect(surfaceDetail(3, -2)).toBe(surfaceDetail(3, -2)); // a fixed function of the place: the same every frame
    expect(surfaceDetail(3, -2)).toBe(surfaceDetail(3, -2, 'meadow')); // the meadow's is the first slice's
    const look = { emissive: 0, roughness: 0.9, gain: EDGE_GAIN.land };
    const shaded = edgeMaterial({ ...look, detail: surfaceUniforms() }).colorNode;
    expect(shaded).not.toBeNull();
    expect(edgeMaterial(look).colorNode).not.toBeNull();
    // under the neon look the light bands glow too, a share of the cell's own colour: no new hue (#1555)
    expect(SURFACE_DETAIL.glow).toBeGreaterThan(0);
    const neon = { hero: uniform(new THREE.Vector2()), traces: new THREE.DataTexture(new Uint8Array(4), 1, 1) };
    expect(edgeMaterial({ ...look, detail: surfaceUniforms(), neon }).emissiveNode).not.toBeNull();
  });

  it('gives each biome a striation of its own, the meadow keeping the first one (#1555)', () => {
    expect(BIOME_DETAIL.meadow).toEqual({ frequency: SURFACE_DETAIL.frequency, warp: SURFACE_DETAIL.warp });
    expect(new Set(BIOMES.map((biome) => `${BIOME_DETAIL[biome].frequency}/${BIOME_DETAIL[biome].warp}`)).size).toBe(BIOMES.length);
    for (const biome of BIOMES) {
      const { frequency } = BIOME_DETAIL[biome];
      expect(frequency, biome).toBeGreaterThanOrEqual(0.8); // a band of 8 cells at most: still read on a phone
      expect(frequency, biome).toBeLessThanOrEqual(4); // a band of 1.5 cells at least: no shimmer of pixels
      expect(Math.abs(surfaceDetail(1.3, 2.7, biome) - 1), biome).toBeLessThanOrEqual(SURFACE_DETAIL.amplitude + 1e-9);
    }
    expect(surfaceDetail(1.3, 2.7, 'desert')).not.toBeCloseTo(surfaceDetail(1.3, 2.7, 'badlands'), 3);
  });

  it('is stronger on a phone, where the art read it faint, and off on the low tier (#1555)', () => {
    expect(surfaceAmplitude(true, 1280)).toBe(SURFACE_DETAIL.amplitude);
    expect(surfaceAmplitude(true, PHONE_WIDTH)).toBe(SURFACE_DETAIL.phone);
    expect(surfaceAmplitude(true, PHONE_WIDTH + 1)).toBe(SURFACE_DETAIL.amplitude);
    expect(SURFACE_DETAIL.phone).toBeGreaterThan(SURFACE_DETAIL.amplitude);
    expect(SURFACE_DETAIL.phone).toBeLessThanOrEqual(0.12); // still a surface: at 0.3 the bands read as stripes (#1714)
    // a wide zoom fades it out: past DETAIL_FADE.to the bands are a few pixels wide and read as stripes over the map (#1714)
    expect(surfaceAmplitude(true, 1280, DETAIL_FADE.from)).toBe(SURFACE_DETAIL.amplitude);
    expect(surfaceAmplitude(true, 1280, (DETAIL_FADE.from + DETAIL_FADE.to) / 2)).toBeCloseTo(SURFACE_DETAIL.amplitude / 2);
    expect(surfaceAmplitude(true, 390, DETAIL_FADE.to)).toBe(0);
    expect(surfaceAmplitude(true, 1280, 6)).toBe(0);
    expect(surfaceAmplitude(false, 1280, 1)).toBe(0);
    expect(surfaceAmplitude(false, 1280)).toBe(0);
    expect(surfaceAmplitude(false, 390)).toBe(0);
    const u = surfaceUniforms();
    expect([u.amplitude.value, u.frequency.value, u.warp.value]).toEqual([SURFACE_DETAIL.amplitude, SURFACE_DETAIL.frequency, SURFACE_DETAIL.warp]);
  });

  it('keeps the arena\'s grid line its weight, glow and colour (#1535); the Open world draws none (#1656)', () => {
    const arena = neonEdgeMaterial().color;
    expect(arena.getHex()).toBe(new THREE.Color(NEON_LINE.colour).multiplyScalar(NEON_LINE.glow).getHex());
    const p = neonEdgeGeometry().attributes.position!.array as Float32Array;
    expect(Math.hypot(p[3]! - p[0]!, p[5]! - p[2]!)).toBeCloseTo(NEON_LINE.width, 6); // the arena's band is as wide as the shared width
  });
});
