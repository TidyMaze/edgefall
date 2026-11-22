import { expect, type Page } from '@playwright/test';
import { test } from './shared-world';
import { paused } from './frameclock';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1662: a wild marble that touches the hero asks first, "A wild marble is in your way." with Fight and Back away. The rules (the pause, the
// way back, the declined group, the calm) are unit tests in openworldmodewander.test.ts; these specs keep the dialog in a real browser.
// #1762: the dialog does not pause the world nor take the focus: a held key walks through a contact and out of it, with no fight.
// Seed 3 has a marble within the hero's sight of the spawn; the marbles stand still (tick 0) until a spec sets the clock.
type Hooks = { __openworldFixture: (f: object) => void; __openworldEnemies: () => [number, number][] };
const data = (page: Page, key: string) => page.evaluate((k) => document.body.dataset[k], key);
const put = (page: Page, hero: [number, number]) => page.evaluate((h) => (window as unknown as Hooks).__openworldFixture({ hero: h, troop: [] }), hero);

// The world of seed 3 on the worker's shared page (shared-world.ts), booted once and fresh for each test: no page load in the test (#1710).
test.use({ worldUrl: './?bot=off&openworld=3' });

// The tests that set the window size give the shared page its size back.
test.afterEach(async ({ world, viewport }) => {
  if (viewport) await world.setViewportSize(viewport);
});

async function opened(page: Page): Promise<[number, number]> {
  const [q, r] = (await page.evaluate(() => (window as unknown as Hooks).__openworldEnemies()))[0]!;
  return [q! + 1, r!];
}

test('ask prompt shows on wild contact, no fight until Fight', async ({ world: page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const beside = await opened(page);
  await put(page, beside);
  const ask = page.locator('#openworld-ask');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('A wild marble is in your way.');
  await expect(page.locator('#openworld-ask-fight')).not.toBeFocused(); // the focus stays on the canvas (#1762)
  await shot(page, { path: 'test-results/openworld-ask-1000x700.png' });
  await paused(page, async (frame) => {
    await frame(6000);
    await frame(100);
  });
  await expect(page.locator('#wild-wipe')).toBeHidden();
  expect(await data(page, 'openworld')).toBe('3'); // no fight until Fight, the hero where it stood (nothing pushed it)
  expect(await data(page, 'openworldAt')).toBe(beside.join(','));
  await page.locator('#openworld-ask-fight').click();
  await expect(page.getByRole('button', { name: 'Flee' })).toBeVisible();
  await expect(ask).toBeHidden();
});

test('Enter fights, Esc backs away and does not ask again until contact is remade', async ({ world: page }) => {
  const beside = await opened(page);
  await put(page, beside);
  await expect(page.locator('#openworld-ask')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#openworld-ask')).toBeHidden();
  expect(await data(page, 'openworld')).toBe('3'); // Esc backs away, it does not leave the world
  expect(await data(page, 'openworldAt')).not.toBe(beside.join(','));
  await paused(page, async (frame) => {
    await frame(6000); // the calm ends: the hero is out of contact, nothing asks
    await frame(100);
  });
  await expect(page.locator('#openworld-ask')).toBeHidden();
  await put(page, beside); // contact remade
  await expect(page.locator('#openworld-ask')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Flee' })).toBeVisible();
});

test('a held key walks through a contact and out of it, no fight (#1762)', async ({ world: page }) => {
  const [bq, br] = await opened(page);
  const start: [number, number] = [bq + 1, br - 1];
  await put(page, start);
  const asked = page.locator('#openworld-ask');
  await expect(asked).toBeHidden();
  await page.keyboard.down('ArrowDown');
  await expect(asked).toBeVisible(); // in contact: the dialog shows and the key is still down
  await shot(page, { path: 'test-results/openworld-ask-walking.png' });
  await expect(asked).toBeHidden(); // the hero walked on, out of contact
  await page.keyboard.up('ArrowDown');
  expect(await data(page, 'openworld')).toBe('3');
  await expect(page.locator('#wild-wipe')).toBeHidden();
  const at = (await data(page, 'openworldAt'))!.split(',').map(Number);
  expect(Math.max(Math.abs(at[0]! - bq), Math.abs(at[1]! - br), Math.abs(at[0]! - bq + at[1]! - br))).toBeGreaterThanOrEqual(2);
});

test('Back away after a step into contact returns to the cell the hero stepped from', async ({ world: page }) => {
  const [bq, br] = await opened(page);
  const start: [number, number] = [bq + 1, br - 1]; // two cells from the marble; ArrowDown steps (-1, +1), onto the cell beside it
  await put(page, start);
  const asked = page.locator('#openworld-ask');
  await expect(asked).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await expect(asked).toBeVisible();
  expect(await data(page, 'openworldAt')).not.toBe(start.join(','));
  await page.keyboard.press('Escape');
  await expect(asked).toBeHidden();
  await expect.poll(() => data(page, 'openworldAt')).toBe(start.join(',')); // back on the previous cell, not just anywhere else
});

for (const [width, height] of [[390, 844], [360, 640]] as const) {
  test(`prompt at ${width}x${height} covers no HUD and buttons are >= 44 px`, async ({ world: page }) => {
    await page.setViewportSize({ width, height });
    const beside = await opened(page);
    await put(page, beside);
    await expect(page.locator('#openworld-ask')).toBeVisible();
    await shot(page, { path: `test-results/openworld-ask-${width}x${height}.png` });
    const rects = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        const r = el?.getBoundingClientRect();
        return el && r && r.width > 0 && getComputedStyle(el).visibility !== 'hidden' ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      };
      return { ask: box('#openworld-ask'), fight: box('#openworld-ask-fight'), back: box('#openworld-ask-back'), hud: box('#openworld-hud'), chip: box('#openworld-chip'), map: box('#openworld-map-button'), teleport: box('#openworld-teleport'), minimap: box('#openworld-minimap'), settings: box('#settings'), font: parseFloat(getComputedStyle(document.getElementById('openworld-ask-text')!).fontSize), view: { w: innerWidth, h: innerHeight } };
    });
    const { ask, fight, back, view } = rects;
    expect(rects.font).toBeGreaterThanOrEqual(14);
    expect(fight!.h).toBeGreaterThanOrEqual(44);
    expect(back!.h).toBeGreaterThanOrEqual(44);
    expect(ask!.x).toBeGreaterThanOrEqual(0);
    expect(ask!.x + ask!.w).toBeLessThanOrEqual(view.w);
    expect(ask!.y + ask!.h).toBeLessThanOrEqual(view.h);
    // The minimap is a picture the world does not need for a moment: the prompt may sit over it, never over a button or the plate.
    for (const other of [rects.hud, rects.chip, rects.map, rects.teleport, rects.settings]) {
      if (!other) continue;
      const apart = ask!.y + ask!.h <= other.y || other.y + other.h <= ask!.y || ask!.x + ask!.w <= other.x || other.x + other.w <= ask!.x;
      expect(apart, JSON.stringify([ask, other])).toBe(true);
    }
  });
}
