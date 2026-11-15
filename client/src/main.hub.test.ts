// @vitest-environment jsdom
import * as THREE from 'three/webgpu';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { axialTo3D, encodeMove, moveForClick, parseMoves, type Axial } from './board';
import { resetView, type View } from './camera';
import { generateKeys } from './moverecord';
import { OnlineSession } from './session';
import { boot, slowKeys, type Game, startBoss } from './test/harness';
import type { Transport } from './transport';

// Walking the hub (docs/specs/game-design.md section 3.5, #521): the Hub entry of the mode menu draws the deck's map
// with the board's cells and the player's glass marble, which rolls one cell by a click on a neighbour or an arrow key.
// body[data-hub] names the deck and the cell of the marble, read by the e2e tests.

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

/** Catches the scene main.ts builds: call before boot. */
function catchScene(): () => THREE.Scene {
  let scene: THREE.Scene | null = null;
  const add = THREE.Object3D.prototype.add;
  const spy = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
    if (this instanceof THREE.Scene && this.name === 'edgefall-scene') scene = this;
    return add.apply(this, objects);
  });
  onTestFinished(() => spy.mockRestore());
  return () => scene!;
}

/** What the scene draws: the cell discs shown, and in the marbles group (the fifth group after the far rim, as
 * main.board.test.ts reads it) the glass marbles and the room glyphs. */
function drawn(scene: THREE.Scene) {
  const meshes = scene.children.filter((c): c is Mesh => c instanceof THREE.Mesh);
  const far = meshes.filter((m) => m.geometry instanceof THREE.ExtrudeGeometry)[2]!;
  const marbleGroup = scene.children[scene.children.indexOf(far) + 4]!;
  const directMarbles = marbleGroup.children.filter((c): c is Mesh => c instanceof THREE.Mesh);
  const liftGroups = marbleGroup.children.filter((c) => c.name === 'door-lift');
  const liftChildren = liftGroups.flatMap((g) => g.children.filter((c): c is Mesh => c instanceof THREE.Mesh));
  return {
    discs: meshes.filter((m) => m.geometry instanceof THREE.CylinderGeometry && !(m instanceof THREE.InstancedMesh) && m.visible).length,
    glass: directMarbles.filter((m) => m.material instanceof THREE.MeshPhysicalMaterial),
    shells: directMarbles.filter((m) => m.geometry instanceof THREE.SphereGeometry && !(m.material instanceof THREE.MeshPhysicalMaterial)),
    glyphs: marbleGroup.children.filter((c) => c.name.startsWith('door-')).length,
    bars: liftChildren.filter((m) => m.name === 'locked-bar'), // the bar across a closed room (#522)
    arrows: liftChildren.filter((m) => m.geometry instanceof THREE.ShapeGeometry), // a lift's arrow (#523)
  };
}

const byId = <T extends HTMLElement = HTMLButtonElement>(id: string): T => document.getElementById(id) as T;
const hub = (): string | undefined => document.body.dataset.hub;
const saved = (): unknown => JSON.parse(localStorage.getItem('ab-alone.progress')!);
const press = (key: string, target: EventTarget = window): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};
/** Picks a file of `text` in the import input, as the file dialog does. */
function pickFile(text: Promise<string>): void {
  const input = byId<HTMLInputElement>('import-file');
  Object.defineProperty(input, 'files', { value: [{ size: 100, text: () => text }], configurable: true });
  input.dispatchEvent(new Event('change'));
}
function ship(game: Game): void {
  byId('ship').click();
}
/** Ship, with the marble saved on `cell` of the Mess. */
function shipAt(game: Game, cell: [number, number]): void {
  localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell, beaten: [] }));
  ship(game);
}
/** Settles until `ok` holds: the bot replies, the signatures of an online game. */
async function until(game: Game, ok: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !ok(); i++) await game.settle();
  expect(ok()).toBe(true);
}
// One marble each, there and back twice: the start position a third time at ply 8, a draw by repetition (a defeat
// against a boss). `play` plays White's half, the page's own clicks play Black.
const THERE_AND_BACK: [number, number, number, number][] = [
  [0, 2, 0, 1],
  [0, -2, 0, -1],
  [0, 1, 0, 2],
  [0, -1, 0, -2],
];
// Against The Echo each move's mirror is a bonus move for the other side (#859): Black up, then east and back east, a
// position a third time at the 5th move, a draw by repetition (a defeat against a boss). The page plays both sides.
const ECHO_DRAW: [number, number, number, number][] = [
  [0, 2, 0, 1],
  [0, -1, 1, -1],
  [0, 1, -1, 1], // the free move the Echo's step offers (#958)
  [-1, 1, 0, 1],
  [0, -1, 1, -1],
  [0, 1, -1, 1],
  [-1, 1, 0, 1],
];
async function loseToTheEcho(game: Game): Promise<void> {
  for (const [ply, [q, r, tq, tr]] of ECHO_DRAW.entries()) {
    game.click(q, r);
    game.click(tq, tr);
    game.frame(5000); // the slide ends
    await until(game, () => game.hook('__plies') === ply + 1);
  }
}
type Play = (q: number, r: number, tq: number, tr: number) => Promise<void>;
async function repeat(game: Game, white?: Play): Promise<void> {
  for (const [ply, [q, r, tq, tr]] of [...THERE_AND_BACK, ...THERE_AND_BACK].entries()) {
    const turn = game.turn();
    if (white && ply % 2 === 1) await white(q, r, tq, tr);
    else {
      game.click(q, r);
      game.click(tq, tr);
      game.frame(5000); // the slide ends
    }
    // The engine has White's move before the page logged it and refreshed the HUD: wait for the HUD too (#952).
    await until(game, () => game.hook('__plies') === ply + 1 && game.turn() !== turn);
  }
}
/** The White player of the page's online room: a session with its own engine, which plays once Black's move is in. */
async function opponent(game: Game) {
  const [transport, room] = [game.peer()!, game.room()!];
  const { Engine, engine_version } = await import('edgefall-wasm');
  const engine = new Engine();
  const session = new OnlineSession({
    game: room,
    side: 2,
    engine: engine_version(),
    keys: await generateKeys(),
    transport,
    judge: { to_move: () => engine.to_move(), play: (mv) => engine.play(mv), status: () => engine.status(), restart: () => {} },
    onMove: () => {},
    onRefuse: () => {},
    beat: { ms: 5000, now: Date.now, every: () => {} },
  });
  return async (q: number, r: number, tq: number, tr: number): Promise<void> => {
    await until(game, () => engine.to_move() === 2);
    const record = encodeMove(moveForClick(parseMoves(engine.legal_moves()), [[q, r]], [tq, tr])!);
    engine.play(Int32Array.from(record));
    await session.send(record);
  };
}

describe('main.ts, walking the hub (#521)', () => {
  it('lands directly on the Hub when booted with no query string, no hash and no saved game, #602', async () => {
    const game = await boot('');
    expect(hub()).toBe('mess 0,0');
    expect(document.body.dataset.deck).toBe('mess');
    expect(game.hud()).toBe('Hub · Mess');
  });

  it('Ship draws the Mess map, its room glyphs and the glass marble on the centre cell, in the HUD too', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    expect(drawn(scene()).discs).toBe(61);
    expect(document.body.dataset.rim).toBe('near');
    ship(game);
    expect(hub()).toBe('mess 0,0');
    expect(document.body.dataset.deck).toBe('mess');
    expect(game.hook('__frame')).toMatchObject({ radius: 3, holes: 0 });
    expect(document.body.dataset.rim).toBe('off');
    const { discs, glass, shells, glyphs } = drawn(scene());
    expect(discs).toBe(37);
    expect(shells).toHaveLength(0);
    expect(glass).toHaveLength(1);
    expect(glass[0]!.position.toArray()).toEqual([0, 0.36, 0]);
    expect(glyphs).toBe(12); // eight rooms (with the Medal room), the lift up and the gallery's three: the Mess has no lift down
    expect(game.hud()).toBe('Hub · Mess');
  });

  it('stands on the terrace: the hub deck draws one dish per cell of the Mess, and a click still walks the marble (#1374)', async () => {
    const game = await boot('?bot=off');
    ship(game);
    expect(document.body.dataset.scene).toBe('table-zero');
    expect(game.hook('__frame')).toMatchObject({ drawn: true, dishes: 1 }); // the harness's hub deck has one cell, at the middle
    game.click(1, 0);
    expect(hub()).toBe('mess 1,0');
  });

  it('rolls the marble onto a clicked neighbour and saves it there, a far cell keeps it put', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off&scene=room');
    ship(game);
    game.click(1, 0);
    expect(hub()).toBe('mess 1,0');
    expect(saved()).toEqual({ version: 1, deck: 'mess', cell: [1, 0], beaten: [] });
    const p = axialTo3D(1, 0);
    expect(drawn(scene()).glass[0]!.position.toArray()).toEqual([p.x, 0.36, p.z]);
    game.click(-2, 0);
    expect(hub()).toBe('mess 1,0');
    game.click(2, -1);
    expect(hub()).toBe('mess 2,-1');
    expect(game.hud()).toBe("Hub · MessCaptain's order · read the log");
  });

  it('rolls the marble by the arrow keys in the hub only, never from a text field', async () => {
    const game = await boot('?bot=off');
    expect(press('ArrowUp').defaultPrevented).toBe(false); // the board has no use for them
    expect(hub()).toBeUndefined();
    ship(game);
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(hub()).toBe('mess 1,-1');
    press('ArrowLeft');
    expect(hub()).toBe('mess 0,-1');
    expect(press('a').defaultPrevented).toBe(false);
    press('ArrowDown', byId<HTMLInputElement>('invite'));
    expect(hub()).toBe('mess 0,-1');
    press('ArrowUp'); // up to (0, -2), then (1, -3), up again: off the map, the marble stays
    press('ArrowUp');
    press('ArrowUp');
    expect(hub()).toBe('mess 1,-3');
  });

  it('leaves the arrow keys to the terminal reader while it is open', async () => {
    const game = await boot('?bot=off');
    await game.settle(); // the web fonts of the console are in
    ship(game);
    press('t');
    expect(document.body.dataset.reading).toBeDefined();
    press('ArrowRight');
    expect(hub()).toBe('mess 0,0');
    press('Escape');
    press('ArrowRight');
    expect(hub()).toBe('mess 1,0');
  });

  it('opens on the saved spot, and an open lift carries the marble onto the lift back of the next deck', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [1, -1], beaten: ['echo'] }));
    ship(game);
    expect(hub()).toBe('mess 1,-1');
    press('ArrowUp');
    expect(hub()).toBe('cargo -1,2');
    expect(document.body.dataset.deck).toBe('cargo');
    expect(saved()).toEqual({ version: 1, deck: 'cargo', cell: [-1, 2], beaten: ['echo'] });
    expect(drawn(scene()).glyphs).toBe(14); // the two lifts and the gallery's five
    expect(game.hud()).toBe('Hub · CargoLift to Mess');
    press('ArrowRight');
    expect(hub()).toBe('cargo 0,2');
    expect(document.body.dataset.deck).toBe('cargo');
  });

  it('draws no ghost for a hovered cell in the hub', async () => {
    const game = await boot('?bot=off');
    ship(game);
    const { x, y } = game.hook<{ x: number; y: number }>('__cellToScreen', 1, 0);
    delete document.body.dataset.ghosts; // set by every ghost drawing
    document.querySelector('body > canvas')!.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    expect(document.body.dataset.ghosts).toBeUndefined();
  });

  it('previews room name, mode descriptor and affordance on hover in the hub (#628)', async () => {
    const game = await boot('?bot=off');
    const canvas = document.querySelector('body > canvas')!;
    // Pointer leave outside the hub does nothing
    canvas.dispatchEvent(new Event('pointerleave'));

    ship(game);
    // Pointer leave in hub without hover does nothing
    canvas.dispatchEvent(new Event('pointerleave'));

    // Hover neighbour cell [1, 0] twice to hit next === hubHover early return
    const p1 = game.hook<{ x: number; y: number }>('__cellToScreen', 1, 0);
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: p1.x, clientY: p1.y }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: p1.x, clientY: p1.y }));
    expect(document.body.dataset.hubHover).toBe('1,0');
    expect(game.hud()).toContain('Target: Deck floor');
    expect(game.hud()).toContain('(Click to move)');

    // Pointer leave clears hover preview while active
    canvas.dispatchEvent(new Event('pointerleave'));
    expect(document.body.dataset.hubHover).toBeUndefined();
    expect(game.hud()).not.toContain('hub-preview');

    // Hover distant boss door [2, 0]
    const p2 = game.hook<{ x: number; y: number }>('__cellToScreen', 2, 0);
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: p2.x, clientY: p2.y }));
    expect(document.body.dataset.hubHover).toBe('2,0');
    expect(game.hud()).toContain('The Echo · boss, Mess seat');
    expect(game.hud()).toContain('(Out of reach (roll closer))');

    // Move pointer off-board where cellAt is null
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: -999, clientY: -999 }));
    expect(document.body.dataset.hubHover).toBeUndefined();
    expect(game.hud()).not.toContain('hub-preview');
  });

  it('leaves the hub for the board when a new game, a boss fight or Play online starts', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'cargo', cell: [0, 0], beaten: ['echo'] }));
    ship(game);
    expect(document.body.dataset.deck).toBe('cargo');
    const { NEON, neonMaterial } = await import('./neonlook'); // the page's own module, loaded by boot
    const ground = (): number => new THREE.Color(NEON.ground).multiply((neonMaterial('scene_col_map_b') as THREE.MeshStandardMaterial).color).getHex();
    expect(ground()).toBe(NEON.ground); // the Hub's floor is the dark neon ground (#1639)
    byId('new-game').click();
    expect(hub()).toBeUndefined();
    expect(document.body.dataset.deck).toBe('mess');
    expect(ground()).not.toBe(NEON.ground); // a fight's surround leans to its deck again
    expect(drawn(scene()).discs).toBe(61);
    expect(game.hook('__frame')).toMatchObject({ radius: 4 });

    ship(game);
    startBoss('The Hull');
    expect(hub()).toBeUndefined();
    expect(document.body.dataset.deck).toBe('cargo');
    expect(drawn(scene()).discs).toBe(61);

    ship(game);
    slowKeys();
    byId('play-online').click();
    await game.online();
    expect(hub()).toBeUndefined();
    expect(document.body.dataset.online).toBeDefined();
    ship(game); // returns to the hub from online (#773)
    expect(hub()).toBe('cargo 0,0');
    expect(document.body.dataset.online).toBeUndefined();
  });

  it('returns to the Hub at any time from battle royale and daily challenge (#773)', async () => {
    const game = await boot('?bot=off');
    byId('battle-royale').click();
    expect(hub()).toBeUndefined();
    expect(document.body.dataset.royale).toBeDefined();
    ship(game);
    expect(hub()).toBeDefined();
    expect(document.body.dataset.royale).toBeUndefined();

    byId('daily').click();
    expect(hub()).toBeUndefined();
    expect(document.body.dataset.boss).toBeDefined();
    ship(game);
    expect(hub()).toBeDefined();
  });

  it('hides the evaluation bar and Hint in the hub, and drops the evaluation in flight; a new game brings them back (#583)', async () => {
    const game = await boot('?bot=off');
    const bar = byId<HTMLElement>('eval');
    expect(bar.hidden).toBe(false); // the start position is being evaluated
    expect(byId('hint').hidden).toBe(false);
    ship(game);
    await game.settle();
    expect(bar.hidden).toBe(true);
    expect(bar.dataset.ply).toBeUndefined(); // the answer for the start position never reached the bar
    expect(byId('hint').hidden).toBe(true);
    game.click(1, 0); // walking keeps them hidden
    expect(hub()).toBe('mess 1,0');
    expect(bar.hidden).toBe(true);
    expect(byId('hint').hidden).toBe(true);
    byId('new-game').click();
    await game.settle();
    expect(bar.hidden).toBe(false);
    expect(bar.dataset.ply).toBe('0');
    expect(byId('hint').hidden).toBe(false);
  });

  it('hides Export game and Import game in the hub, and a file read in flight is dropped there; a new game brings them back (#589)', async () => {
    const game = await boot('?bot=off');
    expect(byId('setting-export-game').hidden).toBe(false);
    expect(byId('setting-import-game').hidden).toBe(false);
    let read: (text: string) => void = () => {};
    pickFile(new Promise<string>((resolve) => (read = resolve)));
    ship(game);
    expect(byId('setting-export-game').hidden).toBe(true);
    expect(byId('setting-import-game').hidden).toBe(true);
    read(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: [] }));
    await game.settle();
    expect(hub()).toBe('mess 0,0'); // the hub stays drawn
    expect(byId<HTMLElement>('eval').hidden).toBe(true);
    expect(game.hud()).toBe('Hub · Mess');
    byId('new-game').click();
    await game.settle();
    expect(byId('setting-export-game').hidden).toBe(false);
    expect(byId('setting-import-game').hidden).toBe(false);
  });

  it('puts the end light of a finished game out in the hub', async () => {
    const game = await boot('?nodes=100');
    await game.hook<Promise<number>>('__playTurns', 30, [4]); // the player marches one way, the bot pushes six off
    expect(document.body.dataset.over).toBe('loss');
    ship(game);
    expect(document.body.dataset.over).toBeUndefined();
    expect(game.hud()).toBe('Hub · Mess');
  });

  it('resets the tension level to calm in the hub (#586)', async () => {
    const game = await boot('?nodes=100');
    for (let t = 1; t <= 30; t++) {
      await game.hook<Promise<number>>('__playTurns', 1, [4]);
      if (game.hook<{ level: number }>('__tension').level > 0) break;
    }
    expect(game.hook<{ level: number }>('__tension').level).toBeGreaterThan(0);
    ship(game);
    expect(game.hook<{ level: number }>('__tension').level).toBe(0);
  });
});

// The doors (#522, game-design.md section 3.5): rolling onto a boss door or a table starts the same game as its mode
// menu entry. Once that game is over, Back to the hub puts the marble back on the door's cell, in the hub. The battle
// royale lobby is shown closed, a terminal opens nothing yet (#524).
describe('main.ts, the hub doors (#522)', () => {
  const back = (): HTMLButtonElement => byId('exit');
  const data = (): DOMStringMap => document.body.dataset;

  it('the boss door starts the deck boss; once the fight is lost, Back to the hub lands on the door', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    shipAt(game, [1, 0]);
    expect(back().hidden).toBe(true); // the Hub is the home: no way out of it (#1517)
    game.click(2, 0);
    expect(hub()).toBeUndefined();
    expect(data().boss).toBe('echo');
    expect(data().deck).toBe('mess');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Echo');
    expect(back().hidden).toBe(false); // the way out is there while the fight is on (#1517)
    expect(back().dataset.label).toBe('Hub');
    await loseToTheEcho(game);
    expect(game.hud()).toContain('Defeat');
    expect(back().hidden).toBe(false);
    expect(back().textContent).toBe('Back to the hub');
    back().click();
    expect(hub()).toBe('mess 2,0');
    expect(game.hud()).toBe("Hub · MessThe Echo · boss, Mess seat");
    expect(back().hidden).toBe(true);
    game.click(-2, 0); // not a neighbour: the marble stays on the door, and the door starts nothing again
    expect(hub()).toBe('mess 2,0');
  });

  it('the boss door of the Bridge starts The Ballast Mind on its radius 5 board (#564)', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const beaten = ['echo', 'hull', 'choir', 'chaplain'];
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'bridge', cell: [1, 0], beaten }));
    ship(game);
    game.click(2, 0);
    expect(hub()).toBeUndefined();
    expect(data().boss).toBe('ballast');
    expect(data().deck).toBe('bridge');
    expect(document.getElementById('boss-bar')!.textContent).toContain('The Ballast Mind');
    expect(game.hook('__frame')).toMatchObject({ radius: 5, holes: 6 });
  });

  it('a table after a boss fight is a plain game again: no boss, no Retry, New game back', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    shipAt(game, [1, 0]);
    game.click(2, 0);
    ship(game);
    expect(byId('boss-retry').hidden).toBe(true); // the hub leaves the fight (#1275)
    for (const [q, r] of [[1, 0], [0, 0], [-1, 0], [-2, 0]] as const) game.click(q, r);
    expect(hub()).toBeUndefined();
    expect(data().boss).toBeUndefined();
    expect(game.hook('__fight')).toBeNull();
    expect(byId('boss-retry').hidden).toBe(true);
    expect(byId('new-game').hidden).toBe(false);
    expect(game.hud()).toContain('Black to move');
  });

  it('the hot-seat table starts a game the bot never answers, Back to the hub after its draw', async () => {
    const game = await boot('?nodes=100');
    shipAt(game, [-1, 0]);
    game.click(-1, -1);
    expect(hub()).toBeUndefined();
    expect(game.hud()).toContain('Two players, one board.');
    await repeat(game); // the page plays both sides: no bot
    expect(game.turn()).toBe('Draw');
    back().click();
    expect(hub()).toBe('mess -1,-1');
    expect(game.hud()).toBe("Hub · MessCrew table · 2 players, one screen");
  });

  it('a hot-seat table game is back after a reload, still with no bot (#565)', async () => {
    const indexedDB = new IDBFactory();
    const game = await boot('?nodes=100', { indexedDB });
    shipAt(game, [-1, 0]);
    game.click(-1, -1);
    game.click(0, 2); // Black (0, 2) to (0, 1)
    game.click(0, 1);
    game.frame(5000);
    await game.settle();
    expect(game.hook('__plies')).toBe(1);
    const again = await boot('?nodes=100', { indexedDB });
    expect(again.hook('__plies')).toBe(1);
    await again.settle();
    expect(again.hook('__plies')).toBe(1); // no bot reply for White
    again.click(0, -2); // the page plays White
    again.click(0, -1);
    await until(again, () => again.hook('__plies') === 2);
    expect(again.turn()).toBe('Black to move');
  });

  it('the bot table brings the bot back after the hot-seat one; Back to the hub after its loss', async () => {
    const game = await boot('?nodes=100');
    shipAt(game, [-1, 0]);
    game.click(-1, -1); // hot-seat
    ship(game);
    game.click(-2, 0); // the bot table, next to the hot-seat one
    expect(hub()).toBeUndefined();
    expect(game.hud()).toContain('You vs Bot.');
    await game.hook<Promise<number>>('__playTurns', 30, [4]); // the player marches one way, the bot pushes six off
    expect(data().over).toBe('loss');
    back().click();
    expect(hub()).toBe('mess -2,0');
    expect(game.hud()).toBe("Hub · MessHouse table · play the ship's bot");
  });

  it('the online table opens a room as Play online does; Back to the hub after the game leaves it', async () => {
    const game = await boot('?bot=off');
    shipAt(game, [-1, 1]);
    game.click(-2, 1);
    expect(hub()).toBeUndefined();
    await until(game, () => data().seat === 'player');
    expect(byId('invite').hidden).toBe(false);
    expect(location.hash).toMatch(new RegExp(`^#room=${game.room()}&key=[\\w-]{8}$`));
    const white = await opponent(game);
    await until(game, () => data().opponent === 'here');
    await repeat(game, white);
    expect(game.turn()).toBe('Draw');
    expect(byId('rematch').hidden).toBe(false);
    back().click();
    await game.settle(); // the closed room calls back: the hub stays
    expect(hub()).toBe('mess -2,1');
    expect(game.hud()).toBe("Hub · MessComms desk · 1v1 online match");
    expect(location.hash).toBe('');
    expect(byId('invite').hidden).toBe(true);
    expect(byId('invite-label').hidden).toBe(true);
    expect(byId('rematch').hidden).toBe(true);
    expect(byId('new-game').hidden).toBe(true); // the Hub at home has no dock (#1697)
    expect(data().online).toBeUndefined();
    expect(data().seat).toBeUndefined();
    ship(game); // a local page again: Ship opens
    expect(hub()).toBe('mess -2,1');
  });

  it('the online table opens nothing while the browser is offline', async () => {
    const game = await boot('?bot=off');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    onTestFinished(() => void Reflect.deleteProperty(navigator, 'onLine'));
    window.dispatchEvent(new Event('offline'));
    shipAt(game, [-1, 1]);
    game.click(-2, 1);
    expect(hub()).toBe('mess -2,1');
    expect(game.room()).toBeNull();
  });

const NW_ORDER = (...cells: Axial[]): number[] => [0, cells.length, 4, ...[...cells, [0, 0], [0, 0]].slice(0, 3).flat()];
const columnOrders = (cells: Axial[], steps: number): number[][] =>
  Array.from({ length: steps }, (_, s) => NW_ORDER(...cells.map(([q, r]): Axial => [q, r - s])));
const END_ROYALE = {
  seed: 7,
  rounds: [
    ...columnOrders([[-4, 8], [-4, 7], [-4, 6]], 3),
    ...columnOrders([[-3, 8], [-3, 7], [-3, 6]], 3),
    ...columnOrders([[-5, 8], [-5, 7]], 3),
    ...columnOrders([[-2, 7], [-2, 6]], 2),
    ...Array.from({ length: 14 }, () => []),
  ],
};

  it('the battle royale door starts battle royale; Back to the hub lands on the door (#593)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    shipAt(game, [-2, 2]);
    expect(drawn(scene()).bars).toHaveLength(1); // the locked lift to Cargo only (#523)
    const bar = drawn(scene()).bars[0]!;
    const barX = bar.parent instanceof THREE.Group ? bar.parent.position.x : bar.position.x;
    expect(barX).not.toBeCloseTo(axialTo3D(-3, 2).x); // no bar over the lobby
    game.click(-3, 2);
    expect(hub()).toBeUndefined();
    expect(data().royale).toBe('1');
    expect(back().hidden).toBe(false); // the way out is there while the game is on (#1517)
    game.hook('__royale', END_ROYALE);
    expect(data().over).toBe('win');
    expect(back().hidden).toBe(false);
    back().click();
    expect(hub()).toBe('mess -3,2');
    expect(game.hud()).toBe("Hub · MessArena · battle royale");
    expect(data().royale).toBeUndefined();
  });

  // #1249: every boss of the roster has its door on its deck, and every mode with no table its room.
  it('a gallery boss door starts its own boss, its plate shows its medal once beaten', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'cargo', cell: [2, -2], beaten: ['echo', 'alien'] }));
    localStorage.setItem('ab-alone.medals', JSON.stringify({ alien: 22 }));
    ship(game);
    expect(document.querySelector('#hub-labels [data-cell="3,-2"]')!.textContent).toContain('The AlienMedal: 22 turns');
    game.click(3, -2);
    expect(hub()).toBeUndefined();
    expect(data().boss).toBe('alien');
    expect(data().deck).toBe('cargo');
  });

  it('the Daily room starts the daily challenge, as its menu entry does', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    shipAt(game, [2, -3]);
    game.click(3, -3);
    expect(hub()).toBeUndefined();
    expect(game.hook<{ daily?: unknown }>('__fight')!.daily).toBeDefined();
  });

  it('the Rogue-lite room starts a run on its map', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'cargo', cell: [-1, 3], beaten: ['echo'] }));
    ship(game);
    game.click(0, 3);
    expect(hub()).toBeUndefined();
    expect(byId('run-map').hidden).toBe(false);
  });

  it('the Open world room opens the Open world', async () => {
    const game = await boot('?bot=off&openworld=7', { reducedMotion: true });
    shipAt(game, [1, -3]);
    game.click(0, -3);
    for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done)); // the world reads its save first
    expect(data().openworld).toBe('7');
  });

  it('the Fight together room opens its boss list; the marble stays on the room', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const beaten = ['echo', 'hull'];
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'furnace', cell: [1, -3], beaten }));
    ship(game);
    game.click(0, -3);
    expect(hub()).toBe('furnace 0,-3');
    expect(byId('coop-list').hidden).toBe(false);
    game.click(1, -3); // off the room and back: the list stays open
    game.click(0, -3);
    expect(byId('coop-list').hidden).toBe(false);
  });

  it('the Ranked room opens a ranked room as its menu entry does; offline it opens nothing', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    localStorage.setItem('ab-alone.board-consent', JSON.stringify({ v: 5, choice: 'declined' })); // the board asks at the first ranked entry (#1287)
    const beaten = ['echo', 'hull', 'choir', 'chaplain'];
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'bridge', cell: [2, -3], beaten }));
    ship(game);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    game.click(3, -3);
    expect(hub()).toBe('bridge 3,-3');
    Reflect.deleteProperty(navigator, 'onLine');
    window.dispatchEvent(new Event('online'));
    game.click(2, -3);
    game.click(3, -3);
    expect(hub()).toBeUndefined();
    await until(game, () => !byId('invite').hidden); // once the room's keys are made
    expect(byId('hud').querySelector('.rank-badge')).not.toBeNull();
  });

  it('the Trainer room starts the Trainer at wave 1, as its menu entry does', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    const beaten = ['echo', 'hull', 'choir', 'chaplain'];
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'bridge', cell: [1, -3], beaten }));
    ship(game);
    game.click(0, -3);
    expect(hub()).toBeUndefined();
    expect(data().trainer).toBe('1');
  });

  it('the exit of a game no room started leads to the Hub (#1697)', async () => {
    const game = await boot('?nodes=100');
    await game.hook<Promise<number>>('__playTurns', 30, [4]);
    expect(data().over).toBe('loss');
    expect(back().hidden).toBe(false);
    expect(back().dataset.label).toBe('Hub');
  });
});

// The terminal rooms (#524, game-design.md section 3.5): rolling onto a terminal opens its lore entry in the reader, Esc
// leaves it to the hub on the same cell, and the console screen shows its deck's first entry again.
describe('main.ts, the hub terminals (#524)', () => {
  const data = (): DOMStringMap => document.body.dataset;
  const reader = (): HTMLElement => byId('reader');

  it("opens the room's own entry in the reader and saves it read; Esc gives the hub back on the same cell", async () => {
    const game = await boot('?bot=off');
    await game.settle(); // the web fonts of the console are in
    shipAt(game, [0, 1]);
    const view = game.hook('__cellToScreen', 0, 0);
    game.click(1, 1);
    expect(hub()).toBe('mess 1,1');
    expect(reader().hidden).toBe(false);
    expect(data().reading).toBe('mess-corner-table');
    expect(data().console).toBe('mess-corner-table 1/2');
    expect(reader().textContent).toContain('Page 1 of 2');
    expect(byId('log-button').hidden).toBe(false); // Play log, as at the console
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('mess-corner-table');
    press('ArrowRight'); // the arrows page the entry, the marble stays
    expect(data().console).toBe('mess-corner-table 2/2');
    expect(hub()).toBe('mess 1,1');
    press('Escape');
    expect(reader().hidden).toBe(true);
    expect(data().reading).toBeUndefined();
    expect(hub()).toBe('mess 1,1');
    expect(game.hud()).toBe('Hub · MessGalley log · read the log');
    expect(game.hook('__cellToScreen', 0, 0)).toEqual(view);
    expect(byId('exit').hidden).toBe(true);
    game.frame(16);
    expect(data().console).toBe('mess-house-rule 1/2'); // the console screen shows the deck's first entry again
  });

  it("the first terminal opens the deck's first entry, the one the console shows", async () => {
    const game = await boot('?bot=off');
    await game.settle();
    shipAt(game, [1, -1]);
    game.click(2, -1);
    expect(data().reading).toBe('mess-house-rule');
    press('ArrowRight');
    press('Escape');
    game.frame(16);
    expect(data().console).toBe('mess-house-rule 2/2'); // the screen goes on from the page left
    expect(localStorage.getItem('ab-alone.lore-read')).toBe('mess-house-rule');
  });
});

// The lift gate (#523, game-design.md section 3.5): a lift wears an arrow toward its deck, and a bar across it while it is
// locked. Bumping a locked lift keeps the marble out and Tally says one short line. body[data-lifts] lists the lifts of
// the deck, read by the e2e tests.
describe('main.ts, the lift gate (#523)', () => {
  const lifts = (): string | undefined => document.body.dataset.lifts;
  const on = (mesh: THREE.Object3D, [q, r]: [number, number]): boolean => {
    const p = axialTo3D(q, r);
    const pos = mesh.parent instanceof THREE.Group && mesh.parent.name.startsWith('door-') ? mesh.parent.position : mesh.position;
    return Math.abs(pos.x - p.x) < 1e-9 && Math.abs(pos.z - p.z) < 1e-9;
  };

  it('a locked lift wears its arrow with a bar across, keeps the marble out and Tally says why', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    shipAt(game, [1, -1]);
    expect(lifts()).toBe('cargo locked');
    const { arrows, bars } = drawn(scene());
    expect(arrows).toHaveLength(1);
    expect(on(arrows[0]!, [1, -2])).toBe(true);
    expect(arrows[0]!.rotation.y).toBeCloseTo(Math.PI / 2); // up the map, toward the deck above
    expect(bars.filter((bar) => on(bar, [1, -2]))).toHaveLength(1);
    press('ArrowUp');
    expect(hub()).toBe('mess 1,-1');
    expect(saved()).toMatchObject({ cell: [1, -1] });
    expect(game.hud()).toBe("Hub · MessLift to Cargo: locked. This deck's boss is still on the books.");
    press('ArrowLeft'); // the next roll: the line is gone
    expect(game.hud()).toBe('Hub · Mess');
    press('ArrowRight');
    press('ArrowUp');
    ship(game); // Ship again: a fresh plate
    expect(game.hud()).toBe('Hub · Mess');
  });

  it('reports the height of a lift arrow for the e2e checks, and none for a cell without a lift (#523)', async () => {
    const game = await boot('?bot=off');
    shipAt(game, [1, -1]);
    expect(game.hook<number>('__liftArrowY', 1, -2)).toBeGreaterThan(0); // the arrow's height, over the floor of its room
    expect(game.hook<number | null>('__liftArrowY', 0, 0)).toBeNull();
  });

  it('on a middle deck the lift down is open and the lift up waits for this deck\'s boss', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'cargo', cell: [0, 0], beaten: ['echo'] }));
    ship(game);
    expect(lifts()).toBe('furnace locked,mess open');
    const { arrows, bars } = drawn(scene());
    const down = arrows.find((arrow) => on(arrow, [-1, 2]))!;
    expect(down.rotation.y).toBeCloseTo(-Math.PI / 2); // down the map, toward the deck below
    expect(bars.filter((bar) => on(bar, [-1, 2]))).toHaveLength(0);
    expect(bars.filter((bar) => on(bar, [1, -2]))).toHaveLength(1);
  });

  it('a boss win opens the lift onto the next deck', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off', { reducedMotion: true });
    shipAt(game, [1, 0]);
    game.click(2, 0); // the boss door: the Echo
    expect(document.body.dataset.boss).toBe('echo');
    const { Encounter } = await import('edgefall-wasm');
    const win = vi.spyOn(Encounter.prototype, 'result').mockReturnValue(1); // a win, without playing six ejections
    game.click(0, 2); // a selection redraws the plate, which records the win
    win.mockRestore();
    expect(lifts()).toBeUndefined(); // no hub, no lift
    ship(game);
    expect(hub()).toBe('mess 2,0');
    expect(lifts()).toBe('cargo open');
    expect(drawn(scene()).bars.filter((bar) => on(bar, [1, -2]))).toHaveLength(0);
    for (const [q, r] of [[1, 0], [1, -1], [1, -2]] as const) game.click(q, r);
    expect(hub()).toBe('cargo -1,2');
    expect(lifts()).toBe('furnace locked,mess open');
  });
});

// The Medal room (#812): the south cell of the Mess lists every boss with its medal in the reader.
describe('main.ts, the Medal room (#812)', () => {
  it('opens every boss with its best turns, or Not beaten, in the reader; Esc gives the hub back', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    localStorage.setItem('ab-alone.medals', JSON.stringify({ echo: 7 }));
    shipAt(game, [0, 1]);
    game.click(0, 2);
    expect(hub()).toBe('mess 0,2');
    expect(document.body.dataset.reading).toBe('medal-room');
    expect(byId('reader').textContent).toContain('Medal room');
    expect(byId('reader').textContent).toMatch(/^Medal room.*The Echo: 7 turns\. .*: Not beaten\./);
    expect(localStorage.getItem('ab-alone.lore-read')).toBeNull(); // not a lore entry
    press('Escape');
    expect(byId('reader').hidden).toBe(true);
    game.frame(16);
    expect(document.body.dataset.console).toBe('mess-house-rule 1/2');
  });
});

describe('main.ts, the Medal room counters (#1538)', () => {
  it('lists the wins of the attempts of each boss tried, next to its best turns', async () => {
    const game = await boot('?bot=off');
    await game.settle();
    localStorage.setItem('ab-alone.medals', JSON.stringify({ echo: 7 }));
    localStorage.setItem('ab-alone.boss-tally', JSON.stringify({ echo: { wins: 2, attempts: 5 }, hull: { wins: 0, attempts: 3 } }));
    shipAt(game, [0, 1]);
    game.click(0, 2);
    expect(byId('reader').textContent).toContain('The Echo: 7 turns. Won 2 of 5. ');
    expect(byId('reader').textContent).toContain('The Hull: Not beaten. Won 0 of 3. ');
  });
});

// The deck plan (#1249): a label plate on every room, always shown and kept on its cell as the camera moves, the
// marble labelled YOU, a lift-shaft rail of the five decks and the boss pips. The deck is framed closer than a board.
describe('main.ts, the deck plan (#1249)', () => {
  const plan = (): HTMLElement => byId<HTMLElement>('hub-plan');
  const plate = (cell: string): HTMLElement => document.querySelector<HTMLElement>(`#hub-labels [data-cell="${cell}"]`)!;
  /** The plate of `cell` sits on the window point just south of the cell centre. */
  function placed(game: Game, [q, r]: [number, number]): void {
    const at = game.hook<{ x: number; y: number }>('__cellToScreen', q - 0.2, r + 0.4);
    expect([plate(`${q},${r}`).style.left, plate(`${q},${r}`).style.top]).toEqual([`${at.x}px`, `${at.y}px`]);
  }

  it('Ship shows a plate on every room and YOU on the marble, the rail and the pips; a new game hides them', async () => {
    const game = await boot('?bot=off');
    expect(plan().hidden).toBe(true);
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'cargo', cell: [0, 0], beaten: ['echo'] }));
    ship(game);
    expect(plan().hidden).toBe(false);
    expect(document.querySelectorAll('#hub-labels .hub-label')).toHaveLength(15); // the fourteen rooms of the Cargo and YOU
    expect(plate('2,0').textContent).toContain('The Hull');
    expect(plate('0,0').textContent).toBe('You');
    placed(game, [2, 0]);
    placed(game, [0, 0]);
    expect(byId('hub-rail').querySelector('[aria-current]')!.textContent).toContain('Cargo');
    expect(byId('hub-pips').textContent).toBe('Medals 0 / 15'); // one count of medals on every screen (#1527)

    game.click(1, 0); // the marble rolls: YOU follows it
    expect(plate('1,0').textContent).toBe('You');
    placed(game, [1, 0]);
    expect(plate('0,0')).toBeNull();

    byId('new-game').click();
    expect(plan().hidden).toBe(true);
  });

  it('keeps every plate on its cell when the camera zooms', async () => {
    const game = await boot('?bot=off');
    ship(game);
    const before = plate('2,0').style.left;
    document.querySelector('body > canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, cancelable: true }));
    expect(plate('2,0').style.left).not.toBe(before);
    placed(game, [2, 0]);
  });

  it('frames the deck from the Blender camera, whenever the terrace comes: at the boot on the hub, on a phone, on Reset view (#1374)', async () => {
    const game = await boot('');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    const blender = (v: View): void => expect(v.polar).toBeCloseTo((40 * Math.PI) / 180);
    blender(game.hook<View>('__view'));
    expect(game.hook<View>('__view').distance).toBeGreaterThanOrEqual((13.6 * 3.6) / 4 - 1e-9); // the file's 13.6 for a radius 4 board, a little closer for the deck
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    window.dispatchEvent(new Event('resize'));
    blender(game.hook<View>('__view'));
    byId('view-reset').click();
    blender(game.hook<View>('__view'));
    vi.unstubAllGlobals();
  });

  it('frames the deck as before in the room, closer still on a phone (#1249)', async () => {
    const game = await boot('?bot=off&scene=room');
    shipAt(game, [-1, 1]);
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(3.6).distance);
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    window.dispatchEvent(new Event('resize'));
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(3.4).distance);
    vi.unstubAllGlobals();
  });

  it('puts the props of the Blender file on the rooms of the game, in place of its own glyphs, the lift arrow and bar kept (#1374)', async () => {
    const scene = catchScene();
    const game = await boot('?bot=off');
    await vi.waitFor(() => expect(document.body.dataset.scene).toBe('table-zero'));
    shipAt(game, [1, -1]);
    const marbleGroup = scene().children.find((c) => c.children.some((k) => k.name === 'door-boss'))!;
    const boss = marbleGroup.getObjectByName('door-boss')!;
    expect(boss.children.map((c) => c.name)).toEqual(['scene_hub_prop_door', 'scene_hub_ring_door', 'seat-lamp']); // the file's, and the seat boss's lamp (#1556)
    expect(boss.position.y).toBeCloseTo(-0.11); // on the board plane: the marbles' group is 0.11 up
    const lift = marbleGroup.getObjectByName('door-lift')!;
    expect(lift.children.map((c) => c.name)).toEqual(['scene_hub_prop_lift', '', 'locked-bar']); // the cage, the arrow, the bar of a locked lift
    expect(marbleGroup.getObjectByName('door-slab')).toBeUndefined();
  });

  it('frames the deck closer than a board, and a game started from it frames its whole board again', async () => {
    const game = await boot('?bot=off');
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(4).distance);
    shipAt(game, [-2, 2]);
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(3.6).distance);
    byId('view-reset').click(); // Reset view in the hub frames the deck
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(3.6).distance);
    vi.stubGlobal('innerWidth', 390); // a phone held upright: closer still, so the plates read
    vi.stubGlobal('innerHeight', 844);
    window.dispatchEvent(new Event('resize'));
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(3.4).distance);
    vi.unstubAllGlobals();
    game.click(-3, 2); // the battle royale
    expect(game.hook<View>('__view').distance).toBeCloseTo(resetView(4).distance);
  });
});

