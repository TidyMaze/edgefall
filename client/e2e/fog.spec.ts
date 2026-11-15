import { expect, test, type Page } from '@playwright/test';
import { RADIUS } from '../src/board';
import { FRAME } from '../src/frame';

// Bug #171: the fog was invisible. Two screenshots of the same still board, Clear board on and off,
// must differ at the far rim and match at the near rim. The CSS vignette (body::after) is hidden so
// only the scene fog is measured. Bug #399: the far rim is the steel rim beyond the cells, the far rim
// cells must match too: the fog thickens toward the rim, never over a cell.
// Every call to the page waits for its software WebGL on a CI runner (#429): the points are read in one call.
const cellsToScreen = (page: Page, cells: [number, number][]) =>
  page.evaluate((list) => list.map(([q, r]) => (window as any).__cellToScreen(q, r) as { x: number; y: number }), cells);

const settle = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Mean absolute RGB difference (0 to 255) of two PNGs inside each box, both decoded once.
const meanDiffs = (page: Page, a: Buffer, b: Buffer, boxes: { x: number; y: number; w: number; h: number }[]) =>
  page.evaluate(
    async ([ra, rb, list]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return g;
      };
      const [ga, gb] = await Promise.all([load(ra as string), load(rb as string)]);
      return list.map((bx) => {
        const pa = ga.getImageData(bx.x, bx.y, bx.w, bx.h).data;
        const pb = gb.getImageData(bx.x, bx.y, bx.w, bx.h).data;
        let sum = 0;
        for (let i = 0; i < pa.length; i += 4) {
          sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
        }
        return sum / (pa.length / 4) / 3;
      });
    },
    [a.toString('base64'), b.toString('base64'), boxes] as const,
  );

type Box = { x: number; y: number; w: number; h: number };

// The still-scene check's evidence: the mean difference inside a box, the bounding box of every pixel that changed,
// and a diff image (the changes amplified in red), attached to the report when the check fails.
const diffOf = (page: Page, a: Buffer, b: Buffer, box: Box) =>
  page.evaluate(
    async ([ra, rb, bx]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data };
      };
      const [A, B] = await Promise.all([load(ra as string), load(rb as string)]);
      const out = document.createElement('canvas');
      out.width = A.w;
      out.height = A.h;
      const og = out.getContext('2d')!;
      const od = og.createImageData(A.w, A.h);
      let sum = 0;
      let n = 0;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
      for (let y = 0; y < A.h; y++) {
        for (let x = 0; x < A.w; x++) {
          const i = (y * A.w + x) * 4;
          const d = Math.abs(A.data[i]! - B.data[i]!) + Math.abs(A.data[i + 1]! - B.data[i + 1]!) + Math.abs(A.data[i + 2]! - B.data[i + 2]!);
          od.data[i] = Math.min(255, d * 4);
          od.data[i + 3] = 255;
          if (x >= bx.x && y >= bx.y && x < bx.x + bx.w && y < bx.y + bx.h) {
            sum += d;
            n++;
          }
          if (d > 48) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      }
      og.putImageData(od, 0, 0);
      return {
        mean: sum / n / 3,
        changed: x1 < 0 ? null : { x0, y0, x1, y1 },
        png: out.toDataURL('image/png').split(',')[1]!,
      };
    },
    [a.toString('base64'), b.toString('base64'), box] as const,
  );

test('the fog shows smoothly across the bay, not on board cells nor as a brutal rim cut, bugs #171, #399, #665', async ({ page }, testInfo) => {
  // The CI window (playwright.config.ts): each of the three draws costs by its pixels, 44 % fewer than the 1280x720 default,
  // and a loaded machine must not push the test past 15 s (#854). It stays above the 768 px width of the low quality tier.
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('./?bot=off&scene=room&quality=high'); // the room's fog: the terrace has none (#1314)
  await page.locator('canvas').waitFor();
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready'); // the room is complete: the bay loads after the page (#661)
  // The evaluation bar's label (#191) is set when the analysis worker answers, which can be after the first shot. Tally's
  // line fades out 4 s after the start (#425), while the shots are taken.
  await page.addStyleTag({ content: 'body::after, #eval, #hud .tally { display: none !important; }' });
  await expect(page.locator('#hud')).toContainText('Black to move');
  // The menu stays closed, so it is in none of the shots: the setting is flipped by a click event on its row. Opening the
  // menu with the cog is checked in clear-board.spec.ts; here each real click cost seconds on a CI runner (#429).
  const toggle = page.getByRole('button', { name: 'Clear board', includeHidden: true });
  const flip = () => toggle.dispatchEvent('click');
  await page.mouse.move(2, 2); // no hover ghost
  await settle(page);

  // Under automation the page skips draws while the last one was slow (#216): two animation frames do not prove the board
  // was drawn again after a flip. Each shot waits for a draw that began after it was asked for (bug #365), then two
  // frames, in one call to the page (#429).
  const drawn = () =>
    page.evaluate(
      () =>
        new Promise((done) => {
          const draws = (window as any).__draws as () => number;
          const asked = (window as any).__drawNext() as number; // not held by the draw throttle (#435)
          const wait = () => (draws() > asked ? requestAnimationFrame(() => requestAnimationFrame(done)) : requestAnimationFrame(wait));
          requestAnimationFrame(wait);
        }),
    );
  const shot = async (name: string) => {
    await drawn();
    return page.screenshot({ path: testInfo.outputPath(name), type: 'png' });
  };
  // The first draws after the room mounts are not the steady picture: the shot of the 2nd draw differs from every later one
  // (mean 1.49 over the page, soft edges everywhere), and all draws from the 3rd on are identical (0). Two draws pass
  // before the first shot, so the still check compares steady frames (#1248).
  await drawn();
  await drawn();
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'off');
  const fogOn = await shot('fog-on.png');
  const fogOnAgain = await shot('fog-on-again.png'); // the same fog, a steady frame later: the still check (one flip less, #1481)
  await flip();
  await expect(page.locator('body')).toHaveAttribute('data-clear', 'on');
  const fogOff = await shot('fog-off.png');

  const size = page.viewportSize()!;
  const band = (cells: { x: number; y: number }[]) => {
    const x = Math.max(0, Math.floor(Math.min(...cells.map((c) => c.x)) - 20));
    const y = Math.max(0, Math.floor(Math.min(...cells.map((c) => c.y)) - 25));
    const w = Math.min(size.width - x, Math.ceil(Math.max(...cells.map((c) => c.x)) - x + 20));
    return { x, y, w, h: 50 };
  };

  // The far half of the steel rim, between the plate's edge and the rim's outer edge (frame.ts), from x = -2 to 2.
  const SQRT3_2 = Math.sqrt(3) / 2;
  const onPlane = (x: number, z: number): [number, number] => [x - z / SQRT3_2 / 2, z / SQRT3_2];
  const edge = RADIUS * SQRT3_2 + FRAME.margin;
  const points = await cellsToScreen(page, [
    ...[0, 1, 2, 3, 4].map((q): [number, number] => [q, -4]),
    ...[-4, -3, -2, -1, 0].map((q): [number, number] => [q, 4]),
    onPlane(-2, -edge),
    onPlane(2, -edge),
    onPlane(0, -edge),
    onPlane(0, -edge - FRAME.rim),
  ]);
  const [far, near, [left, right, inner, outer]] = [points.slice(0, 5), points.slice(5, 10), points.slice(10)];
  const farRim = { x: Math.round(left.x), y: Math.round(outer.y), w: Math.round(right.x - left.x), h: Math.round(inner.y - outer.y) };
  // A box on each far rim cell's disc, half the cell spacing wide.
  const half = Math.round((far[1]!.x - far[0]!.x) / 4);
  const disc = (c: { x: number; y: number }) => ({ x: Math.round(c.x) - half, y: Math.round(c.y) - half, w: 2 * half, h: 2 * half });

  // The pixels are compared on a blank page: the board no longer draws and takes the runner's cores (#429).
  await page.goto('about:blank');
  const still = await diffOf(page, fogOn, fogOnAgain, { x: 0, y: 0, w: size.width, h: size.height });
  if (still.mean >= 0.01) {
    await testInfo.attach('still-diff.png', { body: Buffer.from(still.png, 'base64'), contentType: 'image/png' });
    await testInfo.attach('fog-on.png', { body: fogOn, contentType: 'image/png' });
    await testInfo.attach('fog-on-again.png', { body: fogOnAgain, contentType: 'image/png' });
  }
  expect(still.mean, `changed pixels ${JSON.stringify(still.changed)}`).toBeLessThan(0.01); // still scene
  const fullDiff = await diffOf(page, fogOn, fogOff, { x: 0, y: 0, w: size.width, h: size.height });
  expect(fullDiff.mean, 'fog modifies the rendered scene background').toBeGreaterThan(0.01);
  const [rimDiff, nearDiff, ...cellDiffs] = await meanDiffs(page, fogOn, fogOff, [farRim, band(near), ...far.map(disc)]);
  expect(rimDiff, 'gentle rim without brutal cut').toBeLessThan(1);
  cellDiffs.forEach((d, q) => expect(d, `fog on the far rim cell (${q},-4)`).toBeLessThan(1));
  expect(nearDiff).toBeLessThan(1);
});
