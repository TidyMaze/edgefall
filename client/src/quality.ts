// Quality tiers, fog and the clear-board setting, see docs/specs/tech.md section 5.1, and the volume
// sliders (docs/specs/world.md section 7).
// Pure functions only: main.ts feeds them the browser values.

import type { View } from './camera';
import { FRAME } from './frame';
import { glassSkinById } from './glassskins';
import type { Level } from './lightpanel';
import { PALETTES, type Palette } from './palettes';
import type { Theme } from './settings';
import type { Bus, Mix } from './sound';
import { skinById } from './skins';
import { UI_SCALES, type UiScale } from './uiscale';

/** The quality tiers (#1715): Normal draws all of High but the sun's shadows and the marbles' reflections, its two costliest passes. */
export type Tier = 'low' | 'normal' | 'high';
export const TIERS: readonly Tier[] = ['low', 'normal', 'high'];
export const TIER_NAMES: Record<Tier, string> = { low: 'Low', normal: 'Normal', high: 'High' };
/** The tier after `tier` in the Settings' Quality row: Low, Normal, High, then Low again. */
export const nextTier = (tier: Tier): Tier => TIERS[(TIERS.indexOf(tier) + 1) % TIERS.length]!;
/** The sun's soft shadow (#1364): the High tier only. */
export const hasShadows = (tier: Tier): boolean => tier === 'high';
export interface Hints {
  cores?: number;
  memory?: number;
  reducedMotion: boolean;
  /** The renderer draws in software (`isSoftwareRenderer`, #1483). */
  software?: boolean;
}
export type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

// Not 'ab-alone.quality': earlier versions stored their own guess there, which kept phones on the low tier (#882).
const TIER_KEY = 'ab-alone.tier';
const CLEAR_KEY = 'ab-alone.clear-board';
const FPS_KEY = 'ab-alone.fps';
const SOUND_KEY = 'ab-alone.sound';
const THEME_KEY = 'ab-alone.theme';
const PALETTE_KEY = 'ab-alone.palette';
const SKIN_KEY = 'ab-alone.shell-skin';
const GLASS_KEY = 'ab-alone.glass-skin';
const SAFE_KEY = 'ab-alone.safe-mode';
const SCALE_KEY = 'ab-alone.ui-scale';
const MOTION_KEY = 'ab-alone.reduced-motion';
const FLAT_KEY = 'ab-alone.flat-hud';
const FOLD_KEY = 'ab-alone.hud-folded';
const TRANSCRIPT_KEY = 'ab-alone.transcript';
const BOARD_ZOOM_KEY = 'ab-alone.board-zoom';
const STEERING_KEY = 'ab-alone.steering';

// The point lights the Open world may draw, on every tier (#849, #1234): its scene is lit by a hemisphere and a sun only. The
// ship's scene (76 point lights) is not drawn there, and the render-cost readout counts the scene that is.
export const OPEN_WORLD_POINT_LIGHTS = 0;

// The same rule on a phone as on a desktop (#882): only a weak device or reduced motion drops to the low tier.
// A renderer that draws in software takes the low tier too, until the player picks the other in the settings (#1483).
export function tierFromHints({ cores, memory, reducedMotion, software }: Hints): Tier {
  if (reducedMotion || software) return 'low';
  const weak = (cores ?? Infinity) < 4 || (memory ?? Infinity) < 4;
  return weak ? 'low' : 'high';
}

// Linear fog on the depth along the view axis (THREE.Fog). It starts at the plate's edge, the farthest point of the
// frame's inner hexagon from the camera, and smoothly extends across the hauler bay (#665).
// It thickens into atmospheric haze, never over a cell, at every zoom and turn of the camera. `radius` is the frame's.
export const BAY_FOG_SPAN = 34;
const FOG_TIER_SCALE = { low: 1.25, normal: 1.0, high: 1.0 };

// `density` is the deck's (light.ts, #400): it divides the span over the bay, from the same start, so a denser fog is
// thick sooner and still never over a cell.
export function fogSettings(
  tier: Tier,
  clear: boolean,
  view: View,
  radius: number,
  density: number,
): { near: number; far: number } | null {
  if (clear) return null;
  // How far along the view a hexagon of apothem 1 reaches: its corner nearest the view direction (frame.ts hexagon).
  const reach =
    (Math.sin(view.polar) * Math.max(...[0, 1, 2, 3, 4, 5].map((k) => -Math.sin((k * Math.PI) / 3 + view.azimuth)))) /
    (Math.sqrt(3) / 2);
  const edge = radius * (Math.sqrt(3) / 2) + FRAME.margin;
  const near = view.distance + edge * reach;
  return { near, far: near + (BAY_FOG_SPAN * FOG_TIER_SCALE[tier]) / density };
}

/** One stored setting, `null` when missing or when storage is blocked. */
export function read(store: Store, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores one setting, silently dropped when storage is blocked. */
export function write(store: Store, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Storage blocked (private mode, quota): the setting just lasts for this page view.
  }
}

export const readClearBoard = (store: Store): boolean => read(store, CLEAR_KEY) === 'on';
// The FPS readout (#426): off unless the player switched it on in the settings menu.
export const readFps = (store: Store): boolean => read(store, FPS_KEY) === 'on';
export const writeFps = (store: Store, on: boolean): void => write(store, FPS_KEY, on ? 'on' : 'off');
export const writeClearBoard = (store: Store, on: boolean): void => write(store, CLEAR_KEY, on ? 'on' : 'off');
// The four volume sliders (#438), 0 to 100 % each, 100 % unless the player moved it. They replace the one Sound
// toggle: a Sound off saved before them sets every slider without a value of its own to 0.
const DEFAULT_MIX: Mix = { music: 100, ambience: 5, effects: 100, voice: 100 };
const volumeKey = (bus: Bus): string => `ab-alone.volume.${bus}`;
// Under automation (navigator.webdriver, #990) the music starts at 0: a browser driven by Playwright would play it out loud.
// A volume the player saved still wins.
export const readMix = (store: Store, automated = false): Mix => {
  const muted = read(store, SOUND_KEY) === 'off';
  const volume = (bus: Bus): number => {
    const saved = read(store, volumeKey(bus)) ?? '';
    if (/^\d+$/.test(saved) && Number(saved) <= 100) return Number(saved);
    return muted || (automated && bus === 'music') ? 0 : DEFAULT_MIX[bus];
  };
  return { music: volume('music'), ambience: volume('ambience'), effects: volume('effects'), voice: volume('voice') };
};
export const writeVolume = (store: Store, bus: Bus, percent: number): void => write(store, volumeKey(bus), String(percent));
// The three light sliders (lightpanel.ts scalePower), 0 to 300 % of the tuned power each; until the player moves one,
// the levels the owner tuned in the game (2026-10-29).
export const DEFAULT_LEVELS: Readonly<Record<Level, number>> = { bloom: 20, lamps: 25, lights: 215 };
const levelKey = (level: Level): string => `ab-alone.light.${level}`;
export const readLevels = (store: Store): Record<Level, number> => {
  const level = (l: Level): number => {
    const saved = read(store, levelKey(l)) ?? '';
    return /^\d+$/.test(saved) && Number(saved) <= 300 ? Number(saved) : DEFAULT_LEVELS[l];
  };
  return { bloom: level('bloom'), lamps: level('lamps'), lights: level('lights') };
};
/** A slider's level as a factor of its default (#1727): 1 at the default, 0 at 0, so a scene tuned at the defaults (the Open world, the
 * board's glow) is left as tuned until the player moves it. */
export const levelFactor = (levels: Readonly<Record<Level, number>>, level: Level): number => levels[level] / DEFAULT_LEVELS[level];
export const writeLevel = (store: Store, level: Level, percent: number): void => write(store, levelKey(level), String(percent));
// Photosensitivity safe mode (#380): on unless the player turned it off.
export const readSafeMode = (store: Store): boolean => read(store, SAFE_KEY) !== 'off';
export const writeSafeMode = (store: Store, on: boolean): void => write(store, SAFE_KEY, on ? 'on' : 'off');
// The UI scale (#382): 100 % unless the player picked a step.
export const readUiScale = (store: Store): UiScale => {
  const stored = Number(read(store, SCALE_KEY));
  return (UI_SCALES as readonly number[]).includes(stored) ? (stored as UiScale) : 100;
};
export const writeUiScale = (store: Store, scale: UiScale): void => write(store, SCALE_KEY, String(scale));
// The theme (#317, #1184): Dark unless the player picked System or Light. index.html reads the same key before the first paint.
export const readTheme = (store: Store): Theme => {
  const stored = read(store, THEME_KEY);
  return stored === 'system' || stored === 'light' ? stored : 'dark';
};
export const writeTheme = (store: Store, theme: Theme): void => write(store, THEME_KEY, theme);
// Reduced motion (#379): null until the player presses the toggle, so the system setting decides (motionReduced).
export const readReducedMotion = (store: Store): boolean | null => {
  const stored = read(store, MOTION_KEY);
  return stored === 'on' ? true : stored === 'off' ? false : null;
};
export const writeReducedMotion = (store: Store, on: boolean): void => write(store, MOTION_KEY, on ? 'on' : 'off');
// The flat HUD fallback (#391): off unless the player turned it on.
export const readFlatHud = (store: Store): boolean => read(store, FLAT_KEY) === 'on';
export const writeFlatHud = (store: Store, on: boolean): void => write(store, FLAT_KEY, on ? 'on' : 'off');
// The left HUD panel folded to a tab (#957): unfolded unless the player folded it.
export const readHudFolded = (store: Store): boolean => read(store, FOLD_KEY) === 'on';
export const writeHudFolded = (store: Store, on: boolean): void => write(store, FOLD_KEY, on ? 'on' : 'off');
// The closer board view of a phone held upright (#1567): the whole board unless the player turned it on, per device.
export const readBoardZoom = (store: Store): boolean => read(store, BOARD_ZOOM_KEY) === 'on';
export const writeBoardZoom = (store: Store, on: boolean): void => write(store, BOARD_ZOOM_KEY, on ? 'on' : 'off');
// The audio log transcript (#516): on unless the player turned it off.
export const readTranscript = (store: Store): boolean => read(store, TRANSCRIPT_KEY) !== 'off';
export const writeTranscript = (store: Store, on: boolean): void => write(store, TRANSCRIPT_KEY, on ? 'on' : 'off');
// The Open world steering (#1137): the hero goes round obstacles and a far tap walks there; on unless the player turned it off.
export const readSteering = (store: Store): boolean => read(store, STEERING_KEY) !== 'off';
export const writeSteering = (store: Store, on: boolean): void => write(store, STEERING_KEY, on ? 'on' : 'off');

// The dark shell skin (#377): Scarab ridges unless the player picked another one of skins.ts.
export const readSkin = (store: Store): string => skinById(read(store, SKIN_KEY)).id;
export const writeSkin = (store: Store, id: string): void => write(store, SKIN_KEY, id);

// The pale glass skin (#377): Smoked glass unless the player picked another one of glassskins.ts.
export const readGlassSkin = (store: Store): string => glassSkinById(read(store, GLASS_KEY)).id;
export const writeGlassSkin = (store: Store, id: string): void => write(store, GLASS_KEY, id);

// The colorblind palette (#381): Default unless the player picked one.
export const readPalette = (store: Store): Palette => {
  const stored = read(store, PALETTE_KEY);
  return PALETTES.includes(stored as Palette) ? (stored as Palette) : 'default';
};
export const writePalette = (store: Store, palette: Palette): void => write(store, PALETTE_KEY, palette);

// Software rendering (#1483): a machine with no GPU runs the browser's own rasterizer. Its name shows in the renderer string of the
// context (SwiftShader of Chrome, llvmpipe, softpipe and lavapipe of Mesa, WARP of Windows) or in the WebGPU adapter's description.
export const isSoftwareRenderer = (name: string): boolean => /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|warp/i.test(name);
interface Named {
  gl?: { getExtension(name: 'WEBGL_debug_renderer_info'): { UNMASKED_RENDERER_WEBGL: number } | null; getParameter(p: number): unknown };
  adapter?: { info?: { description?: string; device?: string }; isFallbackAdapter?: boolean };
}
/** The name of the GPU behind a three backend, '' when it tells none: the WebGL context's unmasked renderer, or the WebGPU adapter's. */
export function rendererName(backend: unknown): string {
  const { gl, adapter } = backend as Named;
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  if (gl && info) return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  if (adapter) return `${adapter.isFallbackAdapter ? 'software ' : ''}${adapter.info?.description ?? ''} ${adapter.info?.device ?? ''}`;
  return '';
}

// The measured check (#1483): a renderer string can be masked. The first window of frames (a shader compile is in it) at a median of
// over 100 ms, 10 FPS, is no GPU: a GPU draws these in a tenth of the time.
const SOFTWARE_FRAME_MS = 100;
export const looksSoftware = (frameMs: readonly number[]): boolean =>
  frameMs.length > 0 && [...frameMs].sort((a, b) => a - b)[frameMs.length >> 1]! > SOFTWARE_FRAME_MS;

// A tier is stored only when asked for (?quality): the detected one is not, so a later rule applies at once (#882).
export function readTier(store: Store, hints: Hints): Tier {
  const stored = read(store, TIER_KEY);
  return TIERS.includes(stored as Tier) ? (stored as Tier) : tierFromHints(hints);
}
export const writeTier = (store: Store, tier: Tier): void => write(store, TIER_KEY, tier);

// Under automation (navigator.webdriver) the page draws only while the last draw took under a fifth of the time since it
// began, and at most every 100 ms. CI runners have no GPU: software WebGL takes every core for each draw, and input,
// evaluate and click wait seconds for a frame (bug #216). A draw a test asked for (`asked`) waits the 100 ms only: the
// first draw of a page compiles the shaders, and 4 times its cost made a test that waited for a draw wait 7 to 12 s
// (bug #435). A player draws every frame.
const AUTOMATED_MIN_GAP_MS = 100;
const AUTOMATED_DUTY = 4;
export const drawDue = (now: number, lastStart: number, lastCost: number, asked: boolean, automated: boolean): boolean =>
  !automated || now - lastStart >= Math.max(AUTOMATED_MIN_GAP_MS, asked ? 0 : AUTOMATED_DUTY * lastCost);

// A draw's cost runs from its start to the next animation frame, not to the end of render(): the GPU works after render()
// returns, and the frame after a draw comes late by its GPU time, about 0.4 to 1.1 s with software WebGL against 5 ms
// of JS (bug #921). WebGL's GPU timer query is missing there. The first frame after a draw times it (`timed` false).
export interface LastDraw {
  start: number;
  cost: number;
  timed: boolean;
}
export const timeDraw = (last: LastDraw, now: number): LastDraw =>
  last.timed ? last : { start: last.start, cost: now - last.start, timed: true };

// A player's page draws only when something asked for a frame (#848): the picture changed (`changed`: a move, an input,
// a load, a setting), an effect still moves (`moving`) or a test asked (`asked`). A still board leaves the GPU idle and
// the laptop cool. Under automation the throttle above decides alone, as before: the browser checks count draws.
export const drawWanted = (changed: boolean, moving: boolean, asked: boolean, automated: boolean): boolean =>
  automated || asked || changed || moving;

/**
 * The canvas is veiled (opacity 0) until the terrace is drawn (#1389): a frame of the room drawn meanwhile is never seen, yet its
 * shader programs are compiled on the main thread, 18 of the 36 before the first picture (#1481). It is not drawn.
 */
export const roomVeiled = (veiled: boolean, terraceOn: boolean): boolean => veiled && !terraceOn;

export function hasReflections(tier: Tier, automated: boolean): boolean {
  return !automated && tier === 'high';
}

// The costly passes of the main board room, dropped on the low tier (#849): the bloom's blur passes, and the normal maps
// (a texture to fetch and a lookup in every lit pixel). The room's clearcoat is not listed: no material of the room sets one
// (marbles.ts GLASS holds the numbers, nothing reads them), so there is none to drop. High is unchanged.
export const hasBloom = (tier: Tier): boolean => tier !== 'low';
export const hasNormalMaps = (tier: Tier): boolean => tier !== 'low';

// Geometry detail per tier (#424): low tier reduces vertex count on the 61 discs and 28 marbles for mobile fill/vertex savings.
export interface MeshDetail {
  discSegments: number;
  marbleWidthSegments: number;
  marbleHeightSegments: number;
}
export function meshDetail(tier: Tier): MeshDetail {
  return tier === 'low'
    ? { discSegments: 16, marbleWidthSegments: 16, marbleHeightSegments: 12 }
    : { discSegments: 32, marbleWidthSegments: 32, marbleHeightSegments: 16 };
}

// Every tier caps the canvas at 1.5: a full-screen Retina window at 2 renders 3840×2160 and drew 10 FPS (#843), and a
// phone capped at 1.0 (#424) stretched each drawn pixel 3 times on a DPR-3 screen, a blur. The adaptive resolution
// below steps down when a phone is too slow for it.
// Under automation the canvas renders at half DPR (#349).
const AUTOMATED_PIXEL_RATIO = 0.5;
export const renderPixelRatio = (dpr: number, automated: boolean): number =>
  Math.min(dpr, automated ? AUTOMATED_PIXEL_RATIO : 1.5);

// FXAA smooths the edges (#857) where a drawn pixel is big (a ratio under 1.5) and the renderer has no MSAA, which
// a touch screen keeps.
export const smoothEdges = (drawnRatio: number, msaa: boolean): boolean => drawnRatio < 1.5 && !msaa;

// The adaptive resolution (#843): while the median frame of the last ones takes more than 20 ms (under 50 FPS), the
// pixel ratio steps down a quarter, never under `floor`. The median, so one long frame (a shader compile, a texture
// load) changes nothing. It steps back up only after a run of fast frames (stepRatio, #1580): a frame with room to spare looks the same.
const SLOW_FRAME_MS = 20;
const RATIO_STEP = 0.25;
const isSlow = (frameMs: readonly number[]): boolean => [...frameMs].sort((a, b) => a - b)[frameMs.length >> 1]! > SLOW_FRAME_MS;
export function nextPixelRatio(ratio: number, frameMs: readonly number[], floor: number): number {
  return isSlow(frameMs) ? Math.max(floor, ratio - RATIO_STEP) : ratio;
}

// The step back up (#1580): after UP_FRAMES frames in a row under FAST_FRAME_MS (60 FPS) the ratio steps up a quarter, never over
// the ceiling. A slow window within UP_JUDGE_MS of a step up is a vsync flip: the ratio the step reached is blocked for BLOCK_MS,
// and each further block is twice the last (60, 120, 240 s), so the picture does not flip every few seconds.
const FAST_FRAME_MS = 17;
const UP_FRAMES = 300;
const UP_JUDGE_MS = 10_000;
const BLOCK_MS = 60_000;
export interface RatioBack {
  /** Frames in a row under FAST_FRAME_MS. */
  fast: number;
  /** The page clock (ms) of the last step up, -Infinity before the first. */
  steppedUpAt: number;
  /** The ratio a flip blocked, NaN for none, and the page clock (ms) until which it stays blocked. */
  blockedRatio: number;
  blockedUntil: number;
  /** The length of the next block (ms). */
  blockMs: number;
}
export const RATIO_BACK_START: RatioBack = { fast: 0, steppedUpAt: -Infinity, blockedRatio: NaN, blockedUntil: 0, blockMs: BLOCK_MS };
const medianOf = (frameMs: readonly number[]): number => [...frameMs].sort((a, b) => a - b)[frameMs.length >> 1]!;
/** The pixel ratio after one window of frames (`now`: the page clock at its end): the step down is nextPixelRatio's, unchanged. */
export function stepRatio(
  ratio: number,
  back: RatioBack,
  frameMs: readonly number[],
  floor: number,
  ceiling: number,
  now: number,
): { ratio: number; back: RatioBack } {
  if (isSlow(frameMs)) {
    const lower = nextPixelRatio(ratio, frameMs, floor);
    // A slow window at the floor steps nothing down, so it flips nothing and blocks nothing.
    const flip = lower < ratio && now - back.steppedUpAt <= UP_JUDGE_MS;
    const block = flip ? { blockedRatio: ratio, blockedUntil: now + back.blockMs, blockMs: back.blockMs * 2 } : {};
    return { ratio: lower, back: { ...back, fast: 0, ...block } };
  }
  const fast = medianOf(frameMs) < FAST_FRAME_MS ? back.fast + frameMs.length : 0;
  const target = Math.min(ceiling, ratio + RATIO_STEP);
  const blocked = target === back.blockedRatio && now < back.blockedUntil;
  if (fast < UP_FRAMES || target <= ratio || blocked) return { ratio, back: { ...back, fast } };
  return { ratio: target, back: { ...back, fast: 0, steppedUpAt: now } };
}

// The lowest pixel ratio the adaptive resolution steps down to: 1 on a GPU (a fast frame at a lower one only blurs), half of it on a
// software renderer (#1483), where the cost of a frame is its pixels and a 1280 x 720 screen drawn at 0.5 still reads its cells and marbles.
export const ratioFloor = (dpr: number, software: boolean): number => (software ? 0.5 : Math.min(dpr, 1));

// The window of frames the adaptive resolution judges: 30, and 10 on a software renderer (#1483), where a window of 30 frames takes 3 s
// at 10 FPS and the two steps down to the floor 6 s.
export const ratioFrames = (software: boolean): number => (software ? 10 : 30);

// The low tier offer (#849): after SLOW_RUNS slow windows in a row (about 4 s at 30 FPS) the high tier offers the low one,
// once per page view, until the player answered. Never automatic: Accept or Dismiss, remembered.
export const SLOW_RUNS = 4;
export type LowOffer = 'accepted' | 'dismissed';
const OFFER_KEY = 'ab-alone.low-offer';
/** The count of slow windows in a row after one more window of frames: a fast window starts over. */
export const slowRun = (run: number, frameMs: readonly number[]): number => (isSlow(frameMs) ? run + 1 : 0);
export const offersLowTier = (tier: Tier, run: number, answer: LowOffer | null, shown: boolean): boolean =>
  tier !== 'low' && run >= SLOW_RUNS && answer === null && !shown;
export const readLowOffer = (store: Store): LowOffer | null => {
  const stored = read(store, OFFER_KEY);
  return stored === 'accepted' || stored === 'dismissed' ? stored : null;
};
export const writeLowOffer = (store: Store, answer: LowOffer): void => write(store, OFFER_KEY, answer);

/**
 * Airborne particles (#443): light dust/steam/smoke outside the board volume.
 * Disabled under clear board, reduced motion, low quality tier and automation.
 */
export function hasParticles(
  tier: Tier,
  clear: boolean,
  reducedMotion: boolean,
  automated: boolean,
  forced?: boolean,
): boolean {
  if (forced) return true;
  if (clear || reducedMotion || automated || tier === 'low') return false;
  return true;
}
