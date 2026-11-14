import { expect, test, type Page } from '@playwright/test';
import { inviteLink, startMode } from './modes';

// The online battle royale (#504, docs/specs/tech.md section 6) between three browser contexts. The transport is the
// ?net=hook test hook: the test relays every message from one page to the others, so no public Nostr relay is
// involved. ?round=1500 makes the round deadline 1.5 s.
// From the start of the game the page clocks are paused (page.clock, as in roll.spec.ts): a deadline passes only when
// the test moves every clock past it, so a loaded machine never lets the next round resolve while the test reads the
// reveal of the last one (bug #707).

// Every page relays its messages to the others with its own name as the sender, like a Trystero room, or to the one
// page `to` names. A page whose session does not exist yet has no __netIn: the message is dropped for it (#249).
// `commits` gets the round of every commit a page sends.
const relay = async (pages: Record<string, Page>, commits: number[]) => {
  for (const [name, page] of Object.entries(pages)) {
    await page.exposeFunction('__netOut', (rec: { kind?: string; round?: number }, to?: string) => {
      if (rec.kind === 'commit') commits.push(rec.round!);
      return Promise.all(
        Object.entries(pages)
          .filter(([n, p]) => p !== page && !p.isClosed() && (!to || to === n))
          .map(([, p]) => p.evaluate(([r, from]) => (window as any).__netIn?.(r, from), [rec, name] as const)),
      );
    });
  }
};
// The hook transport exists once the page went online, after its textures loaded (bug #238): data-seat says so.
const open = async (page: Page) => {
  await page.locator('body[data-seat]').waitFor({ state: 'attached' });
  await page.evaluate(() => (window as any).__netOpen());
};
const seated = (page: Page) => expect(page.locator('body')).toHaveAttribute('data-seat', 'player', { timeout: 15_000 });
const reveal = (page: Page) => page.locator('#hud .reveal li');

test('three players: a round resolves at its deadline, the silent player holds (#504, #673)', async ({ browser }) => {
  const [a, b, c] = await Promise.all([0, 1, 2].map(async () => (await browser.newContext()).newPage()));
  const commits: number[] = [];
  await relay({ a, b, c }, commits);
  // Reduced motion: the reveal shows at once, no animation is checked here.
  await Promise.all([a, b, c].map((p) => Promise.all([p.emulateMedia({ reducedMotion: 'reduce' }), p.clock.install()])));
  // Every page kept the commits of `n` seats for `round`: it sends each one it keeps, its own or forwarded (#532).
  // Only then may a deadline pass, or a page would refuse a commit the others took.
  const kept = (round: number, n: number) =>
    expect.poll(() => commits.filter((r) => r === round).length).toBe(3 * n);
  const deadlinePasses = async () => {
    for (const p of [a, b, c]) await p.clock.fastForward(1500);
  };

  await a.goto('./?bot=off&net=hook&quality=low&round=1500');
  await expect(a.locator('#hud')).not.toBeEmpty(); // the mode menu's listeners are wired
  await startMode(a, 'royale');
  await a.getByRole('button', { name: 'Lobby' }).click(); // the lobby sheet (#1044)
  await a.getByRole('button', { name: 'Invite' }).click(); // the offline game becomes a room
  const hash = new URL(await inviteLink(a)).hash;
  expect(hash).toMatch(/^#royale=[\w-]+&key=[\w-]{8}$/);
  await Promise.all([b, c].map((p) => p.goto(`./?bot=off&net=hook&quality=low&round=1500${hash}`)));
  // Every session exists before the first page opens: the hook has no peer join, after which a Trystero page says Hello
  // again, so a page whose session came later would never hear the Hello of the pages open before it.
  for (const p of [b, c]) await p.locator('body[data-seat]').waitFor({ state: 'attached' });
  await open(a);
  await open(b);
  await seated(b); // seat 2, then c takes seat 3
  await open(c);
  await seated(c);
  await expect(a.locator('#hud .presence')).toHaveText('3 players in. Start: bots take the empty seats');

  for (const p of [a, b, c]) await p.clock.pauseAt(await p.evaluate(() => Date.now() + 1000));
  await a.getByRole('button', { name: 'Start' }).click();
  for (const p of [a, b, c]) await expect(p.locator('body')).toHaveAttribute('data-net', 'choosing');
  // a orders (-2, 6) NW, b holds, c says nothing.
  await a.evaluate(() => [(window as any).__click(-2, 6), (window as any).__click(-2, 5)]);
  await b.getByRole('button', { name: 'Hold' }).click();
  await expect(a.locator('#hud .presence')).toHaveText('Order locked, waiting for the others...');
  await kept(1, 2);
  // The order deadline counts down on the plate of the silent page (#673).
  const deadline = c.locator('#hud .presence + .deadline');
  await expect(deadline).toHaveText('Order deadline: 2 s');
  await c.clock.fastForward(600);
  await expect(deadline).toHaveText('Order deadline: 1 s');
  await deadlinePasses();

  for (const p of [a, b, c]) await expect(p.locator('body')).toHaveAttribute('data-royale', '2');
  await expect(reveal(a).nth(0)).toHaveText('You: moved');
  await expect(reveal(a).nth(1)).toHaveText('Player 2: held');
  await expect(reveal(a).nth(2)).toHaveText('Player 3: held');
  await expect(reveal(c).nth(0)).toHaveText('Player 1: moved');
  await expect(reveal(c).nth(2)).toHaveText('You: held');
  // The bot plays a silent seat from round 3 and retakes it when the seat is back: the rounds, the dropped seat and its
  // return are unit tested on the relay (royale-net.test.ts, 'RoyaleNet dropped seat (#674)'). Not replayed here: each
  // round costs a deadline pass on every page, seconds on a CI runner (#1481).
  for (const p of [a, b, c]) await expect(p.locator('body')).toHaveAttribute('data-desync', '0');
  for (const p of [a, b, c]) await p.context().close(); // their WebGL pages would slow the next test (#120)
});
