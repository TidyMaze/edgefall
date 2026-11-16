// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Axial } from './board';
import { BIOMES } from './roguelite';
import { boot, type Game } from './test/harness';

// A tower, a gate and a town of the Open world open the Hub Cutaway on their bay (#1694): the boss's room amber with the confirm up (the Mining cut for a gate,
// its biome kept), the town's ship on the Mess. Enter starts the fight or the run the tower or the gate started, Stay and the exit return to the tower or the gate.

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const bay = (key: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`#ship-bays [data-bay="${key}"]`)!;
const hooks = () => window as unknown as { __openworldFixture: (f: { hero: Axial; troop: Axial[]; enemies: Axial[] }) => void };
/** The frames the page asks for are run by hand, with the page's clock moved by the same amount. */
function frames(game: Game): (ms: number) => void {
  const queued = new Map<number, () => void>();
  let next = 1;
  const request = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => (queued.set(next, cb), next++));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id));
  onTestFinished(() => {
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
  });
  return (ms) => {
    game.frame(ms);
    const due = [...queued.values()];
    queued.clear();
    for (const cb of due) cb();
  };
}
const QUERY = '?bot=off&openworld=7';

/** Rolls the hero onto the cell `[q, r]` from its west neighbour; the entrance cell is returned. */
async function rollOnto(game: Game, at: () => Axial | Promise<Axial>, open = true): Promise<Axial> {
  if (open) {
    byId('openworld').click();
    await settle();
  }
  const [q, r] = await at();
  hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  await settle();
  return [q - 1, r];
}
const tower = (lair: number): Axial => data().openworldLairs!.split(' ')[lair]!.split(',').map(Number) as unknown as Axial;
const place = (kind: 'town' | 'dungeon'): Axial => data().openworldPlaces!.split(' ').find((p) => p.startsWith(`${kind}:`))!.slice(kind.length + 1).split(',').map(Number) as unknown as Axial;
const lairOf = async (id: string): Promise<number> => (await import('edgefall-wasm')).boss_ids().indexOf(id);

describe('a tower opens the ship on its boss bay (#1694)', () => {
  it('leaves the world, opens the ship with the bay amber and the confirm up, and starts no fight', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    expect(data().openworld).toBeUndefined();
    expect(data().hubCutaway).toBe('true');
    expect(data().hub).toMatch(/^mess /);
    expect(data().boss).toBeUndefined();
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('hub-confirm-text').textContent).toMatch(/^Enter .*Echo.*\?$/);
    expect(bay('mess:echo').dataset.state).toBe('goal');
    expect(byId('exit').dataset.label).toBe('Tower');
  });

  it('Enter starts the fight of the lair, and its exit leads back to the tower', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, async () => tower(await lairOf('echo')));
    byId('hub-confirm-yes').click();
    await settle();
    expect(data().boss).toBe('echo');
    expect(data().hub).toBeUndefined();
    expect(byId('exit').dataset.label).toBe('World');
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
  });

  it('Stay puts the hero back on the cell of the tower, no fight started', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, async () => tower(await lairOf('echo')));
    byId('hub-confirm-no').click();
    await settle();
    expect(data().hub).toBeUndefined();
    expect(data().boss).toBeUndefined();
    expect(data().openworldAt).toBe(entrance.join(','));
  });

  it('the exit of the ship leads back to the tower too, and the next Hub is an ordinary one', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, async () => tower(await lairOf('echo')));
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
    byId('exit').click(); // the world's own exit: the Hub
    await settle();
    expect(data().hub).toBeTruthy();
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(bay('furnace:choir')).toBeNull(); // the deck is shut again: no tile (#1729)
  });

  it('a tower whose deck is still shut opens the ship on that deck anyway, the bay lit, and Enter starts its fight', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('choir')));
    expect(data().hub).toMatch(/^furnace /);
    expect(bay('furnace:choir').dataset.state).toBe('goal');
    expect(byId('hub-confirm').hidden).toBe(false);
    byId('hub-confirm-yes').click();
    await settle();
    expect(data().boss).toBe('choir');
  });
});

describe('a visit rolls to its own bay only (#1694)', () => {
  it('on the deck, another room takes no roll either: no fight, the confirm stays (#1694)', async () => {
    const game = await boot(QUERY, { deck: true });
    await rollOnto(game, async () => tower(await lairOf('echo')));
    const { roomsOf } = await import('./hub');
    const [q, r] = roomsOf('mess').find((room) => room.door.kind === 'bot')!.cell;
    game.click(q, r); // a tap elsewhere puts the confirm away, as on the deck; the room is not the visit's: nothing rolls there
    await settle();
    expect(data().boss).toBeUndefined();
    expect(data().hub).toMatch(/^mess /);
  });

  it('another bay takes no tap: no fight, no mode, the confirm stays', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    bay('mess:bot').click();
    await settle();
    expect(data().boss).toBeUndefined();
    expect(data().hub).toMatch(/^mess /);
    expect(byId('hub-confirm').hidden).toBe(false);
    byId('hub-confirm-yes').click();
    await settle();
    expect(data().boss).toBe('echo');
  });

  it('under the first-win lock a locked mode bay starts nothing either', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    bay('mess:daily').click();
    await settle();
    expect(data().boss).toBeUndefined();
    expect(data().hub).toMatch(/^mess /);
  });

  it('a key onto a shut hatch does not move the visit off its bay', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    const run = frames(game);
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      run(200);
    }
    expect(byId('hud').textContent).not.toContain('Lift to Cargo'); // the visit's refusal says nothing of the lift
    expect(data().hub).toMatch(/^mess /);
    expect(data().boss).toBeUndefined();
  });
});

describe('the visit around the ship (#1694)', () => {
  it('the dock holds the exit alone, named for the tower, and the plate says where the visit came from', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    expect(data().bayVisit).toBe('tower');
    expect(byId('exit').textContent).toMatch(/^Back to .*Echo.*tower$/);
    expect(byId('hud').textContent).toMatch(/You came in by .*Echo.*tower\./);
    expect(byId('hud-fold').getAttribute('aria-label')).toMatch(/Echo.*tower/);
    byId('hub-confirm-no').click();
    await settle();
    expect(data().bayVisit).toBeUndefined();
    expect(byId('hud-fold').getAttribute('aria-label')).toBe('HUD panel');
  });

  it('a gate names the gate', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, () => place('dungeon'));
    expect(data().bayVisit).toBe('gate');
    expect(byId('exit').textContent).toBe('Back to the gate');
    expect(byId('hud').textContent).toContain('dungeon gate');
  });

  it('a second visit by another tower renames the exit', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, async () => tower(await lairOf('echo')));
    const first = byId('exit').textContent;
    byId('hub-confirm-no').click();
    await settle();
    await rollOnto(game, async () => tower(await lairOf('hull')), false);
    expect(byId('exit').textContent).not.toBe(first);
  });

  it('Stay keeps the table beneath and the world as it was', async () => {
    const game = await boot(QUERY);
    const plies = game.hook<number>('__plies');
    const entrance = await rollOnto(game, async () => tower(await lairOf('echo')));
    byId('hub-confirm-no').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(game.hook<number>('__plies')).toBe(plies);
    expect(data().openworldLairsBeaten).toBe('');
    expect(data().boss).toBeUndefined();
    expect(data().fightBoard).toBeUndefined();
  });
});

describe('the Echo mirror question of a tower (#1694)', () => {
  const asked = async () => {
    const wasm = await import('edgefall-wasm');
    return wasm.boss_ids().find((b) => wasm.boss_takes_mirror(b))!;
  };
  it('is asked on Enter, and leaving the ship hides it for good: no fight starts from the world later', async () => {
    const id = await asked();
    const game = await boot(QUERY, { storage: { 'ab-alone.medals': JSON.stringify({ echo: 1 }) } });
    const entrance = await rollOnto(game, async () => tower(await lairOf(id)));
    byId('hub-confirm-yes').click();
    await settle();
    expect(byId('trait').hidden).toBe(false);
    expect(data().boss).toBeUndefined();
    byId('exit').click();
    await settle();
    expect(byId('trait').hidden).toBe(true);
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(data().boss).toBeUndefined();
  });

  it('answering starts the fight', async () => {
    const id = await asked();
    const game = await boot(QUERY, { storage: { 'ab-alone.medals': JSON.stringify({ echo: 1 }) } });
    await rollOnto(game, async () => tower(await lairOf(id)));
    byId('hub-confirm-yes').click();
    byId('trait-no').click();
    await settle();
    expect(data().boss).toBe(id);
  });
});

describe('the test hook opens a bay with no walk (#1694)', () => {
  it('__openBay tower and gate', async () => {
    const game = await boot(QUERY);
    game.hook('__openBay', 'tower', 'echo');
    await settle();
    expect(byId('hub-confirm').hidden).toBe(false);
    byId('hub-confirm-no').click();
    await settle();
    game.hook('__openBay', 'tower');
    await settle();
    expect(data().hub).toMatch(/^mess /);
    game.hook('__openBay', 'gate');
    await settle();
    expect(data().hub).toMatch(/^cargo /);
  });

  it('needs no ?openworld: the public world is the way back', async () => {
    const game = await boot('?bot=off');
    game.hook('__openBay', 'gate');
    await settle();
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('exit').textContent).toBe('Back to the gate');
  });
});

describe('a gate opens the ship on the Mining cut (#1694)', () => {
  it('amber bay, confirm up, no run started', async () => {
    const game = await boot(QUERY);
    await rollOnto(game, () => place('dungeon'));
    expect(data().hubCutaway).toBe('true');
    expect(data().hub).toMatch(/^cargo /);
    expect(data().run).toBeUndefined();
    expect(bay('cargo:run').dataset.state).toBe('goal');
    expect(byId('hub-confirm').hidden).toBe(false);
    expect(byId('hub-confirm-text').textContent).toMatch(/^Enter .*\?$/);
  });

  it('Enter starts the run in the biome of the gate, and its exit leads back to the gate', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, () => place('dungeon'));
    byId('hub-confirm-yes').click();
    await settle();
    expect(data().run).toBeTruthy();
    expect(data().biome).toMatch(new RegExp(`^(${BIOMES.map(({ id }) => id).join('|')})$`));
    expect(byId('exit').dataset.label).toBe('World');
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
  });

  it('Stay returns to the gate, and a run from the Hub afterwards begins in the Meadow', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, () => place('dungeon'));
    byId('hub-confirm-no').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(data().run).toBeUndefined();
    byId('exit').click(); // the Hub
    await settle();
    byId('roguelite').click();
    await settle();
    expect(data().biome).toBeUndefined();
  });
});

describe('a town opens the ship on the Mess (#1694)', () => {
  it('with its Workshop and its way back, and no confirm', async () => {
    const game = await boot(QUERY);
    const entrance = await rollOnto(game, () => place('town'));
    expect(data().hubCutaway).toBe('true');
    expect(data().hub).toBe('mess 0,0');
    expect(byId('hub-confirm').hidden).toBe(true);
    expect(byId('workshop-open').hidden).toBe(false);
    expect(byId('exit').dataset.label).toBe('World');
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
  });
});
