// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const flush = (): Promise<void> => new Promise((done) => setTimeout(done, 20));
/** Waits (a signature takes a while on a loaded machine) until `check` holds. */
const until = (check: () => boolean): Promise<void> =>
  vi.waitFor(() => {
    if (!check()) throw new Error('not yet');
  });
import * as THREE from 'three/webgpu';
import type { PeerNet } from './p2p';
import { generateKeys } from './moverecord';
import type { Store } from './quality';
import { EVENTS_KEY, SYNC_MAX, signBeaten, signBreak, signLair } from './worldevents';
import { SETTLE_MS, decode, encodeEmote, encodeBreak, encodeHello, encodePos, encodeTroop, PUBLIC_SEED, roomOf } from './worldpeers';
import { RETRY_MS, WorldPeersHost, type NetStatus } from './worldnet';
import { PeersLayer } from './worldpeersview';

class FakeNet implements PeerNet {
  sent: [Uint8Array, string | undefined][] = [];
  closed = false;
  data: (d: Uint8Array, peer: string) => void = () => {};
  join: (peer: string) => void = () => {};
  leave: (peer: string) => void = () => {};
  fail: (message: string) => void = () => {};
  send(d: Uint8Array, to?: string): void {
    this.sent.push([d, to]);
  }
  onData(cb: (d: Uint8Array, peer: string) => void): void {
    this.data = cb;
  }
  onJoin(cb: (peer: string) => void): void {
    this.join = cb;
  }
  onLeave(cb: (peer: string) => void): void {
    this.leave = cb;
  }
  onError(cb: (message: string) => void): void {
    this.fail = cb;
  }
  close(): void {
    this.closed = true;
  }
}

function setup(allowed = true, store: Store = null) {
  const nets: FakeNet[] = [];
  const rooms: string[] = [];
  const clock = { now: 0 };
  const reports: NetStatus[] = [];
  const lists: { name: string; tiles: number }[][] = [];
  const applied: (readonly [number, number])[] = [];
  const beaten: (readonly [number, number])[] = [];
  const lairs: (readonly [number, number])[] = [];
  const keysOnce = generateKeys();
  const me = { name: '' };
  const root = document.createElement('div');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 1000);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  const world = { tile: () => ({ terrain: 'grass' as const, height: 1, biome: 'meadow' as const }) };
  const host = new WorldPeersHost(
    (room) => {
      rooms.push(room);
      const n = new FakeNet();
      nets.push(n);
      return n;
    },
    () => allowed,
    root,
    (status) => reports.push(status),
    () => me.name,
    { keys: () => keysOnce, canBreak: (_seed, q) => q >= 0, apply: (cell) => applied.push(cell), canBeaten: (_seed, q) => q >= 0, beat: (cell) => beaten.push(cell), canLair: (_seed, q) => q >= 0, lair: (cell) => lairs.push(cell) },
    () => clock.now,
    store,
    (list) => lists.push(list),
  );
  const enter = (seed = PUBLIC_SEED) => host.enter(seed, scene, camera, world as never);
  return { lists, host, nets, rooms, clock, root, scene, enter, reports, me, applied, beaten, lairs, keysOnce };
}

describe('WorldPeersHost emotes and heroes nearby (#1671)', () => {
  it('sends an emote as one index, at most one every 2 s, and refuses an unknown index or a closed room', () => {
    const { nets, host, clock, enter } = setup();
    expect(host.speak(0)).toBe(false); // no room yet
    enter();
    expect(host.speak(9)).toBe(false);
    expect(host.speak(-1)).toBe(false);
    expect(host.speak(1.5)).toBe(false);
    expect(nets[0]!.sent).toEqual([]);
    expect(host.speak(2)).toBe(true);
    expect(nets[0]!.sent).toEqual([[encodeEmote(2), undefined]]);
    clock.now = 1999;
    expect(host.speak(3)).toBe(false);
    clock.now = 2000;
    expect(host.speak(3)).toBe(true);
    expect(nets[0]!.sent).toHaveLength(2);
  });

  it('shows the emote of a peer for a few seconds, drops an unknown id and a flood', () => {
    const { nets, host, clock, root, enter } = setup();
    enter();
    const n = nets[0]!;
    n.join('p');
    n.data(encodeHello('Ana'), 'p');
    n.data(encodePos(1, 0, 0), 'p');
    n.data(encodeEmote(1), 'p');
    host.frame(10, [0, 0]);
    expect(root.dataset.say).toBe('GG');
    clock.now = 100;
    n.data(encodeEmote(4), 'p'); // a flood: the first one stays
    n.data(new Uint8Array([2, 7, 99]), 'p'); // an unknown id: dropped
    host.frame(11, [0, 0]);
    expect(root.dataset.say).toBe('GG');
    host.frame(4010, [0, 0]);
    expect(root.dataset.say).toBe('');
  });

  it('lists the heroes nearby with their distance, once per change, and clears it when the room closes', () => {
    const { nets, host, lists, enter } = setup();
    enter();
    const n = nets[0]!;
    n.join('p');
    n.data(encodeHello('Ana'), 'p');
    n.data(encodePos(3, 0, 0), 'p');
    n.join('q');
    n.data(encodeHello(), 'q');
    n.data(encodePos(9, 0, 0), 'q');
    host.frame(10, [0, 0]);
    host.frame(20, [0, 0]);
    expect(lists.at(-1)).toEqual([
      { name: 'Ana', tiles: 3 },
      { name: 'Another hero', tiles: 9 },
    ]);
    const count = lists.length;
    host.frame(30, [0, 0]);
    expect(lists).toHaveLength(count); // unchanged: not told again
    host.hide();
    expect(lists.at(-1)).toEqual([]);
  });
});

describe('WorldPeersHost', () => {
  it('joins the one room of the public seed, and only that', () => {
    const { rooms, enter } = setup();
    enter(7);
    expect(rooms).toEqual([]); // a private world touches no network
    enter();
    expect(rooms).toEqual([roomOf(PUBLIC_SEED)]);
  });

  it('contacts nobody while online play is not allowed (consent declined)', () => {
    const { rooms, host, enter } = setup(false);
    enter();
    expect(rooms).toEqual([]);
    expect(host.frame(0, [0, 0])).toBe(false); // nothing running: harmless
    host.leave();
  });

  it('greets a peer that joins with a Hello and its place, to that peer alone', () => {
    const { nets, host, enter } = setup();
    enter();
    nets[0]!.join('p');
    expect(nets[0]!.sent).toEqual([[encodeHello(), 'p']]); // no place known yet
    host.frame(10, [3, 1]);
    nets[0]!.sent.length = 0;
    nets[0]!.join('q');
    expect(nets[0]!.sent).toEqual([
      [encodeHello(), 'q'],
      [encodePos(3, 1, 0), 'q'],
    ]);
  });

  it('hands the time the boats bob at to the layer that draws the peers, once per frame', () => {
    const { host, enter } = setup();
    enter();
    const update = vi.spyOn(PeersLayer.prototype, 'update');
    host.frame(10, [3, 1], [[3, 2]], 10);
    host.frame(20, [3, 1], [], null);
    expect(update.mock.calls.map((call: unknown[]) => call[3])).toEqual([10, null]);
    update.mockRestore();
  });

  it('sends the hero position on change, 4 Hz at most, to every peer', () => {
    const { nets, host, enter } = setup();
    enter();
    host.frame(0, [0, 0]);
    host.frame(100, [1, 0]);
    host.frame(250, [1, 0]);
    host.frame(300, [2, 0]);
    host.frame(500, [2, 0]);
    expect(nets[0]!.sent.map(([d, to]) => [decode(d), to])).toEqual([
      [{ t: 'pos', q: 0, r: 0, seq: 0 }, undefined],
      [{ t: 'pos', q: 1, r: 0, seq: 1 }, undefined],
      [{ t: 'pos', q: 2, r: 0, seq: 2 }, undefined],
    ]);
  });

  it('shows a peer after its Hello and position, and reports the change once', () => {
    const { nets, host, root, enter } = setup();
    enter();
    nets[0]!.data(encodePos(1, 0, 0), 'p'); // no Hello: refused
    expect(host.frame(0, [0, 0])).toBe(false);
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(1, 0, 0), 'p');
    expect(host.frame(1, [0, 0])).toBe(true);
    expect(root.dataset.peers).toBe('1');
    expect(host.frame(2, [0, 0])).toBe(false);
  });

  it('drops garbage bytes and a peer that left or went silent', () => {
    const { nets, host, root, clock, enter } = setup();
    enter();
    nets[0]!.data(Uint8Array.of(9, 9, 9), 'p');
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p');
    host.frame(1, [0, 0]);
    expect(root.dataset.edges).toBe('200');
    nets[0]!.leave('p');
    host.frame(2, [0, 0]);
    expect(root.dataset.peers).toBe('0');
    nets[0]!.data(encodeHello(), 'q');
    clock.now = 100;
    nets[0]!.data(encodePos(1, 0, 0), 'q');
    host.frame(200, [0, 0]);
    host.frame(100 + 10_001, [0, 0]);
    expect(root.dataset.peers).toBe('0');
  });

  it('leaves: closes the room, clears the screen, and stops sending', () => {
    const { nets, host, root, scene, enter } = setup();
    enter();
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p');
    host.frame(0, [0, 0]);
    host.leave();
    expect(nets[0]!.closed).toBe(true);
    expect(root.children).toHaveLength(0);
    expect(scene.getObjectByName('peers')).toBeUndefined();
    nets[0]!.sent.length = 0;
    expect(host.frame(500, [5, 5])).toBe(false);
    expect(nets[0]!.sent).toEqual([]);
    host.leave(); // twice is harmless
  });

  it('entering another world leaves the first one', () => {
    const { nets, enter } = setup();
    enter();
    enter(7);
    expect(nets[0]!.closed).toBe(true);
    enter();
    expect(nets).toHaveLength(2);
  });

  it('reads the page clock when none is given', () => {
    const net = new FakeNet();
    const host = new WorldPeersHost(() => net, () => true, document.createElement('div'), () => {}, () => '', { keys: () => generateKeys(), canBreak: () => true, apply: () => {}, canBeaten: () => true, beat: () => {}, canLair: () => true, lair: () => {} });
    const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 1000);
    host.enter(PUBLIC_SEED, new THREE.Scene(), camera, { tile: () => undefined });
    net.data(encodeHello(), 'p');
    net.data(encodePos(1, 0, 0), 'p');
    expect(host.frame(performance.now(), [0, 0])).toBe(true);
  });

  it('sends the public name in its Hello, to a peer that joins and again when the name changes', () => {
    const { nets, host, me, enter } = setup();
    me.name = 'Ana';
    enter();
    nets[0]!.join('p');
    expect(decode(nets[0]!.sent[0]![0])).toEqual({ t: 'hello', name: 'Ana' });
    nets[0]!.sent.length = 0;
    me.name = 'Anna';
    host.setName();
    expect(nets[0]!.sent.map(([d, to]) => [decode(d), to])).toEqual([[{ t: 'hello', name: 'Anna' }, undefined]]);
    host.leave();
    nets[0]!.sent.length = 0;
    host.setName(); // no room: nothing to tell
    expect(nets[0]!.sent).toEqual([]);
  });

  it('shows the name of a peer on the screen', () => {
    const { nets, host, root, enter } = setup();
    enter();
    nets[0]!.data(encodeHello('Bob'), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p');
    host.frame(0, [0, 0]);
    expect(root.querySelector('.peer-edge')!.textContent).toBe('Bob 200');
  });

  it('reports the status the player reads: nobody yet, a count, and nothing in a private world', () => {
    const { nets, host, reports, enter } = setup();
    enter(7);
    expect(reports.at(-1)).toEqual({ available: false, hidden: false, text: '' });
    enter();
    expect(reports.at(-1)).toEqual({ available: true, hidden: false, text: 'Online: nobody else here yet.' });
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(1, 0, 0), 'p');
    host.frame(0, [0, 0]);
    expect(reports.at(-1)!.text).toBe('Online: 1 other hero here.');
    nets[0]!.data(encodeHello(), 'q');
    nets[0]!.data(encodePos(2, 0, 0), 'q');
    host.frame(200, [0, 0]);
    expect(reports.at(-1)!.text).toBe('Online: 2 other heroes here.');
    const count = reports.length;
    host.frame(400, [0, 0]);
    expect(reports).toHaveLength(count); // only a change is reported
    host.leave();
    expect(reports.at(-1)).toEqual({ available: false, hidden: false, text: '' });
  });

  it('shows a join error to the player, and clears it when a peer connects', () => {
    const { nets, host, reports, enter } = setup();
    enter();
    nets[0]!.fail('could not connect to peer p after exchanging SDP; configure TURN servers');
    expect(reports.at(-1)!.text).toBe('Online: a hero was found but the direct connection failed. Your network may block it.');
    nets[0]!.fail('handshake timed out');
    expect(reports.at(-1)!.text).toBe('Online: a connection problem, still trying.');
    nets[0]!.join('p');
    host.frame(0, [0, 0]);
    expect(reports.at(-1)!.text).toBe('Online: nobody else here yet.');
  });

  it('joins the room again RETRY_MS after a join error with nobody connected, keeping the error text (#1670)', () => {
    const { nets, host, reports, rooms, clock, enter } = setup();
    enter();
    clock.now = 1000;
    nets[0]!.fail('could not connect to peer p after exchanging SDP');
    nets[0]!.fail('handshake timed out'); // a second error does not push the retry back
    host.frame(1000 + RETRY_MS - 1, [0, 0]);
    expect(rooms).toHaveLength(1);
    host.frame(1000 + RETRY_MS, [0, 0]);
    expect(nets[0]!.closed).toBe(true);
    expect(rooms).toHaveLength(2);
    expect(reports.at(-1)!.text).toBe('Online: a connection problem, still trying.');
    host.frame(1000 + RETRY_MS + 1, [0, 0]);
    expect(rooms).toHaveLength(2); // the timer is reset
    clock.now = 1000 + RETRY_MS + 100;
    nets[1]!.join('p');
    nets[1]!.data(encodeHello(), 'p');
    nets[1]!.data(encodePos(200, 0, 0), 'p');
    host.frame(1000 + RETRY_MS + 200, [0, 0]);
    expect(reports.at(-1)!.text).toBe('Online: 1 other hero here.');
  });

  it('does not rejoin when a hero is connected, or after the join error cleared', () => {
    const { nets, host, rooms, clock, enter } = setup();
    enter();
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p');
    clock.now = 0;
    nets[0]!.fail('handshake timed out');
    host.frame(200, [0, 0]);
    clock.now = RETRY_MS;
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p'); // still heard
    host.frame(RETRY_MS + 200, [0, 0]);
    expect(rooms).toHaveLength(1);
    nets[0]!.join('q'); // a peer connected: the retry is cancelled
    host.frame(RETRY_MS * 3, [0, 0]);
    expect(rooms).toHaveLength(1);
  });

  it('Hide leaves the room and the screen and Show joins again; leaving the world forgets both', () => {
    const { nets, host, reports, root, enter, rooms } = setup();
    enter();
    nets[0]!.data(encodeHello(), 'p');
    nets[0]!.data(encodePos(200, 0, 0), 'p');
    host.frame(0, [0, 0]);
    host.hide();
    expect(nets[0]!.closed).toBe(true);
    expect(root.children).toHaveLength(0);
    expect(reports.at(-1)).toEqual({ available: true, hidden: true, text: 'Hidden: nobody sees you and you see nobody.' });
    expect(host.frame(10, [0, 0])).toBe(false);
    host.show();
    expect(rooms).toHaveLength(2);
    expect(reports.at(-1)!.hidden).toBe(false);
    host.show(); // already shown: no second room
    expect(rooms).toHaveLength(2);
    host.hide();
    host.hide(); // twice is harmless
    host.leave();
    host.show(); // the world was left: nothing to join
    expect(rooms).toHaveLength(2);
  });

  describe('the broken cells (#1305)', () => {
    const sentBreaks = (net: FakeNet) => net.sent.filter(([d]) => d[1] === 3);
    const sentBeaten = (net: FakeNet) => net.sent.filter(([d]) => d[1] === 5);
    const sentLair = (net: FakeNet) => net.sent.filter(([d]) => d[1] === 6);

    it('signs the cell the hero broke and sends it to every peer', async () => {
      const { nets, host, enter, keysOnce } = setup();
      enter();
      host.broke([4, -2]);
      await until(() => sentBreaks(nets[0]!).length === 1);
      const [bytes, to] = sentBreaks(nets[0]!)[0]!;
      expect(to).toBeUndefined();
      const message = decode(bytes!);
      expect(message).toMatchObject({ t: 'break', event: { seed: PUBLIC_SEED, q: 4, r: -2, pub: (await keysOnce).pub } });
    });

    it('says nothing when no room is open: private world, declined, hidden or left', async () => {
      const { nets, host, enter } = setup();
      host.broke([1, 1]); // nothing entered
      enter();
      host.hide();
      host.broke([1, 1]);
      await flush();
      host.show();
      host.leave();
      expect(sentBreaks(nets[0]!)).toEqual([]);
      expect(sentBreaks(nets[1]!)).toEqual([]);
    });

    it('a room left while the signature is made gets nothing', async () => {
      const { nets, host, enter } = setup();
      enter();
      host.broke([1, 1]);
      host.leave();
      await flush();
      expect(sentBreaks(nets[0]!)).toEqual([]);
    });

    it('applies a valid break from a peer once, and tells it to nobody else', async () => {
      const { nets, applied, enter, keysOnce } = setup();
      enter();
      const event = await signBreak(await keysOnce, PUBLIC_SEED, 3, 5);
      nets[0]!.data(encodeBreak(event), 'p');
      await until(() => applied.length === 1);
      expect(applied).toEqual([[3, 5]]);
      nets[0]!.data(encodeBreak(event), 'q'); // the same cell again, from another peer
      await flush();
      expect(applied).toEqual([[3, 5]]);
      expect(sentBreaks(nets[0]!)).toEqual([]);
    });

    it('refuses a break of another world, one the rules refuse, a forged signature and a flood', async () => {
      const { nets, applied, clock, enter, keysOnce } = setup();
      enter();
      const keys = await keysOnce;
      nets[0]!.data(encodeBreak(await signBreak(keys, 7, 3, 5)), 'p'); // another seed
      clock.now = 1000;
      nets[0]!.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, -3, 5)), 'p'); // canBreak says no
      clock.now = 2000;
      const forged = await signBreak(keys, PUBLIC_SEED, 3, 6);
      nets[0]!.data(encodeBreak({ ...forged, q: 4 }), 'p'); // signed for another cell
      clock.now = 3000;
      await flush();
      expect(applied).toEqual([]);
      nets[0]!.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 8, 8)), 'p');
      nets[0]!.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 9, 9)), 'p'); // 0 ms after: dropped
      await until(() => applied.length === 1);
      await flush();
      expect(applied).toEqual([[8, 8]]);
    });

    it('a peer reports events far from where it stands only up to the sync cap; near its own place there is no cap', async () => {
      const { nets, applied, clock, enter, keysOnce } = setup();
      enter();
      const keys = await keysOnce;
      const net = nets[0]!;
      net.data(encodeHello(), 'p');
      net.data(encodePos(20, 0, 1), 'p');
      for (let i = 0; i < SYNC_MAX + 1; i++) {
        clock.now += 1000;
        net.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 100 + i, 0)), 'p'); // far from (20, 0)
      }
      clock.now += 1000;
      net.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 22, 0)), 'p'); // two cells from it
      await vi.waitFor(() => expect(applied.length).toBe(SYNC_MAX + 1), { timeout: 20000 });
      await flush();
      expect(applied.length).toBe(SYNC_MAX + 1);
      expect(applied).toContainEqual([22, 0]);
      expect(applied).not.toContainEqual([100 + SYNC_MAX, 0]);
    }, 30000);

    it('a place a peer jumped to makes its events near only after SETTLE_MS', async () => {
      const { nets, applied, clock, enter, keysOnce } = setup();
      enter();
      const keys = await keysOnce;
      const net = nets[0]!;
      net.data(encodeHello(), 'p');
      net.data(encodePos(0, 0, 1), 'p');
      for (let i = 0; i < SYNC_MAX; i++) {
        clock.now += 200;
        net.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 100 + i, 0)), 'p'); // far: the whole cap
      }
      await vi.waitFor(() => expect(applied.length).toBe(SYNC_MAX), { timeout: 20000 });
      clock.now += 200;
      net.data(encodePos(5000, 0, 2), 'p'); // 5000 cells in 40 s
      clock.now += 200;
      net.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 5000, 1)), 'p'); // right at the place it claims, but it just jumped there
      await flush();
      expect(applied.length).toBe(SYNC_MAX);
      clock.now += SETTLE_MS;
      net.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, 5001, 1)), 'p');
      await vi.waitFor(() => expect(applied.length).toBe(SYNC_MAX + 1));
    }, 30000);

    it('sends a beaten enemy signed as type 5 to every peer, and only one the rules allow', async () => {
      const { nets, host, enter, keysOnce } = setup();
      enter();
      host.beaten([4, -2]);
      host.beaten([-1, 0]); // canBeaten says no
      await until(() => sentBeaten(nets[0]!).length === 1);
      const [bytes, to] = sentBeaten(nets[0]!)[0]!;
      expect(to).toBeUndefined();
      expect(decode(bytes!)).toMatchObject({ t: 'break', event: { kind: 'beaten', seed: PUBLIC_SEED, q: 4, r: -2, pub: (await keysOnce).pub } });
    });

    it('applies a valid beaten enemy from a peer once, and refuses one that is no enemy', async () => {
      const { nets, beaten, enter, keysOnce, clock } = setup();
      enter();
      const keys = await keysOnce;
      nets[0]!.data(encodeBreak(await signBeaten(keys, PUBLIC_SEED, -3, 5)), 'p'); // canBeaten says no
      clock.now = 1000;
      nets[0]!.data(encodeBreak(await signBeaten(keys, PUBLIC_SEED, 3, 5)), 'p');
      await until(() => beaten.length === 1);
      expect(beaten).toEqual([[3, 5]]);
      clock.now = 2000;
      nets[0]!.data(encodeBreak(await signBeaten(keys, PUBLIC_SEED, 3, 5)), 'q'); // the same enemy from another peer
      await flush();
      expect(beaten).toEqual([[3, 5]]);
    });

    it('tells a wild fight won as a beaten enemy, named by the cell it started on, now or when the room opens, and only for the public world (#1511)', async () => {
      const { nets, host, enter, keysOnce } = setup();
      host.wildWon(PUBLIC_SEED, [4, -2]); // the room is closed: owed
      host.wildWon(PUBLIC_SEED, [-1, 0]); // canBeaten says no
      host.wildWon(7, [4, -2]); // another seed
      await flush();
      expect(nets).toHaveLength(0);
      enter();
      await until(() => sentBeaten(nets[0]!).length === 1);
      expect(decode(sentBeaten(nets[0]!)[0]![0]!)).toMatchObject({ t: 'break', event: { kind: 'beaten', seed: PUBLIC_SEED, q: 4, r: -2, pub: (await keysOnce).pub } });
      host.wildWon(PUBLIC_SEED, [4, -2]); // the room is open: sent at once
      await until(() => sentBeaten(nets[0]!).length === 2);
    });

    it('sends a lair taken signed as type 6 to every peer, only for the public world', async () => {
      const { nets, host, enter, keysOnce } = setup();
      enter();
      host.lairWon(PUBLIC_SEED, [4, -2]);
      host.lairWon(7, [4, -2]); // another seed: not this room's
      await until(() => sentLair(nets[0]!).length === 1);
      const [bytes, to] = sentLair(nets[0]!)[0]!;
      expect(to).toBeUndefined();
      expect(decode(bytes!)).toMatchObject({ t: 'break', event: { kind: 'lair', seed: PUBLIC_SEED, q: 4, r: -2, pub: (await keysOnce).pub } });
    });

    it('a lair taken while the room is closed (the fight leaves the world) is sent when the room opens, once', async () => {
      const { nets, host, enter } = setup();
      host.lairWon(PUBLIC_SEED, [4, -2]);
      await flush();
      expect(nets).toHaveLength(0);
      enter();
      await until(() => sentLair(nets[0]!).length === 1);
      host.leave();
      enter();
      await flush();
      expect(sentLair(nets[1]!)).toHaveLength(0);
    });

    it('applies a lair another hero took once, and refuses one that is no lair', async () => {
      const { nets, lairs, enter, keysOnce, clock } = setup();
      enter();
      const keys = await keysOnce;
      nets[0]!.data(encodeBreak(await signLair(keys, PUBLIC_SEED, -3, 5)), 'p'); // canLair says no
      clock.now = 1000;
      nets[0]!.data(encodeBreak(await signLair(keys, PUBLIC_SEED, 3, 5)), 'p');
      await until(() => lairs.length === 1);
      expect(lairs).toEqual([[3, 5]]);
      clock.now = 2000;
      nets[0]!.data(encodeBreak(await signLair(keys, PUBLIC_SEED, 3, 5)), 'q'); // the same lair from another peer
      await flush();
      expect(lairs).toEqual([[3, 5]]);
    });

    describe('saved events (#1305)', () => {
      const memory = () => {
        const data = new Map<string, string>();
        return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
      };
      const savedCells = (store: ReturnType<typeof memory>) => (JSON.parse(store.data.get(EVENTS_KEY) ?? '{"events":[]}') as { events: { q: number }[] }).events.map((e) => e.q);

      it('saves what is signed, applies it after a reload, and gives it to a joiner (a break, a beaten enemy, a lair)', async () => {
        const store = memory();
        const first = setup(true, store);
        first.enter();
        const keys = await first.keysOnce;
        first.host.broke([1, 0]);
        first.host.beaten([2, 0]);
        first.host.lairWon(PUBLIC_SEED, [3, 0]);
        await until(() => savedCells(store).length === 3);
        first.host.leave(); // leaving does not wipe the saved set
        expect([...savedCells(store)].sort()).toEqual([1, 2, 3]); // three signatures finish in any order: the set is a union, no order
        // the page reloads: a new host on the same store
        const again = setup(true, store);
        again.enter();
        await until(() => again.applied.length + again.beaten.length + again.lairs.length === 3);
        expect(again.applied).toEqual([[1, 0]]);
        expect(again.beaten).toEqual([[2, 0]]);
        expect(again.lairs).toEqual([[3, 0]]);
        again.nets[0]!.join('late');
        again.host.frame(1000, [0, 0]);
        again.host.frame(1300, [0, 0]);
        again.host.frame(1500, [0, 0]);
        const given = again.nets[0]!.sent.filter(([d, to]) => to === 'late' && d.length === 106).map(([d]) => (decode(d) as { event: { q: number; pub: string } }).event);
        expect(given.map((e) => e.q).sort()).toEqual([1, 2, 3]);
        expect(given[0]!.pub).toBe(keys.pub);
        // entering again after a leave brings the world back
        again.host.leave();
        const third = setup(true, store);
        third.enter();
        await until(() => third.applied.length === 1);
        expect([...savedCells(store)].sort()).toEqual([1, 2, 3]);
      });

      it('drops a saved event that is forged, of another seed, or against the rules, and keeps going', async () => {
        const store = memory();
        const keys = await generateKeys();
        const good = await signBreak(keys, PUBLIC_SEED, 4, 0);
        const forged = { ...(await signBreak(keys, PUBLIC_SEED, 5, 0)), q: 6 };
        const other = await signBreak(keys, 7, 8, 0);
        const noRule = await signBeaten(keys, PUBLIC_SEED, -1, 0); // canBeaten says no
        const noLair = await signLair(keys, PUBLIC_SEED, -2, 0);
        const noBreak = await signBreak(keys, PUBLIC_SEED, -3, 0);
        store.setItem(EVENTS_KEY, JSON.stringify({ v: 1, events: [forged, other, noRule, noLair, noBreak, good] }));
        const { applied, beaten, lairs, enter } = setup(true, store);
        enter();
        await until(() => applied.length === 1);
        await flush();
        expect(applied).toEqual([[4, 0]]);
        expect(beaten).toEqual([]);
        expect(lairs).toEqual([]);
        expect(savedCells(store)).toEqual([4]);
      });

      it('stores nothing for a private seed, and reapplies nothing after a Hide and Show', async () => {
        const store = memory();
        const { host, applied, enter } = setup(true, store);
        enter(7);
        host.broke([1, 0]); // no room: nothing signed
        await flush();
        expect(store.data.size).toBe(0);
        enter();
        host.broke([1, 0]);
        await until(() => savedCells(store).length === 1);
        host.hide();
        host.show();
        await flush();
        expect(applied).toEqual([]);
      });

      it('goes on when the room closes while the saved events are checked', async () => {
        const store = memory();
        const keys = await generateKeys();
        store.setItem(EVENTS_KEY, JSON.stringify({ v: 1, events: [await signBreak(keys, PUBLIC_SEED, 4, 0)] }));
        const { host, applied, enter } = setup(true, store);
        enter();
        host.leave();
        await flush();
        expect(applied).toEqual([]);
      });
    });

    it('a break that arrives after the room closed is dropped', async () => {
      const { nets, host, applied, enter, keysOnce } = setup();
      enter();
      nets[0]!.data(encodeBreak(await signBreak(await keysOnce, PUBLIC_SEED, 3, 5)), 'p');
      host.leave();
      await flush();
      expect(applied).toEqual([]);
    });

    it('gives a newcomer what it holds, newest first, one every 200 ms, and stops when it leaves', async () => {
      const { nets, host, clock, applied, enter, keysOnce } = setup();
      enter();
      const keys = await keysOnce;
      for (let q = 1; q <= 3; q++) {
        clock.now = q * 1000;
        nets[0]!.data(encodeBreak(await signBreak(keys, PUBLIC_SEED, q, 0)), `peer${q}`);
        await until(() => applied.length === q);
      }
      nets[0]!.join('new');
      nets[0]!.join('gone');
      nets[0]!.leave('gone');
      const qs = (): number[] => sentBreaks(nets[0]!).map(([d]) => (decode(d) as { event: { q: number } }).event.q);
      host.frame(1000, [0, 0]);
      expect(qs()).toEqual([3]);
      host.frame(1100, [0, 0]);
      expect(qs()).toEqual([3]); // too soon
      host.frame(1200, [0, 0]);
      host.frame(1400, [0, 0]);
      host.frame(1600, [0, 0]);
      expect(qs()).toEqual([3, 2, 1]);
      expect(sentBreaks(nets[0]!).every(([, to]) => to === 'new')).toBe(true);
    });

    it('holds its breaks through a Hide, and forgets them when the world is left', async () => {
      const { nets, host, enter } = setup();
      enter();
      host.broke([2, 2]);
      await until(() => sentBreaks(nets[0]!).length === 1);
      host.hide();
      host.show();
      nets[1]!.join('p');
      host.frame(0, [0, 0]);
      expect(sentBreaks(nets[1]!)).toHaveLength(1);
      host.leave();
      enter();
      nets[2]!.join('p');
      host.frame(0, [0, 0]);
      expect(sentBreaks(nets[2]!)).toEqual([]);
    });
  });

  describe('the armies (#1305)', () => {
    const troops = (net: FakeNet) => net.sent.filter(([d]) => d[1] === 4);

    it('sends the offsets of the hero troop when they change, 4 Hz at most, to every peer', () => {
      const { nets, host, enter } = setup();
      enter();
      host.frame(0, [0, 0], [[1, 0], [-1, 0]]);
      host.frame(100, [1, 0], [[2, 0], [0, 0]]); // the same offsets: nothing
      host.frame(300, [1, 0], [[2, 0]]);
      expect(troops(nets[0]!).map(([d, to]) => [decode(d), to])).toEqual([
        [{ t: 'troop', offsets: [[1, 0], [-1, 0]] }, undefined],
        [{ t: 'troop', offsets: [[1, 0]] }, undefined],
      ]);
    });

    it('gives a newcomer the troop with the hello and the place', () => {
      const { nets, host, enter } = setup();
      enter();
      host.frame(0, [0, 0], [[1, 0]]);
      nets[0]!.sent.length = 0;
      nets[0]!.join('p');
      expect(nets[0]!.sent.map(([d, to]) => [d[1], to])).toEqual([[1, 'p'], [2, 'p'], [4, 'p']]);
      nets[0]!.sent.length = 0;
      const fresh = setup();
      fresh.enter();
      fresh.nets[0]!.join('q'); // no place or troop known yet: the hello alone
      expect(fresh.nets[0]!.sent.map(([d]) => d[1])).toEqual([1]);
    });

    it('draws the troop a peer sends, and nothing for a troop before its hello', () => {
      const { nets, host, scene, enter } = setup();
      enter();
      const marbles = () => (scene.getObjectByName('peers') as THREE.InstancedMesh).count;
      nets[0]!.data(encodeTroop([[1, 0]]), 'p'); // no hello: refused
      nets[0]!.data(encodeHello(), 'p');
      nets[0]!.data(encodePos(1, 1, 0), 'p');
      nets[0]!.data(encodeTroop([[1, 0], [0, 1]]), 'p');
      host.frame(0, [0, 0]);
      expect(marbles()).toBe(3);
    });
  });
});
