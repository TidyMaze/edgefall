// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import page from '../index.html?raw';
import { BOT_BUTTON, BOT_OFFER_MS, SWITCH_LINE, botGameOf, lobbyState, lobbyWaitMs } from './lobby';

describe('lobbyState (#1529)', () => {
  it('waits under 20 s with no peer', () => {
    expect(lobbyState(0, 0)).toBe('wait');
    expect(lobbyState(BOT_OFFER_MS - 1, 0)).toBe('wait');
  });

  it('offers the bot at 20 s with no peer, and after', () => {
    expect(BOT_OFFER_MS).toBe(20000);
    expect(lobbyState(BOT_OFFER_MS, 0)).toBe('offer');
    expect(lobbyState(BOT_OFFER_MS + 5000, 0)).toBe('offer');
  });

  it('a peer in the room means no offer, before or after the wait', () => {
    expect(lobbyState(0, 1)).toBe('joined');
    expect(lobbyState(BOT_OFFER_MS, 1)).toBe('joined');
  });

  it('takes the wait from its argument, the test hook shortens it', () => {
    expect(lobbyState(80, 0, 80)).toBe('offer');
    expect(lobbyState(79, 0, 80)).toBe('wait');
  });
});

describe('lobbyWaitMs (#1529)', () => {
  it('is 20 s for a player, whatever the URL says', () => {
    expect(lobbyWaitMs('?lobbywait=80', false)).toBe(20000);
  });

  it('is the lobbywait parameter under navigator.webdriver, an integer of at least 50 ms', () => {
    expect(lobbyWaitMs('?lobbywait=80', true)).toBe(80);
    expect(lobbyWaitMs('?lobbywait=49', true)).toBe(20000);
    expect(lobbyWaitMs('?lobbywait=1.5', true)).toBe(20000);
    expect(lobbyWaitMs('?lobbywait=abc', true)).toBe(20000);
    expect(lobbyWaitMs('', true)).toBe(20000);
  });
});

describe('botGameOf (#1529)', () => {
  it('is a table for Play online and Ranked, which have no boss', () => {
    expect(botGameOf(null)).toBeNull();
  });

  it('is the same boss and seed for Fight together and Boss duel', () => {
    const fight = { id: 'echo', seed: 7, mirror: true };
    expect(botGameOf(fight)).toEqual({ id: 'echo', seed: 7 });
  });
});

describe('the lobby texts (#1529)', () => {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  const text = (id: string): string | null | undefined => doc.getElementById(id)?.textContent;

  it('the offer is one button, Play the bot while you wait', () => {
    expect(BOT_BUTTON).toBe('Play the bot while you wait');
    expect([...doc.getElementById('lobby-offer')!.children].map((el) => el.id)).toEqual(['lobby-bot']);
    expect(text('lobby-bot')).toBe(BOT_BUTTON);
  });

  it('the switch line is a button of the HUD column, hidden until a peer joins', () => {
    expect(SWITCH_LINE).toBe('A player joined the room: switch to it');
    expect(text('room-switch')).toBe(SWITCH_LINE);
    expect(doc.getElementById('room-switch')!.hidden).toBe(true);
    expect(doc.getElementById('room-switch')!.parentElement!.id).toBe('chrome');
  });
});
