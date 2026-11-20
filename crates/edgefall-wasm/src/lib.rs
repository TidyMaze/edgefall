//! Thin wasm-bindgen bridge over `edgefall-core`. No game logic lives here: it only converts
//! between core types and flat integer arrays (decision #74, local transport, no network).
//!
//! Encodings, all stable and documented:
//! - Board: 61 bytes, row by row from `r = -4` to `r = 4`, inside a row by `q` ascending.
//!   Value `0` empty, `1` Black, `2` White, `3` vanished (a cell a boss removed, The Hull),
//!   `4` to `7` a marble of battle royale seats 3 to 6, `8` a core and `9` the Overseer (The
//!   Overseer's fight).
//!   Index 0 is `(q=0, r=-4)`, index 60 is `(q=0, r=4)`. The radius 5 board of The Ballast Mind
//!   has 91: the same 61, then its outer ring, row by row from `r = -5`, `q` ascending. The Dual
//!   Room's board scans radius 7, 169 codes: the same 91, then rings 6 and 7, each row by row, its
//!   two rooms on the rows `r >= 1` (south) and `r <= -1` (north), every other cell vanished, the
//!   void's row `r = 0` too until the bridge's 5 cells (`q = -2` to `2`) turn empty in P3.
//! - Dual (The Dual Room): `[bridged, side, q, r]`, `1` once the bridge is up, then the side of the
//!   announced return and its landing cell, side `0` (and `0, 0`) when none. Last return: `[side, q,
//!   r]` of the marble that landed at the end of the last ply, empty when none.
//! - Cracks (The Hull): records of 3 integers `[q, r, plies_left]`, back to back.
//! - Eggs (The Alien): records of 3 integers `[q, r, player_turns_left]`, back to back.
//! - Trains (The Rail Yard): records of 6 integers `[line, player_turns_left, entry_q, entry_r,
//!   exit_q, exit_r]`, back to back: the train runs its line from the entry cell to the exit cell
//!   (docs/specs/game-design.md section 7.8 numbers the lines).
//! - Pulsar (The Pulsar): `[pulsar, player_turns_left, force]`, the pulsar of the next pulse as
//!   the direction code it pushes in (it stands off the corner the other way), the player turns
//!   before it fires and its force, `0` for infinite (docs/specs/game-design.md section 7.10).
//! - Last pulse (The Pulsar): the pulsar, then the 61 board codes just before the pulse, then the
//!   cells of the marbles it moved, from where they stood, as `[q, r]` pairs.
//! - Belts (The Assembly Line): `[turns_left, ...]`, the player turns left before the centre belt
//!   reverses, then one record of 6 integers per belt, the centre belt first: `[row, q0, len, dir,
//!   shift, strike]`. The belt is the `len` cells of row `row` from `q0`; `dir` is `1` toward +q, `-1`
//!   toward -q, `0` when it does not run; slot `s` of its pattern shows on cell index
//!   `(s + shift) % len`, the strike slots being the odd ones; `strike` is the cell index of the slot
//!   the press strikes after the next player move, `-1` for none (docs/specs/game-design.md section 7.12).
//! - Last belts (The Assembly Line): records of 6 integers `[q, r, to_q, to_r, fate, code]`, back to
//!   back: a marble the last ply's belts touched, `fate` `0` carried to the target cell, `1` fell off
//!   the end (the target is the cell past it), `2` struck by a press; `code` the board code.
//! - Cell list (The Chaplain, the cells The Magnetizer just polarized): pairs `[q, r]`, back to back.
//! - Incinerators (The Overseer): a cell list. Removed (its burns): records of 3 integers
//!   `[q, r, code]`, the board code of each marble the last ply's hook removed, back to back.
//!   Turns left (its slag fill): the player turns before the boss wins, `-1` with no clock.
//! - Polarities (The Magnetizer): one integer per cell, in the board order: `0` none, `1` +, `-1` −.
//! - Announce (The Magnetizer): `[q, r, sign]` of the marble that takes `sign` at the start of the
//!   next assignment turn, empty when none.
//! - Repulsions (The Magnetizer): records of 126 integers, the pair `[q_a, r_a, q_b, r_b]` (`b`
//!   moves away from `a` and `a` away from `b`), then the 61 board codes and the 61 polarities just
//!   before that repulsion, in the order they happened during the last ply.
//! - Armies (The Choir): records of 3 integers `[q, r, army]`, back to back. Army `0` Alto,
//!   `1` Tenor, `2` Bass, the order of the cycle. On the Choir's radius 3 board the outer ring
//!   is `3`, like a vanished cell.
//! - Side and winner: `1` Black, `2` White.
//! - Status: `0` running, `1` Black won, `2` White won, `3` draw.
//! - Draw reason: `0` none, `1` threefold repetition, `2` 100 plies without ejection, `3` neither
//!   side has a legal move.
//! - Passed: `0` none, else the side code whose turn passed after the last ply, as it had marbles
//!   but no legal move (rules.md section 7).
//! - Result of an encounter: `0` playing, `1` won, `2` lost (a draw is a loss).
//! - Move: 8 integers `[n, dir, q0, r0, q1, r1, q2, r2]`, `n` in 1..=3 marbles, unused
//!   coordinates are `0`. `dir`: `0` E, `1` W, `2` NE, `3` SW, `4` NW, `5` SE.
//!   `legal_moves` returns the records back to back.
//! - Tactic (a rogue-lite fight, `Engine::play`): 8 integers `[0, code, q0, r0, q1, r1, 0, 0]`, the `0`
//!   where a move has its marble count. `code` `1` Reinforce, `2` Freeze, `3` Swap of `(q0, r0)` and
//!   `(q1, r1)`, `4` Fall back (docs/specs/roguelite.md section 11). `Engine::tactics` is the mask of
//!   those the army can play now, bit `code - 1`.
//! - Replay score (`replay_score(moves)`, a ranked 1v1 log read from a relay, #1287): the move records of a standard game back to back,
//!   answered by `[status, black ejections, white ejections]`, or empty when the log is cut inside a record, has an illegal move,
//!   or goes on after the game ended: a log that does not replay has no score.
//! - Score (the evaluation bar): the search score for the side to move, in centi-marbles (one
//!   marble is 100). A won game scores 1 000 000 minus the plies to the win, a lost one the
//!   opposite, a draw 0: beyond +/-500 000 the game is decided.
//! - Battle royale (`Royale`). A seat is a number from `0` to `seats - 1`.
//!   - Arena: 217 bytes, row by row from `r = -8` to `r = 8`, inside a row by `q` ascending, the
//!     order of `cellsFor(8)` in `client/src/board.ts`. Index 0 is `(q=0, r=-8)`, index 216 is
//!     `(q=0, r=8)`. The board codes above: `0` empty, `1` and `2` seats 0 and 1, `4` to `7`
//!     seats 2 to 5, `3` void. A cracked cell, which goes void at the end of the next round, adds
//!     `8` to its code: `8` cracked and empty, `9` a cracked cell with a seat 0 marble.
//!   - Legal orders (`legal_orders(seat)`): the seat's move records, back to back.
//!   - Orders: records of 9 integers `[seat, n, dir, q0, r0, q1, r1, q2, r2]`, a seat then its
//!     move record, back to back. A seat with no record holds, like the empty order of the client.
//!   - Round log: the round number, then one record of 3 integers `[seat, outcome, ejected]` per
//!     turn in initiative order. Outcome `0` applied, `1` fizzled (illegal at its turn, a pass),
//!     `2` held, `3` out (no marble left at its turn). `ejected` is the seat whose marble the
//!     move ejected, `-1` for none.
//!   - Cracks: records of 3 integers `[q, r, rounds_left]`, back to back.
//!   - Placement: one record of 2 integers `[place, points]` per seat in seat order, places from
//!     `1`, empty while the game runs.
//!   - State hash: 16 lowercase hex digits, the same on every peer for the same state.
//! - Special marbles of a rogue-lite fight (`Engine::specials`, `Engine::place_special`): records
//!   of 3 integers `[q, r, kind]`, in `q` then `r` order. `kind` `1` Heavy, `2` Anchor, `3` Spark,
//!   and upgraded `4` Heavy+, `5` Anchor+, `6` Spark+ (docs/specs/roguelite.md sections 5 and 10),
//!   then `7` Magnet, `8` Shield, `9` Bomb, `10` Medic (section 13).
//!   A Bomb's turns left (`Engine::fuses`): records of 3 integers `[q, r, turns]` for the Bombs only, `3` at the start.
//! - Relics of a rogue-lite fight (`Engine::set_relics`): a bit mask, bit `code` set for each relic
//!   the army holds. `code` `0` Gyroscope, `1` Hull plating, `2` Salvage magnet, `3` Jammer, `4`
//!   Detonator, `5` Bunks, `6` Lucky coin, `7` Bargain, `8` Saboteur, `9` Dampener, `10` War chest,
//!   `11` Quartermaster (docs/specs/roguelite.md section 9). The same mask carries the army's affinities from bit 16:
//!   the level, 0 to 2, of Force, Tactics and Chaos on 2 bits each, in that order (section 23).
//! - Rogue-lite map (`run_map(seed, runes, version)`, `version` the optional generation of the map, `0` of a run saved before the pacing (the default), `1` the paced map of docs/specs/roguelite.md section 2, `runes` the optional mask of the runes the player owns, `1` room, `2` shortcut, `4` exit,
//!   section 27): records of 7 integers `[act, row, col, kind, links, formation, elite]` per node,
//!   act by act from `0`, row by row, `col` ascending. `kind` `0` fight, `1` boss (the last row of
//!   an act), `2` elite, `3` rest, `4` event (no longer drawn), `5` treasure, `6` shop, `7` unknown (a "?" the page turns
//!   into an event, a fight or a treasure), `8` secret room (the page plays a treasure). `links` is a bit mask of the columns of the next row of the same act the node leads
//!   to, its bits `8 + c` the columns `c` of the row after the next it skips to (the shortcut); a boss leads to every node of the next act's first row (docs/specs/roguelite.md). `formation` is how the bot's marbles stand in
//!   a fight or an elite: `0` standard, `1` Belgian daisy, `2` German daisy, `3` snake, `4` wedge (`0` on the other nodes); `elite` is
//!   `0` for a node that is no elite, else `1` The Wall, `2` The Artificer, `3` The Brute (section 14).
//! - The bot's army of a fight (`run_foes(seed, node, less, biome, more, version)`, `more` optional special marbles for the ascension levels, section 20, `version` the map's generation as `run_map`'s): `[count, formation, biome, ...]` then a record `[q, r, kind]` per
//!   special marble it holds; `Engine::with_foes(army, plan)` stands it, the biome's holes opened (sections 14 and 18). `biome` is
//!   the Open world's code below (`0` meadow, the act 1 default, which opens none).
//! - The exits at the end of an act (`run_exits(seed, act, from, runes, first)`): the codes of the two biomes the exits lead to for act `act`
//!   (1 or 2) of a run that left the biome `from`, never the meadow, `from` nor `first`, the biome the run began in (section 18), and a third with the rune of the exit (section 27).
//! - Open world chunk (`world_chunk(seed, cx, cy)`): 3 bytes `[height, terrain, biome]` per cell of the
//!   16 x 16 chunk, row by row (`r` then `q` ascending), empty off the world. The world is a hexagon (`WORLD_RADIUS`): in a
//!   chunk its edge crosses, a cell past the edge is `[0, 255, 0]`, `255` off the world. `height` `0` to `7`;
//!   `terrain` `0` water, `1` sand, `2` grass, `3` rock, `4` peak, `5` boulder, `6` tree, `7` wall;
//!   all but sand, grass and rock are blocked; `biome` `0` meadow, `1` forest, `2` tundra, `3` desert,
//!   `4` badlands, `5` archipelago, the biome of the cell, from the climate map (docs/specs/openworld.md section 2, openworld-terrain.md section 4).
//! - Open world lairs (`world_lairs(seed)`): one boss lair per boss of the roster, `q, r` pairs, lair 0 first, each at least 150 cells from the
//!   spawn on open ground, lair `k` the boss `k` on the cell its tier gives it: the nearest is the easiest (docs/specs/openworld.md sections 7
//!   and 15).
//! - Open world rings (`world_rings(seed)`): the ring of each boss's tower, boss 0 first, then one per place of `world_places` (`0` for a town,
//!   the dungeon tier for a gate), docs/specs/openworld.md section 15.
//! - Open world teleporters (`world_teleporters(seed)`): `q, r` pairs, the spawn's first, one a square of 8 x 8 chunks, kept off
//!   the lairs (docs/specs/openworld.md section 10).
//! - Open world places (`world_places(seed)`): the towns then the dungeon gates, `kind, q, r` triples (`kind` `0` a town, `1` a dungeon
//!   gate), the spawn town first, kept off the lairs, the teleporters and the logs (docs/specs/openworld.md section 13).
//! - Open world cairns (`world_cairns(seed, cx, cy)`): the cairns of a chunk, `q, r` pairs, about one a chunk, so no open cell lies farther than 16 cells from a
//!   landmark (#1533, docs/specs/openworld.md section 13).
//! - Open world push (`world_push(seed, troop, enemies, broken)`): `troop` is the hero's cell then the troop's,
//!   `enemies` the enemy marbles near the hero, `q, r` pairs. Empty when no push is legal, else
//!   `[ejected_q, ejected_r, ejected_kind, ntroop, ...troop, nenemies, ...enemies, dir_q, dir_r]`:
//!   `ejected_kind` `0` none, `1` water, `2` edge, with the ejected enemy's cell before the push (`0, 0`
//!   when none); the new cells keep the input order and the ejected enemy is left out of `enemies`;
//!   `dir` is the push's axial step (docs/specs/openworld.md section 4). `broken` is the `q, r` pairs of the boulders and trees the
//!   hero has broken: plain ground for the push.

pub mod convert;
pub mod encounter;
pub mod game;
pub mod royale;
pub mod run;
pub mod world;

pub use convert::{draw_reason_code, result_code, status_code, MOVE_STRIDE};
pub use encounter::{boss_goal, boss_ids, boss_name, engine_version, Encounter};
pub use game::{replay_score, Engine};
pub use royale::Royale;
pub use run::{run_exits, run_foes, run_map};
pub use world::{
    world_cairns, world_chunk, world_lairs, world_logs, world_places, world_rings,
    world_teleporters, world_version,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn re_exports_and_submodules_are_accessible() {
        assert_eq!(MOVE_STRIDE, 8);
        assert_eq!(convert::MOVE_STRIDE, 8);
        assert_eq!(engine_version(), 26);
        assert_eq!(encounter::engine_version(), 26);
        let engine = Engine::new();
        assert_eq!(engine.to_move(), 1);
        let encounter = Encounter::new("echo", 1).unwrap();
        assert_eq!(encounter.name(), "The Echo");
        let royale = Royale::new(3, 1).unwrap();
        assert_eq!(royale.board().len(), 217);
    }
}
