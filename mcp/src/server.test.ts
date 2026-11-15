import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { localPair } from '../../client/src/transport';
import { newEncounter, newEngine } from './engine';
import { Session } from './game';
import { createServer, toolResult } from './server';
import type { PeerNet } from '../../client/src/p2p';
import { encodeHello, encodePos } from '../../client/src/worldpeers';
import { bossIds, worldRules } from './engine';
import { OpenWorld } from './world';
import { WorldRoom } from './worldroom';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

/** A client connected in memory to a fresh server, as an MCP host would be over stdio. Its rooms are local pairs. */
async function connect(room?: WorldRoom, world?: OpenWorld, encounter: typeof newEncounter = newEncounter): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(new Session(newEngine, encounter, () => localPair()[0]), world, room).connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

/** The text of a tool result: the JSON of the output, or of the error. */
function text(result: unknown): string {
  const { content } = result as { content: { type: string; text: string }[] };
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe('text');
  return content[0]!.text;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client!.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: text(result) };
}

describe('toolResult', () => {
  test('a value is its JSON as text content', () => {
    expect(toolResult({ ok: true, value: { a: [1, null] } })).toEqual({ content: [{ type: 'text', text: '{"a":[1,null]}' }] });
  });

  test('an error is the error object as JSON, with isError set', () => {
    expect(toolResult({ ok: false, error: { code: 'no_game', message: 'm' } })).toEqual({
      isError: true,
      content: [{ type: 'text', text: '{"code":"no_game","message":"m"}' }],
    });
  });
});

describe('the Open world tools', () => {
  test('start a world, read it, step and walk, with errors as tool errors', async () => {
    await connect();
    expect((await call('world_state')).isError).toBe(true);
    const started = JSON.parse((await call('new_world', { seed: 3 })).text);
    expect(started.hero).toBe('(0,0)');
    expect(started.window.radius).toBe(3);
    expect(JSON.parse((await call('world_state', { radius: 5 })).text).window.radius).toBe(5);
    expect(JSON.parse((await call('world_step', { direction: 'E' })).text).state.hero).toBe('(1,0)');
    expect(JSON.parse((await call('world_walk', { q: 4, r: 0 })).text).steps).toBe(3);
    const refused = await call('world_walk', { q: 4, r: 0 });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.text).code).toBe('no_path');
    expect((await call('world_step', { direction: 'UP' })).isError).toBe(true);
    const teleport = await call('world_teleport', { q: 2, r: -1 }); // the hero stands on no teleporter
    expect(JSON.parse(teleport.text).code).toBe('blocked');
  });

  test("save the world and resume it, in the client's save format, a bad save refused", async () => {
    await connect();
    await call('new_world', { seed: 3 });
    await call('world_step', { direction: 'E' });
    const save = JSON.parse((await call('save_world')).text);
    expect(save).toMatchObject({ record: 8, seed: 3, hero: [1, 0], lairs: [], logs: [], recruits: 0, resources: { wood: 0, ore: 0, parts: 0, shards: 0 }, army: { specials: [], brought: [], relics: [], relicsBrought: [] } });
    await call('new_world', { seed: 0 });
    // The cells discovered come back too (#1411): the spawn's disc and the 21 cells the step uncovered.
    expect(JSON.parse((await call('new_world', { save })).text)).toMatchObject({ seed: 3, hero: '(1,0)', discovered: 352 });
    expect(JSON.parse((await call('new_world', { save: { ...save, discovered: [[0, 0, '!!']] } })).text).code).toBe('bad_save');
    await call('new_world', { save: { ...save, logs: [2, 5] } }); // the lore logs found by a player of the client (#1589) come back
    expect(JSON.parse((await call('save_world')).text).logs).toEqual([2, 5]);
    expect((await call('new_world', { save: { ...save, logs: [-1] } })).isError).toBe(true);
    await call('new_world', { save: { ...save, time: 450000 } }); // the time of day of a save of the client comes back, not the start of day (#1592)
    expect(JSON.parse((await call('save_world')).text).time).toBe(450000);
    expect((await call('new_world', { save: { ...save, time: -1 } })).isError).toBe(true);
    const { time: _time, ...before } = save; // a save from before the cycle (record 4): the start of day
    await call('new_world', { save: before });
    expect(JSON.parse((await call('save_world')).text).time).toBe(0);
    expect((await call('new_world', { save: { ...save, hero: [1] } })).isError).toBe(true);
    const stale = await call('new_world', { save: { ...save, version: save.version + 1 } });
    expect(JSON.parse(stale.text).code).toBe('bad_save');
  });

  test('a save of 7 to 15 followers loads through new_world, 16 is refused', async () => {
    await connect();
    const save = JSON.parse((await call('new_world', { seed: 3 }), await call('save_world')).text);
    const troop = (n: number) => Array.from({ length: n }, (_, i) => [(i % 5) + 1, Math.floor(i / 5)]);
    for (const n of [7, 15]) {
      const loaded = await call('new_world', { save: { ...save, troop: troop(n) } });
      expect(JSON.parse(loaded.text).troop).toHaveLength(n);
    }
    expect((await call('new_world', { save: { ...save, troop: troop(16) } })).isError).toBe(true);
    const { recruits: _recruits, ...before } = save; // a save from before the recruits: the troop holds 15 at most
    expect(JSON.parse((await call('new_world', { save: { ...before, troop: troop(15) } })).text).recruits).toBe(0);
    expect((await call('new_world', { save: { ...before, troop: troop(16) } })).isError).toBe(true);
  });

  test('the resources and the army of a save of the client come back (#1655), a wrong shape is refused', async () => {
    await connect();
    const save = JSON.parse((await call('new_world', { seed: 3 }), await call('save_world')).text);
    const stock = { wood: 12, ore: 7, parts: 20, shards: 2 };
    const army = { specials: [1], brought: [1], relics: [], relicsBrought: [] };
    expect(JSON.parse((await call('new_world', { save: { ...save, resources: stock, army } })).text)).toMatchObject({ resources: stock });
    expect(JSON.parse((await call('save_world')).text)).toMatchObject({ resources: stock, army });
    expect((await call('new_world', { save: { ...save, resources: { ...stock, wood: -1 } } })).isError).toBe(true);
    expect((await call('new_world', { save: { ...save, army: { ...army, specials: [1.5] } } })).isError).toBe(true);
    const { resources: _r, army: _a, ...before } = save; // a record 7: none
    expect(JSON.parse((await call('new_world', { save: { ...before, record: 7 } })).text).resources).toEqual({ wood: 0, ore: 0, parts: 0, shards: 0 });
  });

  test('the recruits of a save of the client come back (#1531): the troop holds 15 and them, and the cap is 5', async () => {
    await connect();
    const save = JSON.parse((await call('new_world', { seed: 3 }), await call('save_world')).text);
    const troop = (n: number) => Array.from({ length: n }, (_, i) => [(i % 5) + 1, Math.floor(i / 5)]);
    const loaded = await call('new_world', { save: { ...save, troop: troop(18), recruits: 3 } });
    expect(JSON.parse(loaded.text)).toMatchObject({ recruits: 3 });
    expect(JSON.parse(loaded.text).troop).toHaveLength(18);
    expect(JSON.parse((await call('save_world')).text)).toMatchObject({ recruits: 3 });
    expect((await call('new_world', { save: { ...save, troop: troop(19), recruits: 3 } })).isError).toBe(true);
    expect((await call('new_world', { save: { ...save, troop: troop(16), recruits: 6 } })).isError).toBe(true);
    expect((await call('new_world', { save: { ...save, recruits: -1 } })).isError).toBe(true);
  });

  test("the fight of a lair is the session's game: won after the step onto the lair, it beats the lair", async () => {
    // Every fight of this server is won as it starts: the boss encounter says Black won.
    const won = (boss: string, seed: number) => {
      const encounter = newEncounter(boss, seed);
      return Object.assign(Object.create(encounter), { status: () => 1 }) as ReturnType<typeof newEncounter>;
    };
    await connect(undefined, undefined, won);
    const [q, r] = worldRules().world_lairs(3);
    const save = JSON.parse((await call('new_world', { seed: 3 }), await call('save_world')).text);
    await call('new_world', { save: { ...save, hero: [q! - 1, r!], troop: [] } });
    const { lair } = JSON.parse((await call('world_step', { direction: 'E' })).text);
    expect(lair).toMatchObject({ index: 0, boss: bossIds()[0] });
    expect(JSON.parse((await call('world_state')).text).lairs[0].beaten).toBe(false);
    await call('new_game', { boss: lair.boss });
    expect(JSON.parse((await call('world_state')).text).lairs[0].beaten).toBe(true);
  });
});

describe('the rogue-lite run tools (#1469)', () => {
  test('start a run, pick a fight, play it with the game tools, lose it: the run is over', async () => {
    await connect();
    expect(JSON.parse((await call('run_state')).text).code).toBe('no_run');
    const started = JSON.parse((await call('new_run', { seed: 0, bot_nodes: 30 })).text);
    expect(started).toMatchObject({ screen: 'map', seed: 0, army: 14 });
    expect(JSON.parse((await call('run_state', { map: true })).text).map).toHaveLength(27);
    const picked = JSON.parse((await call('run_pick', { node: 0 })).text);
    expect(picked.screen).toBe('fight');
    expect(JSON.parse((await call('get_state')).text)).toMatchObject({ mode: 'bot', game_id: picked.fight.game });
    expect((await call('play_move', { move: '(1,3)>NE' })).isError).toBe(false);
    expect(JSON.parse((await call('save_run')).text)).toMatchObject({ seed: 0, fighting: true, path: [0] });
    await call('resign');
    expect(JSON.parse((await call('run_state')).text)).toMatchObject({ screen: 'lost' });
  });

  test('place, choose and tactic are tools whose refusals are tool errors', async () => {
    await connect();
    await call('new_run', { seed: 0 });
    expect(JSON.parse((await call('run_choose', { choice: 0 })).text).code).toBe('not_now');
    expect(JSON.parse((await call('run_place', { q: 0, r: 2, kind: 'Heavy' })).text).code).toBe('not_now');
    expect(JSON.parse((await call('run_tactic', { tactic: 'Freeze' })).text).code).toBe('not_now');
    expect(JSON.parse((await call('run_flask')).text).code).toBe('bad_choice'); // the army is full
    expect(JSON.parse((await call('run_pick', { node: 5 })).text).code).toBe('bad_choice');
    expect((await call('run_tactic', { tactic: 'Teleport' })).isError).toBe(true);
    expect((await call('run_choose', { choice: -1 })).isError).toBe(true);
  });

  test('a saved run resumes, a bad save is bad_save', async () => {
    await connect();
    await call('new_run', { seed: 2, best: 1 });
    const save = JSON.parse((await call('save_run')).text);
    await call('new_run', { seed: 0 });
    expect(JSON.parse((await call('new_run', { save })).text)).toMatchObject({ seed: 2, screen: 'map' });
    expect(JSON.parse((await call('new_run', { save: { seed: 1 } })).text).code).toBe('bad_save');
    expect((await call('new_run', { unlocked: [99] })).isError).toBe(true);
  });
});

describe('the public Open world tools (#1365)', () => {
  /** A room over a fake PeerNet: `say` makes a peer talk, `sent` is what the browsers would receive. */
  function room() {
    const sent: Uint8Array[] = [];
    let data: (bytes: Uint8Array, peer: string) => void = () => {};
    const net: PeerNet = { send: (bytes) => void sent.push(bytes), onData: (cb) => (data = cb), onJoin: () => {}, onLeave: () => {}, onError: () => {}, close: () => {} };
    const world = new OpenWorld(worldRules(), bossIds);
    return { world, sent, say: (peer: string, bytes: Uint8Array) => data(bytes, peer), worldRoom: new WorldRoom(world, worldRules(), () => net, { sleep: async () => {} }) };
  }

  test('join, list the heroes, walk to one, leave: each a tool, errors as tool errors', async () => {
    const { world, say, worldRoom, sent } = room();
    await connect(worldRoom, world);
    expect((await call('world_heroes')).isError).toBe(true);
    expect(JSON.parse((await call('world_heroes')).text).code).toBe('no_world_room');
    const joined = JSON.parse((await call('join_world_room', { name: 'Claude' })).text);
    expect(joined).toMatchObject({ room: 'ow:1305:0', name: 'Claude', hero: '(0,0)' });
    expect(JSON.parse((await call('join_world_room')).text).code).toBe('already_in_world_room');
    say('p', encodeHello('Ada'));
    say('p', encodePos(1, 0, 1));
    expect(JSON.parse((await call('world_heroes')).text).heroes).toEqual([{ id: 'p', name: 'Ada', cell: '(1,0)', distance: 1 }]);
    expect(JSON.parse((await call('world_visit', { hero: 'p' })).text)).toMatchObject({ steps: 0, arrived: true });
    expect(JSON.parse((await call('world_visit', {})).text).code).toBe('bad_target');
    expect((await call('world_visit', { hero: 'p', q: 1 })).isError).toBe(false); // a hero wins over a cell
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.parse((await call('leave_world_room')).text)).toEqual({ left: true });
  });
});

describe('a server with no peer transport (#1365)', () => {
  test('joining the public world room is a transport error, not a crash', async () => {
    await connect();
    const result = await call('join_world_room');
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text).code).toBe('transport_failed');
  });
});

describe('the MCP server', () => {
  test('is Edgefall (#1651): its server name, its package, the walker config, and no tool says Abalone or ab-alone', async () => {
    const host = await connect();
    expect(host.getServerVersion()).toMatchObject({ name: 'edgefall' });
    const { tools } = await host.listTools();
    for (const tool of tools) expect(tool.description).not.toMatch(/abalone|ab-alone/i);
    const file = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    expect(JSON.parse(file('package.json')).name).toBe('edgefall-mcp');
    expect(Object.keys(JSON.parse(file('walker.mcp.json')).mcpServers)).toEqual(['edgefall']); // its tools are mcp__edgefall__*
    expect(file('walker-prompt.md')).toContain('Use only the edgefall tools');
    expect(file('walker-prompt.md')).not.toMatch(/abalone|ab-alone/i);
  });

  test('rules sums up the game in a few lines: winning, moving, pushing, the notation (#1676)', async () => {
    await connect();
    const text = (await call('rules')).text;
    expect(text).toContain('6 ');
    expect(text).toMatch(/push/i);
    expect(text).toMatch(/more marbles/i);
    expect(text).toContain('(q,r)');
    expect(text).toContain('ejected');
  });

  test('lists the tools of a local game and of an online room, with their input schemas', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'new_game',
      'rules',
      'get_state',
      'legal_moves',
      'play_move',
      'resign',
      'create_room',
      'join_room',
      'wait_for_opponent_move',
      'new_world',
      'world_state',
      'save_world',
      'world_step',
      'world_walk',
      'world_teleport',
      'join_world_room',
      'world_heroes',
      'world_visit',
      'leave_world_room',
      'new_run',
      'run_state',
      'run_pick',
      'run_place',
      'run_choose',
      'run_tactic',
      'run_flask',
      'save_run',
    ]);
    for (const tool of tools) expect(tool.description).toBeTruthy();
    const schema = (name: string) => tools.find((tool) => tool.name === name)!.inputSchema;
    expect(schema('new_game')).toMatchObject({
      type: 'object',
      properties: {
        boss: { type: 'string' },
        seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
        bot_nodes: { type: 'integer', minimum: 1, maximum: 200000 },
      },
      additionalProperties: false,
    });
    // The boss ids come from the engine (boss_ids()), so a host sees them without a call.
    expect(tools.find((tool) => tool.name === 'new_game')!.inputSchema.properties!.boss).toMatchObject({
      description: expect.stringContaining('echo, hull, choir, chaplain'),
    });
    expect(schema('new_game').required ?? []).toEqual([]);
    expect(schema('play_move')).toMatchObject({
      type: 'object',
      properties: { move: { type: 'string' } },
      required: ['move'],
      additionalProperties: false,
    });
    for (const name of ['get_state', 'legal_moves', 'resign']) {
      expect(schema(name)).toMatchObject({ type: 'object', properties: {} });
    }
    expect(schema('create_room')).toMatchObject({
      type: 'object',
      properties: { boss: { type: 'string' }, seed: { type: 'integer', minimum: 0 } },
      additionalProperties: false,
    });
    expect(schema('create_room').required ?? []).toEqual([]);
    expect(schema('join_room')).toMatchObject({
      type: 'object',
      properties: { room: { type: 'string' } },
      required: ['room'],
      additionalProperties: false,
    });
    expect(schema('wait_for_opponent_move')).toMatchObject({
      type: 'object',
      properties: { timeout_s: { type: 'integer', minimum: 1, maximum: 120 } },
      additionalProperties: false,
    });
    expect(schema('wait_for_opponent_move').required ?? []).toEqual([]);
  });

  test('a tool error is the error object of the spec, as JSON', async () => {
    await connect();
    for (const name of ['get_state', 'legal_moves', 'resign']) {
      const result = await call(name);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.text)).toEqual({ code: 'no_game', message: expect.any(String) });
    }
    const result = await call('play_move', { move: '(1,3)>NE' });
    expect(JSON.parse(result.text).code).toBe('no_game');
  });

  test('plays a game through every tool', async () => {
    await connect();
    const started = await call('new_game', { bot_nodes: 20 });
    expect(started.isError).toBe(false);
    expect(JSON.parse(started.text)).toMatchObject({ mode: 'bot', you: 'black', status: 'running' });

    const legal = JSON.parse((await call('legal_moves')).text);
    expect(legal.moves).toContain('(1,3)>NE');

    const played = JSON.parse((await call('play_move', { move: '(1,3)>NE' })).text);
    expect(played).toMatchObject({ played: '(1,3)>NE', reply: expect.any(String), bonuses: [] });
    expect(JSON.parse((await call('get_state')).text)).toEqual(played.state);

    const bad = await call('play_move', { move: '(1,3)>ne' });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.text)).toEqual({ code: 'bad_move', message: 'direction must be E, W, NE, SW, NW or SE' });

    const resigned = JSON.parse((await call('resign')).text);
    expect(resigned).toMatchObject({ status: 'white_won', resigned: true });
    expect(JSON.parse((await call('play_move', { move: '(1,3)>NE' })).text).code).toBe('game_over');
  });

  test('fights a boss: the boss object in the state, its reply in play_move, unknown_boss for a bad id', async () => {
    await connect();
    const started = JSON.parse((await call('new_game', { boss: 'echo', seed: 1 })).text);
    expect(started).toMatchObject({ mode: 'boss', boss: { id: 'echo', name: 'The Echo', tell: null, result: 'playing' } });
    expect(JSON.parse((await call('legal_moves')).text).announces['(1,3)>NE']).toBe('(-1,-3)>SW');
    const played = JSON.parse((await call('play_move', { move: '(1,3)>NE' })).text);
    // The announced mirror is the Echo's bonus move, played inside the move (#859); the reply is its own search move, and
    // its mirror is offered to us as a free move (#958).
    expect(played).toMatchObject({
      played: '(1,3)>NE',
      reply: '(-2,-2)>E',
      bonuses: ['(-1,-3)>SW'],
      state: { mode: 'boss' },
    });
    expect(JSON.parse((await call('legal_moves')).text).free).toEqual(['(2,2)>W']);
    const unknown = await call('new_game', { boss: 'nope' });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(unknown.text)).toEqual({ code: 'unknown_boss', message: 'unknown boss nope' });
  });

  test('opens a room and waits in it through the online tools', async () => {
    await connect();
    expect(JSON.parse((await call('wait_for_opponent_move')).text).code).toBe('no_room');
    const room = JSON.parse((await call('create_room')).text);
    expect(room).toMatchObject({ you: 'black', invite: expect.stringContaining(`#room=${room.room}`) });
    expect(JSON.parse((await call('get_state')).text)).toMatchObject({ mode: 'online', game_id: room.room });
    const again = await call('join_room', { room: room.invite });
    expect(again.isError).toBe(true);
    expect(JSON.parse(again.text).code).toBe('already_in_room');
    expect(JSON.parse((await call('resign')).text).code).toBe('not_supported');
    const waited = JSON.parse((await call('wait_for_opponent_move', { timeout_s: 1 })).text);
    expect(waited).toMatchObject({ event: 'timeout', state: { mode: 'online' } });
    for (const timeout_s of [0, 121, 1.5]) {
      const result = await call('wait_for_opponent_move', { timeout_s });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('timeout_s');
    }
  });

  test('create_room with a boss opens a duel whose invite names the boss and the boss seat (#1316)', async () => {
    await connect();
    const room = JSON.parse((await call('create_room', { boss: 'hull', seed: 5 })).text);
    expect(room.invite).toContain(`#room=${room.room}&boss=hull&seed=5&seat=boss&key=`);
    expect(JSON.parse((await call('get_state')).text)).toMatchObject({ mode: 'online', boss: { id: 'hull' } });
  });

  test('new_game with no argument plays against the default bot', async () => {
    await connect();
    const result = await call('new_game');
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text).status).toBe('running');
  });

  test('arguments outside the input schema are refused before the game sees them', async () => {
    await connect();
    for (const bot_nodes of [0, 200001, 1.5]) {
      const result = await call('new_game', { bot_nodes });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('bot_nodes');
    }
    for (const seed of [-1, 4294967296, 0.5]) {
      const result = await call('new_game', { boss: 'echo', seed });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('seed');
    }
    expect((await call('play_move', {})).isError).toBe(true);
    expect((await call('get_state')).isError).toBe(true);
  });
});
