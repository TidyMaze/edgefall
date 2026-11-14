// The bays of the tall shell of the Hub Cutaway as the Blender file places them (hub_tall_bay_<deck>_<room>, x and y of the node): the fixture of the ship's unit tests.
import type { Bay } from '../hubroll';
import type { Deck } from '../deck';

const ROWS: [Deck, number, [string, number][]][] = [
  ['mess', 0.24, [['world', -2], ['royale', -1], ['bot', 0.58], ['hotseat', 1.58], ['online', 2.58]]],
  ['mess', 1.4, [['medals', -2], ['logs', -1], ['echo', 0.58], ['dual', 1.58], ['daily', 2.58]]],
  ['cargo', 2.78, [['logs', -2], ['crates', -1], ['assembly', 0.58], ['swarm', 1.58], ['run', 2.58]]],
  ['cargo', 3.94, [['hold', -2], ['hull', 0.58], ['alien', 1.58], ['railyard', 2.58]]],
  ['furnace', 5.32, [['coop', -2], ['logs', -1], ['choir', 0.58], ['magnetizer', 1.58], ['core', 2.58]]],
  ['chapel', 6.7, [['nave', -2], ['logs', -1], ['chaplain', 0.58], ['overseer', 1.58], ['stalker', 2.58]]],
  ['bridge', 8.08, [['trainer', -2], ['ranked', -1], ['ballast', 0.58], ['pulsar', 1.58], ['logs', 2.58]]],
];
export const TALL_BAYS: Bay[] = ROWS.flatMap(([deck, y, rooms]) => rooms.map(([room, x]) => ({ deck, room, x, y })));
