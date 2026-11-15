import { expect, test, type Page } from '@playwright/test';

// #1695: in the ship the next goal is always in sight: the beacon (two rings on the goal's bay), the dotted route and the marble's tag, then a goal line over the dock on a phone
// and a card with Go in a window; a tap rolls the marble there. The choice of the goal, the route and the tag are unit tests (hubgoal.test.ts, main.hubgoal.test.ts); this spec reads the page.

const bay = (page: Page, key: string) => page.locator(`#ship-bays [data-bay="${key}"]`);

/** The Hub with The Echo beaten and a run not played yet: the goal is the Rogue-lite run on the Cargo deck. */
async function ship(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript(() => localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten: ['echo'] })));
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => (window as unknown as { __enterMode: (m: string) => void }).__enterMode('hub'));
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await expect(bay(page, 'cargo:run')).toHaveAttribute('data-state', 'goal');
}

test('a phone: the goal line at the foot of the window, the beacon on the goal bay, the route and the tag; a tap on the line rolls to the room', async ({ page }) => {
  await ship(page, { width: 390, height: 844 });
  const line = page.locator('#ship-goal-line');
  await expect(line).toHaveText('Next goal: start a rogue-lite run on the Cargo deck.');
  await expect(page.locator('#ship-gocard')).toBeHidden();
  await expect(page.locator('#ship-goal .ring').first()).toBeVisible();
  await expect(page.locator('#ship-goal .tag')).toHaveText('Ride up to Cargo');
  await expect(page.locator('#ship-goal path')).toHaveAttribute('d', /^M/);
  const m = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const l = r('#ship-goal-line');
    const bays = [...document.querySelectorAll<HTMLElement>('#ship-bays .cut-bay:not([hidden])')].map((b) => b.getBoundingClientRect());
    return { h: l.height, bottom: l.bottom, window: innerHeight, left: l.left, right: l.right, under: bays.filter((b) => b.bottom > l.top && b.top < l.bottom).length };
  });
  expect(m.h).toBeGreaterThanOrEqual(44);
  expect(m.bottom).toBeLessThanOrEqual(m.window); // the Hub at home has no dock (#1697): the line stands at the foot of the window
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(390);
  expect(m.under).toBe(0); // no bay under the line
  await line.click();
  await expect(page.locator('body')).not.toHaveAttribute('data-hub', /./); // the room opened: the Hub is left
});

test('a window: the card with Go replaces the line, and Go rolls to the room', async ({ page }) => {
  await ship(page, { width: 1000, height: 700 });
  await expect(page.locator('#ship-goal-line')).toBeHidden();
  const card = page.locator('#ship-gocard');
  await expect(card).toContainText('Start a rogue-lite run');
  await expect(card).toContainText('Cargo deck');
  const m = await page.evaluate(() => {
    const c = document.querySelector('#ship-gocard')!.getBoundingClientRect();
    const go = document.querySelector('#ship-gocard button')!.getBoundingClientRect();
    const bays = [...document.querySelectorAll<HTMLElement>('#ship-bays .cut-bay')].map((b) => b.getBoundingClientRect());
    return { go: go.height, right: c.right, bottom: c.bottom, over: bays.filter((b) => b.right > c.left && b.left < c.right && b.bottom > c.top && b.top < c.bottom).length };
  });
  expect(m.go).toBeGreaterThanOrEqual(44);
  expect(m.right).toBeLessThanOrEqual(1000);
  expect(m.over).toBe(0); // the card stands over the shoulder, not over a bay
  await card.locator('button').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-hub', /./);
});
