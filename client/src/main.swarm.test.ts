// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import text from '../../crates/edgefall-core/tests/fixtures/swarm.txt?raw';
import { EVAC_MS } from './swarm';
import { parseRecorded } from './test/chaplain-game';
import { boot, type Game, startBoss } from './test/harness';

// The Swarm (#1008, #1266, game-design.md section 7.14) from the recorded win of the core tests (fight seed 0, ?bot=off):
// the player starts in the centre, its wave is announced on a ring on any edge, the HUD counts the turns to the evac, a
// swarm ejection jumps the clock by 2, the boss bar drains with the clock, and the evac lights the whole board.

type Shown = { left: number; passed: boolean; jump: number; cells: [number, number][]; evac: boolean; glow: number; lift: number } | null;
const PLIES = parseRecorded(text);
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const tell = (): string | null | undefined => byId('hud').querySelector('.boss .tell')?.textContent;
const shown = (game: Game): Shown => game.hook<Shown>('__swarm');
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);
const frags = (cls = ''): number => byId('boss-bar').querySelectorAll(`.frag${cls}`).length;

/** Catches the scene main.ts builds: call before boot. */
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && !scene) scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}

/** Starts the fight against The Swarm from the test hook, on the recorded fight's seed 0. */
function fightSwarm(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(0);
    return a;
  });
  startBoss('The Swarm');
}

describe('main.ts The Swarm (#1008)', () => {
  it('plays on the Cargo deck, its wave announced on a ring, the turns and its loss line on the HUD', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    expect(shown(game)).toBeNull();
    fightSwarm(game);
    expect(document.body.dataset.deck).toBe('cargo');
    expect(tell()).toBe('40 turns to the evac · 3 marbles land on their marks next turn · the swarm wins after it ejects 2 of your marbles');
    const s = shown(game)!;
    expect(s).toMatchObject({ left: 40, passed: false, jump: 0, evac: false });
    expect(game.hook('__marbleTurn', 0, 0)).not.toBeNull(); // the player starts in the centre
    expect(named(scene(), 'swarm-mark')).toHaveLength(3);
    expect(document.body.dataset.swarmMarks).toBe(s.cells.map((c) => c.join(',')).join(' '));
    expect(game.hud()).toContain('ejected 0 · ');
    expect(game.hud()).toContain('ejected 0/2');
    expect([frags(), frags('.empty'), frags('.step')]).toEqual([40, 0, 0]); // the bar holds the 40 turns of the clock, no step
    expect(game.hud()).toContain('Waves on file. Forty turns to the evac.');
  });

  it('lands the wave on its mark, counts a turn down and drains the bar by one', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightSwarm(game);
    const [cell] = shown(game)!.cells;
    game.hook('__playMoves', PLIES.slice(0, 1));
    expect(game.hook('__marbleTurn', ...cell!)).not.toBeNull(); // the swarm marble landed on its mark
    game.hook('__playMoves', PLIES.slice(1, 2));
    expect(tell()).toMatch(/^39 turns to the evac · 3 marbles land on their marks next turn/);
    expect(frags('.empty')).toBe(1);
  });

  it('marks arrivals on every edge, the player side too, and a swarm ejection jumps the clock by 2', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightSwarm(game);
    const marks: [number, number][] = [];
    let jumped = '';
    for (let ply = 0; ply < PLIES.length - 1; ply++) {
      const before = shown(game)!.left;
      game.hook('__playMoves', PLIES.slice(ply, ply + 1));
      const now = shown(game)!;
      marks.push(...now.cells);
      if (ply % 2 === 0 && now.jump > 0 && !jumped) {
        expect(now.left).toBe(before - now.jump); // the player's ejection, before the boss reply
        jumped = tell()!;
      }
    }
    expect(marks.some(([, r]) => r > 0)).toBe(true); // the player's start side
    expect(marks.some(([, r]) => r < 0)).toBe(true);
    expect(jumped).toMatch(/^\d+ turns to the evac \(-2\) · /);
  });

  it('the evac lights the whole board after the 30th reply and lifts the marbles', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    fightSwarm(game);
    game.hook('__playMoves', PLIES);
    expect(game.hook('__fight')).toMatchObject({ id: 'swarm' });
    expect(tell()).toBe('The evac lifts you out');
    expect(named(scene(), 'swarm-mark')).toHaveLength(0);
    const glow = named(scene(), 'swarm-evac') as THREE.InstancedMesh[];
    expect(glow).toHaveLength(1);
    expect(glow[0]!.count).toBe(61);
    expect(shown(game)).toMatchObject({ left: 0, evac: true, glow: 0, lift: 0 });
    game.frame(EVAC_MS / 2);
    expect(shown(game)!.glow).toBeGreaterThan(0);
    expect(shown(game)!.lift).toBeGreaterThan(0);
    game.frame(EVAC_MS);
    const done = shown(game)!;
    game.frame(EVAC_MS);
    expect(shown(game)).toEqual(done); // over: it stays lit and still
    game.hook('__playMoves', []); // a redraw keeps the evac where it is
    expect(shown(game)).toEqual(done);
    byId('boss-retry').click();
    expect(shown(game)).toMatchObject({ left: 40, evac: false });
    expect(named(scene(), 'swarm-evac')).toHaveLength(0);
  });

  it('with reduced motion the evac light fades in and no marble moves', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    fightSwarm(game);
    game.hook('__playMoves', PLIES);
    game.frame(EVAC_MS / 2);
    expect(shown(game)!.glow).toBeGreaterThan(0);
    expect(shown(game)!.lift).toBe(0);
  });
});
