---
id: ui
type: architecture-design
status: draft
title: "UI design direction"
parent: world
---

# UI design direction

Status: v0, for issue #88. Covers the page chrome and the flat HUD only. Board and marble
materials are #89 (done), the move preview ghost is #82, the diegetic HUD is #22. This file
refines what [world.md](world.md) sections 5, 6 and 8 already decide, it adds no new lore.
The one-page art direction and the asset list are in [art.md](art.md).

## 1. Mood

Cold, low-key, industrial. A dim ship deck lit by one practical lamp, a cyan glow where the
player is. The page must feel like a viewport onto that deck, not like a web app around a canvas.
Clarity of play wins over mood every time: no effect may touch a cell, a marble or a legal target.

Reference notes (all from world.md):

1. **Palette (section 5).** Near-black base, rust, oxidized steel, sodium orange for hazard, one
   cold cyan for the player's light. Red only for danger, never for a normal state.
2. **Diegetic HUD rules (section 6).** The rim and the frame carry the info, a flat HUD is the
   fallback. Our flat HUD is that fallback, styled as a plate bolted on the frame, and it must
   stay readable at 720p and 200 % UI scale (rule 9).
3. **Accessibility (section 8).** Never colour alone, reduced motion cuts camera sway and
   animation, clear-board mode removes fog and vignette but never the turn or score info.

## 2. Palette as CSS tokens

Tokens live in `client/src/ui.css` on `:root`. Dark is the default (the deck). Light is picked by
`prefers-color-scheme: light` and can be forced with `data-theme="light"` or `data-theme="dark"`
on `<html>`. Both themes define exactly the same token names. The Theme item of the cog menu (#317) sets it: Dark (the default, #1184: with nothing stored the game opens dark whatever the system theme) and Light set the attribute, System removes it and follows the system. A press cycles Dark, Light, System. The choice, System included, is stored under `ab-alone.theme`, and `index.html` applies it before the first paint (no light flash).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0b0d0f` | `#e6e2d6` | page background |
| `--panel` | `#161a1d` | `#f3f0e6` | HUD plate |
| `--edge` | `#4a5258` | `#8a8f8c` | plate border, rivets |
| `--text` | `#d8d4c8` | `#14181b` | main text |
| `--muted` | `#9aa3a8` | `#454d52` | secondary text |
| `--accent` | `#7fd6e8` | `#0a5f73` | player light, turn marker |
| `--hazard` | `#d9822b` | `#8f4a0c` | warnings, last-marble notice |
| `--danger` | `#ff6b5a` | `#a3241a` | breach, ejection warning only |

Dark `--bg` is the world.md base, `--edge`, `--hazard` and `--accent` are the world.md steel,
sodium and cyan. Light is a daylight fallback for people who force it, not a second mood.

## 3. Type

Both faces come from Google Fonts, loaded with `display=swap`, with system fallbacks so a blocked
request keeps a readable page (no layout jump beyond font metrics). The offline app caches them
after one online visit (tech.md section 9.1).

- **Display: Chakra Petch** 600. Turn line and winner line only. Squared, stencil-like, reads
  as ship signage. Uppercase with 0.06em tracking.
- **UI: IBM Plex Sans** 400 and 500. Score line, backend note, everything else. Tabular figures
  for the `0/6` counts.
- Sizes use `rem`, so browser and UI scale settings (up to 200 %) scale the HUD. Turn line
  1.5rem, score line 1rem, notes 0.8125rem. Nothing below 0.8125rem.

## 4. HUD layout

Each fact has one place on the screen at a time (#1038). A result, a count, a name or a turn is
written once: the plate title carries the turn or the result, the pips carry the ejected count, the
boss bar carries the boss name, the score bar carries the evaluation of the position on show (never the
result of a finished game). On a phone held upright the score text leaves the screen but stays in the
accessibility tree, so a screen reader still hears the one name of the count. Desktop keeps the score
text beside the pips; the pips take the colour of each side's marble.

One plate, top-left, 16 px from the edges, max width 22rem, never over the board centre at 720p.
The plate, like the evaluation plate below, is bolted on: a rivet in each corner, 4 px inside the
border, in `--edge`, drawn in CSS over the plate colour, so it adds no size (#303).
In a short landscape window (500 px tall or less, a phone held sideways) the plate keeps to the band
left of the board, like the column, with a smaller turn line, so it covers no cell (#234).
In a taller landscape window up to 1100 px wide the plate is smaller (max width 15rem) for the
same reason (#246).
The buttons (the settings cog, Reset view, New game, Game modes and the rest) share one column
top-right, beside the plate and never over it (#227). Wider than tall, the column keeps to the band
right of the board. Held upright, the column becomes rows of buttons under the plate. No button or
field covers a cell, and the space between them lets every tap through to the board.

Fold (#957): a 44 px button labelled "HUD panel" (`aria-expanded`, `aria-controls="hud"`, titled "Fold the panel" or
"Unfold the panel") beside the plate's top right corner, held upright in that corner beside the turn line, folds the plate
to a tab with the button alone and unfolds it again; the choice is saved (`ab-alone.hud-folded`). Folded, the plate
leaves the screen but not the page, so a screen reader still hears the turn and the score.

HUD buttons, in groups (#839). The column holds the buttons grouped by what they do, in this order, each group a row
that wraps, so its buttons share a row when they fit and a group with no visible button takes no room: (1) the
settings cog; (2) the view, Reset view (Free Cam is the Free camera item of the settings menu, #938); (3) the game, New game, Rematch, Goal, Retry,
Hold, Start and Invite, led by the exit (Hub or World, section 4.10) (the controls of the running mode, only the ones the mode shows); the daily
result card when a daily fight ends; (4) the tools, Hint, Replay and Auto-play; (5) Game modes, last of the column, its
menu under it; (6) the invite link of an open room: its caption, then the link with its Copy button. Held upright the
groups give their buttons to the rows of the column, in the same order. Every button of a group has the one button
style (the panel colour, the edge, the 14 px text, the 2 px radius) (Hint is lit while it is on).
Only New game, Game modes and Copy diagnostics show an icon alone (#297); every other button shows its name, Play online
included. While the invite link shows, the button column is back at its top, so no button above the link is
scrolled out of a short window (#839).

Invite link (#839): the caption, then the link and a Copy button on one row. Copy writes the link to the clipboard,
then the caption, the link and Copy close for good (a new room shows them again). When the browser refuses the
clipboard, or the page has none, the link stays, selected, and the plate says "invite link selected: copy it by hand".

Settings (#277): a cog button, first in the column, opens a menu, one button per item (since #1566 in five headed groups, section 4.11, which fixes
where each item sits; the text below says what each does): the toggles Clear board,
then Reduced motion (#379, see section 6: it follows `prefers-reduced-motion` until pressed, then keeps the player's
choice), then Flat HUD (#391, off by default: the flat HUD fallback of world.md section 6 rule 8, see the Flat HUD
item below), then Sound (#284, no longer a button of the column; a press shows the four volume sliders of #438, Music, Ambience,
Effects and Voice, each its name over a range of 0 to 100 %, in place of the items, so the menu never grows taller and
covers no cell; the menu opens on its items again once closed; opening the menu and moving a slider count as the first
gesture that starts audio; the Transcript toggle of the audio logs, #516, shares its item, on by default and saved
locally), then Theme (#317, Dark, Light or System: a press cycles them, see section 2), then Export game and Import game (#287, no longer buttons of the column),
then Logs, the log archive of world.md section 4 (#513): a short word beside Import game, as FPS is beside Clear board,
titled "Log archive"; a press shows the lore entries read, then the audio logs heard (#517), one button per title
in ship order, in place of the items ("Nothing read yet." before any), and a press on one closes the menu and opens that
entry in the terminal reader, or replays that log. Ledger (#1585) is a second short word in the same item: a press shows the story lines seen, in stage order and none above the player's stage, on the same plate (world.md section 12.9). The last rows of the menu are three light sliders
(#861), Bloom, Lamps and Lights, each a range of 0 to 300 % of the tuned power (defaults 20, 25 and 215), saved on its
own under `ab-alone.light.<name>`, then a Reset lights button (#899, #900) that puts the three back to their defaults
and saves them, so a phone that kept low levels is not left dark (`client/src/main.ts`, `client/src/quality.ts`). Each
item shows an icon of the repo's icon set (`client/src/icons.ts`: inline SVG line icons, thin `currentColor`
strokes, one size) then its label: a fog for Clear board, a ball with speed lines for Reduced motion, lines in a box for Flat HUD, a speaker for Sound, an arrow out
of a tray for Export game, an arrow into it for Import game. The open menu floats over the other buttons, so opening
or closing it moves no button: it hangs under the cog, at its right edge (section 4.11). Every item shows its icon then its label, one item per row, at
every window size (the icon-only items of #414 and the rows of 3 are gone, #1566). Each item keeps its
name as its `aria-label` and as a tooltip (`title`), so a screen reader reads it and a pointer shows it. Each item is at least 44 px tall. It closes on Escape, on a press
outside and on the cog again. The cog is labelled "Settings" (`aria-expanded`, `aria-controls`), each toggle is a
button with `aria-pressed`, each item has the visible focus ring of the buttons.

Game modes (#357): the buttons that start a game mode, Play online (its name shown, #839), Boss with a partner (the id `fight-together`, with the boss list it opens under
it, #530), Battle royale (#502), Solo boss fight (the id `boss-fight`, with the boss list it opens under it), Daily challenge and Hub (the hub,
game-design.md section 3.5, #521), live in one menu behind an icon-only button, a play triangle of the icon set,
labelled "Game modes" (`aria-label`, `title`, `aria-expanded`, `aria-controls`). The menu is closed at the start on every screen size; the buttons keep their behaviour and their
names. The button is the last of the column and the open menu lies under it, so opening or closing it moves no other
button. Held upright, the menu starts a new row under the buttons, its items side by side; an open boss list is one row
of its own under Boss fight or Fight together that scrolls sideways, so a new boss adds no row over the board (room for
12 bosses and more on a phone 360 px wide, #666). In a desktop window (wider than tall, over 1100 px wide, a mouse) the items of the mode menu sit side by side when they fit, and an open boss list takes a row of its own as wide as the column with two bosses a row, each row compact, so 12 bosses and more with Daily challenge fit a 1280x720 or 1280x800 window without a scroll (#653, #699). One boss list is open at a time: opening one closes the other (#615). It closes like the settings menu, on Escape, on a press outside and on its button again,
and once a mode starts (a boss picked, Daily challenge, Play online, Hub, Battle royale). On a phone each item is at
least 44 px tall. The controls of a running mode (Rematch, Goal, Retry, the exit, Hold, the invite link)
stay in the column, outside the menu. Opening the root URL without query parameters or a saved game in progress lands directly on the Hub (Mess deck, #602) for a player who has won a game; a new player lands on the standard board against the bot, and the other modes are locked until the first win (section 4.10, #1665). Saved games and query URLs (`?bot=`, `?nodes=`) open their board mode directly.

The boss list follows the Hub's lifts (#1527): a boss above the player's progress is locked, dimmed with `Beat The Hull first` under its
name (`aria-disabled`, `data-locked`), and a press starts nothing. The rule is `bossOpen` of `hub.ts`, the lift of the boss's deck; a boss
already beaten stays open, so an older save loses nothing, and the list reads the progress each time it opens. A link, a test hook, the Hub's
doors, the Open world's lairs and the MCP do not go through the list and stay open. The lock is a player's: an automated page
(`navigator.webdriver`, every e2e spec) has the list open unless the URL holds `?locks`, as `?firstrun` gives it a first launch. The first-win lock of section 4.10 comes before it: while it holds, the whole Solo boss fight entry waits.

```
+---------------------------------+
| (o) BLACK TO MOVE               |   display face, marker + text
| * You are Black. White is here. |   online only: status line, UI face
| Black ejected 0/6 . White 0/6   |   UI face, the score line, text kept verbatim
| ||||||  ||||||                  |   tally pips (desktop), decorative, aria-hidden
+---------------------------------+
```

- **Turn.** A marker plus the words "Black to move" or "White to move". The marker is a filled
  disc for Black and a ring for White, so the side never depends on colour (world.md section 8).
- **Score.** The score text stays the source of truth and the readable copy: each side's ejected
  count against the win target. Game-over winner names and draw reasons are not duplicated in the
  score line since the turn line and end banner already announce them (#425). On desktop, six pips
  per side are scratched out as marbles are ejected; on compact and mobile screens (under 1100 px wide
  or 500 px tall), decorative pips are hidden to slim down the HUD plate. Held upright on a phone the
  pips are the count and the score text is out of sight (#1038). The pips of each side take its marble
  colour: dark for Black, pale for White. In an army fight of a rogue-lite run the score line is the army, the army the run ends below and
  the marbles lost in red, then the bot's ejections, and it stays on screen held upright (roguelite.md section 31, #1540). The legend of the
  special marbles on the board and the card of the one hovered or tapped sit under the notes and take no more height than the lines (#1541).
  The render backend note
  (WebGL2 / WebGPU) is dropped from the player HUD and kept in `environment.backend` of diagnostics.
- **Tally line (#294, #425).** Matches start with Tally's accounting line per mode/boss, which fades
  out via CSS animation after 5 seconds or clears on the first move.
- **End banner (#282).** When the game is over the turn line is replaced by the result in the
  display face, with the accent border, and under it comes the reason, one short line, all inside the
  plate, so nothing covers a cell (the plate may not grow over the board: the phone-layout e2e checks
  it in a boss fight too, where the banner replaces the boss block's own Victory or Defeat line). The
  result is read from the viewer's side: "You win" / "You lose" against the bot and online, "Black
  wins" / "White wins" in hot-seat and for a spectator, "Draw", and "Victory" / "Defeat" in a boss or
  daily fight, a co-op one included (#530), where a draw is a "Defeat" (rules.md section 10.3). The reason line is in
  TALLY's tone, built by `client/src/endbanner.ts`: "The books balance.", "Tally strikes your name.",
  "The seat is empty.", "The seat holds." (the ejected count is on the plate, #1038; in a boss fight each boss has its own victory and
  defeat line instead, #1546, `bossends.ts`, world.md section 12.8), "Same position three
  times. Tally closes the page.", "100 plies, nothing ejected. Tally calls it even.", and against a boss
  "Repeated 3 times: a defeat." or "100 plies idle: a defeat.". The one action offered is the button
  already in the column: New game (local, bot), Retry (boss, daily), Rematch (online players), and Back to the
  ship when a hub room started the game (game-design.md section 3.5, #522).
  A won boss fight (daily and co-op included) adds the medal to the reason line (#791): "Medal earned: 12 turns."
  the first time, "New record: 9 turns." when the fight took fewer player turns than the medal held, and
  "Medal best: 9 turns." when it did not. In the boss list, a beaten boss carries "Medal: 9 turns" after its name.
  A medal is the fewest player turns a win needed, per boss id, in local storage (`client/src/medals.ts`, key
  `ab-alone.medals`); `hasMedal(store, boss)` is what the auto-play task asks (#792). Every peer of a co-op win gets it.
  `body[data-over]` is `win`, `loss` or `draw` while the game is over (a draw against a boss is `loss`):
  the board dims (filter on the canvas) and one light plays on the rim only, the middle stays clear of
  cells, marbles and targets. Win: a warm sodium rim light rises and pulses once (1.6 s) and stays as a
  glow. Loss: a cold blue-black fade closes in while the board dims (1.4 s). Draw: a still hold of 0.6 s,
  then a neutral steel rim fades in (1.2 s). CSS only, each ends by itself, nothing runs when idle.
  Under Reduced motion (section 6) there is no light and no animation: the banner and the dimmed board
  only. No move is accepted and no marble can be selected once over. The score line still carries the
  reason in the HUD's own words ("by 6 ejections", "by threefold repetition").
- **Flat HUD (#391).** With the Flat HUD setting on, the plate ends with one more block, one line each, built by
  `flatHudHtml` (`client/src/hud.ts`): "Turn: Black" ("Turn: game over" once over), "Ejected: Black 1/6, White 4/6",
  and in a boss fight "Boss phase: 2 of 3" and "Tell: " with the tell text and its countdown ("none" without a tell).
  Off, the block is gone. Strings kept verbatim for the e2e tests.
- **Boss health bar (#788).** In every boss fight (solo, daily, co-op) `#boss-bar` sits at the top centre: the boss's
  name in the display font, a red bar under it. The bar is cut into one fragment per ejection the player needs to win,
  read from the engine (`win_ejections`: 6 for most bosses, 12 for The Ballast Mind), and one fragment empties from the
  right per ejection, to an outline in `--muted` while the filled ones are `--danger`. The fragment where a phase begins (`phase_ejections`) has a light tick on its left edge, so the phase steps
  read without colour. It is one `role="meter"` for a screen reader ("2 of 6 ejected, phase 1 of 3"). Wider than tall it
  is centred in the top band between the plate and the button column, at most 24 rem wide and at least 10 rem (the top
  row of the board lies below it, also at 812 by 375); held upright it is the first row of the column, above the
  plate, one slim row (the name, then the bar) and the plate's own boss name is hidden, so the column is no taller and
  covers no cell. It grows with the UI scale like the plate and lets every press through. A fragment drains with a 400 ms
  fade; under Reduced motion (section 6) it changes at once. When the boss heals (The Chaplain, a player marble converted to it, #810) a fragment fills back with a 450 ms refill, a brief swell and brightening; the phase read by the screen reader comes from the engine and does not go back. It replaces nothing: the plate keeps the boss block with
  its P1 P2 P3 notches and the tell, and the phase notches and tally marks scratched on the frame stay (the bar is the
  quick read at the top, the frame marks the exact count), decided in #788. Outside a boss fight it is hidden.
- **Choir army chips (#816).** In The Choir's fight `#boss-bar` carries `.chips` (`client/src/choirchips.ts`), the play order `▲ Alto 5 > ○ Tenor 6 > ■ Bass 4`: one chip per army with a marble left, in cycle order, with its board glyph, name and marbles left, from `armies()` and `next_army()`. The army that moves next has a ringed chip (`aria-current="step"`), a removed army is gone and the arrows close up, the last army reads "×2". Right of the bar on a wide window (smaller on a phone held sideways), a second row of the bar's box under it when held upright; it covers no cell, plate or button, also at 200 % UI scale.
- **Terminal reader (#512, world.md section 4).** While the camera frames the deck console, the HUD, the
  buttons and the support corner hide, so nothing covers the screen's text at any UI scale; they come back
  when the player leaves. The page shown is copied into `#reader` (`aria-live="polite"`, labelled
  "Terminal"): its title, its text and "Page 1 of 2", read by screen readers only, and with the Flat HUD on
  shown as a plate at the bottom of the window, in the UI face at the UI scale.
- **Audio log player (#516, world.md section 4).** `#log` (labelled "Audio log"), the last of the page chrome
  but shown in the reader too: a Play log button while the reader is open, Skip log while a log plays, and
  above it the transcript line shown (`#transcript`, `aria-live="polite"`) unless the Transcript toggle is off.
  Wider than tall it lies bottom left, in the band left of the board, over the evaluation plate (at the top
  with the Flat HUD on in the reader); held upright it is the last row of the column, under the buttons and
  over the board. Like the evaluation plate it covers no cell and no control, and the line lets every press
  through to the board.
- **Online status.** Online games add one line under the turn: the player's own color and
  whether the opponent is connected, updated live (#121). Strings, kept verbatim for the e2e
  tests: "Waiting for an opponent..." (room creator alone, the turn title names the colour, #1038), "Joining as White..."
  (not seated yet), "You are White. Black is here.", "You are Black. White is disconnected.",
  "Room is full, watching" (spectator). Presence means the key bound to the seat is connected,
  not any peer. A dot before the text repeats the state (accent here, hazard waiting, danger
  disconnected, muted watching); the words alone carry it. While the creator waits, the invite
  link below the buttons has a caption and the accent border.
- **Boss with a partner (#530, named Fight together until #1529).** An item of the mode menu under Play online. It opens the list of the bosses of Boss
  fight under it; picking one opens a co-op room against that boss with a random seed (coop-boss.md), and the invite
  link's caption reads "Invite link: send it to your partner". Both seats play Black, so the HUD names the partner,
  never a colour. On a seated player's human ply the turn line reads "Your turn" or "Partner's turn", on the boss
  turn "White to move" as in solo. The status line reads "Waiting for a partner...", "Joining the fight...", "Your
  partner is here.", "Your partner is disconnected." or "Room is full, watching". Strings kept verbatim for the e2e
  tests. It is greyed offline, like Play online. The boss block shows the room's attempt, one muted line under the
  phase notches as in a daily fight: "Boss with a partner · attempt 2" (#531). The Rematch button reads "Retry" and its
  line names the partner: "You asked for a retry. Waiting for your partner..." and "Your partner asks for a retry."
  When both asked, the same fight restarts (coop-boss.md section 5).
- **Rematch.** When an online game is over, each seated player sees a Rematch button under
  Reset view, spectators do not. It is greyed once pressed, or while the opponent is
  disconnected. One more line under the status line says who asked, kept verbatim for the e2e
  tests: "You asked for a rematch. Waiting for White..." and "Black asks for a rematch." When both
  asked, the new game starts with the colours swapped and the line and the button go away (#186).
- **New game.** A button under Reset view, icon only (#297, the name is the tooltip and the accessible name, and the words show while it asks for the confirmation), in local games only (hot-seat or against the bot):
  boss, daily and online games do not show it. It leaves the game in progress for the start
  position, the bot on or off as it was, and deletes the saved game (tech.md section 8). With no
  move played it starts over at once. Once a move is played, the first press turns it into
  "Confirm new game" with the hazard colour for 4 seconds, and only a second press in that time
  starts over; no dialog. Strings kept verbatim for the e2e tests: "New game", "Confirm new game"
  (#230).
- **Daily challenge.** An item of the mode menu under Boss fight and its boss list, labelled "Daily challenge 2026-10-24: The Choir"
  (the UTC date and that day's boss; on a phone held upright the boss name takes a second line, so a long name pushes
  no item over the board, #575), starts the daily fight (game-design.md section 7.6). During
  it, the boss block shows one muted line under the phase notches, kept verbatim for the e2e
  tests: "Daily challenge 2026-10-24 · attempt 3" (#195).
- **Battle royale (#502).** An item of the mode menu under Fight together. It starts an offline battle royale, the
  player against 5 bots on the radius 8 arena (rules.md section 10.4), at the Furnace, the arena drawn at half the
  cell spacing in the room of the board, each seat's marbles in its shell tint. New game, Hint, the evaluation bar and
  Export game, Import game go away, as in a boss fight. The player selects marbles and presses a target as for a
  move, which locks the order, or presses Hold (#611). The bots' orders come from the round-start state, and the round
  resolves at once. The plate shows "Battle royale · Round 3", the initiative order of that round before its reveal,
  then the reveal of the last round in initiative order, one line a seat: "Bot 1: moved, ejected Bot 3", "You:
  fizzled" (in the hazard colour), "Bot 3: held", "Bot 4: out". The player is "You", the bots "Bot 1" to "Bot 5", each
  name after a dot of its tint. These strings are kept verbatim for the e2e tests. Once the game is over, Hold is
  greyed. A boss fight, Play online or Hub leaves it.
- **Battle royale online (#504).** Invite, in the column of an offline battle royale (not a seventh item of the mode
  menu: on a phone held upright its row would cover the board), greyed while offline like Play online. It opens a
  room of 6 seats (tech.md section 6) and shows its invite link, "Invite link: send it to the other players"; each
  link opener takes the first free seat. The arena and the plate are those of the offline
  game, the seats named "You", "Player 2" for another player and "Bot 4" for an empty seat, by seat number. Under the
  round line a status line: "2 players in. Start: bots take the empty seats" for the creator, who also gets Start in
  the column, in the accent; "2 players in. Waiting for the start..." for the others; then "Your order: a move or
  Hold", "Order locked, waiting for the others..." once the order is committed, "Waiting for the round..." past the
  deadline or for a spectator, and "Desync after round 4: a peer's game differs" in the danger colour. Under it,
  while the open round takes orders (to a spectator too), the order deadline in whole seconds, "Order deadline: 12 s"
  (#673), in the text colour, redrawn each second from the round start as it
  reached the page; in the last 5 s it pulses its opacity (to 0.6 at least), not under Reduced motion. It goes once
  every seat committed or the deadline passed. A seat silent for 2 rounds is played by the bot (tech.md section 6,
  #674): its reveal line reads as for any seat. Hold and the targets work only while the order can be committed. These strings are kept verbatim for the e2e tests, with
  body[data-net] (lobby, choosing, locked, waiting, over) and body[data-desync] (the round, 0 for none).
- **Battle royale breach, seats out and placement (#503).** A ring that cracks at the end of a round (rules.md section
  10.4, ring 8 at the end of round 12) glows in the hazard colour for the whole next round, under the Hull's crack
  decal and one tick per round left, and the plate warns in the hazard colour: "Breach: 48 cells void in 1 round". At
  the end of that round the ring is void: its discs are gone. A seat with no marble left is out: on the plate its name
  is greyed out and struck through in the initiative order, its tint dot faded, and its "out" line of the reveal is
  greyed. Once the game is over the plate is the end banner, lit like the others (End banner, #282):
  "You win" for first place (one seat, #641), else "You place 3rd", then the points the player scored, "10 points. The
  books balance." or "5 points. Tally strikes your name.", and the places, best first, one seat a line: "1st You · 10
  points", "2nd Bot 1 · 6 points". These strings are kept verbatim for the e2e tests.
- **Battle royale round played out (#612).** When a round resolves, the arena plays it out instead of jumping to the
  new position: each seat's turn in initiative order, a move sliding its marbles and pushing the line ahead as in a
  normal game (350 ms a turn), a marble pushed off the arena or onto a void cell falling with the ejection effect, a
  fizzled or held seat's marbles lifted and ringed for 250 ms, a seat out taking no time. Then the breach: the cracked
  cells sink away and the marbles on them fall (800 ms). Each line of the reveal appears on the plate as its turn
  starts, and the end banner waits for the end. A press or a key ends it at once, then does its usual job; an order (a
  target press, Hold) during it ends it first. Reduced motion: no animation, the arena jumps to the new position and
  the whole reveal shows. body[data-reveal] is "turn", "breach" or "done", for the e2e tests.
- **Copy diagnostics.** A button in the bottom-right corner, in every mode, icon only (#297: its name is the tooltip and the accessible name, at least 44 px on a phone), styled like the
  others but kept apart from the play buttons and off the board, even at phone width. It copies
  the diagnostics text (tech.md section 10) and the note line says "diagnostics copied". When the
  browser refuses the clipboard, the text appears in a box above the button, selected from its
  start, with the accent border, and the note says "diagnostics selected: copy them by hand". The
  box goes away once it loses focus. Both strings are kept verbatim for the e2e tests (#220).
- **Daily result card.** When a daily fight is over, under Retry: a read-only box with the text to
  share (game-design.md section 7.6), as wide as its text, with the accent border, then a Copy
  result button. Held upright, the rows of buttons leave no room above the board, so the card sits
  in the bottom-left corner, under the board, with Copy result beside Copy diagnostics. On a phone
  held upright Copy result is a 44 px touch target like Copy diagnostics, and the box above them both
  may be as wide as the window, so its first line does not wrap (#619). Wider than
  tall, the column stops above the Copy diagnostics corner, so neither the card nor a button
  scrolls under it. Like the buttons, the card never covers the plate or a cell. Copy puts the
  text in the clipboard and the note line says "result copied". When the browser refuses the
  clipboard, the text in the box is selected from its start for the player to copy by hand, and
  the note says "result selected: copy it by hand". Both strings are kept verbatim for the e2e
  tests. The card shows only at the end of a daily fight, never in a plain boss fight (#196).
- **Export game, Import game.** Two items of the settings menu, after Sound (#287), for local
  games only: hidden during online, boss and daily games (#219, file format in tech.md section 8).
  The hub (Hub) has no game on: it hides them too until a game leaves it, and a file still being
  read when the player opens the hub is dropped (#589).
  Export game downloads the game, Import game opens the browser's file picker. A refused file adds a
  short note to the HUD, kept verbatim for the e2e tests: "import refused: not a game file", "import
  refused: unknown file version", "import refused: illegal move in the file".
- **Palette.** An item of the settings menu sharing a row with Theme (#381): cycles Default, Protan,
  Deutan, Tritan and High contrast, and recolours the marbles, the rim light, tells and the HUD accent dot.
  Saved locally.
- **A bot that cannot answer (#736).** When the bot worker fails (its wasm did not start, or the search threw),
  the bot turn, the boss turn, the evaluation bar and the hint end instead of waiting for ever: the game is
  not "thinking" any more, a hint that was asked is off, and the HUD adds one note, kept verbatim for the e2e
  tests: "The bot could not answer: press New game".
- **A loading plate (#901).** From the first paint, a fixed plate (`#loading`, `role="status"`, the word "Loading" and a
  turning hex ring) sits over the page, so nothing shifts and a blank or half-lit screen never looks broken. When the
  bay is mounted (`mountBay` runs, a missing bay too), it fades out over 0.3 s (class `done`) and is hidden 400 ms
  later. Under automation (`navigator.webdriver`) it is hidden at once, so a check waiting on `data-bay` never sees it
  fade. Under reduced motion the ring is still and there is no fade. A failed start hides it, so it never covers
  `#boot-error`.
- **A failed start (#737).** If the wasm or the renderer cannot start, a box (`#boot-error`, `role="alert"`) covers
  the page with "The game could not start: <reason>" and a Reload button (`#boot-reload`), instead of a blank
  page with greyed buttons. The strings are kept verbatim for the e2e tests.
- The HUD is a live region (`role="status"`, `aria-live="polite"`) so a screen reader hears the
  turn change. `#hud` and its text are read by the e2e tests: ids and strings do not change.

### 4.1 Evaluation bar

Local hot-seat and bot games show who is ahead, from our own engine (#191). Online and boss games
never show it (fair play, #164): starting one hides it for good. The hub (Hub) has no game on: it
hides the bar and drops the evaluation in flight until a game leaves it (#583).

```
+------------------------+                  +-------------------------------------+
| [#########|.........]  |                  | [#########|.........]   Black +0.4  |
| Black +0.4             |                  +-------------------------------------+
+------------------------+                                   [ Copy diagnostics ]
 wider than tall: bottom-left                held upright: bottom-right corner
```

- **Place.** A second plate, at the bottom. It covers no cell and no control: the
  phone layout e2e test checks it like a control (#227) and checks that it lies over no button.
  - Wider than tall, it keeps to the band left of the board, bottom-left, as wide as the button
    column's band on the right (`50vw - 45vh - 1.5rem`, 8rem to 22rem), 16 px from the edges, with
    the words under the bar. The bottom-right corner keeps Copy diagnostics (#220).
  - Held upright, it is the first row of the bottom-right corner, just above Copy diagnostics,
    the window width minus 32 px at most 22rem, one row high with the words beside the bar.
  - It is not part of `#hud`, so it never re-announces the turn plate.
- **Bar.** Black's share on the left in the dark shell colour, White's on the right in the pale
  glass colour, the marble colours in both themes like the marbles (11.9:1 against each other),
  with an accent mark at the even middle. A lead of 4 ejections and their bonus (600 centi-marbles)
  or more is clamped at 5 % of the ends: the ends are kept for a decided game.
- **Words.** Next to the bar, the same state in words, so it never depends on colour or length:
  "Even", "Black +0.4" (the lead in marbles), "White winning" (the search found a forced win).
  Once the live game is over the words are blank: the result is the plate's title (#1038). In a
  replay the words are the evaluation of the position on show, never the final result. The bar is a
  `role="meter"` named "Evaluation" whose value text is these words.
- **Source.** The search score of the position for the side to move (`Engine.evaluate`), turned
  into White's share from 0 (Black wins) to 1 (White wins) by `client/src/evalbar.ts`. It is
  computed after every move, after New game (#230) and after an import (#219) in a second copy of
  the bot worker, so a bot reply never waits behind it, with a fixed node budget (`EVAL_NODES`, a
  quarter of the bot's), never a clock. One request is in flight at a time and only for the newest
  position: an answer for an older position is dropped, so a late answer never overwrites the bar
  of a newer position. The hint (section 4.2) uses the same worker: each reply goes to its request
  by id, so an evaluation and a hint can be in flight together.
- **Motion.** The bar jumps to its new share, it does not slide (section 6).

### 4.2 Hint

Local hot-seat and bot games have a Hint button: it shows the engine's best move for the side to
move as a ghost on the board, and never plays it (#192). Online, boss and daily games never show it
(fair play, #164): starting one hides it for good, like the evaluation bar. The hub hides it too
until a game leaves it (#583).

- **Place.** In the button column, under New game and above the Game modes button,
  the other tools of a local game, styled like the other buttons. Held upright it shares a row with
  one of them, so it adds no row of buttons over the board. The phone layout e2e test checks it
  like every control (#227).
- **Press.** A press drops the selection and asks for the best move of the position on the board.
  The move is drawn with the move preview ghost (#82): translucent marbles on the cells it would
  fill, and the marbles it takes wear the selection ring, raised like a selection (#301). The
  board, the side to move and the score do not change. While the hint is asked or shown the button
  is lit: `aria-pressed="true"`, accent border and text.
- **Clear.** A second press, a new selection (a click on a marble of the side to move) or the next
  move clears it. A hint belongs to the position it was asked for: after the next move, New game
  or an import it is off, and an answer that arrives for an older position is never drawn.
- **Disabled.** While the bot is thinking and once the game is over, the button is greyed.
- **Source.** `Engine.best_move` with the bot's own node budget (`BOT_NODES`), never a clock: the
  hint is the move the bot would play there. It runs in the evaluation bar's copy of the bot worker
  (section 4.1), so the bot's own reply never waits behind it; the next evaluation of the bar may.
  The hint state of a position lives in `client/src/hint.ts`.
- The label "Hint" is kept verbatim for the e2e tests.

### 4.3 Auto-play

An Auto-play toggle in the fight HUD, next to Hint, lets the bot play the player's side (#792). It is on offer in
a bot game, at the hot-seat table (the bot plays whichever side is to move), in the offline battle royale and in a boss
fight and a rogue-lite run's fight, never online (a versus room, a co-op fight, an online battle royale: the button is hidden), not in the hub and not with
`?bot=off`, the test flag that takes the bot away.

- **Play.** With it on, the bot (Web Worker, the current difficulty, `answer` with `player` for a boss fight) plays the
  player's move no sooner than 700 ms after the last (`AUTO_DELAY_MS`), through the same path as the bot's own reply, so
  the thinking guard shuts the board to clicks meanwhile. The bot's own side plays as ever. In the battle royale it
  commits the royale bot's order for the player's seat, once the reveal of the last round has ended.
- **No repetition** (#1500). The side Auto-play plays never repeats itself into a draw by threefold repetition (a draw is a
  lost boss fight and a lost fight of a run). At the root of its search a move to a position not yet seen in the game is
  preferred over any move to a seen one, even if it scores a little worse; failing that, a move that does not reach the
  third occurrence; a move that draws is played only when every legal move does. A winning move is always kept (an
  ejection cannot be undone, so it is never a repeat). In a boss fight the position counted is the one after the
  boss's hook (#1501): `Encounter::player_search` plays the move on a copy of the fight with `Encounter::play`, so a move
  whose hook (the Chaplain's conversions) rewrites the board into a seen position is not fresh. The bot's own reply, the hint and the boss's difficulty are
  unchanged. The rule is `avoiding_repeats` in `crates/edgefall-core/src/search.rs`, the move is recorded as any other, so
  replays and saves are unchanged.
- **Stop.** Any time: a second press turns it off, and a move being searched is dropped. It turns itself off when the game
  is over, replaced (New game, Retry, an import, another mode) or left for the hub.
- **Boss.** A boss fight needs that boss's medal (the medals, #791): without it the button is greyed
  and the reason is written next to it: "Beat The Echo once to unlock Auto-play against it".
- **Rogue-lite run** (#1489). Every fight of a run offers it: fight, elite and act boss (the boss rule above applies to an act
  boss). The bot plays the army's side with the run's rules, as its own reply does, and never a tactic. It covers the fight
  only and turns itself off when the fight ends.
- **Source.** The rule of availability lives in `client/src/autoplay.ts`. The boss move for the player's side is
  `Encounter.player_move` (the search of the boss budget, so the difficulty scales it), a plain game asks
  `Engine.auto_move` (`best_move` stays the bot's reply and the hint's).
- The label "Auto-play" is kept verbatim for the e2e tests.

### 4.4 Replay

Every game that keeps a move log has a Replay button, beside Hint and Auto-play on their row: a local or bot game, a boss fight, a daily
fight, an online room (as a view only) and an imported game file (#793). It is greyed until the first move and
hidden in the hub and in a battle royale.

- **Bar.** Replay opens the replay bar on the live position, in the bottom-right column above the evaluation
  bar (it covers no cell): a slider over the plies of the log, the label "Move N of M" (with "(live)" at the
  end), and First, Previous, Next, Last and Live buttons. The keys: Left steps back (and opens the replay of a
  game with moves), Right steps forward, Escape is Live. Left and Right are the camera while Free Cam is on, and
  are left to a text field or the slider when one has the focus.
- **Position.** The board, the side to move, the score, the end banner and, in a boss fight, the boss plate
  and its tells show the stepped position. It is built by replaying the first N moves of the log on a new engine,
  so the boss state at each ply is the engine's, deterministic; nothing is stored.
- **Auto-play.** Opening the replay turns Auto-play off.
- **View only.** While the bar is open no move can be played, no group is selected and no hint is asked: clicks,
  drags and the keyboard play do nothing on the board.
- **Live.** Live (or Escape) closes the bar on the current position, and the game goes on. A move that arrives
  meanwhile, the bot's reply or a peer's move, does the same: the bar closes on the live position. New game, an
  import, Retry and any other new game also close it.
- The buttons keep their labels "Replay" and "Live" for the e2e tests.

### 4.5 Hub deck plan (#1249)

The hub (game-design.md section 3.5) reads at a glance, with no hover:

- **Label plates.** A plate over each room, always shown, placed on the window just south of its cell and moved with
  the camera: the room's name in one of three colours (#1526: a mode in the accent, a boss in red or, in the neon look, violet, a locked lift in grey with a dashed edge) and a short plain line under it (`2 players, one screen`, a boss's `boss, Mess seat`, a lift's `open` or
  `locked`), and once a boss is beaten its medal (`Medal: 22 turns`). The names are the ship's own (#1547, the table below). A narrow or short window (600 px wide or 500 px
  high and under) shows the short label alone (`Bot`, `Hull`, `▲ Locked`): a boss's name drops its "The". The marble's floor cell wears `YOU`; on a room, that room's plate is ringed in amber. The plates
  sit on the 3D deck, dark in both themes, so they keep fixed dark colours. The HUD plate still names the room under the
  marble and the hovered target (#628).
- **Names of the ship (#1547).** A door and a terminal wear a name of the ship (`doorlabels.ts`, one table, using only the places and words of world.md: the Mess, the
  ledger, table zero, the mining cuts, the muster points, the clamp) and, under it, a short plain line that says what the door does, so a new player
  still understands at a glance; clarity wins over flavour. The HUD plate, the hover preview and the first-entry confirm read the same name and line
  (`Enter House table (play the ship's bot)?`). The Modes menu keeps its own names. No name depends on the story's stage and none holds a secret word of
  world.md section 12.2 (`doorlabels.test.ts` checks every label at every stage against `SECRETS`). A door with no name of its own wears the fallback, a tested default,
  never an empty plate. A mode's door keeps its plain word on a phone (`World`, `Bot`, `Hot-seat`...), which has no second line; a terminal and a boss door keep their own
  short name there. The first-entry confirm gives the full name and line, so the ship's name reaches a phone player; the signs of the Open world's towns, gates and towers use the same table (`placeSign`: the title of the place transition).

  | Room | Name | Plain line | Phone |
  |---|---|---|---|
  | Hot-seat | Crew table | 2 players, one screen | Hot-seat |
  | Bot | House table | play the ship's bot | Bot |
  | Online | Comms desk | 1v1 online match | Online |
  | Battle royale | Arena | battle royale | Royale |
  | Medal room | Medal wall | medals and best turns | Medals |
  | Daily | Morning count | the boss of the day | Daily |
  | Rogue-lite run | Mining cut | rogue-lite run, 3 acts | Run |
  | Fight together | Shift crew | co-op against a boss | Co-op |
  | Ranked | Clamp list | ranked 1v1 online | Ranked |
  | Open world | Airlock | walk the open world | World |
  | Trainer | Table zero | drill: waves of the bot | Trainer |
  | Terminal | the title of its entry: Captain's order, Galley log, Assay note, Loadmaster's log, Maintenance tag, Locker door, Chapel notice, Sermon notes, Clamp notice, Captain's console | read the log | Order, Galley, Assay, Loadmaster, Tag, Locker, Notice, Sermon, Clamp notice, Console |
  | Boss door | the boss's name | boss fight, `<Deck>` seat (or station) | the name without "The" |
  | Town (Open world) | Muster point | the Hub | |
  | Dungeon gate (Open world) | Mining cut | Rogue-lite run | |
  | Tower (Open world) | the boss's name | | |
  | No name of its own | Ship's door | a room of the Ballast | Door |

- **Seat and stations (#1547).** A deck has several boss doors (the Mess has The Echo and The Dual Room) but one **seat**: the boss that opens the lift to the next
  deck (`canEnter`), the lore-slot boss of world.md section 3. The other bosses of the deck are **stations** and never lock a lift. The plates say which each
  door is (`boss, Mess seat`, `boss, Mess station`) and the lift-shaft rail names the seat only (`Seat: The Echo waits`, `Seat: The Echo beaten`).
- **One loud station (#1526).** While the plate of the next goal (section 4.7, `nextGoal`) is on the deck, it is the one solid amber plate and every
  other plate is quiet (`data-quiet`, 78 % opacity), but the one under the marble, which keeps its ring. When the goal is on another deck, the lift
  on its way (the neighbour deck toward it, `wayTo`) is the loud plate, the others are quiet, and the rail's ringed row names the deck. The colours of
  the plates come down from a colour per mode to the three above. The staircase is the file's pier (`scene_hub_pier`), taken out of the Hub's scene (`withoutHubStaircase`).
  Not done under this issue: the pylons of the plinth (art direction, #1424), and the number of stations per town (towns, #1513).
- **Notice board (#1528).** A card at the left edge, the rail's twin (`#hub-board`, `hubboard.ts`), titled "Notice board", in Tally's flat register (a
  fact, no remark, no secret word of world.md section 12.2: `hubboard.test.ts` checks every state against `SECRETS`): "Daily: The Hull. Not played."
  (or "Won in 12 turns.", "Lost in 9 turns.", "Started, not finished."), "Next boss: The Hull." (the first boss not beaten, in deck order, "none left"
  after the five), "Medals missing: 15." (the roster's bosses with no medal, "none" at zero) and "Streak: 3 days." The streak is the consecutive UTC days
  (`utcDay`) with a daily started, today included, or yesterday back while today is not played; a missed day leaves no line at all, with no word on it.
  It is saved by the Daily's own store (`daily.ts`, `ab-alone.daily-days`, a JSON object day -> `started`, `won 12` or `lost 9`, the last 60 days):
  the day is marked when the daily starts and its result when the end card shows, a win kept over a loss and a faster win over a slower one. A profile
  from before has no such key: it loads as no day, and the attempts it saved for a day count as that day started. No server. Held upright, or on a
  window 600 px wide or 500 px high and under, the card keeps the daily and the streak on one plate above the dock, where the coach line lives, so it
  covers no station (`hub-board.spec.ts`, 960x540 and 390x844). It waits while the coach line of section 4.7 teaches, and while the first-entry confirm is up.
- **Lift-shaft rail.** The five decks from the Bridge down, each beaten (its boss beaten, from the boss menu too), open
  (its lift is open) or locked, and where the marble is. A window: a panel at the right edge, mid-height, left of the dock
  held sideways, the deck names alone on a short window. Held upright: a row of the five decks above the deck, under the
  plate and the cog.
- **Boss pips.** `Medals n / 15` (the count the Open world and the Medal room give, #1527) and a pip per deck in deck order, titled by its deck and boss: filled once beaten, a red ring while its deck is
  open, dotted while locked. Top right, left of the cog; held upright, over the rail's right end.
- The deck, radius 3, is framed a little closer than a board (Reset view frames it again): distance of a radius 3.6
  board, radius 3.4 held upright, so no edge plate is cut off at 360 px wide. A game the hub starts frames its own board.
- **A plate is a button (#1522).** A tap or a click on a plate walks the marble to its room (`hubPath` in `hub.ts`: the shortest way
  over floor cells, so no room is entered on the way, one roll every 160 ms, the same roll as a tapped cell). A tap on a cell, an arrow
  key or leaving the Hub stops the walk. A room that starts a mode asks first until the player entered one (section 4.7); a locked lift
  is walked up to and bumps as a roll onto it does. YOU is no room and takes no tap. On a coarse pointer the hit area reaches 12 px past
  the plate. The hover-only "Tap to move" is gone: the coach line of section 4.7 says it, and a touch screen has no hover.
- Hidden while the terminal reader or the Open world has the screen.

### 4.6 One mode at a time (#1275)

A mode switch starts from a clean base: nothing of the mode left stays on screen, in `body` data, in the scene or in a
timer.

- **What `enter()` adds, `exit()` removes.** A mode's start (`ModeController.enter()` in `client/src/controller.ts` for
  the hub, the start functions of `main.ts` for the others) adds its HUD blocks, `body` data, meshes, listeners and
  timers; its leave (`exit()`, `leaveRun`, `leaveTrainer`, `leaveRoyale`, `leaveOnline`) removes them all.
- **One cleanup path.** Every mode's start calls `leaveMode()` first (`main.ts`): the menu, a hub door, an Open world
  lair, Back, Retry, the Trainer's Next wave and a game resumed after a reload all go through it. It leaves whatever mode
  is on, then clears the stray state no mode owns: the fight's controls and sheets and the board's `body` data, from the
  lists of `client/src/modeswitch.ts`.
- **The Open world opens over the page** (#1063): the world hides all of the game beneath it, Esc presses the exit of the dock and lands in the Hub (#1605, section 4.10), and the next mode leaves it,
  its boss bar, notes and end light included. The next mode's start leaves the world.
- **Guard.** `client/src/main.modeswitch.test.ts` enters every mode of the README table, plays it and leaves it for the
  Hub, which must show what it showed after the boot. A new mode, a HUD element or a `body` data key that stays
  fails it: remove it in the mode's leave, or add it to the lists of `modeswitch.ts`.

### 4.7 First run and guide (#1293, #1521, #1523)

#### First run

A new player does not get five pages of rules first (#1521). Since #1665 a fresh profile does not reach this first run at the start: it lands on the
standard board against the bot (section 4.10), and the first run (`client/src/firstrun.ts`), then the Hub, plays only for a profile that holds the first-win
flag and has not seen it. It plays once and can be skipped.

1. **Cold open (#1523).** A plate over the board, the guide's own: a title (`Mess, deck 1`) and three lines in Tally's flat
   register, the place, the last clear visor and Tally's rule ("CSV Ballast, drifting over Hollow. Power: 11%." / "The crew
   has gone Black. Yours is the last clear visor." / "Tally keeps the count: six out, one winner."). It is stage 1 of the
   story (world.md section 12.2): no line holds a secret word of a later stage, and `firstrun.test.ts` checks it against
   `SECRETS`. Buttons: Skip (left) and Begin. Skip and Escape (B on the pad) go to the Hub.
2. **First match (#1663).** Begin starts the standard 14-v-14 game on the standard board, nothing scripted, against a very weak bot
   (`client/src/firstbot.ts`: a 1-ply mover, any legal move one time in two, else one that brings marbles towards the centre; seeded by the ply.
   `firstbot.test.ts`, 200 seeded games each: it never wins against a random mover (every game draws at 100 plies: a random mover ejects almost
   nothing) and loses to a greedy pusher in 194 of 200, the rest draws; 30 of 30 lost to the engine's 1-node search). The HUD names it
   `Practice bot · easy win`, with no rating. A new player under the lock (section 4.10)
   lands here directly, with no cold open and no Hub. A coach plate at the top (above the dock on a phone held upright) gives one sentence per
   step, each waiting for the player's real input: select (Click or Tap, by the device; the keyboard named once), pick the ringed cell,
   a broadside move, a push (the rule: three push two or one, two push one, a marble behind blocks). A broadside played first skips to the push step,
   a push played first ends the lesson. After 10 moves without a push the push step comes back, with a push of the position as the hint. After the push the plate fades at the next move and the game goes on. For the whole match an illegal move
   says the push rule in the HUD (`COACH.refused`). The HUD keeps Tally's first line and explains it once under it ("Tally is the ship's ledger.
   It counts every match: one seat is yours, the other is the bot's."). The match is never saved as the player's local game.
3. **End.** A win: for a new player the unlock card of section 4.10; for anyone else the plate reads "You won the first match..." with To the
   Hub. A draw or a loss: the plate says New game starts it again (a draw says so apart), the lock stays on. The end plate shows once. Skip hides the plate (a new player keeps the board and the lock,
   anyone else goes to the Hub).
4. **Hub with a goal.** The Hub says the next thing to do (#1524, below): until a boss is beaten it is The Echo. Its door is the one
   solid amber plate (`goalRoom` in `hubview.ts`), the Mess row of the lift-shaft rail is ringed in amber, and the line of the rail
   reads "Next goal: Beat The Echo on the Mess deck." The door's glow breathes; Reduced motion zeroes the animation and keeps the
   ring. This marks every Hub visit, a returning player who beat none included.

- **Who sees it.** `firstRunDue`: the plain root URL (no query, no hash), not played, no guide seen, no game saved and no
  boss beaten. A returning player, or one who saw the guide, gets the Hub as before (#602). The first run is marked done
  (`ab-alone.firstrun = done`, localStorage) as soon as it starts, so it plays once even when the tab closes. The scripted
  game is never saved as the player's local game.
- **Tests.** An automated browser does not play it, and is never locked by section 4.10 (unless `?newplayer`), so the e2e specs boot on a fresh profile as before; `?firstrun` makes
  it a first launch (`client/e2e/first-run.spec.ts`: a fresh profile plays the guided steps to its first push, then a won match opens the
  Hub with The Echo as the goal, well inside the 60 s of #1521). `body[data-firstrun]` reads `open` or `match`.
- **Vocabulary.** White and Black everywhere in rules text, as the HUD says (#1523): the guide no longer says pale glass and
  black shells.

#### The next goal (#1524)

One line of the Hub always says what to do next: a line under the five decks of the lift-shaft rail (`<p class="goal">Next goal: ...`),
shown on a desktop window and on a phone held upright, where the rail is a row of deck names and the plates are short (the line drops its "Next goal:" lead there and keeps one row, so it stays above the board of a 360x640 phone). The room it
points to is the amber plate and the deck of that room is the ringed row of the rail. It replaces the "The Echo waits · next goal" of
the row of #1521: one line, said in words, for every step.

It is computed by one pure function, `nextGoal(beaten, ran)` (`hubview.ts`), from what the player has done, with no store of its own:
`beaten` is the progress's bosses, `ran` is `ranRun(store)` (`runbook.ts`): a run was started, read from the stores that already are
(the compendium, written from a run's first screen, the history of the runs over, and the acts won). The path today:

1. **The first run** (#1521): played or skipped before the Hub is reached, so the Hub's line starts at the next step.
2. **Beat The Echo** on the Mess deck, while The Echo is not beaten.
3. **Start a rogue-lite run** on the Cargo deck, the Rogue-lite room (the amber plate), while no run was started.
4. **Beat the boss of the next deck**: the first deck, in order, whose boss is not beaten ("Beat The Hull on the Cargo deck."). It names
   only a boss the rail names already (its lift is open), never one above the progress, and holds no secret word of `SECRETS`
   (`story.ts`): `hubview.test.ts` checks every state of the path against both.
5. **All five bosses beaten**: "All bosses beaten. Try the Daily or a run." No room is marked.

Not on the path yet: the Open world's first move (a later step) and town training, which comes under Decision #1513. A step is added
to `nextGoal` when its content ships. Tests: `client/e2e/next-goal.spec.ts` (the line at two progress states, on 960x540 and 390x844,
covering no plate), `hubview.test.ts` and `main.firstrun.test.ts`.

#### The Hub's first minutes (#1522)

A new player lands in the Hub with a goal and has to learn how to move there. Two small plates, both of the coach plate's look
(`hubcoach.ts`; one line at the top between the HUD and the cog, above the dock on a phone held upright, over no room plate):

- **Coach line.** "Tap or click a next cell to roll. The arrow keys or the stick do the same." (`WALK_LESSON`, the one lesson of the roll, #1604,
  also the first line of the Open world's controls, openworld.md section 14). It shows when the Hub
  opens until the player has rolled once, in the Hub or the Open world (`ab-alone.hubcoach = done`, localStorage, the only key), and never comes back. A player who
  beat a boss never sees it.
- **First entry confirm.** Rolling onto a room that starts a mode (a boss door, a table, the Daily, the Rogue-lite, the Open world, any
  but a lift, a terminal and the Medal room) does not roll yet: a plate names the room ("Enter House table (play the ship's bot)?") with Stay and Enter, Enter
  taking the focus. Enter rolls onto the room and marks `ab-alone.entered = yes`: the confirm is never asked again. Stay, Escape, a
  tap on another cell or an arrow key closes it, the marble where it was. A tap on a plate that ends next to the room stops there and
  asks. A player who beat a boss is never asked, so the confirm never slows a returning player.
- **Tests.** An automated browser shows neither unless `?firstrun` asks, so every spec that walks into rooms boots as before
  (`hubHelpOn`); `client/e2e/hub-walk.spec.ts` covers both, and the tap on a plate, on a desktop window and a phone.

#### Guide

The five-page guide (`client/src/guide.ts`) no longer opens by itself (#1521). The settings menu's Guide and `?guide` open
it. It keeps its pages over the dimmed game, one at a time.

- **Pages.** The goal (you are White: push six of the Black marbles off, lose six of yours and you lose), a move (one to three
  marbles in a line, one cell, six directions), a push, the 3:2 rule (a line pushes only a shorter line, equal lines never
  push) and the controls. Each page has an inline SVG of the game's marbles, White and Black, on deck cells,
  with amber arrows and dashed ghosts where the marbles go; it sits on the dark deck colour in both themes, as the 3D deck
  does. No external asset.
- **Controls of the input in use.** The controls page holds one paragraph per input and `ui.css` shows one: the mouse and
  keys by default, touch on a coarse pointer, the pad's buttons once the pad is in use (`body[data-pad]`, #1252).
- **Plate.** The card is a plate of the ship chrome (panel, edge, rivets, the amber accent stripe), at most 26 rem wide
  and 16 px from the window's edges, its buttons 48 px high: Skip at the left, Back and Next at the right; Next reads Play
  on the last page. Each page's art fades in on `--motion-base`, a hard cut under Reduced motion.
- **Opened on demand.** Skip, Escape (B on the pad) or Play close it and store `ab-alone.guide = seen` (localStorage, as the
  other settings). The settings menu's Guide, the second button of the Steering item, and `?guide` (while not seen) open it on
  its first page. A player who saw it gets no first run.
- **A modal.** A dialog (`role="dialog"`, `aria-modal`): its Next button takes the focus, Tab and the pad's focus walk
  keep to its buttons, a key pressed in it never reaches the board or the menus, and Start leaves the settings shut. The
  focus goes back where it was (the cog when the menu opened it).
- **Tests.** `?guide` opens it, also in an automated browser (`client/e2e/guide.spec.ts`).
- **Language.** English, as the rest of the UI, which has no translations.

### 4.8 The goal card of The Echo (#1524)

The Echo opens on a card in place of one long line: a picture of the game's marbles over two short steps (`client/src/goalcard.ts`).

1. "Push 6 Black marbles off the edge to win. Lose 6, or draw, and you lose."
2. "Moves are mirrored for free, both ways. Take the ringed mirror of its move, then play your own."

The picture is an inline SVG strip on the dark deck colour, as the guide's art: a line of three White marbles on the left of an amber dashed
mirror line, and the Echo's marbles in the point-symmetric cells on the right, dashed in amber (the free move). It uses flat colours, no
gradient id (an id of another inline picture, the guide's, may sit in a hidden dialog, where it paints nothing). The card shows where
the goal line did (the goal is shown once, #1032): in the HUD before the first move, and in the Goal sheet after it. The plate of the HUD
has room for a few lines and covers no cell (`phone-layout.spec.ts`, every window it lists), so the HUD holds the two steps always and the
strip only where it fits: on a landscape window of at most 1100 px (9 rem wide), not on a phone held upright nor on a wide short window
(1101 px and more, at most 760 px high, where the goal keeps to three lines, #1067: the two steps are three lines there). The Goal sheet
always holds the strip and the steps. The other bosses keep their one line; their cards are a later step.
`boss.goal()` of the bridge is unchanged (the MCP server reads it). Tests: `goalcard.test.ts`, `main.boss.test.ts` and the Echo
spec of `client/e2e/echo.spec.ts` (the card in the HUD, then in the sheet, inside the window and clear of the boss bar).

### 4.10 The first-win lock (#1665)

A new player first plays a normal Abalone game against the bot (Easy, #1664); the rest unlocks after the **first win**. `client/src/unlock.ts`.

- **Locked until the first win:** Open world, Solo boss fight (the list and the Hub's doors), Rogue-lite run, Daily challenge, Battle royale, Ranked, Leaderboard,
  Boss with a partner, Boss vs a player, the Hub, the Trainer, and the Hub's boss and mode rooms. **Never locked:** Settings, the guide and rules, New game and Quick
  game against the bot, Play online with a friend, an `#room=` invite link (a person is waiting), and the Hub's tables, comms desk, terminals and lifts.
- **Look.** A locked entry stays visible and focusable (never `disabled`: Tab reaches it, Enter starts nothing): a dashed edge, `aria-disabled="true"`, `data-locked` (the line) and `data-lock-short`, a padlock before its name and
  "Win your first game to unlock" under it ("Win 1st game" under 600 px), 12 px in the text colour. Every row is at least 44 px tall. The menu opens on an amber
  banner "Win your first game vs the bot" with "More unlocks after your first win" right under it, in view without a scroll. The locked Daily keeps one line (its name is cut with an ellipsis, the whole name stays in the title). A press starts nothing, whatever the way in: one capture-phase guard on the page
  (the menu, the dock, the pad, `?openworld=` of a real player, Back, the Hub's doors). While locked the Hub's goal reads "Win your first game vs the bot" and no door is the amber plate; the notice board says "Next: win your first game vs the bot." and the open deck's seat in the rail "Seat: win your first game", not "The Echo waits". A locked Hub plate wears the line and the dashed grey of a
  locked lift. No animation, so reduced motion needs no case.
- **Start.** A new player on the plain URL gets the board, no cold open and no Hub (the cold open waits for the unlock too). Importing a game file that holds a won game
  against the bot unlocks like a win. The Open world does not lead the menu (`openWorldLeads`, `menuorder.ts`,
  stays for a profile that is unlocked and fresh, which is none on a browser).
- **First win.** The first win against the bot in a standard game (not a boss, run, Trainer, online room, wild fight or replay; a loss or a draw counts for
  nothing) saves `ab-alone.firstwin=1` and shows a card once: "You won." / "Unlocked: Open world, Bosses, Runs, Daily, Royale, Ranked, Leaderboard", with Open world (the filled button), Hub and Dismiss.
- **Existing players** are unlocked at once, with no card, when any holds: `ab-alone.firstwin`, a boss beaten, a saved local game, run or Open world, or any
  non-empty `ab-alone.*` key but the settings (difficulty, palette, sound, theme, transcript, motion, tier, quality, skins, scale, HUD, zoom, steering, look, volume and light keys) and the guide's (reading it is not play: a guide-only profile stays locked, the win is still needed): the tally, the story, the run, rating and world records, a name. A profile that holds only settings stays locked. Nobody loses access.
- **Hooks.** An automated page is unlocked unless `?newplayer` (`?locks` stays the boss list's own hook). `?unlock` saves the flag. `body[data-unlocked]` is `0` or `1`.
  The e2e loads a finished game through `#import-file`; `__enterMode('hub')` opens the Hub whatever the lock.
- The MCP has no browser profile and is not touched (mcp.md).

### 4.9 Browser Back (#1564)

The browser's Back button and the Android Back gesture take the player out of a mode the way its own button does, not out of the
game (`client/src/backnav.ts`, wired in `main.ts`).

- **One entry.** The page notes the screen it started on (the table, or the Hub for a new player). While another screen is shown
  (a mode, the Hub, a table played from the Hub), it holds one history entry of its own, pushed once a frame when it has none. The
  address never changes. Switching from one mode to another adds nothing.
- **Back runs the existing way out.** The entry is popped and the page presses the exit of the dock (section 4.10) when the screen
  has one, so Back lands where the control leads: the Hub, or the Open world for a lair, a wild fight (Flee), a town's Hub or run. A
  screen with none goes to the Hub (the Hub of the mode menu), and from the Hub the table. `exitOf` (`exitslot.ts`) answers both. The entry is pushed again for the Hub, so a second Back reaches the table, and a third leaves the page.
- **Back never destroys a game.** The table Back returns to is the saved local game, loaded as the boot resumes it (every move
  saves it, so the game left is the game that comes back, a Stalker fight under its fog included), with its mode and the bot
  answering if it was the side to move. A fresh table starts only when nothing is saved, which is a game with no move played; New game's
  save clearing (and its two-press confirmation) is not involved. Back does not drop a saved game for a mode played meanwhile.
- **No stale entry.** The mode's own button leaves the entry where it is. When Back pops it with the base screen already shown, the
  page goes on back at once: one press leaves, never two, and the mode is never entered again.
- **No confirmation.** A fight in progress is not asked about; Back leaves it as the Hub entry of the mode menu does. A
  confirmation is not built.
- **Play online keeps what it does.** Its invite link writes the address hash, which is its own history entry: Back drops the hash
  and the room goes on (a room is not broken by it, the invite box keeps the link). The page pushes no entry in a room and Back there
  does nothing else; leaving a room is the mode menu's Hub, as before. A `popstate` that comes with a change of the address hash
  (Chrome fires one when the link is written) is that entry's, never a Back from ours.
- **Guard.** `client/src/main.back.test.ts` and `client/e2e/back.spec.ts` press Back from every mode of the README table and the Hub.

### 4.11 The settings menu in five groups (#1566)

The menu is five groups, each under a visible heading (an `h3` in a `role="group"` named by it), in this order. Every item is the element it was, with its
id and its listener, moved under its heading (`client/src/settingsgroups.ts`); no setting is added, removed or changed.

| Group | Items |
|---|---|
| Sound | Sound (opens the volume page), Transcript, Logs, Ledger |
| Display | Theme (with its UI scale and Safe mode), Shell skin, Glass skin, Clear board, the Bloom, Lamps and Lights sliders, Reset lights |
| Accessibility | Reduced motion, Flat HUD, Palette (the colour-blind palettes) |
| Controls | Difficulty with its note, Steering, Guide |
| Advanced | FPS, Render, Free camera, Export game, Import game, Copy diagnostics |

- **Where the logs are.** Logs and the Ledger are for the player, not a developer tool, so they are in Sound, the last two rows: Logs replays the audio logs
  (whose text is the Transcript, the row above) and opens the lore read, and the Ledger is the written record of the story lines beside it. They stay a page of
  the menu in place of the items, as before.
- **Advanced** is a `details` disclosure, shut at every start and kept as the player left it while the page is open; its summary is a 44 px row with a + or a minus.
  The developer tools in it keep their rules in the other specs (Export game and Import game are hidden in the Hub and online, Copy diagnostics is the last row of the menu).
- **Labels.** Every item shows a visible label, an icon then a word, on a phone as on a desktop. The three that were a bare value say what they are:
  Difficulty: 50% (a fresh profile plays on Easy, #1664), Shell: Leather, Glass: Marble. A toggle shows its state as it did, filled while it is on (`aria-pressed`).
- **Size and place.** The menu is a column 20 rem wide at most (the window less 32 px), hung under the cog at its right edge and fixed to the window. It is as tall
  as its items and no taller than the window less a clearance at the bottom (above the score bar and the dock held upright and on a desktop, above the score bar
  held sideways, above the exit in the Open world). Taller than that, it scrolls inside itself, nothing is cut, and every item and heading stays 44 px. It covers
  cells while it is open, as the Game modes sheet does; a press outside closes it.
- **The cog** is at the right edge of the window in every state, as `thumb-dock.md` section 1 says: top right wherever the window is wider than tall, and held upright
  at the right of the row under the HUD plate (at the top right when there is no plate, in the Open world). It was at the left, under the plate; the plate
  keeps the whole top row, so the cog is not beside it: it is 44 px and a 360 px window leaves the plate 305 px. It clears the HUD plate, the minimap and the
  Map button at 390x844, 360x800, 844x390 and 960x540 (`e2e/settings-groups.spec.ts`).

### 4.10 One door grammar (#1517, Decision #1513)

A mode is entered by a door and left by one control: the exit `#exit`, the **first slot of the dock** in every mode, the Open world on
a phone and on a desktop included (the dock shows the exit alone there, bottom right, clear of the stick, the plate and the map button; the
separate Hub button is gone). Its label names where it leads: **World** when the player came from the world, otherwise **Hub**; it returns the
hero to the entrance used. It replaces the Hub button of the Open world, "Back to the hub" and "Back to the Open world" (once in the Lobby
sheet). Esc in the world presses the exit (#1605) and Browser Back (section 4.9) presses it too, so all three land in one place, the Hub. The map or a sheet open over the world (the terminal reader, the settings, the Game modes, Goal, Lobby) closes first on Esc, and the world stays. The plain table and the Hub, the home of the game, have none: their first
slot stays New game. A wild fight keeps Flee (F) in the first slot until it is over, as Flee leads to the same place, then World.
A boss or lair fight in progress with a ply played is not saved, so the exit asks for a second press, `Sure?` in the `.confirm` look, lapsing after `CONFIRM_MS` as New game does (`newgame.ts`); a fight over or with no ply, the world, the Hub, a town, a run, the Trainer and a table ask nothing, and Browser Back never asks.

**The Hub Cutaway rewrites this table (#1698; amends Decision #1513, owner 2026-11-14).** Design: `cutaway-v2.html` on the `pr-screenshots` branch (`hub-cutaway/`).
Status: the ship is the default Hub since #1696 (#1689, #1691, #1694). `?hub=classic` is the off switch for one release and brings the old Hub back; `?hub=cutaway` is a no-op. #1697 removes
the old path (the Modes menu, Quick game, the dock's World button and the old Hub code). What follows is the default page.

**One home for every feature.** A feature starts in one place; any other screen may show its state and lead there, never start it.

- A room of the ship is in the Hub: every mode, every boss, the run, the Daily, the records and the logs.
- A place on Hollow is in the Open world: wild fights, teleporters, the map, towns and their Workshop (openworld.md, unchanged).
- An action on the game in progress is in the dock: New, Hint, Undo, Replay, Retry, Goal, Flee, Hold, Lobby, and the exit in the first slot.
- A preference or a tool is in Settings, the only menu; Reset everything stays its last row (#1684).

**Tower or bay: the bay stays.** A boss starts from its bay in the ship and nowhere else. Its tower stays on Hollow with what it guards and gives, and is the way in: rolling onto it
opens the ship on the boss's deck, the boss's room amber and the first-entry confirm up (the deck is lit for the visit, shut or not). A gate does the same for the Mining cut, its
biome kept; a town opens the Mess. Enter starts the same fight or run as a tap on the bay; Stay and the exit lead back to the tower or gate (`hubentry.ts`, #1694).

**The next goal, always in sight (#1695).** The goal is the game's own (`nextGoal`; the House table while the first win is awaited), never a second rule. Its bay wears the beacon (amber sign, two
rings that pulse unless motion is reduced); a dotted amber route runs from the marble up the lift and along the floor, and the marble's tag says the way (the deck to ride to, or the room); both redraw
when the goal or the marble moves, and wait while the marble rolls. A phone has the goal line over the dock, a window the card with Go over the right shoulder: one tap rolls the marble to the goal's bay.
With no room left (all five beaten) the line and the card say so and do nothing. A tower's or a gate's visit shows none of it. Code: `hubgoal.ts`.

| Screen | Enter | Exit, first slot | State |
|---|---|---|---|
| Plain table | Hub, House table bay; New game | the exit, to the Hub (the table is no longer a home) | Once the flag is on (#1697) |
| Hub (the ship) | Boot of a returning player; the exit of any mode | none: the home, no dock. Back goes to the table | Default (`?hub=classic` for the old one) |
| A table, a boss, the Daily, the Rogue-lite run, the Trainer, a battle royale, a ranked game | Tap its bay: the marble rolls there, the confirm asks, Enter starts | Hub | Default (`?hub=classic` for the old one) |
| Open world | Hub, Airlock bay | Hub (the world saved) | Default (`?hub=classic` for the old one) |
| Town | Roll onto a town: the ship opens on the Mess | World, hero on the entrance | Default (`?hub=classic` for the old one) |
| Dungeon gate (the run) | Roll onto a gate: the ship opens on the Mining cut, the biome kept | Stay or the exit: World, hero on the entrance | Default (`?hub=classic` for the old one) |
| Tower (a lair fight) | Roll onto a lair: the ship opens on the boss's bay | Stay or the exit: World, hero on the entrance | Default (`?hub=classic` for the old one) |
| Wild fight | A marble touches the hero | Flee, then World | Built |
| Online room (Play online, Fight together, Boss duel, an invite link) | Comms desk, Shift crew bays; `#room=` opens its table | the exit; its Lobby sheet | Once the flag is on |

Not changed by the Cutaway: the first slot of the dock is the exit in every mode (Hub or World), Esc and Browser Back press it, and a fight with a ply played asks `Sure?`.

**The Modes menu goes once the flag is on (#1696, #1697).** World and Quick leave the dock with it, and the Hub at home has no dock. The dock of a table is New, Hint, Undo, Replay;
in the Open world the plate keeps Nearest tower and Quick game goes. Two taps reach any mode from any game: the exit, then a bay.

**A new player (#1665 with the Cutaway).** Plays the guided first match first, then lands in the ship with only the Mess lit; the other decks stay dark with a padlock and open after
the first win (the lock, section 4.10 above) as the old menu's locked rows did. A returning player still lands on the Hub at boot, and an invite link still opens its table.

**Small phones** frame two or three decks around the marble. The shell is tall under 600 px wide or 500 px high, wide above (`hubcutaway.ts`). Measured on the real GPU path with the flag on: 19 draw calls since the bays and lift (#1691; 17 for the ship alone, #1689), 4,731 (tall) and 4,815 (wide) triangles in the frame.

Every feature, after:

| Feature | One home |
|---|---|
| A game against the bot | Hub, House table. New stays in the table's dock to restart |
| Hot-seat for two | Hub, Crew table |
| Online with a friend | Hub, Comms desk (an invite link still opens its table) |
| Battle royale | Hub, Arena |
| Ranked, Leaderboard | Hub, Clamp list (Leaderboard on the second row of its sheet) |
| Boss with a partner, Boss vs a player | Hub, Shift crew (Boss vs a player on the second row of its sheet) |
| The 15 solo boss fights | Hub, the boss's bay; its tower is a way in |
| Daily challenge | Hub, Morning count (the notice board only reports it) |
| Rogue-lite run | Hub, Mining cut; a gate opens the ship on it |
| Trainer | Hub, Table zero |
| Entering the Open world | Hub, Airlock |
| Going to the Hub | The exit, first slot, on every screen but the Hub |
| Medals and best turns | Hub, Medal wall (the counts stay as lines to read) |
| The ship's logs | Hub, the Logs bay of each deck; the Ledger joins the Medal wall; the transcript stays a setting |
| What waits for the first win | Hub: the ship in its locked look, in place of a locked menu |
| Workshop, a town's contract and ledger line | Open world, the town (unchanged) |
| Wild fights, teleporters, Teleport, the Map, Nearest tower, the world's logs, resources, recruits, other heroes | Open world (unchanged) |
| New, Hint, Undo, Auto-play, Retry, Rematch, Goal, Flee, Hold, Lobby, Replay | Dock (unchanged) |
| Reset view | The button over the board (#1681) |
| Quick game | Gone: it is the House table, two taps away |
| Sound, display, accessibility, difficulty, steering, the Guide | Settings (unchanged) |
| Export and import a game, diagnostics, FPS, render, free camera, Console | Settings, Advanced (unchanged) |
| New version: reload | Settings, first row, the dot on the cog |
| Reset everything | Settings, last row (unchanged) |

**Old table (flag off, until #1697 removes it).**

| Screen | Enter | Exit, first slot | State |
|---|---|---|---|
| Plain table | Boot, New game | none: New game | Built |
| Hub (the deck) | Boot of a new player; Hub of Modes | none: the home. Back goes to the table | Built |
| A table, a boss, the Daily, the Rogue-lite run, the Trainer or the Open world of a Hub door | Roll onto the door | Hub, the marble on the door's cell | Built |
| Battle royale, Rogue-lite run, Daily, Trainer, Boss fight, Open world of Modes | The Modes sheet | Hub | Built |
| Open world | Modes, a Hub door, `#openworld` | Hub (the world saved) | Built |
| Town (the Hub scene) | Roll onto a town | World, hero on the entrance | Built (its own stations: planned) |
| Dungeon gate (the run) | Roll onto a gate | World, hero on the entrance | Built |
| Tower (a lair fight) | Roll onto a lair | World, hero on the entrance, at any time | Built |
| Wild fight | A marble touches the hero | Flee, then World | Built |
| Online room (Play online, Fight together, Boss duel, Ranked, an invite link) | Modes, `#room=` | none: its Lobby sheet and the Hub of Modes | Waiting for the arena town |
| Arena town, the other towns' stations, Quick game button, Console, Boss fight fast travel | | | Waiting (openworld.md section 13) |

**The Modes menu does not shrink in this slice.** The arena town and the other tables are not built, so Play online, Fight together, Boss
duel, Battle royale, Ranked, Leaderboard, Boss fight, Daily, Trainer and Rogue-lite run have no place in the world to move to: they stay
in the menu until their rows above are built. The rows of the table that wait are the online room, the arena and the other towns, the
Quick game button, the Console and the fast travel.

Held upright in the world the plate stands above the exit and in the lower half of the screen, the hero at the middle stays seen: a taller plate scrolls, the online row last (#1606).

The dock keeps New game, View, Hint, Replay and Modes clear of the exit: held upright, the gaps shrink from 8 px to what a 360 px
window leaves, so seven buttons (the exit with Auto-play at a bot's table) fit; the buttons stay 44 px. Held sideways the column scrolls from six
buttons on, as before (thumb-dock.md section 2).

- **Tests.** `exitslot.test.ts` (where it leads), `main.back.test.ts` (Back lands there), `client/e2e/door-grammar.spec.ts` (every mode entered and left by the same first slot, the dock
  at 390x844, 960x540 and 844x390).

### 4.12 The empty lobby and the boss names (#1529)

A lobby nobody joins never leaves the creator with nothing to do, and no mode hides until a peer is seen (it would need a presence
server, and it would hide every mode from the first player). The wait, the texts and the choices sit in `lobby.ts`, tested.

- **The boss entries say who plays.** `Solo boss fight` (id `boss-fight`), `Boss with a partner` (id `fight-together`, a co-op room) and
  `Boss vs a player` (id `boss-duel`, the creator is the hero and the joiner plays the boss). The labels changed (#1529), then the HUD lines (#1630: "Boss with a partner · attempt 2", "Boss vs a player"); the ids and the
  invite links did not.
- **The offer.** After 20 s with no peer in the room, the Lobby sheet shows one button, `Play the bot while you wait` (`#lobby-bot`),
  for all four lobbies: Play online, Ranked, Boss with a partner and Boss vs a player. The invite link stays in the sheet above it.
  A peer in the room, before or after the 20 s, means no offer.
- **The bot game is of the same kind.** A table (Play online, Ranked) or the same boss and seed (the two boss rooms), against the bot,
  as New game and a solo boss fight play. The room stays open and listening: its session, its transport and its invite link are kept,
  with no new network traffic. The page is a local game while it lasts: no seat, no ranking, no Ranked panel.
- **A bot game never counts.** It is never sent to the room and never rated, in Ranked or the Leaderboard.
- **The switch line.** When a player joins the room during the bot game, a button under the HUD (`#room-switch`, 44 px, accent border)
  reads "A player joined the room: switch to it". A press leaves the bot game as any mode change does and seats the page in the room
  (a new game in its seat, the boss deck of a co-op room, the Rematch or Retry button). Leaving the bot game by another mode closes the
  room, as leaving a room does today.

## 5. Board framing

The canvas fills the window. A window taller than wide keeps the horizontal view of a square one
(the vertical field of view grows past 40 degrees), so the whole board fits the width of a phone held
upright, and the picture moves down by a quarter of the spare height, which leaves the top to the
plate and the buttons (#227). Every view a fight opens on, and Reset view, puts the board's centre in the
middle of the window's width, and of its height wider than tall (held upright, that height less the shift);
for The Dual Room the centre is the middle between its two rooms (#957). A fight against The Pulsar opens drawn back, along the same line, just
far enough that the six pulsars off the corners and the counter above each fit the window too, and
Reset view goes back there (#691). The HUD plate never pushes the board aside: the player folds it
instead (section 4, #957). A new window size, such as a phone turned upright, fits that view again
while the player has not moved the camera; once he orbits or zooms, his view stays until Reset view
(#696). A co-op Pulsar fight opens on the same view. The chrome adds a rim only: a fixed, non-interactive radial gradient
from transparent at 65 % to near-black (`#0b0d0f` at 75 % opacity) at 100 %, the same in both themes because the 3D deck is dark either way (fog at the rim, never over the cells). No border or
frame is drawn around the canvas, the 3D deck is the frame. The rim is removed with clear-board
mode once that toggle exists (#32), and it has no motion.

### 5.1 Board zoom on a phone held upright (#1567)

A phone held upright (window taller than wide, at most 600 px wide) has one more control, `#board-zoom` (aria label "Zoom the board",
`aria-pressed`), a 44 px button at the right edge of the dock band, 8 px over the dock (thumb-dock.md section 1). One tap toggles
between the whole board with its rim, as above, and a closer view; the choice is saved per device (`ab-alone.board-zoom`) and stays
until it is toggled off.

- **The closer view** is a fixed camera in front of the board, almost straight down (0.15 rad from the vertical), drawn as close as keeps
  all 61 cells, discs included, on the window (3 % margin, `zoomView` in `client/src/boardzoom.ts`). The frame's corners and the rim may be
  cropped, no cell is. The orbit, the pinch and the wheel do not move it; the whole view comes back with the toggle.
- **Marble width** (0.92 of the cell spacing, projected through the camera, held by `boardzoom.test.ts` and `e2e/board-zoom.spec.ts`):
  at 390x844 the narrowest marble goes from 30.3 px to 37.1 px (middle cell 35.7 to 38.6); at 360x800 from 27.9 px to 34.2 px (middle cell
  33.0 to 35.6). The test holds every marble of the closer view at 34 px or more at both sizes.
- **It never blocks a move.** The camera is the picking camera: a tap on a marble selects it in both states. The HUD plate, the dock and the
  button cover no cell at 390x844 and 360x800 in the closer view (`phone-layout`).
- **Where it applies.** The boards of 61 cells (the game, a bot game, the boss and rogue-lite fights). Not the Hub, the
  Battle royale, the Open world, the terminal reader, nor the Pulsar, Dual Room and Ballast Mind fights, whose props or radius lie off a
  61-cell view: the button is hidden there. Desktop and landscape never show it and are unchanged.
- **Open (#1567).** A mis-tap check on a real device (how often a finger lands on the neighbour of the marble it aims at, whole and closer)
  has not been done: it needs a phone in hand. The widths above are a proxy, not that check.

## 6. Motion

- HUD changes fade in over 160 ms (opacity only, ease-out). Nothing moves, nothing slides.
- No looping CSS animation on the page. Camera drift belongs to the renderer, not to this file. The end of a game plays one short animation that ends by itself (section 4, End banner).
- Reduced motion, a toggle of the settings menu (#379), sets every transition and animation duration to 0
  (`:root[data-motion='reduced']`), and the renderer swaps the ejection tumble for a plain fade, drops the
  spatter and the slide. Until the player presses it, it follows `prefers-reduced-motion`; the choice is saved
  locally like the volume sliders and Theme. One pure function, `motionReduced` in `client/src/settings.ts`, decides it.
- The Overseer's speech bubble (#741) is a fixed element over its pedestal: monospace, pale text on near-black (an
  angry one white on dark red), sized with the UI scale and at most 16 rem wide. Typing is
  17 characters a second with a 1 px colour split of the text for 25 ms per character (not a flash) and a soft blip on
  the effects bus; it holds 3 s (angry: 1 s) after the last character, fades over 400 ms, and the angry one shakes
  for as long as it shows. Reduced motion shows the whole text at once, with no split and no shake. Screen readers get
  the whole line at once. Strings: "The vents now burn your marbles too." (HUD, 2 plies) and the 6 angry lines
  (game-design.md section 7.11). On its defeat the bubble types its farewell (typed and held like a taunt) once
  its marble has exploded, and an angry line due on that ply is dropped (#789).
- No flash above 3 per second, no full-screen white, ever (photosensitivity, world.md section 8).

## 7. Colour and contrast

Visuals are judged by the art director on captures, no contrast test (owner, 2026-11-07).

Meaning is never carried by colour alone: turn side by marker shape and words, score by text,
result by words.

## 8. Out of scope

Board textures and marble looks (#89, #26, #28), the ghost preview (#82), menus and settings
terminal (#22), UI scale and theme picker (#32), audio. A theme picker is not part of this task:
the theme follows the system setting, `data-theme` is the hook for #32.
