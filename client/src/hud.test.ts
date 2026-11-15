import { describe, expect, it } from 'vitest';
import { flatHudHtml, hudHtml, passNote } from './hud';
import css from './ui.css?raw';

const TOKENS = ['bg', 'panel', 'edge', 'text', 'muted', 'accent', 'hazard', 'danger'];

// The dark theme is :root, the light one is the media query and the data-theme override.
const blocks = {
  dark: css.match(/:root\s*\{([^}]*)\}/)![1]!,
  lightMedia: css.match(/prefers-color-scheme:\s*light\)\s*\{\s*:root:not\(\[data-theme='dark'\]\)\s*\{([^}]*)\}/)![1]!,
  lightForced: css.match(/:root\[data-theme='light'\]\s*\{([^}]*)\}/)![1]!,
};

describe('refined play screen, #1136', () => {
  const root = css.match(/:root\s*\{[^}]*--amber:[^}]*\}/)?.[0] ?? '';
  const tokens: Record<string, string> = {
    amber: '#ffb000', 'plate-accent': '#ffb000', 'active-fill': '#ffb000', 'active-ink': '#1b1d1f',
    'r-card': '6px', 'r-button': '6px', space: '8px', target: '48px',
  };
  for (const [name, value] of Object.entries(tokens)) {
    it(`defines --${name} as ${value} in the dark theme`, () => {
      expect(root).toContain(`--${name}: ${value};`);
    });
  }

  it('keeps the light theme its own accent and a dark fill', () => {
    expect(css).toMatch(/:root\[data-theme='light'\] \{ --plate-accent: #0a5f73; --active-fill: #1b1f23; --active-ink: #f3f0e6; \}/);
  });

  it('keeps the rivets and gives the plates the 6 px radius and the amber accent', () => {
    expect(css).toContain('--rivet: radial-gradient');
    expect(css).toMatch(/:is\(#hud, #boss-bar, #eval, #dock\) \{ border-radius: var\(--r-card\); \}/);
    expect(css).toMatch(/:root\[data-palette='default'\] :is\(#hud, #boss-bar, #eval, #dock\) \{ --accent: var\(--plate-accent\); \}/);
  });

  it('draws the dock with 48 px buttons, the icon above the label, the active one filled, no blur', () => {
    expect(css).toMatch(/#dock > button, #dock-replay button \{[^}]*height: var\(--target\);[^}]*border-radius: var\(--r-button\);/);
    expect(css).toMatch(/#dock > button \{[^}]*flex-direction: column;/);
    expect(css).toMatch(/#dock > button::before \{[^}]*mask: var\(--icon\)/);
    expect(css).toMatch(/#dock > button\[aria-pressed='true'\], #dock > button\[aria-expanded='true'\] \{[^}]*background: var\(--active-fill\);[^}]*color: var\(--active-ink\);/);
    for (const id of ['new-game', 'hint', 'undo', 'auto-play', 'boss-retry', 'rematch', 'boss-goal', 'royale-hold', 'lobby']) {
      expect(css, id).toMatch(new RegExp(`#dock #${id} \\{ --icon: url\\(`));
    }
    expect(css).not.toContain('backdrop-filter');
  });
});

describe('palette tokens', () => {
  for (const [name, block] of Object.entries(blocks)) {
    it(`defines every token in the ${name} block`, () => {
      for (const token of TOKENS) expect(block).toMatch(new RegExp(`--${token}:\\s*#[0-9a-f]{6};`));
    });
  }

  it('turns animation off under the Reduced motion setting, not the media query (#379)', () => {
    expect(css).toMatch(/:root\[data-motion='reduced'\] \*, :root\[data-motion='reduced'\] \*::before, :root\[data-motion='reduced'\] \*::after \{ animation-duration: 0s !important; transition-duration: 0s !important; \}/);
    expect(css).not.toContain('prefers-reduced-motion');
  });
});

describe('settings menu in five groups, #1566 (replaces the icon-only items of #414 and the rows of 3 of #483)', () => {
  it('shows the label of every item at every window size: no rule hides the label or squares the item', () => {
    expect(css).not.toContain('#settings-menu button span { display: none; }');
    expect(css).not.toMatch(/orientation: portrait\), \(max-width: 1100px\), \(max-height: 500px\) \{/);
    expect(css).not.toContain('grid-template-columns: repeat(3, 2.75rem)');
    expect(css).not.toContain('.skin-pair');
  });

  it('keeps every item and every heading a 44 px target, whatever the window', () => {
    expect(css).toMatch(/#settings-menu button \{[^}]*min-height: 2\.75rem;[^}]*\}/);
    expect(css).toMatch(/#settings-menu summary\.setting-heading \{[^}]*min-height: 2\.75rem;[^}]*\}/);
  });

  it('scrolls a menu taller than the window inside itself, with the headings in a column of rows', () => {
    expect(css).toMatch(/#settings-menu \{[^}]*max-height: [^;]+;[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.setting-section, \.setting-section::details-content \{[^}]*flex-direction: column;/);
  });
});

describe('end of game styles, #282', () => {
  it('has one animation per outcome on the rim light, keeps the middle clear, and drops the light under reduced motion', () => {
    for (const anim of ['win', 'loss', 'draw']) {
      expect(css).toMatch(new RegExp(`body\\[data-over='${anim}'\\]::before \\{[^}]*animation: end-${anim} [^}]*forwards`));
      expect(css).toContain(`@keyframes end-${anim}`);
    }
    expect(css).toMatch(/body\[data-over\]::before \{[^}]*pointer-events: none[^}]*mask-image: radial-gradient\(ellipse at center, transparent 62%/);
    expect(css).toContain(":root[data-motion='reduced'] body[data-over]::before { display: none; }");
    expect(css).toMatch(/body\[data-over\] canvas \{ filter: brightness/);
  });
});

describe('hudHtml', () => {
  const base = { side: 1, status: 0, score: 'Black ejected 0/6 · White ejected 0/6', ejected: [0, 0] as const, win: [6, 6] as const, note: 'WebGL2', glass: 2 };

  it('says whose turn it is', () => {
    expect(hudHtml(base)).toContain('Black to move');
    expect(hudHtml({ ...base, side: 2 })).toContain('White to move');
  });

  it('names the sides after the glass: against the bot the pale side 1 is White to move, and wins', () => {
    expect(hudHtml({ ...base, glass: 1 })).toContain('White to move');
    expect(hudHtml({ ...base, glass: 1, side: 2 })).toContain('Black to move');
    expect(hudHtml({ ...base, glass: 1, status: 2 })).toContain('Black wins');
  });

  it("says Your turn or Partner's turn in place of Black to move on a co-op human ply, and the winner once over (#530)", () => {
    expect(hudHtml({ ...base, turn: "Partner's turn" })).toContain("<span>Partner's turn</span>");
    expect(hudHtml({ ...base, turn: "Partner's turn" })).not.toContain('to move');
    expect(hudHtml({ ...base, turn: 'Your turn', status: 2 })).toContain('White wins');
  });

  it('puts the rating in the middle of the pips row, and nothing there without one (#1611)', () => {
    expect(hudHtml({ ...base, rating: '<span class="bot-rating">Boss ~1000 · Easy</span>' })).toMatch(/<div class="pipline"><div class="pips".*<\/div><span class="bot-rating">Boss ~1000 · Easy<\/span><\/div>/);
    expect(hudHtml(base)).toContain('</div></div><small>');
  });

  it('keeps the score text verbatim and the note', () => {
    const html = hudHtml(base);
    expect(html).toContain('Black ejected 0/6 · White ejected 0/6');
    expect(html).toContain('WebGL2');
  });

  it('shows the winner line instead of the turn when the game is over', () => {
    const html = hudHtml({ ...base, status: 2, score: 'White wins by 6 ejections · x' });
    expect(html).toContain('White wins');
    expect(html).not.toContain('to move');
  });

  it('shows the online status line with its tone, and none offline', () => {
    const html = hudHtml({ ...base, online: { text: 'You are Black. Waiting for an opponent...', tone: 'waiting' } });
    expect(html).toContain('<div class="presence waiting">You are Black. Waiting for an opponent...</div>');
    expect(hudHtml(base)).not.toContain('presence');
  });

  it('shows the rematch line once someone asked, and none otherwise, #186', () => {
    const online = { text: 'You are Black. White is here.', tone: 'here' as const };
    const html = hudHtml({ ...base, status: 3, online, rematch: 'White asks for a rematch.' });
    expect(html).toContain('<div class="rematch">White asks for a rematch.</div>');
    expect(hudHtml({ ...base, status: 3, online, rematch: '' })).not.toContain('rematch');
    expect(hudHtml({ ...base, status: 3, online })).not.toContain('rematch');
  });

  it('shows the end banner in place of the turn line: title, reason, animation id, #282', () => {
    const end = { title: 'You win', line: '6 out. The books balance.', anim: 'win' as const };
    const html = hudHtml({ ...base, status: 1, end });
    expect(html).toContain('<span>You win</span>');
    expect(html).toContain('<div class="end" data-anim="win">6 out. The books balance.</div>');
    expect(html).not.toContain('Black wins');
    expect(hudHtml(base)).not.toContain('class="end"');
  });

  it('names a draw', () => {
    expect(hudHtml({ ...base, status: 3 })).toContain('Draw');
  });

  it('draws six pips per side, scratched once a marble is ejected', () => {
    const html = hudHtml({ ...base, ejected: [2, 6] });
    expect(html.match(/class="pip"/g)).toHaveLength(12 - 8);
    expect(html.match(/class="pip out"/g)).toHaveLength(8);
  });

  it('carries the ejected count of each side as a number at the outer end of its pips (#1568)', () => {
    const html = hudHtml({ ...base, ejected: [2, 0] });
    expect(html).toContain('<span class="pip out"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><b class="count">2/6</b></span>');
    expect(html).toContain('<span class="pale"><b class="count">0/6</b><span class="pip">');
    expect(hudHtml({ ...base, win: [0, 2], ejected: [3, 0] })).toContain('<b class="count">3</b>'); // a side that does not win by ejections: the count alone
  });

  it("colours each side's pips as its marble: dark for Black, pale for White, #1038", () => {
    const rows = (glass: number) => [...hudHtml({ ...base, glass }).matchAll(/<span class="(dark|pale)">/g)].map((m) => m[1]);
    expect(rows(2)).toEqual(['dark', 'pale']); // Black is side 1, the enemy shell
    expect(rows(1)).toEqual(['pale', 'dark']); // against the bot, side 1 wears the glass and is White
  });

  it('draws one scratched pip per ejection of a side that does not win by ejections (The Swarm, #1008)', () => {
    const html = hudHtml({ ...base, win: [0, 2], ejected: [3, 0] });
    expect(html.match(/class="pip out"/g)).toHaveLength(3);
    expect(html.match(/class="pip"/g)).toHaveLength(2);
    expect(flatHudHtml({ ...base, win: [0, 2], ejected: [3, 1] })).toContain('Black 3, White 1/2');
  });

  it('draws one pip per ejection a side needs: 10 for Black against the Choir, Decision #131', () => {
    const html = hudHtml({ ...base, win: [10, 6], ejected: [3, 1] });
    const [black, white] = html.match(/<span class="(?:dark|pale)">.*?<\/b>(?:<span class="pip[^"]*"><\/span>)*<\/span>/g)!; // the rows carry their marble colour (#1038)
    expect(black!.match(/class="pip/g)).toHaveLength(10);
    expect(white!.match(/class="pip/g)).toHaveLength(6);
    expect(html.match(/class="pip out"/g)).toHaveLength(4);
  });
});

describe('the Tally line, #294', () => {
  const base = {
    side: 1,
    status: 0,
    glass: 0,
    score: '0 out',
    ejected: [0, 0] as const,
    win: [6, 6] as const,
    note: '',
  };

  it('shows the line in the plate, after the turn line', () => {
    const html = hudHtml({ ...base, tally: 'Mess: two crews, one table. Ledger open.' });
    expect(html).toContain('<div class="tally">Mess: two crews, one table. Ledger open.</div>');
    expect(html.indexOf('class="tally"')).toBeGreaterThan(html.indexOf('class="turn"'));
  });

  it('explains the tally line once, under it, in the first run (#1521): a note with no line shows nothing', () => {
    const html = hudHtml({ ...base, tally: 'Mess: one seat filled. The other is counted.', tallyNote: 'One seat is yours.' });
    expect(html).toContain('<div class="tally-note">One seat is yours.</div>');
    expect(html.indexOf('class="tally-note"')).toBeGreaterThan(html.indexOf('class="tally"'));
    expect(hudHtml({ ...base, tally: 'Mess: one seat filled.' })).not.toContain('tally-note');
    expect(hudHtml({ ...base, tallyNote: 'One seat is yours.' })).not.toContain('tally-note');
    expect(css).toMatch(/body\[data-firstrun\] #hud \.tally \{[^}]*animation:\s*none/); // the line stays while the note explains it
  });

  it('puts the bot move on its own status line, not in the note (#1680)', () => {
    const html = hudHtml({ ...base, botMove: 'Bot moved 2 marbles left' });
    expect(html).toContain('<div class="botmove" role="status">Bot moved 2 marbles left</div>');
    expect(hudHtml(base)).not.toContain('botmove');
  });

  it('shows no tally element when there is no line', () => {
    expect(hudHtml(base)).not.toContain('class="tally"');
  });

  it('fades out the tally line after 5 seconds via CSS animation (#425)', () => {
    expect(css).toMatch(/#hud \.tally \{[^}]*animation:\s*tally-fade 1s ease-out 4s forwards;/);
    expect(css).toContain('@keyframes tally-fade');
  });

  // #1038: on a phone the pips alone show the ejected count. The score text stays for a screen reader, one name for the count.
  it('hides the score text on a phone held upright, out of sight but in the accessibility tree', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) \{\s*#hud \.score:not\(\.run\) \{[^}]*clip-path: inset\(50%\);[^}]*\}/);
  });

  it('hides the redundant pips on compact/mobile screens (#425)', () => {
    expect(css).toMatch(/@media [^{]*max-width:\s*1100px[^{]*\{[^]*?#hud \.pips \{ display: none; \}/);
  });
});

describe('flatHudHtml, the flat HUD fallback (#391)', () => {
  const game = { side: 1, status: 0, glass: 2, ejected: [1, 4] as const, win: [6, 6] as const };

  it('gives the turn owner and the ejected count as text', () => {
    expect(flatHudHtml(game)).toBe('<div class="flat"><div>Turn: Black</div><div>Ejected: Black 1/6, White 4/6</div></div>');
    expect(flatHudHtml({ ...game, side: 2, glass: 1 })).toContain('<div>Turn: Black</div><div>Ejected: White 1/6, Black 4/6</div>');
  });

  it('says the game is over instead of a turn owner', () => {
    expect(flatHudHtml({ ...game, status: 3 })).toContain('<div>Turn: game over</div>');
  });

  it('adds the boss phase and the tell countdown in a boss fight', () => {
    expect(flatHudHtml({ ...game, boss: { phase: 1, phases: 3, tell: '2 cells in 3 plies' } })).toContain(
      '<div>Boss phase: 2 of 3</div><div>Tell: 2 cells in 3 plies</div>',
    );
    expect(flatHudHtml({ ...game, boss: { phase: 0, phases: 2, tell: '' } })).toContain('<div>Boss phase: 1 of 2</div><div>Tell: none</div>');
  });
});

describe('the HUD tally moves when it changes (#1095)', () => {
  const base = { side: 1, status: 0, glass: 1, score: '', ejected: [0, 0] as [number, number], win: [6, 6] as [number, number], note: '' };

  it('marks only the pips newly out since the last render', () => {
    const html = hudHtml({ ...base, ejected: [3, 1], was: [2, 1] });
    expect(html.match(/class="pip out fresh"/g)).toHaveLength(1);
    expect(html.match(/class="pip out"/g)).toHaveLength(3);
  });

  it('marks nothing when the count is unchanged, went down, or no previous render is known', () => {
    expect(hudHtml({ ...base, ejected: [2, 1], was: [2, 1] })).not.toContain('fresh');
    expect(hudHtml({ ...base, ejected: [0, 0], was: [2, 1] })).not.toContain('fresh');
    expect(hudHtml({ ...base, ejected: [2, 1] })).not.toContain('fresh');
  });

  it('animates the fresh pip on the base token with the out easing, cut by the reduced switch', () => {
    expect(css).toMatch(/#hud \.pip\.fresh \{[^}]*animation: pip-out var\(--motion-base\) var\(--ease-out\)/);
    expect(css).toMatch(/@keyframes pip-out \{ from \{[^}]*scale\(/);
    expect(css).toMatch(/:root\[data-motion='reduced'\] \*[^{]*\{ animation-duration: 0s !important/);
  });
});

describe('the end beat (#1093)', () => {
  it('the turn title pulses once on the celebrate token and the result line arrives a beat later on the base token', () => {
    expect(css).toMatch(/body\[data-over\] #hud \.end \{[^}]*animation: end-line var\(--motion-base\) var\(--ease-out\) var\(--motion-fast\) backwards/);
    expect(css).toMatch(/@keyframes end-line \{ from \{[^}]*opacity: 0[^}]*translateY\(/);
    expect(css).toMatch(/body\[data-over\] #hud \.turn span:last-child \{[^}]*animation: end-title var\(--motion-celebrate\) var\(--ease-out\)/);
    expect(css).toMatch(/@keyframes end-title \{.*scale\(1\.0\d\)/);
  });
});

describe('passNote (#1301)', () => {
  it('names the side whose turn passed, in the colours of the glass, and nothing without a pass', () => {
    expect(passNote(2, 2)).toBe(' · White has no move: turn passed');
    expect(passNote(1, 2)).toBe(' · Black has no move: turn passed');
    expect(passNote(1, 1)).toBe(' · White has no move: turn passed');
    expect(passNote(0, 2)).toBe('');
  });
});

describe('the score of a run fight (#1540)', () => {
  const base = { side: 1, status: 0, score: 'Black ejected 0/6 · White ejected 0/6', ejected: [0, 0] as const, win: [6, 6] as const, note: '', glass: 2 };

  it('shows the run score in place of the ejection line, and the ejection line in every other fight', () => {
    expect(hudHtml(base)).toContain('<div class="score">Black ejected 0/6');
    const html = hudHtml({ ...base, runScore: '<div>Army 14 (run ends below 9)</div>' });
    expect(html).toContain('<div class="score run"><div>Army 14 (run ends below 9)</div></div>');
    expect(html).not.toContain('Black ejected');
  });

  it('keeps the run score on a phone held upright, where the ejection line leaves the screen, and paints the marbles lost in the danger colour', () => {
    expect(css).toMatch(/@media \(orientation: portrait\) \{\s*#hud \.score:not\(\.run\) \{ position: absolute/);
    expect(css).toMatch(/#hud \.score\.run \.lost \{[^}]*color: var\(--danger\)/);
  });
});

describe('the special marbles legend (#1541)', () => {
  it('makes its lines and its card the only parts of the plate that take a tap, and puts a card over the placement screen', () => {
    expect(css).toMatch(/#hud :is\(\.special, \.special-card\) \{ pointer-events: auto;/);
    expect(css).toMatch(/#hud \.specials \{ display: flex; flex-direction: column;[^}]*\}/);
    expect(css).not.toMatch(/#hud \.specials \{[^}]*pointer-events: auto/);
    expect(css).toContain('#chrome:has(.special-card) { z-index: 2; }');
  });
});

describe('the support stack (#1700)', () => {
  it('lets the pointer through its box and takes it only on its buttons and the diagnostics box', () => {
    expect(css).toContain('#support { pointer-events: none; }');
    expect(css).toContain('#support :is(button, textarea) { pointer-events: auto; }');
  });
});
