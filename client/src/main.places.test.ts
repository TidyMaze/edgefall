// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Axial } from './board';
import { CHUNK } from './openworld';
import { BIOMES } from './roguelite';
import { TOWN_LINES } from './tally';
import { boot, type Game } from './test/harness';

// The towns and dungeon gates of the Open world (#1593, docs/specs/openworld.md section 13): rolling onto a town opens the Hub, rolling onto a
// gate starts the rogue-lite run, and "Back to the Open world" returns the hero to the entrance cell, as a lair does (#1170).

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const hooks = () => window as unknown as { __openworldFixture: (f: { hero: Axial; troop: Axial[]; enemies: Axial[] }) => void };

/** Opens the world of seed 7, stands the hero west of the first place of `kind` and rolls onto it. Returns the entrance cell. */
async function rollOnto(game: Game, kind: 'town' | 'dungeon', open = true, nth = 0): Promise<Axial> {
  if (open) {
    byId('openworld').click();
    await settle();
  }
  const [q, r] = data()
    .openworldPlaces!.split(' ')
    .filter((p) => p.startsWith(`${kind}:`))[nth]!
    .slice(kind.length + 1)
    .split(',')
    .map(Number) as unknown as Axial;
  hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  return [q - 1, r];
}

describe('a town of the Open world (#1593)', () => {
  it('rolling onto a town leaves the world and opens the Hub, with a button back to the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    expect(byId('exit').dataset.label).toBe('Hub'); // the world's own way out (#1517)
    await rollOnto(game, 'town');
    expect(data().openworld).toBeUndefined();
    expect(data().hub).toBeTruthy();
    expect(byId('exit').hidden).toBe(false);
    expect(byId('exit').textContent).toBe('Back to the Open world');
    expect(byId('exit').dataset.label).toBe('World');
  });

  it('the button puts the hero back on the entrance cell, and is gone', async () => {
    const game = await boot('?bot=off&openworld=7');
    const entrance = await rollOnto(game, 'town');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().hub).toBeUndefined();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(byId('exit').dataset.label).toBe('Hub'); // the world's own way out again
  });

  it('a table entered from the Hub of a town and left by the Hub of the menu keeps the way back to the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: [] }));
    const entrance = await rollOnto(game, 'town');
    expect(data().hub).toBe('mess -1,0');
    game.click(-1, -1); // the hot-seat table
    expect(data().hub).toBeUndefined();
    expect(byId('exit').dataset.label).toBe('Hub'); // a game, not the Hub: it leads to the Hub
    byId('ship').click();
    expect(byId('exit').hidden).toBe(false);
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
  });

  it('the Hub reached from the menu has no way back to a world', async () => {
    const game = await boot('?bot=off');
    byId('ship').click();
    expect(data().hub).toBeTruthy();
    expect(byId('exit').hidden).toBe(true);
  });

  it('another mode picked in the Hub of a town ends the way back: it is no town\'s', async () => {
    const game = await boot('?bot=off&openworld=7');
    await rollOnto(game, 'town');
    byId('trainer').click();
    expect(byId('exit').dataset.label).toBe('Hub');
    byId('ship').click();
    expect(data().hub).toBeTruthy();
    expect(byId('exit').hidden).toBe(true);
  });

  it('the Open world of the menu, from the Hub of a town, is the world as it was left, and the button is gone', async () => {
    const game = await boot('?bot=off&openworld=7');
    const entrance = await rollOnto(game, 'town');
    await settle();
    byId('openworld').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(byId('exit').dataset.label).toBe('Hub'); // in the world again
  });
});

// #1516: a town enters on Tally's ledger line for it, by its index, from its stage (world.md section 13): nothing before.
describe('the ledger line of a town (#1516)', () => {
  const story = (...moments: number[]): { storage: Record<string, string> } => ({ storage: { 'ab-alone.story': JSON.stringify({ moments, wins: 0 }) } });

  it('shows the line of the spawn town on the plate of the Hub when the stage is reached', async () => {
    const game = await boot('?bot=off&openworld=7', story(2));
    await rollOnto(game, 'town');
    expect(game.hud()).toContain(TOWN_LINES[0]!.line);
  });

  it('shows the line of the town entered, not the first one: the index counts the towns', async () => {
    const game = await boot('?bot=off&openworld=7', story(2, 3, 4, 5));
    await rollOnto(game, 'town', true, 3);
    expect(game.hud()).toContain(TOWN_LINES[3]!.line);
    expect(game.hud()).not.toContain(TOWN_LINES[0]!.line);
  });

  it('shows nothing before the stage of the line', async () => {
    const game = await boot('?bot=off&openworld=7');
    await rollOnto(game, 'town');
    for (const { line } of TOWN_LINES) expect(game.hud()).not.toContain(line);
    expect(byId('hud').querySelector('.tally')).toBeNull();
  });

  it('shows no line on the Hub of the mode menu, and none once the player moves', async () => {
    const game = await boot('?bot=off&openworld=7', story(2));
    await rollOnto(game, 'town');
    game.click(-1, 0);
    expect(game.hud()).not.toContain(TOWN_LINES[0]!.line);
    byId('exit').click();
    await settle();
    byId('ship').click();
    expect(game.hud()).not.toContain(TOWN_LINES[0]!.line);
  });
});

describe('a dungeon gate of the Open world (#1593)', () => {
  it('rolling onto a gate leaves the world and opens the rogue-lite run at its start screen, with a button back to the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    await rollOnto(game, 'dungeon');
    expect(data().openworld).toBeUndefined();
    expect(data().run).toBe('map');
    expect(byId('run-map').hidden).toBe(false);
    expect(byId('exit').hidden).toBe(false);
  });

  it('the button leaves the run for the world, the hero on the entrance cell', async () => {
    const game = await boot('?bot=off&openworld=7');
    const entrance = await rollOnto(game, 'dungeon');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().run).toBeUndefined();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(byId('exit').dataset.label).toBe('Hub');
  });

  it('the run starts in the biome of the ground the gate stands in, #1597', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    const gates = data().openworldPlaces!.split(' ').filter((p) => p.startsWith('dungeon:')).map((p) => p.slice(8).split(',').map(Number) as unknown as Axial);
    const { world_chunk } = await import('edgefall-wasm');
    const biomeAt = ([q, r]: Axial): number => {
      const [cx, cy] = [Math.floor(q / CHUNK), Math.floor(r / CHUNK)];
      return world_chunk(7, cx, cy)[((r - cy * CHUNK) * CHUNK + (q - cx * CHUNK)) * 3 + 2]!;
    };
    const nth = gates.findIndex((gate) => biomeAt(gate) > 0);
    expect(nth, 'one gate of seed 7 stands outside the Meadow').toBeGreaterThanOrEqual(0);
    await rollOnto(game, 'dungeon', false, nth);
    expect(data().run).toBe('map');
    expect(data().biome).toBe(BIOMES[biomeAt(gates[nth]!)]!.id);
  });

  it('a run started from the menu has no way back to a world', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('roguelite').click();
    expect(data().run).toBe('map');
    expect(byId('exit').dataset.label).toBe('Hub');
  });
});

// The transition of a place (#1519, docs/specs/motion.md story 10): started with the place, never in its way, and the matching one on the way back.
describe('the transition of a place (#1519)', () => {
  const cue = () => document.getElementById('place-transition');
  const titled = () => cue()!.querySelector('.pt-title')!.textContent;

  it('a town shows its cue and its name while the Hub is already live, and the way back shows the same cue without a name', async () => {
    const game = await boot('?bot=off&openworld=7');
    await rollOnto(game, 'town');
    expect(data().hub).toBeTruthy();
    expect(data().placeTransition).toBe('enter');
    expect(cue()!.dataset.kind).toBe('town');
    expect(titled()).toBe('Muster point · the Hub');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().openworld).toBe('7');
    expect(data().placeTransition).toBe('back');
    expect(cue()!.dataset.kind).toBe('town');
    expect(titled()).toBe('');
  });

  it('a gate shows its cue and the name of the run, and comes back with it', async () => {
    const game = await boot('?bot=off&openworld=7');
    await rollOnto(game, 'dungeon');
    expect(data().run).toBe('map');
    expect(cue()!.dataset.kind).toBe('dungeon');
    expect(titled()).toBe('Mining cut · Rogue-lite run');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().placeTransition).toBe('back');
    expect(cue()!.dataset.kind).toBe('dungeon');
  });

  it('a tower shows its cue and the name of its boss over the fight that is live, and comes back with it', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
    hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(data().boss).toBe('echo');
    expect(cue()!.dataset.kind).toBe('tower');
    expect(titled()).toBe('The Echo');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().placeTransition).toBe('back');
    expect(cue()!.dataset.kind).toBe('tower');
  });

  it('under reduced motion the name stays and nothing moves, and the way back is a cut', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    await rollOnto(game, 'dungeon');
    expect(cue()!.dataset.motion).toBe('cut');
    expect(titled()).toBe('Mining cut · Rogue-lite run');
    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    byId('exit').click();
    await settle();
    expect(data().placeTransition).toBeUndefined();
  });
});
