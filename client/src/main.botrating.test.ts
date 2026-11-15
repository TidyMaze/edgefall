// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { boot, startBoss } from './test/harness';

// The bot's estimated rating and level in the fight HUD (#1611, docs/specs/roguelite.md section 32): a plain bot game and a run fight.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = (): HTMLElement | null => document.querySelector('#hud .bot-rating');
const normal = { 'ab-alone.difficulty': 'normal' }; // the bot rating is measured at a known difficulty, not at the default (Easy, #1664)
const medals = (n: number): Record<string, string> => ({ 'ab-alone.medals': JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`boss${i}`, 9]))) });

describe('main.ts, the bot rating, #1611', () => {
  it('a new player meets the lowest bot: about 1070, Easy, and says it is an estimate', async () => {
    await boot('?real=1', { storage: normal });
    expect(badge()!.textContent).toBe('Bot ~1070 · Easy');
    expect(badge()!.title).toMatch(/estimate/i);
    expect(document.body.dataset.botRating).toBe('1070');
  });

  it('the bot grows with the bosses beaten: all fifteen medals is the peak, 60000 positions, Hard', async () => {
    await boot('?real=1', { storage: { ...normal, ...medals(15) } });
    expect(badge()!.textContent).toBe('Bot ~1600 · Hard');
    await boot('?real=1', { storage: { ...normal, ...medals(40) } }); // more than the roster counts for nothing more
    expect(badge()!.textContent).toBe('Bot ~1600 · Hard');
  });

  it('the difficulty setting multiplies the budget: Hard doubles it', async () => {
    await boot('?real=1', { storage: { 'ab-alone.difficulty': 'hard' } });
    expect(badge()!.textContent).toBe('Bot ~1130 · Easy');
  });

  it('a test budget (?nodes) is not scaled by the medals', async () => {
    await boot('?nodes=50', { storage: { ...normal, ...medals(15) } });
    expect(badge()!.textContent).toBe('Bot ~940 · Easy');
  });

  it('the first fight of a run is at a quarter of the bot of the medals, and no badge on the map', async () => {
    const game = await boot('?real=1', { storage: normal, indexedDB: new IDBFactory() });
    byId('roguelite').click();
    expect(badge()).toBeNull();
    [...byId('run-map').querySelectorAll<HTMLButtonElement>('button[data-node]')].find((b) => !b.disabled)!.click();
    expect(badge()!.textContent).toBe('Bot ~940 · Easy'); // 200 positions at 25 %: 50
  });

  it('a boss fight reads Boss from its own search budget, with the same tooltip, the difficulty percent applied as the engine does', async () => {
    const game = await boot('?real=1', { storage: normal });
    startBoss('The Echo'); // The Echo: 100 positions
    expect(badge()!.textContent).toBe('Boss ~1000 · Easy');
    expect(badge()!.title).toMatch(/estimate/i);
    expect(document.body.dataset.botRating).toBe('1000');
    await boot('?real=1', { storage: { 'ab-alone.difficulty': 'hard' } });
    startBoss('The Echo'); // 200 positions
    expect(badge()!.textContent).toBe('Boss ~1070 · Easy');
  });

  it('the Choir and the Swarm read their own budgets, and a boss fight needs no bot worker', async () => {
    const game = await boot('?bot=off', { storage: normal });
    const pick = (name: string) => startBoss(name);
    pick('The Swarm');
    expect(badge()!.textContent).toBe('Boss ~1260 · Easy'); // 1500 positions
    pick('The Choir');
    expect(badge()!.textContent).toMatch(/^Boss ~\d+ · /);
  });

  it('the Daily shows its boss rating too', async () => {
    const game = await boot('?real=1', { storage: normal });
    byId('daily').click();
    expect(badge()!.textContent).toMatch(/^Boss ~\d+ · /);
  });

  it('a boss of a run reads its act percent: the first act boss searches half', async () => {
    const game = await boot('?real=1', { storage: normal, indexedDB: new IDBFactory() });
    const { boss_ids, run_map } = await import('edgefall-wasm');
    const { actBoss, parseMap, pick, newRun } = await import('./roguelite');
    const { LEGACY_UNLOCKED } = await import('./collector');
    const nodes = parseMap(run_map(3));
    const path: number[] = [0];
    for (let n = nodes[0]!; n.kind !== 'boss'; ) {
      const i = nodes.findIndex((m) => m.act === n.act && m.row === n.row + 1 && m.col === n.links[0]);
      path.push(i);
      n = nodes[i]!;
    }
    const state = pick({ ...newRun(3, 3, LEGACY_UNLOCKED), enemies: false, path: path.slice(0, -1) }, path[path.length - 1]!);
    await game.hook('__run', state);
    const boss = actBoss(nodes, state, boss_ids())!;
    expect(boss.percent).toBe(50);
    const { Encounter } = await import('edgefall-wasm');
    const nodesOf = new Encounter(boss.id, 0).node_budget(boss.percent);
    const { ratingOfBudget } = await import('./botrating');
    expect(badge()!.textContent).toMatch(new RegExp(`^Boss ~${ratingOfBudget(nodesOf)} · `));
  });
});
