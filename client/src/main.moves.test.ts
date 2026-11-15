// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BLACK_WINS } from '../e2e/end-games';
import { type Axial, CELLS, DIRECTIONS, encodeMove, parseMoves } from './board';
import { BLOOD_MS } from './blood';
import { EJECT_MS, FADE_MS } from './eject';
import { gameFileText } from './gamefile';
import { generateKeys } from './moverecord';
import { OnlineSession } from './session';
import { MOTION } from './motion';
import { SLIDE_MS } from './slide';
import { boot, slowKeys, type Game, startBoss } from './test/harness';

// The moves, the animation and the input of main.ts on the harness (decision #445, #452): a move and its slide, the
// ejection effect and its blood, the skip, the click and its guards, the pointer orbit, pinch and wheel, Reset view,
// a resize and the frame loop.

type Move = { cells: Axial[]; dir: number };
const data = (): DOMStringMap => document.body.dataset; // boot() replaces the body
const legal = (game: Game): Move[] => game.hook<Move[]>('__legal');
const rings = (game: Game): Axial[] => game.hook<Axial[]>('__rings');
const plies = (game: Game): number => game.hook<number>('__plies');
const screen = (game: Game, q: number, r: number): { x: number; y: number } => game.hook('__cellToScreen', q, r);

/** Plays the first legal single-marble move by two clicks, as a player does, and returns it. */
function playOne(game: Game): Move {
  const mv = legal(game).find((m) => m.cells.length === 1)!;
  game.click(...mv.cells[0]!);
  const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
  game.click(...target.cell);
  return mv;
}

/** The 3v2 push of e2e/eject.spec.ts: five plies, the fifth pushes a White marble off the board. Each ply's slide ends
 * before the next one; the effect of the fifth has just started. */
function pushOffBoard(game: Game): void {
  const plies: Axial[][] = [
    [[-2, 2], [-2, 3], [-2, 4], [-2, 1]], // 1. Black trio NW
    [[0, -3], [0, -2], [-1, -2]], // 2. White pair SW
    [[-2, 1], [-2, 2], [-2, 3], [-2, 0]], // 3. Black trio NW
    [[-1, -2], [-1, -1], [-2, -2]], // 4. White pair W, into the Black column
    [[-2, 0], [-2, 1], [-2, 2], [-2, -1]], // 5. 3v2 push, the last White marble leaves
  ];
  for (const [i, cells] of plies.entries()) {
    if (i > 0) game.frame(SLIDE_MS);
    for (const [q, r] of cells) game.click(q, r);
  }
}

const canvas = (): HTMLCanvasElement => document.querySelector('canvas')!;
function pointer(type: string, x: number, y: number, pointerId = 1): void {
  canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}
/** A press and a release on the same spot of the canvas: a mouse click. */
function tap(at: { x: number; y: number }): void {
  pointer('pointerdown', at.x, at.y);
  pointer('pointerup', at.x, at.y);
}
const away = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('a move and its slide', () => {
  it('slides the moved marbles, and a click during the slide waits for its end', async () => {
    const game = await boot('?bot=off');
    const mv = playOne(game);
    expect(plies(game)).toBe(1);
    expect(data().sliding).toBe('1');
    expect(data().knock).toBe('none'); // no Web Audio: no knock
    const white = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...white); // waits for the slide
    expect(rings(game)).toEqual([]);
    const [q, r] = mv.cells[0]!;
    game.frame(SLIDE_MS / 2);
    expect(data().sliding).toBe('1');
    expect(rings(game)).toEqual([]);
    game.frame(SLIDE_MS / 2);
    expect(data().sliding).toBeUndefined();
    expect(rings(game)).toEqual([white]); // the waiting click ran once the slide ended
    expect(game.hook('__marbleTurn', q, r)).toBeNull(); // the marble left its cell
  });

  it('rolls the marble along its slide: its turn changes during the slide and stays at its end', async () => {
    const game = await boot('?bot=off');
    const mv = playOne(game);
    const [q, r] = mv.cells[0]!;
    const [dq, dr] = DIRECTIONS[mv.dir]!;
    const land: Axial = [q + dq, r + dr];
    const start = game.hook<number[]>('__marbleTurn', ...land);
    game.frame(SLIDE_MS / 2);
    const middle = game.hook<number[]>('__marbleTurn', ...land);
    game.frame(SLIDE_MS / 2);
    const end = game.hook<number[]>('__marbleTurn', ...land);
    expect(middle).not.toEqual(start);
    expect(end).not.toEqual(middle);
    game.frame(SLIDE_MS);
    expect(game.hook('__marbleTurn', ...land)).toEqual(end); // over: the loop no longer turns it
  });

  it('drops what waited for the slide of a game New game replaced', async () => {
    const game = await boot('?bot=off');
    const start = legal(game);
    const mv = playOne(game);
    const moved = JSON.stringify(mv.cells[0]);
    const black = start.find((m) => m.cells.length === 1 && JSON.stringify(m.cells[0]) !== moved)!.cells[0]!; // left in place
    game.click(...black); // waits for the slide; in the new game, Black to move, it would select that marble
    const newGame = document.getElementById('new-game')!;
    newGame.click();
    newGame.click(); // confirmed
    expect(plies(game)).toBe(0);
    expect(data().sliding).toBe('1');
    game.frame();
    expect(data().sliding).toBeUndefined(); // the stale slide ends at the next frame
    game.frame(SLIDE_MS);
    expect(rings(game)).toEqual([]); // the waiting click belonged to the old game
    game.click(...black); // the new game takes a click at once
    expect(rings(game)).toEqual([black]);
  });

  it('slides nothing with reduced motion: the next click acts at once', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    playOne(game);
    expect(data().sliding).toBeUndefined();
    const white = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...white);
    expect(rings(game)).toEqual([white]);
  });

  it('knocks with the pitch of the move once a gesture unlocked the sound', async () => {
    const game = await boot('?bot=off', { audio: true });
    dispatchEvent(new PointerEvent('pointerdown')); // the gesture
    playOne(game);
    expect(Number(data().knock)).toBeGreaterThan(0);
  });

  it('gives the knock what the move pushes and where on the board it is (#1574, #1576)', async () => {
    const game = await boot('?bot=off', { audio: true });
    const { Sfx } = await import('./sound'); // the module the page just loaded
    const knock = vi.spyOn(Sfx.prototype, 'knock');
    dispatchEvent(new PointerEvent('pointerdown'));
    const mv = playOne(game);
    const x = mv.cells.reduce((sum, [q, r]) => sum + q + r / 2, 0) / mv.cells.length;
    expect(knock).toHaveBeenCalledWith(mv.cells.length, 0, x / 4); // nothing pushed on the first move
    knock.mockRestore();
  });

  it('saves a local game after each move: a reload resumes it', async () => {
    const game = await boot('?bot=off');
    playOne(game);
    await game.settle();
    const indexedDB = globalThis.indexedDB as never;
    const again = await boot('?bot=off', { indexedDB });
    expect(plies(again)).toBe(1);
  });

  it('never saves a boss fight: a reload starts a fresh local game', async () => {
    const game = await boot('?nodes=20');
    startBoss('The Echo');
    expect(data().boss).toBeDefined();
    playOne(game);
    expect(plies(game)).toBe(1);
    await game.settle();
    const indexedDB = globalThis.indexedDB as never;
    const again = await boot('?nodes=20', { indexedDB });
    expect(plies(again)).toBe(0);
  });

  it('plays the bot reply once the slide of the move it answers ends', async () => {
    const game = await boot('?nodes=20');
    const first = game.turn();
    playOne(game);
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...black); // the bot thinks: no click counts
    expect(rings(game)).toEqual([]);
    await game.settle();
    expect(plies(game)).toBe(1); // the reply waits for the slide
    game.frame(SLIDE_MS);
    expect(plies(game)).toBe(2);
    expect(game.turn()).toBe(first); // the player's turn again
  });

  it('applies the plies of __playTurns as a catch-up: no slide, no knock', async () => {
    const game = await boot('?nodes=20');
    expect(await game.hook<Promise<number>>('__playTurns', 1, [0, 1, 2, 3, 4, 5])).toBe(1);
    expect(plies(game)).toBe(2);
    expect(data().sliding).toBeUndefined();
    expect(data().knock).toBeUndefined();
  });
});

describe('an ejection', () => {
  it('tumbles the marble out and spatters blood past the frame, both ending by themselves', async () => {
    const game = await boot('?bot=off&scene=room');
    pushOffBoard(game);
    expect(plies(game)).toBe(5);
    expect(data().ejections).toBe('1');
    expect(data().ejecting).toBe('tumble');
    expect(data().blood).toBe('spatter');
    expect(data().sound).toBe('none'); // no Web Audio
    type Drawn = { opacity: number; drop: number; along: number; turn: number[] };
    const [at0] = game.hook<Drawn[]>('__ejectAt', 0);
    const [at700] = game.hook<Drawn[]>('__ejectAt', 700);
    expect(at0!.opacity).toBe(1);
    expect(at700!.drop).toBeGreaterThan(at0!.drop); // it falls
    expect(at700!.opacity).toBeLessThan(1); // and fades
    expect(at0!.turn).toHaveLength(4);
    type Spray = { spray: { x0: number } | null; drops: number; cells: unknown[]; marbles: unknown[]; frame: unknown[] };
    const spray = game.hook<Spray>('__bloodAt', 300);
    expect(spray.spray).not.toBeNull();
    expect(spray.drops).toBeGreaterThan(0);
    expect(spray.cells).toHaveLength(61);
    expect(spray.marbles).toHaveLength(27 + Number(data().lastMove)); // 14 Black, 13 White, and the ring of each cell the last move landed on
    expect(spray.frame.length).toBeGreaterThan(0);
    expect(game.hook<Spray>('__bloodAt', BLOOD_MS * 10)).toMatchObject({ spray: null, drops: 0 }); // over
    game.frame(EJECT_MS / 2);
    expect(data().ejecting).toBe('tumble'); // still falling
    expect(game.hook('__ejectAt', 0)).toHaveLength(1);
    game.frame(EJECT_MS / 2);
    expect(data().ejecting).toBeUndefined();
    expect(game.hook('__ejectAt', 0)).toEqual([]);
    expect(data().blood).toBe('spatter'); // the blood lasts longer
    game.frame(BLOOD_MS - EJECT_MS);
    expect(data().blood).toBeUndefined();
    expect(game.hook<Spray>('__bloodAt', 300)).toMatchObject({ spray: null, drops: 0 }); // no spatter left
  });

  it('ends at once on a key', async () => {
    const game = await boot('?bot=off');
    pushOffBoard(game);
    expect(data().ejecting).toBe('tumble');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(data().ejecting).toBeUndefined();
    expect(data().blood).toBeUndefined();
    expect(game.hook('__ejectAt', 0)).toEqual([]);
  });

  it('ends at once on a press anywhere', async () => {
    const game = await boot('?bot=off');
    pushOffBoard(game);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(data().ejecting).toBeUndefined();
    expect(data().blood).toBeUndefined();
  });

  it('only fades with reduced motion, and spills no blood', async () => {
    const game = await boot('?bot=off', { reducedMotion: true });
    pushOffBoard(game);
    expect(data().ejections).toBe('1');
    expect(data().ejecting).toBe('fade');
    expect(data().blood).toBeUndefined();
    game.frame(FADE_MS);
    expect(data().ejecting).toBeUndefined();
  });

  it('tolls or clacks once a gesture unlocked the sound', async () => {
    const game = await boot('?bot=off', { audio: true });
    dispatchEvent(new PointerEvent('pointerdown')); // the gesture
    pushOffBoard(game);
    expect(['toll', 'clack']).toContain(data().sound);
  });
});

/** Plays Black online: Play online, then a White opponent on the other end of the room, seated and connected. */
async function joinAsWhite(game: Game) {
  slowKeys();
  document.getElementById('play-online')!.click();
  await game.online();
  const { Engine, engine_version } = await import('edgefall-wasm');
  let engine = new Engine();
  const received: number[][] = [];
  const session = new OnlineSession({
    game: game.room()!,
    side: 2,
    engine: engine_version(),
    keys: await generateKeys(),
    transport: game.peer()!,
    judge: {
      to_move: () => engine.to_move(),
      play: (mv) => engine.play(mv),
      status: () => engine.status(),
      restart: () => (engine = new Engine()),
    },
    onMove: (mv) => received.push(mv),
    onRefuse: () => {},
  });
  await session.settled;
  await game.settle();
  expect(data().opponent).toBe('here');
  return { session, received, engine: () => engine };
}

describe('a click', () => {
  it('does nothing once the game is over', async () => {
    const game = await boot('?bot=off');
    const input = document.getElementById('import-file') as HTMLInputElement;
    const file = new File([gameFileText({ bot: false, moves: BLACK_WINS })], 'won.json');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await game.settle();
    expect(plies(game)).toBe(BLACK_WINS.length);
    expect(data().over).toBeDefined();
    for (const [q, r] of CELLS) game.click(q, r); // every marble, every empty cell
    expect(rings(game)).toEqual([]);
    expect(plies(game)).toBe(BLACK_WINS.length);
  });

  it('selects and unselects a marble of the side to move, and an illegal target changes nothing', async () => {
    const game = await boot('?bot=off');
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...black);
    expect(rings(game)).toEqual([black]);
    expect(document.body.classList.contains('refused')).toBe(false);
    game.click(0, 0); // the empty centre is no target of that marble
    expect(rings(game)).toEqual([black]);
    expect(plies(game)).toBe(0);
    expect(document.body.classList.contains('refused')).toBe(true); // the turn line shakes (#1097)
    expect(game.hud()).toContain(' · not a legal move');
    game.click(...black);
    expect(rings(game)).toEqual([]);
    game.click(0, 0); // nothing selected: nothing was refused
    expect(game.hud()).not.toContain('not a legal move');
  });

  it('waits for the opponent online: a move would reach nobody', async () => {
    const game = await boot('?bot=off');
    slowKeys();
    document.getElementById('play-online')!.click();
    await game.online();
    expect(game.peer()).not.toBeNull();
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...black);
    expect(game.hud()).toContain('waiting for opponent');
    expect(rings(game)).toEqual([]);
  });

  it('online, sends our move to the opponent, then takes no click until their reply', async () => {
    const game = await boot('?bot=off');
    const white = await joinAsWhite(game);
    playOne(game);
    await game.settle();
    await white.session.settled;
    expect(white.received).toEqual(game.hook('__history'));
    game.frame(SLIDE_MS);
    const theirs = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    game.click(...theirs); // their marble, their turn
    expect(rings(game)).toEqual([]);
  });

  it("online, slides the opponent's move, even when a frame comes before the board is redrawn", async () => {
    const game = await boot('?bot=off');
    const white = await joinAsWhite(game);
    playOne(game);
    await game.settle();
    await white.session.settled;
    game.frame(SLIDE_MS);
    const mv = parseMoves(white.engine().legal_moves()).find((m) => m.cells.length === 1)!;
    const [q, r] = mv.cells[0]!;
    const [dq, dr] = DIRECTIONS[mv.dir]!;
    const land: Axial = [q + dq, r + dr];
    // The page applies the move, then redraws the board once the move is in its log: a frame may come in between.
    let before: unknown = 'no slide';
    const observer = new MutationObserver(() => {
      if (data().sliding !== '1') return;
      observer.disconnect();
      before = game.hook('__marbleTurn', ...land);
      game.frame(SLIDE_MS / 2);
    });
    observer.observe(document.body, { attributes: true });
    const record = encodeMove(mv);
    white.engine().play(Int32Array.from(record));
    await white.session.send(record);
    await game.settle();
    expect(before).toBeNull(); // the frame came before the redraw: no marble on the new cell yet
    expect(plies(game)).toBe(2);
    expect(game.hook('__marbleTurn', ...land)).not.toBeNull();
    expect(data().sliding).toBe('1');
    game.frame(SLIDE_MS);
    expect(data().sliding).toBeUndefined();
  });

  it('online as a spectator, never selects', async () => {
    slowKeys();
    const game = await boot('?bot=off#room=spectated');
    await game.online();
    const [keys, other] = [await generateKeys(), await generateKeys()];
    const creator = new OnlineSession({
      game: game.room()!,
      side: 1,
      engine: (await import('edgefall-wasm')).engine_version(),
      keys,
      transport: game.peer()!,
      judge: { to_move: () => 1, play: () => {}, status: () => 0, restart: () => {} },
      onMove: () => {},
      onRefuse: () => {},
    });
    creator.seats.claim(2, other.pub); // the seat of White is someone else's, before the creator's Hello goes out
    await creator.settled;
    await game.settle();
    expect(data().seat).toBe('spectator');
    game.click(...legal(game).find((m) => m.cells.length === 1)!.cells[0]!); // a Black marble, Black to move
    expect(rings(game)).toEqual([]);
  });
});

describe('the pointer on the board', () => {
  it('selects the marble under a click on the canvas, and a click off the board does nothing', async () => {
    const game = await boot('?bot=off');
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    tap(screen(game, ...black));
    expect(rings(game)).toEqual([black]);
    tap({ x: 1, y: 1 }); // the corner of the window: no cell
    expect(rings(game)).toEqual([black]);
  });

  it('still clicks when the pointer moved a few pixels only', async () => {
    const game = await boot('?bot=off');
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    const at = screen(game, ...black);
    const corner = screen(game, 4, -4);
    pointer('pointerdown', at.x, at.y);
    pointer('pointermove', at.x + 2, at.y);
    pointer('pointerup', at.x + 2, at.y);
    expect(rings(game)).toEqual([black]);
    expect(screen(game, 4, -4)).toEqual(corner); // no orbit
  });

  it('orbits the camera on a drag, which never selects', async () => {
    const game = await boot('?bot=off');
    const at = { x: 1, y: 1 }; // off the marbles: a press on one of the player's is the drag play (#794)
    const corner = screen(game, 4, -4);
    pointer('pointerdown', at.x, at.y);
    pointer('pointermove', at.x + 40, at.y);
    const turned = screen(game, 4, -4);
    expect(away(turned, corner)).toBeGreaterThan(5);
    pointer('pointermove', at.x + 41, at.y); // dragging already: a small step orbits too
    expect(away(screen(game, 4, -4), turned)).toBeGreaterThan(0);
    pointer('pointerup', at.x + 41, at.y);
    expect(rings(game)).toEqual([]);
  });

  // Bug #475: an orbit rebuilt the look (props, fog, pixel ratio) on every pointermove. __looks counts the rebuilds,
  // so e2e/camera.spec.ts checks it without a wall-clock budget (#545).
  it('rebuilds no look while orbiting, however many moves, bug #475', async () => {
    const game = await boot('?bot=off');
    const looks = (): number => game.hook<number>('__looks');
    const before = looks();
    document.getElementById('setting-clear-board')!.click(); // a setting rebuilds the look once
    expect(looks()).toBe(before + 1);
    pointer('pointerdown', 400, 300);
    for (let i = 1; i <= 20; i++) pointer('pointermove', 400 + i * 10, 300);
    pointer('pointerup', 600, 300);
    expect(looks()).toBe(before + 1);
  });

  it('zooms on a pinch, which never selects', async () => {
    const game = await boot('?bot=off');
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    const at = screen(game, ...black);
    const centre = screen(game, 0, 0);
    const corner = screen(game, 4, -4);
    pointer('pointerdown', at.x, at.y, 1);
    pointer('pointerdown', at.x + 100, at.y, 2);
    pointer('pointermove', at.x + 200, at.y, 2); // the fingers move apart
    expect(away(screen(game, 4, -4), centre)).toBeGreaterThan(away(corner, centre)); // closer
    pointer('pointerup', at.x + 200, at.y, 2);
    pointer('pointerup', at.x, at.y, 1);
    expect(rings(game)).toEqual([]);
  });

  it('never clicks on a cancelled press', async () => {
    const game = await boot('?bot=off');
    const black = legal(game).find((m) => m.cells.length === 1)!.cells[0]!;
    const at = screen(game, ...black);
    pointer('pointerdown', at.x, at.y);
    pointer('pointercancel', at.x, at.y);
    expect(rings(game)).toEqual([]);
  });

  it('draws the ghost of the move under the hovering pointer, and none off the board', async () => {
    const game = await boot('?bot=off');
    const mv = legal(game).find((m) => m.cells.length === 1)!;
    game.click(...mv.cells[0]!);
    const target = game.hook<{ cell: Axial; dir: number }[]>('__targets').find((t) => t.dir === mv.dir)!;
    const at = screen(game, ...target.cell);
    expect(data().ghosts).toBe('0');
    pointer('pointermove', at.x, at.y);
    expect(Number(data().ghosts)).toBeGreaterThan(0);
    pointer('pointermove', at.x + 1, at.y); // the same cell
    expect(Number(data().ghosts)).toBeGreaterThan(0);
    pointer('pointermove', 1, 1);
    expect(data().ghosts).toBe('0');
  });

  it('zooms on the wheel, and Reset view brings the first view back', async () => {
    const game = await boot('?bot=off&scene=room');
    const centre = screen(game, 0, 0);
    const corner = screen(game, 4, -4);
    const wheel = new WheelEvent('wheel', { deltaY: -500, cancelable: true });
    canvas().dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true); // the page never scrolls
    expect(away(screen(game, 4, -4), centre)).toBeGreaterThan(away(corner, centre));
    const reset = document.getElementById('view-reset') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(screen(game, 4, -4)).toEqual(corner);
  });

  it('frames the board again when the window is resized', async () => {
    const game = await boot('?bot=off');
    const [width, height] = [innerWidth, innerHeight];
    try {
      Object.assign(window, { innerWidth: 400, innerHeight: 800 }); // a phone held upright
      dispatchEvent(new Event('resize'));
      const centre = screen(game, 0, 0);
      expect(centre.x).toBeCloseTo(200);
      expect(centre.y).toBeCloseTo(400); // centred (#1387)
      expect(screen(game, 4, 0).x).toBeLessThan(400); // the whole width fits
      expect(screen(game, -4, 0).x).toBeGreaterThan(0);
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
    }
  });
});

describe('the frame loop', () => {
  it('rings the last move: a flash when the slide ends, then the resting mark (#1092)', async () => {
    const game = await boot('?bot=off');
    expect(game.hook<{ opacity: number; scale: number }>('__lastMoveRing').scale).toBe(0); // no ring before the first move
    playOne(game);
    expect(data().lastMove).not.toBe('0');
    game.frame(0);
    game.frame(SLIDE_MS + MOTION.base / 2);
    expect(game.hook<{ opacity: number; scale: number }>('__lastMoveRing').opacity).toBeGreaterThan(0.9);
    game.frame(MOTION.base);
    expect(game.hook<{ opacity: number; scale: number }>('__lastMoveRing')).toEqual({ opacity: 0.9, scale: 1 });
  });

  it('under automation draws at most every 100 ms', async () => {
    const game = await boot('?bot=off');
    game.frame();
    expect(game.draws()).toBe(1);
    game.frame();
    expect(game.draws()).toBe(1);
    expect(game.hook('__draws')).toBe(1);
    game.frame(100);
    expect(game.draws()).toBe(2);
    expect(game.hook('__draws')).toBe(2);
  });

  it('draws every frame for a player', async () => {
    const game = await boot('?bot=off', { webdriver: false });
    game.frame();
    game.frame();
    game.frame();
    expect(game.draws()).toBe(3);
    expect(game.hook('__draws')).toBe(3);
  });

  it('keeps drawing every frame while the dust of the high tier drifts (#443, #848)', async () => {
    const game = await boot('?bot=off&quality=high', { webdriver: false });
    game.frame();
    game.frame();
    game.frame();
    expect(game.draws()).toBe(3);
  });

  it('leaves a still board undrawn for a player, and draws again on an input, a camera move and a slide (#848)', async () => {
    const game = await boot('?bot=off&quality=low', { webdriver: false }); // no dust drifting
    const drawsOver = (frames: number): number => {
      const before = game.draws();
      for (let i = 0; i < frames; i++) game.frame();
      return game.draws() - before;
    };
    // Each change draws two frames: the bloom blurs every second one (scene.ts, #894), so the glow follows the change.
    expect(drawsOver(3)).toBe(2); // the first picture
    expect(drawsOver(3)).toBe(0); // nothing changed
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    expect(drawsOver(3)).toBe(2);
    canvas().dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true })); // a zoom, on the canvas only
    expect(drawsOver(3)).toBe(2);
    playOne(game); // by the page hooks: no input event, the move alone asks for the draws
    expect(drawsOver(3)).toBe(3);
    expect(data().sliding).toBe('1'); // each frame of the slide draws
    const last = game.draws();
    game.frame(SLIDE_MS); // its last frame
    expect(data().sliding).toBeUndefined();
    expect(game.draws()).toBe(last + 1);
    game.frame(MOTION.base); // the pulse of the last move (#1092)
    expect(drawsOver(3)).toBe(1); // its last picture once more, for the bloom
    expect(drawsOver(3)).toBe(0); // still again
  });
});
