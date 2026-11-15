// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { TAUNTS, VENT_NOTE, toxinText } from './overseer';
import { BLAST_MS, FLASH_MS } from './martyr';
import { CHAR_MS, FAREWELL, angryLine } from './speech';
import { boot, type Game, startBoss } from './test/harness';

// The Overseer on the harness (#635, game-design.md section 7.11): the Overseer, its 6 cores and 6 vents drawn, the
// slag fill line, a core pushed next to a vent that slides there then rolls into it and sinks (#1241), and the win.
// ?bot=off plays both sides from the fixture of the core tests (crates/edgefall-core/src/encounter/overseer.rs): the
// player pushes the core (1, 1) next to (3, 1) at ply 5, which pulls it in, then (-2, 1) next to (-4, 1); the boss walks
// 3 marbles onto (4, -1), where they burn, then pushes the core (2, -1) next to it itself at ply 22: the player's 6th
// ejection. Each ply: the cells to click, the moved marbles then the target.

type Drawn = { overseer: Axial | null; cores: Axial[]; vents: Axial[] };
const FIXTURE: Axial[][] = [
  [[0, 2], [0, 1]], [[4, -3], [4, -2]], [[-1, 2], [-1, 1]], [[4, -2], [4, -1]],
  [[-1, 1], [0, 1], [1, 1]], [[4, -4], [4, -3]], [[0, 1], [1, 1], [2, 1]], [[4, -3], [4, -2]],
  [[-2, 2], [-1, 1]], [[4, -2], [4, -1]], [[-1, 3], [0, 2]], [[3, -3], [3, -2]],
  [[0, 2], [0, 1]], [[3, -2], [4, -2]], [[-1, 1], [0, 1], [-2, 1]], [[4, -2], [4, -1]],
  [[-2, 1], [-1, 1], [-3, 1]], [[0, -2], [0, -1]], [[-4, 3], [-3, 2]], [[1, -2], [1, -1]],
  [[-3, 2], [-2, 2]], [[0, -1], [1, -1], [2, -1]],
];
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const drawn = (game: Game): Drawn => game.hook<Drawn>('__overseer');

/** Starts the fight against The Overseer from the mode menu. */
function fightOverseer(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(153);
    return a;
  });
  startBoss('The Overseer');
}

/** Plays plies `from` to `to` (excluded) of the fixture by clicks, the slides and the burns run to their end. */
function plies(game: Game, from: number, to: number): void {
  for (const cells of FIXTURE.slice(from, to)) {
    for (const [q, r] of cells) game.click(q, r);
    for (let n = 0; n < 4; n++) game.frame(1000);
  }
}

// The speech bubble, the angry bubble and the haze of the vents (#741, docs/specs/ui.md).
const bubble = (): HTMLElement => byId('bubble');
const bubbleText = (): string => byId('bubble-text').textContent!;
const cues = (game: Game): string[] => game.hook<string[]>('__tellCues');
const gesture = (): boolean => dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));

describe('main.ts The Overseer speaks (#741)', () => {
  it('types the taunt in a bubble above its marble with a blip per new character, holds it 3 s, then fades it', async () => {
    const game = await boot('?bot=off', { audio: true });
    gesture();
    expect(bubble().hidden).toBe(true); // no fight
    fightOverseer(game);
    game.frame(0);
    expect(bubble().hidden).toBe(false);
    expect(bubble().classList.contains('angry')).toBe(false);
    expect(bubbleText()).toBe(TAUNTS[0]![0]);
    expect(bubble().classList.contains('glitch')).toBe(true); // the flicker of a new character
    expect(parseFloat(bubble().style.left)).toBeGreaterThan(0); // over the Overseer's marble, on the window
    expect(parseFloat(bubble().style.top)).toBeGreaterThan(0);
    game.frame(500);
    expect(bubbleText()).toBe(TAUNTS[0]!.slice(0, 9));
    expect(cues(game).filter((c) => c === 'blip')).toHaveLength(2); // one per frame that typed
    game.frame(2000); // 35 characters take 2.1 s
    expect(bubbleText()).toBe(TAUNTS[0]);
    expect(bubble().style.opacity).toBe('1');
    expect(TAUNTS[0]!.length * CHAR_MS).toBeLessThan(2500);
    game.frame(2700); // the 3 s hold is over, the fade runs
    expect(Number(bubble().style.opacity)).toBeLessThan(1);
    game.frame(1000);
    expect(bubble().hidden).toBe(true);
    game.frame(1000); // nothing left to draw
    expect(bubble().hidden).toBe(true);
  });

  it('says the next taunt at each 20 % of the slag fill, and a new fight starts its bubble again', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightOverseer(game);
    expect(bubbleText()).toBe('');
    game.frame(0);
    expect(bubbleText()).toBe(TAUNTS[0]); // reduced motion: the whole text at once
    expect(bubble().classList.contains('glitch')).toBe(false);
    plies(game, 0, 2);
    expect(bubble().hidden).toBe(true); // same taunt, not said again
    plies(game, 2, 16); // 8 turns: 20 %
    expect(bubbleText()).toBe(TAUNTS[1]);
    byId('boss-retry').click();
    game.frame(0);
    expect(bubbleText()).toBe(TAUNTS[0]);
  });

  it('a core burnt on a vent makes it angry, red and shaking, with the line of the seed and the ply, held 1 s; P2 starts the haze and the vents note', async () => {
    const game = await boot('?bot=off');
    fightOverseer(game);
    plies(game, 0, 4);
    expect(body().haze).toBe('0'); // P1: the vents burn the boss's marbles only
    expect(tell()).not.toContain(VENT_NOTE);
    for (const [q, r] of FIXTURE[4]!) game.click(q, r);
    game.frame(1000); // the slide ends: the core sinks into its vent
    expect(body().burns).toBe('1');
    expect(bubble().classList.contains('angry')).toBe(true);
    expect(bubble().classList.contains('still')).toBe(false); // it shakes
    const line = angryLine(153, 5);
    game.frame(line.length * CHAR_MS + 10);
    expect(bubbleText()).toBe(line);
    game.frame(900);
    expect(Number(bubble().style.opacity)).toBe(1); // 1 s hold after the last character
    game.frame(200);
    expect(Number(bubble().style.opacity)).toBeLessThan(1);
    game.frame(1000);
    expect(bubble().hidden).toBe(true);
    expect(tell()).toContain(VENT_NOTE); // P2: the vents burn yours too
    expect(tell()).toContain('Slag fill');
    expect(body().haze).toBe('18'); // 3 puffs over each of the 6 vents
    game.frame(0);
    const before = body().hazeY;
    game.frame(700);
    expect(body().hazeY).not.toBe(before); // the haze rises
    plies(game, 5, 7);
    expect(tell()).not.toContain(VENT_NOTE); // the note lasts 2 plies
    expect(body().haze).toBe('18');
  });

  it('under reduced motion the angry bubble holds still and shows its whole line, and the haze holds still', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightOverseer(game);
    plies(game, 0, 5);
    expect(bubble().classList.contains('angry')).toBe(true);
    expect(bubble().classList.contains('still')).toBe(true);
    expect(bubbleText()).toBe(angryLine(153, 5));
    expect(body().haze).toBe('18');
    const before = body().hazeY;
    game.frame(700);
    expect(body().hazeY).toBe(before);
  });
});

describe('main.ts The Overseer (#635)', () => {
  it('plays in the Chapel with its Tally line, draws the Overseer, its cores and vents, and the slag fill', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightOverseer(game);
    expect(body().boss).toBe('overseer');
    expect(body().deck).toBe('chapel');
    expect(game.hud()).toContain('Cores on file. Watch closes at six burnt.');
    expect(tell()).toBe(toxinText(40));
    const start = drawn(game);
    expect(start.overseer).toEqual([0, 0]);
    expect(start.cores).toHaveLength(6);
    expect(start.cores).toContainEqual([1, 1]);
    expect(start.vents).toHaveLength(6);
    expect(start.vents).toContainEqual([3, 1]);
    plies(game, 0, 2);
    expect(tell()).toBe(toxinText(39));
  });

  it('a core pushed next to a vent slides there, then the vent pulls it in: an ejection for the player (#1241)', async () => {
    const game = await boot('?bot=off');
    fightOverseer(game);
    plies(game, 0, 4);
    expect(game.hud()).toContain('1/6'); // the boss marble that walked onto (4, -1) burnt
    for (const [q, r] of FIXTURE[4]!) game.click(q, r);
    expect(body().sliding).toBe('1');
    expect(body().burns).toBeUndefined(); // the push slides first
    expect(drawn(game).cores).not.toContainEqual([1, 1]);
    game.frame(1000); // the slide ends: the core rolls into its vent and sinks
    expect(body().burns).toBe('1');
    expect(body().ejecting).toBe('tumble');
    expect(drawn(game).cores).toHaveLength(5);
    expect(game.hud()).toContain('2/6');
    plies(game, 5, 6);
    expect(body().burns).toBeUndefined(); // a ply that burns nothing
  });

  it('reduced motion fades the burns, and the boss pushing the 6th core in wins the fight for the player', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightOverseer(game);
    plies(game, 0, 21);
    for (const [q, r] of FIXTURE[21]!) game.click(q, r); // the boss pushes the core (2, -1) next to (4, -1)
    expect(body().burns).toBe('1');
    expect(body().ejecting).toBe('fade');
    expect(game.hud()).toContain('Victory');
    expect(drawn(game).cores).toHaveLength(3);
  });

  it('on victory the central marble explodes, then the bubble types the farewell, with no angry line (#789)', async () => {
    const game = await boot('?bot=off');
    fightOverseer(game);
    plies(game, 0, 21);
    expect(drawn(game).overseer).toEqual([0, 0]);
    for (const [q, r] of FIXTURE[21]!) game.click(q, r);
    expect(body().explosions).toBeUndefined(); // the push slides first
    game.frame(1000); // the slide ends: the 6th core burns and the Overseer blows
    expect(body().burns).toBe('1');
    expect(game.hud()).toContain('Victory');
    expect(body().explosions).toBe('1');
    expect(body().exploding).toBe('1');
    expect(drawn(game).overseer).toBeNull(); // the pedestal is gone
    expect(bubble().hidden).toBe(true); // the angry line due on this ply is dropped: nothing is said while it blows
    game.frame(BLAST_MS);
    expect(body().exploding).toBeUndefined();
    game.frame(0);
    expect(bubbleText()).toBe('W'); // then it types
    expect(bubble().classList.contains('angry')).toBe(false);
    game.frame(FAREWELL.length * CHAR_MS + 10);
    expect(bubbleText()).toBe(FAREWELL);
    expect(bubble().hidden).toBe(false);
    game.frame(3000);
    expect(Number(bubble().style.opacity)).toBeLessThan(1); // the 3 s hold, then it fades
    game.frame(1000);
    expect(bubble().hidden).toBe(true);
  });

  it('under reduced motion the farewell shows whole once the static flash is over', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightOverseer(game);
    plies(game, 0, 21);
    for (const [q, r] of FIXTURE[21]!) game.click(q, r);
    expect(body().explosions).toBe('1');
    game.frame(FLASH_MS);
    game.frame(0);
    expect(bubbleText()).toBe(FAREWELL);
    expect(bubble().classList.contains('still')).toBe(true);
  });

  it('a fight with no clock draws no Overseer and no slag fill', async () => {
    const game = await boot('?bot=off');
    expect(drawn(game)).toEqual({ overseer: null, cores: [], vents: [] });
    expect(tell()).toBeUndefined();
  });
});
