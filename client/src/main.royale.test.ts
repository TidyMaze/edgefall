// @vitest-environment jsdom
import type * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { axialTo3D, type Axial } from './board';
import type { View } from './camera';
import { MARK_MS, STEP_MS } from './royale-reveal';
import { SLIDE_MS } from './slide';
import { boot, slowKeys, type Game, startBoss } from './test/harness';

// The offline battle royale on the harness (#502): Battle royale in the mode menu starts 1 player against 5 bots on
// the radius 8 arena, at the Furnace. The player presses a target on the arena, which locks the order, or holds; the
// round resolves and the HUD plate shows the reveal log in initiative order, a fizzle marked, and the next round's
// initiative before its reveal. A boss fight or Play online leaves it.

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const button = (id: string): HTMLButtonElement => byId<HTMLButtonElement>(id);
const items = (selector: string): string[] => [...byId('hud').querySelectorAll(selector)].map((li) => li.textContent!);
const turn = (): string => byId('hud').querySelector('.turn')!.textContent!;
const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
function tap(game: Game, q: number, r: number): void {
  const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', q, r);
  for (const type of ['pointerdown', 'pointerup'])
    canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
}
async function royale(): Promise<Game> {
  const game = await boot('?bot=off');
  button('battle-royale').click();
  return game;
}
// Seat 0 orders (-6, 3) E, a marble of Bot 1: it fizzles.
const FIZZLE = [0, 1, 0, -6, 3, 0, 0, 0, 0];
// Everyone holds 12 rounds: ring 8, its 48 cells, cracks at the end of round 12 and goes void at the end of round 13.
const CRACKED = { seed: 7, rounds: Array.from({ length: 12 }, () => []) };
// The player walks its 4 columns NW to radius 5 or less in 11 rounds while the bots hold on the rim: the void of ring 6
// at the end of round 25 takes the bots' last marbles together, the player is first (the same file as e2e/royale.spec.ts).
const NW = (...cells: Axial[]): number[] => [0, cells.length, 4, ...[...cells, [0, 0], [0, 0]].slice(0, 3).flat()];
const column = (cells: Axial[], steps: number): number[][] =>
  Array.from({ length: steps }, (_, s) => NW(...cells.map(([q, r]): Axial => [q, r - s])));
const END = {
  seed: 7,
  rounds: [
    ...column([[-4, 8], [-4, 7], [-4, 6]], 3),
    ...column([[-3, 8], [-3, 7], [-3, 6]], 3),
    ...column([[-5, 8], [-5, 7]], 3),
    ...column([[-2, 7], [-2, 6]], 2),
    ...Array.from({ length: 14 }, () => []),
  ],
};

describe('main.ts, the offline battle royale (#502)', () => {
  it('Battle royale starts round 1 on the arena at the Furnace, its initiative shown, Hold on and no Lock order (#611)', async () => {
    const game = await royale();
    expect(document.body.dataset.royale).toBe('1');
    expect(document.body.dataset.deck).toBe('furnace');
    expect(turn()).toBe('Battle royale · Round 1');
    expect(items('.initiative li')).toEqual(['You', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5']);
    expect(byId('hud').textContent).not.toContain('Your order');
    expect(items('.reveal li')).toEqual([]);
    expect(game.hook<{ drawn: boolean }>('__frame').drawn).toBe(false); // the radius 4 frame is put away
    expect(byId('royale-lock')).toBeNull();
    expect(button('royale-hold').hidden).toBe(false);
    expect(button('royale-hold').disabled).toBe(false);
    for (const id of ['new-game', 'boss-retry', 'hint', 'eval', 'setting-export-game', 'setting-import-game'])
      expect(byId(id).hidden, id).toBe(true);
  });

  it('a press on a marble of the player selects it, a press on a target locks the order and plays the round (#611)', async () => {
    const game = await royale();
    tap(game, -6, 3); // a marble of Bot 1: nothing
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    tap(game, -4, 8); // the player's marble is selected
    expect(game.hook<Axial[]>('__rings')).toEqual([[-4, 8]]);
    tap(game, 0, 0); // the hole in the centre (#610): no target there, nothing changes, no prop behind opens
    expect(document.body.dataset.reading).toBeUndefined();
    expect(game.hook<Axial[]>('__rings')).toEqual([[-4, 8]]);
    expect(turn()).toBe('Battle royale · Round 1');
    game.click(-4, 8);
    expect(game.hook<Axial[]>('__rings')).toEqual([]); // a second press lets it go
    game.click(-2, 6);
    expect(game.hook<{ cell: Axial }[]>('__targets').map((t) => t.cell)).toContainEqual([-2, 5]);
    const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', -2, 5);
    canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 2, bubbles: true }));
    expect(document.body.dataset.ghosts).toBeUndefined(); // no ghost over the arena: the board's ghosts are not drawn (#1275)
    game.click(-2, 5); // (-2, 6) NW: the round resolves at once
    game.frame(10_000); // its reveal plays out (#612)
    expect(document.body.dataset.royale).toBe('2');
    expect(turn()).toBe('Battle royale · Round 2');
    expect(items('.initiative li')).toEqual(['Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'You']);
    expect(items('.reveal li')[0]).toBe('You: moved');
    expect(items('.reveal li').map((t) => t.split(':')[0])).toEqual(['You', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5']);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
  });

  // A drag on the arena plays as on the board (#1646): it selects the player's marbles in line and pushes them.
  const drag = (game: Game, type: string, q: number, r: number): void => {
    const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', q, r);
    canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
  };
  it('a drag from a marble of the player selects the column it passes over, never orbits, and pushes it where it is released (#1646)', async () => {
    const game = await royale();
    const corner = game.hook<{ x: number; y: number }>('__cellToScreen', 8, -8);
    drag(game, 'pointerdown', -4, 8);
    drag(game, 'pointermove', -4, 7);
    drag(game, 'pointermove', -6, 3); // a marble of Bot 1: not taken
    drag(game, 'pointermove', -4, 6);
    expect(game.hook<Axial[]>('__rings')).toEqual([[-4, 8], [-4, 7], [-4, 6]]);
    expect(game.hook<{ x: number; y: number }>('__cellToScreen', 8, -8)).toEqual(corner); // the camera stays
    drag(game, 'pointerup', -4, 7); // released on the column: no order, the selection stays
    expect(game.hook<Axial[]>('__rings')).toHaveLength(3);
    expect(turn()).toBe('Battle royale · Round 1');
    drag(game, 'pointerdown', -4, 8);
    drag(game, 'pointermove', -4, 7);
    drag(game, 'pointermove', -4, 6);
    drag(game, 'pointerup', -4, 4); // two steps NW of (-4, 6): the column moves NW
    game.frame(10_000);
    expect(turn()).toBe('Battle royale · Round 2');
    expect(items('.reveal li')[0]).toBe('You: moved');
  });

  it('a drag released toward a blocked direction orders nothing, and a drag from an empty cell or a bot marble orbits (#1646)', async () => {
    const game = await royale();
    drag(game, 'pointerdown', -4, 8);
    drag(game, 'pointermove', -4, 7);
    drag(game, 'pointerup', -4, 10); // SE of (-4, 8): off the arena, no legal order
    expect(game.hook<Axial[]>('__rings')).toEqual([[-4, 8], [-4, 7]]);
    expect(turn()).toBe('Battle royale · Round 1');
    for (const [q, r] of [[0, 0], [-6, 3]] as Axial[]) {
      const corner = game.hook<{ x: number; y: number }>('__cellToScreen', 8, -8);
      const at = game.hook<{ x: number; y: number }>('__cellToScreen', q, r);
      for (const [type, dx] of [['pointerdown', 0], ['pointermove', 40], ['pointerup', 40]] as const)
        canvas().dispatchEvent(new PointerEvent(type, { clientX: at.x + dx, clientY: at.y, pointerId: 1, bubbles: true }));
      expect(game.hook<{ x: number; y: number }>('__cellToScreen', 8, -8)).not.toEqual(corner);
    }
    game.hook('__royale', END); // over: a drag from the player's marble selects nothing
    drag(game, 'pointerdown', -4, 4);
    drag(game, 'pointermove', -4, 3);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
  });

  it("each seat's marbles on the arena wear the seat's glyph, a picked one too (#558)", async () => {
    const game = await royale();
    expect(game.hook<number[]>('__seatGlyphs')).toEqual([10, 10, 10, 10, 10, 10]);
    expect(byId('hud').querySelectorAll('.initiative .seat svg')).toHaveLength(6);
    tap(game, -4, 8);
    expect(game.hook<number[]>('__seatGlyphs')).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('Hold plays the round with no order of the player', async () => {
    await royale();
    button('royale-hold').click();
    expect(items('.reveal li')[0]).toBe('You: held');
    expect(turn()).toBe('Battle royale · Round 2');
  });

  it('a royale game file loads through the hook, and the reveal log marks the fizzled order', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', { seed: 7, rounds: [FIZZLE] });
    expect(turn()).toBe('Battle royale · Round 2');
    const fizzled = byId('hud').querySelector('.reveal li.fizzled')!;
    expect(fizzled.textContent).toBe('You: fizzled');
  });

  it('a finished game takes no more round: Hold is off', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', { seed: 7, rounds: [] });
    // Every game ends by round 46, when ring 2 goes void (rules.md 10.4).
    for (let round = 0; round < 60 && !button('royale-hold').disabled; round++) {
      button('royale-hold').click();
      game.frame(10_000);
    }
    expect(button('royale-hold').disabled).toBe(true);
  });

  it('a cracked ring glows with the crack decal and its countdown a round before it goes void, then vanishes (#503)', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', CRACKED);
    expect(turn()).toBe('Battle royale · Round 13');
    expect(document.body.dataset.cracks).toBe('48');
    expect(document.body.dataset.vanished).toBe('7'); // the hole in the centre (#610)
    expect(game.hook<Axial[]>('__crackDecals')).toHaveLength(48);
    expect(game.hook<Axial[]>('__crackDecals')).toContainEqual([0, 8]);
    expect(byId('hud').querySelector('.breach')!.textContent).toBe('Breach: 48 cells void in 1 round');
    button('royale-hold').click();
    game.frame(10_000); // the reveal ends with the breach (#612)
    expect(turn()).toBe('Battle royale · Round 14');
    expect(document.body.dataset.cracks).toBe('0');
    expect(document.body.dataset.vanished).toBe('55');
    expect(game.hook<Axial[]>('__crackDecals')).toEqual([]);
    expect(byId('hud').querySelector('.breach')).toBeNull();
  });

  it('without the crack decal, the glow, the ticks and the plate line still warn (#503)', async () => {
    const game = await boot('?bot=off', { missing: ['crack-decal.ktx2'] });
    game.hook('__royale', CRACKED);
    expect(document.body.dataset.cracks).toBe('48');
    expect(game.hook<Axial[]>('__crackDecals')).toEqual([]);
    expect(byId('hud').querySelector('.breach')!.textContent).toBe('Breach: 48 cells void in 1 round');
  });

  it('a seat out is greyed out on the plate, and the end shows the places and points, a loss lit as one (#503)', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', { seed: 7, rounds: [] });
    // The player holds on the rim while the bots play: its last marbles go void at the end of round 25.
    for (let round = 0; round < 25; round++) button('royale-hold').click();
    game.frame(10_000); // the last reveal plays out (#612)
    expect(items('.initiative li.out')).toEqual(['You']);
    expect(document.body.dataset.over).toBeUndefined();
    for (let round = 0; round < 60 && !button('royale-hold').disabled; round++) {
      button('royale-hold').click();
      game.frame(10_000);
    }
    expect(turn()).toBe('You place 6th');
    expect(document.body.dataset.over).toBe('loss');
    expect(items('.placement li')).toHaveLength(6);
    expect(items('.placement li').at(-1)).toBe('6th You · 0 points');
  });

  it('an end position loads: the banner names the winner, the places and points, Hold off (#503)', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', END);
    expect(turn()).toBe('You win');
    expect(document.body.dataset.over).toBe('win');
    expect(byId('hud').querySelector('.end')!.textContent).toBe('10 points. The books balance.');
    expect(items('.placement li')).toEqual([
      '1st You · 10 points',
      '2nd Bot 1 · 6 points',
      '2nd Bot 2 · 6 points',
      '2nd Bot 3 · 6 points',
      '2nd Bot 4 · 6 points',
      '2nd Bot 5 · 6 points',
    ]);
    expect(button('royale-hold').disabled).toBe(true);
    game.click(-2, 4); // a marble of the player, then its NW target: no round after the end (#611)
    game.click(-2, 3);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    expect(turn()).toBe('You win');
    button('ship').click();
    expect(document.body.dataset.over).toBeUndefined(); // no end light over the hub
  });

  it('a game everyone holds ends in one tie on the last void: You lead round 25 and win, the bots share 2nd (#641)', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', { seed: 7, rounds: Array.from({ length: 25 }, () => []) });
    expect(turn()).toBe('You win');
    expect(items('.placement li')).toEqual([
      '1st You · 10 points',
      '2nd Bot 1 · 6 points',
      '2nd Bot 2 · 6 points',
      '2nd Bot 3 · 6 points',
      '2nd Bot 4 · 6 points',
      '2nd Bot 5 · 6 points',
    ]);
  });

  it('a boss fight leaves the battle royale: the board and its frame come back', async () => {
    const game = await royale();
    startBoss('The Echo');
    expect(document.body.dataset.royale).toBeUndefined();
    expect(button('royale-hold').hidden).toBe(true);
    expect(game.hook<{ drawn: boolean }>('__frame').drawn).toBe(true);
    expect(turn()).not.toContain('Battle royale');
    game.click(0, 2); // the board takes the clicks again
    expect(game.hook<Axial[]>('__rings')).toEqual([[0, 2]]);
  });

  it('Ship leaves it for the hub, and Battle royale leaves the hub', async () => {
    const game = await royale();
    button('ship').click();
    expect(document.body.dataset.royale).toBeUndefined();
    expect(document.body.dataset.hub).toBeDefined();
    expect(button('royale-hold').hidden).toBe(true);
    drag(game, 'pointerdown', -4, 8); // the hub takes no drag play
    drag(game, 'pointermove', -4, 7);
    drag(game, 'pointerup', -4, 7);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    button('battle-royale').click();
    expect(document.body.dataset.hub).toBeUndefined();
    expect(turn()).toBe('Battle royale · Round 1');
  });

  it('Play online leaves it too, and Battle royale does nothing while online', async () => {
    const game = await royale();
    slowKeys();
    button('play-online').click();
    await game.online();
    expect(document.body.dataset.royale).toBeUndefined();
    button('battle-royale').click();
    expect(document.body.dataset.royale).toBeUndefined();
  });
});

// A round played out (#612): each order in initiative order with the slide, the push and the ejection fall of a normal
// game, a fizzled or held seat briefly ringed, then the breach; its log lines appear in step. A press skips it.
const reveal = (): string | undefined => document.body.dataset.reveal;
const xz = (q: number, r: number): { x: number; z: number } => {
  const p = axialTo3D(q, r);
  return { x: p.x, z: p.z };
};
const drawnAt = (game: Game, q: number, r: number) => game.hook<{ seat: number; x: number; z: number } | null>('__arenaAt', q, r);
async function seeded(seed: number, options = {}): Promise<Game> {
  const game = await boot('?bot=off', options);
  game.hook('__royale', { seed, rounds: [] });
  return game;
}
// Runs frames until `done` holds, at most 10 s of reveal; true when it held.
function until(game: Game, done: () => boolean): boolean {
  for (let ms = 0; ms < 10_000 && !done(); ms += 50) game.frame(50);
  return done();
}

describe('main.ts, a battle royale round plays out (#612)', () => {
  it('each order slides in initiative order, its log line in step, then the board settles on the new position', async () => {
    const game = await seeded(7);
    expect(reveal()).toBe('done'); // a loaded game shows at once
    game.click(-2, 6);
    game.click(-2, 5); // (-2, 6) NW, first in initiative
    expect(reveal()).toBe('turn');
    expect(turn()).toBe('Battle royale · Round 2');
    expect(items('.reveal li')).toEqual(['You: moved']);
    expect(drawnAt(game, -2, 5)).toEqual({ seat: 0, ...xz(-2, 6) }); // the slide starts at the old cell
    expect(drawnAt(game, -2, 6)).toBeNull();
    game.frame(SLIDE_MS / 2);
    const mid = drawnAt(game, -2, 5)!;
    expect(mid.x).toBeLessThan(xz(-2, 6).x);
    expect(mid.x).toBeGreaterThan(xz(-2, 5).x);
    game.frame(STEP_MS - SLIDE_MS / 2); // Bot 1's turn
    expect(drawnAt(game, -2, 5)).toEqual({ seat: 0, ...xz(-2, 5) });
    expect(items('.reveal li').map((t) => t.split(':')[0])).toEqual(['You', 'Bot 1']);
    expect(until(game, () => reveal() === 'done')).toBe(true);
    expect(items('.reveal li')).toHaveLength(6);
    expect(drawnAt(game, -2, 5)).toEqual({ seat: 0, ...xz(-2, 5) });
    expect(game.hook<number[]>('__seatGlyphs')).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it('a held seat is briefly ringed, then the next turn plays', async () => {
    const game = await seeded(7);
    button('royale-hold').click();
    expect(items('.reveal li')).toEqual(['You: held']);
    expect(game.hook<Axial[]>('__rings')).toHaveLength(10); // the player's marbles
    game.frame(MARK_MS);
    expect(game.hook<Axial[]>('__rings')).toEqual([]);
    expect(items('.reveal li')).toHaveLength(2);
  });

  it('a press skips the reveal to its end, and Hold during it plays the next round', async () => {
    const game = await seeded(7);
    button('royale-hold').click();
    dispatchEvent(new PointerEvent('pointerdown'));
    expect(reveal()).toBe('done');
    expect(items('.reveal li')).toHaveLength(6);
    button('royale-hold').click();
    button('royale-hold').click(); // the reveal of round 2 ends, round 3 resolves
    expect(turn()).toBe('Battle royale · Round 4');
    expect(reveal()).toBe('turn');
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(reveal()).toBe('done');
    expect(items('.reveal li')).toHaveLength(6);
  });

  it('a move that ejects plays the ejection fall', async () => {
    // Seed 1, the player holding: Bot 1 ejects a marble of Bot 2 in round 26.
    const game = await seeded(1);
    for (let round = 0; round < 25; round++) button('royale-hold').click();
    game.frame(10_000);
    button('royale-hold').click();
    expect(until(game, () => document.body.dataset.ejecting === 'tumble')).toBe(true);
    expect(reveal()).toBe('turn');
    expect(items('.reveal li').at(-1)).toBe('Bot 1: moved, ejected Bot 2');
    expect(until(game, () => reveal() === 'done' && !document.body.dataset.ejecting)).toBe(true);
  });

  it('then the breach: the cracked cells sink away, their marbles fall, and the ring is void', async () => {
    const game = await boot('?bot=off');
    game.hook('__royale', CRACKED);
    button('royale-hold').click();
    expect(until(game, () => reveal() === 'breach')).toBe(true);
    expect(document.body.dataset.ejecting).toBe('tumble'); // the marbles on the ring fall
    expect(document.body.dataset.vanished).toBe('7'); // only the hole in the centre (#610)
    expect(items('.reveal li')).toHaveLength(6);
    game.frame(100);
    expect(until(game, () => reveal() === 'done')).toBe(true);
    expect(document.body.dataset.vanished).toBe('55');
    expect(document.body.dataset.cracks).toBe('0');
  });

  it('the end shows once the last round played out, and Hold during it plays no more round', async () => {
    const game = await seeded(7);
    // Each Hold ends the reveal before it; the one during the last round's reveal only ends it.
    for (let round = 0; round < 60 && !button('royale-hold').disabled; round++) {
      expect(turn()).toContain('Battle royale'); // the end waits for the reveal
      button('royale-hold').click();
    }
    expect(reveal()).toBe('done');
    expect(turn()).toBe('You place 6th');
    expect(game.hook<number[]>('__seatGlyphs')[0]).toBe(0);
  });

  it('reduced motion: the board jumps to the new position at once', async () => {
    const game = await seeded(7, { reducedMotion: true });
    game.click(-2, 6);
    game.click(-2, 5);
    expect(reveal()).toBe('done');
    expect(items('.reveal li')).toHaveLength(6);
    expect(drawnAt(game, -2, 5)).toEqual({ seat: 0, ...xz(-2, 5) });
  });

  it('leaving during the reveal drops it', async () => {
    const game = await seeded(7);
    button('royale-hold').click();
    button('ship').click();
    expect(reveal()).toBeUndefined();
    game.frame(10_000); // nothing of it plays on over the hub
    expect(document.body.dataset.hub).toBeDefined();
    expect(reveal()).toBeUndefined();
  });
});

describe('main.ts, the battle royale looks like the Blender scene (#1374)', () => {
  // The arena group (half scale) and its marbles' group, from the terrace the page exposes for the browser checks.
  const arenaOf = (game: Game): THREE.Object3D[] => {
    const scene = game.hook<THREE.Object3D>('__terrace').parent!;
    const arena = scene.children.find((c) => c.type === 'Group' && c.scale.x === 0.5)!;
    return arena.children.find((c) => c.type === 'Group')!.children;
  };
  const pedestalsOf = (game: Game): THREE.Mesh[] => arenaOf(game).filter((c): c is THREE.Mesh => c.userData.terrace === true);

  it('stands every marble on a pedestal: the kit disc at the board plane, as wide as Blender\'s half-size one, the marble on top of it', async () => {
    const game = await seeded(7);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    game.hook('__royale', { seed: 7, rounds: [] }); // drawn again once the terrace is on
    const pedestals = pedestalsOf(game);
    expect(pedestals).toHaveLength(60); // six seats of ten
    const marbles = arenaOf(game).filter((c): c is THREE.Mesh => c.type === 'Mesh' && !c.userData.terrace && (c as THREE.Mesh).geometry.type === 'SphereGeometry');
    expect(marbles).toHaveLength(60);
    const [first] = pedestals;
    expect(first!.position.y).toBe(0);
    expect(first!.scale.toArray()).toEqual([1, 2, 1]); // the arena's half scale leaves its height as the kit's
    for (const marble of marbles) expect(pedestals.some((p) => p.position.x === marble.position.x && p.position.z === marble.position.z)).toBe(true);
    expect(Math.min(...marbles.map((m) => m.position.y))).toBeCloseTo(0.36 + 0.22); // 0.11 over the plane, in the arena's scale
  });

  it('keeps the room as it was for the automated tests: no pedestal, the marble on the floor, the room camera', async () => {
    const game = await boot('?bot=off&scene=room');
    game.hook('__royale', { seed: 7, rounds: [] });
    expect(pedestalsOf(game)).toHaveLength(0);
    expect(Math.min(...arenaOf(game).filter((c) => c.type === 'Mesh').map((m) => m.position.y))).toBeLessThan(0.4);
    expect(game.hook<View>('__view').polar).not.toBeCloseTo((40 * Math.PI) / 180);
  });

  it('moves the pedestal with its marble through a slide', async () => {
    const game = await seeded(7);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    game.hook('__royale', { seed: 7, rounds: [] });
    game.click(-2, 6);
    game.click(-2, 5);
    game.frame(SLIDE_MS / 2);
    const mid = drawnAt(game, -2, 5)!;
    expect(pedestalsOf(game).some((p) => p.position.x === mid.x && p.position.z === mid.z)).toBe(true);
  });

  it('frames the arena from the Blender camera, 40 degrees from the vertical, and keeps it whole on a phone', async () => {
    const game = await seeded(7);
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    game.hook('__royale', { seed: 7, rounds: [] });
    const wide = game.hook<View>('__view');
    expect(wide.polar).toBeCloseTo((40 * Math.PI) / 180);
    expect(wide.distance).toBeGreaterThanOrEqual(13.6 - 1e-9);
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    window.dispatchEvent(new Event('resize'));
    const tall = game.hook<View>('__view');
    vi.unstubAllGlobals();
    expect(tall.polar).toBeCloseTo(wide.polar);
    expect(tall.distance).toBeGreaterThanOrEqual(wide.distance); // never closer than the camera of the file; the arena already fits a phone there
  });
});
