import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// The offline battle royale (#502, rules.md section 10.4): 1 player against 5 bots on the radius 8 arena. A target
// press locks the player's order (#611), or the player holds; the round resolves, and the HUD plate shows the reveal
// log in initiative order, fizzles marked, and the next round's initiative before its reveal.

async function ready(page: Page): Promise<void> {
  await page.goto('./?bot=off');
  await expect(page.locator('#hud')).toContainText('to move');
  // __cellToScreen reads the camera, which is only set after the first rendered frame.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

async function click(page: Page, q: number, r: number): Promise<void> {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
}

// Everyone holds 12 rounds: ring 8, its 48 cells, cracks at the end of round 12 and goes void at the end of round 13.
const CRACKED = { seed: 7, rounds: Array.from({ length: 12 }, () => []) };
// The player walks its 4 columns NW to radius 5 or less in 11 rounds while the bots hold on the rim: the void of ring 6
// at the end of round 25 takes the bots' last marbles together, the player is first (src/main.royale.test.ts too).
type Cell = [number, number];
const NW = (...cells: Cell[]): number[] => [0, cells.length, 4, ...[...cells, [0, 0], [0, 0]].slice(0, 3).flat()];
const column = (cells: Cell[], steps: number): number[][] =>
  Array.from({ length: steps }, (_, s) => NW(...cells.map(([q, r]): Cell => [q, r - s])));
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

test('the outer ring cracks with a warning a round before it goes void, then it vanishes (#503)', async ({ page }) => {
  await ready(page);
  await page.evaluate((file) => (window as any).__royale(file), CRACKED);
  const hud = page.locator('#hud');
  const body = page.locator('body');
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 13');
  await expect(hud.locator('.breach')).toHaveText('Breach: 48 cells void in 1 round');
  await expect(body).toHaveAttribute('data-cracks', '48');
  await expect(body).toHaveAttribute('data-vanished', '7'); // the hole in the centre (#610)
  await page.getByRole('button', { name: 'Hold' }).click();
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 14');
  await expect(body).toHaveAttribute('data-vanished', '55');
  await expect(body).toHaveAttribute('data-cracks', '0');
  await expect(hud.locator('.breach')).toHaveCount(0);
});

test('an end position shows the placement banner: places and points (#503)', async ({ page }) => {
  await ready(page);
  await page.evaluate((file) => (window as any).__royale(file), END);
  const hud = page.locator('#hud');
  await expect(hud.locator('.turn')).toHaveText('You win');
  await expect(hud.locator('.end')).toHaveText('10 points. The books balance.');
  await expect(hud.locator('.placement li')).toHaveText([
    '1st You · 10 points',
    '2nd Bot 1 · 6 points',
    '2nd Bot 2 · 6 points',
    '2nd Bot 3 · 6 points',
    '2nd Bot 4 · 6 points',
    '2nd Bot 5 · 6 points',
  ]);
  await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
  await expect(page.getByRole('button', { name: 'Hold' })).toBeDisabled();
});

test('a royale game file loads, and the reveal log marks the fizzled order', async ({ page }) => {
  await ready(page);
  // Round 1: the player orders (-6, 3) E, a marble of Bot 1. It fizzles.
  await page.evaluate(() => (window as any).__royale({ seed: 7, rounds: [[0, 1, 0, -6, 3, 0, 0, 0, 0]] }));
  const hud = page.locator('#hud');
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 2');
  await expect(hud.locator('.reveal li')).toHaveCount(6);
  await expect(hud.locator('.reveal li').first()).toHaveText('You: fizzled');
  await expect(hud.locator('.reveal li').first()).toHaveClass('fizzled');
  await expect(hud.locator('.initiative li').first()).toHaveText('Bot 1');
});

test('Battle royale in the mode menu: a target press on the arena locks the order and the round resolves (#611)', async ({
  page,
}) => {
  await ready(page);
  await startMode(page, 'royale');
  const hud = page.locator('#hud');
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 1');
  await expect(hud.locator('.initiative li')).toHaveText(['You', 'Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5']);
  await expect(page.getByRole('button', { name: 'Lock order' })).toHaveCount(0);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await click(page, -2, 6);
  await click(page, -2, 5); // (-2, 6) NW
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 2');
  await expect(hud.locator('.reveal li').first()).toHaveText('You: moved');
  await page.getByRole('button', { name: 'Hold' }).click();
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 3');
  await expect(hud.locator('.reveal li').last()).toHaveText('You: held');
});

test('a drag from the player\'s marble over its column and out NW pushes the column, the camera stays (#1646)', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__royale({ seed: 7, rounds: [] }));
  const hud = page.locator('#hud');
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 1');
  const at = (q: number, r: number) => page.evaluate(([a, b]) => (window as any).__cellToScreen(a, b) as { x: number; y: number }, [q, r]);
  const corner = await at(8, -8);
  const [first, second, third, out] = [await at(-4, 8), await at(-4, 7), await at(-4, 6), await at(-4, 4)];
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.move(third.x, third.y, { steps: 4 });
  expect(await page.evaluate(() => (window as any).__rings())).toEqual([[-4, 8], [-4, 7], [-4, 6]]);
  expect(await at(8, -8)).toEqual(corner);
  await page.mouse.move(out.x, out.y, { steps: 4 });
  await page.mouse.up();
  await expect(hud.locator('.turn')).toHaveText('Battle royale · Round 2');
  await expect(hud.locator('.reveal li').first()).toHaveText('You: moved');
});

test('each seat wears its own glyph on its marbles and beside its name on the plate (#558)', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__royale({ seed: 7, rounds: [] }));
  await expect(page.locator('#hud .turn')).toHaveText('Battle royale · Round 1');
  expect(await page.evaluate(() => (window as any).__seatGlyphs())).toEqual([10, 10, 10, 10, 10, 10]);
  const glyphs = page.locator('#hud .initiative .seat');
  await expect(glyphs.locator('svg polygon')).toHaveCount(6);
  expect(await glyphs.evaluateAll((spans) => spans.map((s) => s.getAttribute('data-glyph')))).toEqual([
    'disc',
    'triangle',
    'square',
    'cross',
    'star',
    'diamond',
  ]);
});

test('battle royale arena is fully visible with fog at arena rim (#503)', async ({ page }) => {
  await ready(page);
  // First enter hub to verify entering royale from hub doesn't inherit hub fog radius
  await startMode(page, 'hub');
  await expect(page.locator('body')).toHaveAttribute('data-hub');
  // Then enter battle royale
  await startMode(page, 'royale');
  await expect(page.locator('#hud .turn')).toHaveText('Battle royale · Round 1');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  // Check that the top rim cells are within viewport and rendered
  const p = await page.evaluate(() => (window as any).__cellToScreen(0, -4));
  expect(p.y).toBeGreaterThan(50);
});

test('a round plays out on the arena, then ends on the new position (#612)', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__royale({ seed: 7, rounds: [] }));
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-reveal', 'done');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await click(page, -2, 6);
  await click(page, -2, 5); // (-2, 6) NW
  await expect(body).toHaveAttribute('data-reveal', 'turn');
  await expect(body).toHaveAttribute('data-reveal', 'done');
  await expect(page.locator('#hud .reveal li')).toHaveCount(6);
  const at = (q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__arenaAt(cq, cr), [q, r]);
  expect(await at(-2, 5)).toEqual({ seat: 0, x: -2 + 5 / 2, z: (Math.sqrt(3) / 2) * 5 });
  expect(await at(-2, 6)).toBeNull();
});
