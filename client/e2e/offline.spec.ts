import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The offline app (#193) exists only in the production build. Every other spec blocks service workers
// (playwright.config.ts), this one allows them. The offline test opens E2E_PREVIEW_URL: the `vite build` +
// `vite preview` server of playwright.config.ts, or the live site (E2E_BASE_URL).
test.use({ serviceWorkers: 'allow' });

// The spec never reaches Google (bug #649): the stylesheet holds the load event that page.goto waits for, and during a
// network outage of the machine the test timed out in its first step. The two Google Fonts hosts answer from here: a
// stylesheet of the two UI families, both drawn from one font file, the icon font Playwright ships in its trace viewer.
const viewer = new URL('../node_modules/playwright-core/lib/vite/traceViewer/', import.meta.url);
const fontFile = readFileSync(new URL(readdirSync(viewer).find((f) => /^codicon.*\.ttf$/.test(f))!, viewer));
const FONT_URL = 'https://fonts.gstatic.com/e2e/ui.ttf';
const stylesheet = ['Chakra Petch', 'IBM Plex Sans']
  .map((family) => `@font-face { font-family: '${family}'; src: url(${FONT_URL}) format('truetype'); }`)
  .join('\n');
const serveFonts = (context: BrowserContext): Promise<void> =>
  context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => {
    const css = route.request().url().startsWith('https://fonts.googleapis.com/');
    // The service worker fetches them with CORS (sw.ts), the page's font files too.
    return route.fulfill({
      contentType: css ? 'text/css' : 'font/ttf',
      headers: { 'access-control-allow-origin': '*' },
      body: css ? stylesheet : fontFile,
    });
  });

const click = async (page: Page, q: number, r: number): Promise<void> => {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
};

test('after one visit the game loads offline and the bot answers', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs a CDP session (newCDPSession), which only Chromium has');
  await serveFonts(context);
  const url = process.env.E2E_PREVIEW_URL!;
  const withBot = url.includes('?') ? `${url}&bot=on` : `${url}?bot=on`;
  await page.goto(withBot);
  await page.locator('canvas').waitFor();
  const hud = page.locator('#hud');
  await expect(hud).toContainText('White to move');

  // The service worker precaches the build at install, then takes control of the page.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const root = new URL(page.url()).pathname;
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith('edgefall-'));
    const requests = await (await caches.open(names[0]!)).keys();
    return { names, paths: requests.map((r) => new URL(r.url).pathname), hosts: requests.map((r) => new URL(r.url).host) };
  });
  expect(cached.names).toHaveLength(1);
  const assets = [
    'backdrop.ktx2',
    'deck-albedo.ktx2',
    'deck-roughness.ktx2',
    'shell-normal.ktx2',
  ].map((t) => `${root}assets/${t}`);
  expect(cached.paths).toEqual(expect.arrayContaining([root, `${root}manifest.webmanifest`, ...assets]));
  // KTX2Loader's transcoder too, to read the textures offline (#700).
  const transcoder = [/assets\/basis_transcoder-[\w-]+\.js$/, /assets\/basis_transcoder-[\w-]+\.wasm$/];
  for (const built of [/assets\/index-[\w-]+\.js$/, /assets\/bot\.worker-[\w-]+\.js$/, /assets\/edgefall_wasm_bg-[\w-]+\.wasm$/, ...transcoder]) {
    expect(cached.paths.some((p) => built.test(p))).toBe(true);
  }
  // The UI fonts (#221): the Google Fonts stylesheet and its font files are in the same cache after this one visit.
  expect(cached.hosts).toEqual(expect.arrayContaining(['fonts.googleapis.com', 'fonts.gstatic.com']));

  // The browser's HTTP cache keeps the Google Fonts stylesheet one day at most: empty it, so that offline only the
  // service worker can answer, as on a visit a few days later.
  await (await context.newCDPSession(page)).send('Network.clearBrowserCache');
  await context.unrouteAll(); // offline, the fonts come from the service worker alone
  await context.setOffline(true);
  await page.reload();
  await page.locator('canvas').waitFor();
  await expect(hud).toContainText('White to move');
  // The HUD and the buttons keep their fonts. check() alone is also true for a font the page has no face of (the
  // stylesheet failed): each family needs a loaded face too.
  const fonts = () =>
    page.evaluate(() =>
      ['Chakra Petch', 'IBM Plex Sans'].map(
        (family) => document.fonts.check(`1rem "${family}"`) && [...document.fonts].some((f) => f.family === family && f.status === 'loaded'),
      ),
    );
  await expect.poll(fonts).toEqual([true, true]);
  // The cached page loads so fast that a click can come before the first frame, and such a click is lost (bug #237).
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await click(page, 0, 2); // a Black marble
  await click(page, 0, 1); // its NW neighbour, empty at the start
  // The bot worker and its wasm come from the cache too: it answers and the turn comes back.
  await expect.poll(() => page.evaluate(() => (window as any).__plies()), { timeout: 30_000 }).toBe(2);
  await expect(hud).toContainText('White to move');
  await context.setOffline(false);
});

test('the dev server registers no service worker', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'the live site is the production build');
  await page.goto(new URL('./?bot=off', process.env.E2E_DEV_URL).href);
  await page.locator('canvas').waitFor();
  await expect(page.locator('#play-online')).toBeEnabled(); // main.ts ran to its end
  const registered = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => 'registered'),
      new Promise((resolve) => setTimeout(() => resolve('none'), 3_000)),
    ]),
  );
  expect(registered).toBe('none');
});

test('a new build reloads the idle page once, never twice (#1437)', async ({ page, context }) => {
  await serveFonts(context);
  await page.goto(process.env.E2E_PREVIEW_URL!);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload(); // now the page started under a controller: a takeover is an update
  await page.locator('canvas').waitFor();
  const takeover = () => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  const marker = () => page.evaluate(() => (window as any).__marker as string | undefined);

  // Nothing at stake: the page reloads at once (a fresh window has no marker).
  await page.evaluate(() => ((window as any).__marker = 'old'));
  await Promise.all([page.waitForEvent('load'), takeover().catch(() => undefined)]); // the reload may cut the evaluate short
  await page.locator('canvas').waitFor();
  expect(await marker()).toBeUndefined();

  // One reload per build: the second takeover of the same build keeps the page, the button stays.
  await page.evaluate(() => ((window as any).__marker = 'old'));
  await takeover();
  await expect(page.locator('#update')).toHaveJSProperty('hidden', false); // the first row of Settings, its dot on the cog (#1693)
  // The handler decides at once, in the event (main.ts reloadWhenFree, location.reload is synchronous): a reload would have begun; 300 ms lets it unload (#1710).
  await page.waitForTimeout(300);
  expect(await marker()).toBe('old');
});
