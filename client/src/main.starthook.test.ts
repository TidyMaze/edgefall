// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BOSS_IDS } from './tally';
import { boot } from './test/harness';

// The test hook that starts any mode or boss by id (#1690): the e2e specs use it instead of pressing the Modes sheet.

describe('__startMode (#1690)', () => {
  it.each(BOSS_IDS)('starts the boss %s with the random fight seed, locked or not', async (id) => {
    const game = await boot('?bot=off');
    await game.settle();
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => ((a as Uint32Array).fill(7), a));
    game.hook('__startMode', id);
    await game.settle();
    expect(document.body.dataset.boss).toBe(id);
  });

  it.each([
    ['arena', false],
    ['daily', true],
    ['run', false],
  ] as const)('starts the %s mode', async (id, boss) => {
    const game = await boot('?bot=off');
    await game.settle();
    game.hook('__startMode', id);
    await game.settle();
    expect(Boolean(document.body.dataset.boss)).toBe(boss);
  });

  it('starts the Hub', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    game.hook('__startMode', 'hub');
    await game.settle();
    expect(document.body.dataset.hub).toBeTruthy();
  });

  it('refuses an id that is no mode and no boss', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(() => game.hook('__startMode', 'nope')).toThrow('unknown mode nope');
  });
});
