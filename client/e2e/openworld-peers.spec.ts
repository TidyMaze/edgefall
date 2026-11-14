import { expect, test, type Page } from '@playwright/test';
import { MIN_GAP_MS } from '../src/worldpeers';
import { clickHud, openModes, showHud, lowTierOnCi } from './modes';

lowTierOnCi();

// #1305: the public Open world shows the other heroes. The page runs on the hook transport (?net=hook): the test plays the other
// end of the room through window.__netPeer*, so nothing touches a relay. A far hero gets an arrow at the screen edge with its
// distance in tiles, a near one a marker in the scene; a private seed has no room.
const PUBLIC = 1305;

type Hook = {
  __netPeerOut: (data: Uint8Array, to?: string) => void;
  __netPeerIn: (data: number[], peer: string) => void;
  __netPeerJoin: (peer: string) => void;
  __netPeerLeave: (peer: string) => void;
  __out: number[][];
};

async function enter(page: Page, seed: number): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Hook;
    w.__out = [];
    w.__netPeerOut = (data) => void w.__out.push(Array.from(data));
  });
  await page.goto(`./?bot=off&net=hook&quality=low&openworld=${seed}`);
  await page.locator('canvas:not(#openworld-minimap)').waitFor();
  await expect.poll(() => page.evaluate(() => document.body.dataset.openworld)).toBe(String(seed));
}

// A peer's positions closer than MIN_GAP_MS (100 ms, flood guard in worldpeers.ts) are refused: Firefox and WebKit are quick enough to send the next one inside it.
const pastGap = (page: Page): Promise<void> => page.waitForTimeout(MIN_GAP_MS + 20);

const pos = (q: number, r: number, seq: number): number[] => [2, 2, (q >> 8) & 255, q & 255, (r >> 8) & 255, r & 255, seq];

test('a far hero shows as an arrow at the screen edge with its distance, a near one as a marker, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  await page.evaluate(() => (window as unknown as Hook).__netPeerJoin('p'));
  expect(await page.evaluate(() => (window as unknown as Hook).__out)).toContainEqual([2, 1]); // Hello to the peer that joined
  await page.evaluate(
    ([hello, far]) => {
      const w = window as unknown as Hook;
      w.__netPeerIn(hello!, 'p');
      w.__netPeerIn(far!, 'p');
    },
    [[2, 1], pos(0, 60, 0)],
  );
  const edge = page.locator('#openworld-peers .peer-edge');
  await expect(edge).toHaveCount(1);
  await expect(edge).toContainText('60');
  await expect(edge).toHaveAttribute('aria-label', 'Another hero, 60 tiles away');
  const box = (await edge.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height); // inside the screen
  await page.screenshot({ path: 'test-results/peers-far.png' });

  // The same hero walks next to ours: it is in view, so a marker in the scene and no arrow.
  await pastGap(page);
  await page.evaluate((near) => (window as unknown as Hook).__netPeerIn(near, 'p'), pos(1, 0, 1));
  await expect(edge).toHaveCount(0);
  await expect(page.locator('#openworld-peers')).toHaveAttribute('data-peers', '1');
  await page.screenshot({ path: 'test-results/peers-near.png' });

  // It leaves: gone from the screen.
  await page.evaluate(() => (window as unknown as Hook).__netPeerLeave('p'));
  await expect(page.locator('#openworld-peers')).toHaveAttribute('data-peers', '0');
});

test('on a phone screen the arrow stays inside the screen, whichever way the hero is, #1305', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await enter(page, PUBLIC);
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerJoin('p');
    w.__netPeerIn([2, 1], 'p');
    w.__netPeerIn([2, 2, 0xff, 0xce, 0, 40, 0], 'p'); // q = -50, r = 40
  });
  const edge = page.locator('#openworld-peers .peer-edge');
  await expect(edge).toContainText('50');
  const box = (await edge.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(780);
  await page.screenshot({ path: 'test-results/peers-phone.png' });
});

test('the hero sends its position when it steps, and Escape leaves the room, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m[1] === 2).length)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#openworld-peers')).toBeHidden();
});

test('a private seed has no room: no position leaves the page, #1305', async ({ page }) => {
  await enter(page, 7);
  await page.evaluate(() => (window as unknown as Hook).__netPeerJoin?.('p'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as Hook).__out)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('ab-alone.world-events'))).toBeNull(); // a private seed stores nothing
});

test('a public name goes out in the Hello and shows over a near hero, Hide leaves the room, an error is shown, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  await expect(page.locator('#openworld-net')).toHaveText('Online: nobody else here yet.');
  await showHud(page, '#openworld-name');
  await page.locator('#openworld-name').fill('Ana');
  const hellos = () => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m[1] === 1));
  expect(await hellos()).toContainEqual([2, 1, 65, 110, 97]);
  await page.keyboard.press('Escape'); // typed in the field: the world is not left
  await expect(page.locator('body')).toHaveAttribute('data-openworld', String(PUBLIC));
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerIn([2, 1, 66, 111, 98], 'p'); // Bob, standing next to us
    w.__netPeerIn([2, 2, 0, 1, 0, 0, 0], 'p');
  });
  await expect(page.locator('.peer-tag')).toHaveText('Bob');
  await expect(page.locator('#openworld-net')).toHaveText('Online: 1 other hero here.');
  await page.screenshot({ path: 'test-results/peers-named.png' });
  await clickHud(page, '#openworld-hide');
  await expect(page.locator('#openworld-net')).toContainText('Hidden');
  await expect(page.locator('.peer-tag')).toHaveCount(0);
  await clickHud(page, '#openworld-hide');
  await expect(page.locator('#openworld-hide')).toHaveText('Hide');
  await page.evaluate(() => (window as unknown as Hook & { __netPeerError: (m: string) => void }).__netPeerError('could not connect to peer p after exchanging SDP'));
  await expect(page.locator('#openworld-net')).toContainText('the direct connection failed');
});

test('the Say menu sends an emote by index, a hero next to us shows its emote above it, the nearby list names it, #1671', async ({ page }) => {
  await enter(page, PUBLIC);
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerIn([2, 1, 66, 111, 98], 'p'); // Bob, next to us
    w.__netPeerIn([2, 2, 0, 1, 0, 0, 0], 'p');
  });
  await clickHud(page, '#openworld-emote');
  await clickHud(page, '#openworld-emotes button:nth-child(4)');
  expect(await page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m[1] === 7))).toEqual([[2, 7, 3]]); // Hello, as one index
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerIn([2, 7, 2], 'p'); // Follow me
    w.__netPeerIn([2, 7, 200], 'p'); // an id off the list: dropped
  });
  await expect(page.locator('.peer-say')).toHaveText('Follow me');
  await expect(page.locator('#openworld-nearby li')).toHaveText('Bob, 1 tile away');
  await page.screenshot({ path: 'test-results/emote-bubble.png' });
  await page.keyboard.press('Escape'); // closes the menu, the world stays
  await expect(page.locator('#openworld-emotes')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-openworld', String(PUBLIC));
});

// #1305: the signed break event. The test signs as another hero (WebCrypto in the page) and plays the room through the hook.
type Break = Hook & {
  __openworldCanBreak: (seed: number, q: number, r: number) => boolean;
  __openworldIsEnemy: (seed: number, q: number, r: number) => boolean;
  __openworldFixture: (f: { hero: [number, number]; troop: [number, number][]; enemies: [number, number][] }) => void;
};
const props = (page: Page) => page.evaluate(() => { const d = JSON.parse(document.body.dataset.openworldDrawn!) as Record<string, number>; return (d['prop-boulder'] ?? 0) + (d['prop-tree'] ?? 0) + (d['prop-boulder-hi'] ?? 0) + (d['prop-tree-hi'] ?? 0); });
/** A cell next to the spawn that holds a boulder or a tree, and a free cell beside it. */
const obstacle = (page: Page) =>
  page.evaluate((seed) => {
    const w = window as unknown as Break;
    const around = [[-1, 0], [1, 0]]; // beside it on its row: a plain Right or Left arrow steps onto it
    for (let d = 1; d < 12; d++) {
      for (let q = -d; q <= d; q++) {
        for (let r = -d; r <= d; r++) {
          if (!w.__openworldCanBreak(seed, q, r)) continue;
          const free = around.map(([a, b]) => [q + a!, r + b!]).find(([x, y]) => !w.__openworldCanBreak(seed, x!, y!));
          if (free) return { cell: [q, r], free };
        }
      }
    }
    throw new Error('no obstacle near the spawn');
  }, PUBLIC);

test('a break signed by another hero opens the cell here, once, and a forged one does nothing; a newcomer is given it, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  const { cell } = await obstacle(page);
  const before = await props(page);
  const send = (forge: boolean) =>
    page.evaluate(
      async ([seed, q, r, forged]) => {
        const w = window as unknown as Hook;
        const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
        const bytes = new Uint8Array(10);
        const view = new DataView(bytes.buffer);
        bytes.set([1, 1]);
        view.setUint32(2, seed as number);
        view.setInt16(6, q as number);
        view.setInt16(8, r as number);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, bytes));
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        const msg = new Uint8Array(106);
        const mv = new DataView(msg.buffer);
        msg.set([2, 3]);
        mv.setUint32(2, seed as number);
        mv.setInt16(6, (q as number) + (forged ? 1 : 0)); // a signature for another cell
        mv.setInt16(8, r as number);
        msg.set(pub, 10);
        msg.set(sig, 42);
        w.__netPeerIn(Array.from(msg), 'p');
      },
      [PUBLIC, cell![0]!, cell![1]!, forge] as const,
    );
  await send(true);
  await page.waitForTimeout(300);
  expect(await props(page)).toBe(before);
  await send(false);
  await expect.poll(() => props(page)).toBe(before - 1);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-broken', '1');
  await page.waitForTimeout(300);
  await send(false); // the same cell again
  await page.waitForTimeout(300);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-broken', '1');
  // a newcomer is given the held break, 106 bytes, to it alone
  await page.evaluate(() => (window as unknown as Hook).__netPeerJoin('q'));
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m.length === 106).length)).toBe(1);
});

test('an enemy beaten by another hero is gone here, once, and a forged one does nothing, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  // the first generated enemy near the spawn: the rule of the engine says which cells start one
  const enemy = await page.evaluate(() => {
    const w = window as unknown as Break & { __openworldIsEnemy: (seed: number, q: number, r: number) => boolean };
    for (let d = 1; d < 80; d++) for (let q = -d; q <= d; q++) for (let r = -d; r <= d; r++) if (w.__openworldIsEnemy(1305, q, r)) return [q, r];
    return null;
  });
  expect(enemy).not.toBeNull();
  const send = (forge: boolean) =>
    page.evaluate(
      async ([seed, q, r, forged]) => {
        const w = window as unknown as Hook;
        const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
        const bytes = new Uint8Array(10);
        const view = new DataView(bytes.buffer);
        bytes.set([1, 2]); // kind 2: beaten
        view.setUint32(2, seed as number);
        view.setInt16(6, q as number);
        view.setInt16(8, r as number);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, bytes));
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        const msg = new Uint8Array(106);
        const mv = new DataView(msg.buffer);
        msg.set([2, 5]); // type 5: beaten
        mv.setUint32(2, seed as number);
        mv.setInt16(6, (q as number) + (forged ? 1 : 0)); // a signature for another cell
        mv.setInt16(8, r as number);
        msg.set(pub, 10);
        msg.set(sig, 42);
        w.__netPeerIn(Array.from(msg), 'p');
      },
      [PUBLIC, enemy![0]!, enemy![1]!, forge] as const,
    );
  await send(true);
  await page.waitForTimeout(300);
  await expect(page.locator('body')).not.toHaveAttribute('data-openworld-beaten', '1');
  await send(false);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-beaten', '1');
  await send(false); // the same enemy again
  await page.waitForTimeout(300);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-beaten', '1');
});

// #1305: a boss lair another hero took. The lair is the world's own (`world_lairs`), read through the test hook.
test('a boss lair another hero took is heard here, once, not counted, and a forged one does nothing, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  const lair = await page.evaluate(
    (seed) => (window as unknown as Hook & { __openworldLairs: (seed: number) => [number, number][] }).__openworldLairs(seed)[0],
    PUBLIC,
  );
  const send = (forge: boolean) =>
    page.evaluate(
      async ([seed, q, r, forged]) => {
        const w = window as unknown as Hook;
        const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
        const bytes = new Uint8Array(10);
        const view = new DataView(bytes.buffer);
        bytes.set([1, 3]); // kind 3: a lair taken
        view.setUint32(2, seed as number);
        view.setInt16(6, q as number);
        view.setInt16(8, r as number);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, bytes));
        const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        const msg = new Uint8Array(106);
        const mv = new DataView(msg.buffer);
        msg.set([2, 6]); // type 6: lair
        mv.setUint32(2, seed as number);
        mv.setInt16(6, (q as number) + (forged ? 1 : 0)); // a signature for another cell
        mv.setInt16(8, r as number);
        msg.set(pub, 10);
        msg.set(sig, 42);
        w.__netPeerIn(Array.from(msg), 'p');
      },
      [PUBLIC, lair![0]!, lair![1]!, forge] as const,
    );
  await send(true);
  await page.waitForTimeout(300);
  await expect(page.locator('body')).not.toHaveAttribute('data-openworld-lairs-heard', '0');
  await send(false);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-lairs-heard', '0'); // heard, shown beaten, never counted here
  await send(false); // the same lair again
  await page.waitForTimeout(300);
  await expect(page.locator('body')).toHaveAttribute('data-openworld-lairs-heard', '0');
  await expect(page.locator('body')).not.toHaveAttribute('data-openworld-lairs-beaten', '0'); // the victim's own count does not move
});

test('the obstacle the hero breaks goes out signed, 106 bytes, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  const { cell, free } = await obstacle(page);
  await page.evaluate((hero) => (window as unknown as Break).__openworldFixture({ hero: hero as [number, number], troop: [], enemies: [] }), free);
  await page.keyboard.press(free![0]! < cell![0]! ? 'ArrowRight' : 'ArrowLeft');
  await expect(page.locator('body')).toHaveAttribute('data-openworld-broken', '1');
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m.length === 106 && m[1] === 3).length)).toBe(1);
});

// The save and its reload are unit tested (worldnet.test.ts, 'saves what is signed, applies it after a reload'): no reload here,
// a reload of this WebGL world costs seconds on a CI runner (#1481).
test('a hero who joins late is given the broken cell, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  const { cell, free } = await obstacle(page);
  await page.evaluate((hero) => (window as unknown as Break).__openworldFixture({ hero: hero as [number, number], troop: [], enemies: [] }), free);
  await page.keyboard.press(free![0]! < cell![0]! ? 'ArrowRight' : 'ArrowLeft');
  await expect(page.locator('body')).toHaveAttribute('data-openworld-broken', '1');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ab-alone.world-events'))).toContain('"v":1');
  await page.evaluate(() => ((window as unknown as Hook).__out.length = 0)); // the break's own 106 bytes are not the re-serve
  await page.evaluate(() => (window as unknown as Hook).__netPeerJoin('q'));
  await expect.poll(() => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m.length === 106 && m[1] === 3).length)).toBe(1); // re-served
});

// The HUD of the public world on a phone (390x844): the name field and Hide are touch targets of 44 px, and the plate leaves the hero
// and the troop (the centre of the screen) free. A hero on our own cell is lifted above ours.
test('on a phone the name field and Hide are 44 px high and the plate leaves the play area free, #1305', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page, PUBLIC);
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerJoin('p');
    w.__netPeerIn([2, 1, 66, 111, 98], 'p');
    w.__netPeerIn([2, 2, 0, 0, 0, 0, 0], 'p'); // on our own cell
  });
  await expect(page.locator('.peer-tag')).toHaveText('Bob');
  await showHud(page, '#openworld-name'); // a phone held upright enters with the bar: its chip opens the online row (#1657)
  const field = (await page.locator('#openworld-name').boundingBox())!;
  const hide = (await page.locator('#openworld-hide').boundingBox())!;
  expect(field.height).toBeGreaterThanOrEqual(44);
  expect(hide.height).toBeGreaterThanOrEqual(44);
  const plate = (await page.locator('#openworld-hud').boundingBox())!;
  console.log('plate', JSON.stringify(plate), 'field', JSON.stringify(field), 'hide', JSON.stringify(hide));
  await page.screenshot({ path: 'test-results/peers-phone-hud.png' });
  expect(plate.y).toBeGreaterThanOrEqual(844 * 0.5); // the lower half only: the hero stands at the middle
  const tower = (await page.locator('#openworld-dungeon').boundingBox())!;
  expect(tower.y + tower.height).toBeLessThanOrEqual(plate.y + plate.height); // the plate's main button stays in view: the online row is what scrolls
});

// #1305: the army of another hero. Its troop goes over as offsets (15 bytes for six marbles) and is drawn in the colour of its hero.
test('the army of another hero is drawn round it, and ours goes out as 15 bytes, #1305', async ({ page }) => {
  await enter(page, PUBLIC);
  await page.evaluate(() => {
    const w = window as unknown as Hook;
    w.__netPeerJoin('p');
    w.__netPeerIn([2, 1, 66, 111, 98], 'p'); // Bob
    w.__netPeerIn([2, 2, 0, 3, 0, 0, 0], 'p'); // three cells east of us
    w.__netPeerIn([2, 4, 6, 1, 0, 255, 0, 0, 1, 0, 255, 1, 255, 255, 1], 'p'); // a full troop: offsets (1,0) (-1,0) (0,1) (0,-1) (1,-1) (-1,1)
  });
  await expect(page.locator('#openworld-peers')).toHaveAttribute('data-peers', '1');
  await page.screenshot({ path: 'test-results/peers-army.png' });
  const troops = () => page.evaluate(() => (window as unknown as Hook).__out.filter((m) => m[1] === 4));
  await expect.poll(async () => (await troops()).length).toBeGreaterThanOrEqual(1);
  expect((await troops())[0]).toHaveLength(33); // 3 bytes and 15 offsets (#1504)
});

// #1447: the hero of another player on water rides a boat, as ours does. Seed 1305 has water on (25,0) and (25,1), sand on (24,0).
test('the hero of another player rides a boat on water and has none on land, #1447', async ({ page }) => {
  await enter(page, PUBLIC);
  await page.evaluate(() => (window as unknown as { __openworldFixture: (f: object) => void }).__openworldFixture({ hero: [26, 0], troop: [], enemies: [] }));
  await page.evaluate(
    ([hello, wet]) => {
      const w = window as unknown as Hook;
      w.__netPeerJoin('p');
      w.__netPeerIn(hello!, 'p');
      w.__netPeerIn(wet!, 'p');
    },
    [[2, 1], pos(25, 0, 0)],
  );
  const peers = page.locator('#openworld-peers');
  await expect(peers).toHaveAttribute('data-boats', '1');
  await page.screenshot({ path: 'test-results/peers-boat.png' });
  await pastGap(page);
  await page.evaluate((land) => (window as unknown as Hook).__netPeerIn(land, 'p'), pos(24, 1, 1));
  await expect(peers).toHaveAttribute('data-boats', '0');
});
