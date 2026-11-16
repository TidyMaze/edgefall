// What the page holds in place of the Open world (#1578): its code is a chunk of the build that loads at the first entry, so
// until then the mode is off for every question the page asks (each frame, key, pointer and resize), and the first `open` loads
// it. Once loaded the handle forwards to the mode; `loaded` gives the mode and what the page reaches besides it.
import type { Biome } from './openworld';
import type { Phase } from './daynight';
import type { OpenWorldMode } from './openworldmode';
import type { WorldSaves } from './openworldsave';
import type { WorldPeersHost } from './worldnet';

/** What the chunk makes: the mode, the saves of the worlds (a lair or a marble beaten while a fight is on) and the online layer. */
export interface OpenWorldParts {
  mode: OpenWorldMode;
  saves: WorldSaves;
  peers: WorldPeersHost;
}

type Args<K extends keyof OpenWorldMode> = OpenWorldMode[K] extends (...args: infer A) => unknown ? A : never;

export class OpenWorldHandle {
  private parts: OpenWorldParts | null = null;
  private loading: Promise<OpenWorldParts> | null = null;

  /** `load` makes the mode: it runs once, at the first `open`. */
  constructor(private readonly load: () => Promise<OpenWorldParts>) {}

  /** The mode and its companions, once an `open` has loaded them. */
  get loaded(): OpenWorldParts {
    if (!this.parts) throw new Error('The Open world is not loaded');
    return this.parts;
  }

  get active(): boolean {
    return this.parts?.mode.active ?? false;
  }
  get phase(): Phase {
    return this.parts?.mode.phase ?? 'day';
  }
  get biome(): Biome | null {
    return this.parts?.mode.biome ?? null;
  }
  get scene(): OpenWorldMode['scene'] {
    return this.parts?.mode.scene ?? null;
  }
  get eye(): OpenWorldMode['eye'] {
    return this.parts?.mode.eye ?? null;
  }
  /** Settles once the props' models are in the world opened: at once with no world (#1582). */
  get props(): Promise<void> {
    return this.parts?.mode.props ?? Promise.resolve();
  }
  get yaw(): number {
    return this.parts?.mode.yaw ?? 0;
  }
  /** Whether the prompt of a wild marble waits for its answer (#1662). */
  get asking(): boolean {
    return this.parts?.mode.asking ?? false;
  }
  get mapShown(): boolean {
    return this.parts?.mode.mapShown ?? false;
  }

  /** Loads the code when it is not in, then opens the world. */
  async open(...args: Args<'open'>): Promise<void> {
    this.loading ??= this.load().then((parts) => (this.parts = parts));
    return (await this.loading).mode.open(...args);
  }

  key(...args: Args<'key'>): boolean {
    return this.parts?.mode.key(...args) ?? false;
  }
  frame(...args: Args<'frame'>): boolean {
    return this.parts?.mode.frame(...args) ?? false;
  }
  leave(): void {
    this.parts?.mode.leave();
  }
  resize(...args: Args<'resize'>): void {
    this.parts?.mode.resize(...args);
  }
  refreshMode(): void {
    this.parts?.mode.refreshMode();
  }
  reskin(): void {
    void this.parts?.mode.reskin(); // a skin changed in Settings (#1726)
  }
  press(...args: Args<'press'>): void {
    this.parts?.mode.press(...args);
  }
  orbit(...args: Args<'orbit'>): void {
    this.parts?.mode.orbit(...args);
  }
  cancelWalk(): void {
    this.parts?.mode.cancelWalk();
  }
  zoom(...args: Args<'zoom'>): void {
    this.parts?.mode.zoom(...args);
  }
  settle(): void {
    this.parts?.mode.settle();
  }
  panMap(...args: Args<'panMap'>): void {
    this.parts?.mode.panMap(...args);
  }
  hold(...args: Args<'hold'>): void {
    this.parts?.mode.hold(...args);
  }
  release(...args: Args<'release'>): void {
    this.parts?.mode.release(...args);
  }
  turn(...args: Args<'turn'>): void {
    this.parts?.mode.turn(...args);
  }
  toggleMap(): void {
    this.parts?.mode.toggleMap();
  }
  teleport(): void {
    this.parts?.mode.teleport();
  }
}
