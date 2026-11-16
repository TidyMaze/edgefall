import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ACCENT_PULSE, NEON_OPEN_WORLD_POINT_LIGHTS, NEON_ROOM_POINT_LIGHTS, accentLights, accentOn, accentPulse, driveAccents, driveSkyGlow, neonSkyGlow, NEON_BLOOM, NEON_BOARD_BLOOM, setNeonBloom } from './neonfx';

describe('the neon accent lights (#1424)', () => {
  it('has 2 lights in the room and 2 in the Open world, on the high tier of a real GPU only', () => {
    expect(accentLights('room')).toHaveLength(NEON_ROOM_POINT_LIGHTS);
    expect(accentLights('openworld')).toHaveLength(NEON_OPEN_WORLD_POINT_LIGHTS);
    expect(NEON_ROOM_POINT_LIGHTS).toBeLessThanOrEqual(4);
    expect(NEON_OPEN_WORLD_POINT_LIGHTS).toBeLessThanOrEqual(4);
    expect(accentOn('high', false)).toBe(true);
    expect(accentOn('low', false)).toBe(false);
    expect(accentOn('high', true)).toBe(false);
  });
  it('names each light and gives one cyan and one violet', () => {
    const lights = accentLights('room');
    expect(lights.every((l) => l.name === 'neon accent')).toBe(true);
    expect(lights.every((l) => !l.visible)).toBe(true);
    expect(lights[0]!.color.getHex()).toBe(0x19e6ff);
    expect(lights[1]!.color.getHex()).toBe(0x9a6bff);
  });
  it('pulses by a few percent, and not at all under reduced motion', () => {
    expect(accentPulse(1234, true)).toBe(1);
    for (let t = 0; t < 10000; t += 137) expect(Math.abs(accentPulse(t, false) - 1)).toBeLessThanOrEqual(ACCENT_PULSE + 1e-9);
    expect(accentPulse(1000, false)).not.toBe(1);
  });
  it('drives the lights: hidden when off, power times the pulse when on, never compounding', () => {
    const lights = accentLights('room');
    const base = lights[0]!.intensity;
    driveAccents(lights, false, 1000, false);
    expect(lights.every((l) => !l.visible)).toBe(true);
    driveAccents(lights, true, 1000, false);
    driveAccents(lights, true, 1000, false);
    expect(lights[0]!.visible).toBe(true);
    expect(lights[0]!.intensity).toBeCloseTo(base * accentPulse(1000, false));
    driveAccents(lights, true, 1000, true);
    expect(lights[0]!.intensity).toBeCloseTo(base);
    expect(lights[0]).toBeInstanceOf(THREE.PointLight);
  });
  it('sets the bloom of the neon look, and leaves a missing pass alone (low tier)', () => {
    const b = { strength: { value: 0 }, radius: { value: 0 }, threshold: { value: 0 } };
    setNeonBloom(b);
    expect([b.strength.value, b.radius.value, b.threshold.value]).toEqual([NEON_BLOOM.strength, NEON_BLOOM.radius, NEON_BLOOM.threshold]);
    setNeonBloom(null);
  });
  it('gives the 1v1 board a softer glow than the room, scaled by the Bloom slider, so the marbles do not glow (#1725, #1727)', () => {
    expect(NEON_BOARD_BLOOM.strength).toBeLessThan(NEON_BLOOM.strength);
    expect(NEON_BOARD_BLOOM.threshold).toBeGreaterThan(NEON_BLOOM.threshold); // a lit marble stays under it, the tubes go over
    const b = { strength: { value: 0 }, radius: { value: 0 }, threshold: { value: 0 } };
    setNeonBloom(b, NEON_BOARD_BLOOM, 2);
    expect([b.strength.value, b.radius.value, b.threshold.value]).toEqual([NEON_BOARD_BLOOM.strength * 2, NEON_BOARD_BLOOM.radius, NEON_BOARD_BLOOM.threshold]);
    setNeonBloom(b, NEON_BOARD_BLOOM, 0);
    expect(b.strength.value).toBe(0);
  });
  it('has a sky glow, hidden at first, black at the top, shown and hidden by driveSkyGlow', () => {
    const glow = neonSkyGlow();
    const scene = new THREE.Group().add(glow);
    expect(glow.visible).toBe(false);
    const c = glow.geometry.attributes.color!;
    const p = glow.geometry.attributes.position!;
    for (let i = 0; i < p.count; i++) expect(p.getY(i) > 0 ? c.getX(i) + c.getY(i) + c.getZ(i) : 1).toBe(p.getY(i) > 0 ? 0 : 1);
    driveSkyGlow(scene, true);
    expect(glow.visible).toBe(true);
    driveSkyGlow(scene, false);
    expect(glow.visible).toBe(false);
    driveSkyGlow(new THREE.Group(), true);
  });
});
