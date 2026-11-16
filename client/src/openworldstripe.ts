// The stripe of the Open world marbles (docs/specs/openworld.md section 4, #1043): one great circle on the hero, the troop and the
// foes, so the roll of a glide (openworldglide.ts) shows. A symmetric stripe would hide the roll, so its normal is tilted 35 degrees
// off the travel axis: as the marble turns, the stripe sweeps across it. The stripe is a colour node of each material, built from
// uniform nodes: a look sets its colour once, the zoom sets the strength (`fade`) per frame. No material is swapped, no map is
// loaded, and a stripe that lightens (the foes) works as one that darkens (the hero): the colour is mixed in, not multiplied.
import * as THREE from 'three/webgpu';
import { abs, dot, float, fwidth, materialColor, mix, normalize, positionLocal, smoothstep, uniform, varying, vec3 } from 'three/tsl';
import { ROLL_ZOOM } from './openworldglide';

/** The strength of the stripe as a uniform node, 1 at rest: one node is shared by every marble material of a view. */
export const stripeFadeNode = () => uniform(1);
type Fade = ReturnType<typeof stripeFadeNode>;

/** How much of its colour a marble emits at full glow. */
export const GLOW_SHARE = 0.35;

/** The half width of the stripe, in radians of arc: the stripe is 0.16 rad wide (about 9 degrees). */
export const STRIPE_HALF_WIDTH = 0.08;
/** The tilt of the stripe's normal off the travel axis, in radians: 35 degrees. */
export const STRIPE_TILT = (35 * Math.PI) / 180;
/** The zoom up to which the stripe is drawn at full strength: it fades to nothing at `ROLL_ZOOM`, where the roll stops. */
export const STRIPE_FULL_ZOOM = 2.5;
/** The stripe's normal in the marble's own frame, at rest: the travel axis is X, the normal tilted toward Y. */
export const STRIPE_NORMAL = { x: Math.cos(STRIPE_TILT), y: Math.sin(STRIPE_TILT), z: 0 };

/** The strength of the stripe at a zoom, from 1 (full) to 0 (none): full up to `STRIPE_FULL_ZOOM`, linear down to 0 at `ROLL_ZOOM`. */
export function stripeStrength(zoom: number): number {
  if (zoom <= STRIPE_FULL_ZOOM) return 1;
  return Math.max(0, (ROLL_ZOOM - zoom) / (ROLL_ZOOM - STRIPE_FULL_ZOOM));
}

/** The look of a marble material: its base colour, the colour of its stripe, and its roughness. */
export interface MarbleLook {
  base: number;
  stripe: number;
  roughness: number;
}

/** The skins of the ship (#1176) that the marbles wear: the player's for the hero and the troop, the shell's for the enemies. */
export interface MarbleSkins {
  player: THREE.MeshStandardMaterial;
  shell: THREE.MeshStandardMaterial;
}

/** Dresses `material` in the colour, maps and finish of `skin` (#1176), its stripe and glow nodes kept: when a world opens, and again
 * when Settings changes a skin while it is open (#1726). The material compiles again for the new maps. */
export function wearSkin(material: THREE.MeshStandardNodeMaterial, skin: THREE.MeshStandardMaterial): void {
  const { color, roughness, metalness, emissive, emissiveIntensity, map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap } = skin;
  material.color.copy(color);
  material.emissive.copy(emissive);
  Object.assign(material, { roughness, metalness, emissiveIntensity, map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap });
  material.needsUpdate = true;
}

/** A marble material with the stripe of `look`, its strength read from the `fade` uniform (see `stripeStrength`). Its colour is
 * the base, mixed toward the stripe colour across the band of the great circle. With a `skin` (#1176) the material wears its
 * colour, maps and finish, so the stripe is the one cue of the team. With a `glow` (0 to 1, a uniform node of the view, #1496) the marble
 * shines with `share` of its own colour in proportion to it: the hero and the troop stay readable at night. */
export function stripedMaterial(look: MarbleLook, fade: Fade, skin?: THREE.MeshStandardMaterial, glow?: Fade, share = GLOW_SHARE): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ color: look.base, roughness: look.roughness });
  if (skin) wearSkin(material, skin);
  const stripe = uniform(new THREE.Color(look.stripe));
  // The direction of the point on the marble, in its own frame: a sphere's unit normal, so it turns with the marble.
  const direction = normalize(varying(positionLocal));
  // The distance of the point from the great circle, as the sine of the angle: 0 on it, 1 at its pole.
  const off = abs(dot(direction, vec3(STRIPE_NORMAL.x, STRIPE_NORMAL.y, STRIPE_NORMAL.z)));
  const edge = float(Math.sin(STRIPE_HALF_WIDTH));
  const soft = fwidth(off).add(1e-4); // an antialiased edge, one pixel wide
  const band = float(1).sub(smoothstep(edge.sub(soft), edge.add(soft), off));
  const colour = mix(materialColor, stripe, band.mul(fade));
  material.colorNode = colour;
  if (glow) material.emissiveNode = colour.mul(glow).mul(share);
  material.userData.glowShare = glow ? share : 0;
  return material;
}
