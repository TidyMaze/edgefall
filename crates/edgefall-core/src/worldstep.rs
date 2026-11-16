//! The hero's step in the Open world (docs/specs/openworld.md section 4): the held arrows and the camera's yaw give a hex
//! step, and the semi-auto steering (#1137) slides it round an obstacle. Pure maths; the cells that are free come as a mask.

use crate::world::{hex_distance, Terrain};
use std::f64::consts::PI;

/// The neighbour steps, the index is the bridge direction code: E, W, NE, SW, NW, SE.
pub const DIRECTIONS: [(i32, i32); 6] = [(1, 0), (-1, 0), (1, -1), (-1, 1), (0, -1), (0, 1)];

/// The bits of the held arrows.
pub const UP: u8 = 1;
pub const DOWN: u8 = 2;
pub const LEFT: u8 = 4;
pub const RIGHT: u8 = 8;

/// The angle of a step on the ground, in radians, from the x axis towards the far side (screen up is the ground at yaw 0).
fn ground_angle((dq, dr): (i32, i32)) -> f64 {
    (-((3f64.sqrt() / 2.0) * f64::from(dr))).atan2(f64::from(dq) + f64::from(dr) / 2.0)
}

/// The gap between two angles in radians, from 0 to pi.
fn gap_of(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % (2.0 * PI);
    d.min(2.0 * PI - d)
}

/// A gap in nano-radians, so that ties compare equal.
fn nano(gap: f64) -> i64 {
    (gap * 1e9).round() as i64
}

/// The screen direction of the held arrows (x right, y up), `None` for no arrow or for opposite arrows.
fn screen(keys: u8) -> Option<(i32, i32)> {
    let has = |bit| i32::from(keys & bit != 0);
    let (x, y) = (has(RIGHT) - has(LEFT), has(UP) - has(DOWN));
    let opposed = (keys & UP != 0 && keys & DOWN != 0) || (keys & LEFT != 0 && keys & RIGHT != 0);
    (keys & (UP | DOWN | LEFT | RIGHT) != 0 && !opposed).then_some((x, y))
}

/// The direction the keyboard takes at yaw 0, the tie-break: left and right roll along the row, up and down zigzag with the row.
fn keyboard_dir(at_r: i32, keys: u8) -> usize {
    let odd = at_r.rem_euclid(2) == 1;
    match (
        keys & UP != 0,
        keys & DOWN != 0,
        keys & LEFT != 0,
        keys & RIGHT != 0,
    ) {
        (true, _, true, _) => 4,
        (true, _, _, true) => 2,
        (_, true, true, _) => 3,
        (_, true, _, true) => 5,
        (true, ..) => {
            if odd {
                4
            } else {
                2
            }
        }
        (_, true, ..) => {
            if odd {
                3
            } else {
                5
            }
        }
        (_, _, true, _) => 1,
        _ => 0,
    }
}

/// The direction of the held arrows in the yaw of the camera: the neighbour the camera shows nearest to the arrows, a tie going
/// to the step the keyboard takes at yaw 0. `None` for no arrow or for opposite arrows. `want` is the intent's ground angle.
fn straight(at_r: i32, keys: u8, yaw: f64) -> Option<(usize, f64)> {
    let (x, y) = screen(keys)?;
    let want = f64::from(y).atan2(f64::from(x)) + yaw;
    let fallback = ground_angle(DIRECTIONS[keyboard_dir(at_r, keys)]);
    // Left or Right alone breaks a tie toward the neighbour that leans up on the screen (#1273).
    let sideways = keys == LEFT || keys == RIGHT;
    let score = |i: usize| {
        let angle = ground_angle(DIRECTIONS[i]);
        let tie = if sideways {
            -(angle - yaw).sin()
        } else {
            gap_of(angle, fallback)
        };
        (nano(gap_of(angle, want)), nano(tie))
    };
    let best = (1..6).fold(0, |best, i| if score(i) < score(best) { i } else { best });
    Some((best, want))
}

/// The direction index of the hero's step from a cell on row `at_r`, `None` for no intent. Without `steering` it is the straight
/// direction. With it, a straight direction whose bit is not in `free` goes to the free one of its two side neighbours (60 degrees
/// off) that the intent follows best, a tie going to the lower index; the straight one when none is free.
pub fn hero_dir(at_r: i32, keys: u8, yaw: f64, steering: bool, free: u8) -> Option<usize> {
    let (ahead, want) = straight(at_r, keys, yaw)?;
    if !steering || free & (1 << ahead) != 0 {
        return Some(ahead);
    }
    let ahead_angle = ground_angle(DIRECTIONS[ahead]);
    let mut best = (ahead, i64::MAX);
    for (i, dir) in DIRECTIONS.iter().enumerate() {
        let side = (gap_of(ground_angle(*dir), ahead_angle) - PI / 3.0).abs() < 1e-6;
        let gap = nano(gap_of(ground_angle(*dir), want));
        if side && gap < best.1 && free & (1 << i) != 0 {
            best = (i, gap);
        }
    }
    Some(best.0)
}

/// How many marbles follow the hero (#1504).
pub const TROOP: usize = 15;
/// How far from the hero a follower may drift before the leash pulls it back (cells).
const LEASH: i32 = 3;
/// How far a follower with no valid cell beside it looks for one.
const REACH: i32 = 6;
/// The pull of the cell a follower is sent to by the herd (#1506), in 1/n cell per cell: above the leash, so it wins over the flock.
const HERD_PULL: i32 = 64;

/// What the hero's step onto a cell does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entry {
    /// The step is refused.
    Refused,
    /// The hero rolls onto an open cell.
    Rolls,
    /// The hero rolls onto an obstacle and breaks it (#1147).
    Breaks,
}

/// The most levels a step climbs or drops (#1744): a cliff higher than that cannot be walked, up or down.
pub const MAX_CLIMB: i32 = 2;

/// What the hero's step from `at` to `to` does, `terrain` being that of `to` (`None` off the world), `occupied` whether an enemy
/// stands on it and `rise` the height of `to` less the height of `at` (levels): a step of more than `MAX_CLIMB` either way is refused.
pub fn entry(
    at: (i32, i32),
    to: (i32, i32),
    terrain: Option<Terrain>,
    occupied: bool,
    rise: i32,
) -> Entry {
    let delta = (to.0 - at.0, to.1 - at.1);
    let Some(terrain) =
        terrain.filter(|_| DIRECTIONS.contains(&delta) && !occupied && rise.abs() <= MAX_CLIMB)
    else {
        return Entry::Refused;
    };
    match terrain {
        Terrain::Boulder | Terrain::Tree => Entry::Breaks,
        _ if !terrain.open_to_hero() => Entry::Refused,
        _ => Entry::Rolls,
    }
}

/// SplitMix64: the fixed mix that makes the flock's tie-breaks the same on every peer.
pub(crate) fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// The cell follower `i` takes from `cells` (see `flock`): its own or a neighbour's.
fn best_cell(
    cells: &[(i32, i32)],
    i: usize,
    at: (i32, i32),
    to: (i32, i32),
    (seed, tick): (u64, u32),
    free: &dyn Fn((i32, i32)) -> bool,
    goal: Option<(i32, i32)>,
) -> (i32, i32) {
    let n = cells.len() as i32 + 1;
    let heading = (to.0 - at.0, to.1 - at.1);
    let c = cells[i];
    let sum = cells.iter().fold(to, |s, m| (s.0 + m.0, s.1 + m.1));
    let moves = std::iter::once((0, 0)).chain(DIRECTIONS);
    let best = moves
        .enumerate()
        .map(|(k, m)| (k, m, (c.0 + m.0, c.1 + m.1)))
        .filter(|&(_, m, cand)| {
            cand != to
                && if m == (0, 0) {
                    free(cand)
                } else {
                    (free(cand) || cand == at) && !cells.contains(&cand)
                }
        })
        .min_by_key(|&(k, m, cand)| {
            let beside = cells
                .iter()
                .enumerate()
                .filter(|&(j, &o)| j != i && hex_distance(o, cand) == 1)
                .count() as i32
                + i32::from(hex_distance(to, cand) == 1);
            let jitter =
                mix(seed ^ (u64::from(tick) << 24) ^ ((i as u64) << 8) ^ k as u64) % n as u64;
            hex_distance((cand.0 * n, cand.1 * n), sum)
                + n * hex_distance(cand, to)
                + n * 32 * (hex_distance(cand, to) - LEASH).max(0)
                + n * beside
                + n * hex_distance(m, heading)
                + goal.map_or(0, |g| n * HERD_PULL * hex_distance(cand, g))
                + jitter as i32
        });
    best.map_or_else(
        || nearest_valid(cells, c, at, to, free),
        |(_, _, cand)| cand,
    )
}

/// The nearest cell within `REACH` of `c` a marble may stand on, for a follower whose own cell and neighbours are all invalid (on the hero's
/// target, under an enemy, in water the hero left, on an obstacle); `c` itself when there is none.
fn nearest_valid(
    cells: &[(i32, i32)],
    c: (i32, i32),
    at: (i32, i32),
    to: (i32, i32),
    free: &dyn Fn((i32, i32)) -> bool,
) -> (i32, i32) {
    let mut around: Vec<(i32, i32)> = (-REACH..=REACH)
        .flat_map(|dq| (-REACH..=REACH).map(move |dr| (c.0 + dq, c.1 + dr)))
        .filter(|&cand| hex_distance(c, cand) <= REACH)
        .collect();
    around.sort_by_key(|&cand| (hex_distance(c, cand), cand));
    around
        .into_iter()
        .find(|&cand| cand != to && (free(cand) || cand == at) && !cells.contains(&cand))
        .unwrap_or(c)
}

/// The troop after the hero steps from `at` to `to` (#1504, docs/specs/openworld.md section 4b): the followers flock. Each one, the one
/// on `to` first, then by index, takes the best of its own cell and its six neighbours that `free` allows (or `at`, which the hero just
/// left), never `to` nor a cell of another marble, by integer boids costs: cohesion (distance to the centre of the group, in 1/n cell),
/// separation (one cell per marble beside the cell), alignment (one cell per step off the hero's heading), a leash beyond `LEASH`
/// cells of the hero, and a sub-cell jitter hashed from `seed`, `tick` and the index. Integers only: every peer gets the same cells.
/// `goals` (follower index, cell) are the cells the herd sends followers to (#1506, `worldherd::goals`): such a follower hops twice and
/// adds a pull of 64 per cell to its goal to the cost, so it wins over the flock; the others flock as before.
pub fn flock(
    troop: &[(i32, i32)],
    at: (i32, i32),
    to: (i32, i32),
    seed: u64,
    tick: u32,
    free: &dyn Fn((i32, i32)) -> bool,
    goals: &[(usize, (i32, i32))],
) -> Vec<(i32, i32)> {
    let mut cells = troop.to_vec();
    let mut order: Vec<usize> = (0..cells.len()).collect();
    order.sort_by_key(|&i| hex_distance(cells[i], to));
    for i in order {
        let goal = goals.iter().find(|g| g.0 == i).map(|g| g.1);
        // A follower beyond the leash, or sent by the herd, hops twice: it flies faster than the hero, so the strays catch up.
        let hops = if goal.is_some() || hex_distance(cells[i], to) > LEASH {
            2
        } else {
            1
        };
        for _ in 0..hops {
            cells[i] = best_cell(&cells, i, at, to, (seed, tick), free, goal);
        }
    }
    cells
}

#[cfg(test)]
mod tests {
    use super::*;

    const E: usize = 0;
    const NE: usize = 2;
    const NW: usize = 4;
    const SE: usize = 5;
    const ALL: u8 = 0b11_1111;
    fn except(dirs: &[usize]) -> u8 {
        dirs.iter().fold(ALL, |m, d| m & !(1 << d))
    }

    #[test]
    fn at_yaw_zero_a_single_arrow_is_the_step_of_the_keyboard_on_every_row() {
        for (r, up, down) in [(0, NE, SE), (1, NW, 3), (-3, NW, 3), (2, NE, SE)] {
            assert_eq!(hero_dir(r, UP, 0.0, false, ALL), Some(up));
            assert_eq!(hero_dir(r, DOWN, 0.0, false, ALL), Some(down));
            assert_eq!(hero_dir(r, LEFT, 0.0, false, ALL), Some(1));
            assert_eq!(hero_dir(r, RIGHT, 0.0, false, ALL), Some(E));
        }
    }

    #[test]
    fn at_yaw_zero_a_diagonal_of_two_arrows_is_the_diagonal_of_the_grid() {
        assert_eq!(hero_dir(0, UP | LEFT, 0.0, false, ALL), Some(NW));
        assert_eq!(hero_dir(1, UP | RIGHT, 0.0, false, ALL), Some(NE));
        assert_eq!(hero_dir(0, DOWN | LEFT, 0.0, false, ALL), Some(3));
        assert_eq!(hero_dir(1, DOWN | RIGHT, 0.0, false, ALL), Some(SE));
    }

    #[test]
    fn no_arrow_or_opposite_arrows_give_no_step() {
        for keys in [0, UP | DOWN, LEFT | RIGHT, 16] {
            assert_eq!(hero_dir(0, keys, 0.5, true, ALL), None);
        }
    }

    #[test]
    fn the_camera_yaw_turns_the_step_to_the_neighbour_it_shows_nearest() {
        // A quarter turn (60 degrees) of the camera moves the east arrow to the next neighbour round the cell.
        assert_eq!(hero_dir(0, RIGHT, PI / 3.0, false, ALL), Some(NE));
        assert_eq!(hero_dir(0, RIGHT, -PI / 3.0, false, ALL), Some(SE));
        assert_eq!(hero_dir(0, RIGHT, PI, false, ALL), Some(1));
    }

    #[test]
    fn steering_takes_the_straight_cell_when_it_is_free() {
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, ALL), Some(E));
    }

    #[test]
    fn steering_goes_round_a_rock_ahead_by_the_free_side_the_first_when_both_are_free() {
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, except(&[E])), Some(NE));
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, except(&[E, NE])), Some(SE));
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, except(&[E, SE])), Some(NE));
    }

    #[test]
    fn steering_slides_to_the_side_the_intent_follows_best() {
        assert_eq!(hero_dir(0, RIGHT | UP, 0.0, true, except(&[NE])), Some(E));
        assert_eq!(
            hero_dir(0, RIGHT | UP, 0.0, true, except(&[NE, E])),
            Some(NW)
        );
    }

    #[test]
    fn steering_gives_the_blocked_straight_cell_in_a_dead_end() {
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, except(&[E, NE, SE])), Some(E));
    }

    #[test]
    fn without_steering_a_blocked_straight_cell_is_still_the_step() {
        assert_eq!(hero_dir(0, RIGHT, 0.0, false, except(&[E])), Some(E));
    }

    #[test]
    fn steering_never_steps_back() {
        // Only the cells behind and the NW side are free: the hero stays on its straight, blocked cell.
        assert_eq!(hero_dir(0, RIGHT, 0.0, true, 1 << NW | 1 << 1), Some(E));
    }

    /// The ground angle of a direction index, for the tests of the lean.
    fn angle(i: usize) -> f64 {
        ground_angle(DIRECTIONS[i])
    }

    #[test]
    fn left_and_right_alone_both_lean_forward_up_on_the_screen_at_each_resting_angle() {
        for k in 0..6 {
            let yaw = -PI / 6.0 + f64::from(k) * PI / 3.0;
            for r in [0, 1, -3, 2] {
                let left = hero_dir(r, LEFT, yaw, false, ALL).unwrap();
                let right = hero_dir(r, RIGHT, yaw, false, ALL).unwrap();
                assert!((angle(left) - yaw).sin() > 0.49, "left {k} {r}");
                assert!((angle(right) - yaw).sin() > 0.49, "right {k} {r}");
                assert!((angle(left) - yaw).cos() < 0.0);
                assert!((angle(right) - yaw).cos() > 0.0);
            }
        }
    }

    #[test]
    fn down_with_left_or_right_still_steps_back_at_the_resting_angles() {
        for k in 0..6 {
            let yaw = -PI / 6.0 + f64::from(k) * PI / 3.0;
            for key in [LEFT, RIGHT] {
                let to = hero_dir(0, DOWN | key, yaw, false, ALL).unwrap();
                assert!((angle(to) - yaw).sin() < 0.0);
            }
        }
    }

    #[test]
    fn a_neighbour_of_open_ground_free_of_enemies_is_rolled_onto() {
        for terrain in [Terrain::Sand, Terrain::Grass, Terrain::Rock, Terrain::Water] {
            assert_eq!(entry((0, 0), (1, 0), Some(terrain), false, 0), Entry::Rolls);
        }
        for to in DIRECTIONS {
            assert_eq!(
                entry((2, 3), (2 + to.0, 3 + to.1), Some(Terrain::Grass), false, 0),
                Entry::Rolls
            );
        }
    }

    #[test]
    fn a_cell_that_is_not_a_neighbour_is_refused() {
        for to in [(0, 0), (2, 0), (1, 1), (-1, -1), (5, 5)] {
            assert_eq!(
                entry((0, 0), to, Some(Terrain::Grass), false, 0),
                Entry::Refused
            );
        }
    }

    #[test]
    fn off_the_world_or_under_an_enemy_is_refused_even_for_a_boulder() {
        assert_eq!(entry((0, 0), (1, 0), None, false, 0), Entry::Refused);
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Grass), true, 0),
            Entry::Refused
        );
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Boulder), true, 0),
            Entry::Refused
        );
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Water), true, 0),
            Entry::Refused
        );
    }

    #[test]
    fn a_step_up_or_down_more_than_max_climb_levels_is_refused() {
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Grass), false, MAX_CLIMB),
            Entry::Rolls
        );
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Grass), false, -MAX_CLIMB),
            Entry::Rolls
        );
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Grass), false, MAX_CLIMB + 1),
            Entry::Refused
        );
        assert_eq!(
            entry(
                (0, 0),
                (1, 0),
                Some(Terrain::Boulder),
                false,
                -MAX_CLIMB - 1
            ),
            Entry::Refused
        ); // not even to break it
    }

    #[test]
    fn a_boulder_and_any_tree_are_broken_and_nothing_else_blocked() {
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Boulder), false, 0),
            Entry::Breaks
        );
        assert_eq!(
            entry((0, 0), (1, 0), Some(Terrain::Tree), false, 0),
            Entry::Breaks
        );
        for terrain in [Terrain::Peak, Terrain::Wall] {
            assert_eq!(
                entry((0, 0), (1, 0), Some(terrain), false, 0),
                Entry::Refused
            );
        }
    }

    const SEED: u64 = 7;
    fn dist(a: (i32, i32), b: (i32, i32)) -> i32 {
        hex_distance(a, b)
    }
    fn ring() -> Vec<(i32, i32)> {
        let mut out: Vec<(i32, i32)> = DIRECTIONS.to_vec();
        out.extend([
            (2, 0),
            (-2, 0),
            (0, 2),
            (0, -2),
            (2, -2),
            (-2, 2),
            (1, 1),
            (-1, -1),
            (2, -1),
        ]);
        out.truncate(TROOP);
        out
    }
    /// A walk east then north-east: the troop after each step, every step checked.
    fn walk(free: &dyn Fn((i32, i32)) -> bool, steps: u32, seed: u64) -> Vec<Vec<(i32, i32)>> {
        let (mut at, mut troop, mut out) = ((0, 0), ring(), vec![]);
        for t in 0..steps {
            let to = (
                at.0 + [1, 1, 0][(t % 3) as usize],
                at.1 + [0, -1, -1][(t % 3) as usize],
            );
            troop = flock(&troop, at, to, seed, t, free, &[]);
            at = to;
            assert_eq!(troop.len(), TROOP);
            assert!(!troop.contains(&at), "a follower stands on the hero");
            let mut sorted = troop.clone();
            sorted.sort();
            sorted.dedup();
            assert_eq!(sorted.len(), TROOP, "two followers share a cell");
            assert!(
                troop.iter().all(|&c| dist(c, at) <= LEASH + 2),
                "a follower strayed: {troop:?} {at:?}"
            );
            out.push(troop.clone());
        }
        out
    }

    #[test]
    fn the_troop_is_fifteen() {
        assert_eq!(TROOP, 15);
        assert_eq!(ring().len(), 15);
    }

    #[test]
    fn fifteen_followers_keep_round_a_walking_hero_without_overlap() {
        for seed in 0..24 {
            walk(&|_| true, 120, seed);
        }
    }

    #[test]
    fn the_flock_is_the_same_for_the_same_seed_and_tick_and_moves_with_the_seed() {
        let a = walk(&|_| true, 40, SEED);
        assert_eq!(a, walk(&|_| true, 40, SEED));
        assert_ne!(a, walk(&|_| true, 40, SEED + 1));
    }

    #[test]
    fn followers_never_enter_a_cell_that_is_not_free() {
        let free = |c: (i32, i32)| (c.0 + c.1).rem_euclid(5) != 2;
        let mut troop: Vec<(i32, i32)> = ring().into_iter().filter(|&c| free(c)).collect();
        for t in 0..60 {
            // the hero walks back and forth between two cells
            let (from, dest) = if t % 2 == 0 {
                ((0, 0), (1, 0))
            } else {
                ((1, 0), (0, 0))
            };
            troop = flock(&troop, from, dest, SEED, t, &free, &[]);
            assert!(troop.iter().all(|&c| free(c)), "{troop:?}");
        }
    }

    #[test]
    fn the_follower_on_the_hero_target_moves_away_to_the_cell_the_hero_left() {
        let after = flock(&[(1, 0)], (0, 0), (1, 0), SEED, 0, &|_| false, &[]);
        assert_eq!(after, [(0, 0)]);
    }

    #[test]
    fn a_follower_on_the_hero_target_with_no_free_neighbour_takes_the_nearest_free_cell() {
        let free = |c: (i32, i32)| c == (3, 0);
        assert_eq!(
            flock(&[(1, 0)], (9, 9), (1, 0), SEED, 0, &free, &[]),
            [(3, 0)]
        );
    }

    #[test]
    fn a_follower_on_an_enemy_water_or_obstacle_cell_takes_the_nearest_valid_cell() {
        // its own cell (0, 0) is no longer free, nor are its neighbours; (0, 2) is the nearest free one, (3, 3) is farther
        let free = |c: (i32, i32)| c == (0, 2) || c == (3, 3);
        assert_eq!(
            flock(&[(0, 0)], (9, 9), (9, 8), SEED, 0, &free, &[]),
            [(0, 2)]
        );
        // the cell the hero left counts
        assert_eq!(
            flock(&[(0, 0)], (0, 2), (0, 3), SEED, 0, &|_| false, &[]),
            [(0, 2)]
        );
    }

    #[test]
    fn a_follower_with_no_valid_cell_skips_the_cells_of_other_marbles() {
        // (0, 1) is the only free cell near (0, 0); another marble holds it and (0, 1) is not a neighbour move for the other
        let out = flock(
            &[(0, 0), (0, 1)],
            (9, 9),
            (9, 8),
            SEED,
            0,
            &|c| c == (0, 1),
            &[],
        );
        assert_ne!(out[0], (0, 1));
    }

    #[test]
    fn a_walled_in_follower_stays() {
        assert_eq!(
            flock(&[(0, 0)], (5, 5), (5, 6), SEED, 0, &|_| false, &[]),
            [(0, 0)]
        );
    }

    #[test]
    fn a_follower_far_behind_closes_up() {
        let after = flock(&[(-3, 0)], (4, 0), (5, 0), SEED, 0, &|_| true, &[]);
        assert!(dist(after[0], (5, 0)) < dist((-3, 0), (5, 0)));
    }

    #[test]
    fn a_follower_sent_by_the_herd_hops_twice_toward_its_goal_whatever_the_leash() {
        let goal = (-4, 4);
        let out = flock(&[(-4, 0)], (1, 0), (0, 0), SEED, 0, &|_| true, &[(0, goal)]);
        assert_eq!(hex_distance(out[0], goal), 2);
        // The others do not feel it.
        let out = flock(
            &[(-4, 0), (0, 2)],
            (1, 0),
            (0, 0),
            SEED,
            0,
            &|_| true,
            &[(0, goal)],
        );
        assert_eq!(out.len(), 2);
        assert_ne!(out[1], goal);
    }

    #[test]
    fn an_empty_troop_stays_empty() {
        assert!(flock(&[], (0, 0), (1, 0), SEED, 0, &|_| true, &[]).is_empty());
    }
}
