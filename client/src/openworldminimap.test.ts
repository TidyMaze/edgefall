import { describe, expect, it } from 'vitest';
import type { Axial } from './board';
import type { Terrain, Tile } from './openworld';
import { BIOME_LOOK, LOOK, PROPS, WATER } from './openworldview';
import { setNeonWorldOn } from './neonlook';
import { mapColour, WORLD } from './neonworld';
import { WALKABLE } from './openworld';
import { BOSS_COLOURS, ICON } from './openworldlairicon';
import { COLOURS, compassPoints, drawMap, drawMinimap, groundOffset, northDirection, RADIUS, screenOffset, terrainColour, windowCells, type MinimapData } from './openworldminimap';

// The Open world's minimap (#1410, docs/specs/openworld.md section 8): a 2D canvas drawn from plain data.

/** A canvas context that records what is drawn: each fill with the colour it had, and the paths. */
function fakeContext() {
  const log: string[] = [];
  const fills: { colour: string; at: number[] }[] = [];
  let path: number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    clearRect: () => log.push('clear'),
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    beginPath: () => (path = []),
    arc: (x: number, y: number, r: number) => path.push(x, y, r),
    moveTo: (x: number, y: number) => path.push(x, y),
    lineTo: (x: number, y: number) => path.push(x, y),
    closePath: () => {},
    clip: () => log.push('clip'),
    fillText: () => {},
    stroke() {
      log.push(this.strokeStyle === COLOURS.chosen ? 'stroke chosen' : 'stroke');
    },
    fill() {
      fills.push({ colour: this.fillStyle, at: path });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ colour: this.fillStyle, at: [x + w / 2, y + h / 2, w, h] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log, fills };
}

const SIZE = 144;
const MIDDLE = SIZE / 2;
const data = (over: Partial<MinimapData> = {}): MinimapData => ({
  cells: [],
  hero: [0, 0],
  troop: [],
  enemies: [],
  lairs: [],
  teleporters: [],
  logs: [],
  places: [],
  yaw: 0,
  ...over,
});
const at = (fills: { colour: string; at: number[] }[], colour: string) => fills.filter((f) => f.colour === colour);

describe('terrainColour', () => {
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  it('is the colour of the 3D view: the ground of LOOK, the lake shore, the props', () => {
    expect(terrainColour('grass')).toBe(hex(LOOK.grass.color));
    expect(terrainColour('sand')).toBe(hex(LOOK.sand.color));
    expect(terrainColour('rock')).toBe(hex(LOOK.rock.color));
    expect(terrainColour('water')).toBe(hex(WATER.shore));
    expect(terrainColour('tree')).toBe(hex(PROPS.tree.color));
    expect(terrainColour('boulder')).toBe(hex(PROPS.boulder.color));
  });

  it('paints the low grass of a biome in its ground, as the 3D view does (#1442)', () => {
    expect(terrainColour('grass', 'tundra')).toBe(hex(BIOME_LOOK.tundra.ground));
    expect(terrainColour('grass', 'archipelago')).toBe(hex(BIOME_LOOK.archipelago.ground));
    expect(terrainColour('grass', 'meadow')).toBe(terrainColour('grass'));
  });

  describe('the mountain you cannot cross (#1439)', () => {
    const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

    it('is the peak and the wall, which the core blocks (the walkable terrains of openworld.ts), never the walkable rock', () => {
      expect(WALKABLE.has('rock')).toBe(true);
      for (const terrain of ['peak', 'wall'] as const) {
        expect(WALKABLE.has(terrain)).toBe(false);
        expect(terrainColour(terrain)).toBe(COLOURS.mountain);
      }
      expect(terrainColour('rock')).not.toBe(COLOURS.mountain);
    });

    it('keeps the wall the mountain colour in the neon look too, where the rock is lifted for the map', () => {
      setNeonWorldOn(true);
      expect(terrainColour('wall')).toBe(COLOURS.mountain); // the neon look keeps it
      setNeonWorldOn(false);
    });


    it('outlines the dots of the hero, the troop and the enemies in the dark, so they read on the pale mountain', () => {
      const { ctx, log } = fakeContext();
      drawMap(ctx, { width: 400, height: 200, centre: [0, 0], unit: 10, round: false }, data({ troop: [[1, 0]], enemies: [[2, 0]] }));
      expect(log.filter((l) => l === 'stroke')).toHaveLength(3);
    });
  });
});

describe('screenOffset', () => {
  it('puts a cell where the 3D view puts it, relative to the hero: the board layout at yaw 0, up is -r', () => {
    expect(screenOffset([0, 0], [1, 0], 0)).toEqual({ x: 1, y: expect.closeTo(0) });
    const down = screenOffset([0, 0], [0, 1], 0);
    expect(down.x).toBeCloseTo(0.5);
    expect(down.y).toBeCloseTo(Math.sqrt(3) / 2);
    expect(screenOffset([2, 3], [2, 2], 0).y).toBeLessThan(0);
  });

  it('turns with the camera: screen up is the far side of the yaw, so a quarter turn puts -x up', () => {
    const up = screenOffset([0, 0], [-1, 0], Math.PI / 2);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
  });
});

describe('groundOffset (#1411)', () => {
  it('undoes screenOffset: the cell offset, in q and r, of a point of the map, at any yaw', () => {
    for (const yaw of [0, 0.7, -2.1]) {
      const { x, y } = screenOffset([0, 0], [3, -5], yaw);
      const [dq, dr] = groundOffset(x, y, yaw);
      expect(dq).toBeCloseTo(3);
      expect(dr).toBeCloseTo(-5);
    }
  });
});

describe('windowCells', () => {
  const tile = (terrain: Terrain, height = 3): Tile => ({ height, terrain, biome: 'forest' });
  it('reads the hex disc of RADIUS cells round the hero, skipping cells off the world', () => {
    const all = windowCells(() => tile('grass', 5), [10, -4]);
    expect(all).toHaveLength(3 * RADIUS * RADIUS + 3 * RADIUS + 1);
    expect(all).toContainEqual([10, -4, 'grass', 'forest']); // every land cell keeps its biome (#1734)
    const cells = windowCells((q): Tile | undefined => (q < 0 ? undefined : tile('sand', 2)), [0, 0]);
    expect(cells.length).toBeLessThan(all.length);
    expect(cells.every(([q]) => q >= 0)).toBe(true);
  });

  it('keeps the cells off the world, as void, apart from the ones not discovered', () => {
    const cells = windowCells((q): Tile | 'void' | undefined => (q < 0 ? undefined : q === 0 ? 'void' : tile('sand')), [0, 0], 1);
    expect(cells).toContainEqual([0, 0, 'void']);
    expect(cells.every(([q]) => q >= 0)).toBe(true);
  });

  it('reads a disc of another radius when asked, for the map (#1411)', () => {
    expect(windowCells(() => tile('grass'), [0, 0], 2)).toHaveLength(19);
  });

  it('keeps the biome of every land cell, the one the 3D view tints at every height (#1442, #1734)', () => {
    expect(windowCells(() => tile('grass', 4), [0, 0], 0)).toEqual([[0, 0, 'grass', 'forest']]);
    expect(windowCells(() => tile('grass', 5), [0, 0], 0)).toEqual([[0, 0, 'grass', 'forest']]);
    expect(terrainColour('rock', 'forest')).not.toBe(terrainColour('rock'));
    expect(windowCells(() => tile('tree', 3), [0, 0], 0)).toEqual([[0, 0, 'tree', undefined]]);
  });
});

describe('the world edge (#1453)', () => {
  it('paints a cell off the world in its own colour, and the edge line beside it', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ cells: [[3, 0, 'void'], [2, 0, 'grass']] }));
    expect(at(fills, COLOURS.void)).toHaveLength(1);
    expect(at(fills, terrainColour('grass'))).toHaveLength(0); // the grass beside the void is the edge line
    expect(at(fills, COLOURS.worldEdge)).toHaveLength(1);
  });

  it('keeps the terrain of a cell that is not next to the void', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ cells: [[3, 0, 'void'], [-3, 0, 'grass']] }));
    expect(at(fills, terrainColour('grass'))).toHaveLength(1);
    expect(at(fills, COLOURS.worldEdge)).toHaveLength(0);
  });
});

describe('drawMinimap', () => {
  it('draws an arrow only for the 3 nearest unbeaten lairs out of the window; the others and the beaten ones have none', () => {
    const { ctx, fills } = fakeContext();
    const far = (q: number, beaten = false) => ({ cell: [q, 0] as Axial, beaten });
    drawMinimap(ctx, SIZE, data({ lairs: [far(500), far(60), far(300), far(100), far(40, true), far(200)] }));
    expect(at(fills, COLOURS.lair)).toHaveLength(3);
    expect(at(fills, COLOURS.lairBeaten)).toHaveLength(0);
  });

  it('draws no arrow for a lair outside the ring to beat, which is not guided (#1532)', () => {
    const { ctx, fills } = fakeContext();
    const far = (q: number, guided: boolean) => ({ cell: [q, 0] as Axial, beaten: false, guided });
    drawMinimap(ctx, SIZE, data({ lairs: [far(60, false), far(100, true), far(300, false)] }));
    expect(at(fills, COLOURS.lair)).toHaveLength(1);
  });

  it('still draws every lair in the window, whatever the arrows', () => {
    const { ctx, fills } = fakeContext();
    const near = [3, 4, 5, 6].map((q) => ({ cell: [q, 0] as Axial, beaten: false }));
    drawMinimap(ctx, SIZE, data({ lairs: [...near, { cell: [100, 0], beaten: false }] }));
    expect(at(fills, COLOURS.lair)).toHaveLength(5);
  });

  it('clears, clips to a circle and paints each cell in the colour of its terrain', () => {
    const { ctx, log, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ cells: [[3, 0, 'water'], [-3, 0, 'peak']] }));
    expect(log.slice(0, 3)).toEqual(['clear', 'save', 'clip']);
    expect(log).toContain('restore');
    const water = at(fills, terrainColour('water'));
    expect(water).toHaveLength(1);
    expect(water[0]!.at[0]).toBeGreaterThan(MIDDLE);
    expect(at(fills, terrainColour('peak'))[0]!.at[0]).toBeLessThan(MIDDLE);
  });

  it('paints a low grass cell in the ground of its biome (#1442)', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ cells: [[3, 0, 'grass', 'badlands']] }));
    expect(at(fills, terrainColour('grass', 'badlands'))).toHaveLength(1);
  });

  it('draws the cells turned with the yaw, so up is up on screen', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ cells: [[-3, 0, 'rock']], yaw: Math.PI / 2 }));
    const [x, y] = at(fills, terrainColour('rock'))[0]!.at;
    expect(x).toBeCloseTo(MIDDLE);
    expect(y).toBeLessThan(MIDDLE);
  });

  it('draws the hero in the middle, the troop and the enemies in their own colours', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ troop: [[1, 0], [0, 1]], enemies: [[0, -4]] }));
    expect(at(fills, COLOURS.hero)[0]!.at.slice(0, 2)).toEqual([MIDDLE, MIDDLE]);
    expect(at(fills, COLOURS.troop)).toHaveLength(2);
    const [, y] = at(fills, COLOURS.enemy)[0]!.at;
    expect(y).toBeLessThan(MIDDLE);
  });

  it('draws a lair in the window as the tower icon of its boss (#1438), a beaten one grey, and the minimap icon is smaller than the map one', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ lairs: [{ cell: [5, 0], beaten: false, boss: 'hull' }, { cell: [-5, 0], beaten: true, boss: 'echo' }] }));
    expect(at(fills, BOSS_COLOURS.hull!)).toHaveLength(1);
    expect(at(fills, ICON.done)).toHaveLength(1);
    expect(at(fills, BOSS_COLOURS.echo!)).toHaveLength(0);
    const span = (points: number[]): number => Math.max(...points.filter((_, i) => i % 2 === 0)) - Math.min(...points.filter((_, i) => i % 2 === 0));
    const small = span(at(fills, BOSS_COLOURS.hull!)[0]!.at);
    const big = fakeContext();
    drawMap(big.ctx, { width: 400, height: 200, centre: [0, 0], unit: 10, round: false }, data({ lairs: [{ cell: [5, 0], beaten: false, boss: 'hull' }] }));
    expect(small).toBeLessThan(span(at(big.fills, BOSS_COLOURS.hull!)[0]!.at));
  });

  it('draws the teleporters given in the window as portal icons (#1412, #1443), none out of it, the hero\'s own lit, and rings the one chosen', () => {
    const { ctx, fills, log } = fakeContext();
    drawMinimap(ctx, SIZE, data({ hero: [3, 0], teleporters: [[3, 0], [-2, 1], [200, 0]] }));
    const drawn = at(fills, ICON.portal);
    expect(drawn).toHaveLength(1); // the core of the one in the window the hero is not on
    expect(drawn[0]!.at).toHaveLength(3); // a disc, not a tower
    expect(drawn[0]!.at[0]).toBeLessThan(MIDDLE); // 5 cells left of the hero, who is in the middle
    expect(at(fills, ICON.here)).toHaveLength(1); // the one the hero stands on
    expect(log).not.toContain('stroke chosen');
    drawMinimap(ctx, SIZE, data({ teleporters: [[3, 0]], chosen: [3, 0] }));
    expect(log).toContain('stroke chosen');
  });

  it('draws the logs in the window as amber slabs, a log found as a grey outline, and none out of the window (#1589)', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ logs: [{ cell: [3, 0], found: false }, { cell: [-3, 1], found: true }, { cell: [200, 0], found: false }] }));
    const open = at(fills, ICON.log);
    expect(open).toHaveLength(1); // the one in the window not found; the outline of the found one is stroked
    expect(open[0]!.at[0]).toBeGreaterThan(MIDDLE); // 3 cells right of the hero
  });

  it('draws the towns and the dungeon gates in the window as their own icons, and none out of the window (#1514)', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ places: [{ cell: [3, 0], kind: 'town' }, { cell: [-3, 1], kind: 'dungeon' }, { cell: [200, 0], kind: 'town' }] }));
    const [town] = at(fills, ICON.town);
    expect(at(fills, ICON.town)).toHaveLength(1);
    expect(town!.at[0]).toBeGreaterThan(MIDDLE); // 3 cells right of the hero
    const [gate] = at(fills, ICON.dungeon);
    expect(at(fills, ICON.dungeon)).toHaveLength(1);
    expect(gate!.at[0]).toBeLessThan(MIDDLE);
  });

  it('lifts a town or a gate one icon up when a teleporter or a tower shares its spot, so no icon covers it (#1518)', () => {
    const ys = (fills: { colour: string; at: number[] }[], colour: string) => at(fills, colour)[0]!.at.filter((_, i) => i % 2 === 1);
    const middleY = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
    const places: MinimapData['places'] = [{ cell: [0, 0], kind: 'town' }, { cell: [-12, 6], kind: 'dungeon' }];
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ teleporters: [[0, 0]], places, lairs: [{ cell: [-12, 6], beaten: false }] }));
    const alone = fakeContext();
    drawMinimap(alone.ctx, SIZE, data({ places })); // the hero on the town does not move it
    expect(middleY(ys(fills, ICON.town))).toBeLessThan(middleY(ys(alone.fills, ICON.town)) - 18); // the minimap's icon is 20 px: lifted clear of the portal
    expect(at(fills, ICON.town)[0]!.at[0]).toBeCloseTo(MIDDLE); // straight up
    expect(middleY(ys(alone.fills, ICON.town))).toBeGreaterThan(MIDDLE - 2);
    expect(middleY(ys(fills, ICON.dungeon))).toBeLessThan(middleY(ys(alone.fills, ICON.dungeon)) - 18); // lifted off its tower
    const beside = fakeContext();
    drawMinimap(beside.ctx, SIZE, data({ teleporters: [[1, 0]], places })); // a portal a cell to the right, under the icon: pushed left, a full icon off it
    const xs = at(beside.fills, ICON.town)[0]!.at.filter((_, i) => i % 2 === 0);
    const portalX = at(beside.fills, ICON.portal)[0]!.at[0]!; // the portal's core
    expect(portalX).toBeGreaterThan(MIDDLE);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeLessThan(portalX - 18);
  });

  it('draws a lair out of the window as an arrow on the edge pointing to it', () => {
    const { ctx, fills } = fakeContext();
    drawMinimap(ctx, SIZE, data({ lairs: [{ cell: [200, 0], beaten: false }, { cell: [100, -200], beaten: false }] }));
    const [right] = at(fills, COLOURS.lair);
    const [x, y] = right!.at;
    expect(x).toBeGreaterThan(MIDDLE + SIZE / 4);
    expect(x).toBeLessThan(SIZE);
    expect(y).toBeCloseTo(MIDDLE);
    expect(right!.at).toHaveLength(6); // a triangle: three points
    const top = at(fills, COLOURS.lair)[1]!;
    expect(top.at[1]).toBeLessThan(MIDDLE - SIZE / 4);
    expect(top.at[0]).toBeCloseTo(MIDDLE);
  });
});

describe('drawMap (#1411): the drawing of the minimap, on a frame of any size, centre and scale', () => {
  const frame = { width: 400, height: 200, centre: [0, 0] as Axial, unit: 10, round: false };

  it('fills the whole rectangle, with no circle, no edge and no arrow: every lair is its tower icon where it is', () => {
    const { ctx, log, fills } = fakeContext();
    drawMap(ctx, frame, data({ lairs: [{ cell: [200, 0], beaten: false, boss: 'hull' }, { cell: [3, 0], beaten: true, boss: 'hull' }] }));
    expect(log).not.toContain('clip');
    expect(at(fills, COLOURS.back)[0]!.at).toEqual([200, 100, 400, 200]);
    const [far] = at(fills, BOSS_COLOURS.hull!);
    expect(far!.at.length).toBeGreaterThan(8); // the crenellated tower, off the canvas
    expect(far!.at[0]).toBeGreaterThan(200 + 200 * 10 - 14);
    expect(far!.at[0]).toBeLessThan(200 + 200 * 10 + 14);
    expect(at(fills, ICON.done)).toHaveLength(1);
  });

  it('draws every log given where it is, however far (#1589)', () => {
    const { ctx, fills } = fakeContext();
    drawMap(ctx, frame, data({ logs: [{ cell: [200, 0], found: false }] }));
    expect(at(fills, ICON.log)).toHaveLength(1);
  });

  it('draws every town and dungeon gate given where it is, however far (#1514)', () => {
    const { ctx, fills } = fakeContext();
    drawMap(ctx, frame, data({ places: [{ cell: [200, 0], kind: 'town' }, { cell: [-200, 0], kind: 'dungeon' }] }));
    expect(at(fills, ICON.town)[0]!.at[0]).toBeCloseTo(200 + 200 * 10, -2);
    expect(at(fills, ICON.dungeon)[0]!.at[0]).toBeCloseTo(200 - 200 * 10, -2);
  });

  it('draws every teleporter given where it is, however far', () => {
    const { ctx, fills } = fakeContext();
    drawMap(ctx, frame, data({ teleporters: [[200, 0]] }));
    expect(at(fills, ICON.portal)[0]!.at[0]).toBeCloseTo(200 + 200 * 10);
  });

  it('puts the centre in the middle, the cells `unit` px apart, and the hero where it stands', () => {
    const { ctx, fills } = fakeContext();
    drawMap(ctx, { ...frame, centre: [2, 0] }, data({ hero: [0, 0], cells: [[3, 0, 'sand']] }));
    expect(at(fills, terrainColour('sand'))[0]!.at.slice(0, 2)).toEqual([210, 100]);
    expect(at(fills, COLOURS.hero)[0]!.at.slice(0, 2)).toEqual([180, 100]);
  });
});

describe('north (#1448, docs/specs/openworld.md section 8)', () => {
  it('is the ground\'s -z at yaw 0, decreasing r: up on the screen, and it turns with the camera', () => {
    expect(northDirection(0).x).toBeCloseTo(0);
    expect(northDirection(0).y).toBeCloseTo(-1);
    const [dq, dr] = groundOffset(northDirection(0).x, northDirection(0).y, 0);
    expect(dr).toBeLessThan(0); // decreasing r, and straight along -z: dx = dq + dr / 2 is nil
    expect(dq + dr / 2).toBeCloseTo(0);
    for (const yaw of [0, 0.7, -2.1, Math.PI / 2]) {
      const n = northDirection(yaw);
      const [nq, nr] = groundOffset(n.x, n.y, yaw);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1);
      expect(nq + nr / 2).toBeCloseTo(0); // the same ground direction at every yaw
      expect(nr).toBeLessThan(0);
    }
  });

  it('puts the N on the rim of the minimap, on the north side, and turns it with the yaw', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      const { ctx, fills } = fakeContext();
      const texts: [string, number, number][] = [];
      (ctx as unknown as { fillText: (t: string, x: number, y: number) => void }).fillText = (t, x, y) => texts.push([t, x, y]);
      drawMinimap(ctx, SIZE, data({ yaw }));
      const n = texts.find(([t]) => t === 'N')!;
      const dir = northDirection(yaw);
      expect(Math.hypot(n[1] - MIDDLE, n[2] - MIDDLE)).toBeGreaterThan(MIDDLE - 14);
      expect(Math.hypot(n[1] - MIDDLE, n[2] - MIDDLE)).toBeLessThan(MIDDLE);
      expect((n[1] - MIDDLE) * dir.x + (n[2] - MIDDLE) * dir.y).toBeGreaterThan(MIDDLE - 14);
      expect(at(fills, COLOURS.northPlate).length).toBeGreaterThan(0);
    }
  });


  it('draws a compass in the top left corner of the map, not of the minimap: an arrow and an N toward the north', () => {
    const { ctx, fills } = fakeContext();
    const texts: [string, number, number][] = [];
    (ctx as unknown as { fillText: (t: string, x: number, y: number) => void }).fillText = (t, x, y) => texts.push([t, x, y]);
    drawMap(ctx, { width: 400, height: 200, centre: [0, 0], unit: 10, round: false }, data({ yaw: Math.PI / 2 }));
    const c = compassPoints(Math.PI / 2);
    expect(c.centre[0]).toBeLessThan(100);
    expect(c.centre[1]).toBeLessThan(100);
    const n = texts.find(([t]) => t === 'N')!;
    expect([n[1], n[2]]).toEqual(c.label);
    expect(c.label[0]).toBeGreaterThan(c.centre[0]); // a quarter turn: north is to the right
    expect(at(fills, COLOURS.north).length).toBeGreaterThan(0);
  });
});
