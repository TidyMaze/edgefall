import { expect, test, type Page } from '@playwright/test';
import { BLACK_WINS } from './end-games';
import { openModes, lowTierOnCi } from './modes';
import { paused } from './frameclock';
import { shot } from './shot';
import { test as shared } from './shared-world';

lowTierOnCi();

// #962: the Open world mode, behind ?openworld=<seed>: the hero rolls over the generated world, an obstacle stops it, and
// Escape leaves to the board. The blocked cell comes from the test hook, not from the terrain constants (#1002, #1137).
shared('the hero rolls over the Open world, an obstacle stops it, and Escape leaves, #965', async ({ world: page }) => {
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  await expect(page.locator('#openworld-hud')).toBeVisible(); // the plate shows at the load, before it folds (#1138)
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // it rolls over the world (3 steps fold the plate, #1138)
  await expect.poll(at).not.toBe('0,0');
  // a wall of enemies on the three cells ahead (the test hook): no side is free, so the held steering has nowhere to go (#1137)
  const here = (await at())!.split(',').map(Number) as [number, number];
  await page.evaluate(([q, r]) => {
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({
      hero: [q, r],
      troop: [[q - 1, r]],
      enemies: [[q + 1, r], [q + 1, r - 1], [q, r + 1]],
    });
  }, here);
  const before = here.join(',');
  await page.keyboard.press('ArrowRight'); // blocked
  await page.waitForTimeout(300);
  expect(await at()).toBe(before);
  // the cell it came from is open: the step is made, and a push of the troop may carry the hero back onto its cell (#967)
  const pushes = () => page.evaluate(() => document.body.dataset.openworldPush);
  const pushesBefore = await pushes();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await at()) !== before || (await pushes()) !== pushesBefore).toBe(true);
  await expect(page.locator('#openworld-chip')).toBeVisible(); // the steps folded the plate to its chip (#1138)
  await expect(page.locator('#hud')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#hud')).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.openworld)).toBeUndefined();
});

// #1063: while the Open world is on, its arrows roll the hero and do not open the board's replay underneath; Escape leaves
// the world for the Hub, as the exit of the dock does (#1605). The game (moves played) is loaded through the game file import.
test('the arrows in the Open world do not open the board replay, and leaving the world opens no replay, #1063', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  const save = JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: BLACK_WINS });
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(at).toBe('0,-1'); // up-left (#1273)
  await expect(page.locator('#replay-bar')).toHaveJSProperty('hidden', true); // the attribute, not the CSS: the HUD is hidden here anyway
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.body.dataset.openworld)).toBeUndefined();
  await expect(page.locator('#replay-bar')).toHaveJSProperty('hidden', true);
  await expect(page.locator('body')).toHaveAttribute('data-hub', /.+/); // Escape pressed the exit of the dock: the Hub, the game kept beneath (#1605)
});

// #988: a step up onto a higher cell. On seed 7 the spawn row runs grass at height 3 to (3, 0), then (4, 0) is grass at
// height 4: four Right presses reach it, the cell changes and the page keeps running while the camera eases up (the ease
// itself is unit tested in openworldview.test.ts).
shared('the hero steps up onto a higher cell of the Open world and the page keeps running, #988', async ({ world: page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(at).toBe(`${i},0`);
  }
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); // the frames after the step
  expect(errors).toEqual([]);
});

// #966: enemy marbles stand on the map and the troop of 15 trails the hero, the first marble on the cell it just left.
shared('enemy marbles are on the map and the troop follows the hero, #966', async ({ world: page }) => {
  const data = (key: 'openworldAt' | 'openworldTroop' | 'openworldEnemies') => page.evaluate((k) => document.body.dataset[k], key);
  await expect.poll(() => data('openworldAt')).toBe('0,0');
  expect(Number(await data('openworldEnemies'))).toBeGreaterThan(0);
  expect((await data('openworldTroop'))!.split(' ')).toHaveLength(15); // the troop starts at 15 marbles (flock)
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => data('openworldAt')).not.toBe('0,0');
  const before = await data('openworldAt');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => data('openworldAt')).not.toBe(before);
  expect((await data('openworldTroop'))!.split(' ')[0]).toBe(before);
});

// #977: a vertical and a horizontal arrow held together roll the hero on the diagonal. From (0, 0) Up rolls to (1, -1), the
// cell up-left of that is (1, -2), free on seed 7 (the path of the first test goes through it).
shared('two held arrows roll the hero on the diagonal, #977', async ({ world: page }) => {
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  // Up and Left held: the diagonal is the next step of the cadence (#1059), so the first move after the Left keydown is up-left.
  // The whole sequence runs in the page: when the hero reaches (1, -1) the Left key goes down in the same task, before the next frame can
  // step. A poll between the two keys saw a later cell on CI, where a frame takes 100 ms or more without a GPU and the walk goes on (#1436).
  const firstMove = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        const key = (type: string, name: string) => window.dispatchEvent(new KeyboardEvent(type, { key: name }));
        let left = false;
        const observer = new MutationObserver(() => {
          const now = document.body.dataset.openworldAt!;
          if (!left) {
            if (now !== '1,-1') return;
            left = true;
            key('keydown', 'ArrowLeft');
            return;
          }
          if (now === '1,-1') return; // a mark of the same cell (the models arriving) is no move
          observer.disconnect();
          done(now);
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-openworld-at'] });
        key('keydown', 'ArrowUp');
      }),
  );
  expect(firstMove).toBe('1,-2');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
});

// #1059: a held arrow walks the hero on its own, with no key repeat: the keydown steps at once, the frames step while it is held, and
// the keyup stops it. The spawn's clearing is open to 3 cells on every seed, so 3 cells are walked with no obstacle in the way, and the
// walk stops once the arrow is let go. No enemy: a wandering marble that met the hero started a wild fight, the world left (#1511, #1643).
// The page's clock is paused (frameclock.ts): on flowing time the frames walked on before the first look, 317 ms after the keydown on a
// loaded CI runner, which saw 3,0 and never 1,0 (#1659). Each frame of 140 ms (GLIDE_MS) is one step; the pace is the unit test's (openworldmode.test.ts).
shared('a held arrow walks the Open world on its own and stops on keyup, #1059', async ({ world: page }) => {
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  await page.evaluate(() => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [], enemies: [] }));
  await paused(page, async (frame) => {
    await page.keyboard.down('ArrowRight');
    expect(await at()).toBe('1,0'); // the keydown's own step, before any frame
    await frame(140); // no key repeat is sent for a key held down: the frames walk on
    await frame(140);
    expect(await at()).toBe('3,0');
    await page.keyboard.up('ArrowRight');
    await frame(400);
    await frame(400);
    expect(await at()).toBe('3,0'); // let go: no more steps
  });
});

// #976: the wheel zooms the Open world camera out far and back, and the hero still rolls from the far zoom.
shared('the wheel zooms the Open world out far and back, and the hero still rolls, #976', async ({ world: page }) => {
  const zoom = async () => Number(await page.evaluate(() => document.body.dataset.openworldZoom));
  await expect.poll(zoom).toBe(1);
  const box = (await page.locator('canvas:not(#openworld-minimap)').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect.poll(zoom).toBeGreaterThan(2.5); // far out
  // still 3D: the ground, the props, the troop and the enemies are all drawn
  const drawn = await page.evaluate(() => JSON.parse(document.body.dataset.openworldDrawn!) as Record<string, number>);
  expect(drawn['terrain-grass']).toBeGreaterThan(0);
  expect(drawn['prop-tree']).toBeGreaterThan(0);
  expect(drawn.troop).toBe(15); // the troop starts at 15 marbles (flock)
  expect(drawn.enemies).toBeGreaterThan(0);
  // from the far zoom the hero rolls, then the wheel zooms back: one zoom out, not two, whose far chunks cost seconds a frame on a loaded
  // machine's software GL (the test timed out at 45 s, #1643)
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('1,-1');
  await page.mouse.wheel(0, -2000);
  await expect.poll(zoom).toBe(1);
});

// #976: the loaded chunks cover the ground in view at every zoom, so the edge of the loaded area never shows: on a 32:9 screen
// at the widest zoom, the four edge strips of a screenshot have no pixel of the background colour (the neon look's sky, #04050c, #1424; the
// terrace look's sky at the start of day, #93b5d9, drawn as (172, 190, 205) once graded, #1496).
for (const [look, query, [br, bg, bb], allowed] of [
  ['neon', '', [4, 5, 12], 3], // the default look (#1424): no look in the address
  ['terrace', '&look=terrace', [172, 190, 205], 0], // the way back, by address
] as const)
test(`the widest zoom on a 32:9 screen shows no black background at its edges in the ${look} look, #976`, async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 270 }); // 32:9 at a quarter of the pixels: the ratio sets the reach, the software tier draws it faster
  await page.goto(`./?bot=off&openworld=7&hub=classic${query}`);
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  const box = (await page.locator('canvas:not(#openworld-minimap)').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 5000); // as far out as the screen allows
  await expect.poll(async () => Number(await page.evaluate(() => document.body.dataset.openworldZoom))).toBeGreaterThan(2.5);
  // the camera follows the zoom set by a spring (#1333): wait until it draws the widest zoom, or the shot shows the closer one
  await expect
    .poll(() => page.evaluate(() => Math.abs((window as unknown as { __openworldCamera: () => { zoom: number } }).__openworldCamera().zoom - Number(document.body.dataset.openworldZoom))))
    .toBeLessThan(0.001);
  // a 32:9 screen stops before the 16:9 widest zoom (6): its reach would pass MAX_REACH further out
  expect(Number(await page.evaluate(() => document.body.dataset.openworldZoom))).toBeLessThan(6);
  const png = await page.screenshot();
  const background = await page.evaluate(async ([base64, [br, bg, bb]]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const strip = (x: number, y: number, w: number, h: number): number => {
      const d = ctx.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - br) <= 2 && Math.abs(d[i + 1]! - bg) <= 2 && Math.abs(d[i + 2]! - bb) <= 2) n++;
      return n;
    };
    const { width: w, height: h } = canvas;
    return { top: strip(0, 0, w, 6), bottom: strip(0, h - 6, w, 6), left: strip(0, 0, 6, h), right: strip(w - 6, 0, 6, h) };
  }, [png.toString('base64'), [br, bg, bb]] as const);
  // Owner decision (#1424): the neon look tolerates 3 px at most of dark ground at the edges (its ground fades to near the sky colour); the terrace stays at 0.
  expect(background.top + background.bottom + background.left + background.right, JSON.stringify(background)).toBeLessThanOrEqual(allowed);
});

// #989: the props within 8 cells of the hero are drawn with their detailed models once those load, the low-poly ones beyond.
test('the props near the hero are drawn detailed, the ones beyond low-poly, #989', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ab-alone.tier', 'high')); // the detailed models are a high tier part: this spec keeps the tier it tests on CI too (#1436)
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7'); // entered: the world is drawn
  const drawn = () => page.evaluate(() => JSON.parse(document.body.dataset.openworldDrawn!) as Record<string, number>);
  const DETAILED = ['prop-mountain-hi', 'prop-tree-hi', 'prop-boulder-hi', 'prop-wall-hi'];
  const LOW = ['prop-mountain', 'prop-tree', 'prop-boulder', 'prop-wall'];
  const sum = (counts: Record<string, number>, keys: string[]) => keys.reduce((total, k) => total + (counts[k] ?? 0), 0);
  await expect.poll(async () => sum(await drawn(), DETAILED)).toBeGreaterThan(0); // the detailed models arrive, then near the hero
  const counts = await drawn();
  expect(sum(counts, LOW)).toBeGreaterThan(0); // and the low-poly ones beyond
  expect(counts['prop-tree-hi']).toBeLessThanOrEqual(217);
});

// #1000: the entry is in the mode menu for everyone, and a click enters a world with a random seed.
test('the Open world is in the mode menu without the flag, and a click enters a random world, #1000', async ({ page }) => {
  await page.goto('./?bot=off&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await openModes(page);
  await expect(page.locator('#openworld')).toBeVisible();
  await page.locator('#openworld').click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toMatch(/^\d+$/);
});

// #967: the troop pushes the enemy in front of it after a step. The fixture puts the hero on (0, 0) with two troop marbles
// behind it and one enemy on (2, 0): one Right press rolls the hero onto (1, 0), the line of three pushes the enemy on to
// (3, 0) and the hero along with it, to (2, 0). The state is final at once; the push is drawn as an animation of about 0.6 s.
// The page's clock is paused (frameclock.ts): on flowing time a loaded machine draws a frame every 0.8 s (load 53), so the first frame after
// the keydown could already be past the push, take the mark down, and the first look saw no animation (#1660).
shared('the troop pushes the enemy in front of it after a step, and the enemy moves on, #967', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7'); // entered: the world is drawn
  await page.evaluate(() =>
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({
      hero: [0, 0],
      troop: [[-1, 0], [-2, 0]],
      enemies: [[2, 0]],
    }),
  );
  const anim = () => page.evaluate(() => document.body.dataset.openworldAnim);
  await paused(page, async (frame) => {
    await page.keyboard.press('ArrowRight');
    // The push is drawn as an animation at once (the state was final before it): the mark is up until its lunge, slide and fall are over.
    expect(await anim()).toBe('1'); // from the keydown, before any frame
    expect(await page.evaluate(() => document.body.dataset.openworldPush)).toBe('1');
    expect(await page.evaluate(() => document.body.dataset.openworldAt)).toBe('2,0');
    expect(await page.evaluate(() => document.body.dataset.openworldTroop)).toBe('1,0 0,0'); // the two troop marbles trail the hero on (2,0): the line of three pushed forward one cell each, no third marble
    expect(await page.evaluate(() => (window as unknown as { __openworldEnemies: () => number[][] }).__openworldEnemies())).toEqual([[3, 0]]);
    expect(await page.evaluate(() => document.body.dataset.openworldBeaten)).toBe('0');
    await frame(300); // the step has landed (140 ms), the lunge is under way
    expect(await anim()).toBe('1');
    await frame(400); // 700 ms after the keydown: the push is over (its end, 600 ms, is the unit test's, openworldmode.test.ts)
    expect(await anim()).toBeUndefined();
  });
});

// #967: with reduced motion the push is not drawn in between: the marbles jump to their cells, as before.
test('with reduced motion the troop pushes the enemy at once, with no animation, #967', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7'); // entered: the world is drawn
  await page.evaluate(() =>
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({
      hero: [0, 0],
      troop: [[-1, 0], [-2, 0]],
      enemies: [[2, 0]],
    }),
  );
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldPush)).toBe('1');
  expect(await page.evaluate(() => document.body.dataset.openworldAt)).toBe('2,0');
  expect(await page.evaluate(() => document.body.dataset.openworldAnim)).toBeUndefined();
});

// #1025: on a touch screen a touch on the left half shows the virtual joystick under the thumb; dragging right holds the right key,
// the hero walks on while the thumb is held and stops when it lifts. Touch is emulated through CDP (hasTouch).
test.describe('the touch joystick', () => {
  test.use({ hasTouch: true });
  test('a drag on the left half walks the hero right until the thumb lifts, #1025', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'needs a CDP session (newCDPSession), which only Chromium has');
    await page.goto('./?bot=off&openworld=7&hub=classic');
    await page.locator('canvas:not(#openworld-minimap)').waitFor();
    const at = () => page.evaluate(() => document.body.dataset.openworldAt);
    await expect.poll(at).toBe('0,0');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 150, 300);
    await expect(page.locator('#joystick')).toBeVisible();
    await touch('touchMove', 200, 300); // 50 px to the right: the right key is held
    await expect.poll(at).not.toBe('0,0');
    await touch('touchEnd', 200, 300);
    await expect(page.locator('#joystick')).toBeHidden();
    const stopped = await at();
    await page.evaluate(() => new Promise((done) => setTimeout(done, 600))); // a held stick would have stepped by now
    expect(await at()).toBe(stopped);
  });
});

// #1051: the settings menu of the Open world opens on screen. The cog is at the right of the column, as in a normal game (#1032 hid
// the dock), so the menu hangs from its right edge and stays inside the window at every size.
async function openSettingsInOpenWorld(page: Page): Promise<void> {
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  await page.locator('#settings').click();
  await expect(page.locator('#settings-menu')).toBeVisible();
}
async function expectMenuOnScreen(page: Page): Promise<void> {
  const box = (await page.locator('#settings-menu').boundingBox())!;
  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(box.x, 'left edge of the settings menu').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'right edge of the settings menu').toBeLessThanOrEqual(innerWidth);
}
test('the Open world settings menu is on screen at 1280x720, #1051', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSettingsInOpenWorld(page);
  await expectMenuOnScreen(page);
});
test('the Open world settings menu is on screen at 1920x1080, #1051', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSettingsInOpenWorld(page);
  await expectMenuOnScreen(page);
});
test.describe('the Open world settings menu on a touch phone, #1051', () => {
  test.use({ hasTouch: true });
  test('is on screen at 844x390 landscape', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openSettingsInOpenWorld(page);
    await expectMenuOnScreen(page);
  });
  test('stays on screen at 390x844 portrait', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettingsInOpenWorld(page);
    await expectMenuOnScreen(page);
  });
});

// #1026: Q and E turn the Open world camera round the hero by a step, R goes back to the default angle, and the turn is saved with
// the world (saved and resumed: main.openworld.test.ts; the turn itself: openworldview.test.ts and openworldmode.test.ts).
test('Q and E turn the Open world camera round the hero, R goes back, #1026', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  const yaw = () => page.evaluate(() => document.body.dataset.openworldYaw);
  await expect.poll(yaw).toBe('-30'); // the default faces a straight line of hexes (#1254)
  await page.keyboard.press('q');
  await expect.poll(yaw).toBe('30');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await expect.poll(yaw).toBe('-90');
  await page.keyboard.press('r');
  await expect.poll(yaw).toBe('-30');
  await page.keyboard.press('q');
  await expect.poll(yaw).toBe('30');
  // The turn saved on leaving and resumed on entering is a unit test (main.openworld.test.ts).
});

// #1040: a step glides the hero from its cell to the next one. The cell is exact at once (`openworldAt`, the save and the push use
// it); only the drawing glides. With the slow factor of 10 the glide lasts 1.4 s; the frames are drawn on the paused clock at 0.1 s and
// 0.6 s after the keydown, then every 0.2 s (frameclock.ts, #1643), so the browser sees the hero in between whatever a frame costs.
shared('a step glides the hero onto the next cell: exact at once, drawn in between, landed at the end, #1040', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  await page.evaluate(() => {
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [] });
    (window as unknown as { __openworldSlow: number }).__openworldSlow = 10;
  });
  await paused(page, async (frame) => {
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.body.dataset.openworldAt)).toBe('1,0');
    await frame(100);
    expect(await page.evaluate(() => document.body.dataset.openworldGlide)).toBeDefined();
    await shot(page, { path: test.info().outputPath('glide-mid-step-1.png') });
    await frame(500); // a second frame of the same glide, further along it
    await shot(page, { path: test.info().outputPath('glide-mid-step-2.png') });
    // on to its end: the tap's glide eases out to a rest (#1065), a frame every 0.2 s until it has landed, 4 s at most
    for (let i = 0; i < 20 && (await page.evaluate(() => document.body.dataset.openworldGlide)) !== undefined; i++) await frame(200);
    expect(await page.evaluate(() => document.body.dataset.openworldGlide)).toBeUndefined();
    expect(await page.evaluate(() => document.body.dataset.openworldAt)).toBe('1,0');
    expect(await page.evaluate(() => document.body.dataset.openworldAnim)).toBeUndefined();
  });
});

// #1043: the marbles carry a stripe that turns with the roll. The camera follows the hero, so the hero stays at the centre of the
// screen: two frames of the same glide, 0.5 s apart on the paused clock (frameclock.ts, #1643), differ in its centre box (the stripe turns across the marble).
shared('a glide of the hero turns its stripe: two frames in between differ on the marble, #1043', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  await page.evaluate(() => {
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [] });
    (window as unknown as { __openworldSlow: number }).__openworldSlow = 10;
  });
  const [first, second] = await (async () => {
    const shots: Buffer[] = [];
    await paused(page, async (frame) => {
      await page.keyboard.press('ArrowRight');
      await frame(100);
      expect(await page.evaluate(() => document.body.dataset.openworldGlide)).toBeDefined();
      shots.push(await page.screenshot({ path: test.info().outputPath('stripe-mid-glide-1.png') }));
      await frame(500);
      shots.push(await page.screenshot({ path: test.info().outputPath('stripe-mid-glide-2.png') }));
    });
    return shots as [Buffer, Buffer];
  })();
  const difference = await page.evaluate(async ([a, b]) => {
    const centre = async (base64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(img.width / 2 - 40, img.height / 2 - 40, 80, 80).data;
    };
    const x = await centre(a!);
    const y = await centre(b!);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += Math.abs(x[i]! - y[i]!);
    return sum;
  }, [first.toString('base64'), second.toString('base64')] as const);
  expect(difference).toBeGreaterThan(0);
});

// #1100: a step hops. The page records the hero's drawn height (the third number of `openworldGlide`) over a slowed step, a frame every
// 0.2 s of the paused clock (frameclock.ts, #1643): it rises above the height it has on its cell and is back on it at the end. Reduced motion has no glide, hence no hop.
shared('a step hops the hero: it rises mid-step and lands on its cell, #1100', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  await page.evaluate(() => {
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [[-1, 0]], enemies: [] });
    (window as unknown as { __openworldSlow: number }).__openworldSlow = 10;
  });
  const heights: number[] = [];
  await paused(page, async (frame) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 8; i++) {
      await frame(200);
      const glide = await page.evaluate(() => document.body.dataset.openworldGlide);
      if (glide) heights.push(Number(glide.split(',')[2]));
      if (i === 3) await shot(page, { path: test.info().outputPath('hop-mid-step.png') });
    }
  });
  expect(await page.evaluate(() => document.body.dataset.openworldGlide)).toBeUndefined(); // landed
  expect(heights.length).toBeGreaterThan(5);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.04); // up to 0.08 cell at mid-step
});

// #1138: the plate shows at the load, folds to a chip after 3 steps, and the chip opens it again.
shared('the Open world HUD plate folds after 3 steps and the chip reopens it, #1138', async ({ world: page }) => {
  const plate = page.locator('#openworld-hud');
  const chip = page.locator('#openworld-chip');
  await expect(plate).toBeVisible();
  await expect(chip).toBeHidden();
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect(plate).toBeHidden(); // folded: out of sight
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await chip.click();
  await expect(plate).toBeVisible();
  await expect(chip).toBeHidden();
});

// #1138 and #1172: the HUD plate has four rivets and takes the shared tokens: dark in the dark theme, light in the light one.
test('the Open world HUD plate follows the theme with four rivets, #1138, #1172', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('ab-alone.theme', 'system')); // light really applies (#1184)
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  const plate = page.locator('#openworld-hud');
  await expect(plate).toBeVisible();
  await expect(plate).toHaveCSS('background-color', 'rgb(243, 240, 230)');
  await expect(plate).toHaveCSS('border-radius', '6px');
  const image = await plate.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(image.match(/radial-gradient/g)).toHaveLength(4);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(plate).toHaveCSS('background-color', 'rgb(22, 26, 29)');
});

// #1137: a held direction goes round an obstacle by itself. An enemy stands on the cell right of the hero (the loaded state comes
// from the test hook): the Right key takes the free side cell instead of leaning, and it still stops where every side is shut.
shared('a held arrow goes round an obstacle instead of stopping, #1137', async ({ world: page }) => {
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  const fixture = (enemies: number[][]) =>
    page.evaluate((foes) => {
      (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 0], troop: [[-1, 0]], enemies: foes });
    }, enemies);
  await fixture([[1, 0]]);
  await page.keyboard.press('ArrowRight');
  await expect.poll(at).toBe('0,1'); // round the rock by its south-east side at the default camera, no lean
  await shot(page, { path: test.info().outputPath('steer.png') });
  await fixture([[1, 0], [1, -1], [0, 1]]);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await at()).toBe('0,0'); // every side is shut: it stays
});

// #1103: a push punches the camera in 3 % and back within 250 ms; the chunk centre and the reach never change, and the zoom is exactly
// the base one at the end. The page reads what the camera draws (`__openworldCamera`, given the time to draw it at) every 4 ms for 700 ms after the press.
shared('a push punches the camera in and back, without moving the chunk centre, #1103', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  type Camera = { zoom: number; shake: number; centre: number[]; reach: number };
  const result = await page.evaluate(async () => {
    const w = window as unknown as { __openworldFixture: (f: object) => void; __openworldCamera: (at?: number) => Camera };
    w.__openworldFixture({ hero: [0, 0], troop: [[-1, 0], [-2, 0]], enemies: [[2, 0]] });
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    const base = w.__openworldCamera();
    const samples: { t: number; camera: Camera }[] = [];
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    // The camera is drawn at each time of a 4 ms grid (the hook draws it at the time it is given), not at the frames the page happens to get:
    // on CI, without a GPU, a frame takes 100 ms or more and none fell inside the 250 ms punch (#1436).
    for (let t = 0; t <= 700; t += 4) samples.push({ t, camera: w.__openworldCamera(start + t) });
    return { base, samples };
  });
  const { base, samples } = result;
  const zooms = samples.map((s) => s.camera.zoom);
  expect(Math.min(...zooms)).toBeLessThan(base.zoom * 0.99); // it went in
  expect(Math.min(...zooms)).toBeGreaterThanOrEqual(base.zoom * 0.97 - 1e-9); // by 3 % at most
  expect(samples.at(-1)!.camera.zoom).toBe(base.zoom); // and is exactly back
  for (const { camera } of samples) {
    expect(camera.centre).toEqual(base.centre);
    expect(camera.reach).toBe(base.reach);
  }
  const punched = samples.filter((s) => s.camera.zoom !== base.zoom);
  expect(punched.at(-1)!.t - punched[0]!.t).toBeLessThanOrEqual(260); // at most 250 ms, a grid step of slack
  await shot(page, { path: test.info().outputPath('camera-after.png') });
});

// #1333: the camera follows a walk. The arrow is held until the hero has walked 6 cells; the camera (`__openworldCamera`) moves more than
// 5 units. That its speed never jumps from a frame to the next, from rest to the cruise pace (#1290) and back, is the unit test's, on the
// animation clock (openworldwalkmode.test.ts): on a loaded machine's software GL a frame took up to 1.4 s, so the page sampled too few frames
// and a fixed 1.2 s hold walked too few cells (#1643).
shared('the camera follows a walk of the hero, from its start to its stop, #1333', async ({ world: page }) => {
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
  type Hooks = { __openworldFixture: (f: object) => void; __openworldCamera: () => { eye: number[] } };
  await page.evaluate(() => (window as unknown as Hooks).__openworldFixture({ hero: [0, 0], troop: [], enemies: [] }));
  const eye = () => page.evaluate(() => (window as unknown as Hooks).__openworldCamera().eye);
  const start = await eye();
  await page.keyboard.down('ArrowRight'); // held: the walk speeds up to the cruise pace
  await expect.poll(() => page.evaluate(() => Number(document.body.dataset.openworldAt!.split(',')[0]))).toBeGreaterThanOrEqual(6);
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => Math.hypot(...(await eye()).map((x, k) => x - start[k]!))).toBeGreaterThan(5); // it walked
});

// #1273: at the default view a Right press from an odd row walks forward (up-right), as Left does, not back down-right.
shared('Right from an odd row walks forward in the Open world, #1273', async ({ world: page }) => {
  const at = () => page.evaluate(() => document.body.dataset.openworldAt);
  await expect.poll(at).toBe('0,0');
  await page.evaluate(() => {
    (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [0, 1], troop: [[-1, 1]], enemies: [] });
  });
  await page.keyboard.press('ArrowRight');
  await expect.poll(at).toBe('1,1'); // up-right (it was down-right, 0,2)
});
