import { expect, test } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The Stalker as a boss (#1111): started from its bay, fogged at sight 3, the dark veil over what the player's
// marbles do not see, the sight on the HUD. A move is played and the boss answers under the same fog.
test('The Stalker is a boss: start it, the veil and the sight show, a move gets a reply, #1121', async ({ page }, testInfo) => {
  await page.goto('./?bot=on'); // a query: no landing on the Hub (#602)
  await page.locator('canvas').waitFor();
  await startMode(page, 'stalker');
  await expect(page.locator('#hud')).toContainText('Sight 3 · narrows to 2 after 3 more ejections');
  const fog = await page.evaluate(() => (window as any).__stalker() as { visible: unknown[]; drawn: unknown[] });
  expect(fog.visible).toHaveLength(41);
  expect(fog.drawn).toEqual([]); // the boss is four cells away: all hidden
  const plies = async () => page.evaluate(() => (window as any).__plies() as number);
  const move = await page.evaluate(() => (window as any).__legal()[0] as { cells: [number, number][]; dir: number });
  await page.evaluate((m) => (window as any).__roll(...m.cells[0]!), move);
  await page.evaluate((m) => (window as any).__roll(...(window as any).__targets().find((t: any) => t.dir === m.dir).cell), move);
  await expect.poll(plies).toBe(2); // the move and the boss's reply
  await shot(page, { path: testInfo.outputPath('stalker-boss-fight.png') });
});

// #1122: reload during a Stalker fight and come back to the same fight under its fog; no menu has a Stalker entry (#1123).
test('A Stalker fight comes back under its fog after a reload, and no menu has a Stalker entry, #1122 #1123', async ({ page }, testInfo) => {
  await page.goto('./?bot=on');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#stalker')).toHaveCount(0);
  await startMode(page, 'stalker');
  const move = await page.evaluate(() => (window as any).__legal()[0] as { cells: [number, number][]; dir: number });
  await page.evaluate((m) => (window as any).__roll(...m.cells[0]!), move);
  await page.evaluate((m) => (window as any).__roll(...(window as any).__targets().find((t: any) => t.dir === m.dir).cell), move);
  await expect.poll(() => page.evaluate(() => (window as any).__plies() as number)).toBe(2);
  const history = await page.evaluate(() => (window as any).__history());
  await page.reload();
  await expect(page.locator('#hud')).toContainText('Sight 3');
  expect(await page.evaluate(() => (window as any).__history())).toEqual(history);
  expect(await page.evaluate(() => (window as any).__stalker().visible.length)).toBeGreaterThan(0);
  await shot(page, { path: testInfo.outputPath('stalker-after-reload.png') });
});
