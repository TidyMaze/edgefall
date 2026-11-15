// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeMove, parseMoves, type Axial, type Move } from './board';
import { CONFIRM_MS } from './newgame';
import { boot, type Game, startBoss } from './test/harness';

// The local game flow of main.ts on the harness (decision #445): the bot and its worker, the save and its resume, the
// evaluation bar, the hint, New game, the export and import of a game file, and the hooks the browser checks read.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const hintButton = (): HTMLButtonElement => byId('hint');
const newGame = (): HTMLButtonElement => byId('new-game');

/** Plays the first legal single-marble move of the side to move by two clicks, as a player does. */
function playMove(game: Game): Move {
  const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
  game.click(...move.cells[0]!);
  const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!;
  game.click(...target.cell);
  return move;
}

/** The game where both sides play their first legal move: a draw by repetition on Black's move, ply 17. */
async function firstMoveGame(): Promise<number[][]> {
  const { Engine } = await import('edgefall-wasm');
  const engine = new Engine();
  const moves: number[][] = [];
  while (engine.status() === 0) {
    const record = encodeMove(parseMoves(engine.legal_moves())[0]!);
    engine.play(Int32Array.from(record));
    moves.push(record);
  }
  return moves;
}

/** A game file of the save format (docs/specs/tech.md section 8), against the bot. */
const gameFile = (moves: number[][]): string =>
  JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves });

/** Picks `text` as the file of the import input, as the file dialog does. */
function pickFile(text: string | Promise<string> | null): void {
  const input = byId<HTMLInputElement>('import-file');
  const file = text === null ? [] : [{ size: 100, text: () => Promise.resolve(text) }];
  Object.defineProperty(input, 'files', { value: file, configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** The bot searches main.ts logged (Copy diagnostics keeps them): their budget or boss. */
const botSearches = (): unknown[] =>
  vi
    .mocked(console.info)
    .mock.calls.filter(([event]) => event === '[ab-alone] bot-search')
    .map(([, entry]) => {
      const { ms: _ms, ...search } = (entry as { data: { ms: number } }).data;
      return search;
    });


afterEach(() => vi.useRealTimers());

describe('main.ts, the bot', () => {
  it('answers a move of the human with its own, searched with the ?nodes budget, and blocks the hint meanwhile', async () => {
    const game = await boot('?nodes=50', { storage: { 'ab-alone.difficulty': 'normal' } });
    await game.settle();
    expect(botSearches()).toEqual([]); // the human moves first
    const mine = game.turn();
    playMove(game);
    expect(game.turn()).not.toBe(mine);
    expect(hintButton().disabled).toBe(true); // the bot thinks
    await game.settle();
    game.frame(1000); // the bot's move waits for the slide of the human's
    expect(game.hook('__plies')).toBe(2);
    expect(game.turn()).toBe(mine);
    expect(hintButton().disabled).toBe(false);
    expect(botSearches()).toEqual([{ nodes: 50 }]);
  });

  it('replies as the boss in a boss fight', async () => {
    const game = await boot('?nodes=50');
    startBoss('The Chaplain');
    playMove(game);
    await game.settle();
    game.frame(1000);
    expect(game.hook('__plies')).toBe(2);
    expect(botSearches()).toEqual([{ boss: 'chaplain' }]);
  });

  it('drops its reply to a game New game replaced while it was thinking', async () => {
    const game = await boot('?nodes=50', { storage: { 'ab-alone.difficulty': 'normal' } });
    const mine = game.turn();
    playMove(game);
    newGame().click();
    newGame().click(); // confirmed
    await game.settle();
    game.frame(1000);
    expect(game.hook('__plies')).toBe(0);
    expect(game.turn()).toBe(mine);
    expect(botSearches()).toEqual([{ nodes: 50 }]); // it searched, its move was dropped
  });

  it('is off with ?bot=off: the same hand plays both sides', async () => {
    const game = await boot('?bot=off');
    playMove(game);
    await game.settle();
    expect(game.hook('__plies')).toBe(1);
    expect(game.turn()).toBe('White to move');
    expect(botSearches()).toEqual([]);
  });
});

describe('main.ts, the save', () => {
  it('resumes the local game after a reload, in the same mode', async () => {
    const indexedDB = new IDBFactory();
    const first = await boot('?bot=off', { indexedDB });
    const mv = playMove(first);
    await first.settle();
    const again = await boot('?bot=off', { indexedDB });
    expect(again.hook('__plies')).toBe(1);
    expect(again.hook('__history')).toEqual([encodeMove(mv)]);
    expect(again.turn()).toBe('White to move');
  });

  it('starts a new game when nothing is saved', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__plies')).toBe(0);
    expect(game.hook('__history')).toEqual([]);
  });
});

describe('main.ts, the evaluation bar', () => {
  it('shows the score of every position of a local game', async () => {
    const game = await boot('?bot=off');
    const bar = byId('eval');
    expect(bar.hidden).toBe(false);
    await game.settle();
    expect(bar.dataset.ply).toBe('0');
    const words = bar.querySelector('.label')!.textContent!;
    expect(words).toMatch(/^(Even|(Black|White) \+\d\.\d)$/); // the start position is close to even
    const meter = bar.querySelector('.track')!;
    expect(meter.getAttribute('aria-valuetext')).toBe(words);
    const fill = Number(bar.style.getPropertyValue('--fill'));
    expect(fill).toBeGreaterThan(0.4);
    expect(fill).toBeLessThan(0.6);
    expect(meter.getAttribute('aria-valuenow')).toBe(String(Math.round(fill * 100)));
    playMove(game);
    await game.settle();
    expect(bar.dataset.ply).toBe('1');
  });

  it('is off for good in a boss fight, with the hint', async () => {
    const game = await boot('?nodes=50');
    await game.settle();
    startBoss('The Hull');
    expect(byId('eval').hidden).toBe(true);
    expect(hintButton().hidden).toBe(true);
    playMove(game);
    await game.settle();
    game.frame(1000);
    expect(game.hook('__plies')).toBe(2);
    expect(byId('eval').hidden).toBe(true); // the moves of the fight never ask for a score
    expect(byId('eval').dataset.ply).toBe('0');
  });
});

describe('main.ts, the hint', () => {
  it('asks the best move on a press, shows it, and clears it on a second press', async () => {
    const game = await boot('?bot=off&nodes=50');
    expect(hintButton().hidden).toBe(false);
    hintButton().click();
    expect(document.body.dataset.hint).toBe('asking');
    expect(hintButton().getAttribute('aria-pressed')).toBe('true');
    expect(game.hook('__hint')).toBe(null);
    await game.settle();
    expect(document.body.dataset.hint).toBe('shown');
    const hinted = game.hook<number[]>('__hint');
    expect(game.hook<Move[]>('__legal').map(encodeMove)).toContainEqual(hinted);
    hintButton().click();
    expect(document.body.dataset.hint).toBe('off');
    expect(hintButton().getAttribute('aria-pressed')).toBe('false');
    expect(game.hook('__plies')).toBe(0); // shown, never played
  });

  it('fades the ghost in over the base token, whole at once under reduced motion (#1097)', async () => {
    const game = await boot('?bot=off&nodes=50');
    hintButton().click();
    await game.settle();
    expect(game.hook<number>('__ghostOpacity')).toBe(0); // just appeared
    game.frame(100);
    const mid = game.hook<number>('__ghostOpacity');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.45);
    game.frame(1000);
    expect(game.hook<number>('__ghostOpacity')).toBeCloseTo(0.45);
    hintButton().click(); // cleared: the next ghost, hovered, is whole
    expect(game.hook<number>('__ghostOpacity')).toBeCloseTo(0.45);
  });

  it('shows the Hint ghost whole at once under reduced motion (#1097)', async () => {
    const game = await boot('?bot=off&nodes=50', { reducedMotion: true });
    hintButton().click();
    await game.settle();
    expect(game.hook<number>('__ghostOpacity')).toBeCloseTo(0.45);
  });

  it('goes away with a new selection', async () => {
    const game = await boot('?bot=off&nodes=50');
    hintButton().click();
    await game.settle();
    const [q, r] = game.hook<Move[]>('__legal')[0]!.cells[0]!;
    game.click(q, r);
    expect(document.body.dataset.hint).toBe('off');
    expect(game.hook('__rings')).toEqual([[q, r]]);
  });

  it('clears the selection on a press, so the ghost shows the hint alone', async () => {
    const game = await boot('?bot=off&nodes=50');
    const [q, r] = game.hook<Move[]>('__legal')[0]!.cells[0]!;
    game.click(q, r);
    hintButton().click();
    await game.settle();
    expect(game.hook<Axial[]>('__rings')).toEqual(parseMoves(game.hook<number[]>('__hint'))[0]!.cells);
  });
});

describe('main.ts, New game', () => {
  it('starts over at once when no move is played', async () => {
    const game = await boot('?bot=off');
    newGame().click();
    expect(newGame().getAttribute('aria-label')).toBe('New game');
    expect(newGame().classList.contains('confirm')).toBe(false);
    expect(game.turn()).toBe('Black to move');
  });

  it('asks for a confirmation once a move is played, then starts over and deletes the save', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?bot=off', { indexedDB });
    playMove(game);
    await game.settle();
    newGame().click();
    expect(newGame().getAttribute('aria-label')).toBe('Confirm new game');
    expect(newGame().title).toBe('Confirm new game');
    expect(newGame().textContent).toBe('Confirm new game');
    expect(newGame().classList.contains('confirm')).toBe(true);
    expect(game.hook('__plies')).toBe(1);
    newGame().click();
    expect(game.hook('__plies')).toBe(0);
    expect(game.turn()).toBe('Black to move');
    expect(newGame().getAttribute('aria-label')).toBe('New game');
    expect(newGame().querySelector('svg')).not.toBe(null); // the icon is back
    await game.settle();
    expect(byId('eval').dataset.ply).toBe('0'); // the bar follows the new game
    const again = await boot('?bot=off', { indexedDB });
    expect(again.hook('__plies')).toBe(0);
  });

  it('lets the confirmation lapse after a few seconds', async () => {
    const game = await boot('?bot=off');
    playMove(game);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    newGame().click();
    vi.advanceTimersByTime(CONFIRM_MS);
    expect(newGame().getAttribute('aria-label')).toBe('New game');
    expect(newGame().classList.contains('confirm')).toBe(false);
    newGame().click(); // asks again
    expect(game.hook('__plies')).toBe(1);
    expect(newGame().getAttribute('aria-label')).toBe('Confirm new game');
  });
});

describe('main.ts, export and import', () => {
  it('exports the local game as a JSON file in the save format', async () => {
    const game = await boot('?bot=off');
    const mv = playMove(game);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (blobs.push(blob as Blob), 'blob:game'));
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download} ${this.href}`);
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    byId('setting-export-game').click();
    expect(downloads).toEqual([expect.stringMatching(/^edgefall-\d{4}-\d\d-\d\d\.json blob:game$/)]);
    expect(blobs[0]!.type).toBe('application/json');
    expect(JSON.parse(await blobs[0]!.text())).toEqual({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: [encodeMove(mv)] });
    expect(revoked).not.toHaveBeenCalled(); // the download may still be reading it
    vi.advanceTimersByTime(60_000);
    expect(revoked).toHaveBeenCalledWith('blob:game');
  });

  it('opens the file dialog on Import', async () => {
    await boot('?bot=off');
    const input = byId<HTMLInputElement>('import-file');
    const opened = vi.spyOn(input, 'click').mockImplementation(() => {});
    byId('setting-import-game').click();
    expect(opened).toHaveBeenCalledOnce();
  });

  it('replaces the game with an imported one and saves it, and the bot answers if it is its turn', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?nodes=50', { indexedDB });
    const [first] = await firstMoveGame();
    pickFile(gameFile([first!]));
    await game.settle();
    game.frame(1000);
    expect(game.hook<number[][]>('__history')[0]).toEqual(first);
    expect(game.hook('__plies')).toBe(2); // the bot answered the imported move
    expect(byId('eval').dataset.ply).toBe('2');
    await game.settle();
    const again = await boot('?nodes=50', { indexedDB });
    expect(again.hook<number[][]>('__history')[0]).toEqual(first);
  });

  it('imports a finished game: no hint, no bot, no save', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?nodes=50', { indexedDB });
    const moves = await firstMoveGame();
    pickFile(gameFile(moves));
    await game.settle();
    expect(game.hook('__plies')).toBe(17);
    expect(document.body.dataset.over).toBeDefined();
    expect(hintButton().disabled).toBe(true);
    expect(botSearches()).toEqual([]);
    const again = await boot('?nodes=50', { indexedDB });
    expect(again.hook('__plies')).toBe(0);
  });

  it('refuses a file that is not a game, and changes nothing but the HUD note', async () => {
    const game = await boot('?bot=off');
    playMove(game);
    pickFile('not a game');
    await game.settle();
    expect(game.hud()).toContain('import refused: not a game file');
    expect(game.hook('__plies')).toBe(1);
  });

  it('does nothing when the dialog is closed without a file', async () => {
    const game = await boot('?bot=off');
    const before = game.hud();
    pickFile(null);
    await game.settle();
    expect(game.hud()).toBe(before);
  });

  it('drops a file still being read when the player starts a boss fight', async () => {
    const game = await boot('?nodes=50');
    const [first] = await firstMoveGame();
    let read: (text: string) => void = () => {};
    pickFile(new Promise<string>((done) => (read = done)));
    startBoss('The Hull');
    read(gameFile([first!]));
    await game.settle();
    expect(game.hook('__plies')).toBe(0);
    expect(game.hook<{ id: string }>('__fight').id).toBe('hull');
  });
});

describe('main.ts, __playTurns', () => {
  it('plays whole turns, a player move and the bot reply each, without slides', async () => {
    const game = await boot('?nodes=50');
    const played = game.hook<Promise<number>>('__playTurns', 2, [0, 1, 2, 3, 4, 5]);
    expect(hintButton().disabled).toBe(true);
    expect(await played).toBe(2);
    expect(game.hook('__plies')).toBe(4);
    expect(document.body.dataset.sliding).toBeUndefined();
    expect(hintButton().disabled).toBe(false);
  });

  it('stops when no single-marble move goes in one of the directions', async () => {
    const game = await boot('?nodes=50');
    expect(await game.hook<Promise<number>>('__playTurns', 3, [])).toBe(0);
    expect(game.hook('__plies')).toBe(0);
  });

  it('stops on a game the player move ends, or one already over', async () => {
    const game = await boot('?nodes=50');
    const moves = await firstMoveGame();
    pickFile(gameFile(moves.slice(0, 16)));
    await game.settle();
    const last = parseMoves(moves[16]!)[0]!;
    expect(await game.hook<Promise<number>>('__playTurns', 2, [last.dir])).toBe(0);
    expect(game.hook('__plies')).toBe(17); // a draw by repetition
    expect(await game.hook<Promise<number>>('__playTurns', 2, [0, 1, 2, 3, 4, 5])).toBe(0);
    expect(game.hook('__plies')).toBe(17);
  });

  it('stops when New game replaces the game while the bot thinks', async () => {
    const game = await boot('?nodes=50');
    const played = game.hook<Promise<number>>('__playTurns', 3, [0, 1, 2, 3, 4, 5]);
    await Promise.resolve();
    newGame().click();
    newGame().click();
    expect(await played).toBe(0);
    expect(game.hook('__plies')).toBe(0);
  });

  it('plays nothing without the bot, or while it thinks', async () => {
    const hotSeat = await boot('?bot=off');
    expect(await hotSeat.hook<Promise<number>>('__playTurns', 1, [0, 1, 2, 3, 4, 5])).toBe(0);
    const game = await boot('?nodes=50');
    playMove(game);
    expect(await game.hook<Promise<number>>('__playTurns', 1, [0, 1, 2, 3, 4, 5])).toBe(0);
    await game.settle();
    game.frame(1000);
    expect(game.hook('__plies')).toBe(2); // the bot's own reply
  });

  it('exists only under automation', async () => {
    Reflect.deleteProperty(window, '__playTurns'); // set by the pages of the tests above
    await boot('/', { webdriver: false });
    expect((window as unknown as Record<string, unknown>).__playTurns).toBeUndefined();
  });
});

describe('main.ts, the hooks of the browser checks', () => {
  it('read the game, the fight and the sound', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__fight')).toBe(null);
    expect(game.hook('__audio')).toBe('none');
    expect(game.hook('__gain', 'master')).toBe(0);
    expect(game.hook('__tension')).toEqual({ level: 0, layers: expect.any(Array) });
    expect(game.hook('__tellCues')).toEqual([]);
    expect(game.hook('__palette')).toBe(document.documentElement.dataset.palette); // the palette of the setting
    const mv = game.hook<Move[]>('__legal')[0]!;
    for (const name of ['__armies', '__cracks', '__converted']) expect(game.hook(name)).toEqual([]);
    expect(game.hook('__preview', mv)).toEqual([]); // no boss, no flip
  });

  it('read the boss parts of a fight', async () => {
    const game = await boot('?nodes=50');
    startBoss('The Choir');
    expect(game.hook<{ id: string }>('__fight').id).toBe('choir');
    expect(game.hook<unknown[]>('__armies').length).toBeGreaterThan(0);
    expect(game.hook('__cracks')).toEqual([]);
    expect(game.hook('__converted')).toEqual([]);
    expect(game.hook('__preview', game.hook<Move[]>('__legal')[0])).toEqual([]);
    expect(game.hook('__crackDecals')).toEqual([]);
    expect(game.hook('__crackDecalShown', false)).toBe(false);
  });
});
