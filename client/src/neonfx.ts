// Neon accent lights (#1424): 2 point lights in the room (hub, arena, dual share it) and 2 in the Open world, one cyan and one
// violet, with a slight pulse. They are made once and hidden, not removed, when the tier is low or the renderer draws in software.
import * as THREE from 'three';
import type { Tier } from './quality';

export const NEON_ROOM_POINT_LIGHTS = 2;
export const NEON_OPEN_WORLD_POINT_LIGHTS = 2;
/** The pulse's share of the light's power, either way. */
export const ACCENT_PULSE = 0.12;
const PERIOD_MS = 4000;

const SPEC = {
  room: [
    { colour: 0x19e6ff, power: 1.4, reach: 12, at: [-6, 4, 5] },
    { colour: 0x9a6bff, power: 1.4, reach: 12, at: [6, 4, -5] },
  ],
  openworld: [
    { colour: 0x19e6ff, power: 1.4, reach: 7, at: [-3, 2.5, 2] },
    { colour: 0x9a6bff, power: 1.4, reach: 7, at: [3, 2.5, -2] },
  ],
} as const;

export function accentLights(scene: keyof typeof SPEC): THREE.PointLight[] {
  return SPEC[scene].map(({ colour, power, reach, at }) => {
    const light = new THREE.PointLight(colour, power, reach);
    light.name = 'neon accent';
    light.visible = false; // shown by driveAccents on the high tier of a GPU only
    light.position.set(at[0], at[1], at[2]);
    return light;
  });
}

/** Whether the accent lights are drawn: the high tier of a renderer with a GPU. The low tier and software draw none. */
export const accentOn = (tier: Tier, software: boolean): boolean => tier !== 'low' && !software;

/** The factor on the power at `now` (ms): 1 under reduced motion. */
export const accentPulse = (now: number, reduced: boolean): number => (reduced ? 1 : 1 + ACCENT_PULSE * Math.sin((2 * Math.PI * now) / PERIOD_MS));

/** Shows or hides the lights and sets the power of the frame; the base power is kept on the light so the pulse never compounds. */
export function driveAccents(lights: readonly THREE.PointLight[], on: boolean, now: number, reduced: boolean): void {
  for (const light of lights) {
    light.visible = on;
    if (!on) continue;
    const base = (light.userData.power ??= light.intensity) as number;
    light.intensity = base * accentPulse(now, reduced);
  }
}

/** The neon look's bloom on the high tier: a real halo on the lit edges and tubes (the terrace keeps its tuned, nearly off one). */
export const NEON_BLOOM = { strength: 0.35, radius: 0.2, threshold: 0.6 } as const;
/** The 1v1 board's glow (bot, human, boss: the terrace pipeline, #1725): softer, and over a threshold a lit marble stays under, so the
 * marbles read clearly and the tubes and edges still glow. Scaled by the Bloom slider (#1727). */
export const NEON_BOARD_BLOOM = { strength: 0.15, radius: 0.2, threshold: 0.9 } as const;
type Bloom = { strength: { value: number }; radius: { value: number }; threshold: { value: number } };
/** Sets a bloom pass to `spec`, its strength times `factor` (the Bloom slider's, quality.ts `levelFactor`). */
export function setNeonBloom(bloom: Bloom | null | undefined, spec: { strength: number; radius: number; threshold: number } = NEON_BLOOM, factor = 1): void {
  if (!bloom) return; // the low tier has no bloom pass
  bloom.strength.value = spec.strength * factor;
  bloom.radius.value = spec.radius;
  bloom.threshold.value = spec.threshold;
}

/** A violet and cyan glow low on the horizon: an open cylinder round the scene, additive, black at the top. One draw call, hidden with the accents. */
export function neonSkyGlow(radius = 150): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radius, radius * 0.5, 48, 1, true);
  const position = geometry.attributes.position!;
  const colour = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const low = position.getY(i) < 0;
    const mix = (Math.atan2(position.getX(i), position.getZ(i)) / Math.PI + 1) / 2; // violet to cyan round the circle
    if (low) colour.set([0.1 + 0.2 * (1 - mix), 0.12 + 0.3 * mix, 0.35 + 0.3 * mix], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  const glow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  glow.name = 'sky-glow';
  glow.position.y = radius * 0.25 - 4;
  glow.frustumCulled = false;
  glow.renderOrder = -1;
  glow.visible = false;
  return glow;
}

/** Shows or hides the sky glow of `scene`, with the accents: the high tier of a GPU only. */
export function driveSkyGlow(scene: THREE.Object3D, on: boolean): void {
  const glow = scene.getObjectByName('sky-glow');
  if (glow) glow.visible = on;
}
