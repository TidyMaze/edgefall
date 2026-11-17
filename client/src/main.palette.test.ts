// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot } from './test/harness';

// The palette setting (#381): its button steps through the five palettes in order and back to Default, each named on the button, stored and
// worn by the page. The cycle's logic, fast here; the e2e palette.spec keeps one click and the reload in a real browser (#1710).
const byId = (id: string) => document.getElementById(id)!;

describe('the palette setting (#381)', () => {
  it('steps Default, Protan, Deutan, Tritan, High contrast and back to Default, storing and wearing each', async () => {
    const game = await boot('?bot=off');
    game.openSettings();
    const button = byId('setting-palette');
    expect(button.textContent).toContain('Palette: Default');
    for (const [name, id] of [['Protan', 'protan'], ['Deutan', 'deutan'], ['Tritan', 'tritan'], ['High contrast', 'contrast'], ['Default', 'default']] as const) {
      button.click();
      expect(button.textContent).toContain(`Palette: ${name}`);
      expect(localStorage.getItem('ab-alone.palette')).toBe(id);
      expect(document.documentElement.dataset.palette ?? 'default').toBe(id);
      expect(game.hook('__palette')).toBe(id);
    }
  });
});
