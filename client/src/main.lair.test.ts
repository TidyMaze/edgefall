// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Axial } from './board';
import { CLAIM_NOTE } from './openworldgoal';
import { PLACE_LINES } from './placelines';
import { boot, type Game, startBoss } from './test/harness';

// The boss lairs of the Open world (#1170): the hero walks onto a lair and the normal boss fight starts; a win records the medal
// and the lair in the world's save; Back returns to the Open world with the hero on the lair's entrance.

type Move = { cells: Axial[]; dir: number };
const DIRS: Axial[] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const data = () => document.body.dataset;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
};
const hooks = () => window as unknown as { __openworldFixture: (f: { hero: Axial; troop: Axial[]; enemies: Axial[] }) => void };

/** Enters the world of seed 7 and walks onto lair `lair` from the cell west of it (the hook stands the hero there). */
async function walkOnto(game: Game, lair: number, open = true): Promise<Axial> {
  if (open) {
    byId('openworld').click();
    await settle();
  }
  const [q, r] = data().openworldLairs!.split(' ')[lair]!.split(',').map(Number) as unknown as Axial;
  hooks().__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  document.getElementById('hub-confirm-yes')?.click(); // a tower or a gate opens its bay first: Enter starts the fight or the run (#1694)
  return [q - 1, r];
}

describe('the boss lairs of the Open world (#1170)', () => {
  it('walking onto a lair leaves the world and starts a boss fight, the lair numbers choosing the boss', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    expect(data().openworldLairs!.split(' ')).toHaveLength((await import('edgefall-wasm')).boss_ids().length); // one lair per boss of the roster (#1171)
    expect(data().openworldLairsBeaten).toBe('');
    await walkOnto(game, 0);
    expect(data().openworld).toBeUndefined();
    const first = data().boss;
    expect(first).toBeTruthy();
    expect(byId('boss-retry').hidden).toBe(false);
    expect(byId('exit').hidden).toBe(false); // the way out is there while the fight is on (#1517)
    expect(byId('exit').dataset.label).toBe('World');
    await settle();
    await walkOnto(game, 1);
    expect(data().boss).not.toBe(first);
  });

  it('a win records the medal and the lair, and Back to the Open world shows it beaten with the hero on the entrance', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    const { Encounter } = await import('edgefall-wasm');
    const entrance = await walkOnto(game, 0);
    const won = (): number => (game.hook<number>('__plies') > 0 ? 1 : 0);
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(won);
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(won);
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    expect(game.hud()).toContain('Medal earned');
    expect(byId('exit').hidden).toBe(false);
    expect(byId('exit').textContent).toBe('Back to the Open world');
    await settle();
    byId('exit').click();
    await settle();
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(data().openworldLairsBeaten).toBe('0');
    expect(byId('openworld-medals').textContent).toBe(`Medals 1 / ${(await import('edgefall-wasm')).boss_ids().length}`); // the HUD reads the shared medal store (#1171)
    expect(JSON.parse(localStorage.getItem('ab-alone.medals')!)).toEqual({ [Object.keys(JSON.parse(localStorage.getItem('ab-alone.medals')!))[0]!]: 1 });
  });

  it('a lost fight sends Back to the Open world with the lair unbeaten, and Retry keeps the fight the lair\'s', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    const { Encounter } = await import('edgefall-wasm');
    const entrance = await walkOnto(game, 2);
    byId('boss-retry').click();
    expect(byId('exit').textContent).toBe('Back to the Open world');
    const lost = (): number => (game.hook<number>('__plies') > 0 ? 2 : 0);
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(lost);
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(lost);
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    expect(byId('exit').hidden).toBe(false);
    byId('exit').click();
    await settle();
    expect(game.hook<number>('__plies')).toBe(0); // the table beneath the world is the saved game again, not the lost fight's board (#1517)
    expect(data().openworldAt).toBe(entrance.join(','));
    expect(data().openworldLairsBeaten).toBe('');
    expect(byId('openworld-medals').textContent).toBe(`Medals 0 / ${(await import('edgefall-wasm')).boss_ids().length}`);
  });

  it('a boss picked from the menu is no lair\'s: its way out is the Hub, not the world', async () => {
    const game = await boot('?bot=off&openworld=7');
    await walkOnto(game, 0);
    startBoss('The Echo');
    vi.spyOn((await import('edgefall-wasm')).Encounter.prototype, 'status').mockImplementation(() => 2);
    byId('boss-goal').click();
    expect(byId('exit').hidden).toBe(false);
    expect(byId('exit').dataset.label).toBe('Hub');
  });
});

describe('the day and the night of the Open world (#1496)', () => {
  const setTime = (ms: number): void => (window as unknown as { __openworldTime: (ms: number) => void }).__openworldTime(ms);
  const MIN = 60_000;

  it('the test hook sets the time of day and the page reads the phase', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    expect(data().openworldPhase).toBe('day');
    setTime(6.5 * MIN);
    expect(data().openworldPhase).toBe('dusk');
    setTime(9 * MIN);
    expect(data().openworldPhase).toBe('night');
  });

  it('a lair entered at night starts the fight on the night board, Retry keeps it, and Back returns to the same hour', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    byId('openworld').click();
    await settle();
    setTime(9 * MIN);
    await walkOnto(game, 0, false); // the world is open: the hero steps onto the lair at night
    expect(data().openworld).toBeUndefined();
    expect(data().fightBoard).toBe('night');
    byId('boss-retry').click();
    expect(data().fightBoard).toBe('night');
    const { Encounter } = await import('edgefall-wasm');
    vi.spyOn(Encounter.prototype, 'status').mockImplementation(() => 2);
    vi.spyOn(Encounter.prototype, 'result').mockImplementation(() => 2);
    const move = game.hook<Move[]>('__legal').find((m) => m.cells.length === 1 && (m.dir === 2 || m.dir === 4))!;
    const [q, r] = move.cells[0]!;
    game.click(q, r);
    game.click(q + DIRS[move.dir]![0], r + DIRS[move.dir]![1]);
    byId('exit').click();
    await settle();
    expect(data().fightBoard).toBeUndefined(); // the world is back, the board is nobody's
    expect(data().openworldPhase).toBe('night');
  });

  it('a lair entered at dusk and at day takes their boards; a boss picked from the menu keeps the ordinary board', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    await walkOnto(game, 0);
    expect(data().fightBoard).toBe('day');
    byId('openworld').click();
    await settle();
    expect(data().openworldPhase).toBe('day'); // the first fight left the world at the start of day
    setTime(6.5 * MIN);
    await walkOnto(game, 1, false);
    expect(data().fightBoard).toBe('dusk');
    startBoss('The Echo');
    expect(data().fightBoard).toBeUndefined();
  });
});

describe('the boss camera of a lair pushes in (#1519)', () => {
  it('its frames run until the push-in ends, and a press with nothing running is nothing', async () => {
    const game = await boot('?bot=off&openworld=7');
    await walkOnto(game, 0); // the fight starts, the push-in with it
    expect(data().boss).toBeTruthy();
    game.frame(100); // a frame during the push-in: the view eases
    game.frame(400); // past its 350 ms: this frame draws the final framing
    game.frame(100);
    window.dispatchEvent(new Event('pointerdown'));
    expect(data().boss).toBeTruthy();
  });

  it('a press during the push-in snaps it to the final framing', async () => {
    const game = await boot('?bot=off&openworld=7');
    await walkOnto(game, 0);
    window.dispatchEvent(new Event('pointerdown')); // the push-in is running: it ends on this press
    game.frame(100); // no push-in now: the frame draws the view as it is
    expect(data().boss).toBeTruthy();
  });
});

describe("Tally's line in the Open world (#1171)", () => {
  it('shows "Claim: unworked." the first time the player opens an Open world, and never again (the line number comes with stage 5, #1584)', async () => {
    const game = await boot('?bot=off&openworld=7'); // the link opens the world at the load (#1361)
    await settle();
    expect(byId('openworld-tally').textContent).toBe(`Claim: unworked. ${CLAIM_NOTE}`);
    expect(localStorage.getItem('ab-alone.tally0412')).toBe('seen');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    byId('openworld').click();
    await settle();
    expect(byId('openworld-tally').textContent).toBe('');
  });
});

describe("Tally's first-visit line from stage 5 (#1584)", () => {
  it('names the claim, 0412, once the player is delivered, at stage 5', async () => {
    await boot('?bot=off&openworld=7', { storage: { 'ab-alone.story': JSON.stringify({ moments: [2, 3, 4, 5], wins: 0 }) } });
    await settle();
    expect(byId('openworld-tally').textContent).toBe(`Claim 0412: unworked. ${CLAIM_NOTE}`);
  });

  it('keeps the number back at stage 4', async () => {
    await boot('?bot=off&openworld=7', { storage: { 'ab-alone.story': JSON.stringify({ moments: [2, 3, 4], wins: 0 }) } });
    await settle();
    expect(byId('openworld-tally').textContent).toBe(`Claim: unworked. ${CLAIM_NOTE}`);
  });
});

describe("Tally's ending and ledger lines (#1175, #1315)", () => {
  const fixture = (beaten: number[]): void =>
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [], enemies: [], beaten });

  it("shows Tally's ending line once every lair is beaten, and nothing while one is left, #1175", async () => {
    localStorage.setItem('ab-alone.tally0412', 'seen'); // the claim line is spent
    await boot('?bot=off&openworld=7', { storage: { 'ab-alone.story': JSON.stringify({ moments: [2, 3, 4, 5, 6, 7], wins: 0 }) } }); // the clamp opens at stage 7 (#1546)
    await settle();
    expect(data().openworldAt).toBe('0,0');
    const count = data().openworldLairs!.split(' ').length;
    fixture(Array.from({ length: count - 1 }, (_, i) => i)); // all lairs but one
    expect(byId('openworld-tally').textContent).toBe('');
    fixture(Array.from({ length: count }, (_, i) => i));
    expect(byId('openworld-tally').textContent).toBe('Variance noted. Clamp: open. Crew attached: 6.');
  });

  it('says the clamp is locked while the story is short of stage 7, #1546', async () => {
    localStorage.setItem('ab-alone.tally0412', 'seen');
    await boot('?bot=off&openworld=7');
    await settle();
    fixture(Array.from({ length: data().openworldLairs!.split(' ').length }, (_, i) => i));
    expect(byId('openworld-tally').textContent).toBe('Variance noted. Clamp: locked. Crew attached: 6.');
  });

  it('opens the clamp in the ledger line from stage 7, #1546', async () => {
    const game = await boot('?bot=off&openworld=7', { storage: { 'ab-alone.story': JSON.stringify({ moments: [2, 3, 4, 5, 6, 7], wins: 0 }) } });
    await settle();
    const count = data().openworldLairs!.split(' ').length;
    fixture([0, 1, 2]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    byId('openworld').click();
    await settle();
    expect(byId('openworld-tally').textContent).toBe(`Seats on file: 3 of ${count}. Clamp: open.`);
  });

  it('the ledger line counts the seats on file after the world is left and opened again, #1315', async () => {
    const game = await boot('?bot=off&openworld=7');
    await settle();
    const count = data().openworldLairs!.split(' ').length;
    fixture([0, 1, 2]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // leaving the world saves it
    await settle();
    expect(data().openworldSaved).toBe('1');
    byId('openworld').click();
    await settle();
    expect(data().openworld).toBe('7');
    expect(byId('openworld-tally').textContent).toBe(`Seats on file: 3 of ${count}. Slag-glass remembers heat.`);
  });
});

describe('the Dungeon button of the HUD (#1291)', () => {
  it('walks the hero toward the nearest tower through the wasm bridge', async () => {
    const game = await boot('?bot=off&openworld=7');
    byId('openworld').click();
    await settle();
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
    hooks().__openworldFixture({ hero: [q - 3, r], troop: [], enemies: [] });
    byId('openworld-dungeon').click();
    expect(byId('openworld-dungeon-note').textContent).toBe('');
    expect(data().openworldAt).not.toBe(`${q - 3},${r}`); // the first cell of the walk is taken at once
  });
});

describe('the goal of the Open world on arrival (#1530)', () => {
  it('says the objective with the count of towers and the bearing to the nearest, keeps the controls collapsed, and H opens them', async () => {
    await boot('?bot=off&openworld=7');
    await settle();
    const count = (await import('edgefall-wasm')).boss_ids().length;
    expect(byId('openworld-goal').textContent).toBe(`Goal: beat the ${count} towers of Hollow. One medal each.`);
    expect(byId('openworld-bearing').textContent).toMatch(/^Nearest tower: \d+ cells?, (to the |straight )(upper |lower )?\w+\.$/);
    expect(byId('openworld-medals').textContent).toBe(`Medals 0 / ${count}`);
    expect(byId('openworld-dungeon').textContent).toBe('Nearest tower');
    const controls = byId<HTMLDetailsElement>('openworld-controls') as unknown as HTMLDetailsElement;
    expect(controls.open).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    expect(controls.open).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    expect(controls.open).toBe(false);
  });
});

describe("the choice of the Echo's mirror before a tower (#1620)", () => {
  it('after The Echo is beaten, a tower that takes the mirror asks first, and the choice starts the fight with it', async () => {
    const game = await boot('?bot=off&openworld=7', { storage: { 'ab-alone.medals': JSON.stringify({ echo: 9 }) } });
    await walkOnto(game, 0); // The Echo's own tower has the mirror already: no question
    expect(byId('trait').hidden).toBe(true);
    expect(data().boss).toBe('echo');
    await settle();
    await walkOnto(game, 1); // the second tower is The Hull's
    expect(byId('trait').hidden).toBe(false);
    expect(byId('trait-yes').textContent).toMatch(/^Bring the Echo's mirror \(cost: /);
    expect(data().boss).not.toBe('hull');
    byId('trait-yes').click();
    expect(byId('trait').hidden).toBe(true);
    expect(data().boss).toBe('hull');
    expect(localStorage.getItem('ab-alone.medal-trait')).toBe('mirror');
  });
});

describe("Tally's place lines (#1315)", () => {
  it('files the first tower the hero walks up to in the HUD line, once for the player', async () => {
    localStorage.setItem('ab-alone.tally0412', 'seen');
    await boot('?bot=off&openworld=7');
    await settle();
    const [q, r] = data().openworldLairs!.split(' ')[0]!.split(',').map(Number) as unknown as Axial;
    hooks().__openworldFixture({ hero: [q - 2, r], troop: [], enemies: [] });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(data().openworldAt).toBe(`${q - 1},${r}`);
    expect(byId('openworld-tally').textContent).toBe(PLACE_LINES.tower);
    expect(localStorage.getItem('ab-alone.placelines')!.split(' ')).toContain('tower');
  });
});
