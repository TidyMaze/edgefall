// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Axial } from './board';
import { LEGACY_UNLOCKED } from './collector';
import { CARGO_LINE, LEDGER, MEDAL_LINE, TERMINAL_LINE, VOIDED_LINE } from './ledger';
import { newRun } from './roguelite';
import { STORY_KEY } from './story';
import { boot, type Game } from './test/harness';

// The Ledger (#1585, #1586, #1587, docs/specs/world.md section 12.9): the story lines the player has seen, listed in the settings menu in stage order, and the
// lines of stages 3 to 5 the world delivers. Only the ids of the lines seen are saved, in `ab-alone.ledger`.
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const key = (k: string): void => void dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const LEDGER_KEY = 'ab-alone.ledger';
const stored = (): string[] => (localStorage.getItem(LEDGER_KEY) ?? '').split(',').filter(Boolean);
const story = (...moments: number[]): Record<string, string> => ({ [STORY_KEY]: JSON.stringify({ moments, wins: 0, bosses: [] }) });
const line = (id: string): string => LEDGER.find((l) => l.id === id)!.line;
const plate = (): HTMLElement => document.querySelector<HTMLElement>('#settings-menu .setting-archive')!;
const listed = (): string[] => [...plate().querySelectorAll('p')].map((p) => p.textContent!);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};

/** A page whose console shows its first entry: the fonts are in. */
async function ready(storage: Record<string, string> = {}): Promise<Game> {
  const game = await boot('?bot=off', { storage });
  await game.settle();
  game.frame();
  return game;
}
/** Opens the Ledger page of the settings menu. */
function openLedger(game: Game): void {
  game.openSettings();
  byId('setting-ledger').click();
}

describe('the Ledger section of the settings menu (#1585)', () => {
  it('is a short word beside Logs, in the same item, and is no toggle', async () => {
    await ready();
    const button = byId('setting-ledger');
    expect([button.textContent, button.title]).toEqual(['Ledger', 'Ledger']);
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(button.parentElement).toBe(byId('setting-log-archive').parentElement);
    expect(button.previousElementSibling).toBe(byId('setting-log-archive'));
  });

  it('says so when no line was seen, and the menu opens on its items again once closed', async () => {
    const game = await ready();
    openLedger(game);
    expect(byId('settings-menu').dataset.page).toBe('archive'); // the archive plate
    expect(plate().textContent).toBe('Nothing filed yet.');
    game.openSettings();
    expect(byId('settings-menu').hidden).toBe(true);
    expect(byId('settings-menu').dataset.page).toBeUndefined();
  });

  it('lists the lines seen in stage order, whatever the order seen, and none above the stage', async () => {
    const game = await ready({ ...story(2, 3, 4), [LEDGER_KEY]: 'cargo,voided,bot,town-4,medal,ballast-7' });
    openLedger(game);
    expect(listed()).toEqual([line('bot'), line('medal'), line('cargo')]);
  });

  it('lists nothing of a player at stage 1 even when the key holds lines, and ignores an id it does not know', async () => {
    const game = await ready({ [LEDGER_KEY]: 'cargo,medal,nobody,' });
    openLedger(game);
    expect(plate().textContent).toBe('Nothing filed yet.');
    const staged = await ready({ ...story(2), [LEDGER_KEY]: 'nobody,bot' });
    openLedger(staged);
    expect(listed()).toEqual([line('bot')]);
  });

  it('stores only ids: an older profile has no key, and no line text is ever saved', async () => {
    await ready(story(2));
    expect(localStorage.getItem(LEDGER_KEY)).toBeNull();
    const all = Object.entries(localStorage).map(([, v]) => String(v)).join('');
    for (const { line: text } of LEDGER) expect(all).not.toContain(text);
  });
});

describe('the lines the world delivers are filed in the Ledger once seen (#1585)', () => {
  it("files Tally's line of the bot table when the match starts", async () => {
    const game = await boot('?nodes=50', { storage: story(2) });
    expect(game.hud()).toContain('You vs Bot. Eject 6 to win.'); // the plate names the match (#1568), Tally's line is filed
    expect(stored()).toEqual(['bot']);
  });

  it('files nothing for a line of stage 1', async () => {
    await boot('?nodes=50');
    expect(stored()).toEqual([]);
  });
});

describe('the Medal room carries the line of stage 3 (#1586)', () => {
  /** Opens the Medal room from the Mess of the Hub. */
  async function medalRoom(storage: Record<string, string>): Promise<void> {
    const game = await boot('?bot=off', { storage });
    await game.settle();
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 1], beaten: [] }));
    byId('ship').click();
    game.click(0, 2);
    expect(data().reading).toBe('medal-room');
  }
  /** Every page of the reader, turned to the end (the Medal room has two). */
  const text = (): string => {
    const seen: string[] = [];
    while (!byId('reader').hidden) {
      seen.push(byId('reader').textContent!);
      key('ArrowRight');
    }
    return seen.join(' ');
  };

  it('shows it on the first visit, the visit that reaches stage 3, and files it', async () => {
    await medalRoom(story(2));
    expect(JSON.parse(localStorage.getItem(STORY_KEY)!).moments).toEqual([2, 3]);
    expect(text()).toContain(`TALLY: ${MEDAL_LINE}`);
    expect(stored()).toEqual(['medal']);
  });

  it('shows it on the first page for a player already at stage 3 or more: a line is never split by a page turn', async () => {
    await medalRoom(story(2, 3, 4));
    expect(byId('reader').textContent).toContain(MEDAL_LINE);
  });

  it('shows none of it to a player at stage 1', async () => {
    await medalRoom({});
    expect(text()).not.toContain(MEDAL_LINE);
    expect(stored()).toEqual([]);
  });
});

describe('the terminals of the Hub carry a note of Tally after stage 5 (#1587)', () => {
  /** Every page of the console entry, read in the reader. */
  function pages(): string {
    key('t');
    const seen: string[] = [];
    while (!byId('reader').hidden) {
      seen.push(byId('reader').textContent!);
      key('ArrowRight');
    }
    return seen.join(' ');
  }

  it('appends the note at stage 5 and files it', async () => {
    await ready(story(2, 3, 4, 5));
    expect(pages()).toContain(`Appended by TALLY: ${TERMINAL_LINE}`);
    expect(stored()).toEqual(['terminal']);
  });

  it('appends nothing at stage 4', async () => {
    await ready(story(2, 3, 4));
    expect(pages()).not.toContain('Appended by TALLY');
    expect(stored()).toEqual([]);
  });
});

describe('the Cargo log ends on the line of stage 4 (#1586)', () => {
  /** Plays the Cargo log from the archive and runs it to its end. */
  async function cargo(storage: Record<string, string>): Promise<string> {
    const game = await ready({ ...storage, 'ab-alone.logs-collected': 'cargo-night-shift' });
    game.openSettings();
    byId('setting-log-archive').click();
    document.querySelector<HTMLButtonElement>('#settings-menu .setting-archive button')!.click();
    expect(data().log).toBe('cargo-night-shift');
    game.frame(51000);
    return byId('transcript').textContent!;
  }

  it('says it at stage 4, and files it', async () => {
    expect(await cargo(story(2, 3, 4))).toBe(`TALLY: ${CARGO_LINE}`);
    expect(stored()).toEqual(['cargo']);
  });

  it('keeps the last line it had below stage 4', async () => {
    expect(await cargo(story(2, 3))).toBe('Still clocked in. Still on time. End.');
    expect(stored()).toEqual([]);
  });
});

describe('a town of the Open world is the first town visited, stage 3 (#1586)', () => {
  /** Opens the world of seed 7 and rolls onto the first town. */
  async function town(storage: Record<string, string>): Promise<void> {
    const game = await boot('?bot=off&openworld=7', { storage });
    byId('openworld').click();
    await settle();
    const [q, r] = data().openworldPlaces!.split(' ').filter((p) => p.startsWith('town:'))[0]!.slice(5).split(',').map(Number) as unknown as Axial;
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(data().hub).toBeTruthy();
  }

  it('fires the moment of stage 3 and shows the line of the town, filed in the Ledger', async () => {
    await town(story(2));
    expect(JSON.parse(localStorage.getItem(STORY_KEY)!).moments).toEqual([2, 3]);
    expect(byId('hud').textContent).toContain(line('town-0'));
    expect(stored()).toEqual(['town-0']);
  });

  it('records the moment for a stage 1 player, who still sees no line', async () => {
    await town({});
    expect(JSON.parse(localStorage.getItem(STORY_KEY)!).moments).toEqual([3]);
    expect(stored()).toEqual([]);
  });
});

describe('a lost run speaks of line 0412 after stage 5 (#1587)', () => {
  async function lost(storage: Record<string, string>): Promise<string> {
    const game = await boot('?bot=off', { storage });
    byId('roguelite').click();
    await game.hook('__run', { ...newRun(1, 3, LEGACY_UNLOCKED), enemies: false, end: 'lost', army: 3 });
    expect(data().run).toBe('lost');
    return byId('run-map').querySelector('.run-tally')!.textContent!;
  }

  it('shows the line of stage 5 and files it', async () => {
    expect(await lost(story(2, 3, 4, 5))).toBe(VOIDED_LINE);
    expect(stored()).toContain('voided');
  });

  it('shows the old audit below stage 5, and files nothing', async () => {
    expect(await lost(story(2, 3, 4))).toBe('Run voided. Audit reopened.');
    expect(stored()).not.toContain('voided');
  });
});
