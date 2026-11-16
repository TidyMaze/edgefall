import { utimes } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Bug #185: every e2e run starts its dev server with `bun run dev`, which rebuilds the wasm package first and so
// rewrites its files even when nothing changed. A dev server that watches them reloads every page it serves: a
// second run, a dev server or a wasm build in the same checkout reloaded the pages of a run in progress, and a
// click on a page being reloaded failed with "Execution context was destroyed".
const pkg = ['edgefall_wasm.js', 'edgefall_wasm_bg.wasm'].map((file) => new URL(`../../crates/edgefall-wasm/pkg/${file}`, import.meta.url));

test('rewriting the wasm package during a run does not reload the page under test, bug #185', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'the live site has no dev server and no local wasm package');
  await page.goto(new URL('./?bot=off', process.env.E2E_DEV_URL).href);
  await page.locator('canvas').waitFor();
  // A watching dev server reloads the page about a second after the files change: wait past that (2.5 s keeps the test under 5 s, #1710).
  const reloaded = page.waitForEvent('framenavigated', { timeout: 2_500 }).then(
    () => true,
    () => false,
  );
  const now = new Date();
  await Promise.all(pkg.map((file) => utimes(file, now, now))); // what a rebuild does to the files the page loaded
  expect(await reloaded).toBe(false);
});

// Bug #585: the page linked the Google Fonts stylesheet, which holds the load event that page.goto waits for. During
// one of the machine's network outages every page.goto of the run timed out until the network came back. The e2e
// dev server serves a page that loads nothing from another host.
test('the e2e page loads nothing from another host, bug #585', async ({ page }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'the live site is the production build, its fonts come from Google Fonts');
  const remote: string[] = [];
  page.on('request', (request) => {
    const { protocol, hostname } = new URL(request.url());
    if (protocol.startsWith('http') && hostname !== 'localhost') remote.push(request.url()); // data: and blob: are local
  });
  await page.goto(new URL('./?bot=off', process.env.E2E_DEV_URL).href);
  await page.locator('canvas').waitFor();
  expect(remote).toEqual([]);
});
