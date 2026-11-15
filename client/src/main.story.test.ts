// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { BOSS_LORE, WORLD_LOGS } from './lorelogs';
import { SEALED, STORY_KEY } from './story';
import { boot, type Game, startBoss } from './test/harness';

// The stage store of the story (#1584, docs/specs/world.md section 12): the game reveals the story in order. A boss entry above the current stage
// is held back on the win screen and in the log archive; the moments of the ladder fire from the call sites of main.ts.
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const rows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('#settings-menu .setting-archive button')];
const story = (): { moments: number[]; wins: number } => JSON.parse(localStorage.getItem(STORY_KEY)!);
const saved = (...moments: number[]): Record<string, string> => ({ [STORY_KEY]: JSON.stringify({ moments, wins: 0 }) });
const at = (...moments: number[]): void => localStorage.setItem(STORY_KEY, JSON.stringify({ moments, wins: 0 })); // a stage reached while the page runs
const lore = (boss: string) => BOSS_LORE.find((e) => e.boss === boss)!;

/** Plays one move of the hot-seat or fight game, with the engine's status mocked to `status` once a ply was played. */
async function finish(game: Game, kind: 'Encounter' | 'Engine', status: 1 | 2): Promise<void> {
  const wasm = await import('edgefall-wasm');
  const over = (): number => (game.hook<number>('__plies') > 0 ? status : 0);
  if (kind === 'Encounter') vi.spyOn(wasm.Encounter.prototype, 'result').mockImplementation(over);
  vi.spyOn(wasm[kind].prototype, 'status').mockImplementation(over);
  const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
  const [q, r] = move.cells[0]!;
  game.click(q, r);
  game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
}
/** Starts the fight of the boss named `name` from the boss list. */
function start(game: Game, name: string): void {
  startBoss(name);
}
/** Starts the fight of `name` and ends it with the status `status` at the first move. */
async function fight(game: Game, name: string, status: 1 | 2): Promise<void> {
  start(game, name);
  await finish(game, 'Encounter', status);
}
const archive = (game: Game): string[] => {
  game.openSettings();
  byId('setting-log-archive').click();
  return rows().map((b) => b.textContent!);
};

describe('the win screen holds back an entry above the stage (#1584)', () => {
  it('shows the sealed line, not the entry, for The Ballast Mind beaten first: no title, no body, no secret word of the entry', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Ballast Mind', 1);
    expect(game.hud()).toContain('Victory');
    expect(byId('lore').hidden).toBe(false);
    expect(byId('lore-title').textContent).toBe(SEALED.title);
    expect(byId('lore-body').textContent).toBe(SEALED.body);
    expect(byId('lore').textContent).not.toMatch(/last seat|cannot push|crew clear|cargo/i); // nothing of the entry of stage 7
    expect(data().lore).toBe('sealed');
    expect(story().moments).toEqual([6, 2, 7]); // the fight started, the first boss beaten, the ending: the stage stays 2
  });

  it('shows the same sealed line for every boss above the stage: the Chaplain and the Swarm', async () => {
    for (const boss of ['The Chaplain', 'The Swarm']) {
      const game = await boot('?bot=off', { reducedMotion: true });
      await fight(game, boss, 1);
      expect(byId('lore-title').textContent, boss).toBe(SEALED.title);
      expect(byId('lore-body').textContent, boss).toBe(SEALED.body);
    }
  });

  it('shows the entry of a boss whose stage the win itself reaches: The Echo first, then the entry of stage 2', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Echo', 1);
    expect(byId('lore-title').textContent).toBe(lore('echo').title);
    expect(data().lore).toBe('boss-echo');
    expect(story()).toMatchObject({ moments: [2], wins: 1 });
  });

  it('computes the stage after the win is recorded: The Hull at stage 3 shows its entry and the stage goes to 4', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: saved(2, 3) });
    await fight(game, 'The Hull', 1);
    expect(byId('lore-title').textContent).toBe(lore('hull').title);
    expect(byId('lore-body').textContent).toBe(lore('hull').body);
    expect(story().moments).toEqual([2, 3, 4]);
  });

  it('holds The Hull back at stage 2, and the entry is filed anyway', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: saved(2) });
    await fight(game, 'The Hull', 1);
    expect(byId('lore-title').textContent).toBe(SEALED.title);
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('boss-hull');
  });

  it('a defeat counts nothing and a Retry takes the plate away', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Ballast Mind', 2);
    expect(byId('lore').hidden).toBe(true);
    expect(story().moments).toEqual([6]); // only the start of the fight
  });
});

describe('the log archive lists only the entries whose stage is reached (#1584)', () => {
  it('hides a held-back boss entry, and lists it once its stage is reached', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Ballast Mind', 1);
    expect(archive(game)).toEqual([]); // read, but the stage 7 is far
    game.openSettings();
    vi.restoreAllMocks();
    at(2, 3, 4, 5, 6, 7);
    expect(archive(game)).toEqual([lore('ballast').title]);
  });

  it('hides a world log of stage 3 at stage 1 and lists it at stage 3, found or not', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { 'ab-alone.lore-read': 'log-forest-far,log-meadow-near' } });
    expect(archive(game)).toEqual([WORLD_LOGS[0]!.title]);
    game.openSettings();
    at(2, 3);
    expect(archive(game)).toEqual([WORLD_LOGS[0]!.title, WORLD_LOGS[7]!.title]);
  });

  it('lists the lore terminals of stage 1 at once', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { 'ab-alone.lore-read': 'mess-house-rule' } });
    expect(archive(game)).toEqual(["Captain's order, pinned above table four"]);
  });
});

describe('the moments of the ladder fire from main.ts (#1584)', () => {
  it('the start of The Ballast Mind fight is stage 6, whatever the stage', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    start(game, 'The Ballast Mind');
    expect(story()).toMatchObject({ moments: [6], wins: 0 });
  });

  it('the start of another fight is no moment', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    start(game, 'The Echo');
    expect(localStorage.getItem(STORY_KEY)).toBeNull();
  });

  it('the win over The Chaplain is stage 5, out of order, and counts once the stages before it are reached', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Chaplain', 1);
    expect(story().moments).toEqual([2, 5]);
  });

  it('the first visit of the Medal room is stage 3, once', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 1], beaten: [] }));
    byId('ship').click();
    game.click(0, 2);
    expect(data().reading).toBe('medal-room');
    expect(story()).toMatchObject({ moments: [3], wins: 0 });
  });

  it('a medal held at the load fires the boss moments of that boss', async () => {
    await boot('?bot=off', { storage: { 'ab-alone.medals': JSON.stringify({ echo: 14, hull: 20 }) } });
    expect(story()).toMatchObject({ moments: [2, 3, 4], wins: 0 }); // two medals: a second boss reaches stage 3
  });

  it('a win in a game against the bot counts, the third is the optional trigger of stage 2, a hot-seat game counts none', async () => {
    const local = await boot('?bot=off');
    await finish(local, 'Engine', 1);
    expect(localStorage.getItem(STORY_KEY)).toBeNull();
    for (const wins of [1, 2, 3]) {
      const bot = await boot('?nodes=50', { storage: { [STORY_KEY]: JSON.stringify({ moments: [], wins: wins - 1 }) } });
      await bot.settle();
      await finish(bot, 'Engine', 1);
      expect(story()).toMatchObject({ moments: wins === 3 ? [2] : [], wins });
      vi.restoreAllMocks();
    }
  });
});

describe('the bot table subtitle (#1568, the story line of #1584 goes to the archive)', () => {
  it('names the bot after the first boss win too: the story line is not on the plate', async () => {
    const first = await boot('?nodes=50');
    expect(first.hud()).toContain('You vs Bot. Eject 6 to win.');
    expect(first.hud()).not.toContain('never an enemy');
    const next = await boot('?nodes=50', { storage: saved(2) });
    expect(next.hud()).toContain('You vs Bot. Eject 6 to win.');
    expect(next.hud()).not.toContain('never an enemy');
  });
});
