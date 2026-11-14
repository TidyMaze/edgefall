import { describe, expect, it } from 'vitest';
import { endBanner, ordinal, royaleBanner, type EndMode } from './endbanner';

const input = (mode: EndMode, side: number, status: number, reason = 0, win = 6, glass = 2) => ({ mode, side, status, reason, win, glass });
const REPEAT = 1;
const STALL = 2;
const BLOCKED = 3;

describe('endBanner', () => {
  it('shows nothing while the game runs', () => {
    expect(endBanner(input('local', 0, 0))).toBeNull();
  });

  it('all combinations of mode, side, status and reason: title and animation', () => {
    const rows: [EndMode, number, number, number, string, string][] = [
      // mode, side, status, reason, title, animation
      ['local', 0, 1, 0, 'Black wins', 'win'],
      ['local', 0, 2, 0, 'White wins', 'win'],
      ['local', 0, 3, REPEAT, 'Draw', 'draw'],
      ['local', 0, 3, STALL, 'Draw', 'draw'],
      ['bot', 1, 1, 0, 'You win', 'win'],
      ['bot', 1, 2, 0, 'You lose', 'loss'],
      ['bot', 1, 3, REPEAT, 'Draw', 'draw'],
      ['bot', 1, 3, STALL, 'Draw', 'draw'],
      ['boss', 1, 1, 0, 'Victory', 'win'],
      ['boss', 1, 2, 0, 'Defeat', 'loss'],
      ['boss', 1, 3, REPEAT, 'Defeat', 'loss'], // a draw against a boss is a defeat (rules.md 10.3)
      ['boss', 1, 3, STALL, 'Defeat', 'loss'],
      ['online', 1, 1, 0, 'You win', 'win'],
      ['online', 1, 2, 0, 'You lose', 'loss'],
      ['online', 2, 2, 0, 'You win', 'win'],
      ['online', 2, 1, 0, 'You lose', 'loss'],
      ['online', 1, 3, REPEAT, 'Draw', 'draw'],
      ['online', 2, 3, STALL, 'Draw', 'draw'],
      ['online', 0, 1, 0, 'Black wins', 'win'], // a spectator sees the colours
      ['online', 0, 2, 0, 'White wins', 'win'],
      ['online', 0, 3, REPEAT, 'Draw', 'draw'],
    ];
    for (const [mode, side, status, reason, title, anim] of rows) {
      const b = endBanner(input(mode, side, status, reason))!;
      expect([mode, side, status, reason, b.title, b.anim]).toEqual([mode, side, status, reason, title, anim]);
    }
  });

  it('names the winner after the glass: against the bot side 1 wears it, so side 1 wins as White', () => {
    expect(endBanner(input('local', 0, 1, 0, 6, 1))!.title).toBe('White wins');
    expect(endBanner(input('local', 0, 2, 0, 6, 1))!.title).toBe('Black wins');
  });

  // #1038: the ejected count is the pips and the score line of the plate, not the end line again (no "6 out.").
  it('gives the reason in the ship tone, without the ejections the plate already shows', () => {
    expect(endBanner(input('bot', 1, 1, 0, 6))!.line).toBe('The books balance.');
    expect(endBanner(input('bot', 1, 2, 0, 6))!.line).toBe('Tally strikes your name.');
    expect(endBanner(input('boss', 1, 1, 0, 10))!.line).toBe('The seat is empty.');
    expect(endBanner(input('boss', 1, 2, 0, 6))!.line).toBe('The seat holds.');
    expect(endBanner(input('local', 0, 2, 0, 6))!.line).toBe('The books balance.');
    expect(endBanner(input('bot', 1, 3, REPEAT))!.line).toBe('Same position three times. Tally closes the page.');
    expect(endBanner(input('bot', 1, 3, STALL))!.line).toBe('100 plies without an ejection. Tally calls it even.');
    expect(endBanner(input('boss', 1, 3, REPEAT))!.line).toBe('Repeated 3 times: a defeat.');
    expect(endBanner(input('boss', 1, 3, STALL))!.line).toBe('100 plies idle: a defeat.');
  });

  it('a draw with neither side able to move says so (#1301)', () => {
    expect(endBanner(input('bot', 1, 3, BLOCKED))).toEqual({ title: 'Draw', line: 'Neither side can move. Tally calls it even.', anim: 'draw' });
    expect(endBanner(input('boss', 1, 3, BLOCKED))).toEqual({ title: 'Defeat', line: 'No move left: a defeat.', anim: 'loss' });
  });
});

describe('royaleBanner (#503)', () => {
  const at = (place: number, points: number, seat = 0) => ({ seat, place, points });

  it('shows nothing while the battle royale runs', () => {
    expect(royaleBanner([], 0)).toBeNull();
  });

  it('first place wins, with the points scored', () => {
    expect(royaleBanner([at(1, 12), at(2, 6, 1)], 0)).toEqual({ title: 'You win', line: '12 points. The books balance.', anim: 'win' });
  });

  it('any other place names it, a loss', () => {
    expect(royaleBanner([at(1, 10, 1), at(3, 5)], 0)).toEqual({ title: 'You place 3rd', line: '5 points. Tally strikes your name.', anim: 'loss' });
    expect(royaleBanner([at(5, 1)], 0)!.line).toBe('1 point. Tally strikes your name.');
  });

  it('names the places 1st to 6th', () => {
    expect([1, 2, 3, 4, 5, 6].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '6th']);
  });
});
