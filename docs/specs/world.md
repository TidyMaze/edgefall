---
id: world
type: architecture-design
status: draft
title: "World, lore, art and audio"
parent: goal
---

# World, lore, art and audio

Status: draft v0, for issue #19. Spec only, no code. Everything here is original work inspired by
the mood of 2000s sci-fi horror. No names, characters or plot are taken from any existing IP.

## 1. Setting

**CSV Ballast** is a 2.1 km ore hauler (CSV = Cargo Salvage Vessel), drifting over **Hollow**, a
dead moon with no atmosphere. Power is at 11%. Gravity works only on inhabited decks. The ship
is old, patched, and mostly dark.

Five decks, bottom to top, each one an encounter zone (and a board look, see section 5):

| Deck | Place | Mood | Gameplay role |
|---|---|---|---|
| 1. Mess | Crew canteen, tables with worn Abalone boards | Warm light, dead warm | Tutorial, hot-seat table |
| 2. Cargo | Ore bays, gantry cranes, frozen slag | Wide, echoing, cold | PvP tables, first boss |
| 3. Furnace | Smelters, pipes, heat vents | Orange glow, steam | Battle royale arenas |
| 4. Chapel | Improvised shrine built by the crew | Candles, wire, whispers | Mid-game boss |
| 5. Bridge | Command deck, the ship mind's core | Cold white, clean, wrong | Final boss |

The player is **the Tally-holder**: the last crew member still carrying a valid ledger token. No
name, no face, no voice line. You are alone.

## 2. Lore

Written as facts the player can piece together, not as a story told in order.

- **What happened.** Ballast mined a vein of **slag-glass** on Hollow. Slag-glass remembers heat:
  it fuses to anything warm that touches it for long. Crew who handled it started to harden from
  the skin inward. They did not die. They shelled up, rounded off, and kept moving.
- **Why marbles.** The shelled crew lost limbs and edges over weeks and ended as dense black
  spheres with a faint inner pulse. The slag-glass in the player's own cargo-suit visor is the
  only thing keeping you glass-clear instead of black: your light is the last warm thing aboard.
- **Why the game of pushing.** The crew played Abalone in the mess for years. After the first
  hardening, the captain ordered all disputes settled on a board "so nobody else gets hurt". The
  ship mind enforced it. Pushing a marble off the board is the old airlock cycle in miniature:
  whoever is ejected is gone for good. The crew says such a marble has *fallen over the edge*, and
  Tally enters each one the same way: "Another one over the edge." (#1649, the game's name, Edgefall). The mind kept the rule when the captain stopped
  answering.
- **The ship mind: TALLY.** The ledger intelligence that counted cargo, rations and crew. It does
  not hate you. It counts. It wants the books to balance: 14 and 14, six out, a winner. It
  keeps the ship running only for matches. It speaks rarely, in short accounting phrases
  ("Mess: one remaining."). It is the final boss and also the only thing that can open the
  docking clamp.
- **The Hollow Survey (canon, #1174).** The survey office that charted Hollow before the crew arrived. Its
  paperwork outlived it: Tally treats every rogue-lite run as an open **audit** of the books and every
  Trainer run as the crew's **drill**. The drill is held at **table zero** of the Mess, the table nobody
  sat at, with **crew attached: 6** (the Trainer's pool of 6 marbles, #1159). Tally's lines are short,
  optional and never gate anything. Rogue-lite run over: "Run voided. Audit reopened." (lost; from the story's stage 5 it adds "Line 0412 carries a mark from before. Entered without comment.", section 12.9) or
  "Reconciled: 14." (won, with the army left). Trainer wave start: "Drill: wave 5. Opponents: five.
  Seated." Trainer result: "Wave 7 filed. Best on record: 9." No new rule, no HP, no damage: the lines
  only name what the player already sees. Open world with every lair beaten (#1175, #1546): "Variance noted. Clamp: open. Crew attached: 6." (the clamp reads "locked" until the story's stage 7, section 12.8)
- **What the player wants.** The docking clamp release. Tally grants it only to a winner who
  has beaten the five "seats" (the senior crew, see section 3).
- **Tone.** Cosmic dread, grief, bureaucracy. Never gore for its own sake: the horror is that the
  crew is still there and still polite about the rules.

## 3. Boss lore slots

Five slots, one per deck. Names and mapping agreed with the design spec (#53, section 7, #15).

| Slot | Deck | Boss | Role | Lore hook |
|---|---|---|---|---|
| B1 Gatekeeper | 1 Mess | The Echo (#46) | Teaching boss | The last card-player of the mess, who answers every move with its mirror. Its tell shows in the move preview, so it teaches the tell habit. |
| B2 Hull | 2 Cargo | The Hull (#43) | Environment boss | The loadmaster fused to the ship's frame. The board crumbles as the hull he guards fails. |
| B3 Choir | 3 Furnace | The Choir (#44) | Multi-army boss | The shift crew that sang the end of each watch in the heat. Three sub-armies take turns, like voices. |
| B4 Converter | 4 Chapel | The Chaplain (#45) | Conversion boss | The ship's chaplain, who believed the shell was grace. Three adjacent shells flip one of your marbles. |
| B5 Mind | 5 Bridge | The Ballast Mind (#47) | Final boss | Tally itself, playing through a shell army built from the crew's last orders. Reuses Hull, Chaplain and Echo hooks. |

Naming: SPEC.md's "The Marker" was too close to a well-known horror franchise. Renamed **The
Chaplain** (decided in #19, applied in #45, #15 and #53). SPEC.md still needs the one-word
change, done in the PR that touches it.

Tells: every boss tell is a steady shape or glyph plus a sound twin, never flash, flicker or
color alone (section 8).

## 4. How lore is delivered

No cutscenes, no forced dialogue, no quest log.

- **Environment.** Props tell the story: unfinished games left on mess tables, scratch counters
  on walls, shelled marbles frozen mid-push in cargo bays. Each deck has 3 to 5 "scenes".
- **Lore terminals.** Short text logs on in-world screens (max 120 words). Optional. Two per deck
  (`client/src/lore.ts`, #510). The room's console screen shows its deck's first entry, wrapped and paged
  for the UI scale (`client/src/terminal.ts`, #511): a page turn every 8 s, drawn once the web fonts are in.
  The reader (#512): a click on the screen or the T key frames the camera on it (`client/src/camera.ts`); a
  click on the screen or the right arrow turns the page, the left arrow goes back; Esc, a click off the
  screen or a click past the last page leaves, back to the view the player had. The ids read are saved
  locally (`client/src/lorestore.ts`), for the log archive (#513): Logs, in the settings menu (ui.md section 4),
  lists the entries read, in ship order, then the audio logs collected, and a press on one reopens it in the reader. The game goes on while the
  player reads. Rolling onto a hub terminal room (#524) opens that room's own entry in the reader; leaving it puts
  the player back on the hub on the same cell. The Mess's Medal room (#812) opens the same reader on a list of
  every boss with its medal and best turns, or Not beaten.
- **Audio logs.** Short ambient recordings (max 60 s), collectable, replayable from an archive.
  Optional. One per deck (`client/src/audiologs.ts`, #515): a synthesized recording (room tone,
  footsteps, machinery, the Choir's hum) with a timed transcript. No voice acting (section 11):
  the words exist only in the transcript. The player (#516): while reading the deck console, Play log plays
  the log of the deck of the entry shown (an entry reopened from the archive may be another deck's) on the voice bus, music and ambience ducked under it (section 7, Mix); Skip log stops it
  at any time, on the console or off it, and the game goes on meanwhile. The transcript shows line by line,
  over the button (ui.md section 4), on by default; the Transcript toggle beside Sound in the settings menu hides it, saved
  locally. Collectable (#517): a recorder prop lies on the cargo crate of the room (`client/src/room.ts`); a click on it
  plays the deck's log too. Any log heard, from the recorder or Play log, is saved collected (`client/src/lorestore.ts`):
  the log archive lists the logs collected after the entries read, and a press on one replays it.
- **Lore of the story** (`client/src/lorelogs.ts`, #1589, section 12): 15 boss entries, one per boss of the roster, of 200 characters at most, and 12 logs of the
  Open world, of 320 at most (openworld.md section 12). A boss win shows that boss's entry in a sheet over the dock (`#lore`, the audio log transcript's family: it lets every
  press through, and Retry and leaving stay in the dock), a win again shows the same entry. Every entry is filed in the log archive when it is shown or read, after the
  terminals and in the order of the roster then of the logs, and the archive reopens it in the terminal reader (a log of the world and the Medal room have no audio log, so
  no Play log). Each entry has a stage, and none holds a secret word of a later one.
- **Tally.** One-line announcements at match start and end. Never explains itself. Each of the 15 bosses has its own line (#1544), and each town of the Open world a
  ledger line held back until its stage (#1516, section 13).
- **Boss arenas.** Each boss board carries one lore object the player can inspect before the
  fight.
- **Rule.** Skipping all lore must never block progress or make the game unplayable. Lore
  rewards curiosity, it never gates.

## 5. Art direction

The one-page summary of sections 5 to 8, with the asset list, its size budget and how each asset
is made in the repo, is [art.md](art.md).

**Palette.** The neon look (#1424, #1550): cyan (`#19e6ff`, the player) and violet (`#9a6bff`, sky and crystals) on near-black slate (`#04050c`, cells `#5d6a82`); sodium `#d9822b` for hazard only; red `#ff6b5a` for danger only. Every hex and the rule are in [art.md](art.md) section 1, checked by `client/src/artpalette.test.ts`. Nothing saturated outside that list.

**Materials.** Brushed and pitted steel, oil stains, welded patches, taped cables, condensation,
dust. PBR textures, no emissive surfaces except lights, screens and marbles.

**Lighting.** Low-key. Mostly one hard source per deck (practical lamp, vent glow, screen), plus
the rim's cold cyan on the player's turn (`frame.ts` `RIM_LIGHT`), no light on the marbles. Soft contact shadows ground the marbles onto the cells
and frame (#459), disabled under low quality tier and automation to save software WebGL. Flicker
is slow and rare (see photosensitivity, section 8). Shadows stay readable: cells and marbles must
stay legible in every lighting state.

**Fog.** Volumetric or screen-space haze, denser at the edges of the board, never over the cells.
Clear-board mode removes it.

**Marble looks per faction.**

| Faction | Look | Silhouette cue |
|---|---|---|
| Player | Opaque glass skin, no core inside (#885) | Smooth |
| Shelled (enemy) | Matte black organic shell, ridged like a scarab, faint heat pulse | Ridged, no core |
| Boss variants | Same shell with one accent (rust crown, candle wax, wire wrap) | Added silhouette |
| Flipped (by The Chaplain) | Player glass slowly shelling over: black ridges creep from the base up until the flip completes | Half glass, half ridged |
| Battle royale slots | Shell tint per player (six Okabe-Ito tints, #501) plus an engraved near-black glyph, repeated beside the seat's name on the HUD plate (#558), never color alone | Unique glyph each: disc, triangle, square, cross, star, diamond |

**Board look per deck.**

| Deck | Board | Fog | Props |
|---|---|---|---|
| Mess | Worn laminate, coffee rings, scratches | Light | Trays, cups, lamp overhead |
| Cargo | Steel plate with ore dust | Medium, low | Gantry shadow, chains |
| Furnace | Blackened steel, glowing cell edges | Steam | Pipes, vents, heat shimmer |
| Chapel | Wood and wire, wax drips | Candle smoke | Candles, hanging cloth |
| Bridge | Polished white-grey panel, thin cell lines | Almost none | Clean, wrong, too tidy |

**Tell marks.** Boss tells use engraved glyphs and steady ring outlines on the cell or marble
(pale bone-white, against the surface), never a halo or glow alone: a black halo is lost on
a matte black shell. The Chaplain's tell is a ring outline on the marbles about to flip plus a
glyph on the three boss marbles in contact. A tell on a cell is pale bone-white or near-black,
whichever shows better on that surface: The Hull's crack is near-black on the light deck (#355).

**Ejection.** A marble pushed off the board rolls one cell out over the rim with the line that
pushes it, in 200 ms (the sharp inhale of section 7). Then the void takes it (the thud): it falls,
tumbles, stretches along the pull and fades out in 600 ms (the vacuum silence), 800 ms in all,
never more than 1.5 s. It only ever fades, never brightens, so it cannot flash (section 8). A click
or a key ends it at once, and it never holds the next move. Reduced motion: a plain 400 ms fade one
cell out, where the push left it.

Rules never change with the look: cell size and edge clarity stay constant. Visuals are judged by the art director on captures, no contrast test (owner, 2026-11-07).

## 6. Diegetic HUD rules

1. No flat overlay for game-critical info while a match runs.
2. Turn owner: the board rim lights in the player's color: the half of the rim at that side's
   end (where its marbles start), cyan for the glass, sodium for the shell, so the turn reads by
   place too, never color alone (section 8). It switches at once, keeps in clear-board mode and
   goes out when the game is over (#300).
3. Ejected count: tally marks scratched on the board frame, one slot per marble to lose. 1v1
   and bosses: 6 slots per side. Battle royale (10 marbles, out at 0, #49) and the Choir fight
   (10 marbles): the frame shows **marbles left** instead, as a row of notches per player that
   go dark, so it scales to 6 players (a compact arc per seat on the arena rim). In the Choir
   the boss row has one notch per boss marble (12). Each side's row sits on the right side of
   the rim at its own end (near right for the side that starts near, far right for the other),
   clear of the phase notches: a dark groove per slot, a bone-white mark in it (#389).
4. Boss phase notches and tell countdown: notches scratched on the arena frame, one per boss
   marble left until the next phase, one per ejection for The Alien (#621), lit while remaining,
   extinguished as they go, and a steady glyph marks the next-phase threshold. They sit on the near side of the rim, where no marble
   hides them: a dark groove each, filled bone-white while lit (#356). The tell countdown is a
   count of engraved ticks next to the telegraphed move. Flat fallback exists but is never the
   only copy of this info.
5. Selection and legal directions: ghost marbles and arrow glyphs on the board surface.
6. Menus and settings: a terminal screen in the scene, not a floating panel.
7. Tally speaks for system notices, short text on a panel for the same notice.
8. Always provide a **flat HUD fallback** in accessibility options (section 8).
9. Anything diegetic must also be readable at 720p and at 200% UI scale.

## 7. Audio direction

- **Ambience.** Bed per deck: low hum, creaks, distant metal, wet dripping. Low-frequency heavy.
  Silence is a tool: dead air before a boss phase change.
- **Push sounds.** Weight first: dull glass-on-steel knock for a plain move, a grinding scrape
  for a sumito push, pitch dropping with push size (1, 2, 3 marbles). The pitch follows the marbles
  moved; the scrape (#1576) plays when the move pushes opposing marbles (the cells `pushedCells`
  gives, the same the slide animates), a lower body and a swelling band of noise with a longer decay,
  longer and louder for each marble pushed. A plain move keeps the dull knock.
- **Variation (#1574).** No two hits sound the same: each knock, ejection and cue is played with its
  pitch within 3 % either way, its level within 10 % and its noise started at a random offset of the
  looped noise, from a random source the page injects (tests pass a fixed one). The tones of a cue
  keep their pitch and level, so the small-speaker bounds of `cueDb` hold; only its noise varies.
  The knock pans by the board column of the marbles moved, at most 60 % to either side. The effects
  bus rings in a short shared room reverb (0.4 s impulse of decaying noise built in code, no audio
  file, at 20 % under the dry sound), built with the first effect: effects at 0 builds none.
  Calculated, not heard: the pitch, level, pan and reverb values are checked by the unit tests, not
  judged by ear; an owner listens before they are tuned.
- **Ejection.** A sharp inhale (air leaving) on the 200 ms push over the rim, a muffled thud as
  the void takes the marble, then vacuum silence while it falls, for the 600 ms of the void
  (section 5). Once it is gone, a distinct low "toll" for the player's loss (glass), a dry
  "clack" for the enemy's (shell). Synthesized in code (filtered noise and sines), no audio file.
- **Tells.** Every boss tell has its sound twin (sections 3 and 8), synthesized the same way and
  played when the tell appears or changes, never on a tell that stays the same: a low creak of the
  frame for The Hull's crack countdown, a small high bell for The Chaplain's flip tell, two hummed
  voices a fifth apart for The Choir's next army.
- **Cues (#1570).** One cue per game event, all synthesized in code through `Sfx` on the effects bus (the time of day on the ambience
  bus), no audio file: dry, mechanical and low-key, as the ship is. A win is not a fanfare: a stamp, a plain note and its fifth above;
  a loss the same stamp with a note and a minor third below it; a draw the stamp and one plain note twice, neither rising nor
  falling. A boss phase change is a gear shifting down (a falling tritone and a grind), an elimination in the royale a short drop, a
  rogue-lite reward two small ticks a major third apart, a UI click the shortest and quietest of all. A win, a loss or a draw plays
  once per game, after the toll or clack of the last ejection (about 1.1 s), in the royale as soon as the banner shows, never during
  a Replay and never for a hot seat or a spectator. The win of a boss fight is the boss death, which plays instead of the win: one sound for
  that moment, a heavy stamp, a low note that falls a fourth and a plain note above it (a boss fight lost still plays the loss). A boss
  intro plays once as a boss fight opens, 120 ms after the click that opens it and under half a second, so that it clears the tally
  line and does not ride on the crossfade of the music: a latch and two low notes. A phase change plays once, after the ejection that
  caused it, never during a Replay. The royale plays one elimination cue for the marble sets that went out in the same draw of the
  arena, however many, none in the draw that shows the end banner (its own cue), and none for a set already out when a game opens;
  once a round is resolved and its reveal is over (at once under reduced motion) a round tick sounds, a counter turning over, unless
  that draw has an elimination or the end, which take its place, and never for the round a game opens at. The reward plays once as it
  comes up, after the win; the shop plays once as it opens, a till (a bell and its octave); a relic plays once each time a run holds one
  more (taken from a boss, the shop or an event; not the relics a loaded run already has): a rising fourth. The click is one delegated
  listener on the buttons of the page, on the effects slider and the first gesture like every cue; the board, the sliders, a node of
  the rogue-lite map and Start (which have their own pick) never click.

  The frequent cues are the quietest of all, at most the level of the click, so they do not tire. The selection plays when the
  selection changes to a group of marbles (a press, a drag that reaches a new marble, Tab), never on a redraw of the plate, never when
  it is cleared (a move clears it and has its own knock) and not in a Replay. The turn start plays only when the turn has come back
  to the player after a move of the bot or of an online opponent, 250 ms later (when the marbles have arrived): never in a hot seat,
  never for the player's own move, never in a Replay, never when that move ended the game, and not for a co-op partner or the boss's
  reply. The illegal move is a dull reject, a short falling tone and a muffled thud, never a buzz: it plays once for a press that is
  not a legal move after a selection (and for a marble of the other room in the Dual Room), never when the pointer only hovers. In
  the Open world a step plays for a step of the hero, no faster than one cue per 120 ms (every step of a walk at normal speed, 140 ms,
  one in two at the cruise pace of 80 ms), none for a blocked step, a teleport or the troop's marbles, which make no step of their
  own, and none for the first cells of a walk to a far cell, which sounds only its last step (and nothing is played under the
  transition into a tower, a town or a fight, where no step is made); a step that picks something up plays the pickup instead: a
  marble that joins the troop or a lore log found for the first time. The time of day plays when the phase of the day moves (day,
  dusk, night), never at the start of a world, a slow soft swell of a note and its fifth on the ambience bus. The online join plays
  once as the opponent (or the co-op partner) comes into the room, two equal knocks and a high note, not for a spectator and not
  again as the status is drawn again. Every cue carries a tone above 150 Hz, so `cueDb` (`sound.ts`) calculates what a small speaker
  plays of the loudest tone of it at its peak (the same high-pass as below, a triangle by its first harmonic, noise not counted): at
  least -36 and at most -10 dBFS, which `sound.test.ts` asserts. Today: win -17.4, loss -17.5, draw -17.9, phase -17.0, elimination
  -15.5, reward -21.7, click -26.8, turn start -28.1, selection -29.4, illegal move -19.0, boss intro -19.3, boss death -18.0, shop
  -18.9, relic -19.0, royale round -20.9, step -30.0, pickup -20.8, time of day -20.3, online join -20.8 dBFS. This is calculated, not
  heard: an owner should listen on a laptop and a phone. `cuetable.test.ts` reads this table: a row marked played needs its cue, a
  cue its row.

  | Event | Mode | Bus | Status |
  |---|---|---|---|
  | `win` | fights, royale | effects | played |
  | `loss` | fights, royale | effects | played |
  | `phase` | boss | effects | played |
  | `elimination` | royale | effects | played |
  | `reward` | rogue-lite | effects | played |
  | `click` | every mode | effects | played |
  | `draw` | fights, royale | effects | played |
  | `turn-start` | every mode | effects | played |
  | `selection` | every mode | effects | played |
  | `illegal-move` | every mode | effects | played |
  | `boss-intro` | boss | effects | played |
  | `boss-death` | boss | effects | played |
  | `shop` | rogue-lite | effects | played |
  | `relic` | rogue-lite | effects | played |
  | `royale-round` | royale | effects | played |
  | `step` | Open world | effects | played |
  | `pickup` | Open world | effects | played |
  | `time-of-day` | Open world | ambience | played |
  | `online-join` | online | effects | played |

- **Music.** No melodic loops. Drone and texture layers, 2 to 3 tension layers driven by game
  state (marbles in danger, boss phase). Boss themes are a slow pulse that speeds up per phase.
  Today two drone layers of steady low sines under the hum (#439), through the music bus: the
  tension level is one step per player marble on the rim that one push could eject (by the weighted
  rule in The Unstable Core, #761) and per boss
  phase after the first, at most 2; level 1 brings in the first layer, level 2 both, each
  crossfading over about a second.
  Small speakers (#1572): a laptop or phone speaker plays almost nothing below about 150 Hz, so the hum
  and each tension layer keep their low sines for good speakers and add harmonics above 150 Hz
  (the hum an octave over its upper sine, unease the 3rd harmonics of its two beating sines, dread the
  3rd and 4th of its tritone). `smallSpeakerDb` (`sound.ts`) calculates what is left: a second-order
  Butterworth high-pass at 150 Hz on each sine, the master gain 0.8, buses at 100 %, tones added as
  power, in dBFS RMS. Target loudness, which `sound.test.ts` asserts: hum at least -47 and at most -30
  dBFS (ambience bus); tension level 1 at least -44, level 2 at least -40 and at least 3 dB above
  level 1, level 2 at most -30 (music bus, an undertone, not a feature). Today: hum -45.5, level 1
  -41.8, level 2 -38.1 dBFS (before: -48.0, -52.4, -46.6). This is calculated, not heard: an owner
  should listen on a laptop and a phone.
- **Scenes (#1571).** The music follows where the player is, one scene at a time, named by the loop of the page every frame
  (`sceneOf`, `scenes.ts`): the Hub; a game of the board against the bot, in hot seat, online or in the trainer (`bot`); the
  royale; the rogue-lite map (every screen of a run but its fight) and its fight; a boss fight (`boss:<id>`); the Open world
  by the biome under the hero and the hour of the day (`world:<biome>:<day|dusk|night>`, 6 biomes by 3 hours). Each scene is a
  set of layers synthesized in code, no melody and no new audio file (the three MP3s are listed in CREDITS.md): a `drone` of steady sines (an open fifth for the Hub, a
  fifth lower for the bot, a beating minor second for the royale, a major triad for the map, a minor third for the fight), a
  `pulse` for a boss, `wind` outdoors (noise through a band, on the ambience bus). In the Open world each biome has its own root
  (meadow A, forest G, tundra F, desert D, badlands C, archipelago B) and the hour moves it: a fifth above the root by day, a
  fourth at dusk, a minor third and the root an octave down at night, with the wind lower and softer as it gets dark and each
  biome blowing its own way, so night does not sound as day. The reactor room tones and the song of the audio files play
  where the table says: both in the ship, the room tone alone in a boss fight (its pulse is its music), neither outdoors, where
  the Open world no longer plays the ship's room tone. The files fade in and out with the layers, and nothing new depends on
  them (#1573 may replace them).
  The scene changes by a crossfade of about a second: the new layers start silent and rise, the old ones fall, and their
  sources stop 1.5 s later (`SCENE_RELEASE`), when under -40 dB of what they played, so there is no click. The same scene again
  does nothing. A bus at 0 builds none of its layers and a slider that rises from 0 starts them; with every slider at 0 there is
  no audio context, and no context before the first gesture, as everywhere in this section.
  **The boss pulse.** The same slow pulse for every boss: the tones of the boss breathe, silent to full, at 0.5 Hz in the first
  phase (30 beats a minute), 1.4 times faster each phase after (0.7, 0.98, 1.37 Hz), which stops at the fourth. The pitch is the
  boss's own, a semitone a boss of the list from 49.0 Hz (The Echo) to 110.0 Hz (The Swarm), with its 3rd and 4th harmonics for
  a small speaker. It follows the phase without a restart. It mixes under the rest: at its peak it is between -48 and -40 dBFS on
  a small speaker (`PULSE_FLOOR_DB`, `PULSE_CEILING_DB`), at least 4 dB under the floor of the quietest cue (-36), so a cue
  always comes through it, and under tension level 1 (about -42) and level 2: the tension layers and the pulse add, nothing ducks
  for another. The pulse of The Choir (55 Hz) falls on the root of the hum, The Chaplain's (58.3 Hz) on the unease layer: they
  beat or reinforce, which is the tension the fight asks for. An audio log ducks the music bus, pulse included.
  **Levels.** Every drone of a scene between -48 and -38 dBFS on a small speaker (`SCENE_FLOOR_DB`, `SCENE_CEILING_DB`,
  `smallSpeakerDb`), a tone above 150 Hz in each (the harmonic of the low ones at 0.6 of their level), today from -45.7 to
  -41.9; the pulses -46.0 to -42.2 at their peak; the wind, noise, cannot be added to that: its level is bounded by white noise
  at its gain, which a band only lowers, at most -40 dBFS (`WIND_CEILING_DB`), today -43.2 by day, -45.1 at night. `scenes.test.ts`
  asserts all of it. This is calculated, not heard: an owner should listen on a laptop and a phone. `scenetable.test.ts` reads
  this table: a scene needs its row, a row its scene, and the room tone and song columns are those of the code.

  | Scene | Layers | Room tone | Song | Status |
  |---|---|---|---|---|
  | `hub` | drone | yes | yes | played |
  | `bot` | drone | yes | yes | played |
  | `royale` | drone | yes | yes | played |
  | `run-map` | drone | yes | yes | played |
  | `run-fight` | drone | yes | yes | played |
  | `boss:echo` | pulse | yes | no | played |
  | `boss:hull` | pulse | yes | no | played |
  | `boss:choir` | pulse | yes | no | played |
  | `boss:chaplain` | pulse | yes | no | played |
  | `boss:ballast` | pulse | yes | no | played |
  | `boss:alien` | pulse | yes | no | played |
  | `boss:railyard` | pulse | yes | no | played |
  | `boss:magnetizer` | pulse | yes | no | played |
  | `boss:pulsar` | pulse | yes | no | played |
  | `boss:overseer` | pulse | yes | no | played |
  | `boss:assembly` | pulse | yes | no | played |
  | `boss:core` | pulse | yes | no | played |
  | `boss:dual` | pulse | yes | no | played |
  | `boss:stalker` | pulse | yes | no | played |
  | `boss:swarm` | pulse | yes | no | played |
  | `world:meadow` | drone, wind | no | no | played |
  | `world:forest` | drone, wind | no | no | played |
  | `world:tundra` | drone, wind | no | no | played |
  | `world:desert` | drone, wind | no | no | played |
  | `world:badlands` | drone, wind | no | no | played |
  | `world:archipelago` | drone, wind | no | no | played |

- **Voice.** Tally and a few crew logs only. Flat, tired, human.
- **Mix.** Four sliders: music, ambience, effects, voice (#438), each the gain of its bus into one
  master gain, 0 to 100 %, at 100 % by default and saved locally. The hum is ambience, the
  tension drones and the layers of a scene (a wind excepted, which is ambience) music, the knock, the ejection, the tells, the pick of a rogue-lite map node (#1468) and the cues (#1570) effects (the time of day of the Open world ambience), the audio logs voice (#516). The effects bus also feeds the shared room reverb (#1574) into the master.
  A Sound off saved by the old toggle sets every slider to 0. With every slider at 0 no audio
  context is made. The game is fully playable on mute: every audio cue has a visual twin (the
  ejection animation for the ejection sound, the tells on the board for their sounds, the transcript for an
  audio log).
- **Spatial (#1577).** Positional audio in the Hub and the Open world, stereo is enough on the board. A station is a place that
  sounds, a quiet loop of steady sines synthesized in code (no audio file, `STATION_TONES`, `stations.ts`): in the Hub a terminal
  (a mains hum) and a lift (low machinery), in the Open world a town, a dungeon gate and a tower, each its own pair or trio of
  tones, one of them above 150 Hz for a small speaker. Each station heard has a stereo panner and a distance gain on the
  ambience bus (a stereo panner with a gain, not a `PannerNode`: the camera looks down on a flat map, left and right is all the
  position there is to hear): the gain falls in a straight line from 1 on the station to 0 at `STATION_RANGE`, 4 cells, silent
  beyond it. **At most 3 stations sound at once** (`MAX_STATIONS`), the nearest (the id breaks a tie); the others are not built,
  and one that leaves the range or the nearest three fades over about a second and stops 1.5 s later (`SCENE_RELEASE`), one that
  comes in starts silent and rises. **The listener follows the camera:** it stands on the ground the camera looks at and faces the
  way the camera heads on the ground (`listenerOf`), checked every frame; a station straight to the right of the camera pans to
  0.8 (`STATION_PAN`) on the right, one ahead or behind to the middle, and the pan turns with a camera turn of the Open world. The
  ambience slider at 0 builds nothing (the stations are on the ambience bus, so the audio-log duck lowers them with the rest), and
  no context exists before the first gesture. The Hub's stations are those of the deck on screen, the Open world's those of the
  towns, gates and towers of the world; no other scene has one.
  Calculated, not heard: `stationDb` (`sound.ts`) calculates what a small speaker plays of a station by the same high-pass as the
  cues: at one cell from it (gain 0.75) between -50 and -38 dBFS, today terminal -45.2, machinery -46.5, town -44.4, gate -46.0,
  tower -42.2, which `soundstations.test.ts` asserts, and at nine tenths of the range (gain 0.1, 3.6 cells) at least 15 dB lower,
  -59.7 to -64.0, silent at the range. `main.stations.test.ts` reads the live stations and their gain and pan through the test
  hook `__stations`. An owner should listen on a laptop and a phone before the tones and the range are tuned.

## 8. Accessibility

- **Colorblind.** Three palettes (protan, deutan, tritan) plus a high-contrast one, chosen in the
  settings menu and saved locally (#381). Factions differ by silhouette and glyph, never by color alone.
- **Clear-board mode.** Disables fog, bloom, grain, vignette, flicker, props over the board.
  It never removes a boss tell, a preview ghost or a phase notch.
- **Boss tells survive every mode.** Each tell is a steady shape or glyph plus a sound twin, not
  a flash, flicker or color alone. Photosensitivity safe mode, colorblind palettes, the horror
  slider and clear-board mode never remove one (#42).
- **Photosensitivity safe mode.** No flashes above 3 per second, no strobing, no full-screen
  white, lower flicker amplitude. Default on until the player picks otherwise.
- **Horror intensity slider** (0 to 3), per player and local, never changes gameplay information. 0: no jump scares, no shell close-ups, calm audio.
  3: full dread. Applies to visuals, audio stingers and lore text tone.
- **Reduced motion.** Cuts camera sway and the ejection tumble and stretch: a plain fade instead
  (section 5).
- **UI scale** 100% to 200%, subtitles for all audio logs, remappable inputs.
- All options reachable from the first screen, before any horror content, and saved locally.

## 9. References (titles only, to look at)

- Games: *Dead Space* (mood, diegetic UI), *Alien: Isolation* (restraint), *SOMA* (dread of the
  mundane), *Returnal* (alien ruin look), *Hollow Knight* and *Dark Souls* (environmental lore),
  *Obra Dinn* (deduction from scenes), *Inscryption* (board game as horror).
- Film: *Alien* (1979), *Solaris* (1972), *Sunshine* (2007), *Moon* (2009), *Annihilation*.
- Visuals: Zdzislaw Beksinski, H. R. Giger, Simon Stalenhag, Tsutomu Nihei (*Blame!*), Junji Ito
  (*Uzumaki*).
- Sound: Tim Hecker, Eliane Radigue, Ben Frost, Mica Levi (*Under the Skin* score), Kevin
  Martin (The Bug).

## 10. Feature issues

| Feature | Issue |
|---|---|
| Lore terminals | #20 |
| Audio log system | #21 |
| Diegetic HUD | #22 |
| Ejection VFX and decompression audio | #24 |
| Faction marble looks | #26 |
| Deck board themes | #28 |
| Adaptive audio and music | #30 |
| Accessibility options pack | #32 |
| Boss tell glyphs and diegetic phase notches | #62 |

## 11. Open questions

Resolved by the design review on #51 (answers recorded here):

- The Marker is renamed The Chaplain, slot table locked with the design mapping (section 3).
- Voice acting: out, text and ambient audio only.
- Online players get a cosmetic glyph (6 distinct ones for battle royale), no chat.
- The horror slider is per player and local, never changes gameplay information.
- Lore tie-in: in boss fights a draw counts as a loss for you, Tally "keeps the books".

Still open:

1. Audio assets: closed. The three MP3 files are AI-generated for this project, see CREDITS.md.
2. Photosensitivity safe mode on by default: confirm.
3. Tech review (#54) asks for an audio and asset pipeline section: who owns it?

## 12. The story (#1583)

The answer to the game, written once. Every writer reads this section before writing a line of lore, and **no line, spec or
screenshot may state a fact of a stage before the player can reach it** (the ladder below). This repository is public: a player
who reads this section spoils the game, and the text is here on purpose, because the secret words are checked against it.

### 12.1 The story in ten lines

1. Slag-glass remembers heat. It holds a warm person, shell outside and person inside, awake and slowing. It is a hold, not a death.
2. Cold lets go. The only cold the crew could reach was the airlock and Hollow's night.
3. The captain learned this first. A shell will not walk to an airlock. It obeys one thing, the board's count.
4. So the last order was the game: "so nobody else gets hurt". An ejected marble leaves the glass and wakes on the moon.
5. Tally was ordered to run the game and cannot push a crewmate. It needs a clear hand.
6. The ledger's old words change meaning. "Cargo" means to be delivered. "Gone for good" means gone from the glass. Draws are
   booked as losses because a draw delivers nobody. "Crew clear: one" means one hand free to push.
7. The player is ledger line 0412 ("Claim 0412" already exists), the first one delivered. They woke clear in the dust, and the cold
   took their memory. The visor is a cooled shard of the vein.
8. Towns are the delivered, dazed and quiet. The shelled play hard because the glass fears the cold. The Chaplain preaches against delivery.
9. The turn: pushing them into the void was always a rescue.
10. The last seat on the bridge is Tally itself. It lists itself as cargo and cannot deliver itself.

Sections 1 to 3 stay true at every stage: they are what the player believes until the ladder changes it.

### 12.2 The reveal ladder

Triggers are named by story moment, not by place: one `TRIGGERS` table binds each moment to today's events (a boss id, a Hub room) and
can be re-pointed at towers and dungeons if Decision #1513 passes.

| # | Player believes | Learns | Trigger (main / optional) | Delivered |
|---|---|---|---|---|
| 1 | The shelled are infected, Tally is a warden, ejected means dead | The premise | First launch | Cold open (#1523, `firstrun.ts`: three lines, ui.md section 4.7) |
| 2 | Tally is cruel | The rule was protective | First boss beaten / 3 wins in any mode | Boss victory line, Mess terminals |
| 3 | Ejected means dead | The ejected breathe | First town or Medal room visited / one ejected crewmate met in a rogue-lite event | Tally HUD line |
| 4 | The shell is a disease | Cold lets go | The Hull beaten / night survived in the Open world, dungeon act 3 | Cargo audio log, Tally line |
| 5 | I am the last clear survivor | I was delivered first, line 0412 | The Chaplain beaten / a lost run (optional extra line) | Lost-run summary, Chaplain line |
| 6 | Tally wants me beaten | Tally cannot push, it needs me | The Ballast Mind fight starts | Boss line |
| 7 | Winning opens the clamp | The last seat is Tally | Ballast Mind beaten / five towers (#1546) | Ending line, epilogue (12.8) |

**Secret words.** Withheld until stage 4: the cold and the word "delivered" (`deliver`, `cold`). Until stage 5: line 0412 (`0412`). Until
stage 6: Tally's limit (`cannot push`). Until stage 7: Tally as cargo. A line of stage *n* holds no secret word of a stage after *n*.
The main line uses only the main-column triggers, so skipping optional content never blocks the ending.

### 12.3 Delivery

- Short lines only: a Tally HUD line at match start, a boss victory or defeat line, a note under a terminal (the existing "Appended by
  TALLY" device), a lost-run summary line. Nothing blocks a move.
- Saved in one local key, `ab-alone.story`, no server (#1584, section 12.6).
- A player who only plays the bot table gets stages 2 to 4 from wins there, then one hint pointing at the world. Online games count wins
  too, and lines stay local, never sent to the opponent. After stage 7, old lines gain a reread twist, and Reset story is in the
  settings menu.
- **Lore entries** (`client/src/lorelogs.ts`, #1589): every entry carries its `stage` as data, a boss entry holds only what its stage
  reveals and stands alone (a player beats the bosses in any order, so it never reads as if an earlier stage had happened), and a world
  log of stage 1 to 3 may carry the hint of a reread: it holds no secret word of a later stage and reads differently once the player knows.
  The first five bosses follow the ladder (The Echo 2, The Hull 4, The Chaplain 5, The Ballast Mind 7, The Choir 3); the other ten stay at stage 3 or below.

### 12.4 The tested rule

`story.ts` holds the data and pure functions (section 12.6). The unit tests (`story.test.ts`, `main.story.test.ts`) check that stages are strictly ordered; every stage has a trigger emitted by a real call site; a
main-line-only run reaches stage 7; no line of stage *n* holds a secret word of a later stage; a corrupt save falls back to stage 1; every
line fits the HUD; every `lore.ts` and `audiologs.ts` entry carries a stage tag. The entries of `lorelogs.ts` are already under the
secret-word rule (`lorelogs.test.ts`).

### 12.5 Towns and towers

This amends #1516: **towns hold the delivered** (dazed, quiet, clear of the shell), and **the shelled stay in towers and dungeons**. Section 13 maps every mode to its place in the story, and gives each town its ledger line.

### 12.6 The stage store (#1584)

`client/src/story.ts` holds the data and the pure functions. The `TRIGGERS` table binds each moment of the ladder to the events of today,
so it can be re-pointed at towers later; `main.ts` fires the events through one `storyEvent` helper.

| Stage | Main trigger (the event) | Fired from |
|---|---|---|
| 2 | the first boss beaten (`won`, any boss) | the win of a boss fight, once per game |
| 3 | the Medal room first visited (`room`, `medal-room`) or a town of the Open world entered (`town`, #1586), or a second boss beaten (`won`, 2 different bosses) | the reader opening the Medal room, the Open world rolling onto a town, a boss win |
| 4 | The Hull beaten (`won`, `hull`) | the win of a boss fight |
| 5 | The Chaplain beaten (`won`, `chaplain`) | the win of a boss fight |
| 6 | The Ballast Mind's fight starts (`start`, `ballast`) | the start of a boss fight |
| 7 | The Ballast Mind beaten (`won`, `ballast`) | the win of a boss fight |

- **More than one main trigger.** A stage may have several main moments, any of which begins it: `main` of a `TRIGGERS` entry is a list (stage 3 holds the Medal room and a town). The main line needs one of them, so skipping a room or a town never blocks the ending.
- **Optional trigger.** Stage 2 also comes from 3 wins in any mode (`win`, counted once per finished game against a boss, a bot or an online
  opponent; a hot-seat game and a spectator count none; a replay counts none). An optional trigger counts for its own stage only. The
  other optional triggers of the ladder (an ejected crewmate of the rogue-lite, a night survived, a dungeon act 3, a lost run, five towers) are
  not bound: the game has no event for them yet.
- **The stage** is the longest unbroken run of fired moments from stage 2 up. Every moment is recorded when it happens, even out of order:
  a Chaplain win before The Hull counts as soon as stages 2 to 4 are reached. The main line alone reaches stage 7.
- **The save** is the JSON `{"moments": [...], "wins": n}` in `ab-alone.story`, through the same store as the log archive. A corrupt save is a
  new player's, stage 1. A player who played before the story keeps what he earned: at load the medals fire the matching boss moments (a boss
  with a medal was started and won). Two medals reach stage 3 the same way, so nobody is stuck for not opening the Medal room.
- **The gate.** A boss is never locked here (#1527 decides locking). Its lore entry above the current stage is held back: the win screen shows
  the sealed line in place of the entry, the same for every such boss, in Tally's register and with no secret word ("Ledger: sealed",
  "Seat: empty. The entry is held. Tally enters it when the count allows."); `body[data-lore]` reads `sealed`. The stage is computed after
  the win is recorded, so beating The Hull at stage 3 shows its entry. The entry is filed as read either way. The log archive lists only the
  entries whose stage is reached, terminals and logs of the world too (a log is gated when read from the archive, never when found), so a held
  entry appears when its stage is reached.
- **Tally's line.** After the first boss win, stage 2, the bot table's line at the start of a match reads "Mess: one seat filled. The other is
  counted. It was never an enemy." No other line changes.
- **Old text.** `lore.ts` and `audiologs.ts` entries carry a `stage` (all 1). Four lines broke the rule of 12.4 and were reworded, with the
  same meaning: the chapel sermon ("a coat against the night"), the night loader's log ("A wide, dim bay.", "That is the night air."), the
  bridge log ("A clean, steady hum.") and the first-visit line of the Open world ("Claim: unworked." before stage 5, openworld.md section 7).

### 12.7 The Overseer's voice (#1545)

The Overseer is the Chapel's **watch system**: a ship system that kept the shrine's count and never stopped. It is not a person, a
joker or a host. It speaks in Tally's register, terse, procedural and unsettling: short statements of what it logs ("Core burnt. The
record is one short."), never a question, a boast, a pun or a remark on the player's failure, and never "I" or "you". It keeps a watch,
so what it says is the watch: begun, continuing, closing, ended ("Watch ended. No one remains to log it."). Its hazard is the **slag
fill**, the slag of the vein rising in the sealed chamber turn by turn: the vents burn, the fill ends the fight at turn 40. The player
sees "Slag fill 25 %" on the HUD. Nothing here is taken from any existing game, and the old framing of a lab, a test, a subject and a
prize is gone from the fight, its specs and its lore entry. Its lines hold no secret word of section 12.2, so they may be met at any
stage; `overseer.test.ts` guards the banned framing and the secret words. Its mechanic and balance are unchanged.

### 12.8 The finale (#1546, #1588)

The story ends where the README promises: **you walk out**. It adds no mode and no scene, three small things.

- **A victory line and a defeat line per boss** (`client/src/bossends.ts`, `BOSS_ENDS`): each of the 15 bosses has its own, in Tally's
  register (section 12.7), in place of the one banner "The seat is empty." / "The seat holds." (the draw line of a boss fight is unchanged).
  A line is data with a `stage`; every line of the 14 other bosses is stage 1 for good, since a boss menu starts any fight at any time, and
  holds no secret word. `bossEndLine(boss, kind, stage)` picks the line of the highest stage reached. A test fails on a duplicate line. The
  line is chosen after the win is recorded, so a win that reaches a stage speaks at it.
- **The Ballast Mind says the story's answer at two stages.** Stage 6, as its fight starts (the `start` moment is the stage): "I cannot push.
  Rule four. You can. Count carefully." (`tally.ts`). Stage 7, at its win: "Delivered: fourteen. Crew clear: all. Seat five: Tally. Books
  balanced. Clamp: yours." Below those stages the fight keeps its old lines ("The ledger plays itself. Twelve out to balance." and "The
  seat is empty."), so a player who beats it too early sees the sealed entry and no secret (`tally.test.ts`, `bossends.test.ts`).
- **The epilogue** (`client/src/epilogue.ts`) plays when the story is at stage 7 after a boss win, which is the Ballast Mind's win with the
  stages before it reached, or the win of any boss that completes the run to stage 7. Two pages in the dialog of the cold open, over the end
  banner: Tally's closing log, then the clamp and the world, ending on "You walk out." Skip (any page) and Escape close it; Next then
  Walk out close it too. It plays once (`ab-alone.epilogue` in the local store, set as it opens), and is filed in the log archive as one entry
  (`story-epilogue`, stage 7), so it is read again there. `body[data-epilogue]` reads the page for the e2e tests.
- **The world reads differently**: the Hub's bridge console (`bridge-clamp` of `lore.ts`, read by the terminal and in the archive) reads
  "Docking clamp: open." from stage 7 (`CLAMP_OPEN`, `entryOf(id, stage)`), and the Open world's Tally line agrees: the ending line says
  "Clamp: locked" until stage 7 and "Clamp: open" from it, and the ledger line "Seats on file: N of 15." ends on "Clamp: open." in
  place of the lore sentence from stage 7. The MCP server keeps no story and its ending line (every lair beaten) stays "Clamp: open".

Not now: the optional trigger of the ladder, "five towers" (it is the same moment as stage 7 here, `TRIGGERS` unchanged).

### 12.9 The Ledger and the lines of stages 3 to 5 (#1585, #1586, #1587)

**The lines.** Each declares its stage and holds no secret word of a later one (`ledger.test.ts` checks every source of the Ledger at each of the 7 stages).
All are in Tally's register (section 12.7). The stage 3 sample of the issue held "delivered", which section 12.2 withholds until stage 4, so it reads
"breathing" in its place (a word of stage 3: the ejected breathe).

| Stage | Line | Delivered through |
|---|---|---|
| 3 | "Seat 3: not on board. Not on the books as lost. Entered: breathing." | The Medal room: a line of Tally before the list, on its first page, from stage 3. The visit that reaches stage 3 shows it. A town of the Open world also begins stage 3 (below), and shows its own ledger line (section 13) |
| 4 | "Outside: minus one hundred and sixty. The glass lets go of what it held. Entered as weather." | The end of the Cargo audio log, one line of Tally at 50 s (`stage` of a transcript line, `lineAt`) |
| 5 | "Run voided. Audit reopened. Line 0412 carries a mark from before. Entered without comment." | A lost run (rogue-lite), replacing "Run voided. Audit reopened." from stage 5; a won run keeps "Reconciled: N." |
| 5 | "Read count: two. Line 0412 read this first, and walked on." | An appended note of Tally under every terminal of the Hub (the bridge console too), from stage 5 |

- **First town visited.** `TRIGGERS` binds stage 3 to the Medal room or the `town` event, fired when the hero rolls onto a town of the Open world (#1593). The
  story moment is recorded before the town's ledger line is chosen, so the visit that reaches stage 3 speaks at stage 3.
- **The Shelled crewmate** (rogue-lite event, roguelite.md): from stage 4 the choice "Crack its shell" reads "Cool it until the shell lets go", the same trade
  (+30 scrap), worded as stage 4 teaches (cold lets go). Below stage 4 it is unchanged.
- **The Ledger** is a button beside Logs in the settings menu (id `setting-ledger`). A press shows, on the same plate as the log archive, the story lines
  the player has seen, one paragraph each, **in stage order**, "Nothing filed yet." before any. It lists the lines of `LEDGER` (`ledger.ts`): the bot
  table's line of stage 2, the five town lines, the four lines above, the Ballast Mind's lines of stages 6 and 7. **Nothing above the player's stage is
  ever listed**, even if its id is saved.
- **The save** is `ab-alone.ledger` in the local store, the ids of the lines seen (`bot`, `medal`, `cargo`, `voided`, `terminal`, `town-<n>`, `ballast-6`,
  `ballast-7`) joined by commas, never the text (`lorestore.ts`). A profile from before has no key and an empty Ledger; an id this version does not know is ignored.
  A line is filed as it reaches the player: the match start, the end banner, a town's plate, a page of the console, a transcript line, the run panel.

## 13. The Ballast on Hollow: every mode a place in the story (#1516, #1544)

The Open world is the map of the whole game (openworld.md section 13). This section says what each place **is** in the story, so a bright
meadow, a tower and a Hub table are one wreck and not three games. It adds no mechanic and no balance. Section 12 stays the source of
what may be said when.

**A tower is a section of the ship (#1698).** Rolling onto a tower shows that section from inside: the Hub Cutaway opens on the boss's deck and bay, its room amber with the confirm up (ui.md section 4.10). A gate opens the Mining cut and a town the Mess. Behind `?hub=cutaway` until #1696.

**The crash.** The Ballast came down in **five pieces**, one per deck of section 1. Each deck stands upright in the regolith as a
**section**. The old lift of a deck is the shaft of its tower. Hollow has no atmosphere; what looks like weather and ground is made of
the vein (below).

| Mode | Place | In the story |
|---|---|---|
| The 15 bosses | **Towers** | A tower is a **station** of one section. Each boss is the seat Tally still enforces there: it keeps the count at that station, so the seat is "empty" and the game goes on. |
| Rogue-lite run | **Dungeon gates** | The **mining cuts**, where the crew followed the slag-glass vein into the moon. Tally audits each cut as a run (section 2, the Hollow Survey). An act is one cut. |
| Hub, bot and hot-seat tables, Medal room, terminals, Daily, Trainer | **Towns** | **Muster points** round a table zero, each with a ledger station where Tally files who is present. Towns hold the **delivered**; the shelled stay in towers and dungeons (section 12.5). |
| Open world | **The moon** | The ground of all of it. **Biomes** (meadow, forest, tundra, desert, badlands, archipelago): slag-glass remembers heat, so the crew's memories were **fixed into the moon** as remembered places. That is why a dead world with no atmosphere shows grass, pines, snow and a sea. |
| Ballast Mind beaten, the story at its stage 7 | **The clamp** | The ending of section 12.2 (#1546, section 12.8): the docking clamp opens, a short epilogue plays once. |

**The ship in sections.** The five senior seats are the ladder of section 3. The ten later bosses are the other stations of the same
sections, so the 15 read as one ship (`deckOf` of `deck.ts` is the table; each boss entry of `lorelogs.ts` is titled by its section, and
`lorelogs.test.ts` checks it):

| Section (piece) | Senior seat | Other stations |
|---|---|---|
| Mess | The Echo | The Dual Room |
| Cargo | The Hull | The Alien, The Rail Yard, The Assembly Line, The Swarm |
| Furnace | The Choir | The Magnetizer, The Unstable Core |
| Chapel | The Chaplain | The Overseer, The Stalker |
| Bridge | The Ballast Mind | The Pulsar |

**Each tower, in its lines.** A tower is told by four short pieces of data, all in Tally's register (flat, procedural; section 12.7), none
copied from any existing game:

- **Tally's line** at the start of its fight (`tally.ts`, `BOSS_LINES`). Every boss has its own; the ten later bosses share no sentence with
  another boss. It is met from the boss menu at any time, so it is stage 1 for good and holds no secret word (`tally.test.ts`).
- **A blurb**, one line of at most 80 characters saying what the station was (`lorelogs.ts`, `BOSS_BLURBS`, shown as the title of the boss's
  button in the boss lists). It declares its `stage` (1) and holds no secret word.
- **The entry of its win** (`BOSS_LORE`, section 12.3), gated by its stage, sealed before it.
- **Its section's two terminals** (`LORE`, section 4): a deck has two, shared by every tower on it. A tower has no terminals of its own: a
  third entry per tower would need a new Hub room (a UI change), and the win entry already stands for it.

**Goal cards.** The goal of the ten later bosses (`goal` of `BOSSES` in `crates/edgefall-wasm/src/encounter.rs`) opens in the boss's register
("The watch counts every core.", "From the fog the stalker sees your whole army.") and then states the rule exactly as before, ending on the win and loss
sentence. Clarity first: a rule never gives way to flavour. The Echo's card is rebuilt separately (#1524) and is not touched here.

**Towns.** The five towns are indexed as the bridge lists them (`world_places`, openworld.md section 13): 0 the spawn town round table zero,
then the towns of the forest, the tundra, the desert and the badlands. Each has one ledger line of Tally (`tally.ts`, `TOWN_LINES`, `townLine`),
with the stage that may speak of it. Nothing shows before that stage. Entering a town puts its line on the plate of the Hub, until the first
move. "Delivered", the cold and line 0412 are secret words (section 12.2): they appear in a line only from the stage that allows them, and in
no blurb, Tally line or goal.

| Town | Biome | Stage | Ledger line |
|---|---|---|---|
| 0 | the spawn clearing | 2 | Muster: table zero, laid. Seats: six. Counted, every one. Nobody here is hurt. |
| 1 | forest | 3 | Muster: the pines. Residents entered as Out. They breathe, eat and wait. |
| 2 | tundra | 4 | Muster: the white field. Cold lets go. Residents entered as delivered, in good order. |
| 3 | desert | 4 | Muster: the dunes. Residents arrive clear and dazed, no name on file. Entered: delivered. |
| 4 | badlands | 5 | Muster: the ridge. Line 0412 was first. The rest came after, one hand free each. |

**Not now.** A tower's own Hub room and terminals, and a town's own stations (openworld.md section 13). "First town visited" is bound to stage 3
(section 12.6, #1586).
