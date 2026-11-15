import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// The Hub Cutaway (#1689): the ship is drawn in place of the Hub's deck, the tall shell under 600 px wide or 500 px high, the wide one above,
// one shell loaded at a time. Draw calls and triangles stay in the budget of the Open world (55, 31,000), measured by `bun run e2e:budget`.
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
  const files = await openHub(page, '?bot=off', ALL);
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  expect(files).toEqual(['tall']);
});

test('a window loads the wide shell only', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const files = await openHub(page, '?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  expect(files).toEqual(['wide']);
});

test('a window that shrinks under 600 x 500 swaps the wide shell for the tall one', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const files = await openHub(page, '?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await page.setViewportSize({ width: 599, height: 700 });
  await expect.poll(() => files).toEqual(['wide', 'tall']);
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
});

// The budget of each shell, run by hand with `bun run e2e:budget` (tag @budget, a frame of software WebGL takes seconds): the frame of the ship, no deck.
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

test('a tap on a bay of a shut deck bumps at its hatch and Tally says her line', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openHub(page, '?bot=off');
  await bay(page, 'bridge:pulsar').click();
  await expect(page.locator('#hud')).toContainText('locked');
  expect(await hubNow(page)).toMatch(/^mess /);
});

test('the arrow keys move the marble along a floor, and bump the shut hatch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // the tall shell: the Mess has two floors, the lift is 0.58 left of the House table
  await openHub(page, '?bot=off');
  await expect(bay(page, 'mess:bot')).toBeVisible(); // the ship is drawn: before it, the keys roll the old deck's marble
  await page.keyboard.press('ArrowRight');
  await expect(bay(page, 'mess:bot')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // a roll in progress ends first: the next key goes on from where it was going
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#hud')).toContainText('locked');
  expect(await hubNow(page)).toMatch(/^mess /);
});

test('a tap during a roll ends it: the first room does not open', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openHub(page, '?bot=off', ['echo']);
  await bay(page, 'mess:daily').click();
  await bay(page, 'mess:logs').click({ force: true });
  await expect(page.locator('#bay-sheet')).toBeVisible(); // the Logs bay's sheet (#1693), not the daily
  await expect(page.locator('body')).toHaveAttribute('data-hub', /^mess /);
});

/** What the bays and the lift buttons on show measure: the smallest size, and everything that is clipped, under a panel or covered. */
const MEASURE = () => {
  const panels = ['hud', 'hub-pips', 'hub-rail', 'hub-board', 'dock', 'settings'].map((id) => document.getElementById(id)!).filter((e) => getComputedStyle(e).display !== 'none');
  const all = [...document.querySelectorAll<HTMLElement>('#ship-bays .cut-bay')];
  const bays = all.filter((b) => !b.hidden); // a small phone frames the floors around the marble: a bay not whole in the room is no button
  const bad: string[] = [];
  let minW = 999, minH = 999, minFont = 99;
  for (const b of bays) {
    const q = b.getBoundingClientRect();
    minW = Math.min(minW, q.width); minH = Math.min(minH, q.height);
    const sign = [...b.querySelectorAll<HTMLElement>('.short, b')].find((e) => getComputedStyle(e).display !== 'none')!;
    const fs = parseFloat(getComputedStyle(sign).fontSize);
    const sr = sign.getBoundingClientRect();
    if (innerWidth < 600) minFont = Math.min(minFont, fs);
    if (sign.scrollWidth > sign.clientWidth + 1 || sr.right > q.right + 1 || sr.left < q.left - 1 || (innerWidth < 600 && sr.height > fs * 1.6)) bad.push(`${b.dataset.bay}: sign`);
    const hit = panels.find((p) => { const o = p.getBoundingClientRect(); return o.left < q.right && o.right > q.left && o.top < q.bottom && o.bottom > q.top; });
    if (hit) bad.push(`${b.dataset.bay}: under ${hit.id}`);
    const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    if (top !== b && !b.contains(top)) bad.push(`${b.dataset.bay}: covered by ${(top as HTMLElement | null)?.id}`);
    if (q.left < 0 || q.right > innerWidth || q.top < 0 || q.bottom > innerHeight) bad.push(`${b.dataset.bay}: off the window (${q.left.toFixed(0)}..${q.right.toFixed(0)} x ${q.top.toFixed(0)}..${q.bottom.toFixed(0)} of ${innerWidth} x ${innerHeight})`);
  }
  const lift = [...document.querySelectorAll<HTMLElement>('#ship-lift button')].filter((b) => b.offsetParent !== null);
  for (const b of lift) {
    const q = b.getBoundingClientRect();
    if (q.width < 44 || q.height < 44) bad.push(`lift ${b.dataset.lift}: ${q.width} x ${q.height}`);
    const hit = panels.find((p) => { const o = p.getBoundingClientRect(); return o.left < q.right && o.right > q.left && o.top < q.bottom && o.bottom > q.top; });
    if (hit) bad.push(`lift ${b.dataset.lift}: under ${hit.id}`);
    const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    if (top !== b) bad.push(`lift ${b.dataset.lift}: covered by ${(top as HTMLElement | null)?.id}`);
  }
  return { n: all.length, shown: bays.length, lifts: lift.length, bad, minW, minH, minFont };
};

for (const [w, h] of [[390, 844], [375, 667], [360, 640], [1000, 700]] as const) {
  test(`every bay is whole, under no panel, with a one line sign on ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openHub(page, '?bot=off', ALL);
    await expect(bay(page, 'mess:echo')).toBeVisible();
    const r = await page.evaluate(MEASURE);
    console.log(`${w}x${h}: ${r.shown} of ${r.n} bays shown, ${r.lifts} lift buttons, smallest ${r.minW.toFixed(0)} x ${r.minH.toFixed(0)} px, phone sign ${r.minFont}px`);
    expect(r.n).toBe(31);
    expect(r.bad).toEqual([]);
    if (w < 600) expect(r.minFont).toBeGreaterThanOrEqual(10);
    expect(Math.min(r.minW, r.minH)).toBeGreaterThanOrEqual(44); // every bay on show is a tap target (owner, 2026-11-15)
    expect(r.shown).toBeGreaterThanOrEqual(r.lifts ? 9 : 31); // a small phone frames three floors at least: nine bays or more
  });
}

test('the lift buttons ride the marble up and the camera follows: the bays on show stay whole, 44 px and uncovered, up to the Bridge', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // a ride is a 150 ms fade: six of them in the time of the test
  await page.setViewportSize({ width: 360, height: 640 });
  await openHub(page, '?bot=off', ALL);
  await expect(bay(page, 'mess:echo')).toBeVisible();
  const lift = (dir: string) => page.locator(`#ship-lift [data-lift="${dir}"]`);
  await expect(lift('down')).toBeDisabled();
  await expect(bay(page, 'mess:echo')).toHaveAttribute('data-here', 'true'); // the marble's deck has a bright edge
  await expect(bay(page, 'bridge:ballast')).toBeHidden(); // three floors around the marble: the Bridge is off
  for (let i = 0; i < 6; i++) {
    await lift('up').click();
    await page.waitForTimeout(250);
    const r = await page.evaluate(MEASURE);
    expect(r.bad).toEqual([]);
    expect(Math.min(r.minW, r.minH)).toBeGreaterThanOrEqual(44);
  }
  await expect(bay(page, 'bridge:ballast')).toBeVisible({ timeout: 2000 });
  await expect(lift('up')).toBeDisabled();
  await expect(bay(page, 'mess:world')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true'); // nothing opened: still in the Hub
});

for (const [w, h] of [[390, 844], [1000, 700]] as const) {
  test(`the ship is in the scene, whole at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openHub(page, '?bot=off', ALL);
    await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
    // The scene holds the ship from the first frame; the canvas shows it once its material is compiled: a slow software tier takes seconds (a screenshot polls the pixels, not a test).
    expect(await page.evaluate(() => (window as unknown as { __shipDrawn: boolean }).__shipDrawn)).toBe(true);
  });
}
