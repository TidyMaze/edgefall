// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { boot, type BootOptions } from './test/harness';

// Reset everything (#1684): the last row of Settings opens an in-game confirm; Erase wipes the game's keys and saved games and reloads; Cancel changes nothing.

const byId = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const menu = (): HTMLElement => byId('settings-menu');

async function ready(options: BootOptions = {}): Promise<void> {
  const game = await boot('?bot=off', options);
  await game.settle();
  byId('settings').click();
}

describe('main.ts, Reset everything (#1684)', () => {
  it('is the last row of Settings, a danger button, and the question waits out of sight', async () => {
    await ready();
    const row = byId('setting-reset-all');
    expect([row.textContent, row.classList.contains('danger'), row.nextElementSibling!.classList.contains('setting-reset')]).toEqual(['Reset everything', true, true]);
    expect(menu().lastElementChild).toBe(row.nextElementSibling);
    expect(menu().dataset.page).toBeUndefined();
  });

  it('asks in the game, focuses Cancel, and Cancel changes nothing', async () => {
    await ready({ storage: { 'ab-alone.firstwin': '1', 'ab-alone.sound': '0' } });
    byId('setting-reset-all').click();
    expect(menu().dataset.page).toBe('reset');
    expect(byId('reset-ask').textContent).toBe('Erase all progress and settings? This cannot be undone.');
    expect(document.activeElement).toBe(byId('reset-cancel'));
    byId('reset-cancel').click();
    expect(menu().dataset.page).toBeUndefined();
    expect(document.activeElement).toBe(byId('setting-reset-all'));
    expect([localStorage.getItem('ab-alone.firstwin'), localStorage.getItem('ab-alone.sound')]).toEqual(['1', '0']);
  });

  it('Erase removes the ab-alone keys, the saved games, and reloads; other keys stay', async () => {
    const indexedDB = new IDBFactory();
    await ready({ indexedDB, storage: { 'ab-alone.firstwin': '1', 'ab-alone.sound': '0', 'other.key': 'keep' } });
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    const clear = vi.spyOn(globalThis, 'clearInterval');
    byId('setting-reset-all').click();
    byId('reset-erase').click();
    expect(clear).toHaveBeenCalled(); // the timers stop before the sweep (the beats and the royale tick)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k!.startsWith('ab-alone.'))).toEqual([]);
    expect(localStorage.getItem('other.key')).toBe('keep');
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('ab-alone');
  });
});
