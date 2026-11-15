import { describe, expect, it } from 'vitest';
import css from './ui.css?raw';

// #1136, PR 2: the Game modes sheet, the boss list and the settings menu keep the dark theme's look, refined: its plates and ink,
// the amber accent, 6 px radii, 48 px rows on a touch screen, a pressed item filled, no backdrop blur.
describe('the Game modes sheet, the boss list and the settings menu, #1136', () => {
  it('defines the shared tokens, the light theme keeping its own accent and fill', () => {
    const root = css.match(/:root\s*\{[^}]*--amber:[^}]*\}/)?.[0] ?? '';
    for (const token of ['amber: #ffb000', 'plate-accent: #ffb000', 'active-fill: #ffb000', 'r-card: 6px', 'r-button: 6px', 'space: 8px', 'target: 48px']) {
      expect(root).toContain(`--${token};`);
    }
    expect(css).toMatch(/:root\[data-theme='light'\] \{ --plate-accent: #0a5f73; --active-fill: #1b1f23;/);
  });

  it('gives the sheet and the settings menu the amber accent in the default palette, and a 6 px radius', () => {
    expect(css).toMatch(/:root\[data-palette='default'\] :is\(#dock-wrap :is\(#mode-menu, #goal-sheet\), #settings-menu\) \{ --accent: var\(--plate-accent\); \}/);
    expect(css).toMatch(/#dock-wrap :is\(#mode-menu, #goal-sheet\) \{[^}]*border-radius: var\(--r-card\);/);
  });

  it('draws the rows as 6 px cards, 48 px high on a coarse pointer, and the boss list on an 8 px grid', () => {
    expect(css).toMatch(/:is\(#mode-menu, #settings-menu\) button \{[^}]*border-radius: var\(--r-button\);/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{[^}]*#dock-wrap #mode-menu > button[^}]*min-height: var\(--target\);/);
    expect(css).toMatch(/#dock-wrap #mode-menu :is\(#boss-list, #coop-list\) \{[^}]*gap: var\(--space\);/);
  });

  it('keeps the compact 4 px gaps of the desktop sheet, so every boss shows without a scroll (#1069)', () => {
    expect(css).toMatch(/@media \(orientation: landscape\) and \(min-width: 1101px\) and \(pointer: fine\) \{\s*#dock-wrap :is\(#mode-menu, #goal-sheet\), #dock-wrap #mode-menu :is\(#boss-list, #coop-list\) \{ gap: 4px; \}/);
  });

  it('fills a pressed item with the active fill instead of tinting its text', () => {
    expect(css).toMatch(/#settings-menu button\[aria-pressed='true'\], #dock-wrap #mode-menu button\[aria-expanded='true'\] \{[^}]*background: var\(--active-fill\);[^}]*color: var\(--active-ink\);/);
  });

  it('uses no backdrop blur', () => {
    expect(css).not.toContain('backdrop-filter');
  });
});

// #1693: the update row is the first row of Settings, its dot on the cog; the bay sheet is a sheet above the dock like the others, a bay's boss list inside the Shift crew's.
describe('the homes moved in #1693', () => {
  it('draws the update dot on the cog and no longer on Modes', () => {
    expect(css).toMatch(/body:has\(#update:not\(\[hidden\]\)\) #settings \{[^}]*background-image: radial-gradient/);
    expect(css).not.toMatch(/#update:not\(\[hidden\]\)\) #modes/);
  });

  it('tightens the dock when Replay shows so six buttons fit 320 px', () => {
    expect(css).toMatch(/@media \(max-width: 420px\) \{ #dock:has\(#undo:not\(\[hidden\]\), #replay:not\(\[hidden\]\)\) \{ gap: 1px; padding: 4px; \} \}/);
  });

  it('puts the bay sheet above the dock with the other sheets, its rows and boss list at 44 px', () => {
    expect(css).toMatch(/#dock-wrap #lobby-sheet, #dock-wrap #bay-sheet \{/);
    expect(css).toMatch(/#dock-wrap #bay-sheet\[hidden\]/);
    expect(css).toMatch(/#dock-wrap #bay-sheet > button, #dock-wrap #bay-sheet #coop-list button \{[^}]*min-height: 44px;/);
  });
});
