// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot, type Game, startBoss } from './test/harness';
import { WAVE_1_WIN } from './test/trainerline';

// Trainer mode on the harness (#1159): Trainer in the mode menu starts wave 1, a bot with one marble against the
// player's 14. A wave won shows its card with Next wave, a wave lost or drawn ends or repeats it, Retry starts over.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const card = (): string => (byId('trainer-card').hidden ? '' : byId('trainer-text').textContent!);
const whites = (game: Game): number => game.hook<number[]>('__board').filter((c) => c === 2).length;
async function start(url = '?bot=off'): Promise<Game> {
  const game = await boot(url);
  byId('trainer').click();
  return game;
}
/** A game on `Engine.trainer(wave, left)` played out till it ends as `want`: Black moves at random, White as the bot or at
 * random. A 'draw' ends in Black's win with a draw reason (idle plies or repetition). */
async function playOut(wave: number, left: number, want: 'win' | 'loss' | 'draw', white: 'bot' | 'random'): Promise<number[][]> {
  const { Engine } = await import('edgefall-wasm');
  for (let seed = 1; seed < 300; seed++) {
    let s = seed;
    const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const engine = Engine.trainer(wave, left);
    const moves: number[][] = [];
    while (engine.status() === 0 && moves.length < 300) {
      const all = Array.from(engine.legal_moves());
      const k = Math.floor(rnd() * (all.length / 8));
      const mv = white === 'bot' && engine.to_move() === 2 ? Array.from(engine.best_move(60)) : all.slice(k * 8, k * 8 + 8);
      engine.play(Int32Array.from(mv));
      moves.push(mv);
    }
    const got = engine.status() === 2 ? 'loss' : engine.status() === 1 && engine.draw_reason() > 0 ? 'draw' : engine.status() === 1 ? 'win' : 'none';
    if (got === want) return moves;
  }
  throw new Error('no such game');
}

describe('main.ts, Trainer mode (#1159)', () => {
  it('Trainer in the mode menu starts wave 1: one bot marble against 14, the wave and the best in the HUD', async () => {
    const game = await start();
    expect(document.body.dataset.trainer).toBe('1');
    expect(game.hud()).toContain('Trainer · wave 1 · best 0 · Marbles left 6/6');
    expect(game.hud()).toContain('Drill: wave 1. Opponents: one. Seated.');
    expect(game.hud()).toMatch(/Trainer vs Bot\. Eject \d+ to win\./); // the plate names the mode (#1568)
    expect(whites(game)).toBe(1);
    expect(game.hook<number[]>('__board').filter((c) => c === 1)).toHaveLength(14);
    expect(byId('new-game').hidden).toBe(true);
    expect(byId('boss-retry').hidden).toBe(false);
    expect(byId('hint').hidden).toBe(true);
    expect(byId<HTMLButtonElement>('auto-play').disabled).toBe(true);
    expect(card()).toBe('');
  });

  it('the test hook loads a wave directly', async () => {
    const game = await start();
    game.hook('__trainer', 5);
    expect(document.body.dataset.trainer).toBe('5');
    expect(whites(game)).toBe(5);
    expect(game.hud()).toContain('Trainer · wave 5 · best 0');
    expect(game.hud()).toContain('Drill: wave 5. Opponents: five. Seated.');
  });

  it('a wave won shows its card, records the best, and Next wave brings one more marble', async () => {
    const game = await start();
    game.hook('__playMoves', WAVE_1_WIN);
    expect(whites(game)).toBe(0);
    expect(card()).toBe('Wave 1 clearedWaves survived: 1Marbles left: 6/6Best: 1Wave 1 filed. Best on record: 1.'); // a real clear costs no marble
    expect(game.hud()).toContain('Trainer · wave 1 · best 1 · Marbles left 6/6');
    expect(byId('trainer-next').textContent).toBe('Next wave');
    byId('trainer-next').click();
    expect(card()).toBe('');
    expect(document.body.dataset.trainer).toBe('2');
    expect(game.hud()).toContain('Trainer · wave 2 · best 1');
    expect(whites(game)).toBe(2);
    expect(game.hook('__plies')).toBe(0);
    expect(localStorage.getItem('ab-alone.trainer-best')).toBe('1'); // kept for the next visit
  });

  it('a wave lost ends the run: the wave before is the score, and Retry starts again at wave 1 with all 6 marbles', async () => {
    const game = await start();
    game.hook('__trainer', 14);
    game.hook('__playMoves', await playOut(14, 6, 'loss', 'bot'));
    expect(card()).toBe('Fell on wave 14Waves survived: 13Marbles left: 0/6Best: 13Wave 13 filed. Best on record: 13.');
    expect(byId('trainer-next').hidden).toBe(true);
    byId('boss-retry').click();
    expect(card()).toBe('');
    expect(game.hud()).toContain('Trainer · wave 1 · best 13 · Marbles left 6/6');
    expect(whites(game)).toBe(1);
  });

  it('a draw is a win that costs a marble of the run, and the marble stays lost on the next waves', async () => {
    const game = await start();
    game.hook('__trainer', 14);
    game.hook('__playMoves', await playOut(14, 6, 'draw', 'random'));
    expect(card()).toBe('Wave 14 stalled: a draw costs a marbleWaves survived: 14Marbles left: 5/6Best: 14Wave 14 filed. Best on record: 14.');
    expect(game.hud()).toContain('Marbles left 5/6');
    expect(game.hud()).toContain('StalledA draw costs a marble.'); // not "You win"
    expect(byId('trainer-next').hidden).toBe(false);
    byId('trainer-next').click();
    expect(document.body.dataset.trainer).toBe('15');
    expect(game.hud()).toContain('Trainer · wave 15 · best 14 · Marbles left 5/6');
    byId('boss-retry').click(); // only Retry fills the pool again
    expect(game.hud()).toContain('Marbles left 6/6');
  });

  it('the 6th draw ends the run: the score is the wave before', async () => {
    const game = await start();
    game.hook('__trainer', 6, 5);
    expect(game.hud()).toContain('Marbles left 1/6');
    game.hook('__playMoves', await playOut(6, 1, 'draw', 'random'));
    expect(card()).toBe('Fell on wave 6Waves survived: 5Marbles left: 0/6Best: 5Wave 5 filed. Best on record: 5.');
    expect(byId('trainer-next').hidden).toBe(true);
  });

  it('another mode leaves the Trainer', async () => {
    const game = await start();
    game.hook('__playMoves', WAVE_1_WIN);
    startBoss('The Echo');
    expect(document.body.dataset.trainer).toBeUndefined();
    expect(card()).toBe('');
    expect(game.hud()).not.toContain('Trainer');
  });

  it('the bot answers on the wave board, and a wave past a full army keeps 14 marbles', async () => {
    const game = await start('?nodes=50');
    game.hook('__trainer', 20);
    expect(whites(game)).toBe(14);
    expect(game.hud()).toContain('Trainer · wave 20');
    expect(byId('auto-reason').textContent).toBe('Not in the Trainer'); // no Auto-play with a bot (#1159)
    const move = game.hook<{ cells: [number, number][]; dir: number }[]>('__legal').find((m) => m.cells.length === 1)!;
    game.click(...move.cells[0]!);
    game.click(...game.hook<{ cell: [number, number]; dir: number }[]>('__targets').find((t) => t.dir === move.dir)!.cell);
    await game.settle();
    game.frame(1000);
    await game.settle();
    expect(game.hook('__plies')).toBe(2);
  });

  it('the replay rebuilds the wave, not a standard game', async () => {
    const game = await start();
    game.hook('__trainer', 3);
    game.hook('__playMoves', WAVE_1_WIN.slice(0, 1));
    byId('replay').click();
    byId('replay-prev').click();
    expect(whites(game)).toBe(3);
  });
});
