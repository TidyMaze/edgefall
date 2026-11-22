import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';
import { openMore } from './runstart';
import { shot } from './shot';

// The start screen of a rogue-lite run (#1524, docs/specs/roguelite.md section 29): two sentences on what a run is and how it ends, one Start
// button, and the commanders, ascension levels, runes, blueprints and the book behind More. Start and More are in view with no scroll, and every
// control of More can be scrolled into the plate, on a desktop window and on a phone held upright.

async function startScreen(page: Page): Promise<void> {
  await startMode(page, 'run');
  await expect(page.locator('#run-map')).toBeVisible();
}

/** `target` is inside the window and inside what the plate shows of itself (its scrolling box). */
async function shown(page: Page, target: string): Promise<void> {
  const { width, height } = page.viewportSize()!;
  const plate = (await page.locator('#run-map').boundingBox())!;
  const box = (await page.locator(target).boundingBox())!;
  expect(box.x, target).toBeGreaterThanOrEqual(Math.max(0, plate.x));
  expect(box.y, target).toBeGreaterThanOrEqual(Math.max(0, plate.y));
  expect(box.x + box.width, target).toBeLessThanOrEqual(Math.min(width, plate.x + plate.width));
  expect(box.y + box.height, target).toBeLessThanOrEqual(Math.min(height, plate.y + plate.height));
}

for (const [name, viewport, touch] of [
  ['a desktop window, 960x540', { width: 960, height: 540 }, false],
  ['a phone held upright, 390x844', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const kind = touch ? 'phone' : 'desktop';
    // One page for the two tests of this window: its boot (a second or two of shader compiling on software WebGL, 2.5 times that on the CI runner)
    // is paid once, in the hook, not by each test (#1710). Each test starts the run again through the hook.
    let page: Page;
    test.beforeAll(async ({ browser, baseURL }) => {
      page = await (await browser.newContext({ baseURL, viewport, isMobile: touch, hasTouch: touch })).newPage();
      await page.goto('./?nodes=50&bot=off');
      await page.locator('canvas').waitFor();
    });
    test.afterAll(() => page.context().close());

    test('says what a run is, has Start and More in view, and keeps the choices behind More, none of it cut off', async () => {
      await startScreen(page);
      const map = page.locator('#run-map');
      await expect(map.locator('.run-intro')).toHaveText(/^A run is a climb through 3 acts.*Beat the act 3 boss to win; lose a fight, or fall below 4 marbles/);
      await expect(map.locator('#run-start')).toHaveText('Start');
      await shown(page, '#run-start');
      await shown(page, 'button[data-more]');
      await shown(page, '.run-intro');
      await expect(map.locator('button[data-commander]')).toHaveCount(0);
      await expect(map.locator('button[data-ascension]')).toHaveCount(0);
      await expect(map.locator('button[data-flask]')).toBeVisible(); // the flask stays on the screen
      await shot(page, { path: `test-results/run-start-${kind}.png` });

      await openMore(page);
      for (const selector of ['button[data-commander="0"]', 'button[data-ascension="0"]', 'button[data-daily]', 'button[data-book="history"]', 'button[data-book="compendium"]']) {
        await map.locator(selector).scrollIntoViewIfNeeded();
        await shown(page, `#run-map ${selector}`);
      }
      const last = map.locator('button[data-ascension]').last();
      await last.scrollIntoViewIfNeeded();
      await shown(page, '#run-map button[data-ascension]:last-of-type'); // the row that was cut off at the bottom
      await shot(page, { path: `test-results/run-more-${kind}.png` });
      await map.locator('button[data-more]').scrollIntoViewIfNeeded();
      await map.locator('button[data-more]').click(); // Less
      await expect(map.locator('button[data-commander]')).toHaveCount(0);
    });

    test('Start takes the first fight with the Captain, the default commander', async () => {
      await startScreen(page);
      await expect(page.locator('#run-map .run-picks')).toHaveText('Commander: The Captain');
      await page.locator('#run-start').click();
      await expect(page.locator('#run-map')).toBeHidden();
      await expect(page.locator('#hud small')).toContainText(/Rogue-lite run · act 1 fight · .*army 14 marbles/);
    });
  });
}
