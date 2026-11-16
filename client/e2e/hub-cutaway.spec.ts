import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// The Hub (#1689), a 2D menu since #1729: a titled group of tiles per deck in place of the Hub's deck, no ship file. Draw calls and triangles stay in the budget of the Open world
// (55, 31,000), measured by `bun run e2e:budget`. body[data-hub-cutaway] is "true" while the menu is shown.

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

test('the Hub asks for no ship file, on a phone or in a window: it is a 2D menu (#1729)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const files = await openHub(page, '?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator('#ship-bays section.hub-deck')).toHaveCount(5);
  expect(files).toEqual([]);
});

for (const [layout, size] of [['tall', { width: 390, height: 844 }], ['wide', { width: 1000, height: 700 }]] as const) {
  test(`the ${layout} ship draws within the budget @budget`, async ({ page }) => {
    await page.setViewportSize(size);
    await openHub(page, '?bot=off', ALL);
    await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
    await expect.poll(async () => (await cost(page)).triangles, { timeout: 30000 }).toBeLessThanOrEqual(BUDGET.triangles); // the first frames may still draw the deck
    const { calls, triangles } = await cost(page);
    console.log(`cutaway ${layout}: ${calls} draw calls, ${triangles} triangles`);
    expect(calls).toBeLessThanOrEqual(BUDGET.calls);
  });
}

// The bays as tap targets (#1691): a tap rolls the marble there and the room opens, a shut deck bumps, the arrow keys move it, a tap during a roll ends it, and the signs fit.
const bay = (page: Page, key: string) => page.locator(`#ship-bays [data-bay="${key}"]`);
const hubNow = (page: Page) => page.evaluate(() => document.body.dataset.hub ?? null);

test('a tap on the House table rolls the marble there and starts the game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, '?bot=off', ['echo']);
  await expect(bay(page, 'mess:bot')).toBeVisible();
  await bay(page, 'mess:bot').click();
  await expect.poll(() => hubNow(page)).toBeNull(); // the Hub is left: a game is on
});




/** What the tiles measure, each scrolled into the menu's view: the smallest size, and everything that is clipped, blank, under a panel or covered (#1729, #1702). */
const MEASURE = () => {
  const panels = ['hud', 'hub-pips', 'hub-rail', 'hub-board', 'dock', 'settings', 'ship-goal-line', 'ship-gocard'].map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e && getComputedStyle(e).display !== 'none' && !e.hidden);
  const all = [...document.querySelectorAll<HTMLElement>('#ship-bays .cut-bay')];
  const bad: string[] = [];
  let minW = 999, minH = 999, minFont = 99;
  for (const b of all) {
    b.scrollIntoView({ block: 'nearest' });
    const q = b.getBoundingClientRect();
    minW = Math.min(minW, q.width); minH = Math.min(minH, q.height);
    const sign = [...b.querySelectorAll<HTMLElement>('.short, b')].find((e) => getComputedStyle(e).display !== 'none')!;
    if (!sign.textContent!.trim()) bad.push(`${b.dataset.bay}: blank`);
    const fs = parseFloat(getComputedStyle(sign).fontSize);
    const sr = sign.getBoundingClientRect();
    if (innerWidth < 600) minFont = Math.min(minFont, fs);
    if (sign.scrollWidth > sign.clientWidth + 1 || sr.right > q.right + 1 || sr.left < q.left - 1) bad.push(`${b.dataset.bay}: sign`);
    const hit = panels.find((p) => { const o = p.getBoundingClientRect(); return o.width > 0 && o.left < q.right && o.right > q.left && o.top < q.bottom && o.bottom > q.top; });
    if (hit) bad.push(`${b.dataset.bay}: under ${hit.id}`);
    const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    if (top !== b && !b.contains(top)) bad.push(`${b.dataset.bay}: covered by ${(top as HTMLElement | null)?.id}`);
    if (q.left < 0 || q.right > innerWidth) bad.push(`${b.dataset.bay}: off the window`);
  }
  return { n: all.length, bad, minW, minH, minFont };
};

for (const [w, h] of [[390, 844], [375, 667], [360, 640], [1000, 700]] as const) {
  test(`every tile is whole, named, under no panel and 44 px at least on ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openHub(page, '?bot=off', ALL);
    await expect(bay(page, 'mess:echo')).toBeVisible();
    const r = await page.evaluate(MEASURE);
    expect(r.n).toBeGreaterThanOrEqual(30); // every room of the five decks, all open
    expect(r.bad).toEqual([]);
    if (w < 600) expect(r.minFont).toBeGreaterThanOrEqual(10);
    expect(Math.min(r.minW, r.minH)).toBeGreaterThanOrEqual(44); // every tile is a tap target (owner, 2026-11-15)
  });
}


for (const [w, h] of [[390, 844], [1000, 700]] as const) {
  test(`the Hub menu is shown at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openHub(page, '?bot=off', ALL);
    await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
    expect(await page.evaluate(() => (window as unknown as { __shipDrawn: boolean }).__shipDrawn)).toBe(true);
  });
}
