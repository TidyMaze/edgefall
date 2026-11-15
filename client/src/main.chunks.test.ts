// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import './test/openworldwasm';
import { boot } from './test/harness';

// The code of the Open world is a chunk of the build that loads at the first entry (#1578): a page of the table never loads it.

const chunk = vi.hoisted(() => ({ evaluated: 0 }));
vi.mock('./openworldwire', async (importOriginal) => {
  chunk.evaluated++;
  return importOriginal();
});

describe('the code of the Open world, #1578', () => {
  it('is not loaded by a page of the table, and loads at the first entry', async () => {
    const game = await boot('?bot=off', { warmChunks: false });
    await game.settle();
    expect(chunk.evaluated).toBe(0);
    expect(document.body.dataset.openworld).toBeUndefined();
    document.getElementById('openworld')!.click();
    await vi.waitFor(() => expect(document.body.dataset.openworld).toBeDefined()); // its code loads cold
    expect(chunk.evaluated).toBe(1);
  });
});
