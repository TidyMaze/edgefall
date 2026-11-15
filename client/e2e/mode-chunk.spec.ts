import { expect, test } from '@playwright/test';
import { startMode } from './modes';
import { shot } from './shot';

// The code of the Open world is a chunk of the build, loaded at the first entry (#1578): a table page does not ask for it, the first
// entry does, and a load that fails leaves a message with Retry and Reload over a page that is alive.
const CHUNK = '**/assets/openworldwire-*.js';

test('a table page asks for no Open world code, the first entry asks for it once and opens the world', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => /openworldwire-/.test(request.url()) && asked.push(request.url()));
  await page.goto('./?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready');
  expect(asked).toEqual([]);
  await startMode(page, 'world');
  await expect(page.locator('body')).toHaveAttribute('data-openworld', /.+/);
  expect(asked).toHaveLength(1);
});

test('a failed load shows Retry and Reload over a table that is alive, and Reload gets the file back', async ({ page }) => {
  await page.route(CHUNK, (route) => route.abort());
  await page.goto('./?bot=off');
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready');
  await startMode(page, 'world');
  const message = page.locator('#chunk-error');
  await expect(message).toBeVisible();
  await expect(message).toContainText('The Open world could not load');
  await expect(page.locator('#loading')).toBeHidden();
  await shot(page, { path: 'test-results/chunk-error.png' });
  await expect(page.locator('body')).not.toHaveAttribute('data-openworld', /.+/);
  // Chromium keeps a module that failed to load for the life of the page, so Retry asks it nothing new: Reload is what brings the file back.
  await page.unroute(CHUNK);
  await message.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-bay', 'ready');
  await expect(message).toBeHidden();
  await startMode(page, 'world');
  await expect(page.locator('body')).toHaveAttribute('data-openworld', /.+/);
});
