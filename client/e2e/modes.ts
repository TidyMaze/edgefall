import { expect, test, type Page } from '@playwright/test';

/** Starts a mode (`arena`, `run`, `daily`, `world`, `hub`) or a boss by id (`echo`, `hull`...) through the test hook, with no menu pressed (#1690).
 * There is no menu (#1697): a mode starts in the ship, and the bay specs press the real bays. */
export async function startMode(page: Page, id: string): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __booted?: () => boolean }).__booted?.() === true); // set once the landing and the saved game are settled: a mode started sooner is replaced by the Hub's entry
  await page.evaluate((mode) => {
    void (window as unknown as { __startMode: (m: string) => unknown }).__startMode(mode); // not awaited: a world that fails to load never settles
  }, id);
}

const BOSS_OF: Record<string, string> = { 'The Echo': 'echo', 'The Hull': 'hull', 'The Choir': 'choir', 'The Chaplain': 'chaplain', 'The Ballast Mind': 'ballast', 'The Alien': 'alien', 'The Rail Yard': 'railyard', 'The Magnetizer': 'magnetizer', 'The Pulsar': 'pulsar', 'The Overseer': 'overseer', 'The Assembly Line': 'assembly', 'The Unstable Core': 'core', 'The Dual Room': 'dual', 'The Stalker': 'stalker', 'The Swarm': 'swarm' };
/** Starts the boss called `name` (its menu label) through the test hook. */
export async function startBoss(page: Page, name: string): Promise<void> {
  await startMode(page, BOSS_OF[name] ?? name);
}

/** Shows the Open world plate (`#openworld-hud`) and clicks its button `selector`. The plate folds to its chip 8 s after the entry
 * (openworldfold.ts, #1138): on a software-GL runner the page takes longer than that to draw its first frames, so the plate is folded
 * when the test reaches it (#1436). The chip shows it again with no clock. The click itself is made once, never retried: a click
 * that was delivered but timed out on a slow runner would act twice. */
export async function showHud(page: Page, selector: string): Promise<void> {
  const chip = page.locator('#openworld-chip');
  await expect(async () => {
    if (await chip.isVisible()) await chip.click({ timeout: 5000 });
    await expect(page.locator(selector)).toBeVisible({ timeout: 1000 });
  }).toPass();
}
export async function clickHud(page: Page, selector: string): Promise<void> {
  await showHud(page, selector);
  await page.locator(selector).click();
}

/** Opens the Open world's controls hint (#1530) behind the plate's summary, showing the plate first when it is folded: the hints are not shown until it is open. */
export async function openControls(page: Page): Promise<void> {
  await showHud(page, '#openworld-controls summary');
  if (!(await page.locator('#openworld-controls').evaluate((d) => (d as HTMLDetailsElement).open))) await page.locator('#openworld-controls summary').click();
}

/** The invite link of the room just opened: it shows once the room's keys are made, with their fingerprint (#1323). */
export async function inviteLink(page: Page): Promise<string> {
  const invite = page.locator('#invite');
  await expect(invite).toHaveValue(/&key=[\w-]{8}$/);
  return invite.inputValue();
}

/** The low tier on CI (see lowTierOnCi) for pages of a context the test opens itself (browser.newContext). */
export async function lowTierPages(...pages: Page[]): Promise<void> {
  if (process.env.CI) await Promise.all(pages.map((p) => p.addInitScript(() => localStorage.setItem('ab-alone.tier', 'low'))));
}

/** On CI the Open world pages draw on the low quality tier. CI runners have no GPU: on the high tier an idle Open world page ran at
 * 4.6 animation frames a second (one every 220 ms) on SwiftShader, against 60 on the low tier (measured at 960x540, #1436), so the
 * specs that sample frames got none and the ones that click waited seconds. A spec that needs a tier sets its own, which wins.
 * Locally (a GPU) the tier stays the detected one. Call it at the top of a spec file. */
export function lowTierOnCi(): void {
  test.beforeEach(async ({ page }) => {
    if (process.env.CI) await page.addInitScript(() => localStorage.setItem('ab-alone.tier', 'low'));
  });
}
