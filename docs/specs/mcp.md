---
id: mcp
type: module-design
status: draft
title: "MCP server spec (#251, from #163)"
parent: architecture
depends-on:
  - edgefall-wasm
  - client
---

# MCP server spec (#251, from #163)

Status: spec, no code. Lets an AI agent play Edgefall through the Model Context Protocol (MCP): a game against the bot, a boss fight, or an online room.

## 1. Decisions (from the last comment of #163)

1. The server is a **local stdio process**. Free. No hosted server before open beta (#74).
2. Online rooms: **embed the P2P client in Node** (Trystero with a WebRTC polyfill). No browser driving. Owner's choice.
3. The agent has **its own Ed25519 key and a seat** like any peer (#117).
4. Agent players are flagged with an **`agent` field in the signed `Hello`** and shown as such in the room.

## 2. The engine is the only judge

- The server holds no rules. Every legal move, every result and every bot or boss reply comes from `edgefall-wasm` (`Engine` and `Encounter`), which wraps `edgefall-core`.
- The agent never sends a state. It sends a move. The server asks the engine to play it. If the engine says no, the state does not change and the tool returns the engine's reason.
- `legal_moves` is the list the engine returns. A move that is not in it is illegal, whatever the agent believes.
- Online, the server also checks every move it receives with the engine (rules.md section 10.2, tech.md section 6). A peer that sends an illegal move is dropped.
- Resign is the one thing the engine does not model (rules.md OPEN-12). See `resign` in section 5.

## 3. Notation

### 3.1 Cells and moves

Same notation as `edgefall-cli` (`parse_move` in `crates/edgefall-cli/src/lib.rs`) and rules.md section 1.

- A cell is `(q,r)`, no space, for example `(-3,2)`. The board has 61 cells with `max(|q|,|r|,|q+r|) <= 4`.
- A move is the selected cells, then `>`, then the direction: `(-1,2)(0,2)>E`. One marble: `(0,0)>SE`.
- Directions: `E`, `W`, `NE`, `SW`, `NW`, `SE`. Upper case only.
- Cell order inside a move is kept as written.
- Parse errors reuse the `ParseError` messages of `edgefall-cli`: `empty input`, `missing '>' before the direction`, `no cell before '>'`, `cell must look like (q,r), for example (0,0)`, `direction must be E, W, NE, SW, NW or SE`.

### 3.2 Bridge to the engine

`edgefall-wasm` takes a move as 8 integers `[n, dir, q0, r0, q1, r1, q2, r2]` (`MOVE_STRIDE`). `n` is 1 to 3 marbles, unused coordinates are `0`. `dir` is the index in `E, W, NE, SW, NW, SE` (0 to 5). The MCP server converts between the string and this record at the edge. Nothing else converts.

### 3.3 Other codes

Use the codes of the `edgefall-wasm` module doc, mapped to words in the tool output:

| Field | `edgefall-wasm` code | MCP value |
|---|---|---|
| side (`to_move`) | `1`, `2` | `"black"`, `"white"` |
| status | `0` running, `1` Black won, `2` White won, `3` draw | `"running"`, `"black_won"`, `"white_won"`, `"draw"` |
| draw reason | `0` none, `1` repetition, `2` no ejection cap | `null`, `"repetition"`, `"no_ejection_cap"` |
| boss result (`result`) | `0` playing, `1` won, `2` lost | `"playing"`, `"won"`, `"lost"` |

A draw against a boss is a loss (rules.md section 10.3).

## 4. State

### 4.1 Who plays what

- Against the bot or a boss, the agent is Black and moves first. The bot or boss is White (same as `Encounter`).
- Online, the seat comes from the room (section 7).
- `play_move` plays the agent's move, then the bot or boss reply in the same call, so `get_state` always shows a position where the agent is to move, or a finished game.

### 4.2 `get_state` output

```json
{
  "game_id": "string",
  "mode": "bot | boss | online",
  "you": "black | white",
  "to_move": "black | white",
  "status": "running | black_won | white_won | draw",
  "draw_reason": "null | repetition | no_ejection_cap | blocked",
  "passed": "null | black | white",
  "resigned": false,
  "ejected": { "black": 0, "white": 0 },
  "win_ejections": { "black": 6, "white": 6 },
  "ascii": "string",
  "ascii_key": "string",
  "marbles": { "black": ["(0,4)"], "white": ["(0,-4)"] },
  "board": "string",
  "last_moves": ["(0,0)>SE"],
  "boss": null
}
```

- `ejected` is `Engine.ejected(side)`: marbles that side has pushed out. `win_ejections` is `Engine.win_ejections(side)`.
- `ascii` is the board as printed by `render` in `edgefall-cli`: header `  1 2 3 4 5 6 7 8 9`, rows `a` to `i`, `B`, `W`, `.`. On a radius 5 board (The Ballast Mind), `ascii` has header `  0 1 2 3 4 5 6 7 8 9 A` and 11 rows `a` to `k` (`r = -5` to `5`).
- `marbles` lists the cells of each side in the notation of `play_move`, `(q,r)`, in `board` order (#1676); `ascii_key` says how to read a cell of `ascii` as `(q,r)` (row letter gives `r`, column header gives `q`).
- `board` is the cells in `Engine.board()` order, one character per cell: row by row from `r = -4` to `r = 4`, `q` ascending inside a row (61 cells). On a radius 5 board (The Ballast Mind), `board` has 91 characters: the 61 of the standard board first, then ring 5 in board order (rows from `r = -5` to `5`, `q` ascending). The Dual Room's board has 169: the same 91, then rings 6 and 7 in turn, each row by row; every cell off its two rooms is `x` (the void's row `r = 0` too, until the bridge's 5 cells turn `.` in P3), and `ascii` shows it with columns `0` to `E` and rows `a` to `o`. `.` empty, `B` Black, `W` White, `x` vanished (`3` in the engine), `c` a core and `O` the Overseer (The Overseer).
- `last_moves` is the last 6 plies in the notation of section 3.1, oldest first, boss and bot moves included.
- `resigned` is `true` after `resign`. It is the only field the engine does not own.
- `passed` is the side whose turn passed after the last ply, as it had marbles but no legal move (`Engine.passed()`, rules.md section 7, #1301), else `null`. `draw_reason` `blocked`: neither side has a legal move.

### 4.3 Boss state (phase and tell)

`boss` is `null` unless `mode` is `boss`. Otherwise it is one generic object, the same shape for every boss. No tool and no field is named after a boss: what a boss does shows up as data in `tell` and `marks`, so a new boss needs no change to the tool list or the schema.

```json
{
  "id": "string, one of boss_ids()",
  "name": "string",
  "phase": 0,
  "phases": 4,
  "tell": { "kind": "string", "cells": ["(q,r)"], "text": "string" },
  "marks": [{ "kind": "string", "cell": "(q,r)", "value": 2 }],
  "result": "playing | won | lost"
}
```

| Field | Engine source | Meaning |
|---|---|---|
| `id`, `name` | `boss_ids()`, `Encounter.name()` | `id` is one of `boss_ids()` |
| `phase`, `phases` | `Encounter.phase()`, `Encounter.phases()` | `0` is P1. It rises when the boss marble count drops under a threshold (rules.md section 10.3) |
| `tell` | `Encounter.tell()` and the boss's own getters | What the boss will do right after the next ply, shown one ply early. `null` when there is none. `kind` is a short stable id, `cells` the cells it touches, `text` a one-line description for the agent |
| `marks` | the boss's own getters | Cells the boss marked on the board, each with a `kind` and an optional number `value` |
| `result` | `Encounter.result()` | Fight result. A draw is a loss |

How the engine's per-boss getters map into the generic shape (the server does this, an agent never sees the getter names):

| Boss data in the engine | Shows up as |
|---|---|
| `Encounter.next_army()` | `tell` with `kind: "next_army"`, the marbles of that army in `cells` and the army in `text` |
| `Encounter.flips()` | `tell` with `kind: "flip"` and the cells that flip if nothing moves |
| `Encounter.pulsar()` | `tell` with `kind: "pulse"`, no cells, and the way the next pulse pushes, the player turns left before it and its force in `text` (The Pulsar) |
| `Encounter.charges()` | `marks` with `kind: "charge"` and `value` = the marble's charges (The Unstable Core: a marble weighs 1 + its charges in a push) |
| `Encounter.unstable()` | `tell` with `kind: "core"`, no cells, and the next event (collapse, shockwave) in `text` (The Unstable Core) |
| `Encounter.dual()` | `marks` with `kind: "return"` on the announced landing cell and `value` = the side of the coming marble; `tell` with `kind: "return"` and that cell while a marble is coming, else `kind: "bridge"`, no cells, the void or the bridge in `text`, and until the bridge the room this move is played in (The Dual Room: its board is 169 cells, the radius 7 scan of its two rooms; `legal_moves` lists only the moves of that room, #992) |
| `Encounter.cracks()` | `marks` with `kind: "crack"` and `value` = plies left |
| `Encounter.eggs()` | `marks` with `kind: "egg"` and `value` = player turns left before it hatches (The Alien) |
| `Encounter.trains()` | `marks` with `kind: "train"` on every cell of the train's line, from its entry, and `value` = player turns left before it passes (The Rail Yard) |
| `Encounter.polarities()` | `marks` with `kind: "polarity"` and `value` = `1` for +, `-1` for − (The Magnetizer) |
| `Encounter.incinerators()` | `marks` with `kind: "incinerator"` (The Overseer); its cores are `c` and the Overseer `O` on the board |
| `Encounter.turns_left()` (`-1` is no clock) | `tell` with `kind: "slag"` and the player turns left in `text`, with the pull of the vents (The Overseer) |
| `Encounter.ballast_next()` (`-1` is none) | `tell` with `kind: "borrowed"` and the effect The Ballast Mind borrows at the end of this turn in `text` (the Hull's crack, the Pulsar's pulse, the Magnetizer's polarity, the Chaplain's conversion check, the Swarm's wave) |
| `Encounter.belts()` | `marks` with `kind: "belt"` on every cell of a running belt and `value` = `1` toward +q, `-1` toward -q; `kind: "strike"` on the cell of an announced strike slot; and `tell` with `kind: "belt_reverse"` and the player turns left before the centre belt reverses in `text` (The Assembly Line) |
| `Encounter.swarm()` | `marks` with `kind: "arrival"` on each cell where a swarm marble lands after the player's move; `tell` with `kind: "arrival"`, those cells, and the turns left on the evac clock (2 fewer per swarm marble the agent ejects, and the jump its last move made), and a pass in `text` (The Swarm) |
| `Encounter.converted()` | `marks` with `kind: "converted"` |
| `Encounter.armies()` | `marks` with `kind: "army"` and `value` = `0` Alto, `1` Tenor, `2` Bass |
| `Encounter.tell()` id (`-1` is none, `0` is an id: the end of a player turn) | `tell.kind` = `"special"` when no more specific kind applies, the id in `text` |

Rules for the generic shape:

- When several `tell` rows apply, the first one in the table wins: `next_army`, then `flip`, then `pulse`, then `slag`, then `borrowed`, then `special`.
- An unknown `kind` is not an error: an agent that does not know it ignores it and still plays legally. The tell is information, not a rule.
- `kind` values are stable once published. A new boss may add kinds, never rename one.
- The Ballast Mind's pillars show as `x` in `board`. The win threshold is read from `win_ejections` in `get_state`, never hard-coded. A `win_ejections` of `0` means that side does not win by ejections (the agent against The Swarm holds out until its 40-turn evac clock runs out instead).

## 5. Tools

All tools return JSON as MCP text content. A failure sets `isError: true` with an error object (section 6). The server keeps one game at a time.

### `new_game`

Starts a local game and drops any game in progress.

Input:

```json
{
  "boss": "string, optional, one of boss_ids()",
  "seed": "integer 0 to 4294967295, optional, default 0",
  "bot_nodes": "integer 1 to 200000, optional, default 20000"
}
```

- No `boss`: a game against the bot, mode `bot`. The bot searches at most `bot_nodes` positions per move (`Engine.best_move(nodes)`). 20000 is `BOT_NODES` in `client/src/bot.ts`.
- With `boss`: mode `boss`, `Encounter.new(boss, seed)`. The same id and seed always give the same fight. `bot_nodes` is ignored, the boss uses its own budget.

Output: the `get_state` object.

Errors: `unknown_boss`.

### `get_state`

Input: none. Output: the object of section 4.2. Errors: `no_game`.

### `legal_moves`

Input: none.

Output:

```json
{ "to_move": "black | white", "moves": ["(0,0)>SE", "..."], "announces": {}, "free": [], "count": 0 }
```

- `moves` is `Engine.legal_moves()` (or `Encounter.legal_moves()`) in notation. Empty once the game is over.
- On a boss turn that restricts the moves (for example the army in turn), the list only holds the allowed moves. Nothing else changes.
- `announces` is an object from a move to the reply the boss announces for it (`Encounter.tell_move(mv)`): for The Echo, the first bonus move that move gives it, a move with no bonus is left out (#859). It is empty unless the boss announces replies. Same shape for every boss, no per-boss output type.
- `free` is the free moves The Echo offers the agent now (`Encounter.free_moves()`, #958), also in `moves`. Playing one keeps the agent to move (no reply); playing any other move declines them all. Empty against the bot, the other bosses and online.

Errors: `no_game`.

### `play_move`

Input:

```json
{ "move": "(-1,2)(0,2)>E" }
```

Behaviour:

1. Parse the string (section 3.1). On failure: `bad_move`.
2. Convert to a record and call `play`. The engine rejects an illegal move: `illegal_move`, state unchanged.
3. While the game is still running and it is the bot's or boss's turn (not after one of The Echo's free moves), play its reply (`Engine.best_move(bot_nodes)` or `Encounter.boss_move()`) and apply it with `play`. A bot with no legal move has passed, so there is no reply; an agent with no legal move passes too, so the bot replies again (#1301).

Output:

```json
{
  "played": "(-1,2)(0,2)>E",
  "reply": "(1,-2)>SW",
  "bonuses": [],
  "state": { "...": "the get_state object" }
}
```

`reply` is `null` when the game ended on the agent's move, the move was one of The Echo's free moves, or the bot had no legal move and passed (`state.passed`). After an agent pass it is the bot's last reply, every reply is in `last_moves`. `bonuses` lists the bonus plies The Echo's rule played after the agent's move, in order (`Encounter.last_bonuses()`, #859), empty otherwise: the agent's own bonus is offered in `legal_moves.free`, never played for it (#958). Online, `reply` is always `null`: use `wait_for_opponent_move` (section 7).

Errors: `no_game`, `game_over`, `not_your_turn`, `bad_move`, `illegal_move`.

### `create_room`

Online. Opens a room and takes a seat. Drops any game in progress. See section 7.

Input: `{ "boss": "optional, one of boss_ids()", "seed": "optional, default 0" }`. The `Hello` has no name field, so a room shows no display name: the seat shows as an agent (section 8). With `boss` the room is a boss duel (section 7.1).

Output:

```json
{
  "room": "string, random 8+ characters (tech.md section 6)",
  "invite": "string, link a human opens in the client",
  "you": "black",
  "pub": "string, base64url Ed25519 public key of the agent"
}
```

The game starts when a second peer joins and both `Hello` are verified. `room` is `newRoomId` and `invite` is `inviteUrl` of `client/src/invite.ts`, on the live site, ending with `&key=<fingerprint>`: the `fingerprint` of the agent's public key (#1323), so a human who joins binds seat 1 only to this agent. Errors: `already_in_room`, `unknown_boss`, `transport_failed`.

### `join_room`

Online. Joins a room made by a human or by another agent.

Input:

```json
{ "room": "string, a room code or an invite link" }
```

An invite link that ends with `&key=<fingerprint>` (`creatorFromHash`) is passed to the session as `creator`: the agent binds seat 1 only to the creator whose public key has this fingerprint, and ignores any other first `Hello` (#1323). A link without `&key=` (an older one) and a bare room code bind seat 1 to the first `Hello`, as before; `invite` in the output keeps the link's own `&key=`.

Output: same shape as `create_room`, with `you` set to the seat the room gave (`white` if Black is taken). The call returns once the creator's `Hello` gave the agent its seat. A failed join keeps the game in progress. Errors: `already_in_room`, `unknown_boss` (a boss-seat link, section 7.1), `room_full` (both seats taken, the agent would be a spectator and the server does not support spectating), `room_not_found` (no peer answered within the connect timeout, `SIGNALING_TIMEOUT_MS` of `client/src/netcounters.ts`, 30 s, the only creator runs another engine version (tech.md section 9), or the input holds no room code), `transport_failed`.

### `wait_for_opponent_move`

Online. Blocks until something happens. It never hangs: it returns at `timeout_s`.

Input:

```json
{ "timeout_s": "integer 1 to 120, optional, default 30" }
```

Output:

```json
{
  "event": "opponent_moved | game_over | opponent_left | desync | timeout",
  "move": "(1,-2)>SW",
  "state": { "...": "the get_state object" }
}
```

- `move` is set only for `opponent_moved`. It is `null` when nobody moved yet: the room creator's first call returns once the opponent has taken its seat.
- `opponent_moved` means it is the agent's turn and its opponent is connected: `play_move` can go.
- `opponent_left`: the data channel closed. Seats are kept for 60 s (rules.md section 10.2). The agent may call the tool again. Reported once per leave.
- `desync`: the opponent sent a move the agent refused, one that shows its log or position is not ours (`bad-chain`, `out-of-order`, `illegal` or `not-their-turn`, the desync reports of tech.md section 10, until moves carry a state hash). The move is not played, so the opponent stays to move: the game is paused (rules.md section 10.2). `get_state` still works. Reported once per refused move.
- If it is already the agent's turn, the call returns at once with `event: "opponent_moved"` and the last move.
- When several apply, the first of `desync`, `game_over`, `opponent_left`, `opponent_moved` wins.

Errors: `no_room`.

### `resign`

Input: none.

- **Local game or boss:** marks the game as resigned. `status` becomes the opponent's win (`white_won`), a boss `result` becomes `lost`, `resigned` is `true`. The engine is not asked, since it has no resign.
- **Online:** returns `not_supported`. Resign is rules.md OPEN-12 and an online resign needs a new signed message, so it waits for an owner decision. No tool path fakes it.

Output: the `get_state` object. Errors: `no_game`, `game_over`, `not_supported`.

### Open world tools (#1292)

An agent walks the Open world (`openworld.md`) with six tools. Every rule is the Rust core's (`edgefall-wasm`), called in the client's order (`OpenWorldMode.roll`): the map, the enemies, the lairs, the teleporters and the path (`world_chunk`, `world_enemies`, `world_lairs`, `world_teleporters`, `world_path`), the step (`world_enter`, `world_trail`) and the troop's push (`WorldFight`). So the same seed and the same moves give the client's result; the server only holds the hero, the troop, the broken cells, the fight and the lairs beaten. The enemy marbles of the browser wander on a wall clock and meet the hero in a wild fight (`openworld.md` sections 3b and 3c): the server has no real time and no board fight to start, so its `WorldFight` never sets a clock, every marble stays where it starts, and no step meets a wild fight. Nothing of its tools or its saves changes (#1511). The world is separate from the game of `new_game`: both can be open at once. Cells are written `(q,r)` as in section 3.

| Tool | Input | Output |
|---|---|---|
| `new_world` | `seed` 0 to 4294967295, default 0, or `save` | the world state, the hero on the spawn `(0,0)`, the troop round it, no push, or the world of `save` as it was; drops the world in progress |
| `world_state` | `radius` 1 to 8, default 3 | the world state |
| `save_world` | none | the world in the client's save format |
| `world_step` | `direction` E, W, NE, SW, NW, SE | `{ moved, smashed, push, lair?, state }` |
| `world_walk` | `q`, `r` | `{ steps, pushes, state }` |
| `world_teleport` | `q`, `r` | the world state |

World state: `seed`, `hero`, `troop` (the hero's trail, 6 cells), `broken` (obstacles broken), `beaten` (enemies ejected), `enemies` (the marbles inside the window, as the pushes left them), `lairs` (`{ boss, cell, distance, beaten }` for each boss lair, the 15 of the roster, lair `k` is boss `k`, standing by tier: the nearest is the Echo's, `openworld.md` section 15), `teleporters` (`{ cell, distance }` for each teleporter discovered, the spawn's first; distance 0 is the one the hero stands on), `ending` (only once every lair is beaten) and `window`: `{ radius, rows }`, a hex of cells round the hero (never the whole map), one row per `r`, each `{ r, q0, cells }` from the cell `q0` along `q`. A cell letter is `H` hero, `T` troop, `E` enemy, `L` lair, `?` off the world, else its terrain: `~` water, `s` sand, `g` grass, `r` rock, `P` peak, `o` boulder, `t` tree, `W` wall.

- `world_step` asks the core whether the hero enters the cell (`world_enter`): peaks, walls and enemies refuse it (`blocked`, nothing changes); a boulder or a tree is broken (`smashed`) and the cell is plain ground after. The troop trails the hero (`world_trail`).
- **No `attack` tool.** As in the client, the troop attacks on its own after every step (`WorldFight.troop_push`): the best legal push against the enemies near the hero, played on the fight, the hero and the troop taking the cells it gives (a push can move the hero). `push` is `{ direction, ejected }` (the enemy ejected, none or one), `null` when no push was legal.
- A step onto a lair does not move the hero, as the client leaves the world on the entrance: `moved` is `false` and `lair` is `{ index, boss, start }`, where `start` is the call that starts that fight, `new_game` with `boss`.
- `world_walk` takes the shortest path of `world_path` (within 40 cells, the enemies and the lairs blocked) one step at a time, each a `world_step` with its push; `pushes` lists them. A step that a push made impossible ends the walk there. `no_path` when the cell is the hero's, a lair, an enemy, off the world, farther than 40 cells or walled in.

- **Teleporters (#1412).** `world_teleport` moves the hero from the teleporter it stands on to another one already discovered, as the client's choice on the map (`openworld.md` section 10), with the client's own code (`client/src/openworldteleport.ts`): the troop arrives on the free cells within 3 of it, the nearest first, and there is no push on arrival. Refused (`blocked`, the reason in `message`, nothing changes) off a teleporter, onto no teleporter, the same one, one not discovered yet, one with an enemy on it, or with no room for the troop. A teleporter is discovered with the cells round the hero, so the save needs nothing more.
- **Save and resume.** `save_world` gives the world as the client saves it (`worldSaves().put` of `client/src/openworldsave.ts`, record 8): `{ record, version, seed, hero, troop, fight: { removed, added, beaten }, yaw, broken, lairs, discovered, time, logs, recruits, resources, army, savedAt }`, cells as `[q, r]`, `removed` as `"q,r"` keys, `version` the bridge's `world_version()`, `yaw`, `time` (the time of day, #1496: the server's world has no clock) and `logs` (the lore logs the client found, #1589) kept from the save resumed (0, none otherwise). `recruits` (#1531, openworld.md section 16) is the marbles that joined the troop after a push ejected one, at most 5: the troop of a save holds 15 and them, and a push that ejects a marble brings a recruit on the free cell nearest the hero (`push.recruit`, `null` when none joined), by the client's code (`recruitCell`); `world_state` gives `recruits`. A tower beaten adds its pad to the teleporters (openworld.md section 15, `world_pads`), as in the client. The lore logs are not exposed as a tool or in `world_state`: they are optional text for a player, never on the way to the ending, so the server only carries the numbers found, as the client wrote them. `new_world` with that object as `save` resumes it (the fight through `WorldFight.restore`), its seed included, and the same moves then give the same results; a save the client wrote resumes too, and the client reads the server's. A save of another world version, or whose `discovered` does not decode, is `bad_save`, and the world in progress is kept.
- **Resources (#1655, `openworld.md` section 19).** `world_state` and `save_world` carry `resources` (`{ wood, ore, parts, shards }`). A step gathers as the client's hero does, with the client's own code (`client/src/openworldresources.ts`): a tree broken gives wood (twice in the forest), a boulder ore (twice in the badlands and the desert), each marble the troop ejects a part (twice in the rings 4 and 5), and a lair won from the world five shards, once. The lore logs and the wild fights are not played here, so a log's shard and a wild win's parts come only from a client save resumed. `army` (the client's Workshop, slice 2 of #1655) is carried as the client wrote it, empty here; `new_world` with a `save` resumes both, and a save of record 7 or before resumes with zero resources and no army.
- **Cells discovered (#1411).** As the client's map (`openworld.md` section 9), with the same code (`client/src/openworlddiscovered.ts`): the cells within 10 of the hero are discovered when a world starts or resumes and after each step or push, saved as `discovered` (a base64 bitset per chunk). A save from before (record 3 or older) resumes with the cells round the hero discovered. `world_state` gives their number as `discovered`.
- **A lair fight won.** As the client's "Back to the Open world" (#1170): a `new_game` fight of the lair's boss started after the step onto the lair and won by the agent marks that lair beaten at the next world call (`world_state`, `world_step`, `world_walk`, `save_world`). A fight won before the step, of another boss, or online does not count. A beaten lair can be entered and fought again.
- **The ending.** Once every lair is beaten, `ending` is Tally's line of the client (#1175, `endingLine` of `client/src/tally.ts`): `Variance noted. Clamp: open. Crew attached: 6.` (the server keeps no story: every lair beaten reads the clamp open, as the client does from its stage 7, #1546)
- **No loss state.** The hero cannot lose, as in the client (`openworld.md` section 4, "Loss (deferred, not built)"); the `world_state` description says so.

### Rogue-lite tools (#1469)

An agent plays a rogue-lite run (`roguelite.md` section 19) with eight tools. Every rule is the client's own (`client/src/roguelite.ts`) or the bridge's, so the same seed and the same choices give the browser's run. A run is separate from the Open world; its fight is the game of `new_game` (a new game while a fight is on leaves the run, `no_run`).

| Tool | Input | Output |
|---|---|---|
| `new_run` | `seed` default 0, `best` 0 to 3, `unlocked` (blueprint ids), `commander` 0 to 3 (default the Captain), `bot_nodes`, or `save` | the run state; drops the run in progress |
| `run_state` | `map` (also list every node) | the run state |
| `run_pick` | `node` | the run state: the node's screen, or its fight started as the session's game |
| `run_place` | `q`, `r`, `kind` (Heavy, Anchor, Spark, ...) | the run state, the fight restarted with the marble placed (or taken back); in an army fight or an act boss that takes the build (`roguelite.md` section 28) |
| `run_choose` | `choice` (an option number) | the run state |
| `run_tactic` | `tactic` (Reinforce, Freeze, Swap, Fall back), `a`, `b` (a Swap's two cells) | `{ played, reply, state }`; an act boss plays Reinforce and Fall back only |
| `run_flask` | none | the run state, a flask drunk on the map (3 marbles back, a charge spent; `roguelite.md` section 25) |
| `save_run` | none | the run in the client's save format |

Run state: `screen` (`map`, `place`, `fight`, `reward`, `relic`, `event`, `rest`, `shop`, `scroll`, `collector`, `exit`, `won`, `lost`), `line`, `seed`, `army`, `specials`, `biome`, `relics`, `affinities` (the level of Force, Tactics and Chaos once a scroll was taken), `keys`, `tactics`, `flasks`, `scrap`, `cells`, `carried`, `banked`, `told`; on the map `nodes` (`{ node, kind }`, the ones to pick); in a fight `fight` (`kind`, `foes`, `boss`, `bot_nodes`, `game`, `placed`, `left`); on a screen with a choice `options` (`{ choice, text, ok }`, plus `title` for an event); once over `acts_won` and `unlocked`. With `map`, `map` lists `"5: act 1 row 3 elite (The Wall) -> 9,10"` for every node.

- Play the fight with `get_state`, `legal_moves` and `play_move`. The run folds the fight in once the game is over (a draw or `resign` loses it); read `run_state` for the reward.
- Errors: `no_run`, `not_now` (the tool is for another screen), `bad_choice` (nothing changes, a flask with the army full included), `bad_save`, and the game errors of `run_tactic` (`illegal_move`: the engine refused it, the tactic is kept).

## 6. Errors

An error is `{ "code": "...", "message": "..." }`. `message` is the engine's reason or the `ParseError` text when there is one.

| Code | When |
|---|---|
| `no_game` | No game started (`new_game` or a room first) |
| `unknown_boss` | `boss` is not in `boss_ids()` |
| `bad_move` | The string does not parse. `message` is the `ParseError` text |
| `illegal_move` | The engine refused the move. `message` starts with the engine error (`Game::play` error, Debug format) then, for `NotOwnMarble`, `NotALine`, `OffBoard`, `Blocked`, `NotStrongEnough` and `PushBlocked`, names the cells and marbles involved, e.g. `Move(NotStrongEnough): (0,0) (1) push (1,0) (1): you need more marbles than the ones pushed` (#1676) |
| `game_over` | The game has ended |
| `not_your_turn` | Online, it is the opponent's turn |
| `no_room`, `already_in_room`, `room_full`, `room_not_found` | Room state |
| `transport_failed` | The P2P layer could not start |
| `no_world_room`, `already_in_world_room`, `world_changed`, `unknown_hero`, `bad_target` | The public world room (section 7.2) |
| `not_supported` | Online resign |
| `no_world` | No Open world started (`new_world` first) |
| `blocked` | `world_step`: the hero cannot enter the cell; `world_teleport`: the teleport is refused. `message` says why |
| `no_path` | `world_walk`: no way to the cell |
| `bad_save` | `new_world`: the save is of another world version; `new_run`: the save is not a run of the client |
| `no_run` | No run started (`new_run`), or another game replaced its fight |
| `not_now` | A run tool for another screen of the run |
| `bad_choice` | A run choice, node, marble or tactic that cannot be taken now |

## 7. Online rooms

- The server runs the same P2P stack as the browser client, in Node: Trystero with a WebRTC polyfill, behind the `Transport` interface of `client/src/transport.ts`. Signaling carries only SDP and ICE. Game data goes over the data channel (tech.md section 6).
- The agent signs every move as a `MoveRecord` `{game, seq, prev, move, pub, sig}` (`client/src/moverecord.ts`). `move` is the 8-integer record of section 3.2. The hash chain is the same as for humans.
- Seats come from `Hello` `{kind, game, seat, roster, pub, sig}`. The agent's key is created per process and kept in memory. The creator's `Hello` carries the roster.
- The session is `OnlineSession` of `client/src/session.ts`, the browser client's own, with `agent: true`. The transport is `p2pTransport` of `client/src/p2p.ts`, so the app id and the rooms are the client's: a human joins with the invite link. In Node, [werift](https://github.com/shinyoshiaki/werift-webrtc) (pure TypeScript, the polyfill the Trystero README names) is the global `RTCPeerConnection`.
- The agent checks every move it receives with `Engine.play`, and every signature. A move it refuses is not played, as in the browser client.
- Rooms have two seats. A third peer is refused as a player (bug #117).
- Rematch (tech.md section 6) is not exposed in v1. The agent starts a new room.
- No TURN in v1 (multiplayer.md section 4). A pair behind a symmetric NAT cannot connect, and `join_room` returns `room_not_found` or `transport_failed`.

### 7.1 The boss seat (#1316)

A room can be a duel on a boss: seat 1 plays Black, seat 2 plays the boss as White, a mind instead of the boss search. It is the same room and the same signed `MoveRecord`s, no new message and no new protocol version.

- The invite is `<page>#room=<room>&boss=<id>&seed=<seed>&seat=boss&key=<fingerprint>` (`inviteUrl` with `bossSeat`, `bossSeatFromHash` of `client/src/invite.ts`). A co-op invite has no `seat=boss`: there both seats play Black and the engine plays the boss (coop-boss.md). The client opens it too (#1316): Boss duel in the mode menu makes the room (a person is the hero, Black), and a page that opens the link takes the boss seat, a person or an agent, behind the online consent dialog. Its HUD names the roles ("You fight the boss", "You are the boss"), not the colours.
- Both peers hold an `Encounter(boss, seed)` as the room's judge. `Encounter.play` is called for the White move too: it checks it against the boss's legal moves (the Choir's army in turn, the Dual Room's room) and runs the same hooks, tells and phases as after a boss reply. Each peer is the judge of the other's moves; an illegal boss move is refused and is a `desync`.
- `get_state` shows the `boss` block to both seats. `legal_moves` lists `announces` and `free` only on a Black turn.
- The boss's moves are not searched by the server: the agent chooses them, `engine.boss_move()` is not used.
- Not yet: a Retry or rematch in a duel (the client hides the button).

### 7.2 The public Open world room (#1365)

An agent can be a hero in the public Open world (seed 1305, room `ow:1305:0`, multiplayer.md section 7), seen by the players as a named hero. Four tools, in `mcp/src/worldroom.ts`, apart from the local world tools of section 5.2 (which they call but do not change):

| Tool | Input | Output |
|---|---|---|
| `join_world_room` | `name`, up to 16 characters, default `Claude` | `{ room, name, hero, heroes }`; enters the world of seed 1305 with the hero on the spawn, drops the world in progress, joins the room |
| `world_heroes` | none | `{ you, heroes: [{ id, name, cell, distance }], problem? }`, the nearest first; `problem` while a join error is current (30 s), `note` when empty without an error |
| `world_visit` | `hero` (an `id`), or `q` and `r` | `{ steps, hero, target, arrived }`; walks to the hero and stops next to it, following it, or to the cell |
| `leave_world_room` | none | `{ left: true }`; closes the room |

- **The wire is the browser's.** The agent uses `p2pPeers` of `client/src/p2p.ts` and the format of `client/src/worldpeers.ts` as it is: a version 2 `Hello` with the name for each peer that joins, then its position (7 bytes, signed by nobody), at most 4 a second (`SEND_MS`) and a keepalive every 5 s (`KEEPALIVE_MS`) while it stands still. The others are kept in the client's own `Peers` table, so a message of another version, a position without a `Hello`, one that comes faster than `MIN_GAP_MS` and a peer silent for 10 s are refused or dropped as in a browser. A browser shows the agent as a hero with its name and the normal marker.
- **A walk is paced.** `world_visit` takes one cell, with the path of the core (`world_path`) and the move of the server's world (`world_walk` of the local world, section 5.2, one cell at a time), then waits 250 ms: one position message per cell, never faster than a browser. At most 40 steps a call (`arrived` false: call again). The agent follows a hero by re-reading its place each step, and stops next to it.
- **Consent.** Joining connects the agent's host to other players: their browsers, the STUN servers and the Nostr relays see its IP address and its moves (docs/privacy.md, the same as a browser). The MCP agent acts for its own user, so `join_world_room` is that user's explicit call: an agent must not call it unless its user asked for it. The server shows no dialog, the call is the consent, and the tool description says so. Nothing is joined at start.
- **Leaving.** `leave_world_room` closes the room; a host that exits leaves too, and the players drop the hero after 10 s. `new_world` while in the room is `world_changed` for `world_heroes` and `world_visit`: leave and join again.
- Errors: `no_world_room`, `already_in_world_room`, `transport_failed`, `unknown_hero`, `bad_target`, `no_path`, `blocked`, `world_changed`.
- **Run it on demand.** Nothing runs by itself and the server hosts nothing. To see a Claude in the world, from the repo root (needs `bun install` and `bun run wasm` in `mcp/`, and the `claude` CLI): `timeout 660 claude -p "$(cat mcp/walker-prompt.md)" --mcp-config mcp/walker.mcp.json --strict-mcp-config --allowedTools mcp__edgefall__join_world_room mcp__edgefall__world_heroes mcp__edgefall__world_visit mcp__edgefall__leave_world_room --max-budget-usd 2`. It joins as Claude, walks to the nearest hero, then the next nearest, for about 10 minutes (the `timeout` is the hard stop), and leaves. Running it is the user's consent.

## 8. Agent flag in `Hello`

Add one field to `Hello`:

```ts
interface Hello {
  kind: 'hello';
  game: string;
  seat: number;
  roster: string[];
  agent?: true;   // present only for an agent
  pub: string;
  sig: string;
}
```

- The field is part of what is signed (`helloPayload` in `client/src/moverecord.ts`), so nobody can add or remove it in transit.
- A `Hello` without `agent` means a human. Old clients keep working.
- The room shows an "agent" mark next to the seat. The mark does not change the rules.
- The MCP server always sets it. A human client never does.
- The flag is a label, not proof. A human can run a client that lies. That is accepted: the point is that honest agents are visible.

## 9. Follow-up tasks (parent #163)

Order: local game against the bot and bosses first, online rooms second, agent flag third.

1. [#252](https://github.com/TidyMaze/ab-alone/issues/252) Task: MCP server, local game against the bot (`new_game`, `get_state`, `legal_moves`, `play_move`, `resign`)
2. [#253](https://github.com/TidyMaze/ab-alone/issues/253) Task: MCP bosses in `new_game`, with phase and tell in `get_state`
3. [#254](https://github.com/TidyMaze/ab-alone/issues/254) Task: MCP online rooms (`create_room`, `join_room`, `wait_for_opponent_move`)
4. [#255](https://github.com/TidyMaze/ab-alone/issues/255) Task: agent flag in the signed `Hello`, shown in the room

#254 must not ship before #255, or an agent seat shows as a human.

## 10. Open items for the owners

- Online resign needs a decision (rules.md OPEN-12) and a signed message. Not decided here.
- The server code lives in the `mcp/` package (#252): bun, the official TypeScript MCP SDK, the Node build of `edgefall-wasm`. How to run it: README, "Let an AI agent play".
- Spectating is not part of v1.
