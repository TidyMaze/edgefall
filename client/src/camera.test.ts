import { describe, expect, it } from 'vitest';
import {
  DIST_MAX,
  DIST_MIN,
  DRAG_THRESHOLD_PX,
  FOV,
  POLAR_MAX,
  FIT_MARGIN,
  POLAR_MIN,
  clampDistance,
  clampPolar,
  fitView,
  framing,
  isDrag,
  orbit,
  pinchScale,
  resetView,
  SCREEN_MARGIN,
  screenView,
  viewPosition,
  wheelScale,
  zoom,
} from './camera';

describe('clamping', () => {
  it('keeps the polar angle above the board, never at the pole or the horizon', () => {
    expect(POLAR_MIN).toBeGreaterThan(0);
    expect(POLAR_MAX).toBeLessThan(Math.PI / 2);
    expect(clampPolar(-1)).toBe(POLAR_MIN);
    expect(clampPolar(3)).toBe(POLAR_MAX);
    expect(clampPolar(0.7)).toBe(0.7);
  });

  it('keeps the distance between the min and the max', () => {
    expect(clampDistance(0.1)).toBe(DIST_MIN);
    expect(clampDistance(1000)).toBe(DIST_MAX);
    expect(clampDistance(10)).toBe(10);
  });
});

describe('click versus drag', () => {
  it('a movement within the threshold is a click, beyond it a drag', () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(isDrag(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    expect(isDrag(0, -(DRAG_THRESHOLD_PX + 1))).toBe(true);
    expect(isDrag(DRAG_THRESHOLD_PX, DRAG_THRESHOLD_PX)).toBe(true); // the diagonal is longer
  });
});

describe('reset target', () => {
  it('is the default camera position (0, 11, 8) looking at the board centre', () => {
    const p = viewPosition(resetView());
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(11);
    expect(p.z).toBeCloseTo(8);
  });

  it('returns a fresh object each time', () => {
    const a = resetView();
    a.azimuth = 2;
    expect(resetView().azimuth).toBe(0);
  });

  it('is inside the limits', () => {
    const v = resetView();
    expect(clampPolar(v.polar)).toBe(v.polar);
    expect(clampDistance(v.distance)).toBe(v.distance);
  });

  it('scales distance with radius for radius 5 boards (#573)', () => {
    const v4 = resetView(4);
    const v5 = resetView(5);
    expect(v4.distance).toBe(Math.hypot(11, 8));
    expect(v5.distance).toBeCloseTo((5 / 4) * Math.hypot(11, 8));
    expect(v5.polar).toBe(v4.polar);
    expect(v5.azimuth).toBe(0);
    expect(v5.distance).toBeLessThan(DIST_MAX);
  });
});

describe('orbit', () => {
  it('a horizontal drag turns around the board, a vertical one tilts, within the limits', () => {
    const v = orbit(resetView(), 100, 0);
    expect(v.azimuth).toBeLessThan(0);
    expect(v.polar).toBe(resetView().polar);
    expect(orbit(resetView(), 0, 100).polar).toBeLessThan(resetView().polar);
    expect(orbit(resetView(), 0, 1e6).polar).toBe(POLAR_MIN);
    expect(orbit(resetView(), 0, -1e6).polar).toBe(POLAR_MAX);
  });

  it('keeps the distance and never puts the camera under the board', () => {
    const v = orbit(resetView(), 37, -1e6);
    expect(v.distance).toBe(resetView().distance);
    expect(viewPosition(v).y).toBeGreaterThan(0);
  });
});

describe('zoom', () => {
  it('scales the distance within the limits', () => {
    expect(zoom(resetView(), 0.5).distance).toBeCloseTo(resetView().distance * 0.5);
    expect(zoom(resetView(), 1e-6).distance).toBe(DIST_MIN);
    expect(zoom(resetView(), 1e6).distance).toBe(DIST_MAX);
  });

  it('the wheel scrolled down zooms out, up zooms in, no scroll changes nothing', () => {
    expect(wheelScale(100)).toBeGreaterThan(1);
    expect(wheelScale(-100)).toBeLessThan(1);
    expect(wheelScale(0)).toBe(1);
  });

  it('fingers moving apart zoom in, together zoom out, a zero span is ignored', () => {
    expect(pinchScale(100, 200)).toBe(0.5);
    expect(pinchScale(200, 100)).toBe(2);
    expect(pinchScale(100, 0)).toBe(1);
  });
});

describe('viewPosition', () => {
  it('turns a quarter around the board with azimuth pi/2', () => {
    const p = viewPosition({ azimuth: Math.PI / 2, polar: Math.PI / 4, distance: 10 });
    expect(p.x).toBeCloseTo(10 * Math.SQRT1_2);
    expect(p.y).toBeCloseTo(10 * Math.SQRT1_2);
    expect(p.z).toBeCloseTo(0);
  });
});

// The horizontal half-angle tangent seen by a camera with this vertical field of view and window.
const halfWidth = (fov: number, width: number, height: number) => Math.tan((fov * Math.PI) / 360) * (width / height);

describe('framing, bug #227', () => {
  it('a window at least as wide as tall keeps the default view', () => {
    expect(framing(1280, 720)).toBe(FOV);
    expect(framing(812, 375)).toBe(FOV);
    expect(framing(600, 600)).toBe(FOV);
  });

  it('a window taller than wide sees as wide as a square one, so the whole board fits its width', () => {
    const square = halfWidth(FOV, 1, 1);
    for (const [w, h] of [
      [375, 812],
      [768, 1024],
      [599, 600],
    ] as const) {
      const fov = framing(w, h);
      expect(fov).toBeGreaterThan(FOV);
      expect(halfWidth(fov, w, h)).toBeCloseTo(square, 9);
    }
    expect(framing(599, 600)).toBeCloseTo(FOV, 0); // no jump at the square
  });

});

describe('screenView, the terminal reader (#512)', () => {
  // The half width and half height a camera at `d` sees, for a vertical field of view and an aspect.
  const seen = (d: number, fov: number, aspect: number) => {
    const half = Math.tan((fov * Math.PI) / 360) * d;
    return { width: half * aspect, height: half };
  };

  it('stands in front of the screen centre, along its normal', () => {
    const at = screenView({ x: -22.95, y: 2.2, z: 0 }, { x: 1, y: 0, z: 0 }, 2.8, 1.4, FOV, 16 / 9);
    expect(at.y).toBe(2.2);
    expect(at.z).toBe(0);
    expect(at.x).toBeGreaterThan(-22.95);
    const up = screenView({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 2, 1, FOV, 1);
    expect([up.x, up.z]).toEqual([0, 0]);
    expect(up.y).toBeGreaterThan(1);
  });

  it('a wide window fits the screen height with the margin, a narrow one its width', () => {
    const wide = screenView({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 2.8, 1.4, FOV, 4);
    expect(seen(wide.x, FOV, 4).height).toBeCloseTo(SCREEN_MARGIN * 0.7, 9);
    expect(seen(wide.x, FOV, 4).width).toBeGreaterThan(SCREEN_MARGIN * 1.4);
    const narrow = screenView({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 2.8, 1.4, FOV, 16 / 9);
    expect(seen(narrow.x, FOV, 16 / 9).width).toBeCloseTo(SCREEN_MARGIN * 1.4, 9);
    expect(seen(narrow.x, FOV, 16 / 9).height).toBeGreaterThan(SCREEN_MARGIN * 0.7);
  });
});

describe('fitView, bug #691', () => {
  const origin = { x: 0, y: 0, z: 0 };

  it('keeps the view when every point already fits the window', () => {
    expect(fitView(resetView(), [origin, { x: 4, y: 0, z: 0 }], 1280, 720)).toEqual(resetView());
    expect(fitView(resetView(), [], 375, 812)).toEqual(resetView());
  });

  it('draws the camera back along its line, no farther than needed, until a point near it fits', () => {
    const near = { x: 0, y: 0, z: 6 }; // under the bottom edge of the default view
    const fit = fitView(resetView(), [near], 1280, 720);
    expect(fit.distance).toBeGreaterThan(resetView().distance);
    expect([fit.azimuth, fit.polar]).toEqual([resetView().azimuth, resetView().polar]);
    expect(fitView(fit, [near], 1280, 720)).toEqual(fit); // it fits there
    expect(fitView({ ...fit, distance: fit.distance / 1.02 }, [near], 1280, 720).distance).toBeGreaterThan(fit.distance / 1.02);
  });

  it('keeps a point near the camera above the dock: a bottom band `bottom` px tall is no room to fit in (#1716)', () => {
    const near = { x: 0, y: 0, z: 6 };
    const plain = fitView(resetView(), [near], 1280, 720);
    const docked = fitView(resetView(), [near], 1280, 720, 80);
    expect(docked.distance).toBeGreaterThan(plain.distance); // drawn back farther, the point clears the band
    expect(fitView(docked, [near], 1280, 720, 80)).toEqual(docked);
    expect(fitView(resetView(), [{ x: 0, y: 0, z: -6 }], 1280, 720, 80)).toEqual(fitView(resetView(), [{ x: 0, y: 0, z: -6 }], 1280, 720)); // a far point: the band is at the bottom only
  });

  it('may draw back past DIST_MAX when the caller gives a farther cap: The Dual Room is 7 rings wide (#1716)', () => {
    const far = { x: 0, y: 0, z: 40 };
    expect(fitView(resetView(), [far], 1280, 720).distance).toBe(DIST_MAX);
    const fit = fitView(resetView(), [far], 1280, 720, 0, 30);
    expect(fit.distance).toBeGreaterThan(DIST_MAX);
    expect(fit.distance).toBeLessThanOrEqual(30);
  });

  it('a phone held upright, whose width is the board, draws back farther for a point off the side', () => {
    const side = { x: 6, y: 0, z: 0 };
    expect(fitView(resetView(), [side], 1280, 720)).toEqual(resetView());
    expect(fitView(resetView(), [side], 375, 812).distance).toBeGreaterThan(resetView().distance * 1.2);
  });

  it('leaves the margin to the edge, and stops at the farthest distance', () => {
    expect(FIT_MARGIN).toBeGreaterThan(0);
    expect(fitView(resetView(), [{ x: 40, y: 0, z: 0 }], 1280, 720).distance).toBe(DIST_MAX);
  });
});
