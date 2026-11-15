// A harness that runs the whole page, src/main.ts, in vitest under jsdom (decision #445): the test file starts with
// `// @vitest-environment jsdom`, then `const game = await boot('?bot=off')` loads index.html's body and imports a fresh
// main.ts on the real wasm engine. What jsdom lacks is stubbed: the three.js renderer (no WebGL or WebGPU, the scene
// graph stays real), the KTX2 texture loader, the bay's model loader, canvas 2D, the web fonts, matchMedia, IndexedDB
// (fake-indexeddb), the bot workers (the worker's answer() runs in-process), the Trystero transport (one end of a
// localPair) and the clock of the animation loop (game.frame), and Web Audio on demand (the fake of src/test/audio.ts).
// Everything is undone when the test ends.
import { IDBFactory } from 'fake-indexeddb';
import { onTestFinished, vi } from 'vitest';
import { BOSS_PROP_PIECES } from '../bossprops';
import page from '../../index.html?raw';
import type { BotRequest, BotResponse } from '../bot';
import type { PeerNet } from '../p2p';
import type { Transport } from '../transport';
import { FakeContext } from './audio';

export interface BootOptions {
  /** Called each time the page creates a bot worker (the bot's or the analysis one). */
  onWorker?: () => void;
  /** navigator.webdriver, true by default as under Playwright: `?nodes=` sets the bot's budget, `__playTurns` exists. */
  webdriver?: boolean;
  /** The IndexedDB the page opens, a fresh one by default. Pass the same one to two boots to reload a saved game. */
  indexedDB?: IDBFactory;
  /** The system's prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** A touch screen: matchMedia('(pointer: coarse)') matches, as on a phone. */
  touch?: boolean;
  /** A fake AudioContext (src/test/audio.ts), read back with `game.hook('__audio')`; none by default, as in a browser
   * without Web Audio. */
  audio?: boolean;
  /** The Cutaway is the default page (#1696). A boot is the old Hub unless the query says `hub=cutaway` or this is true. */
  defaultHub?: boolean;
  /** The texture files under assets/ that fail to load, as a missing file would, `spaceship-bay.glb` included. The others
   * load, each a texture named after its file. */
  missing?: string[];
  /** document.fonts.load, which jsdom lacks: by default every font is in at once. */
  fonts?: (font: string) => Promise<unknown>;
  /** What fails: `worker` answers every bot request with an error, `wasm` and `renderer` reject their init (#736, #737). */
  fails?: 'worker' | 'wasm' | 'renderer';
  /** What the page finds in localStorage when it loads, a player who played before (#1584); empty by default. */
  storage?: Record<string, string>;
  /** The renderer runs on WebGPU, not its WebGL fallback: compute shaders, so clustered lighting (#neon tubes). */
  webgpu?: boolean;
  /** Loads the code of the Open world and of the online Battle royale (their chunks in the build, #1578) after the page, so a click that enters it finds it ready; true by
   * default. False leaves it to the page, as a first entry in a browser. */
  warmChunks?: boolean;
  /** The renderer's compileAsync, the Open world's programs built before its first frame (#1582): done at once by default. */
  compile?: () => Promise<void>;
}

export interface Game {
  /** Calls a window hook main.ts sets for the browser checks (`__legal`, `__rings`, `__plies`, ...), which must exist. */
  hook<T = unknown>(name: string, ...args: unknown[]): T;
  /** Plays a click on a cell by its axial coordinates, as `__click` does (no raycast). */
  click(q: number, r: number): void;
  /** The whole HUD plate as text, and its turn line alone. */
  hud(): string;
  turn(): string;
  /** Presses the cog of the settings menu. */
  openSettings(): void;
  /** Moves the clock `ms` on and runs one frame of the animation loop: slides and ejections advance. */
  frame(ms?: number): void;
  /** Lets the pending tasks run: the bot workers' replies, IndexedDB. */
  settle(): Promise<void>;
  /** Waits until the page is online: it makes its keys first, which may take any time on a loaded machine (#636). */
  online(): Promise<void>;
  /** The three.js scenes drawn so far. */
  draws(): number;
  /** The model files (`arena.glb`, `openworld.glb`, ...) the page asked for so far, in order (#1520). */
  models(): string[];
  /** The texture files (`deck-albedo.ktx2`, ...) the page asked for so far, in order (#1603). */
  textures(): string[];
  /** The tone mapping (three's constant) and the exposure the renderer draws with now (#1520). */
  tone(): { mapping: number; exposure: number };
  /** The other end of the online room once the page goes online (Play online, an invite link), else null. */
  peer(): Transport | null;
  /** The room the page went online in, else null. */
  room(): string | null;
  /** The public Open world's room (#1305), once the page joined it over Trystero (not under ?net=hook), else null. */
  world(): WorldRoom | null;
}

/** The test end of the public world's room: what the page sent, and the calls Trystero would make. */
export interface WorldRoom {
  room: string;
  sent: [Uint8Array, string | undefined][];
  closed: boolean;
  data(bytes: Uint8Array, peer: string): void;
  join(peer: string): void;
  leave(peer: string): void;
  error(message: string): void;
}

// The engine's answers are deterministic (a fixed node budget, bot.ts): the evaluation bar asks the same opening position
// at every boot, a search of ~80 ms. They are kept for the whole test file, keyed by the request but its id (#1079).
const answers = new Map<string, BotResponse>();

// RoundedBoxGeometry is the page's costliest build at boot (~30 ms of vertex maths for the props): the first one of each
// size is kept and the next boots clone it.
const boxes = new Map<string, import('three').BufferGeometry & { parameters?: object }>();

const body = /<body>([\s\S]*)<\/body>/.exec(page)![1]!;
// Taken before any boot wraps them: a second boot in the same test (a reload) wraps these, not the first wrappers.
const addListener = window.addEventListener.bind(window);
const every = setInterval;

// Canvas 2D (the room art, the deck console) draws into nothing: every property and call of the context is a no-op, but
// measureText, for the deck console's line wrap (terminal.ts): a character is 20 px wide.
const nothing: unknown = new Proxy(() => nothing, {
  get: (_, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 20 }) : nothing),
  set: () => true,
  apply: () => nothing,
});

/** The next WebCrypto key pair comes 20 tasks late, after two settle() calls, as on a loaded machine (#636). Called just
 * before the page goes online (before boot() for an invite link), it slows the page's keys, not the test's. */
export function slowKeys(): void {
  const generate = crypto.subtle.generateKey.bind(crypto.subtle) as (...args: unknown[]) => Promise<CryptoKeyPair>;
  vi.spyOn(crypto.subtle, 'generateKey').mockImplementationOnce((async (...args: unknown[]) => {
    for (let i = 0; i < 20; i++) await new Promise((done) => setTimeout(done));
    return generate(...args);
  }) as never);
}

/** Loads index.html and a fresh main.ts at `url` (a path, a query and a hash, for example `?bot=off`). */
export async function boot(url = '/', options: BootOptions = {}): Promise<Game> {
  const { webdriver = true, reducedMotion = false, touch = false } = options;
  const undo: (() => void)[] = [];
  onTestFinished(() => {
    for (const fn of undo.reverse()) fn();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('three/webgpu');
    vi.doUnmock('edgefall-wasm');
    vi.doUnmock('../p2p');
    vi.doUnmock('../hubcutaway');
    vi.doUnmock('three/examples/jsm/geometries/RoundedBoxGeometry.js');
    vi.doUnmock('three/examples/jsm/loaders/KTX2Loader.js');
    vi.doUnmock('three/examples/jsm/loaders/GLTFLoader.js');
  });

  // The page: index.html's body, a clean root, no saved settings, the URL.
  const root = document.documentElement;
  for (const { name } of [...root.attributes]) if (name !== 'lang') root.removeAttribute(name);
  document.body.replaceWith(Object.assign(document.createElement('body'), { innerHTML: body }));
  localStorage.clear();
  for (const [key, value] of Object.entries(options.storage ?? {})) localStorage.setItem(key, value);
  history.replaceState(null, '', new URL(url, location.origin).href);
  Object.defineProperty(navigator, 'webdriver', { value: webdriver, configurable: true });
  undo.push(() => Reflect.deleteProperty(navigator, 'webdriver'));

  // The clock of the animation loop, moved by frame() only.
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'info').mockImplementation(() => {}); // the page's diagnostics log (logger.ts)

  vi.stubGlobal('indexedDB', options.indexedDB ?? new IDBFactory());
  if (options.audio) vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (reducedMotion && query.includes('reduced-motion')) || (touch && query.includes('pointer: coarse')),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => nothing as RenderingContext);
  Object.assign(Element.prototype, { setPointerCapture() {}, releasePointerCapture() {} });
  Object.defineProperty(document, 'fonts', { value: { load: options.fonts ?? (async () => []) }, configurable: true });
  undo.push(() => Reflect.deleteProperty(document, 'fonts'));

  // Window listeners and intervals of this page, removed when the test ends so the next boot starts alone.
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener, opts) => {
    addListener(type, listener, opts);
    undo.push(() => window.removeEventListener(type, listener, opts));
  });
  vi.stubGlobal('setInterval', (fn: () => void, ms?: number) => {
    const id = every(fn, ms);
    undo.push(() => clearInterval(id));
    return id;
  });
  // Timeouts too: one left pending (a bot reply, the joiner's 30 s signaling timeout) would fire in a later test, or log
  // after the file's environment closed (#623). Taken at boot, not before: a test may spy on setTimeout first.
  const later = setTimeout;
  const cancel = clearTimeout;
  vi.stubGlobal('setTimeout', (...args: Parameters<typeof setTimeout>) => {
    const id = later(...args);
    undo.push(() => cancel(id));
    return id;
  });

  // The KTX2 texture loader (#700): each file under assets/ loads as a texture named after it, but the missing ones. As
  // the real one, it needs the renderer up first.
  const models: string[] = [];
  const textures: string[] = [];
  const missing = (url: string): boolean => !!options.missing?.includes(url.slice(url.lastIndexOf('/') + 1));
  vi.doMock('three/examples/jsm/loaders/KTX2Loader.js', async () => {
    const { Texture } = await vi.importActual<typeof import('three')>('three');
    return {
      KTX2Loader: class {
        ready = false;
        detectSupport(renderer: { initialized?: boolean }): this {
          if (!renderer.initialized) throw new Error('detectSupport() before await renderer.init()');
          this.ready = true;
          return this;
        }
        loadAsync = async (url: string): Promise<InstanceType<typeof Texture>> => {
          const name = url.slice(url.lastIndexOf('/') + 1);
          if (!this.ready) throw new Error('THREE.KTX2Loader: Missing initialization with `.detectSupport( renderer )`.');
          textures.push(name);
          if (missing(url)) throw new Error(`404 ${name}`);
          return Object.assign(new Texture(), { name });
        };
      },
    };
  });

  // The renderer draws nothing: it keeps the animation loop for frame() and counts the draws.
  let loop: ((now: number) => void) | null = null;
  let renderer: { toneMapping: number; toneMappingExposure: number; info: { autoReset: boolean; reset(): void } } | null = null;
  let draws = 0;
  vi.resetModules();
  vi.doMock('edgefall-wasm', async (importOriginal) => {
    const wasm = await (await import('./wasm')).nodeWasm(importOriginal as never);
    return options.fails === 'wasm' ? { ...wasm, default: () => Promise.reject(new Error('wasm fetch failed')) } : wasm;
  });
  vi.doMock('three/webgpu', async (importOriginal) => {
    const THREE = await importOriginal<typeof import('three/webgpu')>();
    class WebGPURenderer {
      domElement = document.createElement('canvas');
      backend = { isWebGPUBackend: options.webgpu ?? false };
      toneMapping = 0;
      constructor() {
        renderer = this;
      }
      // As three's: the animation loop zeroes the frame's counts before each frame unless autoReset is off; a render adds its own.
      info = {
        autoReset: true,
        render: { calls: 9000, drawCalls: 0, triangles: 0 },
        memory: { geometries: 5, textures: 2 },
        reset: (): void => {
          this.info.render.drawCalls = 0;
          this.info.render.triangles = 0;
        },
      };
      toneMappingExposure = 1;
      shadowMap = { enabled: false, type: 0 }; // the sun's soft shadow on the terrace (#1364)
      initialized = false;
      init = async (): Promise<void> => {
        if (options.fails === 'renderer') throw new Error('no GPU');
        this.initialized = true;
      };
      setPixelRatio(): void {}
      setSize(): void {}
      getMaxAnisotropy = (): number => 1;
      compileAsync = options.compile ?? (async (): Promise<void> => {}); // the Open world's programs, built before its first frame (#1582)
      render(): void {
        draws++;
        this.info.render.drawCalls += 7;
        this.info.render.triangles += 300;
      }
      setAnimationLoop(fn: ((now: number) => void) | null): void {
        loop = fn;
      }
    }
    class PMREMGenerator {
      // The texture remembers what it was made from: the scene, the capture options.
      fromScene = (scene: InstanceType<typeof THREE.Scene>, _sigma: number, _near: number, _far: number, options: object) => ({
        texture: Object.assign(new THREE.Texture(), { userData: { scene, options } }),
      });
      dispose(): void {}
    }
    return { ...THREE, WebGPURenderer, PMREMGenerator };
  });
  // The spaceship bay (#648): its maps load as above, its model as an empty scene, unless missing.
  vi.doMock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
    const { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial } = await vi.importActual<typeof import('three')>('three');
    const piece = (name: string): InstanceType<typeof Mesh> => {
      const box = new BoxGeometry(1, 0.1, 1);
      box.setAttribute('color', new BufferAttribute(new Float32Array(box.attributes.position!.count * 3).fill(0.5), 3)); // the vertex colours of the file
      return Object.assign(new Mesh(box, new MeshStandardMaterial()), { name });
    };
    return {
      GLTFLoader: class {
        setMeshoptDecoder(): this {
          return this; // the model is a few boxes: nothing to decode
        }
        loadAsync = async (url: string): Promise<{ scene: InstanceType<typeof Group> }> => {
          models.push(url.slice(url.lastIndexOf('/') + 1));
          if (missing(url)) throw new Error(`404 ${url}`);
          // The terrace (#1314): the arena as one box, its kit as the pieces the game draws itself.
          const scene = new Group();
          if (url.endsWith('arena.glb') && !url.endsWith('kit-arena.glb')) {
            scene.add(piece('scene_slab_arena'), piece('scene_post_0')); // a post: the royale's slab borrows the arena's (#1374)
            // its 61 dishes, where the board's cells are (#1374)
            for (let q = -4, i = 0; q <= 4; q++) {
              for (let r = -4; r <= 4; r++) {
                if (Math.abs(q + r) > 4) continue;
                const cell = piece(`scene_cell_${String(i++).padStart(2, '0')}`);
                cell.position.set(q + r / 2, 0, (Math.sqrt(3) / 2) * r);
                scene.add(cell);
              }
            }
          }
          if (url.endsWith('kit-boss.glb')) scene.add(...['kit_prop_pylon', 'kit_prop_pylon_core', 'kit_prop_press_gantry', 'kit_prop_buffer_stop', ...BOSS_PROP_PIECES].map(piece));
          if (url.endsWith('slab-ballast.glb')) scene.add(piece('scene_ballast_slab'), piece('scene_ballast_cell_000'));
          if (url.endsWith('slab-hub.glb')) scene.add(piece('scene_slab_hub'), piece('scene_hub_cell_00'), ...['scene_hub_prop_door', 'scene_hub_ring_door', 'scene_hub_prop_lift', 'scene_row21_lockbar'].map(piece)); // the props the game puts on its rooms (#1374)
          if (url.endsWith('slab-royale.glb')) scene.add(piece('scene_royale_slab'), piece('scene_royale_cell_000'));
          if (url.endsWith('slab-dual.glb')) scene.add(piece('scene_dual_slab_n'), piece('scene_dual_cell_000'));
          if (url.endsWith('kit-arena.glb')) scene.add(...['kit_pedestal_flat', 'kit_ring_target', 'kit_arrow_target', 'kit_ring_select', 'kit_ring_lastmove'].map(piece));
          if (url.endsWith('kit-ring-hint.glb')) scene.add(piece('kit_ring_hint'));
          const cutaway = /hub-cutaway-(tall|wide)\.glb$/.exec(url); // the Hub Cutaway (#1691): a hull, a few bays on five floors of four decks, the marble and the lift's car
          if (cutaway) {
            const nodes: [string, number, number][] = [['hull', 0, 0], ['bay_mess_world', -2, 0.24], ['bay_mess_bot', 0.58, 0.24], ['bay_mess_logs', -1, 1.4], ['bay_mess_echo', 0.58, 1.4], ['bay_mess_daily', 2.58, 1.4], ['bay_cargo_run', 2.58, 2.78], ['bay_cargo_crates', -1, 2.78], ['bay_cargo_hull', 0.58, 3.94], ['bay_furnace_choir', 0.58, 5.32], ['marble', 0.29, 3], ['car', 0, 2.78]];
            for (const [name, x, y] of nodes) {
              const part = piece(`hub_${cutaway[1]}_${name}`);
              part.position.set(x, y, 0);
              scene.add(part);
            }
          }
          return { scene };
        };
      },
    };
  });

  vi.doMock('three/examples/jsm/geometries/RoundedBoxGeometry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three/examples/jsm/geometries/RoundedBoxGeometry.js')>();
    const { BufferGeometry } = await vi.importActual<typeof import('three')>('three');
    return {
      RoundedBoxGeometry: class extends actual.RoundedBoxGeometry {
        constructor(...args: ConstructorParameters<typeof actual.RoundedBoxGeometry>) {
          const key = args.join();
          const kept = boxes.get(key);
          if (kept) {
            super(1, 1, 1, 0, 0); // a unit box, replaced by the kept one below
            this.copy(kept);
            Object.assign(this, { parameters: kept.parameters });
          } else {
            super(...args);
            boxes.set(key, Object.assign(new BufferGeometry().copy(this), { parameters: this.parameters }));
          }
        }
      },
    };
  });

  // The public Open world's room (#1305): a recorder in place of Trystero.
  let world: WorldRoom | null = null;
  // The online room: main.ts gets one end of a local pair, the test holds the other.
  let peer: Transport | null = null;
  let room: string | null = null;
  if (!options.defaultHub) {
    vi.doMock('../hubcutaway', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../hubcutaway')>()),
      cutawayOn: (search: string): boolean => new URLSearchParams(search).get('hub') === 'cutaway',
    }));
  } else vi.doUnmock('../hubcutaway');
  vi.doMock('../p2p', async (importOriginal) => {
    const { localPair } = await import('../transport');
    return {
      ...(await importOriginal<typeof import('../p2p')>()),
      p2pTransport: (id: string): Transport => {
        const [mine, theirs] = localPair();
        [peer, room] = [theirs, id];
        return mine;
      },
      p2pPeers: (id: string): PeerNet => {
        let onData: (d: Uint8Array, peer: string) => void = () => {};
        let onJoin: (peer: string) => void = () => {};
        let onLeave: (peer: string) => void = () => {};
        let onError: (message: string) => void = () => {};
        const mine: WorldRoom = {
          room: id,
          sent: [],
          closed: false,
          data: (d, peer) => onData(d, peer),
          join: (peer) => onJoin(peer),
          leave: (peer) => onLeave(peer),
          error: (message) => onError(message),
        };
        world = mine;
        return {
          send: (d, to) => void mine.sent.push([d, to]),
          onData: (cb) => void (onData = cb),
          onJoin: (cb) => void (onJoin = cb),
          onLeave: (cb) => void (onLeave = cb),
          onError: (cb) => void (onError = cb),
          close: () => void (mine.closed = true),
        };
      },
    };
  });

  // The bot workers answer in-process, on the next task, with the page's own engine.
  const wasm = await import('edgefall-wasm');
  const { answer, encounterFor, engineFor } = await import('../bot');
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((e: MessageEvent<BotResponse>) => void) | null = null;
      constructor() {
        options.onWorker?.();
      }
      postMessage(req: BotRequest): void {
        setTimeout(() => {
          if (options.fails === 'worker') return void this.onmessage?.({ data: { id: req.id, error: 'Error: boom' } } as never);
          const { id, ...query } = req;
          const key = JSON.stringify(query);
          let response = answers.get(key);
          if (!response) {
            response = answer(req, (army, placed, foes, trainer, relics) => engineFor(wasm.Engine, army, placed, foes, trainer, relics), (boss, seed, placed, relics, mirror) => encounterFor(wasm.Encounter, boss, seed, placed, relics, mirror));
            answers.set(key, response);
          }
          this.onmessage?.({ data: { ...response, id } } as MessageEvent<BotResponse>);
        });
      }
      terminate(): void {}
    },
  );

  await import('../main');
  if (options.warmChunks !== false) await Promise.all([import('../openworldwire'), import('../royale-net')]);
  const hook = <T>(name: string, ...args: unknown[]): T => {
    const fn = (window as unknown as Record<string, ((...args: unknown[]) => T) | undefined>)[name];
    if (!fn) throw new Error(`main.ts sets no ${name} hook`);
    return fn(...args);
  };
  const byId = (id: string): HTMLElement => document.getElementById(id)!;
  const game: Game = {
    hook,
    click: (q, r) => void hook('__click', q, r),
    hud: () => byId('hud').textContent ?? '',
    turn: () => byId('hud').querySelector('.turn')?.textContent ?? '',
    openSettings: () => byId('settings').click(),
    frame: (ms = 16) => {
      clock += ms;
      renderer?.info.autoReset && renderer.info.reset();
      loop?.(clock);
    },
    settle: async () => {
      for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done));
    },
    online: async () => {
      while (document.body.dataset.online === undefined) await new Promise((done) => setTimeout(done));
    },
    draws: () => draws,
    models: () => models,
    textures: () => textures,
    tone: () => ({ mapping: renderer!.toneMapping, exposure: renderer!.toneMappingExposure }),
    peer: () => peer,
    room: () => room,
    world: () => world,
  };
  return game;
}

const BOSS_OF: Record<string, string> = { 'The Echo': 'echo', 'The Hull': 'hull', 'The Choir': 'choir', 'The Chaplain': 'chaplain', 'The Ballast Mind': 'ballast', 'The Alien': 'alien', 'The Rail Yard': 'railyard', 'The Magnetizer': 'magnetizer', 'The Pulsar': 'pulsar', 'The Overseer': 'overseer', 'The Assembly Line': 'assembly', 'The Unstable Core': 'core', 'The Dual Room': 'dual', 'The Stalker': 'stalker', 'The Swarm': 'swarm' };

/** Starts a solo boss fight through the page's test hook, by its title (`The Hull`, a start of it or a text that holds it) or its id (`hull`): the Modes menu and its boss list are gone (#1697), a bay starts a boss in the ship. */
export function startBoss(name: string): void {
  if (!navigator.webdriver) throw new Error('startBoss needs a page under automation (webdriver true): the hook is not there otherwise, a bay or a door starts the boss');
  const title = Object.keys(BOSS_OF).find((k) => k === name || k.startsWith(name) || name.includes(k));
  const id = title ? BOSS_OF[title]! : name;
  (window as unknown as { __startMode: (id: string) => void }).__startMode(id);
}
