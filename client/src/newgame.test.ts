import { describe, expect, it } from 'vitest';
import { CONFIRM_MS, newGameLabel, pressNewGame } from './newgame';

describe('pressNewGame', () => {
  it('starts the new game at the first press when no move was played: nothing to lose', () => {
    expect(pressNewGame(null, 1000, 0)).toEqual({ start: true, confirm: null });
  });

  it('asks for a confirmation for a few seconds once a move was played', () => {
    expect(CONFIRM_MS).toBeGreaterThanOrEqual(2000);
    expect(CONFIRM_MS).toBeLessThanOrEqual(5000);
    expect(pressNewGame(null, 1000, 1)).toEqual({ start: false, confirm: 1000 + CONFIRM_MS });
    expect(pressNewGame(null, 1000, 40)).toEqual({ start: false, confirm: 1000 + CONFIRM_MS });
  });

  it('starts the new game at a second press while the confirmation is asked', () => {
    const { confirm } = pressNewGame(null, 1000, 2);
    expect(pressNewGame(confirm, 1001, 2)).toEqual({ start: true, confirm: null });
    expect(pressNewGame(confirm, 1000 + CONFIRM_MS - 1, 2)).toEqual({ start: true, confirm: null });
  });

  it('asks again when the second press comes after the confirmation lapsed', () => {
    const { confirm } = pressNewGame(null, 1000, 2);
    const late = 1000 + CONFIRM_MS;
    expect(pressNewGame(confirm, late, 2)).toEqual({ start: false, confirm: late + CONFIRM_MS });
  });
});

describe('newGameLabel', () => {
  it('reads New game, and Confirm new game while the confirmation is asked', () => {
    expect(newGameLabel(null)).toBe('New game');
    expect(newGameLabel(pressNewGame(null, 0, 1).confirm)).toBe('Confirm new game');
  });
});
