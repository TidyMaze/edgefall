import type { Page } from '@playwright/test';
import { pauseClock } from './clock';

// The animation clock in the test's hand (#1643). A glide lasts a set time from its keydown, and each frame draws it at the frame's own
// time: on a loaded machine a software-GL frame takes 0.5 to 1.4 s (load 25 to 45, 10 cores), so a frame could land past the whole glide
// and a check that waits for one in between failed every time. With the page's clock paused (Playwright's clock: performance.now,
// requestAnimationFrame and the timers), each `frame` call moves the time on by a set span and draws exactly one frame at that time,
// whatever a frame costs. `paused` resumes the clock at the end, a failure too: the next test of a shared page runs on flowing time.
// The page's clock is installed before its load (shared-world.ts): installed later, performance.now restarted at 0, under the times
// the page had kept (a step due, a fold of the HUD plate), and the tests after it failed.

/** Runs `body` with the page's clock paused; `frame(ms)` moves it on by `ms` and lets the one frame due at that time draw. */
export async function paused(page: Page, body: (frame: (ms: number) => Promise<void>) => Promise<void>): Promise<void> {
  await pauseClock(page); // 1 s ahead of the page's time, which flows on during the call: one frame due on the way fires
  const frame = async (ms: number): Promise<void> => {
    await page.clock.fastForward(ms); // a jump: a due timer or animation frame fires once, not once per 16 ms on the way
    await page.evaluate(() => undefined); // the frame's callback has run
  };
  try {
    await body(frame);
  } finally {
    await page.clock.resume();
  }
}
