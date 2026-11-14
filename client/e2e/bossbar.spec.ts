import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { CONVERTED_AT, SEED, parseRecorded } from '../src/test/chaplain-game';
import { startBoss } from './modes';
import { shot } from './shot';

// The boss health bar (#788): at the top centre of a boss fight, the name over one red fragment per ejection needed, one
// emptying per ejection, covering no cell, no plate and no button.

const fight = async (page: Page, boss: string, seed = 0) => {
  await page.addInitScript((s) => {
    crypto.getRandomValues = ((a: Uint32Array) => a.fill(s)) as typeof crypto.getRandomValues; // the fight seed
  }, seed);
  await page.goto('./?nodes=200');
  await page.locator('canvas').waitFor();
  await startBoss(page, boss);
  await expect(page.locator('#boss-bar .name')).toHaveText(boss);
};

// What the bar covers: the cells (disc as in phone-layout.spec.ts), the HUD plate and every visible button.
const covered = (page: Page, selector = '#boss-bar') =>
  page.evaluate((sel) => {
    type Box = { left: number; top: number; right: number; bottom: number };
    const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const bar = document.querySelector(sel)!.getBoundingClientRect();
    const found: string[] = [];
    const toScreen = (q: number, r: number) => (window as any).__cellToScreen(q, r) as { x: number; y: number };
    for (let r = -4; r <= 4; r++) {
      for (let q = Math.max(-4, -4 - r); q <= Math.min(4, 4 - r); q++) {
        const p = toScreen(q, r);
        const e = toScreen(q + 1, r);
        const radius = 0.46 * Math.hypot(e.x - p.x, e.y - p.y);
        if (meets(bar, { left: p.x - radius, top: p.y - radius, right: p.x + radius, bottom: p.y + radius })) found.push(`cell ${q},${r}`);
      }
    }
    if (meets(bar, document.getElementById('hud')!.getBoundingClientRect())) found.push('the HUD');
    for (const el of document.querySelectorAll('button')) {
      if (el.getClientRects().length > 0 && meets(bar, el.getBoundingClientRect())) found.push(el.textContent || el.getAttribute('aria-label')!);
    }
    return found;
  }, selector);

const sizes = [
  { name: 'a desktop window', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'a window 1024 by 600', viewport: { width: 1024, height: 600 }, mobile: false },
  { name: 'a phone held upright', viewport: { width: 375, height: 812 }, mobile: true },
  { name: 'a phone 360 px wide held upright', viewport: { width: 360, height: 640 }, mobile: true },
  { name: 'a phone held sideways', viewport: { width: 812, height: 375 }, mobile: true },
];
for (const { name, viewport, mobile } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile });
    test('the bar shows 6 fragments and covers nothing, #788', async ({ page }, testInfo) => {
      await fight(page, 'The Hull');
      await expect(page.locator('#boss-bar .frag')).toHaveCount(6);
      expect(await covered(page)).toEqual([]);
      await shot(page, { path: testInfo.outputPath('boss-bar.png') });
    });
  });
}

test.describe('a 200 % UI scale', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('the bar covers no cell at the largest scale, #788', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ab-alone.ui-scale', '200'));
    await fight(page, 'The Hull');
    const cells = (await covered(page)).filter((c) => c.startsWith('cell'));
    expect(cells).toEqual([]);
  });
});

test('The Ballast Mind needs 12 ejections, 12 fragments, #788', async ({ page }) => {
  await fight(page, 'The Ballast Mind');
  await expect(page.locator('#boss-bar .frag')).toHaveCount(12);
});

// The recorded Hull win (crates/edgefall-core/tests/fixtures/hull.txt): every fragment is empty once it is won.
test('the fragments empty as the player ejects, all gone at the win, #788', async ({ page }) => {
  await fight(page, 'The Hull');
  const records = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/hull.txt', import.meta.url), 'utf8'));
  const empty = page.locator('#boss-bar .frag.empty');
  await expect(empty).toHaveCount(0);
  await page.evaluate((r) => (window as any).__playMoves(r), records.slice(0, 70));
  const half = await empty.count();
  expect(half).toBeGreaterThan(0);
  await page.evaluate((r) => (window as any).__playMoves(r), records.slice(70));
  await expect(empty).toHaveCount(6);
});

// The recorded Chaplain win (crates/edgefall-core/tests/fixtures/chaplain.txt): at ply CONVERTED_AT the boss converts a player
// marble, which heals it by one fragment (#810).
test('a player marble converted to the Chaplain fills a fragment back, #810', async ({ page }, testInfo) => {
  await fight(page, 'The Chaplain', SEED);
  const records = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/chaplain.txt', import.meta.url), 'utf8'));
  const play = (from: number, to: number) => page.evaluate((r) => (window as any).__playMoves(r), records.slice(from, to));
  const empty = page.locator('#boss-bar .frag.empty');
  await play(0, CONVERTED_AT - 1);
  const before = await empty.count();
  expect(before).toBeGreaterThan(0);
  await shot(page, { path: testInfo.outputPath('refill-before.png') });
  await page.evaluate(() => {
    (window as any).__refilled = false;
    new MutationObserver(() => {
      if (document.querySelector('#boss-bar .frag.refill')) (window as any).__refilled = true;
    }).observe(document.getElementById('boss-bar')!, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await play(CONVERTED_AT - 1, CONVERTED_AT);
  expect(await empty.count()).toBe(before - 1);
  expect(await page.evaluate(() => (window as any).__refilled)).toBe(true);
  await shot(page, { path: testInfo.outputPath('refill-after.png') });
});

// The Choir's army chips (#816), from the recorded Choir win (crates/edgefall-core/tests/fixtures/choir.txt): the chips in play
// order with the marbles left, the next army highlighted, a removed army gone, the last one reading "×2".
const choirPlies = () => parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/choir.txt', import.meta.url), 'utf8'));
const chipTexts = (page: Page) => page.locator('#boss-bar .chip').allInnerTexts();
const choirFight = async (page: Page) => {
  await fight(page, 'The Choir');
  await page.evaluate((r) => ((window as any).__records = r), choirPlies());
};
const playTo = (page: Page, from: number, to: number) =>
  page.evaluate(([a, b]) => (window as any).__playMoves((window as any).__records.slice(a, b)), [from, to]);

for (const { name, viewport, mobile } of sizes) {
  test.describe(`${name}, the Choir`, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile });
    test('the chips cover no cell, no plate and no button, #816', async ({ page }, testInfo) => {
      await choirFight(page);
      await expect(page.locator('#boss-bar .chip')).toHaveCount(3);
      await shot(page, { path: testInfo.outputPath('choir-chips.png') });
      expect(await covered(page, '#boss-bar .chips')).toEqual([]);
    });
  });
}

test('the chips list the armies, the next one highlighted, removed ones gone, #816', async ({ page }) => {
  await choirFight(page);
  expect(await chipTexts(page)).toEqual(['▲ Alto 6', '○ Tenor 6', '■ Bass 6']);
  await expect(page.locator('#boss-bar .chip.next')).toHaveText('▲ Alto 6');
  await playTo(page, 0, 2); // a player move, then Alto's reply
  await expect(page.locator('#boss-bar .chip.next')).toHaveText('○ Tenor 6');
  await playTo(page, 2, 41); // the first removal (P2): Alto is gone
  expect(await chipTexts(page)).toEqual(['○ Tenor 5', '■ Bass 5']);
  await expect(page.locator('#boss-bar .arrow')).toHaveCount(1);
  await playTo(page, 41, 69); // the second (P3): the last army plays twice
  expect(await chipTexts(page)).toEqual(['○ Tenor 5 ×2']);
  await expect(page.locator('#boss-bar .arrow')).toHaveCount(0);
});

test.describe('a 200 % UI scale, the Choir', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('the chips cover no cell and no plate at the largest scale, #816', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('ab-alone.ui-scale', '200'));
    await choirFight(page);
    const box = (await page.locator('#boss-bar .chips').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280); // all on screen
    await shot(page, { path: testInfo.outputPath('choir-chips-200.png') });
    expect(await covered(page, '#boss-bar .chips')).toEqual([]);
  });
});

// Bug #929: at a 200 % UI scale the bar, centred on the row, overlapped the HUD plate and cut the boss title. The bar stacks
// above the plate: at least 8 px apart, no overlap, its name whole. Checked at 1600 by 900 with the Goal card open (the
// tallest plate), at 100 % too, and on a phone held upright.
const stacked = (page: Page) =>
  page.evaluate(() => {
    const bar = document.getElementById('boss-bar')!.getBoundingClientRect();
    const hud = document.getElementById('hud')!.getBoundingClientRect();
    const name = document.querySelector<HTMLElement>('#boss-bar .name')!;
    const overlapX = Math.max(0, Math.min(bar.right, hud.right) - Math.max(bar.left, hud.left));
    const overlapY = Math.max(0, Math.min(bar.bottom, hud.bottom) - Math.max(bar.top, hud.top));
    return { gap: hud.top - bar.bottom, overlap: overlapX * overlapY, name: name.scrollWidth, nameBox: name.clientWidth };
  });

const stackSizes = [
  { name: 'a 1600 by 900 window at 200 %', viewport: { width: 1600, height: 900 }, scale: '200', mobile: false },
  { name: 'a 1600 by 900 window at 100 %', viewport: { width: 1600, height: 900 }, scale: '100', mobile: false },
  { name: 'a phone 360 px wide held upright', viewport: { width: 360, height: 780 }, scale: '100', mobile: true },
];
for (const { name, viewport, scale, mobile } of stackSizes) {
  test.describe(`${name}, the boss bar`, () => {
    test.use({ viewport, isMobile: mobile, hasTouch: mobile });
    test('the bar stacks above the HUD, 8 px apart, no overlap, title whole, #929', async ({ page }) => {
      await page.addInitScript((s) => localStorage.setItem('ab-alone.ui-scale', s), scale);
      await fight(page, 'The Hull');
      await expect(page.getByRole('button', { name: 'Goal' })).toHaveAttribute('aria-expanded', 'false'); // the sheet is shut before the first move (#1032)
      const r = await stacked(page);
      expect(r.overlap, JSON.stringify(r)).toBe(0);
      expect(r.gap, JSON.stringify(r)).toBeGreaterThanOrEqual(8);
      expect(r.name, JSON.stringify(r)).toBe(r.nameBox);
    });
  });
}

// #1096: the fragment that breaks gets one burst class, which ends with its animation.
test('a fragment that breaks bursts once, #1096', async ({ page }, testInfo) => {
  await fight(page, 'The Hull');
  const records = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/hull.txt', import.meta.url), 'utf8'));
  await page.evaluate(() => {
    (window as any).__broke = 0;
    new MutationObserver(() => {
      if (document.querySelector('#boss-bar .frag.broke')) (window as any).__broke++;
    }).observe(document.getElementById('boss-bar')!, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.evaluate((r) => (window as any).__playMoves(r), records.slice(0, 70));
  expect(await page.evaluate(() => (window as any).__broke)).toBeGreaterThan(0);
  await shot(page, { path: testInfo.outputPath('boss-feedback.png') });
  await expect(page.locator('#boss-bar .frag.broke')).toHaveCount(0);
});
