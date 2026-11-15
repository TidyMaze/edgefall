import { expect, test, type Page } from '@playwright/test';
import { inviteLink, startMode } from './modes';
import { shot } from './shot';
import { openAdvanced } from './settings';

// #521: the Hub entry of the mode menu draws the deck's hub map (docs/specs/game-design.md section 3.5) and the glass
// marble, which rolls one cell at a time by a click on a neighbour or an arrow key. body[data-hub] names its deck and
// cell. The spot is saved: after a reload, Ship lands on the same cell.
// #522: rolling onto a boss door or a table starts its game, and once that game is over Back to the hub puts the
// marble back on the door. The battle royale is shown closed.
// #523: a lift wears an arrow toward its deck, with a bar across while it is locked. A locked lift keeps the marble out
// and Tally says one short line; a boss win opens it. body[data-lifts] lists the lifts of the deck.
// #524: rolling onto a terminal opens its lore entry in the reader; Esc leaves it to the hub on the same cell.
// #583: no game is on in the hub: the evaluation bar and Hint are hidden there.
// #589: Export game and Import game are hidden there too.
// #1249: every room wears a label plate, always shown; a lift-shaft rail lists the five decks and boss pips the progress.
// Every boss has its door on its deck and every mode with no table its room, on the gallery ring of a radius 3 map.

async function ship(page: Page): Promise<void> {
  await startMode(page, 'hub');
}

/** Opens `url`, then Ship with the marble saved on `cell` of the Mess. */
async function shipAt(page: Page, url: string, cell: [number, number]): Promise<void> {
  await page.goto(url);
  await page.locator('canvas').waitFor();
  await page.evaluate((cell) => {
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell, beaten: [] }));
  }, cell);
  await ship(page);
  await expect(page.locator('body')).toHaveAttribute('data-hub', `mess ${cell[0]},${cell[1]}`);
}

/** A mouse click on a cell, through the page's raycast. */
async function clickCell(page: Page, q: number, r: number): Promise<void> {
  const { x, y } = await page.evaluate(([q, r]) => (window as any).__cellToScreen(q, r), [q, r]);
  await page.mouse.click(x, y);
}

/** The same click without the raycast and the frames of a mouse click, to stay fast. */
async function hookClick(page: Page, q: number, r: number): Promise<void> {
  await page.evaluate(([q, r]) => (window as any).__roll(q, r), [q, r]);
}

test('a new player opening the main URL lands directly on the Hub, #602', async ({ page }) => {
  await page.goto('./');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await expect(page.locator('#hud')).toContainText('Hub · Mess');
  await expect(page.locator('#eval')).toBeHidden();
  await expect(page.locator('#hint')).toBeHidden();
});

test('the boss door starts the Echo, and Back to the hub after the defeat lands on the door, #522', async ({ page }, testInfo) => {
  await shipAt(page, './?bot=off', [1, 0]);
  await shot(page, { path: testInfo.outputPath('hub-before-door.png') });
  await hookClick(page, 2, 0);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-boss', 'echo');
  await expect(body).not.toHaveAttribute('data-hub');
  // ?bot=off: the test plays both sides; with the Echo's bonus mirrors (#859), Black taking the free moves offered
  // (#958), these 7 moves bring a position back a third time, a draw by repetition: a defeat (e2e/fight-end.ts).
  const moves = [[0, 2, 0, 1], [0, -1, 1, -1], [0, 1, -1, 1], [-1, 1, 0, 1], [0, -1, 1, -1], [0, 1, -1, 1], [-1, 1, 0, 1]];
  for (const [ply, [q, r, tq, tr]] of moves.entries()) {
    await hookClick(page, q!, r!);
    await hookClick(page, tq!, tr!);
    await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(ply + 1);
  }
  await expect(page.locator('#hud')).toContainText('Defeat');
  const back = page.getByRole('button', { name: 'Back to the hub' });
  await expect(back).toBeVisible();
  await shot(page, { path: testInfo.outputPath('back-to-the-ship.png') });
  await back.click();
  await expect(body).toHaveAttribute('data-hub', 'mess 2,0');
  await expect(page.locator('#hud')).toContainText('The Echo · boss, Mess seat');
  await expect(back).toBeHidden();
});

test('the evaluation bar and Hint are off in the hub and back once a table leaves it, #583', async ({ page }, testInfo) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const bar = page.locator('#eval');
  const hint = page.getByRole('button', { name: 'Hint' });
  await expect(bar).toBeVisible();
  await expect(hint).toBeVisible();
  await ship(page);
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await expect(bar).toBeHidden();
  await expect(hint).toBeHidden();
  await shot(page, { path: testInfo.outputPath('hub-no-eval.png') });
  await startMode(page, 'arena'); // the House table's bay starts a game (the Hub has no New game, #1697)
  await expect(page.locator('body')).not.toHaveAttribute('data-hub');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-ply', '0', { timeout: 10_000 });
  await expect(hint).toBeVisible();
});

test('Export game and Import game are off in the hub and back once a table leaves it, #589', async ({ page }, testInfo) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const cog = page.getByRole('button', { name: 'Settings' });
  const menu = page.locator('#settings-menu');
  await ship(page);
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await cog.click();
  await expect(menu.getByRole('button', { name: 'Clear board' })).toBeVisible();
  await openAdvanced(page); // shut at first (#1566): the buttons are hidden by the hub, not by the group
  await expect(menu.getByRole('button', { name: 'Export game' })).toBeHidden();
  await expect(menu.getByRole('button', { name: 'Import game' })).toBeHidden();
  await shot(page, { path: testInfo.outputPath('hub-settings.png') });
  await page.keyboard.press('Escape');
  await startMode(page, 'arena'); // the House table's bay starts a game (the Hub has no New game, #1697)
  await expect(page.locator('body')).not.toHaveAttribute('data-hub');
  await cog.click();
  await openAdvanced(page);
  await expect(menu.getByRole('button', { name: 'Export game' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Import game' })).toBeVisible();
});

test('the hot-seat table starts a game for two at one table, #522', async ({ page }) => {
  await shipAt(page, './', [-1, 0]);
  await hookClick(page, -1, -1);
  await expect(page.locator('body')).not.toHaveAttribute('data-hub');
  await expect(page.locator('#hud')).toContainText('Two players, one board.');
});

test('the bot table starts a game the bot answers, #522', async ({ page }) => {
  await shipAt(page, './?nodes=100', [-1, 0]);
  await hookClick(page, -2, 0);
  await expect(page.locator('#hud')).toContainText('You vs Bot.');
  await hookClick(page, 0, 2); // Black (0, 2) to (0, 1)
  await hookClick(page, 0, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(2); // the bot replied
});

test('the online table opens a room with its invite link, as Play online does, #522', async ({ page }) => {
  await shipAt(page, './?bot=off&net=hook', [-1, 1]);
  await hookClick(page, -2, 1);
  await expect(page.locator('#invite')).toBeVisible();
  expect(await inviteLink(page)).toMatch(/#room=[\w-]+&key=[\w-]{8}$/);
  await expect(page.locator('#hud')).toContainText('You are Black');
});

test('the battle royale door starts battle royale, and Back to the hub lands on the door, #593', async ({ page }, testInfo) => {
  await shipAt(page, './?bot=off', [-2, 2]);
  const body = page.locator('body');
  await hookClick(page, -3, 2);
  await expect(body).not.toHaveAttribute('data-hub');
  await expect(body).toHaveAttribute('data-royale', '1');
  await expect(page.locator('#hud')).toContainText('Battle royale');
  await shot(page, { path: testInfo.outputPath('royale-arena.png') });
  await page.evaluate(() => (window as any).__royale({
    seed: 7,
    rounds: [
      [0, 3, 4, -4, 8, -4, 7, -4, 6],
      [0, 3, 4, -4, 7, -4, 6, -4, 5],
      [0, 3, 4, -4, 6, -4, 5, -4, 4],
      [0, 3, 4, -3, 8, -3, 7, -3, 6],
      [0, 3, 4, -3, 7, -3, 6, -3, 5],
      [0, 3, 4, -3, 6, -3, 5, -3, 4],
      [0, 3, 4, -5, 8, -5, 7, -5, 6],
      [0, 3, 4, -5, 7, -5, 6, -5, 5],
      [0, 3, 4, -5, 6, -5, 5, -5, 4],
      [0, 2, 4, -2, 7, -2, 6, 0, 0],
      [0, 2, 4, -2, 6, -2, 5, 0, 0],
      ...Array.from({ length: 14 }, () => []),
    ],
  }));
  await expect(body).toHaveAttribute('data-over', 'win');
  const back = page.getByRole('button', { name: 'Back to the hub' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(body).toHaveAttribute('data-hub', 'mess -3,2');
  await expect(page.locator('#hud')).toContainText('Arena · battle royale');
  await shot(page, { path: testInfo.outputPath('royale-after.png') });
});


test('a terminal room opens its lore entry in the reader, and Esc gives the hub back, #524', async ({ page }, testInfo) => {
  await shipAt(page, './?bot=off', [0, 1]);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule /); // the console's web fonts are in
  await shot(page, { path: testInfo.outputPath('terminal-before.png') });
  await hookClick(page, 1, 1);
  await expect(body).toHaveAttribute('data-reading', 'mess-corner-table');
  await expect(page.locator('#reader')).toContainText('Galley log, unsigned');
  await expect(page.getByRole('button', { name: 'Play log' })).toBeVisible();
  await shot(page, { path: testInfo.outputPath('terminal-reader.png') });
  await page.keyboard.press('Escape');
  await expect(body).not.toHaveAttribute('data-reading');
  await expect(page.locator('#reader')).toBeHidden();
  await expect(body).toHaveAttribute('data-hub', 'mess 1,1');
  await expect(page.locator('#hud')).toContainText('Galley log');
  await shot(page, { path: testInfo.outputPath('terminal-after.png') });
});

test('the Medal room lists every boss with its medal in the reader, and Esc gives the hub back, #812', async ({ page }, testInfo) => {
  await shipAt(page, './?bot=off', [0, 1]);
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-console', /^mess-house-rule /); // the console's web fonts are in
  await page.evaluate(() => localStorage.setItem('ab-alone.medals', JSON.stringify({ echo: 14 })));
  await hookClick(page, 0, 2);
  await expect(body).toHaveAttribute('data-reading', 'medal-room');
  await expect(page.locator('#reader')).toContainText('The Echo: 14 turns. The Hull: Not beaten.');
  await shot(page, { path: testInfo.outputPath('medal-room.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#reader')).toBeHidden();
  await expect(body).toHaveAttribute('data-hub', 'mess 0,2');
});

test('the tension drones calm to 0 over the hub, #586', async ({ page }) => {
  await page.goto('./?nodes=100');
  await page.locator('canvas').waitFor(); // the page hooks are set (#585)
  await page.evaluate(async () => {
    for (let t = 1; t <= 30; t++) {
      await (window as any).__playTurns(1, [4]);
      if ((window as any).__tension().level > 0) break;
    }
  });
  expect(await page.evaluate(() => (window as any).__tension().level)).toBeGreaterThan(0);
  await ship(page);
  await expect(page.locator('body')).toHaveAttribute('data-hub', /^mess /);
  expect(await page.evaluate(() => (window as any).__tension().level)).toBe(0);
});

/** Ship, with the marble saved on `cell` of `deck` and the Echo beaten. */
async function shipOn(page: Page, deck: string, cell: [number, number]): Promise<void> {
  await page.evaluate(([deck, cell]) => {
    localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck, cell, beaten: ['echo'] }));
  }, [deck, cell] as const);
  await ship(page);
  await expect(page.locator('body')).toHaveAttribute('data-hub', `${deck} ${cell[0]},${cell[1]}`);
}

test('a gallery boss door starts its own boss, and a mode room opens its mode, #1249', async ({ page }, testInfo) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const body = page.locator('body');
  await shipOn(page, 'cargo', [2, -2]);
  await expect(page.locator('#hub-labels [data-cell="3,-2"]')).toContainText('The Alien');
  await shot(page, { path: testInfo.outputPath('1249-cargo-gallery.png') });
  await hookClick(page, 3, -2);
  await expect(body).not.toHaveAttribute('data-hub');
  await expect(body).toHaveAttribute('data-boss', 'alien');

  await shipOn(page, 'cargo', [-1, 3]);
  await hookClick(page, 0, 3); // the Rogue-lite run
  await expect(body).not.toHaveAttribute('data-hub');
  await expect(page.locator('#run-map')).toBeVisible();
});
