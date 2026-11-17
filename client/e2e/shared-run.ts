import { test as base, expect, type Page } from '@playwright/test';

// One page of the game (`./?bot=off`, no init script, no reload) for all the tests of a spec that load a rogue-lite run through the
// `__run` hook: the boot of the page (1.5 to 3 s of shader compiling on software WebGL, more on the CI runner) is paid once per worker,
// not once per test (#1710). `__run` replaces the run (saved, then resumed as on a reload), so a test starts from the state it loads.
// A test that reloads, resizes, emulates media or adds an init script keeps the `page` of Playwright.
let shared: Promise<Page> | undefined;

export const test = base.extend<{ game: Page }>({
  game: [
    async ({ browser, baseURL }, use) => {
      const boot = async () => {
        const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
        if (process.env.CI) await context.addInitScript(() => localStorage.setItem('ab-alone.tier', 'low')); // as lowTierOnCi (modes.ts)
        const page = await context.newPage();
        await page.goto('./?bot=off');
        await page.waitForFunction(() => typeof (window as any).__run === 'function');
        return page;
      };
      let page = await (shared ??= boot());
      if (page.isClosed()) page = await (shared = boot());
      await use(page);
    },
    { timeout: 120_000 }, // its own time: the boot of the first test's page is not counted in that test's limit (#1710)
  ],
});
export { expect };
