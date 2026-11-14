import * as THREE from 'three/webgpu';
import init, { Encounter, Engine, Royale, boss_ids, boss_name, boss_takes_build, boss_takes_mirror, engine_version, replay_score, run_exits, run_foes, run_map, world_can_break, world_is_enemy, world_lairs, world_logs, world_pads, world_places, world_teleporters, world_version } from 'edgefall-wasm';
import {
  BOARD_CELLS,
  CELLS,
  cellsFor,
  CORE_CODE,
  DIRECTIONS,
  OVERSEER_CODE,
  RADIUS,
  VANISHED,
  arrowYaw,
  axialTo3D,
  cellIndex,
  encodeMove,
  groupTargets,
  moveForClick,
  parseMoves,
  toggleSelection,
  type Axial,
  type Move,
} from './board';
import { extendPath, releaseDir } from './drag';
import { keyTip } from './touchwording';
import { KEY_DIRS, KEY_HINT, announce, moveFor, nextGroup } from './keyboard';
import { gamepad, nextFocus, type PadAction } from './gamepad';
import { CONSENT_TEXT, PRIVACY_URL, consentNeeded, writeConsent } from './consent';
import { readBoard, sharedHtml, type SharedResult } from './boardfeed';
import { publishResult } from './publish';
import { RankedSeal, parseSeal, type Step } from './rankedseal';
import { BOARD_TEXT, publishAllowed, publishFlag, boardAskNeeded, boardKeys, joinBoard, leaveBoard, newKey, readChoice, readRetires, readBoardName, writeChoice } from './shareboard';
import { GUIDE, guideDue, guideStep, writeGuideSeen, type GuideEvent } from './guide';
import { firstBotMove } from './firstbot';
import { COACH, COLD_OPEN, PRACTICE_BOT, firstRunDue, isPush, markFirstRunDone, nextStep, stepLine, type MatchStep } from './firstrun';
import { openWorldLeads } from './menuorder';
import { doorLocked, existingPlayer, firstWinGame, isLocked, LOCK_BANNER, markFirstWin, paintLocks, UNLOCK_CARD } from './unlock';
import { worldSaves } from './openworldsave';
import { askBot, askEval, BOT_NODES, botBudget, encounterFor, engineFor, WILD_NODES } from './bot';
import { askMirror } from './traitchoice';
import { lazyWorker } from './lazyworker';
import { AUTO_DELAY_MS, autoPlayState } from './autoplay';
import { hasMedal } from './medals';
import { BOT_NOTE, botLine, bossLine, progressBudget, ratingOfBudget } from './botrating';
import { bootFailed } from './bootfail';
import { ScreenExit } from './screenexit';
import { WarmGate, compileWhole, drawEach, halves } from './worldwarm';
import { backWay, needsEntry, type Screen, type Way } from './backnav';
import { EXIT_LABEL, EXIT_NAME, exitOf, type Exit } from './exitslot';
import { bossHtml, goalShown } from './bosshud';
import { goalCardHtml } from './goalcard';
import { drawBossBar } from './bossbar';
import { choirChips, drawChoirChips } from './choirchips';
import { zoomView, boardZoomOn } from './boardzoom';
import { FOV, fitView, framing, isDrag, orbit, pinchScale, resetView, screenView, viewPosition, wheelScale, zoom, type View } from './camera';
import { Entrance, entranceCard } from './entrance';
import { FreeCameraController } from './freecam';
import { RenderModeManager, type RenderMode } from './rendermode';
import { openInEditor } from './editorexport';
import { applyTuning, LEVELS, lightPanel, scalePower, type Level } from './lightpanel';
import { LIGHT_TUNING } from './lighttuning';
import { tubeLights } from './neonlight';
import { accentLights, accentOn, driveAccents, driveSkyGlow, neonSkyGlow, setNeonBloom } from './neonfx';
import { ringLamp } from './ringlamp';
import { CELL_LAYER, instanceCells, instanceMarbles } from './instancedcells';
import sceneOverrides from './sceneoverrides.json';
import { ClusteredLighting } from 'three/examples/jsm/lighting/ClusteredLighting.js';
import { CulledLighting } from './culledlighting';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Diagnostics, copyText, gameInfo, renderCostText, type RenderCost } from './diagnostics';
import { BLOOD_DROPS, BLOOD_MS, bloodAt, bloodStainAt } from './blood';
import { ejectTrack, findEjection, trackAt, type EjectTrack } from './eject';
import { Analyst, evalFill, evalText } from './evalbar';
import { ghostMarbles } from './ghost';
import { MOTION, cue, ghostFade } from './motion';
import { LAST_MOVE_REST, botMoveNote, lastMovePulse, pushedMarbles } from './lastmove';
import { boardAfter, freeMarbles, freeText, landing, parseEchoTell } from './echo';
import { Hint, type Spot } from './hint';
import { crackLeft, crackText, parseCracks, tickOffsets } from './hull';
import { COUNTER_MAX, drawCounter, drawShell, eggGlow, eggText, parseEggs, shellTint } from './alien';
import {
  CHEVRON_COLOR,
  CHEVRON_SHAPE,
  TRAIN_LEAD,
  TRAIN_PARTS,
  chevronSpots,
  knockedMarbles,
  parseTrains,
  passedTrains,
  railSpan,
  reachMs,
  trainAt,
  trainText,
  type Train,
} from './railyard';
import { BUBBLE_SPOT, HAZE_PER_VENT, TAUNTS, burnTrack, burnsPlayer, hazeAt, parseBurns, startsBurningPlayer, tauntIndex, toxinText, ventNote, ventOf, type Burn } from './overseer';
import { ANGRY_HOLD_MS, FAREWELL, TAUNT_HOLD_MS, angryLine, speechAt, type Speech } from './speech';
import { blinkAt, drawAnnounce, drawGlyph, parseAnnounce, parseRepulsions, polarityText, repulsionMoves, type Repulsion } from './magnetizer';
import {
  RIB_SPACING,
  STRIKE_COLOR,
  beforeBelts,
  beltMoves,
  beltSpan,
  beltText,
  blinkAt as strikeBlink,
  chevronSpots as beltChevrons,
  counterSpot as beltCounterSpot,
  fellOff,
  parseBelts,
  parseCarries,
  plateSpots,
  ribOffsets,
  rollerSpots,
  slamAt,
  struckBy,
  type Belt,
  type Belts,
  type Carry,
} from './assembly';
import {
  PULSAR_BOUNDS,
  RIPPLES,
  PULSAR_PARTS,
  PULSE_COUNTER_SIZE,
  SHOCK_COLOR,
  charging,
  chevronSpots as pulseChevrons,
  counterSpot,
  fallen,
  parsePulse,
  parsePulsar,
  rippleAt,
  rippling,
  pulseMove,
  pulseText,
  pulsarSpot,
  shockAt,
  type Pulse,
  type Pulsar,
} from './pulsar';
import {
  CORE_COLOR,
  ENERGY,
  WARN_CHARGES,
  WARN_COLOR,
  burstAt,
  coreText,
  energyGlow,
  fallen as shoved,
  lostCells,
  parseCharges,
  parseCore,
  parseEvents,
  pipOffsets,
  shoveTracks,
  sweepAt,
  wedgeCorners,
  wedgeGlow,
  type Charge,
  type Core,
  type UnstableEvents,
} from './unstable';
import {
  BRIDGE,
  DUAL_AZIMUTH,
  DUAL_CELLS,
  DUAL_POLAR,
  bridgeAt,
  dropAt,
  dualText,
  otherRoom,
  outOfTurn,
  parseDual,
  parseReturn,
  roomTurn,
  type DualState,
} from './dual';
import { BOSS_PROP_PIECES, bossProp } from './bossprops';
import { SWARM_TURNS, evacAt, parseSwarm, swarmText, type SwarmState } from './swarm';
import { ballastText, firedText, parseFired, type Fired } from './ballast';
import { chaplainText, parseCells, previewFlips } from './chaplain';
import { ARMY_NAMES, armiesLeft, choirText, parseArmies } from './choir';
import { BLAST_SHARDS, blastAt, martyrText, parseBlast, parseMartyr } from './martyr';
import { countAttempt, dailyCard, dailyFor, dailyLine, dailySeed, dailyTitle, recordDailyResult, utcDay, type Daily } from './daily';
import { coopFromHash, creatorFromHash, fingerprint, inviteUrl, newRoomId, roomFromHash, royaleFromHash, royaleUrl, bossSeatFromHash, type CoopFight } from './invite';
import { botGameOf, lobbyState, lobbyWaitMs } from './lobby';
import { COOP_SIDE, DUEL_LINE, attemptLine, coopTurn, duelTurn, retryText, seatAfter } from './coop';
import { hookHost, netHook, testHooks } from './hooks';
import { createModeProbe } from './modeprobe';

// The mode-entry probe (#1582): two clock reads per entry; only a test build reads it, through its hooks.
const modeProbe = createModeProbe();
import { hookTransport, p2pTransport } from './p2p';
import { PUBLIC_SEED } from './worldpeers';
import type { Transport } from './transport';
import { endBanner, royaleBanner, type EndAnim } from './endbanner';
import { CountWatch, EdgeWatch, EndWatch, OutWatch, PhaseWatch, SelectionWatch, clickable, turnBack } from './cues';
import { tallyLine, townLine } from './tally';
import { matchLine } from './matchline';
import { readBest as readTrainerBest, recordBest as recordTrainerBest, resultText as trainerResult, MARBLES, FULL_ARMY, drillLine, trainerBudget, waveLine, waveResult } from './trainer';
import { generateKeys, type Keys, type Report } from './moverecord';
import { SIGNALING_TIMEOUT_MS } from './netcounters';
import { beatPeriod } from './coordinator';
import { OnlineSession } from './session';
import { coopStatus, duelStatus, onlineStatus, type OnlineStatus } from './presence';
import { playOnlineState } from './connectivity';
import { rematchText } from './rematch';
import { KICK_MS, REST, kickAt, unkick, type Kick } from './kick';
import { MARBLE_RADIUS, SLIDE_MS, SQUASH_MS, pushedCells, slideAt, slideTracks, squashAt, type SlideTrack } from './slide';
import { fuseDigit, fuseNote, parseFuses, pullTrack, specialCues, type Pull } from './specialcues';
import { carryTurns, cellTurn, inHolder, rolledTurn, turnOf, type Quat } from './orient';
import { flatHudHtml, hudHtml, passNote } from './hud';
import { DEFAULT_SKIN, nextSkin, skinById, type Extra } from './skins';
import { DEFAULT_GLASS_SKIN, glassSkinById, nextGlassSkin } from './glassskins';
import { skinKinds, startOnce } from './skinmaps';
import { neonBreachGeometry, neonEggGeometry, nextToSight, neonLookOn, neonMarbleRim, marbleSheen, neonPedestal, neonShellFor, neonTells, neonVeil, tellLook, targetArrowMaterial, NEON } from './neonlook';
import { TERRACE_VIEW, boardPoints, fitTerrace, hubKit, isDefaultView, mergeByMaterial, tableZeroActive, terraceEnvironment, terraceMaterial, withoutHubStaircase, type HubKit } from './tablezero';
import { MARBLE_LOOK, TONAL, asksSkinMaps, flat, loadsTexture, readLook, tonalMarble } from './look';
import { readDifficulty, writeDifficulty, nextDifficulty, scaleBudget, DIFFICULTY_NOTES, DIFFICULTY_PERCENT, TELL_MODE, type Difficulty } from './difficulty';
import { DEFAULT_RATING } from './elo';
import { toleranceWindow } from './matchmaking';
import { boardHtml, buildBoard, loadRivals, ratingHistory, visitBoard } from './leaderboard';
import { loadRankedProfile, rankedHudHtml, settleRanked1v1, settleRankedRoyale, type RankedMode } from './ranked';
import { archiveList, LEVEL_NAMES, menuOpen, motionReduced, nextDisplay, settingsList, themeAttribute, VOLUME_NAMES, type MenuEvent, type Theme } from './settings';
import { groupSettings } from './settingsgroups';
import { RESET_ASK, eraseAll } from './reset';
import { icon } from './icons';
import { fpsAt, fpsLabel, fpsOf, keepWindow, stampDrawn } from './fps';
import { GpuCost, gpuFrameReader, gpuMetricOf, gpuStatsOn, modeOfScene, type TimedRenderer } from './gpucost';
import { LIGHT } from './light';
import { ROOM_SURFACE, spaceshipArchitecture, spaceshipLights } from './room';
import { createCanvasTexture, drawHazardStripes, drawWallPanel } from './roomart';
import { applyDeckAtmosphere, DECK_ATMOSPHERES, type DeckId, loadSpaceshipBay, meshoptLoader, type SpaceshipBayAssets } from './roomloader';
import { wipe } from './wildwipe';
import { lazyChunk } from './modechunk';
import { OpenWorldHandle } from './openworldhandle';
import { twistOf } from './openworldtwist';
import type { PlaceKind } from './placetransition';
import { BOARD_LOOKS } from './boardlook';
import type { Phase } from './daynight';
import { bindJoystick, heldKeys } from './openworldjoystick';
import { bindHudFold } from './openworldfold';
import { DECK_PARTICLES, deckOf, type Deck } from './deck';
import { actSpaceOf, bossSpaceOf } from './bossspace';
import { AUDIO_LOGS, lineAt, logOf, type AudioLog } from './audiologs';
import { LORE } from './lore';
import { bossEndLine } from './bossends';
import { EPILOGUE, epilogueDue, markEpilogue } from './epilogue';
import { audioDeckOf, bossBlurb, bossLore, entryOf, STORY } from './lorelogs';
import { atStake, claimReload } from './autoreload';
import { collectedLogs, markCollected, markRead, markSeen, readLore, seenLines } from './lorestore';
import { ledgerList, linesIn } from './ledger';
import { catchUp, fire, gated, SEALED, storyStage, type StoryEvent } from './story';
import { drawTerminal, pageAt, TERMINAL, terminalFonts, terminalPages, type TerminalPage } from './terminal';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import {
  drawDue,
  isSoftwareRenderer,
  looksSoftware,
  rendererName,
  ratioFloor,
  ratioFrames,
  drawWanted,
  roomVeiled,
  timeDraw,
  type LastDraw,
  fogSettings,
  hasParticles,
  readClearBoard,
  readFlatHud,
  readHudFolded,
  readBoardZoom,
  writeBoardZoom,
  readFps,
  readReducedMotion,
  readGlassSkin,
  readSafeMode,
  readSkin,
  readMix,
  DEFAULT_LEVELS,
  readLevels,
  readPalette,
  readTheme,
  readTier,
  type Tier,
  readTranscript,
  readSteering,
  writeSteering,
  readUiScale,
  hasReflections,
  hasBloom,
  hasNormalMaps,
  meshDetail,
  offersLowTier,
  RATIO_BACK_START,
  stepRatio,
  readLowOffer,
  slowRun,
  writeLowOffer,
  read,
  write,
  renderPixelRatio,
  smoothEdges,
  writeClearBoard,
  writeFlatHud,
  writeHudFolded,
  writeFps,
  writeReducedMotion,
  writeGlassSkin,
  writePalette,
  writeSafeMode,
  writeSkin,
  writeVolume,
  writeLevel,
  writeTheme,
  writeTier,
  writeTranscript,
  writeUiScale,
} from './quality';
import { nextPalette, paletteById, themeColors, type Palette } from './palettes';
import { limitFlash } from './safe';
import { clampUiScale, maxUiScale, uiScaleFactor, type UiScale } from './uiscale';
import { sceneOf } from './scenes';
import { hubStations, listenerOf, type Listener, type Source } from './stations';
import { AFTER_EJECTION, AFTER_SLIDE, BUSES, Sfx, TellWatch, columnOf, type Bus, type CueEvent, type Tell } from './sound';
import { rimDanger, tensionLevel } from './tension';
import { glassSide, sideName } from './glass';
import { ACCENTS, CORE, GLASS, HEAT, pulseAt, SHELL, type Accent } from './marbles';
import { FRAME, RIM_LIGHT, frameShape, rimHalves, rimLight, type FrameShape, type Point } from './frame';
import { notchRow } from './notches';
import { tallyRow, tallySlots } from './tallymarks';
import { formatScore } from './score';
import { runScoreHtml } from './runhud';
import { cardText, Legend, legendHtml, marksOn } from './specialhelp';
import { bestTurns, loadMedals, medalLabel, medalLine, medalRoom, playerTurns, recordMedal, tallyAttempt, tallyWin, type MedalResult } from './medals';
import { loadProgress, recordWin, saveProgress } from './progress';
import { HUB_CELLS, hubPath, roomAt, step, type Door, type Spot as HubSpot } from './hub';
import { entryConfirmDue, entryName, HUB_COACH, hubCoachDue, hubHelpOn, markEntered, markHubCoachDone, needsConfirm } from './hubcoach';
import { createKitGlyph, type GlyphOptions } from './hubart';
import { HubController } from './controller';
import { noticeBoard } from './hubboard';
import { NO_ARMY, NO_RESOURCES, type Army, type Resources } from './openworldresources';
import { armed as fightArmed, bring, bringRelic, buy as buyMarble, buyRelic, hullKeeps, leave as leaveBrought, leaveRelic, lose, placeBrought, relicsMask, sell, sellRelic, thrownOff, upgrade as upgradeMarble, wildFoes, withoutKinds, type Stock } from './openworldworkshop';
import { workshopHtml } from './workshopview';
import { bossLockLine, labelsHtml, nextGoal, pipsHtml, railHtml } from './hubview';
import { clearStray } from './modeswitch';
import { indexedDbStore } from './idb';
import { LocalSaves, type LocalGame } from './savegame';
import { LEGACY_UNLOCKED, readUnlocked, recordUnlocked } from './collector';
import { undoAllowed, undoLength } from './undo';
import { engineAt, replayKey, replayLabel, stepPly, type ReplayStep } from './replay';
import { CONFIRM_MS, newGameLabel, pressNewGame, quickGameHidden, type Confirm } from './newgame';
import { gameFileName, gameFileText, readGameFile } from './gamefile';
import {
  actBoss,
  chooseAscension,
  actsWon,
  BIOMES,
  biomeOf,
  buy,
  chooseCommander,
  chooseExit,
  currentBiome,
  runCue,
  exitHtml,
  claim,
  clearRun,
  dailyRun,
  choices,
  collect,
  collectorHtml,
  leaveCollector,
  eventHtml,
  drink,
  leaveShop,
  fightBudget,
  runNodes,
  armyKept,
  fightOver,
  bonusHtml,
  movesLine,
  takeBonus,
  foePlan,
  left,
  loadRun,
  MAP_VERSION,
  scrollMap,
  mapHtml,
  newRun,
  parseMap,
  parseSpecials,
  place,
  placeHtml,
  placing,
  PLUS_INK,
  PLUS_POINTS,
  readAscension,
  readBest,
  readRunes,
  recordAscension,
  recordBest,
  recordRunes,
  resolve,
  rest,
  restHtml,
  affinityBarHtml,
  relicBarHtml,
  scrollHtml,
  takeScroll,
  relicHtml,
  relicMask,
  removeSpecial,
  rewardHtml,
  runLine,
  saveRun,
  shopHtml,
  sparkBurst,
  SPECIAL_LOOKS,
  claimTactic,
  tacticBarHtml,
  tacticRecord,
  takeKey,
  takeRelic,
  upgrade,
  useTactic,
  visit,
  type MapNode,
  type Run,
  bankedTownLine,
} from './roguelite';
import { bookHtml, compendiumHtml, finished, historyHtml, ranRun, readDaily, readHistory, readSeen, recordFinished, recordSeen, startDailyTry } from './runbook';
import { ARENA, ARENA_SCALE, YOU, deadlineText, loadRoyale, nextRound, outSeats, parseLog, roundOrders, royaleHtml, seatAt, standings, type RoyaleFile } from './royale';
import { buildReveal, shownAt, sinkAt, type Fall, type Reveal } from './royale-reveal';
import type { RoyaleNet } from './royale-net';
import { SEAT_GLYPHS, SEAT_INK, SEATS } from './marbles';
import './ui.css';

import { BONE, clearDrawn, COLORS, FRAME_LOOK, SceneRenderer } from './scene';
import { visibleCells } from './stalker';
const BOT_SIDE = 2; // the human plays side 1 (the glass), the bot plays side 2
declare const __BUILD__: string; // the commit, set by vite.config.ts

// Net state changes, refused moves, desyncs and bot search times, kept in memory for Copy diagnostics (#220).
const diag = new Diagnostics(() => performance.now(), console);

// Offline app (#193): the production build registers the service worker that scripts/offline-app.mjs writes (at the
// end of this file), the dev server none. A new build that takes over this page leaves it the files of its own build
// (offline.ts keeps the previous cache), and New version offers the reload that runs the new build whole. Listened
// to before the first await: the new build can take over while this page is still loading.
const serviceWorker = import.meta.env.PROD && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
const updateButton = document.getElementById('update') as HTMLButtonElement;
updateButton.addEventListener('click', () => location.reload());
if (serviceWorker) {
  const updating = serviceWorker.controller !== null; // a first install takes control, it is no update
  serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updateButton.hidden = false;
    // The page reloads by itself as soon as nothing is at stake, once per build (#1437); the button stays meanwhile.
    const reloadWhenFree = (): void => {
      if (stakeNow()) return;
      clearInterval(waiting);
      if (claimReload(() => sessionStorage, __BUILD__)) location.reload();
    };
    const waiting = setInterval(reloadWhenFree, 1000);
    reloadWhenFree();
  });
}
let stakeNow = (): boolean => true; // set at the end of the start, when the game's state exists: until then nothing reloads

document.getElementById('boot-reload')!.addEventListener('click', () => location.reload());
await init().catch(bootFailed);
let engine: Engine | Encounter = new Engine();
// Replay (#793): while set, `engine` is the position after `ply` moves of the move log, rebuilt by replaying the log on a
// new engine, and `live` is the game itself, put back in place by Live or by any move that arrives.
let replaying: { live: Engine | Encounter; ply: number } | null = null;
// Encounter mode: the boss and seed of the running fight, kept so Retry restarts the same one. A daily
// fight also keeps its UTC day and its attempt of that day (#195).
// The Goal control (#248): the HUD shows the boss goal before the first move, then only while it is open.
const goalButton = document.getElementById('boss-goal') as HTMLButtonElement;
// The Goal sheet (#1032): the goal text above the dock while the Goal control is open, one sheet at a time.
const goalSheet = document.getElementById('goal-sheet')!;
let goalOpen = false;
const closeGoal = (): void => {
  if (!goalOpen) return;
  goalOpen = false;
  hud();
};
let locked = false; // the first-win lock (#1665, unlock.ts): on for a new player until the first win against the bot
let fight: { id: string; seed: number; daily?: { day: string; attempt: number }; mirror?: boolean } | null = null; // mirror: the player's trait brought in (#1620)
let hub: HubController | null = null;
let wildFrom: { seed: number; home: Axial; phase: Phase; placed: number[][]; relics: number[] } | null = null; // the Open world marble that started the wild fight (#1511): the world, the cell it starts on, and the phase it was met in, and the special marbles of the army placed on its side (#1655)
const PULSAR_DOCK = 1.2; // the near pylons are fitted 20 % further out on the terrace, so the dock does not cover them (#1374)
const activeRadius =(): number => (fight?.id === 'ballast' ? 5 : 4);
// The view a fight opens on: the whole board of its radius (#573), drawn back in a Pulsar fight until every pulsar and
// its counter fit the window too (#691). The Dual Room's (#947) looks along its void, the two rooms
// side by side, drawn back until both fit. The board's centre sits in the middle of the window: the HUD plate folds (#957).
const DUAL_POINTS = DUAL_CELLS.flatMap(([q, r]) => [0, 0.5].map((y) => ({ ...axialTo3D(q, r), y }))); // the cells and their marbles' tops
// The hub and the royale on the terrace are framed from the Blender camera (lights_camera.json), drawn back until their cells and props are on the window (#1374).
const HUB_POINTS = boardPoints(HUB_CELLS, 1, [0, 0.6]);
const ROYALE_POINTS = boardPoints(ARENA, ARENA_SCALE, [0, 0.4]);
const BALLAST_POINTS = boardPoints(cellsFor(5), 1, [0, 0.5]);
const RUN_POINTS = boardPoints(CELLS, 1, [0, 0.5]);
const DUAL_BOARD_POINTS = boardPoints(DUAL_CELLS, 1, [0, 0.5]);
const blenderBoard = (): boolean => fight?.id === 'ballast' || fight?.id === 'dual' || (run !== null && !fight); // the boards framed like the hub's (#1374)
const terraceFramed = (): boolean => tableZeroActive({ room: keepRoom, ready: terraceReady });
const fightView = (): View => {
  if (hub && terraceFramed()) return fitTerrace(HUB_POINTS, innerWidth < innerHeight ? 3.4 : 3.6, innerWidth, innerHeight);
  if (royale && terraceFramed()) return fitTerrace(ROYALE_POINTS, 4, innerWidth, innerHeight);
  if (terraceFramed() && blenderBoard()) return fitTerrace(fight?.id === 'ballast' ? BALLAST_POINTS : fight?.id === 'dual' ? DUAL_BOARD_POINTS : RUN_POINTS, activeRadius(), innerWidth, innerHeight);
  if (hub) return resetView(innerWidth < innerHeight ? 3.4 : 3.6); // the hub's deck plan (#1249): its 37 cells and their plates, a little closer than a board, closer still upright
  if (fight?.id === 'pulsar') return fitView(resetView(), sceneRenderer.terraceOn ? PULSAR_BOUNDS.map((p) => (p.z > 0 ? { ...p, z: p.z * PULSAR_DOCK } : p)) : PULSAR_BOUNDS, innerWidth, innerHeight);
  if (fight?.id === 'dual') return fitView({ ...resetView(), azimuth: DUAL_AZIMUTH, polar: DUAL_POLAR }, DUAL_POINTS, innerWidth, innerHeight);
  return resetView(activeRadius());
};
// The view last set by a fight start or Reset view (#696): while it is still the view, the player has not moved the
// camera himself and a new window size fits it again. Once he orbits or zooms, his view stays until Reset view.
let fitted: View | null = null;
const makeGame = (): Engine | Encounter => (fight ? encounterFor(Encounter, fight.id, fight.seed, run?.state.placed, run ? relicMask(run.state) : undefined, fight.mirror) : trainer ? Engine.trainer(trainer.wave, MARBLES - trainer.lost) : new Engine());
// The battle royale (#502) while it is on, else null.
let royale: Royale | null = null;
// The rogue-lite run (#798) while it is on, else null: its map and where it stands.
let run: { map: MapNode[]; state: Run } | null = null;
// The Trainer run (#1159) while it is on, else null: the wave being played.
let trainer: { wave: number; lost: number } | null = null; // `lost`: the marbles of the run's pool lost before this wave
// The special marble type a press on one of the army's marbles places before a fight (#961), 0 for none.
let armed = 0;
// Whether the Swap tactic is picking the army's two marbles (#1460): the first one is the selection.
let swapping = false;
// Whether the fight on carries the army's build (#1494): a run's army fight, or an act boss that takes it (special marbles, relics, tactics).
const built = (): boolean => (run !== null && (engine instanceof Engine || engine.takes_build())) || ((wildFrom ?? lairFrom)?.placed.length ?? 0) > 0; // the army's marbles are on the board: a run's fight, or a wild or lair fight of the world that brought some (#1655)
// Its rounds when it is an online one (#504), and the interval that lets their deadlines pass.
let royaleNet: RoyaleNet<Royale> | null = null;
let ticking = 0;
// A player's page draws only when something asked for a frame (#848, quality.ts drawWanted): `dirty` counts the draws a
// change of the picture still needs, two since the bloom blurs every second draw (scene.ts, #894). Any input may change
// it (a hover, an orbit, a slider, a resize that clears the canvas).
const CHANGE_DRAWS = 2;
let dirty = CHANGE_DRAWS;
// The page is booting (#1628): its top-level awaits yield, and a promise callback that runs in that window (a terrace load, a press
// on a button already live) reaches refresh() before the lets declared further down are initialised. refresh() returns until
// `booted` is set, right after the last declaration, before the boot's final refresh.
let booted = false;
let bootEnded!: () => void;
const bootEnd = new Promise<void>((done) => (bootEnded = done)); // a test hook that loads a game waits for it (#1625)
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'wheel', 'keydown', 'keyup', 'input', 'change', 'click', 'resize'])
  addEventListener(type, () => (dirty = CHANGE_DRAWS), { capture: true, passive: true });

// ?backend=webgl forces the WebGL2 backend, anything else lets three pick WebGPU first.
const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl';

const store = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
catchUp(store, loadMedals(store)); // the medals of a player who played before the story fire their boss moments (#1584)
/** Records what happened in the game for the story (story.ts, #1584): the stage may rise, and the lore held back opens. */
const storyEvent = (event: StoryEvent): number => fire(store, event);
/** Files the story lines of the Ledger that `text` holds as seen (#1585): called wherever a line reaches the player. Only ids are saved. */
const sawLines = (text: string): void => linesIn(text).forEach(({ id }) => markSeen(store, id));
let skin = readSkin(store); // the dark shell skin (#377), skins.ts, declared before the first wave: its maps start with it (#925)
let glass = readGlassSkin(store); // the pale glass skin (#377), glassskins.ts
const tonal = readLook(location.search, store) === 'tonal'; // the Fluent x Material look (#1138, look.ts): no board, cell or skin map
// The room is not shown to a player any more (#1374): `?scene=room` is honoured under automation (`navigator.webdriver`, the e2e
// build) and in a dev build, so the room specs and its code live on. A production page ignores it.
const keepRoom = (navigator.webdriver || import.meta.env.DEV) && new URLSearchParams(location.search).get('scene') === 'room';
const WILD_KEY = 'ab-alone.wild'; // the world of a wild fight under way, so a reload puts the player back in it
const openWorldParam = (new URLSearchParams(location.search).get('openworld') ?? '').trim();
// A page that opens in the Open world (a link with ?openworld, or a reload during a wild fight, #1511) asks for the files of the board, the
// bay and the terrace (620 KB), when the world is left for a fight or the ship (loadBoard, #1520); any other page asks at the load.
const bootsInWorld = openWorldParam !== '' || Boolean(read(store, WILD_KEY));
// Reduced motion (#379): the setting of the menu once pressed, else the system's prefers-reduced-motion, read live.
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let savedMotion = readReducedMotion(store);
let flatHud = readFlatHud(store); // the flat HUD fallback (#391): every game-critical value as text on the plate
let steering = readSteering(store); // the Open world steering (#1137), on by default
let transcriptOn = readTranscript(store); // the audio log transcript (#516), on by default
const reducedMotion = (): boolean => motionReduced(motionQuery.matches, savedMotion);
let tier = readTier(store, {
  cores: navigator.hardwareConcurrency,
  memory: (navigator as { deviceMemory?: number }).deviceMemory,
  reducedMotion: reducedMotion(),
});
const queryQuality = new URLSearchParams(location.search).get('quality');
if (queryQuality === 'high' || queryQuality === 'low') {
  tier = queryQuality;
  writeTier(store, tier);
}
// Textures ship as KTX2, encoded from client/textures/ by scripts/ktx2-textures.mjs (#700). KTX2Loader transcodes each
// one to a format the GPU reads, which it asks the renderer: the renderer comes up first. Its transcoder is a file of
// the build (a hashed asset, like the wasm), so the offline app has it. A failed load keeps the flat fallback look.
// No MSAA on a desktop (#857): with the clustered lights it cost 27 FPS against 108 at a ratio of 1. FXAA ends the
// post-process pipeline instead (scene.ts). A touch screen keeps MSAA (#868): a phone draws 1.5 on a 2.6 to 3x screen,
// which shows the steps, and its tiled GPU resolves MSAA in tile memory. Fixed when the renderer is made.
// The GPU frame cost (#1581) is read from timestamp queries, only with ?gpustats (dev): off for a player, no query made.
const gpuOn = gpuStatsOn(location.search);
const renderer = new THREE.WebGPURenderer({ antialias: matchMedia('(pointer: coarse)').matches, forceWebGL, trackTimestamp: gpuOn });
// The render cost (#851) is the last drawn frame's. three zeroes `info` before every animation frame, so a still frame,
// which draws nothing, would read 0 draw calls: the counts are zeroed by hand before each real draw instead (#1245).
renderer.info.autoReset = false;
await renderer.init().catch(bootFailed);
const gpu = new GpuCost(gpuOn && renderer.hasFeature('timestamp-query'), gpuMetricOf(renderer.backend as TimedRenderer['backend']));
// One drawn frame's GPU time, read a frame later (three resolves the queries asynchronously) into the window of its mode:
// its span on WebGPU, from the first pass start to the last pass end (#1645).
const gpuFrame = gpuFrameReader(renderer as unknown as TimedRenderer, gpu);
const gpuText = (fps: string, mode: string): string => (gpuOn ? `${fps}\n${gpu.text(mode)}` : fps);
Object.defineProperty(window, '__gpuCost', { configurable: true, get: () => gpu.snapshot() });
// A machine with no GPU (#1483): the renderer says so, or the first frames do (endWindow). It takes the low tier unless the player
// stored one, and the Open world lays the ground in view only. `?software=on` or `off` forces it, for the browser checks.
const softwareParam = new URLSearchParams(location.search).get('software');
let software = softwareParam === null ? isSoftwareRenderer(rendererName(renderer.backend)) : softwareParam === 'on';
document.body.dataset.software = software ? 'on' : 'off';
tier = readTier(store, { cores: navigator.hardwareConcurrency, memory: (navigator as { deviceMemory?: number }).deviceMemory, reducedMotion: reducedMotion(), software });
// The neon tubes' rows of short lights (neonlight.ts) cost little when each pixel only adds the lights that reach it:
// clustered (Forward+) lighting, 4x the frame rate of a rect light per tube. It needs compute shaders, so WebGPU only:
// WebGL adds every light at every pixel, the same light at a higher cost (#882).
const clustered = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
renderer.lighting = clustered ? new ClusteredLighting() : new CulledLighting();
const loader = new KTX2Loader().detectSupport(renderer);
// The bay's model and maps are requested here, with the first maps below, not after the skins (#925): the room is ready
// as soon as the scene is. mountBay takes them when the scene exists. The terrace draws no bay, its walls, grates and deck maps
// are the room's: they are asked for under `?scene=room` only (#1370).
let bayRequest: ReturnType<typeof loadSpaceshipBay> | undefined;
const bayLoad = (): ReturnType<typeof loadSpaceshipBay> => (bayRequest ??= loadSpaceshipBay(`${import.meta.env.BASE_URL}assets/pbr/`, undefined, keepRoom ? loader : null, hasNormalMaps(tier)));
if (!bootsInWorld) bayLoad();
async function loadTexture(name: string, srgb: boolean, tiled: boolean): Promise<THREE.Texture | null> {
  if (!loadsTexture(tonal ? 'tonal' : 'pbr', name, keepRoom)) return null; // the terrace draws no board or plate (#1370)
  if (/-normal\.ktx2$/.test(name) && !hasNormalMaps(tier)) return null; // the low tier fetches and draws no normal map (#849)
  try {
    const t = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/${name}`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (tiled) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  } catch {
    return null;
  }
}
// The cells' albedo and normal map of each deck (#401, #440), loaded the first time a mode starts on that deck:
// a page that stays at the Mess loads the Mess one only.
const deckMaps = new Map<Deck, Promise<THREE.Texture | null>>();
const deckMap = (name: Deck): Promise<THREE.Texture | null> => {
  if (!deckMaps.has(name)) deckMaps.set(name, loadTexture(`deck-${name}.ktx2`, true, true));
  return deckMaps.get(name)!;
};
const deckNormalMaps = new Map<Deck, Promise<THREE.Texture | null>>();
const deckNormalMap = (name: Deck): Promise<THREE.Texture | null> => {
  if (!deckNormalMaps.has(name)) deckNormalMaps.set(name, loadTexture(`deck-${name}-normal.ktx2`, false, true));
  return deckNormalMaps.get(name)!;
};
// The deck set (#1603, 60 KB): a page that opens in the Open world asks for it at the first board draw (loadBoard), not at the entry;
// the other pages ask for it at the load, as ever. Until it is asked for, the steel, the plate, the rim and the crack are built flat.
const deferDeck = bootsInWorld && !keepRoom;
let deckSetAsked = !deferDeck;
const atBoot = <T>(load: () => Promise<T | null>): Promise<T | null> => (deferDeck ? Promise.resolve(null) : load());
// The worn skins' maps (#377, #925) are asked for in this tick, with the first maps: a skin's material is made later, with
// the scene, and takes these requests. Key 1 is the enemy shell, key 2 the player's marble (marbles.ts): the skins of
// skins.ts and glassskins.ts, ambientCG PBR materials (CC0), opaque and in their own colours. The maps are square and turn
// once round the sphere, whose circumference is twice the way from pole to pole.
// The default skins, drawn on the terrace by its own marbles (#1314): their maps are asked for when the room opens only (#1370).
const TERRACE_SKINS: readonly string[] = [DEFAULT_SKIN, DEFAULT_GLASS_SKIN];
const SKIN_MAPS = {
  albedo: ['map', true],
  normal: ['normalMap', false],
  roughness: ['roughnessMap', false],
  metalness: ['metalnessMap', false],
  ao: ['aoMap', false],
  emission: ['emissiveMap', true],
} as const;
const skinMapLoads = new Map<string, Promise<THREE.Texture | null>>();
const skinMap = (asset: string, kind: keyof typeof SKIN_MAPS, tile: number): Promise<THREE.Texture | null> =>
  startOnce(skinMapLoads, `${asset}-${kind}`, () =>
    loadTexture(`pbr/skin-${asset}-${kind}.ktx2`, SKIN_MAPS[kind][1], true).then((map) => {
      map?.repeat.set(tile, tile / 2);
      return map;
    }),
  );
for (const s of [skinById(skin), glassSkinById(glass)]) if (asksSkinMaps(keepRoom, s.id, TERRACE_SKINS)) for (const kind of skinKinds(s.extra)) skinMap(s.asset, kind, s.tile);
let [
  deckAlbedo,
  deckRoughness,
  backdrop,
  crackDecal,
  firstDeckMap,
  firstDeckNormal,
  plateAlbedo,
  plateRoughness,
  plateNormal,
  rimAlbedo,
  rimRoughness,
  rimNormal,
  messRoughness,
  plateMetalness,
] = await Promise.all([
  atBoot(() => loadTexture('deck-albedo.ktx2', true, true)),
  atBoot(() => loadTexture('deck-roughness.ktx2', false, true)),
  loadTexture('backdrop.ktx2', true, false),
  atBoot(() => loadTexture('crack-decal.ktx2', false, false)),
  atBoot(() => deckMap(deckOf('local'))), // a page opens at the Mess
  atBoot(() => deckNormalMap(deckOf('local'))),
  // The board plate: brushed aluminium, ambientCG Metal051A (CC0), large swirls.
  loadTexture('pbr/board-albedo.ktx2', true, true),
  loadTexture('pbr/board-roughness.ktx2', false, true),
  loadTexture('pbr/board-normal.ktx2', false, true),
  loadTexture('pbr/plate-albedo.ktx2', true, true),
  loadTexture('pbr/plate-roughness.ktx2', false, true),
  loadTexture('pbr/plate-normal.ktx2', false, true),
  // Concrete036's own roughness for the Mess cells (the shared one is rougher), Metal051A's metalness for the plate.
  atBoot(() => loadTexture('deck-mess-roughness.ktx2', false, true)),
  loadTexture('pbr/board-metalness.ktx2', false, true),
]);

if (plateAlbedo) {
  plateAlbedo.wrapS = plateAlbedo.wrapT = THREE.RepeatWrapping;
  plateAlbedo.repeat.set(0.15, 0.15);
}
if (plateRoughness) {
  plateRoughness.wrapS = plateRoughness.wrapT = THREE.RepeatWrapping;
  plateRoughness.repeat.set(0.15, 0.15);
}
if (plateNormal) {
  plateNormal.wrapS = plateNormal.wrapT = THREE.RepeatWrapping;
  plateNormal.repeat.set(0.15, 0.15);
}

const neonLook = neonLookOn(location.search); // the default look (#1424), `?look=terrace` for the old one: the circuit slab, colours and light; never stored
if (neonLook) document.body.dataset.look = 'neon'; // the style sheet's own hooks for the look
const neonTell = tellLook(neonLook); // the sizes of the bosses' tells: the look's thick ones, or the game's own
const sceneRenderer = new SceneRenderer({
  renderer,
  neon: neonLook,
  backdrop,
  deckAlbedo,
  deckRoughness,
  firstDeckMap,
  firstDeckNormal,
  plateAlbedo,
  plateRoughness,
  plateNormal,
  plateMetalness,
  rimAlbedo,
  rimRoughness,
  rimNormal,
  tonal,
  bloom: hasBloom(tier),
});
await sceneRenderer.init().catch(bootFailed);
const {
  scene,
  camera,
  backend,
  fogObj,
  plate,
  rim,
  roomDeck,
  propsGroup,
  notches,
  tallies,
  marbles,
  ghosts,
  arenaMarbles,
  particles,
  particlePositions,
  particleGeometry,
  particlePositionAttr,
  particleMaterial,
  grooveGeometry,
  scratchGeometry,
  thresholdGeometry,
  thresholdMarkGeometry,
  grooveMaterial,
  scratchMaterial,
} = sceneRenderer;

// The room as the marbles see it (#864): the scene once the bay and its lamps are in, taken from above the middle of the
// board, which the marbles do not hide.
function prefilteredBay(): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(sceneRenderer.scene, 0.04, 0.1, 100, { position: new THREE.Vector3(0, 1.5, 0) }).texture;
  pmrem.dispose();
  return texture;
}
// Fog and vignette follow the quality tier, clear-board switches both off (docs/specs/tech.md 5.1).
diag.log.log('info', 'start', { backend, tier });

// Reflections (#376, #424): the bay, prefiltered once it has loaded (mountBay), for the marble materials on high tier only.
// Omitted on low tier and under automation to save WebGL2 fill rate and PMREM prefilter cost (#416, #424).
let reflections: THREE.Texture | null = null;

// The whole board fits the window, held upright too, centred (#1387).
function frameCamera(): void {
  sceneRenderer.frameCamera(innerWidth, innerHeight);
}
frameCamera();
let view = resetView();
// The entrance beat of a boss fight (#1551, replaces the lair push-in of #1519): the camera eased from the boss's side into `view`, the light rising from dark,
// a card with the boss and its deck; ended by its time or the first press or key. A page under automation has none unless it asks with ?entrance (as ?locks).
const entrance = new Entrance();
const entranceAsked = !navigator.webdriver || new URLSearchParams(location.search).has('entrance');
const entranceBox = document.getElementById('boss-entrance')!;
// The terminal reader (#512): while the player reads the deck console, the view to go back to, else null.
let reading: View | null = null;
const consoleDef = spaceshipArchitecture(tier).find((p) => p.id === 'console-screen')!; // in every tier (room.ts)
function updateFog(): void {
  dirty = CHANGE_DRAWS;
  sceneRenderer.fogRadius = fogRadius;
  sceneRenderer.updateFog(tier, clear, view, fogRadius, deck);
}

// The closer board view of a phone held upright (#1567), a one-tap choice kept per device: a fixed camera over the board, on the
// boards of 61 cells only. The hub, the royale, the Open world, the reader and the fights with props off the board keep their views.
let boardZoom = readBoardZoom(store);
const boardZoomButton = document.getElementById('board-zoom') as HTMLButtonElement;
const boardZoomHere = (): boolean => booted && !hub && !royale && !openWorld.active && !reading && !['pulsar', 'dual', 'ballast'].includes(fight?.id ?? '') && boardZoomOn(true, innerWidth, innerHeight);
const boardZoomShown = (): boolean => boardZoom && boardZoomHere();
/** The beat of boss `id` starts now, for a fight that begins (a fight that comes back from a reload has none); the caller draws the view. */
function beginEntrance(id: string): void {
  entrance.start(performance.now(), entranceAsked ? bossSpaceOf(id) : null, reducedMotion());
  if (!entrance.active) return;
  const card = entranceCard(boss_name(id)!, deckOf('boss', id));
  document.getElementById('boss-entrance-name')!.textContent = card.name;
  document.getElementById('boss-entrance-deck')!.textContent = card.deck;
}
/** The light, the card and the marker of the beat at this frame: the beat ends here once its time is over. */
function syncEntrance(now: number): void {
  entrance.step(now);
  sceneRenderer.setEntranceLight(entrance.light(now));
  entranceBox.hidden = !entrance.active;
  if (entrance.active) document.body.dataset.entrance = entrance.name; // read by the e2e tests
  else delete document.body.dataset.entrance;
}
// The touch preview of an arrow (#1679, tapPreview below): declared here because applyView, which drops it, runs early.
let previewed: { cell: Axial; key: string; engine: object; plies: number } | null = null;
let tapHover = false; // the hover was set by a tap, not a mouse
const tapPlay = Object.assign(document.createElement('div'), { id: 'tap-play', hidden: true, textContent: 'Play' });
document.body.append(tapPlay);
const selectionKey = (): string => selected.map((c) => c.join(',')).join(';');
function applyView(): void {
  if (previewed) dropPreview(); // the camera moved: the Play pill would stay at its old pixels (#1679)
  dirty = CHANGE_DRAWS;
  syncEntrance(performance.now());
  if (freeCam.active) {
    updateFreeCamCamera();
    return;
  }
  sceneRenderer.fogRadius = fogRadius;
  sceneRenderer.applyView(boardZoomShown() ? zoomView(innerWidth, innerHeight) : (entrance.frame(view, performance.now()) ?? view), sceneRenderer.terraceOn ? null : reading, { tier, clear, deck, consoleDef }); // the room's screen is not framed on the terrace (#1369)
  placeHubLabels();
  boardZoomButton.hidden = !boardZoomHere();
}
// The hub's deck plan (#1249): the label plates over the rooms, the lift-shaft rail and the boss pips, shown in the hub only.
const hubPlan = document.getElementById('hub-plan')!;
const hubLabels = document.getElementById('hub-labels')!;
const hubBoard = document.getElementById('hub-board')!;
// The Workshop (#1655, docs/specs/openworld.md section 19.2): a sheet of the Hub of a town of the Open world, where the special marbles are bought, sold and chosen for the wild fights.
const workshopOpen = document.getElementById('workshop-open') as HTMLButtonElement;
const workshop = document.getElementById('workshop')!;
const workshopBody = document.getElementById('workshop-body')!;
let workshopStock: Stock | null = null; // the stock of the world on show, read from its save when the sheet opens
/** Puts the plates back on their cells: the camera moved, or they were drawn again. */
function placeHubLabels(): void {
  hub?.placeLabels(hubLabels, (q, r) => sceneRenderer.cellToScreen(q, r, innerWidth, innerHeight));
}

const freeCam = new FreeCameraController();
const renderModeManager = new RenderModeManager();
let renderMode: RenderMode = 'normal';

function updateFreeCamCamera(): void {
  sceneRenderer.camera.position.set(freeCam.position.x, freeCam.position.y, freeCam.position.z);
  const target = freeCam.getLookTarget();
  sceneRenderer.camera.lookAt(target.x, target.y, target.z);
  sceneRenderer.camera.updateMatrixWorld();
  drawAsked = true;
}

/** The free camera on (from where the camera is, facing `at`: the board's middle, or a light of ?lights) or off. */
function toggleFreeCam(enabled?: boolean, at: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): void {
  const shouldEnable = enabled !== undefined ? enabled : !freeCam.active;
  if (shouldEnable) {
    const curPos = sceneRenderer.camera.position;
    const forwardX = at.x - curPos.x;
    const forwardY = at.y - curPos.y;
    const forwardZ = at.z - curPos.z;
    const horizDist = Math.hypot(forwardX, forwardZ);
    const yaw = Math.atan2(-forwardX, -forwardZ);
    const pitch = Math.atan2(forwardY, Math.max(0.001, horizDist));
    freeCam.enable(curPos, yaw, pitch);
    updateFreeCamCamera();
  } else {
    freeCam.disable();
    applyView();
  }
  paintMenu(); // the Free camera item's pressed state (#938)
}

function setRenderMode(mode: RenderMode): void {
  renderMode = mode;
  renderModeManager.setMode(sceneRenderer.scene, mode);
  paintMenu();
  drawAsked = true;
}

function cycleRenderMode(): RenderMode {
  renderMode = renderModeManager.cycle(sceneRenderer.scene);
  paintMenu();
  drawAsked = true;
  return renderMode;
}
let clear = readClearBoard(store);
const forceParticles =
  new URLSearchParams(location.search).get('particles') === 'on' ||
  new URLSearchParams(location.search).get('particles') === '1';
// The deck in play (#400): its light and fog. A page opens on a local game, hot-seat or against the bot, at the Mess.
let deck: Deck = deckOf('local');
// The theme (#317): System follows the system setting, Dark and Light set data-theme (index.html sets it before the first paint).
let theme: Theme = readTheme(store);
let palette: Palette = readPalette(store); // the colorblind palette (#381), palettes.ts
let difficulty: Difficulty = readDifficulty(store); // the AI and boss difficulty (#704), difficulty.ts
// The FPS readout (#426): off by default. Off, the frame loop only checks the flag; on, it keeps the last frame stamps.
let fpsOn = readFps(store) || gpuOn; // the GPU readout (#1581) rides in the FPS box
let fpsStamps: number[] = [];
let lastFps = 0;
function applyTheme(): void {
  const value = themeAttribute(theme);
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}
// Photosensitivity safe mode (#380), on by default, and the UI scale (#382): one custom property on the root, which
// the HUD and the settings menu read (ui.css). The board does not scale.
let safe = readSafeMode(store);
let uiScale: UiScale = clampUiScale(readUiScale(store), maxUiScale(innerWidth, innerHeight));
function applyUiScale(): void {
  document.documentElement.style.setProperty('--ui-scale', uiScaleFactor(uiScale));
}
applyUiScale();
// Safe mode (#380) caps the one flashing effect, the end-of-game light: its peak and duration are custom properties
// that ui.css reads. The win light pulses once in 1.6 s (0.625 a second), under the 3 a second cap.
const applySafe = (): void => {
  const light = limitFlash({ rate: 1 / 1.6, amplitude: 1 }, safe);
  document.documentElement.style.setProperty('--end-peak', String(light.amplitude));
  document.documentElement.style.setProperty('--end-duration', `${1 / light.rate}s`);
};
applySafe();
// The sounds (docs/specs/world.md section 7) through four buses, each with its volume slider in the menu (#438). The
// audio context waits for a user gesture: browsers block audio before one. A mouse press or a key is a gesture on the
// way down, a touch on the way up, and moving a slider up from 0 starts it too (setVolume).
const sfx = new Sfx(() => (typeof AudioContext === 'undefined' ? null : new AudioContext()), readMix(store, navigator.webdriver), Math.random);
// The sound twin of each boss tell (#358), only when the tell appears or changes. The cues played, read by the e2e tests.
const tells = new TellWatch();
const tellCues: Tell[] = [];
function tellSound(tell: Tell, marks: readonly unknown[]): void {
  if (!tells.changed(tell, marks)) return;
  const cue = sfx.tell(tell);
  if (cue) tellCues.push(cue);
}
// The cues of world.md section 7 (#1570): which event plays which cue is cues.ts, the cues played are read by the tests
// (`__cues`). A win, a loss and a phase change wait for the toll or clack of the ejection that caused them.
const cueWatch = {
  end: new EndWatch(), phase: new PhaseWatch(), out: new OutWatch(), reward: new EdgeWatch(),
  selection: new SelectionWatch(), shop: new EdgeWatch(), relics: new CountWatch(), round: new CountWatch(),
};
const cuesPlayed: CueEvent[] = [];
function playCue(event: CueEvent, after = 0): void {
  if (sfx.cue(event, after)) cuesPlayed.push(event);
}
document.addEventListener('click', (e) => {
  if (clickable(e.target)) playCue('click'); // one place for every button; the board is a canvas and the map has its own pick
});
// The end of the game on the plate sounds once, never while the Replay is open: the live game's end sounds when it is back.
function endCue(game: unknown, anim: EndAnim, after: number): void {
  const heard = cueWatch.end.fresh(game, anim, fight !== null); // the win of a boss fight is the boss death
  if (heard) playCue(heard, after);
}
// The frame's radius, for the fog that starts at its edge (#399): drawFrame sets it.
let fogRadius = RADIUS;
let drawProps: () => void = () => {};

function updateParticles(): void {
  sceneRenderer.updateParticles(tier, clear, reducedMotion(), navigator.webdriver, forceParticles, deck);
}

// The adaptive resolution (#843): the look and a new window size set the pixel ratio, then a player's slow
// frames step it down (quality.ts nextPixelRatio), every RATIO_FRAMES frames. Shown on the page for the tests.
const RATIO_FRAMES = 30;
let pixelRatio = 1;
let frameTimes: number[] = [];
let lastFrame = performance.now();
let ratioBack = RATIO_BACK_START; // the step back up (#1580): its judgement carries across the windows
function setPixelRatio(ratio: number): void {
  pixelRatio = ratio;
  frameTimes = [];
  dirty = CHANGE_DRAWS;
  renderer.setPixelRatio(ratio);
  document.body.dataset.ratio = String(ratio);
}
// The low tier offer (#849): a sustained slow rate (quality.ts slowRun) offers the low tier once per page view, as a quiet
// note with Accept and Dismiss, shown at a quiet moment only: no move animation, no online game or Battle royale.
let lowRun = 0;
let softwareJudged = software; // a renderer that says it is software needs no judging
let lowOfferShown = false;
const lowOffer = document.getElementById('low-offer') as HTMLDivElement;
function endWindow(now: number): void {
  // The first window only (#1483): a GPU page that is slow later (a throttled tab, a heavy scene) stays on its GPU paths.
  if (!softwareJudged && looksSoftware(frameTimes)) {
    software = true; // the renderer did not say so, the frames do: the next world lays the ground in view only
    document.body.dataset.software = 'on';
  }
  softwareJudged = true;
  lowRun = slowRun(lowRun, frameTimes);
  const step = stepRatio(pixelRatio, ratioBack, frameTimes, ratioFloor(devicePixelRatio, software), renderPixelRatio(devicePixelRatio, navigator.webdriver), now);
  ratioBack = step.back;
  if (step.ratio !== pixelRatio) setPixelRatio(step.ratio);
  else frameTimes = [];
}
function adaptResolution(now: number): void {
  frameTimes.push(now - lastFrame);
  lastFrame = now;
  if (frameTimes.length >= ratioFrames(software)) endWindow(now);
}
function offerLowTier(quiet: boolean): void {
  if (!quiet || online || royaleNet || !offersLowTier(tier, lowRun, readLowOffer(store), lowOfferShown)) return;
  lowOfferShown = true;
  lowOffer.hidden = false;
}
function answerLowOffer(accepted: boolean): void {
  lowOffer.hidden = true;
  writeLowOffer(store, accepted ? 'accepted' : 'dismissed');
  if (accepted) {
    tier = 'low';
    writeTier(store, tier);
    applyLook();
  }
}
(document.getElementById('low-offer-accept') as HTMLButtonElement).addEventListener('click', () => answerLowOffer(true));
(document.getElementById('low-offer-dismiss') as HTMLButtonElement).addEventListener('click', () => answerLowOffer(false));
// For the tests (adaptation is skipped under automation): one window of frames of `ms` each.
hookHost.__slowWindow = (ms: number) => {
  frameTimes = Array.from({ length: RATIO_FRAMES }, () => ms);
  endWindow(performance.now());
};

// How many times the look was rebuilt: an orbit never rebuilds it (bug #475, e2e/camera.spec.ts).
let looks = 0;
let pulsing = false;
hookHost.__looks = () => looks;
hookHost.__setTier = (nextTier: Tier) => {
  tier = nextTier;
  writeTier(store, tier);
  applyLook();
};
function applyLook(): void {
  looks++;
  updateFog();
  setPixelRatio(renderPixelRatio(devicePixelRatio, navigator.webdriver));
  document.body.dataset.tier = tier;
  document.body.dataset.clear = clear ? 'on' : 'off';
  drawProps();
  sceneRenderer.setShadows(sceneRenderer.terraceOn && tier === 'high'); // a tier change moves the sun's shadow (#1364)
  updateParticles();
  if (reducedMotion()) document.documentElement.dataset.motion = 'reduced'; // ui.css cuts every animation
  else delete document.documentElement.dataset.motion;
  pulsing = tier === 'high' && !safe && !reducedMotion(); // the shell's heat pulse (#509)
  document.body.dataset.pulse = pulsing ? 'on' : 'off';
}
// The settings menu: one button per item, its icon then its label, opened by the cog only. Escape, a press outside
// and the cog close it. A toggle shows its state in aria-pressed.
const cog = document.getElementById('settings') as HTMLButtonElement;
// Whether a press lies in an element. A press on the window (no node) lies in none of them: it counts as outside (#1032).
const within = (el: Element, target: EventTarget | null): boolean => target instanceof Node && el.contains(target);
const menu = document.getElementById('settings-menu')!;
const toggles: Record<string, () => void> = {
  'clear-board': () => {
    clear = !clear;
    writeClearBoard(store, clear);
  },
  // Sound opens the volume page (#438): the four sliders in place of the items, until the menu closes.
  sound: () => {
    menu.dataset.page = 'volume';
    sliderAt('music').focus();
  },
  transcript: () => {
    transcriptOn = !transcriptOn;
    writeTranscript(store, transcriptOn);
    paintLog();
  },
  theme: () => {
    const next = nextDisplay(theme, uiScale, safe, maxUiScale(innerWidth, innerHeight));
    theme = next.theme;
    uiScale = next.scale;
    safe = next.safe;
    writeTheme(store, theme);
    writeUiScale(store, uiScale);
    writeSafeMode(store, safe);
    applyTheme();
    applyPalette(); // the accent pair follows the theme (#923)
    applyUiScale();
    applySafe();
    layoutConsole();
  },
  'shell-skin': () => {
    skin = nextSkin(skin);
    writeSkin(store, skin);
    marbleMaterials[1] = shellMaterial(skin);
    refresh();
  },
  'reduced-motion': () => {
    savedMotion = !reducedMotion();
    writeReducedMotion(store, savedMotion);
  },
  'flat-hud': () => {
    flatHud = !flatHud;
    writeFlatHud(store, flatHud);
    reader.classList.toggle('flat', flatHud);
    refresh();
  },
  'glass-skin': () => {
    glass = nextGlassSkin(glass);
    writeGlassSkin(store, glass);
    marbleMaterials[2] = glassMaterial(glass);
    refresh();
  },
  palette: () => {
    palette = nextPalette(palette);
    writePalette(store, palette);
    applyPalette();
    refresh();
  },
  difficulty: () => {
    difficulty = nextDifficulty(difficulty);
    writeDifficulty(store, difficulty);
  },
  'render-mode': () => {
    cycleRenderMode();
  },
  'free-cam': () => toggleFreeCam(),
  steering: () => {
    steering = !steering;
    writeSteering(store, steering);
    openWorld.refreshMode(); // the HUD names the mode, and a walk under way ends (#1137)
  },
  guide: () => {
    moveMenu('pick');
    openGuide(cog);
  },
};
const sliderAt = (bus: Bus): HTMLInputElement => document.getElementById(`volume-${bus}`) as HTMLInputElement;
const difficultyNote = Object.assign(document.createElement('p'), { id: 'difficulty-note' }); // what each level changes (#1538), placed beside the control below
const paintMenu = (): void => {
  difficultyNote.textContent = DIFFICULTY_NOTES[difficulty];
  for (const { id, label, icon: name, on } of settingsList(clear, theme, skin, glass, uiScale, safe, reducedMotion(), flatHud, palette, transcriptOn, difficulty, renderMode, freeCam.active, steering)) {
    const row = document.getElementById(`setting-${id}`)!;
    row.innerHTML = `${icon(name)}<span>${label}</span>`;
    const full = id === 'difficulty' ? `Difficulty: ${difficulty} (${DIFFICULTY_PERCENT[difficulty]}%). ${DIFFICULTY_NOTES[difficulty]}` : label;
    row.setAttribute('aria-label', full); // held upright only the icon shows (#414): the name stays for screen readers
    row.title = full; // and as a tooltip
    if (on !== undefined) row.setAttribute('aria-pressed', String(on));
  }
};
for (const { id } of settingsList(clear, theme, skin, glass, uiScale, safe, reducedMotion(), flatHud, palette, transcriptOn, difficulty, renderMode, freeCam.active, steering)) {
  const row = menu.appendChild(document.createElement('button'));
  row.id = `setting-${id}`;
  row.type = 'button';
  const toggle = toggles[id];
  if (!toggle) {
    row.disabled = true; // Export game and Import game: enabled once their listeners are in, below (#146)
    continue;
  }
  row.addEventListener('click', () => {
    toggle();
    applyLook();
    paintMenu();
  });
}
paintMenu();
// The FPS switch (#426) is a developer tool: the Advanced group of the menu holds it (#1566).
const fpsBox = document.getElementById('fps') as HTMLDivElement;
const fpsButton = document.createElement('button');
fpsButton.id = 'setting-fps';
fpsButton.type = 'button';
fpsButton.textContent = 'FPS';
fpsButton.setAttribute('aria-pressed', String(fpsOn));
menu.append(fpsButton);
fpsBox.hidden = !fpsOn;
// The four volume sliders (#438), the page Sound opens: 0 to 100 %, each saved on its own.
for (const bus of BUSES) {
  const row = menu.appendChild(document.createElement('label'));
  row.className = 'setting-volume';
  row.innerHTML = `<span>${VOLUME_NAMES[bus]}</span><input id="volume-${bus}" type="range" min="0" max="100" step="5">`;
  sliderAt(bus).value = String(sfx.volume(bus));
  sliderAt(bus).addEventListener('input', () => {
    sfx.setVolume(bus, Number(sliderAt(bus).value));
    writeVolume(store, bus, sfx.volume(bus));
  });
}
// The three light sliders, the last rows of the menu with its items: 0 to 300 % of the tuned power each (lightpanel.ts
// scalePower), each saved on its own.
const levelAt = (level: Level): HTMLInputElement => document.getElementById(`level-${level}`) as HTMLInputElement;
const levels = readLevels(store);
for (const level of LEVELS) {
  const row = menu.appendChild(document.createElement('label'));
  row.className = 'setting-lights';
  row.innerHTML = `<span>${LEVEL_NAMES[level]}</span><input id="level-${level}" type="range" min="0" max="300" step="5">`;
  levelAt(level).value = String(levels[level]);
  levelAt(level).addEventListener('input', () => {
    levels[level] = Number(levelAt(level).value);
    writeLevel(store, level, levels[level]);
    scaleLights();
  });
}
// A phone that kept low levels stays dark: one button puts the three back to their defaults (#899).
const resetLights = Object.assign(menu.appendChild(document.createElement('button')), {
  id: 'level-reset',
  type: 'button',
  textContent: 'Reset lights',
});
resetLights.addEventListener('click', () => {
  for (const level of LEVELS) {
    levels[level] = DEFAULT_LEVELS[level];
    levelAt(level).value = String(levels[level]);
    writeLevel(store, level, levels[level]);
  }
  scaleLights();
});
menu.append(difficultyNote); // what each level changes (#1538), under Difficulty in the Controls group
// The log archive (#513): its button, Logs, is a row of the Sound group (#1566). It opens a page of one button per entry read, then per audio log collected (#517), in place of the
// items; a press on one closes the menu and reopens the entry in the terminal reader, or replays the log.
const archiveButton = Object.assign(document.createElement('button'), {
  id: 'setting-log-archive',
  type: 'button',
  textContent: 'Logs',
  title: 'Log archive',
});
// The Ledger (#1585): a second row in the same group, the story lines seen so far in stage order, on the same plate.
const ledgerButton = Object.assign(document.createElement('button'), { id: 'setting-ledger', type: 'button', title: 'Ledger', innerHTML: `${icon('ledger')}<span>Ledger</span>` });
ledgerButton.setAttribute('aria-label', 'Ledger');
menu.append(archiveButton, ledgerButton);
archiveButton.addEventListener('click', openArchive);
ledgerButton.addEventListener('click', openLedger);
groupSettings(menu); // the items under their headings (#1566), Copy diagnostics from the page into Advanced
const archive = menu.appendChild(document.createElement('div'));
archive.className = 'setting-archive';
// Reset everything (#1684, reset.ts): the last row of Settings, a danger action that opens an in-game confirm page in place of the items.
menu.insertAdjacentHTML(
  'beforeend',
  `<button id="setting-reset-all" type="button" class="danger" title="Reset everything" aria-label="Reset everything">${icon('newgame')}<span>Reset everything</span></button>` +
    `<div class="setting-reset" role="alertdialog" aria-labelledby="reset-ask"><p id="reset-ask">${RESET_ASK}</p>` +
    '<button id="reset-erase" type="button" class="danger">Erase</button><button id="reset-cancel" type="button">Cancel</button></div>',
);
const resetAll = document.getElementById('setting-reset-all') as HTMLButtonElement;
resetAll.addEventListener('click', () => {
  menu.dataset.page = 'reset';
  document.getElementById('reset-cancel')!.focus({ preventScroll: true }); // the safe answer first
});
document.getElementById('reset-cancel')!.addEventListener('click', () => {
  delete menu.dataset.page;
  resetAll.focus();
});
document.getElementById('reset-erase')!.addEventListener('click', () => {
  stopBeats(); // no timer rewrites a key between the sweep and the reload: the Open world's beats and the royale's tick
  clearInterval(ticking);
  void eraseAll(store, indexedDB).then(() => location.reload());
});
function openArchive(): void {
  menu.dataset.page = 'archive';
  archive.classList.remove('ledger');
  const row = (title: string, open: () => void): HTMLButtonElement => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: title });
    button.addEventListener('click', () => {
      moveMenu('pick');
      open();
    });
    return button;
  };
  const rows = [
    ...gated(archiveList(readLore(store), [...LORE, ...STORY]), storyStage(store)).map((entry) => row(entry.title, () => openReader(entry.id))),
    ...archiveList(collectedLogs(store), AUDIO_LOGS).map((log) => row(log.title, () => playLog(log))),
  ];
  archive.replaceChildren(...(rows.length ? rows : ['Nothing read yet.']));
  rows[0]?.focus();
}
function openLedger(): void {
  menu.dataset.page = 'archive';
  archive.classList.add('ledger');
  const lines = ledgerList(seenLines(store), storyStage(store)); // nothing above the player's stage is listed
  archive.replaceChildren(...(lines.length ? lines.map(({ line }) => Object.assign(document.createElement('p'), { textContent: line })) : ['Nothing filed yet.']));
}
fpsButton.addEventListener('click', () => {
  fpsOn = !fpsOn;
  writeFps(store, fpsOn);
  fpsBox.hidden = !fpsOn;
  fpsStamps = [];
  fpsButton.setAttribute('aria-pressed', String(fpsOn));
});
motionQuery.addEventListener('change', () => {
  applyLook(); // a system change still counts until the player presses Reduced motion
  paintMenu();
});
applyView(); // camera and fog
// The lobby sheet's state (#1044) is declared with the other sheets: the Game modes and Settings buttons close it, and
// they can be pressed while the module still waits on a top-level await.
const lobbyButton = document.getElementById('lobby') as HTMLButtonElement;
const lobbySheet = document.getElementById('lobby-sheet')!;
let lobbyOpen = false;
let menuIsOpen = false;
const moveMenu = (event: MenuEvent): void => {
  menuIsOpen = menuOpen(menuIsOpen, event);
  if (menuIsOpen) {
    moveModes('outside'); // one sheet at a time (#1032)
    closeGoal();
    closeLobby(); // one sheet at a time (#1044)
  }
  menu.hidden = !menuIsOpen;
  delete menu.dataset.page; // the menu opens on its items again
  cog.setAttribute('aria-expanded', String(menuIsOpen));
};
cog.addEventListener('click', () => moveMenu('button'));
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !menuIsOpen) return;
  moveMenu('escape');
  cog.focus();
});
addEventListener('pointerdown', (e) => {
  if (menuIsOpen && !within(menu, e.target) && !within(cog, e.target)) moveMenu('outside');
});
cog.disabled = false; // listener ready (#146)
// The first-launch guide (#1293, guide.ts): a dialog of five pages over the game. Skip, Escape (B on the pad) or Play on
// the last page close it and store it as seen; the settings menu opens it again. A key pressed in it stays in it: Tab and
// the pad's focus walk keep to its buttons.
const guideBox = document.getElementById('guide')!;
const guideNext = document.getElementById('guide-next') as HTMLButtonElement;
const guideBack = document.getElementById('guide-back') as HTMLButtonElement;
let guidePage = 0;
let guideReturn: HTMLElement | null = null; // the focus goes back there when it closes
function showGuidePage(at: number | null): void {
  if (at === null) {
    guideBox.hidden = true;
    writeGuideSeen(store);
    return void guideReturn?.focus();
  }
  guidePage = at;
  const page = GUIDE[at]!;
  document.getElementById('guide-count')!.textContent = `${at + 1} / ${GUIDE.length}`;
  document.getElementById('guide-art')!.innerHTML = page.art;
  document.getElementById('guide-title')!.textContent = page.title;
  document.getElementById('guide-text')!.innerHTML = page.text;
  guideBack.disabled = at === 0;
  guideNext.textContent = at === GUIDE.length - 1 ? 'Play' : 'Next';
}
function openGuide(from: HTMLElement | null): void {
  guideReturn = from;
  showGuidePage(0);
  guideBox.hidden = false;
  guideNext.focus();
}
const moveGuide = (event: GuideEvent): void => showGuidePage(guideStep(guidePage, event));
guideNext.addEventListener('click', () => moveGuide('next'));
guideBack.addEventListener('click', () => {
  moveGuide('back');
  if (guideBack.disabled) guideNext.focus(); // a disabled button would drop the focus out of the guide
});
document.getElementById('guide-skip')!.addEventListener('click', () => moveGuide('skip'));
guideBox.addEventListener('keydown', (e) => {
  e.stopPropagation(); // the board and the menus never see it
  if (e.key === 'Escape') {
    e.preventDefault();
    moveGuide('skip');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    nextFocus(document.activeElement, e.shiftKey ? -1 : 1, guideBox).focus();
  }
});
// The first-win lock (#1665, unlock.ts, ui.md 4.10): a new player plays the normal game first. The entries that wait for the first win are dimmed
// and a press starts nothing, whatever opens them (the menu, the dock, a door of the Hub); a link, Settings, New game and Play online never ask.
// The first win against the bot saves one flag, lifts the lock and shows a card once. body[data-unlocked] reads 0 or 1.
function syncLocks(): void {
  paintLocks(document, locked);
  document.body.dataset.unlocked = locked ? '0' : '1';
}
function unlockFirstWin(): void {
  markFirstWin(store);
  locked = false;
  syncLocks();
  const card = document.getElementById('unlock')!;
  document.getElementById('unlock-title')!.textContent = UNLOCK_CARD.title;
  document.getElementById('unlock-text')!.textContent = UNLOCK_CARD.text;
  card.hidden = false;
  document.getElementById('unlock-world')!.focus();
}
for (const [id, press] of [['unlock-world', () => openWorldButton.click()], ['unlock-hub', () => shipButton.click()], ['unlock-dismiss', () => undefined]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    document.getElementById('unlock')!.hidden = true;
    press();
  });
}
// One guard for the whole page, in the capture phase: a press on a locked entry (the menu, the dock's Open world, the pad's Enter, a call of .click() such
// as ?openworld=, Browser Back or a door of the Hub) starts nothing. The entry keeps the focus and its aria-disabled.
document.addEventListener(
  'click',
  (e) => {
    if (locked && (e.target as Element).closest('[data-locked]')) e.stopPropagation();
  },
  true,
);
// The first run (#1521, #1523, #1663, firstrun.ts, ui.md 4.7): a fresh profile gets the cold open, then the first match: the standard 14-v-14
// board against a very weak bot (firstbot.ts), a coach plate over it with one sentence per step (select, move, a broadside, a push), each
// waiting for the player's real input, which fades after the push. A new player (the lock on) lands in it with no cold open. It is never saved
// as the player's game, and a skipped or lost one leaves the lock on. body[data-firstrun] reads open or match, for the tests.
const coldBox = document.getElementById('coldopen')!;
const coldBegin = document.getElementById('coldopen-begin') as HTMLButtonElement;
const coach = document.getElementById('coach')!;
const coachStep = document.getElementById('coach-step')!;
const coachSkip = document.getElementById('coach-skip') as HTMLButtonElement;
const coachHub = document.getElementById('coach-hub') as HTMLButtonElement;
let firstRun: 'open' | 'match' | null = null;
let matchStep: MatchStep = 'select';
let guided = false; // the coach plate is on: Skip turns it off
let matchOver = false; // the end plate shows once
let stuck = 0; // the player's moves since the lesson began, without a push
let nudge = false; // the push step is shown again, with the hint, at the player's next turn
function setFirstRun(phase: typeof firstRun): void {
  firstRun = phase;
  if (phase) document.body.dataset.firstrun = phase;
  else delete document.body.dataset.firstrun;
}
/** Closes the first run's plates, wherever it was: another mode, a new game or its own end. */
function dropFirstRun(): void {
  coldBox.hidden = coach.hidden = true;
  guided = false;
  setFirstRun(null);
}
function startFirstRun(): void {
  markFirstRunDone(store);
  setFirstRun('open');
  document.getElementById('coldopen-title')!.textContent = COLD_OPEN.title;
  document.getElementById('coldopen-text')!.replaceChildren(...COLD_OPEN.lines.map((line) => Object.assign(document.createElement('p'), { textContent: line })));
  coldBox.hidden = false;
  coldBegin.focus();
  analyse(); // the board behind it is the start position
}
function showStep(step: MatchStep): void {
  matchStep = step;
  if (!guided) return;
  coachStep.textContent = stepLine(step, matchMedia('(pointer: coarse)').matches);
  coach.hidden = false;
}
/** The first match: the standard start position, the coach at its first step. */
function beginFirstMatch(): void {
  coldBox.hidden = true;
  setFirstRun('match');
  guided = true;
  matchOver = false;
  stuck = 0;
  nudge = false;
  coachSkip.hidden = false;
  coachHub.hidden = true;
  showStep('select');
  refresh();
  analyse();
}
const cellAhead = (q: number, r: number): number => engine.board()[cellIndex(q, r)]!; // a legal in-line move has a cell ahead of its front marble
/** The player's move in the first match: the next step, or the plate fades once the push is done. After 10 moves without a push the push step comes back, with a push as the hint. */
function advanceMatch(move: Move, pushed: boolean): void {
  if (matchStep === 'free') {
    coach.hidden = true;
    return;
  }
  const next = nextStep(matchStep, { move, pushed });
  stuck = next === 'free' ? 0 : stuck + 1;
  nudge = guided && stuck > 0 && stuck % 10 === 0;
  showStep(nudge ? 'push' : next);
}
/** The player's turn again after a nudge: a push of the position, when it has one, shows as the hint. */
function nudgePush(): void {
  if (!nudge) return;
  nudge = false;
  const push = parseMoves(engine.legal_moves()).find((move) => isPush(move, cellAhead, PLAYER));
  if (push) hint.show(engine, history, encodeMove(push));
}
/** The match is over, once: the win shows the unlock card (#1665) or, for a player the lock is off for, the way to the Hub; a draw or a loss says New game starts it again. */
function finishFirstMatch(anim: EndAnim | undefined): void {
  if (matchOver) return; // the plate does not come back after the card is dismissed
  matchOver = true;
  const won = anim === 'win';
  coachSkip.hidden = true;
  coachStep.textContent = won ? COACH.won : anim === 'draw' ? COACH.draw : COACH.lost;
  coachHub.hidden = !won || locked;
  coach.hidden = won && !document.getElementById('unlock')!.hidden; // the card says it already
}
function endFirstRun(): void {
  dropFirstRun();
  enterHub(loadProgress(store).at);
}
/** Skip: a new player (the lock on) keeps the board with the plate gone, anyone else goes to the Hub. */
function skipFirstRun(): void {
  if (firstRun === 'match' && locked) {
    guided = false;
    coach.hidden = true;
  } else endFirstRun();
}
coldBegin.addEventListener('click', beginFirstMatch);
document.getElementById('coldopen-skip')!.addEventListener('click', endFirstRun);
coachSkip.addEventListener('click', skipFirstRun);
coachHub.addEventListener('click', endFirstRun);
coldBox.addEventListener('keydown', (e) => {
  e.stopPropagation(); // the board and the menus never see it
  if (e.key === 'Escape') {
    e.preventDefault();
    endFirstRun();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    nextFocus(document.activeElement, e.shiftKey ? -1 : 1, coldBox).focus();
  }
});
// The epilogue (#1546, epilogue.ts, world.md section 12.8): the win that reaches stage 7 plays two pages once, over the end banner. Skip, Escape
// or Walk out on the last page closes it; it is marked as it opens, and filed in the log archive. body[data-epilogue] reads the page, for the e2e tests.
const epilogueBox = document.getElementById('epilogue')!;
const epilogueNext = document.getElementById('epilogue-next') as HTMLButtonElement;
let epiloguePage = 0;
function showEpilogue(page: number): void {
  epiloguePage = page;
  const { title, lines } = EPILOGUE.pages[page]!;
  document.getElementById('epilogue-title')!.textContent = title;
  document.getElementById('epilogue-text')!.replaceChildren(...lines.map((line) => Object.assign(document.createElement('p'), { textContent: line })));
  epilogueNext.textContent = page === EPILOGUE.pages.length - 1 ? 'Walk out' : 'Next';
  document.body.dataset.epilogue = String(page + 1);
}
function openEpilogue(): void {
  markEpilogue(store);
  markRead(store, EPILOGUE.id);
  epilogueBox.hidden = false;
  showEpilogue(0);
  epilogueNext.focus();
}
function closeEpilogue(): void {
  epilogueBox.hidden = true;
  delete document.body.dataset.epilogue;
}
epilogueNext.addEventListener('click', () => (epiloguePage + 1 < EPILOGUE.pages.length ? showEpilogue(epiloguePage + 1) : closeEpilogue()));
document.getElementById('epilogue-skip')!.addEventListener('click', closeEpilogue);
epilogueBox.addEventListener('keydown', (e) => {
  e.stopPropagation(); // the board and the menus never see it
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEpilogue();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    nextFocus(document.activeElement, e.shiftKey ? -1 : 1, epilogueBox).focus();
  }
});
// The online opt-in (#1338, consent.ts): every way online asks here first, before any relay or peer is contacted. Accept stores
// it; Stay solo, Escape or the pad's B keep solo play. One question at a time: a second entry waits on the same answer.
const consentBox = document.getElementById('consent')!;
const consentAccept = document.getElementById('consent-accept') as HTMLButtonElement;
document.getElementById('consent-text')!.textContent = CONSENT_TEXT;
(document.getElementById('consent-notice') as HTMLAnchorElement).href = PRIVACY_URL;
let consentAsked: Promise<boolean> | null = null;
let consentReturn: HTMLElement | null = null;
function askConsent(): Promise<boolean> {
  consentAsked ??= new Promise<boolean>((resolve) => {
    consentReturn = document.activeElement as HTMLElement | null;
    consentBox.hidden = false;
    consentAccept.focus();
    const answer = (yes: boolean): void => {
      consentBox.hidden = true;
      consentAsked = null;
      if (yes) writeConsent(store);
      consentReturn?.focus();
      resolve(yes);
    };
    consentAccept.onclick = () => answer(true);
    document.getElementById('consent-stay')!.onclick = () => answer(false);
    consentBox.onkeydown = (e) => {
      e.stopPropagation(); // the board and the menus never see it
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        nextFocus(document.activeElement, e.shiftKey ? -1 : 1, consentBox).focus();
      }
    };
  });
  return consentAsked;
}
const consentWanted = (): boolean => consentNeeded(store, location.search, navigator.webdriver);
/** Asks the player to accept online play. Declined, the invite link goes and solo play stays. */
async function onlineAllowed(): Promise<boolean> {
  if (await askConsent()) return true;
  if (location.hash) window.history.replaceState(null, '', location.pathname + location.search);
  return false;
}
// The ranked leaderboard (#1287): you among the opponents of your settled 1v1 matches, from what is saved here.
const boardBox = document.getElementById('board')!;
const boardButton = document.getElementById('leaderboard')!;
const closeBoard = (): void => {
  boardBox.hidden = true;
  boardButton.focus();
};
// The shared board opt-in (#1287, shareboard.ts): asked once at the first ranked entry, its own purpose and unticked. Nothing is sent
// in this slice: joining keeps a choice, a name and a key here; Leave the board stores a signed retire here.
const optinBox = document.getElementById('board-optin')!;
const optinTick = document.getElementById('optin-box') as HTMLInputElement;
const optinName = document.getElementById('optin-name') as HTMLInputElement;
const optinYes = document.getElementById('optin-yes') as HTMLButtonElement;
document.getElementById('optin-text')!.textContent = BOARD_TEXT;
(document.getElementById('optin-notice') as HTMLAnchorElement).href = PRIVACY_URL;
optinTick.addEventListener('change', () => {
  optinYes.disabled = !optinTick.checked;
});
function askBoard(): Promise<void> {
  return new Promise<void>((resolve) => {
    const back = document.activeElement as HTMLElement | null;
    optinTick.checked = false;
    optinYes.disabled = true;
    optinName.value = readBoardName(store);
    optinBox.hidden = false;
    optinName.focus();
    const answer = (yes: boolean | null): void => {
      optinBox.hidden = true;
      back?.focus();
      if (yes) void joinBoard(store, optinName.value).then(() => resolve());
      else {
        if (yes === false) writeChoice(store, 'declined'); // Escape (null) leaves it unanswered: asked again at the next entry
        resolve();
      }
    };
    optinYes.onclick = () => answer(true);
    document.getElementById('optin-no')!.onclick = () => answer(false);
    optinBox.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        nextFocus(document.activeElement, e.shiftKey ? -1 : 1, optinBox).focus();
      }
    };
  });
}
const shareJoined = (): boolean => readChoice(store) === 'joined';
function showShare(): void {
  const joined = shareJoined();
  document.getElementById('board-share-state')!.textContent = joined
    ? `You are on the shared board as "${readBoardName(store)}". Nothing is published yet.`
    : 'You are not on the shared board. Ranked play stays on this device.';
  document.getElementById('board-join')!.hidden = joined;
  document.getElementById('board-leave')!.hidden = !joined;
  document.getElementById('board-newkey')!.hidden = !joined;
}
document.getElementById('board-join')!.addEventListener('click', () => void askBoard().then(() => (showShare(), showShared())));
// Behind ?board=publish the retire that Leave or New key just stored goes to the three relays (publish.ts); plain ?board sends nothing.
const publishRetire = (): void => {
  if (publishFlag(location.search)) void publishResult((url) => new WebSocket(url), readRetires(store).at(-1)!, Math.floor(Date.now() / 1000));
};
document.getElementById('board-leave')!.addEventListener('click', () => void leaveBoard(store, Date.now()).then(() => (publishRetire(), showShare(), showShared())));
document.getElementById('board-newkey')!.addEventListener('click', () => void newKey(store, Date.now()).then(publishRetire));
// The shared board, read side (#1287): once joined, the relays are read and the results the Rust rules replay are shown. Before the
// join no socket is opened: the placeholder says so. Nothing is published here. A reopened board drops an older read that comes back late.
let sharedRead = 0;
function showShared(): void {
  const box = document.getElementById('board-shared')!;
  box.hidden = false;
  const read = ++sharedRead;
  if (!shareJoined()) {
    box.textContent = 'Join the board to see the shared results. Until you join, your browser connects to no relay.';
    return;
  }
  box.textContent = 'Reading the relays...';
  void Promise.all([readBoard((url) => new WebSocket(url), Math.floor(Date.now() / 1000), replay_score), boardKeys(store)]).then(([rows, keys]) => {
    if (read === sharedRead) box.innerHTML = sharedHtml(rows, keys.pub);
  }).catch(() => {
    if (read === sharedRead) box.textContent = 'The relays could not be read.';
  });
}
boardButton.addEventListener('click', () => {
  moveModes('outside');
  showShare();
  showShared();
  const profile = loadRankedProfile(store);
  const rows = buildBoard(profile.rating1v1, loadRivals(store));
  document.getElementById('board-body')!.innerHTML = boardHtml(rows, ratingHistory(profile.matches), visitBoard(store, rows));
  boardBox.hidden = false;
  document.getElementById('board-close')!.focus();
});
document.getElementById('board-close')!.addEventListener('click', closeBoard);
boardBox.addEventListener('keydown', (e) => {
  e.stopPropagation(); // the board and the menus never see it
  if (e.key === 'Escape') {
    e.preventDefault();
    closeBoard();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    nextFocus(document.activeElement, e.shiftKey ? -1 : 1, boardBox).focus();
  }
});
// Where the pad walks the focus: in the guide or the opt-in while one is open.
const padScope = (): ParentNode => (!optinBox.hidden ? optinBox : !consentBox.hidden ? consentBox : !coldBox.hidden ? coldBox : guideBox.hidden ? document : guideBox);
if (guideDue(store, location.search)) openGuide(null);
// The mode menu (#357): Play online, Boss fight with its boss list, and Daily challenge behind one button, opened and
// closed like the settings menu. Starting a mode closes it (startBoss, Play online).
const modeButton = document.getElementById('modes') as HTMLButtonElement;
const modeMenu = document.getElementById('mode-menu')!;
modeButton.innerHTML = icon('modes');
let modesOpen = false;
const moveModes = (event: MenuEvent): void => {
  if (event === 'pick') {
    leaveRun(); // another mode abandons the run (startRun starts its own after)
    leaveTrainer();
  }
  modesOpen = menuOpen(modesOpen, event);
  modeMenu.hidden = !modesOpen;
  modeButton.setAttribute('aria-expanded', String(modesOpen));
  if (modesOpen) {
    moveMenu('outside'); // one sheet at a time (#1032)
    closeGoal();
    closeLobby(); // one sheet at a time (#1044)
  }
};
modeButton.addEventListener('click', () => moveModes('button'));
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !modesOpen) return;
  moveModes('escape');
  modeButton.focus();
});
addEventListener('pointerdown', (e) => {
  if (modesOpen && !within(modeMenu, e.target) && !within(modeButton, e.target)) moveModes('outside');
});
modeButton.disabled = false; // listener ready (#146)

for (const type of ['pointerdown', 'pointerup', 'keydown']) addEventListener(type, () => sfx.unlock(), { capture: true });
document.addEventListener('visibilitychange', () => sfx.visible(!document.hidden)); // no sound in a hidden tab (#728)
// The Medal room (#812) reads like a lore entry; its text is built when it opens, from the saved medals.
const MEDAL_ROOM = 'medal-room';
const bossRoster = (): { id: string; name: string }[] => boss_ids().map((id) => ({ id, name: boss_name(id)! }));
// The deck console (#511): the console-screen prop shows its deck's first lore entry, paged for the UI scale and drawn
// once the web fonts are in, so no fallback font shows first. Drawn again on a page turn only, never per frame.
const consoleCanvas = Object.assign(document.createElement('canvas'), { width: TERMINAL.width, height: TERMINAL.height });
const consoleG = consoleCanvas.getContext('2d')!;
const consoleTexture = new THREE.CanvasTexture(consoleCanvas);
consoleTexture.colorSpace = THREE.SRGBColorSpace;
let consoleFonts = false;
let consoleEntry = '';
let consolePages: TerminalPage[] = [];
let consolePage = -1;
let consoleSince = 0;
// The console shows its deck's first entry (every deck has its entries, lore.test.ts), or one reopened from the archive.
const deckEntry = (): string => LORE.find((e) => e.deck === deck)!.id;
function layoutConsole(id = deckEntry()): void {
  if (!consoleFonts) return;
  if (id === MEDAL_ROOM) storyEvent({ on: 'room', id: MEDAL_ROOM }); // the Medal room first visited is stage 3 (#1584), before its note is chosen (#1586)
  const stage = storyStage(store);
  const entry = id === MEDAL_ROOM ? { ...medalRoom(store, bossRoster(), stage), id } : entryOf(id, stage)!; // the bridge console reads the clamp open from stage 7 (#1546)
  sawLines(entry.body); // a note of Tally on the screen (#1585)
  consolePages = terminalPages(entry, uiScale, (text, font) => {
    consoleG.font = font;
    return consoleG.measureText(text).width;
  });
  consolePage = -1;
  consoleSince = performance.now();
  consoleEntry = entry.id;
  if (reading) showConsole(0);
}
// Draws a page on the screen and copies it into #reader, for screen readers and the flat HUD.
function showConsole(page: number): void {
  consolePage = page;
  const shown = consolePages[page]!;
  drawTerminal(consoleG, shown, uiScale);
  consoleTexture.needsUpdate = true;
  dirty = CHANGE_DRAWS;
  document.body.dataset.console = `${consoleEntry} ${page + 1}/${consolePages.length}`; // read by the e2e tests
  const lines = [shown.title.join(' '), shown.body.join(' '), `Page ${page + 1} of ${shown.pages}`];
  reader.replaceChildren(...lines.map((text) => Object.assign(document.createElement('p'), { textContent: text })));
}
function turnConsole(now: number): void {
  if (reading) return; // the player turns the pages
  const page = consolePages.length ? pageAt(now - consoleSince, consolePages.length) : consolePage;
  if (page !== consolePage) showConsole(page);
}
// The terminal reader (#512): a click on the console screen or the T key frames the camera on it; a click on the screen
// or the right arrow turns the page, the left arrow goes back; Esc, a click off the screen or a click past the last page
// leaves, to the view the player had. The page chrome hides meanwhile (ui.css), so nothing covers the text at any UI
// scale; the game goes on: a move played or received lands as always.
const reader = document.getElementById('reader')!;
reader.classList.toggle('flat', flatHud);
let consoleScreen!: THREE.Mesh; // set by drawProps
let recorder!: THREE.Mesh; // set by drawProps
// The terrace has no console screen (#1369): its Console entry of Game modes opens the same reader, the page as a plate, the camera stays.
document.getElementById('console-entry')!.addEventListener('click', () => {
  moveModes('outside'); // the menu closes, as Leaderboard's does
  openReader();
});
function openReader(id?: string): void {
  if (id) layoutConsole(id); // an entry of the log archive (#513)
  if (!consolePages.length) return; // the fonts are not in yet
  reading = view;
  reader.hidden = false;
  reader.classList.toggle('flat', flatHud || sceneRenderer.terraceOn);
  document.body.dataset.reading = consoleEntry; // read by the e2e tests
  if (consoleEntry !== MEDAL_ROOM) markRead(store, consoleEntry);
  showConsole(0);
  applyView();
  paintLog();
}
function leaveReader(): void {
  view = reading!;
  reading = null;
  reader.hidden = true;
  delete document.body.dataset.reading;
  consoleSince = performance.now() - consolePage * TERMINAL.pageMs; // the screen turns on from the page left
  if (consoleEntry !== deckEntry()) layoutConsole(); // after an entry of the log archive, the deck's own again
  applyView();
  paintLog();
}
function turnReader(step: number): void {
  const page = Math.max(0, consolePage + step);
  if (page === consolePages.length) leaveReader();
  else showConsole(page);
}
addEventListener('keydown', (e) => {
  if (openWorld.active && reading && e.key === 'Escape') return leaveReader(); // a log reread from the archive in the world (#1591)
  if (openWorld.active || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // the Open world's keys (#1063)

  if (e.key.toLowerCase() === 'c' && !reading) {
    toggleFreeCam();
    return;
  }
  if (e.key.toLowerCase() === 'x' && !reading) {
    cycleRenderMode();
    return;
  }
  if (freeCam.active) {
    if (e.key === 'Escape') {
      toggleFreeCam(false);
      return;
    }
    if (freeCam.onKeyDown(e.code)) {
      e.preventDefault();
      drawAsked = true;
      return;
    }
  }

  if (!reading) {
    if (e.key.toLowerCase() === 't') openReader();
  } else if (e.key === 'Escape') leaveReader();
  else if (e.key === 'ArrowRight') turnReader(1);
  else if (e.key === 'ArrowLeft') turnReader(-1);
});
addEventListener('keyup', (e) => {
  if (freeCam.active) {
    freeCam.onKeyUp(e.code);
  }
});
// The audio log player (#516, world.md section 4): while the player reads the deck console, Play log plays the audio log
// of the deck of the entry shown (an entry of the log archive may be another deck's) on the voice bus, music and
// ambience ducked under it. Skip log stops it at any time, on the console or off
// it; the game goes on meanwhile. Its transcript shows line by line unless the Transcript toggle is off.
const logButton = document.getElementById('log-button') as HTMLButtonElement;
const transcript = document.getElementById('transcript')!;
let playing: { log: AudioLog; since: number; stage: number } | null = null;
function paintLog(): void {
  logButton.hidden = !playing && !(reading && audioDeckOf(consoleEntry)); // a log of the world and the Medal room have no recording (#1589)
  logButton.textContent = playing ? 'Skip log' : 'Play log';
  const line = (playing && transcriptOn && lineAt(playing.log, (performance.now() - playing.since) / 1000, playing.stage)) || '';
  if (transcript.textContent !== line) {
    transcript.textContent = line; // aria-live: a line is read once
    sawLines(line); // the line of stage 4 the Cargo log ends on (#1586)
  }
  transcript.hidden = !line;
}
function stopLog(): void {
  sfx.stopLog();
  playing = null;
  delete document.body.dataset.log;
  paintLog();
}
// Any log heard joins the log archive (#517).
function playLog(log: AudioLog): void {
  markCollected(store, log.id);
  playing = { log, since: performance.now(), stage: storyStage(store) };
  document.body.dataset.logSound = sfx.playLog(log.voices) ? 'voice' : 'none'; // read by the tests
  document.body.dataset.log = log.id; // read by the e2e tests
  paintLog();
}
logButton.addEventListener('click', () => {
  if (playing) stopLog();
  else playLog(logOf(audioDeckOf(consoleEntry)!));
});
// Called every frame: the next transcript line, and the end of the log.
function tickLog(now: number): void {
  if (!playing) return;
  if (now - playing.since >= playing.log.seconds * 1000) stopLog();
  else paintLog();
}
void Promise.all(Object.values(terminalFonts(uiScale)).map((font) => document.fonts.load(font)))
  .catch(() => undefined)
  .then(() => {
    consoleFonts = true;
    layoutConsole();
  });
// The Mess cells have their own roughness (Concrete036), every other deck the shared one.
const cellRoughness = (name: Deck): THREE.Texture | null => (name === 'mess' ? (messRoughness ?? deckRoughness) : deckRoughness);
let spaceBoss: string | null = null; // the boss whose space is on (#1551): a later redraw of the deck keeps it
let spaceAct: string | null = null; // or the biome of the act of the run (#1551)
function applyDeck(next: Deck, boss: string | null = null, act: string | null = null): void {
  if (entrance.snap()) syncEntrance(performance.now()); // a new deck ends the beat on the deck before it (card and marker too); the fight that starts one begins it after
  deck = next;
  spaceBoss = boss;
  spaceAct = act;
  const space = bossSpaceOf(boss) ?? actSpaceOf(act); // a boss fight has its own space, a fight of a run the space of its act (#1551)
  sceneRenderer.applyDeck(deck, run && runCue(run.map, run.state), space); // a run: a violet rim, redder each act, sodium posts in an elite (#1554)
  if (space) document.body.dataset.space = boss ?? act!; // read by the e2e tests
  else delete document.body.dataset.space;
  if (steel.roughnessMap) steel.roughnessMap = cellRoughness(next); // only the textured look has one
  document.body.dataset.deck = deck; // read by the e2e tests
  applyLook();
  layoutConsole();
  // The deck's texture set (#401, #440) once loaded, the steel when its file did not load; the frame keeps the steel.
  // Only on the textured look: a map added to the flat look would rebuild its pipeline. body[data-deck-set] is read by the e2e.
  if (!deckSetAsked) return; // the Open world's page: the deck's maps wait for the first board draw (#1603)
  void Promise.all([deckMap(next), deckNormalMap(next)]).then(([map, normal]) => {
    if (deck !== next || !steel.map) return; // another deck started meanwhile, or the flat look
    steel.map = map ?? deckAlbedo;
    if (steel.normalMap && normal) steel.normalMap = normal;
    dirty = CHANGE_DRAWS;
    document.body.dataset.deckSet = map ? next : 'steel';
  });
}


const detail = meshDetail(tier);
const discGeometry = new THREE.CylinderGeometry(0.46, 0.46, 0.1, detail.discSegments);
const marbleGeometry = new THREE.SphereGeometry(MARBLE_RADIUS, detail.marbleWidthSegments, detail.marbleHeightSegments);
const ringGeometry = new THREE.TorusGeometry(0.44, 0.04, 8, 32);
const steel = new THREE.MeshStandardMaterial(
  deckAlbedo && deckRoughness
    ? {
        map: firstDeckMap ?? deckAlbedo,
        roughnessMap: cellRoughness(deckOf('local')),
        ...(firstDeckNormal ? { normalMap: firstDeckNormal } : {}),
      }
    : (tonal ? { ...flat(TONAL.cell), roughness: 0.8 } : { color: COLORS.steel, roughness: 0.8 }),
);
applyDeck(deck);
// Used by the browser checks to light the board in play as any deck, the Bridge included, which has no mode yet.
hookHost.__deck = applyDeck;
// A skin's material is built flat the first time it is worn and dressed in every map its asset ships as they load: a press
// never waits, and a page that keeps the default skins loads two sets of maps, not twenty (the requests are made above).
const dressed = new WeakMap<THREE.Material, Promise<void>>(); // when a skin's maps are on
function dress(look: THREE.MeshStandardMaterial, { id, asset, tile, extra }: { id: string; asset: string; tile: number; extra: readonly Extra[] }): void {
  dressed.set(
    look,
    Promise.all((asksSkinMaps(keepRoom, id, TERRACE_SKINS) ? skinKinds(extra) : []).map(async (kind) => [SKIN_MAPS[kind][0], await skinMap(asset, kind, tile)] as const)).then((loaded) => {
      Object.assign(look, Object.fromEntries(loaded));
      if (tonal) return; // one tone and a soft highlight, no map to wait for (#1138)
      if (extra.includes('metalness')) look.metalness = 1; // the map says where it is metal
      if (extra.includes('emission')) look.emissive.set(0xffffff); // black until the map is there: no white flash
      look.needsUpdate = true;
      dirty = CHANGE_DRAWS;
    }),
  );
}
const shellLooks = new Map<string, THREE.MeshStandardMaterial>();
function shellMaterial(id: string): THREE.MeshStandardMaterial {
  const s = skinById(id);
  let look = shellLooks.get(s.id);
  if (!look) {
    look = new THREE.MeshStandardMaterial({
      roughness: 1, // the roughness map sets it
      metalness: 0,
      ...(tonal ? { ...flat(tonalMarble(1, s.color)), ...MARBLE_LOOK } : {}),
      envMap: reflections,
      envMapIntensity: LIGHT.environment.intensity,
      // The heat pulse (#509) glows through the default shell, dark until the loop sets its intensity.
      ...(s.id === DEFAULT_SKIN ? { emissive: HEAT.color, emissiveIntensity: 0 } : {}),
    });
    dress(look, s);
    shellLooks.set(s.id, look);
  }
  return look;
}
const glassLooks = new Map<string, THREE.MeshPhysicalMaterial>();
function glassMaterial(id: string): THREE.MeshPhysicalMaterial {
  const s = glassSkinById(id);
  let look = glassLooks.get(s.id);
  if (!look) {
    look = new THREE.MeshPhysicalMaterial({
      roughness: 1,
      metalness: 0,
      ...(tonal ? { ...flat(tonalMarble(2, s.color)), ...MARBLE_LOOK } : {}),
      envMap: reflections,
      envMapIntensity: LIGHT.environment.intensity,
    });
    dress(look, s);
    glassLooks.set(s.id, look);
  }
  return look;
}
const marbleMaterials: Record<number, THREE.MeshStandardMaterial> = {
  1: shellMaterial(skin),
  2: glassMaterial(glass),
};
await Promise.all([marbleMaterials[1]!, marbleMaterials[2]!].map((m) => dressed.get(m))); // the worn skins are dressed from the first frame
const coreGeometry = new THREE.SphereGeometry(CORE.radius, 16, 8);
// Who wears the glass depends on the mode (glass.ts), so a side maps to a look only at draw time. A ghost's see-through
// glass holds a cyan core as a child; a marble's opaque skin would hide one, so it has none (#885).
const glassOf = (): number => glassSide({ online: online !== null, bot: worker !== null, fight: fight !== null });
// The boss accents (#507, marbles.ts): one mesh per boss, that each shell of its side holds as a child in boss mode.
function accentGeometry(a: Accent): THREE.BufferGeometry {
  if (a.shape === 'torus') return new THREE.TorusGeometry(...a.args).rotateX(a.tilt);
  const geometry = new THREE.CylinderGeometry(...a.args);
  const rim = geometry.attributes.position!; // a cylinder's first row of vertices is its top rim
  for (let v = 1; v < a.args[3]; v += 2) rim.setY(v, rim.getY(v) - a.points);
  return geometry.translate(0, a.y, 0);
}
const accents = new Map(
  Object.entries(ACCENTS).map(([boss, a]) => {
    const { name, color, roughness, metalness } = a;
    const envMapIntensity = LIGHT.environment.intensity;
    const side = THREE.DoubleSide; // the inside of the open crown shows
    const look = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: reflections, envMapIntensity, side });
    return [boss, Object.assign(new THREE.Mesh(accentGeometry(a), look), { name })];
  }),
);
// The marbles take the room's reflection once the bay is in (#864): the shells, the glass and the boss accents, then the
// Lights slider scales it like the lamps'. Skins worn later are made with it.
function reflect(texture: THREE.Texture): void {
  reflections = texture;
  const accentLooks = [...accents.values()].map((a) => a.material as THREE.MeshStandardMaterial);
  for (const look of [...shellLooks.values(), ...glassLooks.values(), ...accentLooks]) {
    look.envMap = texture;
    look.needsUpdate = true;
  }
  scaleLights();
}
function marbleMesh(side: number, looks = marbleMaterials, core?: THREE.Material): THREE.Mesh {
  const glass = side === glassOf();
  const mesh = new THREE.Mesh(marbleGeometry, looks[glass ? 2 : 1]);
  if (glass && core) mesh.add(Object.assign(new THREE.Mesh(coreGeometry, core), { renderOrder: 1 }));
  const accent = !glass && looks === marbleMaterials && !(sceneRenderer.terraceOn && fight?.id === 'hull') ? accents.get(fight?.id ?? '') : undefined; // the boss side (#507); the Hull's crown is left off on the terrace: the cracking cell is its tell (#1374)
  if (accent) mesh.add(accent.clone());
  return mesh;
}
/** Turns a marble (#346): the shell takes the turn, what it holds stays upright (its boss accent, #507). */
function turnMarble(marble: THREE.Object3D, turn: Quat): void {
  marble.quaternion.fromArray(turn);
  for (const child of marble.children) child.quaternion.copy(marble.quaternion).invert();
}
// A legal target (#390): a ring and an arrow glyph flat on the cell, pointing the way the group goes (world.md 6, rule
// 5). Near-black like the shell, so it reads 3:1 on the lit deck in every mode; the shape carries it, not a colour.
const targetRingGeometry = new THREE.RingGeometry(0.34, 0.42, 32);
const arrowShape = new THREE.Shape(
  [[0.26, 0], [0.04, 0.18], [0.04, 0.07], [-0.2, 0.07], [-0.2, -0.07], [0.04, -0.07], [0.04, -0.18]].map(
    ([x, y]) => new THREE.Vector2(x, y),
  ),
);
const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
// The arrow is dark on the lit cell, inside its luminous ring: a cyan one could not reach 3:1 on it (#390, #787).
const targetMaterial = new THREE.MeshBasicMaterial({ color: COLORS.base });
const ringMaterial = new THREE.MeshStandardMaterial({
  color: 0x38e8ff,
  emissive: 0x38e8ff,
  emissiveIntensity: 1.25,
  roughness: 0.2,
  metalness: 0.1,
});
// The Hull tell: a cracked cell wears the crack decal on its steel (crack-decal.png, a steady shape), near-black fissures
// that read 3:1 on the light deck, with one pale tick per ply left. Without the texture, the ticks and the HUD line
// carry the tell.
const crackGeometry = new THREE.CircleGeometry(0.46, 32).rotateX(-Math.PI / 2);
if (crackDecal) crackDecal.anisotropy = renderer.getMaxAnisotropy(); // the cell is seen at a slant: no blur along it
const crackMaterial = new THREE.MeshBasicMaterial({ color: COLORS.base, alphaMap: crackDecal, transparent: true, depthWrite: false });
let crackDecals: Axial[] = []; // the cells drawn with the decal, for the e2e tests
const tickGeometry = new THREE.BoxGeometry(0.05, 0.02, 0.1);
const tickMaterial = new THREE.MeshBasicMaterial({ color: BONE });
// The Chaplain tell: a steady pale ring and a glyph on each marble a hovered move would expose to a
// flip, never a halo or colour alone.
const paleMaterial = new THREE.MeshBasicMaterial({ color: BONE });
// The Stalker's rings, in both looks (#1138): the bot's last move in cyan, a marble it revealed in amber, not the palette's bone.
const lastMaterial = new THREE.MeshBasicMaterial({ color: TONAL.last });
const revealedMaterial = new THREE.MeshBasicMaterial({ color: TONAL.revealed });
const outlineGeometry = new THREE.TorusGeometry(neonTell.ringRadius, neonTell.ringTube, 8, neonTell.ringSides);
const barGeometry = new THREE.BoxGeometry(0.84, 0.02, 0.05);
const glyphGeometry = new THREE.OctahedronGeometry(0.09);
// The Echo's tells (#859): a steady teal ring where a bonus move lands, on its ghost while a move is prepared and on the
// marble once played, until the next move; a bonus the engine would skip is a ghost under a red cross, a shape and not
// colour alone.
const echoMaterial = new THREE.MeshBasicMaterial({ color: 0x4fd1c5 });
// The last move (#1092): a gold ring on the cells it landed on, flashing when the slide ends (lastMovePulse), a static mark under reduced motion.
const lastMoveMaterial = new THREE.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: LAST_MOVE_REST, depthWrite: false });
let lastMoveRings: THREE.Mesh[] = [];
let lastMoveStart = NaN; // on the frame clock, set by the first frame after the move
let lastMovePlaying = false;
const skipMaterial = new THREE.MeshBasicMaterial({ color: 0xe0413a });
// The target of a free move the player is offered (#958): a teal diamond standing on the cell, over the target arrow.
const freeGeometry = new THREE.OctahedronGeometry(0.16).scale(1, 1.6, 1);
// Stalker (#998, game-design.md section 3.8): the cells out of the player's range under a dark veil, one draw call, the
// rim and the board outline left as they are; a pale ring where the bot's last move landed in range.
const fogMaterial = new THREE.MeshBasicMaterial({ color: tonal ? TONAL.veiled : 0x000000, transparent: true, opacity: tonal ? 1 : 0.9, depthWrite: false });
const veil = Object.assign(new THREE.InstancedMesh(crackGeometry, fogMaterial, 61), { name: 'stalker-fog' }); // one, reused
const veilTint = new THREE.Color();
if (neonLook) neonVeil(fogMaterial, veil); // near black in a cyan outline, the shape of the cell
const revealed = new Set<number>(); // the hidden marbles a blocked move revealed, until the next move
// The Swarm (#1008, game-design.md section 7.14): a ring on each cell where a swarm marble lands next turn; once the evac
// clock runs out the evac lights the whole board, one draw call, and lifts the player's marbles (a fade with reduced motion).
const arrivalMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
const evacMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c1, transparent: true, opacity: 0, depthWrite: false });
const evacGlow = Object.assign(new THREE.InstancedMesh(crackGeometry, evacMaterial, 61), { name: 'swarm-evac' }); // one, reused
let evac: { game: unknown; start: number; reduced: boolean; light: number; lift: number; done: boolean } | null = null;
let swarmShown: SwarmState | null = null; // read by the tests
let botMoved: { game: unknown; len: number; text: string } | null = null; // the bot's last move in words (#1680), shown until the player's next move
let lastLanding: Axial[] = []; // where the bot's last move landed
let stalkerShown: { visible: Axial[]; drawn: Axial[]; revealed: Axial[]; last: Axial[] } | null = null; // read by the tests
// The Chaplain's martyr tell (#748): a steady ember ring and a tall glyph on the marble that explodes next boss turn.
const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
const martyrGlyphGeometry = new THREE.OctahedronGeometry(0.11).scale(1, 2, 1);
// Its explosion: a flash disc and a ring of shards, moved by the animation loop.
const blastFlashGeometry = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const blastFlashMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const blastShardGeometry = new THREE.TetrahedronGeometry(0.15);
const blastShardMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, depthWrite: false });
let blast: { group: THREE.Group; flash: THREE.Mesh; shards: THREE.Mesh[]; start: number; reduced: boolean; then?: Speech } | null = null;
// A converted marble (#508, world.md section 5) is half and half, 3:1 on the shell (#326): the ridged shell up to its
// middle, a bowl closed by a flat floor so its inside never shows, and the player's glass above it, resting on the
// floor. The halves stay upright whatever the marble's turn, under its boss accent; the
// marble's own sphere is not drawn.
const half = detail.marbleHeightSegments / 2;
const shellHalfGeometry = new THREE.LatheGeometry(
  [
    ...Array.from({ length: half + 1 }, (_, k) => {
      const a = ((k / half - 1) * Math.PI) / 2; // from the bottom up to the middle
      return new THREE.Vector2(MARBLE_RADIUS * Math.cos(a), MARBLE_RADIUS * Math.sin(a));
    }),
    new THREE.Vector2(0, 0), // the floor, facing up
  ],
  detail.marbleWidthSegments,
);
const glassHalfGeometry = new THREE.SphereGeometry(MARBLE_RADIUS, detail.marbleWidthSegments, half, 0, Math.PI * 2, 0, Math.PI / 2);
const unseen = new THREE.MeshBasicMaterial({ visible: false });
// Beyond the colour (#790): the Chaplain's pale glyph over the wax and pale cracks on the shell half (the crack decal of the
// Hull), both 3:1 on every shell and glass skin, whatever the deck's light.
const convertedGlyph = new THREE.MeshBasicMaterial({ color: BONE });
const convertedGlyphGeometry = glyphGeometry.clone().translate(0, 0.6, 0); // over the wax, and so turned upright with the marble's parts
const terraceGlyph = new THREE.MeshBasicMaterial({ color: 0x15191c, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const terraceGlyphOutline = glyphGeometry.clone().scale(1.3, 1.3, 1.3).translate(0, 0.6, 0); // the outline: the same shape a third larger, in Bone behind it
const convertedCracks = new THREE.MeshBasicMaterial({ color: BONE, alphaMap: crackDecal, transparent: true, depthWrite: false });
function convert(marble: THREE.Mesh): void {
  marble.material = unseen;
  const shell = Object.assign(new THREE.Mesh(shellHalfGeometry, marbleMaterials[1]), { name: 'shell' });
  const glass = Object.assign(new THREE.Mesh(glassHalfGeometry, marbleMaterials[2]), { name: 'glass' });
  const cracks = Object.assign(new THREE.Mesh(shellHalfGeometry, convertedCracks), { name: 'cracks' });
  cracks.scale.setScalar(1.01); // just outside the shell
  const glyph = Object.assign(new THREE.Mesh(convertedGlyphGeometry, convertedGlyph), { name: 'glyph' });
  marble.add(shell, glass, cracks, glyph);
  if (sceneRenderer.terraceOn) {
    // On the terrace the glyph is near-black with a thin Bone outline (art direction, #1374): it reads on the pale glass and the dark shell.
    glyph.material = terraceGlyph;
    marble.add(Object.assign(new THREE.Mesh(terraceGlyphOutline, convertedGlyph), { name: 'glyph-outline' }));
  }
}
let exposed = 0; // marbles the hovered move would expose, for the HUD
// The Choir: each army wears its own glyph in the pale tell colour on top of its marbles, Alto a spike,
// Tenor a ring, Bass a block, never colour alone. The army that moves next gets the pale ring.
const armyGlyphs = [
  new THREE.ConeGeometry(0.08, 0.18, 4),
  new THREE.TorusGeometry(0.07, 0.025, 8, 16),
  new THREE.BoxGeometry(0.13, 0.13, 0.13),
].map((glyph) => glyph.scale(neonTell.glyph, neonTell.glyph, neonTell.glyph));
if (neonLook) armyGlyphs[0]!.scale(1.3, 1, 1.3); // the Alto cone: a wider base
const armyHalos = !neonLook ? [] : armyGlyphs.map((glyph, army) => army === 0 ? glyph.clone().scale(1.85, 2.4, 1.85) : glyph.clone().scale(1.7, 1.7, 1.7)); // the Bone outline behind the neon look's near-black glyph: wider on the cone, which reads small from above
const choirInk = neonLook ? new THREE.MeshBasicMaterial({ color: 0x15191c }) : paleMaterial;
const choirHalo = neonLook ? Object.assign(new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false }), { color: paleMaterial.color }) : paleMaterial; // the pale tell colour, shared: only the back faces of the larger shape show, an outline round the glyph
// The Overseer (#635, game-design.md section 7.11): a dark hexagonal pedestal with a pale eye on the centre cell; a core
// is a pale marble with a dark eye on top, a shape and not a colour; a vent wears a warm disc crossed by dark slots on
// its cell. A burning marble sinks into its vent where it stands (overseer.ts).
const pedestalGeometry = new THREE.CylinderGeometry(0.36, 0.44, 0.72, 6).translate(0, 0.36, 0);
const pedestalMaterial = new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.4, metalness: 0.6 });
const eyeGeometry = new THREE.SphereGeometry(0.16, 24, 16);
const eyeMaterial = new THREE.MeshBasicMaterial({ color: BONE });
const coreShell = new THREE.MeshStandardMaterial({ color: BONE, roughness: 0.3, emissive: 0x5a4a30 });
const pupilGeometry = new THREE.CircleGeometry(0.15, 24).rotateX(-Math.PI / 2);
const pupilMaterial = new THREE.MeshBasicMaterial({ color: COLORS.base });
const ventGeometry = new THREE.CircleGeometry(0.4, 32).rotateX(-Math.PI / 2);
const ventMaterial = new THREE.MeshBasicMaterial({ color: 0xc8501e });
const slotGeometry = new THREE.PlaneGeometry(0.56, 0.07).rotateX(-Math.PI / 2);
// A green fume of slag rises from the vents once they burn the player's marbles too (P2, #741): 3 soft puffs a vent,
// looping, one faint puff held still under reduced motion (overseer.ts hazeAt).
const hazeMap = (() => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const g = canvas.getContext('2d')!;
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(120, 220, 60, 1)');
  glow.addColorStop(1, 'rgba(120, 220, 60, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
})();
let hazes: { sprite: THREE.Sprite; k: number }[] = []; // moved by the animation loop
// The Overseer's speech bubble (#741): a DOM element over its marble, typed at reading speed (speech.ts). The taunt of
// each 20 % of the slag fill, and an angry shaking red line when a core burns on a vent.
const bubbleBox = document.getElementById('bubble')!;
const bubbleText = document.getElementById('bubble-text')!;
const bubbleLine = document.getElementById('bubble-line')!; // the whole line for screen readers
let speech: { spec: Speech; start: number; chars: number } | null = null;
let tauntSaid: { game: Engine | Encounter | null; index: number } = { game: null, index: -1 };
let phaseSeen: { game: Engine | Encounter | null; phase: number; since: number } = { game: null, phase: 0, since: -1 }; // since: the ply the vents began to burn the player's marbles
/** The Overseer starts saying `spec`; `animateSpeech` types it. */
function say(spec: Speech): void {
  speech = { spec, start: performance.now(), chars: 0 };
  bubbleLine.textContent = spec.text;
  bubbleBox.hidden = false;
  bubbleBox.classList.toggle('angry', spec.angry);
  bubbleBox.classList.toggle('still', reducedMotion()); // no shake
}
/** Types the bubble up to now, with the flicker and a blip per new character, and puts it over the Overseer. */
function animateSpeech(now: number): void {
  if (!speech) return;
  const at = speechAt(speech.spec, now - speech.start, reducedMotion());
  if (at.done) {
    speech = null;
    bubbleBox.hidden = true;
    return;
  }
  if (at.text.length > speech.chars && sfx.tell('blip')) tellCues.push('blip');
  speech.chars = at.text.length;
  bubbleText.textContent = at.text;
  bubbleBox.classList.toggle('glitch', at.glitch);
  bubbleBox.style.opacity = String(at.opacity);
  camera.updateMatrixWorld();
  const spot = new THREE.Vector3(BUBBLE_SPOT.x, BUBBLE_SPOT.y, BUBBLE_SPOT.z).project(camera);
  bubbleBox.style.left = `${(spot.x * 0.5 + 0.5) * innerWidth}px`;
  bubbleBox.style.top = `${(0.5 - spot.y * 0.5) * innerHeight}px`;
}
/** Blinks the announced marble, or shows its steady outline with reduced motion. */
function animateAnnounce(now: number): void {
  if (!blinking) return;
  const [reduced, blink] = [reducedMotion(), blinkAt(now, reducedMotion())];
  for (const material of blinking.materials) material.opacity = (material.userData.opacity as number) * blink;
  blinking.ring.visible = reduced;
  document.body.dataset.announceBlink = blink.toFixed(2); // read by the e2e tests
}
/** Moves the haze puffs of the vents. */
function animateHaze(now: number): void {
  for (const { sprite, k } of hazes) {
    const at = hazeAt(now, k, reducedMotion());
    sprite.position.y = at.y;
    sprite.scale.setScalar(1.3 * at.scale);
    sprite.material.opacity = at.opacity;
  }
  if (hazes[0]) document.body.dataset.hazeY = hazes[0].sprite.position.y.toFixed(3); // read by the e2e tests
}
let overseerBlown: Engine | Encounter | null = null; // the game whose Overseer blew up (#789): its pedestal is not drawn again
let overseerPedestal: THREE.Mesh | null = null;
let overseerDrawn: { overseer: Axial | null; cores: Axial[]; vents: Axial[] } = { overseer: null, cores: [], vents: [] }; // read by the e2e tests
/** A core of The Overseer: a pale marble, its dark eye on top. */
function coreMesh(): THREE.Mesh {
  const core = new THREE.Mesh(marbleGeometry, coreShell);
  const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
  pupil.position.y = 0.37;
  core.add(pupil);
  return core;
}
/** An incinerator vent on the cell at `p`: the warm disc and its 3 dark slots. */
function ventAt(p: { x: number; z: number }): THREE.Group {
  const vent = new THREE.Group();
  vent.add(new THREE.Mesh(ventGeometry, ventMaterial));
  for (const dz of [-0.14, 0, 0.14]) {
    const slot = new THREE.Mesh(slotGeometry, pupilMaterial);
    slot.position.set(0, 0.002, dz);
    vent.add(slot);
  }
  vent.position.set(p.x, 0.004, p.z);
  return vent;
}

// The Alien tell (#588, game-design.md section 7.7): an egg on its cell and, above it, a counter of the player turns
// left before it hatches: a sprite, so it always faces the camera, drawn over the marbles (alien.ts, 3:1 and more). On 1
// a glow under the egg pulses once a second, held still under reduced motion (the animation loop sets it).
let eggGeometry: THREE.BufferGeometry = new THREE.SphereGeometry(0.17, 24, 16).scale(1, 1.35, 1).translate(0, 0.23, 0);
if (neonLook) eggGeometry = neonEggGeometry(); // an ovoid with a bone collar
const eggMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55 });
const eggGlowGeometry = new THREE.CircleGeometry(0.4, 32).rotateX(-Math.PI / 2);
const eggGlowMaterial = new THREE.MeshBasicMaterial({ color: BONE, transparent: true, depthWrite: false });
const counterMaterials = Array.from({ length: Math.max(COUNTER_MAX, TRAIN_LEAD) }, (_, i) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  drawCounter(canvas.getContext('2d')!, i + 1, 128);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map, depthTest: false });
});
// The egg is the Alien's colour, the worn shell skin's (#1402), speckled and veined so it is no marble: its map is drawn again
// when that colour changes, and the glow takes the marks' tint.
const eggShellCanvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
const eggShellMap = new THREE.CanvasTexture(eggShellCanvas);
eggShellMap.colorSpace = THREE.SRGBColorSpace;
eggMaterial.map = eggShellMap;
let eggShade = -1;
function dressEggs(): void {
  if (neonLook) return; // the look's egg is near black, not the shell skin's
  const c = marbleMaterials[1]!.color.getHex(); // the Alien is the shell side in a fight
  const shade = c === 0xffffff ? skinById(skin).color : c; // a mapped skin is white until its albedo: the mean colour stands for it
  if (shade === eggShade) return;
  eggShade = shade;
  drawShell(eggShellCanvas.getContext('2d')!, shade, 128);
  eggShellMap.needsUpdate = true;
  eggGlowMaterial.color.setHex(shellTint(shade));
}
let eggsDrawn: { cell: Axial; left: number; glow: boolean }[] = []; // read by the e2e tests
// The Rail Yard tell (#626, game-design.md section 7.8): rails under each announced line, out past both edges onto the
// deck, an amber chevron on both edges and on every cell of the line, pointing the way the train runs (railyard.ts, 3:1
// and more), and the counter of the player turns left above the entry edge, the eggs' sprite. Its pass: the low-poly
// freight train runs the line and knocks each marble on it off with the ejection fall; under reduced motion it jumps.
const chevronGeometry = new THREE.ShapeGeometry(
  new THREE.Shape(CHEVRON_SHAPE.map(([x, z]) => new THREE.Vector2(x, -z))),
).rotateX(-Math.PI / 2);
const chevronMaterial = new THREE.MeshBasicMaterial({ color: CHEVRON_COLOR });
if (neonLook) neonTells({ crack: crackMaterial, egg: eggMaterial, glow: eggGlowMaterial, chevron: chevronMaterial, arrival: arrivalMaterial, pale: paleMaterial }); // thick, solid, not tone mapped
const railGeometry = new THREE.BoxGeometry(1, 0.03, 0.04);
const sleeperGeometry = new THREE.BoxGeometry(0.08, 0.02, 0.6);
const railMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.4 });
const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 });
const trainGeometries = TRAIN_PARTS.map(({ type, size }) =>
  type === 'box'
    ? new THREE.BoxGeometry(size[0], size[1], size[2])
    : type === 'wheel'
      ? new THREE.CylinderGeometry(size[0], size[0], size[1], 8).rotateX(Math.PI / 2)
      : new THREE.DodecahedronGeometry(size[0]).scale(1.4, 0.45, 0.8),
);
const trainMaterials = new Map(TRAIN_PARTS.map((p) => [p.color, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75 })]));
/** A new freight train, its front at its origin, running along +x. */
function trainModel(): THREE.Group {
  const train = Object.assign(new THREE.Group(), { name: 'train' });
  TRAIN_PARTS.forEach((part, i) => {
    const mesh = Object.assign(new THREE.Mesh(trainGeometries[i], trainMaterials.get(part.color)), { name: part.id });
    mesh.position.set(...part.position);
    train.add(mesh);
  });
  return train;
}
let trainsShown: Train[] = []; // the trains of the last refresh, to see which passed after a move
interface Passing {
  train: Train;
  model: THREE.Group;
  rails: THREE.Group; // kept under the train until it is gone
  start: number;
  skipped: boolean;
}
const passing: Passing[] = [];
// The Assembly Line (#744, game-design.md section 7.12): each belt is a near-black strip with a steel roller at each end,
// ribs that scroll the way it runs, a steel plate on every strike slot (red under a press hanging over it when the strike
// is announced), an amber chevron on every cell of a running belt, and the centre belt's counter of the turns left
// before it reverses (assembly.ts). A press slams on the cell it strikes; under reduced motion the ribs hold still and
// nothing slams.
const beltGeometry = new THREE.BoxGeometry(1, 0.04, 0.6);
const beltMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.95 });
const ribGeometry = new THREE.BoxGeometry(0.05, 0.012, 0.56);
const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.8 });
const rollerGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.64, 12).rotateX(Math.PI / 2);
const plateGeometry = new THREE.BoxGeometry(0.62, 0.02, 0.5);
const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7178, metalness: 0.5, roughness: 0.5 });
const strikeMaterial = new THREE.MeshStandardMaterial({ color: STRIKE_COLOR, emissive: STRIKE_COLOR, emissiveIntensity: 0.8 });
const pressGeometry = new THREE.BoxGeometry(0.55, 0.28, 0.46);
const pressMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.4 });
let beltsShown: Belts | null = null; // the belts of the last refresh, read by the e2e tests
let beltRibs: { belt: Belt; ribs: THREE.Mesh[] }[] = []; // scrolled by the animation loop
const slams: { mesh: THREE.Mesh; start: number; skipped: boolean }[] = [];
// The Magnetizer tell (#645, game-design.md section 7.9): a pale + or − on a near-black disc over each polarized
// marble, a sprite that faces the camera and slides with it (magnetizer.ts, 3:1 and more). A marble that just got its
// polarity wears a pale ring until the next ply. During the repulsions of a ply the board drawn is the engine's board
// before the one playing (`shown`), then the engine's own board.
// The marble announced for the next assignment wears an indicator floating higher: the coming sign on a diamond (#671).
// A pair that repels loses its glyphs: they fade out as the pair slides apart.
const signMaterials = (draw: typeof drawGlyph): Map<number, THREE.SpriteMaterial> =>
  new Map(
    [1, -1].map((sign) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      draw(canvas.getContext('2d')!, sign, 128);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      return [sign, new THREE.SpriteMaterial({ map, depthTest: false })];
    }),
  );
const glyphMaterials = signMaterials(drawGlyph);
const announceMaterials = signMaterials(drawAnnounce);
let announceDrawn: { cell: Axial; sign: number } | null = null; // read by the e2e tests
const fading: { sprite: THREE.Sprite; start: number }[] = [];
let shown: { game: Engine | Encounter; board: number[]; poles: number[] } | null = null;
const showing = (): { board: number[]; poles: number[] } | null => (shown?.game === engine ? shown : null);
// The announced marble blinks in opacity (#741, magnetizer.ts blinkAt); with reduced motion it wears a steady outline.
const announceRingMaterial = new THREE.MeshBasicMaterial({ color: BONE });
let blinking: { materials: THREE.Material[]; ring: THREE.Mesh } | null = null; // moved by the animation loop
let polesDrawn: { cell: Axial; sign: number; fresh: boolean }[] = []; // read by the e2e tests
// The Pulsar (#675, game-design.md section 7.10): six low-poly beacons off the corners of the board, a steel base, a
// pale core that spins and two beam cones along the way it pushes. The one that charges glows steady, its counter (2,
// then 1) beside it and an amber chevron before each of its 9 lines, the Rail Yard's. On a pulse a pale ring grows from
// it across the board while the pushed marbles slide a cell and the ones past the rim fall; reduced motion: the ring
// shows whole and fades, the marbles jump. During the move's slide the board drawn is the one before the pulse.
const pulsarGeometries = PULSAR_PARTS.map(({ type, size, flip }) =>
  type === 'base'
    ? new THREE.CylinderGeometry(size[0], size[0]! * 1.2, size[1], 6)
    : type === 'core'
      ? new THREE.IcosahedronGeometry(size[0])
      : new THREE.ConeGeometry(size[0], size[1], 6).rotateZ(flip ? Math.PI / 2 : -Math.PI / 2),
);
const pulsarMaterials = PULSAR_PARTS.map(
  ({ type, color }) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: type === 'base' ? 0.6 : 0, emissive: type === 'base' ? 0 : color, emissiveIntensity: 0.15 }),
);
const chargeMaterial = new THREE.MeshStandardMaterial({ color: PULSAR_PARTS[1]!.color, emissive: PULSAR_PARTS[1]!.color, emissiveIntensity: 1.6 });
const pylonCharge = new THREE.MeshBasicMaterial({ color: 0xffc468, fog: false }); // the terrace's charging core: amber at full strength
const shockGeometry = new THREE.RingGeometry(neonTell.shockInner, 1, 96).rotateX(-Math.PI / 2);
const shockMaterial = new THREE.MeshBasicMaterial({ color: SHOCK_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
let pulsarShown: Pulsar | null = null; // the next pulse of the last refresh
// The pulsar that fires next turn loops small faint rings while the player thinks (#741, pulsar.ts rippleAt).
const rippleGeometry = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const rippleMaterials = Array.from({ length: RIPPLES }, () => new THREE.MeshBasicMaterial({ color: SHOCK_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
let ripples: THREE.Mesh[] = []; // moved by the animation loop
// The Ballast Mind's last borrowed effect (#838): a steady ring in the hazard colour (the orange of its HUD line) on each cell it touched, until the next ply.
const firedGeometry = new THREE.RingGeometry(0.4, 0.5, 40).rotateX(-Math.PI / 2);
const firedMaterial = new THREE.MeshBasicMaterial({ color: 0xe8812a, transparent: true, depthWrite: false }) // transparent: drawn after the discs;
let firedShown: Fired | null = null; // read by the e2e tests
let pulsarCores: THREE.Mesh[] = []; // spun by the animation loop
let shock: { mesh: THREE.Mesh; id: number; start: number; reduced: boolean; skipped: boolean } | null = null;
// The Unstable Core (#751, game-design.md section 7.13): a glowing hexagon on each of the 7 energy cells while the core
// stands (it pulses, flickers the turn before it collapses), 1 to 3 diamond pips over every charged marble (red at 3),
// the announced wedge glowing, a ring bursting where a marble overloads or falls with the core, and the shockwave: the
// wedge's slice of light sweeping outward from the centre. Reduced motion: steady glows, the ring and the slice show
// whole and fade.
const energyGeometry = new THREE.RingGeometry(0.3, 0.42, 6).rotateX(-Math.PI / 2);
const energyMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const pipGeometry = new THREE.OctahedronGeometry(0.09);
const pipMaterial = new THREE.MeshStandardMaterial({ color: CORE_COLOR, emissive: CORE_COLOR, emissiveIntensity: 1.2 });
const warnMaterial = new THREE.MeshStandardMaterial({ color: WARN_COLOR, emissive: WARN_COLOR, emissiveIntensity: 2 });
const wedgeGlowMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const sweepMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const wedgeSlices = new Map<number, THREE.ShapeGeometry>();
/** The slice of the board a wedge covers, flat on the board plane, apex at the centre. */
function wedgeSlice(wedge: number): THREE.ShapeGeometry {
  if (!wedgeSlices.has(wedge)) {
    const [a, b, c] = wedgeCorners(wedge);
    const shape = new THREE.Shape([new THREE.Vector2(a.x, -a.z), new THREE.Vector2(b.x, -b.z), new THREE.Vector2(c.x, -c.z)]);
    wedgeSlices.set(wedge, new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2));
  }
  return wedgeSlices.get(wedge)!;
}
// The Dual Room (#947, #955, game-design.md section 7.15): the void between its two rooms, holes in the plate (frame.ts)
// that the bridge's 5 cells fill at the 5th ejection, coming down into place; the mark of an announced return on its
// landing cell, in the light of the coming marble's side; the returning marble dropping onto its cell. Reduced motion:
// the bridge is in place at once and the marble is on its cell at once.
const markGeometry = new THREE.RingGeometry(0.3, 0.42, 32).rotateX(-Math.PI / 2);
const markMaterials = [RIM_LIGHT.glass, RIM_LIGHT.shell].map(
  (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
);
// The room out of turn under a dark veil until the bridge (#992), one draw call.
const roomDim = Object.assign(
  new THREE.InstancedMesh(crackGeometry, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }), 37),
  { name: 'dual-dim' },
);
let dualShown: DualState | null = null; // the bridge and the announced return of the last refresh
let lowering: { start: number } | null = null; // the bridge coming down
let bridgeY = 0; // the bridge cells' height over their place
let drop: { cell: Axial; start: number; reduced: boolean; y: number } | null = null; // the returning marble falling
type Fx = { mesh: THREE.Mesh; start: number; reduced: boolean; skipped: boolean };
let unstableShown: (Core & { pips: Charge[] }) | null = null; // the next events and the charges of the last refresh
let bursts: Fx[] = [];
let sweep: Fx | null = null;

// The cell edge (#339): a thin bright steel bevel round each disc's top, so the edge reads 3:1 against the surface.
// Each disc is turned by its own angle (#347), so the deck texture repeated on every cell does not read as a pattern.
const edgeGeometry = new THREE.TorusGeometry(0.44, 0.03, 8, 32).rotateX(Math.PI / 2);
// FXAA softens the thin ring, so it glows brighter there to keep its 3:1 (#857).
const smooth = smoothEdges(renderPixelRatio(devicePixelRatio, navigator.webdriver), renderer.samples > 0);
const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xc4cacf, roughness: 0.5, metalness: 0.3, emissive: smooth ? 0x7f8993 : 0x25292d });
const discs: THREE.Mesh[] = BOARD_CELLS.map(([q, r], i) => {
  const disc = new THREE.Mesh(discGeometry, steel);
  disc.rotation.y = cellTurn(i);
  const bevel = new THREE.Mesh(edgeGeometry, edgeMaterial);
  bevel.position.y = 0.05; // the disc's top face, so the bevel is not buried in the disc
  disc.add(bevel);
  const p = axialTo3D(q, r);
  disc.position.set(p.x, -0.05, p.z);
  disc.updateMatrixWorld(); // picking can run before the first render computes it (#237)
  scene.add(disc);
  return disc;
});
const boardDrawn = instanceCells(discs, scene); // drawn in two draw calls, not 182 (#885)
const placeBridge = (y: number): void => {
  bridgeY = y;
  for (const [q, r] of BRIDGE) discs[cellIndex(q, r)]!.position.y = -0.05 + y;
};
// The battle royale arena (#502): its own 217 discs at half the spacing, in the room of the radius 4 board, shown in its
// place while a battle royale is on. Its marbles wear their seat's shell tint (marbles.ts).
const arena = new THREE.Group();
arena.scale.setScalar(ARENA_SCALE);
arena.visible = false;
const arenaDiscs = ARENA.map(([q, r], i) => {
  const disc = new THREE.Mesh(discGeometry, steel);
  disc.rotation.y = cellTurn(i);
  const bevel = new THREE.Mesh(edgeGeometry, edgeMaterial);
  bevel.position.y = 0.05;
  disc.add(bevel);
  const p = axialTo3D(q, r);
  disc.position.set(p.x, -0.05, p.z);
  arena.add(disc);
  return disc;
});
const arenaDrawn = instanceCells(arenaDiscs, arena);
arena.add(arenaMarbles);
arena.updateMatrixWorld(true); // picking can run before the first render
scene.add(arena);
// The marbles, the board's and the arena's, drawn as one instanced mesh per look, placed before each draw (#885).
const syncMarbles = [marbles, arenaMarbles].map((group) => instanceMarbles(group, marbleGeometry, scene));
let syncPedestals: (() => void)[] = []; // made when the arena's kit has loaded (terraceKit): the 1v1's and the royale's
const seatLooks = SEATS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: SHELL.roughness, metalness: SHELL.metalness }));
// Each seat's glyph (#558), flat in the ink on its marbles, never the tint alone: it touches the shell where the shell
// faces the default view, turned to face it, so it stays inside the marble's outline.
const glyphTilt = resetView().polar;
const glyphLift = new THREE.Vector3(0, Math.cos(glyphTilt), Math.sin(glyphTilt)).multiplyScalar(MARBLE_RADIUS + 0.005);
const seatGlyphs = SEAT_GLYPHS.map(({ points }) =>
  new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * 0.2, y * 0.2)))).rotateX(glyphTilt - Math.PI / 2),
);
const seatInk = new THREE.MeshBasicMaterial({ color: SEAT_INK });
// The special marbles' glyphs (#961), on the shell facing the default view, as the seat glyphs.
const specialGlyphs = SPECIAL_LOOKS.map(({ points }) =>
  new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * 0.22, y * 0.22)))).rotateX(glyphTilt - Math.PI / 2),
);
const specialInks = SPECIAL_LOOKS.map(({ color }) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
// The `+` of an upgraded type (#1458), over its glyph in the shell's ink.
const plusGlyph = new THREE.ShapeGeometry(new THREE.Shape(PLUS_POINTS.map(([x, y]) => new THREE.Vector2(x * 0.22, y * 0.22)))).rotateX(
  glyphTilt - Math.PI / 2,
);
const plusInk = new THREE.MeshBasicMaterial({ color: PLUS_INK, side: THREE.DoubleSide });
// The turns a Bomb's fuse has left (#1490), 3 to 1, in the same ink over its glyph: seven bar digits, not a font.
const fuseGlyphs = [1, 2, 3].map((turns) =>
  new THREE.ShapeGeometry(
    fuseDigit(turns).map(([x, y, w, h]) => new THREE.Shape([[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([vx, vy]) => new THREE.Vector2(vx! * 0.22, vy! * 0.22)))),
  ).rotateX(glyphTilt - Math.PI / 2),
);
// The breach (#503): a cracked arena cell glows in the hazard colour under the Hull's crack decal and ticks.
const breachTint = new THREE.Color(); // the look's tint of the glow, mixed in by `neonTell.breachMix`
const breachGeometry = neonLook ? neonBreachGeometry() : crackGeometry; // a hexagon wider than the cell with the look: one band
const breachGlow = new THREE.MeshBasicMaterial({ transparent: true, opacity: neonTell.breachOpacity, depthWrite: false });

// Spaceship interior architecture (bulkhead arches, rear wall, airlock, pedestal, conduits) (#478)
let wallTexture: THREE.Texture | null = null;
let hazardTexture: THREE.Texture | null = null;
if (deckAlbedo && tier === 'high' && typeof document !== 'undefined') {
  try {
    const wallCanvas = createCanvasTexture(512, 512, drawWallPanel);
    wallTexture = new THREE.Texture(wallCanvas);
    wallTexture.needsUpdate = true;
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(4, 2);

    const hazardCanvas = createCanvasTexture(256, 64, drawHazardStripes);
    hazardTexture = new THREE.Texture(hazardCanvas);
    hazardTexture.needsUpdate = true;
    hazardTexture.wrapS = THREE.RepeatWrapping;
    hazardTexture.wrapT = THREE.ClampToEdgeWrapping;
    hazardTexture.repeat.set(4, 1);
  } catch {
    // Canvas context not available (e.g. in basic headless environments)
  }
}

// ?lights: a power slider per light and neon tube (lightpanel.ts), rebuilt when the props replace their lights.
const lightsPanel = new URLSearchParams(location.search).has('lights') ? document.body.appendChild(document.createElement('div')) : null;
// The bloom's knobs, tuned and in the panel like the lights.
const bloomKnobs = ((b) =>
  b
    ? [
        { name: 'bloom strength', uniform: b.strength, max: 3, scaled: true },
        { name: 'bloom radius', uniform: b.radius, max: 1 },
        { name: 'bloom threshold', uniform: b.threshold, max: 10 },
      ]
    : [])(sceneRenderer.pipeline?.bloom);
// The settings' light sliders over the tuned power; the first knob is the bloom's strength.
function scaleLights(): void {
  scalePower(sceneRenderer.scene, levels, bloomKnobs[0]?.uniform);
}
// The ?lights panel's Save button, in dev only: the dev server writes the panel's tuning to sceneoverrides.json (#875).
const saveOverrides = import.meta.env.DEV
  ? {
      levels,
      write: (power: Record<string, number>): void =>
        void fetch('/__sceneoverrides', { method: 'POST', body: JSON.stringify({ power }) })
          .then((r) => r.ok || console.error(`sceneoverrides.json not saved: ${r.status}`))
          .catch(console.error),
    }
  : undefined;
// The lights as tuned (lighttuning.ts) and as saved from the panel (sceneoverrides.json), each time they are made again:
// here, and on the deck's change and the room.
const refreshLights = (): void => {
  applyTuning(sceneRenderer.scene, LIGHT_TUNING, bloomKnobs);
  applyTuning(sceneRenderer.scene, sceneOverrides.power, bloomKnobs);
  if (neonLook) [sceneRenderer.pipeline, sceneRenderer.flatPipeline].forEach((p) => setNeonBloom(p?.bloom)); // a real halo, high tier only (no pass on the low tier)
  scaleLights();
  if (lightsPanel)
    lightPanel(
      sceneRenderer.scene,
      lightsPanel,
      (at) => toggleFreeCam(true, at),
      bloomKnobs,
      // The dev server's endpoint (scripts/editor-scene.mjs): the build drops the button and the exporter with it.
      import.meta.env.DEV ? () => void openInEditor(sceneRenderer.scene, sceneRenderer.camera, renderer).catch(console.error) : undefined,
      saveOverrides,
    );
};
// What the last look made, disposed when the next replaces it (#846): a setting is a rebuild, never a leak.
let propMeshes: THREE.Mesh[] = [];
let roomAccents: THREE.PointLight[] = []; // the neon look's 2 accent lights (neonfx.ts), driven each draw
drawProps = (): void => {
  for (const mesh of propMeshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  propMeshes = [];
  propsGroup.clear();
  const sLights = spaceshipLights(deck);
  for (const def of spaceshipArchitecture(tier)) {
    let mat: THREE.Material;
    const screen = def.id === 'console-screen';
    if (screen) {
      mat = new THREE.MeshBasicMaterial({ map: consoleTexture, fog: false }); // a screen gives its own light
    } else if (def.id === 'log-recorder') {
      mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    } else if (def.id.includes('neon')) {
      const neonColor =
        def.id === 'pedestal-neon-3' ||
        def.id === 'pedestal-neon-4' ||
        def.id === 'pedestal-neon-5' ||
        def.id.endsWith('-sw') ||
        def.id.endsWith('-ne') ||
        def.id.includes('airlock')
          ? sLights.emergency
          : sLights.rim;
      mat = new THREE.MeshStandardMaterial({
        color: neonColor,
        emissive: neonColor,
        emissiveIntensity: 5.5,
        roughness: 0.15,
        fog: true,
      });
    } else if (def.id.includes('wall') && wallTexture) {
      mat = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: def.roughness,
        map: wallTexture,
        fog: false,
      });
    } else if (def.id.includes('hazard') && hazardTexture) {
      mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: def.roughness,
        map: hazardTexture,
        fog: false,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: def.roughness,
        fog: false,
      });
    }

    const geom =
      def.type === 'cylinder'
        ? new THREE.CylinderGeometry(def.size[0], def.size[1], def.size[2], def.size[3])
        : // Rounded edges, within the box: up to 5 cm, a fifth of its thinnest side, so a thin bar stays a bar.
          new RoundedBoxGeometry(def.size[0], def.size[1], def.size[2], 2, Math.min(0.05, Math.min(...def.size) / 5));

    const mesh = new THREE.Mesh(geom, mat);
    if (screen) consoleScreen = mesh;
    if (def.id === 'log-recorder') recorder = mesh;
    mesh.name = def.id; // a neon tube gets its ?lights slider by name
    if (!screen && def.id !== 'log-recorder' && !def.id.includes('neon')) {
      mesh.visible = !currentBay;
    }
    if (def.id.startsWith('neon-gantry')) mesh.visible = false; // no ceiling to hang on (#956): its lights stay
    if (def.id.includes('neon') && currentBay) {
      if (def.id === 'corner-neon-nw') {
        mesh.position.set(-8.4, 5.2, -17.35);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'corner-neon-ne') {
        mesh.position.set(8.4, 5.2, -17.35);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'corner-neon-sw') {
        mesh.position.set(-8.4, 5.2, 17.35);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'corner-neon-se') {
        mesh.position.set(8.4, 5.2, 17.35);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'neon-column-wn') {
        mesh.position.set(-17.35, 5.2, -8.4);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'neon-column-ws') {
        mesh.position.set(-17.35, 5.2, 8.4);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'neon-column-en') {
        mesh.position.set(17.35, 5.2, -8.4);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'neon-column-es') {
        mesh.position.set(17.35, 5.2, 8.4);
        mesh.scale.set(1.4, 1.0, 1.4);
      } else if (def.id === 'neon-airlock-top') {
        mesh.position.set(0, 8.35, -17.65);
        mesh.scale.set(1.1, 1.8, 1.8);
      } else if (def.id === 'neon-observation-top') {
        mesh.position.set(0, 7.2, 17.65);
        mesh.scale.set(1.1, 1.8, 1.8);
      } else if (def.id === 'neon-gantry-north') {
        mesh.position.set(0, 13.05, -8.4);
        mesh.scale.set(1.05, 1.4, 1.4);
      } else if (def.id === 'neon-gantry-south') {
        mesh.position.set(0, 13.05, 8.4);
        mesh.scale.set(1.05, 1.4, 1.4);
      } else mesh.position.set(...def.position);
    } else {
      mesh.position.set(...def.position);
    }
    mesh.rotation.set(...def.rotation);
    propsGroup.add(mesh);
    propMeshes.push(mesh);
  }
  // Each neon tube lights the room for real: a row of lights along it (neonlight.ts), one slider in ?lights.
  for (const tube of propsGroup.children.filter((o) => o.name.includes('neon')))
    propsGroup.add(...tubeLights(tube as THREE.Mesh));
  const ring = ringLamp();
  propsGroup.add(...ring.meshes, ...ring.lights);
  propMeshes.push(...ring.meshes);
  const viewportRimLight = new THREE.PointLight(sLights.rim, 2.7, 11.0);
  viewportRimLight.position.set(17.0, 4.6, 0);
  const kioskGreenLight = new THREE.PointLight(0x55efc4, 2.25, 6.0);
  kioskGreenLight.position.set(-10.2, 2.5, -5.8);
  const lights = { viewportRimLight, kioskGreenLight };
  for (const [name, light] of Object.entries(lights)) light.name = name; // the ?lights sliders' names
  propsGroup.add(...Object.values(lights));
  roomAccents = neonLook ? accentLights('room') : [];
  if (roomAccents.length) propsGroup.add(...roomAccents); // add() with no object logs a Three error (#1505)
  if (currentBay) {
    applyDeckAtmosphere(currentBay, deck as DeckId);
    propsGroup.add(currentBay.scene);
  }
  placeBay();
  refreshLights();
};
// The Pulsar's fight is drawn in space (#1146): the bay's meshes leave the camera's layer (the lamps stay lit), a field of
// stars and a distant glow take the backdrop. Any other game gets the bay back. Redone with the props (drawProps).
const BAY_LAYER = 1; // out of the camera's layer 0
// One flat sheet far under the plate (the camera looks down), painted once: the stars and a soft distant glow.
const space = (() => {
  const canvas = createCanvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.2, h * 0.25, 0, w * 0.2, h * 0.25, w * 0.22);
    glow.addColorStop(0, 'rgba(110,150,255,0.3)');
    glow.addColorStop(1, 'rgba(110,150,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#dfe8ff';
    for (let i = 0; i < 600; i++) g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random(), 1 + Math.random());
  });
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), fog: false }),
  );
  sheet.position.y = -45;
  return Object.assign(new THREE.Group(), { name: 'pulsar-space', visible: false }).add(sheet);
})();
sceneRenderer.scene.add(space);
const bayBackdrop = sceneRenderer.scene.background;
const spaceBackdrop = new THREE.Color(0x000000); // past the edge of the sheet: the same black
let inSpace = false;
function syncSpace(): void {
  const wanted = fight?.id === 'pulsar' && !hub; // the ship's hub keeps its bay
  if (wanted === inSpace) return;
  inSpace = wanted;
  space.visible = wanted;
  sceneRenderer.scene.background = wanted ? spaceBackdrop : bayBackdrop;
  placeBay();
}
// The bay's meshes on their layer for the current state: also after every rebuild of the props (drawProps, #1189).
function placeBay(): void {
  const layer = inSpace ? BAY_LAYER : 0;
  sceneRenderer.roomDeck.layers.set(layer);
  propsGroup.traverse((o) => void ((o as THREE.Mesh).isMesh && o.layers.set(layer)));
}
let currentBay: SpaceshipBayAssets | null = null;
const mountBay = (bay: SpaceshipBayAssets | null): void => {
  currentBay = bay;
  drawProps();
  sceneRenderer.mountBay(bay, deck);
  dirty = CHANGE_DRAWS;
  refreshLights(); // the room's lamps came with it
  if (hasReflections(tier, navigator.webdriver)) reflect(prefilteredBay()); // its lamps are tuned: the room is taken once
  if (currentBay) {
    document.body.dataset.bay = 'ready'; // the room is complete: the browser checks of a still scene wait for it (#661)
  }
  hidePlate();
};
/** The loading plate (#901) fades, then leaves: with the bay, a missing bay too, or with the first frame of a world that opened the page (#1520). */
function hidePlate(): void {
  const plate = document.getElementById('loading')!;
  if (plate.hidden) return; // the world calls it at every frame
  if (navigator.webdriver) plate.hidden = true; // a check waiting on data-bay never sees the plate fade
  else {
    plate.classList.add('done');
    setTimeout(() => (plate.hidden = true), 400);
  }
}
hookHost.__mountBay = mountBay;drawProps();

let frame: FrameShape | null = null;
function drawFrame(board: ArrayLike<number>): void {
  const next = sceneRenderer.drawFrame(board);
  if (!next) return;
  frame = next;
  fogRadius = next.radius;
  applyLook();
}
// The turn on the rim, at once, no fade (world.md section 8). Clear board keeps it: it is game information.
function lightRim(): void {
  const light = hub ? null : rimLight(engine.status(), engine.to_move(), glassOf()); // no game on in the hub (#521)
  sceneRenderer.lightRim(light);
  document.body.dataset.rim = light?.end ?? 'off';
}
// The boss phase notches on the rim (#356, notches.ts): a near-black groove per notch, filled bone-white while lit, and
// a bone-white triangle at the next-phase threshold, so they read on any rim light by shape, not colour alone. No fog
// on them: clear board and the low tier draw them the same (world.md section 8). The HUD P1 P2 P3 stay as the fallback.
function drawNotches(): void {
  const row = engine instanceof Encounter && frame ? notchRow(frame, engine.phase_notches()) : null;
  sceneRenderer.drawNotches(row);
}
// The ejected count scratched on the rim as tally marks (#389, tallymarks.ts), drawn as the phase notches: a groove per
// slot, a bone-white mark in it for each marble lost. The HUD pips stay as the fallback.
function drawTally(): void {
  const lost = [engine.ejected(2), engine.ejected(1)] as const; // a side loses what the other ejects
  const slots = tallySlots(lost);
  tallies.forEach((group, s) => {
    clearDrawn(group);
    for (const m of tallyRow(frame!, s === 0 ? 1 : 2, slots[s]!)) {
      for (const geometry of m.marked ? [grooveGeometry, scratchGeometry] : [grooveGeometry]) {
        const mesh = new THREE.Mesh(geometry, geometry === grooveGeometry ? grooveMaterial : scratchMaterial);
        mesh.position.set(m.x, 0, m.z);
        mesh.rotation.y = m.angle;
        group.add(mesh);
      }
    }
  });
}
// Cell index to the marble on it, first, and what is drawn on that marble (glyph, tell ring): the
// slide moves them together and rolls the marble only.
const marbleAt = new Map<number, THREE.Object3D[]>();
// Each marble's own turn (#346), carried and rolled by its slides (#345), for the game it belongs to (orient.ts).
let turns: { game: Engine | Encounter; map: Map<number, Quat> } = { game: engine, map: new Map() };
const gameTurns = (): Map<number, Quat> => {
  if (turns.game !== engine) turns = { game: engine, map: new Map() };
  return turns.map;
};
const turnAt = (i: number): Quat => turnOf(gameTurns(), fight?.seed ?? 0, i);
const onMarble = (i: number, obj: THREE.Object3D): void => {
  marbleAt.set(i, [...(marbleAt.get(i) ?? []), obj]);
};
// Ghost layer: the position a hovered legal move would give, drawn translucent.
const ghostMaterials: Record<number, THREE.MeshStandardMaterial> = {};
for (const [key, color] of [[1, SHELL.color], [2, GLASS.color]] as const) {
  ghostMaterials[key] = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
}
const ghostCore = new THREE.MeshBasicMaterial({ color: CORE.color, transparent: true, opacity: 0.45, depthWrite: false });
function applyPalette(): void {
  const pal = paletteById(palette);
  document.documentElement.dataset.palette = palette;
  const colors = themeColors(pal, theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches));
  for (const [name, value] of [['--accent', colors.accent], ['--hazard', colors.hazard]] as const) {
    if (value) document.documentElement.style.setProperty(name, value);
    else document.documentElement.style.removeProperty(name); // light default: ui.css's on-cream colours win (#923)
  }
  ringMaterial.color.setHex(tonal ? TONAL.last : pal.core);
  tickMaterial.color.setHex(pal.tell);
  scratchMaterial.color.setHex(pal.tell);
  paleMaterial.color.setHex(pal.tell);
  firedMaterial.color.set(pal.hazard);
  ghostCore.color.setHex(pal.core);
}
applyPalette();
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyPalette); // System theme follows the OS (#923)
let hover: Axial | null = null;
let roomOf: HubSpot | null = null; // the hub room that started the game, for Back to the hub (#522)
let lairFrom: { seed: number; lair: number; phase: Phase; placed: number[][]; relics: number[] } | null = null; // the Open world lair that started the fight, for Back to the Open world (#1170), and the phase of the world it was entered in (#1496)
let placeFrom: { seed: number; kind: PlaceKind } | null = null; // the Open world a town or a dungeon gate was entered from: the Hub or the run it opened has a way back (#1593)
/** Dresses the board for the phase the lair or the wild marble was met in (#1496, #1511): day, dusk or night, `body[data-fight-board]` reading the same. A fight that is neither has the ordinary board. */
function syncBoardLook(): void {
  const phase = lairFrom?.phase ?? wildFrom?.phase;
  sceneRenderer.setBoardLook(phase ? BOARD_LOOKS[phase] : null);
  if (phase) document.body.dataset.fightBoard = phase;
  else delete document.body.dataset.fightBoard;
}
const exitButton = document.getElementById('exit') as HTMLButtonElement; // the dock's first slot in every mode: Hub or World, by where it leads (#1517)
const wildFlee = document.getElementById('wild-flee') as HTMLButtonElement; // Flee, for the whole wild fight (#1511)
let exitReady = false; // the page is built: what the exit reads (the online room, the Open world) exists
/** Where the exit of the screen shown leads (exitslot.ts); Browser Back goes to the same place. */
function exitNow(): Exit {
  return exitOf({
    online: online !== null && roomOf === null, // a table of a Hub door keeps its way back to the Hub, online or not (#522)
    world: openWorld.active,
    wild: wildFrom !== null,
    lair: lairFrom !== null,
    place: placeFrom !== null && (hub !== null || run !== null),
    mode: run !== null || trainer !== null || fight !== null || royale !== null || roomOf !== null,
  });
}
/** Draws the exit from the screen shown: its label names where it leads. A wild fight keeps Flee in the first slot (it leads to the same place). */
function syncExit(): void {
  syncWorkshop();
  if (!exitReady || confirmExit !== null) return; // while it asks, the label is Sure?
  const to = exitNow();
  exitButton.hidden = !to || !wildFlee.hidden;
  if (!to || exitButton.dataset.label === EXIT_LABEL[to]) return;
  exitButton.dataset.label = EXIT_LABEL[to];
  exitButton.textContent = EXIT_NAME[to];
  exitButton.setAttribute('aria-label', EXIT_NAME[to]);
}

// The bot thinks in a worker so the page never freezes. ?bot=off gives the two-player board back
// (the rules e2e tests drive both sides by hand).
const botWorker =
  new URLSearchParams(location.search).get('bot') === 'off'
    ? null
    : lazyWorker(() => new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' })); // created at its first request (#1579)
let worker = botWorker; // the bot of this game: none at the hub's hot-seat table either (#522)
const history: number[][] = [];
let undone = false; // this game had an Undo (#1672): it does not count for the first win, and the flag is saved with the game
let thinking = false;

// A local game survives a reload: saved in IndexedDB after every move, replayed through the engine on
// load (docs/specs/tech.md section 8). Loaded before the board listeners exist, so no click races it.
const gameStore = indexedDbStore();
const saves = new LocalSaves(gameStore, navigator.storage);
// Without ?bot=off the page resumes the game of either mode: a hot-seat game from the hub's table goes on with
// no bot (#565).
const loadLocal = () => saves.load(botWorker ? undefined : false, (boss) => (boss ? encounterFor(Encounter, boss.id, boss.seed, undefined, undefined, boss.mirror) : new Engine())); // the saved local game, with the bot or at the table it was played at
const resumed = await loadLocal();
// A rogue-lite run saved in progress (#798), started over the local game once the page is ready.
// The army's fight with its special marbles placed (#961), the same board as the bot's (bot.ts engineFor).
// The bot's army is the bridge's plan for the node (#1462), or its count for a run saved before.
const foesFor = (map: MapNode[], state: Run): number | number[] => foePlan(map, state, (node, less, biome, more) => run_foes(state.seed, node, less, biome, more, state.map));
// The exits at the end of an act (#1472) and the roster names of their bosses.
const exitsFor = (state: Run) => (act: number, from: number): Uint8Array => run_exits(state.seed, act, from, state.runes, biomeOf(state, 0)); // never the biome the run began in again (#1597)
const armyEngine = (state: Run, map: MapNode[]): Engine => engineFor(Engine, state.army, state.placed, foesFor(map, state), undefined, relicMask(state));
// The fight of the run's last node: the act's roster boss (#800) with the army's build, or the bot against the army.
const runEngine = (state: Run, map: MapNode[]): Engine | Encounter => {
  const boss = actBoss(map, state, boss_ids());
  return boss ? encounterFor(Encounter, boss.id, boss.seed, state.placed, relicMask(state)) : armyEngine(state, map); // an act boss takes the army's build when its rules allow it (#1494)
};
const loadSavedRun = () => loadRun(gameStore, (seed, runes, version) => parseMap(run_map(seed, runes, version)), runEngine);
const resumedRun = await loadSavedRun();
if (resumed) {
  if (!resumed.bot) worker = null;
  engine = resumed.engine;
  history.push(...resumed.moves);
  undone = resumed.undone === true;
}

// Evaluation bar (#191): the search score of every position of a local or bot game, from a second
// copy of the bot worker, so a bot reply never waits behind it. Online and boss games turn it off for
// good (fair play, #164).
const evalBar = document.getElementById('eval')!;
const evalMeter = evalBar.querySelector('.track')!;
const evalLabel = evalBar.querySelector('.label')!;
const analysisWorker = lazyWorker(() => new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' })); // created when the bar first asks (#1579)
const analyst = new Analyst(
  (moves) => askEval(analysisWorker, moves),
  (score, { history: moves, side }) => {
    const fill = evalFill(score, side);
    // Once the live game is over its result is the title of the plate (#1038): the bar shows its fill, no words.
    const words = replaying === null && engine.status() !== 0 ? '' : evalText(score, side, glassOf());
    evalBar.style.setProperty('--fill', String(fill));
    evalMeter.setAttribute('aria-valuenow', String(Math.round(fill * 100)));
    evalMeter.setAttribute('aria-valuetext', words);
    evalLabel.textContent = words;
    evalBar.dataset.ply = String(moves.length); // read by the e2e tests
  },
  botFailed,
);
let analysing = true;
function analyse(): void {
  if (!analysing) return;
  evalBar.hidden = false;
  analyst.request({ history: history.slice(0, shownPly()), side: engine.to_move() }); // the position on show: a replay evaluates its own (#1038)
}
function stopAnalysis(): void {
  analysing = false;
  evalBar.hidden = true;
  analyst.stop();
}

// The bot's and the hint's search budget: BOT_NODES, or the test budget of ?nodes (bot.ts).
const budget = botBudget(location.search, navigator.webdriver);

// Hint (#192): a press shows the engine's best move for the side to move as a ghost, it never plays it. Asked from
// the analysis worker with the bot's own budget, so the bot's reply never waits behind it. A hint belongs to the
// position it was asked for (hint.ts): the next move, New game or an import leave it behind, and a late answer is
// never drawn on a newer position. A new selection and a second press clear it. Local games only, like the bar.
const hintButton = document.getElementById('hint') as HTMLButtonElement;
const here = (): Spot => ({ game: engine, ply: history.length });
const hint = new Hint(
  (moves) => askBot(analysisWorker, moves, scaleBudget(budget, difficulty)), // the bot's own budget: the move the bot would play there
  () => refresh(), // the ghost and the rings on the marbles the move takes (#301)
  botFailed,
);
function syncHint(): void {
  const state = hint.state(here());
  hintButton.hidden = !analysing; // online and boss games turn it off for good, with the bar (fair play, #164)
  hintButton.disabled = thinking || engine.status() !== 0 || replaying !== null;
  hintButton.setAttribute('aria-pressed', String(state !== 'off'));
  document.body.dataset.hint = state; // read by the e2e tests
  syncUndo();
}
// Undo (#1672, undo.ts): in a casual bot game it takes back the player's move and the bot's reply. Absent elsewhere; the game is marked, no first win.
const undoButton = document.getElementById('undo') as HTMLButtonElement;
const undoOk = (): boolean => undoAllowed({ bot: worker !== null, fight: fight !== null, run: run !== null, trainer: trainer !== null, online: online !== null, wild: wildFrom !== null, replaying: replaying !== null, first: firstRun !== null, auto: autoPlay, thinking, over: engine.status() !== 0, hub: hub !== null, plies: history.length });
function syncUndo(): void {
  undoButton.hidden = !undoOk();
}
undoButton.addEventListener('click', () => {
  if (!undoOk()) return; // the rules again: a press on a stale button, or while the bot thinks, does nothing
  const to = undoLength(history.length, (ply) => engineAt(history, ply, makeGame).to_move(), PLAYER);
  engine = engineAt(history, to, makeGame);
  history.length = to;
  undone = true;
  selected = [];
  keyDir = -1;
  hint.clear();
  skipEjections();
  void saves.save(savedGame(), false);
  refresh();
  analyse();
});
hintButton.addEventListener('click', () => {
  selected = []; // the ghost shows the hint alone
  hint.press(engine, history);
  refresh();
});

// Auto-play (#792, docs/specs/ui.md section 4.3): a toggle in the fight HUD lets the bot play the player's side, one move
// per AUTO_DELAY_MS, until it is turned off, the game is over or replaced. The bot's own side is played as ever. Against
// a boss it needs that boss's medal (#791); online, in the hub and with ?bot=off (no bot) it is not there. The battle royale asks the royale bot for the order.
const autoButton = document.getElementById('auto-play') as HTMLButtonElement;
const autoReason = document.getElementById('auto-reason')!;
let autoPlay = false;
let autoGame: object | null = null; // the game or royale it was turned on in
let autoTimer: ReturnType<typeof setTimeout> | undefined;
function stopAuto(): void {
  autoPlay = false;
  clearTimeout(autoTimer);
}
function syncAuto(): void {
  const boss = engine instanceof Encounter ? engine.name() : null;
  const state = autoPlayState({ online: Boolean(hub) || online !== null || botWorker === null, boss, trainer: trainer !== null, run: run !== null }, fight !== null && hasMedal(store, fight.id));
  const over = royale ? royale.placement().length > 0 : engine.status() !== 0;
  const reason = state.shown ? state.reason : null;
  const usable = state.shown && reason === null && !over;
  if (autoPlay && (!usable || (royale ?? engine) !== autoGame)) stopAuto();
  autoButton.hidden = !state.shown;
  autoButton.disabled = !usable;
  autoButton.setAttribute('aria-pressed', String(autoPlay));
  const note = reason ?? (usable ? (state.shown && state.warn) || null : null); // a run's warning shows while Auto-play is usable (#1675)
  autoReason.hidden = note === null;
  autoReason.textContent = note;
}
function autoRoyale(): void {
  autoTimer = setTimeout(() => {
    autoRoyale(); // first: a round that ends the game stops it (syncAuto)
    if (!reveal && canOrder()) playRound([...royale!.bot_order(me())]);
  }, AUTO_DELAY_MS);
}
autoButton.addEventListener('click', () => {
  const on = !autoPlay;
  stopAuto();
  autoPlay = on;
  autoGame = royale ?? engine;
  if (autoPlay) royale ? autoRoyale() : void botTurn();
  refresh();
});

// The replay bar (#793): first, previous, next, last, a slider and Live step through every position of the move log,
// view only (blocked() refuses every move meanwhile). Left and Right step, Left also opens it, Escape is Live.
const replayButton = document.getElementById('replay') as HTMLButtonElement;
const replayBar = document.getElementById('replay-bar')!;
const replaySlider = document.getElementById('replay-slider') as HTMLInputElement;
const liveGame = (): Engine | Encounter => replaying?.live ?? engine;
const shownPly = (): number => replaying?.ply ?? history.length;
function showPly(ply: number): void {
  stopAuto(); // the bot does not play on while the player looks back (#792)
  replaying ??= { live: engine, ply };
  replaying.ply = ply;
  engine = ply === history.length ? replaying.live : engineAt(history, ply, makeGame);
  selected = [];
  keyDir = -1;
  hint.clear();
  skipEjections();
  refresh();
  analyse(); // the bar shows this position's evaluation, not the last live one (#1038)
}
function leaveReplay(): void {
  if (replaying) engine = replaying.live;
  replaying = null;
}
function liveAgain(): void {
  leaveReplay();
  refresh();
  analyse(); // back on the live position, the bar follows it again (#1038)
}
function stepReplay(step: ReplayStep): void {
  showPly(stepPly(shownPly(), step, history.length));
}
function syncReplay(): void {
  if (hub || royale) leaveReplay();
  replayButton.hidden = Boolean(hub || royale);
  replayButton.disabled = history.length === 0;
  replayBar.hidden = replaying === null;
  replaySlider.max = String(history.length);
  replaySlider.value = String(shownPly());
  document.getElementById('replay-label')!.textContent = replayLabel(shownPly(), history.length);
}
replayButton.addEventListener('click', () => {
  moveModes('outside'); // the Replay button sits in the Game modes menu (#1612): a press closes it
  showPly(history.length);
});
for (const step of ['first', 'prev', 'next', 'last'] as const) {
  document.getElementById(`replay-${step}`)!.addEventListener('click', () => stepReplay(step));
}
document.getElementById('replay-live')!.addEventListener('click', liveAgain);
for (const [id, label, key] of [['replay-prev', 'Previous move', 'Left'], ['replay-next', 'Next move', 'Right'], ['replay-live', 'Back to the live game', 'Esc']] as const) {
  const button = document.getElementById(id)!;
  button.title = keyTip(label, key); // a key is named on a keyboard only (#1379)
  if (id !== 'replay-live') button.setAttribute('aria-label', button.title);
}
replaySlider.addEventListener('input', () => showPly(Number(replaySlider.value)));
addEventListener('keydown', (e) => {
  const step = replayKey(e.key, replaying !== null, history.length > 0);
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement; // the slider steps by itself
  if (!step || typing || openWorld.active || hub || royale || reading || freeCam.active || e.altKey || e.ctrlKey || e.metaKey) return; // not the Open world's arrows (#1063)
  e.preventDefault();
  if (step === 'live') liveAgain();
  else stepReplay(step);
});

// The bot, the boss, the evaluation bar or the hint got no answer from its worker (#736): the game must not wait for it.
function botFailed(): void {
  hud(` · The bot could not answer: press New game`);
  syncHint();
}

/** The bot's search in a plain game or a run's fight (#1611): BOT_NODES grown with the bosses beaten, along the run in a run, times the difficulty
 * setting. The Trainer keeps the fixed budget, and so does a test budget (?nodes). */
function gameNodes(): number {
  const grows = budget === BOT_NODES;
  const base = grows && !trainer ? progressBudget(budget, difficulty, Object.keys(loadMedals(store)).length) : scaleBudget(budget, difficulty);
  return run ? fightBudget(run.map, run.state, grows ? runNodes(run.map, run.state, base) : base) : base;
}

/** The estimated rating and level of the bot in a game it scales in (a plain bot game or a run's fight), or of a boss from its own search budget
 * (#1611); none for the Trainer, a wild marble, an online game that is no boss and the map of a run. The tooltip says it is an estimate; the test
 * hook is the number. */
function ratingLine(): string {
  if (firstRun === 'match') return `<span class="bot-rating">${PRACTICE_BOT}</span>`; // the weak first bot has no rating (#1663)
  const boss = fight && engine instanceof Encounter ? engine : null; // a boss, co-op and duel ones too, rated by its own search budget at the percent the bot searches it at (#1611)
  if (!boss && (!worker || fight || online || trainer || wildFrom || (run && !run.state.fighting))) return '';
  const nodes = boss ? boss.node_budget(online ? 100 : (run && actBoss(run.map, run.state, boss_ids())?.percent) || DIFFICULTY_PERCENT[difficulty]) : gameNodes(); // online: shown, not scaled
  document.body.dataset.botRating = String(ratingOfBudget(nodes));
  return `<span class="bot-rating" title="${BOT_NOTE}">${boss ? bossLine(nodes) : botLine(nodes)}</span>`;
}

async function botTurn(): Promise<void> {
  if (online || replaying || thinking || engine.status() !== 0) return;
  const bots = worker !== null && engine.to_move() === BOT_SIDE;
  const auto = autoPlay && !bots; // the player's side, played by the bot (#792)
  const mover = worker ?? botWorker;
  if ((!bots && !auto) || !mover) return;
  thinking = true;
  syncHint(); // no hint while the bot thinks
  const current = fight;
  const game = liveGame();
  const started = performance.now();
  const world = wildFrom ?? lairFrom; // a fight the Open world started that brought special marbles or relics: the bot searches the board the page plays (#1655)
  const build = world && fightArmed(world) ? world : null;
  const normal = wildFrom ? Math.min(WILD_NODES, budget) : gameNodes(); // an elite searches more (#800); a wild marble a modest fixed search (#1511)
  const searchBudget = trainer ? trainerBudget(trainer.wave, normal) : normal; // past a full army, the bot searches more (#1159)
  const diffPercent = (run && actBoss(run.map, run.state, boss_ids())?.percent) || DIFFICULTY_PERCENT[difficulty]; // an act boss at its act's strength
  let move: number[];
  try {
    // An auto-played move comes no sooner than AUTO_DELAY_MS after the last, so the game can be followed and stopped.
    [move] = await Promise.all([
      bots && firstRun === 'match' ? firstBotMove(engine.legal_moves(), history.length) : askBot(mover, history, searchBudget, fight ?? undefined, diffPercent, auto, wildFrom && build ? FULL_ARMY : run?.state.army, build ? build.placed : run?.state.placed, wildFrom && build ? wildFoes(build.relics) : run ? foesFor(run.map, run.state) : undefined, trainer ? { wave: trainer.wave, left: MARBLES - trainer.lost } : undefined, build ? relicsMask(build.relics) : run ? relicMask(run.state) : undefined),
      auto ? new Promise((done) => setTimeout(done, AUTO_DELAY_MS)) : undefined,
    ]);
  } catch {
    if (liveGame() === game) {
      thinking = false; // the worker cannot answer (#736); a replaced game has nothing to say
      botFailed();
    }
    return;
  }
  diag.botSearch(performance.now() - started, current ? { boss: current.id } : { nodes: searchBudget });
  if (liveGame() !== game) return; // Retry, a new fight, New game or an import replaced the game while the bot was thinking
  if (!auto) thinking = false;
  whenSettled(() => {
    if (auto) {
      thinking = false; // an auto-played move keeps the board shut to clicks until it is played
      if (!autoPlay) return void refresh(); // turned off while the bot thought
    }
    if (auto && run?.state.fighting) run.state = { ...run.state, auto: true }; // a run that used Auto-play is marked (#1542)
    playMove(move);
    if (firstRun === 'match') nudgePush();
    if (bots && turnBack(engine.to_move(), PLAYER, engine.status(), replaying !== null)) playCue('turn-start', AFTER_SLIDE); // the bot has answered
    refresh();
    void botTurn(); // the other side's reply, or the next auto-played move
  });
}

// Moved marbles slide to their new cell. A click or a bot reply during a slide waits for its end.
// The marbles settle with a squash (#1560) for SQUASH_MS after the slide, which holds nothing back: `landed` is set when the slide ends.
let slide: { game: Engine | Encounter; tracks: SlideTrack[]; start: number; landed?: boolean } | null = null;
const afterSlide: (() => void)[] = [];
// The slide of a replaced game (an import, New game, Retry, a new fight, going online) holds nothing back: what
// would wait for it would be dropped with it at the next frame (#371).
const sliding = (): boolean => slide?.game === engine && !slide.landed;
function whenSettled(fn: () => void): void {
  if (sliding()) afterSlide.push(fn);
  else fn();
}

/** Draws the marble flattened (#1560): about the board plane, its contact point staying on the board, whatever its roll. */
const squashed = new THREE.Matrix4();
function squashMarble(marble: THREE.Object3D, { y, xz }: { y: number; xz: number }): void {
  marble.matrixAutoUpdate = y === 1;
  if (y === 1) return;
  marble.matrix.makeScale(xz, y, xz).setPosition(marble.position.x, marble.position.y - MARBLE_RADIUS * (1 - y), marble.position.z).multiply(squashed.makeRotationFromQuaternion(marble.quaternion));
  marble.matrixWorldNeedsUpdate = true;
}

function animateSlides(now: number): void {
  const current = slide;
  if (!current) return;
  const stale = current.game !== engine; // Retry, a new fight or going online ends the slide
  const elapsed = now - current.start;
  for (const track of stale ? [] : current.tracks) {
    const p = slideAt(track, elapsed);
    const i = cellIndex(track.cell[0], track.cell[1]);
    const on = marbleAt.get(i) ?? [];
    for (const obj of on) {
      obj.position.x = p.x;
      obj.position.z = p.z;
    }
    if (on[0]) {
      turnMarble(on[0], rolledTurn(track, elapsed, turnAt(i)));
      squashMarble(on[0], squashAt(track, elapsed));
    }
  }
  if (!stale && elapsed < SLIDE_MS) return;
  if (!current.landed) {
    current.landed = true; // the slide is over for the input: the squash that follows holds nothing back
    delete document.body.dataset.sliding;
    if (stale) afterSlide.length = 0; // what waited belongs to the old game
    for (const fn of afterSlide.splice(0)) whenSettled(fn);
  }
  if (slide === current && (stale || elapsed >= SLIDE_MS + SQUASH_MS)) slide = null; // not one a waiting move just began
}

// Marbles leaving the board: pushed one cell out over the rim, they fall, tumble, stretch and fade
// into the void, then are removed. Reduced motion: a plain fade. A click or a key ends the effect at
// once, and the effect never holds the next move.
interface Ejecting {
  holder: THREE.Group; // its x axis is the pull, so its scale stretches the marble along the pull
  tumble: THREE.Group; // in the holder: the roll and the twist
  mesh: THREE.Mesh; // in the tumble, turned so the marble starts with its own turn on the board (#364)
  track: EjectTrack;
  start: number;
  skipped: boolean;
}
const ejecting: Ejecting[] = [];
function playMove(record: number[]): void {
  leaveReplay(); // a bot reply or a peer's move shows the live game
  if (fight && history.length === 0) tallyAttempt(store, fight.id); // the first move makes the attempt: a fight opened and left is not one (#1538)
  const before = Array.from(engine.board());
  const army = built() ? engine : null;
  const specials = army ? parseSpecials(army.specials()) : [];
  const fuses = army ? parseFuses(army.fuses()) : [];
  engine.play(Int32Array.from(record));
  // What the ply did to the special marbles (#1490), read from the engine's own result.
  const cues = army ? specialCues(before, specials, fuses, parseMoves(record)[0]!, army.board(), parseSpecials(army.specials())) : null;
  afterPlay(before, record, true, cues?.pulls);
  const spark = sparkBurst(before, specials, parseMoves(record)[0]!);
  const reduced = reducedMotion();
  if (spark && !reduced) ringAt(spark, 3, 'spark-burst', false, 'sparks');
  for (const cell of reduced ? [] : cues?.bursts ?? []) ringAt(cell, 9, 'bomb-burst', false, 'bombs');
  for (const cell of cues?.flashes ?? []) ringAt(cell, 8, 'shield-flash', reduced, 'shields');
  const back = cues?.returns[0]; // the Medic comes back: it drops onto its row as the Dual Room's marble (#947)
  if (back && !reduced) {
    drop = { cell: back, start: performance.now(), reduced, y: dropAt(0, reduced).y };
    document.body.dataset.medics = String(Number(document.body.dataset.medics ?? 0) + 1); // read by the e2e tests
  }
  if (!online && (!fight || stalkerSaved()) && !run && !trainer && !wildFrom && !firstRun) void saves.save(savedGame(), engine.status() !== 0); // a wild fight is not the local game (#1511)
  if (run?.state.fighting) runMoved();
  analyse();
}

// `live` false: a move replayed by a catch-up shows at once, without its ejection effect and sound (#232).
function afterPlay(before: number[], record: number[], live = true, pulls: Pull[] = []): void {
  history.push(record);
  if (engine.passed()) diag.passed(engine.passed(), history.length); // the move log keeps the pass (#1301)
  const mv = parseMoves(record)[0]!;
  revealed.clear();
  lastLanding = fogged() && engine.to_move() === PLAYER ? landing(mv) : []; // the bot's move, shown for one turn
  if (live && worker !== null && !fight && !fogged() && engine.to_move() === PLAYER) botMoved = { game: engine, len: history.length, text: botMoveNote(mv, pushedMarbles(before, mv)) }; // a core is not a marble of yours; a new game has a new engine, so an old note never shows in it
  const reduced = reducedMotion();
  // The Magnetizer's repulsions (#645): the move slides to the board before the first one, then each plays in turn.
  const repulsions = live && !reduced && engine instanceof Encounter ? parseRepulsions(engine.repulsions()) : [];
  // The Pulsar's pulse (#675): the move slides to the board before the pulse, then the pulse plays.
  const pulse = live && engine instanceof Encounter ? parsePulse(engine.last_pulse(), engine.board().length) : null;
  // The Assembly Line's belts: the move slides to the board before them, then they carry the marbles.
  const carries = live && engine instanceof Encounter ? parseCarries(engine.last_belts()) : [];
  const beltBoard = carries.length > 0 ? beforeBelts(engine.board(), carries) : null;
  // The Unstable Core's overloads, collapse and shockwave (#751): the move slides to the board before them first.
  const unstable = live && engine instanceof Encounter ? parseEvents(engine.last_unstable()) : null;
  // The Echo's bonus plies (#958): the move slides to the board before them, then each slides in turn. Reduced motion:
  // the board shows at once, as for any move.
  const bonuses = live && !reduced && engine instanceof Encounter ? parseMoves(engine.last_bonuses()) : [];
  // `boards[0]` is the board after the move, `boards[k + 1]` the one after bonus `k`, the last one the engine's.
  const boards = bonuses.length === 0 ? [] : [boardAfter(before, mv)];
  bonuses.forEach((bonus, k) => boards.push(k + 1 < bonuses.length ? boardAfter(boards[k]!, bonus) : Array.from(engine.board())));
  const after = repulsions[0]?.board ?? pulse?.board ?? beltBoard ?? unstable?.board ?? boards[0] ?? engine.board();
  const tracks = slideTracks(before, after, mv, reduced);
  const held = gameTurns(); // first: a new game starts its own. Kept for the ejected marble, whose cell is taken
  turns.map = carryTurns(held, fight?.seed ?? 0, tracks, mv.dir);
  // A Magnet's pull (#1490): the pulled marble slides with the move, rolling the way it is pulled.
  for (const pull of pulls) {
    const slid = pullTrack(pull, reduced);
    turns.map = carryTurns(turns.map, fight?.seed ?? 0, [slid], pull.dir);
    tracks.push(slid);
  }
  if (!live) return;
  if (pulls.length > 0 && !reduced) document.body.dataset.pulls = String(Number(document.body.dataset.pulls ?? 0) + pulls.length); // read by the e2e tests
  lastMoveStart = NaN;
  lastMovePlaying = true;
  delete document.body.dataset.repulsions;
  if (tracks.some((t) => t.durationMs > 0)) {
    slide = { game: engine, tracks, start: performance.now() };
    document.body.dataset.sliding = '1';
  }
  document.body.dataset.knock = String(sfx.knock(mv.cells.length, pushedCells(before, mv).length - mv.cells.length, columnOf(mv.cells)) ?? 'none'); // the knock's pitch in Hz, read by the e2e tests (#289)
  startPasses(before, mv, reduced);
  if (repulsions.length > 0) {
    // Each repulsion slides from its board to the next one's, the last to the engine's; then the engine's own tells.
    const game = engine;
    const steps = [...repulsions, { board: Array.from(engine.board()), poles: Array.from((engine as Encounter).polarities()) }];
    shown = { game, ...steps[0]! };
    whenSettled(() => {
      repulsions.forEach((rep, k) => whenSettled(() => repel(game, rep, steps[k + 1]!)));
      whenSettled(() => {
        shown = null;
        refresh();
      });
    });
  }
  if (bonuses.length > 0) {
    const game = engine;
    shown = { game, board: boards[0]!, poles: [] };
    bonuses.forEach((bonus, k) => whenSettled(() => slideBonus(game, boards[k]!, boards[k + 1]!, bonus)));
    whenSettled(() => {
      shown = null;
      refresh();
    });
  }
  if (pulse) {
    shown = { game: engine, board: pulse.board, poles: [] };
    whenSettled(() => firePulse(pulse, reduced));
  }
  if (unstable) {
    shown = { game: engine, board: unstable.board, poles: [] };
    whenSettled(() => fireUnstable(unstable, reduced));
  }
  // The Dual Room (#947, #955): the marble coming back drops onto its cell, the bridge comes down at the 5th ejection.
  const landed = engine instanceof Encounter ? parseReturn(engine.last_return()) : null;
  if (landed) {
    drop = { cell: landed.cell, start: performance.now(), reduced, y: dropAt(0, reduced).y };
    document.body.dataset.returns = String(Number(document.body.dataset.returns ?? 0) + 1); // read by the e2e tests
  }
  if (!reduced && engine instanceof Encounter && parseDual(engine.dual())?.bridged && dualShown?.bridged === false) {
    const fall = { start: Infinity }; // the bridge waits up high until the push's slide is over
    lowering = fall;
    whenSettled(() => (fall.start = performance.now()));
    document.body.dataset.bridge = 'lowering'; // read by the e2e tests
  }
  ejectBy(before, after, mv, held, reduced);
  // The Overseer's vents (#635): the push slides first, then each marble they burnt sinks into its vent, a core they
  // pulled in from the next cell rolls into it first (#1241).
  delete document.body.dataset.burns;
  const vents = engine instanceof Encounter ? parseCells(engine.incinerators()) : [];
  const burns = vents.length > 0 ? parseBurns((engine as Encounter).removed()) : [];
  const won = fight?.id === 'overseer' && engine instanceof Encounter && engine.result() === 1;
  if (burns.length > 0) whenSettled(() => burn(burns, vents, reduced, history.length, won));
  // The defeated Overseer (#789): after the last burn its pedestal blows up like the martyr, then it says its farewell.
  if (won && overseerBlown !== engine) {
    overseerBlown = engine;
    whenSettled(() => {
      explode([0, 0], reduced, { text: FAREWELL, hold: TAUNT_HOLD_MS, angry: false });
      overseerDrawn.overseer = null;
      overseerPedestal!.visible = false;
    });
  }
  if (beltBoard) {
    shown = { game: engine, board: beltBoard, poles: [] };
    whenSettled(() => fireBelts(carries, beltBoard, reduced));
  }
  // The Choir removes its weakest army (#747): the push slides first, then the army's marbles sink where they stood.
  delete document.body.dataset.sunk;
  const sunk = fight?.id === 'choir' ? parseBurns((engine as Encounter).removed()) : [];
  if (sunk.length > 0) whenSettled(() => sink(sunk, reduced));
  // The Chaplain's martyr (#748): the board shows the converted marbles at once, the flash and shards play over them.
  const boom = fight?.id === 'chaplain' && engine instanceof Encounter ? parseBlast(engine.removed()) : null;
  if (boom) whenSettled(() => explode(boom, reduced));
}

/** The removed army: each marble sinks into its cell, or fades with reduced motion. */
function sink(marbles: Burn[], reduced: boolean): void {
  document.body.dataset.sunk = String(marbles.length); // read by the e2e tests
  for (const { cell, side } of marbles) startEjection(marbleMesh(side), burnTrack(cell, reduced), scene);
}

/** The explosion at `cell` (the Chaplain's martyr, the defeated Overseer): a flash and a ring of shards, a static flash with
 * reduced motion, then the bubble says `then`. */
function explode(cell: Axial, reduced: boolean, then?: Speech): void {
  const p = axialTo3D(cell[0], cell[1]);
  const group = Object.assign(new THREE.Group(), { name: 'martyr-blast' });
  group.position.set(p.x, 0.36, p.z);
  const flash = new THREE.Mesh(blastFlashGeometry, blastFlashMaterial);
  const shards = reduced ? [] : Array.from({ length: BLAST_SHARDS }, () => new THREE.Mesh(blastShardGeometry, blastShardMaterial));
  group.add(flash, ...shards);
  scene.add(group);
  blast = { group, flash, shards, start: performance.now(), reduced, then };
  drawBlast(0);
  document.body.dataset.explosions = String(Number(document.body.dataset.explosions ?? 0) + 1); // read by the e2e tests
  document.body.dataset.exploding = '1';
}

/** Draws the explosion `elapsedMs` in, and takes it away once it is over. */
function drawBlast(elapsedMs: number): void {
  const at = blastAt(elapsedMs, blast!.reduced);
  blast!.flash.scale.setScalar(at.flashRadius);
  blastFlashMaterial.opacity = at.flashOpacity;
  blastShardMaterial.opacity = at.shardOpacity;
  blast!.shards.forEach((shard, k) => {
    const angle = (2 * Math.PI * k) / BLAST_SHARDS;
    shard.position.set(Math.cos(angle) * at.shardRadius, at.shardLift, Math.sin(angle) * at.shardRadius);
    shard.rotation.set(elapsedMs / 150 + k, elapsedMs / 200, 0);
  });
  if (!at.done) return;
  scene.remove(blast!.group);
  const { then } = blast!;
  blast = null;
  delete document.body.dataset.exploding;
  if (then) say(then); // the Overseer's farewell types once its marble is gone (#789)
}

/** The burns of a ply at `ply`: each marble sinks into its vent of `vents`, or fades with reduced motion; a burnt core angers the Overseer, unless it is the last one: its farewell has priority (#789). */
function burn(burns: Burn[], vents: Axial[], reduced: boolean, ply: number, won: boolean): void {
  document.body.dataset.burns = String(burns.length); // read by the e2e tests
  if (!won && burns.some((b) => b.side === CORE_CODE)) say({ text: angryLine(fight!.seed, ply), hold: ANGRY_HOLD_MS, angry: true }); // #741
  for (const { cell, side } of burns) startEjection(side === CORE_CODE ? coreMesh() : marbleMesh(side), burnTrack(cell, reduced, ventOf(cell, vents)), scene);
}

/** The ejection `mv` makes from the board `before` to `after`, if any (see `eject`). */
function ejectBy(before: number[], after: ArrayLike<number>, mv: Move, held: Map<number, Quat>, reduced: boolean): void {
  const ejection = findEjection(before, after, mv);
  if (ejection) eject(ejection, mv.dir, held, reduced);
}

/** The effect and sound of `ejection`, pushed off in direction `dir`, the marble with its turn in `held`. */
function eject(ejection: NonNullable<ReturnType<typeof findEjection>>, dir: number, held: Map<number, Quat>, reduced: boolean): void {
  const body = document.body;
  body.dataset.ejections = String(Number(body.dataset.ejections ?? 0) + 1);
  body.dataset.sound = sfx.ejection(ejection.side, glassOf()) ?? 'none'; // read by the e2e tests: toll, clack or none
  const track = ejectTrack(ejection.cell, dir, reduced);
  const mesh = marbleMesh(ejection.side);
  turnMarble(mesh, inHolder(turnOf(held, fight?.seed ?? 0, cellIndex(...ejection.cell)), trackAt(track, 0).yaw));
  startEjection(mesh, track, scene);
  if (!reduced) startBlood(track);
  if (!reduced) {
    kick = { start: performance.now() }; // the camera punches and shakes (#1560)
    body.dataset.kick = 'on'; // read by the e2e tests
  }
}

// The camera kick of an ejection (#1560, kick.ts): `drawnKick` is the one the last frame was drawn with, the picture the pointer sees.
let kick: { start: number } | null = null;
let drawnKick: Kick = REST;
function driveKick(now: number): Kick {
  if (!kick) return REST;
  const elapsed = now - kick.start;
  if (elapsed >= KICK_MS) endKick();
  return kickAt(elapsed, reducedMotion());
}
function endKick(): void {
  kick = null;
  delete document.body.dataset.kick;
}

/** Slides the Echo's bonus move `bonus` of `game` from the board `from` to `to` (#958), as a move slides; an ejected
 * marble falls. A replaced game drops what waits for its slide. */
function slideBonus(game: Engine | Encounter, from: number[], to: number[], bonus: Move): void {
  const held = gameTurns();
  const tracks = slideTracks(from, to, bonus, false);
  turns.map = carryTurns(held, fight!.seed, tracks, bonus.dir);
  ejectBy(from, to, bonus, held, false);
  shown = { game, board: to, poles: [] };
  refresh();
  slide = { game: engine, tracks, start: performance.now() };
  document.body.dataset.sliding = '1';
  document.body.dataset.bonusSlides = String(Number(document.body.dataset.bonusSlides ?? 0) + 1); // read by the e2e tests
}

/** Plays repulsion `rep` of `game` (#645): the pair slides apart with the lines it pushes to the board `to`, its glyphs
 * fade out (#671), an ejected marble falls. A replaced game drops what waits for its slide. */
function repel(game: Engine | Encounter, rep: Repulsion, to: { board: number[]; poles: number[] }): void {
  const held = gameTurns();
  const tracks: SlideTrack[] = [];
  const spent: { cell: Axial; sign: number }[] = []; // the pair, whose glyphs fade out
  for (const half of repulsionMoves(rep.pair)) {
    const moved = slideTracks(rep.board, to.board, half, false);
    // The member's own track comes first; a member pushed off the board has none, as its line is itself alone.
    const sign = rep.poles[cellIndex(...half.cells[0]!)]!;
    spent.push(...moved.slice(0, 1).map((t) => ({ cell: t.cell, sign })));
    turns.map = carryTurns(turns.map, fight!.seed, moved, half.dir); // a Magnetizer fight
    tracks.push(...moved);
    const ejection = findEjection(rep.board, to.board, half);
    if (ejection) eject(ejection, half.dir, held, false);
  }
  shown = { game, ...to };
  refresh();
  for (const { cell, sign } of spent) fadeGlyph(cell, sign);
  slide = { game: engine, tracks, start: performance.now() };
  document.body.dataset.sliding = '1';
  document.body.dataset.repulsions = String(Number(document.body.dataset.repulsions ?? 0) + 1); // read by the e2e tests
}

/** The glyph `sign` of a pair member, drawn on its marble that slides to `cell` and fading out with the slide: the pair
 * loses its polarities (#671). */
function fadeGlyph(cell: Axial, sign: number): void {
  const sprite = Object.assign(new THREE.Sprite(glyphMaterials.get(sign)!.clone()), { renderOrder: 2 });
  const p = axialTo3D(...cell);
  sprite.position.set(p.x, 0.86, p.z);
  sprite.scale.setScalar(0.34);
  marbles.add(sprite);
  onMarble(cellIndex(...cell), sprite);
  fading.push({ sprite, start: performance.now() });
}

/** Fades the glyphs of a spent pair out over the slide, then drops them. */
function fadeGlyphs(now: number): void {
  for (const f of fading.slice()) {
    const t = Math.min(1, (now - f.start) / SLIDE_MS);
    f.sprite.material.opacity = 1 - t;
    if (t < 1) continue;
    f.sprite.removeFromParent();
    f.sprite.material.dispose();
    fading.splice(fading.indexOf(f), 1);
  }
}

/** Plays the pulse of the last ply (#675): the ring grows from the pulsar, the pushed marbles slide a cell and the ones
 * past the rim fall, then the engine's board shows. It waits for the move's slide, so a replaced game drops it. */
function firePulse(pulse: Pulse, reduced: boolean): void {
  const after = Array.from(engine.board());
  const held = gameTurns();
  const tracks = slideTracks(pulse.board, after, pulseMove(pulse), reduced);
  turns.map = carryTurns(turns.map, fight!.seed, tracks, pulse.id); // a Pulsar fight
  for (const ejection of fallen(pulse)) eject(ejection, pulse.id, held, reduced);
  shown = null;
  refresh();
  if (tracks.some((t) => t.durationMs > 0)) {
    slide = { game: engine, tracks, start: performance.now() };
    document.body.dataset.sliding = '1';
  }
  if (shock) scene.remove(shock.mesh);
  shock = { mesh: new THREE.Mesh(shockGeometry, shockMaterial), id: pulse.id, start: performance.now(), reduced, skipped: false };
  scene.add(shock.mesh);
  drawShock(0);
  document.body.dataset.pulses = String(Number(document.body.dataset.pulses ?? 0) + 1); // read by the e2e tests
  document.body.dataset.pulsing = '1';
}

/** Plays what the last ply's hook did (#751): a ring bursts where a marble overloaded or fell with the core, the
 * shoved marbles slide a cell and the ones past the rim fall, the wedge's slice sweeps outward; then the engine's board
 * shows. It waits for the move's slide, so a replaced game drops it. */
function fireUnstable(events: UnstableEvents, reduced: boolean): void {
  const held = gameTurns();
  const tracks = shoveTracks(events, reduced);
  for (const track of tracks) turns.map = carryTurns(turns.map, fight!.seed, [track], track.dir);
  for (const { cell, side, dir } of shoved(events)) eject({ cell, side }, dir, held, reduced);
  const lost = lostCells(events);
  for (const cell of lost) {
    const p = axialTo3D(...cell);
    const material = new THREE.MeshBasicMaterial({ color: WARN_COLOR, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = Object.assign(new THREE.Mesh(shockGeometry, material), { name: 'burst' });
    mesh.position.set(p.x, 0.3, p.z);
    scene.add(mesh);
    bursts.push({ mesh, start: performance.now(), reduced, skipped: false });
  }
  document.body.dataset.bursts = String(Number(document.body.dataset.bursts ?? 0) + lost.length); // read by the e2e tests
  shown = null;
  refresh();
  if (tracks.some((t) => t.durationMs > 0)) {
    slide = { game: engine, tracks, start: performance.now() };
    document.body.dataset.sliding = '1';
  }
  if (events.wedge >= 0) {
    sweep = { mesh: new THREE.Mesh(wedgeSlice(events.wedge), sweepMaterial), start: performance.now(), reduced, skipped: false };
    sweep.mesh.position.y = 0.02;
    scene.add(sweep.mesh);
    drawSweep(0);
    document.body.dataset.shockwaves = String(Number(document.body.dataset.shockwaves ?? 0) + 1); // read by the e2e tests
  }
}

/** A ring in the colour of the special type `kind` over `cell`, drawn as the Core's bursts: a Spark thrown off bursts from
 * its last cell (#961), a Bomb from where it stood (#1490), a Shield that holds a push flashes (#1490, `reduced`: a flash
 * in place, not a ring that grows). `count` is the counter of the e2e tests. */
function ringAt(cell: Axial, kind: number, name: string, reduced: boolean, count: 'sparks' | 'bombs' | 'shields'): void {
  const p = axialTo3D(...cell);
  const material = new THREE.MeshBasicMaterial({ color: SPECIAL_LOOKS[kind - 1]!.color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = Object.assign(new THREE.Mesh(shockGeometry, material), { name });
  mesh.position.set(p.x, 0.3, p.z);
  scene.add(mesh);
  bursts.push({ mesh, start: performance.now(), reduced, skipped: false });
  document.body.dataset[count] = String(Number(document.body.dataset[count] ?? 0) + 1); // read by the e2e tests
}

/** Draws the bursts and the sweep `elapsedMs` into their effects, and takes them away once they are over. */
function animateUnstable(now: number): void {
  for (const b of bursts.slice()) {
    const at = burstAt(b.skipped ? Infinity : now - b.start, b.reduced);
    b.mesh.scale.setScalar(at.radius);
    (b.mesh.material as THREE.MeshBasicMaterial).opacity = at.opacity;
    if (!at.done) continue;
    scene.remove(b.mesh);
    (b.mesh.material as THREE.Material).dispose();
    bursts.splice(bursts.indexOf(b), 1);
  }
  if (sweep) drawSweep(now - sweep.start);
  if (unstableShown?.core) energyMaterial.opacity = energyGlow(now / 1000, unstableShown.collapsing, reducedMotion());
  if (unstableShown && unstableShown.wedge >= 0) wedgeGlowMaterial.opacity = wedgeGlow(now / 1000, reducedMotion());
}

function drawSweep(elapsedMs: number): void {
  const at = sweepAt(sweep!.skipped ? Infinity : elapsedMs, sweep!.reduced);
  sweep!.mesh.scale.setScalar(at.scale);
  sweepMaterial.opacity = at.opacity;
  if (!at.done) return;
  scene.remove(sweep!.mesh);
  sweep = null;
}

/** Draws the Unstable Core's marks (#751): the energy cells while the core stands, the pips over the charged marbles and
 * the announced wedge. Nothing in the other fights. */
function drawUnstable(core: Core | null, charges: Charge[]): void {
  unstableShown = core && { ...core, pips: charges };
  if (!core) return;
  if (core.core) {
    for (const cell of ENERGY) {
      const p = axialTo3D(...cell);
      const hex = Object.assign(new THREE.Mesh(energyGeometry, energyMaterial), { name: 'energy-cell' });
      hex.position.set(p.x, 0.006, p.z);
      marbles.add(hex);
    }
  }
  for (const { cell, n } of charges) {
    const p = axialTo3D(...cell);
    for (const dx of pipOffsets(n)) {
      const pip = Object.assign(new THREE.Mesh(pipGeometry, n >= WARN_CHARGES ? warnMaterial : pipMaterial), { name: 'charge-pip' });
      pip.position.set(p.x + dx, 0.9, p.z);
      marbles.add(pip);
      onMarble(cellIndex(...cell), pip);
    }
  }
  if (core.wedge >= 0) {
    const glow = Object.assign(new THREE.Mesh(wedgeSlice(core.wedge), wedgeGlowMaterial), { name: 'wedge-glow' });
    glow.position.y = 0.012;
    marbles.add(glow);
  }
}

/** Draws The Dual Room's bridge and the mark of an announced return (#947, #955). Nothing in the other fights. */
function drawDual(state: DualState | null): void {
  if (dualShown?.bridged !== state?.bridged) lowering = lowering && state?.bridged ? lowering : null;
  dualShown = state;
  placeBridge(lowering ? bridgeAt(performance.now() - lowering.start, false).y : 0);
  if (state) document.body.dataset.bridge = state.bridged ? (lowering ? 'lowering' : 'up') : 'void'; // read by the e2e tests
  else delete document.body.dataset.bridge;
  const dim = otherRoom(state);
  dim.forEach(([q, r], k) => {
    const p = axialTo3D(q, r);
    roomDim.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, 0.004, p.z)); // on the disc's top face, as the Stalker's veil
  });
  roomDim.instanceMatrix.needsUpdate = true;
  if (dim.length > 0) marbles.add(roomDim);
  if (state?.room != null) document.body.dataset.dualRoom = state.room === 0 ? 'south' : 'north'; // read by the e2e tests
  else delete document.body.dataset.dualRoom;
  if (!state?.coming) return;
  const p = axialTo3D(...state.coming.cell);
  const mark = Object.assign(new THREE.Mesh(markGeometry, markMaterials[state.coming.side === glassOf() ? 0 : 1]), { name: 'return-mark' });
  mark.position.set(p.x, 0.008, p.z);
  marbles.add(mark);
}

/** Brings the bridge down and drops the returning marble, `now` into the animation loop. */
function animateDual(now: number): void {
  if (lowering) {
    const at = bridgeAt(now - lowering.start, false);
    placeBridge(at.y);
    if (at.done) {
      lowering = null;
      document.body.dataset.bridge = 'up';
    }
  }
  if (drop) {
    const at = dropAt(now - drop.start, drop.reduced);
    drop.y = at.y;
    for (const obj of marbleAt.get(cellIndex(...drop.cell)) ?? []) {
      obj.userData.dropBase ??= obj.position.y;
      obj.position.y = (obj.userData.dropBase as number) + at.y;
    }
    if (at.done) drop = null;
  }
}

/** Draws the shockwave `elapsedMs` into the pulse, and takes it away once it is over. */
function drawShock(elapsedMs: number): void {
  const at = shockAt(shock!.id, shock!.skipped ? Infinity : elapsedMs, shock!.reduced);
  shock!.mesh.position.set(at.x, 0.05 + neonTell.lift, at.z);
  shock!.mesh.scale.setScalar(Math.max(at.radius, 0.01));
  shockMaterial.opacity = at.opacity;
  if (!at.done) return;
  scene.remove(shock!.mesh);
  shock = null;
  delete document.body.dataset.pulsing;
}

/** Gives `mesh` and its parts materials of their own, to fade: transparent, the opacity they had kept in `userData.opacity`
 * (the glass is see-through before it fades). */
function fadable(mesh: THREE.Object3D): THREE.Material[] {
  const own: THREE.Material[] = [];
  mesh.traverse((o) => {
    const material = ((o as THREE.Mesh).material as THREE.Material).clone();
    material.transparent = true;
    material.depthWrite = false; // the core stays seen through the fading glass
    material.userData.opacity = material.opacity;
    (o as THREE.Mesh).material = material;
    own.push(material);
  });
  return own;
}

/** Plays the belts of the last ply (#744): the marbles they carry slide a cell, the ones that reach the end roll off and
 * fall, the ones a press struck sink under it. It waits for the move's slide, so a replaced game drops it. */
function fireBelts(carries: Carry[], before: number[], reduced: boolean): void {
  const after = Array.from(engine.board());
  const held = gameTurns();
  const tracks: SlideTrack[] = [];
  for (const mv of beltMoves(carries)) {
    const moved = slideTracks(before, after, mv, reduced);
    turns.map = carryTurns(turns.map, fight!.seed, moved, mv.dir);
    tracks.push(...moved);
  }
  for (const { cell, side, dir } of fellOff(carries)) eject({ cell, side }, dir, held, reduced);
  const struck = struckBy(carries);
  shown = null;
  refresh();
  if (tracks.some((t) => t.durationMs > 0)) {
    slide = { game: engine, tracks, start: performance.now() };
    document.body.dataset.sliding = '1';
  }
  if (struck.length > 0) burn(struck, [], reduced, history.length, false);
  if (!reduced) for (const { cell } of struck) pressOn(cell);
  document.body.dataset.beltTurns = String(Number(document.body.dataset.beltTurns ?? 0) + 1); // read by the e2e tests
}

/** A press: the box of the room, or the gantry of the boss kit on the terrace, whose base is the mesh's origin (`userData.base` below the box's centre). */
function pressMesh(name: string): THREE.Mesh {
  const gantry = terraceProp('press');
  const mesh = Object.assign(new THREE.Mesh(gantry ? gantry.geometry : pressGeometry, gantry ? gantry.material : pressMaterial), { name });
  mesh.userData.base = gantry ? 0.14 : 0;
  return mesh;
}

/** The press comes down on `cell`. */
function pressOn(cell: Axial): void {
  const p = axialTo3D(...cell);
  const mesh = pressMesh('belt-slam');
  mesh.position.set(p.x, slamAt(0, false).y - mesh.userData.base, p.z);
  scene.add(mesh);
  slams.push({ mesh, start: performance.now(), skipped: false });
  document.body.dataset.slams = String(Number(document.body.dataset.slams ?? 0) + 1); // read by the e2e tests
}

function animateSlams(now: number): void {
  for (const s of slams.slice()) {
    const at = slamAt(s.skipped ? Infinity : now - s.start, false);
    s.mesh.position.y = at.y - s.mesh.userData.base;
    if (!at.done) continue;
    scene.remove(s.mesh);
    slams.splice(slams.indexOf(s), 1);
  }
}

/** Starts the effect of the ejected marble `mesh` along `track`, in `parent`: the scene, or the battle royale arena at
 * its own scale (#612). */
function startEjection(mesh: THREE.Mesh, track: EjectTrack, parent: THREE.Object3D, delayMs = 0): void {
  fadable(mesh);
  const tumble = new THREE.Group();
  tumble.add(mesh);
  const holder = new THREE.Group();
  holder.add(tumble);
  parent.add(holder);
  const e: Ejecting = { holder, tumble, mesh, track, start: performance.now() + delayMs, skipped: false }; // waits on its cell
  drawEjection(e, 0);
  ejecting.push(e);
  document.body.dataset.ejecting = track.kind; // read by the e2e tests: tumble, or fade with reduced motion
}

/** Draws an ejected marble `elapsedMs` into its effect, true once the effect is over. */
function drawEjection(e: Ejecting, elapsedMs: number): boolean {
  const p = trackAt(e.track, elapsedMs, e.skipped);
  e.holder.position.set(p.x, 0.36 - p.drop, p.z);
  e.holder.rotation.y = p.yaw;
  e.holder.scale.set(p.along, p.across, p.across);
  e.tumble.rotation.set(p.twist, 0, -p.roll); // rolling forward, the top turns toward the pull: negative z
  e.mesh.traverse((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material;
    material.opacity = material.userData.opacity * p.opacity;
  });
  return p.done;
}

// The blood spatter of an ejection (issue #278): a stylised spatter just past the steel frame, drawn from
// blood.ts. It never covers a cell, a marble or the frame, ends by itself, and a click or a key ends it at once.
const BLOOD_COLOR = 0xbd2a20; // 3.3:1 on the void (#0b0d0f), brighter than the rust it replaces, still not the UI danger red
const DROP_SIZE = 1.6; // world units: big enough to count at 1280x720, still a droplet
interface Bleeding {
  points: THREE.Points;
  stain: THREE.Mesh;
  from: { x: number; z: number };
  dir: { x: number; z: number };
  start: number;
  skipped: boolean;
}
const bleeding: Bleeding[] = [];

function startBlood(track: EjectTrack): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BLOOD_DROPS * 3), 3));
  const material = new THREE.PointsMaterial({ color: BLOOD_COLOR, size: DROP_SIZE, transparent: true, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  // The stain: a flat disc on the void just under the rim, its own mesh so it can grow and fade.
  const stain = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: BLOOD_COLOR, transparent: true, depthWrite: false }),
  );
  stain.rotation.x = -Math.PI / 2;
  scene.add(points, stain);
  const b: Bleeding = { points, stain, from: track.from, dir: track.dir, start: performance.now(), skipped: false };
  drawBlood(b, 0);
  bleeding.push(b);
  document.body.dataset.blood = 'spatter'; // read by the e2e tests
}

/** Draws a spatter `elapsedMs` into its effect, true once it is over. */
function drawBlood(b: Bleeding, elapsedMs: number): boolean {
  const t = b.skipped ? BLOOD_MS : elapsedMs;
  const drops = bloodAt(b.from, b.dir, t, false);
  if (drops.length === 0) return true;
  const position = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  drops.forEach((d, i) => position.setXYZ(i, d.x, d.y, d.z));
  position.needsUpdate = true;
  (b.points.material as THREE.PointsMaterial).opacity = drops[0]!.alpha;
  const stain = bloodStainAt(b.from, b.dir, t, false)!;
  b.stain.position.set(stain.x, 0.01, stain.z);
  b.stain.scale.setScalar(stain.radius);
  (b.stain.material as THREE.MeshBasicMaterial).opacity = stain.alpha;
  return false;
}

function animateEjections(now: number): void {
  for (const e of ejecting.slice()) {
    if (!drawEjection(e, now - e.start)) continue;
    e.holder.removeFromParent();
    e.mesh.traverse((o) => ((o as THREE.Mesh).material as THREE.Material).dispose());
    ejecting.splice(ejecting.indexOf(e), 1);
  }
  if (ejecting.length === 0) delete document.body.dataset.ejecting;
  for (const b of bleeding.slice()) {
    if (!drawBlood(b, now - b.start)) continue;
    scene.remove(b.points, b.stain);
    b.points.geometry.dispose();
    (b.points.material as THREE.Material).dispose();
    b.stain.geometry.dispose();
    (b.stain.material as THREE.Material).dispose();
    bleeding.splice(bleeding.indexOf(b), 1);
  }
  if (bleeding.length === 0) delete document.body.dataset.blood;
}

// Skip: a click or a key jumps the effect to its end, then goes on to do its usual job.
function skipEjections(): void {
  for (const e of ejecting) e.skipped = true;
  for (const b of bleeding) b.skipped = true;
  endKick(); // a press picks on the resting picture, which the next frame draws
  for (const p of passing) p.skipped = true;
  for (const s of slams) s.skipped = true;
  if (shock) shock.skipped = true;
  for (const b of bursts) b.skipped = true;
  if (sweep) sweep.skipped = true;
  animateEjections(performance.now());
  animatePasses(performance.now());
  animateSlams(performance.now());
  if (shock) drawShock(0);
  animateUnstable(performance.now());
}
addEventListener('pointerdown', skipEjections, { capture: true });
addEventListener('keydown', skipEjections, { capture: true });
// A press, a key or a turn of the wheel ends the entrance beat on the final framing and the full light at once (#1551): nothing waits for it.
const snapEntrance = (): void => {
  if (entrance.snap()) applyView();
};
addEventListener('pointerdown', snapEntrance, { capture: true });
addEventListener('keydown', snapEntrance, { capture: true });
addEventListener('wheel', snapEntrance, { capture: true, passive: true });

let selected: Axial[] = [];
let keyDir = -1; // the direction picked with Q W E A S D for the selected group, -1 for none (#738)
let ringed: Axial[] = []; // the marbles drawn with the selection ring, read by the e2e tests
let targets: ReturnType<typeof groupTargets> = []; // the cells drawn with a target arrow, read by the e2e tests
let freeTargets: ReturnType<typeof groupTargets> = []; // the targets of the Echo's free moves, with a diamond (#958)

// The medal of a won boss fight (#791), earned once per fight: hud() runs again on every refresh. Solo, daily and co-op
// fights all come here, so every peer of a co-op win gets the medal.
let medalSeen: { game: unknown; note: string } = { game: null, note: '' };
let winSeen: unknown = null; // the game whose win the story counted, once per game: hud() runs again on every refresh (#1584)
function winOnce(): void {
  if (winSeen === engine) return;
  winSeen = engine;
  storyEvent({ on: 'win' });
}
function medalNote(boss: { id: string }): string {
  if (medalSeen.game !== engine) {
    const turns = playerTurns(history.length);
    const result: MedalResult = recordMedal(store, boss.id, turns);
    tallyWin(store, boss.id);
    storyEvent({ on: 'won', id: boss.id }); // before the lore of the win is chosen: the stage counts this win (#1584)
    if (epilogueDue(store, storyStage(store))) openEpilogue(); // the win that reaches stage 7 (#1546)
    medalSeen = { game: engine, note: medalLine(result, result === 'kept' ? bestTurns(store, boss.id)! : turns) };
    if (lairFrom) void openWorld.loaded.saves.beat(lairFrom.seed, lairFrom.lair); // the lair is beaten in the Open world too (#1170)
    if (lairFrom) openWorld.loaded.peers.lairWon(lairFrom.seed, lairCells(lairFrom.seed)[lairFrom.lair]!); // and seen beaten by the other heroes (#1305)
  }
  return medalSeen.note;
}

// The HUD, and the lobby controls after it: their state (shown, a lobby waiting) is set while the HUD is drawn (#1044).
let hudEjected: readonly [number, number] | undefined; // ejected counts of the last HUD render (#1095)
const legend = new Legend(store); // the kinds of special marble met in earlier fights (#1541)
let specialHover: Axial | null = null; // the special marble under a mouse pointer, whose card the HUD shows (#1541)
let specialTapped = 0; // the kind whose legend line was pressed: a touch screen has no hover (#1541)
const sameCell = (a: Axial, b: Axial): boolean => a[0] === b[0] && a[1] === b[1];
/** The legend of the special marbles on the board, those not met in an earlier fight, and the card of the marble hovered or of the line pressed. */
function specialsHtml(): string {
  const marks = marksOn(engine.board(), engine.specials());
  const mark = marks.find((m) => specialHover && sameCell(m.cell, specialHover)) ?? marks.find((m) => m.kind === specialTapped);
  const turns = mark && parseFuses(engine.fuses()).find((f) => sameCell(f.cell, mark.cell))?.turns; // only a Bomb has a fuse
  return legendHtml(legend.fresh([...new Set(marks.map((m) => m.kind))].sort((a, b) => a - b)), mark ? { kind: mark.kind, text: cardText(mark.kind, mark.side, turns) } : null);
}
/** The pointer is over `cell`, or off the board: the card shows while it is over a special marble. */
function hoverSpecial(cell: Axial | null): void {
  const over = cell && built() && marksOn(engine.board(), engine.specials()).some((m) => sameCell(m.cell, cell)) ? cell : null;
  if (over === specialHover) return;
  specialHover = over;
  hud();
}
let copiedNote: { game: unknown } | undefined; // Copy of the daily result card was pressed on this game: every HUD redraw keeps the note (#1295)
function hud(extra = ''): void {
  drawHud(extra);
  syncLobby();
}
/** The lore of a boss win (#1589): its entry in the box of the audio log's place, filed in the log archive, none once the fight is over or left.
 * An entry above the stage of the story is held back (#1584): the sealed line shows in its place, and the archive lists the entry once its stage is reached. */
function showLore(lore: { id: string; title: string; body: string; stage: number } | undefined): void {
  document.getElementById('lore')!.hidden = !lore;
  if (!lore) return void delete document.body.dataset.lore;
  const shown = lore.stage > storyStage(store) ? SEALED : lore;
  document.getElementById('lore-title')!.textContent = shown.title;
  document.getElementById('lore-body')!.textContent = shown.body;
  document.body.dataset.lore = shown === SEALED ? 'sealed' : lore.id; // read by the e2e tests
  markRead(store, lore.id);
}
function drawHud(extra = ''): void {
  delete document.body.dataset.botRating; // set again by the note of a game the bot scales in
  syncReplay();
  wildFlee.hidden = !wildFrom || engine.status() !== 0; // Flee for the whole fight, not once it is over (#1511)
  syncExit();
  if (hub || royale) document.getElementById('boss-bar')!.hidden = true; // no boss there (#814)
  if (hub || royale) showLore(undefined);
  if (hub) {
    delete document.body.dataset.over; // no end light over the hub
    document.getElementById('hud')!.innerHTML = hub.hud();
    return;
  }
  if (royale) return royaleHud(royale);
  const status = engine.status();
  const ejected = [engine.ejected(1), engine.ejected(2)] as const;
  const win = [engine.win_ejections(1), engine.win_ejections(2)] as const;
  const opening = shownPly() === 0 && status === 0;
  const flavour = opening ? tallyLine({ mode: fight ? 'boss' : online ? 'online' : worker ? 'bot' : 'local', boss: fight?.id, stage: storyStage(store) }) : '';
  sawLines(flavour); // the line of the story at the start of a match (#1585), kept in the ledger whatever the plate shows
  // The plate's subtitle: a match says who plays and the goal (#1568); a boss fight and the first run keep Tally's line.
  const scripted = firstRun === 'open' || firstRun === 'match'; // the first run keeps Tally's line, its coach note explains it (#1521)
  const tally = opening && !fight && !scripted ? matchLine({ mode: online ? 'online' : run ? 'run' : trainer ? 'trainer' : worker ? 'bot' : 'local', win: win[0] }) : flavour;
  const moves = run?.state.fighting ? movesLine(run.map, run.state) : ''; // the budget and the count of the act in a fight (#1473), the map has its own
  // End banner (#282): body[data-over] carries the animation id for the CSS and the e2e tests.
  const end = endBanner({
    status,
    reason: engine.draw_reason(),
    mode: fight ? 'boss' : online ? 'online' : worker ? 'bot' : 'local', // a co-op fight is a boss fight on the HUD (#530)
    side: online ? (online.role === 'player' ? online.side : 0) : fight || worker ? 1 : 0,
    glass: glassOf(),
  });
  if (end && (fight || worker || online?.role === 'player') && !replaying) endCue(engine, end.anim, AFTER_EJECTION);
  if (end?.anim === 'win' && (fight || worker || online?.role === 'player') && !replaying) winOnce(); // the wins of any mode, a hot seat and a spectator apart (#1584)
  if (locked && firstWinGame(end?.anim, { bot: worker !== null, fight: fight !== null, run: run !== null, trainer: trainer !== null, online: online !== null, wild: wildFrom !== null, replaying: replaying !== null, undone })) unlockFirstWin(); // the first win against the bot opens the other modes (#1665)
  if (firstRun === 'match' && status !== 0) finishFirstMatch(end?.anim);
  if (end?.anim === 'win' && fight) {
    const note = medalNote(fight); // a won fight: Black is the player's side. The story is at the stage this win reaches before its line is chosen (#1546)
    const won = bossEndLine(fight.id, 'win', storyStage(store))!;
    sawLines(won);
    end.line = `${won} ${note}`;
  } else if (end?.anim === 'loss' && fight && status !== 3) end.line = bossEndLine(fight.id, 'loss', storyStage(store))!; // each boss has its own (#1546)
  showLore(end?.anim === 'win' && fight ? bossLore(fight.id) : undefined); // the entry of the boss beaten, in the archive too (#1589)
  if (end?.anim === 'win' && wildFrom) end.line = `${end.line} ${wildWon(wildFrom)}`;
  const thrown = end && (wildFrom ?? lairFrom) ? wildThrown((wildFrom ?? lairFrom)!) : ''; // a special marble thrown off is lost (#1655)
  if (end && thrown) end.line = `${end.line} ${thrown}`.trim();
  if (end && trainer && status === 1 && engine.draw_reason() !== 0) Object.assign(end, { title: 'Stalled', line: 'A draw costs a marble.' }); // not "You win" (#1159)
  if (end) document.body.dataset.over = end.anim;
  else delete document.body.dataset.over;
  document.getElementById('hud')!.innerHTML = hudHtml({
    was: hudEjected,
    end: end ?? undefined,
    side: engine.to_move(),
    status,
    glass: glassOf(),
    score: formatScore(ejected, win, status, engine.draw_reason(), glassOf()),
    runScore: run?.state.fighting && engine instanceof Engine ? runScoreHtml(engine.board(), ejected, win) : undefined, // an army fight of a run reads the army, not both sides' ejections (#1540)
    ejected,
    win,
    rating: ratingLine(),
    note: `${run ? runLine(run.map, run.state) : ''}${moves && ` · ${moves}`}${built() ? fuseNote(parseFuses(engine.fuses())) : ''}${trainer ? ` · ${trainerNote(trainer)}` : ''}${stalkerBoss() ? sightNote() : ''}${passNote(engine.passed(), glassOf())}${onlineNote}${online ? '' : offlineNotice}${extra}${copiedNote?.game === engine ? ' · result copied' : ''}`, // the other notes start with ' · '
    online: onlineLine,
    // Co-op (#530): a seated player's human ply is its own or the partner's, the boss turn reads as in solo.
    turn: online?.role === 'player' && duel ? duelTurn(online.side, online.ourTurn()) : online?.role === 'player' && fight && engine.to_move() === COOP_SIDE ? coopTurn(online.ourTurn()) : undefined,
    // Tally's line at the start of a match, the same mode as the end banner (#294).
    botMove: botMoved?.game === engine && botMoved.len === history.length && status === 0 ? botMoved.text : '',
    tallyNote: firstRun === 'match' ? COACH.tally : '', // the first Tally line explained once, under it (#1521)
    tally,
    // Who asked for a rematch, for the seated players of a finished online game (#186), a Retry in co-op (#531).
    rematch:
      online?.role !== 'player' || status === 0
        ? ''
        : fight
          ? retryText(online.askedRematch(online.ourSeat), online.askedRematch(3 - online.ourSeat))
          : rematchText(online.side, online.askedRematch(online.side), online.askedRematch(3 - online.side), glassOf()),
  });
  if (run) {
    document.getElementById('hud')!.insertAdjacentHTML('beforeend', relicBarHtml(run.state)); // the relic bar (#1457)
    document.getElementById('hud')!.insertAdjacentHTML('beforeend', affinityBarHtml(run.state)); // and the affinities (#1471)
    // The tactic bar (#1460): in the army's fights and the act bosses' that take the build, none enabled during the placement or a replay.
    if (run.state.fighting && built()) {
      const mask = placing(run.state) || replaying !== null ? 0 : engine.tactics();
      document.getElementById('hud')!.insertAdjacentHTML('beforeend', tacticBarHtml(run.state, mask, swapping));
      document.getElementById('hud')!.insertAdjacentHTML('beforeend', specialsHtml());
    }
    document.body.dataset.tactics = run.state.tactics.join(','); // read by the e2e tests
    document.body.dataset.auto = String(run.state.auto);
  }
  hudEjected = ejected; // the next render moves only the pips that are new (#1095)
  rematchButton.hidden = online?.role !== 'player' || status === 0 || duel; // spectators never see it, nor a duel yet (#1316)
  rematchButton.disabled = !online?.canRematch(); // asked already, or the opponent is gone
  exportButton.hidden = importButton.hidden = online !== null || fight !== null || run !== null || trainer !== null; // local games only (#219)
  syncHint();
  // The goal is shown once (#1032): the Goal sheet holds it while open, the HUD line only before the first move.
  const sheetOpen = goalOpen && engine instanceof Encounter && status === 0;
  const showGoal = goalShown(shownPly(), sheetOpen);
  goalButton.hidden = !(engine instanceof Encounter) || status !== 0; // once the fight is over the plate has no room for another row (#271)
  goalButton.disabled = shownPly() === 0; // the goal is on the plate until the first move
  goalButton.setAttribute('aria-expanded', String(sheetOpen));
  goalSheet.hidden = !sheetOpen;
  if (sheetOpen) {
    const card = goalCardHtml(fight?.id); // The Echo has a card (#1524), the other bosses a line
    if (card) goalSheet.innerHTML = card;
    else goalSheet.textContent = (engine as Encounter).goal();
  }
  const boss = engine instanceof Encounter ? engine : null;
  if (boss) {
    // The vents note (#741): the change that starts burning the player's marbles, shown for 2 plies.
    const phase = boss.phase();
    if (!replaying && cueWatch.phase.changed(boss, phase)) playCue('phase', AFTER_EJECTION);
    if (phaseSeen.game !== engine) phaseSeen = { game: engine, phase, since: -1 };
    else if (phaseSeen.phase !== phase) {
      phaseSeen = { game: engine, phase, since: boss.incinerators().length > 0 && startsBurningPlayer(phaseSeen.phase, phase) ? shownPly() : -1 };
    }
  }
  const tell = boss
    ? [
        crackText(parseCracks(boss.cracks())),
        eggText(parseEggs(boss.eggs())),
        trainText(parseTrains(boss.trains())),
        beltText(parseBelts(boss.belts())),
        pulseText(parsePulsar(boss.pulsar())),
        ballastText(boss.ballast_next()),
        firedText(parseFired(boss.ballast_fired())),
        coreText(parseCore(boss.unstable())),
        dualText(parseDual(boss.dual()), 1),
        swarmText(parseSwarm(boss.swarm()), boss.win_ejections(2)),
        toxinText(boss.turns_left()),
        ventNote(phaseSeen.since, shownPly()),
        fight?.id === 'magnetizer' ? polarityText(boss.phase(), shownPly()) : '',
        chaplainText(exposed, boss.converted().length / 2),
        martyrText(parseMartyr(boss.martyr())),
        choirText(boss.next_army(), armiesLeft(parseArmies(boss.armies()))),
        freeText(parseMoves(boss.free_moves()).length, freeTargets.length > 0, fight?.id === 'echo' && !showGoal && status === 0), // the rule stays once the goal card is gone (#1674), not once the fight is over: the plate has no room for it (#271, #1686)
      ]
        .filter((t) => t !== '')
        .join(' · ')
    : '';
  if (boss) {
    if (boss.result() === 1 && fight) recordWin(store, fight.id); // a boss win opens the lift onto the next deck (#520); a fight left by the exit of the dock is recorded already (#1517)
    document.getElementById('hud')!.insertAdjacentHTML(
      'beforeend',
      bossHtml({
        phase: boss.phase(),
        phases: boss.phases(),
        result: end ? 0 : boss.result(), // the end banner already says Victory or Defeat, one line less in the plate
        goal: showGoal ? boss.goal() : '',
        card: showGoal ? goalCardHtml(fight?.id) : '',
        tell,
        // The daily line, or the attempt of a co-op room (#531).
        daily: fight?.daily ? dailyLine(fight.daily.day, fight.daily.attempt) : online ? (duel ? DUEL_LINE : attemptLine(online.attempt)) : '',
      }),
    );
  }
  // The Swarm's bar holds the 40 turns of its evac clock, one fragment breaks per boss reply, two per swarm ejection (#1266).
  const turns = boss && parseSwarm(boss.swarm());
  const health = turns ? { ejected: SWARM_TURNS - turns.left, win: SWARM_TURNS } : { ejected: engine.ejected(1), win: engine.win_ejections(1) };
  drawBossBar(document.getElementById('boss-bar')!, boss ? { name: boss.name(), ...health, steps: Array.from(boss.phase_ejections()), phase: boss.phase() } : null);
  drawChoirChips(document.getElementById('boss-bar')!, boss ? choirChips(parseArmies(boss.armies()), boss.next_army()) : null);
  if (flatHud) {
    const flat = { phase: boss?.phase() ?? 0, phases: boss?.phases() ?? 0, tell };
    document
      .getElementById('hud')!
      .insertAdjacentHTML('beforeend', flatHudHtml({ side: engine.to_move(), status, glass: glassOf(), ejected, win, boss: boss ? flat : undefined }));
  }
  if (rankedMode === '1v1') {
    // Our report is signed and sent once, the opponent's comes over the session; the result is rated when both are in (#1317).
    if (status !== 0 && !rankedSent && online) {
      rankedSent = true;
      const board = Array.from(engine.board()).join(',');
      void online.report({ hash: board, status, rating: loadRankedProfile(store).rating1v1 }).then((report) => {
        rankedMine = report;
        settleRankedPair();
      });
    }
    const result = rankedDone ? rankedResult : status !== 0 ? 'waiting' : undefined;
    const waiting = online?.presenceOf(3 - online.side) === 'waiting';
    const queueWindow = waiting ? toleranceWindow(Date.now() - rankedQueuedAt) : undefined;
    document.getElementById('hud')!.insertAdjacentHTML('beforeend', rankedHudHtml(loadRankedProfile(store).rating1v1, { queueWindow, delta: rankedDelta, result }));
  }
  showResultCard();
  showTrainerCard();
}

/** The Swarm's rings on the cells of the next wave, and the evac's light over the whole board once it is won. */
function drawSwarm(board: ArrayLike<number>, swarm: SwarmState | null): void {
  swarmShown = swarm;
  for (const [q, r] of swarm?.cells ?? []) {
    const p = axialTo3D(q, r);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, arrivalMaterial), { name: 'swarm-mark' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.02, p.z);
    marbles.add(ring);
  }
  document.body.dataset.swarmMarks = (swarm?.cells ?? []).map((c) => c.join(',')).join(' '); // read by the e2e tests
  const won = swarm !== null && (engine as Encounter).result() === 1;
  if (!won) evac = null;
  else if (evac?.game !== engine) evac = { game: engine, start: performance.now(), reduced: reducedMotion(), light: 0, lift: 0, done: false };
  if (!evac) return;
  BOARD_CELLS.forEach(([q, r], k) => {
    const p = axialTo3D(q, r);
    evacGlow.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, 0.005, p.z)); // on the disc's top face, as the veil
  });
  evacGlow.count = board.length;
  evacGlow.instanceMatrix.needsUpdate = true;
  marbles.add(evacGlow);
  liftEvac(board, evac);
}

/** The evac as it is now: the light over the board, the player's marbles lifted. */
function liftEvac(board: ArrayLike<number>, at: NonNullable<typeof evac>): void {
  Object.assign(at, evacAt(performance.now() - at.start, at.reduced));
  evacMaterial.opacity = 0.55 * at.light;
  for (const [i, objects] of marbleAt) {
    if (board[i] !== PLAYER) continue;
    for (const obj of objects) {
      obj.userData.evacBase ??= obj.position.y;
      obj.position.y = (obj.userData.evacBase as number) + at.lift;
    }
  }
}

/** Stalker's veil over the cells out of range and the rings of the bot's last move in range (#998). */
function drawFog(board: ArrayLike<number>, fog: Set<number>, lit: Set<number>): NonNullable<typeof stalkerShown> {
  const dark = BOARD_CELLS.filter((_, i) => i < board.length && !fog.has(i));
  veil.setColorAt(0, veilTint.setScalar(1)); // makes the instance colours: white leaves the veil as it is
  dark.forEach(([q, r], k) => {
    const p = axialTo3D(q, r);
    veil.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, 0.004, p.z)); // on the disc's top face, as the crack decal
    veil.setColorAt(k, veilTint.setScalar(Math.max(nextToSight(q, r, (a, b) => fog.has(cellIndex(a, b))), neonTell.fogRings))); // the look outlines the sight edge only
  });
  veil.count = dark.length;
  veil.instanceMatrix.needsUpdate = true;
  veil.instanceColor!.needsUpdate = true;
  marbles.add(veil);
  const last = replaying ? [] : lastLanding.filter(([q, r]) => fog.has(cellIndex(q, r)));
  for (const [q, r] of last) {
    const p = axialTo3D(q, r);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, lastMaterial), { name: 'stalker-last' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(cellIndex(q, r), ring);
  }
  for (const i of lit) {
    const p = axialTo3D(...BOARD_CELLS[i]!);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, revealedMaterial), { name: 'stalker-revealed' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(i, ring);
  }
  const cells = (set: Set<number>): Axial[] => [...set].map((i) => BOARD_CELLS[i]!);
  return { visible: cells(fog), drawn: cells(new Set([...fog, ...lit].filter((i) => board[i] === BOT_SIDE))), revealed: cells(lit), last };
}

const PLAYER = 3 - BOT_SIDE;
/** The Stalker boss (#1111): the fog is the engine's, read from its getters. */
const stalkerBoss = (): boolean => fight?.id === 'stalker' && engine instanceof Encounter;
const fogged = stalkerBoss;
/** Only the Stalker fight is saved among the boss fights (#1122), and not the daily: a reload could not tell it was one. */
const stalkerSaved = (): boolean => stalkerBoss() && !fight!.daily;
const savedGame = (): LocalGame => ({ bot: worker !== null, moves: history, ...(undone ? { undone } : {}), ...(stalkerSaved() ? { boss: { id: 'stalker', seed: fight!.seed, mirror: fight!.mirror } } : {}) });
/** The HUD line of the Stalker boss: the sight, and the ejections before it narrows. */
function sightNote(): string {
  const [sight, left] = (engine as Encounter).stalker() as unknown as number[];
  const narrows = left! < 0 ? '' : ` · narrows to ${sight! - 1} after ${left} more ejections`;
  return `Sight ${sight}${narrows}${revealed.size > 0 ? ' · A hidden marble blocks that move: play again' : ''}`;
}
/** The cells the player sees: within the range of its marbles, the sight of the Stalker boss by its phase. */
const sightOf = (board: ArrayLike<number>): Set<number> => visibleCells(board, PLAYER, (engine as Encounter).sight());

// The terrace (#1314): the arena's glTF from Blender, in place of the room in a 1v1 game. A page whose file is missing or broken
// keeps the room; so do the hub, Ballast Mind, the Dual Room, the royale and a run, until their own PRs (#1374); `?scene=room` asks for it.
let terraceReady = false;
let hubProps: HubKit | null = null; // the props of the hub file, put on the rooms of the game's deck (#1374)
/** The boards of the terrace (#1374): the arena's own radius 4 slab, and the slabs of the two bosses whose board is another one. */
const terraceBoards: Record<'arena' | 'ballast' | 'dual' | 'hub' | 'royale', THREE.Group | null> = { arena: null, ballast: null, dual: null, hub: null, royale: null };
const boardOf = (): keyof typeof terraceBoards => (hub ? 'hub' : royale ? 'royale' : fight?.id === 'ballast' || fight?.id === 'dual' ? fight.id : 'arena');
const dishesOf = (board: THREE.Group | null): THREE.InstancedMesh | undefined => board?.getObjectByName('terrace_dishes') as THREE.InstancedMesh | undefined;
/** The dishes of the terrace follow the discs: a vanished cell (Hull's void, a swept Rail Yard line) shows the gap (#1374). */
const syncDishes = (): void => {
  const [list, scale] = royale ? [arenaDiscs, ARENA_SCALE] : [discs, 1]; // the royale's discs stand in the arena group, at half spacing
  const shown = new Set(list.filter((d) => d.visible).map((d) => `${(d.position.x * scale).toFixed(2)},${(d.position.z * scale).toFixed(2)}`));
  dishesOf(terraceBoards[boardOf()])?.userData.show((x: number, z: number) => shown.has(`${x.toFixed(2)},${z.toFixed(2)}`));
};
/** Shows the board of the fight, hides the others. */
const showBoard = (): void => {
  for (const [name, board] of Object.entries(terraceBoards)) if (board) board.visible = name === boardOf();
  const wearsProp = boardOf() !== 'hub'; // the deck's silhouette prop stands by every board but the hub's (#1551)
  sceneRenderer.showDeckProp(wearsProp, frame?.radius ?? RADIUS, innerWidth < innerHeight);
  document.body.dataset.deckProp = String(wearsProp); // read by the e2e tests
};
/** The props of the boss kit (kit_boss.glb) the fights wear on the terrace: the Pulsar's pylon and its core, the Assembly press, the Rail Yard's buffer stop. */
let bossKit: Record<'pylon' | 'core' | 'press' | 'buffer', THREE.Mesh> | null = null;
const terraceProp = (name: keyof NonNullable<typeof bossKit>): THREE.Mesh | null => (sceneRenderer.terraceOn && bossKit ? bossKit[name] : null);
/** The other pieces of the boss kit, one per boss row (bossprops.ts): the fight wears its own, off the dish (#1374). */
const bossPieces = new Map<string, THREE.Mesh>();
let terraceFailed = false; // the arena files did not load: the board stands on a plain background, the discs drawn as they are
const terraceKit: { pedestal: THREE.Mesh | null; marks: Record<'target' | 'arrow' | 'select' | 'last' | 'hint', THREE.Mesh> | null } = { pedestal: null, marks: null };
/** The kit's marks, while the terrace is shown: a legal target and its arrow, the selection ring, the last move's ring (#1314). */
const terraceMarks = (): NonNullable<typeof terraceKit.marks> | null => (sceneRenderer.terraceOn ? terraceKit.marks : null);
/** A mark of the kit on the cell of a mesh the game made: the kit's geometry and vertex colours, flat on the dish, no rotation. */
function wearKit(mesh: THREE.Mesh, kit: THREE.Mesh, y: number): void {
  mesh.geometry = kit.geometry;
  mesh.material = kit.material;
  mesh.rotation.set(0, 0, 0);
  mesh.userData.terrace = true; // a mark, not a marble
  mesh.position.y = y - TERRACE_LIFT; // the marbles' group stands 0.11 higher on the terrace
}
const terraceFile = (name: string) => meshoptLoader().loadAsync(`${import.meta.env.BASE_URL}assets/pbr/${name}.glb`);
let boardRequested = false;
/** The board shows next: a page that opened in the world asks for its files now (#1520), and the canvas stays veiled until the terrace is drawn: not the room, not a blank board. */
function needBoard(): void {
  loadBoard();
  if (!terraceReady) veilCanvas();
}
/** The deck set (#1603), asked for at the first board draw of a page that opened in the Open world: the steel, the plate, the rim and the
 * crack take its maps, then the deck in play its own. The terrace waits for it, so the first frame of the board is dressed. */
function requestDeckSet(): Promise<void> {
  if (deckSetAsked) return Promise.resolve();
  deckSetAsked = true;
  return Promise.all([loadTexture('deck-albedo.ktx2', true, true), loadTexture('deck-roughness.ktx2', false, true), loadTexture('crack-decal.ktx2', false, false), loadTexture('deck-mess-roughness.ktx2', false, true), deckNormalMap(deck)]).then(([albedo, roughness, crack, mess, normal]) => {
    deckAlbedo = albedo;
    deckRoughness = roughness;
    crackDecal = crack;
    messRoughness = mess;
    if (crack) {
      crack.anisotropy = renderer.getMaxAnisotropy();
      crackMaterial.alphaMap = crack;
      crackMaterial.needsUpdate = true;
    }
    sceneRenderer.setDeckMaps(albedo, roughness);
    if (albedo && roughness) {
      // the textured look of the steel, as built at the load: its own colour is white, its roughness the map's
      steel.color.set(0xffffff);
      steel.roughness = 1;
      steel.map = albedo;
      steel.roughnessMap = cellRoughness(deck);
      if (normal) steel.normalMap = normal;
      steel.needsUpdate = true;
    }
    applyDeck(deck, spaceBoss, spaceAct); // the deck's own maps, and the steel dressed above
    dirty = CHANGE_DRAWS;
  });
}
/** Asks for the files of the board once: the bay of the room and the terrace. At the load, or for a page that opened in the Open world, when it is left (#1520). */
function loadBoard(): void {
  if (boardRequested) return;
  boardRequested = true;
  void bayLoad().then(mountBay);
  void Promise.all([Promise.all([terraceFile('arena'), terraceFile('kit-arena'), terraceFile('kit-ring-hint'), terraceFile('kit-boss'), terraceFile('slab-ballast'), terraceFile('slab-dual'), terraceFile('slab-hub'), terraceFile('slab-royale')]), requestDeckSet()])
  .then(([[arena, kit, hint, props, ballast, dual, hubDeck, royaleSlab]]) => {
    const drawn = mergeByMaterial(arena.scene, true, neonLook); // 5 draw calls, not 1,489 nodes
    sceneRenderer.terrace.add(drawn);
    terraceBoards.arena = drawn.getObjectByName('terrace_board') as THREE.Group;
    hubProps = hubKit(withoutHubStaircase(hubDeck.scene));
    for (const [name, file] of [['ballast', ballast], ['dual', dual], ['hub', hubDeck], ['royale', royaleSlab]] as const) {
      if (name === 'royale') file.scene.add(...arena.scene.children.filter((c) => /^scene_post_\d+$/.test(c.name)).map((c) => c.clone())); // its slab stands in the arena's footprint: the arena's six posts frame it (#1374)
      const board = mergeByMaterial(file.scene, false, neonLook);
      board.visible = false;
      sceneRenderer.terrace.add(board);
      terraceBoards[name] = board;
    }
    const prop = (name: string): THREE.Mesh => {
      const mesh = props.scene.getObjectByName(name) as THREE.Mesh;
      mesh.material = terraceMaterial(mesh.material as THREE.Material, mesh.geometry);
      return mesh;
    };
    bossKit = { pylon: prop('kit_prop_pylon'), core: prop('kit_prop_pylon_core'), press: prop('kit_prop_press_gantry'), buffer: prop('kit_prop_buffer_stop') };
    for (const piece of BOSS_PROP_PIECES) bossPieces.set(piece, prop(piece));
    // The black marbles reflect a sky with a window of light and a cool rim, not the room's lamps.
    if (hasReflections(tier, navigator.webdriver)) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      terraceShell.envMap = pmrem.fromScene(terraceEnvironment(), 0, 0.1, 300).texture;
      pmrem.dispose();
    }
    terraceKit.pedestal = kit.scene.getObjectByName('kit_pedestal_flat') as THREE.Mesh;
    if (neonLook) terraceKit.pedestal = neonPedestal(terraceKit.pedestal);
    const pedestals = [marbles, arenaMarbles].map((group) => instanceMarbles(group, terraceKit.pedestal!.geometry, scene)); // the 1v1's and the royale's
    syncPedestals = pedestals;
    const named = (name: string): THREE.Mesh => kit.scene.getObjectByName(name) as THREE.Mesh;
    terraceKit.marks = { target: named('kit_ring_target'), arrow: named('kit_arrow_target'), select: named('kit_ring_select'), last: named('kit_ring_lastmove'), hint: hint.scene.getObjectByName('kit_ring_hint') as THREE.Mesh };
    terraceReady = true;
    refresh();
  })
  .catch(() => {
    terraceFailed = true; // no file, no terrace: never the room (#1374)
    terraceReady = true;
    refresh();
  });
}
if (!bootsInWorld) loadBoard();
// The terrace's own marbles (#1314): near-black with a sharp cool highlight, and warm white with its brightest pixel held at the
// clamp. They stand in for the default skins only: a skin the player chose is worn as it is.
const terraceShell = marbleSheen('black', neonMarbleRim('black', new THREE.MeshPhysicalMaterial({ color: neonLook ? NEON.blackMarble : 0x0a0c0f, roughness: 0.3, metalness: 0, specularIntensity: 0.12, envMapIntensity: 6 }), neonLook)); // #1553: the sky's reflection, both looks; #1552: the cyan rim on the edge, under the look only // the arena sky's reflection leads, the sun's highlight stays small (envMap set when the arena has loaded)
const terraceGlass = marbleSheen('white', neonMarbleRim('white', new THREE.MeshStandardMaterial({ color: neonLook ? NEON.whiteMarble : 0xe8d9b4, emissive: neonLook ? 0x2a2a2a : 0x2a2012, roughness: 0.6, metalness: 0 }), neonLook)); // #1553: the soft rim and the sharper highlight, under the look only // warm ivory: the emissive keeps the hemisphere's blue fill off it, no reflection: the whites take no blue fill
function terraceMarbles(on: boolean): void {
  marbleMaterials[1] = on && skin === DEFAULT_SKIN ? terraceShell : shellMaterial(skin);
  marbleMaterials[2] = on && glass === DEFAULT_GLASS_SKIN ? terraceGlass : glassMaterial(glass);
}
const PHONE_POLAR = (46 * Math.PI) / 180; // pitch 44 on a phone: the horizon enters the top of the frame
const TERRACE_LIFT = 0.11; // the top of a kit pedestal (kit_pedestal_flat)
function syncTableZero(): void {
  const on = tableZeroActive({ room: keepRoom, ready: terraceReady });
  document.body.dataset.scene = on ? 'table-zero' : 'room'; // read by the e2e tests
  document.getElementById('console-entry')!.hidden = !on; // the terrace's console is a Game modes entry, the room's is its screen (#1369)
  terraceMarbles(on);
  showBoard();
  if (on && !(run !== null && !fight) && isDefaultView(view, resetView(4))) {
    view = innerWidth < innerHeight ? { ...TERRACE_VIEW, polar: PHONE_POLAR, distance: neonLook ? 13.8 : 18 } : { ...TERRACE_VIEW }; // the Blender brief's camera, drawn back on a phone so the sky and the horizon show, for the terrace only: any view the player chose stays
    applyView();
  }
  if (on === sceneRenderer.terraceOn) return;
  sceneRenderer.setTerrace(on, tier === 'high'); // the sun's shadow on the high tier (#1364); the room never comes back once the terrace is on (#1374)
  if (neonLook) sceneRenderer.setNeon(); // #1424
  if (neonLook && !sceneRenderer.scene.getObjectByName('sky-glow')) sceneRenderer.scene.add(neonSkyGlow());
  for (const cells of [...boardDrawn, ...arenaDrawn]) cells.visible = terraceFailed; // the dishes of the glTF are drawn; the discs stay for picking only
  marbles.position.y = TERRACE_LIFT; // the marbles stand on their pedestals, 0.11 over the board plane
  if ((hub || royale || blenderBoard()) && view === fitted) {
    view = fitted = fightView(); // the file came after the hub, the royale or the board: the Blender camera, as if it had been there (#1374)
    applyView();
  }
  updateFog();
}
function refresh(): void {
  if (!booted) return; // the page is still booting: the lets declared further down are not initialised yet (#1628)
  if (!replaying && cueWatch.selection.changed(selected)) playCue('selection'); // when the selection changes, not on each redraw
  if (previewed && !previewLive()) dropPreview(); // the selection, the position or the game moved on (#1679)
  syncTableZero();
  dirty = CHANGE_DRAWS;
  syncSpace();
  syncAuto();
  syncQuick();
  if (hub || royale) drawDual(null); // no fight, no void (#947)
  if (hub) {
    const { beaten } = loadProgress(store);
    const props = sceneRenderer.terraceOn ? hubProps : null;
    // On the terrace each room is the Blender file's own prop, standing on the board plane (#1374); else the glyph of the room.
    const glyphOf = props && ((door: Door, options: GlyphOptions) => { const room = createKitGlyph(props, door, options); room.position.y = -TERRACE_LIFT - 0.02; return room; });
    hub.draw(sceneRenderer, discs, sfx, beaten, marbleMesh(glassOf()), drawFrame, lightRim, glyphOf ?? undefined);
    syncDishes();
    const goal = locked ? { text: LOCK_BANNER, deck: null, room: null } : nextGoal(beaten, ranRun(store)); // the next thing to do (#1524); the first win while the lock is on
    hubLabels.innerHTML = labelsHtml(hub.at, beaten, loadMedals(store), goal, locked); // a beaten boss's door shows its medal (#1249)
    document.getElementById('hub-rail')!.innerHTML = railHtml(hub.at.deck, beaten, goal, locked);
    document.getElementById('hub-pips')!.innerHTML = pipsHtml(beaten, loadMedals(store));
    const day = utcDay(Date.now());
    hubBoard.hidden = !hubCoach.hidden; // the notice board waits while the coach line teaches (#1528)
    hubBoard.innerHTML = noticeBoard(store, day, boss_name(dailyFor(day, boss_ids()).id)!, beaten, loadMedals(store), locked);
    placeHubLabels();
    hud();
    return;
  }
  if (royale) return drawRoyale(royale);
  const board = showing()?.board ?? engine.board();
  drawFrame(board);
  lightRim();
  drawNotches();
  drawTally();
  const moves = legalMoves();
  targets = groupTargets(moves, selected);
  // The Echo's free moves (#958): their marbles ringed, the target of a selected group's free move marked by a diamond.
  const free = showing() || !(engine instanceof Encounter) ? [] : parseMoves(engine.free_moves());
  freeTargets = groupTargets(free, selected);
  if (stalkerBoss()) {
    revealed.clear();
    for (const [q, r] of parseCells((engine as Encounter).revealed())) revealed.add(cellIndex(q, r));
  }
  const fog = fogged() ? sightOf(board) : null;
  const lit = replaying ? new Set<number>() : revealed; // a replayed position shows what was seen then
  const hinted = hint.marked(here());
  ringed = [...selected, ...hinted]; // the selection, or the marbles the hint takes (#301)
  const cracks = engine instanceof Encounter ? parseCracks(engine.cracks()) : [];
  const left = crackLeft(cracks);
  const converted = engine instanceof Encounter ? parseCells(engine.converted()) : [];
  const martyr = engine instanceof Encounter ? parseMartyr(engine.martyr()) : null;
  const armies = engine instanceof Encounter ? parseArmies(engine.armies()) : [];
  const next = engine instanceof Encounter ? engine.next_army() : -1;
  const eggs = engine instanceof Encounter ? parseEggs(engine.eggs()) : [];
  trainsShown = engine instanceof Encounter ? parseTrains(engine.trains()) : [];
  const poles = showing()?.poles ?? (engine instanceof Encounter ? Array.from(engine.polarities()) : []);
  const fresh = showing() || !(engine instanceof Encounter) ? [] : parseCells(engine.assigned());
  announceDrawn = showing() || !(engine instanceof Encounter) ? null : parseAnnounce(engine.announce());
  blinking = null;
  delete document.body.dataset.announceBlink;
  marbles.clear();
  marbleAt.clear();
  const wears = sceneRenderer.terraceOn ? bossProp(fight?.id, innerWidth < innerHeight) : null; // one mesh of the kit, one draw call, only for this boss (#1374)
  const piece = wears && bossPieces.get(wears.piece);
  if (wears && piece) {
    const mesh = Object.assign(new THREE.Mesh(piece.geometry, piece.material), { name: 'boss-prop', userData: { terrace: true } }); // a prop, not a marble
    mesh.position.set(wears.x, 0, wears.z);
    marbles.add(mesh);
  }
  crackDecals = [];
  const vents = engine instanceof Encounter ? parseCells(engine.incinerators()) : [];
  overseerDrawn = { overseer: null, cores: [], vents };
  for (const [q, r] of vents) marbles.add(ventAt(axialTo3D(q, r)));
  hazes = !burnsPlayer(engine instanceof Encounter ? engine.phase() : 0) ? [] : vents.flatMap(([q, r], v) => {
    const p = axialTo3D(q, r);
    return Array.from({ length: HAZE_PER_VENT }, (_, j) => {
      const material = new THREE.SpriteMaterial({ map: hazeMap, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = Object.assign(new THREE.Sprite(material), { name: 'vent-haze' });
      sprite.position.set(p.x, 0.5, p.z);
      marbles.add(sprite);
      return { sprite, k: j / HAZE_PER_VENT + v * 0.17 };
    });
  });
  document.body.dataset.haze = String(hazes.length); // read by the e2e tests
  discs.forEach((disc, i) => {
    const [q, r] = BOARD_CELLS[i]!;
    const side = board[i] ?? VANISHED; // ring 5 is off a board of 61 cells (#564)
    disc.visible = side !== VANISHED; // a vanished cell is a hole: no disc, no marble
    if (i === discs.length - 1) syncDishes();
    if (side === VANISHED) return;
    const p = axialTo3D(q, r);
    const plies = left.get(i) ?? 0;
    disc.material = steel;
    if (plies > 0 && crackDecal) {
      const decal = new THREE.Mesh(crackGeometry, crackMaterial); // on the disc's top face, under the ticks
      decal.position.set(p.x, 0.003, p.z);
      marbles.add(decal);
      crackDecals.push([q, r]);
    }
    const target = targets.find(({ cell: [tq, tr] }) => tq === q && tr === r);
    if (target) {
      const ring = new THREE.Mesh(targetRingGeometry, ringMaterial);
      const arrow = new THREE.Mesh(arrowGeometry, targetMaterial);
      ring.rotation.x = -Math.PI / 2; // flat on the cell, facing up
      arrow.rotation.set(-Math.PI / 2, arrowYaw(target.dir), 0, 'YXZ');
      ring.position.set(p.x, 0.005, p.z);
      arrow.position.set(p.x, 0.005, p.z);
      const kit = terraceMarks();
      if (kit) {
        wearKit(ring, kit.target, 0.078);
        wearKit(arrow, kit.arrow, 0.08);
        arrow.material = targetArrowMaterial(neonLook, arrow.material) as THREE.MeshBasicMaterial; // the neon look's near-black arrow (#1508)
        arrow.rotation.y = arrowYaw(target.dir);
      }
      marbles.add(ring, arrow);
      if (freeTargets.some(({ cell: [fq, fr] }) => fq === q && fr === r)) {
        const diamond = Object.assign(new THREE.Mesh(freeGeometry, echoMaterial), { name: 'echo-free-target' });
        diamond.position.set(p.x, 0.3, p.z);
        marbles.add(diamond);
      }
    }
    for (const dx of tickOffsets(plies)) {
      const tick = new THREE.Mesh(tickGeometry, tickMaterial); // on the front edge, clear of the marble
      tick.position.set(p.x + dx, 0.01, p.z + 0.39);
      marbles.add(tick);
    }
    if (side === 0 || (fog && side === BOT_SIDE && !fog.has(i) && !lit.has(i))) return; // Stalker: hidden
    if (side === OVERSEER_CODE) {
      if (overseerBlown === engine) return;
      const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
      overseerPedestal = pedestal;
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.y = 0.86;
      pedestal.add(eye);
      pedestal.position.set(p.x, 0, p.z);
      marbles.add(pedestal);
      overseerDrawn.overseer = [q, r];
      return;
    }
    if (side === CORE_CODE) overseerDrawn.cores.push([q, r]);
    const marble = side === CORE_CODE ? coreMesh() : marbleMesh(side);
    if (converted.some(([cq, cr]) => cq === q && cr === r)) convert(marble);
    marble.position.set(p.x, 0.36, p.z);
    turnMarble(marble, turnAt(i));
    marbles.add(marble);
    if (sceneRenderer.terraceOn && terraceKit.pedestal && side !== CORE_CODE) {
      // one flat disc under each marble, instanced with the others (the kit's pedestal, 0.04 high): the marble stands on it
      const pedestal = new THREE.Mesh(terraceKit.pedestal.geometry, terraceKit.pedestal.material);
      pedestal.position.set(p.x, -TERRACE_LIFT, p.z);
      pedestal.userData.terrace = true;
      marbles.add(pedestal);
    }
    onMarble(i, marble);
    if (ringed.some(([sq, sr]) => sq === q && sr === r)) {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.02, p.z);
      const kit = terraceMarks();
      if (kit) {
        wearKit(ring, kit.select, 0.078);
        // The hint (#301): the marbles it takes wear the kit's own hint ring, a Bone dashed ring on a black underlay (kit_ring_hint).
        if (hinted.some(([hq, hr]) => hq === q && hr === r)) {
          wearKit(ring, kit.hint, 0.091);
          ring.name = 'hint-ring';
        }
      }
      marbles.add(ring);
      marble.position.y = 0.5;
    }
  });
  for (const { cell, army } of armies) {
    const p = axialTo3D(cell[0], cell[1]);
    // Under the neon look the glyph is near black over a Bone outline a third larger (the Chaplain's rule, #1374): it reads on the pale and the dark shell alike.
    const glyph = new THREE.Mesh(armyGlyphs[army], choirInk);
    glyph.position.set(p.x, 0.76, p.z);
    if (army === 1) glyph.rotation.x = Math.PI / 2; // the ring lies flat, read from above
    marbles.add(glyph);
    onMarble(cellIndex(cell[0], cell[1]), glyph);
    if (neonLook) {
      const halo = new THREE.Mesh(armyHalos[army], choirHalo);
      halo.position.copy(glyph.position);
      halo.rotation.copy(glyph.rotation);
      marbles.add(halo);
      onMarble(cellIndex(cell[0], cell[1]), halo);
    }
    if (army !== next) continue;
    const ring = new THREE.Mesh(outlineGeometry, paleMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(cellIndex(cell[0], cell[1]), ring);
  }
  // The special marbles of a rogue-lite fight (#961): each type's glyph in its colour on the marble.
  const specials = built() ? parseSpecials(engine.specials()) : [];
  const fuses = built() ? parseFuses(engine.fuses()) : [];
  for (const { cell, kind } of specials) {
    const p = axialTo3D(...cell);
    const glyph = Object.assign(new THREE.Mesh(specialGlyphs[kind - 1]!, specialInks[kind - 1]!), { name: 'special-mark' });
    glyph.position.set(p.x, 0.36, p.z).add(glyphLift);
    marbles.add(glyph);
    onMarble(cellIndex(...cell), glyph);
    const fuse = fuses.find((f) => f.cell[0] === cell[0] && f.cell[1] === cell[1]);
    if (fuse) {
      const digit = Object.assign(new THREE.Mesh(fuseGlyphs[fuse.turns - 1]!, plusInk), { name: 'bomb-fuse' });
      digit.position.copy(glyph.position).addScaledVector(glyphLift, 0.01); // just over the glyph
      marbles.add(digit);
      onMarble(cellIndex(...cell), digit);
    }
    if (!SPECIAL_LOOKS[kind - 1]!.plus) continue;
    const plus = Object.assign(new THREE.Mesh(plusGlyph, plusInk), { name: 'special-plus' });
    plus.position.copy(glyph.position).addScaledVector(glyphLift, 0.01); // just over the glyph
    marbles.add(plus);
    onMarble(cellIndex(...cell), plus);
  }
  document.body.dataset.specials = specials.map((s) => `${s.cell},${s.kind}`).join(' '); // read by the e2e tests
  document.body.dataset.fuses = fuses.map((f) => `${f.cell},${f.turns}`).join(' '); // read by the e2e tests

  if (martyr) {
    const p = axialTo3D(martyr[0], martyr[1]);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, emberMaterial), { name: 'martyr-ring' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    const glyph = Object.assign(new THREE.Mesh(martyrGlyphGeometry, emberMaterial), { name: 'martyr-glyph' });
    glyph.position.set(p.x, 0.85, p.z);
    marbles.add(ring, glyph);
    onMarble(cellIndex(martyr[0], martyr[1]), ring);
    onMarble(cellIndex(martyr[0], martyr[1]), glyph);
  }
  document.body.dataset.martyr = martyr ? martyr.join(',') : ''; // read by the e2e tests
  // The Echo's bonus plies of the last move (#859): a teal ring on each marble they moved, until the next move.
  const landed = showing() || !(engine instanceof Encounter) ? [] : parseMoves(engine.last_bonuses()).flatMap(landing);
  for (const [q, r] of landed) {
    const p = axialTo3D(q, r);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, echoMaterial), { name: 'echo-landed' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(cellIndex(q, r), ring);
  }
  document.body.dataset.echoLanded = String(landed.length); // read by the tests
  const last = history.at(-1);
  lastMoveRings = showing() || !last || engine instanceof Encounter ? [] : landing(parseMoves(last)[0]!).map(([q, r]) => {
    const p = axialTo3D(q, r);
    const ring = new THREE.Mesh(outlineGeometry, lastMoveMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    const kit = terraceMarks();
    if (kit) {
      wearKit(ring, kit.last, 0.108); // Sodium, from the kit's vertex colours; the pulse still scales it
      ring.position.x = p.x;
      ring.position.z = p.z;
    }
    marbles.add(ring);
    onMarble(cellIndex(q, r), ring);
    return ring;
  });
  document.body.dataset.lastMove = String(lastMoveRings.length); // read by the tests
  const offered = showing() || !(engine instanceof Encounter) ? [] : freeMarbles(parseMoves(engine.free_moves()));
  for (const [q, r] of offered) {
    const p = axialTo3D(q, r);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, echoMaterial), { name: 'echo-free' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(cellIndex(q, r), ring);
  }
  document.body.dataset.echoFree = String(offered.length); // read by the tests
  document.body.dataset.echoFreeTarget = String(freeTargets.length);
  stalkerShown = fog && drawFog(board, fog, lit);
  polesDrawn = poles.flatMap((sign, i) => {
    if (sign === 0) return [];
    const [q, r] = BOARD_CELLS[i]!;
    const p = axialTo3D(q, r);
    const glyph = Object.assign(new THREE.Sprite(glyphMaterials.get(sign)), { renderOrder: 2 });
    glyph.position.set(p.x, 0.86, p.z);
    glyph.scale.setScalar(0.34);
    marbles.add(glyph);
    onMarble(i, glyph);
    const isFresh = fresh.some(([fq, fr]) => fq === q && fr === r);
    if (isFresh) {
      const ring = new THREE.Mesh(outlineGeometry, paleMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, 0.36, p.z);
      marbles.add(ring);
      onMarble(i, ring);
    }
    return [{ cell: [q, r] as Axial, sign, fresh: isFresh }];
  });
  if (announceDrawn) {
    const { cell, sign } = announceDrawn;
    const p = axialTo3D(...cell);
    const indicator = Object.assign(new THREE.Sprite(announceMaterials.get(sign)), { renderOrder: 2, name: 'announce' });
    indicator.position.set(p.x, 1.3, p.z); // over the glyph disc of a marble that will flip
    indicator.scale.setScalar(0.5);
    marbles.add(indicator);
    onMarble(cellIndex(...cell), indicator);
    const ring = Object.assign(new THREE.Mesh(outlineGeometry, announceRingMaterial), { name: 'announce-ring' });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    marbles.add(ring);
    onMarble(cellIndex(...cell), ring);
    blinking = { materials: fadable(marbleAt.get(cellIndex(...cell))![0]!), ring };
  }
  dressEggs();
  eggsDrawn = eggs.map(({ cell: [q, r], left }) => {
    const p = axialTo3D(q, r);
    const egg = Object.assign(new THREE.Mesh(eggGeometry, eggMaterial), { name: 'egg' });
    egg.position.set(p.x, 0, p.z);
    const counter = Object.assign(new THREE.Sprite(counterMaterials[left - 1]), { renderOrder: 2 });
    counter.position.set(p.x, 0.95 + neonTell.plateLift, p.z);
    counter.scale.setScalar(0.42 * neonTell.plate);
    marbles.add(egg, counter);
    if (left === 1) {
      const glow = Object.assign(new THREE.Mesh(eggGlowGeometry, eggGlowMaterial), { name: 'egg-glow' });
      glow.position.set(p.x, 0.004, p.z);
      marbles.add(glow);
    }
    return { cell: [q, r], left, glow: left === 1 };
  });
  for (const train of trainsShown) drawTrack(train);
  drawSwarm(board, engine instanceof Encounter && !showing() ? parseSwarm(engine.swarm()) : null);
  beltsShown = engine instanceof Encounter ? parseBelts(engine.belts()) : null;
  beltRibs = beltsShown ? drawBelts(beltsShown) : [];
  pulsarShown = engine instanceof Encounter ? parsePulsar(engine.pulsar()) : null;
  pulsarCores = pulsarShown ? drawPulsars(pulsarShown) : [];
  ripples = pulsarShown && rippling(pulsarShown) ? Array.from({ length: reducedMotion() ? 1 : RIPPLES }, (_, k) => {
    const { x, z } = pulsarSpot(pulsarShown!.id);
    const ring = Object.assign(new THREE.Mesh(rippleGeometry, rippleMaterials[k]), { name: 'pulsar-ripple' });
    ring.position.set(x, 0.05, z);
    marbles.add(ring);
    return ring;
  }) : [];
  document.body.dataset.ripples = String(ripples.length); // read by the e2e tests
  firedShown = engine instanceof Encounter ? parseFired(engine.ballast_fired()) : null;
  for (const [q, r] of firedShown?.cells ?? []) {
    const { x, z } = axialTo3D(q, r);
    const ring = Object.assign(new THREE.Mesh(firedGeometry, firedMaterial), { name: 'ballast-fired' });
    ring.position.set(x, 0.06, z);
    marbles.add(ring);
  }
  document.body.dataset.fired = String(firedShown?.cells.length ?? 0); // read by the e2e tests
  // The charges belong to the board after the hook: while a move slides to the board before it, none is drawn.
  drawDual(engine instanceof Encounter ? parseDual(engine.dual()) : null);
  drawUnstable(engine instanceof Encounter ? parseCore(engine.unstable()) : null, showing() || !(engine instanceof Encounter) ? [] : parseCharges(engine.charges()));
  const taunt = engine instanceof Encounter ? tauntIndex(engine.turns_left()) : -1; // the Overseer's line of this 20 %
  if (tauntSaid.game !== engine || tauntSaid.index !== taunt) {
    tauntSaid = { game: engine, index: taunt };
    if (taunt >= 0) say({ text: TAUNTS[taunt]!, hold: TAUNT_HOLD_MS, angry: false });
    else {
      speech = null;
      bubbleBox.hidden = true;
    }
  }
  tellSound('crack', cracks);
  tellSound('choir', ARMY_NAMES[next] ? [next] : []);
  // The drones follow how tense the game is (#439): the player's marbles a push could eject, the boss phase.
  const weights = engine instanceof Encounter && !showing() ? parseCharges(engine.charges()) : []; // the Core's weighted push
  sfx.setTension(tensionLevel(rimDanger(board, glassOf(), weights), engine instanceof Encounter ? engine.phase() : 0));
  document.body.dataset.armies = String(armies.length); // read by the e2e tests
  document.body.dataset.nextArmy = ARMY_NAMES[next] ?? '';
  document.body.dataset.converted = String(converted.length); // read by the e2e tests
  document.body.dataset.cracks = String(cracks.length);
  document.body.dataset.eggs = String(eggs.length);
  document.body.dataset.eggCounters = eggs.map((e) => e.left).join(',');
  document.body.dataset.trains = String(trainsShown.length);
  document.body.dataset.trainCounters = trainsShown.map((t) => t.left).join(',');
  document.body.dataset.beltCounter = beltsShown ? String(beltsShown.left) : '';
  document.body.dataset.beltDirs = beltsShown ? beltsShown.belts.map((b) => b.dir).join(',') : '';
  document.body.dataset.beltStrikes = beltsShown ? beltsShown.belts.map((b) => b.strike).join(',') : '';
  document.body.dataset.pulseCounter = pulsarShown && charging(pulsarShown) ? String(pulsarShown.left) : '';
  document.body.dataset.vanished = String(Array.from(board).filter((v) => v === VANISHED).length);
  hud();
  refreshGhosts(moves);
}

/** The rails and sleepers under the line of `train`, out past both edges onto the deck. */
function railsOf(train: Train): THREE.Group {
  const rails = new THREE.Group();
  const span = railSpan(train);
  for (const side of [-0.22, 0.22]) {
    const rail = Object.assign(new THREE.Mesh(railGeometry, railMaterial), { name: 'rail' });
    rail.scale.x = span.length;
    rail.rotation.y = span.yaw;
    rail.position.set(span.x - Math.sin(span.yaw) * side, 0.02, span.z - Math.cos(span.yaw) * side);
    rails.add(rail);
  }
  for (let d = 0.25 - span.length / 2; d < span.length / 2; d += 0.5) {
    const sleeper = new THREE.Mesh(sleeperGeometry, sleeperMaterial);
    sleeper.rotation.y = span.yaw;
    sleeper.position.set(span.x + Math.cos(span.yaw) * d, 0.008, span.z - Math.sin(span.yaw) * d);
    rails.add(sleeper);
  }
  const stop = terraceProp('buffer');
  if (stop) {
    for (const end of [-1, 1]) {
      // the terrace's buffer stop (kit_boss.glb) at each end of the line, its face towards the track
      const post = new THREE.Mesh(stop.geometry, stop.material);
      post.rotation.y = span.yaw + (end > 0 ? 0 : Math.PI);
      post.position.set(span.x + Math.cos(span.yaw) * end * (span.length / 2), 0, span.z - Math.sin(span.yaw) * end * (span.length / 2));
      rails.add(post);
    }
  }
  return rails;
}

/** The tell of an announced train: its rails, its chevrons, and its counter above the entry edge. */
function drawTrack(train: Train): void {
  marbles.add(railsOf(train));
  for (const spot of chevronSpots(train)) {
    const chevron = Object.assign(new THREE.Mesh(chevronGeometry, chevronMaterial), { name: spot.edge ? 'edge-chevron' : 'chevron' });
    chevron.rotation.y = spot.yaw;
    chevron.position.set(spot.x, 0.03, spot.z);
    chevron.scale.setScalar((spot.edge ? 1.5 : 1) * neonTell.chevron);
    marbles.add(chevron);
  }
  const entry = chevronSpots(train)[0]!;
  const counter = Object.assign(new THREE.Sprite(counterMaterials[train.left - 1]), { renderOrder: 2, name: 'train-counter' });
  counter.position.set(entry.x, 0.75, entry.z);
  counter.scale.setScalar(0.5);
  marbles.add(counter);
}

/** The belts of an Assembly Line fight: a strip, two rollers, the plates of the strike slots (the announced one red under
 * its press), the chevrons of a running belt and the centre belt's counter. Returns the ribs to scroll. */
function drawBelts(b: Belts): { belt: Belt; ribs: THREE.Mesh[] }[] {
  const counter = Object.assign(new THREE.Sprite(counterMaterials[b.left - 1]), { renderOrder: 2, name: 'belt-counter' });
  const at = beltCounterSpot(b.belts[0]!);
  counter.position.set(at.x - (sceneRenderer.terraceOn ? 0.8 : 0), at.y, at.z); // on the terrace the plate stands over the roller, inside the rim (#1374)
  counter.scale.setScalar(0.5);
  marbles.add(counter);
  return b.belts.map((belt) => {
    const span = beltSpan(belt);
    const strip = Object.assign(new THREE.Mesh(beltGeometry, beltMaterial), { name: 'belt' });
    strip.scale.x = span.length;
    strip.position.set(span.x, 0.02, span.z);
    marbles.add(strip);
    for (const { x, z } of rollerSpots(belt)) {
      const roller = Object.assign(new THREE.Mesh(rollerGeometry, railMaterial), { name: 'belt-roller' });
      roller.position.set(x, 0.12, z);
      marbles.add(roller);
    }
    const ribs = Array.from({ length: span.length / RIB_SPACING }, () => Object.assign(new THREE.Mesh(ribGeometry, ribMaterial), { name: 'belt-rib' }));
    marbles.add(...ribs);
    for (const { x, z, strike } of plateSpots(belt)) {
      const plate = Object.assign(new THREE.Mesh(plateGeometry, strike ? strikeMaterial : plateMaterial), { name: strike ? 'belt-strike' : 'belt-plate' });
      plate.position.set(x, 0.06, z);
      marbles.add(plate);
      if (!strike) continue;
      const press = pressMesh('belt-press');
      press.position.set(x, slamAt(0, false).y - press.userData.base, z);
      marbles.add(press);
    }
    for (const { x, z, dir } of beltChevrons(belt)) {
      const chevron = Object.assign(new THREE.Mesh(chevronGeometry, chevronMaterial), { name: 'belt-chevron' });
      chevron.rotation.y = arrowYaw(dir);
      chevron.position.set(x, 0.08, z);
      marbles.add(chevron);
    }
    return { belt, ribs };
  });
}

/** Scrolls the ribs of the running belts and swells the red of the announced slot. */
function animateBelts(now: number): void {
  const reduced = reducedMotion();
  for (const { belt, ribs } of beltRibs) {
    const { x, z } = beltSpan(belt);
    ribOffsets(belt, now, reduced).forEach((offset, k) => ribs[k]!.position.set(x + offset, 0.048, z));
  }
  strikeMaterial.emissiveIntensity = 0.8 * strikeBlink(now, reduced);
}

/** The six pulsars of a Pulsar fight, and the charge of the one whose pulse is 2 turns or less away: its core glows,
 * its counter shows beside it and a chevron lies before each of its lines. Returns the cores, which spin. */
function drawPulsars(next: Pulsar): THREE.Mesh[] {
  const ballast = fight?.id === 'ballast'; // only the pulsar of the announced pulse, and none of the radius 4 chevrons (#838)
  return (ballast ? [next.id] : [0, 1, 2, 3, 4, 5]).map((id) => {
    const spot = pulsarSpot(id);
    const lit = id === next.id && charging(next);
    const model = Object.assign(new THREE.Group(), { name: lit ? 'pulsar-charging' : 'pulsar' });
    const [pylon, pylonCore] = [terraceProp('pylon'), terraceProp('core')];
    if (pylon && pylonCore) {
      // The terrace's beacon post (kit_boss.glb): amber, its core spins and glows steady while it charges (#1374).
      model.add(Object.assign(new THREE.Mesh(pylon.geometry, pylon.material), { name: 'pulsar-base' }));
      model.add(Object.assign(new THREE.Mesh(pylonCore.geometry, lit ? pylonCharge : pylonCore.material), { name: 'pulsar-core' }));
    } else {
      PULSAR_PARTS.forEach((part, i) => {
        const material = lit && part.type === 'core' ? chargeMaterial : pulsarMaterials[i];
        const mesh = Object.assign(new THREE.Mesh(pulsarGeometries[i], material), { name: part.id });
        mesh.position.set(...part.position);
        model.add(mesh);
      });
    }
    model.position.set(spot.x, 0, spot.z);
    model.rotation.y = spot.yaw;
    marbles.add(model);
    if (lit) {
      const counter = Object.assign(new THREE.Sprite(counterMaterials[next.left - 1]), { renderOrder: 2, name: 'pulse-counter' });
      const at = counterSpot(id);
      counter.position.set(at.x, at.y, at.z);
      counter.scale.setScalar(PULSE_COUNTER_SIZE);
      marbles.add(counter);
      for (const c of ballast ? [] : pulseChevrons(id)) {
        const chevron = Object.assign(new THREE.Mesh(chevronGeometry, chevronMaterial), { name: 'pulse-chevron' });
        chevron.rotation.y = c.yaw;
        chevron.position.set(c.x, 0.03, c.z);
        chevron.scale.setScalar(1.5);
        marbles.add(chevron);
      }
    }
    return model.getObjectByName('pulsar-core') as THREE.Mesh;
  });
}

/** Starts the pass of each train the move let through: the freight train runs its line, and each marble that sat on it
 * after the move falls off with the ejection effect when the train reaches it. */
function startPasses(before: number[], mv: Move, reduced: boolean): void {
  if (!(engine instanceof Encounter)) return;
  for (const train of passedTrains(trainsShown, parseTrains(engine.trains()))) {
    const [model, rails] = [trainModel(), railsOf(train)];
    scene.add(model, rails);
    const pass: Passing = { train, model, rails, start: performance.now(), skipped: false };
    drawPass(pass, 0);
    passing.push(pass);
    for (const { cell, side, at } of knockedMarbles(before, mv, train)) {
      const mesh = marbleMesh(side);
      turnMarble(mesh, turnAt(cellIndex(...cell)));
      startEjection(mesh, ejectTrack(cell, train.dir, reduced), scene, reachMs(train, at, reduced));
    }
  }
  document.body.dataset.passing = String(passing.length); // read by the e2e tests
}

/** Draws a passing train `elapsedMs` into its pass, true once it is over. */
function drawPass(p: Passing, elapsedMs: number): boolean {
  const at = trainAt(p.train, p.skipped ? Infinity : elapsedMs, reducedMotion());
  p.model.position.set(at.x, 0, at.z);
  p.model.rotation.y = at.yaw;
  return at.done;
}

function animatePasses(now: number): void {
  for (const p of passing.slice()) {
    if (!drawPass(p, now - p.start)) continue;
    scene.remove(p.model, p.rails);
    passing.splice(passing.indexOf(p), 1);
    document.body.dataset.passing = String(passing.length);
  }
}


const GHOST_OPACITY = 0.45;
let hintShownKey = '';
let ghostFadeStart = 0;
/** The ghost materials at `now`: the Hint's ghost rises from clear (ghostFade), any other ghost is whole. */
function fadeGhosts(now: number): void {
  const k = hintShownKey ? ghostFade(now - ghostFadeStart, reducedMotion()) : 1;
  for (const m of [...Object.values(ghostMaterials), ghostCore]) m.opacity = GHOST_OPACITY * k;
}

/** Whether the Hint's ghost is still rising, so the frame keeps drawing. */
const ghostFading = (): boolean => hintShownKey !== '' && !reducedMotion() && performance.now() - ghostFadeStart < MOTION.base;

function refreshGhosts(moves: ReturnType<typeof parseMoves>): void {
  if (royale) return; // no ghost over the arena
  const mv = keyDir >= 0 ? moveFor(moves, selected, keyDir) : hover ? moveForClick(moves, selected, hover) : null;
  const record = mv ? encodeMove(mv) : hint.shown(here()); // the hovered move, else the hint (#192)
  const list = ghostMarbles(history, record, makeGame);
  // The hover tells follow the difficulty (#1538): the hovered move on normal, every move of the selected marble too on easy, none on hard.
  const mode = TELL_MODE[difficulty];
  const asked: number[][] = mode === 'never' || !(engine instanceof Encounter) || !record ? [] : [record];
  if (mode === 'always' && engine instanceof Encounter) {
    for (const { cell } of groupTargets(moves, selected)) {
      const other = encodeMove(moveForClick(moves, selected, cell)!);
      if (!asked.some((a) => a.join() === other.join())) asked.push(other);
    }
  }
  if (record && mode !== 'never' && engine instanceof Encounter) {
    // The tell: the boss reply announced for the hovered move, drawn on the position after it.
    const reply = Array.from(engine.tell_move(Int32Array.from(record)));
    if (reply.length) list.push(...ghostMarbles([...history, record], reply, makeGame));
  }
  if (record && mode === 'never' && engine instanceof Encounter) {
    // The Echo's bonus is a ghost marble on the move's board, the same tell as its ring: left out on hard, the move's own landing stays.
    const own = landing(parseMoves(record)[0]!);
    const bonus = parseEchoTell(engine.echo_tell(Int32Array.from(record))).flatMap((b) => landing(b.mv));
    const hidden = bonus.filter(([q, r]) => !own.some(([oq, or]) => oq === q && or === r));
    list.splice(0, list.length, ...list.filter(({ cell: [q, r] }) => !hidden.some(([hq, hr]) => hq === q && hr === r)));
  }
  ghosts.clear();
  const hintKey = !mv && record ? record.join() : ''; // a hint that just appeared fades in, a hovered move shows at once
  if (hintKey !== hintShownKey) ghostFadeStart = performance.now();
  hintShownKey = hintKey;
  fadeGhosts(performance.now());
  for (const { cell, side } of list) {
    const p = axialTo3D(cell[0], cell[1]);
    const marble = marbleMesh(side, ghostMaterials, ghostCore);
    marble.position.set(p.x, 0.36, p.z);
    ghosts.add(marble);
  }
  document.body.dataset.ghosts = String(list.length);
  // The Echo's tell (#859): each bonus the hovered move gives the other side, ringed, or crossed when it would be skipped.
  const tell = asked.flatMap((rec) => parseEchoTell((engine as Encounter).echo_tell(Int32Array.from(rec))));
  const counts = { played: 0, skipped: 0 };
  for (const { mv: bonus, skipped } of tell) {
    for (const [q, r] of landing(bonus)) {
      const p = axialTo3D(q, r);
      if (skipped) {
        const marble = marbleMesh(3 - engine.to_move(), ghostMaterials, ghostCore);
        marble.position.set(p.x, 0.36, p.z);
        const cross = [Math.PI / 4, -Math.PI / 4].map((yaw) => {
          const bar = new THREE.Mesh(barGeometry, skipMaterial);
          bar.position.set(p.x, 0.8, p.z);
          bar.rotation.y = yaw;
          return bar;
        });
        ghosts.add(marble, ...cross);
        counts.skipped++;
      } else {
        const ring = new THREE.Mesh(outlineGeometry, echoMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, 0.36, p.z);
        ghosts.add(ring);
        counts.played++;
      }
    }
  }
  document.body.dataset.echoBonus = String(counts.played); // read by the tests
  document.body.dataset.echoSkipped = String(counts.skipped);
  const flipsOf = asked.map((rec) => previewFlips(history, rec, makeGame as () => Encounter));
  const flips = [...new Map(flipsOf.flat().map((cell) => [cell.join(), cell])).values()];
  for (const [q, r] of flips) {
    const p = axialTo3D(q, r);
    const ring = new THREE.Mesh(outlineGeometry, paleMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.36, p.z);
    const glyph = new THREE.Mesh(glyphGeometry, paleMaterial);
    glyph.position.set(p.x, 0.85, p.z);
    ghosts.add(ring, glyph);
  }
  tellSound('flip', flips);
  document.body.dataset.flips = String(flips.length); // read by the e2e tests
  const hovered = record && mode !== 'never' ? (flipsOf[0]?.length ?? 0) : 0; // the HUD counts the flips of the move in hand, not of the others
  if (hovered !== exposed) {
    exposed = hovered;
    hud();
  }
}

// The guards of a move input: the game is over, a bot is thinking, a slide is running, or it is not our turn.
// A click waits for the slide (`retry`), a key is dropped.
function blocked(retry: () => void): boolean {
  if (replaying) return true; // view only (#793)
  if (engine.status() !== 0) return true; // over: no move, no selection (#282)
  if (thinking || online?.role === 'spectator') return true;
  if (sliding()) return whenSettled(retry), true; // the next move waits for the slide
  if (online && !online.ourTurn()) return true; // not our turn: our colour in versus, our human ply in co-op
  if (online && !online.canPlay()) return hud(' · waiting for opponent'), true; // a move would never reach them
  return false;
}

function play(seenMove: Move): void {
  const record = encodeMove(seenMove);
  const pushed = firstRun === 'match' && isPush(seenMove, cellAhead, PLAYER);
  try {
    playMove(record);
  } catch (refusal) {
    // The Stalker: a hidden marble blocks the move, the engine revealed it and changed nothing (#1111)
    if (!stalkerBoss()) throw refusal;
    selected = [];
    keyDir = -1;
    return refresh();
  }
  selected = [];
  dropPreview();
  keyDir = -1;
  if (firstRun === 'match') advanceMatch(seenMove, pushed);
  void online?.send(record);
  if (online && fight && !duel) void answerBoss(true); // co-op: our move's boss reply; in a duel the boss seat answers (#1485)
}

/** The legal moves, the Echo's free moves first: a click, a drag or a key on a free target plays the free move (#958). */
function legalMoves(): Move[] {
  if (stalkerBoss() && engine.to_move() === PLAYER) return parseMoves((engine as Encounter).seen_moves());
  const moves = parseMoves(engine.legal_moves());
  return engine instanceof Encounter ? [...parseMoves(engine.free_moves()), ...moves] : moves;
}

function click(q: number, r: number): void {
  if (hub) {
    cancelHubWalk();
    walk([q, r]);
    return;
  }
  if (royale) return pickRoyale(q, r);
  if (armed) return placeAt(q, r); // only during a placement
  if (swapping) return swapAt(q, r);
  if (blocked(() => click(q, r))) return;
  const side = engine.board()[cellIndex(q, r)];
  if (side === engine.to_move() && outOfTurn(dualShown, [q, r])) {
    // The Dual Room (#992): the marbles of the room out of turn are not this turn's.
    cue(document.body, 'refused', MOTION.fast);
    playCue('illegal-move');
    return hud(` · ${roomTurn(dualShown!.room!)}`);
  }
  if (side === engine.to_move()) {
    selected = toggleSelection(selected, [q, r]);
    dropPreview();
    keyDir = -1;
    hint.clear(); // a new selection
    if (firstRun === 'match' && guided) showStep(nextStep(matchStep, { selected: selected.length }));
    refresh();
    if (selected.length > 0 && firstRun !== 'match') hud(pickNote(`${selected.length} marble${selected.length > 1 ? 's' : ''} selected: pick an arrow`)); // how many marbles are in the line (#1679)
    return void botTurn();
  } else {
    // The engine is the only judge: a click that is not a legal move changes nothing.
    const mv = moveForClick(legalMoves(), selected, [q, r]);
    if (mv) play(mv);
    else if (selected.length > 0) {
      refresh();
      cue(document.body, 'refused', MOTION.fast); // the turn line shakes (#1097); the text says why nothing moved
      playCue('illegal-move'); // a hover never comes here: only a press with a selection
      return hud(firstRun === 'match' ? ` · ${COACH.refused}` : ' · not a legal move'); // the first match says why (#1663)
    }
  }
  refresh();
  void botTurn();
}

const raycaster = new THREE.Raycaster();
raycaster.layers.enable(CELL_LAYER); // the cell discs, drawn by their instances (#885), are what a click hits
function aim(e: PointerEvent | MouseEvent): void {
  const at = unkick(kick ? drawnKick : REST, e.clientX, e.clientY, innerWidth, innerHeight); // the picture is kicked while an ejection plays (#1560)
  raycaster.setFromCamera(new THREE.Vector2((at.x / innerWidth) * 2 - 1, -(at.y / innerHeight) * 2 + 1), camera);
}
// The nearest drawn marble under the ray, its upper part too: the cell discs are flat, a tap above one is a miss (#1668). Run per pointer event, not per frame.
function marbleHit(group: THREE.Group): THREE.Intersection | undefined {
  const drawn = group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).geometry === marbleGeometry && c.visible); // only the shells: not the sprites, rings and glows
  group.updateWorldMatrix(true, false); // picking can run before the first render places them
  for (const mesh of drawn) mesh.updateWorldMatrix(false, false);
  return raycaster.intersectObjects(drawn, false)[0];
}
// The cell a marble stands over: the nearest disc to its centre.
function cellUnder(marble: THREE.Object3D, shown: THREE.Mesh[]): number {
  const at = (royale ? arena : scene).worldToLocal(marble.getWorldPosition(new THREE.Vector3()));
  const apart = shown.map((disc) => disc.position.distanceToSquared(at));
  return apart.indexOf(Math.min(...apart));
}
function cellAt(e: PointerEvent | MouseEvent): Axial | null {
  aim(e);
  const [shown, cells] = royale ? [arenaDiscs, ARENA] : [discs, BOARD_CELLS];
  const marble = marbleHit(royale ? arenaMarbles : marbles); // a marble hides the disc behind it, as it does on the screen
  if (marble) return cells[cellUnder(marble.object, shown)]!;
  const hit = raycaster.intersectObjects(shown.filter((disc) => disc.visible))[0]; // no cell where no disc is drawn
  return hit ? cells[shown.indexOf(hit.object as THREE.Mesh)]! : null;
}
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// The point of the board plane under the pointer, null when the ray never meets it (the horizon).
function groundAt(e: PointerEvent): THREE.Vector3 | null {
  aim(e);
  return raycaster.ray.intersectPlane(ground, new THREE.Vector3());
}
// A marble of the player: the side to move on the board, the player's seat on the arena (#1646).
const ours = (cell: Axial | null): cell is Axial =>
  !!cell && (royale ? seatAt(royale.board()[cellIndex(cell[0], cell[1], ARENA)]!) === me() : engine.board()[cellIndex(cell[0], cell[1])] === engine.to_move());
// No drag play now: the arena once the game is over or while the round waits for no order, the board as `blocked` says.
const dragBlocked = (): boolean => (royale ? royale.placement().length > 0 || !canOrder() : blocked(() => {}));
// A fight is on, outside the hub: the console and the recorder are not to be opened by a stray tap.
const propsShut = (): boolean => !hub && (fight !== null || run !== null);
function onProp(e: PointerEvent, prop: THREE.Mesh): boolean {
  aim(e);
  return raycaster.intersectObject(prop).length > 0;
}

// One pointer that stays put is a click, one that moves is an orbit, two pointers are a pinch.
const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let press: { x: number; y: number; drag: boolean } | null = null;
let marbleDrag: Axial[] | null = null; // the marbles a drag that began on one of ours has passed over (#794)
const span = (): number => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a!.x - b!.x, a!.y - b!.y);
};
// The angle of the two pointers, for a twist of the Open world's camera (#1026), and the pointer that turns it with the right button.
const angle = (): number => {
  const [a, b] = [...pointers.values()];
  return Math.atan2(b!.y - a!.y, b!.x - a!.x);
};
let turning: number | null = null;

canvas.addEventListener('pointerdown', (e) => {
  if (openWorld.active) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); // two fingers pinch and twist the Open world's camera (#976, #1026)
    if (e.button === 2) turning = e.pointerId; // the right button turns the camera round the hero, it does not roll the hero (#1026)
    else if (pointers.size === 1) openWorld.press(e.clientX, e.clientY, innerWidth, innerHeight); // the Open world rolls its hero (#962)
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    press = { x: e.clientX, y: e.clientY, drag: false };
    // A press on one of our marbles starts a selection by drag, anywhere else it is the orbit (#794).
    const cell = hub || reading || freeCam.active ? null : cellAt(e); // the arena too, as the board (#1646)
    marbleDrag = ours(cell) && !dragBlocked() ? [cell] : null;
  } else {
    press!.drag = true; // a second finger never selects (press is set while any pointer is down)
    marbleDrag = null;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const last = pointers.get(e.pointerId);
  if (openWorld.active) {
    if (last) {
      const prevSpan = pointers.size === 2 ? span() : 0;
      const prevAngle = pointers.size === 2 ? angle() : 0;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerId === turning) openWorld.orbit(e.clientX - last.x); // the right button's drag turns the camera (#1026)
      if (pointers.size === 2 || e.pointerId === turning) openWorld.cancelWalk(); // a drag ends a walk to a far cell (#1137)
      if (pointers.size === 2) {
        openWorld.zoom(pinchScale(prevSpan, span())); // the Open world's camera, not the board's (#976)
        openWorld.turn(twistOf(prevAngle, angle())); // a twist turns it too (#1026)
      }
    }
    return;
  }
  if (last && press) {
    if (freeCam.active) {
      freeCam.onPointerMove(e.clientX - last.x, e.clientY - last.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      updateFreeCamCamera();
      return;
    }
    const prevSpan = pointers.size === 2 ? span() : 0;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) view = zoom(view, pinchScale(prevSpan, span()));
    else if (marbleDrag && (press.drag || isDrag(e.clientX - press.x, e.clientY - press.y))) {
      press.drag = true;
      const cell = cellAt(e);
      const path = ours(cell) ? extendPath(marbleDrag, cell) : marbleDrag;
      if (path !== selected) {
        selected = marbleDrag = path;
        keyDir = -1;
        hint.clear(); // a new selection
        refresh();
      }
      return;
    } else if (press.drag || isDrag(e.clientX - press.x, e.clientY - press.y)) {
      press.drag = true;
      dropPreview();
      view = orbit(view, e.clientX - last.x, e.clientY - last.y);
    }
    applyView();
    return;
  }
  if (hub) {
    if (hub.onPointerMove(cellAt(e))) hud();
    return;
  }
  const next = cellAt(e);
  if (next === hover) return;
  hover = next;
  hoverSpecial(next);
  refreshGhosts(legalMoves());
});

// A touch screen has no hover: the first tap on an arrow cell shows the ghost of its move and a Play pill over it, a second tap on the same cell plays it (#1679).
// The preview belongs to one selection of one game position: any other selection, move or game drops it, and the ghost it set with it.
function dropPreview(): void {
  previewed = null;
  tapPlay.hidden = true;
  if (tapHover) hover = null;
  tapHover = false;
}
const previewLive = (): boolean => !hub && !royale && previewed !== null && previewed.engine === engine && previewed.plies === history.length && previewed.key === selectionKey();
/** The note under the plate: a mode with a rule line of its own (a boss fight, the Dual Room) keeps it alone. */
const pickNote = (text: string): string => (fight || dualShown ? '' : `<span class="pick-note">${text}</span>`);
const EDGE = 8; // px kept between the Play pill and the window's edge
function tapPreview(e: PointerEvent, cell: Axial): boolean {
  if (e.pointerType === 'mouse' || firstRun === 'match' || hub || royale || armed || swapping || selected.length === 0) return false;
  if (previewLive() && sameCell(previewed!.cell, cell)) return dropPreview(), false; // the second tap: the click plays it
  const mv = moveForClick(legalMoves(), selected, cell);
  if (!mv) return false;
  previewed = { cell, key: selectionKey(), engine, plies: history.length };
  hover = cell;
  tapHover = true;
  refreshGhosts(legalMoves());
  const at = sceneRenderer.cellToScreen(cell[0], cell[1], innerWidth, innerHeight, 1, 0);
  tapPlay.hidden = false; // shown first: its size places it
  const { width, height } = tapPlay.getBoundingClientRect();
  const dock = document.getElementById('hud-dock')!.getBoundingClientRect();
  let y = at.y - 34; // above the arrow, so the ghost under it stays in view; below it when the plate is there
  if (y - height / 2 < Math.max(EDGE, dock.bottom) && at.x + width / 2 > dock.left && at.x - width / 2 < dock.right) y = at.y + 34;
  tapPlay.style.left = `${Math.min(Math.max(at.x, EDGE + width / 2), innerWidth - EDGE - width / 2)}px`;
  tapPlay.style.top = `${Math.min(Math.max(y, EDGE + height / 2), innerHeight - EDGE - height / 2)}px`;
  tapPlay.classList.toggle('still', reducedMotion());
  hud(pickNote('Tap the arrow again to play'));
  return true;
}

function release(e: PointerEvent): void {
  const wasClick = e.type === 'pointerup' && press && !press.drag && pointers.size === 1;
  const dropped = e.type === 'pointerup' && marbleDrag && press!.drag && pointers.size === 1;
  if (openWorld.active && (e.pointerId === turning || pointers.size === 2)) openWorld.settle(); // a drag or a twist ends on a step (#1251)
  pointers.delete(e.pointerId);
  if (e.pointerId === turning) turning = null;
  if (pointers.size === 0) press = marbleDrag = null;
  if (dropped) return dropMarbles(e);
  if (!wasClick) return;
  if (reading) {
    if (onProp(e, consoleScreen)) turnReader(1);
    else leaveReader();
    return;
  }
  const cell = cellAt(e);
  if (cell && tapPreview(e, cell)) return;
  if (cell) click(cell[0], cell[1]);
  else if (royale && raycaster.intersectObjects(arenaDiscs).length) return; // the hole (#610): no prop behind it
  else if (propsShut()) return; // a fight is on: no prop behind the board opens (#1668)
  else if (onProp(e, consoleScreen)) openReader();
  else if (onProp(e, recorder)) playLog(logOf(deck)); // the deck's recorder prop (#517)
}
// The release of a drag over our marbles plays the move of the group toward the nearest direction; no legal move: nothing.
function dropMarbles(e: PointerEvent): void {
  const at = groundAt(e)?.divideScalar(royale ? ARENA_SCALE : 1); // the arena's cells stand at half spacing
  const dir = at ? releaseDir(selected, at.x, at.z) : null;
  const mv = dir === null ? null : moveFor(royale ? parseMoves(royale.legal_orders(me())) : legalMoves(), selected, dir);
  if (!mv) return;
  if (royale) return playRound(encodeMove(mv)); // the player's order: the round resolves (#1646)
  play(mv);
  refresh();
  void botTurn();
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// The right button turns the Open world's camera: no browser menu over the canvas (#1026).
canvas.addEventListener('contextmenu', (e) => {
  if (openWorld.active) e.preventDefault();
});

// ? shows or hides the key hint (#1673), one line from keyboard.ts.
document.getElementById('keyhint')!.textContent = KEY_HINT;
addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== '?' || e.repeat || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)) return;
  document.body.toggleAttribute('data-keyhint');
});

// Keyboard play (#738), only while the canvas has focus: Tab and Shift+Tab walk the legal groups (past the ends the
// focus moves on), Q W E A S D pick the direction, Enter plays it, Escape backs out one step.
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'Edgefall board');
canvas.addEventListener('keydown', (e) => {
  if (openWorld.active || hub || royale || reading || e.altKey || e.ctrlKey || e.metaKey || blocked(() => {})) return; // the Open world has the canvas (#1063)
  const dir = KEY_DIRS[e.key.toLowerCase()];
  const moves = legalMoves();
  if (e.key === 'Tab') {
    const group = nextGroup(moves, selected, e.shiftKey ? -1 : 1);
    if (group) e.preventDefault();
    selected = group ?? [];
    keyDir = -1;
    hint.clear();
  } else if (dir !== undefined) {
    e.preventDefault();
    keyDir = dir;
  } else if (e.key === 'Enter') {
    const mv = moveFor(moves, selected, keyDir);
    if (!mv) return;
    e.preventDefault();
    play(mv);
    refresh();
    return void botTurn();
  } else if (e.key === 'Escape' && (keyDir >= 0 || selected.length > 0)) {
    e.preventDefault();
    if (keyDir >= 0) keyDir = -1;
    else selected = [];
  } else return;
  refresh();
  hud(` · ${announce(moves, selected, keyDir, padInUse)}`);
});
// The gamepad (#1252): its buttons press the keyboard's keys on the focused control, so the pad takes the keyboard's
// paths. A Tab no one took, or the D-pad off the board, walks the focus. The first press shows the pad's hints and focus
// rings (body[data-pad]); a real key or a mouse move gives the keyboard's back.
let padInUse = false;
let padKeys = false; // a key the pad presses
function padKey(key: string, shiftKey = false): boolean {
  padKeys = true;
  const kept = document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  padKeys = false;
  return kept;
}
const keysBack = (): void => {
  padInUse = false;
  delete document.body.dataset.pad;
};
addEventListener('keydown', () => padKeys || keysBack(), { capture: true });
addEventListener('mousemove', keysBack);
const WALK_PX = 100; // a full push of the stick is this many px of the touch stick's drag
const MAP_PAN_PX = 12; // a full push of the stick pans the Open world's map this many px a frame (#1411)
const padKeyOf = (dir: number): string => Object.keys(KEY_DIRS).find((k) => KEY_DIRS[k] === dir)!;
const pollPad = gamepad((action: PadAction) => {
  padInUse = true;
  document.body.dataset.pad = '';
  const focused = document.activeElement as HTMLElement;
  const free = focused === canvas || focused === document.body; // the canvas has the focus: the Open world's hero is the pad's
  switch (action.kind) {
    case 'confirm':
      if (padKey('Enter') && focused !== canvas) focused.click(); // a button, a toggle
      return;
    case 'back':
      return void padKey('Escape');
    case 'menu':
      if (!guideBox.hidden || !coldBox.hidden || !consentBox.hidden || !optinBox.hidden) return; // the settings stay shut under the guide
      cog.click();
      return cog.focus();
    case 'prev':
    case 'next':
      if (openWorld.active && free) return void padKey(action.kind === 'prev' ? 'q' : 'e'); // the camera turns a step (#1251)
      if (padKey('Tab', action.kind === 'prev')) nextFocus(focused, action.kind === 'prev' ? -1 : 1, padScope()).focus();
      return;
    case 'reset':
      if (openWorld.active) padKey('r'); // the camera back to its default angle (#1026)
      return;
    case 'map':
      return openWorld.toggleMap(); // the Open world's map (#1411)
    case 'teleport':
      return openWorld.teleport(); // the Open world's Teleport action, on a teleporter (#1412)
    case 'walk':
      if (openWorld.mapShown) return openWorld.panMap(-action.x * MAP_PAN_PX, -action.y * MAP_PAN_PX); // the stick looks round the map (#1411)
      // The stick walks the hero as the touch stick does, in the yaw of the camera; a rest lets go (#1252).
      return openWorld.hold(openWorld.active && free ? heldKeys(action.x * WALK_PX, action.y * WALK_PX, openWorld.yaw) : []);
    case 'move':
      if (openWorld.active && free) return; // the stick walked the hero already
      if (focused === canvas) return void padKey(padKeyOf(action.hex));
      return nextFocus(focused, action.step, padScope()).focus();
    case 'orbit':
      if (openWorld.active) return; // LB and RB turn the Open world's camera
      view = orbit(view, action.dx, action.dy);
      return applyView();
    default:
      if (openWorld.active) return openWorld.zoom(action.scale);
      view = zoom(view, action.scale);
      return applyView();
  }
});
canvas.addEventListener('pointerleave', () => {
  hoverSpecial(null);
  if (hub && hub.onPointerLeave()) {
    hud();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (openWorld.active) return openWorld.zoom(wheelScale(e.deltaY)); // the Open world's camera, not the board's (#976)
    view = zoom(view, wheelScale(e.deltaY));
    applyView();
  },
  { passive: false },
);

document.getElementById('reset-view')!.addEventListener('click', () => {
  moveModes('outside'); // the Reset view button sits in the Game modes menu (#1612): a press closes it
  if (freeCam.active) toggleFreeCam(false);
  view = fitted = fightView();
  applyView();
});
(document.getElementById('reset-view') as HTMLButtonElement).disabled = false; // listener ready (#146)
// The left HUD panel folds to a tab with its button alone (#957), saved. Folded, it stays in the page for screen readers.
const hudFold = document.getElementById('hud-fold') as HTMLButtonElement;
function foldHud(folded: boolean): void {
  document.getElementById('hud-dock')!.toggleAttribute('data-folded', folded);
  hudFold.setAttribute('aria-expanded', String(!folded));
  hudFold.title = folded ? 'Unfold the panel' : 'Fold the panel';
}
foldHud(readHudFolded(store));
hudFold.addEventListener('click', () => {
  const folded = hudFold.getAttribute('aria-expanded') === 'true';
  writeHudFolded(store, folded);
  foldHud(folded);
  applyView();
});
hudFold.disabled = false;
boardZoomButton.setAttribute('aria-pressed', String(boardZoom));
boardZoomButton.addEventListener('click', () => {
  boardZoom = !boardZoom;
  writeBoardZoom(store, boardZoom);
  boardZoomButton.setAttribute('aria-pressed', String(boardZoom));
  applyView();
});

addEventListener('resize', () => {
  if (view === fitted) view = fitted = fightView();
  frameCamera();
  setPixelRatio(renderPixelRatio(devicePixelRatio, navigator.webdriver));
  renderer.setSize(innerWidth, innerHeight);
  openWorld.resize(innerWidth, innerHeight);
  applyView(); // the reader fits the screen to the new window
});

// Used by the browser checks to aim at a lift's arrow (#523, #1374): its world height, on top of the cage on the terrace.
hookHost.__liftArrowY = (q: number, r: number): number | null => {
  let arrow: THREE.Object3D | undefined;
  sceneRenderer.marbles.traverse((o) => {
    if (!arrow && o.userData.cell === `${q},${r}`) arrow = o;
  });
  return arrow ? arrow.getWorldPosition(new THREE.Vector3()).y : null;
};
// Used by the browser checks to click a cell by its axial coordinates.
hookHost.__cellToScreen = (q: number, r: number, lift = 0) => {
  return sceneRenderer.cellToScreen(q, r, innerWidth, innerHeight, royale ? ARENA_SCALE : 1, lift);
};
// Used by the browser checks to see the console screen (#512) and the recorder (#517) on the window: the box around its
// corners, in pixels.
function rectOfPoints(points: THREE.Vector3[]): { x: number; y: number; width: number; height: number } {
  camera.updateMatrixWorld();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const v = p.clone().project(camera);
    xs.push(((v.x + 1) / 2) * innerWidth);
    ys.push(((1 - v.y) / 2) * innerHeight);
  }
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}
function rectOf(prop: THREE.Mesh): { x: number; y: number; width: number; height: number } {
  const box = new THREE.Box3().setFromObject(prop);
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  return rectOfPoints(corners);
}
hookHost.__consoleRect = () => rectOf(consoleScreen);
hookHost.__recorderRect = () => rectOf(recorder);
// Used by the browser checks to see The Pulsar on the window (#691): the box round the vertices of each of the six
// pulsars, its glowing core included, and round the counter it shows when it charges, the sprite facing the camera, in
// pixels.
hookHost.__pulsarRects = () => {
  camera.updateMatrixWorld();
  marbles.updateMatrixWorld(true);
  const vertices = (model: THREE.Object3D): THREE.Vector3[] =>
    (model.children as THREE.Mesh[]).flatMap(({ geometry, matrixWorld }) => {
      const at = geometry.getAttribute('position');
      return Array.from({ length: at.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(at, i).applyMatrix4(matrixWorld));
    });
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(PULSE_COUNTER_SIZE / 2);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(PULSE_COUNTER_SIZE / 2);
  return marbles.children
    .filter((c) => c.name === 'pulsar' || c.name === 'pulsar-charging')
    .map((model, id) => {
      const { x, y, z } = counterSpot(id);
      const centre = new THREE.Vector3(x, y, z);
      const square = [1, -1].flatMap((i) => [1, -1].map((j) => centre.clone().addScaledVector(right, i).addScaledVector(up, j)));
      return { pulsar: rectOfPoints(vertices(model)), counter: rectOfPoints(square) };
    });
};
// Used by the browser checks to play their setup plies: the same click, without the raycast and the frames of a mouse click.
hookHost.__click = (q: number, r: number) => click(q, r);

// Used by the browser checks to read the turn of the marble on a cell (#345, #346), null when it has none.
hookHost.__marbleTurn = (q: number, r: number) =>
  marbleAt.get(cellIndex(q, r))?.[0]?.quaternion.toArray() ?? null;
// Used by the browser checks to list the marbles that wear a boss accent (#507): their cell and the accent's name.
const accentNames = new Set(Object.values(ACCENTS).map((a) => a.name)); // not the parts of a converted marble (#508)
hookHost.__accents = () =>
  [...marbleAt].flatMap(([i, [marble]]) =>
    marble!.children.filter((c) => accentNames.has(c.name)).map((c) => ({ cell: BOARD_CELLS[i], accent: c.name })),
  );
// Used by the browser checks to see the look of The Chaplain's converted marbles (#508): the parts each one holds.
hookHost.__convertedLooks = () =>
  [...marbleAt]
    .filter(([, [marble]]) => (marble as THREE.Mesh).material === unseen)
    .map(([i, [marble]]) => ({ cell: BOARD_CELLS[i], parts: marble!.children.map((c) => c.name) }));

// Used by the browser checks to count the phase notches drawn on the frame and see the threshold glyph (#356).
hookHost.__notches = () => {
  const drawn = notches.parent === scene ? notches.children.map((m) => (m as THREE.Mesh).geometry) : [];
  const lit = drawn.filter((g) => g === scratchGeometry).length;
  return { lit, dark: drawn.filter((g) => g === grooveGeometry).length - lit, glyph: drawn.includes(thresholdMarkGeometry) };
};
// Used by the browser checks to count the tally marks drawn on the frame, per side, side 1 first (#389).
hookHost.__tally = () =>
  tallies.map((group) => {
    const drawn = group.parent === scene ? group.children.map((m) => (m as THREE.Mesh).geometry) : [];
    return { marked: drawn.filter((g) => g === scratchGeometry).length, slots: drawn.filter((g) => g === grooveGeometry).length };
  });
// Used by the browser checks to read the frame's size and holes, and that it is drawn (#292).
hookHost.__frame = () => ({
  radius: frame?.radius,
  holes: frame?.holes.length,
  dishes: sceneRenderer.terraceOn ? dishesOf(terraceBoards[boardOf()])?.count : undefined, // the terrace draws one dish per cell in play: a hole is one dish fewer (#1374)
  drawn: sceneRenderer.terraceOn ? (dishesOf(terraceBoards[boardOf()])?.count ?? 0) > 0 : [plate, rim.near, rim.far].every((m) => m.visible && m.parent === scene && m.geometry.attributes.position!.count > 0),
  lit: { near: rim.near.material.emissive.getHex(), far: rim.far.material.emissive.getHex() }, // #300
});
// Used by the browser checks and tests to mount the high-fidelity PBR spaceship bay (#648).
hookHost.__mountBay = mountBay;
hookHost.__toggleFreeCam = (enabled?: boolean) => toggleFreeCam(enabled);
hookHost.__freeCamActive = () => freeCam.active;
hookHost.__renderMode = () => renderMode;
hookHost.__setRenderMode = (mode: RenderMode) => setRenderMode(mode);
hookHost.__cycleRenderMode = () => cycleRenderMode();
hookHost.__clayActive = () => renderMode === 'clay';
hookHost.__wireframeActive = () => renderMode === 'wireframe';
hookHost.__toggleWireframe = (enabled?: boolean) => {
  const next = enabled ?? renderMode !== 'wireframe';
  setRenderMode(next ? 'wireframe' : 'normal');
};

// Used by the browser checks to see the ejected marbles as drawn `ms` into their effect (the next
// frame draws them at the real time again).
hookHost.__ejectAt = (ms: number) =>
  ejecting.map((e) => {
    drawEjection(e, ms);
    const material = e.mesh.material as THREE.Material;
    return {
      along: e.holder.scale.x,
      across: e.holder.scale.y,
      roll: -e.tumble.rotation.z,
      twist: e.tumble.rotation.x,
      drop: 0.36 - e.holder.position.y,
      opacity: material.opacity / material.userData.opacity, // the fade, the glass's own see-through aside
      turn: e.mesh.getWorldQuaternion(new THREE.Quaternion()).toArray(),
    };
  });

// Used by the browser checks to see the spatter `ms` into its effect in screen space (px), beside what it must not
// cover: each cell disc, each marble on the board, and the frame's outer edge (#278). Draws nothing.
hookHost.__bloodAt = (ms: number) => {
  camera.updateMatrixWorld();
  const px = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  };
  const boxOf = (pts: { x: number; y: number }[]) => ({
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  });
  const ring = (cx: number, cz: number, radius: number, y: number) =>
    Array.from({ length: 16 }, (_, k) => px(cx + Math.cos((k * Math.PI) / 8) * radius, y, cz + Math.sin((k * Math.PI) / 8) * radius));
  const b = bleeding.at(-1);
  const drops = b ? bloodAt(b.from, b.dir, ms, false) : [];
  const stain = b ? bloodStainAt(b.from, b.dir, ms, false) : null;
  const spray = [...drops.map((d) => px(d.x, d.y, d.z)), ...(stain ? ring(stain.x, stain.z, stain.radius, 0.01) : [])];
  const cells = CELLS.map(([q, r]) => {
    const c = axialTo3D(q, r);
    return boxOf(ring(c.x, c.z, 0.46, 0.05));
  });
  const boardMarbles = marbles.children.filter((o) => !o.userData.terrace).map((o) => { // not the terrace's pedestals and rings (#1314)
    const bb = new THREE.Box3().setFromObject(o, true); // precise: a turned marble's box is not its turned bounding cube (#346)
    const corners = [bb.min.x, bb.max.x].flatMap((x) => [bb.min.y, bb.max.y].flatMap((y) => [bb.min.z, bb.max.z].map((z) => px(x, y, z))));
    return boxOf(corners);
  });
  return {
    spray: spray.length > 0 ? boxOf(spray) : null,
    drops: drops.length,
    cells,
    marbles: boardMarbles,
    frame: frame!.outer.map((p) => px(p.x, 0, p.z)), // drawn by the first refresh, before any hook can run
  };
};

// Used by the browser checks to see whether the audio context exists ('none') and runs.
hookHost.__audio = () => sfx.state;
// The gain of a bus (#438): 0 before a gesture, then its slider's level.
hookHost.__gain = (bus: Bus) => sfx.gain(bus);
// The tension level and the gain of each drone layer (#439).
hookHost.__tension = () => ({ level: sfx.tension, layers: sfx.layers });
// The scene of the music and what plays of it (#1571).
hookHost.__scene = () => sfx.scene;
// The stations that sound near the camera: id, kind, distance gain and pan (#1577).
hookHost.__stations = () => sfx.stations;
// The sound twins of the boss tells played so far (#358).
hookHost.__tellCues = () => tellCues;
// The cues of the cue table played so far (#1570).
hookHost.__cues = () => cuesPlayed;
// Whether music and ambience are ducked under an audio log (#516).
hookHost.__ducked = () => sfx.ducking;
hookHost.__palette = () => palette;

// Used by the browser checks to count the plies played, bot replies included, and to compare them.
hookHost.__plies = () => history.length;
hookHost.__botBusy = () => thinking || afterSlide.length > 0 || sliding(); // no move thinking or waiting for a slide: the bot is idle (#1624)
hookHost.__sealed = () => sealedResult; // the ranked result both seats signed (#1287), read by the tests
hookHost.__history = () => history;
// Used by the browser checks to read the boss, seed and daily attempt of the running fight.
hookHost.__fight = () => fight;
hookHost.__view = () => view;
hookHost.__terrace = () => sceneRenderer.terrace; // the arena's meshes, for the browser checks of #1314
// A browser check sets the camera exactly (the Blender views of the terrace, #1314): the view, then the camera and the fog follow.
hookHost.__setView = (next: Partial<View>) => {
  Object.assign(view, next);
  applyView();
  dirty = CHANGE_DRAWS;
};

// Used by the browser checks to read the hinted move and the marbles that wear the selection ring (#301).
hookHost.__ghostOpacity = () => ghostMaterials[1]!.opacity; // the Hint ghost's fade (#1097)
hookHost.__hint = () => hint.shown(here());
hookHost.__rings = () => ringed;
// Used by the browser checks to read the opacity and scale of the last move's ring (#1092).
hookHost.__lastMoveRing = () => ({ opacity: lastMoveMaterial.opacity, scale: lastMoveRings[0]?.scale.x ?? 0 });
// Used by the browser checks to read the target cells and the direction of their arrow (#390).
hookHost.__targets = () => targets;
hookHost.__marbles = () => marbles;
// Used by the browser checks to see the kick the last frame was drawn with (#1560).
hookHost.__kick = () => drawnKick;

// Used by the browser checks to pick a legal move (the boss tests play forward), and to find one that
// exposes a marble to The Chaplain.
hookHost.__legal = () => parseMoves(engine.legal_moves());
hookHost.__preview = (mv: Parameters<typeof encodeMove>[0]) =>
  engine instanceof Encounter ? previewFlips(history, encodeMove(mv), makeGame as () => Encounter) : [];
// Used by the browser checks to see which Choir army moved.
hookHost.__armies = () =>
  engine instanceof Encounter ? parseArmies(engine.armies()) : [];
// Used by the browser checks to find The Hull's cracked cells and the ones drawn with the crack decal (#355).
hookHost.__cracks = () =>
  engine instanceof Encounter ? parseCracks(engine.cracks()) : [];
hookHost.__crackDecals = () => crackDecals;
hookHost.__crackDecalShown = (shown: boolean) => (crackMaterial.visible = shown);
// Used by the browser checks to find The Alien's eggs as drawn: their cell, counter and glow on 1 (#588), and the glow.
hookHost.__eggs = () => eggsDrawn;
hookHost.__eggShade = () => eggShade;
hookHost.__eggGlow = () => eggGlowMaterial.opacity;
// Used by the browser checks to find The Rail Yard's trains as drawn (#626): each line, its cells from the entry and
// its counter, and the trains passing now, with where their front is.
hookHost.__trains = () => trainsShown;
hookHost.__passes = () =>
  passing.map((p) => ({ line: p.train.line, x: p.model.position.x, z: p.model.position.z }));
// Used by the browser checks to find The Assembly Line's belts as drawn (#744): each belt's cells, direction, pattern
// scroll and announced strike cell, and the turns left before the centre belt reverses.
hookHost.__belts = () => beltsShown;
// Used by the browser checks to find The Ballast Mind's last borrowed effect as drawn (#838): its code and the ringed cells.
hookHost.__fired = () => firedShown;
// Used by the browser checks to find The Pulsar's next pulse as drawn (#675), and the shockwave of a pulse now.
hookHost.__pulsar = () => pulsarShown && { ...pulsarShown, charging: charging(pulsarShown) };
hookHost.__shock = () =>
  shock && { radius: shock.mesh.scale.x, opacity: shockMaterial.opacity, x: shock.mesh.position.x, z: shock.mesh.position.z };
// Used by the browser checks to find The Unstable Core's marks as drawn (#751): the next events and the charges, and the
// shockwave's slice now.
hookHost.__unstable = () => unstableShown;
// Used by the browser checks to read Stalker's fog as drawn (#998): the visible cells, the enemy marbles drawn, the
// revealed ones and the rings of the bot's last move; null outside Stalker.
hookHost.__stalker = () => stalkerShown;
// Used by the browser checks to read The Swarm as drawn (#1008): the turns left, the pass, the marked cells, and the evac's
// light and lift now; null outside The Swarm.
hookHost.__swarm = () =>
  swarmShown && { ...swarmShown, evac: evac !== null, glow: evacMaterial.opacity, lift: evac?.lift ?? 0 };
// Used by the browser checks to find The Dual Room's marks as drawn (#947, #955): the bridge and the announced return, the
// bridge cells' heights now (null while they are the void), the mark's cell and the falling marble.
hookHost.__dual = () => ({
  state: dualShown,
  bridge: BRIDGE.map(([q, r]) => (discs[cellIndex(q, r)]!.visible ? bridgeY : null)),
  mark: dualShown?.coming?.cell ?? null,
  drop: drop && { cell: drop.cell, y: drop.y },
});
hookHost.__sweep = () => sweep && { scale: sweep.mesh.scale.x, opacity: sweepMaterial.opacity };
// Used by the browser checks to find The Magnetizer's polarities as drawn: the cell, the sign and the ring of a fresh one.
hookHost.__polarities = () => polesDrawn;
// Used by the browser checks to find The Overseer as drawn: its cell, the cores and the vents.
hookHost.__overseer = () => overseerDrawn;
// The announced marble and its coming sign as drawn (#671), and the opacity of the glyphs of a spent pair still fading.
hookHost.__announce = () => announceDrawn;
hookHost.__fading = () => fading.map((f) => f.sprite.material.opacity);
// Used by the browser checks to read the shell's heat pulse (#509).
hookHost.__shellPulse = () => shellLooks.get(DEFAULT_SKIN)?.emissiveIntensity ?? 0;
// Used by the browser checks to hold the pulse `t` seconds into its cycle instead of following the clock (#716).
let pulseHeld: number | null = null;
hookHost.__holdPulse = (t: number) => {
  pulseHeld = t;
};
// Used by the browser checks to find The Chaplain's converted marbles (#326).
hookHost.__blast = () =>
  blast && { shards: blast.shards.length, flash: blastFlashMaterial.opacity, shard: blastShardMaterial.opacity, reduced: blast.reduced };
hookHost.__converted = () =>
  engine instanceof Encounter ? parseCells(engine.converted()) : [];
// Used by the e2e tests to play `turns` boss turns in one call (#349): each player move is the first legal single-marble
// move in `dirs`, the boss replies as botTurn does, and each ply is applied as a catch-up is (afterPlay, not live): no
// slide, ejection or frame per ply, one refresh at the end.
if (navigator.webdriver) {
  hookHost.__playTurns = async (turns: number, dirs: number[]): Promise<number> => {
    if (thinking || online || !worker) return 0;
    thinking = true;
    syncHint();
    await new Promise<void>((done) => whenSettled(done)); // a slide in progress ends first
    const ply = (record: number[]): void => {
      const before = Array.from(engine.board());
      engine.play(Int32Array.from(record));
      afterPlay(before, record, false);
    };
    let played = 0;
    try {
      for (let i = 0; i < turns && engine.status() === 0; i++) {
        const game = engine;
        const mv = parseMoves(engine.legal_moves()).find((m) => m.cells.length === 1 && dirs.includes(m.dir));
        if (!mv) break;
        ply(encodeMove(mv));
        if (engine.status() !== 0) break;
        const reply = await askBot(worker, history, scaleBudget(budget, difficulty), fight ?? undefined, DIFFICULTY_PERCENT[difficulty]);
        if (engine !== game) break; // Retry, New game or an import replaced the game while the bot thought
        ply(reply);
        played++;
      }
    } finally {
      thinking = false;
      refresh();
    }
    return played;
  };
  // Plays the recorded plies of both sides, like a fixture of the core tests: the last one shows its effects (#748).
  hookHost.__playMoves = (records: number[][]): number => {
    records.forEach((record, k) => {
      const before = Array.from(engine.board());
      engine.play(Int32Array.from(record));
      afterPlay(before, record, k === records.length - 1);
    });
    refresh();
    return records.length;
  };
}

// New game (#230): leaves the local game for the start position, bot on or off as it was, and deletes its
// save. Once a move is played, the first press asks for a confirmation for a few seconds (newgame.ts).
// Boss, daily and online games hide it for good (startBoss, goOnline).
// A HUD button with an icon (#297): `content` is the icon or the words, `label` the accessible name and tooltip.
const setButton = (button: HTMLElement, label: string, content: string): void => {
  button.innerHTML = content;
  button.setAttribute('aria-label', label);
  button.title = label;
};
const newGameButton = document.getElementById('new-game') as HTMLButtonElement;
setButton(newGameButton, 'New game', icon('newgame'));
let confirmNew: Confirm = null;
let lapse = 0; // ends the confirmation
function askNewGame(confirm: Confirm): void {
  confirmNew = confirm;
  const label = newGameLabel(confirm);
  setButton(newGameButton, label, confirm === null ? icon('newgame') : label); // the words while it waits for the confirmation
  newGameButton.classList.toggle('confirm', confirm !== null);
  clearTimeout(lapse);
  if (confirm !== null) lapse = setTimeout(askNewGame, CONFIRM_MS, null);
}
newGameButton.addEventListener('click', () => {
  const press = pressNewGame(confirmNew, performance.now(), history.length);
  askNewGame(press.confirm);
  if (press.start) newGame();
});
function newGame(): void {
  dropFirstRun();
  if (hub) {
    leaveHub();
    applyDeck(deckOf('local'));
  }
  engine = new Engine();
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  selected = [];
  thinking = false; // the bot's reply to the old game is dropped (botTurn)
  void saves.clear();
  view = resetView(4);
  applyView();
  refresh();
  analyse(); // the bar follows the new game, an answer for the old one is dropped
}
newGameButton.disabled = false; // listener ready (#146)

// Boss fight: the menu lists the bosses of the bridge, picking one switches the page to encounter
// mode (human Black, the boss answers in the worker). Retry restarts the same boss and seed.
const bossButton = document.getElementById('boss-fight')!;
const bossList = document.getElementById('boss-list')!;
const retryButton = document.getElementById('boss-retry')!;
/** What the army brings to the lair `id` entered from the world (#1655): the special marbles on its side and the relics when the boss takes the army's build (`takes_build`), nothing for the others. */
function lairBuild(id: string, seed: number, mirror: boolean, brought: number[], relics: number[]): { placed: number[][]; relics: number[] } {
  const probe = new Encounter(id, seed);
  if (mirror) probe.set_mirror();
  return probe.takes_build() ? { placed: placeBrought(probe.board(), brought), relics } : { placed: [], relics: [] };
}
function startBoss(id: string, seed: number, daily?: { day: string; attempt: number }, resumeFrom?: { engine: Engine | Encounter; moves: number[][] }, lair: typeof lairFrom = null, mirror = false): void {
  modeProbe.begin('boss');
  leaveMode();
  lairFrom = lair; // a fight picked in a menu, a door or the daily is no lair's (#1170)
  syncBoardLook();
  worker = botWorker; // the boss answers, after the hub's hot-seat table too (#522)
  stopAnalysis();
  fight = { id, seed, daily, mirror };
  storyEvent({ on: 'start', id }); // The Ballast Mind's fight starts is stage 6 (#1584)
  goalOpen = false;
  engine = resumeFrom?.engine ?? encounterFor(Encounter, id, seed, lair?.placed, lair && fightArmed(lair) ? relicsMask(lair.relics) : undefined, mirror); // a lair of the world gets the army's marbles and relics (#1655) // the mirror of the trait starts with the fight (#1620)
  history.length = 0;
  undone = false; // a fresh game (#1672)
  history.push(...(resumeFrom?.moves ?? []));
  replaying = null;
  selected = [];
  thinking = false;
  if (!resumeFrom && stalkerSaved()) void saves.save(savedGame(), false); // a new Stalker fight replaces the saved one (#1122)
  bossList.hidden = true;
  bossButton.setAttribute('aria-expanded', 'false');
  moveModes('pick');
  retryButton.hidden = false;
  newGameButton.hidden = true;
  document.body.dataset.boss = id;
  applyDeck(deckOf('boss', id), id);
  playCue('boss-intro', 0.12); // after the click on the boss, short so as not to ride on the tally line
  refresh(); // the HUD of the fight first: the view keeps off its plate
  view = fitted = fightView();
  if (!resumeFrom) beginEntrance(id); // a fight from a reload does not replay it
  applyView();
}
/** Whether the boss menu locks the bosses above the Hub's lifts (#1527): a player's browser does, an automated page (every other spec) only with `?locks`.
 * Links, `startBoss` itself, the Hub's doors, the lairs and the test hooks never ask. */
const menuLocks = !navigator.webdriver || new URLSearchParams(location.search).has('locks');
const bossEntries = new Map<string, HTMLButtonElement>();
for (const id of boss_ids()) {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.textContent = boss_name(id)!;
  entry.title = bossBlurb(id)!; // the tower's one line of the story (#1544)
  entry.addEventListener('click', () => {
    if (!entry.dataset.locked) startBoss(id, crypto.getRandomValues(new Uint32Array(1))[0]!);
  });
  bossList.appendChild(entry);
  bossEntries.set(id, entry);
}
/** The medal and its best turn count next to each beaten boss (#791), read from the storage when the menu opens. */
function showMedals(): void {
  const beaten = loadProgress(store).beaten;
  for (const [id, entry] of bossEntries) {
    const turns = bestTurns(store, id);
    const lock = menuLocks ? bossLockLine(id, beaten) : ''; // a boss above the Hub's lifts is locked, with its reason (#1527)
    entry.replaceChildren(boss_name(id)!);
    if (turns !== null) entry.append(' ', Object.assign(document.createElement('span'), { className: 'medal', textContent: medalLabel(turns) }));
    if (lock) {
      entry.append(' ', Object.assign(document.createElement('span'), { className: 'lock', textContent: lock }));
      entry.dataset.locked = lock;
      entry.setAttribute('aria-disabled', 'true');
    } else {
      delete entry.dataset.locked;
      entry.removeAttribute('aria-disabled');
    }
  }
}
bossButton.addEventListener('click', () => {
  if (online) return;
  if (bossList.hidden) showMedals();
  bossList.hidden = !bossList.hidden;
  bossButton.setAttribute('aria-expanded', String(!bossList.hidden));
  if (!bossList.hidden) showCoopList(false); // one boss list open at a time (#615)
});
(bossButton as HTMLButtonElement).disabled = false; // engine, boss list and listener ready (#144)

// Daily challenge (#195): the UTC date gives the boss and the seed, the same for everyone that day.
// Each start counts one attempt of the day in localStorage, Retry included. Retry on a daily starts
// the daily of the current day, so after 00:00 UTC it is the new day's fight.
const dailyButton = document.getElementById('daily') as HTMLButtonElement;
function today(): Daily {
  const daily = dailyFor(utcDay(Date.now()), boss_ids());
  // The boss name is a span: held upright on a phone it takes a line of its own (ui.css, #575).
  const bossName = boss_name(daily.id)!;
  const name = Object.assign(document.createElement('span'), { textContent: bossName });
  dailyButton.replaceChildren(dailyTitle(daily.day, ''), name);
  dailyButton.title = dailyTitle(daily.day, bossName); // a phone cuts the label (ui.css, #1000): the whole name stays on hover
  return daily;
}
function startDaily(): void {
  if (online) return;
  const { day, id, seed } = today();
  startBoss(id, seed, { day, attempt: countAttempt(store, day) });
}
today();
setInterval(today, 60_000); // an open page follows the day change at 00:00 UTC
dailyButton.addEventListener('click', startDaily);
dailyButton.disabled = false; // label and listener ready (#144)
goalButton.addEventListener('click', () => {
  goalOpen = !goalOpen;
  if (goalOpen) {
    moveModes('outside'); // one sheet at a time (#1032)
    moveMenu('outside');
    closeLobby(); // one sheet at a time (#1044)
  }
  hud();
});
// Esc closes the Goal sheet and gives the focus back to Goal; a tap outside the sheet and its button closes it too (#1032).
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !goalOpen) return;
  closeGoal();
  goalButton.focus();
});
addEventListener('pointerdown', (e) => {
  if (goalOpen && !within(goalSheet, e.target) && !within(goalButton, e.target)) closeGoal();
});
// The wild fight (#1511, docs/specs/openworld.md section 3c): a wandering marble of the Open world that touches the hero starts the normal
// Abalone fight against a modest bot (WILD_NODES), on the arena board of the hour it was met at. After the wipe the world is left, saved with the
// hero where it stands. Flee, a loss and a reload put the hero back there; a win takes the marble out of the world, saved as a marble the troop ejected.
/** Marks, or unmarks, that a wild fight is under way. */
function wildMarked(on: boolean, seed = 0): void {
  write(store, WILD_KEY, on ? String(seed) : '');
}
/** The wild fight of `from` begins: the world is left, and the arena opens against the bot. The local game the player had stays in its store. */
function startWild(from: NonNullable<typeof wildFrom>): void {
  leaveMode();
  wildFrom = from;
  wildMarked(true, from.seed);
  syncBoardLook();
  worker = botWorker;
  stopAnalysis();
  applyDeck(deckOf('local'));
  engine = fightArmed(from) ? engineFor(Engine, FULL_ARMY, from.placed, wildFoes(from.relics), undefined, relicsMask(from.relics)) : new Engine(); // the army's special marbles on its side and its relics set: the rogue-lite flag, as the bot's search has it (#1655)
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  selected = [];
  thinking = false;
  moveModes('pick');
  retryButton.hidden = true;
  newGameButton.hidden = true;
  view = resetView(4);
  applyView();
  refresh();
  analyse();
}
/** The player's own local game comes back under the world once a wild fight ends (a game started before is read from its store). */
async function restoreLocal(): Promise<void> {
  const back = await loadLocal();
  worker = back && !back.bot ? null : botWorker;
  engine = back?.engine ?? new Engine();
  history.length = 0;
  undone = false; // a fresh game (#1672)
  history.push(...(back?.moves ?? []));
  undone = back?.undone === true;
  replaying = null;
  selected = [];
  thinking = false;
  view = resetView(4);
  applyView();
  refresh();
}
/** The hero goes back to its world where it stood: Flee, Back after a fight, a loss. */
function returnFromWild(): void {
  const { seed } = wildFrom!;
  wildFrom = null;
  wildMarked(false);
  wildFlee.hidden = true;
  syncBoardLook();
  newGameButton.hidden = false;
  void openWorld.open(seed, innerWidth, innerHeight).then(restoreLocal);
}
/** A won wild fight: the marble that started on `wild.home` is gone from the saved world and told to the other heroes, once per fight. */
let wildSeen: unknown = null;
function wildWon(wild: NonNullable<typeof wildFrom>): string {
  if (wildSeen !== engine) {
    wildSeen = engine;
    void openWorld.loaded.saves.beatMarble(wild.seed, wild.home);
    openWorld.loaded.peers.wildWon(wild.seed, wild.home);
  }
  return 'The marble is gone from the world.';
}
/** The army once a fight the Open world started is over (#1655): the special marbles the board no longer holds (thrown off, a Bomb burst) are gone from the army, saved once per fight,
 * the first one kept by the Hull plating. Flee and Back keep them all, since they end the fight before this. Says what was lost and what the Hull plating kept, '' when nothing was. */
let thrownSeen: { game: unknown; line: string; lost: number[] } | null = null;
function wildThrown(world: { seed: number; placed: number[][]; relics: number[] }): string {
  if (thrownSeen?.game === engine) return thrownSeen.line; // the HUD is drawn again: the same line, nothing saved twice
  const { lost, kept } = hullKeeps(world.relics, thrownOff(world.placed.map(([, , kind]) => kind!), armyKept(engine.board(), engine.specials())));
  const names = (kinds: number[]): string => kinds.map((kind) => SPECIAL_LOOKS[kind - 1]!.name).join(', ');
  const line = [lost.length > 0 ? `Lost: ${names(lost)}.` : '', kept.length > 0 ? `Hull plating kept ${names(kept)}.` : ''].filter(Boolean).join(' ');
  thrownSeen = { game: engine, line, lost };
  if (lost.length > 0) {
    const { saves } = openWorld.loaded;
    void saves.load(world.seed).then((save) => save && saves.setStock(world.seed, save.resources, lose(save.army, lost)));
  }
  return line;
}
/** The lair of a retry: the army's marbles thrown off in the fight just lost are not placed again (#1655). */
function retriedLair(): typeof lairFrom {
  return lairFrom && thrownSeen?.game === engine ? { ...lairFrom, placed: withoutKinds(lairFrom.placed, thrownSeen.lost) } : lairFrom;
}
wildFlee.addEventListener('click', () => wildFrom && returnFromWild());
addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && wildFrom && engine.status() === 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) wildFlee.click(); // Flee by the keyboard
});
retryButton.addEventListener('click', () => (trainer ? startTrainer(1) : fight!.daily ? startDaily() : startBoss(fight!.id, fight!.seed, undefined, undefined, retriedLair(), fight!.mirror))); // a lair's retry stays the lair's (#1170), its trait too

// The hub (#521, game-design.md section 3.5): Hub draws the map of the saved deck, in that deck's look, with the
// player's glass marble on the saved cell. A click on a neighbour cell or an arrow key rolls it one cell (hub.ts step),
// and the spot is saved (progress.ts). A new game, a boss fight or Play online leaves it.
/** Draws the sheet from the stock on show; the focus goes back to the button that was pressed, or to the first one still enabled of its row. */
function drawWorkshop(pressed?: { row: number; act: string }): void {
  workshopBody.innerHTML = workshopHtml(workshopStock!);
  if (!pressed) return;
  const row = workshopBody.querySelectorAll('li')[pressed.row]!;
  (row.querySelector<HTMLButtonElement>(`button[data-act="${pressed.act}"]:not(:disabled)`) ?? row.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? workshop).focus(); // a row with nothing left to press keeps the focus in the sheet
}
/** The Workshop shows only in the Hub of a town of the Open world (#1655), not in the Hub of the mode menu. */
function syncWorkshop(): void {
  workshopOpen.hidden = !(hub !== null && placeFrom?.kind === 'town');
  if (workshopOpen.hidden) closeWorkshop();
}
function closeWorkshop(): void {
  workshop.hidden = true;
  workshopStock = null;
}
workshopOpen.addEventListener('click', async () => {
  const { seed } = placeFrom!;
  const save = await openWorld.loaded.saves.load(seed);
  if (!hub || placeFrom?.seed !== seed) return; // the Hub was left while the save was read
  workshopStock = { resources: save?.resources ?? NO_RESOURCES, army: save?.army ?? NO_ARMY };
  drawWorkshop();
  workshop.hidden = false;
  workshop.focus();
});
document.getElementById('workshop-close')!.addEventListener('click', () => {
  closeWorkshop();
  workshopOpen.focus();
});
const WORKSHOP_ACTS = { buy: buyMarble, upgrade: upgradeMarble, sell, bring, leave: leaveBrought };
const RELIC_ACTS = { buy: buyRelic, sell: sellRelic, bring: bringRelic, leave: leaveRelic };
workshopBody.addEventListener('click', ({ target }) => {
  const pressed = (target as Element).closest<HTMLButtonElement>('button[data-act]');
  if (!pressed || !workshopStock) return;
  const { act, kind, relic } = pressed.dataset as { act: keyof typeof WORKSHOP_ACTS; kind?: string; relic?: string };
  workshopStock = relic === undefined ? WORKSHOP_ACTS[act](workshopStock, Number(kind)) : RELIC_ACTS[act as keyof typeof RELIC_ACTS](workshopStock, Number(relic));
  void openWorld.loaded.saves.setStock(placeFrom!.seed, workshopStock.resources, workshopStock.army);
  drawWorkshop({ row: Array.from(workshopBody.querySelectorAll('li')).indexOf(pressed.closest('li')!), act });
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || workshop.hidden) return;
  e.preventDefault();
  workshop.querySelector<HTMLButtonElement>('#workshop-close')!.click(); // Esc closes the sheet and gives the focus back to its button
});
const shipButton = document.getElementById('ship') as HTMLButtonElement;
shipButton.addEventListener('click', () => {
  moveModes('pick');
  enterHub(loadProgress(store).at);
});
shipButton.disabled = false; // listener ready (#146)
function enterHub(at: HubSpot): void {
  const from = placeFrom; // the Hub of a town keeps its way back to the world (#1593)
  leaveMode();
  placeFrom = from;
  roomOf = null;
  hub = new HubController(at);
  hub.enter(at);
  hubPlan.hidden = false;
  hubCoach.hidden = !(helpOn && hubCoachDue(store, loadProgress(store).beaten));
  view = fitted = fightView(); // the deck plan, framed closer (#1249)
  applyView();
  evalBar.hidden = hintButton.hidden = exportButton.hidden = importButton.hidden = true; // no game on in the hub: a new game shows them again (#583, #589)
  analyst.stop();
  sceneRenderer.setHubFloor(true); // the dark neon ground round the deck (#1639)
  applyDeck(at.deck);
  refresh();
}
// The first minutes in the Hub (#1522, hubcoach.ts, ui.md 4.5): a coach line says how to roll until the player has rolled once, a tap on a
// plate walks the marble to its room over floor cells, and until the player has entered a mode once, a roll onto a room asks first.
// An automated browser shows the line and the confirm only under ?firstrun, so the specs that walk into rooms boot as before.
const hubCoach = document.getElementById('hub-coach')!;
hubCoach.textContent = HUB_COACH;
const hubConfirm = document.getElementById('hub-confirm')!;
const traitChoice = { panel: document.getElementById('trait')!, text: document.getElementById('trait-text')!, yes: document.getElementById('trait-yes') as HTMLButtonElement, no: document.getElementById('trait-no') as HTMLButtonElement }; // the choice before a tower (#1620)
const hubConfirmText = document.getElementById('hub-confirm-text')!;
const hubConfirmYes = document.getElementById('hub-confirm-yes')!;
const helpOn = hubHelpOn(location.search, navigator.webdriver);
const HUB_STEP_MS = 160; // between the rolls of a walk to a plate
let hubWalking: ReturnType<typeof setTimeout> | null = null;
let askedFor: Axial | null = null; // the cell whose room the confirm asks about
/** Stops the walk to a plate and closes the confirm: the player took over, or the hub is left. */
function cancelHubWalk(): void {
  if (hubWalking !== null) clearTimeout(hubWalking);
  hubWalking = null;
  askedFor = null;
  hubConfirm.hidden = true;
}
/** One roll to a neighbour cell; false when the marble did not roll (a locked lift, a room that asks first). */
function walk(to: Axial): boolean {
  const progress = loadProgress(store);
  const deck = hub!.at.deck;
  const next = step(hub!.at, to, progress.beaten);
  const door = next === hub!.at ? undefined : roomAt(next.deck, next.cell);
  if (door && helpOn && needsConfirm(door) && entryConfirmDue(store, progress.beaten)) {
    askedFor = to;
    hubConfirmText.textContent = `Enter ${entryName(next.deck, door)}?`;
    hubConfirm.hidden = false;
    hubConfirmYes.focus();
    return false;
  }
  const { stepped, at } = hub!.onCellClick(to, progress.beaten);
  if (!stepped) {
    hud();
    return false;
  }
  markHubCoachDone(store); // the player rolled: the coach line has done its job
  hubCoach.hidden = true;
  saveProgress(store, { ...progress, at });
  if (at.deck !== deck) applyDeck(at.deck);
  refresh();
  enterRoom(at);
  return true;
}
/** A tap on a plate: the marble rolls toward its room, one cell every few frames. */
function walkTo(target: Axial): void {
  cancelHubWalk();
  const path = hubPath(hub!.at, target)!;
  const roll = (): void => {
    if (walk(path.shift()!) && hub && path.length) hubWalking = setTimeout(roll, HUB_STEP_MS);
  };
  if (path.length) roll();
}
hubLabels.addEventListener('click', (e) => {
  const [q, r] = (e.target as Element).closest<HTMLElement>('[data-cell]')!.dataset.cell!.split(',').map(Number);
  walkTo([q!, r!]);
});
document.getElementById('hub-confirm-no')!.addEventListener('click', cancelHubWalk);
hubConfirmYes.addEventListener('click', () => {
  const to = askedFor!;
  markEntered(store);
  cancelHubWalk();
  walk(to);
});
// The doors (#522): rolling onto a boss door or a table starts the same game as its mode menu entry, and the room is
// kept for Back to the hub. A terminal opens its lore entry in the reader, and Esc leaves it to the hub on the same
// cell (#524). A lift starts nothing here.
function enterRoom(at: HubSpot): void {
  const from = placeFrom; // a table or a boss of the Hub of a town is still that visit (#1593)
  const door = roomAt(at.deck, at.cell);
  if (locked && door && doorLocked(door.kind)) return; // the Hub stays as it is: its boss and mode doors wait for the first win (#1665)
  if (door?.kind === 'terminal') return openReader(door.lore);
  if (door?.kind === 'medals') return openReader(MEDAL_ROOM);
  if (door?.kind === 'boss') startBoss(door.boss, crypto.getRandomValues(new Uint32Array(1))[0]!);
  else if (door?.kind === 'hotseat' || door?.kind === 'bot') startLocal(door.kind === 'bot');
  else if (door?.kind === 'online' && !playOnlineButton.disabled) playOnline();
  else if (door?.kind === 'royale') startRoyale({ seed: crypto.getRandomValues(new Uint32Array(1))[0]!, rounds: [] });
  else if (door?.kind === 'daily') startDaily();
  else if (door?.kind === 'ranked' && !rankedButton.disabled) rankedButton.click();
  else return enterModeRoom(door);
  roomOf = at;
  placeFrom = from;
  syncExit(); // the table is started: its exit leads to the Hub (#1517)
}
// The other mode rooms (#1249) do what their menu entry does, and keep no room for Back to the hub: Hub in the mode
// menu takes the player back from a run, the Trainer and the Open world, and Fight together opens the mode menu on its
// boss list.
function enterModeRoom(door: Door | undefined): void {
  if (door?.kind === 'run') runButton.click();
  else if (door?.kind === 'trainer') trainerButton.click();
  else if (door?.kind === 'world') openWorldButton.click();
  else if (door?.kind === 'together') {
    if (!modesOpen) moveModes('button');
    showCoopList(true);
  }
}
function startLocal(bot: boolean): void {
  modeProbe.begin('arena');
  leaveMode();
  applyDeck(deckOf('local'));
  worker = bot ? botWorker : null;
  newGame();
}
// Quick game (#1612, Decision #1513): a bot game from the dock and from the Open world's plate, outside the world. An unfinished game
// asks first, as New game does (pressNewGame), and the question shows on the Quick game button that was pressed, since the New game
// button is hidden in a fight, a run or the world.
const quickButtons = [document.getElementById('quick-game')!, document.getElementById('openworld-quick')!] as HTMLButtonElement[];
let confirmQuick: Confirm = null;
let quickLapse = 0; // ends the question
function askQuickGame(confirm: Confirm): void {
  confirmQuick = confirm;
  for (const quick of quickButtons) quick.textContent = confirm === null ? 'Quick game' : 'Confirm quick game';
  clearTimeout(quickLapse);
  if (confirm !== null) quickLapse = setTimeout(askQuickGame, CONFIRM_MS, null);
}
/** Quick game is hidden in a fight, a boss or a wild one (#1612): the press of a fight that is still on does nothing, as a hidden button does. */
function syncQuick(): void {
  const hidden = quickGameHidden(fight !== null, wildFrom !== null);
  for (const id of ['quick-game', 'openworld-quick']) document.getElementById(id)!.hidden = hidden; // by id: refresh() may run before the buttons below are set up
}
for (const quick of quickButtons) {
  quick.addEventListener('click', () => {
    if (quickGameHidden(fight !== null, wildFrom !== null)) return;
    const press = pressNewGame(confirmQuick, performance.now(), history.length);
    askQuickGame(press.confirm);
    if (press.start) startLocal(true);
  });
  quick.disabled = false; // listener ready (#146)
}
// The one-tap Open world of a fresh profile (#1612): the dock entry opens the world as the mode menu's entry does.
const openWorldEntry = document.getElementById('open-world-entry') as HTMLButtonElement;
openWorldEntry.addEventListener('click', () => openWorldButton.click());
openWorldEntry.disabled = false; // listener ready (#146)
/** The exit of the dock (#1517): to the Open world, the hero on the entrance cell the mode was entered from (a lair, a wild marble, a town, a gate),
 * or to the Hub, the saved world left as Esc leaves it. The Hub of a table's door keeps the door's cell. */
function leaveByExit(): void {
  const to = exitNow();
  if (to === 'hub') return roomOf ? enterHub(roomOf) : shipButton.click();
  if (wildFrom) return returnFromWild();
  const fromLair = lairFrom !== null;
  const { seed, kind } = lairFrom ? { seed: lairFrom.seed, kind: 'tower' as const } : placeFrom!;
  leaveMode(); // the fight, the Hub or the run is left
  void openWorld.open(seed, innerWidth, innerHeight, true, kind).then(() => (fromLair ? restoreLocal() : undefined)); // the world as the place left it: the hero on the entrance (#1170, #1593); the table beneath is the saved game, not the fight's board
}
/** A fight in progress is not saved: once a ply is played, the first press asks "Sure?" for CONFIRM_MS, as New game does (newgame.ts). A fight over, a fight with
 * no ply, a table, a run, the Trainer, the Hub and the world ask nothing. Browser Back asks nothing either (ui.md 4.9): it calls leaveByExit. */
let confirmExit: Confirm = null;
let lapseExit = 0;
function askExit(confirm: Confirm): void {
  confirmExit = confirm;
  exitButton.classList.toggle('confirm', confirm !== null);
  clearTimeout(lapseExit);
  if (confirm !== null) lapseExit = setTimeout(askExit, CONFIRM_MS, null);
  exitButton.dataset.label = confirm === null ? '' : 'Sure?'; // the label of where it leads is drawn again by syncExit
  syncExit();
}
exitButton.addEventListener('click', () => {
  const press = pressNewGame(confirmExit, performance.now(), fight !== null && engine.status() === 0 ? history.length : 0);
  askExit(press.confirm);
  if (press.start) leaveByExit();
});
// One mode at a time (#1275, docs/specs/ui.md): every mode's start leaves the mode on first, the hub by its controller's
// exit(), each other mode by its leave, then clears what no mode owns (modeswitch.ts). Nothing of a mode stays in the next.
// The Open world opens over the page instead (#1063): Esc gives the game beneath back as it was, and the next mode leaves it.
function leaveMode(): void {
  askExit(null); // a question of the exit lapses with the mode
  dropFirstRun();
  needBoard(); // a lair, a town or a gate has left the world already: the board is what shows next
  if (openWorld.active) openWorld.leave();
  leaveRun();
  leaveTrainer();
  leaveRoyale(); // first: its room is the page's online session too
  leaveOnline();
  leaveHub();
  fight = null;
  lairFrom = null;
  wildFrom = null;
  placeFrom = null; // the next mode is no town's or gate's (#1593)
  wildMarked(false);
  wildFlee.hidden = true;
  syncBoardLook();
  goalOpen = false;
  speech = null;
  skipEjections(); // the effects of the mode's last move end with it
  clearStray(document);
  newGameButton.hidden = false;
  syncQuick();
}
function leaveHub(): void {
  if (!hub) return;
  cancelHubWalk();
  hub.exit();
  hub = null;
  sceneRenderer.setHubFloor(false); // the fight's surround leans to its deck again (#1639)
  hubPlan.hidden = true;
  view = fitted = resetView(4); // a board again, as at the start: the game started from the hub frames its own (#1249)
  applyView();
}
addEventListener('keydown', (e) => {
  // An open terminal reader pages by them, a text field moves its caret.
  const to = hub && !openWorld.active && workshop.hidden && !(e.target instanceof HTMLInputElement) ? hub.onKeyDown(e.key, Boolean(reading)) : null;
  if (!to) return;
  e.preventDefault(); // no page scroll
  cancelHubWalk();
  walk(to);
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || hubConfirm.hidden) return;
  e.preventDefault();
  cancelHubWalk(); // Stay
});

// Daily result card (#196): once a daily fight is over, the text to share, and Copy. The text is
// built here and goes nowhere but the clipboard, and only when the player copies it. Copy uses the
// clipboard helper of Copy diagnostics (#220): when the browser refuses, the text is selected in its
// box to copy by hand. It is only set when it changes, so a HUD update keeps the selection.
const resultCard = document.getElementById('daily-card')!;
const resultText = document.getElementById('daily-result') as HTMLTextAreaElement;
const dailyCopy = document.getElementById('daily-copy')!;
function showResultCard(): void {
  const text =
    fight?.daily && engine instanceof Encounter
      ? dailyCard({
          day: fight.daily.day,
          boss: engine.name(),
          result: engine.result(),
          plies: history.length,
          attempt: fight.daily.attempt,
        })
      : '';
  if (text !== '') recordDailyResult(store, fight!.daily!.day, (engine as Encounter).result() === 1, playerTurns(history.length)); // the day's result, for the notice board (#1528)
  const shown = text !== '' && text !== closedCard; // a card the player closed stays closed until its text changes
  if (shown && resultCard.hidden) cardOpener = document.activeElement as HTMLElement | null;
  resultCard.hidden = !shown;
  if (resultText.value !== text) {
    resultText.value = text;
    dailyCopy.textContent = 'Copy result'; // a new result is not copied yet
    dailyCopy.classList.remove('copied');
  }
}
// The card is a sheet above the dock (#1032): Esc or a tap outside closes it, and the focus goes back to what had it.
let closedCard = '';
let cardOpener: HTMLElement | null = null;
function closeResultCard(): void {
  if (resultCard.hidden) return;
  closedCard = resultText.value;
  resultCard.hidden = true;
  cardOpener?.focus();
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeResultCard();
});
addEventListener('pointerdown', (e) => {
  if (!within(resultCard, e.target)) closeResultCard();
});
dailyCopy.addEventListener('click', async () => {
  if (await copyText(resultText.value, navigator.clipboard)) {
    dailyCopy.textContent = 'Copied';
    dailyCopy.classList.add('copied'); // the check mark draws in (#1098)
    copiedNote = { game: engine };
    return hud();
  }
  resultText.focus();
  resultText.select();
  hud(' · result selected: copy it by hand');
});

// Export and import (#219): the local game as a JSON file in the save format, docs/specs/tech.md section 8. An
// imported game is replayed through the engine, replaces the local game and is saved like one, in this page's mode
// (against the bot, or hot-seat with ?bot=off). A bad file changes nothing but the HUD note.
const exportButton = document.getElementById('setting-export-game') as HTMLButtonElement; // in the settings menu (#287)
const importButton = document.getElementById('setting-import-game') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
exportButton.addEventListener('click', () => {
  const link = document.createElement('a');
  const text = gameFileText({ bot: worker !== null, moves: history });
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = gameFileName(new Date());
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000); // the download may still be reading it
});
importButton.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = ''; // so picking the same file again is a change too
  if (!file) return;
  const read = await readGameFile(file, () => new Engine());
  if (online || fight || hub) return; // the player left for another game, or the hub, while the file was read
  if ('refused' in read) return hud(` · ${read.refused}`);
  engine = read.engine;
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  history.push(...read.moves);
  selected = [];
  thinking = false;
  void saves.save(savedGame(), engine.status() !== 0);
  refresh();
  analyse(); // the bar follows the imported position (#191)
  void botTurn();
});
exportButton.disabled = importButton.disabled = false; // listeners ready (#146)

// Online play: Black creates the room and shares the invite link, the link opener plays White.
// The engine stays the only judge: every remote move is replayed through it, a bad one is refused.
// ?net=hook swaps the Trystero transport for the page hook the e2e test wires (no public relays).
// Once the game is over, Rematch starts a new game in the same room with the colours swapped (#186).
let online: OnlineSession | null = null;
let duel = false; // a boss duel (#1316): the White seat plays the boss, its moves come from the room, not from the engine's search
// The heartbeat of the room's session (#359), stopped when the room is left (#1275).
const beats: ReturnType<typeof setInterval>[] = [];
const beatEvery = (fn: () => void, ms: number): void => void beats.push(setInterval(fn, ms));
const stopBeats = (): void => beats.splice(0).forEach((id) => clearInterval(id));
let onlineNote = '';
let offlineNotice = ''; // no connection: Play online is disabled, a game in progress keeps its own status (#194)
let playReady = false;
let onlineLine: OnlineStatus | undefined;
let link: Transport | null = null; // the transport of the online room, closed by Back to the hub (#522)
let rankedMode: RankedMode | null = null;
let rankedQueuedAt = 0;
let rankedDelta: number | undefined;
let rankedDone = false;
let ratedRoyale: Royale | null = null; // the royale game already rated: pressing Ranked again after it ends rates nothing
let rankedSent = false;
let rankedMine: Report | null = null;
let rankedTheirs: Report | null = null;
let rankedResult: 'refused' | undefined;
// The seats seal a ranked result (#1287, rankedseal.ts): behind ?board, only when this seat joined the board; the other seat's intro is
// what proves it joined too. The result both seats signed goes to the three relays (publish.ts) and is kept in `sealedResult`.
let roomKeys: Keys | null = null;
let sealing: { game: string; seal: Promise<RankedSeal> } | null = null;
let sealedResult: SharedResult | null = null;
function sealOf(): Promise<RankedSeal> | null {
  const session = online;
  if (!session || !roomKeys || !link || rankedMode !== '1v1' || readChoice(store) !== 'joined') return null;
  if (sealing?.game !== session.game) {
    const keys = roomKeys;
    sealing = { game: session.game, seal: boardKeys(store).then((board) => new RankedSeal({ game: session.game, side: session.side as 1 | 2, keys, board, name: readBoardName(store), opponent: session.opponent, nowS: () => Math.floor(Date.now() / 1000) })) };
  }
  return sealing.seal;
}
function sealed(step: Step): void {
  if (step.send) link?.send(step.send);
  if (step.result) {
    sealedResult = step.result; // both seats signed it: it goes to the relays, a relay that refuses only means it is not on the board
    if (publishAllowed(store, location.search)) void publishResult((url) => new WebSocket(url), step.result, Math.floor(Date.now() / 1000)); // the consent is checked again: a Leave during the wait sends nothing
  }
}
/** The pair of reports agreed: our intro goes out, and the final is offered to the seal. */
async function sealFinal(): Promise<void> {
  const seal = await sealOf();
  if (!seal) return;
  link?.send(await seal.intro());
  sealed(await seal.finish({ moves: history.map((m) => [...m]), status: engine.status(), ejected: [engine.ejected(1), engine.ejected(2)] }));
}
/** A seal from the other seat. */
async function sealReceived(raw: unknown, key: string): Promise<void> {
  const seal = await sealOf();
  if (seal) sealed(await seal.receive(raw, key));
}
/** Rates the 1v1 once both signed reports are in; reports that differ rate nothing (#1317). */
function settleRankedPair(): void {
  if (rankedMode !== '1v1' || rankedDone || !rankedMine || !rankedTheirs) return;
  rankedDone = true;
  const settled = settleRanked1v1(store, rankedMine, rankedTheirs);
  if (settled) void sealFinal();
  rankedDelta = settled?.delta;
  rankedResult = settled ? undefined : 'refused';
  hud();
}
const inviteBox = document.getElementById('invite') as HTMLInputElement;
const inviteLabel = document.getElementById('invite-label')!;
const inviteCopy = document.getElementById('invite-copy') as HTMLButtonElement;
/** Shows the invite link of a room, its address too. The link makes the button column taller, and a column scrolled down
 * to the mode menu would keep the buttons above out of its box: it goes back to the top (#839). */
function showInvite(url: string, caption: string): void {
  inviteBox.value = url;
  location.hash = new URL(url).hash;
  inviteBox.hidden = inviteLabel.hidden = inviteCopy.hidden = false;
  inviteLabel.textContent = caption;
  document.getElementById('online')!.scrollTop = 0;
  syncLobby(); // the link sits in the lobby sheet (#1044)
}
const hideInvite = (): void => {
  inviteBox.hidden = inviteLabel.hidden = inviteCopy.hidden = true;
  syncLobby();
};
// Copy (#839): the link goes to the clipboard and the link, its label and Copy close: the HUD says so, and the focus goes
// to Game modes, not to the page (#1190). When the browser refuses, the link stays, selected, to copy by hand.
inviteCopy.addEventListener('click', async () => {
  if (await copyText(inviteBox.value, navigator.clipboard)) {
    document.getElementById('modes')!.focus();
    hideInvite();
    return hud(' · invite link copied');
  }
  inviteBox.focus();
  inviteBox.select();
  hud(' · invite link selected: copy it by hand');
});
// The offer (#1529, lobby.ts): a creator's lobby that waited 20 s with no peer offers a bot game of the same kind, a table or the
// same boss. The room stays open and listening beside it (`parked`); a peer who joins shows a line to switch to the room.
const lobbyOffer = document.getElementById('lobby-offer')!;
const lobbyBot = document.getElementById('lobby-bot') as HTMLButtonElement;
const roomSwitch = document.getElementById('room-switch') as HTMLButtonElement;
let lobbyOpenedAt = 0; // when the creator's room opened its lobby; 0 with no room waiting
let lobbyTimer: ReturnType<typeof setTimeout> | undefined;
/** The room a bot game plays beside: its session and transport keep listening, `back` seats the page in it again. */
let parked: { session: OnlineSession; link: Transport; ranked: RankedMode | null; back: () => void } | null = null;
let restoreRoom: (() => void) | null = null; // `back` of the page's room, set by goOnline
/** Draws the offer from the room: a peer in hides it, the wait with none shows it, and the timer is armed while waiting. */
function syncOffer(): void {
  clearTimeout(lobbyTimer);
  const session = online;
  const waitMs = lobbyWaitMs(location.search, navigator.webdriver);
  const waited = session && lobbyOpenedAt ? Date.now() - lobbyOpenedAt : 0;
  const state = session && lobbyOpenedAt ? lobbyState(waited, session.presenceOf(3 - session.side) === 'waiting' ? 0 : 1, waitMs) : 'joined';
  lobbyOffer.hidden = state !== 'offer';
  if (state === 'wait') lobbyTimer = setTimeout(syncOffer, waitMs - waited);
}
/** The switch line shows while a bot game plays beside a room and a player is in it. */
function syncSwitch(): void {
  roomSwitch.hidden = !parked || parked.session.presenceOf(3 - parked.session.side) === 'waiting';
}
lobbyBot.addEventListener('click', () => {
  const room = { session: online!, link: link!, ranked: rankedMode, back: restoreRoom! };
  const bot = botGameOf(fight);
  online = link = rankedMode = null; // the page plays a bot game: not the room's, never rated
  duel = false;
  onlineLine = undefined;
  onlineNote = '';
  for (const key of ['online', 'seat', 'opponent', 'coordinator', 'handover']) delete document.body.dataset[key];
  rematchButton.hidden = true;
  if (bot) startBoss(bot.id, bot.seed);
  else {
    leaveMode();
    applyDeck(deckOf('local'));
    newGame();
  }
  parked = room;
  syncSwitch();
});
roomSwitch.addEventListener('click', () => {
  const room = parked!;
  parked = null; // the bot game is left as it is today, the room is not closed with it
  leaveMode();
  rankedMode = room.ranked;
  roomSwitch.hidden = true;
  room.back();
});
const rematchButton = document.getElementById('rematch') as HTMLButtonElement;
rematchButton.addEventListener('click', () => void online?.rematch());
// Co-op (docs/specs/coop-boss.md section 3): every page plays the boss reply to each human move itself, from the same
// encounter. It is asked from the analysis worker, idle online: on the main thread one reply of The Hull or The Choir
// blocks the page for 150 ms typically, up to 440 ms (#529). Until it is played, the room's next message waits in the
// session's queue, so a partner's next move never comes before it; the boss reply to our own move is awaited first too.
let bossReply: Promise<void> = Promise.resolve();
function answerBoss(live: boolean): Promise<void> {
  bossReply = (async () => {
    if (engine.status() !== 0 || engine.to_move() !== 2) return; // the human move ended the fight, or was a free move (#958)
    const searchBudget = scaleBudget(budget, difficulty);
    const diffPercent = DIFFICULTY_PERCENT[difficulty];
    const move = await askBot(analysisWorker, history.slice(), searchBudget, fight!, diffPercent);
    await new Promise<void>((done) => whenSettled(() => (replay(move, live), refresh(), done())));
  })();
  return bossReply;
}
function replay(mv: ArrayLike<number>, live: boolean): void {
  leaveReplay();
  const before = Array.from(engine.board());
  engine.play(Int32Array.from(mv));
  afterPlay(before, Array.from(mv), live);
}
/** The creator waits for the others as long as it takes, a joiner should find the creator's room at once. */
function signalingTimeout(side: number): void {
  if (side !== 1) setTimeout(() => diag.timeout(), SIGNALING_TIMEOUT_MS);
}
/** The transport of `room`: Trystero, or the page hook the e2e test wires under ?net=hook. */
function roomTransport(room: string): Transport {
  return netHook(location.search) ? hookTransport() : p2pTransport(room, (message) => diag.joinError(message));
}
/** Joins `room` in seat `side`, a co-op room against the boss and seed of `coop` (#529), a versus room without. A joiner
 * from a link with the creator's fingerprint `creator` takes seat 1 only from that key (#1323). */
async function goOnline(room: string, side: number, coop?: CoopFight, creator?: string, asDuel = false): Promise<void> {
  if (consentWanted() && !(await onlineAllowed())) return; // Stay solo (#1338): nothing was contacted, the game in progress goes on
  leaveMode();
  stopAnalysis();
  // Seats the page in the room: its game, its buttons and its deck. Run again when the player switches back from a bot game (#1529).
  const seat = (): void => {
    fight = coop ? { id: coop.boss, seed: coop.seed } : null;
    duel = asDuel;
    // co-op: the same fight again, both seats asked (#531). The accessible name and the dock's short label follow the visible one (#1068).
    const again = coop ? 'Retry' : 'Rematch';
    rematchButton.textContent = again;
    rematchButton.setAttribute('aria-label', again);
    rematchButton.dataset.label = again;
    applyDeck(deckOf('online'));
    newGameButton.hidden = true;
    engine = makeGame();
    history.length = 0;
    undone = false; // a fresh game (#1672)
    replaying = null;
    selected = [];
  };
  seat();
  diag.connecting();
  const net = roomTransport(room);
  link = net;
  signalingTimeout(side);
  let netState = '';
  const joined = new EdgeWatch(); // the opponent comes in: one cue, as the status line is drawn again and again
  // An extra peer is a spectator: it follows the game and never sends (the spectator view is #34).
  // The status line shows our color and whether the key bound to the other seat is connected (#121).
  // Our color is the session's: it swaps at each rematch.
  const note = (): void => {
    if (!online) return syncSwitch(); // the room was left for the ship (#522), or a bot game plays beside it (#1529)
    const session = online; // set before the session calls back, and below before the first note
    const role = session.role;
    const mine = session.side;
    const other = coop && !duel ? 3 - side : 3 - mine; // co-op: the partner's seat, both seats play Black
    const opponent = session.presenceOf(other);
    document.body.dataset.online = role === 'spectator' ? 'Spectator' : sideName(mine, glassOf());
    document.body.dataset.seat = role; // read by the e2e tests
    document.body.dataset.opponent = opponent;
    if (opponent !== 'waiting') closeLobby(); // the opponent is in: the lobby folds
    if (joined.entered(opponent !== 'waiting' && role !== 'spectator')) playCue('online-join');
    document.body.dataset.coordinator = String(session.coordinatorSeq); // join_seq of the coordinator, read by the e2e tests (#359)
    document.body.dataset.handover = session.handover;
    onlineLine = duel ? duelStatus(mine, role, opponent, session.isAgent(other)) : coop ? coopStatus(role, opponent, session.isAgent(other)) : onlineStatus(mine, role, opponent, session.isAgent(other), glassOf());
    onlineNote = netState;
    hud();
    syncOffer();
  };
  const keys = await generateKeys();
  roomKeys = keys;
  const key = await fingerprint(keys.pub); // the creator's invite link carries it
  if (side === 1) {
    showInvite(inviteUrl(location.href, room, coop, key, duel), `Invite link: send it to your ${duel ? 'boss player' : coop ? 'partner' : 'opponent'}`);
    lobbyOpenedAt = Date.now(); // the wait for a peer starts (#1529); note() below draws the offer
    openLobby(); // the link shows open until an opponent connects, no tap on Lobby needed
  }
  online = new OnlineSession({
    game: room,
    side,
    engine: engine_version(),
    keys,
    creator,
    transport: net,
    judge: {
      to_move: () => engine.to_move(),
      play: coop && !duel
        ? async (mv, live) => {
            await bossReply;
            replay(mv, live);
            await answerBoss(live);
          }
        : replay,
      status: () => engine.status(),
      restart: () => {
        engine = makeGame();
        history.length = 0;
        undone = false; // a fresh game (#1672)
        replaying = null;
      },
      // A seat's turn is its main move and the Echo's free moves before it (#958).
      ...(coop && !duel && { mover: () => seatAfter(history.length - (engine as Encounter).free_taken(), 2) }),
    },
    onMove: () => {
      if (online!.role === 'player' && turnBack(engine.to_move(), online!.side, engine.status(), replaying !== null)) playCue('turn-start', AFTER_SLIDE); // the opponent has moved
      refresh();
    },
    onRefuse: (reason) => {
      diag.refused(reason);
      hud(` · refused move: ${reason}`);
    },
    onState: (s) => {
      diag.netState(s);
      netState = ` · ${s}`;
      note();
    },
    onRole: note,
    onPresence: note,
    onCoordinator: note,
    beat: { ms: beatPeriod(location.search, navigator.webdriver), now: Date.now, every: beatEvery },
    onRematchAsk: note,
    onOther: (m, key) => {
      if (parseSeal(m)) return sealReceived(m, key);
      diag.refused('malformed'); // any other message with a kind: as the session read it before seals
      hud(' · refused move: malformed');
    },
    onReport: (report) => {
      rankedTheirs = report;
      settleRankedPair();
    },
    onRematch: () => {
      selected = [];
      note();
      refresh();
    },
  });
  const fit = (): void => {
    if (coop) {
      view = fitted = fightView(); // as in a solo fight
      beginEntrance(coop.boss); // a co-op fight and a duel open as a solo one does (#1551)
      applyView();
    }
  };
  note();
  refresh();
  fit();
  const session = online;
  restoreRoom = (): void => {
    online = session;
    link = net;
    stopAnalysis();
    seat();
    note();
    refresh();
    fit();
  };
}
/** Opens a new room as its creator and shows its invite link: a co-op room with `coop` (#529), a versus room without. */
function playOnline(coop?: CoopFight, asDuel = false): void {
  rankedMode = null;
  moveModes('pick');
  leaveMode(); // the room left first: its invite link goes, the new one shows once its keys are made
  void goOnline(newRoomId((b) => crypto.getRandomValues(b)), 1, coop, undefined, asDuel); // it shows the invite link
}
document.getElementById('play-online')!.addEventListener('click', () => playOnline());
const rankedButton = document.getElementById('ranked') as HTMLButtonElement;
rankedButton.addEventListener('click', () => {
  if (boardAskNeeded(store)) void askBoard().then(startRanked);
  else startRanked();
});
function startRanked(): void {
  rankedDelta = undefined;
  rankedDone = false;
  rankedSent = false;
  rankedMine = rankedTheirs = null;
  rankedResult = undefined;
  rankedQueuedAt = Date.now();
  if (royale) {
    rankedMode = 'royale';
    moveModes('pick');
    hud();
    return;
  }
  playOnline();
  rankedMode = '1v1';
  hud();
}
// Fight together (#530): the mode menu lists the bosses again, under it; picking one opens a co-op room against that
// boss with a random seed, the creator in seat 1.
const coopButton = document.getElementById('fight-together') as HTMLButtonElement;
const coopList = document.getElementById('coop-list')!;
function showCoopList(shown: boolean): void {
  coopList.hidden = !shown;
  coopButton.setAttribute('aria-expanded', String(shown));
}
for (const id of boss_ids()) {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.textContent = boss_name(id)!;
  entry.title = bossBlurb(id)!; // the tower's one line of the story (#1544)
  entry.addEventListener('click', () => {
    showCoopList(false);
    playOnline({ boss: id, seed: crypto.getRandomValues(new Uint32Array(1))[0]! }, listIsDuel);
  });
  coopList.appendChild(entry);
}
// Boss duel (#1316): the same boss list under its own button, a room where the creator is the hero (Black) and the joiner,
// a person or an MCP agent, plays the boss (White). The room carries its moves, and both pages judge them with the encounter.
const duelButton = document.getElementById('boss-duel') as HTMLButtonElement;
let listIsDuel = false; // the shared list opened by Boss duel, not by Fight together
duelButton.addEventListener('click', () => {
  bossList.hidden = true;
  bossButton.setAttribute('aria-expanded', 'false');
  const open = !!coopList.hidden || !listIsDuel;
  listIsDuel = true;
  showCoopList(open);
});
coopButton.addEventListener('click', () => {
  if (coopList.hidden) {
    bossList.hidden = true; // one boss list open at a time (#615)
    bossButton.setAttribute('aria-expanded', 'false');
  }
  const open = !!coopList.hidden || listIsDuel;
  listIsDuel = false;
  showCoopList(open); // hidden or opened by Boss duel: open it
});
// Back to the hub from an online table (#522): the room is closed and the page is a local one again.
function leaveOnline(): void {
  lobbyOpenedAt = 0; // the wait and its offer end with the room (#1529)
  clearTimeout(lobbyTimer);
  lobbyOffer.hidden = true;
  if (parked) {
    ({ session: online, link } = parked); // a bot game was left: the room it played beside closes the usual way
    parked = null;
    roomSwitch.hidden = true;
  }
  if (!online) return;
  online = null;
  duel = false;
  stopBeats();
  link!.close();
  onlineNote = '';
  onlineLine = undefined;
  for (const key of ['online', 'seat', 'opponent', 'coordinator', 'handover']) delete document.body.dataset[key];
  hideInvite();
  rematchButton.hidden = true;
  newGameButton.hidden = false;
  window.history.replaceState(null, '', location.pathname + location.search); // no room in the address
}
const playOnlineButton = document.getElementById('play-online') as HTMLButtonElement;

// The rogue-lite run (#798, docs/specs/roguelite.md): Rogue-lite run in the mode menu starts a new run on the map of
// its seed. A pick on the map starts that node's fight against the bot, the army's marbles on the standard layout less
// those lost; once it is over the map shows again, or the run's summary and New run. The run is saved after every pick
// and move and resumed on load; another mode abandons it. The most acts won in one run unlocks the next runs' special
// marble types and commanders (#801, #1464), picked on the map before the first node.
const runPanel = document.getElementById('run-map')!;
const runButton = document.getElementById('roguelite') as HTMLButtonElement;
let runMore = false; // More is open on the start screen (#1524): shut for each new run, kept while a commander or a level is picked and through the book
let lastBanked: number[] = []; // the blueprints the run in progress or the last one banked (#1622): the town's line lists them
let gateBiome = 0; // the biome of the ground of the gate the next run starts from (#1597): the Meadow for a run of the mode menu or the Hub
function beginRun(): void {
  modeProbe.begin('run');
  const first = gateBiome;
  gateBiome = 0;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const runes = readRunes(store); // the runes found in earlier runs open hidden branches on this map (#1476)
  startRun(chooseCommander({ ...newRun(seed, readBest(store), readUnlocked(store), readAscension(store), runes, MAP_VERSION), first }, 0), parseMap(run_map(seed, runes, MAP_VERSION))); // the Captain until another is picked (#1464)
}
// The daily run (#1466): the seed of the day for everyone, one try a day (its button is shut once tried), its score kept when it ends.
function beginDailyRun(): void {
  const day = utcDay(Date.now());
  startDailyTry(store, day);
  startRun(dailyRun(day, dailySeed(day)), parseMap(run_map(dailySeed(day), 0, MAP_VERSION)));
}
function startRun(state: Run, map: MapNode[], resumed: Engine | Encounter | null = null): void {
  run = null; // its save is overwritten below, not deleted by leaveRun
  lastBanked = state.banked; // the run's blueprints banked so far (#1622)
  runMore = false;
  armed = 0;
  swapping = false;
  moveModes('pick');
  leaveMode();
  applyDeck(deckOf('local'));
  worker = botWorker;
  engine = new Engine(); // the board under the map: the saved local game is left alone, as by a boss fight
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  selected = [];
  thinking = false; // a bot reply to the old game is dropped (botTurn)
  view = resetView(4);
  applyView();
  roomOf = null; // no Back to the hub: the mode menu leaves a run
  stopAnalysis(); // no bar and no hint in a run, as in a boss fight (fair play, #164)
  newGameButton.hidden = true;
  run = { map, state };
  void saveRun(gameStore, state);
  if (resumed) fightRun(resumed, false);
  else {
    showRun();
    refresh();
  }
}
// The run's panel: a relic offer (#1457), the reward of a won fight (#961), an event's choice (#800), a rest site's (#1458), a
// shop's (#1459), the placement before a fight's first move (in a boss fight when the boss takes the build, #1494), or the map.
function showRun(): void {
  const { map, state } = run!;
  sceneRenderer.setRunFight(runCue(map, state)); // its map is the run's board too, violet, an elite's sodium gone (#1554)
  recordBest(store, actsWon(map, state)); // each act boss beaten unlocks for the next runs, this one keeps its own
  recordAscension(store, state); // a run won unlocks the next ascension level (#1465)
  recordRunes(store, state.found); // an elite archetype beaten for the first time keeps its rune for good (#1476)
  recordSeen(store, state); // the compendium (#1466)
  if (!state.fighting) legend.end(); // the special marbles seen in the fight are met (#1541)
  if (cueWatch.reward.entered(state.reward)) playCue('reward', AFTER_EJECTION + 0.7); // after the win of the fight that earned it
  if (cueWatch.shop.entered(state.shop)) playCue('shop');
  if (cueWatch.relics.rose(map, state.relics.length)) playCue('relic'); // taken, from a boss, the shop or an event: not the ones a run is loaded with
  const done = finished(map, state);
  if (done) recordFinished(store, done); // the history, and the daily run's score
  const placed = placing(state) && built();
  const stage = storyStage(store); // an event's wording and a lost run's line follow the story (#1587)
  runPanel.innerHTML = state.bonus
    ? bonusHtml(map, state)
    : state.relic
    ? relicHtml(map, state)
    : state.reward
      ? rewardHtml(map, state)
      : state.event
        ? eventHtml(state, stage)
        : state.rest
          ? restHtml(state)
          : state.shop
            ? shopHtml(state)
            : state.scroll
              ? scrollHtml(map, state)
              : state.collector
                ? collectorHtml(state)
                : state.exit
                  ? exitHtml(map, state, exitsFor(state), boss_name)
                  : placed
                    ? placeHtml(state, armed)
                    : mapHtml(map, state, bookHtml(utcDay(Date.now()), readDaily(store, utcDay(Date.now()))), { ids: boss_ids(), name: boss_name, builds: boss_takes_build }, runMore, stage);
  sawLines(runPanel.textContent!); // the line of a lost run (#1587)
  runPanel.hidden = state.fighting && !placed;
  runPanel.classList.toggle('place', placed);
  const next = runPanel.querySelector('button.node:not(:disabled)'); // after a pick the map scrolls to the nodes to pick, in the middle of the plate (#1468); before the first the commanders stay in view
  if (next && state.path.length) scrollMap(runPanel);
  const screen = state.bonus ? 'bonus' : state.relic ? 'relic' : state.reward ? 'reward' : state.event ? 'event' : state.rest ? 'rest' : state.shop ? 'shop' : state.scroll ? 'scroll' : state.collector ? 'collector' : state.exit ? 'exit' : placed ? 'place' : state.fighting ? 'fight' : 'map';
  document.body.dataset.run = state.end || screen; // read by the e2e tests
  const biome = currentBiome(map, state); // the tint of the map and the board (#1472); the Meadow has none
  if (biome) document.body.dataset.biome = BIOMES[biome]!.id;
  else delete document.body.dataset.biome;
  hud();
}
// A press on one of the army's marbles (Black) during the placement places the type armed, or takes it back.
function placeAt(q: number, r: number): void {
  if (engine.board()[cellIndex(q, r)] !== 1) return;
  run!.state = place(run!.state, [q, r], armed);
  if (left(run!.state, armed) === 0) armed = 0; // none left: the type is put down
  void saveRun(gameStore, run!.state);
  engine = runEngine(run!.state, run!.map);
  showRun();
  refresh();
}
// A fight of the run: an act's boss plays as from the boss menu, its deck and view (#800); the others on the local deck.
function fightRun(game: Engine | Encounter, fresh = true): void {
  const boss = actBoss(run!.map, run!.state, boss_ids());
  fight = boss && { id: boss.id, seed: boss.seed };
  if (boss) document.body.dataset.boss = boss.id;
  else delete document.body.dataset.boss;
  engine = game;
  legend.begin();
  specialHover = null;
  specialTapped = 0;
  history.length = 0;
  undone = false; // a fresh game (#1672)
  history.push(...run!.state.moves);
  replaying = null;
  selected = [];
  thinking = false; // a bot reply to the last fight is dropped (botTurn)
  showRun();
  refresh();
  applyDeck(deckOf(boss ? 'boss' : 'local', boss?.id), boss?.id, BIOMES[currentBiome(run!.map, run!.state)]!.id); // a boss its own space, any other fight its act's
  view = fitted = fightView();
  if (boss && fresh) beginEntrance(boss.id); // a boss the run walks into, not one that comes back from a reload
  applyView();
  void botTurn(); // a fight saved while the bot was thinking
}
// After each move of a fight: the moves are saved, and once it is over the army loses the marbles the bot ejected.
function runMoved(): void {
  const boss = engine instanceof Encounter;
  const status = engine instanceof Encounter ? engine.result() : engine.status(); // a boss fight: 1 won, 2 lost
  const kept = (): number[] => armyKept(engine.board(), engine.specials()); // a boss that takes no build has none on its board
  const state = status === 0 ? { ...run!.state, moves: history.slice() } : fightOver(run!.map, { ...run!.state, moves: history.slice() }, status === 1, engine.ejected(2), kept()); // its last move counts (#1473)
  run!.state = state;
  armed = 0;
  void saveRun(gameStore, state);
  if (!state.fighting || state.moves.length === 1) showRun(); // the fight's end, or its first move ends the placement
}
// A tactic (#1460, docs/specs/roguelite.md section 11): its record joins the move list, the engine plays it behind the
// rogue-lite flag and judges it, and the tactic is gone. False when the engine refuses it: nothing changed.
function playTactic(record: number[]): boolean {
  try {
    engine.play(Int32Array.from(record));
  } catch {
    return false;
  }
  history.push(record);
  run!.state = useTactic(run!.state, record[1]!);
  swapping = false;
  selected = [];
  runMoved();
  refresh();
  void botTurn(); // a Swap costs the move
  return true;
}
// The Swap's first press picks the army's marble, the second the one it trades places with.
function swapAt(q: number, r: number): void {
  if (engine.board()[cellIndex(q, r)] !== 1) return; // the army's marbles only
  const first = selected[0];
  if (!first) {
    selected = [[q, r]];
    return refresh();
  }
  if (first[0] === q && first[1] === r) return;
  if (playTactic(tacticRecord(3, first, [q, r]))) return;
  swapping = false;
  selected = [];
  refresh();
  cue(document.body, 'refused', MOTION.fast);
  hud(' · those marbles cannot swap');
}
document.getElementById('hud')!.addEventListener('click', (e) => {
  const line = (e.target as Element).closest<HTMLButtonElement>('button[data-special]');
  if (line) {
    specialTapped = specialTapped === Number(line.dataset.special) ? 0 : Number(line.dataset.special); // a second tap puts the card away (#1541)
    return hud();
  }
  const button = (e.target as Element).closest<HTMLButtonElement>('button[data-tactic]');
  if (!button) return; // the bar exists in an army fight only, its buttons disabled during a replay
  const code = Number(button.dataset.tactic);
  if (code === 3) {
    swapping = !swapping;
    selected = [];
    refresh();
    return hud();
  }
  if (playTactic(tacticRecord(code))) return;
  cue(document.body, 'refused', MOTION.fast);
  hud(' · that tactic cannot be played now');
});
function leaveRun(): void {
  if (!run) return;
  run = null;
  sceneRenderer.setRunFight(null); // the violet of the run goes at once (#1554)
  armed = 0;
  swapping = false;
  delete document.body.dataset.tactics;
  delete document.body.dataset.auto;
  runPanel.hidden = true;
  delete document.body.dataset.run;
  delete document.body.dataset.biome;
  newGameButton.hidden = false;
  void clearRun(gameStore);
}
function resumeRun(saved: NonNullable<Awaited<ReturnType<typeof loadSavedRun>>>): void {
  startRun(saved.state, saved.map, saved.engine);
}
runPanel.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>('button');
  if (button?.id === 'run-new') beginRun();
  else if (button?.id === 'run-start') pickNode(choices(run!.map, run!.state)[0]!); // Start takes the first fight of the map (#1524)
  else if (button?.dataset.more) {
    runMore = !runMore;
    showRun();
    const details = runPanel.querySelector('.run-more');
    if (details) runPanel.scrollTop += details.getBoundingClientRect().top - runPanel.getBoundingClientRect().top; // the details start at the top of the plate
  } else if (button?.dataset.bonus) {
    run!.state = takeBonus(run!.state);
    void saveRun(gameStore, run!.state);
    fightRun(runEngine(run!.state, run!.map)); // the boss fight (#1473)
  } else if (button?.dataset.key) {
    run!.state = takeKey(run!.map, run!.state, Number(button.dataset.key));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.scroll) {
    run!.state = takeScroll(run!.state, Number(button.dataset.scroll));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.relic) {
    run!.state = takeRelic(run!.map, run!.state, Number(button.dataset.relic));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.offer) {
    run!.state = claim(run!.state, Number(button.dataset.offer));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.tacticOffer) {
    run!.state = claimTactic(run!.state);
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.choice) {
    run!.state = resolve(run!.state, Number(button.dataset.choice));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.rest || button?.dataset.upgrade) {
    run!.state = button.dataset.rest ? rest(run!.state) : upgrade(run!.state, Number(button.dataset.upgrade));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.buy || button?.dataset.remove || button?.dataset.leave) {
    const { state } = run!;
    run!.state = button.dataset.buy ? buy(state, Number(button.dataset.buy)) : button.dataset.remove ? removeSpecial(state, Number(button.dataset.remove)) : leaveShop(state);
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.collect || button?.dataset.depart) {
    run!.state = button.dataset.collect ? collect(run!.state, Number(button.dataset.collect)) : leaveCollector(run!.state);
    lastBanked = run!.state.banked; // the town lists them (#1622)
    recordUnlocked(store, run!.state.banked); // a blueprint banked is unlocked for the next runs, even if this one is lost (#1470)
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.commander) {
    run!.state = chooseCommander(run!.state, Number(button.dataset.commander));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.exit) {
    run!.state = chooseExit(run!.map, run!.state, Number(button.dataset.exit), exitsFor(run!.state));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.ascension) {
    run!.state = chooseAscension(run!.state, Number(button.dataset.ascension));
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button?.dataset.daily) {
    beginDailyRun();
  } else if (button?.dataset.book) {
    const book = button.dataset.book;
    if (book === 'map') showRun();
    else runPanel.innerHTML = book === 'history' ? historyHtml(readHistory(store)) : compendiumHtml(readSeen(store));
  } else if (button?.dataset.kind) {
    armed = armed === Number(button.dataset.kind) ? 0 : Number(button.dataset.kind);
    showRun();
  } else if (button?.dataset.flask) {
    run!.state = drink(run!.state);
    void saveRun(gameStore, run!.state);
    showRun();
  } else if (button) pickNode(Number(button.dataset.node));
});
// A pick of a node of the map, from its button or from Start (#1524).
function pickNode(node: number): void {
  document.body.dataset.pick = sfx.pick() ? 'pick' : 'none'; // the pick's sound (#1468), read by the e2e tests
  run!.state = visit(run!.map, run!.state, node);
  void saveRun(gameStore, run!.state);
  if (run!.state.fighting) fightRun(runEngine(run!.state, run!.map));
  else showRun(); // a rest site, an event, a treasure or a shop
}
runButton.addEventListener('click', beginRun);
runButton.disabled = false; // listener ready (#146)
// Trainer (#1159): a 1 vs 1 against the bot, which starts with one marble and gets one more each wave, until the player
// loses 6 marbles in a wave. The score is the highest wave survived, kept in the storage. Retry starts again at wave 1.
const trainerButton = document.getElementById('trainer') as HTMLButtonElement;
const trainerCard = document.getElementById('trainer-card')!;
const trainerText = document.getElementById('trainer-text')!;
const trainerNext = document.getElementById('trainer-next') as HTMLButtonElement;
function startTrainer(wave: number, lost = 0): void {
  trainer = null; // moveModes('pick') below leaves the old one
  moveModes('pick');
  leaveMode();
  applyDeck(deckOf('local'));
  worker = botWorker;
  trainer = { wave, lost };
  engine = Engine.trainer(wave, MARBLES - lost);
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  selected = [];
  thinking = false; // a bot reply to the old wave is dropped (botTurn)
  view = resetView(4);
  applyView();
  roomOf = null;
  stopAnalysis(); // no bar and no hint, as in a run (fair play, #164)
  newGameButton.hidden = true;
  retryButton.hidden = false;
  document.body.dataset.trainer = String(wave); // read by the e2e tests
  refresh();
}
function leaveTrainer(): void {
  if (!trainer) return;
  trainer = null;
  delete document.body.dataset.trainer;
  trainerCard.hidden = true;
  retryButton.hidden = true;
  newGameButton.hidden = false;
}
/** Where the run stands: the wave's result so far. A draw is a clear whose `draw_reason` is set (it costs a marble). */
const trainerResultNow = (t: { wave: number; lost: number }): ReturnType<typeof waveResult> =>
  waveResult(t.wave, t.lost, engine.ejected(2), engine.status() === 1 && engine.draw_reason() !== 0);
/** The HUD line of the wave; once it is over, the waves survived so far are kept as the best when it is the most yet. */
function trainerNote(t: { wave: number; lost: number }): string {
  const result = trainerResultNow(t);
  if (engine.status() !== 0) recordTrainerBest(store, result.survived);
  return `${waveLine(t.wave, readTrainerBest(store), result.lost)} · ${drillLine(t.wave)}`;
}
/** The result card of a wave that is over, hidden otherwise. */
function showTrainerCard(): void {
  const over = trainer && engine.status() !== 0;
  trainerCard.hidden = !over;
  if (!trainer || !over) return;
  const result = trainerResultNow(trainer);
  trainerText.replaceChildren(...trainerResult(result, trainer.wave, readTrainerBest(store)).map((line) => Object.assign(document.createElement('p'), { textContent: line })));
  trainerNext.hidden = result.kind === 'lost';
}
trainerNext.addEventListener('click', () => startTrainer(trainer!.wave + 1, trainerResultNow(trainer!).lost));
trainerButton.addEventListener('click', () => startTrainer(1));
trainerButton.disabled = false; // listener ready (#146)
// Used by the browser checks to start the Trainer at a wave (#1159), and to read the board.
hookHost.__trainer = startTrainer;
hookHost.__board = () => Array.from(engine.board());
// The Open world (#962, docs/specs/openworld.md): its own scene, drawn by this renderer in place of the board's while it
// is on. Its entry is in the mode menu for everyone (#1000). ?openworld=<seed> fixes the seed, ?openworld=new starts a fresh
// random world; else a click resumes the last world played when it has a save (#968), or rolls a new seed.
const openWorldButton = document.getElementById('openworld') as HTMLButtonElement;
// #1361, owner's choice: for now a player cannot change the seed, everybody plays together in the public world. The seed of the
// URL is read only under automation (navigator.webdriver), so the e2e specs and test hooks keep their private worlds.
const openWorldFresh = navigator.webdriver && openWorldParam === 'new';
const openWorldFixedSeed = !navigator.webdriver || openWorldParam === '' || openWorldFresh ? NaN : Number(openWorldParam);
// The world's code is a chunk of the build, loaded at the first entry (#1578, openworldwire.ts): until then `openWorld` is off.
const openWorldCode = lazyChunk('Open world', () => import('./openworldwire'));
let worldOnline = false;
// The clock the enemy marbles wander by (#1511): the wall clock in ticks. Under automation it stands at tick 0, where the marbles start,
// until a spec sets it (`__openworldWander`).
let wanderTick: number | null = navigator.webdriver ? 0 : null;
const openWorld = new OpenWorldHandle(async () =>
  (await openWorldCode()).wireOpenWorld({
    store,
    gameStore,
    neon: neonLook,
    reduced: reducedMotion,
    // The marbles of the Open world wear the skins of the ship (#1176): the worn glass for the hero and the troop, the worn shell
    // for the enemies, once their maps are on.
    skins: async () => {
      await Promise.all([marbleMaterials[1]!, marbleMaterials[2]!].map((m) => dressed.get(m)));
      // The arena's own marbles under the neon look (#1558): the terrace's black shell and white glass, the default skins only, as the terrace wears them.
      return { player: neonShellFor(neonLook, glass === DEFAULT_GLASS_SKIN, terraceGlass, marbleMaterials[2]!), shell: neonShellFor(neonLook, skin === DEFAULT_SKIN, terraceShell, marbleMaterials[1]!) };
    },
    steering: () => steering,
    // The lights node the renderer keeps per scene holds GPU textures (clustered lighting: 2 per scene) that nothing else frees, so
    // each world entered leaked them (#1258).
    releaseScene: (scene) => void (renderer.lighting.getNode(scene) as { dispose?(): void }).dispose?.(),
    startLair: (seed, lair, phase, brought, relics) => {
      const ids = boss_ids();
      const id = ids[lair % ids.length]!;
      const fightSeed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      askMirror(traitChoice, store, boss_takes_mirror(id), (mirror) => startBoss(id, fightSeed, undefined, undefined, { seed, lair, phase, ...lairBuild(id, fightSeed, mirror, brought, relics) }, mirror)); // a lair starts the normal boss fight (#1170), on the board of the hour (#1496); the Echo's mirror is asked first (#1620)
    },
    onPlace: (seed, kind, index, biome, contract) => {
      // A town opens the Hub and a gate the rogue-lite run, as their mode menu entries do (#1593): every town the same Hub for now.
      gateBiome = kind === 'dungeon' ? BIOMES.findIndex(({ id }) => id === biome) : 0; // the run begins in the gate's biome (#1597)
      (kind === 'town' ? shipButton : runButton).click();
      placeFrom = { seed, kind };
      syncExit();
      if (kind === 'town') {
        storyEvent({ on: 'town' }); // the first town visited is stage 3 (#1586), before the line of this town is chosen
        hub!.bumped = townLine(index, storyStage(store)); // Tally's ledger line of this town on the plate, once its stage is reached (#1516)
        hub!.contract = contract; // the posted contract of the nearest tower of the ring to beat (#1618)
        hub!.banked = bankedTownLine(lastBanked); // the blueprints the last dungeon banked (#1622)
        sawLines(hub!.bumped);
        hud();
      }
    },
    online: () => worldOnline,
    lairCells,
    onWild: (seed, home, phase, brought, relics) => {
      loadBoard(); // as the wipe closes, half a second before the fight starts (#1520)
      wipe(document.getElementById('wild-wipe')!, reducedMotion(), () => startWild({ seed, home, phase, placed: placeBrought(new Engine().board(), brought), relics }));
    },
    cue: (event) => playCue(event),
    wanderTick: () => wanderTick,
  }),
);
/** The boss lairs of the world `seed` (#1305), one cell per boss, the bridge's `world_lairs` read as cells. */
function lairCells(seed: number): Axial[] {
  const flat = Array.from(world_lairs(seed));
  return Array.from({ length: flat.length / 2 }, (_, i): Axial => [flat[2 * i]!, flat[2 * i + 1]!]);
}
/** Whether this page may take the public world online, asking first when the opt-in is due. */
async function publicWorldOnline(): Promise<boolean> {
  const query = new URLSearchParams(location.search);
  if (netHook(location.search)) return true;
  if (navigator.webdriver && !query.has('consent')) return false;
  return !consentWanted() || (await onlineAllowed());
}
/** Opens the world of `seed`, online first when it is the public one and the page may (the opt-in is asked before anything is contacted). */
async function enterWorld(seed: number, resume = true): Promise<void> {
  modeProbe.begin('world');
  placeFrom = null; // the world is the player's place again (#1593)
  syncExit();
  worldOnline = seed === PUBLIC_SEED && (await publicWorldOnline());
  await openWorld.open(seed, innerWidth, innerHeight, resume);
  modeProbe.mark('built');
  if (openWorld.active && worldWarm.hold(openWorld.scene!, openWorld.eye!)) veilCanvas(); // its programs build from now on, behind the veil (#1582)
}
/** The world the menu opens: the public world, or the seed of the URL under automation. */
async function enterOpenWorld(): Promise<void> {
  if (openWorldFresh) return enterWorld(crypto.getRandomValues(new Uint32Array(1))[0]!, false);
  if (Number.isFinite(openWorldFixedSeed)) return enterWorld(openWorldFixedSeed);
  return enterWorld(PUBLIC_SEED); // an older private save stays in its store, untouched
}
if (navigator.webdriver) {
  // The test hooks of the Open world (docs/specs/openworld.md section 6): a fixture sets the hero, the troop and the enemies.
  const hooks = hookHost;
  hooks.__openworldFixture = (fixture: { hero: [number, number]; troop: [number, number][]; enemies: [number, number][]; beaten?: number[]; recruits?: number; resources?: Resources; army?: Army }) => openWorld.loaded.mode.fixture(fixture);
  hooks.__openworldFresh = () => (openWorld.active && openWorld.leave(), enterWorld(openWorldFixedSeed, false)); // the world of ?openworld=<seed> left then entered again from the spawn, no save read, the plate unfolded: a spec shares one page between its tests
  hooks.__modeProbe = () => modeProbe.samples(); // the first-frame times of the mode entries (#1582)
  hooks.__modeReset = () => modeProbe.reset();
  hooks.__modeMarks = () => modeProbe.marks();
  const entries = { arena: () => startLocal(false), run: beginRun, boss: startDaily, world: enterOpenWorld, hub: () => enterHub(loadProgress(store).at) }; // each mode's own entry, as the menus call it
  hooks.__enterMode = (mode: keyof typeof entries) => entries[mode]();
  hooks.__openworldEnemies = () => openWorld.loaded.mode.enemies();
  hooks.__openworldDrawn = () => openWorld.loaded.mode.drawn; // the frames drawn since the world opened: a spec waits for one before it reads the wild fight (#1601)
  hooks.__openworldWander = (tick: number | null) => ((wanderTick = tick), openWorld.loaded.mode.stepWander(undefined, true)); // the tick of the marbles' clock, or null for the real one (#1511)
  hooks.__openworldTime = (ms: number) => openWorld.loaded.mode.setTime(ms); // the time of day in ms of the 12 minute cycle: 0 day, 6 min dusk, 7.5 min night (#1496)
  hooks.__openworldCanBreak = (seed: number, q: number, r: number) => world_can_break(seed, q, r); // whether a cell holds a boulder or a tree (#1305)
  hooks.__openworldIsEnemy = (seed: number, q: number, r: number) => world_is_enemy(seed, q, r); // whether a generated enemy starts on a cell (#1305)
  hooks.__openworldTeleporters = (seed: number) => Array.from(world_teleporters(seed)); // every teleporter of a world, `q, r` pairs (#1412)
  hooks.__openworldPads = (seed: number) => Array.from(world_pads(seed)); // the pad beside each tower of a world, `q, r` pairs in the order of the lairs (#1531)
  hooks.__openworldPlaces = (seed: number) => Array.from(world_places(seed)); // every town and dungeon gate of a world, `kind, q, r` triples (#1514)
  hooks.__openworldLogs = (seed: number) => Array.from(world_logs(seed)); // every lore log of a world, `q, r` pairs (#1589)
  hooks.__openworldLairs = (seed: number) => lairCells(seed); // the boss lairs of a world as cells, for the peer tests (#1305)
  hooks.__openworldCamera = (at?: number) => openWorld.loaded.mode.camera(at); // the zoom, shake, chunk centre and place the camera draws (#1103, #1333)
  hooks.__openworldZoom = (scale: number) => openWorld.loaded.mode.zoom(scale); // the camera's zoom by `scale` (less than 1 closer), as the wheel: a close capture needs it (#1558)
  hooks.__openworldMesh = (name: string) => { // a scene mesh's look, for the captures and the finish checks (#1558)
    const scene = (openWorld.loaded.mode as unknown as { view: { scene: THREE.Scene } }).view.scene;
    const mesh = scene.getObjectByName(name) as THREE.InstancedMesh;
    const m = mesh.material as THREE.MeshStandardMaterial & { colorNode?: unknown; emissiveNode?: unknown };
    return { count: mesh.count, visible: mesh.visible, color: m.color.getHexString(), emissive: m.emissive.getHexString(), emissiveIntensity: m.emissiveIntensity, roughness: m.roughness, metalness: m.metalness, map: !!m.map, colorNode: !!m.colorNode, emissiveNode: !!m.emissiveNode, instance: mesh.instanceColor ? Array.from(mesh.instanceColor.array.slice(0, 3)) : null };
  };
}
openWorldButton.addEventListener('click', () => {
  moveModes('pick');
  leaveRoyale(); // first: its room is the page's online session too (#1275)
  leaveOnline();
  void enterOpenWorld();
  openWorldButton.blur(); // the menu's arrow keys would take the hero's
});
openWorldButton.disabled = false; // listener ready (#146)
bindHudFold(document); // the HUD plate folds to its chip after a few steps (#1138)
bindJoystick(document, openWorld); // the touch stick of the Open world, on the left half of the canvas (#1025)
// Escape closes the sheet that is open over the world (the terminal reader, the settings, the Game modes, Goal, Lobby) and goes no
// further: the world is left by the next one (#1591). The sheets close on their own keydown, before this one, so the state is read
// as the key goes down, in the capture phase.
let sheetOpen = false;
addEventListener('keydown', () => (sheetOpen = reading !== null || menuIsOpen || modesOpen || goalOpen || lobbyOpen), { capture: true });
addEventListener('keydown', (e) => {
  if (!openWorld.active || e.target instanceof HTMLInputElement || (e.key === 'Escape' && sheetOpen)) return;
  if (e.key === 'Escape' && !openWorld.mapShown && !openWorld.asking) return e.preventDefault(), exitButton.click(); // Escape presses the exit of the dock, as Browser Back does (#1605, ui.md 4.10); the map closes first, below
  if (!openWorld.key(e.key, e.repeat)) return; // a key typed in the name field is the field's (#1305) // a key repeat steps nothing: the held arrows walk (#1059)
  e.preventDefault(); // no page scroll
});
addEventListener('keyup', (e) => openWorld.release(e.key)); // a diagonal needs both arrows held (#977)
addEventListener('blur', () => openWorld.release()); // no key stays held once the window is left
// Used by the browser checks to load a run (#798): it is saved, then resumed as on a reload. A run over is not saved: it
// shows its summary (#801), what it leaves out taken from a new run, as a save is decoded (no relic before #1457).
hookHost.__run = async (state: Run) => {
  await bootEnd; // the page's own resume, after its last await, would replace the run loaded here (#1625)
  if (state.end) return startRun({ ...newRun(state.seed, state.best, LEGACY_UNLOCKED), ...state }, parseMap(run_map(state.seed, state.runes, state.map)));
  await saveRun(gameStore, state);
  resumeRun((await loadSavedRun())!); // the browser checks load valid runs
};

// The offline battle royale (#502, rules.md section 10.4): Battle royale starts 1 player against 5 bots on the radius 8
// arena, at the Furnace. The player presses a target on the arena, as a move, which locks the order (#611), or holds;
// the bots' orders come from the round-start state, and the round resolves. The HUD plate shows the next round's
// initiative order before its reveal, and the reveal of the last round. A boss fight, Play online or Hub leaves it,
// and it leaves the Hub.
const holdButton = document.getElementById('royale-hold') as HTMLButtonElement;
const startButton = document.getElementById('royale-start') as HTMLButtonElement; // the creator's, online (#504)
const royaleInviteButton = document.getElementById('royale-invite') as HTMLButtonElement; // offline: opens a room (#504)
function startRoyale(file: RoyaleFile): void {
  leaveMode();
  stopAuto();
  stopAnalysis();
  engine = new Engine(); // a bot reply to the old game is dropped (botTurn)
  history.length = 0;
  undone = false; // a fresh game (#1672)
  replaying = null;
  thinking = false;
  selected = [];
  reveal = null;
  royale = loadRoyale(file, (seats, seed) => new Royale(seats, seed));
  view = fitted = fightView(); // the whole arena on the window (#1374)
  applyView();
  moveModes('pick');
  for (const control of [newGameButton, retryButton, goalButton, hintButton, exportButton, importButton, resultCard]) control.hidden = true;
  holdButton.hidden = false;
  fogRadius = 4.2;
  applyDeck(deckOf('royale'));
  refresh();
}
function leaveRoyale(): void {
  stopAuto();
  if (royaleNet) {
    royaleNet = null;
    clearInterval(ticking);
    stopBeats();
    online = null;
    link!.close();
    hideInvite();
    window.history.replaceState(null, '', location.pathname + location.search); // no room in the address
  }
  startButton.hidden = royaleInviteButton.hidden = true;
  for (const key of ['net', 'desync', 'online', 'seat']) delete document.body.dataset[key];
  royale = null;
  reveal = null;
  arena.visible = false;
  arenaMarbles.clear(); // its marbles' instances are drawn from the group, the hidden arena or not (instancedcells.ts)
  fogRadius = frame?.radius ?? RADIUS;
  for (const mesh of [plate, rim.near, rim.far]) mesh.visible = !sceneRenderer.terraceOn; // the terrace has the slab of the glTF (#1374)
  holdButton.hidden = true;
  delete document.body.dataset.royale;
  delete document.body.dataset.reveal;
}
// The round played out (#612, royale-reveal.ts) from `start`, `ms` into it, `at` the turn drawn (the number of turns
// for the breach), and the cracks before it; null once the arena shows the game as it stands. A press or a key ends it
// at once, and the next order waits for its end.
interface Revealing {
  plan: Reveal;
  cracks: Int32Array;
  start: number;
  ms: number;
  at: number;
}
let reveal: Revealing | null = null;
// The marble and glyph drawn on each arena cell, which the reveal slides.
const arenaAt = new Map<number, THREE.Mesh[]>();
const phaseOf = (r: Revealing): number => (r.ms >= r.plan.breach.start ? r.plan.steps.length : shownAt(r.plan, r.ms) - 1);
// What the arena shows: the game, or the reveal's turn or breach with the seat a fizzle or a hold marks.
function arenaView(game: Royale): { board: ArrayLike<number>; cracks: ReturnType<typeof parseCracks>; marked: number } {
  if (!reveal) return { board: game.board(), cracks: parseCracks(game.cracks()), marked: -1 };
  const step = reveal.plan.steps[phaseOf(reveal)];
  if (!step) return { board: reveal.plan.breach.board, cracks: [], marked: -1 };
  const marked = step.outcome === 'fizzled' || step.outcome === 'held' ? step.seat : -1;
  return { board: step.board, cracks: parseCracks(reveal.cracks), marked };
}
// The arena in place of the board: the cells left, each seat's marbles, the selection and its targets.
function drawRoyale(game: Royale): void {
  fogRadius = 4.2;
  for (const mesh of [...discs, plate, rim.near, rim.far]) mesh.visible = false;
  for (const group of [marbles, ghosts, notches, ...tallies, arenaMarbles]) group.clear();
  marbleAt.clear();
  arenaAt.clear();
  arena.visible = true;
  const { board, cracks, marked } = arenaView(game);
  const left = crackLeft(cracks, ARENA);
  breachGlow.color.set(paletteById(palette).hazard).lerp(breachTint.set(neonTell.breachTint), neonTell.breachMix);
  crackDecals = [];
  targets = reveal || !canOrder() ? [] : groupTargets(parseMoves(game.legal_orders(me())), selected);
  ringed = marked >= 0 ? ARENA.filter((_, i) => seatAt(board[i]!) === marked) : [...selected];
  ARENA.forEach(([q, r], i) => {
    arenaDiscs[i]!.visible = board[i] !== VANISHED;
    arenaDiscs[i]!.position.y = -0.05; // a disc the breach sank is back once void
    if (i === ARENA.length - 1) syncDishes();
    const p = axialTo3D(q, r);
    const rounds = left.get(i) ?? 0;
    if (rounds > 0) {
      const glow = new THREE.Mesh(breachGeometry, breachGlow);
      glow.position.set(p.x, 0.002 + neonTell.arenaLift, p.z);
      arenaMarbles.add(glow);
      if (crackDecal) {
        const decal = new THREE.Mesh(crackGeometry, crackMaterial);
        decal.scale.setScalar(neonTell.arenaDecal); // the look draws the band alone
        decal.position.set(p.x, 0.003 + neonTell.arenaLift, p.z);
        arenaMarbles.add(decal);
        crackDecals.push([q, r]);
      }
      for (const dx of tickOffsets(rounds)) {
        const tick = new THREE.Mesh(tickGeometry, tickMaterial); // one per round left, on the front edge
        tick.position.set(p.x + dx, 0.01 + neonTell.arenaLift, p.z + 0.39);
        arenaMarbles.add(tick);
      }
    }
    const target = targets.find(({ cell: [tq, tr] }) => tq === q && tr === r);
    if (target) {
      const ring = new THREE.Mesh(targetRingGeometry, ringMaterial);
      const arrow = new THREE.Mesh(arrowGeometry, targetMaterial);
      ring.rotation.x = -Math.PI / 2;
      arrow.rotation.set(-Math.PI / 2, arrowYaw(target.dir), 0, 'YXZ');
      ring.position.set(p.x, 0.005, p.z);
      arrow.position.set(p.x, 0.005, p.z);
      arenaMarbles.add(ring, arrow);
    }
    const seat = seatAt(board[i]!);
    if (seat < 0) return;
    const marble = new THREE.Mesh(marbleGeometry, seatLooks[seat]);
    const picked = ringed.some(([sq, sr]) => sq === q && sr === r);
    const stand = terraceKit.pedestal && sceneRenderer.terraceOn ? terraceKit.pedestal : null;
    marble.position.set(p.x, (picked ? 0.5 : 0.36) + (stand ? TERRACE_LIFT / ARENA_SCALE : 0), p.z); // on the terrace the marble stands on its pedestal (#1374)
    const glyph = new THREE.Mesh(seatGlyphs[seat], seatInk);
    glyph.position.copy(marble.position).add(glyphLift);
    arenaMarbles.add(marble, glyph);
    arenaAt.set(i, [marble, glyph]);
    if (stand) {
      // the kit's flat disc under the marble, as the 1v1's: Blender's royale half size across, its height unscaled by the arena's half scale
      const pedestal = new THREE.Mesh(stand.geometry, stand.material);
      pedestal.scale.set(1, 1 / ARENA_SCALE, 1);
      pedestal.position.set(p.x, 0, p.z);
      pedestal.userData.terrace = true;
      arenaMarbles.add(pedestal);
      arenaAt.get(i)!.push(pedestal);
    }
    if (!picked) return;
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 0.02, p.z);
    arenaMarbles.add(ring);
  });
  document.body.dataset.royale = String(nextRound(parseLog(game.round_log()))); // read by the e2e tests
  document.body.dataset.reveal = !reveal ? 'done' : reveal.plan.steps[phaseOf(reveal)] ? 'turn' : 'breach'; // read by the e2e tests
  document.body.dataset.cracks = String(cracks.length);
  document.body.dataset.vanished = String(Array.from(board).filter((v) => v === VANISHED).length);
  hud();
}
// The plate, and once the game is over the end banner and its light (body[data-over], #282, #503).
// During the reveal, the log lines of the turns played so far and no end yet.
function royaleHud(game: Royale): void {
  const placed = reveal ? [] : standings(game.placement());
  const end = royaleBanner(placed, me());
  if (end) document.body.dataset.over = end.anim;
  else delete document.body.dataset.over;
  const { board, cracks } = arenaView(game);
  const out = outSeats(board);
  const gone = cueWatch.out.fresh(game, out);
  const log = parseLog(game.round_log());
  const round = cueWatch.round.rose(game, nextRound(log) - (reveal ? 1 : 0)); // the next round is open once its reveal is over
  if (end) endCue(game, end.anim, 0);
  else if (gone) playCue('elimination'); // the end has its own cue, and an elimination takes the place of the tick
  else if (round) playCue('royale-round');
  const shown = log && reveal ? { ...log, turns: log.turns.slice(0, shownAt(reveal.plan, reveal.ms)) } : log;
  const room = royaleNet && { names: royaleNet.names, you: me(), status: royaleStatus(royaleNet), left: royaleNet.left };
  document.getElementById('hud')!.innerHTML = royaleHtml(shown, { out, cracks, standings: placed, ...room });
  if (rankedMode === 'royale') {
    if (placed.length > 0 && !rankedDone && ratedRoyale !== game) {
      rankedDelta = settleRankedRoyale(store, placed, me()).delta;
      rankedDone = true;
      ratedRoyale = game;
    }
    document.getElementById('hud')!.insertAdjacentHTML('beforeend', rankedHudHtml(loadRankedProfile(store).ratingRoyale, { delta: rankedDelta }));
  }
  holdButton.disabled = end !== null || !canOrder();
  royaleInviteButton.hidden = royaleNet !== null;
  syncExit();
}
// A press on one of the player's marbles selects it, a press on a target locks that move as the order and plays the
// round (#611). Once the game is over a press does nothing.
function pickRoyale(q: number, r: number): void {
  endReveal();
  const game = royale!;
  if (game.placement().length || !canOrder()) return;
  if (seatAt(game.board()[cellIndex(q, r, ARENA)]!) === me()) {
    selected = toggleSelection(selected, [q, r]);
    return refresh();
  }
  const mv = moveForClick(parseMoves(game.legal_orders(me())), selected, [q, r]);
  if (mv) playRound(encodeMove(mv));
}
// Under reduced motion the arena jumps to the new position (#612).
function playRound(mine: readonly number[]): void {
  endReveal();
  const game = royale!;
  if (game.placement().length) return; // Hold pressed during the reveal of the last round
  selected = [];
  if (royaleNet) return void royaleNet.play([...mine]); // online: committed, the round resolves on every peer (#504)
  const before = game.board();
  const cracks = game.cracks();
  const orders = roundOrders(game, mine);
  game.resolve(orders);
  showRound(game, before, cracks, orders);
}
/** Plays out the round `game` just resolved from the arena `before` it, with its cracks then and its orders. */
function showRound(game: Royale, before: ArrayLike<number>, cracks: ArrayLike<number>, orders: Int32Array): void {
  if (reducedMotion()) return refresh();
  const plan = buildReveal(before, orders, parseLog(game.round_log())!, game.board());
  reveal = { plan, cracks: Int32Array.from(cracks), start: performance.now(), ms: 0, at: -1 };
  animateReveal(reveal.start);
}
// Each frame of the reveal: a new turn or the breach redraws the arena and starts its falls, the turn's marbles slide,
// the voided discs sink.
function animateReveal(now: number): void {
  if (!reveal) return;
  const { plan } = reveal;
  const ms = now - reveal.start;
  if (ms >= plan.total) return endReveal();
  reveal.ms = ms;
  const at = phaseOf(reveal);
  const step = plan.steps[at];
  if (at !== reveal.at) {
    reveal.at = at;
    refresh();
    for (const fall of step ? (step.ejected ? [step.ejected] : []) : plan.breach.falls) fallInto(fall);
  }
  if (!step) {
    for (const i of plan.breach.voids) arenaDiscs[i]!.position.y = -0.05 - sinkAt(ms - plan.breach.start);
    return;
  }
  for (const track of step.tracks) {
    const p = slideAt(track, ms - step.start);
    const [marble, glyph, pedestal] = arenaAt.get(cellIndex(...track.cell, ARENA))!;
    marble!.position.x = p.x;
    marble!.position.z = p.z;
    glyph!.position.copy(marble!.position).add(glyphLift);
    pedestal?.position.set(p.x, 0, p.z); // the disc goes with its marble
  }
}
// A marble the reveal ejects or the breach takes: the ejection fall of a normal game, in the arena.
function fallInto({ cell, seat, dir }: Fall): void {
  const mesh = new THREE.Mesh(marbleGeometry, seatLooks[seat]);
  const glyph = new THREE.Mesh(seatGlyphs[seat], seatInk);
  glyph.position.copy(glyphLift);
  mesh.add(glyph);
  startEjection(mesh, ejectTrack(cell, dir, false), arena);
}
function endReveal(): void {
  if (!reveal) return;
  reveal = null;
  refresh();
}
addEventListener('pointerdown', endReveal, { capture: true });
addEventListener('keydown', endReveal, { capture: true });
const royaleButton = document.getElementById('battle-royale') as HTMLButtonElement;
royaleButton.addEventListener('click', () => {
  if (online) return;
  startRoyale({ seed: crypto.getRandomValues(new Uint32Array(1))[0]!, rounds: [] });
});
holdButton.addEventListener('click', () => playRound([]));
royaleButton.disabled = false; // listener ready (#146)

// The online battle royale (#504, docs/specs/tech.md section 6): Invite, in an offline battle royale, opens a room of 6
// seats and shows its invite link, each link opener takes the first free seat. The creator coordinates: Start begins the game, the
// seats empty then are bots, played alike on every peer. Each round a target press or Hold commits the order, the
// round resolves once every seat revealed or its deadline passed (royale-net.ts), and the arena plays it out.
const ONLINE_SEATS = 6;
/** Our seat on the arena: the player's offline, ours in the room online (-1 for a spectator). */
function me(): number {
  return royaleNet ? royaleNet.you : YOU;
}
/** Whether an order can be given now: always offline, while the open round takes ours online. */
function canOrder(): boolean {
  return !royaleNet || royaleNet.phase === 'choosing';
}
function royaleStatus(net: RoyaleNet<Royale>): OnlineStatus {
  const session = online!;
  document.body.dataset.online = 'royale'; // read by the e2e tests, as data-seat, data-net and data-desync
  document.body.dataset.seat = session.role;
  document.body.dataset.net = net.phase;
  document.body.dataset.desync = String(net.desync);
  startButton.hidden = net.phase !== 'lobby' || !session.isCoordinator;
  return net.status(session.isCoordinator);
}
// The keys first: from the arena on, every order goes to the room, and the creator's invite link carries their
// fingerprint. A joiner from a link with one, `creator`, takes seat 1 only from that key (#1323).
const royaleNetCode = lazyChunk('online Battle royale', () => import('./royale-net')); // the room and the rounds are a chunk of the build (#1578)
async function goRoyale(room: string, side: number, creator?: string): Promise<void> {
  if (consentWanted() && !(await onlineAllowed())) return; // Stay solo (#1338)
  const [{ parseRoyale, ROOM_JUDGE, roundPeriod, RoyaleNet, seedOf }, keys] = await Promise.all([royaleNetCode(), generateKeys()]);
  const key = await fingerprint(keys.pub);
  leaveRoyale();
  startRoyale({ seed: seedOf(room), rounds: [] });
  if (side === 1) showInvite(royaleUrl(location.href, room, key), 'Invite link: send it to the other players');
  const game = royale!;
  diag.connecting();
  const net = roomTransport(room);
  link = net;
  signalingTimeout(side);
  const session: OnlineSession = new OnlineSession({
    game: room,
    side,
    seatCount: ONLINE_SEATS,
    engine: engine_version(),
    keys,
    creator,
    transport: net,
    judge: ROOM_JUDGE,
    onMove: refresh, // never: the judge plays no move
    onRefuse: (reason) => diag.refused(reason),
    onState: (state) => {
      diag.netState(state);
      if (state === 'open') void ours.resync(); // back after a drop: what did we miss (#504)
      refresh();
    },
    onRole: refresh,
    onPresence: refresh,
    beat: { ms: beatPeriod(location.search, navigator.webdriver), now: Date.now, every: beatEvery },
    onOther: (m, key, peer) => {
      const message = parseRoyale(m);
      if (message) return ours.receive(message, key, peer);
    },
  });
  const ours: RoyaleNet<Royale> = new RoyaleNet({
    game: room,
    keys,
    royale: game,
    roundMs: roundPeriod(location.search, navigator.webdriver),
    now: Date.now,
    connected: () => net.state === 'open',
    send: (m, to) => net.send(m, to),
    coordinator: () => session.coordinator,
    roster: () => session.seats.roster(),
    onRound: (before, cracks, orders) => showRound(game, before, cracks, orders), // the room's link closes when it is left
    onChange: refresh,
  });
  online = session;
  royaleNet = ours;
  // The deadlines pass, and the plate is drawn again once its countdown shows another second (#673).
  let clock = '';
  ticking = setInterval(() => {
    const now = deadlineText(ours.left);
    if (now !== clock) hud();
    clock = now;
    void ours.tick();
  }, 100) as unknown as number;
  refresh();
}
startButton.addEventListener('click', () => void royaleNet?.start());
royaleInviteButton.addEventListener('click', () => {
  void goRoyale(newRoomId((b) => crypto.getRandomValues(b)), 1); // it shows the invite link
});
// Used by the browser checks to load a royale game file (#502).
hookHost.__royale = startRoyale;
// Used by the browser checks to read the marble drawn for an arena cell, where it is now: its seat and place (#612).
hookHost.__arenaAt = (q: number, r: number) => {
  const marble = arenaAt.get(cellIndex(q, r, ARENA))?.[0];
  return marble ? { seat: seatLooks.indexOf(marble.material as THREE.MeshStandardMaterial), x: marble.position.x, z: marble.position.z } : null;
};
// Used by the browser checks to count each seat's glyphs drawn on the arena, in seat order (#558).
hookHost.__seatGlyphs = () =>
  seatGlyphs.map((g) => arenaMarbles.children.filter((m) => (m as THREE.Mesh).geometry === g).length);
// The lobby sheet (#1044, docs/specs/thumb-dock.md section 1): Start, Invite and the invite link sit above
// the dock. The Lobby control toggles it, and carries an accent while a lobby waits. It shows only with a control to show,
// and one sheet at a time: Esc and a tap outside close it, and the focus goes back to Lobby.
const lobbyControls = (): HTMLElement[] => [startButton, royaleInviteButton, inviteBox, inviteCopy];
/** A lobby waits: the creator's Start shows, or the invite link shows while the other seat is waiting. */
const inviteWaiting = (): boolean => !inviteBox.hidden && document.body.dataset.opponent === 'waiting';
const lobbyWaiting = (): boolean => !startButton.hidden || (!inviteBox.hidden && document.body.dataset.opponent === 'waiting');
function paintLobby(): void {
  lobbySheet.hidden = !lobbyOpen;
  lobbyButton.setAttribute('aria-expanded', String(lobbyOpen));
}
function openLobby(): void {
  if (!lobbyControls().some((el) => !el.hidden)) return;
  lobbyOpen = true;
  moveModes('outside'); // one sheet at a time (#1032, #1044)
  moveMenu('outside');
  closeGoal();
  paintLobby();
}
function closeLobby(): void {
  lobbyOpen = false;
  paintLobby();
}
/** Draws the Lobby control from the controls it holds. While a lobby waits it carries an accent, and the sheet stays shut
 * until the player taps Lobby: the board is never covered by itself (#1044). */
function syncLobby(): void {
  lobbyButton.hidden = !lobbyControls().some((el) => !el.hidden);
  if (lobbyButton.hidden) lobbyOpen = false;
  lobbyButton.dataset.waiting = String(lobbyWaiting());
  paintLobby();
}
lobbyButton.addEventListener('click', () => (lobbyOpen ? closeLobby() : openLobby()));
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !lobbyOpen) return;
  closeLobby();
  lobbyButton.focus();
});
addEventListener('pointerdown', (e) => {
  if (inviteWaiting()) return; // the link stays open until an opponent connects
  if (lobbyOpen && !within(lobbySheet, e.target) && !within(lobbyButton, e.target)) closeLobby();
});
function syncConnectivity(): void {
  const state = playOnlineState(navigator.onLine, playReady);
  playOnlineButton.disabled = coopButton.disabled = duelButton.disabled = rankedButton.disabled = royaleInviteButton.disabled = state.disabled;
  offlineNotice = state.notice;
  hud();
}
addEventListener('online', syncConnectivity);
addEventListener('offline', syncConnectivity);
playReady = true; // engine and listener ready (#127)
syncConnectivity();
const invited = roomFromHash(location.hash);
const coopInvite = coopFromHash(location.hash);
const duelInvite = bossSeatFromHash(location.hash);
const royaleInvite = royaleFromHash(location.hash);
const creator = creatorFromHash(location.hash); // the fingerprint of the creator's key, none in an older link (#1323)
// The Open world leads the mode menu of a fresh profile (#1612, menuorder.ts); a profile with a save or a boss beaten keeps its menu.
// A saved run or a saved public world is a save too: the profile keeps its menu (#1612).
const worldSaved = (await worldSaves(gameStore, world_version()).load(PUBLIC_SEED)) !== null;
const saved = resumed !== null || resumedRun !== null || worldSaved;
if (new URLSearchParams(location.search).has('unlock')) markFirstWin(store); // dev: the lock is lifted for good (#1665)
locked = isLocked(location.search, navigator.webdriver, existingPlayer(store, saved, loadProgress(store).beaten.length));
syncLocks();
const leadsMenu = !locked && openWorldLeads(saved, loadProgress(store).beaten.length);
if (leadsMenu) modeMenu.insertBefore(openWorldButton, document.getElementById('play-online'));
document.getElementById('open-world-entry')!.hidden = !leadsMenu;
if (invited) void goOnline(invited, 2, undefined, creator);
else if (royaleInvite) void goRoyale(royaleInvite, 2, creator);
else if (duelInvite && boss_ids().includes(duelInvite.boss)) void goOnline(duelInvite.room, 2, duelInvite, creator, true); // the joiner plays the boss (#1316)
else if (coopInvite && boss_ids().includes(coopInvite.boss)) void goOnline(coopInvite.room, 2, coopInvite, creator); // an unknown boss starts nothing
else if (resumedRun) resumeRun(resumedRun); // a run saved in progress, over the local game; an invite link wins
else if (!resumed && (!locked || new URLSearchParams(location.search).has('firstrun')) && firstRunDue(store, location.search, navigator.webdriver, location.hash, loadProgress(store).beaten.length > 0)) startFirstRun(); // a fresh profile plays the first run (#1521); a locked one only when ?firstrun asks (the landing below is its first match, #1663)
else if (!resumed && locked && !location.search && !location.hash) beginFirstMatch(); // a new player lands in the guided first match, no cold open (#1663)
else if (!resumed && !locked && !location.search && !location.hash) enterHub(loadProgress(store).at); // a new player arrives on the Hub (#602)
else analyse(); // the start position

// Browser Back and the Android Back gesture (#1564, backnav.ts, ui.md "Browser Back"): the screens other than the one the page started on
// hold one history entry, and Back runs the way out the screen has already: its Back button where it shows one (Flee in a wild fight), else
// the Hub, or New game from the Hub. No confirmation is asked, a fight in progress included.
const baseScreen: Screen = screenNow();
exitReady = true;
syncExit();
new MutationObserver(syncExit).observe(document.body, { attributes: true }); // the Open world entered or left sets or clears body[data-openworld] (#1517)
const screenExit = new ScreenExit(reducedMotion);
let holdsEntry = (window.history.state as { ab?: number } | null)?.ab === 1; // a reload keeps the entry it was made on
function screenNow(): Screen {
  if (online) return 'room';
  return openWorld.active || run || trainer || fight || royale || roomOf || lairFrom || wildFrom ? 'mode' : hub ? 'hub' : 'table';
}
/** Asks the browser for the entry of the screen shown, once a frame. */
function watchBack(): void {
  if (!needsEntry(screenNow(), baseScreen, holdsEntry)) return;
  window.history.pushState({ ab: 1 }, '', location.href);
  holdsEntry = true;
}
/** Back from the Hub: the saved local game comes back, as the boot resumes it; a new table only when nothing is saved. Nothing is cleared. */
async function backToTable(): Promise<void> {
  const saved = await loadLocal();
  if (!saved) return newGame();
  if (saved.boss) return startBoss(saved.boss.id, saved.boss.seed, undefined, saved, null, saved.boss.mirror);
  leaveHub();
  applyDeck(deckOf('local'));
  worker = saved.bot ? botWorker : null;
  engine = saved.engine;
  history.length = 0;
  undone = false; // a fresh game (#1672)
  history.push(...saved.moves);
  undone = saved.undone === true;
  replaying = null;
  selected = [];
  thinking = false;
  view = resetView(4);
  applyView();
  refresh();
  analyse();
  void botTurn(); // a game saved while the bot was thinking
}
const WAYS: Record<Exclude<Way, 'stay'>, () => void> = {
  exit: leaveByExit, // the Hub or the Open world, as the control leads, with no question
  hub: () => shipButton.click(),
  table: () => void backToTable(),
  leave: () => window.history.back(), // the base screen: the browser goes on back
};
let seenHash = location.hash;
addEventListener('popstate', (e) => {
  const moved = location.hash !== seenHash; // Chrome fires popstate when the online address is written, and Back drops it: the room's own entry, not ours (Play online keeps what it did)
  seenHash = location.hash;
  if (moved) return;
  holdsEntry = (e.state as { ab?: number } | null)?.ab === 1;
  const way = backWay(screenNow(), baseScreen, exitNow(), holdsEntry);
  if (way !== 'stay') WAYS[way]();
});

// Copy diagnostics: the events, the counters, the build and the game go to the clipboard, or are selected in a
// text box to copy by hand when the browser refuses (#220). Nothing is sent anywhere.
const copyButton = document.getElementById('copy-diagnostics') as HTMLButtonElement;
// The clipboard is the last row of the Advanced group of the settings list (#1032, #1566), an action with its icon and its label, as the other items.
setButton(copyButton, 'Copy diagnostics', `${icon('diagnostics')}<span>Copy diagnostics</span>`);
const diagnosticsBox = document.getElementById('diagnostics') as HTMLTextAreaElement;
const renderCost = (): RenderCost => {
  let pointLights = 0;
  (openWorld.scene ?? sceneRenderer.scene).traverseVisible((o) => void ((o as THREE.PointLight).isPointLight && pointLights++)); // a hidden lamp lights nothing
  const { render, memory } = renderer.info;
  return { calls: render.drawCalls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, pointLights, tier, pixelRatio };
};
// With ?gpustats the GPU time per mode is in it too (#1581), the capture docs/specs/tech.md section 5.6 checks.
Object.defineProperty(window, '__renderCost', { configurable: true, get: () => ({ ...renderCost(), text: renderCostText(renderCost()), gpu: gpu.snapshot() }) });
copyButton.addEventListener('click', async () => {
  const text = diag.text({
    renderCost: renderCostText(renderCost()),
    build: __BUILD__,
    exported: new Date().toISOString(),
    environment: { mode: import.meta.env.MODE, backend, tier, userAgent: navigator.userAgent, fps: fpsOn ? lastFps : null },
    game: gameInfo({
      bot: worker !== null,
      fight,
      online: online && { game: online.game, side: online.side, role: online.role, signed: online.signedLog },
      toMove: engine.to_move(),
      status: engine.status(),
      moves: history,
    }),
  });
  const copied = await copyText(text, navigator.clipboard);
  diagnosticsBox.hidden = copied;
  if (copied) return hud(' · diagnostics copied');
  diagnosticsBox.value = text;
  diagnosticsBox.focus();
  diagnosticsBox.select();
  diagnosticsBox.scrollTop = 0; // select() scrolls to the end
  setTimeout(() => (diagnosticsBox.scrollTop = 0), 0); // Firefox scrolls to the end after select() returns
  hud(' · diagnostics selected: copy them by hand');
});
diagnosticsBox.addEventListener('blur', () => (diagnosticsBox.hidden = true)); // never left over the board
copyButton.disabled = false; // listener ready (#146)

// Offline app (#193): registered at the end of the start, then checked for a new build at each load
// (Chrome does not check by itself on a reload), so the refresh after a deploy installs it. Blocked (the e2e runs),
// refused or offline, the game simply goes on.
if (serviceWorker) {
  serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((registration) => {
      if (!serviceWorker.controller) return;
      const check = (): void => void registration.update().catch(() => undefined);
      check();
      // An open tab learns of a new build when it comes back to the foreground and every 15 minutes (#1437).
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 15 * 60_000);
    })
    .catch(() => undefined);
  stakeNow = () =>
    atStake({
      online: online !== null,
      ranked: rankedMode !== null,
      fight: fight !== null,
      royale: royale !== null,
      run: run !== null,
      trainer: trainer !== null,
      replaying: replaying !== null,
      openWorld: openWorld.active,
      sheetOpen: lobbyOpen,
      typing: document.activeElement instanceof HTMLTextAreaElement || (document.activeElement instanceof HTMLInputElement && !document.activeElement.readOnly && document.activeElement.type === 'text'),
    });
}

let lastDraw: LastDraw = { start: -Infinity, cost: 0, timed: true };
let draws = 0;
let drawAsked = false;
booted = true; // every top-level let is declared: the page's callbacks may refresh from here (#1628)
bootEnded();
refresh();
applyView(); // the stored closer board view (#1567)
// The canvas joins the page last, once every listener and page hook is set: it draws nothing before the animation loop
// starts below, and the e2e tests take a canvas in the page for a page that is ready (bug #585).
// Until the terrace is drawn the room would show (#1389): the canvas stays hidden on a plain dark page, and shows after a terrace frame.
veilCanvas();
document.body.appendChild(renderer.domElement);
if (resumed?.boss) startBoss(resumed.boss.id, resumed.boss.seed, undefined, resumed, null, resumed.boss.mirror); // a Stalker fight comes back under its fog (#1122)
if (!hub) void botTurn(); // a resumed game saved while the bot was thinking
// Used by the browser checks to wait for a draw: under automation the loop skips frames (#216), so a frame is not a draw (#365).
hookHost.__draws = () => draws;
// Used by the browser checks to ask for the next draw, which the throttle does not hold (#435): returns the draws so far.
hookHost.__drawNext = () => {
  drawAsked = true;
  return draws;
};
function animateParticles(now: number): void {
  sceneRenderer.animateParticles(now, deck);
}
// An effect that moves on screen by itself, frame after frame: while one is shown a player's page draws every frame.
function moving(): boolean {
  const effects = [slide, kick, drawnKick !== REST, reveal, shock, blast, sweep, blinking, ghostFading(), unstableShown?.core, unstableShown && unstableShown.wedge >= 0, lowering, drop, evac && !evac.done];
  const lists = [fading, ejecting, bleeding, passing, slams, bursts, hazes, beltRibs, ripples];
  return (
    effects.some(Boolean) ||
    lists.some((list) => list.length > 0) ||
    (pulsarCores.length > 0 && !reducedMotion()) ||
    eggsDrawn.some((egg) => egg.glow) ||
    (lastMovePlaying && !reducedMotion()) ||
    sceneRenderer.particles.visible ||
    (pulsing && shellLooks.has(DEFAULT_SKIN)) ||
    freeCam.active
  );
}

/** Hides the canvas on a plain dark page until a frame that is not the room's is drawn, unless the room is asked for (#1389). */
function veilCanvas(): void {
  if (keepRoom) return;
  renderer.domElement.style.opacity = '0'; // not `visibility`: a hidden canvas takes no click, and a first tap would be lost
  document.body.dataset.veil = 'on';
}
/** Shows the canvas: called after a frame that is not the room's (#1389), the terrace, its plain background, or the Open world. */
function unveil(): void {
  renderer.domElement.style.opacity = '';
  delete document.body.dataset.veil;
}
/** Sets the renderer and the scene as the Open world draws them: its lights, its tone and its shadow, which its programs depend on. */
function setWorldFrame(scene: THREE.Scene, now: number): void {
  driveSkyGlow(scene, accentOn(tier, software));
  driveAccents(scene.children.filter((o): o is THREE.PointLight => o.name === 'neon accent'), accentOn(tier, software), now, reducedMotion());
  if (!sceneRenderer.terraceOn) sceneRenderer.setWorldTone(neonLook); // a page that opened in the world has no terrace to set them (#1520)
  sceneRenderer.setShadows(tier === 'high'); // the Open world's sun casts its soft shadow on the high tier only (#1364)
}
// The world's first frame waits for its programs, built with the frame's own settings (#1582). One compile per child of the scene
// at once was tried: its first render built them again, a 1 s frame at 4x CPU.
const worldWarm = new WarmGate(async (scene, camera) => {
  await openWorld.props; // the props' models first: the programs of the ones that came after the compile froze the first frame 0.4 s at 4x CPU
  setWorldFrame(scene as THREE.Scene, performance.now());
  const draw = (): void => renderer.render(scene as THREE.Scene, camera as THREE.Camera);
  const task = (): Promise<unknown> => new Promise((done) => setTimeout(done));
  // Behind the veil, a task apart: the hero alone first, as the lights' key changes at their first draw (WebGPU's tiled lights) and a
  // compile before it built every program for a key the first frame no longer has, 1 s at 4x CPU; then the compile; then the sun's
  // shadow pass, which the compile leaves out, half the scene a draw.
  await drawEach(scene as THREE.Scene, [(child) => child.name === 'hero'], draw, task);
  await compileWhole(scene as THREE.Scene, () => renderer.compileAsync(scene as THREE.Scene, camera as THREE.Camera));
  await drawEach(scene as THREE.Scene, halves, draw, task);
});
const EARS_DIRECTION = new THREE.Vector3();
const NOWHERE: Listener = { x: 0, z: 0, yaw: 0 }; // no place with stations: none sounds
// The frame body (#1582): the probe reads its end, the first frame after an entry.
function loopFrame(now: number): void {
  pollPad(now); // the gamepad, read once per frame (#1252)
  const heroBiome = openWorld.active ? openWorld.biome : null;
  const music = sceneOf({ hub: hub !== null, royale: royale !== null, run: run ? (run.state.fighting ? 'fight' : 'map') : null, boss: fight?.id ?? null, world: heroBiome ? { biome: heroBiome, phase: openWorld.phase } : null });
  sfx.setScene(music, music.startsWith('boss:') && engine instanceof Encounter ? engine.phase() : 0); // the music follows where the player is (#1571)
  const ears = openWorld.active ? { camera: openWorld.loaded.mode.ears, sources: openWorld.loaded.mode.stations } : hub ? { camera: sceneRenderer.camera, sources: hubStations(hub.at.deck) } : null;
  if (ears) sfx.listen(listenerOf(ears.camera.position, ears.camera.getWorldDirection(EARS_DIRECTION)), ears.sources); // the stations near the camera sound (#1577)
  else sfx.listen(NOWHERE, []);
  watchBack();
  screenExit.sync(screenNow()); // the dim over a new screen (#1562)
  lastDraw = timeDraw(lastDraw, now);
  if (openWorld.active) {
    if (worldWarm.hold(openWorld.scene!, openWorld.eye!)) {
      veilCanvas(); // the world's programs build behind the veil, a few a task: the page never freezes on its first render (#1582)
      return;
    }
    const drew = openWorld.frame((scene, camera) => {
      setWorldFrame(scene, now);
      renderer.info.reset();
      renderer.render(scene, camera);
    }, now); // the frame's own time, not the moment its callback runs: the camera moves by even steps (#1333)
    unveil();
    hidePlate(); // a page that opened in the world has no bay to wait for (#1520)
    if (software && !navigator.webdriver) adaptResolution(now); // the Open world steps its resolution down on a software renderer only (#1483)
    if (drew) gpuFrame(modeOfScene(music));
    if (fpsOn) {
      // Only the frames really rendered count (#1064): a still scene skips its render, and reads idle, not 60.
      if (drew) stampDrawn(fpsStamps, now);
      lastFps = fpsAt(fpsStamps, now);
      fpsBox.textContent = gpuText(fpsLabel(lastFps), modeOfScene(music));
    }
    return;
  }
  if (entrance.active) applyView(); // the entrance beat eases each frame until it ends (#1551)
  const moves = moving(); // before the effects run, so the frame that ends one draws
  const wanted = drawWanted(dirty > 0, moves, drawAsked, navigator.webdriver);
  if (moves) dirty = CHANGE_DRAWS; // its last picture draws twice too, for the bloom
  if (fpsOn) {
    fpsStamps = keepWindow(fpsStamps, now);
    lastFps = fpsOf(fpsStamps);
    fpsBox.textContent = gpuText(`${lastFps} FPS`, modeOfScene(music));
  }
  driveAccents(roomAccents, accentOn(tier, software), now, reducedMotion());
  driveSkyGlow(sceneRenderer.scene, accentOn(tier, software));
  animateSlides(now);
  const pose = driveKick(now);
  fadeGlyphs(now);
  fadeGhosts(now);
  animateReveal(now);
  animateEjections(now);
  animatePasses(now);
  animateSlams(now);
  animateBelts(now);
  if (shock) drawShock(now - shock.start);
  animateUnstable(now);
  animateDual(now);
  if (evac && !evac.done) liftEvac(engine.board(), evac);
  if (blast) drawBlast(now - blast.start);
  animateSpeech(now);
  animateHaze(now);
  animateAnnounce(now);
  ripples.forEach((ring, k) => {
    const at = rippleAt(now, k, reducedMotion());
    ring.scale.setScalar(Math.max(at.radius, 0.01));
    rippleMaterials[k]!.opacity = at.opacity;
  });
  if (!reducedMotion()) for (const core of pulsarCores) core.rotation.y = now / 600;
  animateParticles(now);
  eggGlowMaterial.opacity = Math.max(eggGlow(now / 1000, reducedMotion()), neonTell.glowFloor);
  if (Number.isNaN(lastMoveStart) && lastMovePlaying) lastMoveStart = now;
  lastMovePlaying = lastMovePlaying && now - lastMoveStart < SLIDE_MS + MOTION.base;
  const pulse = lastMovePulse(lastMovePlaying ? now - lastMoveStart : Infinity, reducedMotion());
  lastMoveMaterial.opacity = pulse.opacity;
  for (const ring of lastMoveRings) ring.scale.setScalar(pulse.scale);
  const heated = shellLooks.get(DEFAULT_SKIN); // only the default shell glows with the heat, once worn
  if (heated) heated.emissiveIntensity = pulsing ? pulseAt(pulseHeld ?? now / 1000) : 0;
  turnConsole(now);
  tickLog(now);
  if (freeCam.active) {
    const dt = Math.min(0.05, Math.max(0.001, (now - (lastDraw.start > 0 ? lastDraw.start : now)) / 1000));
    if (freeCam.update(dt)) {
      updateFreeCamCamera();
    }
  }
  if (!navigator.webdriver) adaptResolution(now);
  offerLowTier(!sliding() && !lastMovePlaying); // at a quiet moment: no move animation (the ambient dust and heat pulse always move)
  if (!wanted || !drawDue(now, lastDraw.start, lastDraw.cost, drawAsked, navigator.webdriver)) return;
  if (roomVeiled(document.body.dataset.veil === 'on', sceneRenderer.terraceOn)) return; // the room under the veil is never seen: its programs are not compiled (#1481)
  for (const sync of syncMarbles) sync();
  for (const sync of syncPedestals) sync();
  renderer.info.reset();
  sceneRenderer.render(pose, innerWidth, innerHeight);
  gpuFrame(modeOfScene(music));
  drawnKick = pose;
  if (sceneRenderer.terraceOn) unveil();
  draws++;
  drawAsked = false;
  dirty = Math.max(0, dirty - 1);
  lastDraw = { start: now, cost: performance.now() - now, timed: false };
}
renderer.setAnimationLoop((now) => {
  loopFrame(now);
  modeProbe.drawn();
});
// A link with any ?openworld=<value> opens the public world at the load (#1361), the online notice first. The saved fight stays
// in its store: the click does the same, and a world only replaces the board on screen.
if (openWorldParam !== '' || read(store, WILD_KEY)) openWorldButton.click(); // last: the whole page is ready; a reload during a wild fight comes back to the world (#1511)
wildMarked(false); // the mark is only for the reload
