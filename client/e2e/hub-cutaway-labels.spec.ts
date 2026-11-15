import { expect, test, type Page } from '@playwright/test';

// #1702: no bay label overlaps another label or the marble's lift tag, no bay wears a blank plate, and a phone's labels are readable (cap height of 7 px or more),
// at 390x844 and 1000x700. The ship draws from the bays' window rects, so the positions are read from the page (bounding boxes), not computed in a unit test.
// One page, one load: the window is resized between the two sizes (the other shell loads) to stay under the 5 s of an e2e.

interface Box { n: string; l: number; t: number; r: number; b: number; cut: boolean }

async function read(page: Page): Promise<{ boxes: Box[]; blank: string[]; cap: number; echoLeft: number }> {
  return page.evaluate(() => {
    const boxes: Box[] = [];
    const blank: string[] = [];
    const add = (n: string, e: Element, cut = false) => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes.push({ n, l: r.left, t: r.top, r: r.right, b: r.bottom, cut });
    };
    let cap = 99;
    for (const bay of document.querySelectorAll<HTMLElement>('#ship-bays .cut-bay:not([hidden])')) {
      const key = bay.dataset.bay ?? '?';
      for (const e of bay.querySelectorAll<HTMLElement>('.short, b, small')) {
        if (getComputedStyle(e).display === 'none') continue;
        if (!e.textContent!.trim()) blank.push(key);
        add(`${key}:${e.tagName.toLowerCase()}`, e, e.scrollWidth > e.clientWidth + 1);
        if (e.classList.contains('short')) {
          const c = document.createElement('canvas').getContext('2d')!;
          const s = getComputedStyle(e);
          c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
          cap = Math.min(cap, c.measureText('H').actualBoundingBoxAscent);
        }
      }
    }
    add('tag', document.querySelector('#ship-goal .tag')!);
    return { boxes, blank, cap, echoLeft: document.querySelector('#ship-bays [data-bay="mess:echo"]')!.getBoundingClientRect().left };
  });
}

test('phone and window: no bay label overlaps another label or the lift tag, no blank plate, readable phone labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('ab-alone.progress', JSON.stringify({ version: 1, deck: 'mess', cell: [0, 0], beaten: ['echo'] })));
  await page.goto('./?bot=off');
  await page.locator('canvas').waitFor();
  await page.evaluate(() => (window as unknown as { __enterMode: (m: string) => void }).__enterMode('hub'));
  await expect(page.locator('body')).toHaveAttribute('data-hub-cutaway', 'true');
  await expect(page.locator('#ship-goal .tag')).toBeVisible();
  let before = -1;
  for (const [name, size] of [['phone', { width: 390, height: 844 }], ['window', { width: 1000, height: 700 }]] as const) {
    if (before >= 0) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await read(page)).echoLeft, { timeout: 4000 }).not.toBe(before); // the other shell's bays are placed
      await expect(page.locator('#ship-goal .tag')).toBeVisible();
    }
    const { boxes, blank, cap, echoLeft } = await read(page);
    before = echoLeft;
    expect(boxes.length, name).toBeGreaterThan(5);
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, c = boxes[j]!;
      if (a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b) hits.push(`${a.n} x ${c.n}`);
    }
    expect(hits, name).toEqual([]);
    expect(boxes.filter((b) => b.cut && /:(short|b)$/.test(b.n)).map((b) => b.n), name).toEqual([]); // the first line shows whole
    expect(blank, name).toEqual([]);
    console.log(`${name}: label cap height ${cap.toFixed(2)} px`);
    if (name === 'phone') expect(cap).toBeGreaterThanOrEqual(7);
  }
});
