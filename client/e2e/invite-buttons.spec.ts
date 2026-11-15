import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// Bug #839: the invite link makes the button column taller. In a short landscape window the column scrolls, and it
// stayed scrolled down after the player reached Play online: Settings and Reset view were scrolled out of the column
// and no longer answered a tap. While the invite link shows, every button at the top of the column stays clickable.
test.describe('a phone held sideways', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test('Settings stays clickable once the invite link shows, #839', async ({ page }) => {
    await page.goto('./?bot=off');
    await page.locator('canvas').waitFor();
    await startMode(page, 'online');
    await expect(page.locator('#invite')).toBeVisible();

    // The column check covers Settings (the Modes menu is gone, #1697).
    const covered = await page.evaluate(() =>
      ['settings'].filter((id) => {
        const r = document.getElementById(id)!.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !document.getElementById(id)!.contains(top);
      }),
    );
    expect(covered, 'buttons with something else under their centre').toEqual([]);
  });
});
