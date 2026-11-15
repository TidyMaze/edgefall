// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { BLAST_MS, BLAST_SHARDS } from './martyr';
import { ANNOUNCED_AT, EXPLODED_AT, SEED } from './test/chaplain-game';
import { recordedGame } from './test/chaplain-fixture';
import { boot, type Game, startBoss } from './test/harness';

// The Chaplain's martyr on the harness (#748, game-design.md section 7.3): after 4 ejections one boss marble wears a
// steady ember ring and a tall glyph and the HUD says it explodes next boss turn; then it explodes, a flash and a ring
// of shards (reduced motion: a static flash) over the marbles it converted. The recorded game of the core tests is
// played by the __playMoves hook, the martyr is announced after ply 52 and explodes at ply 54.

const byId = (id: string): HTMLElement => document.getElementById(id)!;
const body = (): DOMStringMap => document.body.dataset;
const tell = (): string | undefined => byId('hud').querySelector('.boss .tell')?.textContent ?? undefined;
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => scene.getObjectsByProperty('name', name);

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

/** Starts The Chaplain on the fight seed of the recorded game. */
function fightChaplain(game: Game): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => {
    (a as Uint32Array).fill(SEED);
    return a;
  });
  startBoss('The Chaplain');
}

const played = (game: Game, from: number, to: number): number => game.hook<number>('__playMoves', recordedGame().slice(from, to));

describe('main.ts The Chaplain martyr (#748)', () => {
  it('after 4 ejections one boss marble wears the martyr tell and the HUD says it explodes next boss turn', async () => {
    const scene = catchScene();
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightChaplain(game);
    expect(played(game, 0, ANNOUNCED_AT - 1)).toBe(ANNOUNCED_AT - 1);
    expect(body().martyr).toBe('');
    expect(named(scene(), 'martyr-ring')).toHaveLength(0);
    expect(tell() ?? '').not.toContain('Martyr');
    expect(played(game, ANNOUNCED_AT - 1, ANNOUNCED_AT)).toBe(1);
    expect(body().martyr).toMatch(/^-?\d,-?\d$/);
    expect(named(scene(), 'martyr-ring')).toHaveLength(1);
    expect(named(scene(), 'martyr-glyph')).toHaveLength(1);
    expect(tell()).toContain('Martyr marked: it explodes at the end of the next boss turn');
    expect(byId('hud').querySelectorAll('.boss .notch')).toHaveLength(2); // two phases, no P3
  }, 60_000);

  it('the martyr explodes: a flash and a ring of shards that fade, the tell is gone, the 5th ejection is counted', async () => {
    const scene = catchScene();
    const game = await boot('?nodes=200', { reducedMotion: false });
    fightChaplain(game);
    played(game, 0, EXPLODED_AT - 2);
    expect(body().explosions).toBeUndefined();
    played(game, EXPLODED_AT - 2, EXPLODED_AT);
    expect(body().explosions).toBeUndefined(); // the push slides first
    game.frame(1000);
    expect(body().explosions).toBe('1');
    expect(body().exploding).toBe('1');
    expect(body().martyr).toBe('');
    expect(named(scene(), 'martyr-ring')).toHaveLength(0);
    expect(game.hook('__blast')).toMatchObject({ shards: BLAST_SHARDS, reduced: false });
    expect(named(scene(), 'martyr-blast')).toHaveLength(1);
    game.frame(0);
    const flash = (game.hook('__blast') as { flash: number }).flash;
    game.frame(BLAST_MS / 2);
    expect((game.hook('__blast') as { flash: number }).flash).toBeLessThan(flash);
    game.frame(BLAST_MS);
    expect(game.hook('__blast')).toBeNull();
    expect(body().exploding).toBeUndefined();
    expect(named(scene(), 'martyr-blast')).toHaveLength(0);
    expect(game.hud()).toContain('White ejected 5/6');
  }, 60_000);

  it('with reduced motion the explosion is a static flash, no shard', async () => {
    const game = await boot('?nodes=200', { reducedMotion: true });
    fightChaplain(game);
    played(game, 0, EXPLODED_AT);
    expect(game.hook('__blast')).toMatchObject({ shards: 0, reduced: true });
  }, 60_000);
});
