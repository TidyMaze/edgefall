import { expect, test, type Page } from '@playwright/test';

// #1097 and #1098, docs/specs/motion.md stories 7 and 8: a refused move shakes the turn line and says so, a shown Hint draws in on the
// base token, a copied result draws a check mark on the fast token. Reduced motion keeps the text and cuts the motion.
// The unit tests cover the logic (main.moves, main.boss); here the shipped page and CSS are read in the browser.

async function ready(page: Page, reduced = false): Promise<void> {
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off&net=hook');
  await settled(page);
}

async function settled(page: Page): Promise<void> {
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null)))); // the camera is set after a frame
}

async function click(page: Page, q: number, r: number): Promise<void> {
  const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
  await page.mouse.click(p.x, p.y);
}

/** Selects a marble of the side to move, then clicks the empty centre, which is no target of it. */
async function refuse(page: Page): Promise<void> {
  const legal = await page.evaluate(() => (window as any).__legal());
  const [q, r] = legal.find((m: { cells: number[][] }) => m.cells.length === 1).cells[0];
  await click(page, q, r);
  await click(page, 0, 0);
}

/** The cue lasts 120 ms, so its style is recorded the moment `body.refused` is set, then read back. */
const watchTurn = (page: Page) =>
  page.evaluate(() => {
    new MutationObserver(() => {
      if (!document.body.classList.contains('refused')) return;
      const s = getComputedStyle(document.querySelector('#hud .turn')!);
      (window as any).__turnCue = { name: s.animationName, duration: s.animationDuration };
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
const turnAnimation = (page: Page) => page.evaluate(() => (window as any).__turnCue);

// The three tests with the normal motion share one page (the Reduced motion ones emulate the media before the load): its boot, a second or two of
// shader compiling on software WebGL and 2.5 times that on the CI runner, is paid once in the hook, not by the test that runs first (#1710).
let shared: Page;
test.beforeAll(async ({ browser, baseURL }) => {
  shared = await (await browser.newContext({ baseURL })).newPage();
  await shared.goto('./?bot=off&net=hook');
  await settled(shared);
});
test.afterAll(() => shared.context().close());

test('a refused move shakes the turn line on the fast token and says so (#1097)', async () => {
  const page = shared;
  await watchTurn(page);
  await refuse(page);
  await expect(page.locator('#hud')).toContainText('not a legal move');
  expect(await turnAnimation(page)).toEqual({ name: 'refuse', duration: '0.12s' });
});

test('Reduced motion keeps the refusal text and cuts the shake (#1097)', async ({ page }) => {
  await ready(page, true);
  await watchTurn(page);
  await refuse(page);
  await expect(page.locator('#hud')).toContainText('not a legal move');
  expect((await turnAnimation(page)).duration).toBe('0s');
});

test('a shown Hint draws its button in on the base token (#1097)', async () => {
  const page = shared;
  await page.locator('#hint').click();
  await expect(page.locator('body')).toHaveAttribute('data-hint', 'shown');
  const s = await page.locator('#hint').evaluate((b) => ({ name: getComputedStyle(b).animationName, duration: getComputedStyle(b).animationDuration }));
  expect(s).toEqual({ name: 'hint-in', duration: '0.2s' });
});

const copyCheck = (page: Page) =>
  page.evaluate(() => {
    const b = document.getElementById('daily-copy')!;
    b.classList.add('copied');
    const s = getComputedStyle(b, '::before');
    return { content: s.content, name: s.animationName, duration: s.animationDuration };
  });

test('a copied result draws a check mark on the fast token (#1098)', async () => {
  expect(await copyCheck(shared)).toEqual({ content: '"✓"', name: 'check-in', duration: '0.12s' });
});

test('Reduced motion shows the check mark whole (#1098)', async ({ page }) => {
  await ready(page, true);
  expect(await copyCheck(page)).toEqual({ content: '"✓"', name: 'check-in', duration: '0s' });
});
