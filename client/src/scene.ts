import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { max, pass, renderOutput, saturation, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { axialTo3D } from './board';
import { REST, type Kick } from './kick';
import { FOV, framing, screenView, viewPosition, type View } from './camera';
import { DECKS, LIGHT } from './light';
import { TONAL, flat as flatTone } from './look';
import { DECK_PARTICLES, type Deck } from './deck';
import { deckPropColour, deckPropGeometry, deckPropSpot } from './deckprop';
import { fogSettings, hasParticles, renderPixelRatio, smoothEdges, type Tier } from './quality';
import { FRAME, frameShape, rimHalves, type FrameShape, type Point } from './frame';
import { notchRow } from './notches';
import { applyDeckAtmosphere, DECK_ATMOSPHERES, type DeckId, type SpaceshipBayAssets } from './roomloader';
import { ROOM_SURFACE, type StructuralPart } from './room';
import { type BoardLook, TERRACE_LOOK, terraceDeckLook, terraceSpaceLook } from './boardlook';
import type { Space } from './bossspace';
import { softLook } from './softlook';
import { NEON, NEON_LIGHT, lightNeon, neonDeckLook, neonSkyOf, neonStars, type RunCue } from './neonlook';
import { TERRACE_EXPOSURE, addSun, aimSunShadow, sunPosition } from './tablezero';

export const BONE = 0xd8d4c8;
export const COLORS = { base: 0x0b0d0f, steel: 0x4a5258, cyan: 0x7fd6e8 } as const;
export const FRAME_LOOK = { plate: 0x1f1f1f, plateTiles: 0x808080, rim: 0x5d5d5d } as const;
/** What AgX takes out of the palette is given back (art director: about 8 to 10 percent). */
export const TERRACE_SATURATION = 1.35;
/** Contrast after the tone map, round the picture's mean luminance (about 0.44, measured): 1 leaves it; the terrace asks a little more, both tiers (#1398). */
export const TERRACE_CONTRAST = 1.12;
const CONTRAST_PIVOT = 0.44;
/** The radius of the rounded edges of the board's plate and rim. */
const FRAME_BEVEL = 0.03;

export type NotchRow = NonNullable<ReturnType<typeof notchRow>>;

export interface SceneRendererOptions {
  /** main.ts makes it first: KTX2Loader asks it which GPU formats it reads (#700). */
  renderer: THREE.WebGPURenderer;
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
  webdriver?: boolean;
  /** `?look=neon` (#1424): the terrace's picture is not graded (no extra saturation or contrast: the palette is already the look). */
  neon?: boolean;
  backdrop?: THREE.Texture | null;
  deckAlbedo?: THREE.Texture | null;
  deckRoughness?: THREE.Texture | null;
  firstDeckMap?: THREE.Texture | null;
  firstDeckNormal?: THREE.Texture | null;
  plateAlbedo?: THREE.Texture | null;
  plateRoughness?: THREE.Texture | null;
  plateNormal?: THREE.Texture | null;
  plateMetalness?: THREE.Texture | null;
  rimAlbedo?: THREE.Texture | null;
  rimRoughness?: THREE.Texture | null;
  rimNormal?: THREE.Texture | null;
  /** The Fluent x Material look (#1138, look.ts): the plate and the rim are flat tonal materials. */
  tonal?: boolean;
  /** False on the low tier (#849, quality.ts hasBloom): no bloom pass. */
  bloom?: boolean;
}

export interface ViewContext {
  tier: Tier;
  clear: boolean;
  deck: Deck;
  consoleDef?: {
    position: readonly [number, number, number];
    size: readonly [number, number, number, ...number[]];
  };
}

export function createBloomPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  smooth = false,
  blurEvery = 2,
  withBloom = true,
  /** Colour saturation after the tone map: 1 leaves it (the room), the terrace asks more (AgX washes the palette). */
  saturate = 1,
  /** Contrast after the tone map and the saturation: 1 leaves it. */
  contrast = 1,
): (THREE.RenderPipeline & { bloom: ReturnType<typeof bloom> | null }) | null {
  try {
    // The low tier (#849) draws no bloom: the scene goes straight to the screen, or through FXAA alone.
    if (!withBloom && !smooth && saturate === 1 && contrast === 1) return null;
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const colorNode = scenePass.getTextureNode('output');
    if (!withBloom) {
      pipeline.outputColorTransform = false;
      const toned = saturate === 1 ? renderOutput(colorNode) : saturation(renderOutput(colorNode), saturate);
      const graded = contrast === 1 ? toned : vec4(max(toned.rgb.sub(CONTRAST_PIVOT).mul(contrast).add(CONTRAST_PIVOT), 0), 1);
      pipeline.outputNode = smooth ? fxaa(graded) : graded;
      return Object.assign(pipeline, { bloom: null });
    }
    const bloomNode = bloom(colorNode, 0.175, 0.15, 1);
    bloomNode.setResolutionScale(0.25); // a soft glow: a quarter of the resolution is enough (#781, #844)
    const blur = bloomNode.updateBefore.bind(bloomNode);
    let frame = 0;
    bloomNode.updateBefore = (f) => {
      // every second frame: the 12 blur passes are a third of a phone's frame, the glow stays put in between (#894).
      // Under automation every draw (#921): the draws are seconds apart, and a check sees the one it asked for.
      if (frame++ % blurEvery === 0) blur(f);
    };
    pipeline.outputNode = colorNode.add(bloomNode);
    // No MSAA (#857): `smooth` ends with FXAA, which reads the tone-mapped picture, so renderOutput maps it once here.
    if (smooth) {
      pipeline.outputColorTransform = false;
      pipeline.outputNode = fxaa(renderOutput(pipeline.outputNode));
    }
    return Object.assign(pipeline, { bloom: bloomNode }); // its strength, radius and threshold tuned with ?lights

  } catch {
    return null;
  }
}

/**
 * The game's scene: a hidden child keeps its last matrices until it is shown, since nothing draws it. The hidden battle
 * royale arena alone is 434 meshes, a fifth of a phone's frame recomputed for nothing (#885).
 */
class DrawnScene extends THREE.Scene {
  override updateMatrixWorld(): void {
    this.updateMatrix(); // the scene itself never moves
    this.matrixWorld.copy(this.matrix);
    this.matrixWorldNeedsUpdate = false;
    for (const child of this.children) if (child.visible) child.updateMatrixWorld(true);
  }
}

/** Empties a group of marks the game redraws. A mesh taken out of the scene keeps the renderer's record of it, and the scene through it, until it is
 * disposed: its shared geometry and material are never freed, so the mesh is, or each redraw leaves its marks behind (#1520). */
export function clearDrawn(group: THREE.Group): void {
  for (const mesh of group.children) mesh.dispose();
  group.clear();
}

export class SceneRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: 'WebGPU' | 'WebGL2';
  readonly pipeline: ReturnType<typeof createBloomPipeline> = null;
  /** The terrace's: no bloom, FXAA when MSAA is off, and the saturation AgX takes out (#1314). */
  readonly flatPipeline: ReturnType<typeof createBloomPipeline> = null;

  readonly fogObj: THREE.Fog;
  readonly particles: THREE.Points;
  readonly particlePositions: Float32Array;
  readonly particleGeometry: THREE.BufferGeometry;
  readonly particlePositionAttr: THREE.BufferAttribute;
  readonly particleMaterial: THREE.PointsMaterial;

  readonly plate: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly rim: {
    near: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    far: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  };
  readonly roomDeck: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly propsGroup: THREE.Group;
  /** The silhouette prop of the deck in play (#1551): one mesh, one flat material, its shape and colour changed with the deck; shown on the arena's terrace, not in the room nor at the hub. */
  readonly deckProp: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>;
  private propShown = true;
  /** The terrace (#1314): the arena's glTF and its sun, shown in place of the room and of the plate and rim in a 1v1 game. */
  readonly terrace: THREE.Group;
  terraceOn = false;
  /** The terrace's sun: it casts the soft shadow on the high tier (#1364). */
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  /** The lair fight's look (#1496), if one is asked for, and the colours the file's materials had before the looks. */
  private boardLook: BoardLook | null = null;
  /** The boss space of the fight on (#1551), its terrace look, and the look the terrace wears (null: the arena's own, never touched). */
  private space: Space | null = null;
  private spaceLook: BoardLook | null = null;
  private worn: BoardLook | null = null;
  private readonly paints = new WeakMap<THREE.Material, THREE.Color>();
  private readonly neon: boolean;
  private roomBackground: THREE.Color | THREE.Texture | null = null;

  readonly notches: THREE.Group;
  readonly tallies: readonly [THREE.Group, THREE.Group];
  readonly marbles: THREE.Group;
  readonly ghosts: THREE.Group;
  readonly arenaMarbles: THREE.Group;

  readonly grooveGeometry: THREE.BoxGeometry;
  readonly scratchGeometry: THREE.BoxGeometry;
  readonly thresholdGeometry: THREE.BufferGeometry;
  readonly thresholdMarkGeometry: THREE.BufferGeometry;
  readonly grooveMaterial: THREE.MeshBasicMaterial;
  readonly scratchMaterial: THREE.MeshBasicMaterial;

  frame: FrameShape | null = null;
  fogRadius = 4;
  currentBay: SpaceshipBayAssets | null = null;
  private lastParticleNow = 0;

  constructor(options: SceneRendererOptions) {
    const width = options.innerWidth ?? innerWidth;
    const height = options.innerHeight ?? innerHeight;
    const dpr = options.devicePixelRatio ?? devicePixelRatio;
    const webdriver = options.webdriver ?? Boolean(navigator.webdriver);

    this.renderer = options.renderer;
    this.neon = Boolean(options.neon);
    this.renderer.setPixelRatio(renderPixelRatio(dpr, webdriver));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const b = (this.renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend;
    this.backend = b ? 'WebGPU' : 'WebGL2';

    this.scene = new DrawnScene();
    this.scene.name = 'edgefall-scene';
    this.scene.background = options.backdrop ?? new THREE.Color(COLORS.base);
    this.scene.environmentIntensity = LIGHT.environment.intensity;

    this.camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
    this.frameCamera(width, height);

    this.fogObj = new THREE.Fog(DECK_ATMOSPHERES.mess.fogColor, 10, 20);

    const maxParticles = Math.max(...Object.values(DECK_PARTICLES).map((p) => p.count));
    this.particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(maxParticles * 3);
    for (let i = 0; i < maxParticles; i++) this.resetParticle(i);
    this.particlePositionAttr = new THREE.BufferAttribute(this.particlePositions, 3);
    this.particleGeometry.setAttribute('position', this.particlePositionAttr);
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.1,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false,
    });
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.visible = false;

    for (const map of [options.plateAlbedo, options.plateRoughness, options.plateNormal, options.plateMetalness]) {
      if (!map) continue;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(0.15, 0.15);
    }

    // The Metal051A and Onyx013 displacement maps stay out: the plate and the rim are flat slabs whose faces have no
    // vertex inside their outline to move, and the normal map already carries the relief. Onyx013 is stone, with no metalness map.
    const plateMaterial = new THREE.MeshStandardMaterial(
      options.tonal
        ? { ...flatTone(TONAL.plate), roughness: 0.8, metalness: 0 }
        : options.plateAlbedo
        ? {
            map: options.plateAlbedo,
            roughnessMap: options.plateRoughness || null,
            normalMap: options.plateNormal || null,
            ...(options.plateMetalness ? { metalnessMap: options.plateMetalness, metalness: 1 } : {}),
            color: FRAME_LOOK.plateTiles,
            roughness: 0.4,
          }
        : options.deckAlbedo && options.deckRoughness
          ? { map: options.deckAlbedo, roughnessMap: options.deckRoughness, color: FRAME_LOOK.plate }
          : { color: FRAME_LOOK.plate, roughness: 0.8 },
    );
    const rimMaterial = new THREE.MeshStandardMaterial(
      options.tonal
        ? { color: TONAL.cell, roughness: 0.6, metalness: 0, emissiveIntensity: 0.6 } // its emissive is the turn's light (lightRim)
        : options.rimAlbedo
        ? {
            map: options.rimAlbedo,
            roughnessMap: options.rimRoughness || null,
            normalMap: options.rimNormal || null,
            color: FRAME_LOOK.rim,
            roughness: 0.35,
            metalness: 0.65,
            emissiveIntensity: 0.6,
          }
        : options.plateAlbedo
          ? { map: options.plateAlbedo, roughnessMap: options.plateRoughness || null, color: FRAME_LOOK.rim, roughness: 0.35, metalness: 0.65, emissiveIntensity: 0.6 }
          : options.deckAlbedo && options.deckRoughness
            ? { map: options.deckAlbedo, roughnessMap: options.deckRoughness, color: FRAME_LOOK.rim, metalness: 0.3, emissiveIntensity: 0.6 }
            : { color: COLORS.steel, roughness: 0.5, metalness: 0.3, emissiveIntensity: 0.6 },
    );
    this.plate = new THREE.Mesh(new THREE.BufferGeometry(), plateMaterial);
    this.rim = {
      near: new THREE.Mesh(new THREE.BufferGeometry(), rimMaterial),
      far: new THREE.Mesh(new THREE.BufferGeometry(), rimMaterial.clone()),
    };

    const roomMaterial = new THREE.MeshStandardMaterial(
      options.deckAlbedo && options.deckRoughness
        ? { map: options.deckAlbedo, roughnessMap: options.deckRoughness, color: ROOM_SURFACE.color, fog: false }
        : { color: ROOM_SURFACE.color, roughness: ROOM_SURFACE.roughness, fog: false },
    );
    this.roomDeck = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SURFACE.width, 0.4, ROOM_SURFACE.depth), roomMaterial);
    this.roomDeck.position.set(0, ROOM_SURFACE.y - 0.2, 0);
    this.propsGroup = new THREE.Group();
    this.deckProp = new THREE.Mesh(deckPropGeometry('mess'), softLook() ? new THREE.MeshLambertMaterial({ name: 'deck_prop', color: deckPropColour('mess'), fog: false }) : new THREE.MeshStandardMaterial({ name: 'deck_prop', color: deckPropColour('mess'), roughness: 0.8, metalness: 0, fog: false }));
    this.deckProp.name = 'deck-prop';
    this.deckProp.visible = false;
    this.terrace = new THREE.Group();
    this.terrace.name = 'terrace';
    this.terrace.visible = false;
    [this.hemisphere, this.sun] = addSun(this.terrace);

    this.notches = new THREE.Group();
    this.tallies = [new THREE.Group(), new THREE.Group()] as const;
    this.marbles = new THREE.Group();
    this.ghosts = new THREE.Group();
    this.arenaMarbles = new THREE.Group();

    this.grooveGeometry = new THREE.BoxGeometry(0.14, 0.02, 0.21);
    this.scratchGeometry = new THREE.BoxGeometry(0.08, 0.03, 0.15);
    this.thresholdGeometry = new THREE.CircleGeometry(0.13, 3).rotateZ(Math.PI).rotateX(-Math.PI / 2);
    this.thresholdMarkGeometry = new THREE.CircleGeometry(0.08, 3).rotateZ(Math.PI).rotateX(-Math.PI / 2);
    this.grooveMaterial = new THREE.MeshBasicMaterial({ color: COLORS.base, fog: false });
    this.scratchMaterial = new THREE.MeshBasicMaterial({ color: BONE, fog: false });

    this.scene.add(
      this.particles,
      this.roomDeck,
      this.propsGroup,
      this.deckProp,
      this.terrace,
      this.plate,
      this.rim.near,
      this.rim.far,
      this.notches,
      this.tallies[0],
      this.tallies[1],
      this.marbles,
      this.ghosts,
    );

    const smooth = smoothEdges(renderPixelRatio(dpr, webdriver), this.renderer.samples > 0) && !softLook(); // no FXAA pass on a software renderer (#1710): a program less to build
    this.pipeline = createBloomPipeline(this.renderer, this.scene, this.camera, smooth, webdriver ? 1 : 2, options.bloom ?? true);
    this.flatPipeline = createBloomPipeline(this.renderer, this.scene, this.camera, smooth, options.neon && !webdriver ? 2 : 1, !!options.neon && (options.bloom ?? true), options.neon ? 1 : TERRACE_SATURATION, options.neon ? 1 : TERRACE_CONTRAST);
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  resetParticle(i: number): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 5.5 + Math.random() * 11.5;
    this.particlePositions[i * 3] = Math.cos(angle) * radius;
    this.particlePositions[i * 3 + 1] = -0.3 + Math.random() * 7.0;
    this.particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }

  frameCamera(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.fov = framing(width, height);
    this.camera.updateProjectionMatrix();
  }

  applyView(view: View, reading: View | null, context: ViewContext): void {
    const consoleDef = context.consoleDef ?? {
      position: [0, 0, 0] as const,
      size: [1, 1, 1] as const,
    };
    const [x, y, z] = reading ? consoleDef.position : [0, 0, 0];
    const [, height, width] = consoleDef.size;
    const p = reading
      ? screenView({ x, y, z }, { x: 1, y: 0, z: 0 }, width, height, this.camera.fov, this.camera.aspect)
      : viewPosition(view);

    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(x, y, z);
    this.camera.updateMatrixWorld();
    this.updateFog(context.tier, context.clear, view, this.fogRadius, context.deck);
  }

  updateFog(tier: Tier, clear: boolean, view: View, fogRadius: number, deck: Deck): void {
    const fog = fogSettings(tier, clear, view, fogRadius, DECKS[deck].fog);
    if (!fog || this.terraceOn) {
      this.scene.fog = null;
    } else {
      this.fogObj.near = fog.near;
      this.fogObj.far = fog.far;
      this.fogObj.color.setHex(DECK_ATMOSPHERES[deck as DeckId].fogColor);
      if (this.scene.fog !== this.fogObj) this.scene.fog = this.fogObj;
    }
  }

  updateParticles(tier: Tier, clear: boolean, reducedMotion: boolean, webdriver: boolean, forceParticles: boolean, deck: Deck): void {
    const conf = this.space?.scatter ?? DECK_PARTICLES[deck];
    const enabled = hasParticles(tier, clear, reducedMotion, webdriver, forceParticles) && conf.count > 0;
    this.particles.visible = enabled;
    if (!enabled) return;
    this.particleMaterial.color.setHex(conf.color);
    this.particleMaterial.size = conf.size;
    this.particleMaterial.opacity = conf.opacity;
    this.particleGeometry.setDrawRange(0, conf.count);
  }

  animateParticles(now: number, deck: Deck): void {
    if (!this.particles.visible) {
      this.lastParticleNow = now;
      return;
    }
    const dt = this.lastParticleNow ? Math.min(0.08, (now - this.lastParticleNow) / 1000) : 0.016;
    this.lastParticleNow = now;
    const conf = this.space?.scatter ?? DECK_PARTICLES[deck];
    for (let i = 0; i < conf.count; i++) {
      const o = i * 3;
      this.particlePositions[o]! += conf.drift[0] * dt * 10;
      this.particlePositions[o + 1]! += conf.drift[1] * dt * 10;
      this.particlePositions[o + 2]! += conf.drift[2] * dt * 10;
      const x = this.particlePositions[o]!;
      const y = this.particlePositions[o + 1]!;
      const z = this.particlePositions[o + 2]!;
      if (y > 7.5 || y < -0.4 || Math.hypot(x, z) > 17.5 || Math.hypot(x, z) < 5.2) {
        this.resetParticle(i);
      }
    }
    this.particlePositionAttr.needsUpdate = true;
  }

  /** The deck last applied: the neon sky set later (`setNeon`) takes its key. */
  private deck: Deck | null = null;

  /** The cue of the run on (#1554), its act and whether an elite is fought: the rim is violet until `setRunFight(null)`. */
  private runFight: RunCue | null = null;

  /** A run's violet rim and posts (#1554), set at once: on its map too, a later act or an elite changes them, and leaving the run gives
   * the deck's own key back. */
  setRunFight(cue: RunCue | null): void {
    this.runFight = cue;
    if (this.neon && this.deck) neonDeckLook(this.deck, cue, this.space, this.hubFloor);
  }

  /** Whether the Hub is on (#1639): its ground stays the dark neon ground, a fight's leans to its deck. */
  private hubFloor = false;

  /** The Hub's dark floor, set at once and kept through its lift rides; leaving the Hub gives the deck's surround back. */
  setHubFloor(on: boolean): void {
    this.hubFloor = on;
    if (this.neon && this.deck) neonDeckLook(this.deck, this.runFight, this.space, on);
  }

  /** The deck's albedo and roughness, once their file loads (#1603): the plate and the rim were built flat, as the look without them,
   * and take the maps as the look with them is built (the same colours and roughness). A null map leaves the flat look. */
  setDeckMaps(albedo: THREE.Texture | null, roughness: THREE.Texture | null): void {
    if (!albedo || !roughness) return;
    const plate = this.plate.material as THREE.MeshStandardMaterial;
    plate.map = albedo;
    plate.roughnessMap = roughness;
    plate.color.set(FRAME_LOOK.plate);
    plate.roughness = 1;
    plate.needsUpdate = true;
    for (const rim of [this.rim.near, this.rim.far]) {
      const material = rim.material as THREE.MeshStandardMaterial;
      material.map = albedo;
      material.roughnessMap = roughness;
      material.color.set(FRAME_LOOK.rim);
      material.roughness = 1;
      material.needsUpdate = true;
    }
  }

  /** The sun and the hemisphere of the fight while its entrance beat dims them (#1551), else null. */
  private lit: { sun: number; hemisphere: number } | null = null;

  /** The entrance beat of a boss fight (#1551) draws `share` of the fight's light, from dark up to 1, which gives the fight its own light back. */
  setEntranceLight(share: number): void {
    if (share >= 1) return this.restoreLight();
    this.lit ??= { sun: this.sun.intensity, hemisphere: this.hemisphere.intensity };
    this.sun.intensity = this.lit.sun * share;
    this.hemisphere.intensity = this.lit.hemisphere * share;
  }

  private restoreLight(): void {
    if (!this.lit) return;
    this.sun.intensity = this.lit.sun;
    this.hemisphere.intensity = this.lit.hemisphere;
    this.lit = null;
  }

  /** A boss fight passes its space (#1551): its sun, sky, rim and scatter in place of the deck's; null for every other game. */
  applyDeck(next: Deck, run: RunCue | null = null, space: Space | null = null): void {
    this.restoreLight(); // a new deck while the beat dims the light: its own light is set below, not a dim one
    this.deck = next;
    this.runFight = run;
    const light = DECKS[next];
    this.renderer.toneMappingExposure = light.exposure;
    if (space !== this.space) this.spaceLook = space && terraceSpaceLook(space);
    const spaced = this.space !== null; // the sun is only touched while a space is on or just left: the Open world sets its own
    this.space = space;
    if (this.neon) {
      neonDeckLook(next, run, space, this.hubFloor); // the slab, the rim and the posts take the deck's key (#1551), violet in a rogue-lite fight (#1554)
      if (space || spaced) lightNeon(this.sun, this.hemisphere, space);
      // the sky takes the deck's key, but a backdrop texture in the room stays (#1551 fix-forward: main.boot)
      if (!(this.scene.background as THREE.Texture | null)?.isTexture) this.scene.background = neonSkyOf(next, space);
    }
    this.dressTerrace();
    if (this.currentBay) applyDeckAtmosphere(this.currentBay, next as DeckId);
    this.deckProp.geometry = deckPropGeometry(next);
    this.deckProp.material.color.copy(deckPropColour(next));
  }

  /** The deck's prop stands beside a board of `radius` cells, on the side a phone or a desktop has room for, or is hidden (the hub's board has none). Drawn only with the terrace. */
  showDeckProp(shown: boolean, radius: number, phone: boolean): void {
    this.propShown = shown;
    const { x, z } = deckPropSpot(radius, phone);
    this.deckProp.position.set(x, 0, z);
    this.deckProp.visible = shown && this.terraceOn;
  }

  drawFrame(board: ArrayLike<number>): FrameShape | null {
    const next = frameShape(board);
    if (this.frame && JSON.stringify(next) === JSON.stringify(this.frame)) return null;
    this.frame = next;
    this.fogRadius = next.radius;

    const flat = (points: Point[]): THREE.Vector2[] => points.map((p) => new THREE.Vector2(p.x, -p.z));
    // Rounded edges catch the light where square ones cut it: the bevel stays inside the slab's outline (offset) and
    // height (a thinner extrusion), so the cells and the marbles sit where they did.
    const slab = (shape: THREE.Shape, top: number, depth: number): THREE.ExtrudeGeometry =>
      new THREE.ExtrudeGeometry(shape, {
        depth: depth - 2 * FRAME_BEVEL,
        bevelEnabled: true,
        bevelThickness: FRAME_BEVEL,
        bevelSize: FRAME_BEVEL,
        bevelOffset: -FRAME_BEVEL,
        bevelSegments: 2,
      })
        .rotateX(-Math.PI / 2)
        .translate(0, top - depth + FRAME_BEVEL, 0);

    const plateShape = new THREE.Shape(flat(next.inner));
    for (const h of next.holes) plateShape.holes.push(new THREE.Path().absarc(h.x, -h.z, FRAME.hole, 0, 2 * Math.PI, true));
    this.plate.geometry.dispose();
    this.plate.geometry = slab(plateShape, -0.1, 0.2);

    const halves = rimHalves(next);
    for (const end of ['near', 'far'] as const) {
      this.rim[end].geometry.dispose();
      this.rim[end].geometry = slab(new THREE.Shape(flat(halves[end])), 0, 0.3);
    }
    return next;
  }

  lightRim(light: { end: 'near' | 'far'; color: number } | null): void {
    for (const end of ['near', 'far'] as const) {
      this.rim[end].material.emissive.set(light?.end === end ? light.color : 0);
      // The terrace's turn bar (#1314): the bar at the side to move, lit in the arena's own colour; black is the near end.
      const bar = this.terrace.getObjectByName(end === 'near' ? 'scene_turnbar_black' : 'scene_turnbar_white');
      if (bar) bar.visible = light?.end === end;
    }
  }

  drawNotches(row: NotchRow | null): void {
    clearDrawn(this.notches);
    if (!row) return;

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, p: Point, y: number): void => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(p.x, y, p.z);
      this.notches.add(mesh);
    };

    for (const n of row.notches) {
      add(this.grooveGeometry, this.grooveMaterial, n, 0);
      if (n.lit) add(this.scratchGeometry, this.scratchMaterial, n, 0);
    }
    add(this.thresholdGeometry, this.grooveMaterial, row.glyph, 0.005);
    add(this.thresholdMarkGeometry, this.scratchMaterial, row.glyph, 0.01);
  }

  drawTally(frame: FrameShape | null, rows: readonly (readonly { marked: boolean }[])[]): void {
    if (!frame) return;
    this.tallies.forEach((group, s) => {
      group.clear();
      const list = rows[s] ?? [];
      for (let i = 0; i < list.length; i++) {
        const item = list[i]!;
        const groove = new THREE.Mesh(this.grooveGeometry, this.grooveMaterial);
        groove.position.set((i - 2.5) * 0.25, 0, s === 0 ? 3.2 : -3.2);
        group.add(groove);
        if (item.marked) {
          const scratch = new THREE.Mesh(this.scratchGeometry, this.scratchMaterial);
          scratch.position.copy(groove.position);
          group.add(scratch);
        }
      }
    });
  }

  mountBay(bay: SpaceshipBayAssets | null, deck: Deck): void {
    this.currentBay = bay;
    if (this.currentBay) {
      this.roomDeck.visible = false;
      applyDeckAtmosphere(this.currentBay, deck as DeckId);
      this.propsGroup.add(this.currentBay.scene);
    } else {
      this.roomDeck.visible = true;
    }
  }

  /** The terrace in place of the room, or the room back (#1314). The room and its lamps are hidden, not freed; so are the plate and the rim, the glTF carries the slab. */
  setTerrace(on: boolean, shadows = false, background = 0x2c3438): void {
    if (on === this.terraceOn) return;
    this.terraceOn = on;
    this.terrace.visible = on;
    this.deckProp.visible = on && this.propShown;
    this.propsGroup.visible = !on;
    this.roomDeck.visible = !on && !this.currentBay;
    this.plate.visible = this.rim.near.visible = this.rim.far.visible = !on;
    if (on) this.roomBackground = this.scene.background as THREE.Color | THREE.Texture | null;
    this.scene.background = on ? new THREE.Color(background) : this.roomBackground;
    // The Blender render keeps the palette's colours; ACES washes them toward grey, AgX is the Blender view transform (#1314).
    this.renderer.toneMapping = on ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = on ? TERRACE_EXPOSURE : 1;
    // The sky dome of the arena file is 95 away from the board and the camera 6 to 18 from it: the room's far plane at 100 cut its far wall.
    this.camera.far = on ? 300 : 100;
    this.camera.updateProjectionMatrix();
    this.setShadows(on && shadows);
    // a lair fight asked for its look before the terrace was in (#1496), or a boss fight for its space (#1551); the arena's own back after one
    if (on && !this.neon && (this.lookWanted() !== TERRACE_LOOK || this.worn)) this.wear(this.lookWanted());
  }

  /** The tone mapping and the exposure the Open world is drawn with: the terrace's (none in the neon look), which the world took from the renderer when the terrace was in
   * first. A page that opens in the world has no terrace yet (#1520). */
  setWorldTone(neon: boolean): void {
    this.renderer.toneMapping = neon ? THREE.NoToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = neon ? NEON_LIGHT.exposure : TERRACE_EXPOSURE;
  }

  /** The neon look (#1424, `?look=neon`): black sky with fine stars, a cold sun, ACES, in place of the terrace's own light. Asked once, after `setTerrace`. */
  setNeon(): void {
    lightNeon(this.sun, this.hemisphere, this.space);
    // the sky of the deck already on (applyDeck can run before the terrace, at the boot): its key, not the plain sky (#1551)
    this.scene.background = this.deck ? neonSkyOf(this.deck, this.space) : new THREE.Color(NEON.sky);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = NEON_LIGHT.exposure;
    if (!this.terrace.getObjectByName('starfield')) this.terrace.add(neonStars());
  }

  /**
   * Dresses the terrace for a lair fight of the Open world (#1496): the light, the sky, the exposure, the tint of the lit board and of
   * the sky dome, and the glow of the cell edges follow `look`; null gives the terrace back. Nothing happens off the terrace and in the neon
   * look. Asked before the terrace is on, it is applied when it comes on (`setTerrace`).
   */
  setBoardLook(look: BoardLook | null): void {
    if (look === this.boardLook) return; // every mode start asks for the ordinary board
    this.boardLook = look;
    this.dressTerrace();
  }

  /** The look the terrace should wear: a lair's (the Open world's), else the space's of a boss or an act, else the deck's own surround (Mess, Cargo), else the arena's. */
  private lookWanted(): BoardLook {
    return this.boardLook ?? this.spaceLook ?? (this.deck && terraceDeckLook(this.deck)) ?? TERRACE_LOOK;
  }

  private wear(look: BoardLook): void {
    this.worn = look;
    this.applyBoardLook(look);
  }

  /** Puts the wanted look on the terrace when it is on, off the neon look, and not yet worn. */
  private dressTerrace(): void {
    const look = this.lookWanted();
    if (this.terraceOn && !this.neon && look !== (this.worn ?? TERRACE_LOOK)) this.wear(look);
  }

  private applyBoardLook(look: BoardLook): void {
    this.sun.color.setHex(look.sun);
    this.sun.intensity = look.sunIntensity;
    this.sun.position.set(...sunPosition(30, look.elevation, look.azimuth));
    this.hemisphere.color.setHex(look.sky);
    this.hemisphere.groundColor.setHex(look.ground);
    this.hemisphere.intensity = look.hemisphere;
    (this.scene.background as THREE.Color).setHex(look.background);
    this.renderer.toneMappingExposure = look.exposure;
    // The materials are the file's, shared with the next fight: each is multiplied from the colour it had when first dressed.
    const tint = new THREE.Color(look.tint);
    const cell = new THREE.Color(look.cell);
    const dome = new THREE.Color(look.dome).multiplyScalar(TERRACE_EXPOSURE / look.exposure);
    this.terrace.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      if (mesh.name === 'terrace_edges') {
        mesh.visible = look.edge !== null;
        if (look.edge !== null) material.color.setHex(look.edge);
      } else if (material.isMeshStandardMaterial) {
        this.paint(material, tint); // the dishes' material is the board's: its tint is theirs too
        if (mesh.name === 'terrace_dishes') this.paintCells(mesh as THREE.InstancedMesh, cell);
      } else if (material.name === 'terrace_solid') this.paint(material, dome);
    });
  }

  /** Multiplies every cell top by `by`, on top of the board's tint: the colour of each instance (white until a look asks). */
  private paintCells(dishes: THREE.InstancedMesh, by: THREE.Color): void {
    for (let i = 0; i < dishes.instanceMatrix.count; i++) dishes.setColorAt(i, by);
    dishes.instanceColor!.needsUpdate = true;
  }

  /** Sets a material's colour to the one it had at first, multiplied by `by`. */
  private paint(material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, by: THREE.Color): void {
    if (!this.paints.has(material)) this.paints.set(material, material.color.clone());
    material.color.copy(this.paints.get(material)!).multiply(by);
  }

  /** The sun's soft shadow, on the high tier only: the low tier draws none (#1364). */
  setShadows(on: boolean): void {
    if (this.renderer.shadowMap.enabled === on && this.sun.castShadow === on) return; // already so: the Open world asks on every draw
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    aimSunShadow(this.sun, on);
  }

  /** Where the point `lift` above the cell is drawn: a mark on top of a marble is not under the cell's centre (#1259). */
  cellToScreen(q: number, r: number, width: number, height: number, scale = 1, lift = 0): { x: number; y: number } {
    const p = axialTo3D(q, r, scale);
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(p.x, lift, p.z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * width,
      y: ((1 - v.y) / 2) * height,
    };
  }

  /** Draws the scene. `kick` (kick.ts, #1560) zooms and shifts this one picture: the camera is the resting one again once drawn. */
  render(kick: Kick = REST, width = 1, height = 1): void {
    const camera = this.camera;
    if (kick !== REST) {
      camera.zoom = kick.zoom;
      camera.setViewOffset(width, height, -kick.x, -kick.y, width, height);
    }
    try {
      // The terrace lights nothing from within: no bloom, only the graded and smoothed picture (#1314).
      const pipeline = this.terraceOn ? this.flatPipeline : this.pipeline;
      if (pipeline) {
        try {
          pipeline.render();
          return;
        } catch {
          // Fall back to renderer if pipeline fails in mock or test environment
        }
      }
      this.renderer.render(this.scene, camera);
    } finally {
      if (kick !== REST) {
        camera.zoom = 1;
        camera.clearViewOffset();
      }
    }
  }
}
