// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot } from './test/harness';

// #1361: a link ?openworld=<seed> opens that world at the load, with no click on the menu.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((done) => setTimeout(done));
};

describe('the Open world link (#1361)', () => {
  it('?openworld=7 lands in the world of seed 7 at the load', async () => {
    await boot('?bot=off&openworld=7');
    await settle();
    expect(document.body.dataset.openworld).toBe('7');
  });

  it('?openworld=new lands in a fresh world at the load', async () => {
    await boot('?bot=off&openworld=new');
    await settle();
    expect(document.body.dataset.openworld).toMatch(/^\d+$/);
  });

  it('a bad value opens the public world, the one world a player can enter', async () => {
    await boot('?bot=off&openworld=abc');
    await settle();
    expect(document.body.dataset.openworld).toBe('1305');
  });

  it('the menu opens the public world even when a private world was played last', async () => {
    const game = await boot('?bot=off');
    document.getElementById('openworld')!.click();
    await settle();
    expect(document.body.dataset.openworld).toBe('1305');
  });

  it('no parameter boots the board as usual', async () => {
    await boot('?bot=off');
    await settle();
    expect(document.body.dataset.openworld).toBeUndefined();
  });
});

describe('the Hub button of the Open world (#1373, now the exit of the dock, #1517)', () => {
  it('leaves the world, saved as Esc does, for the Hub', async () => {
    await boot('?bot=off&openworld=7');
    await settle();
    expect(document.body.dataset.openworld).toBe('7');
    expect(document.getElementById('exit')!.dataset.label).toBe('Hub');
    document.getElementById('exit')!.click();
    await settle();
    expect(document.body.dataset.openworld).toBeUndefined();
    expect(document.body.dataset.hub).toBeDefined();
  });
});
