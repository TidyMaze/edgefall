import { describe, expect, it } from 'vitest';
import { AUTO_DELAY_MS, RUN_AUTO_WARNING, autoPlayState } from './autoplay';

describe('autoPlayState, #792', () => {
  it('is on offer in a local game, a battle royale or hot-seat: online is not a mode of its own', () => {
    expect(autoPlayState({ online: false, boss: null }, false)).toEqual({ shown: true, reason: null });
  });

  it('is never shown online, a versus room or a co-op fight', () => {
    expect(autoPlayState({ online: true, boss: null }, true)).toEqual({ shown: false });
    expect(autoPlayState({ online: true, boss: 'The Echo' }, true)).toEqual({ shown: false });
  });

  it('is on offer in a boss fight once the boss medal is earned', () => {
    expect(autoPlayState({ online: false, boss: 'The Echo' }, true)).toEqual({ shown: true, reason: null });
  });

  it('is greyed with the reason in a boss fight without the boss medal', () => {
    expect(autoPlayState({ online: false, boss: 'The Echo' }, false)).toEqual({
      shown: true,
      reason: 'Beat The Echo once to unlock Auto-play against it',
    });
  });

  it('is greyed in the Trainer: the score is the player\'s own, #1159', () => {
    expect(autoPlayState({ online: false, boss: null, trainer: true }, false)).toEqual({ shown: true, reason: 'Not in the Trainer' });
  });

  it('warns in a run what Auto-play and leaving cost, #1675', () => {
    expect(autoPlayState({ online: false, boss: null, run: true }, false)).toEqual({ shown: true, reason: null, warn: RUN_AUTO_WARNING });
    expect(RUN_AUTO_WARNING).toMatch(/Daily.*draw.*Hub/);
    expect(autoPlayState({ online: false, boss: 'The Echo', run: true }, false)).toMatchObject({ reason: expect.stringContaining('Beat') });
  });

  it('plays one move per short delay', () => {
    expect(AUTO_DELAY_MS).toBeGreaterThan(0);
    expect(AUTO_DELAY_MS).toBeLessThanOrEqual(1000);
  });
});
