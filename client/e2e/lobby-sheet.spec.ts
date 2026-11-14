import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// #1044, docs/specs/thumb-dock.md section 1: the lobby controls of a battle royale (Hold in the dock, Start, Invite, Back to
// the ship and the invite link in a sheet above the dock). The sheet is closed until Lobby opens it, it opens by itself
// while a lobby waits, Esc gives the focus back, and its targets are 44 px.

type Box = { left: number; top: number; right: number; bottom: number };

const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).boundingBox();
  return { left: b!.x, top: b!.y, right: b!.x + b!.width, bottom: b!.y + b!.height };
};

const viewports = [
  { name: 'a phone 360 by 780', viewport: { width: 360, height: 780 } },
  { name: 'a phone 390 by 844', viewport: { width: 390, height: 844 } },
  { name: 'a phone 844 by 390 held sideways', viewport: { width: 844, height: 390 } },
];

for (const { name, viewport } of viewports) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test('the lobby sheet stays closed until Lobby opens it above the dock, Esc gives the focus back, bug #1044', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await startMode(page, 'royale');
      await expect(page.getByRole('button', { name: 'Hold' })).toBeVisible(); // Hold stays in the dock
      await expect(page.locator('#lobby-sheet')).toBeHidden();

      await page.getByRole('button', { name: 'Lobby' }).click();
      const sheet = page.locator('#lobby-sheet');
      await expect(sheet).toBeVisible();
      await expect(page.getByRole('button', { name: 'Invite' })).toBeVisible();
      const dock = await box(page, '#dock');
      const open = await box(page, '#lobby-sheet');
      if (viewport.width > viewport.height) {
        // Held sideways the dock is a column on the right, and its sheets lie to its left (thumb-dock.md section 2).
        expect(open.right, 'the sheet sits left of the dock column').toBeLessThanOrEqual(dock.left - 8 + 0.5);
      } else {
        expect(open.bottom, 'the sheet sits above the dock').toBeLessThanOrEqual(dock.top - 8 + 0.5);
      }
      expect(open.bottom - open.top, 'the sheet is at most 60 % of the window').toBeLessThanOrEqual(viewport.height * 0.6);
      for (const target of ['#royale-invite', '#lobby']) {
        const b = await box(page, target);
        expect(b.right - b.left, `${target} width`).toBeGreaterThanOrEqual(44);
        expect(b.bottom - b.top, `${target} height`).toBeGreaterThanOrEqual(44);
      }

      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(page.getByRole('button', { name: 'Lobby' })).toBeFocused();
    });

    test('a waiting online room: the dock with Lobby fits the window and no label is clipped, bug #1044', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await startMode(page, 'online');
      await expect(page.getByRole('button', { name: 'Lobby' })).toBeVisible();
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#dock > button')]
          .filter((el) => el.getClientRects().length > 0 && el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent),
      );
      expect(clipped, 'dock labels clipped').toEqual([]);
      const dock = await box(page, '#dock');
      expect(dock.left).toBeGreaterThanOrEqual(0);
      expect(dock.right).toBeLessThanOrEqual(viewport.width);
      expect(dock.bottom).toBeLessThanOrEqual(viewport.height);
    });

    test('a lobby waiting for players marks Lobby, the sheet stays shut until tapped, and the presence line keeps the status, bug #1044', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await startMode(page, 'royale');
      await page.getByRole('button', { name: 'Lobby' }).click();
      await page.getByRole('button', { name: 'Invite' }).click(); // the offline game becomes a room
      await page.keyboard.press('Escape'); // the player closes the sheet: the board is clear
      await expect(page.locator('#lobby-sheet')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Lobby' })).toHaveAttribute('data-waiting', 'true');
      await expect(page.locator('#hud .presence')).toContainText('1 player in. Start: bots take the empty seats');
      await page.getByRole('button', { name: 'Lobby' }).click();
      await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
      await expect(page.locator('#invite')).toBeVisible();
    });
  });
}
