import { describe, expect, it } from 'vitest';
import { CELLS, VANISHED, type Axial } from './board';
import { DECK_NAMES } from './deck';
import { frameShape } from './frame';
import { HUB_CELLS, neighbours, roomsOf, type Spot } from './hub';
import { SECRETS } from './story';
import { BOSS_IDS } from './tally';
import { arrowCell, bossTitle, bumpLine, HUB_BOARD, hubHtml, hubTargetText, labelsHtml, nextBossTitle, nextGoal, pipsHtml, railHtml, reachabilityText, roomLabel, type Goal } from './hubview';

// The hub on screen (docs/specs/game-design.md section 3.5, #521): the board the map is drawn with, the arrow keys and
// the HUD plate.

describe('the hub board', () => {
  it('is floor on the 37 map cells and a hole everywhere else, so the frame shrinks to the map', () => {
    expect(HUB_BOARD).toHaveLength(CELLS.length);
    CELLS.forEach(([q, r], i) =>
      expect(HUB_BOARD[i]).toBe(HUB_CELLS.some(([hq, hr]) => hq === q && hr === r) ? 0 : VANISHED),
    );
    expect(frameShape(HUB_BOARD)).toMatchObject({ radius: 3, holes: [] });
  });
});

describe('the arrow keys', () => {
  it('roll left and right along the row', () => {
    expect(arrowCell([0, 0], 'ArrowLeft')).toEqual([-1, 0]);
    expect(arrowCell([1, -1], 'ArrowRight')).toEqual([2, -1]);
  });

  it('roll up and down in a zigzag that keeps the column: the centre reaches both lifts in two presses', () => {
    expect(arrowCell([0, 0], 'ArrowUp')).toEqual([1, -1]);
    expect(arrowCell([1, -1], 'ArrowUp')).toEqual([1, -2]);
    expect(arrowCell([0, 0], 'ArrowDown')).toEqual([0, 1]);
    expect(arrowCell([0, 1], 'ArrowDown')).toEqual([-1, 2]);
  });

  it('always roll to a neighbour, and down undoes up', () => {
    for (const cell of HUB_CELLS) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        const [q, r] = arrowCell(cell, key)!;
        expect(Math.max(Math.abs(q - cell[0]), Math.abs(r - cell[1]), Math.abs(q + r - cell[0] - cell[1]))).toBe(1);
      }
      const up = arrowCell(cell, 'ArrowUp')!;
      expect(arrowCell(up, 'ArrowDown')).toEqual(cell);
    }
    expect(neighbours([0, 0])).toContainEqual(arrowCell([0, 0], 'ArrowUp'));
  });

  it('ignore every other key', () => {
    for (const key of ['Enter', 'a', ' ', 'Escape']) expect(arrowCell([0, 0], key)).toBeNull();
  });
});

describe('the hub HUD plate', () => {
  const at = (cell: Axial, deck: 'mess' | 'cargo' | 'bridge' = 'mess') => hubHtml({ deck, cell });

  it('names the ship and the deck, and nothing under the marble on a floor cell', () => {
    expect(at([0, 0])).toBe('<div class="turn"><span>Hub · Mess</span></div><small></small>');
    expect(at([0, 0], 'cargo')).toContain('Hub · Cargo');
  });

  it('names the room the marble stands on', () => {
    expect(at([2, 0])).toContain('<small>The Echo · boss, Mess seat</small>');
    expect(at([2, -1])).toContain("<small>Captain's order · read the log</small>");
    expect(at([-1, -1])).toContain('<small>Crew table · 2 players, one screen</small>');
    expect(at([-2, 0])).toContain("<small>House table · play the ship's bot</small>");
    expect(at([-2, 1])).toContain('<small>Comms desk · 1v1 online match</small>');
    expect(at([-3, 2])).toContain('<small>Arena · battle royale</small>'); // #522, #593
    expect(at([1, -2])).toContain('<small>Lift to Cargo</small>');
    expect(at([-1, 2], 'bridge')).toContain('<small>Lift to Chapel</small>');
  });
});

describe('a locked lift (#523)', () => {
  const below: Spot = { deck: 'mess', cell: [1, -1] };

  it('makes Tally say one short line when the marble bumps it', () => {
    expect(bumpLine(below, [1, -2], [])).toBe("Lift to Cargo: locked. This deck's boss is still on the books.");
    expect(bumpLine({ deck: 'cargo', cell: [0, -1] }, [1, -2], ['echo'])).toContain('Lift to Furnace: locked.');
  });

  it('says nothing for an open lift, another cell, or a lift more than one cell away', () => {
    expect(bumpLine(below, [1, -2], ['echo'])).toBe('');
    expect(bumpLine({ deck: 'cargo', cell: [0, 1] }, [-1, 2], [])).toBe(''); // the lift down is always open
    expect(bumpLine(below, [0, -1], [])).toBe('');
    expect(bumpLine({ deck: 'mess', cell: [0, 0] }, [1, -2], [])).toBe('');
  });

  it('shows the banked line of a town under its contract (#1622)', () => {
    expect(hubHtml(below, '', null, 'Contract: The Echo, ring 1, 3 cells, to the right.', 'No blueprint banked yet.')).toContain(
      '<div class="hub-contract">Contract: The Echo, ring 1, 3 cells, to the right.</div><div class="hub-banked">No blueprint banked yet.</div>',
    );
  });

  it('puts the posted contract under the room, above Tally\'s line (#1618)', () => {
    expect(hubHtml(below, '', null, 'Contract: The Echo, ring 1, 3 cells, to the right.')).toBe(
      '<div class="turn"><span>Hub · Mess</span></div><small></small><div class="hub-contract">Contract: The Echo, ring 1, 3 cells, to the right.</div>',
    );
  });

  it("puts Tally's line under the HUD plate", () => {
    expect(hubHtml(below, 'Locked.')).toBe(
      '<div class="turn"><span>Hub · Mess</span></div><small></small><div class="tally">Locked.</div>',
    );
  });
});

describe('hub target inspection and reachability (#628)', () => {
  const at: Spot = { deck: 'mess', cell: [0, 0] };

  it('reports reachability for neighbours, current cell, and distant cells', () => {
    expect(bossTitle('unknown')).toBe('Boss');
    expect(bossTitle('echo')).toBe('The Echo');
    expect(reachabilityText([0, 0], [0, 0])).toBe('Current position');
    expect(reachabilityText([0, 0], [1, 0])).toBe('Click to move');
    expect(reachabilityText([0, 0], [-1, 1])).toBe('Click to move');
    expect(reachabilityText([0, 0], [2, 0])).toBe('Out of reach (roll closer)');
    expect(reachabilityText([0, 0], [-3, 2])).toBe('Out of reach (roll closer)');
  });

  it('inspects all room kinds with descriptive names and mode subtitles', () => {
    expect(hubTargetText(at, [-2, 0])).toEqual({
      name: 'House table',
      desc: 'Practice match against AI',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [2, 0])).toEqual({
      name: 'The Echo',
      desc: 'boss, Mess seat',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText({ deck: 'cargo', cell: [1, 0] }, [2, 0])).toEqual({
      name: 'The Hull',
      desc: 'boss, Cargo seat',
      reach: 'Click to move',
    });
    expect(hubTargetText(at, [-1, -1])).toEqual({
      name: 'Crew table',
      desc: '2 players, one screen',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText({ deck: 'mess', cell: [0, -1] }, [-1, -1])).toEqual({
      name: 'Crew table',
      desc: '2 players, one screen',
      reach: 'Click to move',
    });
    expect(hubTargetText(at, [-2, 1])).toEqual({
      name: 'Comms desk',
      desc: 'Peer-to-peer 1v1 match',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [-3, 2])).toEqual({
      name: 'Arena',
      desc: 'Multi-player battle royale',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [0, 2])).toEqual({
      name: 'Medal wall',
      desc: 'Every boss, its medal and best turns',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [2, -1])).toEqual({
      name: "Captain's order",
      desc: 'Hub archive and audio log',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [1, -2])).toEqual({
      name: 'Lift to Cargo',
      desc: 'Transit to Cargo',
      reach: 'Out of reach (roll closer)',
    });
    expect(hubTargetText(at, [3, -2])).toEqual({
      name: 'The Dual Room',
      desc: 'boss, Mess station',
      reach: 'Out of reach (roll closer)',
    });
    const target = (deck: Spot['deck'], cell: Axial): string => {
      const { name, desc } = hubTargetText({ deck, cell: [0, 0] }, cell);
      return `${name} · ${desc}`;
    };
    expect(target('mess', [3, -3])).toBe('Morning count · One boss and one seed a day');
    expect(target('mess', [0, -3])).toBe('Airlock · A generated hex world');
    expect(target('cargo', [0, 3])).toBe('Mining cut · Three acts, one army of 14');
    expect(target('furnace', [0, -3])).toBe('Shift crew · Two players, one army, a boss');
    expect(target('bridge', [3, -3])).toBe('Clamp list · Online 1v1, Elo and tiers');
    expect(target('bridge', [0, -3])).toBe('Table zero · Waves against the bot, one more each');
    expect(hubTargetText(at, [1, 0])).toEqual({
      name: 'Deck floor',
      desc: 'Open transit corridor',
      reach: 'Click to move',
    });
  });

  it('renders preview in hubHtml when hover is provided', () => {
    const html = hubHtml(at, '', [-2, 0]);
    expect(html).toContain('class="hub-preview"');
    expect(html).toContain('Target: House table · Practice match against AI');
    expect(html).toContain('(Out of reach (roll closer))');

    const near = hubHtml({ deck: 'mess', cell: [-1, 0] }, '', [-2, 0]);
    expect(near).toContain('Target: House table · Practice match against AI');
    expect(near).toContain('(Click to move)');
  });

  it('omits preview in hubHtml when hover is null', () => {
    expect(hubHtml(at, '', null)).not.toContain('class="hub-preview"');
  });
});

// The deck plan (#1249): every room wears a label plate, always shown, with a short label for a phone; a lift-shaft rail
// lists the five decks and boss pips show the progress.
describe('the room labels (#1249)', () => {
  it('name each room in the voice of the ship, with a plain line and a short label for a phone', () => {
    const plate = (deck: 'mess' | 'cargo' | 'furnace' | 'bridge', door: Parameters<typeof roomLabel>[1]) => roomLabel(deck, door, []);
    expect(plate('mess', { kind: 'hotseat' })).toEqual({ name: 'Crew table', state: '2 players, one screen', short: 'Hot-seat', mark: '' });
    expect(plate('mess', { kind: 'bot' })).toEqual({ name: 'House table', state: "play the ship's bot", short: 'Bot', mark: '' });
    expect(plate('mess', { kind: 'online' })).toEqual({ name: 'Comms desk', state: '1v1 online match', short: 'Online', mark: '' });
    expect(plate('mess', { kind: 'royale' })).toEqual({ name: 'Arena', state: 'battle royale', short: 'Royale', mark: '' });
    expect(plate('mess', { kind: 'terminal', lore: 'mess-house-rule' })).toEqual({ name: "Captain's order", state: 'read the log', short: 'Order', mark: '' });
    expect(plate('mess', { kind: 'terminal', lore: 'nobody-named-it' })).toEqual({ name: "Ship's door", state: 'a room of the Ballast', short: 'Door', mark: '' });
    expect(plate('mess', { kind: 'medals' })).toEqual({ name: 'Medal wall', state: 'medals and best turns', short: 'Medals', mark: '' });
    expect(plate('mess', { kind: 'daily' })).toEqual({ name: 'Morning count', state: 'the boss of the day', short: 'Daily', mark: '' });
    expect(plate('cargo', { kind: 'run' })).toEqual({ name: 'Mining cut', state: 'rogue-lite run, 3 acts', short: 'Run', mark: '' });
    expect(plate('cargo', { kind: 'world' })).toEqual({ name: 'Airlock', state: 'walk the open world', short: 'World', mark: '' });
    expect(plate('furnace', { kind: 'together' })).toEqual({ name: 'Shift crew', state: 'co-op against a boss', short: 'Co-op', mark: '' });
    expect(plate('bridge', { kind: 'ranked' })).toEqual({ name: 'Clamp list', state: 'ranked 1v1 online', short: 'Ranked', mark: '' });
    expect(plate('bridge', { kind: 'trainer' })).toEqual({ name: 'Table zero', state: 'drill: waves of the bot', short: 'Trainer', mark: '' });
  });

  it('name the boss behind the door, marked once beaten', () => {
    expect(roomLabel('cargo', { kind: 'boss', boss: 'hull' }, [])).toEqual({ name: 'The Hull', state: 'boss, Cargo seat', short: 'Hull', mark: '' });
    expect(roomLabel('mess', { kind: 'boss', boss: 'echo' }, ['echo'])).toEqual({
      name: 'The Echo',
      state: 'beaten',
      short: 'Echo',
      mark: 'beaten',
    });
  });

  it('name every boss of the roster, its phone label without "The" (#1249)', () => {
    const names = ['echo', 'hull', 'choir', 'chaplain', 'ballast', 'alien', 'railyard', 'magnetizer', 'pulsar', 'overseer', 'assembly', 'core', 'dual', 'stalker', 'swarm'].map(bossTitle);
    expect(names).toEqual([
      'The Echo', 'The Hull', 'The Choir', 'The Chaplain', 'The Ballast Mind', 'The Alien', 'The Rail Yard', 'The Magnetizer',
      'The Pulsar', 'The Overseer', 'The Assembly Line', 'The Unstable Core', 'The Dual Room', 'The Stalker', 'The Swarm',
    ]);
    expect(roomLabel('cargo', { kind: 'boss', boss: 'assembly' }, []).short).toBe('Assembly Line');
  });

  it('show the medal of a beaten boss: its best turns (#1249)', () => {
    expect(roomLabel('cargo', { kind: 'boss', boss: 'alien' }, ['alien'], { alien: 22 })).toEqual({
      name: 'The Alien',
      state: 'Medal: 22 turns',
      short: 'Alien',
      mark: 'beaten',
    });
    expect(roomLabel('mess', { kind: 'boss', boss: 'echo' }, ['echo'], { echo: 1 }).state).toBe('Medal: 1 turn');
    expect(roomLabel('cargo', { kind: 'boss', boss: 'alien' }, [], { echo: 3 }).state).toBe('boss, Cargo station');
    expect(labelsHtml({ deck: 'cargo', cell: [0, 0] }, ['alien'], { alien: 22 })).toContain('<b>The Alien</b><small>Medal: 22 turns</small>');
  });

  it('point a lift up or down to its deck, marked while it is locked', () => {
    expect(roomLabel('cargo', { kind: 'lift', to: 'furnace' }, ['echo'])).toEqual({
      name: 'Lift ▲ Furnace',
      state: 'locked',
      short: '▲ Locked',
      mark: 'locked',
    });
    expect(roomLabel('cargo', { kind: 'lift', to: 'mess' }, ['echo'])).toEqual({ name: 'Lift ▼ Mess', state: 'open', short: '▼ Mess', mark: '' });
    expect(roomLabel('mess', { kind: 'lift', to: 'cargo' }, ['echo'])).toEqual({ name: 'Lift ▲ Cargo', state: 'open', short: '▲ Cargo', mark: '' });
  });

  it('put one plate on the cell of each room of the deck, and YOU on the marble', () => {
    const html = labelsHtml({ deck: 'mess', cell: [0, 0] }, []);
    expect(html.match(/class="hub-label"/g)).toHaveLength(12); // the eleven rooms and the lift up of the Mess
    expect(html).toContain(
      '<div class="hub-label" data-cell="2,0" data-kind="boss"><b>The Echo</b><small>boss, Mess seat</small><span class="short">Echo</span></div>',
    );
    expect(html).toContain('<div class="hub-label" data-cell="1,-2" data-kind="lift" data-mark="locked"><b>Lift ▲ Cargo</b>');
    expect(html).toContain('<div class="hub-label you" data-cell="0,0">You</div>');
  });

  it('lock the boss and mode rooms until the first win (#1665), and leave the tables, the desk and the lifts', () => {
    const boss = roomLabel('mess', { kind: 'boss', boss: 'dual' }, [], {}, true);
    expect(boss).toMatchObject({ name: 'The Dual Room', state: 'Win your first game to unlock', short: 'Dual Room locked', mark: 'locked' });
    expect(roomLabel('mess', { kind: 'world' }, [], {}, true)).toMatchObject({ state: 'Win your first game to unlock', mark: 'locked' });
    expect(roomLabel('mess', { kind: 'bot' }, [], {}, true)).toEqual(roomLabel('mess', { kind: 'bot' }, []));
    expect(roomLabel('mess', { kind: 'lift', to: 'cargo' }, ['echo'], {}, true).mark).toBe('');
    const html = labelsHtml({ deck: 'mess', cell: [0, 0] }, [], {}, null, true);
    expect(html).toContain('data-kind="world" data-mark="locked"');
    expect(html).toContain('data-kind="bot"><b>');
    expect(labelsHtml({ deck: 'mess', cell: [0, 0] }, [])).not.toContain('data-kind="world" data-mark="locked"');
  });

  it('marks the plate of the room the marble stands on, with no YOU plate of its own', () => {
    const html = labelsHtml({ deck: 'cargo', cell: [2, 0] }, ['echo', 'hull']);
    expect(html).toContain('<div class="hub-label" data-cell="2,0" data-kind="boss" data-mark="beaten" data-here>');
    expect(html).not.toContain('hub-label you');
  });
});

describe('the next boss of the notice board (#1528)', () => {
  it('is the first boss not beaten in deck order, and none once all five are down', () => {
    expect(nextBossTitle([])).toBe('The Echo');
    expect(nextBossTitle(['echo'])).toBe('The Hull');
    expect(nextBossTitle(['echo', 'choir'])).toBe('The Hull'); // a boss out of order does not skip the deck before it
    expect(nextBossTitle(['echo', 'hull', 'choir', 'chaplain', 'ballast'])).toBeNull();
  });
});

describe('the lift-shaft rail (#1249)', () => {
  it('lists the five decks from the Bridge down, each beaten, open or locked, and where the marble is', () => {
    const html = railHtml('cargo', ['echo']);
    expect(html.match(/<li /g)).toHaveLength(5);
    expect(html.indexOf('Bridge')).toBeLessThan(html.indexOf('Mess'));
    expect(html).toContain('<li data-deck="mess" data-state="beaten"><span class="n">01</span><b>Mess</b><small>Seat: The Echo beaten</small></li>');
    expect(html).toContain(
      '<li data-deck="cargo" data-state="open" aria-current="location"><span class="n">02</span><b>Cargo</b><small>Seat: The Hull waits · you are here</small></li>',
    );
    expect(html).toContain('<li data-deck="furnace" data-state="locked"><span class="n">03</span><b>Furnace</b><small>Lift locked</small></li>');
  });

  it('says a deck is beaten once its boss is, from the boss menu too', () => {
    expect(railHtml('mess', ['choir'])).toContain('<li data-deck="furnace" data-state="beaten"><span class="n">03</span><b>Furnace</b><small>Seat: The Choir beaten</small></li>');
  });
});

describe('the boss pips (#1249, #1527)', () => {
  it('count the medals out of the fifteen bosses as the Open world does, a pip a deck in deck order: beaten, open or locked', () => {
    expect(pipsHtml(['echo'], { echo: 12 })).toBe(
      '<span class="count">Medals 1 / 15</span>' +
        '<span class="pip" data-state="beaten" title="Mess deck, The Echo: beaten"></span>' +
        '<span class="pip" data-state="open" title="Cargo deck, The Hull: open"></span>' +
        '<span class="pip" data-state="locked" title="Furnace deck, The Choir: locked"></span>' +
        '<span class="pip" data-state="locked" title="Chapel deck, The Chaplain: locked"></span>' +
        '<span class="pip" data-state="locked" title="Bridge deck, The Ballast Mind: locked"></span>',
    );
    expect(pipsHtml([], {})).toContain('Medals 0 / 15');
    expect(pipsHtml([], { echo: 3, alien: 9, dual: 4, nobody: 1 })).toContain('Medals 3 / 15'); // a medal of a boss the roster has not does not count
  });
});

describe('the seat of a deck and its stations (#1547)', () => {
  it('has the rail name the seat only, the boss that opens the next lift, while the plates of the deck name every boss', () => {
    const rail = railHtml('mess', []);
    expect(rail).toContain('Seat: The Echo waits');
    expect(rail).not.toContain('Dual Room');
    const plates = labelsHtml({ deck: 'mess', cell: [0, 0] }, []);
    expect(plates).toContain('<b>The Echo</b><small>boss, Mess seat</small>');
    expect(plates).toContain('<b>The Dual Room</b><small>boss, Mess station</small>');
    expect(plates.match(/data-kind="boss"/g)).toHaveLength(2); // two boss doors on the Mess, one seat
  });
});

describe('the next goal (#1521, #1524)', () => {
  const BOSSES = ['echo', 'hull', 'choir', 'chaplain', 'ballast'];

  it('walks the path: The Echo, a first rogue-lite run, then the boss of each next deck in order', () => {
    expect(nextGoal([], false)).toEqual({ text: 'Beat The Echo on the Mess deck.', deck: 'mess', room: 'boss' });
    expect(nextGoal([], true).room).toBe('boss'); // a run before The Echo does not skip it
    expect(nextGoal(['echo'], false)).toEqual({ text: 'Start a rogue-lite run on the Cargo deck.', deck: 'cargo', room: 'run' });
    expect(nextGoal(['echo'], true)).toEqual({ text: 'Beat The Hull on the Cargo deck.', deck: 'cargo', room: 'boss' });
    expect(nextGoal(['echo', 'hull'], true)).toEqual({ text: 'Beat The Choir on the Furnace deck.', deck: 'furnace', room: 'boss' });
    expect(nextGoal(BOSSES.slice(0, 4), true)).toEqual({ text: 'Beat The Ballast Mind on the Bridge deck.', deck: 'bridge', room: 'boss' });
  });

  it('names the first boss not beaten, whatever order the bosses fell in, and the run goal comes before it', () => {
    expect(nextGoal(['hull', 'choir'], true).deck).toBe('mess');
    expect(nextGoal(['echo', 'choir'], true).deck).toBe('cargo');
    expect(nextGoal(['echo', 'hull'], false).room).toBe('run');
  });

  it('says what is left to do when all five bosses are beaten, on no deck', () => {
    expect(nextGoal(BOSSES, true)).toEqual({ text: 'All bosses beaten. Try the Daily or a run.', deck: null, room: null });
  });

  it('never spoils: no secret word, and no boss of a deck above the goal named', () => {
    const states = BOSSES.flatMap((_, n) => [false, true].map((ran) => nextGoal(BOSSES.slice(0, n), ran)));
    for (const [i, { text, deck }] of states.entries()) {
      for (const { word } of SECRETS) expect(text, `state ${i}`).not.toMatch(word);
      const above = deck === null ? [] : BOSSES.slice(DECK_NAMES.indexOf(deck) + 1);
      for (const boss of above) expect(text, `state ${i}`).not.toContain(bossTitle(boss));
    }
  });

  it('keeps the run as the goal after all five bosses while none was started', () => {
    expect(nextGoal(BOSSES, false).deck).toBe('cargo'); // the run is still the goal until it is started
  });

  it('says the first win on the open deck while the lock is on, and The Echo waits again after (#1665)', () => {
    expect(railHtml('mess', [], null, true)).toContain('<small>Seat: win your first game · you are here</small>');
    expect(railHtml('mess', [], null, true)).not.toContain('Echo waits');
    expect(railHtml('mess', [], null, false)).toContain('Seat: The Echo waits');
  });

  it('puts the goal in a line of the rail, under the five decks, and rings the row of its deck', () => {
    const html = railHtml('mess', [], nextGoal([], false));
    expect(html).toContain('<p class="goal"><span class="lead">Next goal: </span>Beat The Echo on the Mess deck.</p>');
    expect(html).toContain('<li data-deck="mess" data-state="open" data-goal aria-current="location"><span class="n">01</span><b>Mess</b><small>Seat: The Echo waits · you are here</small></li>');
    expect(html.match(/data-goal/g)).toHaveLength(1);
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('class="goal"'));
    expect(railHtml('cargo', ['echo'], nextGoal(['echo'], false))).toContain('<li data-deck="cargo" data-state="open" data-goal aria-current="location">');
    const done = railHtml('mess', BOSSES, nextGoal(BOSSES, true));
    expect(done).toContain('<p class="goal"><span class="lead">Next goal: </span>All bosses beaten. Try the Daily or a run.</p>');
    expect(done).not.toContain('<li data-deck="mess" data-state="beaten" data-goal');
    expect(done).not.toContain('data-goal'); // no row to ring
  });

  it('says no goal when none is asked: the rail as before', () => {
    const html = railHtml('mess', []);
    expect(html).not.toContain('class="goal"');
    expect(html).not.toContain('data-goal');
  });

  it('makes the lift on the way to a goal on another deck the loud plate, the adjacent deck of its way, and quiets the rest (#1526)', () => {
    // Cargo (index 1) to Mess: the lift down; Furnace (2) to Bridge (4): the lift up to Chapel, the next deck on the way, not the Bridge's.
    const down = labelsHtml({ deck: 'cargo', cell: [0, 0] }, [], {}, nextGoal([], false));
    expect(down.match(/data-goal/g)).toHaveLength(1);
    expect(down).toContain('<div class="hub-label" data-cell="-1,2" data-kind="lift" data-goal>');
    expect(down).toContain('<div class="hub-label" data-cell="1,-2" data-kind="lift" data-mark="locked" data-quiet>');
    const up: Goal = { text: '', deck: 'bridge', room: 'boss' };
    const furnace = labelsHtml({ deck: 'furnace', cell: [0, 0] }, [], {}, up);
    expect(furnace.match(/data-goal/g)).toHaveLength(1);
    expect(furnace).toContain('<div class="hub-label" data-cell="1,-2" data-kind="lift" data-mark="locked" data-goal>');
    expect(furnace).toContain('<div class="hub-label" data-cell="-1,2" data-kind="lift" data-mark="locked" data-quiet>');
  });

  it('quiets every other plate of the deck while the goal room is on it, the room under the marble and the YOU plate aside (#1526)', () => {
    const html = labelsHtml({ deck: 'mess', cell: [0, 0] }, [], {}, nextGoal([], false));
    expect(html.match(/data-quiet/g)).toHaveLength(11); // the twelve plates of the Mess but the Echo's door
    expect(html).toContain('<div class="hub-label" data-cell="2,0" data-kind="boss" data-goal>');
    expect(html).toContain('<div class="hub-label" data-cell="1,-2" data-kind="lift" data-mark="locked" data-quiet>');
    expect(html).not.toMatch(/hub-label you[^>]*data-quiet/);
    const bot = roomsOf('mess').find(({ door }) => door.kind === 'bot')!.cell;
    const here = labelsHtml({ deck: 'mess', cell: bot }, [], {}, nextGoal([], false));
    expect(here.match(/data-quiet/g)).toHaveLength(10); // the room under the marble wears its own ring, not the quiet weight
    expect(here).toMatch(/data-kind="bot" data-here>/);
    for (const html of [
      labelsHtml({ deck: 'mess', cell: [0, 0] }, []),
      labelsHtml({ deck: 'mess', cell: [0, 0] }, BOSSES, {}, nextGoal(BOSSES, true)),
    ])
      expect(html).not.toContain('data-quiet');
  });

  it('marks the plate of the goal room alone: the boss door of the goal deck, or the Rogue-lite room, and no other', () => {
    const boss = labelsHtml({ deck: 'mess', cell: [0, 0] }, [], {}, nextGoal([], false));
    expect(boss.match(/data-goal/g)).toHaveLength(1);
    expect(boss).toContain('<div class="hub-label" data-cell="2,0" data-kind="boss" data-goal>');
    const run = labelsHtml({ deck: 'cargo', cell: [0, 0] }, ['echo'], {}, nextGoal(['echo'], false));
    expect(run.match(/data-goal/g)).toHaveLength(1);
    expect(run).toMatch(/data-kind="run" data-goal>/);
    expect(run).not.toMatch(/data-kind="boss"[^>]*data-goal/);
    expect(labelsHtml({ deck: 'mess', cell: [0, 0] }, [])).not.toContain('data-goal');
    expect(labelsHtml({ deck: 'mess', cell: [0, 0] }, BOSSES, {}, nextGoal(BOSSES, true))).not.toContain('data-goal');
  });
});

describe('a locked door is never the goal (#1665)', () => {
  it('while waiting for the first win no plate carries the amber goal, whatever the goal says', () => {
    const goal = nextGoal([], false);
    expect(labelsHtml({ deck: 'mess', cell: [0, 0] }, [], {}, goal, false)).toContain('data-goal');
    expect(labelsHtml({ deck: 'mess', cell: [0, 0] }, [], {}, goal, true)).not.toContain('data-goal');
  });
});
