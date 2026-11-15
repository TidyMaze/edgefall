import { expect, test, type Page } from '@playwright/test';
import { loseByRepetition } from './fight-end';
import { lowTierOnCi } from './modes';

lowTierOnCi();

// #1519: entering a tower or a dungeon gate plays one transition (a cue of its kind, the dim and a title) over the place that is already live, and
// the way back plays the matching one; reduced motion keeps the title and cuts the rest (docs/specs/motion.md story 10). The test hook stands the
// hero next to the place (no walk).
type Hooks = { __openworldFixture: (f: object) => void };
const sizes = [
  { name: 'desktop', viewport: { width: 960, height: 540 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];

/** The cell of the first place or tower of `kind`, from the page. */
async function cellOf(page: Page, kind: 'tower' | 'dungeon'): Promise<[number, number]> {
  const body = page.locator('body');
  const listed = kind === 'tower' ? (await body.getAttribute('data-openworld-lairs'))!.split(' ') : (await body.getAttribute('data-openworld-places'))!.split(' ').filter((p) => p.startsWith('dungeon:')).map((p) => p.slice(8));
  return listed[0]!.split(',').map(Number) as [number, number];
}

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    for (const [kind, title, back] of [['tower', 'The Echo', 'exit'], ['dungeon', 'Mining cut · Rogue-lite run', 'exit']] as const) {
      test(`a ${kind} shows its transition with its title over the live place and the way back plays the matching one, #1519`, async ({ page }) => {
        await page.goto('./?bot=off&openworld=7&hub=classic');
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-openworld-at', '0,0');
        const [q, r] = await cellOf(page, kind);
        await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
        await page.keyboard.press('ArrowRight');
        await expect(body).not.toHaveAttribute('data-openworld', /.*/); // the place is live at once
        const cue = page.locator('#place-transition');
        await expect(cue).toHaveAttribute('data-kind', kind);
        await expect(cue.locator('.pt-title')).toHaveText(title);
        await expect(body).toHaveAttribute('data-place-transition', 'enter');
        await page.mouse.click(5, 5); // a press skips it to its end
        await expect(body).not.toHaveAttribute('data-place-transition', /.*/);
        await expect(cue).toBeHidden();
        if (kind === 'tower') await loseByRepetition(page); // The Echo, the first tower, is lost in a few moves: Back to the Open world shows
        await page.evaluate((id) => document.getElementById(id)!.click(), back); // the first slot of the dock (#1517); a click by script, as the tower's end light may cover it
        await expect(body).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
        await expect(cue).toHaveAttribute('data-kind', kind);
        await expect(body).toHaveAttribute('data-place-transition', 'back');
        await expect(cue.locator('.pt-title')).toHaveText('');
        await expect(cue).toBeHidden(); // 400 ms and it is over
      });

      test(`under reduced motion a ${kind} keeps its title and cuts the rest, and the way back is a cut, #1519`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('./?bot=off&openworld=7&hub=classic');
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-openworld-at', '0,0');
        const [q, r] = await cellOf(page, kind);
        await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
        await page.keyboard.press('ArrowRight');
        const cue = page.locator('#place-transition');
        await expect(cue).toHaveAttribute('data-motion', 'cut');
        await expect(cue.locator('.pt-title')).toHaveText(title);
        await expect(cue.locator('.pt-title')).toBeVisible();
        await expect(cue.locator('.pt-dim')).toBeHidden();
        // Its 600 ms clock counts frames, at most 50 ms each: a runner drawing a frame a second needs 12 s, so its end by itself is a
        // unit test (placetransition.test.ts, "until the press or 600 ms", #1625); here a press ends it, as on the way in above.
        await page.mouse.click(5, 5);
        await expect(body).not.toHaveAttribute('data-place-transition', /.*/);
        await expect(cue).toBeHidden();
      });
    }
  });
}
