import { describe, expect, it, vi } from 'vitest';
import { RESET_ASK, eraseAll, eraseKeys } from './reset';

/** A Storage that lists its keys, as localStorage does. */
function storage(items: Record<string, string>): Storage {
  const map = new Map(Object.entries(items));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}
const keys = (s: Storage): string[] => Array.from({ length: s.length }, (_, i) => s.key(i)!).sort();

describe('reset.ts, Reset everything (#1684)', () => {
  it('asks in the game, not with a browser dialog', () => {
    expect(RESET_ASK).toBe('Erase all progress and settings? This cannot be undone.');
  });

  it('removes every ab-alone key, settings, play, mixer and lights included, and no other key', () => {
    const s = storage({
      'ab-alone.firstwin': '1', 'ab-alone.sound': '0', 'ab-alone.volume.music': '50', 'ab-alone.light.key': '1', 'ab-alone.daily': 'x', 'ab-alone.': 'x',
      'other.key': 'keep', 'ab-aloneX': 'keep', theme: 'keep', 'AB-ALONE.x': 'keep',
    });
    expect(eraseKeys(s)).toBe(6);
    expect(keys(s)).toEqual(['AB-ALONE.x', 'ab-aloneX', 'other.key', 'theme']);
  });

  it('sweeps again after the database went: a save that landed meanwhile is erased too', async () => {
    const s = storage({ 'ab-alone.x': '1' });
    const deleteDatabase = (): IDBOpenDBRequest => {
      const req = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        s.setItem('ab-alone.late', '1'); // a timer's write during the delete
        req.onsuccess!(null as never);
      });
      return req;
    };
    await eraseAll(s, { deleteDatabase });
    expect(keys(s)).toEqual([]);
  });

  it('does nothing without a store', () => {
    expect(eraseKeys(null)).toBe(0);
  });

  it('deletes the ab-alone database, and carries on when it is blocked, fails, throws or is missing', async () => {
    for (const event of ['onsuccess', 'onerror', 'onblocked'] as const) {
      const deleteDatabase = vi.fn((_name: string) => {
        const req = {} as IDBOpenDBRequest;
        queueMicrotask(() => (req[event] as () => void)());
        return req;
      });
      const s = storage({ 'ab-alone.x': '1', keep: '1' });
      await eraseAll(s, { deleteDatabase });
      expect(deleteDatabase).toHaveBeenCalledWith('ab-alone');
      expect(keys(s)).toEqual(['keep']);
    }
    await eraseAll(storage({}), { deleteDatabase: () => { throw new Error('no idb'); } });
    await eraseAll(storage({}), undefined);
  });
});
