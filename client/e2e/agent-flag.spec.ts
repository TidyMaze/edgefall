import { expect, test, type Page } from '@playwright/test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { inviteLink, startMode } from './modes';
import { shot } from './shot';

// The opponent's Hello is signed here with Node's Ed25519, over the bytes helloPayload signs in the client.
// The page receives it through the ?net=hook transport, so no peer and no public relay is involved (#255).
// It carries the page's engine version, or the page refuses it (#526).
const signedHello = (game: string, agent: boolean, engine: number) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url');
  const fields = ['hello', game, 2, [], pub, ...(agent ? ['agent'] : []), 'engine', engine];
  const sig = sign(null, Buffer.from(JSON.stringify(fields)), privateKey).toString('base64url');
  return { kind: 'hello', game, seat: 2, roster: [], ...(agent ? { agent: true } : {}), engine, pub, sig };
};

// Seating and presence run after the hook transport opens: wait for the session, then open it. The page says its
// Hello at once: the engine version it carries is the one the opponent's must carry.
const openRoom = async (page: Page): Promise<number> => {
  await page.locator('body[data-seat]').waitFor({ state: 'attached' });
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const w = window as any;
        w.__netOut = (m: { kind?: string; engine: number }) => m.kind === 'hello' && resolve(m.engine);
        w.__netOpen();
      }),
  );
};

const status = (page: Page) => page.locator('#hud .presence');

test.use({ viewport: { width: 1280, height: 720 } });

async function creatorRoom(page: Page): Promise<{ game: string; engine: number }> {
  await page.goto('./?bot=off&net=hook');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).not.toBeEmpty(); // refresh() runs after the play-online listener is wired
  await startMode(page, 'online');
  const invite = await inviteLink(page);
  const game = /room=([\w-]+)/.exec(invite)?.[1];
  expect(game).toBeTruthy();
  await expect(page.locator('#hud')).toContainText('You are Black');
  return { game: game!, engine: await openRoom(page) };
}

test('a human White seat is not marked as an agent (before)', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const { game, engine } = await creatorRoom(page);
  await page.evaluate((h) => (window as any).__netIn(h, 'human-peer'), signedHello(game, false, engine));
  await expect(status(page)).toHaveText('You are Black. White is here.');
  await shot(page, { path: test.info().outputPath('presence-before.png') });
});

test('an agent White seat is marked in the presence line (after)', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const { game, engine } = await creatorRoom(page);
  await page.evaluate((h) => (window as any).__netIn(h, 'agent-peer'), signedHello(game, true, engine));
  await expect(status(page)).toHaveText('You are Black. White (agent) is here.');
  await shot(page, { path: test.info().outputPath('presence-after.png') });
});
