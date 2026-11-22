//! Open world map (docs/specs/openworld.md section 2): the cells of a huge hex map, generated
//! chunk by chunk from a seed. A chunk depends on the seed and its coordinates alone, so the same
//! world comes out in any order of visit. Relief and terrain are looks: only `Terrain::blocked`
//! cells change what a marble may do.

use crate::encounter::hull::mix;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

/// The version of the generated world, saved with each Open world save (#968): bump it with every change of the generator, the
/// same moment the pinned digest of the tests changes (the line of `the_generated_world_is_pinned_by_a_digest`).
pub const WORLD_VERSION: u32 = 6;
/// A chunk is `CHUNK` x `CHUNK` cells of the axial grid.
pub const CHUNK: i32 = 16;
/// The world is a hexagon of cells round the spawn `(0, 0)`: the cells within `WORLD_RADIUS` of it (#1440).
pub const WORLD_RADIUS: i32 = 448;
/// Cells within this distance of the spawn cell `(0, 0)` are open grass.
pub const CLEARING: i32 = 3;
/// Boulders on the open ground that is not low (heights 2, 5 and 6), in thousandths: the same in every biome. The low
/// ground (heights 3 and 4) takes the density of its biome, see `Biome::boulder_per_mille`.
const UPLAND_BOULDER_PER_MILLE: f64 = 20.0;
/// Walls are laid out on a lattice of squares of this many cells.
const WALL_BLOCK: i32 = 24;
/// A chunk tries to place `TRIES` enemy groups, each with this chance in thousandths; with the obstacles that refuse some,
/// about one group stands per 400 cells.
const GROUP_PER_MILLE: f64 = 600.0;
const TRIES: u64 = 2;
/// No enemy stands within this many cells of the spawn.
const SAFE: i32 = 8;
/// Scales, in cells, of the three levels of a field: macro (continents), meso (ranges) and micro (bumps). The widest
/// zoom sees about 21 chunks across, so the macro level must repeat well inside that.
const LEVEL_SCALES: [i32; 3] = [128, 40, 8];
/// Weights of the macro, meso and micro levels of the elevation and of the moisture; each set sums to 1.
const HEIGHT_WEIGHTS: [f64; 3] = [0.50, 0.35, 0.15];
const MOISTURE_WEIGHTS: [f64; 3] = [0.45, 0.35, 0.20];
/// Salts of the levels: the elevation uses `HEIGHT_SALT` to `+ 2`, the moisture `MOISTURE_SALT` to `+ 2`. The
/// enemy draws already use the salts 12 to 21, so these start after them.
const HEIGHT_SALT: u64 = 30;
const MOISTURE_SALT: u64 = 33;
/// The climate (#1755): three fields over the whole map, the same everywhere, value noise at `CLIMATE_SCALES` (a few hundred cells)
/// summed with `CLIMATE_WEIGHTS`: the temperature (salts `TEMP_SALT` to `+ 2`), the wetness (`WET_SALT`) and the archipelago's sea
/// (`SEA_SALT`). The biome is read from them by `Climate::biome`.
const CLIMATE_SCALES: [i32; 3] = [384, 144, 48];
const CLIMATE_WEIGHTS: [f64; 3] = [0.55, 0.30, 0.15];
const TEMP_SALT: u64 = 52;
const WET_SALT: u64 = 55;
const SEA_SALT: u64 = 62;
/// The temperature below `COLD` is tundra, above `HOT` is desert or badlands; between, meadow or forest. The wetness above
/// `FOREST_WET` makes a temperate cell forest, below `HOT_DRY` a hot cell desert. The sea field above `SEA_LEVEL` is the archipelago. Quantiles
/// of the fields measured on seeds 0 to 30 (`the_climate_shares_are_measured`).
const COLD: f64 = 0.353;
const HOT: f64 = 0.57;
const FOREST_WET: f64 = 0.53;
const HOT_DRY: f64 = 0.49;
const SEA_LEVEL: f64 = 0.655;
/// The archipelago's sea deepens over `SEA_EDGE` of the sea field either side of `SEA_LEVEL`.
const SEA_EDGE: f64 = 0.012;
/// The climate of the map is shifted per seed by one of `CLIMATE_CANDIDATES` offsets of up to `OFFSET_SPAN` cells (salt
/// `CLIMATE_SALT`), the first whose map starts in meadow (the spawn and a ring of `HOME_RING` round it) and shows every biome near
/// (`CLIMATE_NEAR` rings) and far (`CLIMATE_FAR`). The map itself is drawn from the climate alone, never from the spawn: only the choice
/// among the offsets looks at it.
const CLIMATE_SALT: u64 = 48;
const CLIMATE_CANDIDATES: u64 = 4096;
const HOME_RING: i32 = 10;
const CLIMATE_NEAR: [(f64, u32); 5] = [
    (60.0, 12),
    (100.0, 12),
    (140.0, 12),
    (180.0, 12),
    (220.0, 12),
];
const CLIMATE_FAR: [(f64, u32); 6] = [
    (170.0, 24),
    (220.0, 24),
    (270.0, 24),
    (320.0, 24),
    (370.0, 24),
    (420.0, 24),
];
/// A candidate fits when its rarest biome has at least this many points on the near (of 60) and the far (of 144) rings.
const NEAR_ENOUGH: usize = 1;
const FAR_ENOUGH: usize = 12;
/// Each cell's climate moves by a draw of up to `BLEND` either way (salt `BLEND_SALT`) when its biome is picked, so two biomes mix over
/// a few cells along their border.
const BLEND: f64 = 0.005;
const BLEND_SALT: u64 = 45;
/// Some borders between two biomes are marked (#1752): past `FEATURE_FROM` cells from the spawn, the cells next to a cell of another
/// biome turn to a river (water, sailed across) or a ridge (peaks, with a pass `PASS_WIDTH` cells wide every `PASS_EVERY` cells of
/// distance from the spawn), the kind drawn from the seed for each pair of biomes (salt `FEATURE_SALT`): a river, a ridge or none.
const FEATURE_SALT: u64 = 47;
const FEATURE_FROM: i32 = 40;
const PASS_EVERY: i32 = 16;
const PASS_WIDTH: i32 = 3;

/// What marks the border between two biomes of the world `seed` (#1752).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BorderFeature {
    River,
    Ridge,
    Plain,
}

/// The feature of the border between the biomes `a` and `b` of the world `seed`, the same either way round: a third each.
pub fn border_feature(seed: u64, a: Biome, b: Biome) -> BorderFeature {
    let (low, high) = (a.min(b) as i32, a.max(b) as i32);
    let draw = unit(seed, FEATURE_SALT, low * 6 + high, 0);
    if draw < 1.0 / 3.0 {
        BorderFeature::River
    } else if draw < 2.0 / 3.0 {
        BorderFeature::Ridge
    } else {
        BorderFeature::Plain
    }
}

/// The terrain the border feature between `biome` and `other` gives the cell at `from` cells of the spawn: water on a river, a peak on
/// a ridge out of its passes, `None` on a plain border or near the spawn.
fn feature_at(seed: u64, from: i32, biome: Biome, other: Biome) -> Option<Terrain> {
    if from < FEATURE_FROM {
        return None;
    }
    match border_feature(seed, biome, other) {
        BorderFeature::River => Some(Terrain::Water),
        BorderFeature::Ridge if from % PASS_EVERY >= PASS_WIDTH => Some(Terrain::Peak),
        _ => None,
    }
}
/// The biomes by code: tower, lair, log and place `k` are drawn in `BIOMES[k % 6]` (`openworld-terrain.md` section 4).
pub const BIOMES: [Biome; 6] = [
    Biome::Meadow,
    Biome::Forest,
    Biome::Tundra,
    Biome::Desert,
    Biome::Badlands,
    Biome::Archipelago,
];
/// The archipelago's sea: its elevation is the meso and micro levels' alone (no continent, so every seed has islands) lowered
/// by `SEA_DROP`, its tops cut at `ISLAND_TOP` (height 4, below the rock). It comes in by a smoothstep of the sea field.
const SEA_DROP: f64 = 0.19;
const ISLAND_TOP: f64 = 0.58;
/// Upper bounds of the elevation of heights 1 to 7 (height 0 is below the first). They were found by
/// measuring the elevation of chunks -8 to 8 of seeds 1 to 4 (`the_eight_height_levels_hold_their_measured_shares`):
/// their quantiles give the shares of 8, 10, 12, 16, 18, 16, 12 and 8 % per height.
const ELEVATION_STEPS: [f64; 7] = [0.361, 0.430, 0.482, 0.531, 0.581, 0.636, 0.704];
/// The macro level of the elevation is shifted per seed by one of `OFFSET_CANDIDATES` offsets of up to `OFFSET_SPAN`
/// cells (hashed with `OFFSET_SALT`): the first one whose cells of `RING` are all land, else the one with fewest
/// cells that are not. So the spawn and its surroundings are walkable.
const OFFSET_SALT: u64 = 36;
const OFFSET_CANDIDATES: u64 = 16;
const OFFSET_SPAN: i32 = 4096;
/// The cells that must be land: the spawn, the corners of the ring of radius 4 (the clearing's edge), twelve cells
/// on the ring of radius 8 and twelve on the ring of radius 32, corners and edge midpoints.
const RING: [(i32, i32); 30] = [
    (4, 0),
    (0, 4),
    (-4, 4),
    (-4, 0),
    (0, -4),
    (4, -4),
    (32, 0),
    (16, 16),
    (0, 32),
    (-16, 32),
    (-32, 32),
    (-32, 16),
    (-32, 0),
    (-16, -16),
    (0, -32),
    (16, -32),
    (32, -32),
    (32, -16),
    (8, 0),
    (4, 4),
    (0, 8),
    (-4, 8),
    (-8, 8),
    (-8, 4),
    (-8, 0),
    (-4, -4),
    (0, -8),
    (4, -8),
    (8, -8),
    (8, -4),
];
/// The elevations a cell can walk on, heights 2 to 6 (not water, not peak). Fixed numbers, not the measured steps,
/// so that measuring the steps does not move the offsets, which are chosen with them.
const LAND: std::ops::Range<f64> = 0.45..0.70;
/// Moisture below `DRY` makes a rock level (5) sand-coloured rock. It is a quantile of the moisture, measured like the
/// elevation.
const DRY: f64 = 0.422;
/// What a cell looks like and whether it can be entered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Terrain {
    Water,
    Sand,
    Grass,
    Rock,
    Peak,
    Boulder,
    Tree,
    Wall,
}

impl Terrain {
    /// Water, peaks, boulders, trees and walls cannot be entered by an enemy, nor hold a lair, a teleporter or the spawn.
    pub fn blocked(self) -> bool {
        !matches!(self, Terrain::Sand | Terrain::Grass | Terrain::Rock)
    }

    /// Whether the hero and its troop can enter the cell (#1441): the open ground, and water, which they sail on boats.
    pub fn open_to_hero(self) -> bool {
        self == Terrain::Water || !self.blocked()
    }
}

/// The region a cell belongs to: its ground and its obstacle density on the low ground (see `openworld-terrain.md` section 4).
/// The code of a biome is its place in this list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Biome {
    Meadow = 0,
    Forest = 1,
    Tundra = 2,
    Desert = 3,
    Badlands = 4,
    Archipelago = 5,
}

impl Biome {
    /// The chance that a low-ground grass cell is a tree (one draw per cell, salt 6).
    fn tree_chance(self) -> f64 {
        match self {
            Biome::Meadow => 0.02,
            Biome::Forest => 0.25,
            Biome::Tundra => 0.04,
            Biome::Desert | Biome::Badlands => 0.0,
            Biome::Archipelago => 0.05,
        }
    }

    /// The boulders of a low-ground cell, per mille of its draws (salt 4).
    fn boulder_per_mille(self) -> f64 {
        match self {
            Biome::Meadow => 15.0,
            Biome::Forest => 15.0,
            Biome::Tundra => 25.0,
            Biome::Desert => 30.0,
            Biome::Badlands => 45.0,
            Biome::Archipelago => 10.0,
        }
    }
}

/// One cell: its height `0` to `7`, its terrain and its biome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cell {
    pub height: u8,
    pub terrain: Terrain,
    pub biome: Biome,
}

/// A hash of the seed, a purpose `salt` and a point, uniform in `[0, 1)`.
fn unit(seed: u64, salt: u64, x: i32, y: i32) -> f64 {
    let point = (u64::from(x as u32) << 32) | u64::from(y as u32);
    let h = mix(seed ^ salt.wrapping_mul(0xD6E8_FEB8_6659_FD93) ^ mix(point));
    (h >> 11) as f64 / (1u64 << 53) as f64
}

/// Smooth value noise at `(q, r)`: lattice values every `scale` cells, blended with smoothstep. `at`
/// gives the value of a lattice point.
fn noise_at(at: impl Fn(i32, i32) -> f64, q: i32, r: i32, scale: i32) -> f64 {
    let (x, y) = (q.div_euclid(scale), r.div_euclid(scale));
    let smooth = |t: f64| t * t * (3.0 - 2.0 * t);
    let tx = smooth(f64::from(q.rem_euclid(scale)) / f64::from(scale));
    let ty = smooth(f64::from(r.rem_euclid(scale)) / f64::from(scale));
    // Each corner is hashed once (the same values as hashing it for every use).
    let (a, b, c, d) = (at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1));
    let top = a + (b - a) * tx;
    let bottom = c + (d - c) * tx;
    top + (bottom - top) * ty
}

/// Lattice points a chunk spans along one axis: at most 6 for the finest noise (`scale` 5).
const LATTICE: usize = 8;

/// The lattice values of one noise field over one chunk, hashed once for all its cells.
struct Lattice {
    x0: i32,
    y0: i32,
    scale: i32,
    values: [[f64; LATTICE]; LATTICE],
}

impl Lattice {
    /// The lattice of the cells `q0..q0 + CHUNK` by `r0..r0 + CHUNK`, and one cell round them (the neighbours of a border).
    fn new(seed: u64, salt: u64, q0: i32, r0: i32, scale: i32) -> Self {
        let (x0, y0) = ((q0 - 1).div_euclid(scale), (r0 - 1).div_euclid(scale));
        let x1 = (q0 + CHUNK).div_euclid(scale) + 1;
        let y1 = (r0 + CHUNK).div_euclid(scale) + 1;
        debug_assert!(x1 - x0 < LATTICE as i32 && y1 - y0 < LATTICE as i32);
        let mut values = [[0.0; LATTICE]; LATTICE];
        for y in y0..=y1 {
            for x in x0..=x1 {
                values[(y - y0) as usize][(x - x0) as usize] = unit(seed, salt, x, y);
            }
        }
        Lattice {
            x0,
            y0,
            scale,
            values,
        }
    }

    fn noise(&self, q: i32, r: i32) -> f64 {
        noise_at(
            |x, y| self.values[(y - self.y0) as usize][(x - self.x0) as usize],
            q,
            r,
            self.scale,
        )
    }
}

/// The axial distance from `(0, 0)`.
fn distance(q: i32, r: i32) -> i32 {
    (q.abs() + r.abs() + (q + r).abs()) / 2
}

/// The smoothstep of `t` clamped to `[0, 1]`.
fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The elevation at `(q, r)` from the seed alone, with the macro level shifted by `shift`: the same values as the
/// chunk lattices, so the land test sees the world the chunks show.
fn elevation_at(seed: u64, q: i32, r: i32, shift: (i32, i32)) -> f64 {
    let level = |i: usize, (dq, dr): (i32, i32)| {
        noise_at(
            |x, y| unit(seed, HEIGHT_SALT + i as u64, x, y),
            q + dq,
            r + dr,
            LEVEL_SCALES[i],
        )
    };
    HEIGHT_WEIGHTS[0] * level(0, shift)
        + HEIGHT_WEIGHTS[1] * level(1, (0, 0))
        + HEIGHT_WEIGHTS[2] * level(2, (0, 0))
}

/// The last seed whose macro shift was searched, with its shift: a pure memo, so the chunks of one world search once.
/// A lock keeps a racing thread from reading one seed with another seed's shift.
static LAST_SHIFT: Mutex<Option<(u64, (i32, i32))>> = Mutex::new(None);

/// The macro shift of `seed`, from `LAST_SHIFT` when it is the same seed.
fn macro_shift(seed: u64) -> (i32, i32) {
    let known = *LAST_SHIFT.lock().unwrap_or_else(PoisonError::into_inner);
    match known {
        Some((known, shift)) if known == seed => shift,
        _ => {
            let shift = search_shift(seed);
            *LAST_SHIFT.lock().unwrap_or_else(PoisonError::into_inner) = Some((seed, shift));
            shift
        }
    }
}

/// The search of the macro shift of `seed` (see `OFFSET_CANDIDATES`). `min_by_key` keeps the first candidate with
/// the fewest cells of `RING` that are not land.
fn search_shift(seed: u64) -> (i32, i32) {
    let candidate = |c: u64| {
        let c = c as i32;
        let span = f64::from(OFFSET_SPAN);
        let shift = (
            (unit(seed, OFFSET_SALT, c, 0) * span) as i32,
            (unit(seed, OFFSET_SALT, c, 1) * span) as i32,
        );
        let missing = std::iter::once((0, 0))
            .chain(RING)
            .filter(|&(q, r)| !LAND.contains(&elevation_at(seed, q, r, shift)))
            .count();
        (missing, shift)
    };
    (0..OFFSET_CANDIDATES)
        .map(candidate)
        .min_by_key(|&(missing, _)| missing)
        .map_or((0, 0), |(_, shift)| shift)
}

/// The climate of a cell (#1755): its temperature, its wetness and the sea field, each from 0 to 1.
#[derive(Clone, Copy)]
struct Climate {
    temperature: f64,
    wetness: f64,
    sea: f64,
}

impl Climate {
    /// The biome of this climate: the archipelago where the sea field is high, else tundra when cold, desert or badlands when hot
    /// (dry or not), forest when temperate and wet, meadow otherwise. The temperature is continuous, so a temperate band always
    /// lies between the tundra and the desert.
    fn biome(self) -> Biome {
        if self.sea > SEA_LEVEL {
            Biome::Archipelago
        } else if self.temperature < COLD {
            Biome::Tundra
        } else if self.temperature > HOT {
            if self.wetness < HOT_DRY {
                Biome::Desert
            } else {
                Biome::Badlands
            }
        } else if self.wetness > FOREST_WET {
            Biome::Forest
        } else {
            Biome::Meadow
        }
    }

    /// How deep the cell lies in the archipelago's sea, from 0 to 1: it grows over `SEA_EDGE` either side of `SEA_LEVEL`.
    fn depth(self) -> f64 {
        smoothstep((self.sea - SEA_LEVEL + SEA_EDGE) / (2.0 * SEA_EDGE))
    }

    /// The same climate moved by `by` in all three fields: the dither of a border.
    fn moved(self, by: f64) -> Climate {
        Climate {
            temperature: self.temperature + by,
            wetness: self.wetness + by,
            sea: self.sea + by,
        }
    }
}

/// The climate at `(q, r)` from the seed alone, the map shifted by `shift`: the same values as the chunk lattices.
fn climate_at(seed: u64, q: i32, r: i32, shift: (i32, i32)) -> Climate {
    let field = |salt: u64| {
        (0..3)
            .map(|i| {
                CLIMATE_WEIGHTS[i]
                    * noise_at(
                        |x, y| unit(seed, salt + i as u64, x, y),
                        q + shift.0,
                        r + shift.1,
                        CLIMATE_SCALES[i],
                    )
            })
            .sum::<f64>()
    };
    Climate {
        temperature: field(TEMP_SALT),
        wetness: field(WET_SALT),
        sea: field(SEA_SALT),
    }
}

/// The climate shifts searched so far, by seed (a pure memo of up to `CLIMATE_KEPT`, enough for the sweeps of 2000 seeds the tests
/// run: the chunks of one world search once, and so does every test that reads the same seed). A lock keeps a racing thread from
/// reading another seed's shift.
static CLIMATE_SHIFTS: Mutex<Option<HashMap<u64, (i32, i32)>>> = Mutex::new(None);
const CLIMATE_KEPT: usize = 4096;

/// Remembers `shift` for `seed`, the memo emptied first when it already holds `kept` seeds.
fn remember_shift(
    shifts: &mut HashMap<u64, (i32, i32)>,
    kept: usize,
    seed: u64,
    shift: (i32, i32),
) {
    if shifts.len() >= kept {
        shifts.clear();
    }
    shifts.insert(seed, shift);
}

/// The climate shift of `seed`, from `CLIMATE_SHIFTS` when it is known.
fn climate_shift(seed: u64) -> (i32, i32) {
    let known = CLIMATE_SHIFTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .and_then(|shifts| shifts.get(&seed).copied());
    known.unwrap_or_else(|| {
        let shift = search_climate(seed);
        let mut shifts = CLIMATE_SHIFTS
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        remember_shift(
            shifts.get_or_insert_with(HashMap::new),
            CLIMATE_KEPT,
            seed,
            shift,
        );
        shift
    })
}

/// The `count` points of the ring `reach` ground units from the spawn.
/// The biome the smooth climate gives the cell `(q, r)`, without the dither of its border: a cheap first look for the draws of the lairs,
/// the logs and the places, which then read the cell itself.
fn climate_biome(seed: u64, q: i32, r: i32) -> Biome {
    climate_at(seed, q, r, climate_shift(seed)).biome()
}

fn ring_points(reach: f64, count: u32) -> impl Iterator<Item = (i32, i32)> {
    (0..count).map(move |k| {
        let angle = f64::from(k) * std::f64::consts::TAU / f64::from(count);
        // The pointy-top layout of the client's `cellAtPoint`, as the lairs.
        let r = (-reach * angle.sin() / (3f64.sqrt() / 2.0)).round() as i32;
        ((reach * angle.cos() - f64::from(r) / 2.0).round() as i32, r)
    })
}

/// The search of the climate shift of `seed` (see `CLIMATE_CANDIDATES`). A candidate is scored on the biomes met at the points of
/// `CLIMATE_NEAR` (where the near logs and the towns are drawn) and of `CLIMATE_FAR` (the lairs, the far logs and the gates): first the
/// spawn and the ring of 10 cells round it all meadow (the start), then the count of the rarest biome on each, capped at `NEAR_ENOUGH` and `FAR_ENOUGH`, so no biome is missing or rare where something is
/// drawn; then the meadow among the spawn and the rings round it; then the uncapped counts. The first of equals.
fn search_climate(seed: u64) -> (i32, i32) {
    let points = |rings: &[(f64, u32)]| -> Vec<(i32, i32)> {
        rings
            .iter()
            .flat_map(|&(reach, count)| ring_points(reach, count))
            .collect()
    };
    let (near, far) = (points(&CLIMATE_NEAR), points(&CLIMATE_FAR));
    let home: Vec<(i32, i32)> = std::iter::once((0, 0))
        .chain(ring_points(f64::from(HOME_RING), 6))
        .collect();
    let shift_of = |c: u64| {
        let c = c as i32;
        let span = f64::from(OFFSET_SPAN);
        (
            (unit(seed, CLIMATE_SALT, c, 0) * span) as i32,
            (unit(seed, CLIMATE_SALT, c, 1) * span) as i32,
        )
    };
    let fits = |shift: (i32, i32)| {
        let biome = |&(q, r): &(i32, i32)| climate_at(seed, q, r, shift).biome();
        let rarest = |points: &[(i32, i32)]| {
            let mut seen = [0; 6];
            for b in points.iter().map(biome) {
                seen[b as usize] += 1;
            }
            seen.into_iter().min().unwrap_or(0)
        };
        // Cheapest test first: most candidates fail the meadow at the start.
        home.iter().all(|p| biome(p) == Biome::Meadow)
            && rarest(&near) >= NEAR_ENOUGH
            && rarest(&far) >= FAR_ENOUGH
    };
    (0..CLIMATE_CANDIDATES)
        .map(shift_of)
        .find(|&shift| fits(shift))
        .unwrap_or(shift_of(0))
}

/// Whether the cell `(q, r)` is in the world: the one test of the edge, for the cells, the chunks, the enemies, the lairs and
/// the teleporters.
fn in_world(q: i32, r: i32) -> bool {
    distance(q, r) <= WORLD_RADIUS
}

/// Whether some cell of chunk `(cx, cy)` is in the world: its cell nearest the spawn is. A chunk never straddles an axis, and on
/// one side of both axes the distance grows with `|q|` and with `|r|`, so that cell has the coordinates nearest 0.
fn chunk_in_world(cx: i32, cy: i32) -> bool {
    let near = |c: i32| {
        if c < 0 {
            c * CHUNK + CHUNK - 1
        } else {
            c * CHUNK
        }
    };
    in_world(near(cx), near(cy))
}

/// The ruined wall of the square `(x, y)` of the `WALL_BLOCK` grid: its first cell, its step and its
/// length. Most squares have none.
struct Segment {
    start: (i32, i32),
    step: (i32, i32),
    len: i32,
}

fn wall_segment(seed: u64, x: i32, y: i32) -> Option<Segment> {
    if unit(seed, 7, x, y) >= 0.45 {
        return None;
    }
    let start = (
        x * WALL_BLOCK + (unit(seed, 8, x, y) * f64::from(WALL_BLOCK)) as i32,
        y * WALL_BLOCK + (unit(seed, 9, x, y) * f64::from(WALL_BLOCK)) as i32,
    );
    let step = [(1, 0), (0, 1), (1, -1)][(unit(seed, 10, x, y) * 3.0) as usize];
    let len = 3 + (unit(seed, 11, x, y) * 4.0) as i32;
    Some(Segment { start, step, len })
}

/// A field: value noise at the three `LEVEL_SCALES`, the level `i` from the salt `salt + i`, summed with
/// `weights`. Every node of every level is hashed once per chunk.
struct Field {
    levels: [Lattice; 3],
    /// The offset of each level in cells: only the macro level can have one.
    shifts: [(i32, i32); 3],
    weights: [f64; 3],
}

impl Field {
    /// The field of the chunk at `(q0, r0)`, its macro level shifted by `shift` cells.
    fn new(seed: u64, salt: u64, q0: i32, r0: i32, weights: [f64; 3], shift: (i32, i32)) -> Self {
        Self::with_scales(seed, salt, q0, r0, weights, shift, LEVEL_SCALES)
    }

    /// The same with its own `scales` for the three levels.
    fn with_scales(
        seed: u64,
        salt: u64,
        q0: i32,
        r0: i32,
        weights: [f64; 3],
        shift: (i32, i32),
        scales: [i32; 3],
    ) -> Self {
        let shifts = [shift, (0, 0), (0, 0)];
        Field {
            levels: std::array::from_fn(|i| {
                Lattice::new(
                    seed,
                    salt + i as u64,
                    q0 + shifts[i].0,
                    r0 + shifts[i].1,
                    scales[i],
                )
            }),
            shifts,
            weights,
        }
    }

    fn value(&self, q: i32, r: i32) -> f64 {
        self.levels
            .iter()
            .zip(self.shifts)
            .zip(self.weights)
            .map(|((level, (dq, dr)), weight)| weight * level.noise(q + dq, r + dr))
            .sum()
    }
}

/// Everything the cells of one chunk need, computed once: the fields and the walls.
struct Window {
    seed: u64,
    q0: i32,
    r0: i32,
    /// Elevation, which gives the height.
    height: Field,
    /// Moisture, which gives the dry rock.
    moisture: Field,
    /// The temperature, the wetness and the sea field, over the map shifted by `shift`.
    climate: [Field; 3],
    shift: (i32, i32),
    /// Whether each cell of the chunk is on a wall, row by row.
    wall: [bool; (CHUNK * CHUNK) as usize],
}

impl Window {
    fn new(seed: u64, cx: i32, cy: i32) -> Self {
        let (q0, r0) = (cx * CHUNK, cy * CHUNK);
        let mut wall = [false; (CHUNK * CHUNK) as usize];
        // A segment reaches at most one square past its own along each axis, so the squares one
        // step around the chunk's squares hold every segment that crosses it.
        let (x0, y0) = (q0.div_euclid(WALL_BLOCK) - 1, r0.div_euclid(WALL_BLOCK) - 1);
        let x1 = (q0 + CHUNK - 1).div_euclid(WALL_BLOCK) + 1;
        let y1 = (r0 + CHUNK - 1).div_euclid(WALL_BLOCK) + 1;
        for x in x0..=x1 {
            for y in y0..=y1 {
                let Some(seg) = wall_segment(seed, x, y) else {
                    continue;
                };
                for k in 0..seg.len {
                    let (q, r) = (seg.start.0 + k * seg.step.0, seg.start.1 + k * seg.step.1);
                    if (q0..q0 + CHUNK).contains(&q) && (r0..r0 + CHUNK).contains(&r) {
                        wall[((r - r0) * CHUNK + (q - q0)) as usize] = true;
                    }
                }
            }
        }
        let shift = climate_shift(seed);
        Window {
            seed,
            q0,
            r0,
            height: Field::new(seed, HEIGHT_SALT, q0, r0, HEIGHT_WEIGHTS, macro_shift(seed)),
            moisture: Field::new(seed, MOISTURE_SALT, q0, r0, MOISTURE_WEIGHTS, (0, 0)),
            climate: [TEMP_SALT, WET_SALT, SEA_SALT].map(|salt| {
                Field::with_scales(
                    seed,
                    salt,
                    q0 + shift.0,
                    r0 + shift.1,
                    CLIMATE_WEIGHTS,
                    (0, 0),
                    CLIMATE_SCALES,
                )
            }),
            shift,
            wall,
        }
    }

    /// The climate at `(q, r)`, which lies in this chunk or one cell round it.
    fn climate(&self, q: i32, r: i32) -> Climate {
        let [temperature, wetness, sea] = self
            .climate
            .each_ref()
            .map(|field| field.value(q + self.shift.0, r + self.shift.1));
        Climate {
            temperature,
            wetness,
            sea,
        }
    }

    /// The biome of `(q, r)` and how deep it lies in the archipelago's sea, from 0 to 1. The biome is the climate's, moved by a
    /// draw of up to `BLEND` so two biomes mix along their border.
    fn biome(&self, q: i32, r: i32) -> (Biome, f64) {
        let climate = self.climate(q, r);
        let dither = (unit(self.seed, BLEND_SALT, q, r) - 0.5) * 2.0 * BLEND;
        (climate.moved(dither).biome(), climate.depth())
    }

    /// The first biome other than the cell's own among its six neighbours (the climate, not dithered), the border it lies on.
    fn neighbour_biome(&self, q: i32, r: i32) -> Option<(Biome, Biome)> {
        let own = self.climate(q, r).biome();
        STEPS
            .iter()
            .map(|&(dq, dr)| self.climate(q + dq, r + dr).biome())
            .find(|&other| other != own)
            .map(|other| (own, other))
    }

    /// The cell at `(q, r)`, which must lie in this chunk.
    fn cell(&self, q: i32, r: i32) -> Cell {
        if distance(q, r) <= CLEARING {
            return Cell {
                height: 3,
                terrain: Terrain::Grass,
                biome: Biome::Meadow,
            };
        }
        let (biome, sea) = self.biome(q, r);
        let from = distance(q, r);
        let marked = if from < FEATURE_FROM {
            None
        } else {
            self.neighbour_biome(q, r)
        };
        if let Some(terrain) =
            marked.and_then(|(own, other)| feature_at(self.seed, from, own, other))
        {
            let height = if terrain == Terrain::Water { 1 } else { 7 };
            return Cell {
                height,
                terrain,
                biome,
            };
        }
        let elevation = self.height.value(q, r);
        let island = (HEIGHT_WEIGHTS[1] * self.height.levels[1].noise(q, r)
            + HEIGHT_WEIGHTS[2] * self.height.levels[2].noise(q, r))
            / (HEIGHT_WEIGHTS[1] + HEIGHT_WEIGHTS[2])
            - SEA_DROP;
        let elevation = (elevation + (island - elevation) * sea)
            .min(ISLAND_TOP + (1.0 - ISLAND_TOP) * (1.0 - sea));
        let height = ELEVATION_STEPS
            .iter()
            .filter(|&&step| elevation >= step)
            .count() as u8;
        let moisture = self.moisture.value(q, r);
        let terrain = match height {
            0 | 1 => Terrain::Water,
            2 => Terrain::Sand,
            3 | 4 => Terrain::Grass,
            5 if moisture < DRY => Terrain::Rock,
            5 => Terrain::Grass,
            6 => Terrain::Rock,
            _ => Terrain::Peak,
        };
        let open = !terrain.blocked();
        let low = (3..=4).contains(&height);
        let on_wall = self.wall[((r - self.r0) * CHUNK + (q - self.q0)) as usize];
        // The obstacles of the low ground follow the biome; the uplands and the shore keep the same density everywhere.
        let (tree, per_mille) = if low {
            (biome.tree_chance(), biome.boulder_per_mille())
        } else {
            (0.0, UPLAND_BOULDER_PER_MILLE)
        };
        let terrain = if open && on_wall {
            Terrain::Wall
        } else if terrain == Terrain::Grass && unit(self.seed, 6, q, r) < tree {
            Terrain::Tree
        } else if open && unit(self.seed, 4, q, r) * 1000.0 < per_mille {
            Terrain::Boulder
        } else {
            terrain
        };
        Cell {
            height,
            terrain,
            biome,
        }
    }
}

/// The cell at `(q, r)` of the world of `seed`, `None` off the world.
pub fn cell(seed: u64, q: i32, r: i32) -> Option<Cell> {
    if !in_world(q, r) {
        return None;
    }
    let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
    // The cells asked one after the other (the neighbours of a place, a flood fill, a walk) lie in a few chunks: their windows are kept.
    let window = {
        let mut windows = WINDOWS.lock().unwrap_or_else(PoisonError::into_inner);
        let windows = windows.get_or_insert_with(HashMap::new);
        if windows.len() >= WINDOWS_KEPT {
            windows.clear();
        }
        Arc::clone(
            windows
                .entry((seed, cx, cy))
                .or_insert_with(|| Arc::new(Window::new(seed, cx, cy))),
        )
    };
    Some(window.cell(q, r))
}

/// The most windows `cell` keeps.
const WINDOWS_KEPT: usize = 256;

/// The windows of the chunks `cell` read lately.
static WINDOWS: Mutex<Option<WindowMemo>> = Mutex::new(None);
type WindowMemo = HashMap<(u64, i32, i32), Arc<Window>>;

/// Whether a marble may not stand on a cell of chunk `(cx, cy)` of the world `seed`: it is off the world, or its terrain is blocked
/// (`Terrain::blocked`). One window is built for the chunk, so many cells cost one generation (the wandering marbles, #1511).
pub fn chunk_blocked(seed: u64, cx: i32, cy: i32) -> impl Fn(i32, i32) -> bool {
    let window = Window::new(seed, cx, cy);
    move |q, r| !in_world(q, r) || window.cell(q, r).terrain.blocked()
}

/// The `CHUNK` x `CHUNK` cells of chunk `(cx, cy)`, row by row (`r` then `q` ascending), `None`
/// off the world. In a chunk the edge crosses, the cells past it are `None`.
pub fn chunk(seed: u64, cx: i32, cy: i32) -> Option<Vec<Option<Cell>>> {
    if !chunk_in_world(cx, cy) {
        return None;
    }
    let window = Window::new(seed, cx, cy);
    let mut cells = Vec::with_capacity((CHUNK * CHUNK) as usize);
    for dr in 0..CHUNK {
        for dq in 0..CHUNK {
            let (q, r) = (cx * CHUNK + dq, cy * CHUNK + dr);
            cells.push(in_world(q, r).then(|| window.cell(q, r)));
        }
    }
    Some(cells)
}

/// The enemy groups that start in chunk `(cx, cy)` (docs/specs/openworld.md section 3): up to `TRIES` groups
/// of 1 to 3 marbles in a line on three axes, from the seed and the chunk alone. A group is placed only
/// when every one of its cells is in this chunk and in the world, open, off the spawn's `SAFE` radius and shared with no
/// group placed before it in the chunk; the others are dropped.
pub fn enemy_groups(seed: u64, cx: i32, cy: i32) -> Vec<Vec<(i32, i32)>> {
    if !chunk_in_world(cx, cy) {
        return vec![];
    }
    let window = Window::new(seed, cx, cy);
    let mut placed: Vec<Vec<(i32, i32)>> = Vec::new();
    for n in 0..TRIES {
        let draw = |salt: u64| unit(seed, 12 + 5 * n + salt, cx, cy);
        if draw(0) * 1000.0 >= GROUP_PER_MILLE {
            continue;
        }
        let q = cx * CHUNK + (draw(1) * f64::from(CHUNK)) as i32;
        let r = cy * CHUNK + (draw(2) * f64::from(CHUNK)) as i32;
        let (dq, dr) = [(1, 0), (0, 1), (1, -1)][(draw(3) * 3.0) as usize];
        let len = 1 + (draw(4) * 3.0) as i32;
        let group: Vec<(i32, i32)> = (0..len).map(|k| (q + k * dq, r + k * dr)).collect();
        let free = group.iter().all(|&(q, r)| {
            q.div_euclid(CHUNK) == cx
                && r.div_euclid(CHUNK) == cy
                && in_world(q, r)
                && distance(q, r) > SAFE
                && !window.cell(q, r).terrain.blocked()
                && !placed.iter().flatten().any(|&taken| taken == (q, r))
        });
        if free {
            placed.push(group);
        }
    }
    placed
}

/// A lair stands at least this many cells from the spawn.
pub const LAIR_MIN: i32 = 150;
/// The salt of the lair draws (the terrain uses 30 to 39, the enemies 12 to 21).
const LAIR_SALT: u64 = 40;
/// The distance of a lair from the spawn is drawn in ground units between these two (the corners of the hexagon are `WORLD_RADIUS`
/// away, the middles of its sides about 388): a draw off the world is drawn again.
/// Two lairs stand at least this many cells apart (#1755: a biome is a patch now, not a wedge that shares its lairs out).
const LAIR_SPACE: i32 = 24;
const LAIR_NEAR: f64 = 160.0;
const LAIR_FAR: f64 = 420.0;

/// The cells of the `count` boss lairs of the world `seed` (docs/specs/openworld.md section 7), one per boss of the roster: lair `k`
/// is drawn in the biome `k % 6` (#1755), in the `k / 6`-th of its share of the range of distance, the first draw whose cell and six
/// neighbours are open ground on the world, of that biome, at least `LAIR_MIN` cells from the spawn and `LAIR_SPACE` from the lairs before it. So each biome holds
/// two lairs or more of a roster of 12. From the seed alone, so the order of visit of the chunks does not matter.
pub fn lairs(seed: u64, count: usize) -> Vec<(i32, i32)> {
    let mut found: Vec<(i32, i32)> = Vec::with_capacity(count);
    for k in 0..count as i32 {
        let apart =
            |&(q, r): &(i32, i32)| found.iter().all(|&o| hex_distance(o, (q, r)) >= LAIR_SPACE);
        let lair = (0..LAIR_TRIES)
            .find_map(|n| lair_try(seed, count, k, n).filter(apart))
            .expect("a fit lair in its biome");
        found.push(lair);
    }
    found
}

/// The roster's bosses, by their number in `boss_ids()`, from the easiest tower to the hardest (docs/specs/openworld.md section 15).
pub const TOWER_ORDER: [usize; 15] = [0, 5, 8, 10, 12, 13, 3, 9, 11, 14, 6, 4, 7, 1, 2];
/// The towers of one ring, and so of one tier.
pub const RING_SIZE: usize = 3;

/// The cell of the tower of each boss of the roster, boss 0 first (docs/specs/openworld.md section 15): the cells of `lairs` do not
/// move, the boss of `TOWER_ORDER[i]` stands on the `i`-th nearest to the spawn (hex distance, a tie goes to the lower lair). So lair
/// `k` of the client is still the boss `k`: a save's beaten lairs and a medal keep their boss. From the seed alone.
pub fn towers(seed: u64) -> Vec<(i32, i32)> {
    towers_on(&lairs(seed, TOWER_ORDER.len()))
}

/// `towers` from the cells of the 15 lairs.
fn towers_on(cells: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let mut nearest: Vec<usize> = (0..cells.len()).collect();
    nearest.sort_by_key(|&i| (hex_distance((0, 0), cells[i]), i));
    let mut found = vec![(0, 0); cells.len()];
    for (&boss, &lair) in TOWER_ORDER.iter().zip(&nearest) {
        found[boss] = cells[lair];
    }
    found
}

/// The ring, and so the tier, of the tower of the boss `boss`: 1 for the nearest `RING_SIZE` towers, up to 5.
pub fn tower_ring(boss: usize) -> u8 {
    let place = TOWER_ORDER
        .iter()
        .position(|&b| b == boss)
        .expect("a boss of the roster");
    (place / RING_SIZE) as u8 + 1
}

/// The ring, and so the dungeon tier, of a gate on `cell`: that of a tower as far from the spawn, the number of `towers` nearer
/// to it counted by `RING_SIZE`, the last ring past the last tower.
pub fn gate_ring(towers: &[(i32, i32)], cell: (i32, i32)) -> u8 {
    let d = hex_distance((0, 0), cell);
    let nearer = towers
        .iter()
        .filter(|&&t| hex_distance((0, 0), t) < d)
        .count();
    (nearer.min(TOWER_ORDER.len() - 1) / RING_SIZE) as u8 + 1
}

/// The pad a tower beaten through the world leaves (docs/specs/openworld.md section 16): a teleporter on the first of the tower's six
/// neighbours, in the order of `STEPS`, that is open ground and holds no generated enemy, so the hero can come back to that part of the
/// world. A tower's neighbours are all open ground of its biome (`lair_try`), so the search ends in six looks; if every one held an enemy
/// the first would take it. From the seed alone: it reads the terrain and the enemies, never changes them, so `WORLD_VERSION` does not move.
pub fn tower_pad(seed: u64, tower: (i32, i32)) -> (i32, i32) {
    let next = |(dq, dr): (i32, i32)| (tower.0 + dq, tower.1 + dr);
    STEPS
        .into_iter()
        .map(next)
        .filter(|&(q, r)| cell(seed, q, r).is_some_and(|c| !c.terrain.blocked()))
        .min_by_key(|&(q, r)| is_enemy(seed, q, r))
        .expect("a tower stands on open ground")
}

/// A lair is drawn in its share of the range for its first `LAIR_SLOT_TRIES` tries (the most any seed of 1 to 2000 but 711 needs is
/// 5 666), then in the whole range (#1594: the third of seed 711's range that lair 14 is drawn in holds no open ground). So the
/// lairs of a seed that found them in the share do not move. The search ends after `LAIR_TRIES` tries.
const LAIR_SLOT_TRIES: i32 = 8000;
const LAIR_TRIES: i32 = 40_000;

/// The `n`-th try of lair `k`: its cell when it is a fit one.
fn lair_try(seed: u64, count: usize, k: i32, n: i32) -> Option<(i32, i32)> {
    let (biome, nth) = (BIOMES[k as usize % 6], f64::from(k / 6));
    let shares = (count / 6 + usize::from((k as usize % 6) < count % 6)) as f64;
    let slot = if n < LAIR_SLOT_TRIES {
        (nth + 0.2 + 0.6 * unit(seed, LAIR_SALT + 1, k, n)) / shares
    } else {
        unit(seed, LAIR_SALT + 1, k, n) // the whole range
    };
    let angle = std::f64::consts::TAU * unit(seed, LAIR_SALT, k, n);
    let reach = LAIR_NEAR + (LAIR_FAR - LAIR_NEAR) * slot;
    // The pointy-top layout of the client's `cellAtPoint`: x runs along q, z along the rows, the north up.
    let r = (-reach * angle.sin() / (3f64.sqrt() / 2.0)).round() as i32;
    let q = (reach * angle.cos() - f64::from(r) / 2.0).round() as i32;
    let open = |(dq, dr): (i32, i32)| {
        cell(seed, q + dq, r + dr).is_some_and(|c| !c.terrain.blocked() && c.biome == biome)
    };
    let fit = distance(q, r) >= LAIR_MIN
        && climate_biome(seed, q, r) == biome
        && [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)]
            .into_iter()
            .all(open);
    fit.then_some((q, r))
}

/// The teleporters (#1412, docs/specs/openworld.md section 10): one in each square of `TELEPORT_BLOCK` x `TELEPORT_BLOCK` chunks, the
/// squares centred on the spawn's, whose own teleporter is `SPAWN_TELEPORTER`, in the clearing. 8 since #1444 (4 before): a quarter as
/// many.
pub const TELEPORT_BLOCK: i32 = 8;
/// The middle of a square, `TELEPORT_MIDDLE` x `TELEPORT_MIDDLE` chunks, where its teleporter is drawn: half its side, so two
/// teleporters are at least half a square apart, 64 cells.
const TELEPORT_MIDDLE: i32 = TELEPORT_BLOCK / 2;
pub const SPAWN_TELEPORTER: (i32, i32) = (2, -1);
/// The salts of the teleporter draws: the chunk of the square, then the `q` and the `r` of a try.
const TELEPORT_SALT: u64 = 42;
/// The cells a square tries in each of its chunks before the next one.
const TELEPORT_TRIES: i32 = 24;
/// A teleporter and its six neighbours, which are open ground.
const TELEPORT_PAD: [(i32, i32); 7] = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)];

/// The teleporters of the world `seed`, the spawn's first, then a square after the other, row by row: a square's teleporter is the
/// first try of its middle `TELEPORT_MIDDLE` x `TELEPORT_MIDDLE` chunks (from a drawn one) whose cell and six neighbours are open
/// ground in the world, with no generated enemy within 2 cells and no cell of `avoid` (the lairs) within 3. A square with no fit try
/// has none. From the seed alone: it reads the terrain and the enemies, never changes them, so `WORLD_VERSION` does not move.
pub fn teleporters(seed: u64, avoid: &[(i32, i32)]) -> Vec<(i32, i32)> {
    // The farthest square whose middle chunks reach the hexagon along an axis.
    let (middle, half) = (TELEPORT_MIDDLE, TELEPORT_MIDDLE / 2);
    let span = (WORLD_RADIUS / CHUNK + half) / TELEPORT_BLOCK;
    let squares = (-span..=span).flat_map(|by| (-span..=span).map(move |bx| (bx, by)));
    let drawn = squares
        .filter(|&square| square != (0, 0))
        .filter_map(|(bx, by)| {
            let chunks = middle * middle;
            let first = (unit(seed, TELEPORT_SALT, bx, by) * f64::from(chunks)) as i32;
            (first..first + chunks).find_map(|k| {
                let (dx, dy) = (k % middle, k / middle % middle);
                let (cx, cy) = (
                    bx * TELEPORT_BLOCK - half + dx,
                    by * TELEPORT_BLOCK - half + dy,
                );
                teleporter_in(seed, cx, cy, avoid)
            })
        });
    std::iter::once(SPAWN_TELEPORTER).chain(drawn).collect()
}

/// The first fit try of a teleporter in chunk `(cx, cy)`, `None` off the world or when none fits. A try lies 2 cells or more inside
/// the chunk, so its pad and the cells round it within 2 are the chunk's own.
fn teleporter_in(seed: u64, cx: i32, cy: i32, avoid: &[(i32, i32)]) -> Option<(i32, i32)> {
    if !chunk_in_world(cx, cy) {
        return None;
    }
    let window = Window::new(seed, cx, cy);
    let enemies = enemy_groups(seed, cx, cy).concat();
    (0..TELEPORT_TRIES).find_map(|n| {
        let draw =
            |salt: u64| 2 + (unit(seed, salt, n, cx * 4096 + cy) * f64::from(CHUNK - 4)) as i32;
        let at = (
            cx * CHUNK + draw(TELEPORT_SALT + 1),
            cy * CHUNK + draw(TELEPORT_SALT + 2),
        );
        let fit = TELEPORT_PAD.iter().all(|&(dq, dr)| {
            let (q, r) = (at.0 + dq, at.1 + dr);
            in_world(q, r) && !window.cell(q, r).terrain.blocked()
        }) && enemies.iter().all(|&enemy| hex_distance(enemy, at) > 2)
            && avoid.iter().all(|&cell| hex_distance(cell, at) > 3);
        fit.then_some(at)
    })
}

/// The lore logs placed in a world (#1589, docs/specs/openworld.md section 12): two in each biome, one near the spawn and one far.
pub const LOGS: usize = 12;
/// The salt of the log draws: the angle, then the distance from the spawn.
const LOG_SALT: u64 = 50;
/// The distance of a log from the spawn in ground units, drawn between these two, by ring: the near ring stays inside the lairs' (`LAIR_NEAR`).
const LOG_RINGS: [(f64, f64); 2] = [(30.0, 140.0), (160.0, 420.0)];

/// The cells of the `LOGS` lore logs of the world `seed`: log `k` is drawn in the biome `k % 6` (ring `k / 6`, near then far), the first
/// draw whose cell and six neighbours are open ground of that biome, off the spawn's `SAFE` radius, 2 cells or more inside its
/// chunk with no generated enemy within 2 cells, and no cell of `avoid` (the lairs and the teleporters) within 3. From the seed alone: it
/// reads the terrain and the enemies, never changes them, so `WORLD_VERSION` does not move. Log `k` is the `k`-th of the answer, `None` for a
/// log that has no fit (see `LOG_TRIES`), so the others keep their numbers.
pub fn logs(seed: u64, avoid: &[(i32, i32)]) -> Vec<Option<(i32, i32)>> {
    (0..LOGS as i32)
        .map(|k| (0..LOG_TRIES).find_map(|n| log_try(seed, k, n, avoid)))
        .collect()
}

/// A log is drawn in its own ring (`LOG_RINGS`) of its biome; the outer end of the ring grows by 1 ground unit every 2 tries, up to the
/// lairs' `LAIR_FAR`, as the places' rings do (#1755: a biome is a patch now, so the near ring may hold none of it). The search ends
/// after `LOG_TRIES` tries and a log with no fit is left out (`None`, the others keep their numbers).
const LOG_TRIES: i32 = 60_000;

/// The `n`-th try of log `k`: its cell when it is a fit one.
fn log_try(seed: u64, k: i32, n: i32, avoid: &[(i32, i32)]) -> Option<(i32, i32)> {
    let (biome, (near, far)) = (BIOMES[k as usize % 6], LOG_RINGS[k as usize / 6]);
    let ring = (near, (far + f64::from(n) / 2.0).min(LAIR_FAR));
    spot(seed, LOG_SALT, k, n, biome, ring, avoid)
}

/// The `n`-th try of the spot `k` drawn from `salt` in the biome, 30 to 140 or 160 to 420 ground units out (`reach`): its cell
/// when it is a fit one. The cell and its six neighbours are open ground of the biome, off the spawn's `SAFE` radius, 2 cells
/// or more inside its chunk with no generated enemy within 2 cells, and no cell of `avoid` within 3. Logs, towns and dungeon gates use it.
fn spot(
    seed: u64,
    salt: u64,
    k: i32,
    n: i32,
    biome: Biome,
    (near, far): (f64, f64),
    avoid: &[(i32, i32)],
) -> Option<(i32, i32)> {
    let angle = std::f64::consts::TAU * unit(seed, salt, k, n);
    let reach = near + (far - near) * unit(seed, salt + 1, k, n);
    // The pointy-top layout of the client's `cellAtPoint`, as the lairs.
    let r = (-reach * angle.sin() / (3f64.sqrt() / 2.0)).round() as i32;
    let q = (reach * angle.cos() - f64::from(r) / 2.0).round() as i32;
    let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
    let inside = |v: i32| (2..CHUNK - 2).contains(&v.rem_euclid(CHUNK));
    let open = |&(dq, dr): &(i32, i32)| {
        cell(seed, q + dq, r + dr).is_some_and(|c| !c.terrain.blocked() && c.biome == biome)
    };
    let fit = distance(q, r) > SAFE
        && inside(q)
        && inside(r)
        && climate_biome(seed, q, r) == biome
        && TELEPORT_PAD.iter().all(open)
        && avoid.iter().all(|&cell| hex_distance(cell, (q, r)) > 3)
        && enemy_groups(seed, cx, cy)
            .concat()
            .iter()
            .all(|&enemy| hex_distance(enemy, (q, r)) > 2);
    fit.then_some((q, r))
}

/// What a place of the world is (#1514, docs/specs/openworld.md section 13). The bridge passes it as its number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaceKind {
    Town = 0,
    Dungeon = 1,
}

/// The towns of a world, the spawn clearing first, and the dungeon gates, one in each biome but the meadow.
pub const TOWNS: usize = 5;
pub const DUNGEONS: usize = 5;
/// The salt of the town and dungeon gate draws (as `LOG_SALT`, two salts each).
const PLACE_SALT: u64 = 60;
/// Town `k` is drawn in the biome `k`, 40 to 120 ground units out at first (a hex distance of 139 at most, inside the lairs' `LAIR_MIN`);
/// the gate `k` in the biome `k + 1`, as far out as the lairs.
const TOWN_RING: (f64, f64) = (40.0, 120.0);
const DUNGEON_RING: (f64, f64) = (160.0, 420.0);

/// The most tries a place has, so the search always ends: the biomes are patches now (#1755), a thin archipelago may need thousands: every seed of 1 to 2000 finds its places in a quarter of `PLACE_TRIES`.
pub const PLACE_TRIES: i32 = 40_000;

/// The towns then the dungeon gates of the world `seed` (docs/specs/openworld.md section 13), each with its kind and its cell. The first
/// town is the spawn clearing, `(0, 0)`. Town `k` (1 to 4) is drawn in the biome `k` (forest, tundra, desert, badlands) and the dungeon
/// gate `k` in the biome `k + 1` (forest to archipelago): the first draw that `spot` keeps and that is more than 3 cells from every cell
/// of `avoid` (the lairs, the teleporters and the logs) and from the places placed before it. The far edge of the ring of the place
/// grows by 1 ground unit every 2 tries, up to the lairs' `LAIR_FAR`, so a biome with no open ground near the spawn still gets its
/// town further out. From the seed alone, it reads the terrain and the enemies, never changes them, so `WORLD_VERSION` does not move.
pub fn places(seed: u64, avoid: &[(i32, i32)]) -> Vec<(PlaceKind, (i32, i32))> {
    places_within(seed, avoid, PLACE_TRIES)
}

/// `places` with at most `tries` draws a place: a place with no fit in them is left out, so the search always ends.
fn places_within(seed: u64, avoid: &[(i32, i32)], tries: i32) -> Vec<(PlaceKind, (i32, i32))> {
    let mut taken = avoid.to_vec();
    taken.push((0, 0));
    let mut found = vec![(PlaceKind::Town, (0, 0))];
    let wanted = (1..TOWNS as i32)
        .map(|k| (PlaceKind::Town, k, BIOMES[k as usize], TOWN_RING))
        .chain((0..DUNGEONS as i32).map(|k| {
            (
                PlaceKind::Dungeon,
                10 + k,
                BIOMES[k as usize + 1],
                DUNGEON_RING,
            )
        }));
    for (kind, k, biome, (near, far)) in wanted {
        let ring = |n: i32| (near, (far + f64::from(n) / 2.0).min(LAIR_FAR));
        let fit = (0..tries).find_map(|n| spot(seed, PLACE_SALT, k, n, biome, ring(n), &taken));
        if let Some(cell) = fit {
            taken.push(cell);
            found.push((kind, cell));
        }
    }
    found
}

/// The named landmarks of the world `seed` (#1533): the towers, the teleporters, the lore logs and the places, each kept off the ones before
/// it as the bridge keeps them. From the seed alone.
pub fn landmarks(seed: u64) -> Vec<(i32, i32)> {
    let mut found = towers(seed);
    found.extend(teleporters(seed, &found.clone()));
    let logs = logs(seed, &found);
    found.extend(logs.into_iter().flatten());
    let places = places(seed, &found);
    found.extend(places.into_iter().map(|(_, cell)| cell));
    found
}

/// The farthest an open cell may lie from a landmark, in cells (#1533): the cairns fill the gaps the named landmarks leave.
pub const LANDMARK_REACH: i32 = 16;
/// A landmark this close to the middle of a chunk stands for the chunk's cairn.
const CAIRN_CLEAR: i32 = 8;
/// No cairn stands this close to a landmark.
const CAIRN_SPACE: i32 = 3;
/// A cairn is drawn at random among the cells this close to the middle of its chunk.
const CAIRN_CORE: i32 = 3;
const CAIRN_SALT: u64 = 70;

/// The cairns of chunk `(cx, cy)` of the world `seed` (#1533, docs/specs/openworld.md section 13), given its named `landmarks`: about one a
/// chunk, so no open cell lies farther than `LANDMARK_REACH` from a landmark. A look only: it changes no cell, so `WORLD_VERSION` does not
/// move. None off the world or with a landmark within `CAIRN_CLEAR` of the chunk's middle. Else its fit cells
/// (open ground, no generated enemy on it, no landmark within `CAIRN_SPACE`) are tried at random within `CAIRN_CORE` of the middle, then
/// ring by ring: the first is a cairn, and so is each next one farther than `LANDMARK_REACH` from them all (a far corner of the chunk, or
/// another patch of land).
pub fn cairns_in(seed: u64, cx: i32, cy: i32, landmarks: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let middle = (cx * CHUNK + CHUNK / 2, cy * CHUNK + CHUNK / 2);
    if !chunk_in_world(cx, cy)
        || landmarks
            .iter()
            .any(|&l| hex_distance(l, middle) <= CAIRN_CLEAR)
    {
        return vec![];
    }
    let window = Window::new(seed, cx, cy);
    let enemies = enemy_groups(seed, cx, cy).concat();
    let fit = |(q, r): (i32, i32)| {
        in_world(q, r)
            && !window.cell(q, r).terrain.blocked()
            && !enemies.contains(&(q, r))
            && landmarks
                .iter()
                .all(|&l| hex_distance(l, (q, r)) > CAIRN_SPACE)
    };
    // The order of the tries is drawn before any cell is read: a chunk of land reads a few cells, not its 256.
    let mut tries: Vec<(i32, u32, (i32, i32))> = (0..CHUNK)
        .flat_map(|dr| (0..CHUNK).map(move |dq| (cx * CHUNK + dq, cy * CHUNK + dr)))
        .map(|at| {
            let draw = (unit(seed, CAIRN_SALT, at.0, at.1) * f64::from(u32::MAX)) as u32;
            (hex_distance(at, middle).max(CAIRN_CORE), draw, at)
        })
        .collect();
    tries.sort_unstable();
    let mut found: Vec<(i32, i32)> = Vec::new();
    for (_, _, at) in tries {
        if found.iter().all(|&c| hex_distance(c, at) > LANDMARK_REACH) && fit(at) {
            found.push(at);
        }
    }
    found
}

/// The farthest a hero path reaches from its start, in cells (docs/specs/openworld.md section 4).
pub const PATH_RADIUS: i32 = 40;
/// The most cells one path search expands before it gives up.
pub const PATH_EXPANSIONS: usize = 6000;

/// The six steps of the hex grid in the order of the client (E, W, NE, SW, NW, SE): the order that breaks the ties of a path.
const STEPS: [(i32, i32); 6] = [(1, 0), (-1, 0), (1, -1), (-1, 1), (0, -1), (0, 1)];

/// Whether a peer's claim that the hero broke the cell `(q, r)` of the world `seed` can be true (#1305): the generated cell is a
/// boulder or a tree.
pub fn can_break(seed: u64, q: i32, r: i32) -> bool {
    cell(seed, q, r).is_some_and(|c| matches!(c.terrain, Terrain::Boulder | Terrain::Tree))
}

/// Whether a peer's claim that the enemy marble of the generated world `seed` on the cell `(q, r)` was beaten can be true (#1305):
/// a generated enemy starts on that cell. The fight that beat it is not checked (no proof of the push for now), only the place.
pub fn is_enemy(seed: u64, q: i32, r: i32) -> bool {
    let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
    enemy_groups(seed, cx, cy)
        .iter()
        .flatten()
        .any(|&cell| cell == (q, r))
}

/// The axial distance between two cells.
pub fn hex_distance(a: (i32, i32), b: (i32, i32)) -> i32 {
    let (dq, dr) = (a.0 - b.0, a.1 - b.1);
    (dq.abs() + dr.abs() + (dq + dr).abs()) / 2
}

/// The cells of a shortest walk from `from` to `to`, `from` left out: a bounded A* (docs/specs/openworld.md section 4). `enter`
/// tells whether a cell can be entered. Empty when `to` is `from`, farther than `PATH_RADIUS`, not enterable or not reached; the
/// search stops after `max_expanded` cells. Deterministic: the open cell with the lowest estimate goes first, then the one nearest
/// the goal, then the lowest `(q, r)`, and the steps are tried in the order of `STEPS`.
pub fn find_path(
    from: (i32, i32),
    to: (i32, i32),
    max_expanded: usize,
    enter: &mut dyn FnMut(i32, i32) -> bool,
) -> Vec<(i32, i32)> {
    find_path_within(from, to, PATH_RADIUS, max_expanded, enter)
}

/// `find_path` with its own reach: the cells farther than `radius` from `from` are left out of the search.
pub fn find_path_within(
    from: (i32, i32),
    to: (i32, i32),
    radius: i32,
    max_expanded: usize,
    enter: &mut dyn FnMut(i32, i32) -> bool,
) -> Vec<(i32, i32)> {
    if from == to || hex_distance(from, to) > radius || !enter(to.0, to.1) {
        return Vec::new();
    }
    let mut open = BinaryHeap::from([Reverse((
        hex_distance(from, to),
        hex_distance(from, to),
        from,
    ))]);
    let mut cost = HashMap::from([(from, 0)]);
    let mut came: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    let mut expanded = 0;
    while let Some(Reverse((_, _, at))) = open.pop() {
        if at == to {
            let mut path = vec![to];
            while let Some(&before) = came.get(path.last().unwrap()) {
                path.push(before);
            }
            path.pop(); // the start
            path.reverse();
            return path;
        }
        expanded += 1;
        if expanded > max_expanded {
            break;
        }
        let g = cost[&at] + 1;
        for (dq, dr) in STEPS {
            let next = (at.0 + dq, at.1 + dr);
            if hex_distance(from, next) > radius
                || cost.get(&next).is_some_and(|&c| c <= g)
                || !enter(next.0, next.1)
            {
                continue;
            }
            cost.insert(next, g);
            came.insert(next, at);
            let h = hex_distance(next, to);
            open.push(Reverse((g + h, h, next)));
        }
    }
    Vec::new()
}

/// The walk of the hero from `from` to `to` over the world `seed` (`find_path`): a cell is entered when it is on the world, not in
/// `blocked` (the enemies), and open to the hero (water too, #1441) or an obstacle the hero breaks by rolling into it (a boulder or a tree, #1147,
/// #1510). The cells of `broken` are plain ground.
pub fn walk_path(
    seed: u64,
    from: (i32, i32),
    to: (i32, i32),
    broken: &[(i32, i32)],
    blocked: &[(i32, i32)],
) -> Vec<(i32, i32)> {
    let chunks = HashMap::new();
    let reach = (PATH_RADIUS, PATH_EXPANSIONS);
    path_over(&mut (chunks, 0), seed, from, to, reach, broken, blocked)
}

/// The reach of the walk to a tower (the Dungeon button): a lair stands 150 to 420 cells from the spawn.
pub const DUNGEON_RADIUS: i32 = 520;
/// The most cells the search of one tower expands.
pub const DUNGEON_EXPANSIONS: usize = 20000;
/// The towers are tried, nearest first, until the cells looked at by the searches pass this: one press never takes more than a
/// few tens of ms.
pub const DUNGEON_LOOKS: usize = 100_000;

/// The walk to the nearest tower (the Dungeon button, #1291): the lairs not in `beaten` come first, each group from the nearest in a
/// straight line, and the first tower with a way is the one. Returns its number and its path (the start left out, the tower's
/// cell last), `None` when no tower can be reached. `blocked` holds the enemies and the lairs: the tower asked for is let in.
pub fn dungeon_walk(
    seed: u64,
    from: (i32, i32),
    lairs: &[(i32, i32)],
    beaten: &[usize],
    broken: &[(i32, i32)],
    blocked: &[(i32, i32)],
) -> Option<(usize, Vec<(i32, i32)>)> {
    let mut order: Vec<usize> = (0..lairs.len()).collect();
    order.sort_by_key(|&k| (beaten.contains(&k), hex_distance(from, lairs[k]), k));
    let mut seen = (HashMap::new(), 0); // the world made and the cells looked at, shared by the searches
    order.into_iter().find_map(|k| {
        if seen.1 >= DUNGEON_LOOKS {
            return None;
        }
        let open: Vec<(i32, i32)> = blocked.iter().copied().filter(|&c| c != lairs[k]).collect();
        let reach = (DUNGEON_RADIUS, DUNGEON_EXPANSIONS);
        let path = path_over(&mut seen, seed, from, lairs[k], reach, broken, &open);
        (!path.is_empty()).then_some((k, path))
    })
}

/// The chunks made and the cells looked at, shared by the searches of one press.
type Seen = (HashMap<(i32, i32), Option<Vec<Option<Cell>>>>, usize);

/// `walk_path` with its reach `(radius, expansions)`.
fn path_over(
    (chunks, looks): &mut Seen,
    seed: u64,
    from: (i32, i32),
    to: (i32, i32),
    (radius, expansions): (i32, usize),
    broken: &[(i32, i32)],
    blocked: &[(i32, i32)],
) -> Vec<(i32, i32)> {
    let mut terrain = |q: i32, r: i32| -> Option<Terrain> {
        let (cq, cr) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
        let cells = chunks
            .entry((cq, cr))
            .or_insert_with(|| chunk(seed, cq, cr));
        let found =
            cells.as_ref()?[((r - cr * CHUNK) * CHUNK + (q - cq * CHUNK)) as usize]?.terrain;
        Some(match found {
            Terrain::Boulder if broken.contains(&(q, r)) => Terrain::Rock,
            Terrain::Tree if broken.contains(&(q, r)) => Terrain::Grass,
            other => other,
        })
    };
    let mut enter = |q: i32, r: i32| {
        *looks += 1;
        if blocked.contains(&(q, r)) {
            return false;
        }
        match terrain(q, r) {
            Some(Terrain::Boulder | Terrain::Tree) => true,
            Some(other) => other.open_to_hero(),
            None => false,
        }
    };
    find_path_within(from, to, radius, expansions, &mut enter)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cells of a chunk that lies whole in the world.
    fn full(seed: u64, cx: i32, cy: i32) -> Vec<Cell> {
        chunk(seed, cx, cy)
            .unwrap()
            .into_iter()
            .map(Option::unwrap)
            .collect()
    }

    #[test]
    fn only_a_boulder_or_a_tree_of_the_generated_world_can_break() {
        let mut seen = Vec::new();
        for q in -40..40 {
            for r in -40..40 {
                let terrain = cell(5, q, r).unwrap().terrain;
                assert_eq!(
                    can_break(5, q, r),
                    matches!(terrain, Terrain::Boulder | Terrain::Tree),
                    "cell {q},{r} is {terrain:?}"
                );
                seen.push(terrain);
            }
        }
        assert!(
            seen.contains(&Terrain::Boulder)
                && seen.contains(&Terrain::Tree)
                && seen.contains(&Terrain::Grass)
        );
    }

    #[test]
    fn a_cell_off_the_world_cannot_break() {
        assert!(!can_break(5, WORLD_RADIUS + 1, 0));
        assert!(!can_break(5, 0, -WORLD_RADIUS - 1));
    }

    #[test]
    fn a_chunk_holds_every_cell_of_its_square_in_any_order_of_visit() {
        let a = full(7, 3, -2);
        assert_eq!(a.len(), (CHUNK * CHUNK) as usize);
        let _elsewhere = chunk(7, -9, 5).unwrap();
        assert_eq!(full(7, 3, -2), a);
        assert_eq!(
            a[(2 * CHUNK + 5) as usize],
            cell(7, 3 * CHUNK + 5, -2 * CHUNK + 2).unwrap()
        );
    }

    #[test]
    fn the_seed_makes_the_world() {
        assert_ne!(chunk(1, 4, 4), chunk(2, 4, 4));
    }

    #[test]
    fn the_world_is_a_hexagon_of_cells_round_the_spawn() {
        let w = WORLD_RADIUS;
        assert_eq!(w, 448);
        // The six corners are in the world, a step past each is not.
        for (q, r) in [(w, 0), (0, w), (-w, w), (-w, 0), (0, -w), (w, -w)] {
            assert!(cell(1, q, r).is_some(), "corner {q},{r}");
            let (dq, dr) = (q.signum(), r.signum());
            assert!(cell(1, q + dq, r + dr).is_none(), "past {q},{r}");
        }
        // The middle of a side, and the cell past it.
        assert!(cell(1, w / 2, w / 2).is_some());
        assert!(cell(1, w / 2 + 1, w / 2).is_none());
        assert!(cell(1, -w / 2, -w / 2 - 1).is_none());
        // Some 600 000 cells (1 048 576 in the square world before #1440).
        let count = (-w - 1..=w + 1)
            .flat_map(|q| (-w - 1..=w + 1).map(move |r| (q, r)))
            .filter(|&(q, r)| in_world(q, r))
            .count();
        assert_eq!(count, 603_457);
    }

    #[test]
    fn a_chunk_the_edge_crosses_holds_its_cells_up_to_the_edge() {
        // Chunk (28, 0) starts on the east corner (448, 0): its first cell is the only one in the world.
        let east = chunk(1, 28, 0).unwrap();
        assert_eq!(east.len(), (CHUNK * CHUNK) as usize);
        assert_eq!(east[0], cell(1, 448, 0));
        assert!(east[0].is_some());
        assert!(east[1..].iter().all(Option::is_none));
        // Chunk (14, 13) crosses the north-east side: the cells within the radius are there, the others not.
        let side = chunk(3, 14, 13).unwrap();
        for (i, found) in side.iter().enumerate() {
            let (q, r) = (14 * CHUNK + i as i32 % CHUNK, 13 * CHUNK + i as i32 / CHUNK);
            assert_eq!(found.is_some(), q + r <= WORLD_RADIUS, "{q},{r}");
            assert_eq!(*found, cell(3, q, r));
        }
        assert!(side.iter().any(Option::is_some) && side.iter().any(Option::is_none));
        // Past the edge, no chunk: on each side of both axes.
        for (cx, cy) in [
            (29, 0),
            (0, 29),
            (-29, 0),
            (0, -29),
            (15, 14),
            (-15, -15),
            (28, -29),
            (-29, 28),
        ] {
            assert!(chunk(1, cx, cy).is_none(), "chunk {cx},{cy}");
        }
        for (cx, cy) in [(28, -1), (-28, 0), (0, 28), (0, -28), (14, 14), (-14, -15)] {
            assert!(chunk(1, cx, cy).is_some(), "chunk {cx},{cy}");
        }
    }

    #[test]
    fn the_enemies_of_a_chunk_the_edge_crosses_stand_in_the_world() {
        let mut groups = 0;
        for seed in 1..=3 {
            for cx in -30..30 {
                for cy in -30..30 {
                    let cells = chunk(seed, cx, cy);
                    let crossed = cells
                        .as_ref()
                        .is_some_and(|c| c.iter().any(Option::is_none));
                    if !crossed {
                        continue;
                    }
                    for group in enemy_groups(seed, cx, cy) {
                        groups += 1;
                        for (q, r) in group {
                            assert!(cell(seed, q, r).is_some(), "seed {seed}: {q},{r}");
                        }
                    }
                }
            }
        }
        assert!(groups > 20, "{groups} groups");
    }

    #[test]
    fn the_spawn_clearing_is_open_grass() {
        for seed in 0..40 {
            for q in -CLEARING..=CLEARING {
                for r in -CLEARING..=CLEARING {
                    if distance(q, r) > CLEARING {
                        continue;
                    }
                    let c = cell(seed, q, r).unwrap();
                    assert_eq!(c.terrain, Terrain::Grass);
                    assert_eq!(c.height, 3);
                    assert_eq!(c.biome, Biome::Meadow);
                    assert!(!c.terrain.blocked());
                }
            }
        }
    }

    #[test]
    fn the_spawn_surroundings_are_mostly_meadow_on_every_seed() {
        // A disc of axial radius 10 around the spawn (331 cells), on seeds 1 to 16 (seed 7 was a meadow island in a
        // desert): Meadow on at least 80 % of its cells.
        for seed in 1..=16 {
            let disc: Vec<Cell> = (-10..=10)
                .flat_map(|q| (-10..=10).map(move |r| (q, r)))
                .filter(|&(q, r)| distance(q, r) <= 10)
                .map(|(q, r)| cell(seed, q, r).unwrap())
                .collect();
            let (meadow, total) = (
                disc.iter().filter(|c| c.biome == Biome::Meadow).count(),
                disc.len(),
            );
            assert!(
                meadow * 100 >= total * 80,
                "seed {seed}: {meadow} of {total} cells around the spawn are meadow"
            );
        }
    }

    #[test]
    fn walls_stand_on_land_and_trees_grow_on_grass_height() {
        let (mut walls, mut trees) = (0, 0);
        for q in -96..96 {
            for r in -96..96 {
                let c = cell(5, q, r).unwrap();
                match c.terrain {
                    Terrain::Wall => {
                        walls += 1;
                        assert!((2..=6).contains(&c.height), "walls stand on land");
                    }
                    Terrain::Tree => {
                        trees += 1;
                        assert!((3..=4).contains(&c.height), "trees grow on the low ground");
                    }
                    _ => {}
                }
            }
        }
        assert!(
            walls > 20 && trees > 100,
            "{walls} wall cells, {trees} tree cells"
        );
    }

    #[test]
    fn the_distance_is_the_axial_one() {
        assert_eq!(distance(0, 0), 0);
        assert_eq!(distance(2, -1), 2);
        assert_eq!(distance(2, 2), 4);
        assert_eq!(distance(-3, 0), 3);
    }

    #[test]
    fn heights_and_terrains_agree() {
        // A wide window of four seeds: one seed's window can hold no peak at all (its continents are few).
        for seed in 11..15 {
            for cx in -8..8 {
                for cy in -8..8 {
                    for c in full(seed, cx, cy) {
                        assert!(c.height <= 7);
                        match c.terrain {
                            Terrain::Water => assert!(c.height <= 1),
                            Terrain::Sand => assert_eq!(c.height, 2),
                            Terrain::Grass => assert!((3..=5).contains(&c.height)),
                            Terrain::Rock => assert!((5..=6).contains(&c.height)),
                            Terrain::Peak => assert_eq!(c.height, 7),
                            Terrain::Tree => assert!((3..=4).contains(&c.height)),
                            Terrain::Boulder | Terrain::Wall => {
                                assert!((2..=6).contains(&c.height))
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_map_varies_and_obstacles_are_a_fair_share() {
        // Four seeds over 16 x 16 chunks: one seed's window is dominated by its few continents.
        let cells: Vec<Cell> = (1..=4)
            .flat_map(|seed| {
                (-8..8).flat_map(move |cx| (-8..8).flat_map(move |cy| full(seed, cx, cy)))
            })
            .collect();
        for terrain in [
            Terrain::Water,
            Terrain::Sand,
            Terrain::Grass,
            Terrain::Rock,
            Terrain::Peak,
            Terrain::Boulder,
            Terrain::Tree,
            Terrain::Wall,
        ] {
            assert!(
                cells.iter().any(|c| c.terrain == terrain),
                "{terrain:?} never appears"
            );
        }
        let blocked = cells.iter().filter(|c| c.terrain.blocked()).count() * 100 / cells.len();
        assert!((26..=37).contains(&blocked), "{blocked} % blocked");
        let boulders = cells
            .iter()
            .filter(|c| c.terrain == Terrain::Boulder)
            .count();
        assert!(boulders * 100 / cells.len() <= 2);
        let heights: std::collections::HashSet<u8> = cells.iter().map(|c| c.height).collect();
        assert_eq!(heights.len(), 8);
    }

    #[test]
    fn the_eight_height_levels_hold_their_measured_shares() {
        // The 16 x 16 chunks around the spawn, the real window, of four seeds, out of the archipelago, whose sea lowers it (#1442),
        // and off the borders between biomes, which a river or a ridge marks (#1752).
        let mut counts = [0usize; 8];
        for seed in 1..=4 {
            for cx in -8..8 {
                for cy in -8..8 {
                    let window = Window::new(seed, cx, cy);
                    for k in 0..CHUNK * CHUNK {
                        let (q, r) = (cx * CHUNK + k % CHUNK, cy * CHUNK + k / CHUNK);
                        let c = window.cell(q, r);
                        if c.biome != Biome::Archipelago && window.neighbour_biome(q, r).is_none() {
                            counts[c.height as usize] += 1;
                        }
                    }
                }
            }
        }
        let total: usize = counts.iter().sum();
        let targets = [8.0, 10.0, 12.0, 16.0, 18.0, 16.0, 12.0, 8.0];
        for (level, (&n, target)) in counts.iter().zip(targets).enumerate() {
            let share = n as f64 * 100.0 / total as f64;
            assert!(
                (share - target).abs() <= 2.0,
                "level {level}: {share:.1} % against {target} %"
            );
        }
    }

    /// The cells of the 16 x 16 chunks around the spawn, for each seed of `seeds`.
    fn window_cells(seeds: std::ops::RangeInclusive<u64>) -> Vec<Cell> {
        seeds
            .flat_map(|seed| {
                (-8..8).flat_map(move |cx| (-8..8).flat_map(move |cy| full(seed, cx, cy)))
            })
            .collect()
    }

    #[test]
    fn biome_codes_follow_the_table_order() {
        let codes = [
            Biome::Meadow,
            Biome::Forest,
            Biome::Tundra,
            Biome::Desert,
            Biome::Badlands,
            Biome::Archipelago,
        ]
        .map(|b| b as u8);
        assert_eq!(codes, [0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn every_biome_appears_on_land_in_the_window() {
        let land: Vec<Cell> = window_cells(1..=4)
            .into_iter()
            .filter(|c| c.height >= 2)
            .collect();
        for biome in BIOMES {
            assert!(
                land.iter().any(|c| c.biome == biome),
                "{biome:?} never appears"
            );
        }
    }

    /// The climate of the cell `(q, r)` of the world `seed` as the chunks have it, from the point formula.
    fn climate_of(seed: u64, q: i32, r: i32) -> Climate {
        climate_at(seed, q, r, climate_shift(seed))
    }

    #[test]
    fn the_biomes_by_code_are_the_order_the_towers_and_logs_are_drawn_in() {
        // Tower, lair, log and place `k` stand in `BIOMES[k % 6]`, and the client reads the same order (#1755).
        assert_eq!(BIOMES.map(|b| b as usize), [0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn the_climate_gives_each_biome_and_a_temperate_band_lies_between_tundra_and_desert() {
        let at = |temperature, wetness, sea| {
            Climate {
                temperature,
                wetness,
                sea,
            }
            .biome()
        };
        assert_eq!(at(0.2, 0.9, 0.1), Biome::Tundra);
        assert_eq!(at(0.9, 0.2, 0.1), Biome::Desert);
        assert_eq!(at(0.9, 0.9, 0.1), Biome::Badlands);
        assert_eq!(at(0.5, 0.9, 0.1), Biome::Forest);
        assert_eq!(at(0.5, 0.2, 0.1), Biome::Meadow);
        assert_eq!(at(0.2, 0.2, 0.9), Biome::Archipelago);
        assert_eq!(at(COLD + 0.01, 0.2, 0.1), Biome::Meadow, "a temperate band");
        assert_eq!(at(HOT - 0.01, 0.2, 0.1), Biome::Meadow);
        // The climate is continuous, so on seeds 0 to 7 no cell of the tundra touches a hot biome.
        for seed in 0..8 {
            for q in (-448..448).step_by(5) {
                for r in (-448..448).step_by(5) {
                    let own = climate_of(seed, q, r).biome();
                    if own != Biome::Tundra {
                        continue;
                    }
                    for (dq, dr) in STEPS {
                        let other = climate_of(seed, q + dq, r + dr).biome();
                        assert!(
                            !matches!(other, Biome::Desert | Biome::Badlands),
                            "seed {seed}: tundra beside {other:?} at {q},{r}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn the_chunks_and_the_point_formula_have_the_same_climate() {
        for seed in [1, 7] {
            for (cx, cy) in [(0, 0), (-3, 5), (20, -9)] {
                let window = Window::new(seed, cx, cy);
                for k in 0..(CHUNK + 2) * (CHUNK + 2) {
                    // the chunk and one cell round it
                    let (q, r) = (
                        cx * CHUNK - 1 + k % (CHUNK + 2),
                        cy * CHUNK - 1 + k / (CHUNK + 2),
                    );
                    let (a, b) = (window.climate(q, r), climate_of(seed, q, r));
                    assert!(
                        (a.temperature - b.temperature).abs() < 1e-9
                            && (a.wetness - b.wetness).abs() < 1e-9
                            && (a.sea - b.sea).abs() < 1e-9,
                        "seed {seed}: {q},{r}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_shift_memo_empties_when_it_is_full() {
        let mut shifts = HashMap::new();
        remember_shift(&mut shifts, 2, 1, (1, 1));
        remember_shift(&mut shifts, 2, 2, (2, 2));
        remember_shift(&mut shifts, 2, 3, (3, 3));
        assert_eq!(shifts.len(), 1);
        assert_eq!(shifts.get(&3), Some(&(3, 3)));
    }

    #[test]
    fn the_climate_shift_is_searched_once_per_seed_and_does_not_depend_on_the_order() {
        let first = climate_shift(11);
        assert_eq!(climate_shift(12), search_climate(12));
        assert_eq!(climate_shift(11), first);
        assert_eq!(first, search_climate(11));
    }

    #[test]
    fn every_biome_lies_within_the_radius_the_towers_are_drawn_in_on_seeds_0_to_30() {
        // Cells every 4 (axial), in the world: the farthest nearest cell of a biome over the seeds is the number the spec gives.
        for seed in 0..31 {
            let mut nearest = [i32::MAX; 6];
            for q in (-WORLD_RADIUS..=WORLD_RADIUS).step_by(4) {
                for r in (-WORLD_RADIUS..=WORLD_RADIUS).step_by(4) {
                    if in_world(q, r) {
                        let b = climate_of(seed, q, r).biome() as usize;
                        nearest[b] = nearest[b].min(distance(q, r));
                    }
                }
            }
            let far = nearest.into_iter().max().unwrap();
            assert!(far <= LAIR_FAR as i32, "seed {seed}: {nearest:?}");
        }
    }

    #[test]
    fn the_start_is_meadow_on_every_seed_without_the_map_being_drawn_round_it() {
        // The spawn and the ring of `HOME_RING` cells round it are meadow of the climate itself: only the offset of the climate is searched.
        for seed in 0..300 {
            for (q, r) in std::iter::once((0, 0)).chain(ring_points(f64::from(HOME_RING), 6)) {
                assert_eq!(climate_of(seed, q, r).biome(), Biome::Meadow, "seed {seed}");
            }
        }
    }

    #[test]
    fn nothing_but_the_clearing_looks_at_the_spawn() {
        // The biome of a cell round the spawn (past the clearing) is the climate's, dithered along the borders only: no bias toward
        // meadow, no sector.
        for seed in 0..8 {
            let (mut total, mut off) = (0, 0);
            for q in -60..=60 {
                for r in -60..=60 {
                    if distance(q, r) <= CLEARING || distance(q, r) > 60 {
                        continue;
                    }
                    total += 1;
                    let cell = cell(seed, q, r).unwrap();
                    off += (cell.biome != climate_of(seed, q, r).biome()) as i32;
                }
            }
            assert!(off * 12 < total, "seed {seed}: {off} of {total}");
        }
        assert_eq!(cell(5, 0, 0).unwrap().biome, Biome::Meadow);
        assert_eq!(cell(5, CLEARING, 0).unwrap().terrain, Terrain::Grass);
    }

    #[test]
    fn the_borders_of_the_biomes_blend_over_a_few_cells_and_are_not_straight() {
        // A cell's biome is its climate's moved by a small draw: a few cells differ from the smooth biome (never more than 1 in
        // 30), and the borders wander (they cross many columns).
        let seed = 3;
        let (mut mixed, mut total, mut columns) = (0, 0, std::collections::HashSet::new());
        for cx in -8..8 {
            for cy in -8..8 {
                let window = Window::new(seed, cx, cy);
                for k in 0..CHUNK * CHUNK {
                    let (q, r) = (cx * CHUNK + k % CHUNK, cy * CHUNK + k / CHUNK);
                    total += 1;
                    let smooth = window.climate(q, r).biome();
                    if window.biome(q, r).0 != smooth {
                        mixed += 1;
                    }
                    if window.neighbour_biome(q, r).is_some() {
                        columns.insert(q);
                    }
                }
            }
        }
        assert!(mixed > 0 && mixed * 30 < total, "{mixed} of {total}");
        let columns = columns.len();
        assert!(columns > 100, "{columns} columns hold a border");
    }

    #[test]
    fn the_archipelago_is_mostly_water_with_islands_of_sand_and_grass() {
        // The cells deep in the archipelago's sea, seeds 1 to 4, in the chunks -14 to 13: most of them water, the islands sand and
        // low grass (heights 2 to 4) with their trees, boulders and walls; no rock, no peak but a marked ridge's (height 7).
        let mut cells: Vec<Cell> = Vec::new();
        for seed in 1..=4 {
            for cx in -14..14 {
                for cy in -14..14 {
                    let window = Window::new(seed, cx, cy);
                    for k in 0..CHUNK * CHUNK {
                        let (q, r) = (cx * CHUNK + k % CHUNK, cy * CHUNK + k / CHUNK);
                        if in_world(q, r) && window.biome(q, r).1 > 0.999 {
                            cells.push(window.cell(q, r));
                        }
                    }
                }
            }
        }
        let water =
            cells.iter().filter(|c| c.terrain == Terrain::Water).count() * 100 / cells.len();
        assert!((60..=90).contains(&water), "{water} % water");
        let land: Vec<&Cell> = cells
            .iter()
            .filter(|c| c.terrain != Terrain::Water && c.height != 7)
            .collect();
        assert!(
            land.iter().all(|c| (2..=4).contains(&c.height)),
            "an island rises above the low ground"
        );
        for terrain in [Terrain::Sand, Terrain::Grass, Terrain::Tree] {
            assert!(land.iter().any(|c| c.terrain == terrain), "no {terrain:?}");
        }
        assert!(land
            .iter()
            .all(|c| !matches!(c.terrain, Terrain::Rock | Terrain::Peak)));
    }

    #[test]
    fn enemies_live_on_the_land_of_every_biome() {
        let mut groups = HashMap::new();
        for seed in 1..=4 {
            for cx in -8..8 {
                for cy in -8..8 {
                    for group in enemy_groups(seed, cx, cy) {
                        let (q, r) = group[0];
                        *groups
                            .entry(cell(seed, q, r).unwrap().biome as u8)
                            .or_insert(0) += 1;
                    }
                }
            }
        }
        for biome in BIOMES {
            let found = groups.get(&(biome as u8)).copied().unwrap_or(0);
            assert!(found >= 10, "{biome:?}: {found} groups");
        }
    }

    #[test]
    fn each_biome_sets_its_obstacle_density_on_the_low_ground() {
        // Low ground: heights 3 and 4, not a wall. A tree is one time in `tree` (probability), a boulder one per
        // mille of the cells a tree does not take (`boulder`, per mille), within a fifth (trees) and a third (boulders).
        let cells = window_cells(1..=4);
        let table = [
            (Biome::Meadow, 0.02, 15.0),
            (Biome::Forest, 0.25, 15.0),
            (Biome::Tundra, 0.04, 25.0),
            (Biome::Desert, 0.0, 30.0),
            (Biome::Badlands, 0.0, 45.0),
            (Biome::Archipelago, 0.05, 10.0),
        ];
        for (biome, tree, boulder) in table {
            let low: Vec<&Cell> = cells
                .iter()
                .filter(|c| {
                    c.biome == biome && (3..=4).contains(&c.height) && c.terrain != Terrain::Wall
                })
                .collect();
            let trees =
                low.iter().filter(|c| c.terrain == Terrain::Tree).count() as f64 / low.len() as f64;
            let boulders = low.iter().filter(|c| c.terrain == Terrain::Boulder).count() as f64
                / low.len() as f64;
            assert!(
                (trees - tree).abs() <= tree * 0.2 + 0.001,
                "{biome:?} tree share"
            );
            let per_mille = boulders * 1000.0;
            assert!(
                (per_mille - boulder * (1.0 - tree)).abs() <= boulder * 0.33,
                "{biome:?} boulders"
            );
        }
    }

    #[test]
    fn water_shore_uplands_and_peaks_have_the_same_terrains_in_every_biome() {
        let shore = [Terrain::Sand, Terrain::Wall, Terrain::Boulder];
        let upland = [
            Terrain::Rock,
            Terrain::Grass,
            Terrain::Wall,
            Terrain::Boulder,
        ];
        let kept = |c: &Cell| match c.height {
            0 | 1 => c.terrain == Terrain::Water,
            2 => shore.contains(&c.terrain),
            5 | 6 => upland.contains(&c.terrain),
            7 => c.terrain == Terrain::Peak,
            _ => true,
        };
        assert!(
            window_cells(1..=4).iter().all(kept),
            "a biome changed a shore, upland or peak"
        );
    }

    #[test]
    fn a_far_view_around_the_spawn_has_a_sea_and_a_range() {
        // The widest zoom sees about 21 x 21 chunks around the spawn: each of seeds 1 to 8 shows water, and rock or peak, out of
        // the archipelago, which is mostly sea (#1442).
        for seed in 1..=8 {
            let cells: Vec<Cell> = (-10..=10)
                .flat_map(|cx| (-10..=10).flat_map(move |cy| full(seed, cx, cy)))
                .filter(|c| c.biome != Biome::Archipelago)
                .collect();
            let total = cells.len() as f64;
            let water =
                cells.iter().filter(|c| c.terrain == Terrain::Water).count() as f64 * 100.0 / total;
            let range = cells
                .iter()
                .filter(|c| matches!(c.terrain, Terrain::Rock | Terrain::Peak))
                .count() as f64
                * 100.0
                / total;
            assert!(
                (3.0..=45.0).contains(&water),
                "seed {seed}: water {water:.1} %"
            );
            assert!(
                (5.0..=45.0).contains(&range),
                "seed {seed}: rock and peak {range:.1} %"
            );
        }
    }

    #[test]
    fn only_water_peaks_boulders_trees_and_walls_block() {
        for t in [
            Terrain::Water,
            Terrain::Peak,
            Terrain::Boulder,
            Terrain::Tree,
            Terrain::Wall,
        ] {
            assert!(t.blocked(), "{t:?}");
        }
        assert!(!Terrain::Sand.blocked() && !Terrain::Grass.blocked() && !Terrain::Rock.blocked());
    }

    #[test]
    fn the_hero_sails_water_and_is_stopped_by_the_other_blocked_cells() {
        for t in [Terrain::Water, Terrain::Sand, Terrain::Grass, Terrain::Rock] {
            assert!(t.open_to_hero(), "{t:?}");
        }
        for t in [
            Terrain::Peak,
            Terrain::Boulder,
            Terrain::Tree,
            Terrain::Wall,
        ] {
            assert!(!t.open_to_hero(), "{t:?}");
        }
    }

    fn all_groups() -> Vec<Vec<(i32, i32)>> {
        (-8..8)
            .flat_map(|cx| (-8..8).flat_map(move |cy| enemy_groups(5, cx, cy)))
            .collect()
    }

    #[test]
    fn enemy_groups_are_the_same_in_any_order_of_visit() {
        let a = all_groups();
        let reversed: Vec<_> = (-8..8)
            .rev()
            .flat_map(|cx| (-8..8).rev().flat_map(move |cy| enemy_groups(5, cx, cy)))
            .collect();
        let (mut sorted, mut backwards) = (a.clone(), reversed);
        sorted.sort();
        backwards.sort();
        assert_eq!(sorted, backwards);
        assert_ne!(
            a,
            (-8..8)
                .flat_map(|cx| (-8..8).flat_map(move |cy| enemy_groups(6, cx, cy)))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_group_is_one_to_three_marbles_in_a_line_on_open_cells_away_from_the_spawn() {
        let groups = all_groups();
        assert!(groups.len() > 40);
        let lens: std::collections::HashSet<usize> = groups.iter().map(Vec::len).collect();
        assert_eq!(lens, std::collections::HashSet::from([1, 2, 3]));
        for group in &groups {
            for pair in group.windows(2) {
                let step = (pair[1].0 - pair[0].0, pair[1].1 - pair[0].1);
                assert!([(1, 0), (0, 1), (1, -1)].contains(&step), "{group:?}");
            }
            for &(q, r) in group {
                assert!(distance(q, r) > SAFE);
                assert!(!cell(5, q, r).unwrap().terrain.blocked());
            }
        }
    }

    #[test]
    fn there_is_about_one_group_per_four_hundred_cells() {
        let per_cell = all_groups().len() as f64 / (16.0 * 16.0 * 256.0);
        assert!((1.0 / 700.0..1.0 / 300.0).contains(&per_cell), "{per_cell}");
    }

    #[test]
    fn every_group_stays_in_its_chunk_and_no_cell_holds_two_marbles() {
        for seed in 0..12 {
            let mut seen = std::collections::HashSet::new();
            for cx in -8..8 {
                for cy in -8..8 {
                    for group in enemy_groups(seed, cx, cy) {
                        for &(q, r) in &group {
                            assert_eq!(
                                (q.div_euclid(CHUNK), r.div_euclid(CHUNK)),
                                (cx, cy),
                                "{group:?}"
                            );
                            assert!(seen.insert((q, r)), "{seed}: {q},{r} holds two marbles");
                        }
                    }
                }
            }
        }
    }

    /// FNV-1a over the bytes of the chunks and the enemy groups of a few seeds and chunks, four of them on the edge of the
    /// hexagon: any change of the generated world changes it.
    fn world_digest() -> u64 {
        let fnv =
            |hash: u64, byte: u8| (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01B3);
        let mut hash = 0xCBF2_9CE4_8422_2325u64;
        let coords = [
            (0, 0),
            (-1, 0),
            (3, -2),
            (5, 5),
            (-8, 7),
            (28, 0),
            (14, 13),
            (-14, -15),
            (28, -28),
            (12, 9),
            (-4, -4),
            (17, 1),
            (2, 20),
            (-17, -9),
        ];
        for seed in [1u64, 7, 42] {
            for &(cx, cy) in &coords {
                for cell in chunk(seed, cx, cy).unwrap() {
                    let Some(cell) = cell else {
                        hash = fnv(hash, 0xFE); // past the edge
                        continue;
                    };
                    hash = fnv(hash, cell.height);
                    hash = fnv(hash, cell.terrain as u8);
                    hash = fnv(hash, cell.biome as u8);
                }
                for group in enemy_groups(seed, cx, cy) {
                    for (q, r) in group {
                        for byte in q.to_le_bytes().into_iter().chain(r.to_le_bytes()) {
                            hash = fnv(hash, byte);
                        }
                    }
                    hash = fnv(hash, 0xFF);
                }
            }
        }
        hash
    }

    #[test]
    fn some_borders_are_a_river_or_a_ridge_with_passes_past_the_spawn() {
        use Biome::{Forest, Meadow, Tundra};
        // each kind is drawn for some pair of biomes of some seed, the same either way round
        let kinds: Vec<BorderFeature> = (0..30)
            .flat_map(|seed| BIOMES.map(|a| border_feature(seed, a, Tundra)))
            .collect();
        for kind in [
            BorderFeature::River,
            BorderFeature::Ridge,
            BorderFeature::Plain,
        ] {
            assert!(kinds.contains(&kind), "{kind:?}");
        }
        assert_eq!(
            border_feature(3, Meadow, Forest),
            border_feature(3, Forest, Meadow)
        );
        let seed_of = |kind| {
            (0..30)
                .find(|&s| border_feature(s, Meadow, Forest) == kind)
                .unwrap()
        };
        let ridge = seed_of(BorderFeature::Ridge);
        assert_eq!(feature_at(ridge, 100, Meadow, Forest), Some(Terrain::Peak));
        assert_eq!(feature_at(ridge, 96, Meadow, Forest), None); // a pass: 96 % 16 < 3
        assert_eq!(feature_at(ridge, 20, Meadow, Forest), None); // near the spawn
        let river = seed_of(BorderFeature::River);
        assert_eq!(feature_at(river, 100, Forest, Meadow), Some(Terrain::Water));
        let plain = seed_of(BorderFeature::Plain);
        assert_eq!(feature_at(plain, 100, Meadow, Forest), None);
    }

    #[test]
    fn the_generated_world_marks_the_borders_between_two_biomes_past_the_spawn() {
        // On seeds 1 to 3, in the chunks -12 to 11: a cell next to another biome's, 40 cells or more out, is what its pair's feature says
        // (a river is water at height 1, a ridge a peak at height 7 out of the passes), and a cell off any border is never marked.
        let (mut rivers, mut ridges, mut plains) = (0, 0, 0);
        for seed in 1..=3 {
            for cx in -12..12 {
                for cy in -12..12 {
                    let window = Window::new(seed, cx, cy);
                    for (q, r) in (0..CHUNK * CHUNK)
                        .map(|k| (cx * CHUNK + k % CHUNK, cy * CHUNK + k / CHUNK))
                        .filter(|&(q, r)| in_world(q, r) && distance(q, r) > CLEARING)
                    {
                        let c = window.cell(q, r);
                        let border = window.neighbour_biome(q, r);
                        let from = distance(q, r);
                        if let Some((own, other)) = border.filter(|_| from >= FEATURE_FROM) {
                            {
                                let want = feature_at(seed, from, own, other);
                                match border_feature(seed, own, other) {
                                    BorderFeature::River => rivers += 1,
                                    BorderFeature::Ridge => ridges += 1,
                                    BorderFeature::Plain => plains += 1,
                                }
                                if let Some(terrain) = want {
                                    assert_eq!(c.terrain, terrain, "seed {seed}: {q},{r}");
                                    assert_eq!(
                                        c.height,
                                        if terrain == Terrain::Water { 1 } else { 7 }
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(
            rivers > 50 && ridges > 50 && plains > 50,
            "{rivers} {ridges} {plains}"
        );
    }

    #[test]
    fn the_generated_world_is_pinned_by_a_digest() {
        assert_eq!(
            (WORLD_VERSION, world_digest()),
            (6, 2_184_942_252_771_043_681),
            "WORLD_VERSION and digest of the reference world"
        );
    }

    #[test]
    fn the_spawn_chunks_and_the_edge_of_the_world_hold_no_group_in_the_clearing() {
        assert!(enemy_groups(1, 29, 0).is_empty());
        assert!(enemy_groups(1, 0, -29).is_empty());
        for seed in 0..60 {
            for g in enemy_groups(seed, 0, 0) {
                assert!(g.iter().all(|&(q, r)| distance(q, r) > SAFE));
            }
        }
    }

    #[test]
    fn only_a_generated_enemy_cell_can_be_beaten() {
        let first = enemy_groups(5, 0, 0)
            .into_iter()
            .flatten()
            .next()
            .or_else(|| {
                (0..WORLD_RADIUS / CHUNK)
                    .find_map(|cx| enemy_groups(5, cx, 0).into_iter().flatten().next())
            })
            .expect("seed 5 holds an enemy");
        assert!(is_enemy(5, first.0, first.1));
        assert!(!is_enemy(5, 0, 0)); // the spawn clearing
        assert!(!is_enemy(5, WORLD_RADIUS + 1, 0)); // off the world
    }

    /// The 5 x 5 chunks around the spawn chunk, as cell coordinates `[-2 * CHUNK, 3 * CHUNK)`.
    fn spawn_window() -> impl Iterator<Item = (i32, i32)> {
        (-2 * CHUNK..3 * CHUNK).flat_map(|q| (-2 * CHUNK..3 * CHUNK).map(move |r| (q, r)))
    }

    /// The open cells of the spawn window, and those of them that a flood fill over the six
    /// neighbours reaches from the spawn. The fill may leave the window to go round an obstacle, but
    /// stays in the 16 x 16 chunks around the spawn.
    fn spawn_window_reach(seed: u64) -> (usize, usize) {
        let inside = |q: i32, r: i32| {
            (-8 * CHUNK..8 * CHUNK).contains(&q) && (-8 * CHUNK..8 * CHUNK).contains(&r)
        };
        let open = |q: i32, r: i32| cell(seed, q, r).is_some_and(|c| !c.terrain.blocked());
        let mut reached = std::collections::HashSet::from([(0, 0)]);
        let mut todo = vec![(0, 0)];
        while let Some((q, r)) = todo.pop() {
            for (dq, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)] {
                let next = (q + dq, r + dr);
                if inside(next.0, next.1) && open(next.0, next.1) && reached.insert(next) {
                    todo.push(next);
                }
            }
        }
        let total = spawn_window().filter(|&(q, r)| open(q, r)).count();
        let got = spawn_window().filter(|c| reached.contains(c)).count();
        (total, got)
    }

    /// `f` of each seed, in the order of `seeds`. No threads: under coverage they run far slower than one.
    fn each_seed<T>(seeds: Vec<u64>, f: fn(u64) -> T) -> Vec<(u64, T)> {
        seeds.into_iter().map(|seed| (seed, f(seed))).collect()
    }

    #[test]
    fn most_open_cells_around_the_spawn_are_reachable_on_foot() {
        for (seed, (open, reached)) in each_seed((1..=32).collect(), spawn_window_reach) {
            assert!(
                reached * 100 >= open * 90,
                "seed {seed}: {reached} of {open} open cells reached on foot"
            );
        }
    }

    /// The size of the roster at the time of writing: the bridge passes the real count of `boss_ids()`.
    const ROSTER: usize = 14;

    #[test]
    fn a_lair_for_each_boss_stands_at_least_150_cells_from_the_spawn_on_every_seed() {
        for seed in 0..60 {
            let found = lairs(seed, ROSTER);
            assert_eq!(found.len(), ROSTER, "seed {seed}");
            for &(q, r) in &found {
                assert!(distance(q, r) >= LAIR_MIN, "seed {seed}: ({q}, {r})");
            }
        }
        assert_eq!(lairs(7, 15).len(), 15);
        assert_eq!(lairs(7, 3).len(), 3);
    }

    #[test]
    fn a_lair_and_its_six_neighbours_are_open_ground_in_the_world() {
        for seed in 0..60 {
            for (q, r) in lairs(seed, ROSTER) {
                for (dq, dr) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)] {
                    let c = cell(seed, q + dq, r + dr).expect("on the world");
                    assert!(
                        !c.terrain.blocked(),
                        "seed {seed}: ({q}, {r}) + ({dq}, {dr})"
                    );
                }
            }
        }
    }

    #[test]
    fn the_lairs_are_spread_and_come_from_the_seed_alone() {
        for seed in 0..60 {
            let found = lairs(seed, ROSTER);
            assert_eq!(lairs(seed, ROSTER), found);
            for (i, a) in found.iter().enumerate() {
                for b in &found[i + 1..] {
                    assert!(
                        distance(a.0 - b.0, a.1 - b.1) >= 20,
                        "seed {seed}: {a:?} {b:?}"
                    );
                }
            }
        }
        assert_ne!(lairs(1, ROSTER), lairs(2, ROSTER));
    }

    #[test]
    fn every_biome_holds_at_least_two_lairs_on_its_land() {
        for seed in 0..60 {
            let mut count = [0; 6];
            for (q, r) in lairs(seed, ROSTER) {
                count[cell(seed, q, r).unwrap().biome as usize] += 1;
            }
            assert!(count.iter().all(|&n| n >= 2), "seed {seed}: {count:?}");
        }
    }

    #[test]
    fn the_lairs_of_seed_7_are_pinned() {
        assert_eq!(lairs(7, 3), vec![(249, -76), (313, -31), (369, -348)]);
    }

    #[test]
    fn the_first_teleporter_stands_next_to_the_spawn_in_its_clearing() {
        for seed in 0..8 {
            let first = teleporters(seed, &[])[0];
            assert_eq!(first, SPAWN_TELEPORTER);
            assert!(distance(first.0, first.1) < CLEARING, "seed {seed}");
        }
    }

    #[test]
    fn a_teleporter_and_its_six_neighbours_are_open_ground_with_no_enemy_near() {
        for seed in 0..6 {
            for (q, r) in teleporters(seed, &[]) {
                for (dq, dr) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)] {
                    let c = cell(seed, q + dq, r + dr).expect("on the world");
                    assert!(
                        !c.terrain.blocked(),
                        "seed {seed}: ({q}, {r}) + ({dq}, {dr})"
                    );
                }
                let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
                for kx in cx - 1..=cx + 1 {
                    for ky in cy - 1..=cy + 1 {
                        for enemy in enemy_groups(seed, kx, ky).concat() {
                            assert!(hex_distance(enemy, (q, r)) > 2, "seed {seed}: ({q}, {r})");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_teleporters_are_spread_one_a_square_of_chunks_and_come_from_the_seed_alone() {
        for seed in 0..6 {
            let found = teleporters(seed, &[]);
            assert_eq!(teleporters(seed, &[]), found);
            // 7 x 7 squares of 8 x 8 chunks, the hexagon covers some 37 of them: most of those hold one.
            let count = found.len();
            assert!((30..=40).contains(&count), "seed {seed}: {count}");
            // Spread over all of the hexagon, within one spacing of its edge.
            let far = found.iter().map(|&(q, r)| distance(q, r)).max();
            assert!(far > Some(WORLD_RADIUS - 64), "seed {seed}: {far:?}");
            for (i, a) in found.iter().enumerate() {
                for b in &found[i + 1..] {
                    assert!(hex_distance(*a, *b) >= 64, "seed {seed}: {a:?} {b:?}");
                }
            }
        }
        assert_ne!(teleporters(1, &[]), teleporters(2, &[]));
    }

    #[test]
    fn a_teleporter_keeps_off_the_cells_it_is_told_to_avoid() {
        let free = teleporters(7, &[]);
        let taken = free[1];
        let moved = teleporters(7, &[taken]);
        assert_eq!(moved.len(), free.len());
        assert!(hex_distance(moved[1], taken) > 3);
        assert_eq!(moved[2..], free[2..]);
    }

    #[test]
    fn every_biome_holds_a_teleporter_on_its_land() {
        for seed in 0..6 {
            let mut count = [0; 6];
            for (q, r) in teleporters(seed, &[]) {
                count[cell(seed, q, r).unwrap().biome as usize] += 1;
            }
            assert!(count.iter().all(|&n| n >= 1), "seed {seed}: {count:?}");
        }
    }

    #[test]
    fn the_teleporters_of_seed_7_are_pinned() {
        let found = teleporters(7, &[]);
        // A quarter as many as one a square of 4 x 4 chunks, which gave 137 (#1444); 34 before the climate map (#1755).
        assert_eq!(found.len(), 36);
        assert_eq!(found[..3], [(2, -1), (29, -382), (153, -364)]);
    }

    /// The cells the lore logs of a seed keep off: the lairs and the teleporters, as the bridge passes them.
    fn log_cells(seed: u64, avoid: &[(i32, i32)]) -> Vec<(i32, i32)> {
        logs(seed, avoid)
            .into_iter()
            .map(|c| c.expect("a fit log"))
            .collect()
    }

    fn log_avoid(seed: u64) -> Vec<(i32, i32)> {
        let lairs = lairs(seed, ROSTER);
        let mut avoid = teleporters(seed, &lairs);
        avoid.extend(lairs);
        avoid
    }

    #[test]
    fn twelve_log_cells_come_from_the_seed_alone_and_are_all_different() {
        for seed in [1, 7, 1305] {
            let avoid = log_avoid(seed);
            let found = log_cells(seed, &avoid);
            assert_eq!(found.len(), LOGS, "seed {seed}");
            assert_eq!(log_cells(seed, &avoid), found);
            for (i, a) in found.iter().enumerate() {
                assert!(!found[i + 1..].contains(a), "seed {seed}: {a:?}");
            }
        }
        assert_ne!(log_cells(1, &log_avoid(1)), log_cells(2, &log_avoid(2)));
    }

    #[test]
    fn a_log_and_its_six_neighbours_are_open_ground_in_its_own_biome_off_the_spawn() {
        for seed in [1, 7, 1305, 2, 3, 4, 5, 6] {
            for (k, &(q, r)) in log_cells(seed, &log_avoid(seed)).iter().enumerate() {
                assert!(distance(q, r) > SAFE, "seed {seed}: log {k} at ({q}, {r})");
                for (dq, dr) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)] {
                    let c = cell(seed, q + dq, r + dr).expect("on the world");
                    assert!(!c.terrain.blocked(), "seed {seed}: log {k} at ({q}, {r})");
                    assert_eq!(c.biome, BIOMES[k % 6], "seed {seed}: log {k} at ({q}, {r})");
                }
            }
        }
    }

    #[test]
    fn a_log_keeps_off_the_lairs_the_teleporters_and_the_enemies() {
        for seed in [1, 7, 1305, 2, 3] {
            let avoid = log_avoid(seed);
            for &(q, r) in &log_cells(seed, &avoid) {
                assert!(
                    avoid.iter().all(|&c| hex_distance(c, (q, r)) > 3),
                    "seed {seed}: ({q}, {r})"
                );
                let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
                for kx in cx - 1..=cx + 1 {
                    for ky in cy - 1..=cy + 1 {
                        for enemy in enemy_groups(seed, kx, ky).concat() {
                            assert!(hex_distance(enemy, (q, r)) > 2, "seed {seed}: ({q}, {r})");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn every_biome_holds_two_logs_one_in_the_near_ring_and_one_in_the_far() {
        for seed in [1, 7, 1305, 2, 3, 4] {
            let found = log_cells(seed, &log_avoid(seed));
            for k in 0..6 {
                let (near, far) = (found[k], found[k + 6]);
                assert_eq!(cell(seed, near.0, near.1).unwrap().biome, BIOMES[k]);
                assert_eq!(cell(seed, far.0, far.1).unwrap().biome, BIOMES[k]);
                assert!(distance(near.0, near.1) > SAFE, "seed {seed}: log {k}");
                assert!(distance(far.0, far.1) > 150, "seed {seed}: far log {k}");
            }
        }
    }

    #[test]
    fn a_log_moves_off_a_cell_it_is_told_to_avoid() {
        let free = log_cells(7, &[]);
        let moved = log_cells(7, &[free[3]]);
        assert_eq!(moved.len(), free.len());
        assert!(hex_distance(moved[3], free[3]) > 3);
        assert_eq!(moved[..3], free[..3]);
    }

    #[test]
    fn the_logs_of_seed_7_are_pinned() {
        assert_eq!(
            log_cells(7, &log_avoid(7))[..3],
            [(-13, -35), (53, 23), (342, -437)]
        );
    }

    /// The cells the towns and dungeon gates of a seed keep off: the lairs, the teleporters and the logs, as the bridge passes them.
    fn place_avoid(seed: u64) -> Vec<(i32, i32)> {
        let mut avoid = log_avoid(seed);
        avoid.extend(logs(seed, &avoid).into_iter().flatten());
        avoid
    }

    fn kind_cells(found: &[(PlaceKind, (i32, i32))], kind: PlaceKind) -> Vec<(i32, i32)> {
        found
            .iter()
            .filter(|place| place.0 == kind)
            .map(|place| place.1)
            .collect()
    }

    #[test]
    fn every_seed_places_the_spawn_town_first_then_the_other_towns_and_the_dungeon_gates() {
        for seed in 1..=24 {
            let avoid = place_avoid(seed);
            let found = places(seed, &avoid);
            assert_eq!(found, places(seed, &avoid), "seed {seed}");
            let towns = kind_cells(&found, PlaceKind::Town);
            let gates = kind_cells(&found, PlaceKind::Dungeon);
            assert_eq!(towns.len(), TOWNS, "seed {seed}");
            assert_eq!(gates.len(), DUNGEONS, "seed {seed}");
            assert_eq!(towns[0], (0, 0), "the spawn clearing is the first town");
            assert!(found[..TOWNS].iter().all(|p| p.0 == PlaceKind::Town));
        }
        assert_ne!(places(1, &place_avoid(1)), places(2, &place_avoid(2)));
    }

    #[test]
    fn no_two_places_overlap_and_none_sits_on_a_lair_a_teleporter_or_a_log() {
        for seed in 1..=24 {
            let avoid = place_avoid(seed);
            let found = places(seed, &avoid);
            for (i, a) in found.iter().enumerate() {
                for b in &found[i + 1..] {
                    assert!(hex_distance(a.1, b.1) > 3, "seed {seed}: {a:?} and {b:?}");
                }
                if a.1 != (0, 0) {
                    assert!(
                        avoid.iter().all(|&c| hex_distance(c, a.1) > 3),
                        "seed {seed}: {a:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_place_and_its_six_neighbours_are_open_ground_with_no_enemy_near() {
        for seed in 1..=24 {
            for &(kind, (q, r)) in &places(seed, &place_avoid(seed)) {
                for (dq, dr) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1)] {
                    let c = cell(seed, q + dq, r + dr).expect("on the world");
                    assert!(
                        !c.terrain.blocked(),
                        "seed {seed}: {kind:?} at ({q}, {r}) + ({dq}, {dr})"
                    );
                }
                let (cx, cy) = (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
                for kx in cx - 1..=cx + 1 {
                    for ky in cy - 1..=cy + 1 {
                        for enemy in enemy_groups(seed, kx, ky).concat() {
                            assert!(
                                hex_distance(enemy, (q, r)) > 2,
                                "seed {seed}: {kind:?} at ({q}, {r})"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_other_towns_stand_in_their_biome_and_every_wild_biome_holds_a_gate() {
        for seed in 1..=24 {
            let found = places(seed, &place_avoid(seed));
            let towns = kind_cells(&found, PlaceKind::Town);
            for (k, &(q, r)) in towns.iter().enumerate().skip(1) {
                assert_eq!(cell(seed, q, r).unwrap().biome, BIOMES[k], "seed {seed}");
                assert!(distance(q, r) < WORLD_RADIUS, "seed {seed}: town {k}");
            }
            let gates = kind_cells(&found, PlaceKind::Dungeon);
            for (k, &(q, r)) in gates.iter().enumerate() {
                assert_eq!(
                    cell(seed, q, r).unwrap().biome,
                    BIOMES[k + 1],
                    "seed {seed}: gate {k}"
                );
                assert!(distance(q, r) >= LAIR_MIN, "seed {seed}: gate {k}");
            }
        }
    }

    #[test]
    fn a_place_moves_off_a_cell_it_is_told_to_avoid() {
        let free = places(7, &[]);
        let moved = places(7, &[free[2].1]);
        assert_eq!(moved.len(), free.len());
        assert!(hex_distance(moved[2].1, free[2].1) > 3);
        assert_eq!(moved[..2], free[..2]);
    }

    #[test]
    fn the_places_of_seed_7_are_pinned() {
        let found = places(7, &place_avoid(7));
        let town = |q, r| (PlaceKind::Town, (q, r));
        let gate = |q, r| (PlaceKind::Dungeon, (q, r));
        assert_eq!(
            found,
            vec![
                town(0, 0),
                town(13, 40),
                town(315, -346),
                town(-333, 122),
                town(-77, 98),
                gate(-190, -108),
                gate(173, -343),
                gate(-435, 343),
                gate(197, 82),
                gate(146, -172),
            ]
        );
    }

    /// What the 2000-seed sweeps share, computed once for the seeds 1 to 2000 (`SEEDS[seed - 1]`): the places in a quarter of their tries
    /// (the same as `places(seed, &[])` whenever all ten are found, the tries before a fit being the same), the 15 lairs, the towers on
    /// them and the pad of each tower. The lairs are the costly search, and the sweeps of the places, the lairs, the towers and the pads
    /// used to redo it each.
    struct Seed {
        places: Vec<(PlaceKind, (i32, i32))>,
        lairs: Vec<(i32, i32)>,
        towers: Vec<(i32, i32)>,
        pads: Vec<((i32, i32), (i32, i32))>,
    }

    /// One thread: under coverage the counters of the threads share cache lines, and 8 threads ran 40 times slower than one.
    static SEEDS: std::sync::LazyLock<Vec<Seed>> = std::sync::LazyLock::new(|| {
        (1..=2000)
            .map(|seed| {
                let lairs = lairs(seed, TOWER_ORDER.len());
                let towers = towers_on(&lairs);
                let pads = towers.iter().map(|&t| (t, tower_pad(seed, t))).collect();
                let places = places_within(seed, &[], PLACE_TRIES / 4);
                Seed {
                    places,
                    lairs,
                    towers,
                    pads,
                }
            })
            .collect()
    });

    /// The seeds 1 to 2000 with what they share.
    fn seeds() -> impl Iterator<Item = (u64, &'static Seed)> {
        (1..=2000).zip(SEEDS.iter())
    }

    #[test]
    fn every_seed_from_1_to_2000_places_its_five_towns_and_five_gates_and_the_search_ends() {
        for (seed, shared) in seeds() {
            let found = &shared.places;
            assert_eq!(found.len(), TOWNS + DUNGEONS, "seed {seed}");
            for (i, a) in found.iter().enumerate() {
                for b in &found[i + 1..] {
                    assert!(hex_distance(a.1, b.1) > 3, "seed {seed}: {a:?} and {b:?}");
                }
                for (dq, dr) in TELEPORT_PAD {
                    let c = cell(seed, a.1 .0 + dq, a.1 .1 + dr).expect("on the world");
                    assert!(!c.terrain.blocked(), "seed {seed}: {a:?}");
                }
            }
        }
    }

    #[test]
    fn the_places_found_in_a_quarter_of_the_tries_are_those_of_all_the_tries() {
        for seed in 1..=60 {
            assert_eq!(
                places_within(seed, &[], PLACE_TRIES / 4),
                places(seed, &[]),
                "seed {seed}"
            );
        }
    }

    #[test]
    fn the_seeds_whose_towns_found_no_fit_near_the_spawn_get_all_their_places_with_the_lairs_the_teleporters_and_the_logs_avoided(
    ) {
        for seed in [862, 1178, 1279, 1339, 1413, 1540, 1616] {
            let avoid = place_avoid(seed);
            let found = places(seed, &avoid);
            assert_eq!(found.len(), TOWNS + DUNGEONS, "seed {seed}");
            for (i, a) in found.iter().enumerate().skip(1) {
                assert!(
                    avoid.iter().all(|&c| hex_distance(c, a.1) > 3),
                    "seed {seed}: {a:?}"
                );
                assert!(distance(a.1 .0, a.1 .1) > SAFE, "seed {seed}: {a:?}");
                for b in &found[..i] {
                    assert!(hex_distance(a.1, b.1) > 3, "seed {seed}: {a:?} and {b:?}");
                }
            }
        }
    }

    #[test]
    fn a_place_with_no_fit_in_its_tries_is_left_out_and_the_spawn_town_stays() {
        assert_eq!(places_within(7, &[], 0), vec![(PlaceKind::Town, (0, 0))]);
        assert_eq!(places_within(7, &[], PLACE_TRIES), places(7, &[]));
    }

    #[test]
    fn every_seed_from_1_to_2000_places_its_fifteen_lairs_and_the_search_ends() {
        for (seed, shared) in seeds() {
            let found = &shared.lairs;
            assert_eq!(found.len(), 15, "seed {seed}");
            for (k, &(q, r)) in found.iter().enumerate() {
                assert!(distance(q, r) >= LAIR_MIN, "seed {seed}: lair {k}");
                for (dq, dr) in TELEPORT_PAD {
                    let c = cell(seed, q + dq, r + dr).expect("on the world");
                    assert!(!c.terrain.blocked(), "seed {seed}: lair {k}");
                    assert_eq!(c.biome, BIOMES[k % 6], "seed {seed}: lair {k}");
                }
            }
        }
    }

    /// The seeds of 1 to 22 000 and the random 32-bit ones found so far whose log `k` had no fit in its own ring and wedge before #1755 (#1595): the
    /// search of `logs` never ended on them.
    const LOG_HANG_SEEDS: [(u64, i32); 21] = [
        (2381, 2),
        (3074, 4),
        (3486, 1),
        (7825, 4),
        (8664, 2),
        (10972, 1),
        (11027, 2),
        (11665, 5),
        (12177, 5),
        (14993, 5),
        (16583, 4),
        (16640, 1),
        (16808, 5),
        (18491, 1),
        (19010, 5),
        (19426, 5),
        (20105, 4),
        (21003, 1),
        (21272, 3),
        (205_585_469, 0),
        (1_437_627_643, 0),
    ];

    #[test]
    fn the_seeds_whose_log_search_never_ended_get_all_their_logs_and_the_search_returns() {
        let (tx, rx) = std::sync::mpsc::channel();
        for (seed, k) in LOG_HANG_SEEDS {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let _ = tx.send((seed, k, logs(seed, &log_avoid(seed))));
            });
        }
        drop(tx);
        for _ in LOG_HANG_SEEDS {
            let (seed, k, found) = rx
                .recv_timeout(std::time::Duration::from_secs(60))
                .expect("logs never end");
            assert_eq!(found.len(), LOGS, "seed {seed}");
            assert!(found.iter().all(Option::is_some), "seed {seed}");
            // The log is on open ground of its biome, off the spawn.
            let (q, r) = found[k as usize].unwrap();
            let biome = BIOMES[k as usize % 6];
            assert!(distance(q, r) > SAFE, "seed {seed}: log {k}");
            for (dq, dr) in TELEPORT_PAD {
                let c = cell(seed, q + dq, r + dr).expect("on the world");
                assert!(!c.terrain.blocked(), "seed {seed}: log {k}");
                assert_eq!(c.biome, biome, "seed {seed}: log {k}");
            }
        }
    }

    /// Whether `path` is a walk from `from`: each cell next to the one before, none of `avoid`.
    fn walks(from: (i32, i32), path: &[(i32, i32)], avoid: &[(i32, i32)]) -> bool {
        let mut at = from;
        path.iter().all(|&next| {
            let ok = hex_distance(at, next) == 1 && !avoid.contains(&next);
            at = next;
            ok
        })
    }

    #[test]
    fn a_path_over_open_ground_is_straight_and_leaves_the_start_out() {
        let path = walk_path(3, (0, 0), (3, 0), &[], &[]);
        assert_eq!(path, vec![(1, 0), (2, 0), (3, 0)]);
        assert_eq!(
            walk_path(3, (0, 0), (3, 0), &[], &[]),
            path,
            "deterministic"
        );
    }

    #[test]
    fn a_path_goes_round_the_cells_in_the_way() {
        let path = walk_path(3, (0, 0), (3, 0), &[], &[(1, 0), (2, 0)]);
        assert_eq!(path.len(), 4);
        assert_eq!(path.last(), Some(&(3, 0)));
        assert!(walks((0, 0), &path, &[(1, 0), (2, 0)]));
    }

    #[test]
    fn a_wall_is_crossed_where_it_ends_by_the_shortest_way() {
        // The cells q = 2, r from -3 to 3 are blocked: the way round is 10 cells, either side.
        let mut wall = |q: i32, r: i32| !(q == 2 && (-3..=3).contains(&r));
        let path = find_path((0, 0), (4, 0), PATH_EXPANSIONS, &mut wall);
        assert_eq!(path.len(), 10);
        assert_eq!(path.last(), Some(&(4, 0)));
        let avoid: Vec<(i32, i32)> = (-3..=3).map(|r| (2, r)).collect();
        assert!(walks((0, 0), &path, &avoid));
    }

    #[test]
    fn no_path_to_the_start_a_blocked_cell_the_world_edge_or_beyond_the_radius() {
        assert!(walk_path(3, (0, 0), (0, 0), &[], &[]).is_empty());
        assert!(walk_path(3, (0, 0), (2, 0), &[], &[(2, 0)]).is_empty());
        let edge = WORLD_RADIUS;
        assert!(walk_path(3, (edge, 0), (edge + 1, 0), &[], &[]).is_empty()); // in a chunk the edge crosses
        assert!(walk_path(3, (0, -edge), (0, -edge - 1), &[], &[]).is_empty()); // in a chunk past the edge
        assert!(walk_path(3, (0, 0), (PATH_RADIUS + 1, 0), &[], &[]).is_empty());
    }

    #[test]
    fn a_path_sails_onto_the_water() {
        let lake = (-30..30)
            .flat_map(|q| (-30..30).map(move |r| (q, r)))
            .filter(|&(q, r)| cell(9, q, r).map(|c| c.terrain) == Some(Terrain::Water))
            .min_by_key(|&at| hex_distance(at, (0, 0)))
            .unwrap();
        let path = walk_path(9, (0, 0), lake, &[], &[]);
        assert_eq!(path.last(), Some(&lake));
        assert!(walks((0, 0), &path, &[]));
    }

    #[test]
    fn a_search_that_runs_out_of_expansions_gives_no_path() {
        let mut open = |_q: i32, _r: i32| true;
        assert!(find_path((0, 0), (30, 0), 5, &mut open).is_empty());
        assert_eq!(find_path((0, 0), (30, 0), 500, &mut open).len(), 30);
        let mut shut = |q: i32, r: i32| (q, r) == (5, 0);
        assert!(
            find_path((0, 0), (5, 0), PATH_EXPANSIONS, &mut shut).is_empty(),
            "no way to it"
        );
    }

    /// A cell of the world 9 with the terrain `kind`, and whether a tree stands on one of its neighbours.
    fn find(kind: Terrain, crowded: bool) -> (i32, i32) {
        let near = |q: i32, r: i32| {
            [(1, 0), (-1, 0), (1, -1), (-1, 1), (0, -1), (0, 1)]
                .iter()
                .any(|&(dq, dr)| cell(9, q + dq, r + dr).map(|c| c.terrain) == Some(Terrain::Tree))
        };
        (-60..60)
            .flat_map(|q| (-60..60).map(move |r| (q, r)))
            .find(|&(q, r)| {
                cell(9, q, r).map(|c| c.terrain) == Some(kind)
                    && near(q, r) == crowded
                    && cell(9, q - 1, r).is_some_and(|c| !c.terrain.blocked())
            })
            .unwrap()
    }

    #[test]
    fn a_boulder_is_a_cell_to_walk_to_and_any_tree_too() {
        let boulder = find(Terrain::Boulder, false);
        let lone = find(Terrain::Tree, false);
        let crowded = find(Terrain::Tree, true);
        for target in [boulder, lone, crowded] {
            let start = (target.0 - 1, target.1);
            let path = walk_path(9, start, target, &[], &[]);
            assert_eq!(path.last(), Some(&target), "{target:?}");
        }
        let start = (crowded.0 - 1, crowded.1);
        let path = walk_path(9, start, crowded, &[crowded], &[]);
        assert_eq!(path.last(), Some(&crowded), "a broken tree is grass");
        let boulder_broken = walk_path(9, (boulder.0 - 1, boulder.1), boulder, &[boulder], &[]);
        assert_eq!(boulder_broken.last(), Some(&boulder));
    }

    #[test]
    fn walls_and_peaks_are_never_entered() {
        for kind in [Terrain::Wall, Terrain::Peak] {
            let at = (-200..200)
                .flat_map(|q| (-200..200).map(move |r| (q, r)))
                .find(|&(q, r)| cell(9, q, r).map(|c| c.terrain) == Some(kind))
                .unwrap();
            assert!(
                walk_path(9, (at.0 - 1, at.1), at, &[], &[]).is_empty(),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn the_dungeon_walk_goes_to_the_nearest_unbeaten_tower_round_its_neighbours() {
        // The first seed whose nearest tower has a way on foot (a river between two biomes can cut it, #1752).
        let nearest_of = |lairs: &[(i32, i32)]| {
            (0..15)
                .min_by_key(|&k| hex_distance((0, 0), lairs[k]))
                .unwrap()
        };
        let seed = (0..40)
            .find(|&seed| {
                let lairs = lairs(seed, 15);
                dungeon_walk(seed, (0, 0), &lairs, &[], &[], &lairs)
                    .is_some_and(|(k, _)| k == nearest_of(&lairs))
            })
            .expect("a seed whose nearest tower has a way");
        let lairs = lairs(seed, 15);
        let (k, path) = dungeon_walk(seed, (0, 0), &lairs, &[], &[], &lairs).expect("a way");
        let nearest = nearest_of(&lairs);
        assert_eq!(k, nearest);
        assert_eq!(path.last(), Some(&lairs[k]), "the tower's cell is last");
        assert!(path.len() as i32 >= LAIR_MIN);
        assert!(!path.iter().any(|c| lairs.contains(c) && *c != lairs[k]));
        let beaten = dungeon_walk(seed, (0, 0), &lairs, &[nearest], &[], &lairs).unwrap();
        assert_ne!(beaten.0, nearest, "a beaten tower comes last");
        let all: Vec<usize> = (0..15).collect();
        let again = dungeon_walk(seed, (0, 0), &lairs, &all, &[], &lairs).unwrap();
        assert_eq!(again.0, nearest, "all beaten: the nearest again");
    }

    #[test]
    fn the_dungeon_walk_gives_none_without_a_tower_a_way_or_the_time() {
        assert!(dungeon_walk(9, (0, 0), &[], &[], &[], &[]).is_none());
        let lairs = lairs(9, 15);
        let walled: Vec<(i32, i32)> = lairs
            .iter()
            .flat_map(|&l| STEPS.map(|(a, b)| (l.0 + a, l.1 + b)))
            .collect();
        assert!(dungeon_walk(9, (0, 0), &lairs, &[], &[], &walled).is_none());
        // Every tower walled in but the farthest: the searches of the near ones pass the budget before it is tried.
        let farthest = (0..15)
            .max_by_key(|&k| hex_distance((0, 0), lairs[k]))
            .unwrap();
        let open = &lairs[farthest..=farthest];
        assert!(dungeon_walk(9, (0, 0), open, &[], &[], open).is_some());
        let others: Vec<(i32, i32)> = (0..15)
            .filter(|&k| k != farthest)
            .flat_map(|k| STEPS.map(|(a, b)| (lairs[k].0 + a, lairs[k].1 + b)))
            .collect();
        assert!(dungeon_walk(9, (0, 0), &lairs, &[], &[], &others).is_none());
    }
    /// 24 random 32-bit seeds, fixed so a failure repeats.
    fn random_seeds() -> Vec<u64> {
        let mut x: u64 = 0x2545_F491_4F6C_DD1D;
        (0..24)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                x >> 32
            })
            .collect()
    }

    fn check_towers(seed: u64, found: &[(i32, i32)], lairs: &[(i32, i32)]) {
        let mut cells = lairs.to_vec();
        let mut moved = found.to_vec();
        cells.sort();
        moved.sort();
        assert_eq!(
            moved, cells,
            "seed {seed}: the towers stand on the lairs' cells"
        );
        let along: Vec<i32> = TOWER_ORDER
            .iter()
            .map(|&boss| hex_distance((0, 0), found[boss]))
            .collect();
        assert!(
            along.windows(2).all(|w| w[0] <= w[1]),
            "seed {seed}: the nearer the easier, {along:?}"
        );
        let echo = found[0];
        assert!(
            found
                .iter()
                .all(|&c| hex_distance((0, 0), echo) <= hex_distance((0, 0), c)),
            "seed {seed}: the Echo is the nearest tower"
        );
    }

    #[test]
    fn the_tower_order_is_the_whole_roster_once_with_the_echo_first() {
        let mut sorted = TOWER_ORDER;
        sorted.sort_unstable();
        assert_eq!(sorted.to_vec(), (0..15).collect::<Vec<_>>());
        assert_eq!(TOWER_ORDER[0], 0);
    }

    #[test]
    fn every_seed_from_1_to_2000_puts_the_easiest_tower_nearest_and_the_echo_first() {
        for (seed, shared) in seeds() {
            assert_eq!(shared.towers.len(), 15, "seed {seed}");
            check_towers(seed, &shared.towers, &shared.lairs);
        }
    }

    #[test]
    fn random_seeds_put_the_easiest_tower_nearest_and_the_echo_first() {
        for seed in random_seeds() {
            check_towers(seed, &towers(seed), &lairs(seed, TOWER_ORDER.len()));
        }
    }

    #[test]
    fn a_tower_stands_where_the_tier_order_says_and_not_on_its_own_lair() {
        // The first seed whose nearest lair is not lair 0: boss 0 stands on it all the same, and a lair's cell never moves.
        let nearest_of = |seed| {
            let cells = lairs(seed, 15);
            (0..15)
                .min_by_key(|&k| (hex_distance((0, 0), cells[k]), k))
                .unwrap()
        };
        let seed = (0..60).find(|&seed| nearest_of(seed) != 0).unwrap();
        assert_eq!(towers(seed)[0], lairs(seed, 15)[nearest_of(seed)]);
        assert_eq!(towers(seed), towers(seed));
    }

    #[test]
    fn the_rings_hold_three_towers_each_in_five_tiers() {
        let rings: Vec<u8> = TOWER_ORDER.iter().map(|&boss| tower_ring(boss)).collect();
        assert_eq!(rings, [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]);
        assert_eq!(tower_ring(0), 1);
        assert_eq!(tower_ring(2), 5);
    }

    #[test]
    fn a_gate_has_the_ring_of_the_towers_nearer_than_it() {
        let found = towers(7);
        let mut sorted: Vec<i32> = found.iter().map(|&c| hex_distance((0, 0), c)).collect();
        sorted.sort_unstable();
        let at = |d: i32| (d, 0);
        assert_eq!(gate_ring(&found, at(10)), 1, "inside the nearest tower");
        assert_eq!(gate_ring(&found, at(sorted[2])), 1, "two towers nearer");
        assert_eq!(
            gate_ring(&found, at(sorted[2] + 1)),
            2,
            "three towers nearer"
        );
        assert_eq!(gate_ring(&found, at(sorted[3] + 1)), 2);
        assert_eq!(gate_ring(&found, at(sorted[7] + 1)), 3);
        assert_eq!(
            gate_ring(&found, at(sorted[14] + 1)),
            5,
            "past the last tower"
        );
        assert_eq!(gate_ring(&found, at(1000)), 5);
    }

    /// The pad of each tower of a seed, boss 0 first, with the tower it stands beside.
    fn pads(seed: u64) -> Vec<((i32, i32), (i32, i32))> {
        towers(seed)
            .into_iter()
            .map(|tower| (tower, tower_pad(seed, tower)))
            .collect()
    }

    #[test]
    fn every_seed_from_1_to_2000_gives_each_tower_a_pad_on_an_open_cell_next_to_it_and_the_search_ends(
    ) {
        for (seed, shared) in seeds() {
            let found = &shared.pads;
            assert_eq!(found.len(), 15, "seed {seed}");
            for (i, &(tower, pad)) in found.iter().enumerate() {
                assert_eq!(hex_distance(tower, pad), 1, "seed {seed}: pad {i}");
                let c = cell(seed, pad.0, pad.1).expect("on the world");
                assert!(!c.terrain.blocked(), "seed {seed}: pad {i}");
                assert!(!is_enemy(seed, pad.0, pad.1), "seed {seed}: pad {i}");
                assert!(
                    found.iter().all(|&(t, _)| t != pad),
                    "seed {seed}: pad {i} is on a tower"
                );
                for &(_, other) in &found[i + 1..] {
                    assert_ne!(pad, other, "seed {seed}: two pads on {pad:?}");
                }
            }
        }
    }

    #[test]
    fn a_pad_never_shares_a_cell_with_a_teleporter_a_log_or_a_place() {
        for seed in [1, 7, 1305, 2, 3, 862, 1178] {
            let mut taken = bridge_avoid(seed);
            let found = logs(seed, &taken);
            taken.extend(found.iter().flatten());
            let towns = places(seed, &taken);
            taken.extend(towns.into_iter().map(|p| p.1));
            for (_, pad) in pads(seed) {
                assert!(taken.iter().all(|&c| c != pad), "seed {seed}: {pad:?}");
            }
        }
    }

    #[test]
    fn a_pad_takes_the_first_neighbour_in_the_order_of_the_steps_that_is_open_and_free_of_enemies()
    {
        let tower = towers(7)[0];
        let pad = tower_pad(7, tower);
        let free = |(dq, dr): (i32, i32)| {
            let (q, r) = (tower.0 + dq, tower.1 + dr);
            cell(7, q, r).is_some_and(|c| !c.terrain.blocked()) && !is_enemy(7, q, r)
        };
        let first = STEPS.iter().find(|&&step| free(step)).unwrap();
        assert_eq!(pad, (tower.0 + first.0, tower.1 + first.1));
        assert_eq!(tower_pad(7, tower), pad, "from the seed alone");
    }

    #[test]
    fn the_pads_of_seed_7_are_pinned() {
        let found: Vec<(i32, i32)> = pads(7).into_iter().map(|p| p.1).collect();
        assert_eq!(found[..3], [(-190, -5), (301, -435), (-334, -102)]);
    }

    /// The cells the logs, then the places, keep off, as the bridge passes them (the 15 towers' lairs and the teleporters, then the logs).
    fn bridge_avoid(seed: u64) -> Vec<(i32, i32)> {
        bridge_avoid_on(seed, lairs(seed, TOWER_ORDER.len()))
    }

    /// `bridge_avoid` from the 15 lairs.
    fn bridge_avoid_on(seed: u64, lairs: Vec<(i32, i32)>) -> Vec<(i32, i32)> {
        let mut avoid = teleporters(seed, &lairs);
        avoid.extend(lairs);
        avoid
    }

    /// The points of interest that are no boss (docs/specs/openworld.md section 16): the lore logs and the dungeon gates.
    fn points_of_interest(seed: u64, lairs: Vec<(i32, i32)>) -> Vec<(i32, i32)> {
        let mut avoid = bridge_avoid_on(seed, lairs);
        let found = logs(seed, &avoid);
        avoid.extend(found.iter().flatten());
        let gates = kind_cells(&places(seed, &avoid), PlaceKind::Dungeon);
        found.into_iter().flatten().chain(gates).collect()
    }

    #[test]
    fn a_world_holds_twelve_logs_and_five_gates_two_or_three_points_of_interest_in_every_biome() {
        for (seed, shared) in seeds().take(300) {
            let found = points_of_interest(seed, shared.lairs.clone());
            assert_eq!(found.len(), LOGS + DUNGEONS, "seed {seed}");
            for (k, biome) in BIOMES.into_iter().enumerate() {
                let here = found
                    .iter()
                    .filter(|&&(q, r)| cell(seed, q, r).unwrap().biome == biome)
                    .count();
                let want = if k == 0 { 2 } else { 3 };
                assert_eq!(here, want, "seed {seed}: biome {k}");
            }
        }
    }

    /// The largest landmark-free radius of the world `seed` (#1533): the farthest any open cell lies from the nearest of `landmarks`, in
    /// cells (hex distance, through anything). A breadth-first search from every landmark at once over the cells of the world.
    fn landmark_gap(seed: u64, landmarks: &[(i32, i32)]) -> i32 {
        let side = 2 * WORLD_RADIUS + 1;
        let at = |q: i32, r: i32| ((r + WORLD_RADIUS) * side + q + WORLD_RADIUS) as usize;
        let mut open = vec![false; (side * side) as usize];
        let chunks = WORLD_RADIUS / CHUNK + 1;
        for cy in -chunks..=chunks {
            for cx in -chunks..=chunks {
                for (i, c) in chunk(seed, cx, cy).unwrap_or_default().iter().enumerate() {
                    let (q, r) = (cx * CHUNK + i as i32 % CHUNK, cy * CHUNK + i as i32 / CHUNK);
                    if c.is_some_and(|c| !c.terrain.blocked()) {
                        open[at(q, r)] = true;
                    }
                }
            }
        }
        let mut seen = vec![-1; (side * side) as usize];
        let mut queue = std::collections::VecDeque::new();
        for &(q, r) in landmarks.iter().filter(|&&(q, r)| in_world(q, r)) {
            seen[at(q, r)] = 0;
            queue.push_back((q, r));
        }
        let mut gap = 0;
        while let Some((q, r)) = queue.pop_front() {
            let d = seen[at(q, r)];
            if open[at(q, r)] {
                gap = gap.max(d);
            }
            for (dq, dr) in STEPS {
                let (nq, nr) = (q + dq, r + dr);
                if in_world(nq, nr) && seen[at(nq, nr)] < 0 {
                    seen[at(nq, nr)] = d + 1;
                    queue.push_back((nq, nr));
                }
            }
        }
        gap
    }

    /// Every cairn of the world `seed`, chunk by chunk.
    fn cairns(seed: u64, landmarks: &[(i32, i32)]) -> Vec<(i32, i32)> {
        let chunks = WORLD_RADIUS / CHUNK + 1;
        (-chunks..=chunks)
            .flat_map(|cy| (-chunks..=chunks).map(move |cx| (cx, cy)))
            .flat_map(|(cx, cy)| cairns_in(seed, cx, cy, landmarks))
            .collect()
    }

    #[test]
    fn no_open_cell_lies_farther_than_landmark_reach_from_a_landmark() {
        let gaps = |seed| {
            let named = landmarks(seed);
            let before = landmark_gap(seed, &named);
            let mut all = named.clone();
            all.extend(cairns(seed, &named));
            (before, landmark_gap(seed, &all))
        };
        for (seed, (before, after)) in each_seed(vec![7, 11, 23], gaps) {
            println!("#1533 seed {seed}: largest landmark-free radius {before} cells before cairns, {after} with them");
            assert!(
                before > LANDMARK_REACH,
                "seed {seed}: the named landmarks alone leave {before}"
            );
            assert!(
                after <= LANDMARK_REACH,
                "seed {seed}: {after} cells from any landmark"
            );
        }
    }

    #[test]
    fn a_cairn_stands_on_open_ground_off_the_landmarks_and_far_from_its_chunk_twin() {
        let named = landmarks(7);
        let cells = cairns(7, &named);
        assert_eq!(cells, cairns(7, &named), "the same seed, the same cairns");
        let count = cells.len();
        assert!(count > 1000, "{count} cairns");
        let chunk_of = |(q, r): (i32, i32)| (q.div_euclid(CHUNK), r.div_euclid(CHUNK));
        for (i, &a) in cells.iter().enumerate() {
            let twin = cells[i + 1..].iter().find(|&&b| chunk_of(b) == chunk_of(a));
            assert!(
                twin.is_none_or(|&b| hex_distance(a, b) > LANDMARK_REACH),
                "{a:?} {twin:?}"
            );
        }
        for &(q, r) in &cells {
            assert!(cell(7, q, r).is_some_and(|c| !c.terrain.blocked()));
            assert!(named.iter().all(|&l| hex_distance(l, (q, r)) > CAIRN_SPACE));
            assert!(!is_enemy(7, q, r));
        }
    }

    #[test]
    fn a_landmark_near_the_middle_of_a_chunk_stands_for_its_cairn() {
        let (cx, cy) = (0, 0);
        let middle = (cx * CHUNK + CHUNK / 2, cy * CHUNK + CHUNK / 2);
        assert!(!cairns_in(7, cx, cy, &[]).is_empty());
        assert!(cairns_in(7, cx, cy, &[middle]).is_empty());
        assert!(cairns_in(7, 40, 40, &[]).is_empty(), "off the world");
    }

    #[test]
    fn a_chunk_whose_land_lies_in_two_patches_far_apart_holds_a_cairn_on_each() {
        // Chunk (27, -15) of seed 23: a strip of shore at each end, 22 cells apart.
        let cells = cairns_in(23, 27, -15, &[]);
        assert_eq!(cells.len(), 2, "{cells:?}");
        assert!(hex_distance(cells[0], cells[1]) > LANDMARK_REACH);
    }

    #[test]
    fn a_chunk_with_no_open_cell_holds_no_cairn() {
        // The first chunk of seed 7 with no open cell: deep water or a range of peaks.
        let blocked = (-27..27)
            .flat_map(|cy| (-27..27).map(move |cx| (cx, cy)))
            .filter(|&(cx, cy)| chunk_in_world(cx, cy))
            .find(|&(cx, cy)| {
                full_or_none(7, cx, cy)
                    .is_some_and(|cells| cells.iter().all(|c| c.terrain.blocked()))
            })
            .expect("a chunk all blocked");
        assert!(cairns_in(7, blocked.0, blocked.1, &[]).is_empty());
    }

    /// The cells of a chunk of the world, `None` when the edge crosses it.
    fn full_or_none(seed: u64, cx: i32, cy: i32) -> Option<Vec<Cell>> {
        chunk(seed, cx, cy)
            .expect("a chunk of the world")
            .into_iter()
            .collect()
    }
}
