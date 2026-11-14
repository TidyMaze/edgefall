import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseRecorded } from '../src/test/chaplain-game';
import { startMode } from './modes';
import { shot } from './shot';

// The Swarm (#1008, #1266, game-design.md section 7.14) from the recorded win of the core tests (fight seed 0, ?bot=off):
// the state is loaded by the __playMoves hook. The player starts in the centre, the first wave is announced on a ring, it
// lands there after the player's move, and the evac comes once its 40-turn clock runs out, lighting the whole board.

const plies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/swarm.txt', import.meta.url), 'utf8'));
const play = (page: Page, from: number, to: number) => page.evaluate((records) => (window as any).__playMoves(records), plies.slice(from, to));
const swarm = (page: Page) => page.evaluate(() => (window as any).__swarm()) as Promise<{ left: number; cells: [number, number][]; evac: boolean }>;

test('The Swarm: a wave announced on its mark lands there, the clock counts down, the evac lights the board, #1008 #1266', async ({
  page,
}, testInfo) => {
  const tell = page.locator('#hud .boss .tell');
  await page.addInitScript(() => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(0)) as typeof crypto.getRandomValues; // the fight seed
  });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'swarm');
  await expect(page.locator('#boss-bar .name')).toContainText('The Swarm');
  await expect(page.locator('body')).toHaveAttribute('data-deck', 'cargo');
  await expect(tell).toHaveText('40 turns to the evac · 3 marbles land on their marks next turn · the swarm wins after it ejects 2 of your marbles');
  expect(await page.evaluate(() => (window as any).__marbleTurn(0, 0) !== null)).toBe(true); // the player starts in the centre
  const marks = (await swarm(page)).cells;
  const [mark] = marks;
  await expect(page.locator('body')).toHaveAttribute('data-swarm-marks', marks.map((c) => c.join(',')).join(' ')); // 3 a turn
  await page.mouse.move(2, 2); // no hover ghost
  await shot(page, { path: testInfo.outputPath('swarm-announce.png') });

  await play(page, 0, 1);
  expect(await page.evaluate(([q, r]) => (window as any).__marbleTurn(q, r) !== null, mark!)).toBe(true); // it arrived
  await play(page, 1, 2);
  await expect(tell).toContainText('39 turns to the evac');
  await shot(page, { path: testInfo.outputPath('swarm-arrival.png') });

  await play(page, 2, plies.length);
  await expect(tell).toHaveText('The evac lifts you out');
  await expect(page.locator('#hud')).toContainText('Victory');
  expect(await swarm(page)).toMatchObject({ left: 0, evac: true });
  await expect.poll(async () => (await page.evaluate(() => (window as any).__swarm().glow)) as number).toBeGreaterThan(0.5);
  await shot(page, { path: testInfo.outputPath('swarm-evac.png') });
});
