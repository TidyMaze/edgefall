// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type Axial } from './board';
import { boot, type Game } from './test/harness';

// The terminal reader (#512): a click on the console screen, or the T key, frames the camera on it; a click on the
// screen or the right arrow turns the page, the left arrow goes back; Esc, a click off the screen or a click past the
// last page leaves. The page shown is copied into #reader, for screen readers and the flat HUD, the entries read are
// saved, and the game goes on meanwhile.

type Rect = { x: number; y: number; width: number; height: number };
type Move = { cells: Axial[]; dir: number };
const reader = (): HTMLElement => document.getElementById('reader')!;
const data = (): DOMStringMap => document.body.dataset;
const key = (k: string): void => void dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const rect = (game: Game): Rect => game.hook('__consoleRect');
const screen = (game: Game, q: number, r: number): { x: number; y: number } => game.hook('__cellToScreen', q, r);
const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
function pointer(type: string, x: number, y: number): void {
  canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
}
function tap(at: { x: number; y: number }): void {
  pointer('pointerdown', at.x, at.y);
  pointer('pointerup', at.x, at.y);
}
const centre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A page whose console shows its first entry: the fonts are in. */
async function ready(url = '?bot=off'): Promise<Game> {
  const game = await boot(url);
  await game.settle();
  game.frame();
  return game;
}

describe('main.ts, the terminal reader (#512)', () => {
  it('the T key frames the camera on the console screen, and Esc gives the board view back', async () => {
    const game = await ready('?bot=off&scene=room'); // the room's screen: the terrace has none (#1369)
    const board = screen(game, 0, 0);
    expect(reader().hidden).toBe(true);
    key('t');
    expect(reader().hidden).toBe(false);
    expect(data().reading).toBe('mess-house-rule');
    const shown = rect(game);
    expect(shown.x).toBeGreaterThan(0); // the whole screen, with a margin
    expect(shown.x + shown.width).toBeLessThan(innerWidth);
    expect(shown.y).toBeGreaterThan(0);
    expect(shown.y + shown.height).toBeLessThan(innerHeight);
    expect(shown.width).toBeGreaterThan(innerWidth * 0.85);
    key('Escape');
    expect(reader().hidden).toBe(true);
    expect(data().reading).toBeUndefined();
    expect(screen(game, 0, 0)).toEqual(board);
  });

  it('copies the page shown into the reader region and pages with the arrows and a click, past the last page it leaves', async () => {
    const game = await ready();
    key('T');
    expect(data().console).toBe('mess-house-rule 1/2');
    const paragraphs = (): string[] => [...reader().querySelectorAll('p')].map((p) => p.textContent!);
    expect(paragraphs()[0]).toBe("Captain's order, pinned above table four");
    expect(paragraphs()[1]).toMatch(/^From today every dispute aboard is settled on a board\./);
    expect(paragraphs()[2]).toBe('Page 1 of 2');
    key('ArrowLeft'); // the first page stays
    key('x'); // another key does nothing
    expect(data().console).toBe('mess-house-rule 1/2');
    key('ArrowRight');
    expect(data().console).toBe('mess-house-rule 2/2');
    expect(paragraphs()[2]).toBe('Page 2 of 2');
    game.frame(9000); // no page turns by itself while reading
    expect(data().console).toBe('mess-house-rule 2/2');
    key('ArrowLeft');
    expect(data().console).toBe('mess-house-rule 1/2');
    tap(centre(rect(game))); // a click on the screen turns the page
    expect(data().console).toBe('mess-house-rule 2/2');
    tap(centre(rect(game))); // past the last page: back to the board
    expect(reader().hidden).toBe(true);
    game.frame(16);
    expect(data().console).toBe('mess-house-rule 2/2'); // the screen goes on from the page left
    game.frame(8000);
    expect(data().console).toBe('mess-house-rule 1/2');
  });

  it('a click on the console screen opens the reader, a click off the screen leaves', async () => {
    const game = await ready();
    pointer('pointerdown', 500, 600); // orbit to look at the west wall, low over the board
    pointer('pointermove', 240, 400);
    pointer('pointermove', 238, 380);
    pointer('pointerup', 238, 380);
    expect(reader().hidden).toBe(true); // a drag never opens it
    const far = rect(game);
    expect(far.width).toBeLessThan(innerWidth / 4);
    tap(centre(far));
    expect(reader().hidden).toBe(false);
    pointer('pointerdown', 1, 1);
    pointer('pointermove', 100, 1);
    pointer('pointerup', 100, 1); // a drag while reading neither turns nor leaves
    expect([reader().hidden, data().console]).toEqual([false, 'mess-house-rule 1/2']);
    tap({ x: 1, y: 1 }); // the corner of the window: off the screen
    expect(reader().hidden).toBe(true);
    expect(rect(game)).toEqual(far); // the view it left, the drag while reading forgotten
  });

  it('opens on nothing before the web fonts are in', async () => {
    const game = await boot('?bot=off', { fonts: () => new Promise(() => {}) });
    game.frame();
    key('t');
    expect(reader().hidden).toBe(true);
    expect(data().reading).toBeUndefined();
  });

  it('saves the entries read, once each', async () => {
    const game = await ready();
    key('t');
    key('Escape');
    game.hook('__deck', 'cargo');
    key('t');
    key('Escape');
    game.hook('__deck', 'mess');
    key('t');
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('mess-house-rule,cargo-assay');
  });

  it('shows the new entry from its first page when the deck changes while reading', async () => {
    const game = await ready();
    key('t');
    key('ArrowRight');
    game.hook('__deck', 'bridge');
    expect(data().console).toBe('bridge-clamp 1/1');
    expect(reader().textContent).toContain('Page 1 of 1');
  });

  it('shows the reader region as a plate while the Flat HUD is on', async () => {
    await ready();
    expect(reader().classList.contains('flat')).toBe(false);
    document.getElementById('setting-flat-hud')!.click();
    expect(reader().classList.contains('flat')).toBe(true);
    document.getElementById('setting-flat-hud')!.click();
    expect(reader().classList.contains('flat')).toBe(false);
  });

  it('never blocks a move: the bot answers while the player reads, and the board plays on after', async () => {
    const game = await ready('?nodes=1');
    const legal = (): Move[] => game.hook<Move[]>('__legal');
    const plies = (): number => game.hook<number>('__plies');
    const mine = game.turn();
    const mv = legal().find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
    game.click(...target.cell);
    const played = plies();
    key('t');
    game.frame(1000);
    await game.settle();
    game.frame(1000);
    expect(plies()).toBe(played + 1); // the bot played while the reader was open
    expect(reader().hidden).toBe(false);
    expect(game.turn()).toBe(mine);
    key('Escape');
    const next = legal().find((m) => m.cells.length === 1)!;
    tap(screen(game, ...next.cells[0]!));
    expect(game.hook<Axial[]>('__rings')).toEqual([next.cells[0]]);
    await game.settle();
  });

  // #1369: the terrace has no console screen, so its Game modes entry opens the deck's entry in the reader, as a plate.
  it('the terrace has a Console entry in Settings, Advanced, that reads the deck entry as a plate, and the room has none, #1369', async () => {
    const game = await ready();
    await vi.waitFor(() => expect(data().scene).toBe('table-zero'));
    const button = document.getElementById('console-entry') as HTMLButtonElement;
    expect(document.getElementById('mode-menu')!.contains(button)).toBe(false); // its home is Settings, Advanced (#1693)
    expect(button.closest('#settings-advanced')).not.toBeNull();
    expect(button.hidden).toBe(false);
    expect(document.getElementById('settings-menu')!.hidden).toBe(true);
    (document.getElementById('settings') as HTMLButtonElement).click();
    expect(document.getElementById('settings-menu')!.hidden).toBe(false);
    const board = screen(game, 0, 0);
    button.click();
    expect(document.getElementById('settings-menu')!.hidden).toBe(true); // the menu closes, as Leaderboard's does
    expect(reader().hidden).toBe(false);
    expect(reader().classList.contains('flat')).toBe(true); // the page shows: the room's screen is not there to show it
    expect(reader().textContent).toContain("Captain's order, pinned above table four");
    expect(data().reading).toBe('mess-house-rule');
    expect(screen(game, 0, 0)).toEqual(board); // the camera stays on the board: the room's screen is not framed
    key('Escape');
    expect(reader().hidden).toBe(true);
    await ready('?bot=off&scene=room');
    expect(data().scene).toBe('room');
    expect((document.getElementById('console-entry') as HTMLButtonElement).hidden).toBe(true);
  });
});

describe('the props during a fight (#1668)', () => {
  const inFight = async (): Promise<Game> => {
    const game = await ready();
    game.openModes();
    document.getElementById('boss-fight')!.click();
    [...document.getElementById('boss-list')!.querySelectorAll('button')].find((b) => b.textContent!.startsWith('The Echo'))!.click();
    expect(game.hook('__fight')).not.toBeNull();
    game.frame();
    return game;
  };

  it('a tap on the console screen opens no reader while a boss fight is on', async () => {
    const game = await inFight();
    expect(rect(game).width).toBeGreaterThan(0);
    tap(centre(rect(game)));
    expect(reader().hidden).toBe(true);
    expect(data().reading).toBeUndefined();
  });

  it('a tap on the recorder plays no log while a boss fight is on', async () => {
    const game = await inFight();
    const recorder: Rect = game.hook('__recorderRect');
    tap(centre(recorder));
    expect(data().log).toBeUndefined();
  });

  it('a tap on the console screen still opens the reader when no fight is on', async () => {
    const game = await ready('?bot=off&scene=room');
    tap(centre(rect(game)));
    expect(reader().hidden).toBe(false);
  });
});
