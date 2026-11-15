import { expect, test } from '@playwright/test';
import { pauseClock } from './clock';
import { lowTierOnCi, showHud } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1530: the Open world says its goal on arrival, one sentence and the bearing to the nearest tower, and keeps the controls behind a
// collapsed hint (one tap on its summary, or H). The plate must not cover the hero on a phone, upright or on its side.

// `hold` (#1658): the page's clock is paused once the world is entered, so the plate does not fold under the test.
const enter = async (page: import('@playwright/test').Page, hold = false): Promise<void> => {
  if (hold) await page.clock.install(); // before the load: the page's times are the clock's from the start (frameclock.ts)
  await page.goto('./?bot=off&openworld=7');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
  if (hold) await pauseClock(page);
  await showHud(page, '#openworld-goal'); // the plate folds 8 s after the entry, before a slow runner gets here (#1436)
};

test('the world says its goal and the bearing to the nearest tower, the controls are collapsed, and H and a tap open and close them', async ({ page }, testInfo) => {
  await enter(page);
  await expect(page.locator('#openworld-goal')).toHaveText(/^Goal: beat the 15 towers of Hollow\. One medal each\.$/);
  await expect(page.locator('#openworld-bearing')).toHaveText(/^Nearest tower: \d+ cells, (to the |straight )(upper |lower )?\w+\.$/);
  await expect(page.locator('#openworld-medals')).toHaveText('Medals 0 / 15');
  await expect(page.locator('#openworld-dungeon')).toHaveText('Nearest tower');
  const hint = page.locator('#openworld-controls .keys-hint').last();
  await expect(hint).toBeHidden(); // collapsed
  await shot(page, { path: testInfo.outputPath('1530-world-desktop.png') });
  await page.keyboard.press('h'); // shows the plate first when it has folded
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('H to close this');
  await page.keyboard.press('h');
  await expect(hint).toBeHidden();
  await showHud(page, '#openworld-controls summary');
  await page.locator('#openworld-controls summary').click(); // a tap does the same
  await expect(hint).toBeVisible();
  await page.locator('#openworld-controls summary').click();
  await expect(hint).toBeHidden(); // opened and closed: it stays closed
});

test('the bearing follows the hero: next to the first tower it is one cell away', async ({ page }) => {
  await enter(page);
  const [q, r] = (await page.evaluate(() => document.body.dataset.openworldLairs))!.split(' ')[0]!.split(',').map(Number) as [number, number];
  await page.evaluate(([q, r]) => (window as any).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q, r]);
  await expect(page.locator('#openworld-bearing')).toHaveText(/^Nearest tower: 1 cell, /);
});

// #1532: the bearing is on the ring to beat. Next to a tower of the second ring the nearest tower is still one of the first ring, far off; once
// the three towers of the first ring are beaten (a fixture: the fights are covered elsewhere) the bearing is the one cell to the second ring's.
test('the bearing follows the ring to beat: a tower of the next ring next to the hero is not the nearest tower until the first ring is beaten', async ({ page }) => {
  await enter(page);
  const body = await page.evaluate(() => ({ rings: document.body.dataset.openworldRings!.split(' ').map(Number), lairs: document.body.dataset.openworldLairs!.split(' ') }));
  expect(body.rings.filter((ring) => ring === 1)).toHaveLength(3);
  const second = body.rings.indexOf(2);
  const [q, r] = body.lairs[second]!.split(',').map(Number) as [number, number];
  const first = body.rings.flatMap((ring, i) => (ring === 1 ? [i] : []));
  expect(first).toContain(0); // the Echo is in the first ring
  await page.evaluate(([q, r]) => (window as any).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q, r]);
  await expect(page.locator('#openworld-bearing')).toHaveText(/^Nearest tower: \d{2,} cells, /); // not the 1 cell to the second ring's tower
  await page.evaluate(([q, r, beaten]) => (window as any).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [], beaten }), [q, r, first] as const);
  await expect(page.locator('#openworld-bearing')).toHaveText(/^Nearest tower: 1 cell, /);
});

// Upright, the plate enters as a bar (#1657, below). #1658: the plate folds 8 s after the entry; on a slow page that clock fired between the
// plate shown and the tap on its summary, so the page's clock is paused once the world is entered (`enter(page, true)`).
test.describe('landscape 844 by 390', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('the plate on arrival fits the screen and leaves the hero in the middle uncovered', async ({ page }, testInfo) => {
    await enter(page, true);
    const box = (await page.locator('#openworld-hud').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(844);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
    const covers = box.x < 422 + 40 && box.x + box.width > 422 - 40 && box.y < 195 + 40 && box.y + box.height > 195 - 40;
    expect(covers, `the plate ${JSON.stringify(box)} covers the hero at 422,195`).toBe(false);
    await expect(page.locator('#openworld-controls .tap-hint')).toBeHidden();
    await shot(page, { path: testInfo.outputPath('1530-world-844.png') });
    await page.locator('#openworld-controls summary').tap();
    await expect(page.locator('#openworld-controls .tap-hint')).toBeVisible();
    await shot(page, { path: testInfo.outputPath('1530-world-844-controls.png') });
  });
});

// #1657: a phone held upright enters with the plate folded to a bar, the goal, the bearing and the medals: a fifth of the window at most,
// under the hero, the goal 12 px at least. Its chip says More, a 44 px target clear of the Hub exit, and opens the rest: under the hero at
// 390x844, its two buttons inside the window at 360x640 (the same page, made smaller). One boot; the rects are read in one call. The page's
// clock is paused at the entry (the goal needs no frame): the first frames build the world's programs, and a read of the rects waited
// 7.8 s on them at load 25 to 40; no frame is needed to read the DOM.
type Rect = { x: number; y: number; w: number; h: number; bottom: number };
const rects = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const rect = (id: string): Rect => {
      const b = document.getElementById(id)!.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom };
    };
    const goal = document.getElementById('openworld-goal')!;
    return {
      hud: rect('openworld-hud'), chip: rect('openworld-chip'), exit: rect('exit'), dungeon: rect('openworld-dungeon'),
      goalPx: parseFloat(getComputedStyle(goal).fontSize), chipText: document.getElementById('openworld-chip')!.innerText,
    };
  });

test.describe('upright 390 by 844, the bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the plate enters as a bar of a fifth of the window at most, its More chip opens the rest, its buttons on screen down to 360x640 (#1657)', async ({ page }, testInfo) => {
    await page.clock.install();
    await page.goto('./?bot=off&openworld=7');
    await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
    await pauseClock(page);
    const hud = page.locator('#openworld-hud');
    await expect(page.locator('#openworld-goal')).toHaveText(/^Goal: /);
    await expect(hud).toHaveAttribute('data-folded', '1');
    const bar = await rects(page);
    expect(bar.hud.h, JSON.stringify(bar.hud)).toBeLessThanOrEqual(844 * 0.2);
    expect(bar.hud.y, JSON.stringify(bar.hud)).toBeGreaterThan(844 / 2 + 40); // the hero stands at the middle
    expect(bar.hud.bottom).toBeLessThanOrEqual(844);
    expect(bar.goalPx).toBeGreaterThanOrEqual(12);
    expect(bar.dungeon.h).toBe(0); // behind the chip
    expect(bar.chipText).toBe('MORE');
    expect(Math.min(bar.chip.w, bar.chip.h)).toBeGreaterThanOrEqual(44);
    expect(bar.chip.x + bar.chip.w <= bar.exit.x || bar.chip.bottom <= bar.exit.y, 'the chip is clear of the Hub exit').toBe(true);
    await shot(page, { path: testInfo.outputPath('1657-bar-390.png') });
    await page.locator('#openworld-chip').tap();
    await expect(hud).not.toHaveAttribute('data-folded', '1');
    const open = await rects(page);
    expect(open.hud.y, JSON.stringify(open.hud)).toBeGreaterThan(844 / 2 + 40);
    expect(open.dungeon.bottom).toBeLessThanOrEqual(open.hud.bottom);
    // Tab follows the screen (WCAG 2.4.3): the plate's controls, top to bottom then left to right, are the ones Tab walks from the first.
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll('#openworld-hud :is(summary, button, input)')]
        .filter((e) => e.checkVisibility())
        .map((e) => ({ id: e.id || e.tagName.toLowerCase(), y: Math.round(e.getBoundingClientRect().y), x: e.getBoundingClientRect().x }))
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((e) => e.id),
    );
    expect(shown).toEqual(['summary', 'openworld-dungeon']);
    await page.locator('#openworld-controls summary').focus();
    const tabbed = ['summary'];
    for (const _ of shown.slice(1)) {
      await page.keyboard.press('Tab');
      tabbed.push(await page.evaluate(() => document.activeElement!.id || document.activeElement!.tagName.toLowerCase()));
    }
    expect(tabbed).toEqual(shown);
    await page.setViewportSize({ width: 360, height: 640 });
    await expect.poll(async () => (await rects(page)).hud.bottom).toBe(640 - 88); // laid out at the new size, 5.5rem over the bottom
    const small = await rects(page);
    for (const button of [small.dungeon]) {
      expect(button.y, JSON.stringify(small)).toBeGreaterThanOrEqual(small.hud.y);
      expect(button.bottom, JSON.stringify(small)).toBeLessThanOrEqual(Math.min(632, small.hud.bottom)); // inside the plate, none scrolled off
    }
    await shot(page, { path: testInfo.outputPath('1657-open-360.png') });
    await expect(page.locator('#openworld-controls .tap-hint')).toBeHidden();
    await page.locator('#openworld-controls summary').tap();
    await expect(page.locator('#openworld-controls .tap-hint')).toBeVisible();
  });
});

test('the one lesson of the roll shows on the first entry with the controls open (#1604; the roll and never back: openworldlesson.test.ts)', async ({ page }, testInfo) => {
  await page.goto('./?bot=off&openworld=7&firstrun'); // a player's first launch: the lesson is on (the automated page keeps it off)
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await page.getByRole('button', { name: 'Begin' }).click(); // the first-run story card covers the world until begun
  await showHud(page, '#openworld-lesson');
  await expect(page.locator('#openworld-lesson')).toHaveText('Tap or click a next cell to roll. The arrow keys or the stick do the same.');
  await expect(page.locator('#openworld-controls')).toHaveJSProperty('open', true);
  await shot(page, { path: testInfo.outputPath('1604-lesson.png') });
});
