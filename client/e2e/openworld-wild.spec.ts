import { expect, type Page } from '@playwright/test';
import { test } from './shared-world';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1511: a wandering marble that touches the hero starts a wild fight the player can flee. Seed 3 has a marble within the hero's sight of the
// spawn. The marbles stand still (tick 0) until a spec sets the clock; the hero is put beside one with the test hook. The fight's logic (the
// reload, the walk, F) is unit tests in main.wild.test.ts (#1626): this smoke keeps the wipe, the arena and Flee in a real browser.
type Hooks = { __openworldFixture: (f: object) => void; __openworldEnemies: () => [number, number][] };
const hooks = (page: Page) => ({
  enemies: () => page.evaluate(() => (window as unknown as Hooks).__openworldEnemies()),
  put: (hero: [number, number]) => page.evaluate((h) => (window as unknown as Hooks).__openworldFixture({ hero: h, troop: [] }), hero),
});
const data = (page: Page, key: string) => page.evaluate((k) => document.body.dataset[k], key);

// The world of seed 3 on the worker's shared page (shared-world.ts), booted once and fresh for each test: no page load in the test (#1710).
test.use({ worldUrl: './?bot=off&openworld=3' });

async function opened(page: Page): Promise<[number, number]> {
  const [marble] = await hooks(page).enemies();
  return marble!;
}

test('a marble beside the hero starts the wipe, then the arena with Flee; Flee puts the hero back and the marble waits 5 s, #1511', async ({ world: page }) => {
  const [q, r] = await opened(page);
  await hooks(page).put([q + 1, r]);
  await page.locator('#openworld-ask-fight').click(); // the wild marble asks first (#1662)
  await expect(page.locator('#wild-wipe')).toBeVisible();
  await page.waitForTimeout(220);
  await shot(page, { path: 'test-results/openworld-wild-wipe.png' });
  await expect.poll(() => data(page, 'openworld')).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Flee' })).toBeVisible();
  expect(await data(page, 'fightBoard')).toBe('day');
  await expect(page.locator('#wild-wipe')).toBeHidden(); // a second in all
  await shot(page, { path: 'test-results/openworld-wild-fight.png' });
  await page.getByRole('button', { name: 'Flee' }).click();
  await expect.poll(() => data(page, 'openworldAt')).toBe(`${q + 1},${r}`);
  await expect(page.getByRole('button', { name: 'Flee' })).toBeHidden();
  expect(await data(page, 'fightBoard')).toBeUndefined();
  await page.waitForTimeout(600);
  expect(await data(page, 'openworld')).toBe('3'); // beside the marble, and no new fight: it is calm
});
