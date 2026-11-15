import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1655 (Decision #1654, docs/specs/openworld.md section 19.3): the Workshop upgrades a Heavy and sells relics, and a lair fight walked into from the world places the
// special marbles and sets the relics the army brings. The stock comes from the test hook; the logic is unit tests (openworldworkshop.test.ts, main.workshop.test.ts).
type Hooks = { __openworldFixture: (f: object) => void };
const sizes = [
  { name: 'desktop 960 by 540', viewport: { width: 960, height: 540 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];
const fixture = (page: Page, f: object): Promise<void> => page.evaluate((f) => (window as unknown as Hooks).__openworldFixture(f), f);
const stock = {
  resources: { wood: 4, ore: 20, parts: 30, shards: 8 },
  army: { specials: [1, 9], brought: [1, 9], relics: [0], relicsBrought: [0] },
};

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const file = name.replaceAll(' ', '-');

    test('the Workshop upgrades a Heavy for shards and ore, and buys a relic for shards and parts', async ({ page }) => {
      await page.goto('./?bot=off&openworld=7&hub=classic');
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-openworld-at', '0,0');
      const listed = (await body.getAttribute('data-openworld-places'))!.split(' ');
      const [q, r] = listed.find((p) => p.startsWith('town:'))!.slice(5).split(',').map(Number) as [number, number];
      await fixture(page, { hero: [q - 1, r], troop: [], enemies: [], ...stock });
      await page.keyboard.press('ArrowRight');
      await expect(body).toHaveAttribute('data-hub', /.+/);
      await page.locator('#workshop-open').click();
      await page.locator('#workshop button[data-kind="1"][data-act="upgrade"]').click(); // 3 shards and 10 ore
      await expect(page.locator('#workshop-stock')).toHaveText('Wood 4 · Ore 10 · Parts 30 · Shards 5');
      await expect(page.locator('#workshop li[data-kind="4"] .w-own')).toHaveText('Owned 1 · Bringing 1');
      await page.locator('#workshop button[data-relic="4"][data-act="buy"]').click(); // a Detonator, 5 shards and 15 parts
      await page.locator('#workshop button[data-relic="4"][data-act="bring"]').click();
      await expect(page.locator('#workshop-stock')).toHaveText('Wood 4 · Ore 10 · Parts 15 · Shards 0');
      await expect(page.locator('#workshop-relics')).toHaveText('Relics 2 · Bringing 2 / 2');
      await expect(page.locator('#workshop button[data-relic="1"][data-act="buy"]')).toBeDisabled();
      await page.locator('#workshop').evaluate((el) => (el.scrollTop = 0));
      await shot(page, { path: `test-results/upgrade-${file}.png` });
      await page.locator('#workshop button[data-relic="1"][data-act="buy"]').scrollIntoViewIfNeeded();
      await shot(page, { path: `test-results/relics-${file}.png` });
    });

    test('a lair fight walked into places the special marbles and sets the relics the army brings, and Back keeps them all', async ({ page }) => {
      await page.goto('./?bot=off&openworld=7&hub=classic');
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-openworld-at', '0,0');
      const lairs = (await body.getAttribute('data-openworld-lairs'))!.split(' ').map((c) => c.split(',').map(Number) as [number, number]);
      const [q, r] = lairs[1]!; // The Hull, a boss that takes the army's build (The Echo, the first lair, takes none)
      const walked = `${q - 1},${r}`;
      await fixture(page, { hero: [q - 1, r], troop: [], enemies: [], ...stock });
      await page.keyboard.press('ArrowRight');
      await expect(body).not.toHaveAttribute('data-openworld', /.*/);
      await expect(body).toHaveAttribute('data-boss', 'hull');
      const kinds = (): Promise<number[]> => page.evaluate(() => (document.body.dataset.specials ?? '').split(' ').filter(Boolean).map((s) => Number(s.split(',')[2])).sort());
      await expect.poll(kinds).toEqual([1, 9]);
      if (process.env.E2E_SHOTS) await page.waitForTimeout(3500); // the boss's entrance card, for the picture only
      await shot(page, { path: `test-results/relics-lair-${name.replaceAll(' ', '-')}.png` });
      await page.locator('#exit').click();
      await expect(body).toHaveAttribute('data-openworld-at', walked);
    });
  });
}
