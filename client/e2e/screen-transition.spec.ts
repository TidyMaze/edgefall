import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// #1099, docs/specs/motion.md story 9: the canvas cross-fades on the base token when the Open world is entered or left. Opacity only,
// so the game is live while it runs. Reduced motion cuts it. The page and CSS are read in the browser; the entry logic has unit tests.

async function ready(page: Page, reduced = false): Promise<void> {
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect(page.locator('#hud')).toContainText('to move');
}

const canvasCue = (page: Page, openworld: boolean) =>
  page.evaluate((on) => {
    if (on) document.body.dataset.openworld = 'test';
    else delete document.body.dataset.openworld;
    const s = getComputedStyle(document.querySelector('canvas')!);
    return { name: s.animationName, duration: s.animationDuration };
  }, openworld);

test('the canvas fades in on the base token on entering and leaving the Open world (#1099)', async ({ page }) => {
  await ready(page);
  expect(await canvasCue(page, true)).toEqual({ name: 'screen-in-world', duration: '0.2s' });
  expect(await canvasCue(page, false)).toEqual({ name: 'screen-in', duration: '0.2s' });
});

test('the fade never blocks input: the canvas keeps its pointer events (#1099)', async ({ page }) => {
  await ready(page);
  expect(await page.locator('canvas:not(#openworld-minimap)').evaluate((c) => getComputedStyle(c).pointerEvents)).not.toBe('none');
});

test('Reduced motion cuts the fade to a hard cut (#1099)', async ({ page }) => {
  await ready(page, true);
  expect((await canvasCue(page, true)).duration).toBe('0s');
});

test('the fade really plays when the Open world is entered by its button (#1099)', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await page.evaluate(() => {
    (window as any).__started = [];
    document.addEventListener('animationstart', (e) => (window as any).__started.push((e as AnimationEvent).animationName), true);
  });
  await startMode(page, 'world');
  await expect(page.locator('#openworld-hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__started)).toContain('screen-in-world');
});

// #1562, motion.md story 11: the new screen is live and a dim over it lifts in about 120 ms. Read on the frames: opaque at the first, gone by the 120 ms.
test('the screen exit is a dim that starts opaque and lifts in about 120 ms, the new screen live under it (#1562)', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  const frames = await page.evaluate(
    () =>
      new Promise<{ t: number; o: number; live: boolean }[]>((done) => {
        const out: { t: number; o: number; live: boolean }[] = [];
        document.getElementById('ship')!.click();
        const t0 = performance.now();
        const tick = (): void => {
          const layer = document.getElementById('screen-exit');
          const o = layer ? Number(getComputedStyle(layer).opacity) : 0;
          out.push({ t: performance.now() - t0, o, live: document.body.dataset.hub !== undefined });
          if (performance.now() - t0 < 300) requestAnimationFrame(tick);
          else done(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(frames[0]!.live).toBe(true); // the Hub took the page in the click, before any fade
  const first = frames.find((f) => f.o > 0)!;
  expect(first.o).toBeGreaterThan(0.5); // starts nearly opaque
  const sorted = frames.filter((f) => f.t >= first.t);
  expect(sorted.at(-1)!.o).toBe(0); // clear at the end
  const last = sorted.filter((f) => f.o > 0).at(-1)!;
  expect(last.t - first.t).toBeLessThan(220); // about 120 ms, with room for a slow frame on CI
});

test('the screen exit is cut under reduced motion (#1562)', async ({ page }) => {
  await ready(page, true);
  await page.evaluate(() => document.getElementById('ship')!.click());
  await page.waitForTimeout(100);
  expect(await page.locator('#screen-exit[data-flip]').count()).toBe(0);
});
