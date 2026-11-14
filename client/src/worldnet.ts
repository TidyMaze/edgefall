// The public Open world online (#1305): the hero's room, what it sends and what it shows of the other heroes. The Open world mode
// calls it on entering and leaving a world and on each frame; it stays idle on any seed but the public one, and until the player
// accepted online play (main.ts asks first, consent.ts). Nothing goes through a relay but the connection itself (p2p.ts).
import type * as THREE from 'three/webgpu';
import type { Axial } from './board';
import type { World } from './openworld';
import type { PeerNet } from './p2p';
import { joinErrorCause } from './netcounters';
import type { Keys } from './moverecord';
import type { Store } from './quality';
import { BreakSet, SYNC_MAX, SYNC_MS, signBeaten, signBreak, signLair, verifyBreak } from './worldevents';
import { type BreakEvent, decode, EMOTE_SEND_MS, EMOTES, encodeBreak, encodeEmote, encodeHello, Peers, hexDistance, PUBLIC_SEED, roomOf, Sender } from './worldpeers';
import { PeersLayer } from './worldpeersview';

/** What the Open world mode needs of the online layer. */
export interface PeerHost {
  /** A world was entered: joins the room when it is the public one. */
  enter(seed: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera, world: Pick<World, 'tile'>): void;
  /** Called every frame at `now` (ms) with the hero's cell and its troop's cells, and the time the boats bob at (`null`: held still). Returns whether the scene must be drawn again. */
  frame(now: number, hero: Axial, troop?: readonly Axial[], bobNow?: number | null): boolean;
  /** The world was left: stops sending and clears the screen. */
  leave(): void;
  /** The hero broke the obstacle on `cell`: told to the others, signed. */
  broke(cell: Axial): void;
  /** The hero ejected the generated enemy that starts on `cell` (#1305): told to the others when the rule allows it, signed. */
  beaten(cell: Axial): void;
  /** The hero took the boss lair on `cell` of the world `seed` (#1305): told to the others once the room is open, signed. */
  lairWon(seed: number, cell: Axial): void;
  /** The hero won a wild fight against the generated marble that starts on `cell` of the world `seed` (#1511): told as a beaten enemy, once
   * the room is open, signed, when the rule allows it. */
  wildWon(seed: number, cell: Axial): void;
}

/** What the signed events need of the page: the player's key, the rules of the world (`world_can_break`, `world_is_enemy`, the lairs of
 * `world_lairs`) and what happens to a cell another hero broke (the world opens it and the view smashes its prop), to an enemy another
 * hero ejected, or to a lair another hero took. */
export interface BreakHooks {
  keys: () => Promise<Keys>;
  canBreak: (seed: number, q: number, r: number) => boolean;
  apply: (cell: Axial) => void;
  canBeaten: (seed: number, q: number, r: number) => boolean;
  beat: (cell: Axial) => void;
  canLair: (seed: number, q: number, r: number) => boolean;
  lair: (cell: Axial) => void;
}

/** Breaks from one peer closer together than this are dropped (flood guard; the sync of a newcomer goes at SYNC_MS). */
const BREAK_GAP_MS = 100;
/** A hero acts within this many cells of where it stands; an event further than that from its sender is a relayed one (a sync). */
const NEAR = 12;

/** What the HUD shows of the connection: `available` is false outside the public world (no controls), `hidden` when the player hides. */
export interface NetStatus {
  available: boolean;
  hidden: boolean;
  text: string;
}

/** After a join error with nobody connected, the room is left and joined again this long after (#1670): a fresh announce and fresh offers
 * instead of waiting for the relays' 60 s cycle to retry the pair that failed. */
export const RETRY_MS = 15000;

const NOBODY = 'Online: nobody else here yet.';
const heroes = (n: number): string => `Online: ${n} other ${n === 1 ? 'hero' : 'heroes'} here.`;
const ERRORS: Record<string, string> = {
  'ice-failed': 'Online: a hero was found but the direct connection failed. Your network may block it.',
  'join-error': 'Online: a connection problem, still trying.',
};

interface Running {
  net: PeerNet;
  sender: Sender;
  peers: Peers;
  layer: PeersLayer;
}

export class WorldPeersHost implements PeerHost {
  private running: Running | null = null;
  /** The public world entered, kept while the player hides, so Show can join again. */
  private entered: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; world: Pick<World, 'tile'> } | null = null;
  private text = '';
  private lastCount = 0;
  private failed = '';
  /** When to join the room again after a join error, or null. */
  private retryAt: number | null = null;
  /** The cells broken this visit, what is owed to peers that joined (a queue each), and when a peer last sent a break. */
  private readonly held: BreakSet;
  private syncing: { peer: string; events: BreakEvent[] }[] = [];
  private lastSync = -Infinity;
  private readonly lastBreak = new Map<string, number>();
  /** How many events far from their sender each peer reported: no more than a sync (SYNC_MAX), since nothing proves its key was there. */
  private readonly far = new Map<string, number>();
  /** When this hero last sent an emote, and the list of the heroes nearby last given to `nearby`. */
  private lastSay = -Infinity;
  private shownNearby = '';
  /** The lairs taken while the room was closed (the fight leaves the world): told when it opens. Kept across a leave. */
  private owed: [BreakEvent['kind'], Axial][] = [];

  /**
   * `open` joins a room, `allowed` says whether online play was accepted (read when a world is entered), `root` holds the edge
   * indicators and name tags, `report` gets the status the HUD shows, `name` the player's public name, `clock` the time in ms
   * (the frame's time base), `hooks` the signed break events.
   */
  constructor(
    private readonly open: (room: string) => PeerNet,
    private readonly allowed: () => boolean,
    private readonly root: HTMLElement,
    private readonly report: (status: NetStatus) => void,
    private readonly name: () => string,
    private readonly hooks: BreakHooks,
    private readonly clock: () => number = () => performance.now(),
    store: Store = null,
    private readonly nearby: (heroes: { name: string; tiles: number }[]) => void = () => {},
  ) {
    this.held = new BreakSet(store);
  }

  enter(seed: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera, world: Pick<World, 'tile'>): void {
    this.leave();
    if (seed !== PUBLIC_SEED || !this.allowed()) return void this.say({ available: false, hidden: false, text: '' });
    this.entered = { scene, camera, world };
    this.start();
  }

  private say(status: NetStatus): void {
    this.text = status.text;
    this.report(status);
  }

  /** Reports the status of the room as it is now. */
  private update(): void {
    const text = this.failed || (this.lastCount > 0 ? heroes(this.lastCount) : NOBODY);
    if (text !== this.text) this.say({ available: true, hidden: false, text });
  }

  private start(): void {
    const { scene, camera, world } = this.entered!;
    const net = this.open(roomOf(PUBLIC_SEED));
    const sender = new Sender();
    const peers = new Peers();
    net.onJoin((peer) => {
      this.failed = '';
      this.retryAt = null;
      net.send(encodeHello(this.name()), peer);
      const here = sender.now();
      if (here) net.send(here, peer);
      const troop = sender.nowTroop();
      if (troop) net.send(troop, peer);
      const events = this.held.newest(SYNC_MAX);
      if (events.length > 0) this.syncing.push({ peer, events });
    });
    net.onData((data, peer) => {
      const message = decode(data);
      if (message?.t === 'hello') peers.hello(peer, this.clock(), message.name);
      else if (message?.t === 'break') void this.receive(peer, message.event);
      else if (message?.t === 'emote') peers.emote(peer, message.id, this.clock());
      else if (message?.t === 'troop') peers.troop(peer, message.offsets, this.clock());
      else if (message) peers.position(peer, message, this.clock());
    });
    net.onLeave((peer) => {
      peers.leave(peer);
      this.lastBreak.delete(peer);
      this.far.delete(peer);
      this.syncing = this.syncing.filter((s) => s.peer !== peer);
    });
    net.onError((message) => {
      this.failed = ERRORS[joinErrorCause(message)]!;
      this.retryAt ??= this.clock() + RETRY_MS;
      this.update();
    });
    this.running = { net, sender, peers, layer: new PeersLayer(scene, camera, world, this.root) };
    this.lastCount = 0;
    this.failed = '';
    this.retryAt = null;
    this.text = '';
    this.update();
    this.sendOwed();
    void this.restore(this.running);
  }

  /** The events saved by earlier visits (#1305): each checked as a peer's would be (this world, a cell the rules allow, a signature that
   * verifies), then held, applied to the world and given to the peers that join. Whatever does not check is dropped. */
  private async restore(run: Running): Promise<void> {
    const good: BreakEvent[] = [];
    for (const event of this.held.stored(PUBLIC_SEED)) {
      if (this.held.has(event.q, event.r)) continue; // held already (the room opened again after a Hide)
      const allowed = event.kind === 'beaten' ? this.hooks.canBeaten : event.kind === 'lair' ? this.hooks.canLair : this.hooks.canBreak;
      if (allowed(event.seed, event.q, event.r) && (await verifyBreak(event))) good.push(event);
      if (this.running !== run) return; // the room closed meanwhile
    }
    for (const event of this.held.adopt(good)) {
      if (event.kind === 'beaten') this.hooks.beat([event.q, event.r]);
      else if (event.kind === 'lair') this.hooks.lair([event.q, event.r]);
      else this.hooks.apply([event.q, event.r]);
    }
  }

  /** A lair was taken: told to the peers now, or when the room opens if it is closed (the lair's fight leaves the world). Only the
   * public world's lairs are shared. */
  lairWon(seed: number, cell: Axial): void {
    if (seed !== PUBLIC_SEED) return;
    this.owed.push(['lair', cell]);
    this.sendOwed();
  }

  /** A wild fight was won (#1511): the marble is a beaten enemy to the others, named by the cell it started on, told now or when the room opens. */
  wildWon(seed: number, cell: Axial): void {
    if (seed !== PUBLIC_SEED || !this.hooks.canBeaten(seed, cell[0], cell[1])) return;
    this.owed.push(['beaten', cell]);
    this.sendOwed();
  }

  private sendOwed(): void {
    if (!this.running) return;
    for (const [kind, cell] of this.owed.splice(0)) void this.announce(kind, cell);
  }

  /** The hero broke the obstacle on `cell`: signs it, holds it and tells every peer. */
  broke(cell: Axial): void {
    void this.announce('break', cell);
  }

  /** The hero ejected the enemy on `cell`: signed and told to the peers, only when a generated enemy starts there (`world_is_enemy`). */
  beaten([q, r]: Axial): void {
    if (this.hooks.canBeaten(PUBLIC_SEED, q, r)) void this.announce('beaten', [q, r]);
  }

  private async announce(kind: BreakEvent['kind'], [q, r]: Axial): Promise<void> {
    const run = this.running;
    if (!run) return;
    const sign = kind === 'beaten' ? signBeaten : kind === 'lair' ? signLair : signBreak;
    const event = await sign(await this.hooks.keys(), PUBLIC_SEED, q, r);
    if (this.running !== run) return; // the room closed while the key signed
    this.held.add(event);
    run.net.send(encodeBreak(event));
  }

  /** A break or a beaten enemy from `peer`: checked (this world, a cell the rules allow, not too fast, a signature that verifies), then
   * held and applied. */
  private async receive(peer: string, event: BreakEvent): Promise<void> {
    const run = this.running;
    if (event.seed !== PUBLIC_SEED || this.held.has(event.q, event.r)) return;
    const now = this.clock();
    if (now - (this.lastBreak.get(peer) ?? -Infinity) < BREAK_GAP_MS) return;
    this.lastBreak.set(peer, now);
    const at = run?.peers.cellOf(peer, now);
    if (!at || hexDistance(at, [event.q, event.r]) > NEAR) {
      const used = this.far.get(peer) ?? 0;
      if (used >= SYNC_MAX) return;
      this.far.set(peer, used + 1);
    }
    const allowed = event.kind === 'beaten' ? this.hooks.canBeaten : event.kind === 'lair' ? this.hooks.canLair : this.hooks.canBreak;
    if (!allowed(event.seed, event.q, event.r) || !(await verifyBreak(event))) return;
    if (this.running !== run || !this.held.add(event)) return; // the room closed meanwhile, or the same cell came first
    if (event.kind === 'beaten') this.hooks.beat([event.q, event.r]);
    else if (event.kind === 'lair') this.hooks.lair([event.q, event.r]);
    else this.hooks.apply([event.q, event.r]);
  }

  /** The hero says emote or phrase `id` (an index in EMOTES) to the peers (#1671). False when the room is closed, the id is unknown, or the
   * last one went less than EMOTE_SEND_MS ago. */
  speak(id: number): boolean {
    const run = this.running;
    const now = this.clock();
    if (!run || !Number.isInteger(id) || id < 0 || id >= EMOTES.length || now - this.lastSay < EMOTE_SEND_MS) return false;
    this.lastSay = now;
    run.net.send(encodeEmote(id));
    return true;
  }

  /** The public name changed: tells the peers here. */
  setName(): void {
    this.running?.net.send(encodeHello(this.name()));
  }

  frame(now: number, hero: Axial, troop: readonly Axial[] = [], bobNow: number | null = null): boolean {
    const run = this.running;
    if (!run) return false;
    run.sender.set(hero[0], hero[1]);
    run.sender.setTroop(troop);
    const message = run.sender.due(now);
    if (message) run.net.send(message);
    const army = run.sender.dueTroop(now);
    if (army) run.net.send(army);
    run.peers.expire(now);
    if (this.retryAt !== null && now >= this.retryAt && run.peers.cells(hero).length === 0) return this.rejoin(hero);
    const owed = this.syncing[0];
    if (owed && now - this.lastSync >= SYNC_MS) {
      this.lastSync = now;
      run.net.send(encodeBreak(owed.events.shift()!), owed.peer);
      if (owed.events.length === 0) this.syncing.shift();
    }
    const cells = run.peers.cells(hero, now);
    this.lastCount = cells.length;
    this.update();
    const list = cells.slice(0, 8).map((c) => ({ name: c.name || 'Another hero', tiles: hexDistance(hero, c.cell) }));
    const key = list.map((h) => `${h.name}:${h.tiles}`).join('|');
    if (key !== this.shownNearby) {
      this.shownNearby = key;
      this.nearby(list);
    }
    return run.layer.update(cells, hero, [hero, ...troop], bobNow);
  }

  /** Joins the room again, keeping the error text until a peer connects. */
  private rejoin(hero: Axial): boolean {
    const failed = this.failed;
    this.stop();
    this.start();
    this.failed = failed;
    this.update();
    return this.running!.layer.update([], hero, [hero]);
  }

  /** Stops sending and receiving: peers drop this hero after 10 s, and it sees nobody. */
  hide(): void {
    if (!this.running) return;
    this.stop();
    this.say({ available: true, hidden: true, text: 'Hidden: nobody sees you and you see nobody.' });
  }

  /** Joins the room again after a Hide. */
  show(): void {
    if (!this.entered || this.running) return;
    this.start();
  }

  private stop(): void {
    const run = this.running;
    if (!run) return;
    this.running = null;
    this.shownNearby = '';
    this.nearby([]);
    this.syncing = [];
    this.lastBreak.clear();
    this.far.clear();
    run.net.close();
    run.layer.dispose();
  }

  leave(): void {
    const wasHere = this.entered !== null;
    this.stop();
    this.entered = null;
    this.held.clear();
    if (wasHere) this.say({ available: false, hidden: false, text: '' });
  }
}
