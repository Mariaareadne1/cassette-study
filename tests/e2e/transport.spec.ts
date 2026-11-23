import { expect, test } from '@playwright/test';
import { at, boot, loadByClick, probe, untilDeck, watchErrors } from './helpers';

test.describe('the object and its transport', () => {
  test('boots and renders with no script or shader errors', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await expect(page.getByRole('heading', { name: 'Cassette Study' })).toBeVisible();
    await untilDeck(page, (p) => p.frames > 30, 'the stage is rendering frames');
    const lit = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      return c.width > 0 && c.height > 0;
    });
    expect(lit).toBe(true);
    expect(errors).toEqual([]);
  });

  test('play makes sound, time advances, reels turn; pause halts both', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await loadByClick(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const started = await untilDeck(page, (p) => p.playing && p.audioTime > 0.6, 'audio is playing and time advances');
    await untilDeck(page, (p) => p.level > 0.001, 'audio signal reaches the analyser');
    const later = await untilDeck(page, (p) => p.audioTime > started.audioTime + 0.5, 'time keeps advancing');
    expect(later.deck.time).toBeGreaterThan(0.5);
    expect(later.hubL).not.toBeCloseTo(started.hubL, 3);
    expect(later.deck.mode).toBe('playing');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await untilDeck(page, (p) => p.deck.mode === 'paused' && !p.playing, 'paused');
    await page.waitForTimeout(700);
    const still = await probe(page);
    expect(still.audioTime).toBeCloseTo(paused.audioTime, 1);
    expect(still.hubL).toBeCloseTo(paused.hubL, 3);
    expect(errors).toEqual([]);
  });

  test('fast-forward winds ahead and rewind returns to the start', async ({ page }) => {
    await boot(page);
    await loadByClick(page);
    await page.getByRole('button', { name: 'Fast-forward' }).click();
    const ff = await untilDeck(page, (p) => p.deck.mode === 'fastForward' && p.deck.time > 4, 'fast-forward moves the tape');
    await page.getByRole('button', { name: 'Stop' }).click();
    const stopped = await untilDeck(page, (p) => p.deck.mode === 'stopped', 'stopped');
    expect(stopped.deck.time).toBeGreaterThanOrEqual(ff.deck.time);
    await page.waitForTimeout(500);
    expect((await probe(page)).hubL).toBeCloseTo(stopped.hubL, 3);

    await page.getByRole('button', { name: 'Rewind' }).click();
    await untilDeck(page, (p) => p.deck.time < 0.05 && p.deck.mode === 'stopped', 'rewound to the start and stopped', 15_000);
  });

  test('the door opens from the object and the cassette can be dragged in', async ({ page }) => {
    await boot(page);
    const door = await at(page, 'door');
    await page.mouse.click(door.x, door.y);
    await untilDeck(page, (p) => p.deck.door === 'open' && Math.abs(p.doorX) > 0.2, 'door opens');

    const from = await at(page, 'cassette');
    const to = await at(page, 'slot');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 24, from.y + ((to.y - from.y) * i) / 24);
      await page.waitForTimeout(16);
    }
    await untilDeck(page, (p) => p.deck.cassette === 'aligned', 'cassette snaps into alignment over the deck');
    await page.mouse.up();
    await untilDeck(page, (p) => p.deck.cassette === 'seated', 'cassette seats on release');
  });

  test('keyboard: space plays and pauses, E ejects', async ({ page }) => {
    await boot(page);
    await loadByClick(page);
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('Space');
    await untilDeck(page, (p) => p.deck.mode === 'playing', 'space plays');
    await page.keyboard.press('Space');
    await untilDeck(page, (p) => p.deck.mode === 'paused', 'space pauses');
    await page.keyboard.press('e');
    await untilDeck(page, (p) => p.deck.door === 'open' && p.deck.mode === 'stopped', 'E stops and opens the door');
  });

  test('turning the tape over plays side B from where side A ended', async ({ page }) => {
    await boot(page);
    await loadByClick(page);
    // One physical tape: the end of side A is the start of side B.
    await page.getByRole('button', { name: 'Fast-forward' }).click();
    await untilDeck(page, (p) => p.deck.mode === 'ended', 'side A wound to its end', 20_000);
    await page.keyboard.press('e');
    await untilDeck(page, (p) => p.deck.door === 'open', 'door open');
    await page.getByRole('button', { name: /Turn the tape over/ }).click();
    const flipped = await untilDeck(page, (p) => p.deck.side === 'B' && p.deck.cassette === 'seated', 'side B is up');
    expect(flipped.deck.time).toBeLessThan(0.1);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await untilDeck(page, (p) => p.deck.mode === 'playing' && p.playing && p.audioTime > 0.3, 'side B plays');
    await expect(page.locator('.cs-track')).toHaveText('Night Index');
  });
});
