import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { parseRecorded } from '../src/test/chaplain-game';
import { BLACK_WINS } from './end-games';
import { loseByRepetition } from './fight-end';
import { openModes } from './modes';
import { logOf } from '../src/audiologs';
import { dailyFor, dailyTitle, utcDay } from '../src/daily';
import { BOSS_IDS } from '../src/tally';
import { shot } from './shot';
import { openAdvanced } from './settings';

// Bug #227: on a phone the button column covered the HUD plate and the board's top-right cells, and held
// upright the board was wider than the screen. In every state below no control covers the HUD plate or a
// cell, every control is on screen or can be scrolled into view, and a tap on any of the 61 cells reaches
// the board. Bug #234: held sideways the plate hid the board's top-left marbles, so the plate covers no
// cell either. The evaluation plate (#191) is checked like a control: it lets taps through, so it would
// hide a cell without missing a tap. So is the transcript of an audio log (#516).

// What is wrong on the page right now, as readable lines: an empty list is a good layout.
const problems = (page: Page) =>
  page.evaluate(() => {
    type Box = { left: number; top: number; right: number; bottom: number };
    const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const onScreen = (b: Box) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
    const toScreen = (q: number, r: number) => (window as any).__cellToScreen(q, r) as { x: number; y: number };
    const cells: { name: string; centre: { x: number; y: number }; disc: Box }[] = [];
    for (let r = -4; r <= 4; r++) {
      for (let q = Math.max(-4, -4 - r); q <= Math.min(4, 4 - r); q++) {
        const p = toScreen(q, r);
        const east = toScreen(q + 1, r);
        const radius = 0.46 * Math.hypot(east.x - p.x, east.y - p.y); // the disc radius is 0.46, cells are 1 apart
        const disc = { left: p.x - radius, top: p.y - radius, right: p.x + radius, bottom: p.y + radius };
        cells.push({ name: `cell ${q},${r}`, centre: p, disc });
      }
    }
    const hud = document.getElementById('hud')!.getBoundingClientRect();
    const found: string[] = [];
    for (const c of cells) if (meets(hud, c.disc)) found.push(`the HUD covers ${c.name}`);
    const plates: Record<string, string> = { eval: 'the evaluation plate', transcript: 'the transcript', lore: 'the lore of a win' };
    for (const el of document.querySelectorAll('button, input, label, textarea, select, #eval, #transcript, #lore')) {
      if (el.getClientRects().length === 0) continue; // hidden
      const name = plates[el.id] ?? (el.textContent || el.getAttribute('aria-label')!);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // a scrolling column brings it into view
      const box = el.getBoundingClientRect();
      if (el.id !== 'hud-fold' && !el.closest('#hud') && meets(box, hud)) found.push(`${name} covers the HUD`); // its own fold button (#957), and the legend lines of a rogue-lite fight (#1541) are on the plate
      if (!onScreen(box)) found.push(`${name} is off screen`);
      const sheeted = el.closest('#mode-menu, #daily-card, #lobby-sheet, #lore') != null; // #1032 #1488 #1589: a sheet above the dock (the open Lobby too) may lie over the board's lower cells
      if (!sheeted) for (const c of cells) if (meets(box, c.disc)) found.push(`${name} covers ${c.name}`);
    }
    // The plates let taps through, so they must not lie over a control either, or they hide it.
    for (const [id, name] of Object.entries(plates)) {
      const plate = document.getElementById(id)!;
      if (plate.getClientRects().length === 0) continue; // hidden
      for (const el of document.querySelectorAll('button, input, label, textarea, select, #eval')) {
        if (el === plate || el.getClientRects().length === 0) continue; // itself, or hidden
        if (el.closest('#settings-menu')) continue; // the open settings menu floats over the plates too (#277)
        if (meets(plate.getBoundingClientRect(), el.getBoundingClientRect())) {
          found.push(`${name} covers ${plates[el.id] ?? (el.textContent || el.getAttribute('aria-label'))}`);
        }
      }
    }
    // #1032: the Game modes sheet and the daily result card are sheets above the thumb dock; an open one may lie over
    // the board's lower cells (spec section 3), so only a cell under the sheet is let through, never off screen.
    const sheet = (el: Element | null) => el?.closest('#mode-menu, #daily-card, #lobby-sheet') != null;
    for (const c of cells) {
      if (!onScreen(c.disc)) found.push(`${c.name} is off screen`);
      else if (document.elementFromPoint(c.centre.x, c.centre.y)?.tagName !== 'CANVAS' && !sheet(document.elementFromPoint(c.centre.x, c.centre.y))) found.push(`a tap on ${c.name} misses the board`);
    }
    return found;
  });

// The camera matrices are updated on a rendered frame.
const frame = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// A real mouse click on the cog, after checking the cog is the element under the pointer (what Playwright's click checks).
// Playwright's click waits for the page to paint twice before and after, each wait a frame of software WebGL (#349).
const tapCog = async (page: Page) => {
  const cog = page.getByRole('button', { name: 'Settings' });
  const { x, y, hit, cover } = await cog.evaluate((el) => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // as Playwright's click does before it taps
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const cover = top && { tag: top.tagName, id: top.id, cls: String(top.className), rect: top.getBoundingClientRect().toJSON(), cog: r.toJSON() };
    return { x, y, hit: el.contains(top), cover };
  });
  expect(hit, `the settings cog is not covered by ${JSON.stringify(cover)}`).toBe(true);
  await page.mouse.click(x, y);
};

const check = async (page: Page, testInfo: TestInfo, state: string) => {
  await frame(page);
  await shot(page, { path: testInfo.outputPath(`${state.replaceAll(' ', '-')}.jpg`), type: 'jpeg', quality: 70 });
  expect(await problems(page), state).toEqual([]);
  // The same check with the settings menu open (#277): the cog and the menu cover no cell, marble or target.
  await tapCog(page);
  await expect(page.getByRole('button', { name: 'Clear board' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound' })).toBeVisible();
  await frame(page);
  // The user's choice: the light sliders are rows of the open menu, which may lie over cells; it stays on screen.
  const open = (await problems(page)).filter((p) => !/ covers cell |^a tap on cell /.test(p));
  expect(open, `${state}, settings menu open`).toEqual([]);
  // On a touch screen every item of the open menu is a touch target of at least 44 px (#287).
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('#settings-menu button')]
      .filter((el) => navigator.maxTouchPoints > 0 && el.getClientRects().length > 0)
      .filter((el) => el.getBoundingClientRect().width < 44 || el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent || el.getAttribute('aria-label')),
  );
  expect(small, `${state}, settings menu open, under 44 px`).toEqual([]);
  // Every item shows its label at every window size (#1566, it was its icon only held upright or in a small window, #414); each
  // keeps its name too, for screen readers and as a tooltip.
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('#settings-menu button')]
      .filter((el) => el.getClientRects().length > 0 && el.querySelector('svg'))
      .map((el) => ({
        name: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        labelShown: el.querySelector('span')!.getClientRects().length > 0,
      })),
  );
  for (const item of items) {
    expect(item.name, `${state}, a settings item has a name`).toBeTruthy();
    expect(item.title, `${state}, ${item.name} has its name as a tooltip`).toBe(item.name);
    expect(item.labelShown, `${state}, ${item.name} shows its label`).toBe(true);
  }
  await tapCog(page);
  await expect(page.getByRole('button', { name: 'Clear board' })).toBeHidden();
};

// The volume page of the settings menu (#438): Sound shows the four sliders in place of the items; they cover no cell
// either, and on a touch screen each is a touch target of at least 44 px.
const checkVolumes = async (page: Page, state: string) => {
  await tapCog(page);
  await page.getByRole('button', { name: 'Sound' }).click();
  await expect(page.getByRole('slider', { name: 'Music' })).toBeVisible();
  await frame(page);
  // The page hangs under the cog like the menu (#1566): it may lie over cells, as the open menu does above, and over nothing else.
  const open = (await problems(page)).filter((p) => !/ covers cell |^a tap on cell /.test(p));
  expect(open, `${state}, volume sliders open`).toEqual([]);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('#settings-menu .setting-volume')]
      .filter((el) => navigator.maxTouchPoints > 0 && el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent),
  );
  expect(small, `${state}, volume sliders under 44 px`).toEqual([]);
  await tapCog(page);
  await expect(page.getByRole('slider', { name: 'Music' })).toBeHidden();
};

// The parts of the daily result card (#196) that meet the Copy diagnostics button (#220), each scrolled into view
// first, as a scrolling column shows it.
const cardOverCorner = (page: Page) =>
  page.evaluate(() => {
    const corner = document.getElementById('copy-diagnostics')!.getBoundingClientRect();
    return ['daily-result', 'daily-copy'].filter((id) => {
      const el = document.getElementById(id)!;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const b = el.getBoundingClientRect();
      return b.left < corner.right && corner.left < b.right && b.top < corner.bottom && corner.top < b.bottom;
    });
  });

const sizes = [
  { name: 'a phone held upright', viewport: { width: 375, height: 812 }, mobile: true },
  // Bug #614: a common Android phone, narrower: the board sits higher and the open mode menu covered its top row.
  { name: 'a phone 360 px wide held upright', viewport: { width: 360, height: 780 }, mobile: true },
  { name: 'a phone held sideways', viewport: { width: 812, height: 375 }, mobile: true },
  { name: 'a desktop window', viewport: { width: 1280, height: 720 }, mobile: false },
  // Bug #246: the plate reached over the board's top-left edge in these medium windows.
  { name: 'a tablet held sideways', viewport: { width: 1024, height: 768 }, mobile: false },
  { name: 'a window 1000 by 720', viewport: { width: 1000, height: 720 }, mobile: false },
  { name: 'a window 1024 by 600', viewport: { width: 1024, height: 600 }, mobile: false },
];

// One page for the tests of a serial group tagged @one-page (#1481): booted once in its window, with `stored` in its localStorage.
const sharedPage = (viewport: { width: number; height: number }, mobile: boolean, stored: Record<string, string> = {}): (() => Page) => {
  let page: Page;
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }, testInfo) => {
    page = await (await browser.newContext({ ...testInfo.project.use, viewport, isMobile: mobile, hasTouch: mobile })).newPage();
    await page.addInitScript((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), stored);
    await page.goto('./?bot=off&net=hook');
    await page.locator('canvas').waitFor();
  });
  test.afterAll(async () => {
    await page.context().close();
  });
  return () => page;
};

// A phone 390 by 844 held upright, one page (#1481): the board at boot (#1387), then the Hub (#1388).
test.describe('a phone 390 by 844 held upright', { tag: '@one-page' }, () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no mobile emulation');
  const shared = sharedPage({ width: 390, height: 844 }, true);
  // #1387: a phone held upright shows the board at the middle of the window, clear of the thumb dock.
  test('the board is vertically centred above the dock, #1387', async () => {
    const page = shared();
    const seen = await page.evaluate(() => {
      const toScreen = (q: number, r: number) => (window as any).__cellToScreen(q, r) as { y: number };
      return { centre: toScreen(0, 0).y, bottom: toScreen(0, 4).y, dock: document.getElementById('dock')!.getBoundingClientRect().top, height: innerHeight };
    });
    expect(Math.abs(seen.centre - seen.height / 2)).toBeLessThan(0.05 * seen.height);
    expect(seen.bottom).toBeLessThan(seen.dock);
  });
  test('the rail and the Bosses strip sit under the cog and above the board, #1388', async () => {
    await hubUnderCog(shared(), { width: 390, height: 844 });
  });
});

// #1567: the closer view of the board (one tap, stored per device): the plate, the dock, the zoom button and the settings menu
// cover no cell at the two common phone sizes, and every cell is on the window.
for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  test.describe(`the closer board view on a phone ${viewport.width} by ${viewport.height} held upright`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    test('the HUD plate and the dock cover no cell, #1567', async ({ page }, testInfo) => {
      await page.addInitScript(() => localStorage.setItem('ab-alone.board-zoom', 'on'));
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await expect(page.locator('#hud')).toContainText('Black to move');
      await expect(page.getByRole('button', { name: 'Zoom the board' })).toHaveAttribute('aria-pressed', 'true');
      await check(page, testInfo, 'the closer board view');
    });
  });
}

// #1388: on the Hub, held upright, the five-section rail and the Bosses strip sit just under the plate and the cog, clear of the board.
// The 390 by 844 phone runs it on its shared page, above.
for (const viewport of [{ width: 360, height: 640 }]) {
  test.describe(`the Hub on a phone ${viewport.width} by ${viewport.height} held upright`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    test('the rail and the Bosses strip sit under the cog and above the board, #1388', async ({ page }) => {
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
      await hubUnderCog(page, viewport);
    });
  });
}
async function hubUnderCog(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await openModes(page);
  await page.getByRole('button', { name: 'Hub' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-hub', /^\w+ /);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const seen = await page.evaluate(() => {
    const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    const toScreen = (window as any).__cellToScreen as (q: number, r: number) => { y: number };
    let board = Infinity;
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (Math.abs(q + r) <= 3) board = Math.min(board, toScreen(q, r).y);
    return { cog: box('chrome').bottom, pips: box('hub-pips').top, pipsBottom: box('hub-pips').bottom, rail: box('hub-rail').top, railBottom: box('hub-rail').bottom, board };
  });
  console.log(`1388 ${viewport.width}x${viewport.height}`, JSON.stringify(seen));
  expect(seen.pips).toBeGreaterThanOrEqual(seen.cog); // under the plate and the cog,
  expect(seen.pips - seen.cog).toBeLessThan(24); // right under them,
  expect(seen.rail).toBeGreaterThanOrEqual(seen.pipsBottom); // the rail under the strip
  expect(seen.board).toBeGreaterThan(seen.railBottom);
  expect(seen.board).toBeGreaterThan(seen.pipsBottom);
}

// One page per window (#1481): a page boot is most of a test's time on the GPU-less runner, so the states below are reached one after the
// other on the same page, in this order, each by the game's own controls or a test hook, and each is still its own test. The group runs
// serially in one worker and on one CI shard (tag @one-page, scripts/shard-reporter.ts); a failure retries the whole group on a new page.
for (const { name, viewport, mobile } of sizes) {
  test.describe(name, { tag: '@one-page' }, () => {
    test.skip(({ browserName }) => mobile && browserName === 'firefox', 'Firefox has no mobile emulation');
    test.describe.configure({ mode: 'serial' });
    let page: Page;
    const turnAround = () => page.setViewportSize({ width: viewport.height, height: viewport.width });
    const turnBack = () => page.setViewportSize(viewport);
    const openBossList = async () => {
      await openModes(page);
      const fights = page.getByRole('button', { name: 'Boss fight' });
      if ((await fights.getAttribute('aria-expanded')) !== 'true') await fights.click();
    };

    // The page clock is installed at the boot (page.clock, as in newgame.spec.ts): the mode menu tests move it to a day and the audio
    // log pauses it, as on a page booted with it.
    test.beforeAll(async ({ browser }, testInfo) => {
      const context = await browser.newContext({ ...testInfo.project.use, viewport, isMobile: mobile, hasTouch: mobile });
      page = await context.newPage();
      await page.clock.install({ time: Date.parse('2026-10-23T08:00:00Z') });
      await page.goto('./?bot=off&net=hook');
      await page.locator('canvas').waitFor();
    });
    test.afterAll(async () => {
      await page.context().close();
    });

    test('nothing covers the board or the HUD at the start, bugs #227 #234', async ({}, testInfo) => {
      const hud = page.locator('#hud');
      await expect(hud).toContainText('Black to move');
      // The plate stays top-left, 16 px from the edges (docs/specs/ui.md section 4).
      expect(await hud.boundingBox()).toMatchObject({ x: 16, y: 16 });
      await check(page, testInfo, 'at the start');
      await checkVolumes(page, 'at the start');
    });

    // #1032 (rewrites the #227 column): on a desktop the cog stays top right, and the main controls are a centred bar at
    // the bottom of the window, one row, the bar's bottom 16 px above the window's. A desktop window: CI's 960x540 is under the
    // short-window layout (#1436).
    if (!mobile && viewport.width === 1280 && viewport.height === 720)
      test('on a desktop the cog is top right and the controls form a centred bar at the bottom, bugs #227 #1032', async () => {
        await expect(page.locator('#hud')).toContainText('Black to move');
        const { width, height } = viewport;
        const cog = await page.getByRole('button', { name: 'Settings' }).boundingBox();
        expect(cog!.y).toBe(16);
        expect(cog!.x + cog!.width).toBeCloseTo(width - 16, 0);
        const boxes = await Promise.all(['New game', 'Hint', 'Game modes'].map((b) => page.getByRole('button', { name: b }).boundingBox()));
        for (const box of boxes) expect(box!.y + box!.height).toBeCloseTo(height - 16 - 8 - 1, 0); // the bar's content row
        const centre = boxes.reduce((a, b) => a + b!.x + b!.width / 2, 0) / boxes.length;
        expect(centre).toBeGreaterThan(width / 2 - 200);
        expect(centre).toBeLessThan(width / 2 + 200);
      });

    // The audio log player (#516): its transcript line and Skip log cover no cell, no control and not the HUD.
    // Bug #902: the transcript runs on the page clock, paused from Play log on and moved on to the second line, so a
    // slow frame loop never misses it; the clock flows again for the checks.
    test('nothing covers the board or the HUD while an audio log plays, #516 #902', async ({}, testInfo) => {
      await expect(page.locator('body')).toHaveAttribute('data-console', /^mess-house-rule /);
      await page.keyboard.press('t');
      const play = page.getByRole('button', { name: 'Play log' });
      await expect(play).toBeVisible();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000)); // a short jump: few frames to draw
      await play.click();
      await page.keyboard.press('Escape');
      const second = logOf('mess').lines[1]!;
      await page.clock.fastForward(second.at * 1000); // one frame paints the line due then
      await expect(page.locator('#transcript')).toHaveText(second.text);
      await page.clock.resume();
      await check(page, testInfo, 'while an audio log plays');
      await page.getByRole('button', { name: 'Skip log' }).click();
      await expect(page.locator('#transcript')).toBeHidden();
    });

    // The open mode menu (#357) with its boss list, its tallest state, covers no cell either. Bug #575: the Daily
    // challenge button names the boss of the day, so the menu's rows change with the date. The rows only depend on the
    // list and the widest label (bug #715): one check per boss list, on a day whose daily boss has the widest name, as
    // drawn in the button's font; main.boss.test.ts checks that every boss is named on its day. Bug #603: the boss list
    // of Fight together (#530) is checked too. The page clock moves to that day and the minute timer of the open page
    // renames the button, as it does at 00:00 UTC (bug #629).
    for (const list of ['Boss fight', 'Boss with a partner']) {
      test(`nothing covers the board or the HUD with the mode menu and the ${list} list open, widest daily boss, bugs #227 #234 #357 #575 #603 #715`, async ({}, testInfo) => {
        await openBossList();
        const names = await page.locator('#boss-list button').allTextContents(); // in the order of boss_ids()
        const widest = await page.evaluate(async (all) => {
          await document.fonts.ready;
          const g = document.createElement('canvas').getContext('2d')!;
          g.font = getComputedStyle(document.querySelector('#daily span')!).font;
          return all.reduce((a, b) => (g.measureText(b).width > g.measureText(a).width ? b : a));
        }, names);
        let ms = Date.UTC(2026, 9, 23);
        while (dailyFor(utcDay(ms), names).id !== widest) ms += 86_400_000;
        const day = utcDay(ms);
        await page.clock.setSystemTime(new Date(`${day}T08:00:00Z`));
        await page.clock.fastForward(60_000); // the minute timer fires once
        await expect(page.locator('#daily')).toHaveText(dailyTitle(day, widest));
        const button = page.getByRole('button', { name: list });
        if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click(); // closes the other list
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        // #666: the list holds every boss of the game (BOSS_IDS), so a new boss needs no layout change; bug #615 (one list open
        // at a time) is main.coop.test.ts.
        await expect(page.locator(list === 'Boss fight' ? '#boss-list' : '#coop-list').getByRole('button')).toHaveCount(BOSS_IDS.length);
        await expect(page.locator(list === 'Boss fight' ? '#coop-list' : '#boss-list')).toBeHidden();
        await check(page, testInfo, `with the mode menu and the ${list} list open, daily ${widest}`);
      });
    }

    test('nothing covers the board or the HUD in a boss fight, bugs #227 #234', async ({}, testInfo) => {
      await openBossList();
      await page.locator('#boss-list button').first().click();
      await expect(page.locator('#hud')).toContainText('P1');
      await check(page, testInfo, 'in a boss fight');
    });

    // The lore of a boss win (#1589) sits in the plate under the banner: the plate still covers no cell and no button. The recorded win of The
    // Swarm (fight seed 0) is played by the __playMoves hook.
    test('the lore of a boss win covers neither a cell nor a button, #1589', async ({}, testInfo) => {
      const plies = parseRecorded(readFileSync(new URL('../../crates/edgefall-core/tests/fixtures/swarm.txt', import.meta.url), 'utf8'));
      await page.evaluate(() => {
        crypto.getRandomValues = ((a: Uint32Array) => a.fill(0)) as typeof crypto.getRandomValues; // the fight seed
        localStorage.setItem('ab-alone.story', JSON.stringify({ moments: [2, 3], wins: 0 })); // stage 3 reaches The Swarm's entry (#1584)
      });
      await openBossList();
      await page.locator('#boss-list').getByRole('button', { name: 'The Swarm' }).click();
      await page.evaluate((records) => (window as any).__playMoves(records), plies);
      await expect(page.locator('#lore')).toBeVisible();
      await expect(page.locator('body')).toHaveAttribute('data-lore', 'boss-swarm');
      await check(page, testInfo, 'with the lore of a boss win');
    });

    test('nothing covers the board or the HUD in a rogue-lite fight with its legend and a card, #1540 #1541', async ({}, testInfo) => {
      const moves = [[1, 2, -4, 3, 0, 0, 0, 0], [2, 5, 0, -4, 1, -4, 0, 0]]; // no placement screen over the board
      await page.evaluate((m) => (window as any).__run({ seed: 3, army: 14, path: [0], fighting: true, moves: m, end: '', specials: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0], placed: [[-4, 4, 3], [0, 4, 9]], reward: false }), moves);
      await expect(page.locator('#hud button.special')).toHaveCount(2);
      await page.locator('#hud button.special').first().click();
      await expect(page.locator('#hud .special-card')).toBeVisible();
      await check(page, testInfo, 'in a rogue-lite fight with its legend');
    });

    // Upright, then turned around: the turn is a resize of the same page.
    test('the end banner covers neither a cell nor a button, nor turned around, #282', async ({}, testInfo) => {
      await page.locator('#import-file').setInputFiles({
        name: 'game.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ version: 1, mode: 'local', layout: 'standard', bot: true, moves: BLACK_WINS })),
      });
      await expect(page.locator('body')).toHaveAttribute('data-over', 'win');
      await expect(page.locator('#hud .end')).toContainText('The books balance');
      await check(page, testInfo, 'with the end banner');
      await turnAround();
      await check(page, testInfo, 'with the end banner turned around');
      await turnBack();
    });

    // The same defeat as the plate check of bug #271 (the plate and the buttons cover no cell after a daily defeat): the daily of
    // 2027-03-30 (e2e/fight-end.ts), the card checked upright, then the page turned around (a resize, no second fight).
    test('the daily result card covers neither the HUD nor the board, nor turned around, #196 #271', async ({}, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // the 7 moves of the defeat slide in no time: the layout is the same
      await page.clock.setSystemTime(new Date('2027-03-30T08:00:00Z'));
      await page.clock.fastForward(60_000); // the minute timer names the day's boss
      await openModes(page);
      await page.locator('#daily').click();
      await expect(page.locator('#hud')).toContainText('Daily challenge 2027-03-30 · attempt 1');
      await loseByRepetition(page);
      await expect(page.locator('#daily-card')).toBeVisible();
      await check(page, testInfo, 'with the daily result card');
      expect(await cardOverCorner(page), 'the card is clear of Copy diagnostics').toEqual([]);
      await turnAround();
      await check(page, testInfo, 'with the daily result card turned around');
      expect(await cardOverCorner(page), 'turned around, the card is clear of Copy diagnostics').toEqual([]);
      await turnBack();
    });

    // Last: the page stays in the online room.
    test('nothing covers the board or the HUD waiting for an opponent, turned around, bugs #227 #234', async ({}, testInfo) => {
      const hud = page.locator('#hud');
      await openModes(page);
      await page.getByRole('button', { name: 'Play online' }).click();
      await expect(hud).toContainText('Waiting for an opponent');
      // The invite link shows in the lobby sheet, open until the opponent connects (#1488, was shut: #1044).
      const lobby = page.getByRole('button', { name: 'Lobby' });
      await expect(lobby).toBeVisible();
      await expect(page.locator('#invite')).toBeVisible();
      await check(page, testInfo, 'waiting for an opponent');
      // The open sheet leaves a way out: Esc and the Lobby button close it, the board and the HUD stay as they were.
      await page.keyboard.press('Escape');
      await expect(page.locator('#invite')).toBeHidden();
      await check(page, testInfo, 'waiting for an opponent, lobby shut');
      await lobby.click();
      await expect(page.locator('#invite')).toBeVisible();
      await lobby.click();
      await expect(page.locator('#invite')).toBeHidden();
      await lobby.click();
      await expect(page.locator('#invite')).toBeVisible();

      // Turning the device around keeps the layout right.
      await turnAround();
      await check(page, testInfo, 'turned around');
    });
  });
}

// On a desktop the column stays where it was: top right, one button under the other.
// UI scale 200 % (#382): only a large desktop window has room for the HUD at 200 % (maxUiScale).
// One page (#1481): its settings rows (#427) are checked on it next.
test.describe('a large desktop window at a 200 % UI scale', { tag: '@one-page' }, () => {
  const shared = sharedPage({ width: 1920, height: 1080 }, false, { 'ab-alone.ui-scale': '200' });

  test('nothing covers the board or the HUD at a 200 % UI scale, #382', async ({}, testInfo) => {
    const page = shared();
    await expect(page.locator('#hud')).toContainText('Black to move');
    await check(page, testInfo, 'at 200 % UI scale, large desktop');
  });
  test('every settings row is on screen and reachable, a large desktop window at 200 % UI scale, bug #427', async () => {
    await settingsReachable(shared());
  });
});

// Bug #427: the open settings menu was clipped by the column it sits in at a 200 % UI scale (landscape), so Skin, Export
// game and Import game were hidden and the board took the click. Every row must be on screen and receive a click at its centre.
// The large desktop window at 200 % runs it on its shared page, above.
for (const { name, viewport, scale } of [
  { name: 'a large desktop window at 100 % UI scale', viewport: { width: 1920, height: 1080 }, scale: '100' },
  { name: 'a phone held sideways at 100 % UI scale', viewport: { width: 844, height: 390 }, scale: '100' },
  { name: 'a phone held upright at 100 % UI scale', viewport: { width: 390, height: 844 }, scale: '100' },
]) {
  test(`every settings row is on screen and reachable, ${name}, bug #427`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((s) => localStorage.setItem('ab-alone.ui-scale', s), scale);
    await page.goto('./?bot=off&net=hook');
    await page.locator('canvas').waitFor();
    await settingsReachable(page);
  });
}
async function settingsReachable(page: Page): Promise<void> {
  await expect(page.locator('#settings')).toBeEnabled();
  await page.locator('#settings').click();
  await openAdvanced(page); // the developer tools are shut under Advanced (#1566)
  await expect(page.locator('#settings-menu button')).toHaveCount(24); // Reset everything with its Erase and Cancel (#1684), Ledger shares Import with Logs (#1585), Guide shares Steering (#1293), Steering (#1137), Copy diagnostics (#1032, the last row), Render mode (#763), Difficulty (#704), Flat HUD shares Reduced motion (#391), glass shares shell (#377), Palette shares Theme (#381), Transcript shares Sound (#516), Logs shares Import (#513), Free camera (#938)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#settings-menu button')].filter((el) => el.getClientRects().length > 0).map((el) => { // Erase and Cancel wait out of sight (#1684)
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the menu scrolls where it is shorter than its rows (#382, #904)
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const onScreen = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      return { name: el.textContent, reachable: el.contains(hit) && onScreen };
    }),
  );
  expect(rows.filter((row) => !row.reachable).map((row) => row.name), 'rows covered or off screen').toEqual([]);
}

// Bug #271: at the end of a daily fight the plate gains the daily, result and score lines, and grew over the board
// or pushed the button rows onto it. Same check as above, played to the end: a draw by threefold repetition. The windows
// 1000 by 720 and 1024 by 600 are in `sizes`: their daily result card test (#196 #271) is this same state, checked there.
for (const { name, viewport } of [
  { name: 'a tablet held upright', viewport: { width: 768, height: 1024 } },
]) {
  test.describe(`${name}, end of a daily fight`, () => {
    test.use({ viewport });

    test('the plate and the buttons cover no cell after a defeat, bug #271', async ({ page }, testInfo) => {
      const hud = page.locator('#hud');
      await page.emulateMedia({ reducedMotion: 'reduce' }); // the 7 moves of the defeat slide in no time: the layout is the same
      await page.clock.setFixedTime(new Date('2027-03-30T08:00:00Z'));
      await page.goto('./?bot=off&net=hook');
      await openModes(page);
      await page.locator('#daily').click();
      await expect(hud).toContainText('Daily challenge 2027-03-30 · attempt 1');
      await loseByRepetition(page); // against the Echo's bonus mirrors (#859), e2e/fight-end.ts
      await expect(hud).toContainText('Defeat');
      await check(page, testInfo, 'after a daily defeat');
    });
  });
}
