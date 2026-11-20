---
id: openworld-terrain
type: feature-design
status: draft
title: "Open world terrain"
parent: openworld
depends-on: [rules]
---

# Open world terrain (#962, tasks #983, #984, #987, #988)

One topic: how the generated map of the Open world gets large landmarks and fine detail, regions with
their own look, a taller relief and an easier walk. It builds on `openworld.md` section 2 (the map) and
changes no rule of Abalone (`rules.md`). Owner requests of 2026-10-30: "ajoute des biomes / variations dans
la map, procedural toujours, plusieurs niveaux de cartes de terrain pour avoir du detail micro et macro",
"diminue le nombre d'obstacles/arbres, le deplacement est souvent difficile", "augmente le relief".

Four tasks change the same lines and every world of every seed, so they go **one after the other**
(section 7). Each pins the world with the digest test of #981 and updates its value on purpose.

## 1. Today

- `cell(seed, q, r)` in `crates/edgefall-core/src/world.rs`: height 0 to 3 from
  `0.65 * noise(.., 12) + 0.35 * noise(.., 5)` (thresholds 0.32, 0.50, 0.64), a `dry` noise (scale 9) picks sand
  or rock over grass, forests are `noise(.., 7) > 0.55` and half their grass is a tree, a boulder stands on
  6 % of the open cells, a wall segment per 24-cell square. `noise` is value noise with a smooth blend
  between the corners of a lattice of `scale` cells.
- The chunk bytes are 2 per cell: height, terrain code. The client column is `topOf = 0.2 + 0.2 * height`.
- Seen from afar the map is fine static: one scale everywhere, no landmark.

## 2. Levels of noise (#983)

A **field** is a weighted sum of value noise at three scales, each from the seed, its own salt and the cell,
so any order of visit gives the same world:

| Level | Scale (cells) | Gives |
|---|---|---|
| macro | 128 | continents and seas, climate regions |
| meso | 40 | ranges, big lakes, plateaus, forest patches |
| micro | 8 | local bumps, ragged borders |

- `field(seed, salt, q, r, weights)` replaces the one-off `noise` calls: `w_macro * noise(.., 128) +
  w_meso * noise(.., 40) + w_micro * noise(.., 8)`, weights summing to 1. First values: height 0.50, 0.35,
  0.15; moisture 0.45, 0.35, 0.20; temperature 0.55, 0.30, 0.15 (section 4). The salts are 30 and up (the
  enemy draws use 12 to 21); the existing ones keep their meaning until their code is replaced.
- **Scale**: the widest zoom sees about 21 chunks (about 340 cells) across, so the macro level must repeat well
  inside that: at 256 cells one feature filled the view and the far view read as a plain (measured in #983).
- **Spawn land**: the macro level of the elevation is offset per seed by one of 16 offsets (up to 4096 cells,
  searched once per seed): the first whose cells (the spawn, the corners of the ring of radius 4, twelve cells on
  radius 8 and twelve on radius 32) are all land, heights 2 to 6, else the one with fewest that are not. No
  fade near the spawn: a fade widens the flat area the far view shows.
- Value noise of several levels bunches around 0.5, so **thresholds are measured, not guessed**: a test
  computes the histogram of a field over a window of chunks and the constants are the quantiles that give the
  target shares below. The constants carry a comment saying so.
- **Eight heights**, 0 to 7 (a `u8` already, `Cell.height`). Target share of the cells per level:
  8, 10, 12, 16, 18, 16, 12, 8 %. Levels 0 and 1 are water (18 %), 2 is a sandy shore, 3 and 4 are the biome's
  low ground, 5 and 6 the uplands (rock), 7 is a peak (8 %, blocked). Peaks and water are the large
  obstacles, so the macro and meso levels must make them come in masses, not in dust.
- **Cost**: each lattice node is hashed once per chunk and each cell interpolates from the chunk's tables, as
  #981 did for the old noise. Budget: one chunk at most 20 us native, the 4096 chunks at most 3 times the
  figure #981 reports (about 27 ms), measured in the PR with the timing example that #981 adds (`crates/edgefall-core/examples/world_timing.rs`).
- **Client**: until #988 the visible column must not change, so `topOf` maps the eight levels onto today's
  scale (`0.2 + 0.2 * level * 3 / 7`) in #983. #988 replaces it.

## 3. Fewer obstacles (#987)

Smallest task, first in the order. Only constants of `cell`:

- A forest cell is a tree one time in four (`unit(.., 6) < 0.25`, was 0.5).
- Boulders: 20 per mille of the open cells (`BOULDER_PER_MILLE = 20`, was 60).
- Water, peaks and walls unchanged.
- **Test**: in the 5 x 5 chunks around the spawn, for 8 seeds, a flood fill over the six neighbours from the
  spawn reaches at least 90 % of the open cells, and the blocked share is under the old bound; the existing
  share test is tightened to the measured figures (blocked 10 to 35 %, boulders at most 2 %).
- `openworld.md` section 2 states "about 6 %" and "about half": updated in the same PR (or in the pending
  spec PR #969 if it is still open).

## 4. Biomes (#984, #1442, a climate map since #1755)

A biome is a region with its own ground, trees and boulders. Since #1755 (owner, 2026-11-17: "no central point on the map, an even,
organic spread over the whole map") the biome of a cell comes from a **climate** read from three fields over the whole map, the same
everywhere: no angle, no distance, no reference to the spawn. (Before, #1442 made it the sextant of the hexagon seen from the spawn;
before that, #984 mixed a temperature and a moisture field.) Each field is value noise at the scales 384, 144 and 48 cells
(`CLIMATE_SCALES`, weights 0.55, 0.30, 0.15, section 2's `Field`): the **temperature** (salts 52 to 54), the **wetness** (55 to 57) and
the **sea** field (62 to 64).

| Climate | Biome | Ground tint | Tree | Boulder (per mille) |
|---|---|---|---|---|
| sea field above `SEA_LEVEL` 0.655 | Archipelago (new) | fresh green `#5c7d58` | 5 % | 10 |
| temperature below `COLD` 0.353 | Tundra | snow white | 4 % | 25 |
| temperature above `HOT` 0.57, wetness below 0.49 | Desert | warm sand | none | 30 |
| temperature above `HOT` 0.57, wetter | Badlands | dark red rock | none | 45 |
| temperate, wetness above 0.53 | Forest | deep green | 25 % | 15 |
| temperate, otherwise | Meadow, the start | green | 2 % | 15 |

The thresholds are quantiles of the fields (shares measured over seeds 0 to 30): meadow 26 %, forest 18 %, archipelago 16 %, badlands 15 %,
desert 13 % and tundra 13 %. The temperature is continuous and `HOT - COLD` is 0.22, so a temperate band (forest or meadow) always lies
between the tundra and the desert, and they never touch (a test walks the map of eight seeds).

- **Organic borders**: the three fields have a meso and a micro level, so a border wanders. A patch holds thousands of cells: on seed 7
  within 150 cells of the spawn, nine patches of 50 cells or more average 7 500 cells (the six wedges of #1442 averaged 9 650 there, all
  meeting at the spawn; a disc of 150 cells holds 68 000).
- **Blend**: each cell's climate is moved by a draw of up to 0.005 (`BLEND`, a few cells where the fields are steep) when its biome is
  picked, so two biomes mix over a few cells along their border.
- **Spawn**: the clearing (radius 3) is Meadow grass at height 3. The map is not drawn round it, and there is no meadow bias: the
  climate is shifted per seed by the first of 4096 offsets (`CLIMATE_CANDIDATES`, `search_climate`) whose spawn and ring of 10 cells are
  meadow of the climate itself and whose rings (`CLIMATE_NEAR`, up to 220 cells; `CLIMATE_FAR`, 170 to 420) hold every biome, the rarest at
  least once near and 12 times of 144 far. So the start is meadow on every seed and every biome lies in the radius the towers are drawn in
  (seeds 0 to 30: the farthest nearest cell of a biome is 220 away, seed 0; before, 14).
- **Archipelago**: mostly water, with islands of sand and low grass, crossed by boat (#1441). Its elevation is that of the meso
  and micro levels only (no continent), lowered by `SEA_DROP` 0.19, and its tops are cut at `ISLAND_TOP` (height 4): no rock, no
  peak. The sea comes in smoothly, by a smoothstep over `SEA_EDGE` (0.012) of the sea field either side of `SEA_LEVEL`.
- **What a biome changes**: the ground of every height in the 3D view and the minimap (#1734): its grass is the biome's ground, its sand,
  rock and peaks the game's colour with the biome mixed in (`BIOME_MIX`: 35, 40 and 30 %), in either look; and the density of the
  obstacles per open cell on the low ground. Water keeps its colour; the archipelago alone also changes the relief, as above.
- **A biome's own props (#1733)**: the meadow's round tree, the forest's giant mushroom, the tundra's ice spire and ice block, the desert's
  sandstone rock, the badlands' rock arch and the archipelago's palm, in `client/models/openworld-biomes.glb` (`ow_tree_<biome>`,
  `ow_boulder_<biome>`, vertex colours, 28 to 38 triangles; source `art/blender/openworld-biomes.blend`). A cell takes its biome's prop once
  the file is in (`BIOME_PROPS`), untinted, and the plain tree or boulder before; the obstacle, its break and its resource are unchanged.
- **No new `Terrain`**: the tint is a colour, not a terrain. The ground and the props are tinted per instance,
  `LOOK[ground] x BIOME_TINT[biome]` (`setColorAt`), so no new mesh. The map paints a low grass cell in the same ground.
- **Chunk bytes**: 3 per cell, `height, terrain, biome` (the biome code is the order of the `Biome` enum: `0` meadow to
  `5` archipelago, `u8`). Enemies stand on the open land of every biome, never on water.
- **Lairs and teleporters** (`openworld.md` sections 7 and 10): lair cell `k` (the draw's number; the boss on it is by tier since #1532, section 15) is drawn in the biome `k % 6` (the order of the codes: meadow, forest, tundra, desert, badlands, archipelago) and kept only on the
  open ground of its biome, so each biome holds two lairs or more (15 bosses: three in the meadow, the forest and the tundra, two
  in the others). The teleporters keep their squares; an archipelago square with no island that fits has none (seed 7 holds 36,
  36 before, and seed 1305 36, 37 before; at least four in every biome).
- **Tests**: the climate maps to the six biomes and a temperate band lies between tundra and desert; the Lattice and the point
  climate agree; every biome lies in reach on seeds 0 to 30; a border is ragged and blends; the archipelago is mostly water with islands of sand and grass, no rock nor peak; the obstacle densities of each biome hold on
  the low ground (trees within a fifth, boulders within a third); enemies, two lairs and a teleporter in every biome; the spawn
  clearing is Meadow and open; the order of visit does not matter. The eight-height shares and the far view's sea and range are
  measured out of the archipelago, whose sea is meant; the blocked share and the 32-seed flood fill of #987 still hold.
  `WORLD_VERSION` is 6 since #1755 (5 for #1752, 4 for #1442, 3 for the hexagon of #1440).

**Measured (#1442)**, the 16 x 16 chunks around the spawn, seeds 1 to 4. Share of the window per biome: meadow 15.3 %, forest
11.8 %, tundra 16.6 %, desert 21.3 %, badlands 12.7 %, archipelago 22.2 %. Low ground obstacles: meadow trees 2.0 % and 16.4
boulders per mille, forest 25.1 % and 10.6, tundra 4.1 % and 26.4, desert 0 % and 28.5, badlands 0 % and 45.0, archipelago
4.8 % and 8.6. Blocked share 36.3 % (bound 26 to 37), water 26.5 %. The middle of the archipelago is 64.9, 76.3, 88.0 and 66.5 %
water on seeds 1 to 4.

**Digest**: the world digest moves to 2184942252771043681 (`WORLD_VERSION` 6).

**Cost** (`world_timing`, the minimum of three runs on a shared machine): the 2465 chunks of the hexagon 30.1 ms before and
39.8 ms after (budget 117 ms): two angles and two draws more per cell.

**Memory**: unchanged, the tint is the instance colour every ground and prop already carries (#984).

- **Light rules (#1739)**: the forest's fog closes in to `FOREST_SIGHT` (60 %) of its reach; the desert's mirage hides a marble past
  `MIRAGE` (8) cells of the hero until it comes near; the tundra's ice slides the hero one cell more the same way once a step has landed,
  when that cell is free and nothing was broken or pushed, the slide itself not sliding again (`biomerules.ts`, `slideOnIce`); the last enemy a push
  moves onto the tundra slides one cell more the same way when that cell is open ground with no marble (#1751, `troop_push_on` in
  edgefall-core, so the client and the MCP server agree).

- **Outer biomes (#1741, #1755)**: where a large-scale noise field of the cell is above `OUTER_ABOVE` (0.52, a little under half the map)
  each biome shows its harsh outer one: the meadow a steppe, the forest a jungle, the tundra a crystal plain, the desert salt flats, the
  badlands a volcanic field, the archipelago a swamp, 12 in all. The field (`outerField` of `biomerings.ts`, value noise at 160 and 56
  cells, a hash of the cell alone) is the same for every player and has no centre, so the outer lands are patches all over the map. Their
  ground and props lean to the outer colour and the banner names them. A look only: the rules stay the biome's, the world and its saves
  are unchanged. **Borders (#1740)**: a ground cell's colour averages the biomes within `BLEND_REACH` (4) cells
  and its tree or boulder is drawn from them, so two biomes mix over a gradient.

- **Marked borders (#1752, #1755)**: the border between each pair of biomes is drawn from the seed as a river, a ridge or plain, a third
  each (`border_feature`, the same either way round). Past 40 cells from the spawn, a cell next to a cell of another biome (the climate, not
  dithered) is water on a river, sailed across, or a peak at height 7 on a ridge, with a pass 3 cells wide every 16 cells of distance from
  the spawn (`feature_at`). `WORLD_VERSION` 6: older saves start fresh.

## 5. Relief (#988)

Client only, after #983 (it needs the eight heights).

- `topOf(level) = 0.2 + STEP * level`, water at 0.08. **`STEP = 0.5`** (0.6 since #1718, section 5.1) (a peak at 3.7), kept on screenshots of
  seed 7 at STEP 0.3, 0.4 and 0.5, closest and widest: 0.3 reads flat (the cliff faces are thin), 0.4 shows short
  faces, 0.5 shows the rock plateaus and the peak cluster standing clear of the grass with tall side faces, and no
  cell hidden behind a peak at close zoom. Props, marbles and the troop stand on `topOf`; the mountains (1.2 to 2.0
  high) read as spires on the taller columns, so their scale is unchanged.
- **A cliff too high (#1744)**: a step that climbs or drops more than `MAX_CLIMB` (2) levels is refused (`worldstep::entry`, the `rise` of
  `world_enter`), up or down, an obstacle too; water is sailed onto and off whatever the land's height beside it. The client and the MCP
  server pass the rise; steering slides the hero to a free neighbour as for any refused cell.
- **Finding**: on seed 7 no two passable cells differ by 2 levels or more within 45 cells of the spawn: the steepest
  step a hero can walk is one level. The tall faces are peaks (blocked, level 7) against rock (level 6), 22 cells out
  at (-8, 22) and (-8, 23). The e2e test steps onto a cell one level up, (4, 0).
- **Camera**: it follows the hero's column top with an ease, `y += (target - y) * (1 - exp(-dt / 0.12))`, so a
  step up or down a cliff does not jump. A gap within 0.01 snaps; reduced motion jumps at once. The mode draws
  every frame of the ease and none after it settles. At STEP 0.5 a 3-level step (a gap of 1.5) is 0.010 from the top
  after 0.6 s, on the top within 0.67 s.
- **Pick**: a click is the nearest hit of the ray among the hero's cell and its six neighbours, each tested
  against its own top plane `y = topOf(cell)` and kept only if the hit point lies in that cell (`cellAtPoint` of the
  hit is the candidate). No hit, no move: the hero's own cell comes back and the roll does nothing. A lower cell
  hidden behind a higher ring cell cannot be clicked at its top centre: the test covers all six neighbours above the
  ring's level and the two in front below it.
- **Cost**: the build is unchanged: a rebuild at the widest zoom takes a median 38.6 ms on main and 38.8 ms with this
  task (35 rebuilds each, in node, a synthetic world of every terrain and height).
- Cost: no per-frame work added; a rebuild does not get slower.

### 5.1 More relief, and the land shaped by its landmarks (#1718, #1719)

Drawn only: the levels, the walk and the rules stay the engine's. `topOf = 0.2 + STEP * level + hexLift + relief + shape`, water still at
0.08; every height (the hero, the troop, the props, the pick planes, the other heroes) reads it.
- **STEP 0.6** (0.5 before): the owner found the world a little flat.
- **Rise inside a level** (`relief`, `client/src/landshape.ts`): value noise on a lattice 5 cells wide, eased between its points, 0 to 0.5
  high, so the cells of one level read as slopes and hills; under a step, so a level's highest top stays under the next level's lowest.
- **Style: a tabletop diorama terraformed by its landmarks** (`shapeLand`), each cell shaped by its nearest landmark (a tie goes to the
  tower, then the gate, then the light), falling off with the rings:
  - a tower stands on a **mound**: 3 rings, 1.1 high under it, the tops leaning 45 % toward rock grey;
  - a dungeon gate sits in a **hollow**: 2 rings, 1.0 deep at its mouth, the tops leaning 60 % toward a scorched near-black;
  - a town and a teleporter **pool their light**: 2 rings, no height, the tops leaning 32 % toward the light's own colour (the town's
    cyan, the teleporter's violet).
- The shapes are set as the world opens, before the ground is laid (`shapeWorld`); the low tier's flat look draws neither the rise nor
  the shapes.
- **Twice the levels, and a beach (#1732, owner 2026-11-16)**: the rise inside a level is cut into two flat terraces, none or half a step
  (`terrace`, 0.3) where the relief passes its middle, so each level of the engine reads as two: sixteen drawn heights instead of eight. The
  coast's sand stands half a step lower than its level (`BEACH` 0.3) and takes no terrace: a level-2 beach is drawn at 0.9 instead of 1.4 to 1.9,
  nearer the water (0.08). `topOf = 0.2 + STEP * level + hexLift + terrace + shape`, sand `0.2 + STEP * level - BEACH + hexLift`.
- **Each biome's relief (#1735)**: the terrace follows its biome (`BIOME_RELIEF`): wide rolling hills in the meadow (lattice 9), tight rises
  in the forest (3), low ground cut by ridges in the tundra (a third up), dunes in bands across the desert, wide plateaus in the badlands
  (two thirds up, lattice 10); the archipelago keeps the plain relief. The view hands `topOf` the biome of each cell. Kept on screenshots of seed 1305 at a tower, a gate, the spawn town and in the open, close and wide (owner OK, 2026-11-16).

## 6. Shared rules

- **Order independence and determinism**: a chunk comes from the seed and its coordinates alone.
- **Spawn**: radius 3 open grass, reachable, no enemy within 8 (`openworld.md` section 2).
- **World version**: each task changes every world. Once the save of #968 stores a seed, it also stores a
  `WORLD_VERSION` (a constant bumped by each terrain task), so an old save is told apart, not misread.
  As built (#968): `WORLD_VERSION` is in `crates/edgefall-core/src/world.rs`, with a comment above it (`1` until #1024,
  `2` until #1440, `3` since). The digest test asserts `(WORLD_VERSION, world_digest())` against `(3, <digest>)` on one line, so a change of the generator forces an edit
  of that line: bump the version and repin the digest in the same commit. The bridge exports it as `world_version()`
  (`crates/edgefall-wasm/src/world.rs`), and the client saves it with each world (`openworld.md` section 5): a save of another
  version is not loaded.
- **Memory and speed** follow #981: bounded chunk caches (512 chunks, radius 10), no per-frame allocation, a
  rebuild under about 40 ms at the widest zoom.

## 7. Order of work and conflicts

One task at a time, each branched from `main` after the previous merged (CONTRIBUTING rules 15 and 16):

| Order | Task | Lines it touches |
|---|---|---|
| 1 | #987 fewer obstacles | the constants of `cell`, `world.rs` tests, the digest |
| 2 | #983 noise levels, eight heights | `cell` (the elevation and thresholds), a `field` helper, `topOf` mapping, the digest |
| 3 | #988 relief | `topOf`, `pick`, the camera follow in `openworldview.ts`; no engine file |
| 4 | #984 biomes | `cell`, the chunk bytes (`world.rs`, `edgefall-wasm/src/world.rs`, `parseChunk`, `Tile`), instance colours in `OpenWorldView.build` |

#988 can run beside #983 only if it waits for the eight heights, so it is kept after it. Nothing here runs
beside the zoom group (#976 to #981) while that group is open: it touches `openworldview.ts` and `world.rs`.

## 8. Open choices

- **Biome tint per instance colour** (recommended) or one mesh per ground and biome (more draw calls).
- **Biome as a third byte** (recommended, simple) or packed in the terrain byte (less memory, harder to read).
- **Rivers, swamps and more biomes**: not now; each needs its own task once these four are in.
