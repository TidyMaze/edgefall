import { describe, expect, it } from 'vitest';
import { backWay, needsEntry, type Screen } from './backnav';
import type { Exit } from './exitslot';

// Browser Back and the Android Back gesture (#1564, docs/specs/ui.md section "Browser Back"): the page keeps one history entry
// while a screen other than the one it started on is shown, and Back runs the way out the screen has already.

describe('needsEntry: the page asks for a history entry', () => {
  it('on a screen other than the base one when it holds none', () => {
    expect(needsEntry('hub', 'table', false)).toBe(true);
    expect(needsEntry('mode', 'table', false)).toBe(true);
    expect(needsEntry('table', 'hub', false)).toBe(true);
  });
  it('never on the base screen', () => {
    for (const screen of ['table', 'hub', 'mode'] as const) expect(needsEntry(screen, screen, false)).toBe(false);
  });
  it('never when it holds one already', () => {
    expect(needsEntry('mode', 'table', true)).toBe(false);
  });
  it('never in an online room, whose address is its own entry', () => {
    expect(needsEntry('room', 'table', false)).toBe(false);
  });
});

describe('backWay: what Back does on the screen it left', () => {
  const way = (screen: Screen, base: Screen, exit: Exit = null, forward = false) => backWay(screen, base, exit, forward);
  it('leaves the page from a screen with no exit that is not the Hub: only the Hub has none (#1697)', () => {
    expect(way('mode', 'table')).toBe('leave');
    expect(way('table', 'hub')).toBe('leave');
  });
  it('takes the Hub to the table', () => {
    expect(way('hub', 'table')).toBe('table');
  });
  it('takes the exit of the dock when the screen has one (#1517): it leads to the Hub or the Open world', () => {
    expect(way('mode', 'table', 'hub')).toBe('exit');
    expect(way('mode', 'table', 'world')).toBe('exit');
    expect(way('hub', 'table', 'world')).toBe('exit');
  });
  it('lets the page go when the base screen is shown: the entry was left behind by the mode\'s own button', () => {
    expect(way('table', 'table')).toBe('leave');
    expect(way('hub', 'hub', 'world')).toBe('leave');
  });
  it('keeps an online room as it is: the browser drops its address and nothing else', () => {
    expect(way('room', 'table')).toBe('stay');
    expect(way('room', 'room')).toBe('stay');
  });
  it('does nothing when Forward lands on the entry again', () => {
    expect(way('mode', 'table', null, true)).toBe('stay');
  });
});
