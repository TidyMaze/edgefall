import { expect, test, type Page } from '@playwright/test';

// Issue #1287: the shared ranked board opt-in, asked at the first ranked entry, unticked; and its read side: once joined, opening the
// board reads the two relays and only reads (REQ and CLOSE, never an EVENT). No flag: the board is on by default.
// `?net=hook` keeps the online transport off the network.
const SHOTS = process.env.SHOTS;

async function watch(page: Page): Promise<{ sockets: string[]; sent: string[] }> {
  const sockets: string[] = [];
  const sent: string[] = [];
  await page.routeWebSocket(/.*/, (ws) => {
    sockets.push(ws.url());
    ws.onMessage((m) => sent.push(String(m)));
    ws.send(JSON.stringify(['EOSE', 'ab-board']));
  });
  return { sockets, sent };
}

test('the ranked entry asks first, joining and leaving the board are as easy, and nothing is sent', async ({ page }) => {
  const { sockets, sent } = await watch(page);
  await page.goto('./?bot=off&net=hook&hub=classic');
  await page.getByRole('button', { name: 'Game modes' }).click();
  await page.getByRole('button', { name: 'Ranked' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shared ranked board' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('public and permanent');
  await expect(dialog).toContainText('I understand and I am 16 or older');
  const tick = dialog.getByRole('checkbox');
  await expect(tick).not.toBeChecked();
  const join = dialog.getByRole('button', { name: 'Join the board' });
  await expect(join).toBeDisabled();
  for (const control of [tick, dialog.getByRole('textbox'), join, dialog.getByRole('button', { name: 'Keep ranked local' })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
  for (const control of [dialog.getByRole('textbox'), dialog.getByRole('button', { name: 'Keep ranked local' }), dialog.locator('#optin-tick')]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('textbox').fill('A name far too long to keep');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}-optin.png` });
  await tick.check();
  await join.click();
  await expect(dialog).toBeHidden();

  expect(sockets).toEqual([]); // joined, board not opened: nothing read yet
  await page.getByRole('button', { name: 'Game modes' }).click();
  await page.getByRole('button', { name: 'Leaderboard' }).click();
  const board = page.getByRole('dialog', { name: 'Ranked 1v1' });
  await expect(board).toContainText('You are on the shared board as "A name far too l"');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}-board.png` });
  await board.getByRole('button', { name: 'Leave the board' }).click();
  await expect(board).toContainText('You are not on the shared board');
  const kept = await page.evaluate(() => ({
    consent: localStorage.getItem('ab-alone.board-consent'),
    retire: localStorage.getItem('ab-alone.board-retire'),
  }));
  expect(JSON.parse(kept.consent!)).toEqual({ v: 5, choice: 'declined' });
  expect(JSON.parse(kept.retire!).events[0].kind).toBe('retire');
  await expect.poll(() => new Set(sockets).size).toBe(2);
  expect([...new Set(sockets)].sort()).toEqual(['wss://relay.bitmacro.cloud/', 'wss://relay.piazza.today/']);
  expect(sent.every((m) => m.startsWith('["REQ"') || m.startsWith('["CLOSE"'))).toBe(true);
});
