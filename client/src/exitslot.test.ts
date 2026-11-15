import { describe, expect, it } from 'vitest';
import css from './ui.css?raw';
import { EXIT_LABEL, EXIT_NAME, exitOf, type Where } from './exitslot';

// The exit of the dock (#1517, docs/specs/ui.md section "One door grammar"): one control in the first slot, named by where it leads,
// the Open world when the player came from it, else the Hub; the Hub itself has none.

const nowhere: Where = { world: false, wild: false, lair: false, place: false, home: false };
const at = (where: Partial<Where>) => exitOf({ ...nowhere, ...where });

describe('exitOf: where the exit of the dock leads', () => {
  it('has none in the Hub, the home of the game', () => {
    expect(at({ home: true })).toBeNull();
  });
  it('leads the Open world to the Hub', () => {
    expect(at({ world: true })).toBe('hub');
  });
  it('leads every other screen to the Hub: the plain table, a fight, a run, the Trainer, a battle royale, an online room, a table of a Hub door', () => {
    expect(at({})).toBe('hub');
  });
  it('leads back to the Open world from a lair, a wild fight, and the Hub or the run of a town or a gate', () => {
    expect(at({ lair: true })).toBe('world');
    expect(at({ wild: true })).toBe('world');
    expect(at({ place: true })).toBe('world');
    expect(at({ place: true, home: true })).toBe('world');
  });
  it('names where it leads: a short label for the dock, a name for the screen readers', () => {
    expect(EXIT_LABEL).toEqual({ world: 'World', hub: 'Hub' });
    expect(EXIT_NAME).toEqual({ world: 'Back to the Open world', hub: 'Back to the hub' });
  });
});

describe('the dock with the exit', () => {
  it('shrinks its gaps held upright so that seven buttons (the exit and Auto-play at a bot\'s table) fit 360 px', () => {
    expect(css).toContain('@media (orientation: portrait) { #dock:has(> #exit:not([hidden])):has(> :nth-child(6 of button:not([hidden]))) { gap: clamp(0px, calc((100vw - 350px) / 6), 8px); padding: 4px; } }');
  });
});
