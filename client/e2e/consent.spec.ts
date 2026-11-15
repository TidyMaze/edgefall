import { expect, test, type Page } from '@playwright/test';
import { startMode } from './modes';

// Issue #1338: nothing reaches a relay or a peer before the player accepts the online notice. `?consent` asks for the
// dialog under Playwright (navigator.webdriver skips it, as the guide), and routeWebSocket keeps every relay unreached.
const SHORTLIST = ['wss://relay.piazza.today/', 'wss://nostr.red5d.dev/', 'wss://relay.bitmacro.cloud/'];

async function watch(page: Page): Promise<string[]> {
  const sockets: string[] = [];
  await page.routeWebSocket(/.*/, (ws) => {
    sockets.push(ws.url()); // a routed socket is not reported by page.on('websocket'), so the route counts it
    void ws.close();
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  return sockets;
}
async function playOnline(page: Page): Promise<void> {
  await startMode(page, 'online');
}

test('Play online asks first, and Stay solo keeps solo play with no socket opened', async ({ page }) => {
  const sockets = await watch(page);
  await page.goto('./?bot=off&consent');
  await playOnline(page);
  const dialog = page.getByRole('dialog', { name: 'Online play' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('I am 16 or older.');
  await expect(dialog.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', /docs\/privacy\.md$/);
  for (const name of ['Accept', 'Stay solo']) {
    const box = await dialog.getByRole('button', { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('button', { name: 'Stay solo' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('body')).not.toHaveAttribute('data-online', /.+/);
  await page.waitForTimeout(500);
  expect(sockets).toEqual([]);
});

test('Accept connects through the relay shortlist, and the choice is kept', async ({ page }) => {
  const sockets = await watch(page);
  await page.goto('./?bot=off&consent');
  await playOnline(page);
  await page.getByRole('dialog', { name: 'Online play' }).getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  for (const url of sockets) expect(SHORTLIST).toContain(url);
  await page.goto('./?bot=off&consent');
  await playOnline(page);
  await expect(page.getByRole('dialog', { name: 'Online play' })).toBeHidden();
});

test('an invite link asks before it joins', async ({ page }) => {
  const sockets = await watch(page);
  await page.goto('./?bot=off&consent#room=abcd1234');
  await expect(page.getByRole('dialog', { name: 'Online play' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(sockets).toEqual([]);
});
