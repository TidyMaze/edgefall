//! Open world bridge (docs/specs/openworld.md): the cells of a chunk, see the module docs of the
//! crate for its encoding.

use edgefall_core::world::{self, Terrain};
use edgefall_core::worldoverlay::{Block, Overlay, PUSH_REACH};
use edgefall_core::worldstep::{self, Entry};
use edgefall_core::worldwander;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use wasm_bindgen::prelude::*;

/// Bytes per cell: `[height, terrain, biome]`.
pub const CELL_STRIDE: usize = 3;
/// The terrain byte of a cell past the edge, in a chunk the edge crosses (#1440): the byte of `-1`, off the world.
pub const OFF_WORLD: u8 = 255;

/// The code of a terrain on the bridge: `0` water, `1` sand, `2` grass, `3` rock, `4` peak, `5` boulder, `6` tree, `7` wall.
fn terrain_code(terrain: Terrain) -> u8 {
    match terrain {
        Terrain::Water => 0,
        Terrain::Sand => 1,
        Terrain::Grass => 2,
        Terrain::Rock => 3,
        Terrain::Peak => 4,
        Terrain::Boulder => 5,
        Terrain::Tree => 6,
        Terrain::Wall => 7,
    }
}

/// The terrain of a bridge code, `None` for `-1` (off the world) or an unknown code.
fn terrain_of_code(code: i32) -> Option<Terrain> {
    [
        Terrain::Water,
        Terrain::Sand,
        Terrain::Grass,
        Terrain::Rock,
        Terrain::Peak,
        Terrain::Boulder,
        Terrain::Tree,
        Terrain::Wall,
    ]
    .into_iter()
    .find(|&terrain| i32::from(terrain_code(terrain)) == code)
}

/// The version of the generated world (`WORLD_VERSION` of the core): a save of another version is not loaded (#968).
#[wasm_bindgen]
pub fn world_version() -> u32 {
    world::WORLD_VERSION
}

/// The cells of chunk `(cx, cy)` of the world `seed`, `CELL_STRIDE` bytes per cell, row by row;
/// empty off the world, `[0, OFF_WORLD, 0]` for a cell past the edge.
#[wasm_bindgen]
pub fn world_chunk(seed: u32, cx: i32, cy: i32) -> Vec<u8> {
    world::chunk(u64::from(seed), cx, cy)
        .unwrap_or_default()
        .iter()
        .flat_map(|cell| {
            cell.map_or([0, OFF_WORLD, 0], |cell| {
                [cell.height, terrain_code(cell.terrain), cell.biome as u8]
            })
        })
        .collect()
}

/// Whether the cell `(q, r)` of the world `seed` is a boulder or a tree, so a peer's signed "broken" event for it can be true (#1305).
#[wasm_bindgen]
pub fn world_can_break(seed: u32, q: i32, r: i32) -> bool {
    world::can_break(u64::from(seed), q, r)
}

/// Whether a generated enemy marble of the world `seed` starts on the cell `(q, r)`, so a peer's signed "beaten" event for it can be
/// true (#1305).
#[wasm_bindgen]
pub fn world_is_enemy(seed: u32, q: i32, r: i32) -> bool {
    world::is_enemy(u64::from(seed), q, r)
}

/// The enemy marbles that start in chunk `(cx, cy)` of the world `seed`: `q, r` pairs, the groups one
/// after the other; empty off the world.
#[wasm_bindgen]
pub fn world_enemies(seed: u32, cx: i32, cy: i32) -> Vec<i32> {
    world::enemy_groups(u64::from(seed), cx, cy)
        .into_iter()
        .flatten()
        .flat_map(|(q, r)| [q, r])
        .collect()
}

/// The boss lairs of the world `seed`, one per boss of the roster: `q, r` pairs, lair 0 first (docs/specs/openworld.md section 7). Lair
/// `k` is the boss `k`, standing on the cell its tier gives it (section 15): the nearest to the spawn is the easiest.
#[wasm_bindgen]
pub fn world_lairs(seed: u32) -> Vec<i32> {
    world::towers(u64::from(seed))
        .into_iter()
        .flat_map(|(q, r)| [q, r])
        .collect()
}

/// The teleporters of the world `seed` (#1412, docs/specs/openworld.md section 10): `q, r` pairs, the spawn's first, kept off the lairs.
#[wasm_bindgen]
pub fn world_teleporters(seed: u32) -> Vec<i32> {
    let lairs = world::lairs(u64::from(seed), crate::encounter::boss_ids().len());
    world::teleporters(u64::from(seed), &lairs)
        .into_iter()
        .flat_map(|(q, r)| [q, r])
        .collect()
}

/// The pad of each tower of the world `seed` (docs/specs/openworld.md section 15): `q, r` pairs, in the order of `world_lairs`, the boss
/// of the tower first. A pad is a teleporter on a cell next to its tower, which the client adds to the network once the tower is beaten
/// through the world.
#[wasm_bindgen]
pub fn world_pads(seed: u32) -> Vec<i32> {
    world::towers(u64::from(seed))
        .into_iter()
        .flat_map(|tower| {
            let (q, r) = world::tower_pad(u64::from(seed), tower);
            [q, r]
        })
        .collect()
}

/// The lore logs of the world `seed` (#1589, docs/specs/openworld.md section 12): `q, r` pairs, log 0 first, 12 in all so that a log keeps
/// its number, kept off the lairs and the teleporters. A log with no fit (#1595, seeds of one in a thousand) is the pair `LOG_LEFT_OUT`, a
/// cell no hero reaches and no chunk holds.
#[wasm_bindgen]
pub fn world_logs(seed: u32) -> Vec<i32> {
    let lairs = world::lairs(u64::from(seed), crate::encounter::boss_ids().len());
    let mut taken = world::teleporters(u64::from(seed), &lairs);
    taken.extend(lairs);
    flat_logs(&world::logs(u64::from(seed), &taken))
}

/// The logs as `q, r` pairs, a log left out as `LOG_LEFT_OUT` twice.
fn flat_logs(cells: &[Option<(i32, i32)>]) -> Vec<i32> {
    cells
        .iter()
        .flat_map(|cell| cell.map_or([LOG_LEFT_OUT; 2], |(q, r)| [q, r]))
        .collect()
}

/// The `q` and the `r` of a log left out (docs/specs/openworld.md section 12): far off the world.
pub const LOG_LEFT_OUT: i32 = i32::MIN;

/// The towns then the dungeon gates of the world `seed` (#1514, docs/specs/openworld.md section 13): `kind, q, r` triples, `kind` `0` for a
/// town and `1` for a dungeon gate, the spawn town first, kept off the lairs, the teleporters and the logs.
#[wasm_bindgen]
pub fn world_places(seed: u32) -> Vec<i32> {
    places_of(seed)
        .into_iter()
        .flat_map(|(kind, (q, r))| [kind as i32, q, r])
        .collect()
}

/// A world's seed and its named landmarks (`world::landmarks`).
type Landmarks = (u64, Vec<(i32, i32)>);

/// The named landmarks of the last world asked for its cairns: the next chunk of the same world does not look for them again.
static LANDMARKS: Mutex<Option<Landmarks>> = Mutex::new(None);

/// The cairns of chunk `(cx, cy)` of the world `seed` (#1533, docs/specs/openworld.md section 13): `q, r` pairs, about one a chunk, so no
/// open cell lies farther than 16 cells from a tower, a teleporter, a log, a place or a cairn. A look only, the hero walks over them.
#[wasm_bindgen]
pub fn world_cairns(seed: u32, cx: i32, cy: i32) -> Vec<i32> {
    let seed = u64::from(seed);
    let mut known = LANDMARKS.lock().unwrap_or_else(PoisonError::into_inner);
    if known.as_ref().is_none_or(|(of, _)| *of != seed) {
        *known = Some((seed, world::landmarks(seed)));
    }
    let (_, landmarks) = known.as_ref().expect("just set");
    world::cairns_in(seed, cx, cy, landmarks)
        .into_iter()
        .flat_map(|(q, r)| [q, r])
        .collect()
}

/// The places of the world `seed`, kept off the lairs, the teleporters and the logs.
fn places_of(seed: u32) -> Vec<(world::PlaceKind, (i32, i32))> {
    let lairs = world::lairs(u64::from(seed), crate::encounter::boss_ids().len());
    let mut taken = world::teleporters(u64::from(seed), &lairs);
    taken.extend(lairs);
    let logs = world::logs(u64::from(seed), &taken);
    taken.extend(logs.into_iter().flatten());
    world::places(u64::from(seed), &taken)
}

/// The rings of the world `seed` (docs/specs/openworld.md section 15): the ring of the tower of each boss of the roster, boss 0 first, then
/// one for each place of `world_places`, `0` for a town and the gate's dungeon tier for a gate.
#[wasm_bindgen]
pub fn world_rings(seed: u32) -> Vec<u8> {
    let towers = world::towers(u64::from(seed));
    (0..towers.len())
        .map(world::tower_ring)
        .chain(places_of(seed).into_iter().map(|(kind, cell)| match kind {
            world::PlaceKind::Town => 0,
            world::PlaceKind::Dungeon => world::gate_ring(&towers, cell),
        }))
        .collect()
}

/// The walk of the hero from `(from_q, from_r)` to `(to_q, to_r)` in the world `seed` (docs/specs/openworld.md section 4): `q, r`
/// pairs, the start left out, empty when there is none. `blocked` holds the enemy cells and the lairs, `broken` the obstacles the
/// hero has broken (#1154), both `q, r` pairs.
#[wasm_bindgen]
pub fn world_path(
    seed: u32,
    from_q: i32,
    from_r: i32,
    to_q: i32,
    to_r: i32,
    blocked: Vec<i32>,
    broken: Vec<i32>,
) -> Vec<i32> {
    world::walk_path(
        u64::from(seed),
        (from_q, from_r),
        (to_q, to_r),
        &pairs(&broken),
        &pairs(&blocked),
    )
    .into_iter()
    .flat_map(|(q, r)| [q, r])
    .collect()
}

/// The walk to the nearest tower of the world `seed` (the Dungeon button, #1291) from `(from_q, from_r)`: `beaten` holds the numbers of
/// the lairs beaten (tried last), `blocked` the enemy cells and the lairs, `broken` the broken obstacles (`q, r` pairs). Empty when no
/// tower has a way within the search budget; else `[lair, ...q, r pairs]`: the tower's number, then the cells to walk, the tower's last.
#[wasm_bindgen]
pub fn world_dungeon(
    seed: u32,
    from_q: i32,
    from_r: i32,
    beaten: Vec<i32>,
    blocked: Vec<i32>,
    broken: Vec<i32>,
) -> Vec<i32> {
    let lairs = world::towers(u64::from(seed));
    let beaten: Vec<usize> = beaten.iter().map(|&k| k as usize).collect();
    let Some((lair, path)) = world::dungeon_walk(
        u64::from(seed),
        (from_q, from_r),
        &lairs,
        &beaten,
        &pairs(&broken),
        &pairs(&blocked),
    ) else {
        return Vec::new();
    };
    std::iter::once(lair as i32)
        .chain(path.into_iter().flat_map(|(q, r)| [q, r]))
        .collect()
}

/// The direction of the hero's step (docs/specs/openworld.md section 4), the index of `DIRECTIONS` (E, W, NE, SW, NW, SE), `-1` for no
/// step: `row` is the row of the hero, `keys` the held arrows (bit 0 up, 1 down, 2 left, 3 right), `yaw` the camera's in radians,
/// `steering` whether the step slides round obstacles (#1137), `free` the bits of the directions whose cell the hero can enter.
#[wasm_bindgen]
pub fn world_step(row: i32, keys: u32, yaw: f64, steering: bool, free: u32) -> i32 {
    worldstep::hero_dir(row, keys as u8, yaw, steering, free as u8).map_or(-1, |dir| dir as i32)
}

/// What the hero's step from `(q, r)` to `(tq, tr)` does: `0` refused, `1` rolls, `2` breaks the obstacle (#1147). `terrain` is the
/// bridge code of the target cell (`-1` or an unknown code: off the world), `occupied` whether an enemy stands on it.
#[wasm_bindgen]
pub fn world_enter(
    q: i32,
    r: i32,
    tq: i32,
    tr: i32,
    terrain: i32,
    occupied: bool,
    rise: i32,
) -> i32 {
    let entry = worldstep::entry((q, r), (tq, tr), terrain_of_code(terrain), occupied, rise);
    match entry {
        Entry::Refused => 0,
        Entry::Rolls => 1,
        Entry::Breaks => 2,
    }
}

/// The troop after the hero steps from `(step[0], step[1])` to `(step[2], step[3])` (#1504, the flock of docs/specs/openworld.md section 4b): `q, r` pairs, in
/// the order they came. `ground` holds the cells the followers may stand on (the client checks the cells beside the troop), `tick` counts
/// the hero's steps: with the world `seed` it fixes every tie, so peers agree. `goals` are `index, q, r` triples (`WorldFight.herd_goals`, #1506):
/// the followers the herd sends to a cell; empty without a hunt.
#[wasm_bindgen]
pub fn world_flock(
    seed: u32,
    tick: u32,
    troop: Vec<i32>,
    step: Vec<i32>,
    ground: Vec<i32>,
    goals: Vec<i32>,
) -> Vec<i32> {
    let ground = pairs(&ground);
    let goals: Vec<(usize, (i32, i32))> = goals
        .as_chunks::<3>()
        .0
        .iter()
        .map(|g| (g[0] as usize, (g[1], g[2])))
        .collect();
    worldstep::flock(
        &pairs(&troop),
        (step[0], step[1]),
        (step[2], step[3]),
        u64::from(seed),
        tick,
        &|cell| ground.contains(&cell),
        &goals,
    )
    .into_iter()
    .flat_map(|(q, r)| [q, r])
    .collect()
}

/// The cells of a flat `q, r` list.
fn cells_of_flat(flat: &[i32]) -> Vec<(i32, i32)> {
    pairs(flat)
}

/// The flat `q, r` list of cells.
fn flat_of(cells: &[(i32, i32)]) -> Vec<i32> {
    cells.iter().flat_map(|&(q, r)| [q, r]).collect()
}

/// A chunk and the generated enemies that start in it.
type Chunk = ((i32, i32), Vec<(i32, i32)>);

/// The chunks of a flat list: `cx, cy, n` then the `n` generated enemies of that chunk as `q, r` pairs, chunk after chunk.
fn blocks_of(chunks: &[i32]) -> Vec<Chunk> {
    let mut blocks = Vec::new();
    let mut rest = chunks;
    while let [cx, cy, n, tail @ ..] = rest {
        let (cells, tail) = tail.split_at(2 * *n as usize);
        blocks.push(((*cx, *cy), cells_of_flat(cells)));
        rest = tail;
    }
    blocks
}

/// A push of the troop as it was played (`WorldFight.troop_push`), cells as flat `q, r` pairs.
#[wasm_bindgen(getter_with_clone)]
pub struct PushResult {
    /// The troop after the push, the hero first.
    pub troop: Vec<i32>,
    /// The enemies near the hero before the push.
    pub foes: Vec<i32>,
    /// The same enemies after it.
    pub enemies: Vec<i32>,
    /// The enemy ejected, none or one.
    pub ejected: Vec<i32>,
    /// The cell the ejected enemy started on when it was a generated one (the cell the other heroes check, #1511), else the cell it
    /// stood on.
    pub homes: Vec<i32>,
    /// The direction of the push, `q, r`.
    pub dir: Vec<i32>,
}

/// The enemies of the Open world fight as the pushes of the troop left them (edgefall-core `worldoverlay`). The generated enemies of a
/// chunk come in with each call, so the object holds only what the pushes changed.
#[wasm_bindgen]
pub struct WorldFight {
    overlay: Overlay,
    /// The world seed and the tick of the clock the wandering marbles stand at (#1511); tick 0, the start of the clock, has them all at
    /// the cells they start on, which is where a fight that never sets a clock (the MCP server) leaves them.
    clock: (u64, u32),
    /// The offset each chunk's group has at the clock, worked out once per chunk and tick.
    offsets: RefCell<HashMap<(i32, i32), (i32, i32)>>,
    /// The cells the troop stands on (#1590): a group never takes a step onto one, nor onto a shoved marble, it waits a tick. This peer's
    /// drawing alone, the walk itself stays a function of the seed, the chunk and the clock.
    held: Vec<(i32, i32)>,
}

#[wasm_bindgen]
impl WorldFight {
    /// A fight with no push.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WorldFight {
        WorldFight::with(Overlay::new())
    }

    /// The fight of a save: the generated enemies gone and the enemies on other cells (`q, r` pairs), the number ejected.
    pub fn restore(removed: Vec<i32>, added: Vec<i32>, beaten: u32) -> WorldFight {
        WorldFight::with(Overlay::from_parts(
            cells_of_flat(&removed),
            cells_of_flat(&added),
            beaten,
        ))
    }

    /// Forgets every push.
    pub fn reset(&mut self) {
        self.overlay = Overlay::new();
    }

    /// Hides generated enemies (`q, r` pairs).
    pub fn hide(&mut self, cells: Vec<i32>) {
        self.overlay.hide(&cells_of_flat(&cells));
    }

    /// Sets the clock the wandering marbles stand at (#1511): the world `seed` and the `tick`, the same on every peer. Every query after
    /// it places the generated enemies where they are at that tick. Tick 0 has them where they start.
    pub fn set_clock(&mut self, seed: u32, tick: u32) {
        if self.clock != (u64::from(seed), tick) {
            self.clock = (u64::from(seed), tick);
            self.offsets.borrow_mut().clear();
        }
    }

    /// Sets the cells of the troop (`q, r` pairs) that the wandering groups never walk onto (#1590): a group whose next cell is one of
    /// them, or a shoved marble's, stays where it was the tick before.
    pub fn set_held(&mut self, cells: Vec<i32>) {
        self.held = cells_of_flat(&cells);
        self.offsets.borrow_mut().clear();
    }

    /// The length of a tick of the clock in ms (`worldwander::TICK_MS`): the marbles take one step per tick.
    pub fn tick_ms() -> u32 {
        worldwander::TICK_MS
    }

    /// Whether an enemy stands on `(q, r)`, `generated` being the generated enemies of its chunk.
    pub fn occupied(&self, generated: Vec<i32>, q: i32, r: i32) -> bool {
        let generated = cells_of_flat(&generated);
        let offset = self.offset(chunk_of((q, r)), &generated);
        self.overlay.occupied(&generated, (q, r), offset)
    }

    /// Whether the generated enemy that starts on `(q, r)` is still in the world, `generated` being the generated enemies of its chunk
    /// (#1511): a signed event of another hero names that cell, wherever the enemy wandered.
    pub fn alive(&self, generated: Vec<i32>, q: i32, r: i32) -> bool {
        self.overlay.alive(&cells_of_flat(&generated), (q, r))
    }

    /// The enemies on chunk `(cx, cy)` now, `generated` being its generated ones.
    pub fn chunk_enemies(&self, generated: Vec<i32>, cx: i32, cy: i32) -> Vec<i32> {
        let generated = cells_of_flat(&generated);
        let offset = self.offset((cx, cy), &generated);
        flat_of(&self.overlay.chunk_enemies(&generated, (cx, cy), offset))
    }

    /// The marble that touches the hero on `(q, r)` (#1511): a generated enemy within one cell that no push has moved. `[home q, home
    /// r, q, r]`, the cell it starts on then the cell it stands on, or empty. `chunks` as for `around`.
    pub fn wild_contact(&self, chunks: Vec<i32>, q: i32, r: i32) -> Vec<i32> {
        match self.overlay.wild_contact(&self.blocks(&chunks), (q, r)) {
            Some(marble) => {
                let home = marble.home.expect("a wild marble is a generated one");
                vec![home.0, home.1, marble.at.0, marble.at.1]
            }
            None => vec![],
        }
    }

    /// The enemies within `radius` cells of `(q, r)`. `chunks` lists the chunks to look in, in order: `cx, cy, n` then the `n` generated
    /// enemies of that chunk as `q, r` pairs, chunk after chunk.
    pub fn around(&self, chunks: Vec<i32>, q: i32, r: i32, radius: i32) -> Vec<i32> {
        flat_of(&self.overlay.around(&self.blocks(&chunks), (q, r), radius))
    }

    /// The troop's attack after a step: the best legal push of `troop` (the hero's cell first) in the world `seed` against the enemies
    /// within `world_push_reach` of the hero, `chunks` being the chunks that reach them (`around`), `broken` the broken cells. The push is
    /// played on the fight (a line push, or a single marble shoving a foe into the water, #1504, `tick` being the hero's step count of the flock); `undefined` when none is legal.
    pub fn troop_push(
        &mut self,
        seed: u32,
        troop: Vec<i32>,
        chunks: Vec<i32>,
        broken: Vec<i32>,
        tick: u32,
    ) -> Option<PushResult> {
        let terrain = broken_terrain(seed, &broken);
        let blocks = self.blocks(&chunks);
        let played = self.overlay.troop_push_on(
            &blocks,
            &pairs(&troop),
            terrain,
            iced(seed),
            (u64::from(seed), tick),
        )?;
        Some(PushResult {
            troop: flat_of(&played.troop),
            foes: flat_of(&played.foes),
            enemies: flat_of(&played.enemies),
            ejected: flat_of(&played.ejected),
            homes: flat_of(&played.homes),
            dir: vec![played.dir.0, played.dir.1],
        })
    }

    /// The cells the herd sends the followers to before they flock (#1506): `index, q, r` triples for the troop (the hero first) in the world
    /// `seed`, `chunks` and `broken` as for `troop_push`; empty without a hunt. Pass them to `world_flock`.
    pub fn herd_goals(
        &self,
        seed: u32,
        troop: Vec<i32>,
        chunks: Vec<i32>,
        broken: Vec<i32>,
    ) -> Vec<i32> {
        self.overlay
            .herd_goals(
                &self.blocks(&chunks),
                &pairs(&troop),
                broken_terrain(seed, &broken),
                u64::from(seed),
            )
            .into_iter()
            .flat_map(|(i, (q, r))| [i as i32, q, r])
            .collect()
    }

    /// How far from the hero the enemies are that a push can reach.
    pub fn push_reach() -> i32 {
        PUSH_REACH
    }

    /// Plays a push: the enemies `old` leave, the enemies `new` stand, `ejected` of them are beaten.
    pub fn apply(&mut self, old: Vec<i32>, new: Vec<i32>, ejected: u32) {
        self.overlay
            .apply(&cells_of_flat(&old), &cells_of_flat(&new), ejected as usize);
    }

    /// The generated enemies gone, `q, r` pairs in the order they went.
    pub fn removed(&self) -> Vec<i32> {
        flat_of(self.overlay.removed())
    }

    /// The enemies on other cells, `q, r` pairs in the order they came.
    pub fn added(&self) -> Vec<i32> {
        flat_of(self.overlay.added())
    }

    /// The enemies ejected so far.
    pub fn beaten(&self) -> u32 {
        self.overlay.beaten()
    }
}

impl WorldFight {
    fn with(overlay: Overlay) -> WorldFight {
        WorldFight {
            overlay,
            clock: (0, 0),
            offsets: RefCell::new(HashMap::new()),
            held: Vec::new(),
        }
    }

    /// The offset the group of chunk `chunk` has at the clock, `generated` being the generated enemies of the chunk.
    fn offset(&self, chunk: (i32, i32), generated: &[(i32, i32)]) -> (i32, i32) {
        let (seed, tick) = self.clock;
        if tick == 0 || generated.is_empty() {
            return (0, 0);
        }
        *self
            .offsets
            .borrow_mut()
            .entry(chunk)
            .or_insert_with(|| self.settled(seed, chunk, generated, tick))
    }

    /// The offset the walk gives at `tick`, or the last one of the outing that leaves every marble clear of the troop and of the shoved
    /// marbles (#1590): the outing starts at home, the way back is the way out, so the group waits where it was.
    fn settled(
        &self,
        seed: u64,
        chunk: (i32, i32),
        generated: &[(i32, i32)],
        tick: u32,
    ) -> (i32, i32) {
        let alive: Vec<(i32, i32)> = generated
            .iter()
            .copied()
            .filter(|cell| !self.overlay.removed().contains(cell))
            .collect();
        let held = |at: &(i32, i32)| self.held.contains(at) || self.overlay.added().contains(at);
        (tick - tick % worldwander::EPOCH..=tick)
            .rev()
            .map(|t| worldwander::offset(seed, chunk, generated, t))
            .find(|&(dq, dr)| !alive.iter().any(|&(q, r)| held(&(q + dq, r + dr))))
            .unwrap_or((0, 0))
    }

    /// The chunks of a flat list with the offset their group has now.
    fn blocks(&self, chunks: &[i32]) -> Vec<Block> {
        blocks_of(chunks)
            .into_iter()
            .map(|(chunk, generated)| {
                let offset = self.offset(chunk, &generated);
                (chunk, generated, offset)
            })
            .collect()
    }
}

impl Default for WorldFight {
    fn default() -> Self {
        Self::new()
    }
}

/// The chunk a cell is in.
fn chunk_of((q, r): (i32, i32)) -> (i32, i32) {
    (q.div_euclid(world::CHUNK), r.div_euclid(world::CHUNK))
}

/// The terrain of a cell of the world `seed` as the hero left it: a broken boulder is rock, a broken tree grass (#1147).
fn broken_terrain(seed: u32, broken: &[i32]) -> impl Fn(i32, i32) -> Option<Terrain> {
    let broken = pairs(broken);
    move |q, r| match terrain_at(u64::from(seed), q, r) {
        Some(Terrain::Boulder) if broken.contains(&(q, r)) => Some(Terrain::Rock),
        Some(Terrain::Tree) if broken.contains(&(q, r)) => Some(Terrain::Grass),
        other => other,
    }
}

/// Whether a cell of the world `seed` is the tundra's ice, which carries a pushed marble one cell more (#1751).
fn iced(seed: u32) -> impl Fn(i32, i32) -> bool {
    move |q, r| {
        world::cell(u64::from(seed), q, r).is_some_and(|cell| cell.biome == world::Biome::Tundra)
    }
}

/// The terrain of a cell of the world `seed`, `None` off the world.
fn terrain_at(seed: u64, q: i32, r: i32) -> Option<Terrain> {
    let cell = world::cell(seed, q, r)?;
    Some(cell.terrain)
}

/// The `q, r` pairs of a flat list.
fn pairs(flat: &[i32]) -> Vec<(i32, i32)> {
    let (chunks, _) = flat.as_chunks::<2>();
    chunks.iter().map(|&[q, r]| (q, r)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_world_version_is_the_core_one() {
        assert_eq!(world_version(), edgefall_core::world::WORLD_VERSION);
    }

    #[test]
    fn a_chunk_is_three_bytes_a_cell_and_matches_the_engine() {
        let bytes = world_chunk(9, 1, -1);
        assert_eq!(bytes.len(), 16 * 16 * CELL_STRIDE);
        let cell = world::cell(9, 16 + 3, -16 + 2).unwrap();
        let at = (2 * 16 + 3) * CELL_STRIDE;
        assert_eq!(bytes[at], cell.height);
        assert_eq!(bytes[at + 1], terrain_code(cell.terrain));
        assert_eq!(bytes[at + 2], cell.biome as u8);
    }

    #[test]
    fn the_biome_codes_are_the_six_biomes_of_the_table() {
        let biomes: std::collections::HashSet<u8> = (1..=4)
            .flat_map(|seed| {
                (-8..8).flat_map(move |cx| (-8..8).map(move |cy| world_chunk(seed, cx, cy)))
            })
            .flat_map(|bytes| bytes.into_iter().skip(2).step_by(CELL_STRIDE))
            .collect();
        assert_eq!(biomes, std::collections::HashSet::from([0, 1, 2, 3, 4, 5]));
    }

    #[test]
    fn enemies_are_q_r_pairs_that_match_the_engine() {
        let mut found = false;
        for cx in -8..8 {
            let flat = world_enemies(5, cx, 3);
            let groups: Vec<(i32, i32)> = world::enemy_groups(5, cx, 3).concat();
            assert_eq!(flat.len(), groups.len() * 2);
            for (i, (q, r)) in groups.iter().enumerate() {
                assert_eq!((flat[2 * i], flat[2 * i + 1]), (*q, *r));
                found = true;
            }
        }
        assert!(found);
        assert!(world_enemies(5, 32, 0).is_empty());
    }

    #[test]
    fn the_lairs_are_q_r_pairs_that_match_the_core() {
        let flat = world_lairs(7);
        let roster = crate::encounter::boss_ids().len();
        let lairs: Vec<(i32, i32)> = world::towers(7);
        assert_eq!(flat.len(), 2 * roster);
        assert_eq!(
            flat,
            lairs.iter().flat_map(|&(q, r)| [q, r]).collect::<Vec<_>>()
        );
    }

    #[test]
    fn the_pads_are_q_r_pairs_one_beside_each_tower_in_the_order_of_the_lairs() {
        let (pads, lairs) = (world_pads(7), world_lairs(7));
        assert_eq!(pads.len(), lairs.len());
        for (pad, lair) in pads.chunks(2).zip(lairs.chunks(2)) {
            assert_eq!(world::hex_distance((pad[0], pad[1]), (lair[0], lair[1])), 1);
            assert_eq!((pad[0], pad[1]), world::tower_pad(7, (lair[0], lair[1])));
        }
    }

    #[test]
    fn the_tower_order_names_every_boss_of_the_roster_once_from_the_echo_to_the_choir() {
        let ids = crate::encounter::boss_ids();
        assert_eq!(world::TOWER_ORDER.len(), ids.len());
        let order: Vec<&str> = world::TOWER_ORDER
            .iter()
            .map(|&k| ids[k].as_str())
            .collect();
        assert_eq!(
            order,
            [
                "echo",
                "alien",
                "pulsar",
                "assembly",
                "dual",
                "stalker",
                "chaplain",
                "overseer",
                "core",
                "swarm",
                "railyard",
                "ballast",
                "magnetizer",
                "hull",
                "choir"
            ]
        );
    }

    #[test]
    fn the_rings_are_one_for_each_boss_then_one_for_each_place_with_no_ring_for_a_town() {
        let flat = world_rings(7);
        let towers = world::towers(7);
        let places = world_places(7);
        assert_eq!(flat.len(), towers.len() + places.len() / 3);
        assert_eq!(flat[0], 1, "the Echo is in the first ring");
        assert_eq!(flat[2], 5, "the Choir in the last");
        for (k, &ring) in flat[..towers.len()].iter().enumerate() {
            assert_eq!(ring, world::tower_ring(k));
        }
        for (i, triple) in places.chunks(3).enumerate() {
            let ring = flat[towers.len() + i];
            if triple[0] == 0 {
                assert_eq!(ring, 0, "a town has no ring");
            } else {
                assert_eq!(ring, world::gate_ring(&towers, (triple[1], triple[2])));
                assert!((1..=5).contains(&ring));
            }
        }
    }

    #[test]
    fn the_teleporters_are_q_r_pairs_that_match_the_core_and_keep_off_the_lairs() {
        let flat = world_teleporters(7);
        let lairs = world::lairs(7, crate::encounter::boss_ids().len());
        let cells = world::teleporters(7, &lairs);
        assert_eq!(
            flat,
            cells.iter().flat_map(|&(q, r)| [q, r]).collect::<Vec<_>>()
        );
        assert!(cells
            .iter()
            .all(|&t| lairs.iter().all(|&l| world::hex_distance(t, l) > 3)));
    }

    #[test]
    fn the_logs_are_q_r_pairs_that_match_the_core_and_keep_off_the_lairs_and_the_teleporters() {
        let flat = world_logs(7);
        let lairs = world::lairs(7, crate::encounter::boss_ids().len());
        let mut taken = world::teleporters(7, &lairs);
        taken.extend(lairs);
        let cells = world::logs(7, &taken);
        assert_eq!(cells.len(), world::LOGS);
        assert_eq!(flat, flat_logs(&cells));
        assert!(cells.iter().all(Option::is_some));
        assert_eq!(flat[..2], [cells[0].unwrap().0, cells[0].unwrap().1]);
    }

    #[test]
    fn a_log_left_out_keeps_the_numbers_of_the_others_and_is_a_cell_off_the_world() {
        let flat = flat_logs(&[Some((4, -2)), None, Some((6, 1))]);
        assert_eq!(flat, [4, -2, LOG_LEFT_OUT, LOG_LEFT_OUT, 6, 1]);
    }

    #[test]
    fn the_places_are_kind_q_r_triples_that_match_the_core_and_keep_off_the_lairs_teleporters_and_logs(
    ) {
        let flat = world_places(7);
        let lairs = world::lairs(7, crate::encounter::boss_ids().len());
        let mut taken = world::teleporters(7, &lairs);
        taken.extend(lairs);
        let logs = world::logs(7, &taken);
        taken.extend(logs.into_iter().flatten());
        let cells = world::places(7, &taken);
        assert_eq!(cells.len(), world::TOWNS + world::DUNGEONS);
        assert_eq!(
            flat,
            cells
                .iter()
                .flat_map(|&(kind, (q, r))| [kind as i32, q, r])
                .collect::<Vec<_>>()
        );
        assert_eq!(flat[..3], [0, 0, 0], "the spawn town first");
        assert_eq!(flat[3 * world::TOWNS], 1, "then the dungeon gates");
    }

    #[test]
    fn the_cairns_are_q_r_pairs_that_match_the_core() {
        let mut seen = 0;
        for seed in [7, 8, 7] {
            for (cx, cy) in [(0, 1), (3, -2)] {
                let cells = world::cairns_in(seed, cx, cy, &world::landmarks(seed));
                seen += cells.len();
                let flat = world_cairns(seed as u32, cx, cy);
                assert_eq!(
                    flat,
                    cells.iter().flat_map(|&(q, r)| [q, r]).collect::<Vec<_>>()
                );
            }
        }
        assert!(seen > 0);
    }

    #[test]
    fn the_dungeon_walk_is_a_lair_number_then_q_r_pairs_that_match_the_core() {
        let lairs = world_lairs(3);
        let blocked = lairs.clone();
        let flat = world_dungeon(3, 0, 0, vec![], blocked.clone(), vec![]);
        let pairs: Vec<(i32, i32)> = lairs.chunks(2).map(|c| (c[0], c[1])).collect();
        let (lair, path) = world::dungeon_walk(3, (0, 0), &pairs, &[], &[], &pairs).unwrap();
        assert_eq!(flat[0], lair as i32);
        // The first tower with a way, nearest first: the nearest of seed 3 (the Echo's, 0) has none, the walk goes on to the next.
        assert!(lair < pairs.len() && path.last() == Some(&pairs[lair]));
        assert_eq!(
            flat[1..],
            path.iter().flat_map(|&(q, r)| [q, r]).collect::<Vec<_>>()
        );
        let walled: Vec<i32> = pairs
            .iter()
            .flat_map(|&(q, r)| {
                [(1, 0), (-1, 0), (1, -1), (-1, 1), (0, -1), (0, 1)]
                    .into_iter()
                    .flat_map(move |(a, b)| [q + a, r + b])
            })
            .collect();
        assert!(world_dungeon(3, 0, 0, vec![], walled, vec![]).is_empty());
        assert_ne!(
            world_dungeon(3, 0, 0, vec![lair as i32], blocked, vec![])[0],
            lair as i32
        );
    }

    #[test]
    fn a_path_is_q_r_pairs_that_match_the_core() {
        assert_eq!(
            world_path(9, 0, 0, 3, 0, vec![], vec![]),
            vec![1, 0, 2, 0, 3, 0]
        );
        let round = world_path(9, 0, 0, 3, 0, vec![1, 0, 2, 0], vec![]);
        assert_eq!(round.len(), 8);
        assert_eq!(round[6..], [3, 0]);
        assert!(world_path(9, 0, 0, 0, 0, vec![], vec![]).is_empty());
    }

    #[test]
    fn can_break_matches_the_generated_terrain() {
        let breakable = (-40..40)
            .flat_map(|q| (-40..40).map(move |r| (q, r)))
            .filter(|&(q, r)| world_can_break(5, q, r))
            .count();
        assert!(breakable > 0 && breakable < 6400);
        assert!(!world_can_break(5, 0, 0)); // the spawn clearing
        assert!(!world_can_break(5, 100_000, 0)); // off the world
    }

    #[test]
    fn is_enemy_matches_the_generated_enemies() {
        let enemies: Vec<i32> = (-6..6)
            .flat_map(|cx| (-6..6).flat_map(move |cy| world_enemies(5, cx, cy)))
            .collect();
        assert!(!enemies.is_empty());
        for pair in enemies.chunks(2) {
            assert!(world_is_enemy(5, pair[0], pair[1]));
        }
        assert!(!world_is_enemy(5, 0, 0));
        assert!(!world_is_enemy(5, 100_000, 0));
    }

    #[test]
    fn an_entry_is_zero_refused_one_rolls_two_breaks() {
        assert_eq!(world_enter(0, 0, 1, 0, 2, false, 0), 1); // grass
        assert_eq!(world_enter(0, 0, 1, 0, 5, false, 0), 2); // boulder
        assert_eq!(world_enter(0, 0, 1, 0, 6, false, 0), 2); // a tree (#1510)
        assert_eq!(world_enter(0, 0, 1, 0, 0, false, 0), 1); // water, sailed
        assert_eq!(world_enter(0, 0, 1, 0, 2, true, 0), 0); // enemy
        assert_eq!(world_enter(0, 0, 3, 0, 2, false, 0), 0); // not a neighbour
        assert_eq!(world_enter(0, 0, 1, 0, -1, false, 0), 0); // off the world
        assert_eq!(world_enter(0, 0, 1, 0, 99, false, 0), 0); // unknown code
        assert_eq!(world_enter(0, 0, 1, 0, 2, false, 3), 0); // a cliff of three levels (#1744)
        assert_eq!(world_enter(0, 0, 1, 0, 2, false, -2), 1); // two down: walked
    }

    #[test]
    fn every_terrain_code_gives_its_entry() {
        let codes: Vec<i32> = (0..8)
            .map(|t| world_enter(0, 0, 1, 0, t, false, 0))
            .collect();
        assert_eq!(codes, vec![1, 1, 1, 1, 0, 2, 2, 0]);
    }

    #[test]
    fn a_flock_moves_the_marble_off_the_hero_target_onto_the_ground_given() {
        let out = world_flock(
            7,
            0,
            vec![1, 0, -1, 0],
            vec![0, 0, 1, 0],
            vec![0, 0, -1, 0, -2, 0],
            vec![],
        );
        assert_eq!(out[0..2], [0, 0]);
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn the_herd_sends_a_follower_behind_the_foe_and_the_flock_takes_the_goal() {
        // The world of seed 9 has water near the spawn column; a hunt needs a foe within 6 and water within 10: none here, so no goals.
        let fight = WorldFight::new();
        assert!(fight
            .herd_goals(9, vec![0, 0, 1, 0], vec![], vec![])
            .is_empty());
        // Seed 1: a foe on (137,-220), on a tundra shore, with the water three cells away, the hero behind it: the one follower flanks.
        let goals = fight.herd_goals(
            1,
            vec![136, -220, 135, -220],
            vec![8, -14, 1, 137, -220],
            vec![],
        );
        assert_eq!(goals, vec![0, 137, -221]);
        let out = world_flock(
            7,
            0,
            vec![-4, 0],
            vec![1, 0, 0, 0],
            (-6..6)
                .flat_map(|q| (-6..6).flat_map(move |r| [q, r]))
                .collect(),
            vec![0, -4, 4],
        );
        assert_eq!(out.len(), 2);
        assert!((out[0] + 4).abs() + (out[1] - 4).abs() < 8);
    }

    #[test]
    fn a_step_is_a_direction_index_or_minus_one() {
        assert_eq!(world_step(0, 8, 0.0, true, 0b11_1111), 0);
        assert_eq!(world_step(0, 8, 0.0, true, 0b11_1110), 2);
        assert_eq!(world_step(0, 0, 0.0, true, 0b11_1111), -1);
    }

    #[test]
    fn off_the_world_is_empty() {
        assert!(world_chunk(9, 29, 0).is_empty());
    }

    #[test]
    fn a_cell_past_the_edge_of_a_chunk_it_crosses_is_off_the_world() {
        // Chunk (28, 0) starts on the east corner (448, 0) of the hexagon: its first cell only is in the world.
        let bytes = world_chunk(9, 28, 0);
        assert_eq!(bytes.len(), 16 * 16 * CELL_STRIDE);
        let corner = world::cell(9, 448, 0).unwrap();
        assert_eq!(bytes[1], terrain_code(corner.terrain));
        assert_eq!(bytes[CELL_STRIDE..CELL_STRIDE * 2], [0, OFF_WORLD, 0]);
        assert_eq!(terrain_of_code(i32::from(OFF_WORLD)), None);
    }

    #[test]
    fn every_terrain_has_its_code() {
        let all = [
            Terrain::Water,
            Terrain::Sand,
            Terrain::Grass,
            Terrain::Rock,
            Terrain::Peak,
            Terrain::Boulder,
            Terrain::Tree,
            Terrain::Wall,
        ];
        assert_eq!(all.map(terrain_code), [0, 1, 2, 3, 4, 5, 6, 7]);
    }

    /// The chunk list of `fight.troop_push` for the enemies the test lays: only the chunk `(cx, 0)`, no generated enemy.
    fn chunk_of_row(cx: i32) -> Vec<i32> {
        vec![cx, 0, 0]
    }

    #[test]
    fn a_slide_keeps_the_order_of_the_troop_and_moves_the_enemy() {
        // The hero (0,0) and the marble (-1,0) push the enemy (1,0) east to (2,0), on the spawn clearing.
        let mut fight = WorldFight::new();
        let chunks = vec![0, 0, 1, 1, 0];
        let out = fight
            .troop_push(9, vec![0, 0, -1, 0], chunks, vec![], 1)
            .unwrap();
        assert_eq!(out.troop, vec![1, 0, 0, 0]);
        assert_eq!(out.foes, vec![1, 0]);
        assert_eq!(out.enemies, vec![2, 0]);
        assert!(out.ejected.is_empty());
        assert_eq!(out.dir, vec![1, 0]);
        assert_eq!(fight.added(), vec![2, 0]);
        assert_eq!(WorldFight::push_reach(), 10);
    }

    #[test]
    fn a_push_off_the_world_ejects_the_last_enemy() {
        // The world ends at q = 511: the enemy (511,0) is pushed onto (512,0), which is off it.
        let mut fight = WorldFight::new();
        fight.apply(vec![], vec![511, 0], 0);
        let out = fight
            .troop_push(9, vec![509, 0, 510, 0], chunk_of_row(31), vec![], 1)
            .unwrap();
        assert_eq!(out.ejected, vec![511, 0]);
        assert_eq!(out.homes, vec![511, 0]); // a marble pushed before has no start cell to name: its own
        assert!(out.enemies.is_empty());
        assert_eq!(fight.beaten(), 1);
    }

    #[test]
    fn the_hero_behind_a_foe_near_the_water_herds_it_one_cell_with_the_world_terrain() {
        // Seed 1, as the herd goals: the foe on (137,-220) with water three cells east, the hero right behind it (#1682).
        let mut fight = WorldFight::new();
        let out = fight
            .troop_push(1, vec![136, -220], vec![8, -14, 1, 137, -220], vec![], 1)
            .unwrap();
        assert!(out.ejected.is_empty());
        // herded one cell onto (138,-220), the tundra's ice, which carries it one more (#1751)
        assert!(iced(1)(138, -220));
        assert_eq!(out.enemies, vec![139, -220]);
    }

    #[test]
    fn no_legal_push_is_undefined_and_leaves_the_fight() {
        let mut fight = WorldFight::new();
        assert!(fight
            .troop_push(9, vec![0, 0, -1, 0], vec![0, 0, 0], vec![], 1)
            .is_none());
        assert!(fight
            .troop_push(9, vec![0, 0], vec![0, 0, 1, 1, 0], vec![], 1)
            .is_none());
        assert_eq!(fight.added(), Vec::<i32>::new());
    }

    /// A boulder or a tree of the seed 9 with a free cell on its west to start a line from, found in the world itself.
    fn obstacle(kind: Terrain) -> (i32, i32) {
        (-60..60)
            .flat_map(|q| (-60..60).map(move |r| (q, r)))
            .find(|&(q, r)| terrain_at(9, q, r) == Some(kind))
            .unwrap()
    }

    #[test]
    fn a_push_into_a_broken_obstacle_is_legal_and_into_an_unbroken_one_is_refused() {
        for kind in [Terrain::Boulder, Terrain::Tree] {
            let (q, r) = obstacle(kind);
            // Two marbles push the enemy next to the obstacle east, onto it.
            let troop = vec![q - 2, r, q - 3, r];
            let (cx, cy) = ((q - 1).div_euclid(16), r.div_euclid(16));
            let chunks = vec![cx, cy, 1, q - 1, r];
            let push = |broken: Vec<i32>| {
                WorldFight::new().troop_push(9, troop.clone(), chunks.clone(), broken, 1)
            };
            assert!(push(vec![]).is_none(), "{kind:?} blocks");
            assert!(
                push(vec![q + 1, r]).is_none(),
                "another broken cell changes nothing"
            );
            let out = push(vec![q, r]).unwrap();
            assert!(out.ejected.is_empty(), "{kind:?} broken: the enemy slides");
        }
    }

    #[test]
    fn a_fight_plays_a_push_and_answers_for_the_chunk() {
        let mut fight = WorldFight::new();
        assert!(fight.occupied(vec![1, 0], 1, 0));
        fight.apply(vec![1, 0], vec![2, 0], 1);
        assert!(!fight.occupied(vec![1, 0], 1, 0));
        assert!(fight.occupied(vec![], 2, 0));
        assert_eq!(
            fight.chunk_enemies(vec![1, 0, 5, 5], 0, 0),
            vec![5, 5, 2, 0]
        );
        assert_eq!(fight.removed(), vec![1, 0]);
        assert_eq!(fight.added(), vec![2, 0]);
        assert_eq!(fight.beaten(), 1);
    }

    #[test]
    fn a_fight_hides_resets_and_restores() {
        let mut fight = WorldFight::default();
        fight.hide(vec![1, 0]);
        assert_eq!(fight.removed(), vec![1, 0]);
        fight.reset();
        assert!(fight.removed().is_empty() && fight.beaten() == 0);
        let saved = WorldFight::restore(vec![4, 4, 1, 1], vec![2, 2], 7);
        assert_eq!(saved.removed(), vec![4, 4, 1, 1]);
        assert_eq!(saved.added(), vec![2, 2]);
        assert_eq!(saved.beaten(), 7);
    }

    #[test]
    fn a_fight_lists_the_enemies_around_a_cell_over_the_chunks_given() {
        let mut fight = WorldFight::new();
        fight.apply(vec![2, 0], vec![0, 3], 0);
        let chunks = vec![0, 0, 3, 1, 0, 2, 0, 9, 0, 1, 0, 2, 16, 0, 30, 0];
        assert_eq!(fight.around(chunks.clone(), 0, 0, 3), vec![1, 0, 0, 3]);
        assert_eq!(
            fight.around(chunks, 0, 0, 20),
            vec![1, 0, 9, 0, 0, 3, 16, 0]
        );
        assert!(fight.around(vec![], 0, 0, 5).is_empty());
    }

    /// A chunk of the seed 3 with generated enemies, and a tick at which its group stands away from where it starts.
    fn wandering() -> (i32, i32, Vec<i32>, u32, (i32, i32)) {
        (-5..5)
            .flat_map(|cx| (-5..5).map(move |cy| (cx, cy)))
            .find_map(|(cx, cy)| {
                let flat = world_enemies(3, cx, cy);
                let generated = pairs(&flat);
                (1..200).find_map(|tick| {
                    let offset = worldwander::offset(3, (cx, cy), &generated, tick);
                    (!generated.is_empty() && offset != (0, 0))
                        .then(|| (cx, cy, flat.clone(), tick, offset))
                })
            })
            .expect("a chunk of the seed 3 has a group that wanders")
    }

    #[test]
    fn a_group_whose_next_cell_is_held_by_the_troop_or_a_shoved_marble_waits_a_tick() {
        let (cx, cy, flat, tick, (dq, dr)) = wandering();
        let stands = |fight: &WorldFight, cell: (i32, i32)| {
            pairs(&fight.chunk_enemies(flat.clone(), cx, cy)).contains(&cell)
        };
        let next = (flat[0] + dq, flat[1] + dr);
        let mut fight = WorldFight::new();
        fight.set_held(vec![next.0, next.1]);
        fight.set_clock(3, tick);
        assert!(!stands(&fight, next), "a troop marble holds the cell");
        // The group keeps the cells of the tick before, a pure function of the seed, the chunk and the clock.
        let before = worldwander::offset(3, (cx, cy), &pairs(&flat), tick - 1);
        assert_eq!(
            fight.chunk_enemies(flat.clone(), cx, cy),
            flat.chunks(2)
                .flat_map(|c| [c[0] + before.0, c[1] + before.1])
                .collect::<Vec<i32>>()
        );
        fight.set_held(vec![]);
        assert!(stands(&fight, next), "released, the group takes the step");
        let mut shoved = WorldFight::restore(vec![], vec![next.0, next.1], 0);
        shoved.set_clock(3, tick);
        let mut waiting: Vec<i32> = flat
            .chunks(2)
            .flat_map(|c| [c[0] + before.0, c[1] + before.1])
            .collect();
        waiting.extend([next.0, next.1]);
        let mut seen = shoved.chunk_enemies(flat.clone(), cx, cy);
        seen.sort_unstable();
        waiting.sort_unstable();
        assert_eq!(seen, waiting, "a shoved marble holds the cell alone");
        let mut gone = WorldFight::restore(flat.clone(), vec![], 0);
        gone.set_held(vec![next.0, next.1]);
        gone.set_clock(3, tick);
        assert!(gone.chunk_enemies(flat.clone(), cx, cy).is_empty());
    }

    #[test]
    fn a_clock_moves_the_generated_enemies_and_tick_zero_puts_them_home() {
        let (cx, cy, flat, tick, (dq, dr)) = wandering();
        let mut fight = WorldFight::new();
        assert_eq!(fight.chunk_enemies(flat.clone(), cx, cy), flat);
        fight.set_clock(3, tick);
        let moved: Vec<i32> = flat
            .chunks(2)
            .flat_map(|c| [c[0] + dq, c[1] + dr])
            .collect();
        assert_eq!(fight.chunk_enemies(flat.clone(), cx, cy), moved);
        assert!(fight.occupied(flat.clone(), moved[0], moved[1]));
        assert!(!fight.occupied(flat.clone(), flat[0], flat[1]));
        fight.set_clock(3, tick); // the same clock again keeps what was worked out
        assert_eq!(fight.chunk_enemies(flat.clone(), cx, cy), moved);
        assert_eq!(
            fight
                .around(
                    vec![cx, cy, flat.len() as i32 / 2]
                        .into_iter()
                        .chain(flat.clone())
                        .collect(),
                    flat[0],
                    flat[1],
                    10
                )
                .len(),
            moved.len()
        );
        fight.set_clock(3, 0);
        assert_eq!(fight.chunk_enemies(flat.clone(), cx, cy), flat);
        assert_eq!(WorldFight::tick_ms(), worldwander::TICK_MS);
        assert!(fight.alive(flat.clone(), flat[0], flat[1]));
        assert!(!fight.alive(flat.clone(), flat[0] + 100, flat[1]));
    }

    #[test]
    fn a_wandering_marble_next_to_the_hero_is_the_wild_contact_and_names_its_start_cell() {
        let (cx, cy, flat, tick, (dq, dr)) = wandering();
        let mut fight = WorldFight::new();
        fight.set_clock(3, tick);
        let chunks: Vec<i32> = vec![cx, cy, flat.len() as i32 / 2]
            .into_iter()
            .chain(flat.clone())
            .collect();
        let (home, at) = ((flat[0], flat[1]), (flat[0] + dq, flat[1] + dr));
        // The hero stands on the marble's cell: that is within one cell.
        assert_eq!(
            fight.wild_contact(chunks.clone(), at.0, at.1)[..2],
            [home.0, home.1]
        );
        assert_eq!(
            fight.wild_contact(chunks.clone(), at.0, at.1)[2..],
            [at.0, at.1]
        );
        assert!(fight.wild_contact(chunks, at.0 + 9, at.1).is_empty());
        assert!(fight.wild_contact(vec![], 0, 0).is_empty());
    }
}
