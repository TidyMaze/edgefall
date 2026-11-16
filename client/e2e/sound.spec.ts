import { expect, test, type Page } from '@playwright/test';
import { ICONS } from '../src/icons';
import { knockPitch } from '../src/sound';
import { DIRECTIONS, encodeMove, type Move } from '../src/board';
import { startMode } from './modes';

// The ejection sound (world.md section 7): the page says which sound an ejection played in
// data-sound, and window.__audio() gives the state of the audio context ('none' before one exists).
async function open(page: Page) {
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await expect(page.locator('#hud')).toContainText('Black to move');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return async (...cells: [number, number][]) => {
    for (const [q, r] of cells) {
      const p = await page.evaluate(([cq, cr]) => (window as any).__cellToScreen(cq, cr), [q, r]);
      await page.mouse.click(p.x, p.y);
    }
  };
}
// The volume sliders (#438) live in the settings menu: the cog opens it, its Sound item shows the four sliders.
const slider = async (page: Page, name: 'Music' | 'Ambience' | 'Effects' | 'Voice') => {
  const range = page.getByRole('slider', { name });
  if (await range.isVisible()) return range;
  if (!(await page.getByRole('button', { name: 'Sound' }).isVisible())) await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sound' }).click();
  return range;
};
const audio = (page: Page) => page.evaluate(() => (window as any).__audio());
const gain = (page: Page, bus: string) => page.evaluate((b) => (window as any).__gain(b), bus);
const tension = (page: Page) => page.evaluate(() => (window as any).__tension());

/** Plays the move of `cells` onto `to` (one of its marbles' neighbour) through the __playMoves hook, as a click would choose it: a
 * software-GL runner draws each click, about 1 s each, and only the last move of a test needs to be a real gesture (#1710). */
async function hookMove(page: Page, cells: [number, number][], to: [number, number]): Promise<void> {
  const legal = (await page.evaluate(() => (window as any).__legal())) as Move[];
  const same = (m: Move) => m.cells.length === cells.length && cells.every(([q, r]) => m.cells.some(([a, b]) => a === q && b === r));
  const move = legal.find((m) => same(m) && m.cells.some(([q, r]) => q + DIRECTIONS[m.dir]![0] === to[0] && r + DIRECTIONS[m.dir]![1] === to[1]))!;
  await page.evaluate((record) => (window as any).__playMoves([record]), encodeMove(move));
}

// The 3v2 push of eject.spec.ts: Black pushes the last White marble of the q = -2 column off. The four moves before the push are
// played through the hook; the push is clicked, the gesture that lets the page make sound.
async function loseGlass(click: Awaited<ReturnType<typeof open>>, page: Page) {
  await hookMove(page, [[-2, 2], [-2, 3], [-2, 4]], [-2, 1]);
  await hookMove(page, [[0, -3], [0, -2]], [-1, -2]);
  await hookMove(page, [[-2, 1], [-2, 2], [-2, 3]], [-2, 0]);
  await hookMove(page, [[-1, -2], [-1, -1]], [-2, -2]);
  await click([-2, 0], [-2, 1], [-2, 2], [-2, -1]);
}

// The same push turned half a turn, sides swapped: after one waiting move of Black, White pushes
// a Black marble of the q = 2 column off.
async function loseShell(click: Awaited<ReturnType<typeof open>>, page: Page) {
  await hookMove(page, [[-2, 2]], [-3, 2]); // Black waits: one marble W
  await hookMove(page, [[2, -2], [2, -3], [2, -4]], [2, -1]);
  await hookMove(page, [[0, 3], [0, 2]], [1, 2]);
  await hookMove(page, [[2, -1], [2, -2], [2, -3]], [2, 0]);
  await hookMove(page, [[1, 2], [1, 1]], [2, 2]);
  await click([2, 0], [2, -1], [2, -2], [2, 1]);
}

test('no audio before a gesture, then a lost glass marble tolls', async ({ page }) => {
  const click = await open(page);
  expect(await audio(page)).toBe('none'); // browsers block audio before a gesture
  await loseGlass(click, page);
  await expect(page.locator('body')).toHaveAttribute('data-ejections', '1');
  await expect(page.locator('body')).toHaveAttribute('data-sound', 'toll');
  expect(await audio(page)).toBe('running');
});

// #289: a move plays a knock; body[data-knock] gives its pitch (none when silent). Three marbles in
// line is the lowest knock.
test('a move plays the knock of its marbles, lower for three', async ({ page }) => {
  const click = await open(page);
  await click([-2, 2], [-2, 3], [-2, 4], [-2, 1]);
  await expect(page.locator('body')).toHaveAttribute('data-knock', String(knockPitch(3)));
});

test('a lost enemy shell clacks', async ({ page }) => {
  const click = await open(page);
  await loseShell(click, page);
  await expect(page.locator('#hud')).toContainText('White ejected 1/6');
  await expect(page.locator('body')).toHaveAttribute('data-sound', 'clack');
});

// #438: four sliders, one per bus. Under Playwright (navigator.webdriver) the music starts at 0, so a test run is silent (#990);
// effects and voice at 100 %. window.__gain(bus) is the gain of a bus, 0 before a gesture.
test('Sound opens four sliders at defaults, each moves its own bus, and the menu closes back on its items', async ({ page }) => {
  await open(page);
  await expect(await slider(page, 'Music')).toHaveValue('0');
  for (const name of ['Effects', 'Voice'] as const) await expect(await slider(page, name)).toHaveValue('100');
  await expect(await slider(page, 'Ambience')).toHaveValue('5');
  await expect(page.getByRole('button', { name: 'Clear board' })).toBeHidden(); // the sliders in place of the items
  const music = await slider(page, 'Music');
  await music.focus();
  await page.keyboard.press('Home'); // a key is a gesture: it starts the audio
  await expect(music).toHaveValue('0');
  await expect.poll(() => gain(page, 'music')).toBeLessThan(0.01);
  await page.keyboard.press('ArrowRight');
  await expect(music).toHaveValue('5');
  await expect.poll(() => gain(page, 'music')).toBeCloseTo(0.05, 2);
  expect(await gain(page, 'ambience')).toBeCloseTo(0.05, 2);
  for (const bus of ['effects', 'voice']) expect(await gain(page, bus)).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Clear board' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Music' })).toBeHidden();
});

test('the effects slider at 0 mutes the ejection and the knock, and the game plays on', async ({ page }) => {
  const click = await open(page);
  const effects = await slider(page, 'Effects');
  await effects.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await loseGlass(click, page);
  await expect(page.locator('#hud')).toContainText('Black ejected 1/6');
  await expect(page.locator('body')).toHaveAttribute('data-sound', 'none');
  await expect(page.locator('body')).toHaveAttribute('data-knock', 'none'); // the knock of the last move is silent too
});

test('the sliders survive a reload, and every slider at 0 makes no audio context', async ({ page }) => {
  await open(page);
  for (const name of ['Music', 'Ambience', 'Effects', 'Voice'] as const) {
    const range = await slider(page, name);
    await range.focus();
    await page.keyboard.press('Home');
  }
  await page.keyboard.press('Escape');

  await page.reload();
  const click = await open(page);
  await expect(await slider(page, 'Voice')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await click([0, 2]); // a gesture on the board: still no audio context while every slider is at 0
  expect(await audio(page)).toBe('none');

  const effects = await slider(page, 'Effects');
  await effects.focus();
  await page.keyboard.press('End'); // back up, the key is the gesture that starts the audio
  await expect(effects).toHaveValue('100');
  expect(await audio(page)).toBe('running');
  await expect.poll(() => gain(page, 'effects')).toBeGreaterThan(0.9);
});

test('an old saved Sound off sets every slider at 0', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ab-alone.sound', 'off'));
  await open(page);
  for (const name of ['Music', 'Ambience', 'Effects', 'Voice'] as const) await expect(await slider(page, name)).toHaveValue('0');
});

test('Sound is no loose HUD button: it is in the settings menu, its sliders reachable by keyboard', async ({ page }) => {
  await open(page);
  await expect(page.locator('#online > #sound')).toHaveCount(0);
  const sound = page.getByRole('button', { name: 'Sound' });
  await expect(sound).toBeHidden(); // closed until the cog opens it
  await page.getByRole('button', { name: 'Settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(sound).toBeVisible();
  await expect(sound.locator('path')).toHaveAttribute('d', ICONS.sound); // a speaker
  await sound.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('slider', { name: 'Music' })).toBeFocused(); // the first slider takes the focus
  await page.keyboard.press('ArrowRight'); // the music starts at 0 under Playwright (#990): an arrow moves it up one step
  await expect(page.getByRole('slider', { name: 'Music' })).toHaveValue('5');
});

// The hum (world.md section 7) runs under every game once a gesture has made the audio context, through the
// ambience bus, and the Ambience slider fades it out.
test('the hum runs after a gesture, and fades out with the Ambience slider', async ({ page }) => {
  const tracks = new Set<string>();
  page.on('request', (r) => r.url().includes('/audio/') && tracks.add(r.url().split('/').pop()!));
  const click = await open(page);
  expect(await gain(page, 'ambience')).toBe(0); // no audio context before a gesture, so no hum
  expect([...tracks]).toEqual([]);
  await click([0, 2]); // a gesture on the board starts the audio, and with it the hum and tracks
  await expect.poll(() => gain(page, 'ambience')).toBeCloseTo(0.05, 2);
  await expect.poll(() => [...tracks].sort()).toEqual([
    'dead-ore-hauler.mp3',
    'reactor-room-tone-1.mp3',
    'reactor-room-tone-2.mp3',
  ]);
  const ambience = await slider(page, 'Ambience');
  await ambience.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => gain(page, 'ambience')).toBeLessThan(0.01);
});

// #439: the drone layers follow the tension level, which rises once a push could eject a player marble.
test('the tension level rises when a marble is pushed to the rim, and the drones crossfade in', async ({ page }) => {
  const click = await open(page);
  expect(await tension(page)).toEqual({ level: 0, layers: [0, 0] });
  // The first four moves of loseGlass: White steps two marbles into the q = -2 column, the top one on the rim, three
  // Black marbles in line behind them.
  await click([-2, 2], [-2, 3], [-2, 4], [-2, 1]);
  await click([0, -3], [0, -2], [-1, -2]);
  expect((await tension(page)).level).toBe(0);
  await click([-2, 1], [-2, 2], [-2, 3], [-2, 0]);
  await click([-1, -2], [-1, -1], [-2, -2]);
  await expect.poll(async () => (await tension(page)).level).toBeGreaterThan(0);
  await expect.poll(async () => (await tension(page)).layers[0]).toBeGreaterThan(0.9); // crossfaded in within about a second
});

// #1571: the music follows the scene. Nobody can listen in a browser driven by Playwright, so the page says which scene it plays
// (window.__scene): none of its layers is built while the Music slider is at 0 (the automation default), a boss fight has its pulse.
test('the music names the scene, and builds its layers only once the Music slider is up', async ({ page }) => {
  await open(page);
  const scene = () => page.evaluate(() => (window as any).__scene());
  expect(await scene()).toMatchObject({ id: 'bot', layers: 0 });
  const music = await slider(page, 'Music');
  await music.focus();
  await page.keyboard.press('ArrowRight'); // a key is a gesture: it starts the audio
  await expect.poll(async () => (await scene()).layers).toBe(1);
  await page.keyboard.press('Escape');
  await startMode(page, 'echo');
  await expect.poll(async () => scene()).toMatchObject({ id: 'boss:echo', layers: 1, pulse: 0.5, track: false });
});

// Bug #146 pattern: a click right after load hits a disabled button or toggles.
test('the settings cog is not clickable before it works, and works right after load', async ({ page }) => {
  await page.goto('./?bot=off', { waitUntil: 'domcontentloaded' });
  const atClick = await page.evaluate(() => {
    const cog = document.getElementById('settings') as HTMLButtonElement;
    const disabled = cog.disabled;
    cog.click();
    return { disabled, hidden: (document.getElementById('settings-menu') as HTMLElement).hidden };
  });
  expect(atClick.disabled || !atClick.hidden).toBe(true);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeEnabled();
});
