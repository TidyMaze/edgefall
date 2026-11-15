import { expect, test } from '@playwright/test';
import { BOSS_IDS } from '../src/tally';

// Issue #357: Play online, Boss fight and Daily challenge live in one menu behind the Game modes button, collapsed
// by default, built like the settings menu (#277): it closes on Escape, a press outside and the button again.
const ENTRIES = ['Play online', 'Boss fight', /^Daily challenge/];

test('the mode menu is closed at the start, and its button opens and closes it', async ({ page }) => {
  await page.goto('./?bot=off&hub=classic');
  const button = page.getByRole('button', { name: 'Game modes' });
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('title', 'Game modes');
  await expect(button.locator('svg')).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  for (const name of ENTRIES) await expect(page.getByRole('button', { name })).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  for (const name of ENTRIES) await expect(page.getByRole('button', { name })).toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Boss fight' })).toBeHidden();
});

test('the mode menu closes on Escape and on a press outside, and is reachable by keyboard', async ({ page, browserName }) => {
  // On a Mac, Tab skips buttons in Safari unless Option is held (system keyboard navigation setting).
  const tab = process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('./?bot=off&hub=classic');
  const button = page.getByRole('button', { name: 'Game modes' });
  const online = page.getByRole('button', { name: 'Play online' });
  await expect(button).toBeEnabled();

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(online).toBeVisible();
  // A fresh profile lists Open world first (#1612, Decision #1513): the first Tab lands on it, the next on Play online.
  await page.keyboard.press(tab);
  await expect(page.locator('#openworld')).toBeFocused(); // by id: the dock's World button has the same name
  await page.keyboard.press(tab);
  await expect(online).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(online).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await button.click();
  await expect(online).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(online).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('picking a boss closes the mode menu and keeps Retry and Goal in the column', async ({ page }) => {
  await page.goto('./?bot=off&hub=classic');
  const button = page.getByRole('button', { name: 'Game modes' });
  await button.click();
  await page.getByRole('button', { name: 'Boss fight' }).click();
  await page.locator('#boss-list').getByRole('button', { name: 'The Echo' }).click();
  await expect(page.locator('#hud')).toContainText('P1');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Boss fight' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Goal' })).toBeVisible();
});

test('picking Ranked starts a ranked queue with rank badge and updates Elo in Battle royale (#711)', async ({ page }) => {
  // The shared board asks at the first ranked entry (#1287): this spec answers it once, as declined, so the queue starts.
  await page.addInitScript(() => {
    if (!localStorage.getItem('ab-alone.board-consent')) localStorage.setItem('ab-alone.board-consent', JSON.stringify({ v: 5, choice: 'declined' }));
  });
  await page.goto('./?bot=off&net=hook&hub=classic');
  const modes = page.getByRole('button', { name: 'Game modes' });
  await modes.click();
  await page.getByRole('button', { name: 'Battle royale' }).click();
  await modes.click();
  await page.getByRole('button', { name: 'Ranked' }).click();
  await expect(modes).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#hud .rank-badge')).toContainText('Silver1200');

  await page.goto('./?bot=off&net=hook&hub=classic');
  await modes.click();
  await page.getByRole('button', { name: 'Ranked' }).click();
  await expect(modes).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#hud .rank-badge')).toContainText('Silver1200');
  await expect(page.locator('#hud .rank-queue')).toHaveText('Queue ±100');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('the mode button and every item of the open menu are touch targets of at least 44 px', async ({ page }) => {
    await page.goto('./?bot=off&hub=classic');
    await page.getByRole('button', { name: 'Game modes' }).click();
    await page.getByRole('button', { name: 'Boss fight' }).click();
    const small = await page.evaluate(() =>
      [document.getElementById('modes')!, ...document.querySelectorAll('#mode-menu button')]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => el.getBoundingClientRect().width < 44 || el.getBoundingClientRect().height < 44)
        .map((el) => el.textContent || el.getAttribute('aria-label')),
    );
    expect(small).toEqual([]);
  });
});

// #666: on a phone held upright the open boss list holds every boss of the game (BOSS_IDS, 13 bosses, not padded):
// every item stays a 44 px touch target with a label of at least 12
// px, and the last boss, scrolled into view, is on screen and the element under its centre.
for (const viewport of [{ width: 360, height: 780 }, { width: 375, height: 812 }]) {
  test.describe(`on a ${viewport.width} px phone held upright`, () => {
    test.use({ viewport, hasTouch: true });

    test('every boss of the list keeps 44 px touch targets and readable labels, the last one reachable, #666', async ({ page }) => {
      await page.goto('./?bot=off&hub=classic');
      await page.getByRole('button', { name: 'Game modes' }).click();
      await page.getByRole('button', { name: 'Boss fight' }).click();
      const list = page.locator('#boss-list');
      await expect(list.getByRole('button')).toHaveCount(BOSS_IDS.length);
      const found = await page.evaluate(() => {
        const items = [...document.querySelectorAll('#mode-menu button')].filter((el) => el.getClientRects().length > 0);
        const last = document.querySelector('#boss-list')!.lastElementChild!;
        last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const b = last.getBoundingClientRect();
        return {
          small: items.filter((el) => el.getBoundingClientRect().width < 44 || el.getBoundingClientRect().height < 44).map((el) => el.textContent),
          tiny: items.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.textContent),
          lastReachable: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === last,
        };
      });
      expect(found).toEqual({ small: [], tiny: [], lastReachable: true });
    });
  });
}

// Bug #653: on a 1280x720 window the open boss list of 7 bosses scrolled, The Rail Yard and Daily challenge below the
// fold. On a desktop window every boss and Daily challenge show without a scroll. #699: the Boss fight and Fight together
// lists have room for every boss of the game (BOSS_IDS): the list is no longer padded, the 13 real bosses are checked.
for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }]) {
  for (const [name, id] of [['Boss fight', 'boss-list'], ['Boss with a partner', 'coop-list']]) {
    test(`every boss of the ${name} list and Daily challenge fit without a scroll in a ${viewport.width}x${viewport.height} window, bugs #653 #699`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('./?bot=off&hub=classic');
      await page.getByRole('button', { name: 'Game modes' }).click();
      await page.getByRole('button', { name }).click();
      const list = page.locator(`#${id}`);
      await expect(list.getByRole('button').first()).toBeVisible();
      await expect(list.getByRole('button')).toHaveCount(BOSS_IDS.length);
      const outside = await page.evaluate((id) => {
        const column = document.getElementById('mode-menu')!; // the menu sits in the thumb dock's wrap since #1032, not in #online
        const box = column.getBoundingClientRect();
        const inside = (b: DOMRect) =>
          b.left >= Math.max(0, box.left) && b.top >= Math.max(0, box.top) && b.right <= Math.min(innerWidth, box.right) && b.bottom <= Math.min(innerHeight, box.bottom);
        const items = [...document.querySelectorAll(`#${id} button`), document.getElementById('daily')!];
        return {
          scrolls: column.scrollHeight > column.clientHeight,
          outside: items.filter((el) => !inside(el.getBoundingClientRect())).map((el) => el.textContent),
        };
      }, id);
      expect(outside).toEqual({ scrolls: false, outside: [] });
    });
  }
}
