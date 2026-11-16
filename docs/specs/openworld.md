---
id: openworld
type: feature-design
status: draft
title: "Open world"
parent: game-design
depends-on: [rules]
---

# Open world (#962)

A secondary mode, like the boss fights (#934) and the rogue-lite run (#797): a huge generated hex
map, a hero marble the player walks, and a troop that follows it and fights on its own. The core of
the game stays Abalone. Owner request of 2026-10-30, pending Decision #962. It sits beside the
A-light Explore (#720 to #725), which it does not touch.

## 1. The mode

- **Entry**: the Airlock bay of the ship (the Modes menu and the dock's World button are gone, #1697), locked until the first win against the bot (#1665, `ui.md` section 4.10), then for everyone, no flag (#1000). A click opens the public
  world, seed 1305 (owner's choice, #1361: a player cannot change the seed for now); any `?openworld=...` link opens it at the
  load, the online notice first. The seed of the URL is read only under automation (tests). Leave returns to where the player
  came from.
- **Delivered (#963)**: the spec (#964), the map (#965), the enemies and troop (#966), the attack (#967) and the save (#968) are merged; the mode is reachable without a flag.
- **A-light dropped**: #720 and its slices #722 to #725, parked since 2026-10-26, are superseded by this mode and the boss lairs (#1170, #1171). The hero rule and Rewind (#723, #724) were not built.
- **Delta to Abalone**: none to the move, the push or the legality (`rules.md`). The mode adds a
  map, obstacles and an automatic troop whose only attack is a legal Abalone push (pillar 1).
- **Not now**: HP, damage, levels, items, real-time fights (each needs a Decision, #313). The economy of the Open world is the one of section 19 (Decision #1654): four resources and the Workshop, nothing else.

## 2. The map

- **Cells**: the axial hex grid, cut into **chunks** of 16 x 16 cells (a parallelogram tiles the
  axial grid with no gap). The world is a regular hexagon of cells centred on the spawn `(0, 0)` (#1440): a cell is in the
  world when its hex distance to the spawn is at most `WORLD_RADIUS` = 448, 603 457 cells (the square world before it,
  64 x 64 chunks, held 1 048 576). `in_world` in `crates/edgefall-core/src/world.rs` is the one test of the edge, for the
  cells, the chunks, the enemies, the lairs and the teleporters. The chunks stay the storage unit: a chunk wholly past
  the edge is off the world (empty on the bridge), and in a chunk the edge crosses the cells past it are off the world
  (`[0, 255, 0]` on the bridge, a hole in the client's chunk), so the edge reads as today's: a cliff into the void in 3D,
  no cell on the minimap and the map. A chunk is generated only when the hero is within 2 chunks of it.
- **Loaded chunks** (the view, #976, #1046): the view draws a square of chunks around a centre chunk, `reach` chunks each
  side. The reach is the ground in view in cells (the hex distance to the farthest corner of the screen), rounded up to
  chunks, plus one chunk of margin, and never more than 10 (441 chunks). The centre is kept while the square still covers
  the hero's hex ball of that radius (every cell within the radius of the hero's cell): it is re-centred on the hero's chunk
  only when it no longer does. So a hero that paces along a chunk line rebuilds no chunk: a step only moves the props
  that switch between detailed and plain, the cells within the detail radius of the old or the new hero cell (#1034,
  #1054), and the others keep their instances. The rule holds at every zoom and turn, so the edge of the loaded chunks never shows on screen.
- **Seed**: a chunk comes from the world seed and its coordinates alone (engine splitmix64), so
  the same seed always gives the same world, in any order of visit. Saving a world is its seed.
- **Relief**: every cell has a height 0 to 7 from three levels of smooth value noise (macro, meso,
  micro, see [openworld-terrain.md](openworld-terrain.md) section 2). The renderer lifts the cell
  column to `0.2 + STEP * height` with `STEP = 0.5` (water to 0.08, see [openworld-terrain.md](openworld-terrain.md)
  section 5), and lights it. The height itself never changes a
  move or a push: it only picks the terrain, and a terrain that blocks is an obstacle.
- **Terrain**: from height and a second noise (moisture), one look per cell: **lakes** (water,
  heights 0 and 1), sand (the shore, height 2), grass, rock, **mountains** (peaks, height 7). Forests
  (**trees**) and ruined **walls** (segments of 3 to 6 cells along one of
  three axes, one per 24-cell square at most, laid on land) come on top.
- **Biomes** (#984, #1442): six, one per sextant of the hexagon seen from the spawn, with ragged borders that blend over a few
  cells: meadow east (the start, the spawn's surroundings are meadow), forest north-east, tundra (snow) north-west, desert west,
  badlands south-west and the archipelago south-east, mostly water with islands of sand and grass, crossed by boat. Each sets the
  colour of the low ground, in the 3D view and on the map, and the density of its trees and boulders (see
  [openworld-terrain.md](openworld-terrain.md) section 4).
- **Obstacles**: blocked cells the hero, the troop and the enemies cannot enter: mountains,
  trees, walls, and scattered boulders (about 2 % of the open cells). Water blocks the enemies only: the hero and the troop
  sail on it (section 4, #1441), and lairs, teleporters and the spawn stay on land. A push into an obstacle is
  refused, as a push into a friendly marble is in `rules.md`.
- **Breakable obstacles** (#1147, #1510): the hero breaks a small obstacle by rolling into it. Every **boulder** and every
  **tree** is breakable, alone or in a forest (`entry` in `worldstep.rs`). Buildings (walls) and mountains
  stay in the way, and so does any cell an enemy stands on. The move that would have
  been refused goes through and the cell becomes plain ground of its terrain (a boulder leaves rock, a tree grass); only the
  hero breaks, the troop and the enemies treat an obstacle as blocked until it is broken, and a push into one is refused
  by the engine until then (the bridge gets the broken cells, which are plain ground for it: #1154). The break plays shards of the prop's colour, thrown outward and falling, gone within 0.7 s, drawn by the
  particle pool (`openworld-animation.md` section 6, no per-frame allocation); under reduced motion the prop fades in place in
  0.3 s. None past the roll zoom. A broken cell stays broken: the set is kept in the world's save (`broken: [[q, r], ...]`,
  section 5) and applied on top of every chunk read, so generation stays a pure function of the seed. `body[data-openworld-broken]`
  counts them.
- **Style**: low-poly and faceted, as the bay: flat-shaded hex columns, coolant-blue lakes that glow
  a little, dark faceted spires for the mountains, teal wire pines, grey boulders, black gantry
  walls. The props are meshes made in Blender (`client/models/openworld.glb`, a few faces each,
  packed with meshopt); the ground is one instanced hex prism per terrain.
- **Spawn**: a clearing of radius 3 around the start cell has no obstacle and no enemy, and every
  cell of the clearing reaches the clearing's edge, so the hero is never boxed in. The clearing is
  grass at height 3, and the world's macro level is offset per seed so that the start and the cells around it
  are land, not sea nor peaks (see [openworld-terrain.md](openworld-terrain.md) section 2).

The levels of noise, the biomes, the relief and the obstacle density are specified in
[openworld-terrain.md](openworld-terrain.md).

## 3. Enemies

Basic enemies only. A group is 1 to 3 loose black marbles in a line on passable cells, placed by
the seed (about one group per 400 cells), none within 8 cells of the spawn, and a group stays
inside one chunk, so no two groups share a cell. They wander (section 3b) but never push: they react only when pushed. They never stand on water: a push that would put one
there ejects it. A pushed enemy is
ejected when the cell beyond the line is water or off the world (the edge of the world): the last
enemy of the line falls, the others shift one cell. A push into a tree, boulder, wall or peak, or
into a marble (troop or enemy), is refused. Enemies never push, so nothing ejects the hero yet.

## 3b. The wandering marbles (#1511)

The generated marbles of a chunk walk a short way from where they start and back, slowly, as one group. The rule is pure and lives in
Rust (`crates/edgefall-core/src/worldwander.rs`, `offset`), integers only, so every peer sees the same marbles in the same places.

- **Clock.** The world's tick: the wall clock in ticks of `TICK_MS` = 1200 ms (`FightState.tickMs`, `Math.floor(Date.now() / 1200)`), the
  same on every peer to within their clocks. A marble steps one cell a tick, 0.83 cells a second against the hero's 7. The page hands the
  tick to the fight (`FightState.setClock(seed, tick)`, `WorldFight.set_clock`), and every question about the enemies (where they are,
  which cell is taken, who is near the hero, what a push meets) is asked at that tick. Tick 0 stands every marble on the cell it starts
  on: a fight that sets no clock, the MCP server's, never sees a marble move (it has no real time, and no wild fight, section 3c).
- **Walk.** The group of a chunk moves as one: every marble of the chunk is shifted by the same offset, so they never meet each other. The
  tick is cut into outings of `EPOCH` = 8 ticks. Each outing draws from the seed, the chunk and the outing alone a direction (one of the
  six) and a length of 0 to `LEASH` = 3 cells. The group goes out one cell a tick, stays, and comes back to end the outing at home, so
  the offset after tick `t` of an outing is `min(t, length, 8 - t)` cells along the direction (the distance is 0 at the start of every
  outing, and a tick moves the group one cell at most).
- **Where it may go.** A marble never walks onto water, a peak, a wall, a tree or a boulder (the generated terrain, `Terrain::blocked`, the
  same as where a group is placed), off the world, or out of its chunk. When a cell of the way is such for any marble of the chunk's
  group, the length is cut short of it. The terrain read is the generated one, never the cells the hero broke, which peers do not share.
  The walk reads the chunk's generated marbles, the ones a push moved away included, so it never depends on what a troop did.
- **The troop and the shoved marbles hold their cell** (#1590): the page tells the fight the troop's cells (`FightState.setHeld`) before
  every tick, and a group whose next cell is a troop marble or a marble the troop shoved (`added`) waits where it stood
  the tick before (the last cell of the outing that is clear), so a wandering marble never shares a cell with one. This is this peer's
  drawing alone: the walk (`worldwander::offset`) stays a pure function of the seed, the chunk and the clock, and the wire names a marble
  by its start cell, so no peer needs the troop of another.
- **A marble moved by a push stops wandering.** It stands where it was pushed to, in `added` (section 4), and keeps no start cell. The
  overlay keeps a generated marble by the cell it starts on (`removed`), so the save format is unchanged, and a marble pushed
  onto the start cell of another one is not that one again.
- **Drawing.** The view lays the enemies again on a tick and rolls each marble that stepped from its old cell to the new one over
  `WANDER_GLIDE_MS` = 900 ms (the push's own animation is waited for), at once under reduced motion. `window.__openworldWander(tick)` sets
  the tick on a webdriver page (`null` for the real clock); automation stands at tick 0 until a spec sets it, so the specs of the world
  keep their marbles still.
- **Online.** A signed "beaten" event (`multiplayer.md` section 7, #1305; `world_is_enemy`) names the cell the marble was **generated** on, not
  where it wandered to, and the peers check it against that cell as before: a marble is the same one on every peer whatever its place at
  the tick. `Played.homes` gives the start cell of the ejected marble when it is a generated one, and `FightState.alive(world, home)` is the
  peer's check that it is still there. The wire does not change.

## 3c. The wild fight (#1511)

A wandering marble that touches the hero starts a fight the player can run from. It is the game's own Abalone against the bot, on the arena of
the hour, reached and left the way a boss lair is (section 7). No new rule.

- **Contact.** A generated marble no push has moved, within **1 cell** of the hero (`WorldFight.wild_contact`, `Overlay::wild_contact`), starts
  the fight. It is looked for after each step of the hero (so rolling into a marble, or up to one, is a contact: the step lands within one cell
  first), on each tick of the clock (a marble that walks up to the hero), when the calm ends, and when a test fixture puts the hero beside one.
  Of several, the one that started on the lowest `(r, q)` fights. A marble the troop shoved stands in `added` and fights nobody. The step that
  makes the contact **skips the troop's automatic push** (section 4): the marble has started a fight, the troop does not push it, nor any other
  that step. The walk ends and the hero takes no more steps; the world is saved with the hero where it stands (the cell it landed on).
- **Calm.** A world that has just opened starts no wild fight for `FLEE_GRACE_MS` = **5 s**: that is how a marble that was fled from cannot fight
  for 5 s (Flee, a loss and a reload all open the world again), and a marble next to the hero on a reload or a Back does not catch it at once.
  After the calm, a marble still within one cell fights. A test fixture ends the calm.
- **Transition** (`client/src/wildwipe.ts`, `#wild-wipe`, ui.css): a white flash over the first 0.2 s and a dark hexagon with an accent rim that
  grows from the middle of the screen over the world in 0.5 s; the world is left and the arena is set up under it; then the hexagon shrinks back to the
  middle over 0.5 s: **1 s in all**, the game's own (the hexagon of its cells, its accent), no art of another game. Under reduced motion (the
  page's `reducedMotion()`) it is a plain fade: 0.25 s to black, the swap, 0.25 s back. The cover ignores the pointer and the keys, and the arena is
  there from the middle of the transition, so nothing waits for it once the arena appears. While it closes the hero takes no step and no key is the
  world's.
- **The arena.** `startWild` in `main.ts`: the world is left (saved), a new local game against the bot starts on the **standard board, 14 marbles a
  side**: no constant of a short army fits better (the Trainer starts a wave on one marble, `FULL_ARMY` and `START_ARMY` are the full 14). The board
  is the hexagon of the phase the marble was met at, the same three looks as a lair (section 11, `data-fight-board`). The player's own local game is
  not touched: the wild fight is never saved (`saves.save` is skipped, New and Retry are hidden), and Flee, Back or a reload give the saved local game
  back under the world. The game rules, the HUD and the end banner are the ordinary ones.
- **The bot.** `WILD_NODES` = **2000** positions (`bot.ts`), a tenth of the bot's 20 000 and below the rogue-lite's fight (20 000 at normal, scaled
  by the difficulty, doubled against an elite): fixed, not scaled by the difficulty setting, and never above the test budget `?nodes`.
- **Flee.** A button labelled `Flee` in the dock (`#wild-flee`, ui.css, the accent ring of Retry), on screen for the whole fight and hidden once it is over,
  and the **F** key (not in a text field, not with Ctrl, Alt or Meta). It ends the fight at once: the world opens again with the hero where it stood, no
  reward and no penalty, the marble where the clock puts it, calm for 5 s. A **loss** ends the game and offers "Back to the Open world", the same
  return, with no penalty. A **reload** during the fight (`localStorage` `ab-alone.wild` holds the world's seed while one is on) opens the world at the
  load, the hero on its cell; nothing was lost, the marble is still there.
- **Win.** The end banner adds "The marble is gone from the world.", and the marble is removed as a marble the troop ejected is today:
  `WorldSaves.beatMarble` writes its start cell into the saved `fight.removed` and adds one to `fight.beaten` (once, even if the banner is drawn
  again). "Back to the Open world" resumes the world without it. It is told to the other heroes as a beaten enemy (`PeerHost.wildWon`, the lair's
  owed queue: sent now or when the room opens).
- **Special marbles and relics** (#1655, sections 19.2 and 19.3). When the army brings some, they stand on its side in the arena, its relics are set (the Saboteur gives the bot 13 marbles) and the bot plays them; one thrown off, or a Bomb burst, is lost
  from the army at the end of the fight, win or loss. Flee, Back and a reload keep every marble.
- **Online (the smallest correct rule).** A wild win is the signed `beaten` event of #1305, unchanged: it names the cell the marble was **generated**
  on, never where it wandered, and the peers check it with `world_is_enemy` against that cell as they do for an enemy the troop ejects
  (`PeerHost.beaten` uses `Played.homes` now). A peer applies it to the marble that starts there if it is still alive (`FightState.alive`), wherever its
  clock puts it. The fight itself is the player's alone: other heroes see the hero leave the world, as for a lair, and come back.
- **MCP.** The server stays in step by standing still: its `WorldFight` sets no clock (tick 0, every marble where it starts, as before), and it has
  no board fight to start, so `world_step` and `world_walk` never meet a wild fight and the marbles never move there. No change to its tools or
  its saves.

## 4. The hero and the troop

- **Hero**: one glass marble (#1176: in the skin the player wears on the ship, as the troop; the enemies wear the worn shell skin, and the stripe ring is the only team cue; under the neon look with the default skins, the arena's own finish, the black shell with its cyan rim and the white glass, #1558: GPU ?gpustats, two runs each, no measurable change, 1280x720 7.96 and 7.97 ms before, 7.95 and 7.97 after, 390x844 7.40 and 7.38 before, 7.39 and 7.39 after), moved one cell at a time (click a neighbour, or the arrow keys, as
  in the hub, section 3.5 of `game-design.md`). A held arrow keeps walking: the first cell is taken on the
  keydown, then one cell per glide (140 ms) while the arrow is held, whatever the system's key repeat (#1059).
- **Gamepad** (#1252, `game-design.md` section 2 item 7): the left stick or the D-pad walks the hero as the touch stick does,
  read in the yaw of the camera, and the walk goes on while it is held. LB and RB turn the camera one step (Q and E), R3 resets it
  (R), the triggers zoom (the wheel's path, RT in, LT out), B leaves (Esc). The right stick does nothing here. While the focus is
  on a control (after Start, say) the stick and LB RB walk the focus instead, and the hero stays. A walk onto a lair starts the
  boss fight, played with the pad (A, B, LB RB, the stick) and left with Back, as with the keyboard. The help and the HUD name
  the pad's buttons while the pad is in use.
- **Camera turn** (#1026, #1251, #1254): Q and E turn the camera round the hero by 60 degrees, one step per hex direction, so six
  presses make a full turn. The grid is pointy-top, so at yaw 0 screen up falls between two neighbours (the zigzag of an odd and an
  even row). The camera therefore rests at 30 degrees plus a multiple of 60 (`REST_OFFSET`): at every resting angle screen up runs
  along a straight line of neighbours, and held Up alone walks it with no tie. The default is -30 degrees, where up rolls
  north-east, the step the keyboard always took on an even row; R goes back to it, and a new world opens at it. A right-button drag
  or a two-finger twist turns freely while held, and on release it settles on the nearest resting angle. The yaw is saved with the
  world; a saved yaw that is not a resting angle (an older save) is read back at the nearest one. At every resting yaw each arrow
  and diagonal still steps to the neighbour the camera shows nearest to it.
  A pure sideways intent (Left alone, Right alone, the stick near horizontal) sits exactly between two neighbours, up and down
  on the screen; the tie goes to the one that leans forward (up on the screen), so at every resting angle Left steps up-left and
  Right up-right (#1273). Up, Down and the diagonals keep their steps; Down with Left or Right still steps back.
- **Steering** (#1137): a held direction (arrow, stick) is an *intent*, an angle on the ground. Each step takes the cell of
  that direction when the hero can enter it. When it cannot (a wall, a peak, an enemy), the hero takes
  the free one of the two neighbours 60 degrees to the side that the intent follows best; if both follow it equally, the lower
  direction index (E, W, NE, SW, NW, SE). It never steps back or to a cell 120 degrees off. When no side is free, it leans and
  stops as before (#1040). Only legal steps: the same `Hero.step` rules.
- **Tap to walk** (#1137): with steering on, a tap or a click on a cell that is not next to the hero sets a destination. The cell
  is found on the ground under the pointer (the ray meets the plane of the hero's cell top, then the top of the cell it fell in,
  three times over). The path is a game rule, so it lives in Rust (#1164): `world::find_path`, a bounded A* on the hex grid,
  exported as `world_path(seed, from, to, blocked, broken)` (`q, r` pairs, the start left out, empty when there is no way).
  A cell is entered when it is on the world, not an enemy or a lair (`blocked`) and open (water too, it is sailed) or an obstacle the hero breaks
  (a boulder or a tree, #1147, #1510), the same rule as `Hero.step`; the cells of `broken` are plain ground. Every
  step costs 1, the estimate is the hex distance. Bounds: the destination is within 40 cells of the hero, and the search stops after
  6000 expanded cells, so a walled-in destination costs a bounded time; both give no path and the tap does nothing. Determinism: the
  open cell with the lowest estimate goes first, then the nearest the destination, then the lowest `(q, r)`, and the steps are tried
  E, W, NE, SW, NW, SE. The hero takes the path one cell per glide at the steady speed of a held walk (#1065), each cell through
  `Hero.step` (so the troop trails it and its push plays as for any step). The walk ends at the destination, when a step is
  refused (an enemy moved in, a push moved the hero off the path), or at once when any key is pressed, the stick is held, the camera
  is dragged, twisted or pinched, or steering is turned off. A new tap replaces the walk. A lair is a blocked cell: a tap does not
  walk into a boss fight. `body[data-openworld-route]` holds the cells still to take.
- **Sailing** (#1441): the hero and the troop enter water and move on it exactly as on land: the same step, trail, steering, walk
  path and push. The rule is the engine's, in one place: `Terrain::blocked` is what an enemy (and a lair, a teleporter, the spawn)
  cannot stand on, `Terrain::open_to_hero` what the hero and the troop can enter, the open ground and water; the client and the MCP
  server (`world_step`, `world_walk`) both ask the engine. Off the world still stops the hero: there is no sea past the edge. On
  water each marble of the hero and the troop rides a small low-poly boat (`openworldboat.ts`): a wooden hull and a pale triangular
  sail at the bow, 18 flat triangles, one geometry and one material for every boat (one instanced mesh, `boats` in
  `body[data-openworld-drawn]`). The hull sits on the water round the lower part of the marble, which keeps its size and place;
  the boat and its marble bob together (3 hundredths of a cell over 2.6 s, each boat on its own phase), held still under reduced
  motion, on the low tier and past the roll zoom. A boat turns to the way its marble went once it went 0.3 cell, so the lean of a
  blocked step never turns it. On land the boat goes away, from the moment the marble's drawn place leaves the water cell.
  The heroes of the other players and their troops ride the same boats on water, one instanced mesh of the peers' layer (`peer-boats`), bobbing and turning by the same rules.
- **Steering setting** (#1137): the Settings item *Steering*, on by default (team decision), stored under `ab-alone.steering`.
  Off, a held direction takes only the straight step and leans when it is blocked (#1040), and a far tap does nothing; a tap next
  to the hero rolls it either way. The Open world HUD line `#openworld-mode` names the mode: "Steering on" or "Steering off".
- **Troop** (#1504): 15 marbles per player, local and remote, at the start on the open ground round the spawn (nearest first). After each
  hero step the troop flocks (section 4b). No decision of the player.
- **Automatic attack**: after its step, the troop attacks when a line of 2 or 3 of its marbles,
  hero included, is next to a smaller line of enemy marbles along that line's axis and the push is
  legal under `rules.md`. It then plays that push. The enemy line is the run of enemies right in
  front of the pushing line, 1 or 2 marbles and fewer than the pushing line (2 pushes 1, 3 pushes
  1 or 2). The push is refused when the cell beyond the enemy run is a tree, boulder, wall or peak,
  or holds a marble; it ejects the last enemy when that cell is water or off the world, and
  otherwise every enemy of the run shifts one cell. Several pushes can be legal: the one that
  ejects the most enemies, then the lowest `(r, q)` of the back marble of the pushing line, then
  the lowest direction index (E, W, NE, SW, NW, SE), so the result is deterministic and testable.
  The rule is built in `crates/edgefall-core/src/worldfight.rs` (`best_push`, `apply_push`).
- **Client state** (`client/src/openworldfight.ts`): the enemies are the generated ones of the seed
  with an overlay. `removed` holds the cells of generated enemies a push moved away or ejected, `added`
  the cells of enemies that now stand where no generated one starts, `beaten` counts the ejected ones.
  The current enemies of a cell are its generated ones not removed, plus the added ones. The hero is
  blocked by the current enemies (not by the generated ones of its own chunk), the view draws them,
  and a push redraws them. The overlay is plain data: `toJSON` and `FightState.fromJSON` (the save).
  A new entry starts a fresh overlay.
- **Bridge**: `WorldFight.troop_push(seed, troop, chunks, broken)` (`crates/edgefall-wasm/src/world.rs`, rule in
  `Overlay::troop_push`, `crates/edgefall-core/src/worldoverlay.rs`) plays the push after each step on the hero,
  the troop and the overlay, with the enemies within `WorldFight.push_reach()` (10) cells of the hero. It
  gives the troop, the enemies before and after, the ejected one and the direction, or nothing when no push
  is legal.
- **Data attributes** of `body`, next to `openworldAt` and `openworldTroop`: `openworldEnemies` (the
  enemies drawn in the loaded chunks), `openworldBeaten` (the ejected enemies) and `openworldPush`
  (the pushes played, one more at each push).
- **Animation** (#967): the state is final at once (hero, troop, enemies, data attributes); only what is drawn
  is animated, from the old cells to the new ones, in this order (`OpenWorldView.playPush` and `tick`):
  1. **Lunge** (0 to 400 ms): each marble of the pushing line moves from its old cell to its new one, the
     hero's mesh with it when it is in the line. The ease goes a tenth of a cell past the new cell at 80 % of
     the lunge, then settles back on it. The camera follows the hero's drawn place.
  2. **Slide** (160 to 410 ms): each pushed enemy slides one cell along the push, starting at the contact
     (40 % of the lunge). The contact frame is held 50 ms (`HIT_HOLD_MS`, #1561): the whole push stands still
     for that long and the slide starts after it, so the push ends 50 ms later. The hold only pauses the push's
     clock, a step or a click snaps the push at once and waits for nothing. Four sparks (`BURST`, at most four
     alive, from the particle pool) fly from the contact cell. Reduced motion plays no push, so no hold and no spark.
  3. **Fall** (160 to 410 ms slide, then 410 to 710 ms sinking): an ejected enemy slides into the water cell
     (or past the edge), then drops 0.6 below the ground while it shrinks to nothing. It has its own mesh
     (`ejected`), shown only while it falls.
  - **Reduced motion** (the page's `reduced()`): no animation at all, the marbles jump as before.
  - **Snap**: a step, a click, a zoom, a resize or a fixture first ends the animation on its final cells.
    Leaving the mode cancels it. While it runs the mode draws every frame, and the body carries
    `openworldAnim="1"` (removed when it ends).
  - The times are the normal speed; `window.__openworldSlow` (a webdriver check) multiplies them.
- **Loss** (deferred, not built): the hero ejected ends the walk (the world is kept, the hero
  starts again at the spawn, the troop at 6). It cannot happen yet, because enemies never push;
  it is specified here for when they do. A troop marble ejected is lost, with the same deferral.

## 4b. The flock (#1504)

The troop moves like a flock of birds. The rule is `worldstep::flock` (edgefall-core), exported as `world_flock(seed, tick, troop, step, ground)` with `step` = `[from q, from r, to q, to r]`;
the client only passes the cells and draws. After the hero steps from `at` to `to`, every follower moves once (a follower more than 3 cells
from the hero, the leash, moves twice, so strays catch up), the nearest to the hero first. It takes the best of its own cell and its six
neighbours that is in `ground`, is not `to` and holds no other marble (the cell `at` the hero left is always allowed), by this cost, in 1/n
cell with n the marbles plus the hero, the lowest winning:

- **cohesion**: the distance to the centre of the group and to the hero;
- **separation**: one cell per marble beside the candidate cell;
- **alignment**: one cell per hex step between the move and the hero's heading;
- **leash**: 32 cells per cell beyond 3 from the hero;
- **jitter**: a SplitMix64 hash of the world seed, the tick (the hero's step count) and the marble's index, under one cell.

Integers only, so a replay, and the peers that receive the cells, agree. A follower on `to` moves first and is never dropped, so the hero is
never blocked by its troop. A follower never stays on `to`, an enemy's cell, water the hero does not sail or an obstacle: when its own cell is invalid and no neighbour is valid it takes the nearest valid cell within 6 (or stays when there is none). `ground` is the open ground (sand, grass, rock, no enemy on it), plus water only while the hero sails (#1441): a
follower never stands on an obstacle, and in water only on a boat's course. The troop keeps its 15 marbles and its order; the wire carries up
to 15 offsets (33 bytes). A new world starts the troop the same way in the client and the MCP (`startTroop`: the 15 nearest standable cells of the three rings round the spawn). The tick is not saved, so a resumed world restarts it at 0 and flocks differently from the same session played straight through, in the client and the MCP alike (accepted).

**The shove (#1504).** The troop also fights with single marbles. After the flock, in `Overlay::troop_push`, when no line push ejects (a line that ejects keeps priority), `worldfight::best_shove` looks at every troop marble (hero included) and the six directions: a foe on the neighbour cell whose cell behind it, along the same direction, is water or off the world is ejected, and the marble takes the foe's cell, as the front of a line does. Only a shove that ejects exists: on dry ground a single marble pushes nothing, and the foes are the generated and pushed enemies (the only neutrals). One push per hero step (a shove replaces the line push of that step). Among the possible shoves the lowest SplitMix64 hash of the world seed, the tick (the same hero step count as the flock) and the slot (marble index * 6 + direction index) wins, so every peer plays the same one; integers only. `WorldFight.troop_push` takes the tick as its last argument; the result and the animation (lunge, slide, fall) are those of a line push, the client and the MCP unchanged otherwise. The wire does not change.

## 4c. The herd (#1506)

The troop also herds a foe or neutral marble to the water over several hero steps, even when the water is far. The rule is `worldherd` (edgefall-core); it is **stateless**: each step it is derived again from the seed, the cells and the generated world, so nothing is saved and nothing travels (the wire does not change), and peers agree. Integers only, no hash-map order.

- **Target** (`worldherd::herd`): among the foes within **6** cells of the hero (about what the hero sees, and inside the push reach of 10), the one whose shortest walk over open ground (no other foe on it) to a water cell or off the world is the shortest, at most **10** cells (the search is bounded to 331 cells). Ties by the SplitMix64 hash of the world seed and the foe's cell (not the tick: a tie must not flip each step). The walk's first direction `d` is the first in the order of `DIRECTIONS` that starts a shortest walk and whose cell behind the foe (`foe - d`) is open ground. The troop's cells are not obstacles of the walk, so the target does not depend on where the followers are.
- **Roles** (`worldherd::goals`, before the flock): the follower nearest to the cell behind the foe (within 8, lowest index first) is the pusher, up to two more take the cells beside the foe, behind it on either side (`foe` plus the directions 120 and 240 degrees from `d`). They are the only ones the herd moves: each hops twice and adds a pull of 64 per cell to its goal to the flock cost (`worldstep::flock`, its last argument), so they keep the flock's separation and jitter; the others flock as in section 4b. The hero never gets a goal. No follower in reach of the push cell: no goals.
- **Herding push** (`worldherd::herd_push`, in `Overlay::troop_push`): after the flock, when a troop marble (the hero included) stands behind the target it pushes it one cell along `d` and takes its cell; the cell ahead must be open ground free of the troop. Order of the step: a line that ejects, a shove that ejects (4b), the herding push, a line that does not eject. The last step of a walk is the shove of 4b (the water behind the foe), so the foe falls with the same rule and animation. Never an ally, the hero or another player's marble.
- **End**: the hunt ends by itself when the walk is blocked or longer than 10, the foe is farther than 6 from the hero, or no follower is within 8 of the push cell: the next step does not find it, and the troop flocks.
- **Bridge**: `world_flock(seed, tick, troop, step, ground, goals)` takes `goals` as `index, q, r` triples (empty without a hunt); `WorldFight.herd_goals(seed, troop, chunks, broken)` gives them (the hero first in `troop`, the index is among the followers). The client (`Hero.step`) and the MCP call it before the flock; the push is played inside `troop_push`, so nothing else changes.

## 5. Saving

The world (seed), the hero and troop cells, and the enemy groups beaten are saved in IndexedDB, in the game store of the
`ab-alone` database next to the local game and the run (`client/src/openworldsave.ts`, #968). No library: the `idb.ts` store.

**What is saved.** One record per seed, under the key `openworld:<seed>`:
`{ record, version, seed, hero: [q, r], troop: [[q, r], ...], fight: { removed, added, beaten }, broken: [[q, r], ...], lairs: [n, ...], discovered: [[cx, cy, bits], ...], time, logs: [n, ...], recruits, resources: { wood, ore, parts, shards }, army: { specials, brought, relics, relicsBrought }, yaw, savedAt }`, where `fight` is the
`FightState` of `openworldfight.ts` (the generated enemies a push moved away, the enemies on other cells, the beaten count).
The last world played is kept apart under `openworld:last` (`{ seed }`).

**When.** After each hero step and each push, the final state (not the animation), written at most once a frame: the frame
loop flushes it. The world is saved once more when the mode is left, and when another world is entered over it. A write
does not wait for the game: a storage that fails (a private window, blocked or full storage) is no game error, the save is
just not counted. The page counts the stored saves in `body[data-openworld-saved]`, which the e2e test polls.

**Which world opens.** For a player the menu entry (`#openworld`) and any
`?openworld=...` link at load open the public world, seed 1305 (#1361); older private saves stay in the store, untouched, and
there is no New world control. Under automation (`navigator.webdriver`) `?openworld=<n>` opens that seed, resuming its own
save, and `?openworld=new` opens a new random seed fresh. The push count of a session
(`openworldPush`) is not saved: it starts at 0 after a reload.

**Versions and garbage (#1661).** A record of the right seed and world version is never deleted. A field that does not decode (a wrong shape,
cells that are not integers, a `time` out of range, more troop marbles than the troop holds, a bad `fight`) is reset to its default and the
other fields are kept: `resources`, `army`, `logs`, `recruits`, `time` (start of day), `discovered`, `broken`, `lairs`, `fight`, `troop`
(none) and `yaw` (0) each fall back alone, and each one reset is named in a `console.warn` (`openworld: the saved <field> of world <seed> does
not decode ...`). Only a record whose `version` is not the `WORLD_VERSION` of the bridge (`world_version()`, openworld-terrain.md section 6; its
cells would mean something else), whose `seed` is another, whose `record` version this build does not know, whose `hero` is not a cell, or
that is no object at all, is refused: the world starts on the spawn, and the refused record is copied under `openworld:<seed>:refused`, not
deleted. The store (`idb.ts`) forgets a connection that closed under it (a newer page upgraded the database, the browser closed it) and runs
the call once more on a fresh one, so a closed connection never reads as "no save". The only delete of a world key is New world
(`discard`).

**Record versions.** `record` 3 adds `lairs`, the numbers of the boss lairs beaten (section 7). A record of version 1 (no `record`
field) or 2 loads with no lair beaten, so an old save is kept; an unknown later version, or a `lairs` that is not a list of
whole numbers, is refused or reset as above. `record` 4 adds `discovered`, the cells discovered (section 9): a record before it loads
with none, and the mode discovers the cells round the hero at once; a `discovered` that does not decode is a bad field, reset as above. `record` 5 adds `time`,
the time of day (section 11): a record before it loads at the start of day; a `time` that is not a number in `[0, 12 min)` is a bad field, reset as above. `record` 6 adds `logs`, the numbers of the lore logs found (section 12): a record before it loads with none found; a `logs` that is not a list of whole numbers is a bad field, reset as above. `record` 8 adds `resources` and `army` (section 19, #1655): a record before it loads with zero resources and an empty army; a `resources` that is not four whole numbers from 0, or an `army` that is not four lists of codes within the army's limits, is a bad field, reset as above. `beat` and `beatMarble` add the shards of a lair and the parts of a wild fight to the record they write, once (a lair already beaten, a marble already gone, gives nothing), and write record 8. `record` 7 adds `recruits`, the marbles that joined the troop (section 16): a record before it loads with none, and its troop holds 15 marbles at most as it always did; a `recruits` that is not a whole number from 0 to 5 is a bad field, reset as above, and so is a troop longer than 15 plus its `recruits`. `beat` and `beatMarble` keep `recruits` and write the current record, so a record of version 6 they touch still loads.

## 6. Tests

Engine (`edgefall-core`): the same seed gives the same chunk in any order; the spawn clearing is
connected; a chunk has no marble on an obstacle; the troop's attack is a legal push and the choice
is deterministic. Client: unit tests at 100 %, and an e2e that walks a few cells, meets a group,
watches the troop push, reloads and is still there (under 15 s). Every slice is checked in Chrome
with the Playwright MCP before its PR, with a screenshot.

Test hooks, on a webdriver page only: `window.__openworldFixture({ hero, troop, enemies })` puts the
hero, the troop and the enemies of the loaded square (the generated ones are hidden; without `enemies` they stay, wandering, and a marble the hero is put
beside fights, section 3c), `window.__openworldWander(tick | null)` sets the tick of the marbles' clock (section 3b), and
`window.__openworldEnemies()` gives the enemies near the hero; the fixture also takes `recruits: n` (section 16), and `resources` and `army` (section 19.2), and `window.__openworldPads(seed)` gives the pads of the towers as `q, r` pairs (section 15). The e2e push test uses them. `window.__openworldTime(ms)` sets the time of
day in ms of the 12 minute cycle (section 11), `window.__openworldLogs(seed)` gives the lore logs of a world as `q, r` pairs (section 12); `body[data-openworld-phase]` reads `day`, `dusk` or `night`, and `body[data-fight-board]`
the same on a lair fight.

## 7. Boss lairs (#1170, #1171, epic #1177)

The Open world has a goal: one landmark lair per boss of the roster (15 today, the length of `boss_ids()`), each a normal boss fight.

- **Placement** is seeded world generation in Rust (`world::lairs(seed, count)` finds the cells; the bridge's `world_lairs(seed)` gives the cells of
  `world::towers(seed)`, `q, r` pairs, lair 0 first). Since #1532 the cell a boss stands on is its tier's, section 15: lair `k` is still boss `k`, and the
  cells are the same set. The rest of this paragraph is how `lairs` draws a cell, whose number is the draw's, not the boss's. Cell `k` is drawn in the sextant `k % 6` of the hexagon (#1442, the biome of section 2), in the `k / 6`-th of its share of
  that sextant's lairs (the middle 60 % of it), 160 to 420 ground units out, and kept when its cell and its six neighbours are open
  ground of that sextant's biome on the world and it is at least 150 cells from the spawn (`LAIR_MIN`): so every biome holds two
  lairs or more (three in the meadow, the forest and the tundra for the 15 bosses), on land, an island in the archipelago. Before
  #1442 lair `k` was drawn in the `k`-th `count`-th of the circle. The hexagon's corners are 448 ground units out and the middles
  of its sides about 388, so a draw past the edge is drawn again. After 8000 tries in its share of the sextant a lair is drawn in the whole sextant, and the search
  ends after 40 000 (#1594: seed 711's third lair of the tundra had no open ground in its share and the world never opened); a lair found in its share
  does not move. It reads the terrain, never changes it.
- **Look.** A low-poly landmark made in Blender (`client/models/openworld-lair.glb`, vertex colours, under 72 triangles each) on
  the lair's cell, tall enough to read from the widest zoom: a dark spire on a hex plinth with a gold band and a floating gold gem
  while the lair is unbeaten, a shorter stump with a green band and no gem once beaten (the shape changes, not only the colour).
  Until the model is loaded, the plain gold or green pillar is drawn.
  An unbeaten tower wears a crenellated crown in its lamp's colour at 4 units, six merlons on a collar (84 triangles), the top of its
  map icon, so it reads apart from a town's spire from far away; a beaten one has none (#1518).
- **Enter.** Rolling onto the lair's cell from a neighbour starts the boss fight of the same number in the roster (`boss_ids()`), the number of the lair, not of its place on the map,
  the normal fight with a random seed. The world is left with the hero on the entrance (the cell it came from). The fight is live at once, under the transition of motion.md story 10 (a cue of two doors, the boss's name) (#1519).
- **Win.** The medal is recorded in `ab-alone.medals` as for any boss win, and the lair is added to `lairs` of the world's save.
  "Back to the Open world" resumes the world on the entrance with the lair shown beaten.
- **Loss.** "Back to the Open world" returns the hero to the lair's entrance, the lair unbeaten. Retry stays the lair's fight.
- **Browser checks.** `body[data-openworld-lairs]` lists the lair cells (`q,r` separated by spaces) and `data-openworld-lairs-beaten`
  the numbers beaten; `__openworldFixture` stands the hero next to a lair.
- **Medal count.** The HUD shows `Medals N / total` (`#openworld-medals`): N the bosses with a medal in the shared `ab-alone.medals`
  store, total the roster size. Read when a world opens, so it is right after "Back to the Open world".
- **Tally's line.** The first time a player opens an Open world the HUD shows "Claim: unworked." and one sentence that explains it (`CLAIM_NOTE`, section 14) (`#openworld-tally`), once: the
  flag `ab-alone.tally0412` is kept next to the medals. From stage 5 of the story (world.md section 12) it reads "Claim 0412: unworked.",
  the line number being a secret until then (#1584). Reduced motion changes nothing.
- **Seats on file (#1315).** While some lairs are beaten and not all, a world that opens shows "Seats on file: N of total. Slag-glass remembers heat."
  (`ledgerLine` of `client/src/tally.ts`, the lore line of world.md section 2) in `#openworld-tally`, in place of the claim line, which is not asked for.
  From stage 7 of the story (the epilogue, world.md section 12.8) the lore sentence gives way to "Clamp: open." (#1546).
- **Place lines (#1315).** The first time the hero steps within 3 cells (`PLACE_REACH`) of a town, a dungeon gate or a tower, or onto a biome
  other than the meadow, `#openworld-tally` shows Tally's line of that kind (`PLACE_LINES` of `client/src/placelines.ts`, eight lines, what
  world.md section 13 says each place is, no secret word): once per kind for the player, the kinds filed in `ab-alone.placelines` next to
  `ab-alone.tally0412`. A step reaching two new kinds files the first (town, gate, tower, then the biome); the next step files the other.
- **The army in a lair (#1655, section 19.3).** The special marbles and relics the army brings (Workshop, section 19) are placed and set in the lair's fight when its boss takes the army's build, and the marbles lost are settled as in a wild fight. Nothing of it in a boss picked from a menu or the Hub.
- **Ending (#1175).** When every lair of the world is in `lairs` (beaten), the world counts as beaten: whenever it opens, `#openworld-tally`
  shows "Variance noted. Clamp: open. Crew attached: 6." (the crew is the Trainer's `MARBLES`; "Clamp: locked" while the story is short of stage 7, #1546), in place of the claim line. One line, no
  speech, nothing gated, no new save field (a save from before reads as not over). `__openworldFixture` takes `beaten: [n, ...]` to set the lairs beaten.

## 8. Minimap (#1410)

- **Place.** A round canvas, `#openworld-minimap` (9 rem, drawn at 288 px), fixed in the top right corner under the settings cog (16 px from
  the top, the cog's height and half a rem below it), never over a button on a desktop or a phone width. It ignores the pointer, and
  shows only while `body[data-openworld]` is set, so every other mode (and a world left) has none (#1275).
- **Window.** The hex disc of 24 cells round the hero (three chunks across), each cell a square in the colour the 3D view draws its terrain in (`terrainColour`: `LOOK`, `WATER`, `PROPS`, no palette of its own), read
  with `World.tile`: the same chunks as the 3D view, no second copy of the rules. The hero is in the middle (white), the troop (gold) and
  the enemies near the hero (red) are dots. Only the discovered cells (section 9) and the enemies on them are drawn; the rest stays dark.
  A discovered teleporter in the window (section 10) is a portal icon (see Icons).
- **Turn.** The map is turned by the camera's yaw (`screenOffset`: the ground layout of `axialTo3D`, screen up `(-sin yaw, -cos yaw)`), so up
  on the map is up on screen, and Q, E, R and a drag turn it. It turns with the camera's drawn yaw (`OpenWorldView.drawnYaw`, the spring
  of #1333), so the minimap and the 3D view turn together and end together; under reduced motion it turns at once. It is redrawn on the
  frames where that yaw changed, never at rest.
- **North (#1448).** North is the ground's -z at yaw 0 (decreasing axial `r`), the same for every world. An N on a dark round plate
  (white on `#0b0d0f`, over 3:1, unit test) sits on the minimap's rim, on the north side (`northDirection`), and turns with the map. The
  full map (section 9) has a small compass in its top left corner: a plate, an arrow and an N toward the north, as the map is drawn.
- **Icons (#1438, #1443).** `openworldlairicon.ts` draws them with canvas paths, no image. A boss tower is a crenellated tower on a dark
  square plate with a dark halo and a light rim, in the colour of its boss (`BOSS_COLOURS`, one per boss, lair k is boss k counted round the roster) and with the
  boss's initial from 26 px; a beaten tower is grey with a check mark and no initial. A teleporter is a violet ring and core on a dark
  round plate with the same outline, the core lit when the hero stands on it; it never looks like a tower (round plate, no crenels). The
  minimap icon is 20 px; the map icon keeps at least 28 px when zoomed out and grows with the zoom (1.5 times the cell). The halo or the rim
  reads 3:1 on every terrain colour (unit test). Hero, troop and enemy dots have a dark outline.
- **Mountain (#1439).** The peak and the wall, which the core blocks (`Terrain::blocked`, the walkable set `WALKABLE` of `openworld.ts`
  is the rest), are pale (`COLOURS.mountain`, 3:1 over the walkable rock) on the map and the minimap, in every look; the rock is dark.
- **World edge (#1453).** A discovered cell off the world (`World.tile` has none: the bridge's off-world cell code, no second copy of
  `in_world`) is a deep void blue (`COLOURS.void`), not the dark of an undiscovered cell (`COLOURS.back`), 3:1 from it (unit test). The land
  cell beside it is drawn in a pale cyan line (`COLOURS.worldEdge`), 3:1 over the void and over `back`, so the hexagon's border shows
  wherever the hero's sight (section 9) has reached it. The map (section 9) draws it the same way.
- **Lairs.** A lair in the window is its tower icon. A lair out of the window gets an arrow on the map's edge pointing to it only
  for the 3 nearest unbeaten ones of the ring to beat (section 15); the others have none. A tower of a farther ring is drawn, on the minimap and
  the map, only once its cell is discovered (section 9).
- **Cost.** `openworldminimap.ts` draws from plain data (`drawMinimap`) and is redrawn by `mark`: when a world opens and on a step, a push, a
  broken obstacle or a camera turn, and by `frame` only while the drawn yaw changes, never at rest.

## 9. Map (#1411)

- **Discovery.** Every cell within 10 cells (hex distance, `SIGHT`) of the hero is discovered: when a world opens and after each step
  or push (`mark`), so the world shows little by little as the hero travels. `openworlddiscovered.ts` keeps one bit a cell, a bitset of
  16 x 16 bits per chunk, saved with the world as `discovered: [[cx, cy, bits], ...]`, `bits` the base64 of the chunk's 32 bytes (bit `i`
  is cell `i` of the chunk, row by row), 44 characters a chunk (section 5). A save from before has none: the cells round the hero are
  discovered when it opens. `body[data-openworld-discovered]` counts the cells discovered, for the browser checks.
- **Open and close.** The Map button (`#openworld-map-button`, under the minimap, out of `#chrome` so it stays over the map), the M key
  and the pad's View button open it; the same button, M, Escape and the pad's B close it, and the world stays open. While it is open the
  hero stays: the walk under way ends, the arrows held let go, and the arrows and camera keys do nothing.
- **Look.** `#openworld-map`, full screen over the world, its HUD and the minimap, drawn by the minimap's drawing (`drawMap` of
  `openworldminimap.ts`, a frame of any size, centre and scale) on a canvas of the window's size: the discovered cells in their terrain
  colour, the rest dark, the hero, the troop, the enemies near the hero on discovered cells, every boss lair (a landmark seen from
  afar: its tower icon, a beaten one grey, as on the minimap) and every discovered teleporter (a portal icon, section 10). It is turned with the camera, as the minimap. It opens on the hero, 8 px a cell.
- **Pan and zoom.** A drag pans it (the ground follows the pointer), the wheel and a pinch zoom it between 3 and 32 px a cell, the pad's
  left stick pans it and the triggers zoom it. The box takes the pointer and its canvas does not, so the touch stick leaves it alone.
- **Click.** A click on the map (a press that moves less than 6 px) hands the cell under it to `WorldMap.pick`: in the choice of a
  teleporter it picks one (section 10), else it does nothing.
- **Cost.** It is drawn when it opens, on a pan or a zoom, and on a `mark` while it is open, never on a frame; it reads the discovered
  cells of the disc that holds the screen's corners.

## 10. Teleporters (#1412)

- **Placement** is seeded world generation in Rust (`world::teleporters(seed, avoid)`, bridge `world_teleporters(seed)`, `q, r` pairs, the
  spawn's first): one teleporter in each square of 8 x 8 chunks (`TELEPORT_BLOCK`), the squares centred on the spawn's chunk (about 35
  in a world). The spawn's square has its own on `(2, -1)`, in the clearing. Any other square tries cells 2 or more inside its middle
  4 x 4 chunks (half its side), from a drawn one, 24 tries a chunk, and keeps the first whose cell and six neighbours are open ground,
  with no generated enemy within 2 cells and no lair within 3 (the bridge passes the lairs); a square with no fit try has none. Two
  teleporters are at least 64 cells apart. A quarter as many as before #1444 (squares of 4 x 4 chunks, a middle of 2 x 2, 32 cells
  apart): seed 7 holds 34 teleporters (36 before the archipelago's sea of #1442, which leaves some squares with no island that
  fits), against 137 in the same hexagon, and the public world 1305 holds 36 (37 before #1442), against 159; every biome holds some. It
  reads the terrain and the enemies, never changes them, so `WORLD_VERSION` does not move and the saves keep loading. In the hexagon
  (#1440) the squares run as far as their middle chunks reach it, and a try keeps its pad in the world.
- **Look.** A flat violet hex pad on the cell and a violet ring floating over it (`TELEPORTER_LOOK`), drawn for the teleporters of the
  loaded chunks (two instanced meshes, laid with the chunks); a portal icon on the minimap and the map.
- **Discovery.** A teleporter is discovered once its cell is (section 9: within 10 cells of the hero), so the network grows as the
  player explores. No save field of its own: the discovered cells hold it. `body[data-openworld-teleporters]` lists the discovered ones
  (`q,r` separated by spaces).
- **Teleport action.** Only while the hero stands on a teleporter: the Teleport button (`#openworld-teleport`, under the Map button,
  hidden otherwise), T and the pad's Y open the map in the choice of a teleporter, with the caption "Choose a teleporter"
  (`#openworld-map-note`); the same button, T, M, Escape and B close it. The discovered teleporter nearest the map's middle (the hero's
  own left out) is ringed in white: Enter or the pad's A picks it. A click (a tap) picks the discovered teleporter within 2 cells of the
  cell under it.
- **Arrival.** The hero moves onto the teleporter picked, and the troop onto the free cells within 3 of it (open ground, no enemy, no
  lair), the nearest first, at once: no glide and no push, so no fight on arrival, as at the spawn. A pick on no teleporter, the hero's
  own, one not discovered, one with an enemy on it, or with no room for the whole troop is refused, the reason in the caption, and
  nothing moves. The rules are `client/src/openworldteleport.ts`, which loads no engine, so the MCP server (`world_teleport`) runs the
  same code.

## 11. Day and night (#1496)

The Open world goes through day, dusk and night, and a lair is fought on a hexagonal board dressed for the hour it was entered at.

- **Cycle.** 12 minutes of play in the world (`client/src/daynight.ts`): day 6 min, dusk 1.5 min, night 3 min, dusk again 1.5 min (the dawn
  uses the dusk look). The time counts only while the world is open and a frame is drawn: not in a fight, not in the menu, and a frame
  that follows a stall counts a quarter second at most. It is saved with the world (`time`, section 5: an older save or a new world starts at
  the start of day), when the world is left too, so a fight and the way back to the world keep the hour. `body[data-openworld-phase]`
  reads the phase; `window.__openworldTime(ms)` sets the time (section 6).
- **World look.** The sun's colour, strength and place (the angle of its light and its shadow), the ambient light, the sky and the fog
  colour (they are one) and the tint of the water follow the time of day (`WORLD_LOOKS`: one look per phase). Over the last 30 s of a
  phase the look blends into the next one's, smoothly (a smoothstep, in 255 steps: the scene is drawn again only when a step changes it,
  so a blend costs no more than a frame that moves), ending on that look, so the change of phase is no jump. Night stays readable: the
  moon is a real key light, the ambient is not black, and the hero, the troop (an emission of their own colour), the lairs and the
  teleporters (an emissive that grows with the dark) shine of their own. The minimap and the map keep their colours: no darkening. The
  neon look (`?look=neon`) has a sky of its own and keeps it. No light is added and no object is made per frame: the view's own sun,
  hemisphere, fog and background are written in place (`Sky.set`, `OpenWorldView.setTime`).
- **Three boards.** A lair starts the normal boss fight (section 7), now on a board of one of three looks, fixed by the phase of the
  world when the hero stepped on the lair (`body[data-fight-board]` reads `day`, `dusk` or `night`; Retry keeps it, Back to the Open
  world and any other mode take it off). `BOARD_LOOKS` in `client/src/boardlook.ts` is data: the sun's colour, strength and place, the
  hemisphere, the colour beyond the board, the exposure, a tint for the lit board and one for the sky dome of the arena file, a tint
  for the cell tops, and the colour of the glowing cell edges. **Day**: bright warm ground, a high warm sun. **Dusk**: an orange sun
  low over the board (long shadows) and a violet hemisphere. **Night**: a dark blue ground, a pale moonlight key and a glowing cyan
  line round every cell (a hidden ring under each dish that only the night look shows). A fight outside the Open world keeps the
  terrace as it was (`TERRACE_LOOK`); the neon look is left alone.
- **Reduced motion.** The phases still change; there is no blend: the look switches where the phase changes.
- **Tests.** Unit: the phase from the time, the blend and its steps, the save, the sky of the view, the board looks, the terrace's look
  and the mark of the fight. E2E (`openworld-daynight.spec.ts`): a world at each phase set with the hook, a lair entered at each phase on
  its board.

**One look that turns with the hour (#1747).** The day takes the terrace look's best: the blue sky and air with no stars, the warm high
sun, a plain and even ground. Dusk turns the sky violet. The night takes the neon look's best: the near-black sky with its stars, the
circuit traces and the darker far ground, the light pools and the glowing rims. The 1v1 boards keep their fixed look (the fight reads the
same at any hour), the 2D Hub is unaffected. `?look=terrace` stays only as the one-visit way back of #1424, not a second mode.

## 12. Lore logs (#1589)

The Open world holds twelve logs of the story (`docs/specs/world.md` section 12), optional, never on the way to the ending.

- **Placement** is seeded world generation in Rust (`world::logs(seed, avoid)`, bridge `world_logs(seed)`, `q, r` pairs, log 0 first, 12 in all,
  `LOGS`). Log `k` is drawn in the sextant `k % 6` (the biome of section 2: meadow, forest, tundra, desert, badlands, archipelago), in ring `k / 6`:
  the near ring 30 to 140 ground units from the spawn, the far ring 160 to 420 (the lairs' 160 to 420). So each biome holds two, one near the spawn and one
  far, and the same seed gives the same cells on every peer. A draw is kept when its cell and its six neighbours are open ground of the sextant's biome
  (never water, a peak, a tree, a boulder or a wall), it is more than `SAFE` (8) cells from the spawn, it lies 2 cells or more inside its chunk with no
  generated enemy within 2 cells, and no lair or teleporter is within 3 cells (the bridge passes both as `avoid`). It reads the terrain and the enemies,
  never changes them, so `WORLD_VERSION` does not move and the saves keep loading. After 30 000 tries in its own ring and wedge a log is
  drawn anywhere in its whole sextant, 30 to 420 ground units out, and the search ends after 60 000 tries (#1595: seeds such as 2381, 3074, 3486,
  7825 and 205585469 had no fit for one log in its ring, 38 in 40 000 seeds sampled, and the world never opened); a log found in its ring does
  not move. A log with no fit at all is left out: the bridge's `world_logs` still gives 12 pairs, so every log keeps its number, and a log left
  out is the pair `i32::MIN, i32::MIN`, a cell no hero reaches that no chunk holds (no stake, no icon, never found). None was left out in the
  40 000 seeds sampled.
- **Text.** `client/src/lorelogs.ts` holds the twelve entries by log number (`WORLD_LOGS`): a title, a body of 320 characters at most, a `stage` of the reveal
  ladder (1 to 3) and a `reread` flag (three of them carry the hint of a reread). Tally's register, short, original. No log holds a secret word of a later
  stage (`lorelogs.test.ts`).
- **Look.** A log is a stake on its cell: tall and amber, glowing at night, while unread; short and grey, with no glow, once found (the shape changes, not
  only the colour). A diamond icon on the minimap and the map for the logs on discovered cells, a filled amber slab unread and an outline of it in the grey of a
  beaten tower once found (`logIcon`, never a tower or a portal). The amber and the grey read 3:1 over the icon's plate (unit test).
- **Read.** Rolling onto a log (a step of the hero, never a teleport) opens a short panel (`#openworld-log`: the title and the text) in the top left, under the cog
  and beside the minimap, over the world and nothing else: it ignores the pointer. It never blocks a move: the next move closes it. The log is marked found in the
  world's save (`logs`, section 5), and filed in the log archive (`ab-alone.lore-read`, world.md section 4), whose Logs page reopens it in the terminal reader at any
  time, in or out of the world. Rolling onto a log found reads it again. `body[data-openworld-logs]` lists the logs on discovered cells (`q,r` separated by
  spaces), `data-openworld-logs-found` the numbers found and `data-openworld-log` the id of the log the panel shows.
- **MCP.** The server does not expose the logs: its `save_world` carries the numbers found as the client wrote them (`mcp.md`).
- **Tests.** Rust: 12 cells per seed from the seed alone, each on open ground of its biome with its neighbours, off the spawn, the lairs, the teleporters and the
  enemies, two per sextant. Client: the save of `logs` and its migration, the stakes and their glow, the icon, the panel, the archive. E2E
  (`openworld-lore.spec.ts`): a log read by a roll, closed by the next move, found after a reload and in the archive.

## 13. The world as the map of the whole game (#1514, Decision #1513)

Decision #1513 (both owners agreed, 2026-11-05): the Open world is the map of the whole game, and every mode is a place in it or a
gate to it. This supersedes the "secondary mode" of section 1. Same rules in every place (Abalone first, no HP, no levels, no stats,
#313); only the place changes. This section is the one-page plan; the rows say what is built and what is planned, so nobody reads a
plan as the game.

| Mode today | Place in the world | Enter | Leave | State |
|---|---|---|---|---|
| Open world (walk, troop, fights) | The whole hexagon, spawn `(0, 0)` | the Airlock bay of the ship (#1697), `#openworld` link | The exit of the dock, Hub (Esc presses it, #1605) | Built |
| Hub, bot, hot-seat, Medal room, terminals, Daily | **Spawn town**: the clearing of radius 3 round `(0, 0)`, the crash site | Walk into the clearing (the hero starts in it) | Walk out of it | Place, map icon and entrance built (#1593): rolling onto the town opens the Hub scene, the front door. Moving its stations into the town is planned |
| Training yard (Trainer, Stalker), a bot table, a hot-seat table, a notice board | **The four other towns**, one per biome but the meadow and the archipelago (forest, tundra, desert, badlands), 40 to 120 ground units out | Walk in | Walk out | Place, map icon and entrance built (#1593): every town opens the same Hub for now. Their own stations are planned, five towns sharing out the Hub's stations, one per deck |
| Online, Ranked, Leaderboard, Royale, co-op, boss duel | **Arena town**: one of the four other towns, chosen when it is built. An invite link `#room=` still opens the table at once | Walk in | Walk out | Planned (the town exists on the map, the table does not) |
| The 15 bosses | **Towers**: the boss lairs of section 7, 160 to 420 ground units out, the easiest boss nearest (section 15) | Roll onto the lair from a neighbour | Win or lose, "Back to the Open world": the hero returns to the entrance cell | Built (section 7). The five story bosses as the gates of the five decks is planned |
| Rogue-lite run | **Dungeon gates**: one in each biome but the meadow (forest, tundra, desert, badlands, archipelago), 160 to 420 ground units out, each with a dungeon tier from its ring (section 15). An act is one dungeon, in matching terrain | Roll onto the gate from a neighbour | Leave the run: the hero returns to the entrance cell | Gate, map icon and entrance built (#1593): rolling onto a gate starts the run, in the biome of the gate's ground (#1597) |
| Teleporters | Pads in the clearing and in the open ground, one a square of 8 x 8 chunks (section 10) | Roll onto a pad, Teleport button | Pick another pad | Built. Pads inside towns and gate clearings are planned |
| Console | Leaves the player's UI | n/a | n/a | Planned |
| Boss fight menu | Fast travel to the towers already found | Menu entry | n/a | Planned; unchanged by the Cutaway, where a tower opens the ship on its boss bay (#1698) |
| Quick game (bot, hot-seat, online) | Gone (#1697): the House table of the ship is a bot game, two taps from the world (the exit, then the bay) | | | Removed |

- **Rule for every place**: it is entered by walking or rolling onto it, and every exit returns the hero to the entrance cell, as a
  lair does (section 7). No place moves the hero anywhere else.
- **Placement is seeded world generation in Rust** (`world::places(seed, avoid)`, bridge `world_places(seed)`, `kind, q, r` triples,
  `kind` 0 a town and 1 a dungeon gate). The towns come first and the spawn clearing, `(0, 0)`, is the first town. The other four towns
  are drawn in the sextants 1 to 4 (the biomes of section 2, from the forest), 40 to 120 ground units out, inside the nearest tower's 150
  cells. The far edge of that ring grows by 1 ground unit every 2 tries, up to 420 (the towers' `LAIR_FAR`): on seeds 862, 1178, 1279, 1339,
  1413, 1540 and 1616 a sextant holds too little open ground of its biome within 120 units (a pad of 7 cells with no tree, boulder or peak), and the town stands further out. The five dungeon gates are drawn in the sextants 1 to 5, 160 to 420 ground units out, as the towers.
  A draw is kept when its cell and its six neighbours are open ground of the sextant's biome, it is more than `SAFE` (8) cells from the
  spawn, 2 cells or more inside its chunk with no generated enemy within 2 cells, and it is more than 3 cells from every lair,
  teleporter, log and place placed before it, so no two places overlap and none sits on blocked ground (a tower is a lair: they do not
  move). The search ends: a place has `PLACE_TRIES` (1000) tries, four times what the most demanding of the seeds 1 to 2000 needs (239),
  and a place with no fit in them is left out, so the world holds fewer than ten (the spawn town always stays). The biome of the sextant
  stays required: every sextant of the seeds 1 to 2000 holds open ground of its biome. The bridge passes the lairs, the teleporters and the logs, in that order, so none of them moves. It reads the terrain and the
  enemies, never changes them, and needs no record in the save: the places are a function of the seed, so `WORLD_VERSION` does not move
  and the saves keep loading.
- **Map.** A town is a cyan spire on a hexagonal plate, a dungeon gate a round sodium arch on a triangular plate, a tower the crenellated
  tower of section 8 on a square plate, a teleporter a round plate and a log a diamond: five shapes (`townIcon`, `dungeonIcon` of
  `openworldlairicon.ts`). Like the towers they are landmarks seen from afar: the map draws every one where it is, the minimap the ones in
  its window, 20 px, no arrow. The violet, amber, green and orange of the icons read 3:1 over the plate (unit test).
- **Browser checks.** `body[data-openworld-places]` lists the places (`town:q,r` or `dungeon:q,r`, separated by spaces);
  `window.__openworldPlaces(seed)` gives the bridge's triples.
- **Tests.** Rust: the places of the seeds 1 to 2000 all hold the 5 towns and the 5 gates (a bounded sweep: it fails rather than hangs, and
  holds in a quarter of the tries), the places of 24 seeds hold them, the spawn town first, no two places within 3 cells, none on a
  lair, teleporter or log, each with open ground and no enemy round it, each in its biome; seed 7 is pinned. Client: the icons' shapes
  and contrast, the minimap and the map drawing them, the mode reading and publishing them.
- **Enter** (#1593). Rolling onto a town or a gate from a neighbour is the lair's path of section 7 (`roll`, `enterPlace` of
  `openworldmode.ts`): the world is saved with the hero on the entrance, the cell it came from, and left, and the page starts the place. A
  town opens the Hub scene, the Hub of the mode menu (every town the same one for now, the stations are the Hub's), a gate starts a new
  rogue-lite run at its start screen, as Rogue-lite run of the mode menu does. A gate's run begins in the biome of the ground
  the gate stands in (#1597): `enterPlace` reads the biome of the gate's cell and hands it to the page, which starts the run with it as `first`
  (roguelite.md section 18). The
  spawn clearing's town on `(0, 0)` is the cell the hero starts on, so it opens only when the hero rolls back onto it. A walk to a far
  cell, the Dungeon button and the troop's arrival on a teleporter go round the places as they go round the lairs, and a held arrow into
  a place enters it. The MCP server (`mcp/src/world.ts`) does not know the places: an agent steps over their cells as over ground.
- **Ledger line** (#1516). Entering a town puts Tally's line for it on the plate of the Hub (`TOWN_LINES` of `tally.ts`, keyed by the town's index among the
  towns: the spawn town 0, then the forest, tundra, desert and badlands towns; `onPlace` of `OpenWorldMode` gives the index), until the first move, and only from the
  stage the line declares: a new player meets none (world.md section 13). A seed with a town left out shifts the later towns' lines by one (none in the seeds 1 to 2000).
- **Workshop** (#1655). The Hub that a town opens has a Workshop button and sheet (section 19.2); the Hub of the mode menu does not.
- **Exit.** The exit `#exit`, the first slot of the dock, labelled World (#1517, ui.md section 4.10; it was `#place-back`), is shown while the Hub or the run is on and came from a place
  (`placeFrom` of `main.ts`): it leaves the Hub or the run (a run left is abandoned, as by another mode) and opens the world at the entrance,
  as the exit of a lair does. A table or a boss of that Hub leads to the Hub, which keeps it. Any other mode, and the
  Open world of the menu, end it. The Hub or the run reached from the menu leads to the Hub, not to a world. A reload keeps no `placeFrom`, as a reload
  in a lair's fight keeps no `lairFrom`: the Open world of the menu opens the world saved on the entrance.
- **Marker.** A flat pad on the cell, the teleporter's pad recoloured to the map icons' colours, cyan on a town and sodium on a gate (#1518)
  (`town-pad`, `gate-pad`, `OpenWorldView.setPlaces`), lit at night as the teleporters are. No plate label: lairs have none. Real models are #1518.
- **Transition** (#1519). Entering a town or a gate, like a tower (section 7), plays the transition of motion.md story 10 over the Hub or the run that starts at once, and "Back to the Open world" plays the matching one over the world.
- **Cairns** (#1533). No open cell lies more than `LANDMARK_REACH` (16) cells from a landmark: a tower, a teleporter, a log, a place or a
  cairn. `cairns` of edgefall-core puts one near the middle of each chunk (at random within 3 cells of it, on open ground, no enemy, no
  landmark within 3), none where a landmark lies within 8 of the middle, and a second one on a chunk cell farther than 16 from the first.
  Largest landmark-free radius before / after: seed 7 118 / 16, seed 11 120 / 15, seed 23 200 / 14 (about 2 400 cairns a world). A look
  only (`world_cairns`, `OpenWorldView.setCairns`): three slate stones under a glowing sodium cap, walked over like a pad; the world's cells
  and `WORLD_VERSION` do not change. Boulders, pines and gantry walls are scatter, not landmarks.
- **Not now**: moving the Hub's stations, 3D models of the places (#1518), the door grammar (#1517).

## 14. The goal on arrival (#1530)

The panel (`#openworld-hud`) opens on what to do, not on the keys.

- **Goal.** `#openworld-goal`: "Goal: beat the 15 towers of Hollow. One medal each." (a tower is a lair for the player). `#openworld-bearing` under
  it: "Nearest tower: 208 cells, to the upper left." The nearest tower of the ring to beat (section 15), by hex distance, and the way on the screen in eight words
  (`WAYS` of `openworldgoal.ts`), from the same turn of the ground as the minimap's arrows (`screenOffset`), so it follows the camera. Both are
  written when the minimap is drawn (a step, a tower beaten, a camera turn) and only when they change. Once every tower is beaten the goal reads "Goal done: all 15 towers are beaten." and the
  bearing says what is left: the lore logs not found, else "Left: the dungeon gates." A world with no tower shows neither. Tally's flat register, no
  word of a later stage (checked against `SECRETS`).
- **Medals.** `Medals n / 15` stays (`#openworld-medals`), the one wording of progress on every screen: the Hub's count (`#hub-pips`) says it too (#1527).
- **Controls.** The keys, taps and pad buttons are behind `#openworld-controls`, a `<details>` closed on arrival, with the steering line
  (`#openworld-mode`) inside. A tap on its summary (44 px) or H opens and closes it; H on a folded plate shows the plate with the controls open. Nothing else
  opens or closes it: a player who opened it and closed it finds it closed in the next world.
- **The one lesson of the roll (#1604).** While the lesson is due (`ab-alone.hubcoach` is not `done`, and the page has storage and is not an automated
  browser, or it is `?firstrun`), the first entry opens the controls and shows its first line, `#openworld-lesson`: "Tap or click a next cell to roll.
  The arrow keys or the stick do the same." (`WALK_LESSON`, the Hub's coach line too). The first roll ends it: the line goes, the key is saved, and
  the controls stay closed in every world after. Hub and Open world share that one key; a player who rolled in the Hub never sees it here.
- **Nearest tower.** The button `#openworld-dungeon` (its id is kept) walks to the nearest tower of the ring to beat (#1291, #1532). It was "Dungeon", which
  now names the gates of section 13.
- **Claim.** The first-visit line stays, once per player, with its stage rule (`Claim: unworked.` before stage 5, "Claim 0412: unworked." from it), and
  is followed by "A claim is a case on Tally's ledger. Unworked means no tower is beaten."
- **Phone.** On a window 500 px high or under the panel is a column of 17 rem at the left, so the hero in the middle is clear of it, and its own
  height is bounded (`max-height`, it scrolls) so the open controls never leave the top of the screen. On a phone held upright (portrait, 600 px
  wide at most, `foldsAtEntry`, #1657) the folded panel is a bar, the goal, the bearing and the medals, 104 px high from 360x640 to 430x932 (a fifth
  of the window at most), and the world starts with it; taps go through it, and its chip (`#openworld-chip`, 48 px high), which says More there (the
  one way to the buttons), opens the whole panel until the next 3 steps. Opened there, its two buttons stand on one row and the claim goes under them
  (text only: every control keeps its HTML order, so Tab follows the screen), and on a short window the panel may rise towards the Map button
  (17.25rem at most): at 360x640 it shows whole, the buttons' bottom at 492 px. The first-run lesson of the roll still enters with the whole panel.

## 15. Rings: the nearest tower is the easiest (#1532)

The world leads the player outward. The cells of the towers do not move (`world::lairs`, section 7); what changes is which boss stands on which
cell, and what the map shows.

- **Who stands where.** `world::towers(seed)` sorts the 15 lair cells by hex distance from the spawn (a tie goes to the lower draw) and gives them
  to the bosses in `TOWER_ORDER`, the easiest first: the boss `TOWER_ORDER[i]` stands on the `i`-th nearest cell. A pure function of the seed. The
  bridge's `world_lairs` gives this list, so lair `k` of the client, the save, the map's letters and colours, `onLair`, the MCP's `lairs` and the
  fight a roll starts are all still boss `k` of the roster: nothing was renumbered. Only the cell of a boss moved (a boss's biome is no longer
  the sextant `k % 6`; the set of cells, and so the biomes of the towers, is the same).
- **Saves.** `lairs` of the save is the list of the numbers beaten, boss numbers, so every record from 1 to 6 loads and means the same bosses: a
  medal belongs to a boss. No record, no migration, `WORLD_VERSION` unchanged. A world saved before stands the hero on its saved cell, and the
  boss that stood there then may be another one now.
- **Rings.** A ring is three towers: the nearest three are ring 1, the next three ring 2, up to ring 5. The ring of a boss is its place in
  `TOWER_ORDER` over 3 (`world::tower_ring`), so it is the same on every seed, and the distance follows from the sort. Over the seeds 1 to 300 the
  distance of the towers from the spawn, in cells:

| Ring (dungeon tier) | Towers (nearest first) | Distance of its towers, median by place (min to max) | Bosses and their measured wins /20 at 10x |
|---|---|---|---|
| 1 | 1 to 3 | 187, 204, 222 (160 to 306) | The Echo 16 (judgement), The Alien 20, The Pulsar 18 |
| 2 | 4 to 6 | 240, 259, 279 (188 to 372) | The Assembly Line 18, The Dual Room 18, The Stalker 9 of 10 (judgement) |
| 3 | 7 to 9 | 293, 314, 331 (199 to 414) | The Chaplain 17, The Overseer 17, The Unstable Core 17 |
| 4 | 10 to 12 | 348, 363, 384 (255 to 435) | The Swarm 17, The Rail Yard 16, The Ballast Mind 15 |
| 5 | 13 to 15 | 401, 416, 434 (319 to 447) | The Magnetizer 15, The Hull 12, The Choir 8 |

- **Tiers.** The boss tier is the ring. The order is the measured ladder of boss-balance.md: the pro-level player (10 times the boss budget) wins
  more often against an easier boss, so the order is the wins of the latest row of each boss, most first, a tie by roster order: The Alien 20
  (`alien_sim`, outside the gate by decision #667), The Pulsar 18 (#1231), The Assembly Line 18 (#1228), The Dual Room 18 (#992), The Chaplain 17
  (#1112), The Overseer 17 (#1241), The Unstable Core 17 (#915), The Swarm 17 (#1266), The Rail Yard 16 (#1232), The Ballast Mind 15 (#1209),
  The Magnetizer 15 (#1237), The Hull 12 (#823), The Choir 8 (#825). Two bosses are a judgement, not a measure: **The Echo** is the first boss of the
  path (`nextGoal`, the Hub's lifts) and 16 of 20 puts it among the middle ones, so it is the nearest tower by decision (#1532); **The Stalker** was
  measured with a fogged pro player on 10 seeds (#1120, 9 of 10), counted as 18 of 20. The Hub's order of lifts and the menu lock do not change. No boss changes.
- **Gates.** A dungeon gate has the ring of the tower it passes: the number of towers nearer to the spawn than it, over 3, plus 1, up to 5
  (`world::gate_ring`). That is its dungeon tier, the number the table gives its place. Nothing else changes for a gate: its run is the normal run.
  The ring is published on the page (`body[data-openworld-gate-rings]`, the gates in order, and `data-openworld-rings`, the ring of each tower by number); the bridge's
  `world_rings(seed)` gives the 15 towers' rings then one per place of `world_places` (`0` for a town).
- **The ring to beat.** The nearest ring that holds a tower not beaten. The towers of it are guided: the minimap's arrows, the bearing line and the Nearest
  tower button (section 14) point at them only, the nearest to the hero first. A tower of a farther ring shows again, as an icon on the map and the
  minimap, only once its cell is discovered (section 9): a world not walked has a map that holds the tower to find, not the whole roster. Every
  tower stays enterable: a hero who walks to a far tower fights its boss. The Nearest tower button sends the towers of a farther ring to the bridge as
  beaten, which it tries last: with a tower of the ring to beat it can reach, it goes there. Beaten towers are always drawn. Once a ring is beaten, the
  next one is the ring to beat.
- **Tests.** Rust: on the seeds 1 to 2000 and 24 random 32-bit seeds the towers stand on the lairs' cells, the distance never falls along
  `TOWER_ORDER`, and The Echo is the nearest tower; the order is the roster once; the rings and the gate rule. The bridge: the order names the
  bosses by id, the lairs are the towers, the rings. Client: the map, the minimap, the bearing, the button and an older save.

## 16. Things to find, risk and earn (#1531)

The world has a reason to leave the spawn besides the 15 towers: places to find, a gain for the pushes the troop already plays, and a thing a tower gives
only to a hero who came by walking. All three are about marbles on the board and places on the map: no currency, no HP, no stats, no item, so section 1's
"Not now" (#313) stays true. A recruit is one more marble of the troop, which the rules of the troop already know; a pad is one more teleporter of
section 10.

- **Points of interest.** The non-boss points of interest are the 12 lore logs (section 12) and the 5 dungeon gates (section 13), 17 in a world of
  603 457 cells, one for 35 500 cells (the 15 towers are one for 40 200). Each biome holds two or three: the logs are two a biome (one in the near ring,
  30 to 140 ground units out, one in the far ring), and the gates one in each biome but the meadow, so the meadow holds 2 and every other biome 3. Every biome
  has one within 165 cells of the spawn, about as near as the nearest tower (at 160 cells or more, section 15). No new kind of place (no
  cache, no camp). The density is a function of the seed alone and is tested over the seeds 1 to 300 (`world::tests`, the count, the biome and the
  distance).
- **Pads.** A tower the hero beats by walking onto it in the Open world (section 7) leaves a teleporter pad on an open cell next to it. The pad joins
  the network of section 10: it is drawn and discovered as any pad, the Teleport button and the map pick it, and the teleport arrives and refuses as for
  any pad. It is found by `world::tower_pad(seed, tower)`, a pure function of the seed and the tower: the first of the tower's six neighbours, in the order
  of `STEPS` (E, W, NE, SW, NW, SE), that is open ground and holds no generated enemy. The six neighbours of a tower are open ground of its biome by
  construction (`lair_try`), so the search ends in at most six looks; the bridge's `world_pads(seed)` gives the 15 pads in the order of `world_lairs`, and a
  test sweeps the seeds 1 to 2000 (the pad is next to its tower, on open ground, off every enemy's start, never on a tower, never the same as another pad).
  The pads and the places of sections 10 and 13 keep 3 cells off every lair, so a pad never shares a cell with a teleporter, a log or a place.
  Which pads exist is the list of the towers beaten in the world's save (`lairs`, section 5): a boss beaten from the Modes menu or the Hub is a medal and
  adds nothing to that list, so it leaves no pad. No save field is added: `lairs` already holds only the lairs beaten through the world. A pad shows once its
  tower is beaten, wherever the save is read.

- **Recruits.** A marble a push of the troop sends into the water or off the edge of the world joins the troop as a recruit. The rules allow one marble
  to fall per push (a line push ejects the last enemy of the run it pushes, a shove one foe, sections 3, 4 and 4b), so a group of three that is pushed
  out marble by marble brings up to three recruits, one for each marble that falls, and a group that is not pushed out brings none. Only a push of the
  troop counts: a marble beaten in a wild fight (section 3c), a marble another hero ejected and a marble that walked into the water does not. The cap is
  `RECRUIT_MAX` = **5** in `client/src/openworldrecruit.ts`, a third of the troop of 15: past it a marble still falls and counts as beaten, and nothing joins.
  The recruit appears on the free cell nearest the hero within 3 cells (open ground, no enemy, no lair or place, not the hero's nor the troop's cell;
  the order of `arrival` in `openworldteleport.ts`), at once and at rest, drawn with the push (`OpenWorldView.join`). When no cell within 3 is free,
  as on a boat far out, none joins and the cap is not spent. From then on it is a troop marble in every rule: it is the last of the troop (the
  followers flock, section 4b, the hero's line of two or three marbles counts it, the herd and the shove use it, a teleport brings it along), and the troop is 15 plus
  its recruits. The wire of section 4 of `multiplayer.md` still carries 15 offsets, so the other heroes see the first 15 marbles and not the
  newest recruits. The plate shows a line `#openworld-recruits` under the medals, hidden while there are none: "A marble joins the troop. Recruits 2 / 5"
  when one has just joined, "Recruits 2 / 5" when the world opens. `body[data-openworld-recruits]` holds the count. The count is saved
  with the world as `recruits` (record 7, section 5), and it is `recruits` that the troop of a record is checked against: the troop holds 15 plus them.
  The rule is shared with the MCP server (`recruitCell`), whose `world_step` says the cell in `push.recruit` and whose `world_state` and
  `save_world` carry `recruits` (`mcp.md` section 5).
- **How it fits "Not now".** Section 1 keeps HP, damage, levels, items and economy out until a Decision (#313). A recruit is a marble of the troop,
  which already pushes, flocks and is pushed under the rules of `rules.md`; it has no hit points, no level and no stat, and it is not spent or
  traded. The pad is a teleporter of section 10, a place on the map. The points of interest are the logs and the gates already specified. Nothing
  here is a currency, and no push is stronger for it than a troop of 15 plus its recruits can make it by being longer in line. The economy that Decision #1654 adds (four resources and the Workshop, section 19) is separate from these gains, and acts only in the fights the Open world starts.
- **Tests.** Rust: the pads and the density, above. Client: the recruit's cell and cap (`openworldrecruit.test.ts`), the mode (a recruit for an
  ejection, none past the cap or with no free cell, the plate line, the save and its reload, `openworldmoderecruit.test.ts`), the record 7 and the
  older records (`openworldsave.test.ts`), the pad in the network (`openworldmodepads.test.ts`). MCP: the recruit and the pad, the schema of the save.
  E2E (`openworld-gains.spec.ts`): a recruit joins on a shove and a pad stands by a beaten tower, on a desktop and a phone, each under 15 s.

## 17. Budget: the world as the first screen (#1520, Decision #1513)

The world is where a new player lands, so its load, its memory and the switch to a fight are budgeted like the frame of `tech.md` section 5.5 (under 150 draw
calls). One fixed script measures them: `bun run e2e:budget` (`client/e2e/world-budget.spec.ts`, tag `@budget`). It is a report by hand, not a gate: five fresh pages on `?openworld=3` (a marble stands within sight of the spawn), each loads the world, waits 1.5 s, reads `window.__renderCost`
(`renderer.info` of one frame), collects the garbage with the DevTools collector (`HeapProfiler.collectGarbage`, twice, no `--expose-gc`) and reads the JS heap, puts the hero
beside the marble (a wild fight, section 3c), waits for the arena, Flees, collects and reads the heap, and does it a second time. The longest task is the longest `longtask`
entry of the page. The last test prints the median and the range of the five runs. Run on a loaded machine the long tasks grow by a quarter or more: the numbers below
are of a quiet moment (load average 4 on 10 cores), Chromium on the GPU of an Apple M4 at 1280x720, local build of the e2e mode.

| Measure | Median (range of 5) | Budget |
|---|---|---|
| Triangles in one frame | 712 511 (712 491 to 712 511) | 750 000 |
| Draw calls in one frame | 44 at the budget view, 45 at its widest zoom (52 and 53 before #1647) | 45 |
| Triangles of the scene, budget view (unit test, regression cap) | 353 010 | 370 000 |
| Triangles of the scene, widest zoom (unit test, regression cap) | 3 254 456 | 3 400 000 |
| Draw calls of the scene, either view (unit test, regression cap) | 19 (23 before #1647) | 25 |
| JS heap after load, collected | 16.3 MB (16.2 to 16.3) | 20 MB |
| Longest task, load to the first world frame and 1.5 s after | 309 ms (305 to 353) | 500 ms |
| Longest task, touch of a marble to its arena and 1.5 s after | 84 ms (83 to 98) | 200 ms |
| Same, a second fight of the page | 0 ms (0 to 0) | 200 ms |
| JS heap after the first fight, back in the world, collected, against before it | +9.8 MB (+9.7 to +9.9) | +12 MB |
| Growth of that heap for each further round trip (fight and Flee) | +0.8 MB (+0.8 to +0.9) | 1 MB |

- **Scene geometry, a regression gate (#1481).** The frame's 750 000 triangles and 45 draw calls stay the budget. Beside them, regression caps (about
  5 % over the scene of 2026-11-08) hold the scene geometry, the part a unit test can build: each visible mesh in the camera's frustum counts once,
  its triangles times its instances, at 1280x720 on the high tier, seed 3, at the spawn (the closest zoom) and at the widest zoom of that window. `openworldbudget.test.ts`
  builds it in node with the real chunks, places and models and fails over a cap, so every push checks it. The renderer's frame draws the shadow casters a second time and
  adds its full-screen passes: 708 579 triangles and 44 calls at the budget view, read by hand on `window.__renderCost`. The unit test checks the frame's 45 as
  the scene's calls, its shadow casters and the 11 calls of the rest of the frame (the sky and the full-screen passes, read on the hook). A landmark's
  parts are one mesh, so one call and one shadow call (#1647): a teleporter's pad and ring, a town's pad and spire, a gate's pad and arch share their colour;
  a hut and its windows, a cairn's stones and its cap carry their colours, roughness and glow on their vertices. The frame went from 52 to 44 calls at the
  budget view and from 53 to 45 at its widest zoom (seed 7: 52 to 44, 51 to 43), the triangles unchanged, GPU time 4.4 ms either way.
- **What the first fight adds.** A page that opens in the world has not asked for the files of the board, so the first fight loads them: the bay of the room and the
  terrace, 622 KB over 9 files. That is 5.6 MB of the +9.8 MB (the heap after load fell from 21.9 to 16.3 MB): the heap after the first fight, 26.0 MB, is the heap the board always had after a fight; it moved from the load
  (21.9 MB before this section) to the first fight. The rest of the margin is the arena's own state (its marbles, materials and shader programs).
- **No ship file at the entry.** `?openworld=<seed>` (and a reload during a wild fight, section 3c, which comes back to the world) fetches none of `spaceship-bay.glb`, `arena.glb`,
  `kit-*.glb` and `slab-*.glb`: it asks for the world's models (`openworld*.glb`) only, and the Loading plate (`#loading`) leaves with the first world frame instead of with the
  bay. `loadBoard()` of `main.ts` asks for the nine files once: at the load of any other page, as the wipe of a wild fight closes (`openWorld.onWild`, half a second before the arena opens),
  and as the board is shown next by any other way (a lair, a town, a gate, the Modes menu: `leaveMode`; Escape in the world: the exit of the dock, which leaves it for the Hub), through `needBoard()`. When a page leaves the world before the terrace is in, the canvas stays veiled (`body[data-veil]`) until the terrace is drawn: the room never shows, and a blank board never does. A fight looks as before (checked at 960x540: the same arena, 61 dishes, the same frame), and so does the world: a world frame of a page that opened in it is pixel for pixel the one
  it was (default look and neon, reduced motion, time of day 1000 ms). The renderer's tone mapping (AgX, none in the neon look) and its exposure used to reach the world from the terrace, which was in first; a page that
  opens in the world sets them itself (`SceneRenderer.setWorldTone`) until the terrace does (the 32:9 edge check of `openworld.spec.ts` read the difference on the software renderer).
  The Mess deck's maps (`deck-mess*.ktx2`, `deck-albedo`, `deck-roughness`, `crack-decal`, 90 KB) are still fetched at the load: the board's materials are made with them at the top
  of the page, a change of its own.
- **A chunk of its own (#1578, tech.md section 9.0).** The world's code is a chunk of the build loaded at the first entry; `?openworld=` loads it at the boot, behind the Loading plate. The longest task of the load did not move (309 ms median, 304 to 374 over 5 runs, the same setup as the table above).
- **World to fight.** No long task over 200 ms: the longest, with the files loaded on the way, is 84 ms, the same as with them loaded in advance (89 ms), so no shader pre-warming
  was needed. The 309 ms of the entry is the page's own first draw (the wasm of the engine, the world's first chunks, the shaders) and is a budget, not a target of this section.
- **Leaks found and fixed.** A round trip from the world to a fight and back used to leave 4 GPU textures (the sun's shadow map and the nodes of the lights of each world entered,
  `OpenWorldView.dispose` now disposes its lights) and 12 render objects (the notches and tally marks the board redraws: each mesh taken out of the scene kept its render object, and the
  scene through it, until `clearDrawn` of `scene.ts` disposes it). The heap grew by 1.5 MB for each round trip before, 0.8 MB now.
- **Leak left.** The 0.8 MB left for each round trip is held by the renderer's own full-screen pass (its `RenderObject`s keep the node builder, and through it the scene of the world left); it
  is three.js's, not a mesh of the game, and its fix needs a look of its own: it is a follow-up of this section.
- **Tests.** Client: the files fetched at the load, by a world page, a wild fight's reload, the wipe and the ship (`main.boardload.test.ts`), the lights and the marks freed
  (`openworldview.test.ts`, `scene.test.ts`, `main.board.test.ts`). E2E: the network log of `?openworld=7`, of a wild fight and of a page that does not open in the world
  (`openworld-assets.spec.ts`); the budget by hand (`world-budget.spec.ts`).

## 18. The loop: town, dungeon, tower (#1515, Decision #1513)

One loop through the world, each place doing one job. Same rules everywhere (#313): no HP, no levels, no stats, no currency. Only variety carries between runs and never power (Decision #934). The resources and the Workshop of section 19 (Decision #1654) act only in the fights the Open world starts, never in a run.

- **Town (the loadout).** A town is where the hero prepares and recovers. Rolling onto a town opens its loadout panel (the Hub today, section 13; the panel is the first build slice).
  1. **Loadout**: the trait slot of section 18.1, and the special marbles and tactics the player brings to the next run (roguelite.md sections 5 and 11).
  2. **Troop restore**: the troop is set back to 15 plus its recruits (section 16, `RECRUIT_MAX` 5) at no cost, only in a town. A marble missing from the troop of the save comes back there.
  3. **Posted contract**: one line naming the nearest tower or gate of the ring to beat (section 15): its kind, its boss or act, its ring (danger 1 to 5) and its distance in cells, e.g. "Contract: The Echo, ring 1, 187 cells, to the upper left."
- **Dungeon (variety).** A gate's run pays variety only: the blueprints it banks (roguelite.md section 15), the cells that turn into special marbles, the relics and the tactics it unlocks. Never a stronger army (#934). The town's loadout lists what the last run banked, so a dungeon shows its change on the loadout screen.
- **Tower (one trait).** A tower's medal (#791) gives one **trait**, unlocked for good: one rule taken from that boss's own mechanic (section 18.1). It is never a number. It opens the next ring's towers and gates as the ring to beat (section 15), and the next town's contract names them.
- **Danger grows with distance.** The ring of a place is its danger: ring 1 (nearest, 160 to 306 cells) to ring 5 (319 to 447). Enemies, the boss tier and the dungeon tier follow the ring (section 15). A player who walks outward meets a higher number and a new trait option, never a flatter fight.

### 18.1 The medal trait

The trait is what the medal's tower teaches the player's side of the board. A town's loadout offers the traits unlocked, and the player brings **at most one per fight**, or none. Each trait has its cost stated on its loadout line, the boss's own cost, so every bring is a trade.

**Options for the first medal trait (The Echo, ring 1):**

| Option | What it is | Verdict |
|---|---|---|
| A. A flat bonus: one extra marble, or one extra push a turn | A number on every fight | Rejected: it is power (#934) and a stat (#313), and the player picks nothing |
| B. The boss's rule always on for the player's side (the Echo's mirror on every fight) | A forced rule, no choice | Rejected: the player cannot refuse it, so the loadout has nothing to choose |
| C. An optional trait per fight, with the boss's own cost on its line (the mirror copies your moves onto the foe's side, and the turn it costs is stated) | Bring it or leave it; one trait a fight | **Chosen**: each fight the player decides between the trait's reach and its cost, and the same boss gives a different plan on each fight |

**Why C:** it changes the player's choice on every fight (bring the mirror or not, against this foe or that one), it adds no number and no power, and it is variety in the sense of #934.

**Rules of the slot.** One trait slot, one trait a fight, chosen in the town's loadout before a tower, a gate or a wild fight starts; a fight started from the Modes menu or the Hub uses the same slot. A tower's medal always unlocks its own trait. Traits are unlocked only by medals, never bought. The first trait is The Echo's mirror (the first tower, section 15). The other 14 medals each unlock one trait, one per boss, in the build slices after the first.

**Metrics** (measured on the build, not before):
- Share of fights started with a trait in the slot: target 30 % to 60 % by the 5th tower. Under 10 %: the trait is not worth its cost. Over 80 %: it is a free bonus and its cost is too small.
- Pick spread: no trait above 40 % of the brings of its ring.
- Town visits before a tower or a gate: target 50 % or more of the walks into one, so the loadout is used.
- Median time from the spawn to the first medal: target under 10 min (not measured yet).

**Tests (when built):** Rust for the trait's rule (one trait a fight, the boss's cost applied). Client: the slot, the unlock by medal, the loadout line, the save of the slot. E2E: a fresh profile reaches the first town and reads its contract, each under 15 s.

**Not now:** a trait bought, traded or crafted; a second trait slot; the 3D town (#1518); the story bosses' gates (section 13).

## 19. Resources and the Workshop (#1655, Decision #1654)

The world rewards exploring and winning with a stock that the next fights of the world spend. The Decision (option A) keeps section 1's rules: no HP, no level, no
stat, and no new engine rule. The move, the push and `rules.md` do not change. The stock is spent in a Workshop (section 19.2) on the special
marbles and relics of the rogue-lite, which act **only in the fights the Open world itself starts** (the wild fight, section 3c, and a lair or tower entered by walking
onto it, section 7): never in a rogue-lite run, a dungeon gate's run included, a boss fight from the Modes menu or the Hub, the Daily, a bot or hot-seat table, online,
Ranked or Royale.

### 19.1 Gathering (slice 1)

| Resource | Source | Bonus |
|---|---|---|
| Wood | Breaking a tree (section 2): +1 | x2 in the forest |
| Ore | Breaking a boulder: +1 | x2 in the badlands |
| Parts | A marble the troop's push ejects: +1 each. A wild fight won: +3. Anything broken in the desert: +1 (#1737) | x2 in the rings 4 and 5 |
| Shards | A tower or a lair beaten from the world: +5. A lore log found: +1. Anything broken in the tundra: +1 (#1737) | none |

Each biome is known for one resource (#1737, `BIOME_RESOURCE`): the forest's wood, the badlands' ore, the tundra's shards (its ice), the desert's parts (its
buried scrap); the meadow and the archipelago give the plain yield. So the Workshop's recipes send the hero across the biomes.

- **TUNE.** Every number is in `TUNE` of `client/src/openworldresources.ts`, with the pure functions that give a yield (`breakYield`, `ejectYield`, `wildYield`,
  `lairYield`, `logYield`). The biome is the one of the broken cell (section 2). The client's mode and the MCP server use the same module.
- **The ring of a cell** (for the parts) is the ring whose towers stand nearest to its hex distance from the spawn (`ringOfCell`): ring 1 below 231, ring 2 from 231,
  ring 3 from 286, ring 4 from 340, ring 5 from 392, halfway between the medians of the towers of two rings (section 15). An ejection counts at the hero's cell, a wild win
  at the cell the beaten marble started on.
- **Gathered once.** A broken obstacle stays broken (`broken`, section 2) and a beaten marble stays gone (`fight.removed`), and the counts are saved in the same record, so a
  reload gives nothing twice. A wild win and a lair won are paid by `beatMarble` and `beat` of the save, only when the marble or the lair was not beaten already; a log
  gives its shard the first time it is found (`logs`). Only the hero's own actions pay: an obstacle broken, a marble beaten or a lair won by another hero (`multiplayer.md`
  section 7) pays nothing, and a boss beaten from the Modes menu or the Hub is no lair beaten from the world (section 16).
- **Scope.** The counts change only from these actions of the Open world. No other mode reads or writes them.
- **The plate.** One line under the medals and the recruits, `#openworld-resources`: `Wood 12 · Ore 7 · Parts 20 · Shards 2`, zeros at the start, on the full plate (a phone
  held upright shows it behind the chip's More, as the recruits line). `body[data-openworld-resources]` holds `wood,ore,parts,shards`, for the browser checks.
- **Save.** Record 8 (section 5) holds `resources` and `army`. The army is empty in this slice: `{ specials: [], brought: [], relics: [], relicsBrought: [] }`, lists of the
  engine's codes of the special marbles and the relics owned and brought, so the Workshop adds no record. Limits checked on load: 6 specials owned, 4 brought, 2 relics brought.
- **MCP.** `world_state` and `save_world` carry `resources`, `new_world` with a `save` resumes them and the `army`, and a step gathers as the client does (`mcp.md` section 5).
- **Tests.** Client: the yields and the ring (`openworldresources.test.ts`), the mode (`openworldmoderesources.test.ts`: biome factors, ejection, log, reload, record 7), the
  save (`openworldsave.test.ts`: record 8, record 7, garbage, once-only). MCP: the state, the steps, the lair, the save. E2E (`openworld-resources.spec.ts`): a boulder and a tree
  broken fill the plate, and a reload keeps the counts, on a desktop and two phones, each under 15 s.

### 19.2 The Workshop (slice 2)

A station of the Hub of a town, where the resources buy the special marbles of the rogue-lite, and the army brings some to the wild fights of the world. Section 19.3 adds the
upgraded types, the army relics and the lairs.

| Special marble | Cost (TUNE) | Refund |
|---|---|---|
| Heavy | 6 ore + 4 parts | 3 ore + 2 parts |
| Anchor | 6 ore + 2 wood + 4 parts | 3 ore + 1 wood + 2 parts |
| Spark | 4 wood + 6 parts | 2 wood + 3 parts |
| Shield | 6 wood + 4 parts | 3 wood + 2 parts |
| Magnet | 4 ore + 6 parts | 2 ore + 3 parts |
| Bomb | 3 wood + 3 ore + 6 parts | 1 wood + 1 ore + 3 parts |
| Medic | 6 wood + 6 parts | 3 wood + 3 parts |

- **Where.** `#workshop-open`, a button at the bottom left of the Hub (over the dock on a phone held upright), shown only when the Hub was entered from a town of the Open world
  (`placeFrom.kind === 'town'`, section 13): the Hub of the mode menu has none. It opens `#workshop`, a sheet over the deck that reads the stock from the world's save, takes the
  focus and scrolls on a short window. Close and Esc shut it and give the focus back to the button; the arrows of the Hub roll nothing while it is open. Leaving the Hub closes it.
- **Rows.** One per special marble, in the order of the table: its name and rule (the rogue-lite's own text), its price, how many the army owns and brings, and the buttons
  **Buy**, **Sell**, **Bring** and **Leave** (tab order: Close, then each row left to right). A button that cannot be pressed is `disabled`, and its `title` and label say why
  (the Buy reason is also written on the row): "not enough ore", "not enough wood and parts", "army full", "none to sell", "3 already brought", "none left to bring",
  "none brought". After a press the focus stays on the button, or goes to the first enabled one of its row, or to the sheet.
- **Rules** (`client/src/openworldworkshop.ts`, pure, no engine). The army owns **6** special marbles at most (the engine's codes in `army.specials`, kept in order) and brings
  **3** to a fight (`army.brought`, a multiset of the owned ones; 4 with the Quartermaster brought, section 19.3, the rogue-lite's `FIGHT_CAP`). Buy spends the cost; Sell takes one owned
  marble and gives back half of each part of the cost, rounded down, and takes it out of the loadout when the loadout holds more of its kind than the army keeps. The loadout
  is kept in the save (`army.brought`) until it is changed. The sheet writes each change to the save at once (`WorldSaves.setStock`, record 8).
- **In a wild fight** (`startWild` of `main.ts`). The mode tells the page the loadout with the marble (`onWild(seed, home, brought)`). When it is not empty, the fight is the
  rogue-lite's engine of a full army (`Engine.with_army(14, 14)`, the standard board with the rogue-lite flag, Decision #935) with one special marble placed on each of the
  brought kinds by `Engine::place_special` (`placeBrought`: the army's marbles nearest the centre, in the order of the loadout), and the bot's request carries the same
  army, `placed` and `foes` (`engineFor`), so its search plays the board the page plays. An empty loadout starts the plain game, bit for bit as before. The board draws the
  glyphs of the special marbles and the Bomb's fuse (`built()`), and `body[data-specials]` lists them.
- **Losses** (`wildThrown`). When the fight is over, a won one or a lost one, the brought marbles that the board no longer holds (thrown off, or a Bomb burst) are gone from the
  army (`lose`: from `specials` and from `brought`), saved once, and the end banner says "Lost: Heavy, Bomb.". A Medic that came back is still on the board and stays. **Flee**,
  Back and a reload end the fight before it is over and keep everything.
- **Scope.** Only the fights the Open world starts place them (the wild fight here, a lair in section 19.3). A rogue-lite run, a dungeon gate, a boss of the Modes menu or the Hub, the Daily, a bot or hot-seat
  table, online, Ranked and Royale are built as before: their engines never get a `placed` list (`main.workshop.test.ts` checks the arena and the Daily after a world whose army
  brings two).
- **Tests.** The rules (`openworldworkshop.test.ts`), the sheet (`workshopview.test.ts`), the save (`openworldsave.test.ts`), the mode's loadout and fixture
  (`openworldmodewander.test.ts`, `openworldmoderesources.test.ts`), the page (`main.workshop.test.ts`: the button in a town and not in the menu's Hub, the sheet, buy, sell,
  loadout, reasons, a wild fight placing the marbles, the losses, Flee, the other modes). E2E (`openworld-workshop.spec.ts`): the Workshop on a desktop and two phones, by the
  keyboard too, and a wild fight with a Heavy and a Bomb placed, each under 15 s. The fixture hook takes `resources` and `army`.

### 19.3 Upgraded types, relics and the lairs (slice 3)

The same sheet sells the upgraded types and the army relics, and a lair walked into from the world gets the army the way a wild fight does.

- **Upgrades.** A Heavy, an Anchor or a Spark the army owns is upgraded to its `+` type (Heavy+ 4, Anchor+ 5, Spark+ 6, the rogue-lite's upgraded kinds, kind + 3) for **3 shards and
  10 of its main resource** (TUNE: ore for a Heavy and an Anchor, wood for a Spark). The `+` type takes the marble's place in the army, and in the loadout when the loadout held more of
  the kind than the army keeps. It cannot be bought: its row has Sell, Bring and Leave only, and the plain marble's row has an **Upgrade** button (tab order Buy, Upgrade, Sell, Bring,
  Leave) that says why when it cannot ("none to upgrade", "not enough ore and shards"). A `+` type counts as one of the six owned and one of the three brought. **Refund:** half of its
  whole price (the plain marble's and the upgrade's), each part rounded down: a Heavy+ gives back 8 ore, 2 parts and 1 shard.
- **Relics.** Five, the rogue-lite's relics (section 9) that act inside one fight: Gyroscope, Hull plating, Detonator, Saboteur and Quartermaster, **5 shards and 15 parts** each
  (refund 2 shards and 7 parts). The army owns one of each ("already owned") and brings **2** to a fight (`army.relicsBrought`, "2 already brought"; "not owned", "already brought",
  "none brought" say the rest). The sheet has a relics line (`#workshop-relics`, `Relics 1 · Bringing 1 / 2`) and one row per relic with Buy, Sell, Bring and Leave
  (`data-relic` is the relic's code, the buttons act by `data-act`).
  - **Gyroscope** and **Detonator**: set on the engine with `Engine::set_relics` (the rogue-lite's bit for each relic, `relicsMask`), before the first move.
  - **Hull plating**: the first special marble lost in a fight stays in the army (the banner says "Hull plating kept Heavy."); the others are lost as in section 19.2.
  - **Saboteur** (wild fights only): the bot has 13 marbles instead of 14 (`Engine.with_army(14, 13)`, the bot's search too). A lair has no such count: it is brought and ignored there.
  - **Quartermaster**: with it brought the loadout holds **4** special marbles (`bringMax`); leaving or selling it takes the fourth out of the loadout.
- **Lair and tower fights** walked into from the world (section 7). The mode tells the page the loadout with the lair (`onLair(seed, lair, brought, relics)`). When the boss takes the
  army's build (`takes_build`, the rogue-lite's act bosses' rule), the brought marbles are placed on the army's side of the boss board (`placeBrought` on the encounter's own board, the
  mirror of the Echo applied first) and the relics set (`encounterFor`, the bot's request carrying the same `placed` and relics so its search plays that board). A boss that takes no
  build is the plain fight and loses nothing. Losses are settled as in a wild fight (`wildThrown`: thrown off or a burst Bomb is lost once, Hull plating keeps the first, the banner says
  so), a win or a loss alike; **Retry** places only the marbles that are left; leaving by the exit (Flee), the Back button and a reload keep everything.
- **Scope.** Never anywhere else: a rogue-lite run, a dungeon gate, a boss of the Modes menu or the Hub, the Daily, a bot or hot-seat table, online, Ranked and Royale never get a `placed`
  list or a relic (`main.workshop.test.ts` enters the arena and a boss after a world whose army brings two marbles and two relics, and no engine is told of one), so their digests are
  unchanged.
- **Tests.** The rules (`openworldworkshop.test.ts`), the sheet (`workshopview.test.ts`), the mode's loadout (`openworldmodewander.test.ts`, `openworldmodelair.test.ts`), the page
  (`main.workshop.test.ts`: upgrade, relics, the Quartermaster, a wild fight and a lair that place the marbles and set the relics, the bot's request, the Hull plating, losses, Retry,
  Flee, the other modes). E2E (`openworld-relics.spec.ts`): the Workshop upgrading a Heavy and buying a relic, and a lair fight with a special marble placed, on a desktop and an
  upright phone, each under 15 s.
