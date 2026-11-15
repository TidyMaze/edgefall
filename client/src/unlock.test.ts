// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { firstWon, existingPlayer, LOCK_BANNER, LOCK_NOTE, isLocked, markFirstWin, paintLocks, doorLocked, firstWinGame, LOCKED_IDS, LOCK_LINE, LOCK_SHORT, UNLOCK_CARD, SHIP_UNLOCK_TEXT, LOCKED_BAY_LINE } from './unlock';
import type { Store } from './quality';

// The first-win lock (#1665, docs/specs/ui.md section 4.10): a new player plays the normal game first; the modes unlock after the first win.
const memory = (items: Record<string, string> = {}): Store => ({ getItem: (k) => items[k] ?? null, setItem: (k, v) => void (items[k] = v) });

describe('the first-win flag', () => {
  it('is off on a fresh profile, set by markFirstWin, and off when the storage is blocked', () => {
    const store = memory();
    expect(firstWon(store)).toBe(false);
    markFirstWin(store);
    expect(store!.getItem('ab-alone.firstwin')).toBe('1');
    expect(firstWon(store)).toBe(true);
    expect(firstWon(null)).toBe(false);
  });
});

/** A store that lists its keys, as localStorage does. */
const listed = (items: Record<string, string> = {}): Store => ({ getItem: (k) => items[k] ?? null, setItem: (k, v) => void (items[k] = v), get length() { return Object.keys(items).length; }, key: (i: number) => Object.keys(items)[i] ?? null }) as Store;

describe('every signal of play unlocks an existing player, listed or not', () => {
  const SIGNALS: [string, string][] = [
    ['ab-alone.boss-tally', '{"echo":{"won":1,"lost":2}}'],
    ['ab-alone.story', '2'],
    ['ab-alone.roguelite.history', '[{"seed":123456,"floor":4,"won":false}]'],
    ['ab-alone.roguelite.daily', '2026-11-13'],
    ['ab-alone.roguelite.seen', '["thorn","glass"]'],
    ['ab-alone.ranked.board', '[{"name":"Mira","rating":1215}]'],
    ['ab-alone.ranked.rivals', '[{"name":"Tobias","rating":1180}]'],
    ['ab-alone.world-key', '{"pub":"mkTc6xq3q8e0j6pQ9wz1G4yH7Kd2n5RvB8sLaUfXoYE","priv":"jwk"}'],
    ['ab-alone.world-events', '[{"seed":7,"at":"2026-11-12"}]'],
    ['ab-alone.board-name', 'Mira'],
    ['ab-alone.public-name', 'Mira'],
  ];
  it.each(SIGNALS)('%s', (key, value) => {
    expect(existingPlayer(memory({ [key]: value }), false, 0)).toBe(true);
    expect(existingPlayer(listed({ [key]: value }), false, 0)).toBe(true);
  });
  it('reading the guide is not play: a guide-only profile stays locked, listed or not', () => {
    expect(existingPlayer(memory({ 'ab-alone.guide': 'seen' }), false, 0)).toBe(false);
    expect(existingPlayer(listed({ 'ab-alone.guide': 'seen' }), false, 0)).toBe(false);
  });
  it('any other ab-alone key counts when the store lists its keys', () => {
    expect(existingPlayer(listed({ 'ab-alone.tally': '1' }), false, 0)).toBe(true);
    expect(existingPlayer(listed({ 'ab-alone.light.bloom': 'on', 'someone.else': '1' }), false, 0)).toBe(false); // a key of another app is nobody's record
  });
  it('a cleared mark (an empty value, as ab-alone.wild at every boot) is no record', () => {
    expect(existingPlayer(listed({ 'ab-alone.wild': '' }), false, 0)).toBe(false);
  });
  it('a profile with only settings stays locked', () => {
    const settings = ['transcript', 'difficulty', 'palette', 'sound', 'theme', 'reduced-motion', 'tier', 'quality', 'clear-board', 'fps', 'shell-skin', 'glass-skin', 'safe-mode', 'ui-scale', 'flat-hud', 'hud-folded', 'board-zoom', 'steering', 'look', 'volume.music', 'volume.effects', 'light.lamps', 'light.bloom'];
    expect(existingPlayer(listed(Object.fromEntries(settings.map((k) => ['ab-alone.' + k, 'x']))), false, 0)).toBe(false);
    expect(existingPlayer(listed(), false, 0)).toBe(false);
    expect(existingPlayer(null, false, 0)).toBe(false);
  });
});

describe('an existing player is unlocked at once', () => {
  it('a fresh profile is not one', () => expect(existingPlayer(memory(), false, 0)).toBe(false));
  it.each([
    ['the first-win flag', { 'ab-alone.firstwin': '1' }, false, 0],
    ['a boss beaten', {}, false, 1],
    ['a saved game, run or world', {}, true, 0],
    ['the first run done', { 'ab-alone.firstrun': 'done' }, false, 0],
    ['a daily record', { 'ab-alone.daily': '{"2026-11-13":{"attempts":1,"result":"won","turns":12}}' }, false, 0],
    ['a daily day', { 'ab-alone.daily-days': '["2026-11-12","2026-11-13"]' }, false, 0],
    ['a rating record', { 'ab-alone.ranked': '{"rating":1215,"matches":[{"won":true,"foe":1180}]}' }, false, 0],
    ['a run history', { 'ab-alone.roguelite': '{"seed":123456,"floor":4}' }, false, 0],
    ['a run ascension', { 'ab-alone.roguelite.ascension': '2' }, false, 0],
    ['a run rune', { 'ab-alone.roguelite.runes': '["thorn","glass"]' }, false, 0],
  ])('%s', (_, items, saved, beaten) => expect(existingPlayer(memory(items), saved, beaten)).toBe(true));
});

describe('the lock', () => {
  it('locks a fresh player on the plain URL, and an automated page only with ?newplayer', () => {
    expect(isLocked('', false, false)).toBe(true);
    expect(isLocked('?bot=off', false, false)).toBe(true);
    expect(isLocked('', true, false)).toBe(false);
    expect(isLocked('?newplayer', true, false)).toBe(true);
    expect(isLocked('?locks', true, false)).toBe(false); // the boss list's hook keeps its meaning
  });
  it('never locks an existing player, and ?unlock opens it', () => {
    expect(isLocked('', false, true)).toBe(false);
    expect(isLocked('?newplayer', true, true)).toBe(false);
    expect(isLocked('?unlock', false, false)).toBe(false);
    expect(isLocked('?newplayer&unlock', true, false)).toBe(false);
  });
  it('names the Hub doors that wait for the first win and none of the tables', () => {
    for (const kind of ['boss', 'daily', 'run', 'together', 'ranked', 'world', 'trainer', 'royale']) expect(doorLocked(kind), kind).toBe(true);
    for (const kind of ['bot', 'hotseat', 'online', 'terminal', 'medals', 'lift']) expect(doorLocked(kind), kind).toBe(false);
  });
});

describe('the menu render of a locked entry', () => {
  const menu = (): void => {
    document.body.innerHTML = [...LOCKED_IDS, 'play-online', 'new-game'].map((id) => `<button id="${id}"></button>`).join('') + '<p id="lock-banner"></p><p id="lock-note"></p>';
  };
  it('dims every locked entry with aria-disabled, data-locked and both lines, and leaves the others', () => {
    menu();
    paintLocks(document, true);
    for (const id of LOCKED_IDS) {
      const el = document.getElementById(id)!;
      expect(el.getAttribute('aria-disabled'), id).toBe('true');
      expect(el.dataset.locked, id).toBe(LOCK_LINE);
      expect(el.dataset.lockShort, id).toBe(LOCK_SHORT);
    }
    for (const id of ['play-online', 'new-game']) expect(document.getElementById(id)!.hasAttribute('aria-disabled'), id).toBe(false);
    expect(LOCK_LINE).toBe('Win your first game to unlock');
    expect(LOCK_SHORT).toBe('Win 1st game');
    expect(LOCKED_IDS).toEqual(expect.arrayContaining(['openworld', 'boss-fight', 'roguelite', 'daily', 'battle-royale', 'ranked', 'leaderboard', 'fight-together', 'boss-duel', 'ship', 'trainer']));
    expect(LOCKED_IDS).not.toContain('play-online');
  });
  it('shows the banner and the note while locked, hides them when unlocked', () => {
    menu();
    paintLocks(document, true);
    expect(document.getElementById('lock-banner')!.hidden).toBe(false);
    expect(document.getElementById('lock-note')!.hidden).toBe(false);
    paintLocks(document, false);
    expect(document.getElementById('lock-banner')!.hidden).toBe(true);
    expect(document.getElementById('lock-note')!.hidden).toBe(true);
    expect(LOCK_BANNER).toBe('Win your first game vs the bot');
    expect(LOCK_NOTE).toBe('More unlocks after your first win');
  });
  it('lifts the look when unlocked', () => {
    menu();
    paintLocks(document, true);
    paintLocks(document, false);
    for (const id of LOCKED_IDS) {
      const el = document.getElementById(id)!;
      expect(el.hasAttribute('aria-disabled'), id).toBe(false);
      expect(el.dataset.locked, id).toBeUndefined();
    }
  });
});

describe('which game over is the first win', () => {
  const bot = { bot: true, fight: false, run: false, trainer: false, online: false, wild: false, replaying: false };
  it('is a win against the bot, and only that', () => {
    expect(firstWinGame('win', bot)).toBe(true);
    for (const anim of ['loss', 'draw', undefined]) expect(firstWinGame(anim, bot), String(anim)).toBe(false);
    expect(firstWinGame('win', { ...bot, bot: false })).toBe(false); // a hot seat
    for (const mode of ['fight', 'run', 'trainer', 'online', 'wild', 'replaying'] as const) expect(firstWinGame('win', { ...bot, [mode]: true }), mode).toBe(false);
  });
});

describe('the unlock card', () => {
  it('says what opened', () => {
    expect(UNLOCK_CARD.title).toBe('You won.');
    expect(UNLOCK_CARD.text).toBe('Unlocked: Open world, Bosses, Runs, Daily, Royale, Ranked, Leaderboard');
  });
});

describe('the unlock card on the ship (#1692)', () => {
  it('names the Mess and the next goal, and a locked bay says why', () => {
    expect(SHIP_UNLOCK_TEXT('The Echo')).toBe('The Mess is open. Next: beat The Echo.');
    expect(SHIP_UNLOCK_TEXT(null)).toBe('The Mess is open.');
    expect(LOCKED_BAY_LINE).toMatch(/locked.*first win/i);
  });
});
