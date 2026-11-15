import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

// #1694: a tower opens the ship on its boss's bay (amber, the confirm up), a gate on the Mining cut. The rules (Enter, Stay, the exit, the refused taps, the mirror
// question) are unit tests, main.towerbay.test.ts; a boot of the Open world costs an e2e its 5 s, so the test hook __openBay opens the bay and this spec only reads the page.
type Hooks = { __openBay: (kind: 'tower' | 'gate', boss?: string) => void };
const sizes = [
  { name: '390x844', viewport: { width: 390, height: 844 }, touch: true },
  { name: '375x667', viewport: { width: 375, height: 667 }, touch: true },
  { name: '360x640', viewport: { width: 360, height: 640 }, touch: true },
  { name: '1000x700', viewport: { width: 1000, height: 700 }, touch: false },
];

async function open(page: Page, kind: 'tower' | 'gate'): Promise<void> {
  await page.goto('./?bot=off');
  await page.waitForFunction(() => (window as unknown as { __booted?: () => boolean }).__booted?.() === true); // the landing is settled: a bay opened sooner is replaced by the Hub's entry
  await page.evaluate((kind) => (window as unknown as Hooks).__openBay(kind, 'echo'), kind);
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await expect(page.locator('#hub-confirm')).toBeVisible();
}

for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    test('a tower opens the ship with the amber bay, the confirm clear of it, the dock holding the exit alone', async ({ page }) => {
      await open(page, 'tower');
      await expect(page.locator('#ship-bays [data-state="goal"]')).toHaveCount(1);
      await expect.poll(() => page.locator('#ship-bays [data-state="goal"]').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(0); // placed on the ship
      await expect(page.locator('#exit')).toContainText("Echo's tower");
      await expect(page.locator('#hud')).toContainText("You came in by The Echo's tower.");
      expect(await page.locator('#dock > button:visible').count()).toBe(1);
      const m = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const no = r('#hub-confirm-no');
        const yes = r('#hub-confirm-yes');
        const box = r('#hub-confirm');
        const goal = r('#ship-bays [data-state="goal"]');
        return { no: [no.width, no.height], yes: [yes.width, yes.height], gap: yes.left - no.right, box: [box.top, box.bottom], hud: r('#hud').bottom, goal: [goal.top, goal.bottom], wraps: ['#hub-confirm-no', '#hub-confirm-yes'].map((s) => document.querySelector<HTMLElement>(s)!.scrollWidth > document.querySelector<HTMLElement>(s)!.clientWidth) };
      });
      expect(m.no[1]).toBeGreaterThanOrEqual(44);
      expect(m.yes[1]).toBeGreaterThanOrEqual(44);
      expect(m.gap).toBeGreaterThanOrEqual(8);
      expect(m.wraps).toEqual([false, false]);
      expect(m.box[1] <= m.goal[0] || m.box[0] >= m.goal[1]).toBe(true); // never over the target bay
      if (viewport.width < 600) expect(m.box[0]).toBeGreaterThanOrEqual(m.hud + 8); // a phone: under the title row
      if (process.env.E2E_SHOTS) {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __renderCost: { triangles: number } }).__renderCost.triangles), { timeout: 30000 }).toBeLessThanOrEqual(6000); // the first frames may still draw the deck
        await shot(page, { path: `test-results/tower-bay-${name}.png` });
      }
    });

    test('a gate opens the Mining cut amber, the exit alone naming the gate', async ({ page }) => {
      await open(page, 'gate');
      await expect(page.locator('#ship-bays [data-bay="cargo:run"]')).toHaveAttribute('data-state', 'goal');
      await expect(page.locator('#exit')).toHaveText('Back to the gate');
      expect(await page.locator('#dock > button:visible').count()).toBe(1);
    });
  });
}
