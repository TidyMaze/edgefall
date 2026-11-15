// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DELAY_MS } from './autoplay';
import { BLACK_WINS } from '../e2e/end-games';
import type { Axial } from './board';
import { gameFileText } from './gamefile';
import { SLIDE_MS } from './slide';
import { boot, type Game, startBoss } from './test/harness';

// The replay mode of main.ts on the harness (#793): the bar, the keys, the stepped position and the view-only guard.

type Move = { cells: Axial[]; dir: number };
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const legal = (game: Game): Move[] => game.hook<Move[]>('__legal');
const plies = (game: Game): number => game.hook<number>('__plies');
const label = (): string => byId('replay-label').textContent!;
const bar = (): boolean => !byId('replay-bar').hidden;
const slider = (): HTMLInputElement => byId<HTMLInputElement>('replay-slider');
const key = (k: string, init: KeyboardEventInit = {}, on: EventTarget = document.body): boolean =>
  on.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** Plays the first legal single-marble move by two clicks, then lets its slide end. */
function playOne(game: Game): void {
  const mv = legal(game).find((m) => m.cells.length === 1)!;
  game.click(...mv.cells[0]!);
  const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
  game.click(...target.cell);
  game.frame(SLIDE_MS);
}
/** A hot-seat game of `n` plies. */
async function played(n: number): Promise<Game> {
  const game = await boot('?bot=off');
  for (let i = 0; i < n; i++) playOne(game);
  return game;
}
async function importGame(game: Game, moves: number[][]): Promise<void> {
  const input = byId<HTMLInputElement>('import-file');
  Object.defineProperty(input, 'files', { value: [new File([gameFileText({ bot: false, moves })], 'g.json')], configurable: true });
  input.dispatchEvent(new Event('change'));
  await game.settle();
}

describe('the replay bar', () => {
  it('has a Replay button that waits for a first move, and a bar that opens on the live position', async () => {
    const game = await boot('?bot=off');
    expect(byId<HTMLButtonElement>('replay').disabled).toBe(true);
    expect(byId('dock').contains(byId('replay'))).toBe(true); // a dock action (#1693)
    expect(byId('replay').hidden).toBe(true); // nothing to review yet (#1693)
    expect(bar()).toBe(false);
    playOne(game);
    playOne(game);
    expect(byId('replay').hidden).toBe(false);
    byId('replay').click();
    expect(bar()).toBe(true);
    expect(label()).toBe('Move 2 of 2 (live)');
    expect(slider().max).toBe('2');
    expect(slider().value).toBe('2');
  });

  it('steps with first, previous, next, last and the slider, and shows the position stepped to', async () => {
    const opening = legal(await boot('?bot=off'));
    const game = await played(3);
    const turn = game.turn();
    byId('replay').click();
    byId('replay-prev').click();
    expect(label()).toBe('Move 2 of 3');
    expect(game.turn()).not.toBe(turn); // two plies back it is the other side's move
    byId('replay-first').click();
    expect(label()).toBe('Move 0 of 3');
    expect(legal(game)).toEqual(opening);
    expect(game.hook('__rings')).toEqual([]);
    byId('replay-next').click();
    expect(slider().value).toBe('1');
    slider().value = '2';
    slider().dispatchEvent(new Event('input'));
    expect(label()).toBe('Move 2 of 3');
    byId('replay-last').click();
    expect(label()).toBe('Move 3 of 3 (live)');
    expect(game.turn()).toBe(turn);
    expect(plies(game)).toBe(3); // the move log is never touched
  });

  it('is view only: no move can be played while replaying', async () => {
    const game = await played(2);
    byId('replay').click();
    byId('replay-prev').click();
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    expect(game.hook<unknown[]>('__targets')).toEqual([]);
    expect(plies(game)).toBe(2);
  });

  it('Live returns to the current position and closes the bar', async () => {
    const game = await played(2);
    const turn = game.turn();
    byId('replay').click();
    byId('replay-first').click();
    byId('replay-live').click();
    expect(bar()).toBe(false);
    expect(game.turn()).toBe(turn);
    playOne(game); // the game goes on
    expect(plies(game)).toBe(3);
  });
});

describe('the replay keys', () => {
  it('Left opens the replay one move back, Left and Right step, Escape returns to the live game', async () => {
    const game = await played(3);
    expect(key('ArrowRight')).toBe(true); // nothing to step forward to
    expect(bar()).toBe(false);
    expect(key('ArrowLeft')).toBe(false);
    expect(label()).toBe('Move 2 of 3');
    key('ArrowLeft');
    expect(label()).toBe('Move 1 of 3');
    key('ArrowRight');
    expect(label()).toBe('Move 2 of 3');
    expect(key('Escape')).toBe(false);
    expect(bar()).toBe(false);
    expect(plies(game)).toBe(3);
  });

  it('leaves shortcuts, a typing field and an empty game alone', async () => {
    const game = await boot('?bot=off');
    expect(key('ArrowLeft')).toBe(true); // no move yet
    playOne(game);
    expect(key('ArrowLeft', { ctrlKey: true })).toBe(true);
    expect(key('ArrowLeft', { altKey: true })).toBe(true);
    expect(key('ArrowLeft', { metaKey: true })).toBe(true);
    expect(key('ArrowLeft', {}, byId('invite'))).toBe(true);
    expect(bar()).toBe(false);
  });

  it('are the camera keys while Free Cam is on', async () => {
    const game = await played(1);
    byId('setting-free-cam').click();
    expect(key('ArrowLeft')).toBe(true);
    expect(bar()).toBe(false);
    byId('setting-free-cam').click();
    expect(game.turn()).toBeTruthy();
  });
});

describe('what the replay covers', () => {
  it('an imported game file, over: the stepped position is not over', async () => {
    const game = await boot('?bot=off');
    await importGame(game, BLACK_WINS);
    expect(document.body.dataset.over).toBe('win');
    byId('replay').click();
    byId('replay-prev').click();
    expect(document.body.dataset.over).toBeUndefined();
    expect(game.hud()).toContain('to move');
    byId('replay-live').click();
    expect(document.body.dataset.over).toBe('win');
  });

  it('a new game or an import closes the replay', async () => {
    const game = await played(2);
    byId('replay').click();
    byId('replay-first').click();
    await importGame(game, BLACK_WINS);
    expect(bar()).toBe(false);
    expect(plies(game)).toBe(BLACK_WINS.length);
    byId('replay').click();
    byId('new-game').click();
    byId('new-game').click(); // confirmed
    expect(bar()).toBe(false);
  });

  it('the move of a bot that answers while the replay is open closes it on the live position', async () => {
    const game = await boot('?nodes=1');
    playOne(game);
    byId('replay').click();
    byId('replay-first').click();
    for (let i = 0; i < 50 && plies(game) < 2; i++) await game.settle();
    expect(plies(game)).toBe(2);
    expect(bar()).toBe(false);
  });

  it('a boss fight: the boss state at each ply comes from replaying the log', async () => {
    const game = await boot('?bot=off');
    startBoss('The Hull');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Hull');
    playOne(game);
    byId('replay').click();
    byId('replay-first').click();
    expect(label()).toBe('Move 0 of 1');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Hull');
    byId('replay-last').click();
    expect(plies(game)).toBe(1);
  });

  it('the Ship hides the Replay button and ends the replay', async () => {
    const game = await played(1);
    byId('replay').click();
    byId('ship').click();
    expect(bar()).toBe(false);
    expect(byId('replay').hidden).toBe(true);
  });

  it('turns Auto-play off: the bot plays no move while the player looks back (#792)', async () => {
    const game = await boot('?nodes=50');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    byId('auto-play').click();
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS);
    game.frame(1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10); // the bot's reply
    game.frame(1000);
    const at = plies(game);
    expect(at).toBe(2);
    byId('replay').click();
    expect(byId('auto-play').getAttribute('aria-pressed')).toBe('false');
    await vi.advanceTimersByTimeAsync(AUTO_DELAY_MS * 3);
    game.frame(1000);
    expect(plies(game)).toBe(at);
  });
});
afterEach(() => vi.useRealTimers());
