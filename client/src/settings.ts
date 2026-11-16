// The settings menu (#277, docs/specs/ui.md section 4): a list of items behind a cog button: the toggles Clear board,
// Reduced motion (#379) and Flat HUD (#391), Sound (#284, which opens the four volume sliders of #438), the audio log
// Transcript (#516), Safe mode (#380),
// the Theme choice (#317), the Shell skin and Glass skin choices (#377), the UI scale (#382), then the actions Export game and Import
// game (#287), and the list of the Log archive (#513). Pure functions only: main.ts feeds them the clicks and builds the DOM. The
// menu shows them in five groups (settingsgroups.ts, #1566); a label says what the item is, so the three that were a value are
// Shell: Leather, Glass: Marble and Difficulty: 100%.
import type { IconName } from './icons';
import type { Bus } from './sound';
import type { Level } from './lightpanel';
import { DIFFICULTY_LABELS, type Difficulty } from './difficulty';
import { glassSkinById } from './glassskins';
import { PALETTE_NAMES, type Palette } from './palettes';
import { TIER_NAMES, type Tier } from './quality';
import { RENDER_MODE_NAMES, type RenderMode } from './rendermode';
import { skinById } from './skins';
import { nextUiScale, type UiScale } from './uiscale';

export interface Setting {
  id: string;
  label: string;
  icon: IconName;
  on?: boolean; // a toggle's state, absent on an action
}

/** The theme choice: System follows the system setting, Dark and Light force it (#317). */
export type Theme = 'system' | 'dark' | 'light';
const THEME_NAMES: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' };

/** The choice after a press on the Theme item: System, Dark, Light, then System again. */
export const nextTheme = (theme: Theme): Theme => (theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system');

/** The `data-theme` value of a choice, null to leave the attribute off so the system setting decides. */
export const themeAttribute = (theme: Theme): string | null => (theme === 'system' ? null : theme);

/** The choice after a press on the Theme row: the theme cycles first; once it is back to System, the UI scale steps
 *  up to the cap; once the scale is back to 100 %, Safe mode flips. The theme stays the main action of the row. */
export const nextDisplay = (
  theme: Theme,
  scale: UiScale,
  safe: boolean,
  max: UiScale,
): { theme: Theme; scale: UiScale; safe: boolean } => {
  const next = nextTheme(theme);
  if (next !== 'system') return { theme: next, scale, safe };
  return scale < max ? { theme: next, scale: nextUiScale(scale, max), safe } : { theme: next, scale: 100, safe: !safe };
};

/** Whether motion is cut (#379): the player's choice once pressed, else the system's prefers-reduced-motion. */
export const motionReduced = (system: boolean, saved: boolean | null): boolean => saved ?? system;

/** The items the menu lists, in order, with their icon and the toggles' current state. The Theme row shows the UI scale
 *  and holds Safe mode as its pressed state, so the menu keeps eight rows with Reduced motion and Flat HUD. Sound is
 *  no toggle: it opens the sliders; Transcript (#516) shares its row. */
export const settingsList = (
  clear: boolean,
  theme: Theme,
  skin: string,
  glass: string,
  scale: UiScale,
  safe: boolean,
  reduced: boolean,
  flat: boolean,
  palette: Palette,
  transcript: boolean,
  difficulty: Difficulty = 'easy',
  renderMode: RenderMode = 'normal',
  freeCam = false,
  steering = true,
  tier: Tier = 'high',
): Setting[] => [
  { id: 'clear-board', label: 'Clear board', icon: 'fog', on: clear },
  { id: 'quality', label: `Quality: ${TIER_NAMES[tier]}`, icon: 'render' }, // Low, Normal, High (#1715)
  { id: 'reduced-motion', label: 'Reduced motion', icon: 'motion', on: reduced },
  { id: 'flat-hud', label: 'Flat HUD', icon: 'flat', on: flat },
  { id: 'sound', label: 'Sound', icon: 'sound' },
  { id: 'transcript', label: 'Transcript', icon: 'transcript', on: transcript },
  { id: 'theme', label: `Theme: ${THEME_NAMES[theme]}`, icon: 'theme', on: safe },
  { id: 'palette', label: `Palette: ${PALETTE_NAMES[palette]}`, icon: 'palette' },
  { id: 'shell-skin', label: `Shell: ${skinById(skin).name}`, icon: 'skin' },
  { id: 'glass-skin', label: `Glass: ${glassSkinById(glass).name}`, icon: 'skin' },
  { id: 'render-mode', label: `Render: ${RENDER_MODE_NAMES[renderMode]}`, icon: 'render' },
  { id: 'free-cam', label: 'Free camera', icon: 'camera', on: freeCam }, // a developer view (#938), shortcut C
  { id: 'steering', label: 'Steering', icon: 'steer', on: steering }, // Open world: go round obstacles, tap to walk (#1137)
  { id: 'guide', label: 'Guide', icon: 'guide' }, // the first-launch guide again (#1293)
  { id: 'export-game', label: 'Export game', icon: 'export' },
  { id: 'difficulty', label: `Difficulty: ${DIFFICULTY_LABELS[difficulty]}`, icon: 'scale' },
  { id: 'import-game', label: 'Import game', icon: 'import' },
];

/** The name of each volume slider, the page Sound opens (#438). */
export const VOLUME_NAMES: Record<Bus, string> = { music: 'Music', ambience: 'Ambience', effects: 'Effects', voice: 'Voice' };
/** The names of the light sliders, the page Lights opens. */
export const LEVEL_NAMES: Record<Level, string> = { bloom: 'Bloom', lamps: 'Lamps', lights: 'Lights' };

/** An entry of the log archive (#513): a lore entry, and an audio log once they are collected (#517). */
export interface ArchiveEntry {
  id: string;
  title: string;
}

/** The page Log archive opens: the entries whose id was saved in `seen`, in the order of `entries`. */
export const archiveList = <T extends ArchiveEntry>(seen: readonly string[], entries: readonly T[]): T[] =>
  entries.filter((entry) => seen.includes(entry.id));

export type MenuEvent = 'button' | 'escape' | 'outside' | 'pick';

/** Whether a menu is open after `event`: its button (the cog, the mode button of #357) toggles it, Escape, a click
 * outside and a picked game mode close it. */
export const menuOpen = (open: boolean, event: MenuEvent): boolean => (event === 'button' ? !open : false);
