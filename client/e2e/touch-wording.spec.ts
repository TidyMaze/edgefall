import { expect, test, type Page } from '@playwright/test';
import { openControls } from './modes';

// #1379: on a phone no visible text, tooltip or label names a keyboard key.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const KEY = /\b(arrows?|WASD|Esc|Escape|Enter|Space|Spacebar|Tab|Shift|Ctrl|keyboard|click|[QERC] to|Q E|Left\)|Right\)|\(Esc\))\b|\(Esc\)/i;

/** The text a player can see or hover: the own text, title and aria-label of every element that takes room on screen. */
async function seen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || box.width === 0 || box.height === 0 || el.closest('[hidden]') || el.closest('.sr-only')) continue;
      if (el.classList.contains('sr-only')) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent!.trim()).join(' ');
      out.push(own, el.title, el.getAttribute('aria-label') ?? '');
    }
    return out.filter((t) => t !== '');
  });
}

const expectNoKey = async (page: Page): Promise<void> => {
  const bad = (await seen(page)).filter((t) => KEY.test(t));
  expect(bad).toEqual([]);
};

test('the board, the settings and the guide name no key', async ({ page }) => {
  await page.goto('./?bot=off&guide');
  await expect(page.locator('#guide')).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await expectNoKey(page);
    await page.getByRole('button', { name: 'Next', exact: true }).tap();
  }
  await expectNoKey(page);
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(page.locator('#settings')).toBeEnabled();
  await expectNoKey(page);
  await page.locator('#settings').tap();
  await expect(page.locator('#settings-menu')).toBeVisible();
  await expectNoKey(page);
});

test('the Open world plate and the replay buttons name no key', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7');
  await expect(page.locator('body')).toHaveAttribute('data-openworld', '7');
  await openControls(page); // the hints are behind the summary (#1530)
  await expect(page.locator('#openworld-hud .tap-hint')).toBeVisible();
  await expectNoKey(page);
  for (const id of ['replay-prev', 'replay-next', 'replay-live']) {
    expect(await page.locator(`#${id}`).evaluate((b) => `${b.title} ${b.getAttribute('aria-label') ?? ''}`)).not.toMatch(KEY);
  }
});
