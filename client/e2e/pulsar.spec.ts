import { expect, test, type Page } from '@playwright/test';
import { pauseClock, stepClock } from './clock';
import { startMode } from './modes';
import { shot } from './shot';

// The Pulsar (#675, game-design.md section 7.10) from the fixture of the core tests: fight seed 2 and ?bot=off, so the
// test plays both sides through the click hook. The first pulsar pushes NW, off the bottom corner. The pulse after
// ply 5 throws the lone boss marble on (4, -4) off and leaves the player's pairs at the bottom left in place; the ones
// after plies 9 and 13 eject 2 more: P2, force 3. The screenshots are kept for the report.

const [E, W, SW, NW, SE] = [0, 1, 3, 4, 5];
const FIXTURE: [number, number, number][] = [
  [-2, 2, NW], [4, -3, SW], [-1, 2, NW], [0, -2, SW], [0, 2, NW], [3, -3, E], [-2, 1, NW], [-1, -1, W], [-1, 1, NW],
  [-2, -1, W], [0, 1, NW], [-3, -1, SE], [-2, 0, NW],
];

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

async function startPulsar(page: Page, reducedMotion: boolean): Promise<void> {
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(2)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'pulsar');
  await expect(page.locator('#boss-bar .name')).toContainText('The Pulsar');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'bridge');
  await page.mouse.move(2, 2); // no hover ghost
}

/** Plies `from` to `to` (excluded) of the fixture, each after the slides of the one before. */
async function plies(page: Page, from: number, to: number): Promise<void> {
  for (const [q, r, dir] of FIXTURE.slice(from, to)) {
    await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
    await page.evaluate(
      ([cq, cr, d]) => {
        const step = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1]][d]!;
        (window as any).__roll(cq, cr);
        (window as any).__roll(cq + step[0]!, cr + step[1]!);
      },
      [q, r, dir],
    );
  }
}

const marbleAt = (page: Page, q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__marbleTurn(cq, cr) !== null, [q, r]);
const outPips = (page: Page) => page.locator('#hud .pips > span').evaluateAll((sides) => sides.map((s) => s.querySelectorAll('.out').length));

test('The Pulsar: a charging pulsar counts down, fires, throws a lone marble off and leaves a pair, then force 3, #675', async ({ page }, testInfo) => {
  const body = page.locator('body');
  const tell = page.locator('#hud .boss .tell');
  await startPulsar(page, true);
  await expect(tell).toHaveText('Pulse in 3 turns, force 2');
  await expect(body).toHaveAttribute('data-pulse-counter', '');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('pulsar-start.png') });
  await plies(page, 0, 1);
  await expect(body).toHaveAttribute('data-pulse-counter', '2'); // it charges: 2 turns ahead
  await plies(page, 1, 4);
  await expect(body).toHaveAttribute('data-pulse-counter', '1');
  await expect(tell).toHaveText('Pulse in 1 turn, force 2');
  expect(await page.evaluate(() => (window as any).__pulsar())).toEqual({ id: NW, left: 1, force: 2, charging: true });
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('pulsar-before.png') });
  await plies(page, 4, 5); // the player's 3rd move: the pulse
  await expect(body).toHaveAttribute('data-pulses', '1');
  expect(await outPips(page)).toEqual([1, 0]); // the boss marble counts for the player
  expect(await marbleAt(page, 4, -4)).toBe(false); // the lone one on the far rim is off
  expect(await marbleAt(page, -4, 4)).toBe(true); // the pair resists
  expect(await marbleAt(page, -4, 3)).toBe(true);
  await expect(body).toHaveAttribute('data-pulse-counter', '2'); // charging again
  await page.waitForFunction(() => (window as any).__shock() === null);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('pulsar-after.png') });
  await plies(page, 5, 13);
  await expect(body).toHaveAttribute('data-pulses', '3');
  expect(await outPips(page)).toEqual([3, 0]);
  await expect(page.locator('#hud .notch.active')).toHaveText('P2'); // after 3 ejections
  await expect(tell).toHaveText('Pulse in 4 turns, force 3'); // the phase raises the force
});

// The shockwave plays on the page clock (page.clock): paused before the last ply and stepped by hand, so the frames the
// test samples do not depend on how fast a loaded machine draws (#891).
test('The Pulsar: the shockwave grows from the pulsar across the board, #675', async ({ page }, testInfo) => {
  const body = page.locator('body');
  await page.clock.install();
  await startPulsar(page, false);
  await plies(page, 0, 4);
  await pauseClock(page);
  await plies(page, 4, 5);
  await expect.poll(async () => { await stepClock(page, 50); return body.getAttribute('data-pulsing'); }, { intervals: [0], timeout: 12_000 }).toBe('1');
  const radii: number[] = [];
  for (let frame = 0; frame < 5; frame++) { // the shockwave lasts 700 ms: 5 steps of 100 ms after it fired it is still out
    const shock = await page.evaluate(() => (window as any).__shock());
    expect(shock).not.toBeNull();
    radii.push(shock.radius);
    await shot(page, { path: testInfo.outputPath(`pulsar-shock-${frame}.png`) });
    await stepClock(page, 100);
  }
  await stepClock(page, 700);
  expect(radii).toEqual([...radii].sort((a, b) => a - b)); // it grows
  await expect(body).not.toHaveAttribute('data-pulsing', '1');
  await expect(body).toHaveAttribute('data-pulses', '1');
});

// Bug #691: on a 1280x720 window the two bottom corner pulsars and the counter of the charging one were cut off at the
// screen edge. In the default view of the fight, every pulsar, its glowing core and the counter it shows when it charges
// lie inside the window, on desktop windows and on phones held upright and sideways. The HUD plate may cover one: the
// board's centre stays in the middle of the window and the player folds the plate (#957).
type Rect = { x: number; y: number; width: number; height: number };
async function hiddenPulsars(page: Page, viewport: { width: number; height: number }): Promise<string[]> {
  await freshDraw(page);
  const rects = await page.evaluate(() => (window as any).__pulsarRects() as { pulsar: Rect; counter: Rect }[]);
  expect(rects).toHaveLength(6);
  const off = (r: Rect) => r.x < 0 || r.y < 0 || r.x + r.width > viewport.width || r.y + r.height > viewport.height;
  return rects.flatMap(({ pulsar, counter }, id) =>
    Object.entries({ pulsar, counter })
      .filter(([, r]) => off(r))
      .map(([what, r]) => `${what} ${id} off screen at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
}

const sizes = [
  { name: 'a 1280x720 window', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'a 1280x800 window', viewport: { width: 1280, height: 800 }, mobile: false },
  { name: 'a phone held upright', viewport: { width: 375, height: 812 }, mobile: true },
  { name: 'a phone 360 px wide held upright', viewport: { width: 360, height: 780 }, mobile: true },
  { name: 'a phone held sideways', viewport: { width: 812, height: 375 }, mobile: true },
];
for (const { name, viewport, mobile } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile });
    test('The Pulsar: every pulsar and its counter are on screen, bug #691', async ({ page }, testInfo) => {
      await startPulsar(page, true);
      await plies(page, 0, 1);
      await expect(page.locator('body')).toHaveAttribute('data-pulse-counter', '2');
      const hidden = await hiddenPulsars(page, viewport);
      await shot(page, { path: testInfo.outputPath('pulsars-on-screen.png') });
      expect(hidden).toEqual([]);
    });
  });
}

// Bug #696: the view was fitted at the start of the fight only, so turning a phone upright put the side pulsars off
// screen until Reset view. The fitted view follows the window while the player has not moved the camera himself.
test.describe('a phone turned upright', () => {
  test.use({ viewport: { width: 812, height: 375 }, isMobile: true, hasTouch: true });
  test('The Pulsar: turning the phone upright refits the view, bug #696', async ({ page }, testInfo) => {
    await startPulsar(page, true);
    await plies(page, 0, 1);
    await expect(page.locator('body')).toHaveAttribute('data-pulse-counter', '2');
    const upright = { width: 375, height: 812 };
    await page.setViewportSize(upright);
    const hidden = await hiddenPulsars(page, upright);
    await shot(page, { path: testInfo.outputPath('turned-upright.png') });
    expect(hidden).toEqual([]);
  });
});

test('The Pulsar: the pulsar that fires next turn loops faint small rings while the player thinks, #741', async ({ page }, testInfo) => {
  const body = page.locator('body');
  await startPulsar(page, false);
  await plies(page, 0, 1);
  await expect(body).toHaveAttribute('data-ripples', '0'); // 2 turns away: only the glow
  await plies(page, 1, 4);
  await expect(page.locator('#hud .boss .tell')).toHaveText('Pulse in 1 turn, force 2');
  await expect(body).toHaveAttribute('data-ripples', '2');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('pulsar-ripples.png') });
});

test('The Pulsar: with reduced motion the next pulsar wears one static faint ring, #741', async ({ page }, testInfo) => {
  await startPulsar(page, true);
  await plies(page, 0, 4);
  await expect(page.locator('body')).toHaveAttribute('data-ripples', '1');
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('pulsar-ripple-reduced.png') });
});
