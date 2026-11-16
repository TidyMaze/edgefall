import { describe, expect, it } from 'vitest';
import { ICONS } from './icons';
import { archiveList, LEVEL_NAMES, menuOpen, motionReduced, nextDisplay, nextTheme, settingsList, themeAttribute, VOLUME_NAMES } from './settings';
import { BUSES } from './sound';
import { LEVELS } from './lightpanel';
import { glassSkinById } from './glassskins';
import { PALETTE_NAMES } from './palettes';
import { skinById } from './skins';

describe('settingsList', () => {
  it('without a difficulty argument, the row reads Easy: 50% (#1664)', () => {
    const row = settingsList(false, 'system', 'scarab', 'smoked', 100, true, false, false, 'default', true).find((x) => x.id === 'difficulty');
    expect(row!.label).toBe('Difficulty: 50%');
  });

  it('lists Clear board, Quality, Reduced motion, Flat HUD, Sound, Transcript, Difficulty, Theme, Palette, shell and glass skin, Export and Import game', () => {
    expect(settingsList(false, 'system', 'scarab', 'smoked', 100, true, false, false, 'default', true, 'normal')).toEqual([
      { id: 'clear-board', label: 'Clear board', icon: 'fog', on: false },
      { id: 'quality', label: 'Quality: High', icon: 'render' }, // a fresh profile on a strong device (#1715)
      { id: 'reduced-motion', label: 'Reduced motion', icon: 'motion', on: false },
      { id: 'flat-hud', label: 'Flat HUD', icon: 'flat', on: false },
      { id: 'sound', label: 'Sound', icon: 'sound' },
      { id: 'transcript', label: 'Transcript', icon: 'transcript', on: true },
      { id: 'theme', label: 'Theme: System', icon: 'theme', on: true },
      { id: 'palette', label: 'Palette: Default', icon: 'palette' },
      { id: 'shell-skin', label: `Shell: ${skinById('scarab').name}`, icon: 'skin' },
      { id: 'glass-skin', label: `Glass: ${glassSkinById('smoked').name}`, icon: 'skin' },
      { id: 'render-mode', label: 'Render: Normal', icon: 'render' },
      { id: 'free-cam', label: 'Free camera', icon: 'camera', on: false },
      { id: 'steering', label: 'Steering', icon: 'steer', on: true },
      { id: 'guide', label: 'Guide', icon: 'guide' }, // the first-launch guide again (#1293)
      { id: 'export-game', label: 'Export game', icon: 'export' },
      { id: 'difficulty', label: 'Difficulty: 100%', icon: 'scale' },
      { id: 'import-game', label: 'Import game', icon: 'import' },
    ]);
    expect(settingsList(true, 'light', 'scarab', 'frost', 200, false, true, true, 'protan', false, 'hard', 'clay', true, false, 'normal')).toEqual([
      { id: 'clear-board', label: 'Clear board', icon: 'fog', on: true },
      { id: 'quality', label: 'Quality: Normal', icon: 'render' },
      { id: 'reduced-motion', label: 'Reduced motion', icon: 'motion', on: true },
      { id: 'flat-hud', label: 'Flat HUD', icon: 'flat', on: true },
      { id: 'sound', label: 'Sound', icon: 'sound' },
      { id: 'transcript', label: 'Transcript', icon: 'transcript', on: false },
      { id: 'theme', label: 'Theme: Light', icon: 'theme', on: false },
      { id: 'palette', label: 'Palette: Protan', icon: 'palette' },
      { id: 'shell-skin', label: `Shell: ${skinById('scarab').name}`, icon: 'skin' },
      { id: 'glass-skin', label: `Glass: ${glassSkinById('frost').name}`, icon: 'skin' },
      { id: 'render-mode', label: 'Render: Clay', icon: 'render' },
      { id: 'free-cam', label: 'Free camera', icon: 'camera', on: true },
      { id: 'steering', label: 'Steering', icon: 'steer', on: false },
      { id: 'guide', label: 'Guide', icon: 'guide' },
      { id: 'export-game', label: 'Export game', icon: 'export' },
      { id: 'difficulty', label: 'Difficulty: 200%', icon: 'scale' },
      { id: 'import-game', label: 'Import game', icon: 'import' },
    ]);
  });

  it('keeps the menu at seventeen items, including difficulty setting, render mode, the free camera, steering and the guide', () => {
    expect(settingsList(false, 'system', 'scarab', 'smoked', 100, true, false, false, 'default', true, 'normal')).toHaveLength(17);
  });

  it('names the four volume sliders, one per bus (#438)', () => {
    expect(BUSES.map((bus) => VOLUME_NAMES[bus])).toEqual(['Music', 'Ambience', 'Effects', 'Voice']);
  });

  it('names the three light sliders, one per level', () => {
    expect(LEVELS.map((level) => LEVEL_NAMES[level])).toEqual(['Bloom', 'Lamps', 'Lights']);
  });

  it('cycles the theme first; once back to System, steps the UI scale up to the cap; then 100 % with Safe mode flipped', () => {
    expect(nextDisplay('system', 100, true, 200)).toEqual({ theme: 'dark', scale: 100, safe: true });
    expect(nextDisplay('dark', 100, true, 200)).toEqual({ theme: 'light', scale: 100, safe: true });
    expect(nextDisplay('light', 100, true, 200)).toEqual({ theme: 'system', scale: 125, safe: true });
    expect(nextDisplay('system', 175, true, 200)).toEqual({ theme: 'dark', scale: 175, safe: true });
    expect(nextDisplay('light', 200, true, 200)).toEqual({ theme: 'system', scale: 100, safe: false });
    expect(nextDisplay('light', 100, false, 100)).toEqual({ theme: 'system', scale: 100, safe: true });
  });

  it('gives every menu item a name and an icon of the set', () => {
    for (const s of [...settingsList(false, 'dark', 'scarab', 'smoked', 125, false, false, false, 'default', true), ...settingsList(true, 'system', 'scarab', 'smoked', 200, true, true, true, 'contrast', true)]) {
      expect(s.label).not.toBe('');
      expect(Object.keys(ICONS)).toContain(s.icon);
    }
  });

  it('gives every setting a distinct id', () => {
    const ids = settingsList(false, 'system', 'scarab', 'smoked', 100, true, false, false, 'default', true).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('archiveList', () => {
  const entries = [
    { id: 'a', title: 'First', kind: 'lore' },
    { id: 'b', title: 'Second', kind: 'lore' },
    { id: 'c', title: 'Third', kind: 'audio' },
  ];

  it('lists the entries already seen, in the order of the entries, whatever their kind (#513)', () => {
    expect(archiveList(['c', 'a'], entries)).toEqual([entries[0], entries[2]]);
  });

  it('skips an id saved for no entry, and is empty before anything is seen', () => {
    expect(archiveList(['gone', 'b'], entries)).toEqual([entries[1]]);
    expect(archiveList([], entries)).toEqual([]);
  });
});

describe('theme', () => {
  it('cycles System, Dark, Light, then System again', () => {
    expect(nextTheme('system')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('system');
  });

  it('sets data-theme for Dark and Light, and leaves it off for System (the system setting decides)', () => {
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('system')).toBeNull();
  });
});

describe('motionReduced, the one switch of every animation (#379)', () => {
  it('follows the system setting until the player picks', () => {
    expect(motionReduced(true, null)).toBe(true);
    expect(motionReduced(false, null)).toBe(false);
  });

  it('keeps the choice of the player over the system setting', () => {
    expect(motionReduced(false, true)).toBe(true);
    expect(motionReduced(true, false)).toBe(false);
    expect(motionReduced(true, true)).toBe(true);
    expect(motionReduced(false, false)).toBe(false);
  });
});

describe('menuOpen', () => {
  it('opens on its button (the cog, the mode button) and closes on it again', () => {
    expect(menuOpen(false, 'button')).toBe(true);
    expect(menuOpen(true, 'button')).toBe(false);
  });

  it('closes on Escape, on a click outside and on a picked mode, and stays closed', () => {
    for (const event of ['escape', 'outside', 'pick'] as const) {
      expect(menuOpen(true, event)).toBe(false);
      expect(menuOpen(false, event)).toBe(false);
    }
  });
});
