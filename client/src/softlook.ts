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

/**
 * Every Basic and Lambert mesh of `root` gets the same vertex layout: a normal and a four-float colour (white where it had none), with
 * its colours on. A program is built per layout, so the unlit and the lit meshes share one program each (plus one for the instanced).
 * The colour of a mesh without one does not change: white times its material colour.
 */
export function shareShapes(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const material = mesh.material as THREE.Material | undefined;
    if (!mesh.geometry || !material || !((material as THREE.MeshBasicMaterial).isMeshBasicMaterial || (material as THREE.MeshLambertMaterial).isMeshLambertMaterial)) return;
    const g = mesh.geometry;
    const count = g.getAttribute('position')!.count;
    if (!g.getAttribute('normal')) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const colour = g.getAttribute('color');
    if (!colour || colour.itemSize !== 4) {
      const out = new Float32Array(count * 4).fill(1);
      if (colour) for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = colour.getComponent(i, c);
      g.setAttribute('color', new THREE.BufferAttribute(out, 4));
    }
    (material as THREE.MeshBasicMaterial).vertexColors = true;
  });
}
