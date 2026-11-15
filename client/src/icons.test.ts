import { describe, expect, it } from 'vitest';
import { ICONS, icon, type IconName } from './icons';

describe('icon', () => {
  it('draws every icon as a 20 px inline SVG of thin currentColor strokes, hidden from screen readers', () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const svg = icon(name);
      expect(svg).toMatch(/^<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"/);
      expect(svg).toContain('fill="none" stroke="currentColor" stroke-width="1.5"');
      expect(svg).toContain(`<path d="${ICONS[name]}"/>`);
    }
  });

  it('has the icons of the HUD buttons (New game, Play online, Copy diagnostics) and of the theme and shell settings', () => {
    expect(Object.keys(ICONS)).toEqual(expect.arrayContaining(['newgame', 'online', 'diagnostics', 'theme', 'skin']));
  });

  it('gives every icon its own drawing', () => {
    const drawings = Object.values(ICONS);
    expect(new Set(drawings).size).toBe(drawings.length);
  });
});
