import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi, enterBay } from './modes';
import { shot } from './shot';
import { test as shared } from './shared-world';

lowTierOnCi();

// #1593: rolling onto a town opens the Hub, rolling onto a dungeon gate starts the rogue-lite run, and Back to the Open world returns the hero
// to the entrance cell (docs/specs/openworld.md section 13). The test hook stands the hero next to the place of the public seed 7 (no walk).
type Hooks = { __openworldFixture: (f: object) => void; __openworldTime: (ms: number) => void };
const sizes = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];

/** The cell of the first place of `kind`, from the page. */
async function placeOf(page: Page, kind: 'town' | 'dungeon'): Promise<[number, number]> {
  const listed = (await page.locator('body').getAttribute('data-openworld-places'))!.split(' ');
  return listed.find((p) => p.startsWith(`${kind}:`))!.slice(kind.length + 1).split(',').map(Number) as [number, number];
}

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    for (const [kind, shown] of [['town', 'data-hub'], ['dungeon', 'data-run']] as const) {
      // On the page the spec's tests share at this size (shared-world.ts): the boot is paid once, not per test (#1710).
      shared(`rolling onto a ${kind} enters it, and Back to the Open world returns to the entrance cell, #1593`, async ({ world: page }) => {
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-openworld-at', '0,0');
        const [q, r] = await placeOf(page, kind);
        await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
        await shot(page, { path: `test-results/place-${kind}-${name}-day.png` });
        await page.evaluate(() => (window as unknown as Hooks).__openworldTime(9 * 60_000));
        await shot(page, { path: `test-results/place-${kind}-${name}-night.png` });
        await page.keyboard.press('ArrowRight');
        if (kind === 'dungeon') await enterBay(page);
        await expect(body).not.toHaveAttribute('data-openworld', /.*/);
        await expect(body).toHaveAttribute(shown, /.+/); // the Hub's deck and cell, the run's screen
        if (kind === 'town') await expect(page.locator('.hub-contract')).toHaveText(/^Contract: The [A-Za-z ]+, ring 1, \d+ cells?, (to the |straight )(upper |lower )?\w+\.$/); // the posted contract (#1618)
        if (kind === 'town') await expect(page.locator('.hub-banked')).toHaveText(/^(No blueprint banked yet\.|Banked by the last dungeon:)/); // the blueprints the last dungeon banked (#1622)
        await expect(page.locator('#exit')).toBeVisible();
        await expect(page.locator('#exit')).toHaveAttribute('data-label', 'World');
        await shot(page, { path: `test-results/place-${kind}-${name}-inside.png` });
        await page.locator('#exit').click();
        await expect(body).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
        await expect(page.locator('#exit')).toHaveAttribute('data-label', 'Hub'); // the world's own exit, same slot (#1517)
      });
    }
  });
}

// #1597: a gate's run begins in the biome of the ground the gate stands in, not the Meadow (body[data-biome] is absent in the Meadow).
shared('rolling onto a dungeon gate starts its run in the gate\'s biome, #1597', async ({ world: page }) => {
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-openworld-at', '0,0');
  const [q, r] = await placeOf(page, 'dungeon');
  await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
  await page.keyboard.press('ArrowRight');
  await enterBay(page);
  await expect(body).toHaveAttribute('data-run', /.+/);
  await expect(body).toHaveAttribute('data-biome', /^(forest|tundra|desert|badlands|archipelago)$/);
  await shot(page, { path: 'test-results/gate-biome.png' });
});
