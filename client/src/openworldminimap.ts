// The Open world's minimap (#1410, docs/specs/openworld.md section 8): the cells round the hero, drawn on a 2D canvas from plain data,
// turned with the camera so up on the map is up on screen. No DOM and no three.js here: the mode hands over the data when a step, a
// push or a camera turn changed it, and the map is redrawn then, never every frame. The full screen map (#1411, openworldmap.ts) is the
// same drawing on another frame (`drawMap`).
import type { Axial } from './board';
import { type Biome, neighbours, same, type Terrain, type Tile } from './openworld';
import { dungeonIcon, iconSize, lairIcon, logIcon, portalIcon, townIcon } from './openworldlairicon';
import { biomeGround, LOOK, PROPS, WATER } from './openworldview';
import { neonWorldOn } from './neonlook';
import { mapColour } from './neonworld';

/** The cells from the hero to the edge of the map: a window of three chunks across. */
export const RADIUS = 24;
/** The radius of the map's compass, in px. */
const COMPASS_RADIUS = 22;
/** The lairs out of the window that get an arrow on the edge: the nearest unbeaten ones. */
const ARROWS = 3;

/** What a cell of the window is: a terrain, or `void` for a cell off the world (#1453). */
export type MapTerrain = Terrain | 'void';

/** A cell of the window: `q, r`, its terrain and, for low grass, its biome (#1442). */
export type MinimapCell = readonly [number, number, MapTerrain, Biome?];

export interface MinimapData {
  cells: readonly MinimapCell[];
  hero: Axial;
  troop: readonly Axial[];
  enemies: readonly Axial[];
  /** The boss lairs, in or out of the window, whether each is beaten and the id of its boss (#1438). Only a guided one (default) gets an arrow
   * (#1532): the towers of a farther ring than the one to beat have none. */
  lairs: readonly { cell: Axial; beaten: boolean; boss?: string; guided?: boolean }[];
  /** The teleporters to draw (#1412): the discovered ones. */
  teleporters: readonly Axial[];
  /** The lore logs to draw (#1589): the discovered ones, and whether each is found. */
  logs: readonly { cell: Axial; found: boolean }[];
  /** The towns and the dungeon gates (#1514), in or out of the window: landmarks seen from afar, as the lairs. */
  places: readonly { cell: Axial; kind: 'town' | 'dungeon' }[];
  /** The teleporter the map's choice would pick (#1412), ringed; none outside the choice. */
  chosen?: Axial | null;
  /** The camera's yaw, in radians (`OpenWorldView.yaw`). */
  yaw: number;
}

/** The colours of the map that are not terrain. */
export const COLOURS = {
  hero: '#ffffff',
  troop: '#f2c14e',
  enemy: '#e0453b',
  lair: '#ffb020',
  lairBeaten: '#6f7a72',
  /** The mountain that cannot be crossed (the peak and the wall, #1439): pale, 3:1 over the walkable rock whatever the look. */
  mountain: '#d5dbe0',
  chosen: '#ffffff',
  back: '#0b0d0f',
  /** A cell off the world (#1453): a deep void blue, 3:1 over the undiscovered `back`. */
  void: '#3a55c8',
  /** The line along the world's edge: pale cyan, 3:1 over the void and over `back`. */
  worldEdge: '#8fe3ff',
  edge: '#0b0d0f',
  /** The N of the north marker and the dark plate under it (#1448): 3:1 or more, whatever the terrain. */
  north: '#ffffff',
  northPlate: '#0b0d0f',
} as const;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The colour of a terrain: the one the 3D view draws it in (`LOOK`, `WATER`, `PROPS`, the ground of `biome` for low grass, #1442), except
 * the mountain that cannot be crossed (#1439). */
export function terrainColour(terrain: Terrain, biome?: Biome): string {
  if (terrain === 'peak' || terrain === 'wall') return COLOURS.mountain;
  const own = terrain === 'water' ? WATER.shore : terrain === 'tree' || terrain === 'boulder' ? PROPS[terrain].color : biome ? biomeGround(terrain, biome) : LOOK[terrain].color;
  return hex(neonWorldOn() ? mapColour(own) : own); // the neon look's dark terrain is lifted for the map (#1424)
}

/** Where `cell` is from the hero on the map, in cells and canvas axes (y down): the ground layout of the 3D view (`axialTo3D`) turned by
 * the camera, whose screen up is `(-sin yaw, -cos yaw)` on the ground (`lookAtHero`). */
export function screenOffset(hero: Axial, cell: Axial, yaw: number): { x: number; y: number } {
  const dq = cell[0] - hero[0];
  const dr = cell[1] - hero[1];
  const dx = dq + dr / 2;
  const dz = (Math.sqrt(3) / 2) * dr;
  return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), y: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
}

/** Where north is on the canvas, a unit vector (y down): north is the ground's -z at yaw 0, decreasing axial `r`, fixed for every
 * world (#1448). It turns with the camera as the cells do (`screenOffset`). */
export function northDirection(yaw: number): { x: number; y: number } {
  return { x: Math.sin(yaw), y: -Math.cos(yaw) };
}

/** The compass of the map (#1448): in the top left corner, a plate of `radius` px round `centre`, a small arrow from its middle toward
 * the north (`tip`, `left`, `right`) and the N (`label`) beyond the arrow. */
export function compassPoints(yaw: number): {
  centre: readonly [number, number];
  radius: number;
  tip: readonly [number, number];
  left: readonly [number, number];
  right: readonly [number, number];
  label: readonly [number, number];
} {
  const radius = COMPASS_RADIUS;
  const centre: readonly [number, number] = [radius + 16, radius + 16];
  const { x, y } = northDirection(yaw);
  const at = (along: number, across: number): readonly [number, number] => [centre[0] + x * along - y * across, centre[1] + y * along + x * across];
  return { centre, radius, tip: at(radius * 0.4, 0), left: at(-radius * 0.15, -radius * 0.2), right: at(-radius * 0.15, radius * 0.2), label: at(radius * 0.68, 0) };
}

/** The offset in cells (`dq, dr`) of the point `x, y` cells from the middle of the map, in canvas axes: `screenOffset` undone. */
export function groundOffset(x: number, y: number, yaw: number): Axial {
  const dx = x * Math.cos(yaw) + y * Math.sin(yaw);
  const dz = -x * Math.sin(yaw) + y * Math.cos(yaw);
  const dr = dz / (Math.sqrt(3) / 2);
  return [dx - dr / 2, dr];
}

/** The grounds a biome colours (#1734). */
const LAND: ReadonlySet<Terrain> = new Set(['sand', 'grass', 'rock', 'peak']);
/** The cells of the hex disc of `radius` (RADIUS: the minimap's window) round `hero`, read with `tile`; the cells hidden (not
 * discovered, #1411) are left out. A cell off the world is kept when `tile` says `void` (#1453). A low grass cell keeps its biome, whose ground it is drawn in. */
export function windowCells(tile: (q: number, r: number) => Tile | 'void' | undefined, hero: Axial, radius = RADIUS): MinimapCell[] {
  const cells: MinimapCell[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      const [q, r] = [hero[0] + dq, hero[1] + dr];
      const found = tile(q, r);
      if (found === 'void') cells.push([q, r, 'void']);
      else if (found) cells.push([q, r, found.terrain, LAND.has(found.terrain) ? found.biome : undefined]); // every land ground by its biome (#1734)
    }
  }
  return cells;
}

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colour: string): void => {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = COLOURS.edge; // a dark outline, so the dot reads on the pale mountain (#1439)
  ctx.lineWidth = 1;
  ctx.stroke();
};

/** A closed shape through `points`, filled. */
const shape = (ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], colour: string): void => {
  ctx.fillStyle = colour;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
};

/** An N centred on `x, y`, on a round dark plate of `radius` px, so it reads over any terrain (#1448). */
const northMark = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void => {
  ctx.fillStyle = COLOURS.northPlate;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = COLOURS.north;
  ctx.font = `bold ${Math.round(radius * 1.2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', x, y);
};

/** Where a map is drawn: a canvas of `width` x `height` px with the cell `centre` (fractions allowed) in the middle, `unit` px a cell.
 * `round` is the minimap: a disc, its edge drawn, and an arrow on the edge for the lairs out of it. */
export interface MapFrame {
  width: number;
  height: number;
  centre: Axial;
  unit: number;
  round: boolean;
}

/** Draws the minimap on a square canvas of `size` px: the hero in the middle, `data.yaw` up. A lair out of the window is an arrow on
 * the edge, pointing to it. */
export function drawMinimap(ctx: CanvasRenderingContext2D, size: number, data: MinimapData): void {
  drawMap(ctx, { width: size, height: size, centre: data.hero, unit: size / 2 / (RADIUS + 1), round: true }, data);
}

/** Draws `data` on `frame`, `data.yaw` up: the cells given, then the towns and the dungeon gates, the lairs (the tower icon of each boss), the teleporters, the lore logs, the enemies, the troop and the hero. */
export function drawMap(ctx: CanvasRenderingContext2D, { width, height, centre, unit, round }: MapFrame, data: MinimapData): void {
  const [midX, midY] = [width / 2, height / 2];
  const put = (cell: Axial): { x: number; y: number } => {
    const { x, y } = screenOffset(centre, cell, data.yaw);
    return { x: midX + x * unit, y: midY + y * unit };
  };
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (round) {
    ctx.beginPath();
    ctx.arc(midX, midY, midX - 1, 0, 2 * Math.PI);
    ctx.clip();
  }
  ctx.fillStyle = COLOURS.back;
  ctx.fillRect(0, 0, width, height);
  const side = unit * 1.3; // a little over a cell, so the turned squares leave no gap
  const voids = new Set(data.cells.filter((cell) => cell[2] === 'void').map(([q, r]) => `${q},${r}`));
  const onEdge = (q: number, r: number): boolean => neighbours([q, r]).some(([nq, nr]) => voids.has(`${nq},${nr}`));
  for (const [q, r, terrain, biome] of data.cells) {
    const { x, y } = put([q, r]);
    ctx.fillStyle = terrain === 'void' ? COLOURS.void : onEdge(q, r) ? COLOURS.worldEdge : terrainColour(terrain, biome); // the land beside the void is the edge line (#1453)
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
  }
  const edge = round ? midX - 8 : Infinity; // the full map has no edge: every lair is drawn where it is
  const away = (cell: Axial): number => Math.hypot(put(cell).x - midX, put(cell).y - midY);
  const size = iconSize(unit, round);
  const covers = [...data.teleporters, ...data.lairs.map((lair) => lair.cell)].map(put); // the icons drawn over the places
  for (const { cell, kind } of data.places) {
    if (away(cell) > edge) continue; // the minimap draws the ones in its window only
    let { x, y } = put(cell);
    const cover = covers.find((c) => Math.hypot(c.x - x, c.y - y) < size);
    if (cover) {
      // A portal or a tower under the icon (#1518): the icon moves a full icon off it, away from it, straight up when on the same spot.
      const d = Math.hypot(x - cover.x, y - cover.y);
      [x, y] = d > 0 ? [cover.x + ((x - cover.x) / d) * size, cover.y + ((y - cover.y) / d) * size] : [x, y - size];
    }
    (kind === 'town' ? townIcon : dungeonIcon)(ctx, x, y, size); // a spire, an arch (#1514, #1518)
  }
  const out = data.lairs.filter(({ cell, beaten, guided }) => !beaten && guided !== false && away(cell) > edge).sort((a, b) => away(a.cell) - away(b.cell));
  const arrows = new Set(out.slice(0, ARROWS).map((lair) => lair.cell));
  for (const { cell, beaten, boss } of data.lairs) {
    const colour = beaten ? COLOURS.lairBeaten : COLOURS.lair;
    const { x, y } = put(cell);
    const [ox, oy] = [x - midX, y - midY];
    const dist = away(cell);
    if (dist <= edge) {
      lairIcon(ctx, x, y, iconSize(unit, round), boss, beaten); // the tower of its boss (#1438)
      continue;
    }
    if (!arrows.has(cell)) continue; // out of the window: an arrow for the nearest few only
    const [ux, uy] = [ox / dist, oy / dist]; // the arrow sits on the edge, its tip toward the lair
    const [px, py] = [midX + ux * edge, midY + uy * edge];
    shape(ctx, [[px + ux * 5, py + uy * 5], [px - ux * 5 - uy * 4, py - uy * 5 + ux * 4], [px - ux * 5 + uy * 4, py - uy * 5 - ux * 4]], colour);
  }
  for (const cell of data.teleporters) {
    if (away(cell) > edge) continue; // the minimap draws the ones in its window only
    const { x, y } = put(cell);
    portalIcon(ctx, x, y, iconSize(unit, round), same(cell, data.hero)); // a portal, the core lit under the hero (#1443)
  }
  for (const { cell, found } of data.logs) {
    if (away(cell) > edge) continue; // the minimap draws the ones in its window only
    const { x, y } = put(cell);
    logIcon(ctx, x, y, iconSize(unit, round), found); // a slab, outlined once found (#1589)
  }
  if (data.chosen) {
    const { x, y } = put(data.chosen);
    ctx.strokeStyle = COLOURS.chosen;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, iconSize(unit, round) / 2 + 4, 0, 2 * Math.PI); // round the portal's icon
    ctx.stroke();
  }
  for (const cell of data.enemies) {
    const { x, y } = put(cell);
    dot(ctx, x, y, 2.5, COLOURS.enemy);
  }
  for (const cell of data.troop) {
    const { x, y } = put(cell);
    dot(ctx, x, y, 2, COLOURS.troop);
  }
  const hero = put(data.hero);
  dot(ctx, hero.x, hero.y, 3, COLOURS.hero);
  ctx.restore();
  if (!round) {
    const c = compassPoints(data.yaw); // the map's compass (#1448)
    ctx.fillStyle = COLOURS.northPlate;
    ctx.beginPath();
    ctx.arc(c.centre[0], c.centre[1], c.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = COLOURS.north; // a light ring, the plate is as dark as the map's background
    ctx.lineWidth = 1.5;
    ctx.stroke();
    shape(ctx, [c.tip, c.left, c.right], COLOURS.north);
    ctx.fillStyle = COLOURS.north;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c.label[0], c.label[1]);
    return;
  }
  ctx.strokeStyle = COLOURS.edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(midX, midY, midX - 1, 0, 2 * Math.PI);
  ctx.stroke();
  const north = northDirection(data.yaw); // the N on the rim, on the north side (#1448)
  const plate = midX * 0.11; // a share of the minimap, so it reads at any size it is shown at
  const rim = midX - 1 - plate;
  northMark(ctx, midX + north.x * rim, midY + north.y * rim, plate);
}
