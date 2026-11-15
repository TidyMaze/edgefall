// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { BOSS_ENDS } from './bossends';
import { CLAMP_OPEN, EPILOGUE } from './epilogue';
import { STORY_KEY } from './story';
import { BOSS_IDS } from './tally';
import { boot, type Game, startBoss } from './test/harness';

// The finale (#1546, #1588, docs/specs/world.md section 12.8): each boss has its own victory and defeat line; the win that reaches stage 7 plays
// a short, skippable epilogue once, which the log archive rereads; the bridge console then reads the clamp open.
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const NAMES: Record<string, string> = { echo: 'The Echo', hull: 'The Hull', ballast: 'The Ballast Mind', swarm: 'The Swarm', stalker: 'The Stalker' };
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = (): DOMStringMap => document.body.dataset;
const saved = (...moments: number[]): Record<string, string> => ({ [STORY_KEY]: JSON.stringify({ moments, wins: 0 }) });
const box = (): HTMLElement => byId('epilogue');
const line = (boss: string, kind: 'win' | 'loss', stage = 1): string => BOSS_ENDS.filter((e) => e.boss === boss && e.kind === kind && e.stage <= stage).at(-1)!.line;

/** Starts the fight of `boss` and ends it with `status` (1 a win, 2 a loss, 3 a draw) at the first move. */
async function fight(game: Game, boss: string, status: 1 | 2 | 3): Promise<void> {
  const wasm = await import('edgefall-wasm');
  const over = (): number => (game.hook<number>('__plies') > 0 ? status : 0);
  vi.spyOn(wasm.Encounter.prototype, 'result').mockImplementation(over);
  vi.spyOn(wasm.Encounter.prototype, 'status').mockImplementation(over);
  startBoss(NAMES[boss]!);
  const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
  const [q, r] = move.cells[0]!;
  game.click(q, r);
  game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
}
const archive = (game: Game): HTMLButtonElement[] => {
  game.openSettings();
  byId('setting-log-archive').click();
  return [...document.querySelectorAll<HTMLButtonElement>('#settings-menu .setting-archive button')];
};

describe('each boss has its own victory and defeat line (#1546)', () => {
  it('shows the boss line on the banner of a win and of a defeat, in place of the one banner of all 15', async () => {
    for (const boss of ['echo', 'swarm']) {
      const won = await boot('?bot=off', { reducedMotion: true });
      await fight(won, boss, 1);
      expect(won.hud(), boss).toContain('Victory');
      expect(won.hud(), boss).toContain(line(boss, 'win'));
      expect(won.hud(), boss).not.toContain('The seat is empty.');
      vi.restoreAllMocks();
      const lost = await boot('?bot=off', { reducedMotion: true });
      await fight(lost, boss, 2);
      expect(lost.hud(), boss).toContain('Defeat');
      expect(lost.hud(), boss).toContain(line(boss, 'loss'));
      expect(lost.hud(), boss).not.toContain('The seat holds.');
      vi.restoreAllMocks();
    }
  });

  it('leaves the draw line of a boss fight as it was', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'echo', 3);
    expect(game.hud()).toContain('Defeat');
    expect(game.hud()).toContain('a defeat.');
    for (const { line: l } of BOSS_ENDS) expect(game.hud()).not.toContain(l);
  });

  it('has a victory and a defeat line for every boss of the menu (the data of the 15)', () => {
    expect(BOSS_IDS.every((id) => line(id, 'win') && line(id, 'loss'))).toBe(true);
  });
});

describe("The Ballast Mind's ending line is held back until stage 7 (#1588)", () => {
  it('shows the old line when it is beaten too early: no secret on the banner, no epilogue', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    await fight(game, 'ballast', 1);
    expect(game.hud()).toContain('The seat is empty.');
    expect(game.hud()).not.toContain('Clamp');
    expect(box().hidden).toBe(true);
    expect(localStorage.getItem('ab-alone.epilogue')).toBeNull();
  });

  it('shows the line of the ending when the win reaches stage 7, and the epilogue opens over it', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: saved(2, 3, 4, 5, 6) });
    await fight(game, 'ballast', 1);
    expect(game.hud()).toContain('Delivered: fourteen. Crew clear: all. Seat five: Tally. Books balanced. Clamp: yours.');
    expect(box().hidden).toBe(false);
    expect(data().epilogue).toBe('1');
    expect(byId('epilogue-title').textContent).toBe(EPILOGUE.pages[0]!.title);
    expect(byId('epilogue-text').textContent).toContain(EPILOGUE.pages[0]!.lines[0]);
    expect(localStorage.getItem('ab-alone.epilogue')).toBe('seen');
  });

  it('says its limit as the fight starts at stage 6, the old line below', async () => {
    const early = await boot('?bot=off', { reducedMotion: true });
    startBoss('The Ballast Mind');
    expect(early.hud()).toContain('The ledger plays itself. Twelve out to balance.');
    expect(early.hud()).not.toContain('cannot push');
    const ready = await boot('?bot=off', { reducedMotion: true, storage: saved(2, 3, 4, 5) });
    startBoss('The Ballast Mind');
    expect(ready.hud()).toContain('I cannot push. Rule four. You can. Count carefully.');
  });
});

describe('the epilogue (#1546)', () => {
  const play = async (moments = [2, 3, 4, 5, 6]): Promise<Game> => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: saved(...moments) });
    await fight(game, 'ballast', 1);
    return game;
  };

  it('has two pages: Next turns to the clamp and the world, and Walk out closes it on "You walk out."', async () => {
    await play();
    expect(byId('epilogue-next').textContent).toBe('Next');
    byId('epilogue-next').click();
    expect(data().epilogue).toBe('2');
    expect(byId('epilogue-title').textContent).toBe(EPILOGUE.pages[1]!.title);
    expect(byId('epilogue-text').textContent).toContain('Docking clamp: open.');
    expect(byId('epilogue-text').textContent).toMatch(/You walk out\.$/);
    expect(byId('epilogue-next').textContent).toBe('Walk out');
    byId('epilogue-next').click();
    expect(box().hidden).toBe(true);
    expect(data().epilogue).toBeUndefined();
  });

  it('is skipped by the Skip button on either page, and by Escape', async () => {
    await play();
    byId('epilogue-skip').click();
    expect(box().hidden).toBe(true);
    expect(data().epilogue).toBeUndefined();
    vi.restoreAllMocks();
    const second = await play();
    byId('epilogue-next').click();
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(box().hidden).toBe(true);
    expect(second.hud()).toContain('Victory'); // the banner is under it
  });

  it('keeps the focus inside it with Tab and lets no other key reach the board', async () => {
    await play();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    box().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); // and back
    const other = vi.fn();
    addEventListener('keydown', other);
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    removeEventListener('keydown', other);
    expect(other).not.toHaveBeenCalled();
    expect(box().hidden).toBe(false);
  });

  it('plays once: a second win does not open it again', async () => {
    const game = await play();
    byId('epilogue-skip').click();
    vi.restoreAllMocks();
    await fight(game, 'echo', 1);
    expect(box().hidden).toBe(true);
  });

  it('opens for the win that completes the run to stage 7, not only the Ballast Mind: The Hull when the ending was won first', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: saved(2, 3, 5, 6, 7) });
    await fight(game, 'hull', 1);
    expect(box().hidden).toBe(false);
    expect(game.hud()).toContain(line('hull', 'win'));
  });

  it('is filed in the log archive and read again there, as one entry', async () => {
    const game = await play();
    byId('epilogue-skip').click();
    vi.restoreAllMocks();
    const rows = archive(game);
    expect(rows.map((b) => b.textContent)).toContain(EPILOGUE.title);
    rows.find((b) => b.textContent === EPILOGUE.title)!.click();
    expect(data().reading).toBe(EPILOGUE.id);
    expect(document.getElementById('reader')!.textContent).toContain(EPILOGUE.pages[0]!.lines[0]);
    expect(data().console).toMatch(/^story-epilogue 1\/\d+$/);
  });

  it('is not due again after a reload: the flag is saved locally', async () => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { ...saved(2, 3, 4, 5, 6, 7), 'ab-alone.epilogue': 'seen' } });
    await fight(game, 'echo', 1);
    expect(box().hidden).toBe(true);
  });
});

describe('the clamp reads open on the bridge console from stage 7 (#1546)', () => {
  const reread = async (moments: number[]): Promise<string> => {
    const game = await boot('?bot=off', { reducedMotion: true, storage: { ...saved(...moments), 'ab-alone.lore-read': 'bridge-clamp' } });
    archive(game).find((b) => b.textContent === CLAMP_OPEN.title)!.click();
    return document.getElementById('reader')!.textContent!;
  };

  it('reads the clamp locked before stage 7 and open from it', async () => {
    expect(await reread([2, 3, 4, 5, 6])).toContain('Docking clamp: locked.');
    expect(await reread([2, 3, 4, 5, 6, 7])).toContain('Docking clamp: open.');
  });
});
