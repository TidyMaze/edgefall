import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// Browser Back and the Android Back gesture (#1564, docs/specs/ui.md section "Browser Back"): entering a mode pushes one history
// entry, Back returns to the Hub, and Back from the Hub returns to the table. The page never goes to about:blank.

const body = (page: Page) => page.locator('body');
const pick = (page: Page, mode: string): Promise<void> => startMode(page, mode); // no menu (#1697): the mode starts through the hook

const MODES: [string, (page: Page) => Promise<void>, (page: Page) => Promise<void>][] = [
  ['Battle royale', (p) => pick(p, 'royale'), (p) => expect(p.locator('#royale-hold')).toBeVisible()],
  ['Rogue-lite run', (p) => pick(p, 'run'), (p) => expect(p.locator('#run-map')).toBeVisible()],
  ['Daily challenge', (p) => pick(p, 'daily'), (p) => expect(body(p)).toHaveAttribute('data-boss', /.+/)],
  ['Trainer', (p) => pick(p, 'trainer'), (p) => expect(body(p)).toHaveAttribute('data-trainer', /.+/)],
  [
    'Boss fight',
    (p) => pick(p, 'echo'),
    (p) => expect(body(p)).toHaveAttribute('data-boss', /.+/),
  ],
  ['Open world', (p) => pick(p, 'world'), (p) => expect(body(p)).toHaveAttribute('data-openworld', /.+/)],
];

for (const [name, enter, shown] of MODES) {
  test(`Back from ${name} returns to the Hub, then to the table, #1564`, async ({ page }) => {
    await page.goto('./?bot=off&net=hook');
    await expect(page.locator('#hud')).toContainText('Black to move');
    await enter(page);
    await shown(page);
    await page.goBack();
    expect(page.url()).toContain('bot=off');
    await expect(page.locator('#hud')).toContainText('Hub');
    await expect(body(page)).toHaveAttribute('data-hub', /.+/);
    await page.goBack();
    expect(page.url()).toContain('bot=off');
    await expect(page.locator('#hud')).toContainText('Black to move');
    await expect(body(page)).not.toHaveAttribute('data-hub', /.*/);
  });
}

test('Back from the Hub returns to the table, and a Back on the table leaves the page, #1564', async ({ page }) => {
  await page.goto('./?bot=off&net=hook');
  await expect(page.locator('#hud')).toContainText('Black to move');
  await pick(page, 'hub');
  await expect(page.locator('#hud')).toContainText('Hub');
  await page.goBack();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await page.goBack(); // the page started here: the browser's own Back
  await expect.poll(() => page.url()).not.toContain('bot=off'); // the URL changes after goBack resolves: wait for it, as the next test does
});

test('a mode left by its own button leaves no entry to press twice, #1564', async ({ page }) => {
  await page.goto('./?bot=off&net=hook');
  await expect(page.locator('#hud')).toContainText('Black to move');
  await pick(page, 'hub');
  await pick(page, 'arena'); // the House table's bay: the Hub has no New game any more (#1697)
  await expect(page.locator('#hud')).toContainText('Black to move');
  await page.goBack(); // one press: the page pops the stale entry and goes on back at once
  await expect.poll(() => page.url()).not.toContain('bot=off');
});

test('Back from the Hub keeps the table game that was saved: its moves stay on the board and in the store, #1564', async ({ page }) => {
  await page.goto('./?bot=off&net=hook');
  await expect(page.locator('#hud')).toContainText('Black to move');
  const click = (q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__click(cq, cr), [q, r]);
  const plies = () => page.evaluate(() => (window as any).__plies() as number);
  await click(0, 2);
  await click(0, 1); // Black
  await expect.poll(plies).toBe(1);
  await click(0, -2);
  await click(0, -1); // White
  await expect.poll(plies).toBe(2);
  const saved = () =>
    page.evaluate(
      () =>
        new Promise<number>((done) => {
          const req = indexedDB.open('ab-alone');
          req.onsuccess = () => {
            const get = req.result.transaction('game').objectStore('game').get('local');
            get.onsuccess = () => done(get.result?.moves.length ?? 0);
          };
        }),
    );
  await expect.poll(saved).toBe(2);
  await pick(page, 'hub');
  await expect(page.locator('#hud')).toContainText('Hub');
  await page.goBack();
  await expect(page.locator('#hud')).toContainText('Black to move');
  expect(await plies()).toBe(2);
  expect(await saved()).toBe(2);
});
