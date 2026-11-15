import { expect, test } from '@playwright/test';
import { startMode } from './modes';

// Issue #1287: the Leaderboard entry of the mode menu shows the player among the opponents of settled 1v1 matches.
test('the leaderboard shows my position among the opponents I met, my row highlighted', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ab-alone.ranked',
      JSON.stringify({
        version: 1,
        rating1v1: 1250,
        ratingRoyale: 1200,
        matches: [
          { id: 'm1', timestamp: 1, mode: '1v1', delta: 12, newRating: 1238, opponentsCount: 1 },
          { id: 'm2', timestamp: 2, mode: '1v1', delta: 12, newRating: 1250, opponentsCount: 1 },
        ],
      }),
    );
    localStorage.setItem(
      'ab-alone.ranked.rivals',
      JSON.stringify({
        version: 1,
        rivals: [
          { pub: 'a1b2c3d4', rating: 1710, timestamp: 1 },
          { pub: 'e5f6a7b8', rating: 1420, timestamp: 2 },
          { pub: 'c9d0e1f2', rating: 1010, timestamp: 3 },
        ],
      }),
    );
    localStorage.setItem('ab-alone.ranked.board', JSON.stringify({ version: 1, rank: 1 }));
  });
  await page.goto('./?bot=off');
  await startMode(page, 'leaderboard');
  const board = page.getByRole('dialog', { name: 'Ranked 1v1' });
  await expect(board).toBeVisible();
  await expect(board).toContainText('Your position: 3 of 4');
  await expect(board.locator('tr[data-me]')).toContainText('You');
  await expect(board.locator('#board-history li')).toHaveText(['1238', '1250']);
  await expect(board.locator('#board-move')).toHaveText('Down 2 places since your last visit');
  await page.keyboard.press('Escape');
  await expect(board).toBeHidden();
});
