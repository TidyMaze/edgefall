// The other heroes of the public Open world (#1305, docs/specs/multiplayer.md section 7): the wire format, what a hero sends and
// what it keeps of the others. Pure code, no network. Messages are small and unsigned: a peer lies only about itself, so a
// position is cosmetic. Everything received is untrusted bytes, checked here before it is used.
import type { Axial } from './board';
import { b64, unb64 } from './moverecord';
import { read, write, type Store } from './quality';
import { filtered } from './namefilter';

/** The seed of the one public world every player lands in by default (lead decision on #1305). New world stays private. */
export const PUBLIC_SEED = 1305;
/** The room of a public seed. Rooms split by region and shard in a later slice; for now there is one. */
export const roomOf = (seed: number): string => `ow:${seed}:0`;

/** The version of this wire format, its first byte: a message of another version is dropped. */
const VERSION = 2;
const HELLO = 1;
const POS = 2;
const BREAK = 3;
const TROOP = 4;
const BEATEN = 5;
const LAIR = 6;
const EMOTE = 7;

/** The emotes and phrases of the public world (#1671): the wire carries only an index into this fixed list, and the text shown is read from
 * it here, never from the wire. The first three are emotes, the rest preset phrases. */
export const EMOTES = ['Wave', 'GG', 'Follow me', 'Hello', 'Duel?', 'Thanks'] as const;
/** How long an emote stays above its hero (ms); the most one hero sends (one per EMOTE_SEND_MS), and the closest two are believed from one peer. */
export const EMOTE_SHOW_MS = 4000;
export const EMOTE_SEND_MS = 2000;
export const EMOTE_GAP_MS = 1500;
/** The most marbles of a troop on the wire, and how far from its hero one may stand (cells). */
export const TROOP_MAX = 15;
export const TROOP_REACH = 8;

/** A signed world event (#1305): `break` (a hero broke the obstacle on the cell), `beaten` (the enemy marble that starts on the cell was
 * ejected) or `lair` (a hero took the boss lair on the cell). Signed by its key (`pub`, `sig` in base64url), see worldevents.ts. */
export interface BreakEvent {
  kind: 'break' | 'beaten' | 'lair';
  seed: number;
  q: number;
  r: number;
  pub: string;
  sig: string;
}

/** A break, beaten or lair event on the wire: version, type (3 break, 5 beaten, 6 lair), seed (u32), q and r (int16), the 32-byte key, the 64-byte signature. */
export const BREAK_BYTES = 2 + 4 + 2 + 2 + 32 + 64;

export function encodeBreak(e: BreakEvent): Uint8Array {
  const out = new Uint8Array(BREAK_BYTES);
  const view = new DataView(out.buffer);
  out.set([VERSION, e.kind === 'beaten' ? BEATEN : e.kind === 'lair' ? LAIR : BREAK]);
  view.setUint32(2, e.seed);
  view.setInt16(6, int16(e.q));
  view.setInt16(8, int16(e.r));
  out.set(unb64(e.pub), 10);
  out.set(unb64(e.sig), 42);
  return out;
}

export type Message = { t: 'break'; event: BreakEvent } | { t: 'troop'; offsets: Axial[] } | { t: 'hello'; name: string } | { t: 'pos'; q: number; r: number; seq: number } | { t: 'emote'; id: number };

/** At most 4 positions a second. */
export const SEND_MS = 250;
/** A still hero repeats its place this often, so peers do not drop it (0.2 Hz). */
export const KEEPALIVE_MS = 5000;
/** A peer silent for this long is dropped. */
export const PEER_TTL_MS = 10_000;
/** Positions from one peer closer together than this are dropped (flood guard; the honest rate is SEND_MS). */
export const MIN_GAP_MS = 100;
/** The fastest a hero is believed to move between two positions (cells per second, above any walk or boat), and how long a place reached by a
 * faster jump (a teleporter, or a lie) stays unproven: its events count as far from it until then. */
export const MAX_SPEED = 20;
export const SETTLE_MS = 3000;
/** The most heroes drawn, markers and edge indicators. */
export const MAX_PEERS = 20;
/** The table keeps at most this many peers, shown or not. */
const MAX_TABLE = MAX_PEERS * 4;

/** The most characters of a public name. */
export const MAX_NAME = 16;

/** A public name as shown: control and format characters (bidi overrides included) dropped, trimmed, cut at MAX_NAME characters; empty when filtered. */
export const cleanName = (name: string): string => {
  const clean = [...name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, MAX_NAME).join('');
  return filtered(clean) ? '' : clean; // a filtered pun (#1652) is anonymous, sent or received
};

const NAME_KEY = 'ab-alone.public-name';
/** The player's public name from the store, cleaned: empty (anonymous) when none was chosen. */
export const readName = (store: Store): string => cleanName(read(store, NAME_KEY) ?? '');
export const writeName = (store: Store, name: string): void => write(store, NAME_KEY, cleanName(name));

/** Hello: version, type and the public name in UTF-8 (empty when anonymous), 2 bytes and up to 64 more. */
export function encodeHello(name = ''): Uint8Array {
  const text = new TextEncoder().encode(cleanName(name));
  const out = new Uint8Array(2 + text.length);
  out.set([VERSION, HELLO]);
  out.set(text, 2);
  return out;
}

/** The name of a Hello's tail, cleaned; empty when it is not UTF-8. */
function nameOf(tail: Uint8Array): string {
  try {
    return cleanName(new TextDecoder('utf-8', { fatal: true }).decode(tail));
  } catch {
    return '';
  }
}

const int16 = (n: number): number => Math.max(-32768, Math.min(32767, Math.trunc(n)));

/** An emote: version, type, the index in EMOTES, 3 bytes. */
export const encodeEmote = (id: number): Uint8Array => new Uint8Array([VERSION, EMOTE, id]);

/** A position: version, type, q and r as big-endian int16 (clamped), seq, 7 bytes. */
export function encodePos(q: number, r: number, seq: number): Uint8Array {
  const out = new Uint8Array(7);
  const view = new DataView(out.buffer);
  out[0] = VERSION;
  out[1] = POS;
  view.setInt16(2, int16(q));
  view.setInt16(4, int16(r));
  out[6] = seq & 0xff;
  return out;
}

/** The troop of a hero: version, type, the count, then the offset of each marble from the hero (two int8), at most TROOP_MAX. */
export function encodeTroop(offsets: readonly Axial[]): Uint8Array {
  const kept = offsets.slice(0, TROOP_MAX);
  const out = new Uint8Array(3 + 2 * kept.length);
  out.set([VERSION, TROOP, kept.length]);
  const view = new DataView(out.buffer);
  kept.forEach(([dq, dr], i) => {
    view.setInt8(3 + 2 * i, dq);
    view.setInt8(4 + 2 * i, dr);
  });
  return out;
}

/** Whether `offsets` are a troop: at most TROOP_MAX marbles, each within TROOP_REACH of the hero, none on it, none twice. */
const isTroop = (offsets: readonly Axial[]): boolean =>
  offsets.length <= TROOP_MAX &&
  offsets.every(([dq, dr], i) => {
    const far = hexDistance([0, 0], [dq, dr]);
    return far >= 1 && far <= TROOP_REACH && offsets.findIndex((o) => o[0] === dq && o[1] === dr) === i;
  });

/** The message in bytes received from a peer, or null when it is not one of ours. */
export function decode(data: unknown): Message | null {
  if (!(data instanceof Uint8Array) || data.length < 2 || data[0] !== VERSION) return null;
  if (data[1] === HELLO) return data.length <= 2 + 4 * MAX_NAME ? { t: 'hello', name: nameOf(data.subarray(2)) } : null;
  if (data[1] === EMOTE) return data.length === 3 && data[2]! < EMOTES.length ? { t: 'emote', id: data[2]! } : null; // an unknown id is dropped
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[1] === BREAK || data[1] === BEATEN || data[1] === LAIR) {
    if (data.length !== BREAK_BYTES) return null;
    const kind = data[1] === BREAK ? 'break' : data[1] === BEATEN ? 'beaten' : 'lair';
    const event: BreakEvent = { kind, seed: view.getUint32(2), q: view.getInt16(6), r: view.getInt16(8), pub: b64(data.slice(10, 42).buffer), sig: b64(data.slice(42).buffer) };
    return { t: 'break', event };
  }
  if (data[1] === TROOP) {
    const count = data[2]!;
    if (data.length !== 3 + 2 * count) return null;
    const offsets = Array.from({ length: count }, (_, i): Axial => [view.getInt8(3 + 2 * i), view.getInt8(4 + 2 * i)]);
    return isTroop(offsets) ? { t: 'troop', offsets } : null;
  }
  if (data[1] !== POS || data.length !== 7) return null;
  return { t: 'pos', q: view.getInt16(2), r: view.getInt16(4), seq: data[6]! };
}

/** The distance in cells between two axial cells. */
export const hexDistance = (a: Axial, b: Axial): number => {
  const dq = a[0] - b[0];
  const dr = a[1] - b[1];
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};

/** What this hero sends: its place, when it changed and SEND_MS passed, or KEEPALIVE_MS passed. */
export class Sender {
  private at: Axial | null = null;
  private sent: Axial | null = null;
  private lastMs = 0;
  private seq = 0;
  private troop: Axial[] = [];
  private sentTroop = ''; // what peers know: no marbles, until told
  private troopMs = -Infinity;

  set(q: number, r: number): void {
    this.at = [q, r];
  }

  /** The cells of this hero's troop (absolute). Call after `set`: the offsets are taken from the hero's place. */
  setTroop(cells: readonly Axial[]): void {
    this.troop = cells.map((c): Axial => [c[0], c[1]]);
  }

  /** The offsets of the marbles from the hero that a peer accepts: not on the hero, within TROOP_REACH, at most TROOP_MAX. */
  private get offsets(): Axial[] | null {
    const at = this.at;
    if (!at) return null;
    return this.troop
      .map((c): Axial => [c[0] - at[0], c[1] - at[1]])
      .filter((o) => hexDistance([0, 0], o) >= 1 && hexDistance([0, 0], o) <= TROOP_REACH)
      .slice(0, TROOP_MAX);
  }

  /** The position message to send at `now` (ms), or null. */
  due(now: number): Uint8Array | null {
    const at = this.at;
    if (!at) return null;
    const waited = now - this.lastMs;
    const moved = !this.sent || this.sent[0] !== at[0] || this.sent[1] !== at[1];
    if (this.sent && !(moved ? waited >= SEND_MS : waited >= KEEPALIVE_MS)) return null;
    this.sent = at;
    this.lastMs = now;
    return encodePos(at[0], at[1], this.seq++);
  }

  /** The troop to send at `now` (ms): its offsets from the hero changed since the last one and SEND_MS passed; null otherwise. */
  dueTroop(now: number): Uint8Array | null {
    const offsets = this.offsets;
    if (!offsets || this.sentTroop === offsets.join() || now - this.troopMs < SEND_MS) return null;
    this.sentTroop = offsets.join();
    this.troopMs = now;
    return encodeTroop(offsets);
  }

  /** The troop now, for a peer that just joined; none when there is no marble (a peer starts with none). */
  nowTroop(): Uint8Array | null {
    const offsets = this.offsets;
    return offsets && offsets.length > 0 ? encodeTroop(offsets) : null;
  }

  /** The place now, for a peer that just joined; it takes no seq of its own (the next send is a newer one). */
  now(): Uint8Array | null {
    return this.at ? encodePos(this.at[0], this.at[1], this.seq - 1) : null;
  }
}

interface Entry {
  cell: Axial | null;
  /** The marbles of its troop as offsets from its hero. */
  offsets: Axial[];
  name: string;
  seq: number;
  /** The time of the last message of any kind, and of the last accepted position (ms). */
  heard: number;
  posAt: number;
  troopAt: number;
  /** The emote last accepted (an index in EMOTES), until when it shows, and when it came. */
  emote: number;
  emoteUntil: number;
  emoteAt: number;
  /** Until when its place is unproven: it jumped faster than MAX_SPEED. */
  unsettled: number;
}

/** What this hero knows of the others, by transport peer. */
export class Peers {
  private readonly table = new Map<string, Entry>();

  get size(): number {
    return this.table.size;
  }

  /** A Hello from `peer`, with its public name (already cleaned by `decode`). */
  hello(peer: string, now: number, name = ''): void {
    const known = this.table.get(peer);
    if (known) {
      known.heard = now;
      known.name = name;
    } else if (this.table.size < MAX_TABLE) this.table.set(peer, { cell: null, offsets: [], name, seq: 0, heard: now, posAt: -Infinity, troopAt: -Infinity, emote: 0, emoteUntil: -Infinity, emoteAt: -Infinity, unsettled: -Infinity });
  }

  /** A position from `peer`. False when it is refused: no Hello first, too fast, or not newer than the last (seq mod 256). */
  position(peer: string, { q, r, seq }: { q: number; r: number; seq: number }, now: number): boolean {
    const e = this.table.get(peer);
    if (!e) return false;
    if (now - e.posAt < MIN_GAP_MS) return false;
    const ahead = (seq - e.seq + 256) % 256;
    if (e.cell && (ahead === 0 || ahead > 127)) return false;
    if (e.cell && hexDistance(e.cell, [q, r]) > 2 + (MAX_SPEED * (now - e.posAt)) / 1000) e.unsettled = now + SETTLE_MS;
    e.cell = [q, r];
    e.seq = seq;
    e.heard = now;
    e.posAt = now;
    return true;
  }

  /** The troop of `peer` as offsets from its hero. False when refused: no Hello, or too fast (a flood). */
  troop(peer: string, offsets: readonly Axial[], now: number): boolean {
    const e = this.table.get(peer);
    if (!e || now - e.troopAt < MIN_GAP_MS) return false;
    e.offsets = offsets.map((o): Axial => [o[0], o[1]]);
    e.heard = now;
    e.troopAt = now;
    return true;
  }

  /** An emote from `peer` (an index `decode` checked). False when refused: no Hello, or closer than EMOTE_GAP_MS to its last (a flood). */
  emote(peer: string, id: number, now: number): boolean {
    const e = this.table.get(peer);
    if (!e || now - e.emoteAt < EMOTE_GAP_MS) return false;
    e.emote = id;
    e.emoteAt = now;
    e.emoteUntil = now + EMOTE_SHOW_MS;
    e.heard = now;
    return true;
  }

  /** The last place `peer` reported, null when none or when it got there faster than a hero goes (until SETTLE_MS have passed). */
  cellOf(peer: string, now: number): Axial | null {
    const e = this.table.get(peer);
    return e && now >= e.unsettled ? e.cell : null;
  }

  leave(peer: string): void {
    this.table.delete(peer);
  }

  /** Drops the peers silent for more than PEER_TTL_MS. */
  expire(now: number): void {
    for (const [peer, e] of this.table) if (now - e.heard > PEER_TTL_MS) this.table.delete(peer);
  }

  /** The peers with a known place: at most MAX_PEERS, the nearest to `from` first when it is given. `say` is the emote showing at `now`, when given. */
  cells(from?: Axial, now?: number): { peer: string; cell: Axial; name: string; troop: Axial[]; say?: number }[] {
    const known = [...this.table].flatMap(([peer, e]) => {
      const [q, r] = e.cell ?? [0, 0];
      return e.cell ? [{ peer, cell: e.cell, name: e.name, troop: e.offsets.map(([dq, dr]): Axial => [q + dq, r + dr]), say: now !== undefined && now < e.emoteUntil ? e.emote : undefined }] : [];
    });
    if (from) known.sort((a, b) => hexDistance(from, a.cell) - hexDistance(from, b.cell));
    return known.slice(0, MAX_PEERS);
  }
}
