import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// Issue #1287: the shared board is on by default (no flag). Before the player says yes to the board consent it shows a join
// placeholder and opens no relay socket, reading included; after the yes it reads the relays.
// The state is a first visit (no answer stored). The sockets are counted where the page opens them: routeWebSocket sees every
// socket the page makes (page.on('websocket') did not fire for the routed ones on Playwright 1.63, so it is not used here).
// `?net=hook` keeps the online transport off the network.
const SHOTS = process.env.SHOTS;

test.use({ viewport: { width: 390, height: 844 } });

test('the board opens no relay socket before the consent, and reads the relays after it', async ({ page }) => {
  const sockets: string[] = [];
  await page.routeWebSocket(/.*/, (ws) => {
    sockets.push(ws.url());
    ws.send(JSON.stringify(['EOSE', 'ab-board']));
  });
  await page.goto('./?bot=off&net=hook');
  await startMode(page, 'leaderboard');
  const board = page.getByRole('dialog', { name: 'Ranked 1v1' });
  await expect(board).toContainText('Join the board to see the shared results');
  expect(sockets).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}-placeholder.png` });

  await board.getByRole('button', { name: 'Join the shared board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shared ranked board' });
  await expect(dialog).toContainText('You must be 16 or older.');
  await expect(dialog).toContainText('Opening the board connects your browser to these relays, which see your IP address.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}-consent.png` });
  await dialog.getByRole('textbox').fill('Ann');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Join the board' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  expect([...new Set(sockets)].sort()).toEqual(['wss://relay.bitmacro.cloud/', 'wss://relay.piazza.today/']);
});
