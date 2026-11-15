// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EASE, MOTION, reducedMotion, cue, ghostFade } from './motion';
import { SLIDE_MS } from './slide';
import css from './ui.css?raw';

const NAMES = ['instant', 'fast', 'base', 'slow', 'celebrate'] as const;
const declared = (block: string, name: string): string | undefined => block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
const tokens = css.match(/\/\* motion tokens[^]*?:root\s*\{([^}]*)\}/)![1]!;
const reduced = css.match(/:root\[data-motion='reduced'\]\s*\{([^}]*)\}/)![1]!;

describe('motion tokens (#1106)', () => {
  it('defines the five durations in ui.css with the same values as MOTION', () => {
    for (const n of NAMES) expect(declared(tokens, `motion-${n}`)).toBe(`${MOTION[n]}ms`);
  });

  it('defines the three easings in ui.css with the same values as EASE', () => {
    for (const [n, value] of Object.entries(EASE)) expect(declared(tokens, `ease-${n}`)).toBe(value);
  });

  it('matches the numbers of docs/specs/motion.md', () => {
    expect(MOTION).toEqual({ instant: 80, fast: 120, base: 200, slow: 320, celebrate: 1200 });
  });

  it('computes every duration to 0ms under the Reduced motion switch', () => {
    for (const n of NAMES) expect(declared(reduced, `motion-${n}`)).toBe('0ms');
  });

  it('makes the marble slide the base token', () => {
    expect(SLIDE_MS).toBe(MOTION.base);
  });
});

describe('menus and buttons answer touch (#1094)', () => {
  const block = css.match(/\/\* Touch motion \(#1094,[^]*$/)![0];

  it('presses a dock or sheet button down on the instant token with the out easing', () => {
    expect(block).toMatch(/#dock-wrap button \{[^}]*transition: transform var\(--motion-instant\) var\(--ease-out\)/);
    expect(block).toMatch(/#dock-wrap button:active:not\(:disabled\) \{[^}]*transform: scale\(0\.96\)/);
  });

  it('opens every sheet on the base token with the out easing', () => {
    for (const id of ['goal-sheet', 'daily-card', 'lobby-sheet']) expect(block).toContain(`#dock-wrap #${id}`);
    expect(block).toMatch(/animation: sheet-in var\(--motion-base\) var\(--ease-out\)/);
    expect(block).toMatch(/@keyframes sheet-in \{ from \{ opacity: 0; transform: translateY\(8px\); \} \}/);
  });

  it('is cut by the reduced switch', () => {
    expect(css).toMatch(/:root\[data-motion='reduced'\] \*[^{]*\{ animation-duration: 0s !important; transition-duration: 0s !important; \}/);
  });
});

describe('reducedMotion', () => {
  it('follows data-motion on the root', () => {
    expect(reducedMotion({ dataset: {} })).toBe(false);
    expect(reducedMotion({ dataset: { motion: 'reduced' } })).toBe(true);
  });
});

describe('cue (#1097)', () => {
  afterEach(() => vi.useRealTimers());

  it('adds the class, restarts it when called again, and removes it after the duration', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    cue(el, 'refused', MOTION.fast);
    expect(el.classList.contains('refused')).toBe(true);
    vi.advanceTimersByTime(MOTION.fast - 20);
    cue(el, 'refused', MOTION.fast); // a second refusal restarts the cue
    vi.advanceTimersByTime(MOTION.fast - 20);
    expect(el.classList.contains('refused')).toBe(true);
    vi.advanceTimersByTime(20);
    expect(el.classList.contains('refused')).toBe(false);
  });
});

describe('refusal, hint and copy motion (#1097, #1098)', () => {
  const block = css.match(/\/\* Refusal, hint and copy motion \(#1097[^]*$/)![0];

  it('shakes the turn line of a refused move once on the fast token', () => {
    expect(block).toMatch(/body\.refused #hud \.turn \{[^}]*animation: refuse var\(--motion-fast\) var\(--ease-out\)/);
    expect(block).toMatch(/@keyframes refuse \{[^}]*translateX/);
  });

  it('draws the Hint button in on the base token when its move is shown', () => {
    expect(block).toMatch(/body\[data-hint='shown'\] #hint \{[^}]*animation: hint-in var\(--motion-base\) var\(--ease-out\)/);
    expect(block).toMatch(/@keyframes hint-in/);
  });

  it('draws a check mark on Copied on the fast token', () => {
    expect(block).toMatch(/#daily-copy\.copied::before \{[^}]*content: '\\2713'[^}]*animation: check-in var\(--motion-fast\) var\(--ease-out\)/);
    expect(block).toMatch(/@keyframes check-in \{[^}]*clip-path/);
  });
});

describe('screen transitions (#1099)', () => {
  const block = css.match(/\/\* Screen transitions \(#1099[^]*$/)![0];

  it('fades the canvas in on the base token when the Open world is entered', () => {
    expect(block).toMatch(/body\[data-openworld\] canvas \{[^}]*animation: screen-in-world var\(--motion-base\) var\(--ease-out\)/);
    expect(block).toMatch(/@keyframes screen-in-world \{ from \{ opacity: 0; \} \}/);
  });

  it('fades the canvas in the same way when the Open world is left', () => {
    expect(block).toMatch(/body:not\(\[data-openworld\], \[data-over\]\) canvas \{[^}]*animation: screen-in var\(--motion-base\) var\(--ease-out\)/);
  });

  it('uses two keyframe names, since a rule swap with the same name would not restart the fade', () => {
    expect(block).toMatch(/@keyframes screen-in \{/);
    expect(block).not.toMatch(/canvas \{ animation: screen-in-world[^}]*\}\s*body:not[^}]*screen-in-world/);
  });

  it('moves opacity only, so the game stays live under the fade', () => {
    expect(block).not.toMatch(/pointer-events|visibility|display/);
  });
});

describe('Open world UI motion (#1105)', () => {
  const block = css.match(/\/\* Open world UI motion \(#1105[^]*?(?=\n\/\*|$)/)![0];

  it('slides the HUD in on the base token, like the dock sheets', () => {
    expect(block).toMatch(/body\[data-openworld\] #openworld-hud \{[^}]*animation: sheet-in var\(--motion-base\) var\(--ease-out\)/);
  });

  it('folds the HUD away on the fast token, with transform and opacity only', () => {
    const folded = css.match(/#openworld-hud\[data-folded\] \{([^}]*)\}/)![1]!;
    expect(folded).toContain('transition: opacity var(--motion-fast) var(--ease-out), transform var(--motion-fast) var(--ease-out), visibility 0s var(--motion-fast)');
    expect(css.match(/#openworld-hud \{[^}]*transition: ([^;]*);/)![1]).not.toMatch(/\b(width|height|top|left|margin)\b/);
  });
});

describe('the Hint ghost fades in (#1097, motion.md story 7)', () => {
  it('rises from clear to whole over the base token, easing out', () => {
    expect(ghostFade(0, false)).toBe(0);
    const mid = ghostFade(MOTION.base / 2, false);
    expect(mid).toBeGreaterThan(0.5); // ease out: past the linear half
    expect(mid).toBeLessThan(1);
    expect(ghostFade(MOTION.base, false)).toBe(1);
    expect(ghostFade(MOTION.base * 5, false)).toBe(1);
    expect(ghostFade(-10, false)).toBe(0);
  });
  it('reduced motion: whole at once', () => {
    expect(ghostFade(0, true)).toBe(1);
  });
});

describe('the transition of a place (#1519)', () => {
  const block = css.match(/\/\* Place transition \(#1519[^]*?(?=\n\/\* [A-Z]|$)/)![0];

  it('is layers over the page that never take a press, the dim and the cue under the HUD and the title over it', () => {
    expect(block).toMatch(/#place-transition > \* \{ position: fixed; pointer-events: none; \}/);
    expect(block).toMatch(/:is\(\.pt-dim, \.pt-door, \.pt-arch\) \{ z-index: 0; \}/);
    expect(block).toMatch(/\.pt-title \{\s*z-index: 4;/);
    expect(block).toMatch(/#place-transition\[hidden\] \{ display: none; \}/);
  });

  it('moves opacity and transform only, from the numbers the script writes, and has no transition or animation of its own', () => {
    const rules = block.replace(/\/\*[^]*?\*\//g, '');
    expect(rules).not.toMatch(/[;{\s](transition|animation)\s*:|@keyframes/);
    expect(rules).not.toMatch(/\b(width|height|top|left|right|bottom|margin):\s*[^;]*var\(--(dim|open|title)/);
    expect(block).toMatch(/\.pt-dim \{[^}]*opacity: var\(--dim\)/);
    expect(block).toMatch(/\.pt-title \{[^}]*opacity: var\(--title\)/);
  });

  it('gives the tower two doors that part and the gate an arch that opens, and the town only the dim', () => {
    expect(block).toMatch(/\[data-kind='tower'\] \.pt-door/);
    expect(block).toMatch(/translateX\(calc\(var\(--open\) \* -100%\)\)/);
    expect(block).toMatch(/\[data-kind='dungeon'\] \.pt-arch/);
    expect(block).toMatch(/scale\(calc\(/);
    expect(block).toMatch(/\[data-kind='tower'\] \.pt-dim \{ display: none; \}/);
    expect(block).toMatch(/:is\(\.pt-door, \.pt-arch\) \{ display: none; \}/); // shown for their kind only
  });

  it('cuts the dim and the cue under reduced motion and keeps the title', () => {
    expect(block).toMatch(/\[data-motion='cut'\] :is\(\.pt-dim, \.pt-door, \.pt-arch\) \{ display: none; \}/);
    expect(block).not.toMatch(/\[data-motion='cut'\][^{]*\.pt-title/);
  });
});

describe('exit of a screen (#1562)', () => {
  const block = css.match(/\/\* Exit of a screen \(#1562[^]*?\n\n/)![0];

  it('lifts a dim over the new screen, opaque at the start, with two keyframe names so each change replays', () => {
    expect(block).toMatch(/#screen-exit\[data-flip='a'\] \{[^}]*animation: screen-out-a var\(--motion-fast\) var\(--ease-in\)/);
    expect(block).toMatch(/#screen-exit\[data-flip='b'\] \{[^}]*animation: screen-out-b var\(--motion-fast\)/);
    expect(block).toMatch(/@keyframes screen-out-a \{ from \{ opacity: 1; \} \}/);
    expect(block).toMatch(/@keyframes screen-out-b \{ from \{ opacity: 1; \} \}/);
  });

  it('takes no press, rests clear, and gives way to the transition of a place', () => {
    expect(block).toMatch(/#screen-exit \{[^}]*pointer-events: none[^}]*opacity: 0/);
    expect(block).toMatch(/body\[data-place-transition\] #screen-exit \{ display: none; \}/);
  });
});
