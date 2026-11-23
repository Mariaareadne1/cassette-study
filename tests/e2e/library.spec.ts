import path from 'node:path';
import { expect, test } from '@playwright/test';
import { boot, untilDeck, watchErrors } from './helpers';

const fixture = (f: string) => path.join(__dirname, '..', 'fixtures', f);

test.describe('make a tape and the shelf', () => {
  test('a recorded tape plays, survives a reload and can be deleted', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await page.getByRole('button', { name: 'Make a tape' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make a tape' });
    await dialog.getByLabel('Title').fill('Kitchen Radio');
    await dialog.getByLabel('Note').fill('for the e2e test');
    await dialog.locator('#cs-side-A').setInputFiles(fixture('tone-a.wav'));
    await expect(dialog.getByText(/tone-a\.wav · 0:06/)).toBeVisible();
    await dialog.locator('#cs-side-B').setInputFiles(fixture('tone-b.wav'));
    await expect(dialog.getByText(/tone-b\.wav · 0:04/)).toBeVisible();
    await dialog.locator('#cs-art').setInputFiles(fixture('art.png'));
    await dialog.getByText('Typewriter').click();
    await dialog.getByRole('button', { name: 'Save and play' }).click();
    await expect(dialog).toBeHidden();
    await untilDeck(page, () => true, '');
    await expect.poll(() => page.evaluate(() => window.__cassette!.controller.currentTape?.meta.title)).toBe('Kitchen Radio');
    await expect(page.locator('.cs-track')).toHaveText(/tone-a|Kitchen Radio/);

    await page.reload();
    await page.waitForFunction(() => window.__cassette?.ready === true);
    await page.getByRole('button', { name: 'Shelf', exact: true }).click();
    const shelf = page.getByRole('dialog', { name: 'Shelf' });
    const row = shelf.getByRole('listitem').filter({ hasText: 'Kitchen Radio' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Load' }).click();
    await expect(shelf).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__cassette!.controller.currentTape?.meta.title)).toBe('Kitchen Radio');

    // Load it and play the saved audio.
    await page.evaluate(() => window.__cassette!.controller.insertOrRemove());
    await untilDeck(page, (p) => p.deck.cassette === 'seated' && p.deck.door === 'closed', 'seated');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await untilDeck(page, (p) => p.playing && p.audioTime > 0.4 && Math.abs(p.deck.duration - 6) < 0.2, 'saved side A plays');

    await page.getByRole('button', { name: 'Shelf', exact: true }).click();
    await shelf.getByRole('listitem').filter({ hasText: 'Kitchen Radio' }).getByRole('button', { name: 'Delete' }).click();
    await shelf.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(shelf.getByText('Kitchen Radio')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a file that is not audio is refused with a clear message', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Make a tape' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make a tape' });
    await dialog.locator('#cs-side-A').setInputFiles(fixture('not-audio.mp3'));
    await expect(dialog.getByRole('alert')).toContainText(/can’t play|couldn’t|no readable length/i);
    await dialog.getByRole('button', { name: 'Save and play' }).click();
    await expect(dialog.getByRole('alert').last()).toContainText('Add a recording');
  });

  test('export then import round-trips a tape', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Make a tape' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make a tape' });
    await dialog.getByLabel('Title').fill('Round Trip');
    await dialog.locator('#cs-side-A').setInputFiles(fixture('tone-b.wav'));
    await expect(dialog.getByText(/tone-b\.wav/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save to shelf' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Shelf', exact: true }).click();
    const shelf = page.getByRole('dialog', { name: 'Shelf' });
    const row = shelf.getByRole('listitem').filter({ hasText: 'Round Trip' });
    const downloadP = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Export' }).click();
    const download = await downloadP;
    expect(download.suggestedFilename()).toBe('round-trip.cassette');
    const file = await download.path();
    await shelf.locator('input[type=file]').setInputFiles(file!);
    await expect(shelf.getByRole('listitem').filter({ hasText: 'Round Trip' })).toHaveCount(2);

    const cardP = page.waitForEvent('download');
    await row.first().getByRole('button', { name: 'Collector card' }).click();
    expect((await cardP).suggestedFilename()).toBe('round-trip-card.png');
  });
});
