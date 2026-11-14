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

  it('starts the Open world', async () => {
    const game = await boot('?bot=off&openworld=5');
    await game.settle();
    game.hook('__startMode', 'world');
    await game.settle();
    expect(document.body.dataset.openworld).toBeTruthy();
  });

  it('starts the battle royale, once', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    game.hook('__startMode', 'royale');
    expect(document.getElementById('hud')!.textContent).toContain('Battle royale');
  });

  it('starts the online game and waits for an opponent', async () => {
    const game = await boot('?bot=off&net=hook');
    await game.settle();
    game.hook('__startMode', 'online');
    await game.settle();
    expect(document.getElementById('hud')!.textContent).toContain('Waiting for an opponent');
  });

  it('starts a partner fight against the boss', async () => {
    const game = await boot('?bot=off&net=hook');
    await game.settle();
    game.hook('__startMode', 'coop:echo');
    await game.settle();
    expect(game.hook<{ id: string }>('__fight').id).toBe('echo');
  });

  it('does not read boss as the daily', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(() => game.hook('__startMode', 'boss')).toThrow('unknown mode boss');
    expect(() => game.hook('__startMode', 'coop:nope')).toThrow('unknown mode coop:nope');
  });

  it('says when the page is booted, the landing settled', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(game.hook('__booted')).toBe(true);
  });

  it('refuses an id that is no mode and no boss', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    expect(() => game.hook('__startMode', 'nope')).toThrow('unknown mode nope');
  });
});
