// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { bannerText, fightToResume, keepForReload, leavesGame, noteFor, NOWHERE, placeOf, tabStore, takeResume, worldToResume, type Place, type Raw } from './resume';

const memory = (): Storage => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage;
};
const place = (over: Partial<Place> = {}): Place => ({ fight: null, moves: [], world: null, lair: false, lost: false, ...over });
const fight = { id: 'echo', seed: 7, mirror: false, daily: false };

describe('the note a reload for a new version keeps (#1717)', () => {
  it('is read back once, then is gone', () => {
    const store = memory();
    keepForReload(store, { kind: 'fight', id: 'echo', seed: 7, mirror: true, moves: [[1, 2, 3]] });
    expect(takeResume(store)).toEqual({ kind: 'fight', id: 'echo', seed: 7, mirror: true, moves: [[1, 2, 3]] });
    expect(takeResume(store)).toBeNull();
    keepForReload(store, { kind: 'world', seed: 1305 });
    expect(takeResume(store)).toEqual({ kind: 'world', seed: 1305 });
    keepForReload(store, null);
    expect(takeResume(store)).toBeNull();
    expect(takeResume(null)).toBeNull(); // no storage
  });

  it('drops a note that does not parse or does not hold its fields', () => {
    const store = memory();
    for (const raw of ['{', '{"kind":"world","seed":1.5}', '{"kind":"fight","id":"echo","seed":7,"mirror":false,"moves":[[1,"a"]]}', '{"kind":"fight","id":3,"seed":7,"mirror":false,"moves":[]}', '{"kind":"fight","id":"echo","seed":7,"mirror":false,"moves":"no"}', '{"kind":"cake"}']) {
      store.setItem('ab-alone.update-resume', raw);
      expect(takeResume(store), raw).toBeNull();
    }
  });

  it('keeps a boss fight with its moves, else the Open world, and nothing for what a reload leaves', () => {
    expect(noteFor(place({ fight, moves: [[1]] }))).toEqual({ kind: 'fight', id: 'echo', seed: 7, mirror: false, moves: [[1]] });
    expect(noteFor(place({ fight: { ...fight, daily: true } }))).toBeNull(); // the daily counts its attempts: it is not replayed
    expect(noteFor(place({ fight, lair: true, world: 1305 }))).toEqual({ kind: 'world', seed: 1305 }); // a tower's fight goes back to its world
    expect(noteFor(place({ world: 1305 }))).toEqual({ kind: 'world', seed: 1305 });
    expect(noteFor(place({ world: 1305, lost: true }))).toBeNull();
    expect(noteFor(place())).toBeNull(); // the table: its own save brings it back
  });

  it('says when a reload leaves the game in progress', () => {
    expect([leavesGame(place()), leavesGame(place({ fight })), leavesGame(place({ world: 1 }))]).toEqual([false, false, false]);
    expect([leavesGame(place({ lost: true })), leavesGame(place({ fight: { ...fight, daily: true } })), leavesGame(place({ fight, lair: true }))]).toEqual([true, true, true]);
    expect(bannerText(false)).toBe('New version ready. Reloading keeps where you are.');
    expect(bannerText(true)).toBe('New version ready. Reloading now leaves this game.');
  });
});

describe('where the page is, and what the start after the reload does with it (#1717)', () => {
  const raw = (over: Partial<Raw> = {}): Raw => ({ fight: null, history: [], worldActive: false, worldSeed: 1305, lair: null, wild: null, others: [null, null, null, null], ...over });

  it('reads the fight, its moves, the world and what a reload leaves', () => {
    expect(placeOf(raw())).toEqual(NOWHERE);
    const moves = [[1, 2]];
    const kept = placeOf(raw({ fight: { id: 'echo', seed: 3, mirror: true }, history: moves }));
    expect(kept).toEqual({ fight: { id: 'echo', seed: 3, mirror: true, daily: false }, moves: [[1, 2]], world: null, lair: false, lost: false });
    expect(kept.moves[0]).not.toBe(moves[0]); // a copy: the game goes on meanwhile
    expect(placeOf(raw({ fight: { id: 'echo', seed: 3, daily: { day: 'x' } } })).fight).toEqual({ id: 'echo', seed: 3, mirror: false, daily: true });
    expect(placeOf(raw({ worldActive: true })).world).toBe(1305);
    expect(placeOf(raw({ lair: { seed: 7 } }))).toMatchObject({ world: 7, lair: true });
    expect(placeOf(raw({ wild: { seed: 9 } }))).toMatchObject({ world: 9, lair: true });
    expect(placeOf(raw({ others: [null, {}, null, null] })).lost).toBe(true);
  });

  it('starts the noted fight again replayed to its last move, and only a known boss whose moves replay', () => {
    const replay = vi.fn((id: string, seed: number, mirror: boolean, moves: number[][]) => (moves.length < 3 ? { id, seed, mirror } : null));
    const note = { kind: 'fight', id: 'echo', seed: 3, mirror: false, moves: [[1]] } as const;
    expect(fightToResume(note, ['echo'], replay)).toEqual({ id: 'echo', seed: 3, mirror: false, moves: [[1]], engine: { id: 'echo', seed: 3, mirror: false } });
    expect(fightToResume({ ...note, moves: [[1], [2], [3]] }, ['echo'], replay)).toBeNull(); // the moves do not replay
    expect(fightToResume(note, ['hull'], replay)).toBeNull(); // a boss this build does not know
    expect(fightToResume({ kind: 'world', seed: 1 }, ['echo'], replay)).toBeNull();
    expect(fightToResume(null, ['echo'], replay)).toBeNull();
    expect([worldToResume({ kind: 'world', seed: 1305 }), worldToResume(note), worldToResume(null)]).toEqual([1305, null, null]);
  });

  it('keeps the note in the tab only, and in none when the browser blocks it', () => {
    expect(tabStore()).toBe(sessionStorage);
    const getter = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    onTestFinished(() => getter.mockRestore());
    expect(tabStore()).toBeNull();
  });
});
