// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot } from './test/harness';

// The ranked leaderboard dialog on the harness (#1287).
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const key = (name: string, shiftKey = false): void =>
  void byId('board').dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));

describe('ranked leaderboard dialog', () => {
  it('opens from the mode menu with the saved opponents and my row highlighted, then closes', async () => {
    const game = await boot('?bot=off');
    localStorage.setItem('ab-alone.ranked', JSON.stringify({ version: 1, rating1v1: 1250, ratingRoyale: 1200, matches: [] }));
    localStorage.setItem('ab-alone.ranked.rivals', JSON.stringify({ version: 1, rivals: [{ pub: 'abcdef123', rating: 1400, timestamp: 1 }] }));
    expect(byId('board').hidden).toBe(true);
    byId('leaderboard').click();
    expect(byId('board').hidden).toBe(false);
    expect(byId('board-body').textContent).toContain('Your position: 2 of 2');
    expect(byId('board-body').querySelector('tr[data-me]')!.textContent).toContain('You');
    expect(document.activeElement).toBe(byId('board-close'));
    byId('board-close').click();
    expect(byId('board').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('leaderboard'));
  });

  it('tells how your position moved since the last time you opened it', async () => {
    const game = await boot('?bot=off');
    localStorage.setItem('ab-alone.ranked', JSON.stringify({ version: 1, rating1v1: 1250, ratingRoyale: 1200, matches: [] }));
    localStorage.setItem('ab-alone.ranked.rivals', JSON.stringify({ version: 1, rivals: [{ pub: 'abcdef123', rating: 1400, timestamp: 1 }] }));
    localStorage.setItem('ab-alone.ranked.board', JSON.stringify({ version: 1, rank: 1 }));
    byId('leaderboard').click();
    expect(byId('board-move').textContent).toBe('Down 1 place since your last visit');
    byId('board-close').click();
    byId('leaderboard').click();
    expect(byId('board-move').textContent).toBe('Unchanged since your last visit');
  });

  it('shows an empty board, keeps Tab inside and closes on Escape', async () => {
    const game = await boot('?bot=off');
    byId('leaderboard').click();
    expect(byId('board-body').textContent).toContain('Play a ranked match');
    key('Tab'); // the shared board's join button comes first (#1287)
    expect(document.activeElement).toBe(byId('board-join'));
    key('Tab', true);
    expect(document.activeElement).toBe(byId('board-close'));
    key('a');
    expect(byId('board').hidden).toBe(false);
    key('Escape');
    expect(byId('board').hidden).toBe(true);
  });
});
