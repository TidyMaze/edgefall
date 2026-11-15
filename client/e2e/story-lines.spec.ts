import { expect, test, type Page } from '@playwright/test';
import { CARGO_LINE, MEDAL_LINE, TERMINAL_LINE, VOIDED_LINE } from '../src/ledger';
import { TOWN_LINES } from '../src/tally';
import { lowTierOnCi } from './modes';
import { shot } from './shot';

lowTierOnCi();

// #1585, #1586, #1587 (docs/specs/world.md section 12.9): a town reaches stage 3 and speaks at it, a lost run speaks of line 0412 after stage 5, and the Ledger of the
// settings menu lists the lines seen in stage order and hides the later ones. The story and the lines seen are loaded through their saves, no game is replayed.
type Hooks = { __openworldFixture: (f: object) => void; __run: (state: object) => Promise<void> };
const sizes = [
  { name: 'desktop 960 by 540', viewport: { width: 960, height: 540 }, touch: false },
  { name: 'upright phone 390 by 844', viewport: { width: 390, height: 844 }, touch: true },
];
/** Loads the story at `moments` and the ids of the lines seen, before the page runs. */
async function save(page: Page, moments: number[], seen = ''): Promise<void> {
  await page.addInitScript(([moments, seen]) => {
    localStorage.setItem('ab-alone.story', JSON.stringify({ moments, wins: 0, bosses: [] }));
    if (seen) localStorage.setItem('ab-alone.ledger', seen as string);
  }, [moments, seen] as const);
}
/** Opens the Ledger page of the settings menu, `before` run on the menu of items first. */
async function openLedger(page: Page, before?: () => Promise<void>): Promise<void> {
  await page.locator('#settings').click();
  await before?.();
  await page.locator('#setting-ledger').dispatchEvent('click'); // the row is hidden: the Ledger's home is the ship's Medal wall (#1693), its page is the same
}

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });
    const slug = name.replaceAll(' ', '-');

    test('rolling onto a town is the first town visited: stage 3, the town speaks, and the Ledger lists it, #1586', async ({ page }) => {
      await save(page, [2]);
      await page.goto('./?bot=off&openworld=7');
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-openworld-at', '0,0');
      await page.evaluate(() => (window as unknown as Hooks).__openworldFixture({ hero: [-1, 0], troop: [], enemies: [] }));
      await page.keyboard.press('ArrowRight');
      await expect(body).toHaveAttribute('data-hub', /.+/);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ab-alone.story')!).moments)).toEqual([2, 3]);
      await expect(page.locator('#hud')).toContainText(TOWN_LINES[0]!.line);
      await shot(page, { path: `test-results/story-town-${slug}.png` });
      await openLedger(page);
      await expect(page.locator('.setting-archive p')).toHaveText([TOWN_LINES[0]!.line]);
    });

    test('a lost run after stage 5 shows the line of the player, and the old audit below it, #1587', async ({ page }) => {
      for (const [moments, text] of [[[2, 3, 4, 5], VOIDED_LINE], [[2, 3, 4], 'Run voided. Audit reopened.']] as const) {
        await save(page, [...moments]);
        await page.goto('./?bot=off');
        await page.locator('canvas').waitFor();
        await page.waitForFunction(() => typeof (window as unknown as Hooks).__run === 'function');
        await page.evaluate((state) => (window as unknown as Hooks).__run(state), { seed: 3, army: 3, path: [0], fighting: false, moves: [], end: 'lost', specials: [0, 0, 0], placed: [], reward: false, event: false });
        await expect(page.locator('.run-tally')).toHaveText(text);
        if (moments.length === 4) await shot(page, { path: `test-results/story-voided-${slug}.png` });
      }
    });

    test('the Ledger lists the lines seen in stage order and hides the ones above the stage, #1585', async ({ page }) => {
      await save(page, [2, 3, 4], 'cargo,town-4,bot,medal,terminal,town-2');
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await openLedger(page, async () => {
        // The rows of the Sound group (#1566) stay inside the menu and the window, none cut; Logs and Ledger are hidden there, their homes are in the ship (#1693).
        const buttons = page.locator('#settings-menu .setting-section:has(#setting-ledger) button:visible');
        expect(await buttons.count()).toBe(2);
        const frame = (await page.locator('#settings-menu').boundingBox())!;
        for (let i = 0; i < (await buttons.count()); i++) {
          const box = (await buttons.nth(i).boundingBox())!;
          expect(box.x, `button ${i}`).toBeGreaterThanOrEqual(frame.x);
          expect(box.x + box.width, `button ${i}`).toBeLessThanOrEqual(frame.x + frame.width + 0.5); // inside the menu, not cut by its edge
          expect(box.x + box.width, `button ${i}`).toBeLessThanOrEqual(viewport.width);
          expect(await buttons.nth(i).evaluate((el) => el.scrollWidth > el.clientWidth + 1), `button ${i} overflows`).toBe(false);
        }
        await shot(page, { path: `test-results/story-menu-${slug}.png` });
      });
      const lines = page.locator('.setting-archive p');
      await expect(lines).toHaveText([
        'Mess: one seat filled. The other is counted. It was never an enemy.',
        MEDAL_LINE,
        TOWN_LINES[2]!.line,
        CARGO_LINE,
      ]);
      await expect(page.locator('#settings-menu')).not.toContainText(TERMINAL_LINE);
      await expect(page.locator('#settings-menu')).not.toContainText(TOWN_LINES[4]!.line);
      await shot(page, { path: `test-results/story-ledger-${slug}.png` });
      const menu = await page.locator('#settings-menu').boundingBox();
      for (let i = 0; i < 4; i++) {
        const box = await lines.nth(i).boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width);
      }
    });

    test('a full Ledger scrolls inside the settings menu: the menu stays in the window and the last line is reachable, #1585', async ({ page }) => {
      await save(page, [2, 3, 4, 5, 6, 7], 'bot,town-0,town-1,medal,town-2,town-3,cargo,town-4,voided,terminal,ballast-6,ballast-7');
      await page.goto('./?bot=off');
      await page.locator('canvas').waitFor();
      await openLedger(page);
      const lines = page.locator('.setting-archive p');
      await expect(lines).toHaveCount(12);
      const menu = page.locator('#settings-menu');
      await shot(page, { path: `test-results/story-ledger-full-${slug}.png` });
      await lines.last().scrollIntoViewIfNeeded();
      const [frame, last] = [(await menu.boundingBox())!, (await lines.last().boundingBox())!];
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height);
      expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.width);
      if (touch) expect(frame.y + frame.height).toBeLessThanOrEqual((await page.locator('#dock').boundingBox())!.y - 40); // held upright, above the eval bar and the dock, so no line is hidden under them
      expect(last.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(last.y + last.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
      await shot(page, { path: `test-results/story-ledger-full-end-${slug}.png` });
    });
  });
}
