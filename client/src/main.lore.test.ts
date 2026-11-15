// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { BOSS_LORE, WORLD_LOGS } from './lorelogs';
import { boot, type Game, startBoss } from './test/harness';

// The lore of the story (#1589, docs/specs/world.md section 12): a boss win shows that boss's entry under the banner and files it in the log
// archive; a log of the Open world read lands there too; the archive reopens both in the terminal reader.
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const rows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('#settings-menu .setting-archive button')];

/** Starts the fight of the boss named `name` from the boss list, and ends it with the status `status` (1 a win, 2 a loss) at the first move. */
async function fight(game: Game, name: string, status: 1 | 2): Promise<void> {
  const { Encounter } = await import('edgefall-wasm');
  startBoss(name);
  const over = (): number => (game.hook<number>('__plies') > 0 ? status : 0);
  vi.spyOn(Encounter.prototype, 'result').mockImplementation(over);
  vi.spyOn(Encounter.prototype, 'status').mockImplementation(over);
  const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
  const [q, r] = move.cells[0]!;
  game.click(q, r);
  game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
}

describe('the lore after a boss win (#1589)', () => {
  it('shows the entry of the boss beaten under the banner, with its title, and files it in the archive', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Echo', 1);
    expect(byId('lore').hidden).toBe(false);
    expect(byId('lore-title').textContent).toBe(BOSS_LORE[0]!.title);
    expect(byId('lore-body').textContent).toBe(BOSS_LORE[0]!.body);
    expect(game.hud()).toContain('Victory');
    expect(data().lore).toBe('boss-echo');
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('boss-echo');
  });

  it('shows the entry of the boss that was beaten, whichever it is, and the same one again on a repeat win', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { 'ab-alone.story': JSON.stringify({ moments: [2, 3], wins: 0 }) } }); // stage 3: The Swarm's entry is reached (#1584)
    await fight(game, 'The Swarm', 1);
    expect(byId('lore-title').textContent).toBe('Cargo: the Swarm');
    expect(byId('lore-body').textContent).toBe(BOSS_LORE.at(-1)!.body);
    vi.restoreAllMocks();
    await fight(game, 'The Swarm', 1);
    expect(byId('lore-title').textContent).toBe('Cargo: the Swarm');
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('boss-swarm'); // one entry in the archive
  });

  it('never blocks Retry or leaving: the buttons of the win stay', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Echo', 1);
    expect(byId('lore').hidden).toBe(false);
    expect(byId('boss-retry').hidden).toBe(false);
  });

  it('goes with the fight: the Hub and the Battle royale take it away', async () => {
    for (const leave of ['ship', 'battle-royale']) {
      const game = await boot('?bot=off', { reducedMotion: true });
      await fight(game, 'The Echo', 1);
      expect(byId('lore').hidden).toBe(false);
      vi.restoreAllMocks();
      await game.settle();
      byId(leave).click();
      await game.settle();
      expect(byId('lore').hidden, leave).toBe(true);
      expect(data().lore, leave).toBeUndefined();
    }
  });

  it('shows no lore after a defeat, and none in a game against the bot', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Echo', 2);
    expect(game.hud()).toContain('Defeat');
    expect(byId('lore').hidden).toBe(true);
    expect(data().lore).toBeUndefined();
    expect(localStorage.getItem('ab-alone.lore-read')).toBeNull();
  });

  it('reopens the entry from the log archive in the terminal reader, with its own Play log for its deck', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'The Echo', 1);
    game.openSettings();
    byId('setting-log-archive').click();
    expect(rows().map((b) => b.textContent)).toEqual([BOSS_LORE[0]!.title]);
    rows()[0]!.click();
    expect(data().reading).toBe('boss-echo');
    expect(byId('reader').querySelector('p')!.textContent).toBe(BOSS_LORE[0]!.title);
    expect(byId('log-button').hidden).toBe(false); // the audio log of the Mess, where the Echo sat
  });
});

describe('a lore log of the Open world in the log archive (#1589)', () => {
  it('rolling onto a log files it, and the archive reopens it in the reader with no audio log to play', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    const all = game.hook<number[]>('__openworldLogs', 7);
    expect(all).toHaveLength(2 * WORLD_LOGS.length); // the bridge's cells and the texts are twelve each
    const [q, r] = all as unknown as Axial;
    game.hook('__openworldFixture', { hero: [q! - 1, r!], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(data().openworldLog).toBe('log-meadow-near');
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('log-meadow-near');
    game.openSettings();
    byId('setting-log-archive').click();
    expect(rows().map((b) => b.textContent)).toEqual([WORLD_LOGS[0]!.title]);
    rows()[0]!.click();
    expect(data().reading).toBe('log-meadow-near');
    expect(byId('log-button').hidden).toBe(true); // a log of the world has no recording
  });
});
