// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { boot } from './test/harness';

// The notice board of the Hub (#1528, docs/specs/ui.md section 4.5): today's daily with its status, the next boss, the medals missing and the
// local daily streak, a card of the Hub. It is not shown while the coach line of the first minutes teaches.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const DAY = Date.parse('2027-03-30T08:00:00Z');
const progress = (beaten: string[]): Record<string, string> => ({ 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten }) });
const lines = (): string[] => [...byId('hub-board').querySelectorAll('li')].map((li) => li.textContent!);

describe('the notice board', () => {
  it('shows in the Hub: the daily not played, the next boss, every medal missing, and no streak', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    await boot('/');
    expect(byId('hub-board').hidden).toBe(false);
    expect(byId('hub-board').querySelector('h2')!.textContent).toBe('Notice board');
    const [daily, next, medals, ...rest] = lines();
    expect(daily).toMatch(/^Daily: .+\. Not played\.$/);
    expect(next).toBe('Next boss: The Echo.');
    expect(medals).toBe('Medals missing: 15.');
    expect(rest).toEqual([]);
  });

  it('shows the status of today\'s daily, the next boss, the medals missing and the streak, from the save', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    await boot('/', {
      storage: {
        ...progress(['echo']),
        'ab-alone.medals': JSON.stringify({ echo: 20, hull: 30 }),
        'ab-alone.daily-days': JSON.stringify({ '2027-03-30': 'won 12', '2027-03-29': 'lost 5', '2027-03-28': 'started' }),
      },
    });
    const [daily, next, medals, streak] = lines();
    expect(daily).toMatch(/^Daily: .+\. Won in 12 turns\.$/);
    expect(next).toBe('Next boss: The Hull.');
    expect(medals).toBe('Medals missing: 13.');
    expect(streak).toBe('Streak: 3 days.');
  });

  it('loads an older profile that has only the attempts of the daily: today started, a streak of one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(DAY);
    await boot('/', { storage: { 'ab-alone.daily': '2027-03-30 2' } });
    const [daily, , , streak] = lines();
    expect(daily).toMatch(/\. Started, not finished\.$/);
    expect(streak).toBe('Streak: 1 day.');
  });

  it('is not shown while the coach line teaches the first minutes, and comes once the player rolled', async () => {
    const game = await boot('?firstrun', { deck: true }); // the coach teaches the deck's walk: the deck's cells, not the 2D Hub (#1729)
    byId('coldopen-skip').click();
    expect(byId('hub-coach').hidden).toBe(false);
    expect(byId('hub-board').hidden).toBe(true);
    game.click(1, 0);
    expect(byId('hub-coach').hidden).toBe(true);
    expect(byId('hub-board').hidden).toBe(false);
  });

  it('is shown to a player who rolled before, with no beaten boss', async () => {
    await boot('/', { webdriver: false, storage: { 'ab-alone.hubcoach': 'done', 'ab-alone.firstrun': 'done' } });
    expect(document.body.dataset.hub).toBe('mess 0,0');
    expect(byId('hub-board').hidden).toBe(false);
  });
});
