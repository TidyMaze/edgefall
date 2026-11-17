import { expect, test, type Page } from '@playwright/test';
import { lowTierOnCi } from './modes';
import { test as shared } from './shared-world';

lowTierOnCi();

// #1661: Flee from a wild fight reopened the world as a new one. The world is read again from IndexedDB when the fight ends: a record with one
// unreadable field was deleted whole, and a database connection a newer page closed failed every later read. The record a world saved is made
// so here (a progress of broken cells and discovered cells, then one field spoiled, or the connection closed) while a wild fight runs, then Flee:
// the hero is on its cell, and the discovered and broken cells are kept. Seed 3 has a marble beside the spawn (openworld-wild.spec.ts).
type Hooks = { __openworldFixture: (f: object) => void; __openworldEnemies: () => [number, number][] };
const data = (page: Page, key: string) => page.evaluate((k) => document.body.dataset[k], key);
const DB = 'ab-alone';
const KEY = 'openworld:3';

/** The record of the world in IndexedDB, read by the page itself. */
const read = (page: Page) =>
  page.evaluate(
    (key) =>
      new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const open = indexedDB.open('ab-alone');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('game').objectStore('game').get(key);
          get.onsuccess = () => (open.result.close(), resolve(get.result));
        };
      }),
    KEY,
  );
/** Replaces fields of that record. */
const patch = (page: Page, fields: object) =>
  page.evaluate(
    ([key, changes]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ab-alone');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('game', 'readwrite');
          const get = tx.objectStore('game').get(key as string);
          get.onsuccess = () => tx.objectStore('game').put({ ...get.result, ...(changes as object) }, key as string);
          tx.oncomplete = () => (open.result.close(), resolve());
        };
      }),
    [KEY, fields] as const,
  );
/** A newer page upgrading the database: the page's own connection gets `versionchange`. */
const upgrade = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ab-alone', 2);
        open.onsuccess = () => (open.result.close(), resolve());
        open.onerror = () => reject(open.error);
      }),
  );
const bits = (text: string) => [...atob(text)].reduce((n, c) => n + c.charCodeAt(0).toString(2).replace(/0/g, '').length, 0);

/** A world with progress, in a wild fight: the hero stands beside a marble, the record holds a long walk's cells. */
async function fighting(page: Page, booted = false): Promise<{ at: string; cells: number }> {
  if (!booted) {
    await page.goto('./?openworld=3&nodes=200');
    await page.locator('canvas[aria-label="Edgefall board"]').waitFor();
    await expect.poll(() => data(page, 'openworldAt')).toBe('0,0');
  }
  const [[q, r]] = await page.evaluate(() => (window as unknown as Hooks).__openworldEnemies());
  const at: [number, number] = [q! + 1, r!];
  await page.evaluate((h) => (window as unknown as Hooks).__openworldFixture({ hero: h, troop: [] }), at);
  await page.locator('#openworld-ask-fight').click(); // the wild marble asks first (#1662)
  await expect(page.getByRole('button', { name: 'Flee' })).toBeVisible();
  await expect.poll(async () => (await read(page))?.hero).toEqual(at); // the world is saved as the fight starts
  const record = (await read(page))!;
  const chunks = record.discovered as [number, number, string][];
  const walked = [...chunks, ...chunks.map(([cx, cy, text]): [number, number, string] => [cx + 40, cy + 40, text])];
  await patch(page, { discovered: walked, broken: [[40, 40], [41, 41]] });
  return { at: at.join(','), cells: walked.reduce((n, [, , text]) => n + bits(text), 0) };
}

async function fled(page: Page, world: { at: string; cells: number }): Promise<void> {
  await page.getByRole('button', { name: 'Flee' }).click();
  await expect.poll(() => data(page, 'openworldAt')).toBe(world.at);
  expect(await data(page, 'openworldDiscovered')).toBe(String(world.cells));
  expect(await data(page, 'openworldBroken')).toBe('2');
}

// On the worker's shared page of seed 3 (shared-world.ts), fresh for the test: no page load (#1710). The next test upgrades the database,
// so it keeps a page of its own.
shared.describe('the shared world of seed 3', () => {
  shared.use({ worldUrl: './?bot=off&openworld=3' });
  shared('a world whose saved time is unreadable keeps its hero cell, discovered cells and broken cells through Flee, #1661', async ({ world: page }) => {
    const world = await fighting(page, true);
    await patch(page, { time: 1e12 });
    await fled(page, world);
    expect(await read(page)).toBeDefined();
  });
});

test('a database connection a newer page closed does not reset the world on Flee, #1661', async ({ page }) => {
  const world = await fighting(page);
  await upgrade(page);
  await fled(page, world);
});
