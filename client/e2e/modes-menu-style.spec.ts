import { expect, test, type Page } from '@playwright/test';
import { openModes } from './modes';
import { shot } from './shot';

// Issues #1548, #1563, #1565: the Modes menu and the Auto-play note on a desktop window and on a phone.
const SIZES = [
  { name: '960x540', width: 960, height: 540 },
  { name: '390x844', width: 390, height: 844 },
];

const enterAlien = async (page: Page) => {
  await openModes(page);
  await page.getByRole('button', { name: 'Boss fight' }).click();
  await page.locator('#boss-list button', { hasText: 'The Alien' }).click();
};

for (const size of SIZES) {
  test(`the Auto-play note stays inside the window and off Retry at ${size.name}, bug #1548`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('./?hub=classic'); // with the bot: Auto-play is only shown against it
    await enterAlien(page);
    const note = page.locator('#auto-reason');
    await expect(note).toContainText('Beat The Alien once to unlock Auto-play');
    const box = (await note.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(await note.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    for (const id of ['#boss-retry', '#hint', '#replay', '#new-game', '#modes', '#settings']) {
      const other = await page.locator(id).boundingBox().catch(() => null);
      if (!other) continue;
      const apart = box.x + box.width <= other.x + 0.5 || other.x + other.width <= box.x + 0.5 || box.y + box.height <= other.y + 0.5 || other.y + other.height <= box.y + 0.5;
      expect(apart, `the note overlaps ${id}`).toBe(true);
    }
    await shot(page, { path: testInfo.outputPath(`1548-note-${size.name}.png`) });
  });

  test(`every button of the Modes menu has the menu style and a focus ring at ${size.name}, bug #1563`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('./?bot=off&hub=classic');
    await openModes(page);
    const styles = await page.locator('#mode-menu button:visible').evaluateAll((buttons) =>
      buttons.map((b) => {
        const s = getComputedStyle(b);
        return { id: b.id || b.textContent, bg: s.backgroundColor, font: s.fontFamily, radius: s.borderRadius };
      }),
    );
    expect(styles.length).toBeGreaterThan(5);
    expect(styles.map((s) => s.id)).toContain('leaderboard');
    const reference = styles.find((s) => s.id === 'play-online')!;
    for (const s of styles) {
      expect(s.bg, `${s.id} background`).not.toBe('rgb(239, 239, 239)');
      expect(s.bg, `${s.id} background`).toBe(reference.bg);
      expect(s.radius, `${s.id} radius`).toBe(reference.radius);
    }
    await page.locator('#leaderboard').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await page.locator('#leaderboard').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await shot(page, { path: testInfo.outputPath(`1563-menu-${size.name}.png`) });
  });
}

test('the Modes menu of a 390x844 phone reaches every mode, hints at the scroll and gives Daily a full row, bug #1565', async ({ page }, testInfo) => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('./?bot=off&hub=classic');
    await openModes(page);
    const menu = page.locator('#mode-menu');
    const widths = await page.locator('#mode-menu > button:visible').evaluateAll((bs) => bs.map((b) => [b.id, Math.round(b.getBoundingClientRect().width)] as const));
    const daily = widths.find(([id]) => id === 'daily')![1];
    const play = widths.find(([id]) => id === 'play-online')![1];
    expect(daily, `Daily is as wide as Play online at ${width}`).toBe(play);
    // every mode can be scrolled into view and sits inside the window
    for (const id of ['play-online', 'roguelite', 'trainer', 'openworld']) {
      const button = page.locator(`#${id}`);
      if (!(await button.count()) || !(await button.isVisible())) continue;
      await button.scrollIntoViewIfNeeded();
      const b = (await button.boundingBox())!;
      expect(b.y + b.height, `${id} bottom at ${width}`).toBeLessThanOrEqual(844 + 1);
    }
    // a fade at the bottom edge says there is more below, and it is gone at the end
    await menu.evaluate((el) => (el.scrollTop = 0));
    const overflow = await menu.evaluate((el) => el.scrollHeight > el.clientHeight);
    if (overflow) {
      expect(await menu.evaluate((el) => getComputedStyle(el).maskImage + getComputedStyle(el).backgroundImage), `fade at ${width}`).toContain('gradient');
    }
  }
  await shot(page, { path: testInfo.outputPath('1565-menu-430x844.png') });
});
