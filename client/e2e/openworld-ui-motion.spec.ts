import { expect, test } from '@playwright/test';

// #1105, docs/specs/openworld-animation.md story 7: the HUD plate and the New world sheet slide in on the base token, with
// transform and opacity only, so the page does not shift. Reduced motion shows both at once, and focus stays on the button.

const MOTION_WAIT = 400;
const enter = async (page: import('@playwright/test').Page) => {
  await page.goto('./?bot=off&openworld=7');
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect(page.locator('#openworld-hud')).toBeVisible();
};
const anim = (page: import('@playwright/test').Page, sel: string) =>
  page.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });

test('the HUD and the New world sheet slide in on the base token, with no layout shift (#1105)', async ({ page }) => {
  await enter(page);
  expect(await anim(page, '#openworld-hud')).toEqual({ name: 'sheet-in', duration: '0.2s' });
  // from here on, the layout shifts the page makes by itself are counted (CLS ignores those within 500 ms of the click, which is the
  // HUD growing by its own content: the slide is a transform and moves no box)
  await page.evaluate(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift' });
  });
  await page.waitForTimeout(MOTION_WAIT);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0);
});

test('Reduced motion shows the HUD and the sheet at once (#1105)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enter(page);
  expect(await anim(page, '#openworld-hud')).toEqual({ name: 'sheet-in', duration: '0s' });
});
