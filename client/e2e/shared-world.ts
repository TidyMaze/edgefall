import { test as base, expect, type Browser, type Page } from '@playwright/test';

// One Open world page for all the tests of a spec that ask for the same page (`./?bot=off&openworld=7`, no init script, no reload): the
// boot of the page (2 to 3 s of first frames on software WebGL, more on the CI runner) is paid once per worker, not once per test
// (#1481). Each test starts from the spawn: the page hook __openworldFresh opens the world again without reading its save. A test that
// reloads, resizes, emulates media or adds an init script keeps the `page` of Playwright.
// The fixture has its own time (#1710): the boot of the first test's page is not counted in that test's 5 s.
export type WorldScreen = { viewport?: { width: number; height: number } | null; isMobile?: boolean; hasTouch?: boolean };

async function boot(browser: Browser, baseURL: string | undefined, screen: WorldScreen): Promise<Page> {
  const context = await browser.newContext({ baseURL, ...screen, serviceWorkers: 'block' });
  if (process.env.CI) await context.addInitScript(() => localStorage.setItem('ab-alone.tier', 'low')); // as lowTierOnCi (modes.ts)
  const page = await context.newPage();
  await page.clock.install(); // the time flows as usual; a test pauses it to draw a glide frame by frame (frameclock.ts, #1643)
  await page.goto('./?bot=off&openworld=7');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  return page;
}

// One page per window and touch setting, kept for the worker: a spec whose describes run at a desktop and a phone size shares a page per size.
const pages = new Map<string, Promise<Page>>();

export const test = base.extend<{ world: Page }>({
  world: [
    async ({ browser, baseURL, viewport, isMobile, hasTouch }, use) => {
      const screen = { viewport, isMobile, hasTouch };
      const key = JSON.stringify(screen);
      let page = await (pages.get(key) ?? pages.set(key, boot(browser, baseURL, screen)).get(key)!);
      if (page.isClosed()) page = await pages.set(key, boot(browser, baseURL, screen)).get(key)!;
      await page.evaluate(() => {
        delete (window as unknown as { __openworldSlow?: number }).__openworldSlow; // the slow factor a glide test set (openworldglide.ts)
        return (window as unknown as { __openworldFresh: () => Promise<void> }).__openworldFresh();
      });
      // no key is left held by the test before: a test that timed out mid-press can leave an arrow down, and the next one walks (#1643)
      for (const key of ['Shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(key);
      await expect.poll(() => page.evaluate(() => document.body.dataset.openworldAt)).toBe('0,0');
      // the world's frames run: its first entry builds the programs behind the veil, where no frame walks or glides (#1582, #1643)
      await expect.poll(() => page.evaluate(() => document.body.dataset.veil)).toBeUndefined();
      await use(page);
    },
    { timeout: 120_000 }, // its own time: the boot of the first test's page is not counted in that test's 5 s (#1710)
  ],
});
export { expect };
