import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseRecorded } from '../src/test/chaplain-game';
import { BOSS_ENDS } from '../src/bossends';
import { CLAMP_OPEN, EPILOGUE } from '../src/epilogue';
import { startMode, startBoss } from './modes';
import { shot } from './shot';

// #1546, #1588: each boss has its own victory line, and the win that reaches stage 7 plays a short epilogue once. There is no recorded win of The
// Ballast Mind, so the story is loaded at the end state through its save: the moments 2, 3, 5, 6 and 7 are held, and the recorded win of The Hull
// (fight seed 0) is the one that completes the run to stage 7, as it does for a player who beat the Ballast Mind first (story.ts).
const hullPlies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/hull.txt', import.meta.url), 'utf8'));
const swarmPlies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/swarm.txt', import.meta.url), 'utf8'));
const line = (boss: string, kind: 'win' | 'loss'): string => BOSS_ENDS.find((e) => e.boss === boss && e.kind === kind && e.stage === 1)!.line;
const sizes = [
  { name: 'desktop 1280 by 720', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const slug = name.replaceAll(' ', '-');

    async function winHull(page: import('@playwright/test').Page, boss = 'The Hull', plies = hullPlies, story = { moments: [2, 3, 5, 6, 7], wins: 0 }): Promise<void> {
      await page.addInitScript((saved) => {
        crypto.getRandomValues = ((a: Uint32Array) => a.fill(0)) as typeof crypto.getRandomValues; // the fight seed
        localStorage.setItem('ab-alone.story', JSON.stringify(saved));
      }, story);
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await startBoss(page, boss);
      await page.evaluate((records) => (window as any).__playMoves(records), plies);
      await expect(page.locator('#hud')).toContainText('Victory');
    }

    test('the win that reaches stage 7 plays the epilogue: two pages, Walk out, once, and the archive rereads it, #1546', async ({ page }) => {
      await winHull(page);
      await expect(page.locator('#hud')).toContainText(line('hull', 'win'));
      await expect(page.locator('#epilogue')).toBeVisible();
      await expect(page.locator('#epilogue-title')).toHaveText(EPILOGUE.pages[0]!.title);
      for (const l of EPILOGUE.pages[0]!.lines) await expect(page.locator('#epilogue-text')).toContainText(l);
      await shot(page, { path: `test-results/epilogue-1-${slug}.png` });
      await page.locator('#epilogue-next').click();
      await expect(page.locator('#epilogue-title')).toHaveText(EPILOGUE.pages[1]!.title);
      await expect(page.locator('#epilogue-text')).toContainText('You walk out.');
      await shot(page, { path: `test-results/epilogue-2-${slug}.png` });
      await page.locator('#epilogue-next').click(); // Walk out
      await expect(page.locator('#epilogue')).toBeHidden();
      await expect(page.locator('body')).not.toHaveAttribute('data-epilogue', /.+/);
      await page.locator('#settings').click();
      await page.locator('#setting-log-archive').dispatchEvent('click'); // hidden: the Logs' home is the ship's Logs bays (#1693), the archive page is the same
      await page.locator('.setting-archive').getByRole('button', { name: EPILOGUE.title }).click();
      await expect(page.locator('body')).toHaveAttribute('data-reading', EPILOGUE.id);
      await expect(page.locator('#reader')).toContainText(EPILOGUE.pages[0]!.lines[0]!);
    });

    // The locked leg (before stage 7, with the note of Tally under it from stage 5) is a unit test (lorelogs.test.ts, "give the bridge console its
    // open-clamp text from stage 7 and the locked one before"): one page load here reads the stage from the story (#1710).
    test('the bridge console reads the clamp open from stage 7, #1546', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('ab-alone.story', JSON.stringify({ moments: [2, 3, 4, 5, 6, 7], wins: 0 }));
        localStorage.setItem('ab-alone.lore-read', 'bridge-clamp');
      });
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await page.locator('#settings').click();
      await page.locator('#setting-log-archive').dispatchEvent('click'); // hidden: the Logs' home is the ship's Logs bays (#1693), the archive page is the same
      await page.locator('.setting-archive').getByRole('button', { name: CLAMP_OPEN.title }).click();
      await expect(page.locator('#reader')).toContainText('Docking clamp: open.');
    });

    test('Skip closes the epilogue on the first page, it is saved and does not open again after a reload, #1546', async ({ page }) => {
      await winHull(page);
      await expect(page.locator('#epilogue')).toBeVisible();
      await page.locator('#epilogue-skip').click();
      await expect(page.locator('#epilogue')).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem('ab-alone.epilogue'))).toBe('seen');
      await page.reload();
      await page.locator('canvas').waitFor();
      await startMode(page, 'hull');
      await page.evaluate((records) => (window as any).__playMoves(records), hullPlies);
      await expect(page.locator('#hud')).toContainText('Victory');
      await expect(page.locator('#epilogue')).toBeHidden();
    });

    test("a boss's victory line is its own, with no epilogue before stage 7, #1546", async ({ page }) => {
      await winHull(page, 'The Swarm', swarmPlies, { moments: [2, 3], wins: 0 });
      await expect(page.locator('#hud')).toContainText(line('swarm', 'win'));
      await expect(page.locator('#hud')).not.toContainText('The seat is empty.');
      await expect(page.locator('#epilogue')).toBeHidden();
      await expect(page.locator('#hud .end')).toHaveCSS('opacity', '1'); // its slide-in is over
      await shot(page, { path: `test-results/boss-win-line-${slug}.png` });
    });
  });
}
