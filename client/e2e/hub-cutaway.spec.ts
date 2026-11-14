import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// The Hub Cutaway (#1689): `?hub=cutaway` draws the ship in place of the Hub's deck, the tall shell under 600 px wide or 500 px high, the wide one above,
// one shell loaded at a time; the flag off asks for no cutaway file. Draw calls and triangles stay in the budget of the Open world (55, 31,000), measured by `bun run e2e:budget`.
// body[data-hub-cutaway] is "true" while the ship is drawn.

const BUDGET = { calls: 55, triangles: 31000 };
const ALL = ['echo', 'hull', 'choir', 'chaplain', 'ballast'];

/** Opens the page on `query` with `beaten` bosses saved, and counts the cutaway files it asks for. */
async function openHub(page: Page, query: string, beaten: string[] = []): Promise<string[]> {
  const files: string[] = [];
  page.on('request', (r) => /hub-cutaway-(tall|wide)\.glb/.test(r.url()) && files.push(/(tall|wide)\.glb/.exec(r.url())![1]!));
  await page.addInitScript((beaten) => localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten })), beaten);
  await page.goto(`./${query}`);
  await page.locator('canvas').waitFor();
  await startMode(page, 'hub');
  return files;
}
const cost = (page: Page) => page.evaluate(() => (window as unknown as { __renderCost: { calls: number; triangles: number } }).__renderCost);

test('a phone loads the tall shell only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const files = await openHub(page, '?hub=cutaway&bot=off', ALL);
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  expect(files).toEqual(['tall']);
});

test('a window loads the wide shell only', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const files = await openHub(page, '?hub=cutaway&bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  expect(files).toEqual(['wide']);
});

test('a window that shrinks under 600 x 500 swaps the wide shell for the tall one', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const files = await openHub(page, '?hub=cutaway&bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await page.setViewportSize({ width: 599, height: 700 });
  await expect.poll(() => files).toEqual(['wide', 'tall']);
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
});

// The budget of each shell, run by hand with `bun run e2e:budget` (tag @budget, a frame of software WebGL takes seconds): the frame of the ship, no deck.
for (const [layout, size] of [['tall', { width: 390, height: 844 }], ['wide', { width: 1000, height: 700 }]] as const) {
  test(`the ${layout} ship draws within the budget @budget`, async ({ page }) => {
    await page.setViewportSize(size);
    await openHub(page, '?hub=cutaway&bot=off', ALL);
    await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
    await expect.poll(async () => (await cost(page)).triangles, { timeout: 30000 }).toBeLessThanOrEqual(BUDGET.triangles); // the first frames may still draw the deck
    const { calls, triangles } = await cost(page);
    console.log(`cutaway ${layout}: ${calls} draw calls, ${triangles} triangles`);
    expect(calls).toBeLessThanOrEqual(BUDGET.calls);
  });
}

test('the flag off asks for no cutaway file and keeps the deck', async ({ page }) => {
  const files = await openHub(page, '?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub', 'mess 0,0');
  await page.waitForTimeout(500);
  expect(files).toEqual([]);
  await expect(page.locator('body')).not.toHaveAttribute('data-hub-cutaway', /.*/);
  await expect(page.locator('#hub-labels')).toBeVisible();
});
