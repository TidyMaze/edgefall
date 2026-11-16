// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boot, type Game } from './test/harness';

// The next goal in the Hub Cutaway (#1695): the beacon on the goal's bay, the dotted route and the marble's tag, the goal line (phone) and the card with Go (window). The pure parts are in
// hubgoal.test.ts; here the wiring of the page: the goal of the game, the redraw when it or the marble changes, the tap that rolls, the visit of a tower, the flag off.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const progress = (beaten: string[]): Record<string, string> => ({ 'ab-alone.progress': JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten }) });
const RAN = { 'ab-alone.roguelite': '2' }; // a run played: the goal after The Echo is the next seat
const line = (): HTMLButtonElement => byId<HTMLButtonElement>('ship-goal-line');
const go = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#ship-gocard button')!;
const tag = (): HTMLElement => document.querySelector<HTMLElement>('#ship-goal .tag')!;
const routeD = (): string => document.querySelector('#ship-goal path')!.getAttribute('d')!;
const rings = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#ship-goal .ring')];

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
async function ship(query = '?bot=off', beaten: string[] = [], options: Parameters<typeof boot>[1] = {}): Promise<Game> {
  const game = await boot(query, { ...options, storage: { ...progress(beaten), ...options.storage } });
  game.hook('__startMode', 'hub');
  await game.settle();
  expect(document.body.dataset.hubCutaway).toBe('true');
  return game;
}

describe('the goal line and the card', () => {
  it("say the game's next goal, and follow it after a win", async () => {
    await ship();
    expect(line().textContent).toBe('Next goal: beat The Echo on the Mess deck.');
    expect(line().dataset.bay).toBe('mess:echo');
    expect(byId('ship-gocard').querySelector('b')!.textContent).toBe('Beat The Echo');
    await ship('?bot=off', ['echo']);
    expect(line().textContent).toBe('Next goal: start a rogue-lite run on the Cargo deck.');
    expect(line().dataset.bay).toBe('cargo:run');
    expect(go().dataset.bay).toBe('cargo:run');
  });

  it('name the first win for a new player, whose goal bay is the House table', async () => {
    const game = await boot('?bot=off&newplayer');
    game.hook('__startMode', 'hub');
    await game.settle();
    expect(line().textContent).toBe('Next goal: win your first game against the bot at the House table.');
    expect(line().dataset.bay).toBe('mess:bot');
  });

  it('are idle once all five are beaten: the sentence of the game, nothing to roll to', async () => {
    await ship('?bot=off', ['echo', 'hull', 'choir', 'chaplain', 'ballast'], { storage: RAN });
    expect(line().textContent).toBe('All bosses beaten. Try the Daily or a run.');
    expect(line().disabled).toBe(true);
    expect(rings().every((r) => r.hidden)).toBe(true);
  });

  it('roll the marble to the goal and start its room, from the line or from Go', async () => {
    for (const button of [line, go]) {
      const game = await ship('?bot=off', ['echo']);
      const run = frames(game);
      button().click();
      run(400);
      run(400);
      expect(document.body.dataset.hub).toBeUndefined(); // the run started: the Hub is left
    }
  });

  it('go with the ship: a game or the Open world leaves no goal line, card, route or tag behind', async () => {
    const game = await ship('?bot=off', ['echo']);
    expect(line().hidden).toBe(false);
    game.hook('__startMode', 'arena');
    await game.settle();
    expect(line().hidden).toBe(true);
    expect(byId('ship-gocard').hidden).toBe(true);
    expect(byId('ship-goal').hidden).toBe(true);
  });

  it("are gone during a tower's visit, which has its own bay and its own exit", async () => {
    const game = await ship();
    game.hook('__openBay', 'tower', 'echo');
    await game.settle();
    expect(line().hidden).toBe(true);
    expect(byId('ship-gocard').hidden).toBe(true);
    expect(byId('ship-goal').hidden).toBe(true);
  });
});

