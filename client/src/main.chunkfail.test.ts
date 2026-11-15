// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import './test/openworldwasm';
import { boot } from './test/harness';

// A load of the Open world's code that fails (offline, a new deploy that removed the old file) leaves a message with Retry and
// Reload and a page that is alive, and Retry enters the world once the file comes (#1578).

const chunk = vi.hoisted(() => ({ fail: true }));
vi.mock('./openworldwire', async (importOriginal) => {
  if (chunk.fail) throw new Error('Failed to fetch dynamically imported module');
  return importOriginal();
});

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;

describe('a failed load of the Open world, #1578', () => {
  it('shows the message, keeps the page alive, and Retry enters the world', async () => {
    const game = await boot('?bot=off', { warmChunks: false });
    byId('openworld').click();
    await vi.waitFor(() => expect(byId('chunk-error').hidden).toBe(false));
    expect(byId('chunk-name').textContent).toBe('Open world');
    expect(byId('loading').hidden).toBe(true);
    expect(document.body.dataset.openworld).toBeUndefined();
    expect(byId('hud').textContent).not.toBe(''); // the page under the message is alive
    chunk.fail = false;
    byId('chunk-retry').click();
    await vi.waitFor(() => expect(document.body.dataset.openworld).toBeDefined());
    expect(byId('chunk-error').hidden).toBe(true);
  });
});
