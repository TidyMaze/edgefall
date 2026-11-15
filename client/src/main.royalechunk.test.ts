// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { boot } from './test/harness';

// The online half of the Battle royale, its room and its rounds (royale-net.ts), is a chunk of the build that loads when a player
// opens a room (#1578): a table page and an offline Battle royale never load it.

const chunk = vi.hoisted(() => ({ evaluated: 0 }));
vi.mock('./royale-net', async (importOriginal) => {
  chunk.evaluated++;
  return importOriginal();
});

describe('the online Battle royale code, #1578', () => {
  it('is not loaded by a table page nor by an offline Battle royale, and loads when Invite opens a room', async () => {
    const game = await boot('?bot=off', { warmChunks: false });
    await game.settle();
    expect(chunk.evaluated).toBe(0);
    document.getElementById('battle-royale')!.click();
    await game.settle();
    expect(document.body.dataset.royale).toBeDefined(); // the arena is on
    expect(chunk.evaluated).toBe(0);
    document.getElementById('royale-invite')!.click();
    await vi.waitFor(() => expect(document.body.dataset.online).toBe('royale'));
    expect(chunk.evaluated).toBe(1);
  });
});
