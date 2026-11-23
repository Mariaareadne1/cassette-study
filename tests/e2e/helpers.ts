import { expect, type Page } from '@playwright/test';

export interface Probe {
  deck: { door: string; cassette: string; mode: string; side: string; time: number; duration: number };
  audioTime: number;
  playing: boolean;
  level: number;
  hubL: number;
  hubR: number;
  doorX: number;
  frames: number;
}

/** Collects console errors, page errors and failed shader compiles for a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /THREE\.WebGLProgram|Shader Error|GL_INVALID/i.test(t)) errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function boot(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__cassette?.ready === true, null, { timeout: 45_000 });
}

export function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const { controller, stage } = window.__cassette!;
    const d = controller.deck.snapshot();
    const dbg = stage.debug() as Record<string, number>;
    return {
      deck: { door: d.door, cassette: d.cassette, mode: d.mode, side: d.side, time: d.time, duration: d.duration },
      audioTime: controller.audio.currentTime(d.side),
      playing: controller.audio.isPlaying(d.side),
      level: controller.audio.level(),
      hubL: dbg.hubL,
      hubR: dbg.hubR,
      doorX: dbg.doorX,
      frames: dbg.frames,
    };
  });
}

/** Screen position of a feature of the object, in CSS pixels. */
export function at(page: Page, target: string): Promise<{ x: number; y: number }> {
  return page.evaluate((t) => window.__cassette!.stage.screenOf(t as never), target);
}

export async function untilDeck(page: Page, pred: (p: Probe) => boolean, message: string, timeout = 10_000): Promise<Probe> {
  let last: Probe | null = null;
  await expect
    .poll(
      async () => {
        last = await probe(page);
        return pred(last);
      },
      { timeout, message },
    )
    .toBe(true);
  return last!;
}

/** Loads the tape with one real click on the cassette and waits until it's seated with the door shut. */
export async function loadByClick(page: Page): Promise<void> {
  const c = await at(page, 'cassette');
  await page.mouse.click(c.x, c.y);
  await untilDeck(page, (p) => p.deck.cassette === 'seated' && p.deck.door === 'closed', 'tape seated, door closed');
}
