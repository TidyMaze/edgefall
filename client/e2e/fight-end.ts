import { expect, type Page } from '@playwright/test';
import { startMode } from './modes';

// Reaching the end of a boss fight, for the daily result card tests (#196). With ?bot=off the test
// plays both sides by hand. The daily boss of 2027-03-30 is The Echo with 14 bosses (#1111), whose mirror
// of each move is a bonus move for the other side (#859), offered to the player (#958): Black up, White
// east, Black's free move west, Black east, White east, the free move again and Black east bring a
// position back a third time at the 7th move, a draw by threefold repetition, which is a loss against a boss.
const ECHO_DRAW: [number, number, number, number][] = [
  [0, 2, 0, 1], // Black (0,2) to (0,1), the Echo's bonus (0,-2) to (0,-1)
  [0, -1, 1, -1], // White east, Black is offered the mirror west
  [0, 1, -1, 1], // Black takes it
  [-1, 1, 0, 1], // Black east, White's bonus west
  [0, -1, 1, -1],
  [0, 1, -1, 1],
  [-1, 1, 0, 1],
];
export async function loseByRepetition(page: Page): Promise<void> {
  // The test hook's click (main.ts __roll): the same move as a mouse click, without the raycast and the frames of one (#1413).
  const click = (q: number, r: number) => page.evaluate(([cq, cr]) => (window as any).__roll(cq, cr), [q, r]);
  for (const [ply, [q, r, tq, tr]] of ECHO_DRAW.entries()) {
    await click(q, r);
    await click(tq, tr);
    await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBe(ply + 1);
  }
  await expect(page.locator('#hud')).toContainText('Defeat');
  // The last move's slides still end with a HUD redraw, which wipes a note written meanwhile ("result copied", #1277).
  await expect(page.locator('body')).not.toHaveAttribute('data-sliding', '1');
}

/** Opens the daily challenge of 2027-03-30 (clock fixed), starts it and returns the boss name. */
export async function startDaily(page: Page): Promise<string> {
  await page.clock.setFixedTime(new Date('2027-03-30T08:00:00Z'));
  await page.goto('./?bot=off');
  const daily = page.locator('#daily');
  await expect(daily).toBeEnabled();
  const name = (await daily.textContent())!.split(': ')[1]!;
  await startMode(page, 'daily');
  await expect(page.locator('#hud')).toContainText('Daily challenge 2027-03-30 · attempt 1');
  return name;
}
