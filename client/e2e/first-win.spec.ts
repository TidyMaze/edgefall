import { expect, test } from '@playwright/test';
import { BLACK_WINS } from './end-games';
import { openModes } from './modes';

// #1665: a new player first plays the normal game against the bot; the other modes wait for the first win. `?newplayer` gives an automated page a
// new player's menu (every other spec stays open). The win comes from an imported finished game; the unit tests hold the rest (main.unlock.test.ts).

test('a new player sees the locked menu, wins once and gets the unlock card, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '0');
  await openModes(page);
  const roguelite = page.locator('#roguelite');
  await expect(roguelite).toHaveAttribute('aria-disabled', 'true');
  await expect(roguelite).toHaveAttribute('data-locked', 'Win your first game to unlock');
  await expect(page.locator('#play-online')).not.toHaveAttribute('aria-disabled', 'true');
  await roguelite.click({ force: true });
  await expect(page.locator('body')).not.toHaveAttribute('data-hub', /./);

  await page.locator('#import-file').setInputFiles({
    name: 'game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS })),
  });
  const card = page.locator('#unlock');
  await expect(card).toBeVisible();
  await expect(card).toContainText('You won.');
  await expect(card).toContainText('Unlocked: Open world, Bosses, Runs, Daily, Royale, Ranked, Leaderboard');
  await expect(page.locator('body')).toHaveAttribute('data-unlocked', '1');
  await expect(roguelite).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('#unlock-dismiss').click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.firstwin'))).toBe('1');
});

// #1665 UX: every locked row is at least 44 px tall (a touch target), its line is 12 px in the readable text colour, the Daily row keeps one line
// for its name, and the banner and the note frame the list.
for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1000, height: 700 }]] as const) {
  test(`the locked menu rows are 44 px tall, readable and on one line, ${label}, #1665`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./?newplayer&hub=classic');
    await page.locator('canvas').waitFor();
    await openModes(page);
    await expect(page.locator('#lock-banner')).toHaveText('Win your first game vs the bot');
    await expect(page.locator('#lock-note')).toHaveText('More unlocks after your first win');
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished))); // the sheet slides in: measure it at rest
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#mode-menu > [data-locked]')]
        .filter((el) => el.offsetParent)
        .map((el) => {
          const line = getComputedStyle(el, '::after');
          const name = document.createRange();
          name.selectNodeContents([...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!); // the row's own name, not a status inside it
          return { id: el.id, height: el.getBoundingClientRect().height, content: el.scrollHeight, size: parseFloat(line.fontSize), lines: name.getClientRects().length };
        }),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.height, row.id).toBeGreaterThanOrEqual(44);
      expect(row.content, `${row.id}: its text fits the row, nothing spills out`).toBeLessThanOrEqual(row.height);
      expect(row.size, row.id).toBeGreaterThanOrEqual(11);
      expect(row.size, row.id).toBeLessThanOrEqual(12);
    }
    const daily = rows.find((row) => row.id === 'daily')!;
    expect(daily.lines, 'the Daily name is on one line').toBe(1);
    const single = rows.find((row) => row.id === 'roguelite')!;
    expect(daily.height, 'the Daily row is as tall as a one-line row').toBe(single.height);
    const note = await page.evaluate(() => {
      const box = document.getElementById('lock-note')!.getBoundingClientRect();
      const banner = document.getElementById('lock-banner')!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, bannerBottom: banner.bottom, height: innerHeight };
    });
    expect(note.top, 'the note is under the banner').toBeGreaterThanOrEqual(note.bannerBottom);
    expect(note.top - note.bannerBottom, 'right under it').toBeLessThan(12);
    expect(note.bottom, 'in view without a scroll').toBeLessThanOrEqual(note.height);
  });
}

test('Tab reaches a locked row and Enter opens nothing, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await openModes(page);
  await page.locator('#daily').focus();
  await expect(page.locator('#daily')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#roguelite')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).not.toHaveAttribute('data-run', /./);
  await expect(page.locator('#roguelite')).toHaveAttribute('aria-disabled', 'true');
});

test('the locked Hub names the first win and shows no amber door, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => (window as unknown as { __enterMode: (m: string) => void }).__enterMode('hub'));
  await expect(page.locator('#hub-rail .goal')).toHaveText('Next goal: Win your first game vs the bot');
  await expect(page.locator('#hub-labels [data-goal]')).toHaveCount(0);
});

test('the card has Open world as its filled button and lists the Leaderboard, #1665', async ({ page }) => {
  await page.goto('./?newplayer&hub=classic');
  await page.locator('canvas').waitFor();
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS })) });
  await expect(page.locator('#unlock')).toBeVisible();
  const fills = await page.evaluate(() => ['unlock-world', 'unlock-dismiss'].map((id) => getComputedStyle(document.getElementById(id)!).backgroundColor));
  expect(fills[0]).not.toBe(fills[1]);
  await expect(page.locator('#unlock')).toContainText('Leaderboard');
});
