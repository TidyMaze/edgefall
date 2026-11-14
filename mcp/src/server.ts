// The MCP server: the tools of docs/specs/mcp.md section 5 over one Session, a local game or an online room. Every
// tool returns JSON as text content, a failure sets `isError` with the error object of section 6.
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { BLUEPRINTS } from '../../client/src/collector';
import { RECRUIT_MAX } from '../../client/src/openworldrecruit';
import { COMMANDERS, TACTICS } from '../../client/src/roguelite';
import { bossIds, runRules, worldRules } from './engine';
import type { Result, Session } from './game';
import { RogueRun } from './run';
import { OpenWorld } from './world';
import { refusePeers, WorldRoom } from './worldroom';

const NOTATION =
  'A move is the selected cells, then ">", then the direction: "(-1,2)(0,2)>E", "(0,0)>SE". A cell is (q,r). ' +
  'Directions: E, W, NE, SW, NW, SE.';

export function toolResult(result: Result<unknown>): CallToolResult {
  return result.ok
    ? { content: [{ type: 'text', text: JSON.stringify(result.value) }] }
    : { isError: true, content: [{ type: 'text', text: JSON.stringify(result.error) }] };
}

const WINDOW =
  'The window is a hex of cells round the hero, one row per r, each row from the cell q0 along q. H hero, T troop, E enemy, L lair, ' +
  '? off the world, else the terrain: ~ water, s sand, g grass, r rock, P peak, o boulder, t tree, W wall. Peaks, walls, enemies ' +
  'and lairs cannot be entered; the hero and the troop sail on water like on land; a boulder or a tree is broken by rolling into it. After each step ' +
  'the troop attacks on its own, as in the client: it plays the best legal push against the enemies near the hero, and an enemy ' +
  'pushed into water or off the world is ejected (beaten).';

const CELL = z.tuple([z.int(), z.int()]);

/** A world save in the client's format (client/src/openworldsave.ts), as save_world gives it. */
const SAVE = z.object({
  version: z.int(),
  seed: z.int().min(0).max(4294967295),
  hero: CELL,
  troop: z.array(CELL).max(15 + RECRUIT_MAX),
  fight: z.object({ removed: z.array(z.string().regex(/^-?\d+,-?\d+$/)), added: z.array(CELL), beaten: z.int().min(0) }),
  yaw: z.number(),
  broken: z.array(CELL),
  lairs: z.array(z.int().min(0)),
  discovered: z.array(z.tuple([z.int(), z.int(), z.string()])).optional(),
  time: z.number().min(0).optional(),
  logs: z.array(z.int().min(0)).optional(),
  recruits: z.int().min(0).max(RECRUIT_MAX).optional(),
  resources: z.object({ wood: z.int().min(0), ore: z.int().min(0), parts: z.int().min(0), shards: z.int().min(0) }).optional(),
  army: z.object({ specials: z.array(z.int().min(0)).max(6), brought: z.array(z.int().min(0)).max(4), relics: z.array(z.int().min(0)), relicsBrought: z.array(z.int().min(0)).max(2) }).optional(),
}).refine((save) => save.troop.length <= 15 + (save.recruits ?? 0), { message: 'the troop holds 15 marbles and its recruits' });

export function createServer(
  session: Session,
  world: OpenWorld = new OpenWorld(worldRules(), bossIds, session),
  worldRoom: WorldRoom = new WorldRoom(world, worldRules(), refusePeers),
  rogue: RogueRun = new RogueRun(runRules(), session, bossIds),
): McpServer {
  const server = new McpServer({ name: 'edgefall', version: '0.1.0' });

  server.registerTool(
    'new_game',
    {
      description:
        'Start a local game of Edgefall against the bot, or a boss fight, and drop any game in progress. You are ' +
        'Black and move first. Returns the game state (see get_state).',
      inputSchema: z.strictObject({
        boss: z
          .string()
          .optional()
          .describe(`Fight this boss instead of the bot: ${bossIds().join(', ')}. Same boss and seed, same fight.`),
        seed: z.int().min(0).max(4294967295).optional().describe('Seed of the boss fight, default 0.'),
        bot_nodes: z
          .int()
          .min(1)
          .max(200000)
          .optional()
          .describe('Positions the bot searches per move, default 20000. Fewer is weaker and faster. Not for a boss.'),
      }),
    },
    (input) => toolResult(session.newGame(input)),
  );

  server.registerTool(
    'get_state',
    {
      description:
        'The game state: mode (bot, boss, online), your side, side to move, status (running, black_won, white_won, ' +
        'draw), marbles ejected by each side and the number needed to win, the board as ASCII and as 61 characters (91 or 169 on a larger boss board), ' +
        'the last 6 plies, and in a boss fight the boss: phase, tell (what it does after the next ply), marks on the ' +
        'board, result.',
    },
    () => toolResult(session.getState()),
  );

  server.registerTool(
    'legal_moves',
    {
      description:
        'Every legal move of the side to move, from the engine. Empty once the game is over. announces maps a move to ' +
        `the reply a boss announces for it, empty when it announces nothing. ${NOTATION}`,
    },
    () => toolResult(session.legalMoves()),
  );

  server.registerTool(
    'play_move',
    {
      description:
        'Play your move. The engine refuses an illegal one and nothing changes. The bot or boss replies in the ' +
        'same call, so you are to move again unless the game is over. Online, the move is sent to your opponent: ' +
        `call wait_for_opponent_move for the reply. ${NOTATION}`,
      inputSchema: z.strictObject({ move: z.string().describe('Your move, for example "(1,3)>NE".') }),
    },
    (input) => toolResult(session.playMove(input)),
  );

  server.registerTool(
    'resign',
    { description: 'Give up the game: the bot or boss wins. Not supported online yet.' },
    () => toolResult(session.resign()),
  );

  server.registerTool(
    'create_room',
    {
      description:
        'Open an online room and take its first seat: you are Black. Send the invite link to a human, who opens ' +
        'it in a browser, or the room code to another agent (join_room). Then call wait_for_opponent_move: it ' +
        'returns once the opponent is seated and it is your turn. With boss, the room is a boss fight and the ' +
        'opponent plays the boss as White: the invite link names the boss, and join_room seats the other agent as ' +
        'the boss. Drops any game in progress.',
      inputSchema: z.strictObject({
        boss: z.string().optional().describe(`Fight this boss, played by the opponent: ${bossIds().join(', ')}.`),
        seed: z.int().min(0).max(4294967295).optional().describe('Seed of the boss fight, default 0.'),
      }),
    },
    async (input) => toolResult(await session.createRoom(input)),
  );

  server.registerTool(
    'join_room',
    {
      description:
        'Join an online room a human or another agent opened, from its invite link or its room code. You are ' +
        'White: call wait_for_opponent_move for Black\'s first move. If the link is a boss fight, you play the boss: ' +
        'get_state shows the boss, legal_moves lists your moves, and the boss rules judge them. Drops any game in progress.',
      inputSchema: z.strictObject({ room: z.string().describe('The invite link or the room code.') }),
    },
    async (input) => toolResult(await session.joinRoom(input)),
  );

  server.registerTool(
    'wait_for_opponent_move',
    {
      description:
        'Online: wait until it is your turn, then return the opponent move (event opponent_moved, move null ' +
        'before the first move), or game_over, opponent_left (it may come back), desync (the opponent sent a ' +
        'move that was refused, the game waits), or timeout. Never waits longer than timeout_s.',
      inputSchema: z.strictObject({
        timeout_s: z.int().min(1).max(120).optional().describe('Seconds to wait at most, default 30.'),
      }),
    },
    async (input) => toolResult(await session.waitForOpponentMove(input)),
  );

  server.registerTool(
    'new_world',
    {
      description:
        'Start the Open world of a seed and drop the world in progress: the hero on the spawn (0,0), the troop round it, or resume a ' +
        'save. Same seed, same world and the same moves give the same result as the client. Returns the world state (see world_state). ' +
        'Walk to a lair and step onto it, then fight its boss with new_game: a fight won marks the lair beaten when you are back in the ' +
        `world. ${WINDOW}`,
      inputSchema: z.strictObject({
        seed: z.int().min(0).max(4294967295).optional().describe('Seed of the world, default 0.'),
        save: SAVE.optional().describe('Resume this world, its seed included: the output of save_world, or a save of the client. bad_save when it is of another world version.'),
      }),
    },
    (input) => toolResult(world.newWorld(input)),
  );

  server.registerTool(
    'world_state',
    {
      description:
        'The Open world state: seed, hero, troop, obstacles broken, enemies beaten (ejected), cells discovered (within 10 of the hero so far), the enemies in the window as the pushes ' +
        'left them, every boss lair with its distance from the hero and whether it is beaten, the teleporters discovered with their distance (0: the hero stands on it), ending (the end line) once every lair is ' +
        'beaten, and a short window of cells round the hero (never the whole map). There is no loss state: the hero cannot lose, as in ' +
        `the client. ${WINDOW}`,
      inputSchema: z.strictObject({ radius: z.int().min(1).max(8).optional().describe('Cells of the window out from the hero, default 3.') }),
    },
    (input) => toolResult(world.state(input)),
  );

  server.registerTool(
    'save_world',
    {
      description:
        "The Open world in the client's save format (hero, troop, fight, broken, lairs beaten, cells discovered): give it to new_world as save to " +
        'resume the world later.',
    },
    () => toolResult(world.save()),
  );

  server.registerTool(
    'world_step',
    {
      description:
        'Roll the hero one cell, then the troop pushes on its own: push is its direction and the enemy ejected, null when no push ' +
        'was legal (the push can move the hero). Water is sailed like land. Refused (blocked) by a peak, a wall or an enemy, and ' +
        'nothing changes. Onto a lair the hero stays, moved is false and lair names the boss and the call that starts its fight ' +
        '(new_game with that boss).',
      inputSchema: z.strictObject({ direction: z.enum(['E', 'W', 'NE', 'SW', 'NW', 'SE']).describe('Direction of the step.') }),
    },
    (input) => toolResult(world.step(input)),
  );

  server.registerTool(
    'world_walk',
    {
      description:
        'Walk the hero to a cell, round the obstacles and the enemies, by the shortest path of the engine, up to 40 cells away, ' +
        'one step at a time as world_step: pushes lists the pushes of the troop on the way, and a step a push made impossible ends ' +
        'the walk there (compare the hero with the cell). no_path when there is no path (the hero cell, a lair, an enemy, off the ' +
        'world, too far, walled in).',
      inputSchema: z.strictObject({ q: z.int().describe('Column of the cell.'), r: z.int().describe('Row of the cell.') }),
    },
    (input) => toolResult(world.walk(input)),
  );

  server.registerTool(
    'world_teleport',
    {
      description:
        'Teleport the hero from the teleporter it stands on to another teleporter already discovered (world_state lists them), as in ' +
        'the client: the troop arrives on the free cells round it, and there is no push on arrival. Refused (blocked, nothing changes) ' +
        'off a teleporter, onto no teleporter, the same one, one not discovered yet, one with an enemy on it, or with no room for the troop.',
      inputSchema: z.strictObject({ q: z.int().describe('Column of the teleporter.'), r: z.int().describe('Row of the teleporter.') }),
    },
    (input) => toolResult(world.teleport(input)),
  );

  server.registerTool(
    'join_world_room',
    {
      description:
        'Join the public Open world as a hero other players see: the world of seed 1305, room ow:1305:0, the hero on the spawn (0,0). ' +
        'Browsers show you as a named hero. This connects you to other players (their browsers see your IP address and your moves) and ' +
        'drops the world in progress: only call it when your user asked you to be in the public world. Then call world_heroes.',
      inputSchema: z.strictObject({ name: z.string().optional().describe('Your public name, up to 16 characters, default Claude.') }),
    },
    (input) => toolResult(worldRoom.join(input)),
  );

  server.registerTool(
    'world_heroes',
    {
      description:
        'The heroes in the public world room with a known place, the nearest to you first: id, name, cell (q,r) and distance in cells. ' +
        'A hero silent for 10 s is gone. problem says the connection has a current error (it clears after 30 s without a new one). note says "no other hero seen yet" when the list is empty and there is no error.',
    },
    () => toolResult(worldRoom.heroes()),
  );

  server.registerTool(
    'world_visit',
    {
      description:
        'Walk to a hero (its id from world_heroes) and stop next to it, following it if it moves, or walk to a cell (q and r). One cell every ' +
        '250 ms, the pace of a browser, at most 40 steps a call: arrived is false when that was not enough, call again. The room sees each step.',
      inputSchema: z.strictObject({
        hero: z.string().optional().describe('The id of the hero to walk to.'),
        q: z.int().optional().describe('Column of the cell, with r, when no hero.'),
        r: z.int().optional().describe('Row of the cell.'),
      }),
    },
    async (input) => toolResult(await worldRoom.visit(input)),
  );

  server.registerTool(
    'leave_world_room',
    { description: 'Leave the public world room: the players stop seeing you after about 10 s. Do it when you are done.' },
    () => toolResult(worldRoom.leave()),
  );

  server.registerTool(
    'new_run',
    {
      description:
        'Start a rogue-lite run of a seed and drop the run in progress: a 3-act map of nodes, an army of 14 marbles, the bot to beat in each ' +
        'fight. Same seed and same choices give the same run as the client (docs/specs/roguelite.md), and save_run is its save. Returns the run ' +
        'state (see run_state). Pick a node with run_pick, play its fight with get_state, legal_moves and play_move (resign loses it), take ' +
        'what waits after it with run_choose. Only variety carries between runs: best and unlocked are what a browser would have banked.',
      inputSchema: z.strictObject({
        seed: z.int().min(0).max(4294967295).optional().describe('Seed of the run, default 0.'),
        best: z.int().min(0).max(3).optional().describe('The most acts won in one run before this one: it unlocks special marble types, default 0.'),
        unlocked: z
          .array(z.int().min(0).max(BLUEPRINTS.length - 1))
          .optional()
          .describe('The blueprints banked in earlier runs (banked of a run over): relics, tactics and special marbles in the pools, default none.'),
        runes: z.int().min(0).max(7).optional().describe('The runes owned, a bit mask (1 Rune of Stone, 2 Rune of Spark, 4 Rune of Might; found by beating The Wall, The Artificer and The Brute for the first time): a secret room, a shortcut and a secret exit on the map, default none.'),
        commander: z.int().min(0).max(COMMANDERS.length - 1).optional().describe('The commander, 0 the Captain (default), the others unlocked by best: its special marbles and its starting relic.'),
        bot_nodes: z.int().min(1).max(200000).optional().describe('Positions the bot searches per move in a fight, default 20000. An elite searches twice as many.'),
        save: z.record(z.string(), z.unknown()).optional().describe('Resume this run instead: the output of save_run, or a save of the client. bad_save when it is not one.'),
      }),
    },
    async (input) => toolResult(await rogue.newRun(input)),
  );

  server.registerTool(
    'run_state',
    {
      description:
        'The run: screen (map, place, fight, reward, relic, event, rest, shop, scroll, collector, exit, won, lost), army, special marbles, relics, affinities, tactics, flasks, scrap, ' +
        'cells, blueprints, and what the screen holds: on the map the nodes to pick; in a fight the bot, the boss or the elite, the game id and the ' +
        'special marbles placed; on a screen with a choice (reward, relic, event, rest, shop, scroll, collector) the options to take with run_choose, ok ' +
        'false for one that cannot be taken now; once over the acts won and what it unlocked. With map, every node of the map: its act, row, kind ' +
        'and the nodes it leads to.',
      inputSchema: z.strictObject({ map: z.boolean().optional().describe('Also list every node of the map.') }),
    },
    (input) => toolResult(rogue.state(input)),
  );

  server.registerTool(
    'run_pick',
    {
      description:
        'Pick a node of the map (run_state lists the ones to pick): a fight, an elite or a boss starts its fight as the game of the server ' +
        '(you are Black, the bot or the act boss replies in play_move); a rest, shop, treasure or event waits for run_choose; a "?" turns into ' +
        'one of them. Before the first move, run_place puts the special marbles on the army.',
      inputSchema: z.strictObject({ node: z.int().min(0).describe('The node, its number in run_state.') }),
    },
    (input) => toolResult(rogue.pick(input)),
  );

  server.registerTool(
    'run_place',
    {
      description:
        'Place a special marble of the army on one of its marbles before the first move of a fight, or take it back by placing the same type ' +
        'on the same marble again: kind is Heavy, Anchor, Spark, Heavy+, Anchor+, Spark+, Magnet, Shield, Bomb or Medic, (q,r) a cell of the ' +
        'army (get_state shows the board). At most 3 of each type. Returns the run state; the fight restarts with the marbles placed. The first ' +
        'move starts the fight.',
      inputSchema: z.strictObject({ q: z.int(), r: z.int(), kind: z.string().describe('The type of special marble.') }),
    },
    (input) => toolResult(rogue.place(input)),
  );

  server.registerTool(
    'run_choose',
    {
      description:
        'Take an option of the screen (run_state, options): a reward, a relic, an event choice (the last is Leave), Rest or an upgrade at a rest ' +
        'site, a purchase or a removal at a shop or Leave, the affinity to grow with the scroll after an act boss, a blueprint to bank at the Collector or Leave, the exit (biome) to take after an act boss. Refused (bad_choice, nothing changes) ' +
        'when it cannot be taken now. Returns the run state.',
      inputSchema: z.strictObject({ choice: z.int().min(0).describe('The number of the option.') }),
    },
    (input) => toolResult(rogue.choose(input)),
  );

  server.registerTool(
    'run_tactic',
    {
      description:
        'Play a tactic the run holds during an army fight, after the special marbles are placed (not against an act boss): Reinforce adds a marble ' +
        'to your back row, Freeze makes the bot skip its next turn, Swap trades two of your marbles, one of them special, and costs your move (the ' +
        'bot replies), Fall back undoes your last move and the bot answer. The engine judges it; one it refuses is kept. Returns the reply and the run state.',
      inputSchema: z.strictObject({
        tactic: z.enum(TACTICS.map((t) => t.name) as [string, ...string[]]),
        a: CELL.optional().describe('Swap: the first marble, [q, r].'),
        b: CELL.optional().describe('Swap: the second marble, [q, r].'),
      }),
    },
    (input) => toolResult(rogue.tactic(input)),
  );

  server.registerTool(
    'run_flask',
    {
      description:
        'Drink a flask on the map between two nodes: 3 marbles back (up to 14), one charge spent. The run starts with 2 charges, refilled at each ' +
        'act; run_state shows the charges left (flasks). Refused (bad_choice, nothing changes) with the army full or no charge left. Returns the run state.',
    },
    () => toolResult(rogue.flask()),
  );

  server.registerTool(
    'save_run',
    {
      description:
        "The run in the client's save format: give it to new_run as save to resume the run later, fight in progress included.",
    },
    () => toolResult(rogue.save()),
  );

  return server;
}
