import { expect, test, type Page } from '@playwright/test';
import { openModes, lowTierOnCi } from './modes';
import { loseByRepetition } from './fight-end';
import { shot } from './shot';

lowTierOnCi();

// #1517, docs/specs/ui.md section "One door grammar": every mode is entered by a door (the Hub, the mode menu or a place of the world) and left
// by the same control, the first slot of the dock, `#exit`. Its label names where it leads: World when the player came from the world,
// otherwise Hub. The plain table and the Hub, the home of the game, have none: their first slot stays New game.
type Hooks = { __openworldFixture: (f: object) => void; __openworldEnemies: () => [number, number][] };
const body = (page: Page) => page.locator('body');
const firstSlot = (page: Page) => page.locator('#dock > button:visible').first();
const pick = async (page: Page, id: string): Promise<void> => {
  await openModes(page);
  await page.locator(id).click();
};
const hubShown = (page: Page) => expect(body(page)).toHaveAttribute('data-hub', /.+/);
/** The marble of the Hub stands beside the hot-seat table, so the table is one roll away. */
const besideTheTable = (page: Page) => page.addInitScript(() => localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [-1, 0], beaten: [] })));
/** From the Hub, rolls onto the hot-seat table: a game with the exit, New game, Hint and the rest in the dock. */
const rollOntoTable = async (page: Page): Promise<void> => {
  await page.evaluate(() => (window as any).__click(-1, -1));
  await expect(body(page)).not.toHaveAttribute('data-hub', /.*/);
};
const hubTable = async (page: Page): Promise<void> => {
  await pick(page, '#ship');
  await hubShown(page);
  await rollOntoTable(page);
};

/** The first slot is the exit, named `label`. */
async function exitIs(page: Page, label: string): Promise<void> {
  await expect(firstSlot(page)).toHaveAttribute('id', 'exit');
  await expect(firstSlot(page)).toHaveAttribute('data-label', label);
}

/** The cell of the first place or tower of `kind`, from the page. */
async function cellOf(page: Page, kind: 'tower' | 'town' | 'dungeon'): Promise<[number, number]> {
  const attr = kind === 'tower' ? 'data-openworld-lairs' : 'data-openworld-places';
  const listed = (await body(page).getAttribute(attr))!.split(' ');
  const cell = kind === 'tower' ? listed[0]! : listed.find((p) => p.startsWith(`${kind}:`))!.slice(kind.length + 1);
  return cell.split(',').map(Number) as [number, number];
}

/** The dock holds the exit first, and nothing in it clips, shrinks under 44 px or leaves the dock or the window. Gives the buttons shown. */
async function dockFits(page: Page): Promise<string[]> {
  await exitIs(page, 'Hub');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const dock = await page.evaluate(() => {
    const frame = document.getElementById('dock')!.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLElement>('#dock > button')].filter((b) => b.getClientRects().length > 0);
    return {
      inWindow: frame.left >= 0 && frame.top >= 0 && frame.right <= innerWidth && frame.bottom <= innerHeight,
      order: buttons.map((b) => b.id),
      small: buttons.filter((b) => b.getBoundingClientRect().width < 43.5 || b.getBoundingClientRect().height < 43.5).map((b) => b.id),
      clipped: buttons.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.id),
      outside: buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.right > frame.right + 0.5 || r.left < frame.left - 0.5 || r.bottom > frame.bottom + 0.5 || r.top < frame.top - 0.5; }).map((b) => b.id),
    };
  });
  expect(dock.order[0]).toBe('exit');
  expect(dock.order).toContain('modes');
  expect(dock.inWindow, `dock in window: ${dock.order}`).toBe(true);
  expect(dock.small, `${dock.order}`).toEqual([]);
  expect(dock.clipped, `${dock.order}`).toEqual([]);
  expect(dock.outside, `${dock.order}`).toEqual([]);
  return dock.order;
}

// The modes of the mode menu, from the plain table: each one's first slot is Hub, and a press lands on the Hub.
const MENU_MODES: [string, (page: Page) => Promise<void>, (page: Page) => Promise<void>][] = [
  ['Battle royale', (p) => pick(p, '#battle-royale'), (p) => expect(p.locator('#royale-hold')).toBeVisible()],
  ['Rogue-lite run', (p) => pick(p, '#roguelite'), (p) => expect(p.locator('#run-map')).toBeVisible()],
  ['Daily challenge', (p) => pick(p, '#daily'), (p) => expect(body(p)).toHaveAttribute('data-boss', /.+/)],
  ['Trainer', (p) => pick(p, '#trainer'), (p) => expect(body(p)).toHaveAttribute('data-trainer', /.+/)],
  [
    'Boss fight',
    async (p) => {
      await pick(p, '#boss-fight');
      await p.locator('#boss-list button').first().click();
    },
    (p) => expect(body(p)).toHaveAttribute('data-boss', /.+/),
  ],
  ['Open world', (p) => pick(p, '#openworld'), (p) => expect(body(p)).toHaveAttribute('data-openworld', /.+/)],
];

for (const [name, enter, shown] of MENU_MODES) {
  test(`${name} is left by the first slot of the dock, labelled Hub, #1517`, async ({ page }) => {
    await page.goto('./?bot=off&net=hook&hub=classic');
    await expect(page.locator('#hud')).toContainText('Black to move');
    await expect(firstSlot(page)).toHaveAttribute('id', 'new-game'); // the plain table has no exit
    await enter(page);
    await shown(page);
    await exitIs(page, 'Hub');
    await firstSlot(page).click();
    await hubShown(page);
    await expect(body(page)).not.toHaveAttribute('data-openworld', /.*/);
    await expect(firstSlot(page)).toHaveAttribute('id', 'new-game'); // the Hub is the home: no exit
  });
}

test('a table of a Hub door is left by the first slot, and the Hub puts the marble back on the door, #1517', async ({ page }) => {
  await besideTheTable(page);
  await page.goto('./?bot=off&net=hook&hub=classic');
  await pick(page, '#ship');
  await hubShown(page);
  await expect(firstSlot(page)).toHaveAttribute('id', 'new-game');
  await rollOntoTable(page);
  await exitIs(page, 'Hub');
  await firstSlot(page).click();
  await expect(body(page)).toHaveAttribute('data-hub', 'mess -1,-1'); // the marble on the door
});

const sizes = [
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'CI page', viewport: { width: 960, height: 540 }, touch: false },
];
for (const { name, viewport, touch } of sizes) {
  test.describe(name, () => {
    test.use({ viewport, isMobile: touch, hasTouch: touch });

    for (const [kind, shown] of [['town', 'data-hub'], ['dungeon', 'data-run'], ['tower', 'data-boss']] as const) {
      test(`a ${kind} of the world is left by the first slot, labelled World, and the hero is on the entrance cell, #1517`, async ({ page }) => {
        await page.goto('./?bot=off&openworld=7&hub=classic');
        await expect(body(page)).toHaveAttribute('data-openworld-at', '0,0');
        await exitIs(page, 'Hub'); // the world's own exit is in the same slot
        const [q, r] = await cellOf(page, kind);
        await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
        await page.keyboard.press('ArrowRight');
        await expect(body(page)).not.toHaveAttribute('data-openworld', /.*/);
        await expect(body(page)).toHaveAttribute(shown, /.+/);
        await exitIs(page, 'World');
        await page.mouse.click(5, 5); // a press skips the transition of the place to its end (#1519)
        await shot(page, { path: `test-results/door-${kind}-${viewport.width}.png` });
        await firstSlot(page).click();
        await expect(body(page)).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
        await exitIs(page, 'Hub');
      });
    }
  });
}

test('a lair fight with a ply played asks for a second press, labelled Sure?, as New game does; Back asks nothing, #1517', async ({ page }) => {
  await page.goto('./?bot=off&openworld=7&hub=classic');
  await expect(body(page)).toHaveAttribute('data-openworld-at', '0,0');
  const [q, r] = await cellOf(page, 'tower');
  await page.evaluate(([q, r]) => (window as unknown as Hooks).__openworldFixture({ hero: [q - 1, r], troop: [], enemies: [] }), [q!, r!]);
  await page.keyboard.press('ArrowRight');
  await expect(body(page)).toHaveAttribute('data-boss', /.+/);
  await page.mouse.click(5, 5); // a press skips the transition of the place to its end (#1519)
  await firstSlot(page).click(); // no ply played: nothing to lose, the first press leaves at once
  await expect(body(page)).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
  await page.keyboard.press('ArrowRight'); // back onto the tower
  await expect(body(page)).toHaveAttribute('data-boss', /.+/);
  await page.mouse.click(5, 5);
  const click = (a: number, b: number) => page.evaluate(([cq, cr]) => (window as any).__click(cq, cr), [a, b]);
  await click(0, 2);
  await click(0, 1); // the Echo's board, Black up one
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBeGreaterThan(0);
  await firstSlot(page).click();
  await expect(firstSlot(page)).toHaveAttribute('data-label', 'Sure?');
  await expect(firstSlot(page)).toHaveClass(/confirm/);
  await expect(body(page)).toHaveAttribute('data-boss', /.+/); // the fight is still there
  await firstSlot(page).click();
  await expect(body(page)).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
  await exitIs(page, 'Hub');
  await page.keyboard.press('ArrowRight');
  await expect(body(page)).toHaveAttribute('data-boss', /.+/);
  await page.mouse.click(5, 5);
  await click(0, 2);
  await click(0, 1);
  await expect.poll(() => page.evaluate(() => (window as any).__plies())).toBeGreaterThan(0);
  await page.goBack(); // Browser Back leaves with no question (ui.md 4.9)
  await expect(body(page)).toHaveAttribute('data-openworld-at', `${q! - 1},${r}`);
});

test('a wild fight is left by the first slot too: Flee, and the hero is back in the world, #1517', async ({ page }) => {
  await page.goto('./?openworld=3&nodes=200&hub=classic');
  await page.locator('canvas[aria-label="Edgefall board"]').waitFor();
  await expect(body(page)).toHaveAttribute('data-openworld-at', '0,0');
  const [q, r] = (await page.evaluate(() => (window as unknown as Hooks).__openworldEnemies()))[0]!;
  await page.evaluate((h) => (window as unknown as Hooks).__openworldFixture({ hero: h, troop: [] }), [q + 1, r]);
  await page.locator('#openworld-ask-fight').click(); // the wild marble asks first (#1662)
  await expect(body(page)).not.toHaveAttribute('data-openworld', /.*/);
  await expect(firstSlot(page)).toHaveAttribute('id', 'wild-flee');
  await firstSlot(page).click();
  await expect(body(page)).toHaveAttribute('data-openworld-at', `${q + 1},${r}`);
  await exitIs(page, 'Hub');
});

// The dock holds the exit and the slots it pushes along on a phone and on the CI page: nothing clips, nothing is under 44 px, nothing leaves the window.
for (const viewport of [{ width: 390, height: 844 }, { width: 960, height: 540 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });

    const sideways = viewport.height < 400; // a phone held sideways: its column scrolls under 390 px, only the world is measured
    const states: [(typeof MENU_MODES)[number], boolean][] = sideways ? [] : [[MENU_MODES[4]!, false], [MENU_MODES[4]!, true], [MENU_MODES[3]!, false], [MENU_MODES[2]!, false], [MENU_MODES[0]!, false], [['Hub door table', hubTable, hubTable], false]];
    for (const [[name, enter], lose] of states) {
      test(`the dock with the exit in ${name}${lose ? ' after a defeat' : ''} fits the window, clipped by nothing, #1517`, async ({ page }) => {
        await besideTheTable(page);
        await page.goto('./?bot=off&net=hook&hub=classic');
        await enter(page);
        if (lose) await loseByRepetition(page); // the first boss of the list is The Echo: Retry, Goal and the rest join the exit
        await dockFits(page);
        await shot(page, { path: `test-results/door-dock-${name.replaceAll(' ', '-')}${lose ? '-lost' : ''}-${viewport.width}.png` });
      });
    }

    // The column of a phone held sideways scrolls from six buttons on (thumb-dock.md section 2): the seventh is measured where it fits.
    if (!sideways) test('the dock with the exit holds the seventh button, Auto-play, at the table of the bot, #1517', async ({ page }) => {
      await besideTheTable(page);
      await page.goto('./?net=hook&hub=classic'); // the bot plays: Auto-play joins
      await pick(page, '#ship');
      await hubShown(page);
      await page.evaluate(() => (window as any).__click(-2, 0)); // the bot's table
      await expect(body(page)).not.toHaveAttribute('data-hub', /.*/);
      expect(await dockFits(page)).toContain('auto-play');
      await shot(page, { path: `test-results/door-dock-bot-table-${viewport.width}.png` });
    });

    test('the dock in the world is the exit alone, clear of the stick, the plate and the map button, #1517', async ({ page }) => {
      await page.goto('./?bot=off&openworld=7&hub=classic');
      await expect(body(page)).toHaveAttribute('data-openworld-at', '0,0');
      await exitIs(page, 'Hub');
      expect(await page.locator('#dock > button:visible').count()).toBe(1);
      const exit = (await page.locator('#exit').boundingBox())!;
      expect(exit.width).toBeGreaterThanOrEqual(44);
      expect(exit.height).toBeGreaterThanOrEqual(44);
      expect(exit.x + exit.width).toBeLessThanOrEqual(viewport.width);
      expect(exit.y + exit.height).toBeLessThanOrEqual(viewport.height);
      expect(exit.x).toBeGreaterThan(viewport.width / 2); // not in the stick's half
      for (const selector of ['#openworld-hud', '#openworld-chip', '#settings', '#openworld-map-button', '#openworld-minimap']) {
        const other = await page.locator(selector).boundingBox();
        if (!other) continue;
        const apart = exit.x + exit.width <= other.x || other.x + other.width <= exit.x || exit.y + exit.height <= other.y || other.y + other.height <= exit.y;
        expect(apart, selector).toBe(true);
      }
      await shot(page, { path: `test-results/door-world-${viewport.width}.png` });
    });
  });
}

for (const [from, start] of [['the plain table', async (_p: Page) => undefined], ['the Hub', async (p: Page) => { await pick(p, '#ship'); await hubShown(p); }]] as const) {
  test(`Escape in the Open world presses the exit and lands in the Hub, opened from ${from}, #1605`, async ({ page }) => {
    await page.goto('./?bot=off&net=hook&hub=classic');
    await expect(page.locator('#hud')).toContainText('Black to move');
    await start(page);
    await pick(page, '#openworld');
    await expect(body(page)).toHaveAttribute('data-openworld', /.+/);
    await page.keyboard.press('Escape');
    await hubShown(page);
    await expect(body(page)).not.toHaveAttribute('data-openworld', /.*/);
    await expect(firstSlot(page)).toHaveAttribute('id', 'new-game'); // the Hub is the home
  });
}
