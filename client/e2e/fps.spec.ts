import { expect, test } from '@playwright/test';
import { openAdvanced } from './settings';

// The FPS readout (#426): off by default, switched on in the settings menu, kept across a reload, its last value in
// Copy diagnostics.
test('the FPS readout is off by default, shows a rate once switched on, and survives a reload', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium grants the clipboard-read and clipboard-write permissions the test needs');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const readout = page.locator('#fps');
  await expect(readout).toBeHidden();

  await page.getByRole('button', { name: 'Settings' }).click();
  await openAdvanced(page); // a developer tool (#1566)
  const fps = page.getByRole('button', { name: 'FPS' });
  await expect(fps).toHaveAttribute('aria-pressed', 'false');
  await fps.click();
  await expect(fps).toHaveAttribute('aria-pressed', 'true');
  await expect(readout).toBeVisible();
  await expect.poll(async () => parseInt((await readout.textContent()) ?? '0', 10), { timeout: 8000 }).toBeGreaterThan(0);

  await page.reload();
  await page.locator('canvas').waitFor();
  await expect(readout).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click(); // the clipboard is the last row of the settings list (#1032)
  await openAdvanced(page);
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  const diagnostics = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(diagnostics.environment.fps).toBeGreaterThan(0);
  expect(diagnostics.renderCost).toMatch(/^draw calls: \d+\ntriangles: \d+\ngeometries: \d+\ntextures: \d+\npoint lights: \d+\ntier: \w+\npixel ratio: [\d.]+$/);
  expect(await page.evaluate(() => (window as any).__renderCost.calls)).toBeGreaterThan(0);
});

// Local, on a GPU only (owner's decision, #1436): the 60 ms frame limit of #777 cannot hold on the CI runner, which draws in software
// (one frame took 850 ms in run 41485265392). The limit stays 60 ms; the test does not run on CI.
test('marble selection preserves framerate and causes no frame time spikes, bug #777', async ({ page }) => {
  test.skip(!!process.env.CI, 'needs a GPU: the CI runner draws in software (#777, #1436)');
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(500);

  const maxFrameDelta = await page.evaluate(async () => {
    let maxDelta = 0;
    let last = performance.now();
    let tracking = true;
    const measure = (now: number) => {
      if (!tracking) return;
      const delta = now - last;
      if (delta > maxDelta) maxDelta = delta;
      last = now;
      requestAnimationFrame(measure);
    };
    requestAnimationFrame(measure);

    // Warm up 3 frames
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Select marble (0, 4)
    (window as any).__roll(0, 4);

    // Track 10 frames post-click
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    tracking = false;
    return maxDelta;
  });

  console.log('Max frame delta during selection:', maxFrameDelta.toFixed(1), 'ms');
  expect(maxFrameDelta).toBeLessThan(60);
});
