import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ANNOUNCED_AT, CONVERTED_AT, EXPLODED_AT, SEED, parseRecorded } from '../src/test/chaplain-game';
import { startBoss, startMode } from './modes';
import { shot } from './shot';

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

// #358: every boss tell has a sound twin, played when the tell appears or changes. window.__tellCues() lists the cues
// played so far. The clicks that open the fight are the gesture that starts the audio.
const tellCues = (page: Page) => page.evaluate(() => (window as any).__tellCues()) as Promise<string[]>;

test('start The Echo, play a move, the boss replies, Retry resets the board', async ({ page }) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  const hud = page.locator('#hud');
  const plies = () => page.evaluate(() => (window as any).__plies());
  const click = async (q: number, r: number) => {
    const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
    await page.mouse.click(p.x, p.y);
  };

  await startMode(page, 'echo');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(hud).toContainText('P1');
  await expect(hud).toContainText('White to move');
  await expect(page.locator('#hud .notch.active')).toHaveText('P1');

  await click(0, 2); // a Black marble
  await click(0, 1); // its NW neighbour, empty at the start

  // The boss answers in the worker: two plies, the HUD is back on the human side.
  await expect.poll(plies, { timeout: 30_000 }).toBe(2);
  await expect(hud).toContainText('White to move');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await shot(page, { path: 'test-results/boss-hud.png', clip: { x: 0, y: 0, width: 420, height: 260 } });

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(plies).toBe(0);
  await expect(hud).toContainText('White to move');
  await expect(page.locator('#boss-bar .name')).toContainText('The Echo');
  await expect(hud).toContainText('White ejected 0/6');
});

// The Hull (#149): a rim cell cracks at ply 8, shows its ticks for 2 player turns, then it is a hole. The cracked cell wears
// the crack decal in both quality tiers, with Clear board off and on (#355, world.md section 8), 3:1 on the cell with
// Clear board on: the fog dims the far rim cells under 3:1 (bug #399). The crack's course and the decal's contrast are
// two tests: together they took over 15 s on CI (#431).
// The fight starts, and Clear board flips, by click events on their buttons, the menus closed: opening them is checked
// by the Echo test and clear-board.spec.ts, and each real click cost 1.7 to 2.3 s on CI at 1280 x 720 (#429).
// CRACK_SEED puts the crack on a cell in the open, seen whole (seeds 2, 4 and 6 hide it behind a marble).
const CRACK_SEED = 1;
// `seed` fixes the fight (#1195): the cracked cell is the same every run, and ?nodes=200 makes the replies the same, so the
// decal is not left behind a marble from time to time.
const startHull = async (page: Page, tier: string, seed?: number) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no animation is checked: slides take no time
  await page.addInitScript((t) => localStorage.setItem('ab-alone.tier', t), tier);
  if (seed !== undefined) {
    await page.addInitScript((fill) => {
      crypto.getRandomValues = ((a: Uint32Array) => a.fill(fill)) as typeof crypto.getRandomValues;
    }, seed);
  }
  await page.goto(seed === undefined ? './' : './?nodes=200');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-tier', tier);
  await startBoss(page, 'The Hull');
  await expect(page.locator('#boss-bar .name')).toContainText('The Hull');
  await expect(page.locator('body')).toHaveAttribute('data-cracks', '0');
};

for (const tier of ['high', 'low']) {
  test(`start The Hull (${tier} tier), play to the first wave: a cracked cell ticks down, then vanishes, #149`, async ({ page }, testInfo) => {
    const body = page.locator('body');
    const hud = page.locator('#hud');
    const plies = () => page.evaluate(() => (window as any).__plies());
    const click = async (q: number, r: number) => {
      const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
      await page.mouse.click(p.x, p.y);
    };
    // A forward one-marble move (NW or NE): Black never steps back, so no position repeats. The mouse plays the first
    // one, the gesture that starts the audio of the tell cues, __playTurns the next three (#429, the same moves), the
    // test hook the last (the same handler a click calls).
    const advance = async (mouse: boolean) => {
      const mv = await page.evaluate(() =>
        (window as any).__legal().find((m: any) => m.cells.length === 1 && (m.dir === 4 || m.dir === 2)),
      );
      const [q, r] = mv.cells[0];
      const send = mouse ? click : (cq: number, cr: number) => page.evaluate(([x, y]) => (window as any).__click(x, y), [cq, cr]);
      await send(q, r);
      await send(mv.dir === 4 ? q : q + 1, r - 1);
    };

    await startHull(page, tier);
    await advance(true);
    await expect.poll(plies, { timeout: 30_000 }).toBe(2); // the boss replied
    expect(await page.evaluate(() => (window as any).__playTurns(3, [4, 2]))).toBe(3);
    await expect.poll(plies, { timeout: 30_000 }).toBe(8);
    await expect(body).toHaveAttribute('data-cracks', '1');
    await expect(hud).toContainText('Cracks: 1 cell in 2 turns');
    expect(await tellCues(page)).toEqual(['crack']); // the crack appears
    await shot(page, { path: testInfo.outputPath('hull-cracked.png') });

    await advance(false);
    await expect.poll(plies, { timeout: 30_000 }).toBe(10);
    expect(await tellCues(page)).toEqual(['crack', 'crack']); // it ticked down on ply 9
    await expect(body).toHaveAttribute('data-cracks', '1');
    await advance(false);
    await expect.poll(plies, { timeout: 30_000 }).toBe(12);
    expect(await tellCues(page)).toEqual(['crack', 'crack']); // then vanished on ply 11: no cue for a gone tell
    await expect(body).toHaveAttribute('data-vanished', '1');
    expect(await page.evaluate(() => (window as any).__frame())).toMatchObject({ radius: 4, holes: 1, drawn: true, dishes: 60 }); // a hole in the frame (#292), one dish fewer on the terrace (#1374)
    await expect(body).toHaveAttribute('data-cracks', '0');
    await expect(hud).not.toContainText('Cracks:');
    expect(await page.evaluate(() => (window as any).__crackDecals())).toEqual([]);
    await shot(page, { path: testInfo.outputPath('hull-vanished.png') });
  });

  test(`start The Hull (${tier} tier): the cracked cell wears the crack decal, #355`, async ({ page }) => {
    const body = page.locator('body');
    await page.setViewportSize({ width: 1280, height: 720 });
    await startHull(page, tier, CRACK_SEED);
    expect(await page.evaluate(() => (window as any).__playTurns(4, [4, 2]))).toBe(4); // the forward moves to the crack
    // The decals and the cracked cells in one call to the page (#431): one crack, which wears the decal.
    const { decals, cracks } = await page.evaluate(() => {
      const w = window as any;
      return { decals: w.__crackDecals() as [number, number][], cracks: w.__cracks().map((c: any) => c.cell) };
    });
    expect(cracks).toHaveLength(1);
    expect(decals).toEqual(cracks);
    await page.getByRole('button', { name: 'Clear board', includeHidden: true }).dispatchEvent('click');
    await expect(body).toHaveAttribute('data-clear', 'on');
    expect(await page.evaluate(() => (window as any).__crackDecals())).toEqual(decals);
  });
}

// The Chaplain fight from its start, on the fight seed of the recorded game (#748): the plies of the core fixture are played
// by one call (__playMoves), the way every other spec loads the state it needs. ?nodes=200: the test budget of the boss search.
const startChaplain = async (page: Page, { reduced = true } = {}) => {
  await page.addInitScript((seed) => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(seed)) as typeof crypto.getRandomValues; // the fight seed
  }, SEED);
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('./?nodes=200');
  await page.locator('canvas').waitFor();
  await startMode(page, 'chaplain');
  await expect(page.locator('#boss-bar .name')).toContainText('The Chaplain');
  await expect(page.locator('body')).toHaveAttribute('data-converted', '0');
};

/** Plays the recorded plies `from` to `to` (excluded). */
const recordedGame = () =>
  parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/chaplain.txt', import.meta.url), 'utf8'));
const playRecorded = (page: Page, from: number, to: number) =>
  page.evaluate((records) => (window as any).__playMoves(records), recordedGame().slice(from, to));

const cellScreen = (page: Page, q: number, r: number) =>
  page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]) as Promise<{ x: number; y: number }>;

// The Chaplain (#150, #748): a hovered move shows the marbles it would flip at the end of the turn it plays.
test('start The Chaplain: a hovered move shows the marbles it flips, #150', async ({ page }, testInfo) => {
  const body = page.locator('body');
  const hud = page.locator('#hud');
  await page.addInitScript(() => localStorage.setItem('ab-alone.difficulty', 'normal')); // the recorded game is measured at a known difficulty, not the default (Easy, #1664)
  await startChaplain(page);
  const DIRS = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]];
  const exposing = () =>
    page.evaluate(() => {
      const w = window as any;
      return w.__legal().find((m: any) => m.cells.length === 1 && w.__preview(m).length > 0) ?? null;
    });

  let found = await exposing();
  for (let k = 0; k < EXPLODED_AT && !found; k += 2) {
    await playRecorded(page, k, k + 2);
    found = await exposing();
  }
  expect(found).not.toBeNull();
  const [q, r] = found.cells[0];
  const [dq, dr] = DIRS[found.dir]!;
  const at = await cellScreen(page, q, r);
  await page.mouse.click(at.x, at.y); // select the marble
  const flipCues = async () => (await tellCues(page)).filter((c) => c === 'flip').length;
  const heard = await flipCues();
  const t = await cellScreen(page, q + dq!, r + dr!);
  await page.mouse.move(t.x, t.y); // hover the move: ghost and flip preview
  await expect(body).not.toHaveAttribute('data-flips', '0');
  await expect(hud).toContainText('Flips this turn');
  await page.mouse.move(t.x + 2, t.y + 2); // the same move still hovered: the same tell, no second cue
  expect(await flipCues()).toBe(heard + 1);
  await shot(page, { path: testInfo.outputPath('chaplain-preview.png') });
});

// The same fight, a converted marble keeps its own look (#326): half ridged shell, half glass (no hidden core since #886), under
// the wax (#508), its glass half 3:1 against its shell. The recorded game converts its first marble at ply 24.
test('start The Chaplain: a converted marble keeps its look, #150', async ({ page }) => {
  await startChaplain(page);
  await playRecorded(page, 0, CONVERTED_AT - 1);
  await expect(page.locator('body')).toHaveAttribute('data-converted', '0');
  await playRecorded(page, CONVERTED_AT - 1, CONVERTED_AT);
  await expect(page.locator('body')).not.toHaveAttribute('data-converted', '0');
  await expect(page.locator('#hud')).toContainText('Converted:');
  const cells = await page.evaluate(() => (window as any).__converted());
  const looks = await page.evaluate(() => (window as any).__convertedLooks());
  expect(looks).toHaveLength(cells.length);
  expect(looks).toEqual(expect.arrayContaining(cells.map((cell: [number, number]) => ({ cell, parts: ['wax', 'shell', 'glass', 'cracks', 'glyph', 'glyph-outline'] }))));
});

// The Chaplain's martyr (#748): after 4 ejections one boss marble wears the tell and the HUD says it explodes; the next boss
// turn it explodes, a flash and a ring of shards, and counts as the 5th ejection. Reduced motion: a static flash, no shard.
test('The Chaplain: a martyr is announced, then explodes and counts as the 5th ejection, #748', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const body = page.locator('body');
  await startChaplain(page, { reduced: false });
  await playRecorded(page, 0, ANNOUNCED_AT);
  await expect(body).not.toHaveAttribute('data-martyr', '');
  await expect(page.locator('#hud')).toContainText('Martyr marked');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('chaplain-martyr.png') });
  await playRecorded(page, ANNOUNCED_AT, EXPLODED_AT);
  await expect(body).toHaveAttribute('data-martyr', '');
  await expect(body).toHaveAttribute('data-explosions', '1');
  await shot(page, { path: testInfo.outputPath('chaplain-explosion.png') }); // the flash and the shards
  await expect(body).toHaveAttribute('data-martyr', '');
  await expect(page.locator('#hud')).toContainText('White ejected 5/6');
  expect(await page.evaluate(() => (window as any).__blast()?.shards)).toBe(8);
  await expect(body).not.toHaveAttribute('data-exploding', '1', { timeout: 5_000 }); // and gone
  expect(errors).toEqual([]);
});

// The Choir (#183, #747): the standard board, a glyph per army on the boss marbles, only the army in turn
// moves and the next one wears a ring.
test('start The Choir: the boss moves the army in turn, the next army is marked, #183', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  const hud = page.locator('#hud');
  const plies = () => page.evaluate(() => (window as any).__plies());
  type Member = { cell: [number, number]; army: number };
  const armies = () => page.evaluate(() => (window as any).__armies()) as Promise<Member[]>;
  const cellsOf = (list: Member[], army: number) =>
    list.filter((m) => m.army === army).map((m) => m.cell.join(',')).sort();
  const click = async (q: number, r: number) => {
    const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
    await page.mouse.click(p.x, p.y);
  };

  await page.keyboard.press('Shift'); // a gesture: the page makes its audio on the first one, the menu press used to be it, and the tell cue needs it
  await startMode(page, 'choir');
  await expect(page.locator('#boss-bar .name')).toContainText('The Choir');
  await expect(hud).toContainText('White ejected 0/6 · Black ejected 0/6');
  await expect(hud).toContainText('Next army: Alto');
  await expect(page.locator('#hud .notch')).toHaveCount(3);
  await expect(body).toHaveAttribute('data-vanished', '0'); // the standard board
  await expect(body).toHaveAttribute('data-armies', '18');
  await expect(body).toHaveAttribute('data-next-army', 'Alto');
  expect(await tellCues(page)).toEqual(['choir']); // the next-army tell appears
  await shot(page, { path: testInfo.outputPath('choir-start.png') });

  const before = await armies(); // the armies before the two moves, as #183 reads them
  const mv = await page.evaluate(() =>
    (window as any).__legal().find((m: any) => m.cells.length === 1 && (m.dir === 4 || m.dir === 2)),
  );
  const [q, r] = mv.cells[0];
  await click(q, r);
  await click(mv.dir === 4 ? q : q + 1, r - 1);
  await expect.poll(plies, { timeout: 30_000 }).toBe(2); // the boss replied
  const after = await armies();
  expect(cellsOf(after, 0)).not.toEqual(cellsOf(before, 0)); // Alto, the army in turn, moved
  expect(cellsOf(after, 1)).toEqual(cellsOf(before, 1));
  expect(cellsOf(after, 2)).toEqual(cellsOf(before, 2));
  await expect(hud).toContainText('Next army: Tenor');
  await expect(body).toHaveAttribute('data-next-army', 'Tenor');
  expect(await tellCues(page)).toEqual(['choir', 'choir']); // once more for Tenor, not for the selection or the human move
  await shot(page, { path: testInfo.outputPath('choir-tenor-next.png') });
});

// Task #377: the boss marks stay readable on other shell skins (a pale and a metal one): the Choir army glyphs at the
// start and a converted marble's glass half once The Chaplain converts one, 3:1 as for the default skin (#326, #508).
// Task #507: in boss mode the shells of the boss side wear their boss's accent (world.md section 5), a rust crown for
// The Hull, candle wax for The Chaplain, under any palette, safe mode and Clear board. window.__accents() lists the cells
// whose marble wears one. The screenshot is kept for the report.
for (const [name, accent, stored] of [
  ['The Hull', 'crown', { 'ab-alone.palette': 'contrast' }],
  ['The Chaplain', 'wax', { 'ab-alone.safe-mode': 'off', 'ab-alone.clear-board': 'on' }],
] as const) {
  test(`the boss side wears ${name}'s ${accent}, task #507`, async ({ page }, testInfo) => {
    await page.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, stored);
    await page.goto(accent === 'crown' ? './?scene=room' : './'); // the terrace leaves the Hull's crown off (#1374)
    await page.locator('canvas').waitFor();
    await startBoss(page, name);
    await expect(page.locator('#boss-bar .name')).toContainText(name);
    const worn = (await page.evaluate(() => (window as any).__accents())) as { cell: [number, number]; accent: string }[];
    expect(worn).toHaveLength(14);
    expect(worn.every((w) => w.accent === accent)).toBe(true);
    await freshDraw(page);
    await shot(page, { path: testInfo.outputPath(`accent-${accent}.png`) });
  });
}

// Task #564: The Ballast Mind is in the boss list. Its fight plays on the Bridge, on a radius 5 board with six void
// pillars, and its 16 shells wear the wire wrap (#507). The screenshot is kept for the report.
test('start The Ballast Mind: its radius 5 board on the Bridge, its shells in the wire wrap, task #564', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await startMode(page, 'ballast');
  await expect(page.locator('#boss-bar .name')).toContainText('The Ballast Mind');
  await expect(page.locator('#hud')).toContainText('White ejected 0/12 · Black ejected 0/12');
  await expect(body).toHaveAttribute('data-deck', 'bridge');
  await expect(body).toHaveAttribute('data-vanished', '6'); // the pillars
  expect(await page.evaluate(() => (window as any).__frame())).toMatchObject({ radius: 5, holes: 6 });
  const worn = (await page.evaluate(() => (window as any).__accents())) as { cell: [number, number]; accent: string }[];
  expect(worn).toHaveLength(16);
  expect(worn.every((w) => w.accent === 'wire')).toBe(true);
  expect(worn.some((w) => Math.abs(w.cell[0]) === 5)).toBe(true); // ring 5 is drawn too
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-start.png') });
});

// Task #573: The Ballast Mind default view and reset view frame its whole radius 5 board
test('The Ballast Mind radius 5 board frames in 1280x720 and phone upright, task #573', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await page.locator('canvas').waitFor();
  await startMode(page, 'ballast');
  await expect(page.locator('#boss-bar .name')).toContainText('The Ballast Mind');

  // Verify all radius 5 cells fit within the 1280x720 viewport
  const cells = await page.evaluate(() => {
    const list: [number, number][] = [];
    for (let q = -5; q <= 5; q++) {
      for (let r = -5; r <= 5; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 5) {
          list.push([q, r]);
        }
      }
    }
    const toScreen = (window as any).__cellToScreen;
    return list.map(([q, r]) => ({ q, r, ...toScreen(q, r) }));
  });
  expect(cells.every((c) => c.x > 30 && c.x < 1250 && c.y > 30 && c.y < 690)).toBe(true);

  // Reset view keeps the framing: the button over the board shows once the camera moved (#1681)
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, 400);
  await page.getByRole('button', { name: 'Reset view' }).click();
  const resetCells = await page.evaluate(() => {
    const toScreen = (window as any).__cellToScreen;
    return [toScreen(0, 5), toScreen(0, -5)];
  });
  expect(resetCells[0].y).toBeLessThan(690);
  expect(resetCells[1].y).toBeGreaterThan(30);

  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('ballast-view-1280x720.png') });

  // On a phone held upright
  await page.setViewportSize({ width: 375, height: 812 });
  await freshDraw(page);
  const phoneCells = await page.evaluate(() => {
    const toScreen = (window as any).__cellToScreen;
    return [toScreen(-5, 0), toScreen(5, 0), toScreen(0, 5)];
  });
  expect(phoneCells[0].x).toBeGreaterThan(10);
  expect(phoneCells[1].x).toBeLessThan(365);
  expect(phoneCells[2].y).toBeLessThan(780);
  await shot(page, { path: testInfo.outputPath('ballast-view-phone.png') });
});
