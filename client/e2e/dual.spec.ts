import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseRecorded } from '../src/test/chaplain-game';
import { BRIDGE_AT, RETURN_AT, RETURN_CELL, SEED } from '../src/test/dual-game';
import { startBoss } from './modes';
import { shot } from './shot';

// The Dual Room (#947, #955, game-design.md section 7.15) from the recorded fight of the wasm tests (fight seed 1,
// ?bot=off): the state is loaded by the __playMoves hook, the plies that matter are played live. The two side-4 rooms
// open with the void between them; the boss marble pushed off on ply RETURN_AT is announced on its mark and lands there
// one ply later; the 5th ejection, on ply BRIDGE_AT, fills the void with the bridge. Until then the room out of turn is
// dimmed (#992). The screenshots are kept for the report (dual-v2-rooms.png, dual-v2-bridge.png).

// Waits for a draw that began after this call. It is asked of the page, so the draw throttle does not hold it (#435).
const freshDraw = async (page: Page) => {
  const asked = await page.evaluate(() => (window as any).__drawNext() as number);
  await page.waitForFunction((n) => (window as any).__draws() > n, asked);
};

const plies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/dual.txt', import.meta.url), 'utf8'));
const play = (page: Page, from: number, to: number) => page.evaluate((records) => (window as any).__playMoves(records), plies.slice(from, to));
const dual = (page: Page) => page.evaluate(() => (window as any).__dual()) as Promise<{ mark: [number, number] | null }>;
const marbleAt = (page: Page, [q, r]: [number, number]) => page.evaluate(([cq, cr]) => (window as any).__marbleTurn(cq, cr) !== null, [q, r]);

test('The Dual Room: two rooms split by a void, a return lands on its mark a ply after it is announced, the 5th ejection raises the bridge, #955, the rooms in turn, #992', async ({
  page,
}, testInfo) => {
  const body = page.locator('body');
  const tell = page.locator('#hud .boss .tell');
  await page.addInitScript((seed) => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(seed)) as typeof crypto.getRandomValues; // the fight seed
  }, SEED);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startBoss(page, 'The Dual Room');
  await expect(page.locator('#boss-bar .name')).toContainText('The Dual Room');
  await expect(body).toHaveAttribute('data-deck', 'mess');
  await expect(body).toHaveAttribute('data-bridge', 'void');
  await expect(body).toHaveAttribute('data-dual-room', 'south');
  await expect(tell).toHaveText('Ejected marbles come back in the other room · the bridge comes at 5');
  await page.mouse.move(2, 2); // no hover ghost
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('dual-v2-rooms.png') });

  await play(page, 0, RETURN_AT);
  expect((await dual(page)).mark).toEqual(RETURN_CELL);
  await expect(body).toHaveAttribute('data-dual-room', 'north'); // the boss's ply in the north room
  await expect(tell).toHaveText('Its marble comes back on the mark next turn · the bridge comes at 5');
  expect(await marbleAt(page, RETURN_CELL)).toBe(false);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('dual-return.png') });
  await play(page, RETURN_AT, RETURN_AT + 1);
  await expect(body).toHaveAttribute('data-returns', '1');
  expect(await marbleAt(page, RETURN_CELL)).toBe(true);

  await play(page, RETURN_AT + 1, BRIDGE_AT);
  await expect(body).toHaveAttribute('data-bridge', 'up');
  await expect(body).not.toHaveAttribute('data-dual-room');
  await expect(tell).toHaveText('The bridge is up, ejected marbles are gone');
  expect((await page.evaluate(() => (window as any).__dual().bridge)) as number[]).toEqual([0, 0, 0, 0, 0]);
  await freshDraw(page);
  await shot(page, { path: testInfo.outputPath('dual-v2-bridge.png') });
});
