// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOVE_STRIDE, type Axial } from './board';
import { indexedDbStore } from './idb';
import './test/openworldwasm';
import { world_enemies } from 'edgefall-wasm';
import { boot, type Game } from './test/harness';

// The Workshop and the special marbles of the wild fights (#1655, Decision #1654, docs/specs/openworld.md section 19.2).
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
type Stock = { resources?: { wood: number; ore: number; parts: number; shards: number }; army?: { specials: number[]; brought: number[]; relics: number[]; relicsBrought: number[] } };
type Hooks = { __openworldFixture: (f: { hero: Axial; troop: Axial[]; enemies?: Axial[] } & Stock) => void; __openworldEnemies: () => Axial[] };
const hooks = () => window as unknown as Hooks;
const rich = { wood: 20, ore: 20, parts: 40, shards: 0 };
const army = (specials: number[], brought: number[]) => ({ specials, brought, relics: [], relicsBrought: [] });

/** Opens the world of seed 7, loads `stock`, rolls onto its first town. */
async function inTown(game: Game, stock: Stock): Promise<Axial> {
  byId('openworld').click();
  await settle();
  const [q, r] = data().openworldPlaces!.split(' ').find((p) => p.startsWith('town:'))!.slice(5).split(',').map(Number) as unknown as Axial;
  hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [], ...stock });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  await settle();
  return [q - 1, r];
}
const open = async (): Promise<void> => {
  byId('workshop-open').click();
  await settle();
};
const press = async (kind: number, act: string): Promise<void> => {
  document.querySelector<HTMLButtonElement>(`#workshop button[data-kind="${kind}"][data-act="${act}"]`)!.click();
  await settle();
};
const pressRelic = async (code: number, act: string): Promise<void> => {
  document.querySelector<HTMLButtonElement>(`#workshop button[data-relic="${code}"][data-act="${act}"]`)!.click();
  await settle();
};
const text = (id: string): string => byId(id).textContent!;

describe('the Workshop station of the Hub (#1655)', () => {
  it('shows in the Hub of a town of the Open world, not in the Hub of the mode menu', async () => {
    const menu = await boot('?bot=off');
    byId('ship').click();
    expect(data().hub).toBeTruthy();
    expect(byId('workshop-open').hidden).toBe(true);
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, {});
    expect(data().hub).toBeTruthy();
    expect(byId('workshop-open').hidden).toBe(false);
    expect(byId('workshop-open').textContent).toBe('Workshop');
    expect(byId('workshop').hidden).toBe(true);
  });

  it('opens a sheet with the stock of the world, closes with Close and Esc, and the focus goes back to the button', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: { wood: 12, ore: 7, parts: 20, shards: 2 } });
    await open();
    expect(byId('workshop').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('workshop'));
    expect(text('workshop-stock')).toBe('Wood 12 · Ore 7 · Parts 20 · Shards 2');
    expect(text('workshop-army')).toBe('Army 0 / 6 · Bringing 0 / 3');
    byId('workshop-close').click();
    expect(byId('workshop').hidden).toBe(true);
    expect(document.activeElement).toBe(byId('workshop-open'));
    await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(byId('workshop').hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // nothing open: nothing
    expect(byId('workshop').hidden).toBe(true);
  });

  it('the arrows of the Hub do not roll the marble while the sheet is open', async () => {
    const game = await boot('?bot=off&openworld=7', { deck: true });
    await inTown(game, {});
    const at = data().hub;
    await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(data().hub).toBe(at);
    byId('workshop-close').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(data().hub).not.toBe(at);
  });

  it('buys, sells and chooses the loadout, and the sheet reads the save back: a Heavy for 6 ore and 4 parts, 3 ore and 2 parts back', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: rich });
    await open();
    await press(1, 'buy');
    expect(text('workshop-stock')).toBe('Wood 20 · Ore 14 · Parts 36 · Shards 0');
    expect(text('workshop-army')).toBe('Army 1 / 6 · Bringing 0 / 3');
    expect(document.activeElement).toBe(document.querySelector('#workshop button[data-kind="1"][data-act="buy"]'));
    await press(1, 'bring');
    expect(text('workshop-army')).toBe('Army 1 / 6 · Bringing 1 / 3');
    expect(document.querySelector<HTMLButtonElement>('#workshop button[data-kind="1"][data-act="bring"]')!.disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#workshop button[data-kind="1"][data-act="buy"]')); // the pressed button is disabled: the first enabled one of its row
    await press(1, 'leave');
    expect(text('workshop-army')).toBe('Army 1 / 6 · Bringing 0 / 3');
    await press(1, 'bring');
    await press(10, 'buy'); // 6 wood and 6 parts
    await press(10, 'sell'); // half back
    expect(text('workshop-stock')).toBe('Wood 17 · Ore 14 · Parts 33 · Shards 0');
    byId('workshop-close').click();
    await open(); // the save, read again
    expect(text('workshop-stock')).toBe('Wood 17 · Ore 14 · Parts 33 · Shards 0');
    expect(text('workshop-army')).toBe('Army 1 / 6 · Bringing 1 / 3');
    await press(1, 'sell'); // the brought Heavy goes with it
    expect(text('workshop-stock')).toBe('Wood 17 · Ore 17 · Parts 35 · Shards 0');
    expect(text('workshop-army')).toBe('Army 0 / 6 · Bringing 0 / 3');
  });

  it('a disabled button says why, and the army owns at most six', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: { wood: 3, ore: 3, parts: 3, shards: 0 }, army: army([1], []) });
    await open();
    const buy = (kind: number) => document.querySelector<HTMLButtonElement>(`#workshop button[data-kind="${kind}"][data-act="buy"]`)!;
    expect(buy(1).disabled).toBe(true);
    expect(buy(1).title).toBe('not enough ore and parts');
    expect(document.querySelector('#workshop li[data-kind="1"] .w-why')!.textContent).toBe('not enough ore and parts');
    byId('workshop-close').click();
    await boot('?bot=off&openworld=7'); // another page: nothing of the first leaks in
    const full = await boot('?bot=off&openworld=7');
    await inTown(full, { resources: { wood: 99, ore: 99, parts: 99, shards: 0 }, army: army([1, 1, 2, 2, 3, 3], []) });
    await open();
    expect(buy(8).disabled).toBe(true);
    expect(buy(8).title).toBe('army full');
    await press(1, 'sell');
    expect(buy(8).disabled).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('#workshop button[data-kind="1"][data-act="sell"]')); // one more to sell: the focus stays
  });

  it('upgrades a Heavy for 3 shards and 10 ore, sells the Heavy+ for half of its whole price, and the sheet reads the save back', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: { wood: 0, ore: 10, parts: 0, shards: 3 }, army: army([1], [1]) });
    await open();
    await press(1, 'upgrade');
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 0');
    expect(text('workshop-army')).toBe('Army 1 / 6 · Bringing 1 / 3');
    expect(document.querySelector('#workshop li[data-kind="4"] .w-own')!.textContent).toBe('Owned 1 · Bringing 1');
    expect(document.activeElement).toBe(byId('workshop'));
    byId('workshop-close').click();
    await open();
    expect(document.querySelector('#workshop li[data-kind="4"] .w-own')!.textContent).toBe('Owned 1 · Bringing 1');
    await press(4, 'sell');
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 8 · Parts 2 · Shards 1');
    expect(text('workshop-army')).toBe('Army 0 / 6 · Bringing 0 / 3');
  });

  it('buys, brings, leaves and sells a relic: 5 shards and 15 parts, 2 shards and 7 parts back, and the Quartermaster makes room for a fourth special', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: { wood: 0, ore: 0, parts: 30, shards: 10 }, army: army([1, 2, 3, 9], [1, 2, 3]) });
    await open();
    await pressRelic(11, 'buy');
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 0 · Parts 15 · Shards 5');
    expect(text('workshop-relics')).toBe('Relics 1 · Bringing 0 / 2');
    await pressRelic(11, 'bring');
    expect(text('workshop-army')).toBe('Army 4 / 6 · Bringing 3 / 4');
    await press(9, 'bring');
    expect(text('workshop-army')).toBe('Army 4 / 6 · Bringing 4 / 4');
    await pressRelic(11, 'leave'); // without the Quartermaster the loadout is three again
    expect(text('workshop-army')).toBe('Army 4 / 6 · Bringing 3 / 3');
    await pressRelic(11, 'sell');
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 0 · Parts 22 · Shards 7');
    expect(text('workshop-relics')).toBe('Relics 0 · Bringing 0 / 2');
    byId('workshop-close').click();
    await open();
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 0 · Parts 22 · Shards 7');
    expect(document.querySelector('#workshop button[data-relic="0"][data-act="buy"]')!.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the focus in the sheet when the row has no button left to press', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: { wood: 0, ore: 0, parts: 0, shards: 0 }, army: army([1], []) });
    await open();
    await press(1, 'sell'); // 3 ore and 2 parts back: not enough for another, and none left to sell, bring or leave
    expect(document.querySelectorAll('#workshop li[data-kind="1"] button:not(:disabled)').length).toBe(0);
    expect(document.activeElement).toBe(byId('workshop'));
  });

  it('a click on the sheet that is no button does nothing, and a button of a closed sheet neither', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: rich });
    await open();
    byId('workshop-body').click();
    const buy = document.querySelector<HTMLButtonElement>('#workshop button[data-kind="1"][data-act="buy"]')!;
    byId('workshop-close').click();
    buy.click();
    await settle();
    await open();
    expect(text('workshop-stock')).toBe('Wood 20 · Ore 20 · Parts 40 · Shards 0');
  });

  it('is closed with the Hub: leaving to the world hides the button and the sheet, and a sheet still loading stays shut', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, {});
    byId('workshop-open').click();
    byId('exit').click(); // the Hub is left before the save is read
    await settle();
    expect(byId('workshop').hidden).toBe(true);
    expect(byId('workshop-open').hidden).toBe(true);
    await inTown(game, {});
    await open();
    expect(byId('workshop').hidden).toBe(false);
    byId('exit').click();
    await settle();
    expect(byId('workshop').hidden).toBe(true);
  });

  it('opens on an empty stock when the world has no save', async () => {
    const game = await boot('?bot=off&openworld=7');
    await inTown(game, { resources: rich });
    await indexedDbStore().delete('openworld:7'); // the save is gone
    await open();
    expect(text('workshop-stock')).toBe('Wood 0 · Ore 0 · Parts 0 · Shards 0');
    expect(text('workshop-army')).toBe('Army 0 / 6 · Bringing 0 / 3');
  });
});

// The wild fight (docs/specs/openworld.md section 3c) with the special marbles of the army placed on its side.
type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const { seed, home } = (() => {
  for (let n = 1; n < 100; n++) {
    for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as Axial[]) {
      const flat = world_enemies(n, cx, cy);
      for (let i = 0; i < flat.length; i += 2) if (Math.max(Math.abs(flat[i]!), Math.abs(flat[i + 1]!), Math.abs(flat[i]! + flat[i + 1]!)) <= 10) return { seed: n, home: [flat[i]!, flat[i + 1]!] as Axial };
    }
  }
  throw new Error('no seed');
})();
const beside: Axial = [home[0] + 1, home[1]];
const specials = (): number[] => (data().specials ?? '').split(' ').filter(Boolean).map((s) => Number(s.split(',')[2])).sort((a, b) => a - b);

afterEach(() => vi.useRealTimers());

describe('a wild fight in a biome (#1738)', () => {
  it('stands the biome on the board and gives the bot two of its special marbles, and the bot searches the same board', async () => {
    const game = await boot('?openworld=3&nodes=40');
    const { Engine } = await import('edgefall-wasm');
    const withFoes = vi.spyOn(Engine, 'with_foes');
    byId('openworld').click();
    await settle();
    hooks().__openworldFixture({ hero: [-30, 30], troop: [] }); // the badlands of seed 3 (south-west)
    const [q, r] = hooks().__openworldEnemies().find(([eq, er]) => eq < -25 && er > 25)!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: [q! + 1, r!], troop: [] });
    document.getElementById('openworld-ask-fight')!.click();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(data().wildBiome).toBe('badlands');
    expect(data().space).toBe('badlands'); // the arena in the badlands' light
    expect(specials()).toEqual([1, 1]); // two Heavies on the bot's side
    const plan = Array.from(withFoes.mock.calls[0]![1] as Int32Array);
    expect(plan.slice(0, 3)).toEqual([14, 0, 4]); // 14 marbles, the standard formation, the badlands' holes
    game.click(0, 2);
    game.click(0, 1);
    await game.settle();
    game.frame(1000); // the bot's move waits for the slide of the human's
    for (let i = 0; i < 20 && game.hook<number>('__plies') < 2; i++) await game.settle();
    expect(game.hook<number>('__plies')).toBe(2); // the bot answered
    expect(withFoes.mock.calls.length).toBeGreaterThanOrEqual(2); // on an engine of the same plan, in its worker
    expect(Array.from(withFoes.mock.calls.at(-1)![1] as Int32Array)).toEqual(plan);
  });
});

describe('the special marbles in a wild fight (#1655)', () => {
  /** A world with the stock loaded and the hero put next to a marble: the wipe closes, the arena opens. */
  async function met(stock: Stock, url = `?openworld=${seed}&nodes=40`, options: Parameters<typeof boot>[1] = {}, booted: () => Promise<void> = async () => {}): Promise<Game> {
    const game = await boot(url, options);
    await booted(); // the page's own copy of the bridge is loaded: a spy set here sees what it calls
    byId('openworld').click();
    await settle();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hooks().__openworldFixture({ hero: beside, troop: [], ...stock });
    document.getElementById('openworld-ask-fight')!.click(); // the wild marble asks first (#1662)
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    return game;
  }
  /** The army saved with the world of the seed, as the next entry reads it. */
  const saved = async (): Promise<{ specials: number[]; brought: number[] }> => {
    await settle();
    return ((await indexedDbStore().get(`openworld:${seed}`)) as { army: { specials: number[]; brought: number[] } }).army;
  };
  /** The fight over: the engine says `status` once a move is played, and its board holds only the special marbles of `kinds`. */
  async function over(game: Game, status: number, kinds: number[]): Promise<void> {
    const { Engine } = await import('edgefall-wasm');
    const real = Engine.prototype.specials;
    vi.spyOn(Engine.prototype, 'status').mockImplementation(() => (game.hook<number>('__plies') > 0 ? status : 0));
    vi.spyOn(Engine.prototype, 'specials').mockImplementation(function (this: InstanceType<typeof Engine>) {
      const flat = Array.from(real.call(this));
      return Int32Array.from(Array.from({ length: flat.length / 3 }, (_, i) => flat.slice(3 * i, 3 * i + 3)).filter((rec) => kinds.includes(rec[2]!)).flat());
    });
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
  }

  /** The human plays a move and the bot answers it, as in a game of the bot (the answer comes from the worker of the page, in the process). */
  async function exchange(game: Game): Promise<void> {
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    await game.settle();
    game.frame(1000); // the bot's move waits for the slide of the human's
  }

  it('places the brought marbles on the side of the army, one on each, and the bot searches the same board', async () => {
    let withArmy: ReturnType<typeof vi.spyOn>;
    const game = await met({ army: army([1, 1, 9], [1, 9]) }, undefined, {}, async () => void (withArmy = vi.spyOn((await import('edgefall-wasm')).Engine, 'with_army')));
    expect(specials()).toEqual([1, 9]);
    expect(withArmy.mock.calls).toEqual([[14, 14]]); // the page's engine: the standard board, the rogue-lite flag
    expect(game.hook<number>('__plies')).toBe(0);
    await exchange(game);
    expect(game.hook<number>('__plies')).toBe(2); // the bot answered
    expect(withArmy.mock.calls).toEqual([[14, 14], [14, 14]]); // on an engine of the same army, in its worker
  });

  it('places nothing when the army brings nothing: the fight is the plain one, and so is the bot\'s engine', async () => {
    let withArmy: ReturnType<typeof vi.spyOn>;
    const game = await met({ army: army([1, 9], []) }, undefined, {}, async () => void (withArmy = vi.spyOn((await import('edgefall-wasm')).Engine, 'with_army')));
    expect(specials()).toEqual([]);
    await exchange(game);
    expect(game.hook<number>('__plies')).toBe(2);
    expect(withArmy).not.toHaveBeenCalled();
  });

  it('a special marble thrown off in a lost fight is gone from the army, the others stay, and it is told once', async () => {
    const game = await met({ army: army([1, 1, 9], [1, 9]) });
    await over(game, 2, [9]); // the Heavy is thrown off, the Bomb stays
    expect(game.hud()).toContain('Lost: Heavy.');
    byId('boss-goal').click(); // the HUD is drawn again: the loss counts once
    await settle();
    expect(await saved()).toMatchObject({ specials: [1, 9], brought: [9] });
    expect(game.hud()).toContain('Lost: Heavy.');
  });

  it('a won fight keeps the marbles that stayed, and tells nothing lost', async () => {
    const game = await met({ army: army([1, 9], [1, 9]) });
    await over(game, 1, [1, 9]);
    expect(game.hud()).toContain('The marble is gone from the world.');
    expect(game.hud()).not.toContain('Lost');
    expect(await saved()).toMatchObject({ specials: [1, 9], brought: [1, 9] });
  });

  it('a won fight loses the ones thrown off too: a spent Bomb is gone', async () => {
    const game = await met({ army: army([1, 9], [1, 9]) });
    await over(game, 1, [1]);
    expect(game.hud()).toContain('The marble is gone from the world. Lost: Bomb.');
    expect(await saved()).toMatchObject({ specials: [1], brought: [1] });
  });

  it('a fight with none brought loses nothing', async () => {
    const game = await met({ army: army([1, 9], []) });
    await over(game, 2, []);
    expect(game.hud()).not.toContain('Lost');
    expect(await saved()).toMatchObject({ specials: [1, 9], brought: [] });
  });

  it('Flee keeps every marble', async () => {
    const game = await met({ army: army([1, 9], [1, 9]) });
    byId('wild-flee').click();
    await settle();
    expect(data().openworld).toBe(String(seed));
    expect(game.hud()).not.toContain('Lost');
    expect(await saved()).toMatchObject({ specials: [1, 9], brought: [1, 9] });
  });

  it('sets the relics brought before the first move, in the army engine too (the bot searches the same board)', async () => {
    let setRelics: ReturnType<typeof vi.spyOn>;
    const game = await met({ army: { specials: [1], brought: [1], relics: [0, 4], relicsBrought: [0, 4] } }, undefined, {}, async () => void (setRelics = vi.spyOn((await import('edgefall-wasm')).Engine.prototype, 'set_relics')));
    expect(setRelics.mock.calls).toEqual([[0b1_0001]]);
    await exchange(game);
    expect(game.hook<number>('__plies')).toBe(2);
    expect(setRelics.mock.calls).toEqual([[0b1_0001], [0b1_0001]]);
  });

  it('a relic alone, with no special marble, makes the army fight, and the Saboteur gives the bot one marble fewer', async () => {
    let withArmy: ReturnType<typeof vi.spyOn>;
    const game = await met({ army: { specials: [], brought: [], relics: [8], relicsBrought: [8] } }, undefined, {}, async () => void (withArmy = vi.spyOn((await import('edgefall-wasm')).Engine, 'with_army')));
    expect(withArmy.mock.calls).toEqual([[14, 13]]);
    await exchange(game);
    expect(game.hook<number>('__plies')).toBe(2);
    expect(withArmy.mock.calls).toEqual([[14, 13], [14, 13]]);
  });

  it('the Hull plating keeps the first special marble lost: the army keeps it and the banner says so', async () => {
    const game = await met({ army: { specials: [1, 1, 9], brought: [1, 9], relics: [1], relicsBrought: [1] } });
    await over(game, 2, [9]); // the Heavy is thrown off
    expect(game.hud()).toContain('Hull plating kept Heavy.');
    expect(game.hud()).not.toContain('Lost:');
    expect(await saved()).toMatchObject({ specials: [1, 1, 9], brought: [1, 9] });
  });

  it('the Hull plating keeps only the first of two lost', async () => {
    const game = await met({ army: { specials: [1, 9], brought: [1, 9], relics: [1], relicsBrought: [1] } });
    await over(game, 2, []);
    expect(game.hud()).toContain('Lost: Bomb. Hull plating kept Heavy.');
    expect(await saved()).toMatchObject({ specials: [1], brought: [1] });
  });

  it('a world whose save is gone loses nothing and writes nothing', async () => {
    const game = await met({ army: army([1], [1]) });
    await indexedDbStore().delete(`openworld:${seed}`);
    await over(game, 2, []);
    await settle();
    expect(await indexedDbStore().get(`openworld:${seed}`)).toBeUndefined();
  });
});

describe('no other fight has a special marble (#1655)', () => {
  const brought = { army: { specials: [1, 9], brought: [1, 9], relics: [0, 11], relicsBrought: [0, 11] }, resources: rich };

  it.each(['arena', 'boss'] as const)('the %s entered after the world, with the army brought, has none', async (mode) => {
    const game = await boot(`?openworld=${seed}`);
    byId('openworld').click();
    await settle();
    hooks().__openworldFixture({ hero: [0, 0], troop: [], enemies: [], ...brought });
    byId('exit').click(); // the Hub of the menu: the world is left, its army with it
    await settle();
    const { Engine, Encounter } = await import('edgefall-wasm');
    const spies = [vi.spyOn(Engine.prototype, 'set_relics'), vi.spyOn(Engine.prototype, 'place_special'), vi.spyOn(Encounter.prototype, 'set_relics'), vi.spyOn(Encounter.prototype, 'place_special')];
    await game.hook<Promise<void>>('__enterMode', mode);
    await settle();
    expect(data().specials ?? '').toBe('');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled(); // no relic, no special marble: the fight's digest is the plain one's
    vi.restoreAllMocks();
  });

  it('a plain game of the bot, the Hub of the menu and a run start with no special marble from the world', async () => {
    const game = await boot('?bot=off');
    expect(data().specials ?? '').toBe('');
    void game;
  });
});

// The lair of the world (docs/specs/openworld.md section 7) entered by walking onto it: the brought marbles and relics, for the bosses that take a build.
describe('the army in a lair fight walked into from the world (#1655)', () => {
  const brought = { army: { specials: [1, 1, 9], brought: [1, 9], relics: [0, 1], relicsBrought: [0, 1] }, resources: rich };
  /** The lairs of seed 7 by what their boss takes: the index of the first boss that takes the army's build, and of the first that does not. */
  async function lairs(): Promise<{ builds: number; plain: number }> {
    const { boss_ids, boss_takes_build } = await import('edgefall-wasm');
    const ids = boss_ids();
    return { builds: ids.findIndex((id) => boss_takes_build(id)), plain: ids.findIndex((id) => !boss_takes_build(id)) };
  }
  /** The world of seed 7 with the stock loaded, and the hero stepped onto lair `lair` from the west. */
  async function walkInto(stock: Stock, lair: number, booted: () => Promise<void> = async () => {}): Promise<Game> {
    const game = await boot('?openworld=7', { reducedMotion: true });
    await booted(); // the page's own copy of the bridge is loaded: a spy set here sees what it calls
    byId('openworld').click();
    await settle();
    const [q, r] = data().openworldLairs!.split(' ')[lair]!.split(',').map(Number) as unknown as Axial;
    hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [], ...stock });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    document.getElementById('hub-confirm-yes')?.click(); // a tower or a gate opens its bay first: Enter starts the fight or the run (#1694)
    await settle();
    return game;
  }
  const saved = async (): Promise<{ specials: number[]; brought: number[] }> => {
    await settle();
    return ((await indexedDbStore().get('openworld:7')) as { army: { specials: number[]; brought: number[] } }).army;
  };
  /** The lair fight over with `status` once a move is played, its board holding only the special marbles of `kinds`. */
  async function finish(game: Game, status: number, kinds: number[]): Promise<void> {
    const { Encounter } = await import('edgefall-wasm');
    const real = Encounter.prototype.specials;
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(() => (game.hook<number>('__plies') > 0 ? status : 0));
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(() => (game.hook<number>('__plies') > 0 ? status : 0));
    vi.spyOn(Encounter.prototype, 'specials').mockImplementation(function (this: InstanceType<typeof Encounter>) {
      const flat = Array.from(real.call(this));
      return Int32Array.from(Array.from({ length: flat.length / 3 }, (_, i) => flat.slice(3 * i, 3 * i + 3)).filter((rec) => kinds.includes(rec[2]!)).flat());
    });
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
  }
  const placedKinds = (spy: { mock: { calls: unknown[][] } }): number[] => spy.mock.calls.map((call) => call[2] as number).sort((a, b) => a - b);

  it('places the brought marbles and sets the brought relics in a lair whose boss takes the build, and the bot gets the same', async () => {
    let place!: ReturnType<typeof vi.spyOn>, relics!: ReturnType<typeof vi.spyOn>;
    const game = await walkInto(brought, (await lairs()).builds, async () => {
      const { Encounter } = await import('edgefall-wasm');
      place = vi.spyOn(Encounter.prototype, 'place_special');
      relics = vi.spyOn(Encounter.prototype, 'set_relics');
      vi.spyOn(Encounter.prototype, 'boss_move').mockImplementation(function (this: InstanceType<typeof Encounter>) {
        return this.legal_moves().slice(0, MOVE_STRIDE); // the boss answers at once with its first move: the search is not what is tested
      });
    });
    expect(data().boss).toBeTruthy();
    expect(data().specials!.split(' ').map((s) => Number(s.split(',')[2])).sort()).toEqual([1, 9]);
    expect(placedKinds(place)).toEqual([1, 9]);
    expect(relics.mock.calls).toEqual([[0b11]]);
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    for (let i = 0; i < 50 && game.hook<number>('__plies') < 2; i++) {
      await game.settle();
      game.frame(1000);
    }
    expect(game.hook<number>('__plies')).toBe(2); // the boss answered
    expect(placedKinds(place)).toEqual([1, 1, 9, 9]); // the bot's engine of the same fight, in its worker
    expect(relics.mock.calls).toEqual([[0b11], [0b11]]);
    vi.restoreAllMocks();
  });

  it('a boss that takes no build places nothing and sets nothing, and a lair with an empty army is the plain fight', async () => {
    let place!: ReturnType<typeof vi.spyOn>, relics!: ReturnType<typeof vi.spyOn>;
    const spy = async (): Promise<void> => {
      const { Encounter } = await import('edgefall-wasm');
      place = vi.spyOn(Encounter.prototype, 'place_special');
      relics = vi.spyOn(Encounter.prototype, 'set_relics');
    };
    await walkInto(brought, (await lairs()).plain, spy);
    expect(data().specials ?? '').toBe('');
    expect(place).not.toHaveBeenCalled();
    expect(relics).not.toHaveBeenCalled();
    await walkInto({ army: army([], []), resources: rich }, (await lairs()).builds, spy);
    expect(relics).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('loses the marbles thrown off in a lair fight, once, and the Retry brings only the ones left', async () => {
    const game = await walkInto(brought, (await lairs()).builds);
    await finish(game, 2, [9]); // the Heavy is thrown off, the Hull plating keeps it
    expect(game.hud()).toContain('Hull plating kept Heavy.');
    expect(await saved()).toMatchObject({ specials: [1, 1, 9], brought: [1, 9] });
    vi.restoreAllMocks();
    let place!: ReturnType<typeof vi.spyOn>;
    const again = await walkInto({ ...brought, army: { ...brought.army, relics: [0], relicsBrought: [0] } }, (await lairs()).builds, async () => void (place = vi.spyOn((await import('edgefall-wasm')).Encounter.prototype, 'place_special')));
    await finish(again, 2, [9]);
    expect(again.hud()).toContain('Lost: Heavy.');
    expect(await saved()).toMatchObject({ specials: [1, 9], brought: [9] });
    place.mockClear();
    byId('boss-retry').click();
    expect(placedKinds(place)).toEqual([9]); // the Heavy is not placed again for free
    vi.restoreAllMocks();
  });

  it('a won lair fight tells what was lost too, and leaving it keeps everything', async () => {
    const game = await walkInto({ ...brought, army: { ...brought.army, relics: [], relicsBrought: [] } }, (await lairs()).builds);
    await finish(game, 1, [1, 9]);
    expect(game.hud()).toContain('Medal earned');
    expect(game.hud()).not.toContain('Lost');
    expect(await saved()).toMatchObject({ specials: [1, 1, 9], brought: [1, 9] });
    vi.restoreAllMocks();
    const left = await walkInto({ ...brought, army: { ...brought.army, relics: [], relicsBrought: [] } }, (await lairs()).builds);
    byId('exit').click(); // Back to the Open world before the end: Flee keeps all
    await settle();
    expect(left.hud()).not.toContain('Lost');
    expect(await saved()).toMatchObject({ specials: [1, 1, 9], brought: [1, 9] });
  });
});
