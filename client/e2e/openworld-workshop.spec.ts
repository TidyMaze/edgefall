import { test as shared } from './shared-world';
import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1655 (Decision #1654, docs/specs/openworld.md section 19.2): the Workshop of a town's Hub buys and chooses special marbles, and a wild fight places the ones the army
// brings. The stock comes from the test hook (no gathering by walking); the logic is unit tests (openworldworkshop.test.ts, main.workshop.test.ts).
type Hooks = { __openworldFixture: (f: object) => void; __openworldEnemies: () => [number, number][] };
const sizes = [
  { name: 'desktop 960 by 540', viewport: { width: 960, height: 540 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'small phone 320 by 480', viewport: { width: 320, height: 480 }, touch: true },
];
const fixture = (page: Page, f: object): Promise<void> => page.evaluate((f) => (window as unknown as Hooks).__openworldFixture(f), f);
const rich = { wood: 20, ore: 20, parts: 40, shards: 0 };
const army = (specials: number[], brought: number[]) => ({ specials, brought, relics: [], relicsBrought: [] });

/** The box of `locator` lies inside the window. */
async function inside(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x, selector).toBeGreaterThanOrEqual(0);
  expect(box.y, selector).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
  expect(box.y + box.height, selector).toBeLessThanOrEqual(height);
}

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const file = name.replaceAll(' ', '-');

    shared('the Hub of a town has a Workshop that buys a Heavy and a Bomb and chooses them for the next fight, by the keyboard too', async ({ world: page }) => { // the shared page of this size (shared-world.ts, #1710)
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-openworld-at', '0,0');
      const listed = (await body.getAttribute('data-openworld-places'))!.split(' ');
      const [q, r] = listed.find((p) => p.startsWith('town:'))!.slice(5).split(',').map(Number) as [number, number];
      await fixture(page, { hero: [q - 1, r], troop: [], enemies: [], resources: rich });
      await page.keyboard.press('ArrowRight');
      await expect(body).toHaveAttribute('data-hub', /.+/);
      await expect(page.locator('#workshop')).toBeHidden();
      await inside(page, '#workshop-open');
      await page.locator('#workshop-open').focus();
      await page.keyboard.press('Enter'); // the keyboard opens it, and the sheet takes the focus
      await expect(page.locator('#workshop')).toBeVisible();
      await expect(page.locator('#workshop-stock')).toHaveText('Wood 20 · Ore 20 · Parts 40 · Shards 0');
      await inside(page, '#workshop');
      await page.keyboard.press('Tab');
      await expect(page.locator('#workshop-close')).toBeFocused(); // the tab order: Close, then the rows
      await page.keyboard.press('Tab');
      await expect(page.locator('#workshop button[data-kind="1"][data-act="buy"]')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#workshop-stock')).toHaveText('Wood 20 · Ore 14 · Parts 36 · Shards 0');
      await page.locator('#workshop button[data-kind="1"][data-act="bring"]').click();
      await page.locator('#workshop button[data-kind="9"][data-act="buy"]').click();
      await page.locator('#workshop button[data-kind="9"][data-act="bring"]').click();
      await expect(page.locator('#workshop-stock')).toHaveText('Wood 17 · Ore 11 · Parts 30 · Shards 0');
      await expect(page.locator('#workshop-army')).toHaveText('Army 2 / 6 · Bringing 2 / 3');
      await expect(page.locator('#workshop button[data-kind="2"][data-act="bring"]')).toBeDisabled(); // none owned to bring
      await expect(page.locator('#workshop li[data-kind="1"] .w-why')).toHaveText('');
      await expect(page.locator('#workshop button[data-kind="7"][data-act="buy"]')).toBeEnabled();
      await page.locator('#workshop').evaluate((el) => (el.scrollTop = 0)); // the first rows in the picture
      await shot(page, { path: `test-results/workshop-${file}.png` });
      await page.keyboard.press('Escape');
      await expect(page.locator('#workshop')).toBeHidden();
      await expect(page.locator('#workshop-open')).toBeFocused();
      await page.locator('#exit').click(); // back in the world, and the Workshop is not in the Hub of the menu
      await expect(body).toHaveAttribute('data-openworld-at', `${q - 1},${r}`);
      await expect(page.locator('#workshop-open')).toBeHidden();
    });
  });
}

for (const { name, viewport, touch } of sizes.slice(0, 2)) {
  test.describe(`${name}, wild fight`, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    // Seed 3 has a marble within the hero's sight of the spawn (openworld-wild.spec.ts). The army brings a Heavy and a Bomb: both stand on its side.
    test('a wild fight places the special marbles the army brings, and Flee gives the world back', async ({ page }) => {
      await page.goto('./?bot=off&openworld=3');
      await page.locator('canvas[aria-label="Edgefall board"]').waitFor();
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-openworld-at', '0,0');
      const [q, r] = (await page.evaluate(() => (window as unknown as Hooks).__openworldEnemies()))[0]!;
      await fixture(page, { hero: [q + 1, r], troop: [], army: army([1, 9], [1, 9]) });
      await page.locator('#openworld-ask-fight').click(); // the wild marble asks first (#1662)
      await expect(body).not.toHaveAttribute('data-openworld', /.*/);
      await expect(page.getByRole('button', { name: 'Flee' })).toBeVisible();
      await expect(page.locator('#wild-wipe')).toBeHidden();
      const kinds = (): Promise<number[]> => page.evaluate(() => (document.body.dataset.specials ?? '').split(' ').filter(Boolean).map((s) => Number(s.split(',')[2])).sort());
      await expect.poll(kinds).toEqual([1, 9]);
      await shot(page, { path: `test-results/workshop-fight-${name.replaceAll(' ', '-')}.png` });
      await page.getByRole('button', { name: 'Flee' }).click();
      await expect(body).toHaveAttribute('data-openworld-at', `${q + 1},${r}`);
    });
  });
}
