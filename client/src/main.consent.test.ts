// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { boot } from './test/harness';

// The online opt-in on the harness (#1338): every online entry asks first, nothing starts before Accept.
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const shown = (): boolean => !byId('consent').hidden;
const consentInside = (el: Element | null): boolean => byId('consent').contains(el);
const key = (name: string, shiftKey = false): void =>
  void byId('consent').dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));

describe('online consent dialog', () => {
  it('asks before Play online, shows the decided text and the notice link, and starts nothing until Accept', async () => {
    const game = await boot('?bot=off&consent');
    byId('play-online').click();
    await game.settle();
    expect(shown()).toBe(true);
    expect(byId('consent-text').textContent).toContain('I am 16 or older.');
    expect(byId<HTMLAnchorElement>('consent-notice').href).toContain('docs/privacy.md');
    expect(game.peer()).toBeNull();
    expect(document.activeElement).toBe(byId('consent-accept'));
    byId('consent-accept').click();
    await game.online();
    expect(shown()).toBe(false);
    expect(localStorage.getItem('ab-alone.online-consent')).toBe('accepted');
    expect(game.peer()).not.toBeNull();
  });

  it('keeps solo play on Stay solo and on Escape, and does not store the refusal', async () => {
    const game = await boot('?bot=off&consent');
    for (const leave of [() => byId('consent-stay').click(), () => key('Escape')]) {
      byId('play-online').click();
      await game.settle();
      expect(shown()).toBe(true);
      leave();
      await game.settle();
      expect(shown()).toBe(false);
      expect(game.peer()).toBeNull();
      expect(document.body.dataset.online).toBeUndefined();
    }
    expect(localStorage.getItem('ab-alone.online-consent')).toBeNull();
  });

  it('asks before the Battle royale and before an invite link, and a refusal drops the link', async () => {
    const royale = await boot('?bot=off&consent');
    byId('royale-invite').click();
    await royale.settle();
    expect(shown()).toBe(true);
    byId('consent-stay').click();
    await royale.settle();
    expect(royale.peer()).toBeNull();

    const invited = await boot('?bot=off&consent#room=abcd1234');
    await invited.settle();
    expect(shown()).toBe(true);
    expect(invited.peer()).toBeNull();
    byId('consent-stay').click();
    await invited.settle();
    expect(location.hash).toBe('');
    expect(invited.peer()).toBeNull();
  });

  it('keeps the focus inside on Tab and waits on one answer for two entries', async () => {
    const game = await boot('?bot=off&consent');
    byId('play-online').click();
    byId('royale-invite').click();
    await game.settle();
    key('Tab');
    expect(document.activeElement).toBe(byId('consent-notice'));
    key('Tab', true);
    expect(document.activeElement).toBe(byId('consent-accept'));
    key('a'); // another key does nothing
    expect(shown()).toBe(true);
    byId('consent-stay').click();
    await game.settle();
    expect(shown()).toBe(false);
  });

  it('the pad walks it: the D-pad stays inside the dialog and Start does not open the settings', async () => {
    const game = await boot('?bot=off&consent');
    let pads: unknown[] = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
    const tap = (button: number): void => {
      for (const held of [[button], []]) {
        pads = [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })) }];
        game.frame();
      }
    };
    byId('play-online').click();
    await game.settle();
    tap(15);
    expect(consentInside(document.activeElement)).toBe(true);
    tap(9);
    expect(byId('settings-menu').hidden).toBe(true);
    Reflect.deleteProperty(navigator, 'getGamepads');
    byId('consent-stay').click();
  });

  it('does not ask again once accepted, nor under ?net=hook, nor under automation without ?consent', async () => {
    const accepted = await boot('?bot=off&consent');
    localStorage.setItem('ab-alone.online-consent', 'accepted');
    byId('play-online').click();
    await accepted.online();
    expect(shown()).toBe(false);

    const hook = await boot('?bot=off&consent&net=hook');
    byId('play-online').click();
    await hook.settle();
    expect(shown()).toBe(false);

    const automated = await boot('?bot=off');
    byId('play-online').click();
    await automated.online();
    expect(shown()).toBe(false);
  });
});
