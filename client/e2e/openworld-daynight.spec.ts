import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1496: the Open world goes through day, dusk and night (docs/specs/openworld.md section 11), and a lair fight entered from it is on the
// board of the phase it was entered in. The test hook `__openworldTime(ms)` sets the time of day: 0 to 6 min day, to 7.5 min dusk,
// to 10.5 min night, to 12 min dusk again. A picture of each is kept with E2E_SHOTS=1 (DAYNIGHT_SHOTS names the folder).
const MIN = 60_000;
const PHASES = [['day', 3 * MIN], ['dusk', 6.75 * MIN], ['night', 9 * MIN]] as const;
const shots = process.env.DAYNIGHT_SHOTS ?? 'test-results';

const enter = async (page: Page): Promise<void> => {
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe('7');
};
const setTime = (page: Page, ms: number) => page.evaluate((t) => (window as unknown as { __openworldTime: (ms: number) => void }).__openworldTime(t), ms);
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
/** Stands the hero next to the first lair and steps onto it: the boss fight of the lair starts. */
const intoLair = async (page: Page): Promise<void> => {
  const lairs = (await page.evaluate(() => document.body.dataset.openworldLairs))!.split(' ');
  const [q, r] = lairs[0]!.split(',').map(Number) as [number, number];
  await page.evaluate(
    ([q, r]) => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }),
    [q, r],
  );
  await page.keyboard.press('ArrowRight');
};

test('the world reads day, dusk and night as the time of day is set, and starts at the start of day, #1496', async ({ page }) => {
  await enter(page);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-phase', 'day');
  for (const [phase, ms] of PHASES) {
    await setTime(page, ms);
    await expect(page.locator('body')).toHaveAttribute('data-openworld-phase', phase);
    await frames(page);
    await shot(page, { path: `${shots}/world-${phase}.png` });
  }
  await setTime(page, 11 * MIN); // the dawn uses the dusk look
  await expect(page.locator('body')).toHaveAttribute('data-openworld-phase', 'dusk');
});

for (const [phase, ms] of PHASES) {
  test(`a lair entered at ${phase} starts the fight on the ${phase} board, #1496`, async ({ page }) => {
    await enter(page);
    await setTime(page, ms);
    await intoLair(page);
    await expect(page.locator('body')).toHaveAttribute('data-fight-board', phase);
    await expect(page.locator('body')).toHaveAttribute('data-boss', /.+/);
    await expect(page.locator('body')).not.toHaveAttribute('data-openworld', /.+/);
    await page.mouse.move(2, 2);
    await frames(page);
    await shot(page, { path: `${shots}/fight-${phase}.png` });
  });
}
