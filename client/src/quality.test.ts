import { describe, expect, it } from 'vitest';
import { axialTo3D, CELLS, VANISHED } from './board';
import { DIST_MAX, DIST_MIN, POLAR_MAX, POLAR_MIN, resetView, viewPosition, type View } from './camera';
import { frameShape } from './frame';
import {
  drawDue,
  isSoftwareRenderer,
  looksSoftware,
  rendererName,
  ratioFloor,
  ratioFrames,
  drawWanted,
  roomVeiled,
  timeDraw,
  fogSettings,
  readClearBoard,
  readFps,
  writeFps,
  hasReflections,
  hasBloom,
  hasNormalMaps,
  meshDetail,
  renderPixelRatio,
  smoothEdges,
  nextPixelRatio,
  stepRatio,
  RATIO_BACK_START,
  slowRun,
  offersLowTier,
  readLowOffer,
  writeLowOffer,
  SLOW_RUNS,
  readFlatHud,
  readHudFolded,
  readBoardZoom,
  writeBoardZoom,
  readTranscript,
  readSteering,
  writeSteering,
  readReducedMotion,
  readGlassSkin,
  readSafeMode,
  readMix,
  readLevels,
  writeLevel,
  readSkin,
  readPalette,
  readTheme,
  readTier,
  nextTier,
  TIERS,
  TIER_NAMES,
  hasShadows,
  readUiScale,
  tierFromHints,
  hasParticles,
  writeClearBoard,
  writeGlassSkin,
  writePalette,
  writeSafeMode,
  writeVolume,
  writeFlatHud,
  writeHudFolded,
  writeTranscript,
  writeReducedMotion,
  writeSkin,
  writeTheme,
  writeTier,
  writeUiScale,
} from './quality';

const big = { cores: 8, memory: 8, reducedMotion: false };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}
const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('tierFromHints', () => {
  it('is high on a big, capable screen', () => {
    expect(tierFromHints(big)).toBe('high');
  });
  it('judges a phone by the desktop rule, whatever its screen: high on 4 cores and 4 GB (#882)', () => {
    const phone = { width: 320, cores: 4, memory: 4, reducedMotion: false }; // the screen is no hint any more
    expect(tierFromHints(phone)).toBe('high');
    expect(tierFromHints({ cores: 6, reducedMotion: false })).toBe('high');
    expect(tierFromHints({ memory: 4, reducedMotion: false })).toBe('high');
  });
  it('is low when the user prefers reduced motion', () => {
    expect(tierFromHints({ ...big, reducedMotion: true })).toBe('low');
  });
  it('is low on few cores or little memory', () => {
    expect(tierFromHints({ ...big, cores: 2 })).toBe('low');
    expect(tierFromHints({ ...big, memory: 2 })).toBe('low');
  });
  it('ignores hints the browser does not give', () => {
    expect(tierFromHints({ reducedMotion: false })).toBe('high');
  });
});

describe('the three quality tiers (#1715)', () => {
  it('steps Low, Normal, High, then Low, and a stored Normal is read back', () => {
    expect([nextTier('low'), nextTier('normal'), nextTier('high')]).toEqual(['normal', 'high', 'low']);
    expect(TIERS.map((t) => TIER_NAMES[t])).toEqual(['Low', 'Normal', 'High']);
    expect(readTier({ getItem: () => 'normal', setItem: () => {} }, { reducedMotion: false })).toBe('normal');
    expect(readTier({ getItem: () => 'ultra', setItem: () => {} }, { reducedMotion: false })).toBe('high'); // an unknown value: the detected tier
  });
  it('draws all of High on Normal but the sun\'s shadows and the reflections', () => {
    expect([hasShadows('low'), hasShadows('normal'), hasShadows('high')]).toEqual([false, false, true]);
    expect([hasReflections('normal', false), hasReflections('high', false)]).toEqual([false, true]);
    expect([hasBloom('normal'), hasNormalMaps('normal'), hasBloom('low')]).toEqual([true, true, false]);
    expect(meshDetail('normal')).toEqual(meshDetail('high'));
    expect(offersLowTier('normal', SLOW_RUNS, null, false)).toBe(true); // a slow Normal is offered Low too
    expect(fogSettings('normal', false, resetView(), 4, 1)).toEqual(fogSettings('high', false, resetView(), 4, 1));
  });
});

describe('software rendering (#1483)', () => {
  it('takes the low tier, and a stored choice still wins', () => {
    expect(tierFromHints({ reducedMotion: false, software: true })).toBe('low');
    expect(readTier({ getItem: () => 'high', setItem: () => {} }, { reducedMotion: false, software: true })).toBe('high');
  });
  it('knows the software renderers by their name, and a GPU is none', () => {
    for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Mesa softpipe', 'Microsoft Basic Render Driver', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)', 'Software Rasterizer', 'lavapipe', 'ANGLE (Microsoft WARP)']) {
      expect(isSoftwareRenderer(name), name).toBe(true);
    }
    for (const name of ['', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'NVIDIA GeForce RTX 4070']) expect(isSoftwareRenderer(name), name).toBe(false);
  });
  it('reads the name of the GPU of a WebGL backend, a WebGPU adapter, or nothing', () => {
    const gl = (info: unknown) => ({ getExtension: () => info, getParameter: () => 'llvmpipe' });
    expect(rendererName({ gl: gl({ UNMASKED_RENDERER_WEBGL: 37446 }) })).toBe('llvmpipe');
    expect(isSoftwareRenderer(rendererName({ gl: gl(null), adapter: { info: { description: 'SwiftShader' } } }))).toBe(true); // no extension: the adapter
    expect(rendererName({ adapter: { isFallbackAdapter: true } })).toContain('software');
    expect(rendererName({ adapter: { info: { description: 'Apple', device: 'M2' } } })).toBe('Apple M2');
    expect(rendererName({})).toBe('');
    expect(rendererName({ gl: gl(null) })).toBe('');
  });
  it('lets the adaptive resolution go down to half a pixel ratio, where a GPU stops at 1', () => {
    expect([ratioFloor(2, false), ratioFloor(0.75, false), ratioFloor(2, true), ratioFloor(1, true)]).toEqual([1, 0.75, 0.5, 0.5]);
    expect([ratioFrames(false), ratioFrames(true)]).toEqual([30, 10]);
  });
  it('is measured: a first window of frames over 100 ms is no GPU, a window of 16 ms frames with one long frame is', () => {
    expect(looksSoftware([])).toBe(false);
    expect(looksSoftware([180, 150, 170, 140, 160])).toBe(true);
    expect(looksSoftware([16, 16, 900, 16, 16])).toBe(false);
  });
});

describe('fogSettings', () => {
  // Fog is linear on the depth along the view axis, like THREE.Fog.
  const factor = (f: { near: number; far: number }, depth: number): number =>
    Math.min(1, Math.max(0, (depth - f.near) / (f.far - f.near)));
  // Depth of a point of the board plane for a camera that looks at the board centre.
  const depth = (v: View, x: number, z: number): number => {
    const c = viewPosition(v);
    const len = Math.hypot(c.x, c.y, c.z);
    return ((x - c.x) * -c.x + -c.y * -c.y + (z - c.z) * -c.z) / len;
  };
  const DISC = 0.46; // a cell disc's radius (main.ts)
  const ring = ([q, r]: readonly [number, number]): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  const views: View[] = [];
  for (let k = 0; k < 24; k++) {
    for (const polar of [POLAR_MIN, resetView().polar, POLAR_MAX]) {
      for (const distance of [DIST_MIN, resetView().distance, DIST_MAX]) views.push({ azimuth: (k * Math.PI) / 12, polar, distance });
    }
  }

  // Bug #399: the fog was over the far rim cells. At every view, for the full board and The Choir's radius 3.
  for (const tier of ['low', 'high'] as const) {
    for (const radius of [4, 3]) {
      const cells = CELLS.filter((c) => ring(c) <= radius);
      const outer = frameShape(CELLS.map((c) => (ring(c) > radius ? VANISHED : 0))).outer;
      it(`${tier}, radius ${radius}: never over a cell, gentle at the rim, extends into bay (#665)`, () => {
        for (const v of views) {
          const fog = fogSettings(tier, false, v, radius, 1)!;
          const reach = DISC * Math.sin(v.polar); // the disc's farthest point from its centre, along the view
          const cellDepth = Math.max(...cells.map(([q, r]) => depth(v, axialTo3D(q, r).x, axialTo3D(q, r).z) + reach));
          expect(factor(fog, cellDepth)).toBe(0);
          expect(factor(fog, Math.max(...outer.map((p) => depth(v, p.x, p.z))))).toBeLessThan(0.05);
          expect(fog.far - fog.near).toBeGreaterThanOrEqual(30);
        }
      });
    }
  }
  // #896: a span of 52 left the bay haze nearly invisible (mean RGB diff 0.0076 < 0.01): a shorter span thickens it.
  it('the bay haze is thick enough to show, a span of at most 36 on high (#896)', () => {
    const fog = fogSettings('high', false, resetView(), 4, 1)!;
    expect(fog.far - fog.near).toBeLessThanOrEqual(36);
  });
  it('is lighter on low than on high', () => {
    const low = fogSettings('low', false, resetView(), 4, 1)!;
    const high = fogSettings('high', false, resetView(), 4, 1)!;
    expect(low.near).toBe(high.near);
    expect(low.far).toBeGreaterThan(high.far);
  });
  it('extends far smoothly to 45m+ at default view on standard density (#665)', () => {
    const fog = fogSettings('high', false, resetView(), 4, 1)!;
    expect(fog.far).toBeGreaterThanOrEqual(45);
  });
  // #400: a deck's density thickens the fog over the rim, from the same start: never over a cell on any deck.
  it('a denser deck fog starts at the same edge and is thick sooner, at every view', () => {
    for (const v of views) {
      const haze = fogSettings('high', false, v, 4, 1)!;
      const steam = fogSettings('high', false, v, 4, 2)!;
      expect(steam.near).toBe(haze.near);
      expect(steam.far - steam.near).toBeCloseTo((haze.far - haze.near) / 2);
    }
  });
  it('is off in clear-board mode, in every tier and on every deck', () => {
    for (const density of [0.3, 1, 2]) {
      expect(fogSettings('low', true, resetView(), 4, density)).toBeNull();
      expect(fogSettings('high', true, resetView(), 4, density)).toBeNull();
    }
  });
});

describe('shell skin storage: Scarab ridges unless the player picked another', () => {
  it('defaults to scarab, reads back what was written, under its own key', () => {
    const s = memoryStorage();
    expect(readSkin(s)).toBe('scarab');
    writeSkin(s, 'hex');
    expect(s.data.get('ab-alone.shell-skin')).toBe('hex');
    expect(readSkin(s)).toBe('hex');
  });
  it('ignores an unknown stored id, and survives storage that throws or is missing', () => {
    expect(readSkin(memoryStorage({ 'ab-alone.shell-skin': 'gold' }))).toBe('scarab');
    expect(readSkin(throwing)).toBe('scarab');
    expect(readSkin(null)).toBe('scarab');
    expect(() => writeSkin(throwing, 'hex')).not.toThrow();
  });
});

describe('glass skin storage: Smoked glass unless the player picked another', () => {
  it('defaults to smoked, reads back what was written, under its own key', () => {
    const s = memoryStorage();
    expect(readGlassSkin(s)).toBe('smoked');
    writeGlassSkin(s, 'frost');
    expect(s.data.get('ab-alone.glass-skin')).toBe('frost');
    expect(readGlassSkin(s)).toBe('frost');
  });
  it('ignores an unknown stored id, and survives storage that throws or is missing', () => {
    expect(readGlassSkin(memoryStorage({ 'ab-alone.glass-skin': 'gold' }))).toBe('smoked');
    expect(readGlassSkin(throwing)).toBe('smoked');
    expect(readGlassSkin(null)).toBe('smoked');
    expect(() => writeGlassSkin(throwing, 'frost')).not.toThrow();
  });
});

describe('theme storage: Dark unless the player picked System or Light', () => {
  it('defaults to dark (#1184)', () => {
    expect(readTheme(memoryStorage())).toBe('dark');
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeTheme(s, 'light');
    expect(s.data.get('ab-alone.theme')).toBe('light');
    expect(readTheme(s)).toBe('light');
    writeTheme(s, 'system');
    expect(s.data.get('ab-alone.theme')).toBe('system');
    expect(readTheme(s)).toBe('system');
  });
  it('ignores a garbage stored value: dark', () => {
    expect(readTheme(memoryStorage({ 'ab-alone.theme': 'blue' }))).toBe('dark');
  });
  it('falls back to dark when storage throws or is missing, and does not throw writing', () => {
    expect(readTheme(throwing)).toBe('dark');
    expect(readTheme(null)).toBe('dark');
    expect(() => writeTheme(throwing, 'dark')).not.toThrow();
    expect(() => writeTheme(null, 'dark')).not.toThrow();
  });
});

describe('palette storage: default unless the player picked one', () => {
  it('defaults to default', () => {
    expect(readPalette(memoryStorage())).toBe('default');
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writePalette(s, 'protan');
    expect(s.data.get('ab-alone.palette')).toBe('protan');
    expect(readPalette(s)).toBe('protan');
  });
  it('ignores garbage value and falls back to default', () => {
    expect(readPalette(memoryStorage({ 'ab-alone.palette': 'invalid' }))).toBe('default');
  });
  it('falls back to default when storage throws or is missing', () => {
    expect(readPalette(throwing)).toBe('default');
    expect(readPalette(null)).toBe('default');
    expect(() => writePalette(throwing, 'protan')).not.toThrow();
    expect(() => writePalette(null, 'protan')).not.toThrow();
  });
});

describe('FPS readout storage (#426)', () => {
  it('is off by default, and off when storage throws or is missing', () => {
    expect(readFps(memoryStorage())).toBe(false);
    expect(readFps(throwing)).toBe(false);
    expect(readFps(null)).toBe(false);
  });
  it('writes then reads back, and a blocked write does not throw', () => {
    const s = memoryStorage();
    writeFps(s, true);
    expect(readFps(s)).toBe(true);
    writeFps(s, false);
    expect(readFps(s)).toBe(false);
    expect(() => writeFps(throwing, true)).not.toThrow();
  });
});

describe('transcript storage (#516): on unless the player turned it off', () => {
  it('defaults to on', () => {
    expect(readTranscript(memoryStorage())).toBe(true);
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeTranscript(s, false);
    expect(s.data.get('ab-alone.transcript')).toBe('off');
    expect(readTranscript(s)).toBe(false);
    writeTranscript(s, true);
    expect(s.data.get('ab-alone.transcript')).toBe('on');
    expect(readTranscript(s)).toBe(true);
  });
  it('falls back to on when storage throws or is missing, and does not throw writing', () => {
    expect(readTranscript(throwing)).toBe(true);
    expect(readTranscript(null)).toBe(true);
    expect(() => writeTranscript(throwing, false)).not.toThrow();
  });
});

describe('folded HUD panel storage (#957): unfolded unless the player folded it', () => {
  it('writes then reads back, under its own key, unfolded by default and when storage throws', () => {
    const s = memoryStorage();
    expect(readHudFolded(s)).toBe(false);
    writeHudFolded(s, true);
    expect(s.data.get('ab-alone.hud-folded')).toBe('on');
    expect(readHudFolded(s)).toBe(true);
    writeHudFolded(s, false);
    expect(readHudFolded(s)).toBe(false);
    expect(readHudFolded(throwing)).toBe(false);
  });
});

describe('flat HUD storage (#391): off unless the player turned it on', () => {
  it('defaults to off', () => {
    expect(readFlatHud(memoryStorage())).toBe(false);
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeFlatHud(s, true);
    expect(s.data.get('ab-alone.flat-hud')).toBe('on');
    expect(readFlatHud(s)).toBe(true);
    writeFlatHud(s, false);
    expect(s.data.get('ab-alone.flat-hud')).toBe('off');
    expect(readFlatHud(s)).toBe(false);
  });
  it('falls back to off when storage throws or is missing, and does not throw writing', () => {
    expect(readFlatHud(throwing)).toBe(false);
    expect(readFlatHud(null)).toBe(false);
    expect(() => writeFlatHud(throwing, true)).not.toThrow();
    expect(() => writeFlatHud(null, true)).not.toThrow();
  });
});

describe('reduced motion storage (#379): no choice until the player presses the toggle', () => {
  it('defaults to no choice, so the system setting decides', () => {
    expect(readReducedMotion(memoryStorage())).toBeNull();
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeReducedMotion(s, true);
    expect(s.data.get('ab-alone.reduced-motion')).toBe('on');
    expect(readReducedMotion(s)).toBe(true);
    writeReducedMotion(s, false);
    expect(s.data.get('ab-alone.reduced-motion')).toBe('off');
    expect(readReducedMotion(s)).toBe(false);
  });
  it('ignores a garbage stored value: no choice', () => {
    expect(readReducedMotion(memoryStorage({ 'ab-alone.reduced-motion': 'slow' }))).toBeNull();
  });
  it('falls back to no choice when storage throws or is missing, and does not throw writing', () => {
    expect(readReducedMotion(throwing)).toBeNull();
    expect(readReducedMotion(null)).toBeNull();
    expect(() => writeReducedMotion(throwing, true)).not.toThrow();
    expect(() => writeReducedMotion(null, true)).not.toThrow();
  });
});

describe('clear-board storage', () => {
  it('defaults to off', () => {
    expect(readClearBoard(memoryStorage())).toBe(false);
  });
  it('writes then reads back', () => {
    const s = memoryStorage();
    writeClearBoard(s, true);
    expect(readClearBoard(s)).toBe(true);
    writeClearBoard(s, false);
    expect(readClearBoard(s)).toBe(false);
  });
  it('falls back to off when storage throws or is missing', () => {
    expect(readClearBoard(throwing)).toBe(false);
    expect(readClearBoard(null)).toBe(false);
  });
  it('does not throw when writing to a broken or missing storage', () => {
    expect(() => writeClearBoard(throwing, true)).not.toThrow();
    expect(() => writeClearBoard(null, true)).not.toThrow();
  });
});

describe('the three light sliders: bloom, lamps, lights', () => {
  it('defaults to the levels the owner tuned (bloom 20, lamps 25, lights 215 %), and reads back a saved slider under its own key', () => {
    const s = memoryStorage();
    expect(readLevels(s)).toEqual({ bloom: 20, lamps: 25, lights: 215 });
    writeLevel(s, 'lamps', 250);
    writeLevel(s, 'bloom', 0);
    expect(s.data.get('ab-alone.light.lamps')).toBe('250');
    expect(readLevels(s)).toEqual({ bloom: 0, lamps: 250, lights: 215 });
  });
  it('ignores a garbage stored value, and a stored value over 300 %: the default', () => {
    for (const bad of ['bright', '', '-5', '301', '50.5']) expect(readLevels(memoryStorage({ 'ab-alone.light.lights': bad })).lights).toBe(215);
  });
  it('falls back to the default when storage throws or is missing, and does not throw when writing to it', () => {
    expect(readLevels(throwing).bloom).toBe(20);
    expect(readLevels(null).bloom).toBe(20);
    expect(() => writeLevel(throwing, 'bloom', 0)).not.toThrow();
    expect(() => writeLevel(null, 'bloom', 0)).not.toThrow();
  });
});

describe('mix storage, the four volume sliders (#438)', () => {
  it('defaults to music, effects and voice at 100 %, ambience at 5 %', () => {
    expect(readMix(memoryStorage())).toEqual({ music: 100, ambience: 5, effects: 100, voice: 100 });
  });
  it('writes then reads back each slider, under its own key', () => {
    const s = memoryStorage();
    writeVolume(s, 'music', 30);
    writeVolume(s, 'voice', 0);
    expect(s.data.get('ab-alone.volume.music')).toBe('30');
    expect(s.data.get('ab-alone.volume.voice')).toBe('0');
    expect(readMix(s)).toEqual({ music: 30, ambience: 5, effects: 100, voice: 0 });
  });
  it('maps an old saved Sound off to every slider at 0, and on to defaults', () => {
    expect(readMix(memoryStorage({ 'ab-alone.sound': 'off' }))).toEqual({ music: 0, ambience: 0, effects: 0, voice: 0 });
    expect(readMix(memoryStorage({ 'ab-alone.sound': 'on' }))).toEqual({ music: 100, ambience: 5, effects: 100, voice: 100 });
  });
  it('a slider saved since wins over the old Sound off', () => {
    const s = memoryStorage({ 'ab-alone.sound': 'off' });
    writeVolume(s, 'effects', 70);
    expect(readMix(s)).toEqual({ music: 0, ambience: 0, effects: 70, voice: 0 });
  });
  it('ignores a garbage stored value: the default of that slider', () => {
    for (const bad of ['loud', '', '-5', '101', '50.5']) {
      expect(readMix(memoryStorage({ 'ab-alone.volume.music': bad })).music).toBe(100);
    }
  });
  it('falls back to 100 % when storage throws or is missing', () => {
    expect(readMix(throwing).effects).toBe(100);
    expect(readMix(null).effects).toBe(100);
  });
  it('under automation the music slider defaults to 0, the other three keep their defaults (#990)', () => {
    expect(readMix(memoryStorage(), true)).toEqual({ music: 0, ambience: 5, effects: 100, voice: 100 });
  });
  it('a normal browser keeps the music slider at 100 % (#990)', () => {
    expect(readMix(memoryStorage(), false)).toEqual({ music: 100, ambience: 5, effects: 100, voice: 100 });
  });
  it('a music slider saved by the player wins over the automated default (#990)', () => {
    expect(readMix(memoryStorage({ 'ab-alone.volume.music': '40' }), true).music).toBe(40);
    expect(readMix(memoryStorage({ 'ab-alone.volume.music': '100' }), true).music).toBe(100);
  });
  it('a garbage stored music value under automation falls back to 0 (#990)', () => {
    expect(readMix(memoryStorage({ 'ab-alone.volume.music': 'loud' }), true).music).toBe(0);
  });
  it('under automation the music default is 0 when storage throws or is missing (#990)', () => {
    expect(readMix(throwing, true).music).toBe(0);
    expect(readMix(null, true).music).toBe(0);
    expect(readMix(throwing, true).effects).toBe(100);
  });
  it('does not throw when writing to a broken or missing storage', () => {
    expect(() => writeVolume(throwing, 'music', 0)).not.toThrow();
    expect(() => writeVolume(null, 'music', 0)).not.toThrow();
  });
});

describe('safe mode storage: on unless the player turned it off (#380)', () => {
  it('defaults to on', () => {
    expect(readSafeMode(memoryStorage())).toBe(true);
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeSafeMode(s, false);
    expect(s.data.get('ab-alone.safe-mode')).toBe('off');
    expect(readSafeMode(s)).toBe(false);
    writeSafeMode(s, true);
    expect(readSafeMode(s)).toBe(true);
  });
  it('falls back to on when storage throws or is missing', () => {
    expect(readSafeMode(throwing)).toBe(true);
    expect(readSafeMode(null)).toBe(true);
  });
});

describe('UI scale storage: 100 % unless the player picked a step (#382)', () => {
  it('defaults to 100', () => {
    expect(readUiScale(memoryStorage())).toBe(100);
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeUiScale(s, 175);
    expect(s.data.get('ab-alone.ui-scale')).toBe('175');
    expect(readUiScale(s)).toBe(175);
  });
  it('ignores a value that is not a step', () => {
    expect(readUiScale(memoryStorage({ 'ab-alone.ui-scale': '300' }))).toBe(100);
    expect(readUiScale(memoryStorage({ 'ab-alone.ui-scale': 'big' }))).toBe(100);
  });
  it('falls back to 100 when storage throws or is missing', () => {
    expect(readUiScale(throwing)).toBe(100);
    expect(readUiScale(null)).toBe(100);
    expect(() => writeUiScale(throwing, 200)).not.toThrow();
  });
});

describe('tier storage', () => {
  it('uses the device default when nothing is stored, without storing it: a later rule applies at once (#882)', () => {
    const s = memoryStorage();
    expect(readTier(s, { ...big, cores: 2 })).toBe('low');
    expect(s.data.size).toBe(0);
  });
  it('ignores the tier an earlier version stored on its own under ab-alone.quality (#882)', () => {
    expect(readTier(memoryStorage({ 'ab-alone.quality': 'low' }), big)).toBe('high');
  });
  it('prefers a stored valid tier over the device default', () => {
    expect(readTier(memoryStorage({ 'ab-alone.tier': 'low' }), big)).toBe('low');
    expect(readTier(memoryStorage({ 'ab-alone.tier': 'high' }), { ...big, cores: 2 })).toBe('high');
  });
  it('ignores a garbage stored value', () => {
    expect(readTier(memoryStorage({ 'ab-alone.tier': 'ultra' }), big)).toBe('high');
  });
  it('falls back to the device default when storage throws', () => {
    expect(readTier(throwing, big)).toBe('high');
    expect(readTier(null, { ...big, cores: 2 })).toBe('low');
  });
  it('writeTier stores and survives a broken storage', () => {
    const s = memoryStorage();
    writeTier(s, 'high');
    expect(s.data.get('ab-alone.tier')).toBe('high');
    expect(() => writeTier(throwing, 'low')).not.toThrow();
    expect(() => writeTier(null, 'low')).not.toThrow();
  });
});

describe('smoothEdges (#857)', () => {
  it('is FXAA below a drawn ratio of 1.5 on a renderer without MSAA only', () => {
    expect(smoothEdges(1, false)).toBe(true);
    expect(smoothEdges(0.5, false)).toBe(true); // under automation the canvas is drawn at 0.5
    expect(smoothEdges(1.5, false)).toBe(false);
    expect(smoothEdges(1, true)).toBe(false);
  });
});

describe('renderPixelRatio (#424)', () => {
  it('gives a phone up to 1.5 like any player: at 1 a DPR-3 screen stretched every drawn pixel 3 times, a blur', () => {
    expect(renderPixelRatio(3, false)).toBe(1.5);
    expect(renderPixelRatio(0.8, false)).toBe(0.8);
  });
  it('caps every player at 1.5 DPR: a full-screen Retina window at 2 drew 10 FPS (#843)', () => {
    expect(renderPixelRatio(1, false)).toBe(1);
    expect(renderPixelRatio(2, false)).toBe(1.5);
    expect(renderPixelRatio(3, false)).toBe(1.5);
  });
  it('renders at half the pixels under automation, so software WebGL costs less per frame', () => {
    expect(renderPixelRatio(1, true)).toBe(0.5);
    expect(renderPixelRatio(2, true)).toBe(0.5);
  });
  it('never renders above the device ratio under automation', () => {
    expect(renderPixelRatio(0.5, true)).toBe(0.5);
  });
});

describe('nextPixelRatio, the adaptive resolution (#843)', () => {
  const frames = (ms: number, n = 30): number[] => Array.from({ length: n }, () => ms);
  it('steps down by a quarter while the frames take more than 20 ms', () => {
    expect(nextPixelRatio(1.5, frames(40), 1)).toBe(1.25);
    expect(nextPixelRatio(1.25, frames(21), 1)).toBe(1);
  });
  it('keeps the ratio while the frames are fast enough', () => {
    expect(nextPixelRatio(1.5, frames(16.7), 1)).toBe(1.5);
    expect(nextPixelRatio(1.5, frames(20), 1)).toBe(1.5);
  });
  it('never goes under the floor', () => {
    expect(nextPixelRatio(1, frames(50), 1)).toBe(1);
    expect(nextPixelRatio(1.1, frames(50), 1)).toBe(1);
  });
  it('reads the median: one long frame (a shader compile, a texture load) changes nothing', () => {
    expect(nextPixelRatio(1.5, [...frames(16, 29), 8000], 1)).toBe(1.5);
  });
});

describe('stepRatio, the step back up (#1580)', () => {
  // Runs the adaptive resolution (main.ts endWindow) over windows of 30 frames: `frameMs(i)` is the i-th frame's time.
  // Returns each change of the ratio with its time on the page clock (ms).
  function drive(frameMs: (i: number) => number, frames: number, start: number, ceiling: number): { at: number; ratio: number }[] {
    const changes: { at: number; ratio: number }[] = [];
    let ratio = start;
    let back = RATIO_BACK_START;
    let now = 0;
    let win: number[] = [];
    for (let i = 0; i < frames; i++) {
      const ms = frameMs(i);
      now += ms;
      win.push(ms);
      if (win.length < 30) continue;
      const next = stepRatio(ratio, back, win, 1, ceiling, now);
      if (next.ratio !== ratio) changes.push({ at: now, ratio: next.ratio });
      ratio = next.ratio;
      back = next.back;
      win = [];
    }
    return changes;
  }
  // Ten fast windows (300 frames at 16 ms), then one slow window at 25 ms: the step up is flipped back at once, every time.
  const flicker = (i: number): number => (Math.floor(i / 30) % 11 === 10 ? 25 : 16);

  it('steps up after 300 frames under 17 ms, not before', () => {
    expect(drive(() => 16, 270, 1, 1.25)).toEqual([]);
    expect(drive(() => 16, 300, 1, 1.25)).toEqual([{ at: 4800, ratio: 1.25 }]);
  });
  it('a 60 Hz trace (16.7 ms) steps up once and stays at the ceiling', () => {
    expect(drive(() => 1000 / 60, 30 * 200, 1, 1.25).map((c) => c.ratio)).toEqual([1.25]);
  });
  it('a 30 Hz trace (33.3 ms) never steps up', () => {
    expect(drive(() => 1000 / 30, 30 * 100, 1.5, 1.5).map((c) => c.ratio)).toEqual([1.25, 1]);
  });
  it('a median between 17 and 20 ms keeps the ratio: no step up, no step down', () => {
    expect(drive(() => 18, 30 * 100, 1.25, 1.5)).toEqual([]);
  });
  it('a slow window more than 10 s after a step up steps down without a block', () => {
    const late = (i: number): number => (Math.floor(i / 30) === 35 ? 25 : 16);
    expect(drive(late, 30 * 46, 1, 1.25)).toEqual([
      { at: 4800, ratio: 1.25 },
      { at: 17550, ratio: 1 },
      { at: 22350, ratio: 1.25 },
    ]);
  });
  it('a slow window within 10 s of a step up blocks that ratio: the flicker flips at most once per 60 s', () => {
    const ups = drive(flicker, 30 * 11 * 120, 1, 1.5).filter((c) => c.ratio > 1);
    const gaps = ups.slice(1).map((c, i) => c.at - ups[i]!.at);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.every((g) => g >= 60000)).toBe(true);
  });
  it('the block doubles each time: 60 s, then 120 s, then 240 s', () => {
    const ups = drive(flicker, 30 * 11 * 200, 1, 1.5).filter((c) => c.ratio > 1);
    const gaps = ups.slice(1).map((c, i) => c.at - ups[i]!.at);
    expect(gaps[0]).toBeGreaterThanOrEqual(60000);
    expect(gaps[0]).toBeLessThan(62000);
    expect(gaps[1]).toBeGreaterThanOrEqual(120000);
    expect(gaps[1]).toBeLessThan(126000);
    expect(gaps[2]).toBeGreaterThanOrEqual(240000);
  });
});

describe('mobile quality optimizations (#424)', () => {
  it('hasReflections returns true on high tier only, skipping PMREM on low tier and automation', () => {
    expect(hasReflections('high', false)).toBe(true);
    expect(hasReflections('low', false)).toBe(false);
    expect(hasReflections('high', true)).toBe(false);
    expect(hasReflections('low', true)).toBe(false);
  });

  it('meshDetail reduces geometry segments on low tier / mobile', () => {
    const low = meshDetail('low');
    expect(low.discSegments).toBe(16);
    expect(low.marbleWidthSegments).toBe(16);
    expect(low.marbleHeightSegments).toBe(12);

    const high = meshDetail('high');
    expect(high.discSegments).toBe(32);
    expect(high.marbleWidthSegments).toBe(32);
    expect(high.marbleHeightSegments).toBe(16);
  });
});

describe('drawDue', () => {
  it('draws every frame for a player, whatever the draw cost', () => {
    expect(drawDue(1000, 999, 500, false, false)).toBe(true);
  });
  it('draws at most 10 times a second under automation', () => {
    expect(drawDue(1099, 1000, 5, false, true)).toBe(false);
    expect(drawDue(1100, 1000, 5, false, true)).toBe(true);
  });
  it('waits four times a slow draw under automation, so software WebGL leaves the CPU to the input', () => {
    expect(drawDue(1799, 1000, 200, false, true)).toBe(false);
    expect(drawDue(1800, 1000, 200, false, true)).toBe(true);
  });
  it('does not hold a draw a test asked for behind a slow draw, the one that compiled the shaders, bug #435', () => {
    expect(drawDue(1099, 1000, 3000, true, true)).toBe(false);
    expect(drawDue(1100, 1000, 3000, true, true)).toBe(true);
  });
});

describe('timeDraw', () => {
  it('times a draw up to the next animation frame, which software WebGL delays by the GPU time, bug #921', () => {
    expect(timeDraw({ start: 1000, cost: 5, timed: false }, 2100)).toEqual({ start: 1000, cost: 1100, timed: true });
  });
  it('keeps a timed draw as it is on the frames after', () => {
    const timed = { start: 1000, cost: 1100, timed: true };
    expect(timeDraw(timed, 3000)).toBe(timed);
  });
  it('holds an unasked draw four times the GPU time under automation, an asked one only 100 ms', () => {
    const last = timeDraw({ start: 1000, cost: 5, timed: false }, 2100);
    expect(drawDue(5399, last.start, last.cost, false, true)).toBe(false);
    expect(drawDue(5400, last.start, last.cost, false, true)).toBe(true);
    expect(drawDue(2100, last.start, last.cost, true, true)).toBe(true);
  });
});

describe('drawWanted (#848)', () => {
  it('leaves a still board undrawn for a player', () => {
    expect(drawWanted(false, false, false, false)).toBe(false);
  });
  it('draws for a player once the picture changed, while an effect moves, or when a test asked', () => {
    expect(drawWanted(true, false, false, false)).toBe(true);
    expect(drawWanted(false, true, false, false)).toBe(true);
    expect(drawWanted(false, false, true, false)).toBe(true);
  });
  it('leaves automation to its throttle alone, so the browser checks still see draws on a still board', () => {
    expect(drawWanted(false, false, false, true)).toBe(true);
  });
});

describe('roomVeiled (#1481)', () => {
  it('skips the frame the veil hides: the room, drawn before the terrace, is never seen', () => {
    expect(roomVeiled(true, false)).toBe(true);
  });
  it('draws once the terrace is on, or when no veil was put up (?scene=room, the Open world)', () => {
    expect(roomVeiled(true, true)).toBe(false);
    expect(roomVeiled(false, false)).toBe(false);
    expect(roomVeiled(false, true)).toBe(false);
  });
});

describe('hasParticles and the pixel ratio', () => {
  describe('hasParticles (#443)', () => {
    it('enables particles for high tier when clear, reduced motion and automation are off', () => {
      expect(hasParticles('high', false, false, false)).toBe(true);
    });

    it('disables particles under low quality tier', () => {
      expect(hasParticles('low', false, false, false)).toBe(false);
    });

    it('disables particles under clear board', () => {
      expect(hasParticles('high', true, false, false)).toBe(false);
    });

    it('disables particles under reduced motion', () => {
      expect(hasParticles('high', false, true, false)).toBe(false);
    });

    it('disables particles under automation to save software WebGL', () => {
      expect(hasParticles('high', false, false, true)).toBe(false);
    });

    it('allows forcing particles on under automation for tests/screenshots', () => {
      expect(hasParticles('low', false, false, true, true)).toBe(true);
    });
  });
});

describe('steering storage (#1137): on unless the player turned it off', () => {
  it('defaults to on', () => {
    expect(readSteering(memoryStorage())).toBe(true);
  });
  it('writes then reads back, under its own key', () => {
    const s = memoryStorage();
    writeSteering(s, false);
    expect(s.data.get('ab-alone.steering')).toBe('off');
    expect(readSteering(s)).toBe(false);
    writeSteering(s, true);
    expect(s.data.get('ab-alone.steering')).toBe('on');
    expect(readSteering(s)).toBe(true);
  });
  it('falls back to on when storage throws or is missing, and does not throw writing', () => {
    expect(readSteering(throwing)).toBe(true);
    expect(readSteering(null)).toBe(true);
    expect(() => writeSteering(throwing, false)).not.toThrow();
  });
});

describe('the low tier drops the costly passes of the board room (#849)', () => {
  it('draws no bloom pass on low, one on high', () => {
    expect(hasBloom('low')).toBe(false);
    expect(hasBloom('high')).toBe(true);
  });

  it('loads and draws no normal map on low, the maps on high', () => {
    expect(hasNormalMaps('low')).toBe(false);
    expect(hasNormalMaps('high')).toBe(true);
  });
});

describe('the low tier offer after a sustained slow frame rate (#849)', () => {
  const frames = (ms: number, n = 30): number[] => Array.from({ length: n }, () => ms);
  it('counts consecutive slow windows (median over 20 ms) and a fast one starts over', () => {
    expect(slowRun(0, frames(40))).toBe(1);
    expect(slowRun(2, frames(40))).toBe(3);
    expect(slowRun(3, frames(16.7))).toBe(0);
    expect(slowRun(3, [...frames(16, 29), 8000])).toBe(0); // one long frame is no slow window
  });
  it('offers the low tier only after SLOW_RUNS slow windows, on the high tier, once, until answered', () => {
    expect(offersLowTier('high', SLOW_RUNS, null, false)).toBe(true);
    expect(offersLowTier('high', SLOW_RUNS - 1, null, false)).toBe(false);
    expect(offersLowTier('low', SLOW_RUNS, null, false)).toBe(false);
    expect(offersLowTier('high', SLOW_RUNS, 'dismissed', false)).toBe(false);
    expect(offersLowTier('high', SLOW_RUNS, null, true)).toBe(false); // once per session
  });
  it('remembers the answer', () => {
    const data: Record<string, string> = {};
    const store = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    expect(readLowOffer(store)).toBeNull();
    writeLowOffer(store, 'dismissed');
    expect(readLowOffer(store)).toBe('dismissed');
    data['ab-alone.low-offer'] = 'junk';
    expect(readLowOffer(store)).toBeNull();
    expect(readLowOffer(null)).toBeNull();
  });
});

describe('board zoom storage (#1567): off unless the player turned it on, per device', () => {
  it('writes then reads back, under its own key, off by default and when storage throws', () => {
    const s = memoryStorage();
    expect(readBoardZoom(s)).toBe(false);
    writeBoardZoom(s, true);
    expect(s.data.get('ab-alone.board-zoom')).toBe('on');
    expect(readBoardZoom(s)).toBe(true);
    writeBoardZoom(s, false);
    expect(readBoardZoom(s)).toBe(false);
    expect(readBoardZoom(throwing)).toBe(false);
  });
});
