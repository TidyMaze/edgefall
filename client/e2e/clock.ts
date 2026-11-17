import type { Page } from '@playwright/test';

/** Pauses the page clock (page.clock) a second ahead: from now on it moves only when stepClock runs it (#891). */
/** Pauses the page's clock 1 s ahead of its time. On a loaded runner more than 1 s can pass between reading the time and pausing, and
 * Playwright refuses a pause in the past ("Cannot fast-forward to the past"): it reads the time again and tries again (openworld.spec, #1710). */
export async function pauseClock(page: Page): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      return await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    } catch (error) {
      if (tries >= 5 || !String(error).includes('to the past')) throw error;
    }
  }
}

/** Jumps the paused page clock `ms` forward, in jumps of 110 to 300 ms with a draw after each. Under automation the page
 * draws at most every 100 ms (drawDue, src/quality.ts): a shorter jump gets no draw and the wait for it never ends. */
export async function stepClock(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 300) {
    const asked = await page.evaluate(() => (window as any).__drawNext() as number);
    await page.clock.fastForward(Math.max(110, Math.min(left, 300)));
    await page.waitForFunction((n) => (window as any).__draws() > n, asked);
  }
}
