// The lighter look of a renderer that draws in software (#1710). SwiftShader builds each program of the first frame in about 0.13 s
// (17 of them, 2.5 s of the 2.7 s boot), the lit PBR ones with their rim and sheen nodes the heaviest. On that renderer only, the
// terrace's lit materials are Lambert (one diffuse term, no BRDF, no node graph) and the marbles keep their cue as a plain tint. A
// renderer with a GPU never reads this: its look is unchanged.
import * as THREE from 'three/webgpu';

let on = false;

/** Turns the lighter look on or off; main.ts sets it once, when the renderer is known. */
export function setSoftLook(value: boolean): void {
  on = value;
}

/** Whether the lighter look is on. */
export const softLook = (): boolean => on;

/**
 * Every unlit material of `root` is drawn on both sides. A program is built per side (front, back, both: the shader reads the facing
 * for a normal an unlit colour never uses), so materials that differ by side only are one program fewer each.
 */
export function bothSides(root: THREE.Object3D): void {
  root.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (material && (material as THREE.MeshBasicMaterial).isMeshBasicMaterial && material.side === THREE.FrontSide) material.side = THREE.DoubleSide; // a back-face dome stays one
  });
}

/** A marble of the lighter look: its colour, and its rim as a steady glow (the rim is a fresnel node on a renderer with a GPU). */
export function softMarble(colour: number, glow: number, strength: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: colour, emissive: new THREE.Color(glow).multiplyScalar(strength) });
}
