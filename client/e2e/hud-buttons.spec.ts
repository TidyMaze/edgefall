import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';
import { openAdvanced } from './settings';

// #839: the HUD buttons look alike. Copy is styled as Reset view, and the button that opens a private game
// shows its name, in a button as tall as the other items of the mode menu.

/** The look of a button: what makes a button this style, not where it sits or how wide its name is. */
const look = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily}`,
      color: s.color,
      background: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      radius: s.borderTopLeftRadius,
      padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
      height: Math.round(el.getBoundingClientRect().height), // to the pixel: 47.99997 and 48 are the same height (a float rounding)
    };
  });

test('Free camera is a settings item, not a HUD button, lit while it is on, #938', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#free-cam')).toHaveCount(0);
  await expect(page.locator('#mode-menu #reset-view')).toHaveCount(1); // Reset view in the Game modes menu, not the dock (#1612: five dock controls fit 320 px)
  await page.locator('#settings').click();
  await openAdvanced(page); // a developer view, under Advanced (#1566)
  const item = page.getByRole('button', { name: 'Free camera' });
  await expect(item).toHaveAttribute('aria-pressed', 'false');
  await item.click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as { __freeCamActive: () => boolean }).__freeCamActive())).toBe(true);
});

test('Play online shows its name and is as tall as Boss with a partner, #839', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await openModes(page);
  const play = page.getByRole('button', { name: 'Play online', exact: true });
  await expect(play).toHaveText('Play online');
  await expect(play.locator('svg')).toHaveCount(0);
  expect(await look(page, 'play-online')).toEqual(await look(page, 'fight-together'));
});

test('Copy looks like Reset view and is as tall as the link beside it, #839', async ({ page }) => {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await startMode(page, 'online');
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  // #1032: Reset view is a thumb dock button (its label is a short word there), so Copy is no longer compared to it.
  const copy = await look(page, 'invite-copy');
  expect(copy.height).toBeCloseTo((await page.locator('#invite').boundingBox())!.height, 0); // the same height to within half a pixel
});
