import { expect, test, type Page } from '@playwright/test';
import { inviteLink, lowTierPages, startMode } from './modes';

// #1529: a lobby nobody joins offers Play the bot while you wait after 20 s (?lobbywait shortens it under the test browser, 300 ms here).
// The bot game is of the same kind, the room stays open and listening, and a peer who joins during it shows a line to switch to the room.
// The transport is the ?net=hook test hook: the test relays records from one page to the other, no public relay is involved.
const room = async (pages: Record<string, Page>) => {
  for (const [name, page] of Object.entries(pages)) {
    await page.exposeFunction('__netOut', (rec: unknown, to?: string) =>
      Promise.all(
        Object.entries(pages)
          .filter(([n, p]) => p !== page && !p.isClosed() && (!to || to === n))
          .map(([, p]) => p.evaluate(([r, from]) => (window as any).__netIn?.(r, from), [rec, name] as const)),
      ),
    );
  }
};
const open = async (page: Page) => {
  await page.locator('body[data-seat]').waitFor({ state: 'attached' });
  await page.evaluate(() => (window as any).__netOpen());
};

test('Play the bot while you wait: a bot game, the room kept, a switch line once a player joins, and the switch seats both', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await lowTierPages(a, b);
  await room({ a, b });
  await a.goto('./?bot=off&net=hook&quality=low&lobbywait=300');
  await a.locator('canvas').waitFor();
  await startMode(a, 'online');
  const invite = await inviteLink(a);
  const bot = a.getByRole('button', { name: 'Play the bot while you wait' });
  await expect(bot).toBeVisible();
  await bot.click();
  await expect(a.locator('body')).not.toHaveAttribute('data-seat', /.*/); // a bot game, not the room's
  await expect(a.locator('#room-switch')).toBeHidden();

  await b.goto(`./?net=hook&quality=low${new URL(invite).hash}`);
  await b.locator('canvas').waitFor();
  await a.evaluate(() => (window as any).__netOpen()); // a's room is parked beside its bot game: no data-seat to wait for
  await open(b);
  const line = a.getByRole('button', { name: 'A player joined the room: switch to it' });
  await expect(line).toBeVisible();
  await line.click();
  await expect(line).toBeHidden();
  await expect(a.locator('body')).toHaveAttribute('data-seat', 'player');
  await expect(a.locator('body')).toHaveAttribute('data-opponent', 'here');
  await expect(b.locator('body')).toHaveAttribute('data-seat', 'player');
  await a.context().close();
  await b.context().close();
});
