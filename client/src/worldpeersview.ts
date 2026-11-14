// The other heroes of the public Open world on screen (#1305): a marker marble on the cell of each one in view, and at the screen
// edge an arrow with the distance in tiles for each one out of view. The marker is one instanced mesh in the world's scene, the
// indicators are plain elements over the canvas.
import * as THREE from 'three/webgpu';
import { axialTo3D, type Axial } from './board';
import type { World } from './openworld';
import { bob, boatGeometry, boatMaterial, DRAFT, steer, type Wake } from './openworldboat';
import { GROUND, MARBLE, topOf } from './openworldview';
import { EMOTES, hexDistance, MAX_PEERS, TROOP_MAX } from './worldpeers';
import { neonMarbleRim, neonWorldOn } from './neonlook';

/** The marbles of every hero drawn: its own and a full troop each, one instanced mesh. */
const CAPACITY = MAX_PEERS * (1 + TROOP_MAX);

/** The colour of another hero and its troop, from its peer id: a hue of its own at a fixed lightness, set apart from the pale blue hero,
 * the black enemies and the green ground. The same id gives the same colour on every screen. */
export function peerColour(peer: string): THREE.Color {
  let hash = 0;
  for (const ch of peer) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const hue = [300, 330, 20, 50, 190, 260, 0, 160][hash % 8]! / 360; // magenta, pink, orange, yellow, cyan, violet, red, mint: none a green ground or a black foe
  return new THREE.Color().setHSL(hue, 0.85, 0.65);
}
/** How far in from the screen's edge the indicator sits, as a share of the half screen. */
const MARGIN = 0.88;
/** How far a marker standing on the hero's own cell is lifted above it, so both show. */
const LIFT = 0.75;

export interface Spot {
  inside: boolean;
  /** The place of the indicator, in percent of the screen from its left and its top edge. */
  left: number;
  top: number;
  /** The way the arrow points, in radians clockwise from the right (CSS rotate). */
  angle: number;
}

/**
 * Where the indicator of a point goes: `x`, `y`, `z` are its normalised device coordinates (z above 1 is behind the camera),
 * `aspect` the screen's width over its height. A point behind the camera is mirrored through the centre, so its arrow points
 * away from the view. A point on screen keeps its own place; any other one goes where the line from the centre to it meets the margin of the screen.
 */
export function edgeSpot(x: number, y: number, z: number, aspect: number): Spot {
  const behind = z > 1;
  const nx = behind ? -x : x;
  const ny = behind ? -y : y;
  const inside = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const far = Math.max(Math.abs(nx), Math.abs(ny));
  const scale = inside ? 1 : far === 0 ? 0 : MARGIN / far;
  const px = nx * scale;
  const py = far === 0 ? -MARGIN : ny * scale; // dead behind the centre: the bottom edge
  return { inside, left: ((px + 1) / 2) * 100, top: ((1 - py) / 2) * 100, angle: Math.atan2(-py, px * aspect) };
}

export class PeersLayer {
  private readonly mesh: THREE.InstancedMesh;
  /** The boats of the marbles on water (#1447), as the hero's own (openworldboat.ts), and where each marble's boat last turned. */
  private readonly boats: THREE.InstancedMesh;
  private wakes = new Map<string, Wake>();
  private readonly edges: HTMLElement[] = [];
  private readonly tags: HTMLElement[] = [];
  private readonly bubbles: HTMLElement[] = [];
  private shown = '';
  private readonly boatPose = new THREE.Object3D();
  private heroes = 0;
  private armies = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: Pick<World, 'tile'>,
    private readonly root: HTMLElement,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(MARBLE, 16, 12), neonMarbleRim('white', new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x2a2a2a, roughness: 0.2 }), neonWorldOn()), CAPACITY); // #1553: the white's finish under the neon look, the peers' as the hero's
    this.mesh.setColorAt(0, new THREE.Color(0xffffff)); // the colour buffer exists before the first draw: a shader built without it never reads one
    this.mesh.name = 'peers';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.boats = new THREE.InstancedMesh(boatGeometry(MARBLE), boatMaterial(), CAPACITY);
    this.boats.name = 'peer-boats';
    this.boats.count = 0;
    this.boats.frustumCulled = false;
    this.scene.add(this.boats);
  }

  /**
   * Draws `peers` for a hero standing on `hero` with its troop on `own` (the hero's cell and its troop's: a marble of another hero on
   * one of them is lifted above it): a marble for each hero and each troop marble in view on loaded ground, in the colour of its hero,
   * and an edge indicator for each hero out of view. A marble on water rides a boat that bobs at `bobNow` (ms, `null`: held still).
   * Returns whether anything drawn changed, so the page draws the scene again.
   */
  update(peers: readonly { peer: string; cell: Axial; name: string; troop: readonly Axial[]; say?: number }[], hero: Axial, own: readonly Axial[] = [hero], bobNow: number | null = null): boolean {
    this.camera.updateMatrixWorld();
    const point = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const out: { peer: string; cell: Axial; spot: Spot; name: string }[] = [];
    const named: { peer: string; spot: Spot; name: string }[] = [];
    const said: { peer: string; spot: Spot; text: string }[] = [];
    let marbles = 0;
    let afloat = 0;
    const wakes = new Map<string, Wake>();
    let heroes = 0;
    for (const { peer, cell, name, troop, say } of peers) {
      const colour = peerColour(peer);
      for (const [i, at] of [cell, ...troop].entries()) {
        const p = axialTo3D(at[0], at[1]);
        const tile = this.world.tile(at[0], at[1]);
        const lift = own.some((o) => o[0] === at[0] && o[1] === at[1]) ? LIFT : 0;
        const wet = tile?.terrain === 'water';
        point.set(p.x, (tile ? topOf(GROUND[tile.terrain], tile.height, at[0], at[1]) + MARBLE : MARBLE) + lift + (wet ? bob(bobNow, marbles) : 0), p.z);
        this.mesh.setMatrixAt(marbles, matrix.setPosition(point));
        this.mesh.setColorAt(marbles, colour);
        const ndc = point.clone().project(this.camera);
        const spot = edgeSpot(ndc.x, ndc.y, ndc.z, this.camera.aspect);
        const drawn = spot.inside && tile;
        if (drawn && wet) {
          const wake = this.wakes.get(`${peer}:${i}`) ?? { x: p.x, z: p.z, yaw: 0 };
          steer(wake, p.x, p.z);
          wakes.set(`${peer}:${i}`, wake);
          this.boatPose.position.set(p.x, topOf('water', 0, 0, 0) - DRAFT + bob(bobNow, marbles), p.z);
          this.boatPose.rotation.set(0, wake.yaw, 0);
          this.boatPose.updateMatrix();
          this.boats.setMatrixAt(afloat++, this.boatPose.matrix);
        }
        if (drawn) marbles++; // a marble not drawn is overwritten by the next one
        if (i > 0) continue; // the rest is for the hero: its tag and its indicator
        if (drawn) {
          heroes++;
          if (name) named.push({ peer, spot, name });
          if (say !== undefined && EMOTES[say]) said.push({ peer, spot, text: EMOTES[say] }); // the text is ours, picked by the index
        } else out.push({ peer, cell, spot, name });
      }
    }
    this.wakes = wakes;
    this.boats.count = afloat;
    this.boats.instanceMatrix.needsUpdate = true;
    this.mesh.count = marbles;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.heroes = heroes;
    this.armies = peers.map((p) => `${p.name || p.peer}:${1 + p.troop.length}`).join(','); // the marbles each hero holds, as received
    this.indicate(out, named, said, hero);
    const key = peers.map((p) => `${p.peer}:${p.cell}:${p.troop.join(';')}:${p.say ?? ''}`).join(' ');
    const changed = key !== this.shown;
    this.shown = key;
    return changed;
  }

  private indicate(out: { peer: string; cell: Axial; spot: Spot; name: string }[], named: { peer: string; spot: Spot; name: string }[], said: { peer: string; spot: Spot; text: string }[], hero: Axial): void {
    this.pool(this.tags, named.length, () => {
      const tag = document.createElement('div');
      tag.className = 'peer-tag';
      tag.setAttribute('aria-hidden', 'true');
      return tag;
    });
    named.forEach(({ peer, spot, name }, i) => {
      const tag = this.tags[i]!;
      tag.style.color = `#${peerColour(peer).getHexString()}`;
      tag.style.left = `${spot.left.toFixed(1)}%`;
      tag.style.top = `${spot.top.toFixed(1)}%`;
      tag.textContent = name; // text, never markup: a name comes from another player
    });
    this.pool(this.bubbles, said.length, () => {
      const bubble = document.createElement('div');
      bubble.className = 'peer-say';
      bubble.setAttribute('aria-hidden', 'true');
      return bubble;
    });
    said.forEach(({ peer, spot, text }, i) => {
      const bubble = this.bubbles[i]!;
      bubble.style.borderColor = `#${peerColour(peer).getHexString()}`;
      bubble.style.left = `clamp(5.5rem, ${spot.left.toFixed(1)}%, calc(100% - 5.5rem))`; // kept inside the screen, 360 px included
      bubble.style.top = `max(4rem, ${spot.top.toFixed(1)}%)`;
      bubble.textContent = text;
    });
    this.pool(this.edges, out.length, () => {
      const edge = document.createElement('div');
      edge.className = 'peer-edge';
      edge.setAttribute('role', 'img');
      edge.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false"><path d="M4 4l16 8-16 8 3-8z" fill="currentColor" stroke="#0b0d0f" stroke-width="1.5" stroke-linejoin="round"/></svg><span></span>';
      return edge;
    });
    out.forEach(({ peer, cell, spot, name }, i) => {
      const edge = this.edges[i]!;
      edge.style.color = `#${peerColour(peer).getHexString()}`;
      const tiles = hexDistance(hero, cell);
      edge.style.left = `${spot.left.toFixed(1)}%`;
      edge.style.top = `${spot.top.toFixed(1)}%`;
      edge.style.setProperty('--angle', `${spot.angle.toFixed(3)}rad`);
      edge.setAttribute('aria-label', `${name || 'Another hero'}, ${tiles} ${tiles === 1 ? 'tile' : 'tiles'} away`);
      edge.lastElementChild!.textContent = name ? `${name} ${tiles}` : String(tiles);
    });
    this.root.hidden = out.length === 0 && named.length === 0 && said.length === 0;
    this.root.dataset.say = said.map(({ text }) => text).join(','); // for the browser checks
    this.root.dataset.peers = String(this.heroes + out.length); // for the browser checks
    this.root.dataset.marbles = String(this.mesh.count); // for the browser checks
    this.root.dataset.boats = String(this.boats.count); // for the browser checks
    this.root.dataset.armies = this.armies;
    this.root.dataset.edges = out.map(({ cell }) => hexDistance(hero, cell)).join(',');
  }

  /** Grows or shrinks `pool` to `size` elements, each made by `make` and added to the root. */
  private pool(pool: HTMLElement[], size: number, make: () => HTMLElement): void {
    while (pool.length < size) {
      const el = make();
      this.root.append(el);
      pool.push(el);
    }
    while (pool.length > size) pool.pop()!.remove();
  }

  /** Takes the marker out of the scene and frees it, and clears the indicators. */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.scene.remove(this.boats);
    this.boats.geometry.dispose();
    (this.boats.material as THREE.Material).dispose();
    this.boats.dispose();
    this.edges.length = 0;
    this.tags.length = 0;
    this.bubbles.length = 0;
    this.root.replaceChildren();
    this.root.hidden = true;
    delete this.root.dataset.peers;
    delete this.root.dataset.edges;
    delete this.root.dataset.marbles;
    delete this.root.dataset.boats;
    delete this.root.dataset.armies;
    delete this.root.dataset.say;
  }
}
