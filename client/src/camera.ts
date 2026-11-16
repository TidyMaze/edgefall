// Orbit camera around the board centre: pure view maths, the pointer wiring lives in main.ts.

type Vec3 = { x: number; y: number; z: number };

export interface View {
  azimuth: number; // radians around the vertical axis, 0 looks from +z
  polar: number; // radians from the vertical axis, 0 straight above the board
  distance: number; // from the board centre
}

export const POLAR_MIN = 0.15;
export const POLAR_MAX = 1.4; // under pi/2: the camera never goes below the board plane
export const DIST_MIN = 6;
export const DIST_MAX = 18; // the fog follows the zoom (quality.ts), so the limit is only the view size
export const DRAG_THRESHOLD_PX = 5;
export const FOV = 40; // vertical field of view in degrees, for a window at least as wide as tall
const RAD_PER_PX = 0.006;
const WHEEL_RATE = 0.001;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clampPolar = (a: number): number => clamp(a, POLAR_MIN, POLAR_MAX);
export const clampDistance = (d: number): number => clamp(d, DIST_MIN, DIST_MAX);

// The vertical field of view in degrees for a window. A window taller than wide keeps the horizontal view of a square
// one, so the whole board fits the width of a phone held upright. The board is at the middle of the window (#1387).
export function framing(width: number, height: number): number {
  if (width >= height) return FOV;
  const half = Math.tan((FOV * Math.PI) / 360) * (height / width);
  return (360 / Math.PI) * Math.atan(half);
}

// A pointer that moved farther than the threshold since it went down is dragging, not clicking.
export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;

// The default view: the camera at (0, 11, 8) looking at the board centre, scaled with radius.
export const resetView = (radius = 4): View => ({
  azimuth: 0,
  polar: Math.atan2(8, 11),
  distance: (radius / 4) * Math.hypot(11, 8),
});

// The view drawn back along its own line, never closer, until every point lies inside a window of this size, within
// FIT_MARGIN of its half size from the edges (#691): The Pulsar's beacons stand off the board's corners. At most DIST_MAX.
// The board's centre stays in the middle of the window's width, the HUD plate folds out of the way instead (#957).
export const FIT_MARGIN = 0.03;
// `bottom`: the height in px of a band at the window's bottom no point may fall in, the dock's (#1716): in The Dual Room its buttons
// covered the back rows of the player's room, and a click on those marbles pressed Hub or Retry.
export function fitView(view: View, points: readonly Vec3[], width: number, height: number, bottom = 0, max = DIST_MAX): View {
  const floor = -(1 - FIT_MARGIN) + (2 * bottom) / height; // the lowest screen height a point may take, in -1..1
  const tanV = Math.tan((framing(width, height) * Math.PI) / 360);
  const tanH = tanV * (width / height);
  const fits = (distance: number): boolean => {
    const eye = viewPosition({ ...view, distance });
    const f = { x: -eye.x / distance, y: -eye.y / distance, z: -eye.z / distance }; // to the board centre
    const across = Math.hypot(f.x, f.z);
    const right = { x: -f.z / across, z: f.x / across };
    const up = { x: -right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y };
    return points.every((p) => {
      const d = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
      const depth = d.x * f.x + d.y * f.y + d.z * f.z;
      const sx = (d.x * right.x + d.z * right.z) / (depth * tanH);
      const sy = (d.x * up.x + d.y * up.y + d.z * up.z) / (depth * tanV);
      return Math.max(Math.abs(sx), Math.abs(sy)) <= 1 - FIT_MARGIN && sy >= floor;
    });
  };
  let distance = view.distance;
  while (distance < max && !fits(distance)) distance = Math.min(max, distance * 1.01);
  return { ...view, distance };
}

export const orbit = (v: View, dx: number, dy: number): View => ({
  ...v,
  azimuth: v.azimuth - dx * RAD_PER_PX,
  polar: clampPolar(v.polar - dy * RAD_PER_PX),
});

export const zoom = (v: View, scale: number): View => ({ ...v, distance: clampDistance(v.distance * scale) });

export const wheelScale = (deltaY: number): number => Math.exp(deltaY * WHEEL_RATE);

// Fingers moving apart (span grows) bring the camera closer.
export const pinchScale = (prevSpan: number, span: number): number => (span > 0 ? prevSpan / span : 1);

export const viewPosition = (v: View): { x: number; y: number; z: number } => ({
  x: v.distance * Math.sin(v.polar) * Math.sin(v.azimuth),
  y: v.distance * Math.cos(v.polar),
  z: v.distance * Math.sin(v.polar) * Math.cos(v.azimuth),
});

// The terminal reader (#512): the camera that reads a flat screen stands in front of its centre, along its normal, as
// close as fits the whole screen and a margin around it, in both the height and the width of the view.
export const SCREEN_MARGIN = 1.1;
export function screenView(centre: Vec3, normal: Vec3, width: number, height: number, fov: number, aspect: number): Vec3 {
  const half = Math.tan((fov * Math.PI) / 360);
  const d = SCREEN_MARGIN * Math.max(height / 2 / half, width / 2 / (half * aspect));
  return { x: centre.x + normal.x * d, y: centre.y + normal.y * d, z: centre.z + normal.z * d };
}
