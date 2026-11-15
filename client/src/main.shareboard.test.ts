// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Keys } from './moverecord';
import { boot } from './test/harness';

// The opt-in for the shared ranked board on the harness (#1287): asked at the first ranked entry, unticked, nothing sent.
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const shown = (): boolean => !byId('board-optin').hidden;
const key = (name: string, shiftKey = false): void =>
  void byId('board-optin').dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
const tick = (): void => {
  byId<HTMLInputElement>('optin-box').checked = true;
  byId('optin-box').dispatchEvent(new Event('change'));
};

describe('shared board opt-in', () => {
  it('asks at the first ranked entry, unticked, with the decided text; Join needs the tick and stores a choice, a name and a key', async () => {
    const game = await boot('?bot=off&board&net=hook');
    byId('ranked').click();
    await game.settle();
    expect(shown()).toBe(true);
    expect(byId('optin-text').textContent).toContain('public and permanent');
    expect(byId('optin-text').textContent).toContain('You must be 16 or older.');
    expect(byId<HTMLInputElement>('optin-box').checked).toBe(false);
    expect(byId<HTMLButtonElement>('optin-yes').disabled).toBe(true);
    expect(byId<HTMLAnchorElement>('optin-notice').href).toContain('docs/privacy.md');
    expect(document.activeElement).toBe(byId('optin-name'));
    byId<HTMLInputElement>('optin-name').value = 'x'.repeat(30);
    tick();
    expect(byId<HTMLButtonElement>('optin-yes').disabled).toBe(false);
    byId('optin-yes').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBeNull());
    expect(shown()).toBe(false);
    expect(JSON.parse(localStorage.getItem('ab-alone.board-consent')!)).toEqual({ v: 5, choice: 'joined' });
    expect(localStorage.getItem('ab-alone.board-name')).toHaveLength(16);
  });

  it('Escape leaves it unanswered and it asks again at the next entry; only Keep ranked local stores a decline', async () => {
    const game = await boot('?bot=off&board&net=hook');
    for (let again = 0; again < 2; again++) {
      byId('ranked').click();
      await game.settle();
      expect(shown()).toBe(true);
      key('Escape');
      await game.settle();
      expect(shown()).toBe(false);
      expect(localStorage.getItem('ab-alone.board-consent')).toBeNull();
    }
    byId('ranked').click();
    await game.settle();
    byId('optin-no').click();
    await game.settle();
    expect(JSON.parse(localStorage.getItem('ab-alone.board-consent')!)).toEqual({ v: 5, choice: 'declined' });
  });

  it('Keep ranked local stores a decline, and it is not asked again', async () => {
    const game = await boot('?bot=off&board&net=hook');
    for (const leave of [() => byId('optin-no').click()]) {
      localStorage.removeItem('ab-alone.board-consent');
      byId('ranked').click();
      await game.settle();
      expect(shown()).toBe(true);
      key('Tab');
      expect(document.activeElement).toBe(byId('optin-box'));
      key('Tab', true);
      expect(document.activeElement).toBe(byId('optin-name'));
      key('a');
      expect(shown()).toBe(true);
      leave();
      await game.settle();
      expect(shown()).toBe(false);
      expect(JSON.parse(localStorage.getItem('ab-alone.board-consent')!)).toEqual({ v: 5, choice: 'declined' });
      expect(localStorage.getItem('ab-alone.board-key')).toBeNull();
    }
    byId('ranked').click();
    await game.settle();
    expect(shown()).toBe(false);
  });

  it('the pad walks it: the D-pad stays inside the dialog', async () => {
    const game = await boot('?bot=off&board&net=hook');
    let pads: unknown[] = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
    const tap = (button: number): void => {
      for (const held of [[button], []]) {
        pads = [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })) }];
        game.frame();
      }
    };
    byId('ranked').click();
    await game.settle();
    tap(15);
    expect(byId('board-optin').contains(document.activeElement)).toBe(true);
    Reflect.deleteProperty(navigator, 'getGamepads');
    byId('optin-no').click();
  });

  it('is on by default, no flag needed: the leaderboard shows the join placeholder and no key is made before the join', async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const game = await boot('?bot=off&net=hook');
    byId('leaderboard').click();
    await game.settle();
    expect(byId('board-share').hidden).toBe(false);
    expect(byId('board-shared').textContent).toContain('Join the board');
    expect(byId('board').hidden).toBe(false);
    expect(FakeSocket.all).toHaveLength(0);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('ab-alone.board-'))).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('the board dialog joins, then New key changes the key and Leave the board stores a signed retire and clears the consent', async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const game = await boot('?bot=off&board');
    byId('leaderboard').click();
    expect(byId('board-share-state').textContent).toContain('not on the shared board');
    expect(byId('board-leave').hidden).toBe(true);
    byId('board-join').click();
    expect(shown()).toBe(true);
    byId<HTMLInputElement>('optin-name').value = 'Ada';
    tick();
    byId('optin-yes').click();
    await vi.waitFor(() => expect(byId('board-share-state').textContent).toContain('as "Ada"'));
    expect(byId('board-join').hidden).toBe(true);
    const first = localStorage.getItem('ab-alone.board-key');
    byId('board-newkey').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBe(first));
    byId('board-leave').click();
    await vi.waitFor(() => expect(byId('board-share-state').textContent).toContain('not on the shared board'));
    const retires = JSON.parse(localStorage.getItem('ab-alone.board-retire')!) as { v: number; events: { kind: string }[] };
    expect(retires.events).toHaveLength(2); // New key retired the first key, Leave the second
    expect(retires.events.map((e) => e.kind)).toEqual(["retire", "retire"]);
    expect((JSON.parse(localStorage.getItem('ab-alone.board-consent')!) as { choice: string }).choice).toBe('declined');
    expect(localStorage.getItem('ab-alone.board-key')).toBe(''); // Leave erases the key here
    vi.unstubAllGlobals();
  });

  it('joining, New key and Leave the board open no socket', async () => {
    const sockets = vi.fn();
    vi.stubGlobal('WebSocket', sockets);
    const game = await boot('?bot=off&board&net=hook');
    byId('ranked').click();
    await game.settle();
    tick();
    byId('optin-yes').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBeNull());
    byId('board-leave').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-retire')).not.toBeNull());
    expect(sockets).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('with ?board=publish, Leave the board and New key each send their retire to the two relays; plain ?board sent none above', async () => {
    const sent: string[] = [];
    class Sock {
      constructor(readonly url: string) { queueMicrotask(() => this.on.get('open')?.({})); }
      on = new Map<string, (e: { data?: string }) => void>();
      addEventListener(t: string, f: (e: { data?: string }) => void): void { this.on.set(t, f); }
      send(d: string): void { sent.push(d); }
      close(): void {}
    }
    vi.stubGlobal('WebSocket', Sock);
    const game = await boot('?bot=off&board=publish&net=hook');
    byId('ranked').click();
    await game.settle();
    tick();
    byId('optin-yes').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBeNull());
    byId('board-newkey').click();
    await vi.waitFor(() => expect(sent).toHaveLength(2)); // two relays now
    byId('board-leave').click();
    await vi.waitFor(() => expect(sent).toHaveLength(4));
    const events = sent.map((m) => (JSON.parse(m) as [string, { content: string }])[1].content);
    expect(sent.every((m) => m.startsWith('["EVENT"'))).toBe(true);
    expect(events.map((c) => (JSON.parse(c) as { kind: string }).kind)).toEqual(Array(4).fill('retire'));
    vi.unstubAllGlobals();
  });
  // The read side (#1287): behind ?board and after the opt-in, the board reads the three relays and shows the results the rules replay.
  class FakeSocket {
    static all: FakeSocket[] = [];
    sent: string[] = [];
    private on = new Map<string, ((e: { data?: string }) => void)[]>();
    constructor(readonly url: string) {
      FakeSocket.all.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type: string, fn: (e: { data?: string }) => void): void {
      this.on.set(type, [...(this.on.get(type) ?? []), fn]);
    }
    send(data: string): void {
      this.sent.push(data);
      if (data.startsWith('["REQ"')) queueMicrotask(() => FakeSocket.serve(this));
    }
    close(): void {}
    emit(type: string, data?: string): void {
      for (const fn of this.on.get(type) ?? []) fn({ data });
    }
    static serve: (s: FakeSocket) => void = () => {};
  }

  it('reads the three relays after the opt-in, shows the results the rules replay and drops the others, publishes nothing', async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const game = await boot('?bot=off&board&net=hook');
    const { Engine } = await import('edgefall-wasm');
    const engine = new Engine();
    const moves: number[][] = [];
    for (let i = 0; i < 400 && engine.status() === 0; i++) {
      const mv = engine.best_move(20);
      engine.play(mv);
      moves.push([...mv]);
    }
    const { generateKeys } = await import('./moverecord');
    const { signResult } = await import('./boardfeed');
    const [ka, ...opps] = (await Promise.all(Array.from({ length: 6 }, () => generateKeys()))) as [Keys, ...Keys[]];
    // Ann needs 5 distinct opponents to be ranked (MIN_OPPONENTS): five keys, the first one is Bob.
    const result = async (game: string, name: string, status: number, signedBy = true, kb: Keys = opps[0]!): Promise<string> => {
      const r = { v: 1 as const, game, black: { pub: ka.pub, name }, white: { pub: kb.pub, name: 'Bob' }, moves, status, ejected: [engine.ejected(1), engine.ejected(2)] as [number, number], ts: Math.floor(Date.now() / 1000) - 60 };
      return JSON.stringify({ ...r, sigs: signedBy ? { black: await signResult(ka, r), white: await signResult(kb, r) } : { black: 'x', white: 'y' } });
    };
    const lie = engine.status() === 1 ? 2 : 1;
    // 10 counted games (MIN_GAMES): each of the five opponents twice.
    const wins = await Promise.all(Array.from({ length: 10 }, (_, i) => result(`h${i}`, '<i>Ann</i>', engine.status(), true, opps[i % 5]!)));
    const contents = [...wins, await result('g2', 'Liar', lie), await result('g3', 'Unsigned', engine.status(), false)];
    FakeSocket.serve = (s) => {
      for (const content of contents) {
        s.emit('message', JSON.stringify(['EVENT', 'ab-board', { kind: 1, tags: [['t', 'ab-alone-ranked']], content }]));
      }
      s.emit('message', JSON.stringify(['EOSE', 'ab-board']));
    };
    byId('leaderboard').click();
    expect(FakeSocket.all).toHaveLength(0); // not joined: nothing is read
    expect(byId('board-shared').textContent).toContain('Join the board');
    byId('board-close').click();
    byId('ranked').click();
    await game.settle();
    tick();
    byId('optin-yes').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBeNull());
    byId('leaderboard').click();
    await vi.waitFor(() => expect(byId('board-shared').textContent).toContain('Ann'));
    expect(FakeSocket.all.map((s) => s.url)).toEqual(['wss://relay.piazza.today', 'wss://relay.bitmacro.cloud']);
    expect(byId('board-shared').textContent).toContain('<i>Ann</i>'); // as text
    expect(byId('board-shared').innerHTML).toContain('&lt;i&gt;');
    expect(byId('board-shared').textContent).not.toContain('Liar');
    expect(byId('board-shared').textContent).not.toContain('Unsigned');
    expect(byId('board-shared').hidden).toBe(false);
    for (const s of FakeSocket.all) expect(s.sent.map((m) => (JSON.parse(m) as string[])[0])).toEqual(['REQ', 'CLOSE']);
    // Opened again at once, only the last read is shown: the older answer comes back late and is dropped.
    byId('board-shared').textContent = '';
    byId('leaderboard').click();
    byId('leaderboard').click();
    await vi.waitFor(() => expect(byId('board-shared').textContent).toContain('Ann'));
    expect(byId('board-shared').querySelectorAll('tbody tr')).toHaveLength(1); // the opponents have met one key each: not ranked
    vi.unstubAllGlobals();
  });

  it('an answer of the version before is asked again: nothing is read from it', async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    localStorage.setItem('ab-alone.board-consent', JSON.stringify({ v: 3, choice: 'joined' }));
    const game = await boot('?bot=off&net=hook');
    byId('leaderboard').click();
    await game.settle();
    expect(FakeSocket.all).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('no relay is contacted before a current opt-in: not asked, declined, an older answer, or garbage', async () => {
    for (const saved of [null, { v: 4, choice: 'declined' }, { v: 1, choice: 'joined' }, { v: 2, choice: 'joined' }, { v: 3, choice: 'joined' }, 'garbage']) {
      FakeSocket.all = [];
      vi.stubGlobal('WebSocket', FakeSocket);
      localStorage.clear();
      if (saved) localStorage.setItem('ab-alone.board-consent', typeof saved === 'string' ? saved : JSON.stringify(saved));
      const game = await boot('?bot=off&board&net=hook');
      byId('leaderboard').click();
      await game.settle();
      expect(FakeSocket.all).toHaveLength(0);
      expect(byId('board-shared').textContent).toContain('Join the board');
      vi.unstubAllGlobals();
    }
  });

  it('says so when the relays cannot be read, instead of waiting for ever', async () => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.serve = (s) => s.emit('message', JSON.stringify(['EOSE', 'ab-board']));
    const game = await boot('?bot=off&board&net=hook');
    byId('ranked').click();
    await game.settle();
    tick();
    byId('optin-yes').click();
    await vi.waitFor(() => expect(localStorage.getItem('ab-alone.board-key')).not.toBeNull());
    const spies = ['importKey', 'generateKey'].map((m) => vi.spyOn(crypto.subtle, m as 'importKey').mockRejectedValue(new Error('no key')));
    byId('leaderboard').click();
    byId('leaderboard').click(); // opened again at once: the first read fails after the second began, and says nothing
    await vi.waitFor(() => expect(byId('board-shared').textContent).toBe('The relays could not be read.'));
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
