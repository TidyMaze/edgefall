---
id: thumb-dock
type: feature-design
status: draft
title: "Thumb dock"
parent: ui
references: [motion]
---

# Thumb dock: spec for #1032

Status: decided by the owner (section 6). Concept 1 of the four mockups (`concept-1.html`, chosen 2026-10-31). Scope: one topic, the placement of the main controls. No code in this spec.

Sources read: `client/index.html` (ids), `client/src/ui.css` (current rules: `#chrome` 64, `#online` 125, `body[data-openworld]` 737, `body[data-reading]` 248), `client/src/main.ts` (settings items, Reset lights at 852).

## How the numbers were obtained

- **Measured**: Playwright (Chromium, from `client/node_modules`) on `concept-1.html`, mockup frame resized to the viewport. Only the mockup's own boxes (board placeholder, HUD, dock, cog) are measured, not the real game.
- **Assumed**: the real HUD height, the real board size and position, the joystick size, the safe-area insets, and the 4 px vertical gap (taken from #1030 as the lead gave it; the PR was not read).

## 1. Controls per state

Dock = the bottom bar (one row, 44 px buttons). Sheet = a panel above the dock (see section 3). Top = the top band (HUD, cog, boss bar, transcript).

| State | Dock (bottom bar) | Sheet | Top band |
|---|---|---|---|
| Normal game | The exit (`#exit`, first slot, to the Hub), New game, Hint. Undo and Replay when there is one to take back or review; Auto-play when allowed (#1697: no World, Quick game or Game modes) | None | HUD plate (`#hud`), cog `#settings` (top right) |
| Boss fight | The exit in the first slot, then Retry (`#boss-retry`) or Rematch (`#rematch`, after a loss), Goal (`#boss-goal`), Replay. Hint and Auto-play only when the game allows them | Goal opens the goal text as a sheet above the dock (not a new row over the board) | Boss bar (`#boss-bar`) on the top row, full width, above the HUD (#929). HUD plate below it. Cog at top right |
| Ranked | As normal game | None: Ranked is a row of the Clamp list bay's sheet in the ship | HUD shows the rank badge (`#hud .ranked`) |
| Fight together / Battle royale | The exit, Hold (Battle royale only: one tap each round, so it stays in the dock, #1044), Lobby (`#lobby`, shown only while the lobby sheet has a control) | Lobby sheet (`#lobby-sheet`): Start, Invite and Fight together's invite row (`#invite-row`). Opens only when the player taps Lobby: it never opens by itself, so it never covers the board unasked. While a lobby waits, Lobby carries a steady accent (border, text and a dot on its corner, `data-waiting`), never a flash. Hold is not in it | HUD plate with the presence line, the only status line: the sheet repeats no status, and "You are Black" stays there (#1044) |
| Daily challenge | As normal game | Daily result (`#daily-card`: text and Copy result) opens as a sheet when the daily ends. Closes with Esc or a tap outside | HUD plate with the daily line |
| Open world | The exit `#exit` alone, Hub, bottom right (#1517; the dock was hidden here, with a separate Hub button on touch). Joystick (`#joystick`, touch) sits bottom-left in the same band, 16 px from the edges | Open world panel (New world, Seed, Keep or Discard) as a sheet above the joystick band | Open world text and seed (`#openworld-hud`). Keyboard: arrows roll, Esc leaves. Free camera stays in Settings |
| Replay review | The dock shows the replay controls, one row of five 44 px icon buttons: First (⏮), Previous (◀), Next (▶), Last (⏭), Live. Replaces the normal dock while reviewing | None | Replay slider and label (`#replay-slider`, `#replay-label`) on the top band under the HUD, full width, 44 px high |
| Auto-play | Sixth dock button when allowed (`#auto-play`, hidden otherwise). Six buttons fit 360 px: 6×44 + 5×8 = 304 px | None | None |
| Update banner (`#update`) | Not in the dock. Shows as a dot on the cog, and as the first row of Settings (#1693) | First row of Settings | None |
| Transcript and log (`#log`) | Not in the dock | Log archive stays in Settings | Transcript line stays under the HUD as today |

Notes:
- Settings (cog) is the only control at the right edge of the top band in every state, so the thumb never has to reach it except to open it. It stays 44×44. Wider than tall it is top right (16 px from the top and the right). Held upright it is at the right of the first row under the HUD plate, not in the plate's row (the plate takes 305 of the 358 px of a 360 px window and its fold button is in its corner), and at the top right when there is no plate (the Open world, #1566).
- The board zoom (`#board-zoom`, #1567, ui.md section 5.1) is not a dock button: a 44 px button at the right of the dock band, 8 px over the dock, shown on a phone held upright on a 61-cell board only. It steps aside while a dock sheet is open. The dock keeps its buttons.
- Clipboard (`#copy-diagnostics`) leaves the bottom-right corner (open question 1).
- `#support` (the support container with the replay bar and clipboard) is emptied: the replay bar goes to the dock and the top band (replay review), the clipboard moves (open question 1).

### Once the Hub Cutaway is on (#1698)

The default since #1696; #1697 removed the Modes menu, Quick game, the dock's World button and the old rows above (`?hub=classic` is still the off switch until the old Hub code goes). Design: `cutaway-v2.html` on the `pr-screenshots` branch. The Modes menu goes, and with it Game modes, World and Quick game in the dock. The first slot is the exit on every screen but the Hub (ui.md section 4.10).

| Screen | Dock |
|---|---|
| Hub (the ship) | none: the bays, the goal line (Go in a window) and the cog |
| Table | the exit, New, Hint, Undo, Replay (Auto-play when allowed) |
| Boss fight | the exit, Retry or Rematch, Goal, Replay |
| Open world | the exit alone, as today; the plate keeps Nearest tower |
| Online lobby, battle royale | the exit, Hold (royale), Lobby |

Settings is the only menu and stays at the cog; the update dot moves to the cog. Targets stay 44 px. Not measured: these docks on a device.

## 2. Geometry

Assumed for every size: the dock is `left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom))` on a phone. Dock height is 62 px: 44 px button, 8 px padding top and bottom, 1 px border. Button gap 8 px horizontal. Vertical gap between wrapped rows is 4 px (from #1030 as the lead gave it).

The band reserved for the board: from the bottom of the top band plus 8 px, to the top of the dock minus 8 px. Nothing (controls, sheets, bars) may enter it, except the sheets, which open in the same band and close when dismissed.

| Size | Dock | Board band | Measured in the mockup |
|---|---|---|---|
| 360×780, portrait | Full width 16 to 344 px. Dock 702 to 764 px (780 − 16 − 62 = 702) | From HUD bottom + 8 to 694 px | Mockup (page coordinates, 34 px frame offset): dock 716 to 778 px, board grid bottom 568 px: 148 px gap. All five dock buttons 44×44. Labels overflow the 44 px width (section 5) |
| 390×844, portrait | Full width 16 to 374 px. Dock 766 to 828 px | From HUD bottom + 8 to 758 px | Mockup (same offset): dock 780 to 842 px, board grid bottom 600 px: 180 px gap. Label overflow not measured in the normal state |
| 375×812, portrait | Full width 16 to 359 px. Top 734 px | From HUD bottom + 8 to 726 px | Not measured (assumed, same rule as 360 and 390) |
| 844×390, landscape phone | **Does not fit as a row.** Proposal: a vertical column on the right, 16 px from the right edge, 44 px wide, 8 px gaps, under the cog: top at 68 px, six buttons end at 372 px (≤ 374). Column x 784 to 828 | Left of the column: x 16 to 776, y 68 to 374 | Mockup as a row: dock 371 to 433 px, screen bottom 404 px, so the dock is cut by 29 px and overlaps the board grid by 6 732 px² (fails) |
| 1280×720, desktop | Centred, bottom 16 px, width of its content (five buttons: 5×44 + 4×8 = 252 px) plus 16 px padding. Top 642 px | From HUD bottom + 8 to 634 px | Not measured (the mockup's desktop view is scaled 50 %, so its numbers are halved) |

UI scale:
- The top band (HUD, boss bar, cog) grows with `--ui-scale`, as #927 asks. The dock does not grow: its targets must stay 44 px. Label text may grow with the scale. **Assumed**; open question 3.
- At 200 %, the mockup's dock with its zoom applied: dock top 718 px, board grid bottom 697 px, no overlap, the five buttons 88×88 (zoom test, the real dock would not scale). Only the boss-fight state and the real HUD height at 200 % need a real measure.

Safe area: `env(safe-area-inset-bottom)` added to the dock bottom on phones. **Assumed**; not measured on a device with a notch.

Keyboard: the dock is a toolbar (`role="toolbar"`), DOM order = Tab order. Arrow keys between buttons: optional (not in scope).

## 3. Sheets

- Opened by the dock button (Goal, Daily result, lobby controls) or by the cog (Settings).
- Position: bottom edge at dock top − 8 px (the band rule), left and right 16 px.
- Height cap: `max-height: min(60 %, board band height)`, so a sheet never reaches the top band. Overflow: `overflow-y: auto`, scroll inside the sheet. Items keep 44 px.
- Close: Esc, a tap outside the sheet and the dock (pointerdown), or the same trigger button.
- Focus: moves to the first item on open; returns to the trigger button on close.
- Focus ring: 2 px solid `--accent`, offset 2 px (matches ui.css:144).
- Only one sheet open at a time.
- Settings stays at the cog as a list under the cog, in five headed groups, scrolling inside itself when taller than the window (ui.md section 4.11, #1566).

## 4. What leaves the old top column

The `#online` column (ui.css:125) stops being a column of buttons in portrait:
- Moves to the dock: New game (`#new-game`), Reset view (`#reset-view`), Hint (`#hint`), Replay (`#replay`), Auto-play (`#auto-play`), Undo (`#undo`), Retry and Rematch, Goal (as a dock button, see section 1).
- Moves to a sheet: the bay sheets (`#bay-sheet`, #1693; the mode menu `#mode-menu` is gone, #1697), the daily card (`#daily-card`), the invite row (`#invite-row`), the lobby controls, the update banner (`#update`).
- Stays at the top: the cog (`#settings-box`), the HUD (`#hud-dock`), the boss bar (`#boss-bar`), the Open world text (`#openworld-hud`), the transcript (`#log`).
- Leaves the bottom-right: the clipboard (`#copy-diagnostics`) and the replay bar (`#replay-bar`), as above.

The rules that set the column's portrait layout (ui.css:301-335, the `.group` display rules at 129-131, the portrait rules of the former mode menu) are replaced by the dock rules. Nothing else in the column changes size.

## 5. Acceptance: probe-ready assertions

Run at 360×780, 375×812, 390×844 (portrait), 844×390 (landscape), 1280×720 (desktop). Each state: normal game, boss fight, replay review, Open world, one sheet open, UI scale 100 % and 200 %. Dark and light theme.

1. **No overlap with the board.** For every control (dock, top band, sheet, joystick, replay slider) and every board cell disc: intersection area = 0 px². Except: the sheet open state may cover the board's top and middle only if the sheet is in the closed-band rule (section 3), so it is checked with the same probe.
2. **Targets.** Every dock button, every sheet item, the cog, Goal, Retry, Rematch, the replay controls: `width ≥ 44` and `height ≥ 44` in CSS px.
3. **Dock above the clipboard.** If the clipboard stays bottom-right: `dock.right ≤ clipboard.left` or `dock.bottom ≤ clipboard.top − 8`. After the move (section 4): the clipboard does not overlap the dock: intersection = 0 px².
4. **Dock in the viewport.** `dock.bottom ≤ innerHeight − 16` and `dock.left ≥ 16`, `dock.right ≤ innerWidth − 16` (portrait). In landscape the column: `column.right ≤ innerWidth − 16`, `column.bottom ≤ innerHeight − 16`.
5. **Top band clear of the board.** HUD and boss bar bottoms are at least 8 px above the board band top.
6. **Sheets.** Sheet `bottom ≤ dock.top − 8`, sheet `height ≤ 60 %` of `innerHeight`, scroll works (`scrollHeight > clientHeight` when there are more items).
7. **Keyboard.** Tab reaches every dock button in DOM order. Esc closes an open sheet. Focus returns to the trigger. Computed focus outline width = 2 px.
8. **Labels fit.** Each dock button's `scrollWidth ≤ clientWidth` (no overflow). See the measured failure below.
9. **Scale.** Probes 1–8 pass at UI scale 100 % and 200 %.

Measured failures on the mockup (before the real build):
- Portrait 360 (measured): labels overflow the 44 px buttons (New game, Reset view, Replay, Modes). At 390 the same is likely but not measured. The labels need the 44 px dock to grow in width, or the labels move under icons. **Fails assertion 8.** Proposal: icon above a 10–11 px label is too small for a 44 px target; the owner decides between shorter labels (New game → New, Reset view → View) and a two-row dock (open question 4).
- Landscape 844×390 as a row: dock cut by 29 px and over the board by 6 732 px². **Fails assertion 4 and 1.** Fixed by the column in section 2.
- Desktop and 200 % overlap: not measured on the real game.

## 6. Decisions (owner, 2026-10-31, given to the lead agent in the session)

1. **Clipboard.** Moves into the Settings list as "Copy diagnostics".
2. **Update banner.** A dot on Game modes plus a first row in its sheet.
3. **Dock and UI scale.** The dock stays at 44 px; only the top band grows with `--ui-scale`.
4. **Labels.** Short labels in one row: New, View, Hint, Replay, Modes (assertion 8 must pass at 360 px).
5. **Landscape.** The right-hand column of section 2 is the landscape layout.
6. **Goal.** A sheet above the dock.

## 7. Not done in this spec

- The real HUD height, the real board placement and the joystick size: measure on the build (`layout:check`).
- The Auto-play rules (when it is allowed): unchanged.
- Settings position under the cog: unchanged. Its groups and its scroll are ui.md section 4.11.
- No code, no test, no issue or PR change.
