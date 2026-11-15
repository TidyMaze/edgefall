import { expect, test, type Page } from '@playwright/test';
import { openModes, startMode } from './modes';
import { BLACK_WINS } from './end-games';

// #1032, docs/specs/thumb-dock.md: the main controls sit in a thumb dock at the bottom of the window. In every state
// below no dock button covers a board cell, every dock button is a 44 px target, the dock stays in the window and
// clear of the HUD and the settings cog, and Esc closes the Game modes sheet and gives the focus back.

type Box = { left: number; top: number; right: number; bottom: number };

// The probe: the dock and its buttons, against the board's cell discs, the HUD, the cog and the window.
const probe = (page: Page) =>
  page.evaluate(() => {
    const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const toScreen = (q: number, r: number) => (window as any).__cellToScreen(q, r) as { x: number; y: number };
    const cells: { name: string; disc: Box }[] = [];
    for (let r = -4; r <= 4; r++) {
      for (let q = Math.max(-4, -4 - r); q <= Math.min(4, 4 - r); q++) {
        const p = toScreen(q, r);
        const east = toScreen(q + 1, r);
        const radius = 0.46 * Math.hypot(east.x - p.x, east.y - p.y);
        cells.push({ name: `cell ${q},${r}`, disc: { left: p.x - radius, top: p.y - radius, right: p.x + radius, bottom: p.y + radius } });
      }
    }
    const rect = (el: Element): Box => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    };
    const dock = document.getElementById('dock');
    const buttons = [...document.querySelectorAll('#dock button')].filter((el) => el.getClientRects().length > 0);
    const overlaps: string[] = [];
    const small: string[] = [];
    const clipped: string[] = [];
    for (const el of buttons) {
      const box = rect(el);
      const name = el.getAttribute('aria-label') || el.textContent!.trim();
      for (const c of cells) if (meets(box, c.disc)) overlaps.push(`${name} covers ${c.name}`);
      if (box.right - box.left < 44 || box.bottom - box.top < 44) small.push(`${name} is ${Math.round(box.right - box.left)}x${Math.round(box.bottom - box.top)}`);
      if ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth) clipped.push(name);
    }
    const dockBox = dock && dock.getClientRects().length ? rect(dock) : null;
    const hud = rect(document.getElementById('hud')!);
    const cog = rect(document.getElementById('settings')!);
    const ui = {
      dock: dockBox,
      inWindow: dockBox ? dockBox.left >= 0 && dockBox.top >= 0 && dockBox.right <= innerWidth && dockBox.bottom <= innerHeight : false,
      touchesHud: dockBox ? meets(dockBox, hud) : false,
      touchesCog: dockBox ? meets(dockBox, cog) : false,
      order: buttons.map((el) => el.getAttribute('aria-label') || el.textContent!.trim()),
    };
    return { overlaps, small, clipped, ui };
  });

const frame = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

const check = async (page: Page, state: string) => {
  await frame(page);
  const result = await probe(page);
  expect(result.ui.dock, `${state}: the dock is shown`).not.toBeNull();
  expect(result.overlaps, `${state}: dock over the board`).toEqual([]);
  expect(result.small, `${state}: dock targets under 44 px`).toEqual([]);
  expect(result.clipped, `${state}: dock labels clipped`).toEqual([]);
  expect(result.ui.inWindow, `${state}: dock in the window`).toBe(true);
  expect(result.ui.touchesHud, `${state}: dock over the HUD`).toBe(false);
  expect(result.ui.touchesCog, `${state}: dock over the cog`).toBe(false);
  return result;
};

const viewports = [
  { name: 'a phone 360 by 780', viewport: { width: 360, height: 780 } },
  { name: 'a phone 375 by 812', viewport: { width: 375, height: 812 } },
  { name: 'a phone 390 by 844', viewport: { width: 390, height: 844 } },
  { name: 'a phone 844 by 390 held sideways', viewport: { width: 844, height: 390 } },
  { name: 'a desktop 1280 by 720', viewport: { width: 1280, height: 720 } },
];

for (const { name, viewport } of viewports) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });

    test('a normal game: the dock holds the five controls, clear of the board, bug #1032', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await expect(page.locator('#hud')).toContainText('Black to move');
      const result = await check(page, 'a normal game');
      expect(result.ui.order).toEqual(['New game', 'Hint', 'Open world', 'Quick game', 'Game modes']);
    });

    test('a boss fight: the dock holds Goal and Retry, clear of the board, bug #1032', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await startMode(page, 'echo');
      await expect(page.locator('#hud')).toContainText('P1');
      await expect(page.locator('#boss-goal')).toBeVisible();
      await check(page, 'a boss fight');
    });

    test('a review: the dock holds the five replay steps, clear of the board, bug #1032', async ({ page, browserName, hasTouch }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      // One move, by two clicks, so the history has a position to review.
      const mv = await page.evaluate(() => (window as any).__legal().find((m: any) => m.cells.length === 1));
      const click = async ([q, r]: number[]) => {
        const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
        // Firefox with touch emulation takes a tap, not a mouse click, as the press.
        if (browserName === 'firefox' && hasTouch) await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
      };
      await click(mv.cells[0]);
      const target = await page.evaluate(
        (dir) => (window as any).__targets().find((t: any) => t.dir === dir),
        mv.dir,
      );
      await click(target.cell);
      await expect(page.locator('#replay')).toBeEnabled();
      await page.locator('#replay').click();
      await expect(page.locator('#replay-bar')).toBeVisible();
      const result = await check(page, 'a review');
      // A key is named on a keyboard only (#1379): the phones that touch (width under 600) read the plain labels.
      const touch = viewport.width < 600;
      expect(result.ui.order).toEqual(['First position', touch ? 'Previous move' : 'Previous move (Left)', touch ? 'Next move' : 'Next move (Right)', 'Last position', 'Live']);
      await expect(page.locator('#dock > button').first()).toBeHidden();
      if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
        const slider = await page.locator('#replay-slider').boundingBox();
        expect(slider!.height, 'the slider is a 44 px target on a touch screen, #928').toBeGreaterThanOrEqual(44);
      }
    });

    test('Esc closes the Game modes sheet and gives the focus back to Game modes, bug #1032', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await openModes(page);
      await expect(page.locator('#mode-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#mode-menu')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Game modes' })).toBeFocused();
    });
  });
}

// #1693: Replay joined the dock once there is a move to review: at 320 px each control stays a 44 px target and inside the screen, before and after.
test('the dock controls fit a 320 px phone with and without Replay, each at least 44 px, #1693', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  const boxes = () => page.evaluate(() => [...document.querySelectorAll('#dock > button')].filter((b) => (b as HTMLElement).getClientRects().length).map((b) => b.getBoundingClientRect().toJSON()));
  const fit = (list: Awaited<ReturnType<typeof boxes>>) => {
    for (const b of list) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(320);
    }
  };
  await expect(page.locator('#replay')).toBeHidden(); // no move yet
  const before = await boxes();
  expect(before.length).toBe(5);
  fit(before);
  const save = JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: false, moves: BLACK_WINS });
  await page.locator('#import-file').setInputFiles({ name: 'game.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#replay')).toBeVisible();
  const after = await boxes();
  expect(after.length).toBeGreaterThanOrEqual(6);
  fit(after);
});
