import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseRecorded } from '../src/test/chaplain-game';
import { BOSS_LORE } from '../src/lorelogs';
import { SEALED } from '../src/story';
import { startMode } from './modes';
import { shot } from './shot';

// #1589: a boss win shows that boss's entry of the story under the banner (a sheet over the dock that lets every press through), files it in
// the log archive, and never blocks Retry. The recorded win of The Swarm (fight seed 0) is played by the __playMoves hook.
const plies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/swarm.txt', import.meta.url), 'utf8'));
const hullPlies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/hull.txt', import.meta.url), 'utf8'));
const swarm = BOSS_LORE.find((e) => e.boss === 'swarm')!;
const sizes = [
  { name: 'desktop 1280 by 720', viewport: { width: 1280, height: 720 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    test('the win over The Swarm shows its entry, Retry still works, and the log archive reads it again, #1589', async ({ page }) => {
      await page.addInitScript(() => {
        crypto.getRandomValues = ((a: Uint32Array) => a.fill(0)) as typeof crypto.getRandomValues; // the fight seed
        localStorage.setItem('ab-alone.story', JSON.stringify({ moments: [2, 3], wins: 0 })); // stage 3 reaches The Swarm's entry (#1584)
      });
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await startMode(page, 'swarm');
      await expect(page.locator('#lore')).toBeHidden(); // none during the fight
      await page.evaluate((records) => (window as any).__playMoves(records), plies);
      await expect(page.locator('#hud')).toContainText('Victory');
      await expect(page.locator('#lore-title')).toHaveText(swarm.title);
      await expect(page.locator('#lore-body')).toHaveText(swarm.body);
      await expect(page.locator('body')).toHaveAttribute('data-lore', 'boss-swarm');
      await expect(page.locator('#lore')).toHaveCSS('opacity', '1'); // its slide-in is over
      await shot(page, { path: `test-results/boss-lore-${name.replaceAll(' ', '-')}.png` });
      expect(await page.locator('#lore').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none'); // every press goes through to the board and the buttons
      // It is in the archive, and the terminal reader reads it again.
      await page.locator('#settings').click();
      await page.locator('#setting-log-archive').click();
      await expect(page.locator('.setting-archive')).toContainText(swarm.title);
      // Retry is not held by it: it starts the fight again, with no lore.
      await page.keyboard.press('Escape');
      await page.locator('#boss-retry').click();
      await expect(page.locator('#lore')).toBeHidden();
      await expect(page.locator('body')).not.toHaveAttribute('data-lore', /.+/);
    });
  });
}

// #1584: a new player cannot read the ending first. A boss whose entry lies above the current stage shows the sealed line in its place,
// the same for all of them, and the entry opens in the log archive only when its stage is reached. The recorded win of The Hull (stage 4)
// is played by a player at stage 1.
for (const { name, viewport, touch } of sizes) {
  test.describe(`sealed, ${name}`, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    test('the first win over The Hull shows the sealed line, not its entry, and the archive lists nothing, #1584', async ({ page }) => {
      await page.addInitScript(() => {
        crypto.getRandomValues = ((a: Uint32Array) => a.fill(0)) as typeof crypto.getRandomValues; // the fight seed
      });
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await startMode(page, 'hull');
      await page.evaluate((records) => (window as any).__playMoves(records), hullPlies);
      await expect(page.locator('#hud')).toContainText('Victory');
      await expect(page.locator('#lore-title')).toHaveText(SEALED.title);
      await expect(page.locator('#lore-body')).toHaveText(SEALED.body);
      await expect(page.locator('body')).toHaveAttribute('data-lore', 'sealed');
      await expect(page.locator('#lore')).toHaveCSS('opacity', '1');
      await shot(page, { path: `test-results/boss-lore-sealed-${name.replaceAll(' ', '-')}.png` });
      await page.locator('#settings').click();
      await page.locator('#setting-log-archive').click();
      await expect(page.locator('.setting-archive')).toHaveText('Nothing read yet.');
    });
  });
}
