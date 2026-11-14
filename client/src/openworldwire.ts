// The Open world as one chunk of the build (#1578): the root of everything only the world needs, loaded by `import()` at the first
// entry (modechunk.ts, openworldhandle.ts). `wireOpenWorld` makes the mode, its saves and its online layer from the page's `deps`, and
// binds the world's own HUD controls. The page keeps what it shares with the table: the keys, the pointer, the frame and the fights.
import { bindAsk } from './openworldask';
import { boss_ids, boss_name, world_cairns, world_can_break, world_chunk, world_dungeon, world_enemies, world_is_enemy, world_lairs, world_logs, world_pads, world_path, world_places, world_rings, world_teleporters, world_version } from 'edgefall-wasm';
import type * as THREE from 'three/webgpu';
import type { Axial } from './board';
import type { Biome } from './openworld';
import type { WorldCue } from './cues';
import { hasMedal } from './medals';
import { markRead } from './lorestore';
import { netHook } from './hooks';
import { hookPeers, p2pPeers } from './p2p';
import { applyNeonWorld } from './neonworld';
import { FightState } from './openworldfight';
import { OpenWorldMode } from './openworldmode';
import type { OpenWorldParts } from './openworldhandle';
import { AMBIENT } from './openworldparticles';
import { worldSaves } from './openworldsave';
import { firstNewLine } from './placelines';
import type { MarbleSkins } from './openworldstripe';
import { BIOME_LOOK, LAIR_LOOK, LOOK, MARBLE_LOOK as WORLD_MARBLES, PROPS, TELEPORTER_LOOK, WATER, loadModels } from './openworldview';
import type { Phase } from './daynight';
import { read, write, type Store } from './quality';
import type { KeyStore } from './savegame';
import { storyStage } from './story';
import { meshoptLoader } from './roomloader';
import { WorldPeersHost } from './worldnet';
import { worldKeys } from './worldevents';
import { cleanName, EMOTES, readName, writeName } from './worldpeers';

/** What the world takes from the page: the stores, and the few things it asks the page to do. */
export interface OpenWorldDeps {
  store: Store;
  /** The IndexedDB store of the saved worlds. */
  gameStore: KeyStore;
  /** `?look=neon` is on: the world takes the neon palette (#1424). */
  neon: boolean;
  reduced: () => boolean;
  /** The worn skins of the ship, once their maps are on (#1176). */
  skins: () => Promise<MarbleSkins>;
  steering: () => boolean;
  /** The renderer frees what it keeps per scene (#1258). */
  releaseScene: (scene: THREE.Scene) => void;
  /** A lair starts the boss fight on the board of the hour (#1170). */
  startLair: (seed: number, lair: number, phase: Phase, brought: number[], relics: number[]) => void;
  /** A town opens the Hub and a gate the rogue-lite run (#1593). */
  onPlace: (seed: number, kind: 'town' | 'dungeon', index: number, biome: Biome, contract: string) => void;
  /** Whether the page took the public world online. */
  online: () => boolean;
  /** The boss lairs of a world as cells (#1305). */
  lairCells: (seed: number) => Axial[];
  /** A wild fight is about to start: the page wipes the screen and opens the arena (#1511). */
  onWild: (seed: number, home: Axial, phase: Phase, brought: number[], relics: number[]) => void;
  cue: (event: WorldCue) => void;
  /** The tick the enemy marbles wander by when a spec fixes it, else null (#1511). */
  wanderTick: () => number | null;
}

export function wireOpenWorld(deps: OpenWorldDeps): OpenWorldParts {
  const { store } = deps;
  if (deps.neon) applyNeonWorld(true, { LOOK, WATER, BIOME_LOOK, PROPS, MARBLE_LOOK: WORLD_MARBLES, LAIR_LOOK, TELEPORTER_LOOK, AMBIENT }); // the Open world's palette, the minimap's too
  const saves = worldSaves(deps.gameStore, world_version());
  const mode: OpenWorldMode = new OpenWorldMode(
    (seed, cx, cy) => world_chunk(seed, cx, cy),
    (seed, cx, cy) => Int32Array.from(world_enemies(seed, cx, cy)),
    () =>
      loadModels(
        {
          low: `${import.meta.env.BASE_URL}assets/pbr/openworld.glb`,
          high: `${import.meta.env.BASE_URL}assets/pbr/openworld-hi.glb`,
          lair: `${import.meta.env.BASE_URL}assets/pbr/openworld-lair.glb`,
        },
        meshoptLoader(),
      ),
    deps.reduced,
    saves,
    (seed) => Int32Array.from(world_lairs(seed)),
    (seed, lair, brought, relics) => deps.startLair(seed, lair, mode.phase, brought, relics),
    deps.skins,
    () => ({ have: boss_ids().filter((id) => hasMedal(store, id)).length, total: boss_ids().length }), // one medal per boss, from the shared store (#1171)
    () => {
      // Tally's claim line, once per player (#1171): the flag sits in the same store as the medals. The line number is the stage 5 secret (#1584).
      if (read(store, 'ab-alone.tally0412') === 'seen') return '';
      write(store, 'ab-alone.tally0412', 'seen');
      return storyStage(store) >= 5 ? 'Claim 0412: unworked.' : 'Claim: unworked.';
    },
    (seed, from, to, blocked, broken) => Int32Array.from(world_path(seed, from[0], from[1], to[0], to[1], blocked, broken)), // the walk to a far cell (#1137)
    deps.steering,
    deps.releaseScene,
    (seed, from, beaten, blocked, broken) => Int32Array.from(world_dungeon(seed, from[0], from[1], beaten, blocked, broken)), // the Dungeon button (#1291)
    (seed) => Int32Array.from(world_teleporters(seed)), // the teleporters (#1412)
    () => boss_ids(), // lair k is boss k round the roster: the tower icons of the map (#1438)
    (seed) => Int32Array.from(world_logs(seed)), // the lore logs (#1589)
    (id) => markRead(store, id), // a log read joins the log archive (#1589)
    (seed) => Int32Array.from(world_places(seed)), // the towns and dungeon gates (#1514)
    deps.onPlace,
    () => storyStage(store), // the clamp of Tally's lines is open from stage 7 (#1546)
    (seed) => Uint8Array.from(world_rings(seed)), // the ring of each tower and the dungeon tier of each gate (#1532)
    (seed) => Int32Array.from(world_pads(seed)), // the pad a tower beaten through the world leaves (#1531)
    (id) => boss_name(id)!, // the title of a tower entered (#1519)
    (kinds) => firstNewLine(store, kinds), // Tally files the first town, gate, tower or biome reached, once per kind (#1315)
    (seed, cx, cy) => Int32Array.from(world_cairns(seed, cx, cy)), // the cairns of a chunk, so no open cell lies far from a landmark (#1533)
  );
  mode.cue = deps.cue; // the step, the pickup and the time of day (#1570)
  document.getElementById('openworld-dungeon')!.addEventListener('click', () => mode.dungeon());
  const mapButton = document.getElementById('openworld-map-button')!;
  mapButton.addEventListener('click', () => {
    mode.toggleMap(); // the map of the cells discovered (#1411)
    mapButton.blur(); // the keys and the pad go back to the world
  });
  const teleportButton = document.getElementById('openworld-teleport')!;
  teleportButton.addEventListener('click', () => {
    mode.teleport(); // the choice of a teleporter on the map (#1412)
    teleportButton.blur();
  });
  // The public world (#1305): one fixed seed where everybody lands by default, the only world with other heroes. It joins its room only
  // after the opt-in (consent.ts); Stay solo opens the same world offline. New world and any other seed stay private and offline. An
  // automated page stays offline too unless it asks for the hook transport (?net=hook) or the opt-in dialog (?consent).
  const netBox = document.getElementById('openworld-online')!;
  const netHide = document.getElementById('openworld-hide') as HTMLButtonElement;
  const netName = document.getElementById('openworld-name') as HTMLInputElement;
  const nearby = document.getElementById('openworld-nearby')!;
  const emotes = document.getElementById('openworld-emotes')!;
  const emoteButton = document.getElementById('openworld-emote') as HTMLButtonElement;
  const hud = document.getElementById('openworld-hud')!;
  const openEmotes = (): void => {
    emotes.hidden = false;
    emoteButton.setAttribute('aria-expanded', 'true');
    hud.dataset.say = ''; // the plate shrinks to the online box on a phone
  };
  const closeEmotes = (): void => {
    emotes.hidden = true;
    emoteButton.setAttribute('aria-expanded', 'false');
    delete hud.dataset.say;
  };
  const peers = new WorldPeersHost(
    (room) => (netHook(location.search) ? hookPeers() : p2pPeers(room)),
    deps.online,
    document.getElementById('openworld-peers')!,
    (status) => {
      // The HUD's online controls: the status line, and Hide or Show. They exist in the public world only.
      if (netBox.hidden && status.available) netName.value = readName(store); // the field shows the stored name when the controls appear
      netBox.hidden = !status.available;
      document.getElementById('openworld-net')!.textContent = status.text;
      netHide.textContent = status.hidden ? 'Show' : 'Hide';
      netHide.setAttribute('aria-pressed', String(status.hidden));
      emoteButton.disabled = status.hidden; // nobody hears a hidden hero
      if (status.hidden || !status.available) closeEmotes();
    },
    () => readName(store),
    // The signed events of the public world (#1305): the player's key, the engine's rule of what can break, and what a break of another hero does.
    {
      keys: () => worldKeys(store),
      canBreak: (seed, q, r) => world_can_break(seed, q, r),
      apply: (cell) => mode.remoteBreak(cell),
      canBeaten: (seed, q, r) => world_is_enemy(seed, q, r),
      beat: (cell) => mode.remoteBeaten(cell),
      canLair: (seed, q, r) => deps.lairCells(seed).some(([a, b]) => a === q && b === r),
      lair: (cell) => mode.remoteLair(cell),
    },
    undefined,
    store, // the signed events are kept in this browser (#1305)
    (heroes) => nearby.replaceChildren(...heroes.map(({ name, tiles }) => Object.assign(document.createElement('li'), { textContent: `${name}, ${tiles} ${tiles === 1 ? 'tile' : 'tiles'} away` }))), // names are text, never markup
  );
  mode.peers = peers;
  bindAsk(mode, document.querySelector<HTMLElement>('canvas[aria-label="Edgefall board"]')!); // the question of a wild marble (#1662)
  mode.store = store; // the one lesson of the roll (#1604)
  mode.onWild = (seed, home, brought, relics) => deps.onWild(seed, home, mode.phase, brought, relics); // the hour the marble was met at dresses the arena
  // The clock the enemy marbles wander by (#1511): the wall clock in ticks, so every peer sees them in the same places.
  mode.wander = () => deps.wanderTick() ?? Math.floor(Date.now() / FightState.tickMs);
  netHide.addEventListener('click', () => (netHide.getAttribute('aria-pressed') === 'true' ? peers.show() : peers.hide()));
  // The emotes and phrases (#1671): a fixed list, only its index goes on the wire; one a 2 s, the rest is dropped.
  emotes.replaceChildren(...EMOTES.map((text, id) => Object.assign(document.createElement('button'), { type: 'button', textContent: text, onclick: () => peers.speak(id) })));
  emoteButton.addEventListener('click', () => (emotes.hidden ? openEmotes() : closeEmotes()));
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || emotes.hidden) return;
    e.stopPropagation(); // Escape closes the menu first, and does not leave the world
    closeEmotes();
  }, { capture: true });
  netName.addEventListener('input', () => {
    writeName(store, cleanName(netName.value)); // the field keeps what was typed, the store and the peers get the clean name
    peers.setName();
  });
  return { mode, saves, peers };
}
