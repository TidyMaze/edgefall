// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import page from '../index.html?raw';

// The page's controls, in their places (#839, #1032, docs/specs/thumb-dock.md): the thumb dock at the bottom holds the
// game's controls in order, Settings starts with the update row, and the top column keeps the
// cog, the lobby controls and the invite link.
const doc = new DOMParser().parseFromString(page, 'text/html');
const children = (id: string): string[] => [...doc.getElementById(id)!.children].map((el) => el.id);

describe('The page controls', () => {
  it('the thumb dock holds the game controls in order: Exit (#1517), Flee (a wild fight, #1511), Retry, Rematch, Goal, New game, Hint, Undo, Replay (#1693), the replay steps, Hold, Lobby, Open world (#1612), Quick game (#1612), Modes, Auto-play (Reset view is in the Modes menu, #1612: six dock controls fit 320 px, e2e/thumb-dock.spec.ts)', () => {
    expect(children('dock')).toEqual([
      'exit',
      'wild-flee',
      'boss-retry',
      'rematch',
      'boss-goal',
      'new-game',
      'hint',
      'undo',
      'replay',
      'dock-replay',
      'royale-hold',
      'lobby',
      'open-world-entry',
      'quick-game',
      'modes',
      'auto-play',
    ]);
  });

  it('the lobby sheet above the dock holds Start, Invite and the invite link (#1044)', () => {
    expect(children('lobby-sheet')).toEqual(['royale-start', 'royale-invite', 'lobby-offer', 'invite-label', 'invite-row']);
  });

  it('the replay steps are the dock review: First, Previous, Next, Last, Live', () => {
    expect(children('dock-replay')).toEqual(['replay-first', 'replay-prev', 'replay-next', 'replay-last', 'replay-live']);
  });

  it('the top column keeps the cog, the auto-play reason and the game file input (the lobby controls moved to the sheet, #1044)', () => {
    expect(children('online')).toEqual(['settings-box', 'auto-reason', 'import-file']);
  });

  it('Settings starts with the update row (#1693), the Game modes sheet with the modes', () => {
    expect(children('settings-menu')[0]).toBe('update');
    expect(children('mode-menu')).not.toContain('update');
    expect(children('mode-menu')).toContain('play-online');
  });

  it('put Copy beside the invite link', () => {
    expect(children('invite-row')).toEqual(['invite', 'invite-copy']);
  });

  it('gives each game mode of the Modes sheet a one-line plain description, its title (#1568); the Daily sets its own', () => {
    const modes = ['play-online', 'fight-together', 'boss-duel', 'battle-royale', 'ranked', 'boss-fight', 'roguelite', 'trainer', 'openworld', 'ship'];
    for (const id of modes) expect(doc.getElementById(id)!.title, id).toMatch(/^[A-Z][^.]{10,80}\.$/);
  });
});
