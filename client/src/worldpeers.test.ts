import { describe, expect, it } from 'vitest';
import { b64 } from './moverecord';
import { EMOTE_GAP_MS, EMOTE_SHOW_MS, EMOTES, encodeEmote, BREAK_BYTES, encodeTroop, TROOP_MAX, TROOP_REACH, cleanName, decode, encodeBreak, encodeHello, encodePos, hexDistance, KEEPALIVE_MS, MAX_NAME, MAX_PEERS, MIN_GAP_MS, PEER_TTL_MS, Peers, SETTLE_MS, PUBLIC_SEED, readName, roomOf, SEND_MS, Sender, writeName } from './worldpeers';

describe('the wire format', () => {
  it('names one room for the public world', () => {
    expect(roomOf(PUBLIC_SEED)).toBe(`ow:${PUBLIC_SEED}:0`);
  });

  it('a Hello is 2 bytes plus the name and a position 7, versioned 2', () => {
    expect(encodeHello()).toEqual(Uint8Array.of(2, 1));
    expect(encodeHello('Ana')).toEqual(Uint8Array.of(2, 1, 65, 110, 97));
    expect(encodePos(3, -2, 9)).toEqual(Uint8Array.of(2, 2, 0, 3, 0xff, 0xfe, 9));
    expect(decode(encodeHello())).toEqual({ t: 'hello', name: '' });
    expect(decode(encodeHello('Ana'))).toEqual({ t: 'hello', name: 'Ana' });
    expect(decode(encodePos(3, -2, 9))).toEqual({ t: 'pos', q: 3, r: -2, seq: 9 });
    expect(decode(encodePos(-32768, 32767, 255))).toEqual({ t: 'pos', q: -32768, r: 32767, seq: 255 });
  });

  it('refuses what is not ours: wrong version, type, length, or not bytes', () => {
    expect(decode(Uint8Array.of(1, 1))).toBeNull(); // the first slice's version
    expect(decode(Uint8Array.of(2, 9))).toBeNull(); // unknown type
    const long = new Uint8Array(2 + 4 * MAX_NAME + 1).fill(97);
    long.set([2, 1]);
    expect(decode(long)).toBeNull(); // a Hello too long
    expect(decode(Uint8Array.of(2, 2, 0, 3))).toBeNull(); // short position
    expect(decode(Uint8Array.of(2))).toBeNull();
    expect(decode('hello')).toBeNull();
    expect(decode({ t: 'pos' })).toBeNull();
    expect(decode(null)).toBeNull();
  });

  it('a position outside the 16-bit range is clamped, never wrapped', () => {
    expect(decode(encodePos(40000, -40000, 300))).toEqual({ t: 'pos', q: 32767, r: -32768, seq: 44 });
  });
});

describe('cleanName', () => {
  it('keeps a plain name, trims it, drops control characters and cuts at 16 characters', () => {
    expect(MAX_NAME).toBe(16);
    expect(cleanName('  Ana  ')).toBe('Ana');
    expect(cleanName('A\u0000n\n\u202ea')).toBe('Ana');
    expect(cleanName('a'.repeat(40))).toBe('a'.repeat(16));
    expect(cleanName('\u{1F600}'.repeat(20))).toBe('\u{1F600}'.repeat(16)); // characters, not bytes
    expect(cleanName('')).toBe('');
    expect(cleanName('Edging King')).toBe(''); // a filtered pun (#1652) is anonymous, sent or received
    expect(cleanName('Edgefall')).toBe('Edgefall');
  });

  it('a Hello with a name cut or dirty on the wire is cleaned when decoded', () => {
    const dirty = Uint8Array.of(2, 1, 32, 66, 7, 111, 98, 32);
    expect(decode(dirty)).toEqual({ t: 'hello', name: 'Bob' });
    expect(decode(Uint8Array.of(2, 1, 0xff, 0xfe))).toEqual({ t: 'hello', name: '' }); // not UTF-8
  });
});

describe('the stored public name', () => {
  it('is empty until one is written, then read back cleaned, with or without a store', () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readName(store)).toBe('');
    writeName(store, '  Ana\u0007  ');
    expect(data.get('ab-alone.public-name')).toBe('Ana');
    expect(readName(store)).toBe('Ana');
    data.set('ab-alone.public-name', 'b'.repeat(30));
    expect(readName(store)).toBe('b'.repeat(16)); // a stored value is cleaned too
    expect(readName(null)).toBe('');
    expect(() => writeName(null, 'x')).not.toThrow();
  });
});

describe('the broken-cell event on the wire', () => {
  const event = { kind: 'break' as const, seed: 1305, q: -7, r: 300, pub: b64(new Uint8Array(32).fill(7).buffer), sig: b64(new Uint8Array(64).fill(9).buffer) };

  it('is 106 bytes: version, type 3, seed, q, r, the 32-byte key and the 64-byte signature', () => {
    const bytes = encodeBreak(event);
    expect(bytes).toHaveLength(BREAK_BYTES);
    expect(BREAK_BYTES).toBe(106);
    expect([...bytes.subarray(0, 2)]).toEqual([2, 3]);
    expect(decode(bytes)).toEqual({ t: 'break', event });
  });

  it('a beaten enemy has the same 106 bytes under type 5, and comes back with its kind', () => {
    const beaten = { ...event, kind: 'beaten' as const };
    const bytes = encodeBreak(beaten);
    expect(bytes).toHaveLength(BREAK_BYTES);
    expect([...bytes.subarray(0, 2)]).toEqual([2, 5]);
    expect(decode(bytes)).toEqual({ t: 'break', event: beaten });
  });

  it('a lair taken has the same 106 bytes under type 6, and comes back with its kind (#1305)', () => {
    const lair = { ...event, kind: 'lair' as const };
    const bytes = encodeBreak(lair);
    expect(bytes).toHaveLength(BREAK_BYTES);
    expect([...bytes.subarray(0, 2)]).toEqual([2, 6]);
    expect(decode(bytes)).toEqual({ t: 'break', event: lair });
  });

  it('refuses a break of another length', () => {
    const bytes = encodeBreak(event);
    expect(decode(bytes.subarray(0, 105))).toBeNull();
    expect(decode(Uint8Array.of(...bytes, 0))).toBeNull();
  });
});

describe('the troop on the wire', () => {
  it('is 3 bytes and 2 per marble, as offsets from the hero: 33 bytes for a full troop of 15 (#1504)', () => {
    expect(TROOP_MAX).toBe(15);
    expect(encodeTroop([])).toEqual(Uint8Array.of(2, 4, 0));
    expect(encodeTroop([[1, 0], [-2, 3]])).toEqual(Uint8Array.of(2, 4, 2, 1, 0, 254, 3));
    const six = encodeTroop([[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]);
    expect(six).toHaveLength(15);
    expect(decode(six)).toEqual({ t: 'troop', offsets: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] });
    const ring = Array.from({ length: 15 }, (_, i): [number, number] => [i % 5 + 1, Math.floor(i / 5)]);
    expect(encodeTroop(ring)).toHaveLength(33);
    expect(decode(encodeTroop(ring))).toEqual({ t: 'troop', offsets: ring });
    expect(decode(encodeTroop([[-2, 3]]))).toEqual({ t: 'troop', offsets: [[-2, 3]] });
  });

  it('keeps only the first 15 marbles when sent more', () => {
    const many = Array.from({ length: 18 }, (_, i): [number, number] => [(i % 8) + 1, Math.floor(i / 8)]);
    expect(decode(encodeTroop(many))).toEqual({ t: 'troop', offsets: many.slice(0, 15) });
  });

  it('refuses what a troop cannot be: a wrong length, too many, a marble on the hero, far off, or twice', () => {
    expect(TROOP_REACH).toBe(8);
    expect(decode(Uint8Array.of(2, 4))).toBeNull();
    expect(decode(Uint8Array.of(2, 4, 2, 1, 0))).toBeNull(); // says 2 marbles, holds 1
    expect(decode(Uint8Array.of(2, 4, 1, 1, 0, 9))).toBeNull(); // a byte too many
    for (const n of [7, 15]) {
      const distinct = Array.from({ length: n }, (_, i): [number, number] => [i % 5 + 1, Math.floor(i / 5)]);
      expect(decode(encodeTroop(distinct))).toEqual({ t: 'troop', offsets: distinct }); // 7 to 15 distinct marbles load
    }
    expect(decode(new Uint8Array([2, 4, 16, ...Array.from({ length: 16 }, (_, i) => [i % 5 + 1, Math.floor(i / 5)]).flat()]))).toBeNull(); // 16 marbles
    expect(decode(Uint8Array.of(2, 4, 1, 0, 0))).toBeNull(); // on the hero
    expect(decode(Uint8Array.of(2, 4, 1, 9, 0))).toBeNull(); // 9 cells off
    expect(decode(Uint8Array.of(2, 4, 1, 5, 5))).toBeNull(); // 10 cells off on the diagonal
    expect(decode(Uint8Array.of(2, 4, 2, 1, 0, 1, 0))).toBeNull(); // the same cell twice
    expect(decode(Uint8Array.of(2, 4, 1, 8, 0))).not.toBeNull(); // 8 is the edge
  });
});

describe('hexDistance', () => {
  it('counts cells between two axial cells', () => {
    expect(hexDistance([0, 0], [0, 0])).toBe(0);
    expect(hexDistance([0, 0], [3, 0])).toBe(3);
    expect(hexDistance([0, 0], [2, -3])).toBe(3);
    expect(hexDistance([1, 1], [-2, 3])).toBe(3);
  });
});

describe('Sender: position on change, 4 Hz at most', () => {
  it('sends the first position, then only a change, no faster than every 250 ms', () => {
    const s = new Sender();
    expect(SEND_MS).toBe(250);
    s.set(0, 0);
    expect(s.due(0)).toEqual(encodePos(0, 0, 0));
    expect(s.due(10)).toBeNull(); // nothing changed
    s.set(1, 0);
    expect(s.due(100)).toBeNull(); // too soon
    expect(s.due(250)).toEqual(encodePos(1, 0, 1));
    s.set(2, 0);
    s.set(3, 0); // only the last place counts
    expect(s.due(500)).toEqual(encodePos(3, 0, 2));
  });

  it('repeats the position every 5 s while still, so peers keep it', () => {
    const s = new Sender();
    s.set(4, 4);
    s.due(0);
    expect(s.due(KEEPALIVE_MS - 1)).toBeNull();
    expect(s.due(KEEPALIVE_MS)).toEqual(encodePos(4, 4, 1));
  });

  it('sends nothing before a place is known; the seq wraps at 256', () => {
    const s = new Sender();
    expect(s.due(1e6)).toBeNull();
    let last: Uint8Array = new Uint8Array();
    for (let i = 0; i < 257; i++) {
      s.set(i, 0);
      last = s.due(i * SEND_MS)!;
    }
    expect(last[6]).toBe(0); // the 257th message
  });

  it('now(): the current place for a peer that just joined', () => {
    const s = new Sender();
    expect(s.now()).toBeNull();
    s.set(2, 1);
    expect(s.now()).toEqual(encodePos(2, 1, 255)); // the seq of the last send, so the next send is newer for the peer
    s.due(0);
    expect(s.now()).toEqual(encodePos(2, 1, 0));
    expect(s.now()).toEqual(encodePos(2, 1, 0)); // asking does not use a seq of its own
  });
});

describe('Sender: the troop, on change only, 4 Hz at most', () => {
  it('sends the offsets from the hero when they change, never the same twice, never faster than every 250 ms', () => {
    const s = new Sender();
    expect(s.dueTroop(0)).toBeNull(); // nothing known
    s.set(10, 10);
    expect(s.dueTroop(0)).toBeNull(); // no marble: what peers know already
    s.setTroop([[11, 10], [9, 10]]);
    expect(s.dueTroop(0)).toEqual(encodeTroop([[1, 0], [-1, 0]]));
    expect(s.dueTroop(300)).toBeNull(); // unchanged
    s.setTroop([[11, 10]]);
    s.set(11, 10); // the hero moved: the same cells are other offsets
    expect(s.dueTroop(100)).toBeNull(); // too soon
    expect(s.dueTroop(250)).toEqual(encodeTroop([])); // the one marble stands on the hero now: dropped
  });

  it('now: the troop for a peer that just joined, none before one is known', () => {
    const s = new Sender();
    expect(s.nowTroop()).toBeNull();
    s.set(0, 0);
    s.setTroop([[1, 0]]);
    expect(s.nowTroop()).toEqual(encodeTroop([[1, 0]]));
    s.setTroop([]);
    expect(s.nowTroop()).toBeNull(); // a peer starts with none
  });

  it('drops a marble too far from the hero or on it, so what it sends a peer accepts', () => {
    const s = new Sender();
    s.set(0, 0);
    s.setTroop([[0, 0], [20, 0], [1, 0]]);
    expect(s.dueTroop(0)).toEqual(encodeTroop([[1, 0]]));
  });
});

describe('Peers', () => {
  const pos = (q: number, r: number, seq: number) => ({ t: 'pos' as const, q, r, seq });

  it('shows a peer only after its Hello', () => {
    const p = new Peers();
    expect(p.position('a', pos(1, 1, 0), 0)).toBe(false);
    expect(p.cells()).toEqual([]);
    p.hello('a', 0);
    expect(p.position('a', pos(1, 1, 0), 0)).toBe(true);
    expect(p.cells()).toEqual([{ peer: 'a', cell: [1, 1], name: '', troop: [] }]);
  });

  it('lists no peer that said Hello but has sent no place yet', () => {
    const p = new Peers();
    p.hello('a', 0);
    expect(p.size).toBe(1);
    expect(p.cells([0, 0])).toEqual([]);
  });

  it('drops a peer that leaves, and one silent for 10 s', () => {
    const p = new Peers();
    p.hello('a', 0);
    p.hello('b', 0);
    p.position('a', pos(1, 0, 0), 0);
    p.position('b', pos(2, 0, 0), 0);
    p.leave('a');
    p.leave('nobody');
    expect(p.cells().map((c) => c.peer)).toEqual(['b']);
    p.expire(PEER_TTL_MS);
    expect(p.cells().map((c) => c.peer)).toEqual(['b']);
    p.expire(PEER_TTL_MS + 1);
    expect(p.cells()).toEqual([]);
  });

  it('trusts a place for events only when the peer got there at a hero\'s speed, or has stood there for SETTLE_MS', () => {
    const p = new Peers();
    expect(p.cellOf('a', 0)).toBeNull(); // unknown peer
    p.hello('a', 0);
    expect(p.cellOf('a', 0)).toBeNull(); // no place yet
    p.position('a', pos(1, 0, 0), 0);
    expect(p.cellOf('a', 0)).toEqual([1, 0]);
    p.position('a', pos(5, 0, 1), 1000); // 4 cells in a second: a walk
    expect(p.cellOf('a', 1000)).toEqual([5, 0]);
    p.position('a', pos(500, 0, 2), 1200); // a jump of 495 cells in 0.2 s
    expect(p.cellOf('a', 1200)).toBeNull();
    expect(p.cellOf('a', 1200 + SETTLE_MS - 1)).toBeNull();
    expect(p.cellOf('a', 1200 + SETTLE_MS)).toEqual([500, 0]);
  });

  it('refuses a flood: a message under MIN_GAP_MS after the last one is dropped', () => {
    const p = new Peers();
    p.hello('a', 0);
    expect(p.position('a', pos(1, 0, 0), 1000)).toBe(true);
    expect(p.position('a', pos(2, 0, 1), 1000 + MIN_GAP_MS - 1)).toBe(false);
    expect(p.position('a', pos(2, 0, 1), 1000 + MIN_GAP_MS)).toBe(true);
  });

  it('refuses an older seq (mod 256) but accepts the wrap', () => {
    const p = new Peers();
    p.hello('a', 0);
    p.position('a', pos(5, 0, 10), 0);
    expect(p.position('a', pos(1, 0, 9), 1000)).toBe(false);
    expect(p.position('a', pos(1, 0, 10), 1000)).toBe(false); // same seq twice
    expect(p.position('a', pos(6, 0, 11), 1000)).toBe(true);
    p.hello('b', 0);
    p.position('b', pos(0, 0, 250), 0);
    expect(p.position('b', pos(1, 0, 2), 1000)).toBe(true); // 250 -> 2 is forward across the wrap
  });

  it('a second Hello keeps the place and the peer stays one entry, its name changes', () => {
    const p = new Peers();
    p.hello('a', 0, 'Ana');
    p.position('a', pos(1, 0, 0), 0);
    expect(p.cells()).toEqual([{ peer: 'a', cell: [1, 0], name: 'Ana', troop: [] }]);
    p.hello('a', 5, 'Anna');
    expect(p.cells()).toEqual([{ peer: 'a', cell: [1, 0], name: 'Anna', troop: [] }]);
    p.hello('a', 6);
    expect(p.cells()[0]!.name).toBe('');
  });

  it('shows at most MAX_PEERS, the nearest to a cell first', () => {
    const p = new Peers();
    for (let i = 0; i < MAX_PEERS + 5; i++) {
      p.hello(`p${i}`, 0);
      p.position(`p${i}`, pos(100 - i, 0, 0), 0);
    }
    const shown = p.cells([0, 0]);
    expect(shown).toHaveLength(MAX_PEERS);
    expect(shown[0]!.peer).toBe(`p${MAX_PEERS + 4}`); // q = 100 - 24 = 76, the nearest
  });

  it('caps the table itself: a Hello past 4 x MAX_PEERS is ignored', () => {
    const p = new Peers();
    for (let i = 0; i < MAX_PEERS * 4 + 3; i++) p.hello(`p${i}`, 0);
    expect(p.size).toBe(MAX_PEERS * 4);
  });

  it('keeps the troop of a peer as cells round its hero, and moves it with the hero', () => {
    const p = new Peers();
    expect(p.troop('a', [[1, 0]], 0)).toBe(false); // no Hello
    p.hello('a', 0);
    p.position('a', { q: 5, r: 5, seq: 0 }, 0);
    expect(p.troop('a', [[1, 0], [0, -1]], 1000)).toBe(true);
    expect(p.cells()[0]!.troop).toEqual([[6, 5], [5, 4]]);
    p.position('a', { q: 7, r: 5, seq: 1 }, 2000);
    expect(p.cells()[0]!.troop).toEqual([[8, 5], [7, 4]]);
    expect(p.troop('a', [], 1001)).toBe(false); // a flood: under MIN_GAP_MS after the last
    expect(p.troop('a', [], 3000)).toBe(true);
    expect(p.cells()[0]!.troop).toEqual([]);
  });
});

describe('emotes (#1671)', () => {
  it('encodes an index in 3 bytes and decodes only the ids of the list', () => {
    expect(decode(encodeEmote(2))).toEqual({ t: 'emote', id: 2 });
    expect(decode(encodeEmote(EMOTES.length - 1))).toEqual({ t: 'emote', id: EMOTES.length - 1 });
    expect(decode(encodeEmote(EMOTES.length))).toBeNull();
    expect(decode(encodeEmote(255))).toBeNull();
    expect(decode(new Uint8Array([2, 7]))).toBeNull();
    expect(decode(new Uint8Array([2, 7, 0, 0]))).toBeNull();
  });

  it('keeps an emote for EMOTE_SHOW_MS, refuses one before a Hello or closer than EMOTE_GAP_MS to the last', () => {
    const p = new Peers();
    expect(p.emote('a', 1, 0)).toBe(false); // no Hello
    p.hello('a', 0);
    p.position('a', { q: 1, r: 1, seq: 0 }, 0);
    expect(p.cells([0, 0])[0]!.say).toBeUndefined(); // no time given
    expect(p.emote('a', 1, 100)).toBe(true);
    expect(p.emote('a', 2, 100 + EMOTE_GAP_MS - 1)).toBe(false);
    expect(p.cells([0, 0], 101)[0]!.say).toBe(1);
    expect(p.cells([0, 0], 100 + EMOTE_SHOW_MS)[0]!.say).toBeUndefined();
    expect(p.emote('a', 2, 100 + EMOTE_GAP_MS)).toBe(true);
    expect(p.cells([0, 0], 100 + EMOTE_GAP_MS)[0]!.say).toBe(2);
  });
});
