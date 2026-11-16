//! The enemy overlay of the Open world fight (docs/specs/openworld.md section 3): the generated enemies of a seed never change; a
//! push removes the ones it moved away (`removed`, by the cell they start on) and adds the ones that now stand where no generated
//! enemy starts (`added`). The generated enemies of a chunk come in as an argument, so the rule stays pure and testable. Both lists
//! keep the order in which cells were put in: the order of the enemies is the order the push rule sees them in.
//!
//! A generated enemy wanders (`worldwander`, #1511): it stands on the cell it starts on shifted by the offset its chunk's group has
//! at the tick of the clock, which the caller gives with the chunk. A marble a push moved is no longer generated: it stands where it
//! was pushed to, in `added`, and wanders no more.

use crate::world::{Terrain, CHUNK};
use crate::worldfight;
use crate::worldherd;

/// A cell, `q, r`.
pub type Cell = (i32, i32);

/// A chunk, the generated enemies that start in it and the offset its group has from them now (`worldwander::offset`).
pub type Block = (Cell, Vec<Cell>, Cell);

/// The chunk a cell is in.
fn chunk_of((q, r): Cell) -> Cell {
    (q.div_euclid(CHUNK), r.div_euclid(CHUNK))
}

/// The cell `by` away from `cell`.
fn shifted((q, r): Cell, (dq, dr): Cell) -> Cell {
    (q + dq, r + dr)
}

/// The enemies within this many cells of the hero are the ones a push can reach.
pub const PUSH_REACH: i32 = 10;

/// A push as it was played, from the cells before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Played {
    /// The troop after the push, the hero first.
    pub troop: Vec<Cell>,
    /// The enemies near the hero before the push.
    pub foes: Vec<Cell>,
    /// The same enemies after it.
    pub enemies: Vec<Cell>,
    /// The enemy ejected, none or one.
    pub ejected: Vec<Cell>,
    /// The cell the ejected enemy started on when it was a generated one (the cell the other heroes can check, #1511), else the cell
    /// it stood on: the same length as `ejected`.
    pub homes: Vec<Cell>,
    /// The direction of the push.
    pub dir: Cell,
}

/// An enemy marble as the fight has it now: the cell it stands on, and the generated cell it started on when it has not been moved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Marble {
    pub at: Cell,
    pub home: Option<Cell>,
}

/// What the pushes of the troop changed on the generated enemies, and how many enemies were ejected.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Overlay {
    removed: Vec<Cell>,
    added: Vec<Cell>,
    beaten: u32,
}

impl Overlay {
    /// A fight with no push: the generated enemies are all there, none beaten.
    pub fn new() -> Self {
        Self::default()
    }

    /// The overlay of a saved fight: the lists are kept as given, in their order.
    pub fn from_parts(removed: Vec<Cell>, added: Vec<Cell>, beaten: u32) -> Self {
        Self {
            removed,
            added,
            beaten,
        }
    }

    /// The generated enemies gone, in the order they went.
    pub fn removed(&self) -> &[Cell] {
        &self.removed
    }

    /// The enemies on cells where no generated enemy starts, in the order they came.
    pub fn added(&self) -> &[Cell] {
        &self.added
    }

    /// The enemies ejected so far.
    pub fn beaten(&self) -> u32 {
        self.beaten
    }

    /// Hides generated enemies: a test fixture replaces them with its own.
    pub fn hide(&mut self, cells: &[Cell]) {
        for &cell in cells {
            if !self.removed.contains(&cell) {
                self.removed.push(cell);
            }
        }
    }

    /// The marbles of chunk `chunk` now: the `generated` ones not moved, each shifted by `offset`, then the ones pushed onto it.
    fn marbles_of(&self, generated: &[Cell], chunk: Cell, offset: Cell) -> Vec<Marble> {
        let mut marbles: Vec<Marble> = generated
            .iter()
            .copied()
            .filter(|cell| !self.removed.contains(cell))
            .map(|home| Marble {
                at: shifted(home, offset),
                home: Some(home),
            })
            .collect();
        marbles.extend(
            self.added
                .iter()
                .copied()
                .filter(|&cell| chunk_of(cell) == chunk)
                .map(|at| Marble { at, home: None }),
        );
        marbles
    }

    /// The enemies on chunk `chunk` now: the `generated` ones of that chunk not moved, shifted by the `offset` of its group, then the
    /// ones pushed onto it.
    pub fn chunk_enemies(&self, generated: &[Cell], chunk: Cell, offset: Cell) -> Vec<Cell> {
        self.marbles_of(generated, chunk, offset)
            .into_iter()
            .map(|marble| marble.at)
            .collect()
    }

    /// Whether an enemy stands on `cell` now; `generated` are the generated enemies of its chunk, `offset` the shift of its group. A
    /// group stays in its chunk, so the chunk of the cell is the only one to ask.
    pub fn occupied(&self, generated: &[Cell], cell: Cell, offset: Cell) -> bool {
        self.added.contains(&cell)
            || generated
                .iter()
                .any(|&home| shifted(home, offset) == cell && !self.removed.contains(&home))
    }

    /// Whether the generated enemy that starts on `home` is still in the world (#1511): a signed event of another hero names the cell
    /// an enemy starts on, wherever it wandered to.
    pub fn alive(&self, generated: &[Cell], home: Cell) -> bool {
        generated.contains(&home) && !self.removed.contains(&home)
    }

    /// The marbles within `radius` cells (hex distance) of `cell`, chunk by chunk in the order given: `blocks` pairs a chunk with the
    /// generated enemies that start in it and the offset of their group.
    fn marbles_around(&self, blocks: &[Block], cell: Cell, radius: i32) -> Vec<Marble> {
        let distance = |(q, r): Cell| {
            let (dq, dr) = (q - cell.0, r - cell.1);
            (dq.abs() + dr.abs() + (dq + dr).abs()) / 2
        };
        blocks
            .iter()
            .flat_map(|(chunk, generated, offset)| self.marbles_of(generated, *chunk, *offset))
            .filter(|marble| distance(marble.at) <= radius)
            .collect()
    }

    /// The enemies within `radius` cells (hex distance) of `cell`, chunk by chunk in the order given (`chunk_enemies` of each).
    pub fn around(&self, blocks: &[Block], cell: Cell, radius: i32) -> Vec<Cell> {
        self.marbles_around(blocks, cell, radius)
            .into_iter()
            .map(|marble| marble.at)
            .collect()
    }

    /// The wandering marble that touches the hero (#1511): a generated one, not moved by a push, within one cell of `hero`. When
    /// several do, the one that started on the lowest `(r, q)`, so the choice is the same for every peer.
    pub fn wild_contact(&self, blocks: &[Block], hero: Cell) -> Option<Marble> {
        self.marbles_around(blocks, hero, 1)
            .into_iter()
            .filter(|marble| marble.home.is_some())
            .min_by_key(|marble| marble.home.map(|(q, r)| (r, q)))
    }

    /// The troop's attack: the best legal push of `troop` (the hero first) against the enemies within `PUSH_REACH` of the hero, on the
    /// `terrain` given. `blocks` are the chunks that reach them with their generated enemies (`around`). The push is played on the
    /// overlay, the shove of a single marble included (`best_shove`, from the `seed` and the `tick`); `None`, and the overlay as it was, when no push is legal.
    pub fn troop_push(
        &mut self,
        blocks: &[Block],
        troop: &[Cell],
        terrain: impl Fn(i32, i32) -> Option<Terrain>,
        (seed, tick): (u64, u32),
    ) -> Option<Played> {
        self.troop_push_on(blocks, troop, terrain, |_, _| false, (seed, tick))
    }

    /// `troop_push` where the cells `iced` gives are the tundra's ice (#1751): the last enemy a push moves onto one slides one cell more
    /// the same way, when that cell is open ground with no marble on it.
    pub fn troop_push_on(
        &mut self,
        blocks: &[Block],
        troop: &[Cell],
        terrain: impl Fn(i32, i32) -> Option<Terrain>,
        iced: impl Fn(i32, i32) -> bool,
        (seed, tick): (u64, u32),
    ) -> Option<Played> {
        let marbles = self.marbles_around(blocks, troop[0], PUSH_REACH);
        let foes: Vec<Cell> = marbles.iter().map(|marble| marble.at).collect();
        let line = worldfight::best_push(troop, &foes, &terrain);
        // A line that ejects wins; else a single marble shoving a foe out (#1504); else the line's push.
        let push = match line {
            Some(line) if line.ejections > 0 => line,
            line => worldfight::best_shove(troop, &foes, &terrain, seed, tick)
                .or_else(|| worldherd::herd_push(troop, &foes, &terrain, seed))
                .or(line)?,
        };
        let (mut after, mut enemies) = (troop.to_vec(), foes.clone());
        let ejected = worldfight::apply_push(&mut after, &mut enemies, &push);
        if let worldfight::Outcome::Slides(to) = push.last {
            let d = push.dir.vector();
            let beyond = (to.0 + d.0, to.1 + d.1);
            let open = terrain(beyond.0, beyond.1).is_some_and(|t| !t.blocked());
            let empty = !after.contains(&beyond)
                && !enemies.contains(&beyond)
                && self.marbles_around(blocks, beyond, 0).is_empty();
            if iced(to.0, to.1) && open && empty {
                for m in enemies.iter_mut().filter(|m| **m == to) {
                    *m = beyond; // the ice carries it one cell more
                }
            }
        }
        self.play(&marbles, &enemies, &ejected);
        let homes = ejected
            .iter()
            .map(|&cell| {
                marbles
                    .iter()
                    .find(|marble| marble.at == cell)
                    .and_then(|marble| marble.home)
                    .unwrap_or(cell)
            })
            .collect();
        Some(Played {
            troop: after,
            foes,
            enemies,
            ejected,
            homes,
            dir: push.dir.vector(),
        })
    }

    /// Plays a push on the overlay: `marbles` were the enemies before it, `after` the cells the ones that stayed in the world stand on
    /// now (the same order, the `ejected` ones left out). A marble that moved leaves its place (a generated one is removed by the cell
    /// it starts on) and stands where it went, no longer wandering; one that fell is removed and counted.
    fn play(&mut self, marbles: &[Marble], after: &[Cell], ejected: &[Cell]) {
        let mut next = after.iter();
        for marble in marbles {
            let to = if ejected.contains(&marble.at) {
                None
            } else {
                next.next().copied().filter(|&to| to != marble.at)
            };
            if to.is_none() && !ejected.contains(&marble.at) {
                continue; // it stayed where it was
            }
            match marble.home {
                Some(home) => self.removed.push(home),
                None => self.added.retain(|&cell| cell != marble.at),
            }
            match to {
                Some(cell) => self.added.push(cell),
                None => self.beaten += 1,
            }
        }
    }

    /// The cells the herd sends the followers to before they flock (#1506, `worldherd::goals`): `troop` is the hero first, `blocks` the chunks
    /// that reach the enemies near it; (follower index, cell) pairs, empty without a hunt.
    pub fn herd_goals(
        &self,
        blocks: &[Block],
        troop: &[Cell],
        terrain: impl Fn(i32, i32) -> Option<Terrain>,
        seed: u64,
    ) -> Vec<(usize, Cell)> {
        let foes = self.around(blocks, troop[0], PUSH_REACH);
        worldherd::goals(troop, &foes, terrain, seed)
    }

    /// Plays a push: the enemies `old` leave their cells, the enemies `new` stand on theirs, and the `ejected` ones count as beaten.
    /// A generated enemy that comes back to its cell is that generated enemy again.
    pub fn apply(&mut self, old: &[Cell], new: &[Cell], ejected: usize) {
        for &cell in old {
            if let Some(i) = self.added.iter().position(|&c| c == cell) {
                self.added.remove(i);
            } else if !self.removed.contains(&cell) {
                self.removed.push(cell);
            }
        }
        for &cell in new {
            if let Some(i) = self.removed.iter().position(|&c| c == cell) {
                self.removed.remove(i);
            } else if !self.added.contains(&cell) {
                self.added.push(cell);
            }
        }
        self.beaten += ejected as u32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_overlay_changes_nothing() {
        let overlay = Overlay::new();
        assert!(overlay.removed().is_empty() && overlay.added().is_empty());
        assert_eq!(overlay.beaten(), 0);
        assert_eq!(
            overlay.chunk_enemies(&[(1, 0), (2, 0)], (0, 0), (0, 0)),
            [(1, 0), (2, 0)]
        );
        assert!(overlay.occupied(&[(1, 0)], (1, 0), (0, 0)));
        assert!(!overlay.occupied(&[(1, 0)], (2, 0), (0, 0)));
    }

    #[test]
    fn a_pushed_generated_enemy_leaves_its_cell_and_stands_on_the_new_one() {
        let mut overlay = Overlay::new();
        overlay.apply(&[(1, 0)], &[(2, 0)], 0);
        assert_eq!(overlay.removed(), [(1, 0)]);
        assert_eq!(overlay.added(), [(2, 0)]);
        assert!(!overlay.occupied(&[(1, 0)], (1, 0), (0, 0)));
        assert!(overlay.occupied(&[], (2, 0), (0, 0)));
        assert_eq!(overlay.chunk_enemies(&[(1, 0)], (0, 0), (0, 0)), [(2, 0)]);
    }

    #[test]
    fn an_enemy_that_comes_back_to_its_generated_cell_is_that_generated_enemy_again() {
        let mut overlay = Overlay::new();
        overlay.apply(&[(1, 0)], &[(2, 0)], 0);
        overlay.apply(&[(2, 0)], &[(1, 0)], 0);
        assert_eq!(overlay, Overlay::new());
    }

    #[test]
    fn ejected_enemies_are_counted() {
        let mut overlay = Overlay::new();
        overlay.apply(&[(1, 0), (5, 0)], &[], 2);
        overlay.apply(&[], &[], 1);
        assert_eq!(overlay.beaten(), 3);
        assert_eq!(overlay.removed(), [(1, 0), (5, 0)]);
    }

    #[test]
    fn a_pushed_enemy_belongs_to_the_chunk_it_stands_in_below_zero_too() {
        let mut overlay = Overlay::new();
        overlay.apply(&[], &[(-1, -1), (16, 0)], 0);
        assert_eq!(overlay.chunk_enemies(&[], (-1, -1), (0, 0)), [(-1, -1)]);
        assert_eq!(overlay.chunk_enemies(&[(3, 3)], (0, 0), (0, 0)), [(3, 3)]);
        assert_eq!(overlay.chunk_enemies(&[], (1, 0), (0, 0)), [(16, 0)]);
    }

    #[test]
    fn the_cells_keep_the_order_they_came_in() {
        let mut overlay = Overlay::new();
        overlay.apply(&[], &[(3, 0), (1, 0), (2, 0)], 0);
        overlay.apply(&[(1, 0)], &[], 0);
        assert_eq!(overlay.added(), [(3, 0), (2, 0)]);
        assert_eq!(
            overlay.chunk_enemies(&[(3, 3)], (0, 0), (0, 0)),
            [(3, 3), (3, 0), (2, 0)]
        );
    }

    #[test]
    fn around_keeps_the_enemies_within_the_radius_chunk_by_chunk() {
        let mut overlay = Overlay::new();
        overlay.apply(&[(2, 0)], &[(0, 3)], 0);
        let chunks = [
            ((0, 0), vec![(1, 0), (2, 0), (9, 0)], (0, 0)),
            ((1, 0), vec![(16, 0), (30, 0)], (0, 0)),
        ];
        assert_eq!(overlay.around(&chunks, (0, 0), 3), [(1, 0), (0, 3)]);
        assert_eq!(
            overlay.around(&chunks, (0, 0), 20),
            [(1, 0), (9, 0), (0, 3), (16, 0)]
        );
        assert!(overlay.around(&[], (0, 0), 5).is_empty());
    }

    #[test]
    fn the_distance_is_the_hex_distance() {
        let overlay = Overlay::new();
        let chunks = [((0, 0), vec![(2, -1), (2, 2), (-1, -1), (3, 0)], (0, 0))];
        // (2,-1) is 2 away, (2,2) is 4, (-1,-1) is 2, (3,0) is 3.
        assert_eq!(overlay.around(&chunks, (0, 0), 2), [(2, -1), (-1, -1)]);
        assert_eq!(overlay.around(&chunks, (0, 0), 3).len(), 3);
    }

    fn grass(_q: i32, _r: i32) -> Option<Terrain> {
        Some(Terrain::Grass)
    }

    #[test]
    fn the_troop_pushes_an_enemy_in_line_and_the_overlay_follows() {
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(1, 0), (3, 3)], (0, 0))];
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (-1, 0), (-2, 0)], grass, (1, 0))
            .unwrap();
        assert_eq!(played.troop, [(1, 0), (0, 0), (-1, 0)]);
        assert_eq!(played.foes, [(1, 0), (3, 3)]);
        assert_eq!(played.enemies, [(2, 0), (3, 3)]);
        assert!(played.ejected.is_empty());
        assert_eq!(played.dir, (1, 0));
        assert_eq!(overlay.removed(), [(1, 0)]);
        assert_eq!(overlay.added(), [(2, 0)]);
        assert_eq!(overlay.beaten(), 0);
    }

    #[test]
    fn on_the_ice_the_last_enemy_slides_one_cell_more_when_it_is_free() {
        let chunks = [((0, 0), vec![(1, 0), (3, 3)], (0, 0))];
        let ice = |q: i32, _r: i32| q == 2;
        let mut overlay = Overlay::new();
        let played = overlay
            .troop_push_on(&chunks, &[(0, 0), (-1, 0), (-2, 0)], grass, ice, (1, 0))
            .unwrap();
        assert_eq!(played.enemies, [(3, 0), (3, 3)]);
        assert_eq!(overlay.added(), [(3, 0)]);
        // a marble beyond, or a boulder, stops it on the ice
        let held = [((0, 0), vec![(1, 0), (3, 0)], (0, 0))];
        let mut overlay = Overlay::new();
        let played = overlay
            .troop_push_on(&held, &[(0, 0), (-1, 0), (-2, 0)], grass, ice, (1, 0))
            .unwrap();
        assert!(played.enemies.contains(&(2, 0)));
        let rock = |q: i32, _r: i32| {
            Some(if q == 3 {
                Terrain::Boulder
            } else {
                Terrain::Grass
            })
        };
        let mut overlay = Overlay::new();
        let played = overlay
            .troop_push_on(&chunks, &[(0, 0), (-1, 0), (-2, 0)], rock, ice, (1, 0))
            .unwrap();
        assert_eq!(played.enemies, [(2, 0), (3, 3)]);
        // an ejected one does not slide
        let water = |_q: i32, _r: i32| Some(Terrain::Water);
        let mut overlay = Overlay::new();
        let played = overlay
            .troop_push_on(
                &[((0, 0), vec![(1, 0)], (0, 0))],
                &[(0, 0), (-1, 0), (-2, 0)],
                water,
                |_, _| true,
                (1, 0),
            )
            .unwrap();
        assert_eq!(played.ejected, [(1, 0)]);
    }

    #[test]
    fn an_enemy_pushed_into_water_is_ejected_and_counted() {
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(1, 0)], (0, 0))];
        let water = |_q: i32, _r: i32| Some(Terrain::Water); // only the cell beyond the enemy is asked for
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (-1, 0), (-2, 0)], water, (1, 0))
            .unwrap();
        assert_eq!(played.ejected, [(1, 0)]);
        assert!(played.enemies.is_empty());
        assert_eq!(overlay.beaten(), 1);
        assert_eq!(overlay.removed(), [(1, 0)]);
    }

    #[test]
    fn no_legal_push_changes_nothing() {
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(5, 5)], (0, 0))];
        assert_eq!(
            overlay.troop_push(&chunks, &[(0, 0), (-1, 0)], grass, (1, 0)),
            None
        );
        assert_eq!(overlay, Overlay::new());
        assert_eq!(
            overlay.troop_push(&[], &[(0, 0), (-1, 0), (-2, 0)], grass, (1, 0)),
            None
        );
    }

    #[test]
    fn only_the_enemies_within_the_reach_of_the_hero_are_in_the_push() {
        let mut overlay = Overlay::new();
        let chunks = [
            ((0, 0), vec![(1, 0)], (0, 0)),
            ((1, 0), vec![(16, 0)], (0, 0)),
        ];
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (-1, 0), (-2, 0)], grass, (1, 0))
            .unwrap();
        assert_eq!(played.foes, [(1, 0)]);
        assert_eq!(PUSH_REACH, 10);
    }

    #[test]
    fn a_cell_is_in_a_list_once_and_keeps_its_place() {
        let mut overlay = Overlay::new();
        overlay.apply(&[(1, 0), (1, 0)], &[(3, 0), (4, 0), (3, 0)], 0);
        assert_eq!(overlay.removed(), [(1, 0)]);
        assert_eq!(overlay.added(), [(3, 0), (4, 0)]);
        overlay.apply(&[(1, 0)], &[], 0);
        assert_eq!(overlay.removed(), [(1, 0)]);
    }

    #[test]
    fn hide_removes_generated_enemies_once() {
        let mut overlay = Overlay::new();
        overlay.hide(&[(1, 0), (2, 0), (1, 0)]);
        assert_eq!(overlay.removed(), [(1, 0), (2, 0)]);
        assert!(overlay
            .chunk_enemies(&[(1, 0), (2, 0)], (0, 0), (0, 0))
            .is_empty());
    }

    #[test]
    fn a_saved_overlay_comes_back_as_it_was() {
        let overlay = Overlay::from_parts(vec![(4, 4), (1, 1)], vec![(2, 2)], 7);
        assert_eq!(overlay.removed(), [(4, 4), (1, 1)]);
        assert_eq!(overlay.added(), [(2, 2)]);
        assert_eq!(overlay.beaten(), 7);
    }

    #[test]
    fn a_single_marble_shoves_a_foe_into_the_water_and_a_line_that_ejects_wins() {
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(1, 0), (7, 7)], (0, 0))];
        let sea = |q: i32, r: i32| {
            Some(if (q, r) == (2, 0) {
                Terrain::Water
            } else {
                Terrain::Grass
            })
        };
        let played = overlay.troop_push(&chunks, &[(0, 0)], sea, (3, 5)).unwrap();
        assert_eq!((played.ejected.clone(), played.dir), (vec![(1, 0)], (1, 0)));
        assert_eq!(played.troop, [(1, 0)]);
        assert_eq!(overlay.beaten(), 1);
        // A line that pushes without ejecting loses to a shove that ejects; a line that ejects wins.
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(1, 0), (0, -1)], (0, 0))];
        let sea = |q: i32, r: i32| {
            Some(if (q, r) == (0, -2) {
                Terrain::Water
            } else {
                Terrain::Grass
            })
        };
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (-1, 0), (-2, 0)], sea, (3, 5))
            .unwrap();
        assert_eq!(played.ejected, [(0, -1)]);
        let mut overlay = Overlay::new();
        let water = |_q: i32, _r: i32| Some(Terrain::Water);
        let chunks = [((0, 0), vec![(1, 0)], (0, 0))];
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (-1, 0), (-2, 0)], water, (3, 5))
            .unwrap();
        assert_eq!(played.troop, [(1, 0), (0, 0), (-1, 0)]);
    }

    #[test]
    fn a_marble_behind_a_far_foe_herds_it_one_cell_toward_the_water_and_the_goals_send_the_pusher()
    {
        let sea = |q: i32, _r: i32| {
            Some(if q >= 5 {
                Terrain::Water
            } else {
                Terrain::Grass
            })
        };
        let mut overlay = Overlay::new();
        let chunks = [((0, 0), vec![(2, 0)], (0, 0))];
        let troop = [(0, 0), (0, 1), (-1, 0)];
        assert_eq!(overlay.herd_goals(&chunks, &troop, sea, 1)[0], (0, (1, 0)));
        let played = overlay
            .troop_push(&chunks, &[(0, 0), (1, 0)], sea, (1, 1))
            .unwrap();
        assert_eq!(
            (played.enemies.clone(), played.ejected.clone(), played.dir),
            (vec![(3, 0)], vec![], (1, 0))
        );
        assert_eq!(played.troop, [(0, 0), (2, 0)]);
        assert_eq!(overlay.beaten(), 0);
        assert_eq!(overlay.added(), [(3, 0)]);
        // Nothing near: no goals; a marble elsewhere: no push.
        assert!(overlay.herd_goals(&[], &troop, sea, 1).is_empty());
        let mut overlay = Overlay::new();
        assert!(overlay
            .troop_push(&chunks, &[(0, 0), (0, 1)], sea, (1, 1))
            .is_none());
    }

    #[test]
    fn a_wandering_group_stands_shifted_from_where_it_starts() {
        let mut overlay = Overlay::new();
        let generated = [(1, 0), (2, 0)];
        assert_eq!(
            overlay.chunk_enemies(&generated, (0, 0), (0, 1)),
            [(1, 1), (2, 1)]
        );
        assert!(overlay.occupied(&generated, (2, 1), (0, 1)));
        assert!(!overlay.occupied(&generated, (2, 0), (0, 1)));
        // A marble gone is gone by the cell it starts on, wherever its group is.
        overlay.hide(&[(1, 0)]);
        assert_eq!(overlay.chunk_enemies(&generated, (0, 0), (0, 1)), [(2, 1)]);
        assert!(!overlay.occupied(&generated, (1, 1), (0, 1)));
        let blocks = [((0, 0), generated.to_vec(), (0, 1))];
        assert_eq!(overlay.around(&blocks, (0, 0), 3), [(2, 1)]);
    }

    #[test]
    fn a_generated_enemy_is_alive_until_its_start_cell_is_removed() {
        let mut overlay = Overlay::new();
        assert!(overlay.alive(&[(1, 0)], (1, 0)));
        assert!(!overlay.alive(&[(1, 0)], (2, 0)));
        overlay.hide(&[(1, 0)]);
        assert!(!overlay.alive(&[(1, 0)], (1, 0)));
    }

    #[test]
    fn the_troop_pushes_a_wandering_marble_where_it_stands_and_it_stops_wandering() {
        let mut overlay = Overlay::new();
        // It starts on (3, 0) and has wandered to (1, 0): the line meets it there.
        let blocks = [((0, 0), vec![(3, 0)], (-2, 0))];
        let played = overlay
            .troop_push(&blocks, &[(0, 0), (-1, 0), (-2, 0)], grass, (1, 0))
            .unwrap();
        assert_eq!((played.foes, played.enemies), (vec![(1, 0)], vec![(2, 0)]));
        assert_eq!(overlay.removed(), [(3, 0)]);
        assert_eq!(overlay.added(), [(2, 0)]);
        // Pushed again from where it stands, wherever the group is: it stays put.
        let again = [((0, 0), vec![(3, 0)], (0, 0))];
        assert_eq!(overlay.around(&again, (0, 0), 5), [(2, 0)]);
    }

    #[test]
    fn a_wandering_marble_ejected_names_the_cell_it_started_on() {
        let mut overlay = Overlay::new();
        let blocks = [((0, 0), vec![(3, 0)], (-2, 0))];
        let water = |_q: i32, _r: i32| Some(Terrain::Water);
        let played = overlay
            .troop_push(&blocks, &[(0, 0), (-1, 0), (-2, 0)], water, (1, 0))
            .unwrap();
        assert_eq!((played.ejected, played.homes), (vec![(1, 0)], vec![(3, 0)]));
        assert_eq!((overlay.beaten(), overlay.removed()), (1, &[(3, 0)][..]));
        // A marble a push moved before has no start cell to name: its own.
        let mut overlay = Overlay::from_parts(vec![], vec![(1, 0)], 0);
        let played = overlay
            .troop_push(
                &[((0, 0), vec![], (0, 0))],
                &[(0, 0), (-1, 0), (-2, 0)],
                water,
                (1, 0),
            )
            .unwrap();
        assert_eq!((played.ejected, played.homes), (vec![(1, 0)], vec![(1, 0)]));
        assert!(overlay.added().is_empty());
    }

    #[test]
    fn a_marble_pushed_onto_a_start_cell_that_is_free_is_not_the_generated_one_again() {
        let mut overlay = Overlay::from_parts(vec![(2, 0)], vec![], 0);
        let blocks = [((0, 0), vec![(1, 0), (2, 0)], (0, 0))];
        overlay
            .troop_push(&blocks, &[(0, 0), (-1, 0), (-2, 0)], grass, (1, 0))
            .unwrap();
        assert_eq!(overlay.removed(), [(2, 0), (1, 0)]);
        assert_eq!(overlay.added(), [(2, 0)]);
        assert_eq!(
            overlay.chunk_enemies(&[(1, 0), (2, 0)], (0, 0), (3, 0)),
            [(2, 0)]
        );
    }

    #[test]
    fn a_marble_next_to_the_hero_that_still_wanders_starts_a_wild_fight() {
        let overlay = Overlay::from_parts(vec![], vec![(0, 1)], 0);
        let blocks = [((0, 0), vec![(4, 0), (6, 6)], (-3, 0))];
        // (1, 0) is next to the hero; the pushed marble on (0, 1) is next to it too, but it is not a wanderer.
        let marble = overlay.wild_contact(&blocks, (0, 0)).unwrap();
        assert_eq!((marble.at, marble.home), ((1, 0), Some((4, 0))));
        assert!(overlay.wild_contact(&blocks, (5, 5)).is_none());
        assert!(overlay.wild_contact(&[], (0, 0)).is_none());
        let pushed = Overlay::from_parts(vec![], vec![(0, 1)], 0);
        assert!(pushed
            .wild_contact(&[((0, 0), vec![], (0, 0))], (0, 0))
            .is_none());
    }

    #[test]
    fn of_two_marbles_in_touch_the_one_that_started_on_the_lowest_row_and_column_fights() {
        let overlay = Overlay::new();
        let blocks = [((0, 0), vec![(1, 0), (0, 1), (-1, 1)], (0, 0))];
        assert_eq!(
            overlay.wild_contact(&blocks, (0, 0)).unwrap().home,
            Some((1, 0))
        );
        let blocks = [((0, 0), vec![(-1, 1), (0, 1)], (0, 0))];
        assert_eq!(
            overlay.wild_contact(&blocks, (0, 0)).unwrap().home,
            Some((-1, 1))
        );
    }
}
