// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import * as THREE from 'three';
import type { Axial } from './board';
import { ECHO_STEPS } from './goalcard';
import { dailyFor, dailyTitle, utcDay } from './daily';
import { CONVERTED_AT, EXPLODED_AT, SEED } from './test/chaplain-game';
import { recordedGame } from './test/chaplain-fixture';
import { parseRecorded } from './test/chaplain-game';
import echoWin from '../../crates/edgefall-core/tests/fixtures/echo.txt?raw';
import { BOSS_BLURBS } from './lorelogs';
import { SLIDE_MS } from './slide';
import { boot, slowKeys, type Game } from './test/harness';

// Boss fights and the daily challenge on the harness (decision #445, task #454): the boss list, Retry, the Goal control,
// the daily challenge and its result card, the boss block of the HUD, and The Hull, The Chaplain and The Choir drawn on
// the board with their tells and the tells' sounds.

type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const body = (): DOMStringMap => document.body.dataset;

/** The random fight seed a picked boss draws from now on. */
const drawSeed = (seed: number): void =>
  void vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(seed);
    return a;
  });
/** Starts the fight against `name` from the mode menu, with `seed` as the random fight seed. */
function fightBoss(game: Game, name: string, seed = 1): void {
  drawSeed(seed);
  game.openModes();
  byId('boss-fight').click();
  [...byId('boss-list').querySelectorAll('button')].find((b) => b.textContent!.startsWith(name))!.click(); // a beaten boss carries its medal (#791)
}
/** Plays `mv` by two clicks: its marble, then the cell it goes to. */
function play(game: Game, mv: Move): void {
  const [q, r] = mv.cells[0]!;
  const [dq, dr] = DIRS[mv.dir]!;
  game.click(q, r);
  game.click(q + dq, r + dr);
}
/** The first legal one-marble move forward (NE or NW for the side at the bottom), the boss tests' move. */
const forward = (game: Game): Move =>
  game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
/** Lets the bot reply until `done` holds. */
async function until(game: Game, done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i++) await game.settle();
  expect(done()).toBe(true);
}
/** One boss turn: a forward move, then the boss reply. */
async function turn(game: Game): Promise<void> {
  const plies = game.hook<number>('__plies');
  play(game, forward(game));
  await until(game, () => game.hook<number>('__plies') === plies + 2);
}
/** Moves the pointer over a cell (the hover that draws the ghost), or off the board with null. */
function hover(game: Game, cell: Axial | null): void {
  const { x, y } = cell ? game.hook<{ x: number; y: number }>('__cellToScreen', ...cell) : { x: 1, y: 1 };
  document.querySelector('body > canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
}
/** A key press: the gesture that starts the audio. */
const gesture = (): boolean => dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
const cues = (game: Game): string[] => game.hook<string[]>('__tellCues');

// Move by move against The Echo, whose mirror of each move is a bonus move for the other side (#859), offered to the
// player (#958): Black up, White east, Black's free move east, Black back, White east, the free move again, Black back
// bring a position back a third time, a draw by repetition at the 7th move, which is a defeat against a boss (as
// e2e/fight-end.ts). ?bot=off plays both sides.
const ECHO_DRAW: [number, number, number, number][] = [
  [0, 2, 0, 1],
  [0, -1, 1, -1],
  [0, 1, -1, 1], // the free move the Echo's step offers (#958)
  [-1, 1, 0, 1],
  [0, -1, 1, -1],
  [0, 1, -1, 1],
  [-1, 1, 0, 1],
];
function loseByRepetition(game: Game): void {
  for (const [q, r, tq, tr] of ECHO_DRAW) {
    game.click(q, r);
    game.click(tq, tr);
  }
  expect(game.hook('__plies')).toBe(7);
}
const DAY = Date.parse('2027-03-30T08:00:00Z'); // its daily boss is The Echo, with 14 bosses (#1111)
const NEXT_DAY = Date.parse('2027-03-31T08:00:00Z');

describe('main.ts boss fights', () => {
  it("gives each boss of the list its blurb as its title, the tower's one line of the story (#1544)", async () => {
    await boot('?bot=off');
    const buttons = [...byId('boss-list').querySelectorAll('button')];
    expect(buttons.map((b) => b.title)).toEqual(BOSS_BLURBS.map((b) => b.blurb));
    const together = [...byId('coop-list').querySelectorAll('button')]; // the same list of Fight together and Boss duel
    expect(together.map((b) => b.title)).toEqual(BOSS_BLURBS.map((b) => b.blurb));
  });

  it('lists the bosses behind Boss fight, the button opens and closes the list', async () => {
    await boot('?bot=off');
    const button = byId('boss-fight');
    const list = byId('boss-list');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'The Echo',
      'The Hull',
      'The Choir',
      'The Chaplain',
      'The Ballast Mind',
      'The Alien',
      'The Rail Yard',
      'The Magnetizer',
      'The Pulsar',
      'The Overseer',
      'The Assembly Line',
      'The Unstable Core',
      'The Dual Room',
      'The Stalker',
      'The Swarm',
    ]);
    expect(list.hidden).toBe(true);
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    expect(list.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a picked boss switches the page to its fight: the boss block, the goal, Retry, no local controls', async () => {
    const game = await boot('?bot=off');
    fightBoss(game, 'The Echo', 42);
    expect(game.hook('__fight')).toEqual({ id: 'echo', seed: 42, mirror: false });
    expect(body().boss).toBe('echo');
    expect(byId('mode-menu').hidden).toBe(true); // picking a mode closes the menu
    expect(byId('modes').getAttribute('aria-expanded')).toBe('false');
    expect(byId('boss-list').hidden).toBe(true);
    expect(byId('boss-fight').getAttribute('aria-expanded')).toBe('false');
    expect(byId('boss-retry').hidden).toBe(false);
    expect(byId('new-game').hidden).toBe(true);
    expect(byId('hint').hidden).toBe(true); // fair play: no hint, no evaluation bar (#164)
    expect(byId('eval').hidden).toBe(true);
    expect(byId('setting-export-game').hidden).toBe(true);
    expect(byId('daily-card').hidden).toBe(true);
    const boss = byId('hud').querySelector('.boss')!;
    expect(byId('boss-bar').querySelector('.name')!.textContent).toBe('The Echo'); // #1038: the boss bar names the boss, the plate does not
    expect([...boss.querySelectorAll('.notch')].map((n) => n.textContent)).toEqual(['P1', 'P2']);
    expect(boss.querySelector('.notch.active')!.textContent).toBe('P1');
    // The goal card of #1524: two short steps and a picture, in place of the one long line.
    expect([...boss.querySelectorAll('.goal.goal-card ol.goal-steps li')].map((li) => li.textContent)).toEqual([...ECHO_STEPS]);
    expect(boss.querySelector('.goal.goal-card svg')).not.toBeNull();
    expect(boss.textContent).not.toContain('Goal: ');
    expect(boss.querySelector('.result')).toBeNull();
    expect(boss.querySelector('.tell')).toBeNull(); // The Echo draws no tell on the board
    expect(game.turn()).toBe('White to move'); // the player wears the glass, White
    // The goal is on the plate before the first move: the Goal control shows it open and cannot fold it.
    const goal = byId<HTMLButtonElement>('boss-goal');
    expect(goal.hidden).toBe(false);
    expect(goal.disabled).toBe(true);
    expect(goal.getAttribute('aria-expanded')).toBe('false'); // the sheet is shut: the HUD line holds the goal here (#1032)
    // The phase notches on the rim (#356): one groove per notch, the threshold glyph.
    const notches = game.hook<{ lit: number; dark: number; glyph: boolean }>('__notches');
    expect(notches.lit + notches.dark).toBeGreaterThan(0);
    expect(notches.glyph).toBe(true);
    expect(game.hook('__tally')).toEqual([{ marked: 0, slots: 6 }, { marked: 0, slots: 6 }]); // marbles lost
  });

  it('the boss bar at the top shows the name and a fragment per ejection the engine asks, none outside a fight (#788)', async () => {
    const game = await boot('?bot=off');
    expect(byId('boss-bar').hidden).toBe(true);
    fightBoss(game, 'The Echo');
    const bar = byId('boss-bar');
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('.name')!.textContent).toBe('The Echo');
    expect(bar.querySelectorAll('.frag')).toHaveLength(6);
    expect(bar.querySelectorAll('.frag.step')).toHaveLength(1); // P2 begins at a step
    expect(bar.querySelectorAll('.frag.empty')).toHaveLength(0);
    fightBoss(game, 'The Ballast Mind');
    expect(bar.querySelector('.name')!.textContent).toBe('The Ballast Mind');
    expect(bar.querySelectorAll('.frag')).toHaveLength(12);
  });

  it('the boss bar goes away when the fight is left for the Ship or a battle royale (#814)', async () => {
    const game = await boot('?bot=off');
    for (const mode of ['ship', 'battle-royale']) {
      fightBoss(game, 'The Echo');
      expect(byId('boss-bar').hidden).toBe(false);
      game.openModes();
      byId(mode).click();
      expect(byId('boss-bar').hidden).toBe(true);
    }
  });

  it('the boss replies to the player in the worker, at the test budget', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    await turn(game);
    expect(game.turn()).toBe('White to move');
    expect(byId('boss-bar').querySelector('.name')!.textContent).toBe('The Echo');
  });

  // #1032 owner rule: the goal is shown once. After the first move the HUD has no goal line; the Goal control opens the
  // goal in the sheet above the dock, and the HUD line stays off while the sheet is open.
  it('after the first move the Goal control opens the goal in its sheet, and the HUD never repeats it', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    play(game, forward(game));
    const goal = byId<HTMLButtonElement>('boss-goal');
    const hudShows = (): boolean => byId('hud').querySelector('.boss .goal') !== null;
    expect(goal.disabled).toBe(false);
    expect(goal.getAttribute('aria-expanded')).toBe('false');
    expect(byId('goal-sheet').hidden).toBe(true);
    expect(hudShows()).toBe(false);
    goal.click();
    expect(goal.getAttribute('aria-expanded')).toBe('true');
    expect(byId('goal-sheet').hidden).toBe(false);
    expect([...byId('goal-sheet').querySelectorAll('ol.goal-steps li')].map((li) => li.textContent)).toEqual([...ECHO_STEPS]); // the card, with its picture (#1524)
    expect(byId('goal-sheet').querySelector('svg')).not.toBeNull();
    expect(hudShows()).toBe(false); // the sheet holds the goal, the HUD does not repeat it
    goal.click();
    expect(goal.getAttribute('aria-expanded')).toBe('false');
    expect(byId('goal-sheet').hidden).toBe(true);
    // A new fight starts with the sheet closed.
    goal.click();
    fightBoss(game, 'The Hull');
    play(game, forward(game));
    expect(byId('goal-sheet').hidden).toBe(true);
    expect(hudShows()).toBe(false);
    goal.click(); // a boss with no card keeps the line of its goal, as text (#1524)
    expect(byId('goal-sheet').querySelector('.goal-steps')).toBeNull();
    expect(byId('goal-sheet').textContent).toMatch(/^One cell cracks/);
  });

  it('Retry restarts the same boss with the same seed', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Chaplain', 7);
    play(game, forward(game));
    expect(game.hook('__plies')).toBe(1);
    drawSeed(99); // Retry draws no new seed
    byId('boss-retry').click();
    expect(game.hook('__plies')).toBe(0);
    expect(game.hook('__fight')).toEqual({ id: 'chaplain', seed: 7, mirror: false });
    expect(byId('boss-bar').querySelector('.name')!.textContent).toBe('The Chaplain');
    expect(byId('boss-retry').hidden).toBe(false);
  });

  it('Retry while the boss thinks drops its reply to the old fight', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    play(game, forward(game));
    expect(game.hook('__plies')).toBe(1); // the boss is thinking
    byId('boss-retry').click();
    await game.settle();
    expect(game.hook('__plies')).toBe(0);
    expect(game.turn()).toBe('White to move');
    await turn(game); // the new fight goes on as usual
  });

  it('Retry while the boss turns of the e2e hook play stops them', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    const played = game.hook<Promise<number>>('__playTurns', 3, [4, 2]);
    while (game.hook<number>('__plies') === 0) await Promise.resolve(); // the first move is played, the boss thinks
    byId('boss-retry').click();
    expect(await played).toBe(0);
    expect(game.hook('__plies')).toBe(0);
  });

  it('a lost fight hides the Goal control and leaves the Defeat to the end banner', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    loseByRepetition(game);
    expect(body().over).toBe('loss');
    expect(game.hud()).toContain('Defeat');
    expect(byId('boss-goal').hidden).toBe(true);
    expect(byId('hud').querySelector('.boss .result')).toBeNull(); // one line less in the plate (#271)
    expect(byId('daily-card').hidden).toBe(true); // a boss fight that is not the daily has no result card
  });

  it('a won fight records the boss as beaten in the hub progress, a lost one does not (#520)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const beaten = (): unknown => JSON.parse(localStorage.getItem('ab-alone.progress') ?? '{}').beaten;
    fightBoss(game, 'The Echo');
    loseByRepetition(game);
    expect(beaten()).toBeUndefined();
    const { Encounter } = await import('edgefall-wasm');
    fightBoss(game, 'The Hull');
    vi.spyOn(Encounter.prototype, 'result').mockReturnValue(1); // a win, without playing six ejections
    play(game, forward(game));
    expect(beaten()).toEqual(['hull']);
  });

  describe('medals (#791)', () => {
    const medals = (): unknown => JSON.parse(localStorage.getItem('ab-alone.medals') ?? '{}');
    /** Wins a fight against The Hull in one player turn: the engine says Black won, without six ejections. */
    async function winHull(game: Game): Promise<void> {
      const { Encounter } = await import('edgefall-wasm');
      fightBoss(game, 'The Hull');
      const won = (): number => (game.hook<number>('__plies') > 0 ? 1 : 0); // won once the first move is played
      vi.spyOn(Encounter.prototype, 'result').mockImplementation(won);
      vi.spyOn(Encounter.prototype, 'status').mockImplementation(won);
      play(game, forward(game));
    }
    const menuEntry = (name: string): string =>
      [...byId('boss-list').querySelectorAll('button')].find((b) => b.textContent!.startsWith(name))!.textContent!;

    it('the first win earns the medal, the banner says so and the boss menu shows it', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      expect(menuEntry('The Hull')).toBe('The Hull');
      await winHull(game);
      expect(medals()).toEqual({ hull: 1 });
      expect(game.hud()).toContain('Medal earned: 1 turn.');
      byId('boss-goal').click(); // the HUD draws again: the fight earns its medal once, the line stays
      expect(game.hud()).toContain('Medal earned: 1 turn.');
      byId('boss-fight').click();
      expect(menuEntry('The Hull')).toBe('The Hull Medal: 1 turn');
      expect(menuEntry('The Echo')).toBe('The Echo'); // an unbeaten boss has no medal
    });

    it('a faster win is called out as a new record, a slower one keeps the best', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      localStorage.setItem('ab-alone.medals', JSON.stringify({ hull: 5 }));
      await winHull(game);
      expect(medals()).toEqual({ hull: 1 });
      expect(game.hud()).toContain('New record: 1 turn.');
    });

    it('a win that is not faster keeps the best count', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      localStorage.setItem('ab-alone.medals', JSON.stringify({ hull: 1 }));
      await winHull(game);
      expect(medals()).toEqual({ hull: 1 });
      expect(game.hud()).toContain('Medal best: 1 turn.');
    });

    it('a lost fight earns no medal', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      fightBoss(game, 'The Echo');
      loseByRepetition(game);
      expect(medals()).toEqual({});
      expect(game.hud()).not.toContain('Medal');
    });
  });

  describe('win and attempt counters (#1538)', () => {
    const tally = (): unknown => JSON.parse(localStorage.getItem('ab-alone.boss-tally') ?? '{}');

    it('an attempt counts when the first move is played, not when the fight is opened, and again after a Retry', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      fightBoss(game, 'The Hull');
      fightBoss(game, 'The Echo'); // the Hull was opened and left
      expect(tally()).toEqual({});
      play(game, forward(game));
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 1 } });
      play(game, forward(game)); // the second move of the same fight
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 1 } });
      byId('boss-retry').click();
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 1 } });
      play(game, forward(game));
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 2 } });
    });

    it('a win counts once, whatever the HUD redraws, and a lost fight adds an attempt only', async () => {
      const game = await boot('?bot=off', { reducedMotion: true });
      fightBoss(game, 'The Echo');
      loseByRepetition(game);
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 1 } });
      const { Encounter } = await import('edgefall-wasm');
      fightBoss(game, 'The Hull');
      const won = (): number => (game.hook<number>('__plies') > 0 ? 1 : 0);
      vi.spyOn(Encounter.prototype, 'result').mockImplementation(won);
      vi.spyOn(Encounter.prototype, 'status').mockImplementation(won);
      play(game, forward(game));
      byId('boss-goal').click(); // the HUD draws again
      expect(tally()).toEqual({ echo: { wins: 0, attempts: 1 }, hull: { wins: 1, attempts: 1 } });
    });

    it('keeps the counters of a player who played before the counters existed', async () => {
      const game = await boot('?bot=off', { reducedMotion: true, storage: { 'ab-alone.medals': JSON.stringify({ hull: 9 }) } });
      expect(tally()).toEqual({});
      fightBoss(game, 'The Hull');
      play(game, forward(game));
      expect(tally()).toEqual({ hull: { wins: 0, attempts: 1 } });
    });
  });

  describe('the tell by difficulty (#1538)', () => {
    const level = (difficulty: string): { 'ab-alone.difficulty': string } => ({ 'ab-alone.difficulty': difficulty });
    /** The Echo: the marble at (0, 2) is selected, then (0, 1) hovered when `over`. The bonus rings and the ghosts drawn. */
    async function echoTell(difficulty: string, over: boolean): Promise<{ bonus: number; ghosts: number }> {
      const game = await boot('?bot=off', { reducedMotion: true, storage: level(difficulty) });
      fightBoss(game, 'The Echo');
      game.click(0, 2);
      if (over) hover(game, [0, 1]);
      return { bonus: Number(body().echoBonus), ghosts: Number(body().ghosts) };
    }

    it('normal: the Echo shows its bonus on a hovered move only', async () => {
      expect(await echoTell('normal', false)).toEqual({ bonus: 0, ghosts: 0 });
      expect((await echoTell('normal', true)).bonus).toBe(1);
    });

    it('hard: the Echo shows no bonus on a hovered move, only the ghost of the move', async () => {
      expect(await echoTell('hard', true)).toEqual({ bonus: 0, ghosts: 1 });
    });

    it('easy: the Echo shows the bonus of every move of the selected marble, with nothing hovered', async () => {
      const { bonus } = await echoTell('easy', false);
      expect(bonus).toBeGreaterThan(1);
    });

    it('easy: a hovered move shows what a normal one shows', async () => {
      expect((await echoTell('easy', true)).ghosts).toBe((await echoTell('normal', true)).ghosts);
    });

    describe('The Chaplain', () => {
      async function chaplain(difficulty: string): Promise<{ game: Game; mv: Move; at: Axial }> {
        const game = await boot('?nodes=200', { reducedMotion: true, storage: level(difficulty) });
        fightBoss(game, 'The Chaplain', SEED);
        const exposing = (): Move | undefined =>
          game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && game.hook<Axial[]>('__preview', m).length > 0);
        const recorded = recordedGame();
        for (let k = 0; k < EXPLODED_AT && !exposing(); k += 2) game.hook('__playMoves', recorded.slice(k, k + 2));
        const mv = exposing()!;
        const [q, r] = mv.cells[0]!;
        const [dq, dr] = DIRS[mv.dir]!;
        game.click(q, r);
        return { game, mv, at: [q + dq, r + dr] };
      }

      it('normal: nothing is shown before a move is hovered', async () => {
        await chaplain('normal');
        expect(body().flips).toBe('0');
        expect(byId('hud').querySelector('.boss .tell')?.textContent ?? '').not.toContain('Flips this turn');
      });

      it('hard: a hovered move shows no flip', async () => {
        const { game, at } = await chaplain('hard');
        hover(game, at);
        expect(body().flips).toBe('0');
        expect(byId('hud').querySelector('.boss .tell')?.textContent ?? '').not.toContain('Flips this turn');
      });

      it('easy: the flips of every move of the selected marble are shown with nothing hovered, the HUD waits for a hover', async () => {
        const { game, mv, at } = await chaplain('easy');
        expect(Number(body().flips)).toBeGreaterThanOrEqual(game.hook<Axial[]>('__preview', mv).length);
        expect(Number(body().flips)).toBeGreaterThan(0);
        expect(byId('hud').querySelector('.boss .tell')?.textContent ?? '').not.toContain('Flips this turn');
        hover(game, at);
        expect(byId('hud').querySelector('.boss .tell')!.textContent).toContain('Flips this turn');
      });
    });
  });

  it('the flat HUD lists the boss phase and its tell as text', async () => {
    const game = await boot('?bot=off');
    byId('setting-flat-hud').click();
    fightBoss(game, 'The Echo');
    expect(game.hud()).toContain('Boss phase: 1 of 2');
    expect(game.hud()).toContain('Tell: none');
    fightBoss(game, 'The Choir');
    expect(game.hud()).toContain('Tell: Next army: Alto');
  });

  it('online, Boss fight and Daily challenge start nothing', async () => {
    slowKeys();
    const game = await boot('?bot=off#room=boss-test');
    await game.online(); // the invite link joins the room
    expect(game.room()).toBe('boss-test');
    byId('boss-fight').click();
    expect(byId('boss-list').hidden).toBe(true);
    byId('daily').click();
    expect(game.hook('__fight')).toBeNull();
    expect(body().boss).toBeUndefined();
  });
});

describe('main.ts daily challenge', () => {
  it('the button names the day and its boss; each start counts an attempt, Retry included', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    const daily = byId<HTMLButtonElement>('daily');
    expect(daily.disabled).toBe(false);
    expect(daily.textContent).toBe('Daily challenge 2027-03-30: The Echo');
    expect(daily.querySelector('span')!.textContent).toBe('The Echo'); // held upright it takes a line of its own (#575)
    expect(daily.title).toBe('Daily challenge 2027-03-30: The Echo'); // the whole name when a phone cuts the label (#1000)
    game.openModes();
    daily.click();
    expect(byId('mode-menu').hidden).toBe(true);
    expect(game.hook('__fight')).toMatchObject({ id: 'echo', daily: { day: '2027-03-30', attempt: 1 } });
    expect(byId('hud').querySelector('.boss .daily')!.textContent).toBe('Daily challenge 2027-03-30 · attempt 1');
    expect(localStorage.getItem('ab-alone.daily')).toBe('2027-03-30 1');
    const seed = game.hook<{ seed: number }>('__fight').seed;
    play(game, forward(game));
    byId('boss-retry').click();
    expect(game.hook('__plies')).toBe(0);
    expect(game.hook('__fight')).toEqual({ id: 'echo', seed, daily: { day: '2027-03-30', attempt: 2 }, mirror: false });
    expect(byId('hud').querySelector('.boss .daily')!.textContent).toBe('Daily challenge 2027-03-30 · attempt 2');
  });

  // Bug #715: each boss of the list, on a day it is the daily boss, is named on the button (the e2e layout check takes
  // the widest name only).
  it('names every boss of the list on a day it is the daily boss', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off');
    const names = [...byId('boss-list').querySelectorAll('button')].map((b) => b.textContent!); // in the order of boss_ids()
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      let ms = DAY;
      while (dailyFor(utcDay(ms), names).id !== name) ms += 86_400_000;
      now.mockReturnValue(ms);
      byId('daily').click(); // the start reads the day again, as the minute timer does
      expect(byId('daily').textContent).toBe(dailyTitle(utcDay(ms), name));
      expect(document.getElementById('boss-bar')!.textContent).toContain(name); // #1038: the boss bar names the boss
    }
  });

  it('the daily result card closes with Esc or a tap outside, gives the focus back, and stays closed until its text changes (#1032)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    byId('reset-view').focus(); // the focus the card returns to
    loseByRepetition(game);
    const card = byId('daily-card');
    expect(card.hidden).toBe(false);
    game.hud(); // a HUD refresh keeps an open card open
    expect(card.hidden).toBe(false);
    byId('daily-result').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // a tap in the card keeps it
    expect(card.hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // a tap outside closes it
    expect(card.hidden).toBe(true);
    expect(document.activeElement).toBe(byId('reset-view'));
    game.hud(); // closed, it stays closed while its text is the same
    expect(card.hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // closed already: nothing happens
    expect(card.hidden).toBe(true);
  });

  it('records the day the daily was started and its result in player turns, for the notice board (#1528)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    expect(JSON.parse(localStorage.getItem('ab-alone.daily-days')!)).toEqual({ '2027-03-30': 'started' });
    loseByRepetition(game); // 7 plies: 4 player turns
    expect(JSON.parse(localStorage.getItem('ab-alone.daily-days')!)).toEqual({ '2027-03-30': 'lost 4' });
    game.hud(); // a HUD refresh writes it again as it was
    expect(JSON.parse(localStorage.getItem('ab-alone.daily-days')!)).toEqual({ '2027-03-30': 'lost 4' });
  });

  it('a press on the window (no node) closes the daily result card, and throws nothing (CI, #1032)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    loseByRepetition(game);
    expect(byId('daily-card').hidden).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(byId('daily-card').hidden).toBe(true);
  });

  it('Esc closes the daily result card', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    loseByRepetition(game);
    expect(byId('daily-card').hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(byId('daily-card').hidden).toBe(true);
  });

  it('Retry after 00:00 UTC starts the new day’s fight, its first attempt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off');
    byId('daily').click();
    const first = game.hook<{ id: string; seed: number }>('__fight');
    vi.spyOn(Date, 'now').mockReturnValue(NEXT_DAY);
    byId('boss-retry').click();
    const next = game.hook<{ seed: number; daily: unknown }>('__fight');
    expect(next.daily).toEqual({ day: '2027-03-31', attempt: 1 });
    expect(next.seed).not.toBe(first.seed);
    expect(byId('daily').textContent).toMatch(/^Daily challenge 2027-03-31: The /);
    expect(localStorage.getItem('ab-alone.daily')).toBe('2027-03-31 1');
  });

  it('the result copied note stays when the last bonus slide ends after Copy (#1295)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off');
    byId('daily').click();
    for (const [i, [q, r, tq, tr]] of ECHO_DRAW.entries()) {
      game.click(q, r);
      game.click(tq, tr);
      if (i < ECHO_DRAW.length - 1) for (let k = 0; k < 4; k++) game.frame(SLIDE_MS); // the last move keeps its slides running
    }
    expect(body().sliding).toBe('1');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      byId('daily-copy').click();
      await game.settle();
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    expect(game.hud()).toContain(' · result copied');
    for (let i = 0; i < 4; i++) game.frame(SLIDE_MS); // the slides end and redraw the HUD
    expect(body().sliding).toBeUndefined();
    expect(game.hud()).toContain(' · result copied');
    byId('boss-retry').click();
    expect(game.hud()).not.toContain(' · result copied'); // a new attempt has nothing copied
  });

  it('a finished daily shows its result card, and Copy puts the text on the clipboard', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    const card = byId('daily-card');
    const text = byId<HTMLTextAreaElement>('daily-result');
    expect(card.hidden).toBe(true); // the fight is on
    expect(text.value).toBe('');
    loseByRepetition(game);
    expect(card.hidden).toBe(false);
    expect(text.value).toBe(
      'Edgefall daily 2027-03-30: The Echo\nDefeat in 7 plies on attempt 1\nhttps://tidymaze.github.io/edgefall/',
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      byId('daily-copy').click();
      await game.settle();
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    expect(writeText).toHaveBeenCalledWith(text.value);
    expect(game.hud()).toContain(' · result copied');
    const copy = byId('daily-copy');
    expect([copy.textContent, copy.classList.contains('copied')]).toEqual(['Copied', true]); // the check draws in (#1098)
    // Retry hides the card again: the new attempt is on.
    byId('boss-retry').click();
    expect(card.hidden).toBe(true);
    expect(text.value).toBe('');
    expect([copy.textContent, copy.classList.contains('copied')]).toEqual(['Copy result', false]);
  });

  it('when the browser refuses the clipboard, the result is selected to copy by hand, and stays selected', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    const game = await boot('?bot=off', { reducedMotion: true });
    byId('daily').click();
    loseByRepetition(game);
    const text = byId<HTMLTextAreaElement>('daily-result');
    byId('daily-copy').click(); // jsdom has no clipboard: the copy fails
    await game.settle();
    expect(game.hud()).toContain(' · result selected: copy it by hand');
    expect(byId('daily-copy').textContent).toBe('Copy result'); // nothing was copied
    expect(document.activeElement).toBe(text);
    expect([text.selectionStart, text.selectionEnd]).toEqual([0, text.value.length]); // the HUD update kept it
  });
});

describe('main.ts boss tells', () => {
  it('The Hull: a cracked cell wears the decal and its line, ticks down, then is a hole in the frame', async () => {
    const game = await boot('?nodes=200&scene=room', { reducedMotion: true, audio: true });
    gesture();
    fightBoss(game, 'The Hull');
    expect(body().cracks).toBe('0');
    expect(game.hook('__crackDecals')).toEqual([]);
    for (let n = 0; n < 4; n++) await turn(game); // the first rim cell cracks at ply 8
    expect(body().cracks).toBe('1');
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Cracks: 1 cell in 2 turns');
    const cracks = game.hook<{ cell: Axial }[]>('__cracks');
    expect(game.hook('__crackDecals')).toEqual(cracks.map((c) => c.cell));
    expect(cues(game)).toEqual(['crack']); // the crack appears
    expect(game.hook('__crackDecalShown', false)).toBe(false); // the crack decal stays hidden
    expect(game.hook('__crackDecalShown', true)).toBe(true);
    await turn(game);
    expect(cues(game)).toEqual(['crack', 'crack']); // it ticked down on ply 9
    expect(body().cracks).toBe('1');
    await turn(game); // it vanishes at the end of the second player turn: no cue for a gone tell
    expect(cues(game)).toEqual(['crack', 'crack']);
    expect(body().cracks).toBe('0');
    expect(body().vanished).toBe('1');
    expect(game.hook('__crackDecals')).toEqual([]);
    expect(game.hook('__frame')).toMatchObject({ radius: 4, holes: 1, drawn: true });
    expect(byId('hud').querySelector('.boss .tell')).toBeNull();
  }, 60_000);

  it('The Chaplain: a hovered move shows the marbles it flips, with one cue per new tell', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true, audio: true, storage: { 'ab-alone.difficulty': 'normal' } });
    gesture();
    fightBoss(game, 'The Chaplain', SEED);
    const exposing = (): Move | undefined =>
      game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && game.hook<Axial[]>('__preview', m).length > 0);
    const recorded = recordedGame();
    for (let k = 0; k < EXPLODED_AT && !exposing(); k += 2) game.hook('__playMoves', recorded.slice(k, k + 2)); // the recorded game
    const mv = exposing()!;
    const [q, r] = mv.cells[0]!;
    const [dq, dr] = DIRS[mv.dir]!;
    game.click(q, r); // the marble is selected
    hover(game, [q + dq, r + dr]); // the move is hovered: its ghost and the flip preview
    const flips = game.hook<Axial[]>('__preview', mv).length;
    expect(body().flips).toBe(String(flips));
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toContain('Flips this turn');
    expect(cues(game).filter((c) => c === 'flip')).toHaveLength(1);
    hover(game, [q + dq, r + dr]); // the same cell again: nothing changes
    expect(cues(game).filter((c) => c === 'flip')).toHaveLength(1);
    hover(game, null); // off the board: no ghost, no preview
    expect(body().flips).toBe('0');
    expect(body().ghosts).toBe('0');
  }, 60_000);

  it('The Chaplain: a converted marble is drawn and the HUD counts it', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightBoss(game, 'The Chaplain', SEED);
    expect(game.hook<number>('__playMoves', recordedGame().slice(0, CONVERTED_AT - 1))).toBe(CONVERTED_AT - 1);
    expect(body().converted).toBe('0');
    game.hook('__playMoves', recordedGame().slice(CONVERTED_AT - 1, CONVERTED_AT)); // the boss turn that converts one
    const converted = game.hook<Axial[]>('__converted');
    expect(converted).toHaveLength(1);
    expect(body().converted).toBe('1');
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toContain('Converted: 1');
  }, 60_000);

  it('The Choir: a glyph per army, the next army ringed and named', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true, audio: true });
    gesture();
    fightBoss(game, 'The Choir');
    expect(game.hud()).toContain('White ejected 0/6 · Black ejected 0/6');
    expect(byId('hud').querySelectorAll('.boss .notch')).toHaveLength(3);
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Next army: Alto');
    expect(body().vanished).toBe('0'); // the standard board
    expect(body().armies).toBe('18');
    expect(body().nextArmy).toBe('Alto');
    expect(game.hook('__frame')).toMatchObject({ radius: 4 });
    expect(cues(game)).toEqual(['choir']);
    type Member = { cell: Axial; army: number };
    const cellsOf = (army: number): string[] =>
      game
        .hook<Member[]>('__armies')
        .filter((m) => m.army === army)
        .map((m) => m.cell.join())
        .sort();
    const before = [0, 1, 2].map(cellsOf);
    await turn(game);
    expect(cellsOf(0)).not.toEqual(before[0]); // Alto, the army in turn, moved
    expect(cellsOf(1)).toEqual(before[1]);
    expect(cellsOf(2)).toEqual(before[2]);
    expect(body().nextArmy).toBe('Tenor');
    expect(byId('hud').querySelector('.boss .tell')!.textContent).toBe('Next army: Tenor');
    expect(cues(game)).toEqual(['choir', 'choir']); // once more for Tenor, not for the human move
  }, 60_000);

  it.each([
    ['', 18],
    ['&look=terrace', 0],
  ])('The Choir glyphs under the neon look are near black over a Bone outline 1.7 times larger (#1424), boot %s: %i', async (look, count) => {
    let scene: THREE.Scene | null = null;
    const add = THREE.Object3D.prototype.add;
    const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if (this instanceof THREE.Scene && !scene) scene = this;
      return add.apply(this, objects);
    });
    onTestFinished(() => spy.mockRestore());
    const game = await boot(`?bot=off${look}`, { reducedMotion: true });
    gesture();
    fightBoss(game, 'The Choir');
    game.frame(100);
    const meshes: THREE.Mesh[] = [];
    scene!.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    const ink = meshes.filter((m) => (m.material as THREE.MeshBasicMaterial).color?.getHex() === 0x15191c && m.geometry.type !== 'ShapeGeometry');
    const army = ink.filter((m) => ['ConeGeometry', 'TorusGeometry', 'BoxGeometry'].includes(m.geometry.type));
    expect(army).toHaveLength(count);
    if (count) {
      const halos = meshes.filter((m) => army[0]!.geometry.type === m.geometry.type && (m.material as THREE.MeshBasicMaterial).color.getHex() !== 0x15191c && m.position.y === 0.76);
      expect(halos.length).toBeGreaterThan(0);
      const [a, h] = [army[0]!.geometry, halos[0]!.geometry].map((g) => (g.computeBoundingBox(), g.boundingBox!.max.y));
      expect(h! / a!).toBeGreaterThan(1.69);
    }
  });

  it('The Choir sinks the army it removed after the push, a marble at a time (#747)', async () => {
    const game = await boot('?bot=off');
    const { Encounter } = await import('edgefall-wasm');
    fightBoss(game, 'The Choir');
    const single = (): Move => game.hook<Move[]>('__legal').find((m) => m.cells.length === 1)!;
    play(game, single()); // the player's move removes no army
    game.frame(1000);
    expect(body().sunk).toBeUndefined();
    vi.spyOn(Encounter.prototype, 'removed').mockReturnValue(Int32Array.from([-4, 1, 2, -4, 2, 2]));
    play(game, single()); // the move that, say, ejected the third marble: the weakest army is removed
    expect(body().sunk).toBeUndefined(); // the slide goes first
    game.frame(1000);
    expect(body().sunk).toBe('2');
  });

  it('the boss hooks of the browser checks read nothing outside a fight', async () => {
    const game = await boot('?bot=off');
    expect(game.hook('__preview', game.hook<Move[]>('__legal')[0])).toEqual([]);
    expect(game.hook('__armies')).toEqual([]);
    expect(game.hook('__cracks')).toEqual([]);
    expect(game.hook('__converted')).toEqual([]);
    expect(game.hook('__fight')).toBeNull();
  });

  it('a hovered move in a fight also draws the boss reply it announces', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const ghostsOf = (name: string): number => {
      fightBoss(game, name);
      const mv = forward(game);
      const [q, r] = mv.cells[0]!;
      const [dq, dr] = DIRS[mv.dir]!;
      game.click(q, r);
      hover(game, [q + dq, r + dr]);
      return Number(body().ghosts);
    };
    const echo = ghostsOf('The Echo');
    const hull = ghostsOf('The Hull');
    expect(hull).toBeGreaterThan(0);
    expect(echo).toBeGreaterThan(hull); // The Echo announces its mirror reply
  });

  it('The Echo rings the bonus a hovered move gives it, and crosses a free move that would not be offered (#859)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { 'ab-alone.difficulty': 'normal' } });
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    hover(game, [0, 1]);
    expect([body().echoBonus, body().echoSkipped]).toEqual(['1', '0']); // the mirror (0,-2) to (0,-1), a ringed ghost
    hover(game, null);
    expect([body().echoBonus, body().echoSkipped]).toEqual(['0', '0']);
    // Black up and its bonus, White back, Black takes the free move back, Black up again and its bonus: the free move
    // White's step back would offer brings the start position a third time, a draw that loses the player: not offered.
    game.click(0, 1); // (0, 2) is still selected
    for (const [q, r, tq, tr] of [[0, -1, 0, -2], [0, 1, 0, 2], [0, 2, 0, 1]] as const) {
      game.click(q, r);
      game.click(tq, tr);
    }
    expect(game.hook('__plies')).toBe(4);
    game.click(0, -1);
    hover(game, [0, -2]);
    expect([body().echoBonus, body().echoSkipped]).toEqual(['0', '1']);
  });

  it('The Echo marks where its bonus plies landed until the next move (#859)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    expect(body().echoLanded).toBe('0');
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    game.click(0, 1);
    expect(body().echoLanded).toBe('1'); // the Echo's bonus, (0,-2) to (0,-1)
    game.click(0, -1);
    game.click(1, -1);
    expect(body().echoLanded).toBe('0'); // the player's bonus is offered, not played (#958)
    fightBoss(game, 'The Hull');
    play(game, forward(game));
    expect(body().echoLanded).toBe('0');
  });

  it('The Echo offers the player its free move: ringed marbles, a diamond on the selected target, the HUD line (#958)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    expect(body().echoFree).toBe('0');
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    game.click(0, 1);
    game.click(0, -1);
    game.click(1, -1); // the Echo steps east: the player may take (0,1) to (-1,1) for free
    expect([body().echoFree, body().echoFreeTarget]).toEqual(['1', '0']);
    const tell = (): string => byId('hud').querySelector('.boss .tell')?.textContent ?? '';
    expect(tell()).toBe('Free move: a ringed marble moves for free, any other move declines it');
    const player = game.turn();
    game.click(0, 1);
    expect(body().echoFreeTarget).toBe('1');
    expect(tell()).toBe('Free move: the diamond target is free, then you move again');
    const diamonds = game.hook<{ children: { name: string }[] }>('__marbles').children.filter((o) => o.name === 'echo-free-target');
    expect(diamonds).toHaveLength(1);
    game.click(-1, 1); // taken: Black moves again, nothing is offered any more
    expect(game.hook('__plies')).toBe(3);
    expect(game.turn()).toBe(player);
    expect([body().echoFree, body().echoFreeTarget]).toEqual(['0', '0']);
    expect(tell()).toBe('Echo rule: when one of your marbles is ringed, it moves for free; any other move declines it'); // the rule stays on the plate (#1674)
  });

  it('the Echo rule line is gone once the fight is over: the result plate has no room for it (#1686)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const { Encounter } = await import('edgefall-wasm');
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    game.click(0, 1);
    game.click(0, -1);
    game.click(1, -1);
    game.click(0, 1);
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(() => 1); // over after the free move is taken
    game.click(-1, 1);
    const tell = (): string => byId('hud').querySelector('.boss .tell')?.textContent ?? '';
    expect(tell()).not.toContain('Echo rule');
  });

  it('a normal move declines the free move: the boss replies to it (#958)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    const player = game.turn();
    for (const [q, r, tq, tr] of [[0, 2, 0, 1], [0, -1, 1, -1], [0, 3, 0, 2]] as const) {
      game.click(q, r);
      game.click(tq, tr);
    }
    expect(game.hook('__plies')).toBe(3);
    expect(game.turn()).not.toBe(player);
    expect(body().echoFree).toBe('0');
  });

  it("every bonus slides: the Echo's after the player's move, one slide after the other (#958)", async () => {
    const game = await boot('?bot=off');
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    game.click(0, 1);
    expect(body().sliding).toBe('1');
    expect(body().bonusSlides).toBeUndefined(); // the move slides first, on the board before its bonus
    game.frame(SLIDE_MS);
    expect([body().sliding, body().bonusSlides]).toEqual(['1', '1']);
    expect(body().echoLanded).toBe('0'); // the ring waits for the slide
    game.frame(SLIDE_MS);
    expect(body().sliding).toBeUndefined();
    expect(body().echoLanded).toBe('1');
  });

  it('reduced motion: no bonus slides, the board shows at once (#958)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Echo');
    game.click(0, 2);
    game.click(0, 1);
    expect([body().sliding, body().bonusSlides]).toEqual([undefined, undefined]);
    expect(body().echoLanded).toBe('1');
  });

  it('two bonus plies of P2 slide one after the other, on the board each leaves (#958)', async () => {
    const game = await boot('?bot=off');
    fightBoss(game, 'The Echo', 0); // the seed of the recorded win of the core tests
    // Its 75th ply, a player move in P2, gives the Echo its mirror and an older move.
    expect(game.hook<number>('__playMoves', parseRecorded(echoWin).slice(0, 75))).toBe(75);
    game.frame(SLIDE_MS);
    expect(body().bonusSlides).toBe('1');
    game.frame(SLIDE_MS);
    expect(body().bonusSlides).toBe('2');
    game.frame(SLIDE_MS);
    expect(body().sliding).toBeUndefined();
    expect(body().echoLanded).not.toBe('0');
  });

  it('The Ballast Mind announces echo only from phase 3 (#574)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Ballast Mind');
    const mv = forward(game);
    const [q, r] = mv.cells[0]!;
    const [dq, dr] = DIRS[mv.dir]!;
    game.click(q, r);
    hover(game, [q + dq, r + dr]);
    expect(Number(body().ghosts)).toBe(1);

    const { Encounter } = await import('edgefall-wasm');
    const echoRecord = new Int32Array([1, 5, 2, -3, 0, 0, 0, 0]);
    vi.spyOn(Encounter.prototype, 'tell_move').mockReturnValue(echoRecord);
    hover(game, null);
    hover(game, [q + dq, r + dr]);
    expect(Number(body().ghosts)).toBeGreaterThan(1);
  });

  it('The Ballast Mind fight sets view for radius 5 and reset-view restores it (#573)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightBoss(game, 'The Ballast Mind');
    const v = game.hook<{ distance: number }>('__view');
    expect(v.distance).toBeCloseTo((5 / 4) * Math.hypot(11, 8));
    byId('reset-view').click();
    const vReset = game.hook<{ distance: number }>('__view');
    expect(vReset.distance).toBeCloseTo((5 / 4) * Math.hypot(11, 8));
  });
});

// The boss menu follows the Hub's lifts (#1527): a boss the Hub would not let the player reach is locked, with its reason. A player's browser
// (no automation) or `?locks` has the lock; the automated pages of the other specs, and the links, keep the menu open.
describe('the boss menu locks the bosses the Hub would not reach (#1527)', () => {
  const entries = (): HTMLButtonElement[] => [...byId('boss-list').querySelectorAll('button')];
  const entry = (name: string): HTMLButtonElement => entries().find((b) => b.textContent!.startsWith(name))!;
  const open = (game: Game): void => {
    game.openModes();
    byId('boss-fight').click();
  };
  const progress = (...beaten: string[]) => ({ 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten }) });

  it('shows the bosses above the progress locked with the boss to beat, and starts none of them', async () => {
    const game = await boot('?bot=off&unlock', { webdriver: false });
    open(game);
    expect(entry('The Echo').getAttribute('aria-disabled')).toBeNull();
    expect(entry('The Dual Room').getAttribute('aria-disabled')).toBeNull();
    expect(entries().filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(13);
    const choir = entry('The Choir');
    expect(choir.getAttribute('aria-disabled')).toBe('true');
    expect(choir.dataset.locked).toBe('Beat The Hull first');
    expect(choir.querySelector('.lock')!.textContent).toBe('Beat The Hull first');
    expect(entry('The Hull').querySelector('.lock')!.textContent).toBe('Beat The Echo first');
    drawSeed(1);
    choir.click();
    entry('The Ballast Mind').click();
    expect(body().boss).toBeUndefined(); // no fight started
    expect(byId('boss-list').hidden).toBe(false); // the menu stays open
    entry('The Echo').click();
    expect(body().boss).toBe('echo');
  });

  it('opens a deck as its lift opens, and keeps open the bosses already beaten of an older save', async () => {
    const game = await boot('?bot=off', { webdriver: false, storage: progress('echo', 'pulsar') });
    open(game);
    for (const name of ['The Hull', 'The Alien', 'The Swarm']) expect(entry(name).getAttribute('aria-disabled'), name).toBeNull();
    expect(entry('The Choir').getAttribute('aria-disabled')).toBe('true');
    expect(entry('The Pulsar').getAttribute('aria-disabled')).toBeNull(); // beaten, whatever its deck
    expect(entry('The Pulsar').querySelector('.lock')).toBeNull();
    drawSeed(1);
    entry('The Hull').click();
    expect(body().boss).toBe('hull');
  });

  it('reads the progress each time the menu opens, and drops a lock that no longer holds', async () => {
    const game = await boot('?bot=off&unlock', { webdriver: false });
    open(game);
    expect(entry('The Hull').getAttribute('aria-disabled')).toBe('true');
    byId('boss-fight').click(); // closed
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten: ['echo'] }));
    byId('boss-fight').click();
    expect(entry('The Hull').getAttribute('aria-disabled')).toBeNull();
    expect(entry('The Hull').dataset.locked).toBeUndefined();
    expect(entry('The Hull').querySelector('.lock')).toBeNull();
  });

  it('is open on an automated page, and locked there with ?locks', async () => {
    const open_ = await boot('?bot=off');
    open(open_);
    expect(entries().filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(0);
    const locked = await boot('?bot=off&locks');
    open(locked);
    expect(entries().filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(13);
  });
});
