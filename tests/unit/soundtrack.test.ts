import { describe, expect, test } from 'vitest';
import { plan } from '../../src/deck/soundtrack';

describe('demo soundtrack plan', () => {
  test('music follows play, pause, resume and stop with the right offsets', () => {
    const p = plan(
      [
        { t: 1, type: 'cue', detail: 'latch' },
        { t: 1, type: 'mode', detail: 'playing' },
        { t: 1, type: 'play', detail: 'A:0.0000:spin' },
        { t: 4, type: 'mode', detail: 'paused' },
        { t: 5, type: 'mode', detail: 'playing' },
        { t: 5, type: 'play', detail: 'A:3.0000:resume' },
        { t: 7, type: 'mode', detail: 'fastForward' },
        { t: 9, type: 'mode', detail: 'stopped' },
      ],
      12,
    );
    expect(p.music).toEqual([
      { side: 'A', at: 1, offset: 0, until: 4, spinUp: true },
      { side: 'A', at: 5, offset: 3, until: 7, spinUp: false },
    ]);
    expect(p.motor).toEqual([
      [1, 4],
      [5, 7],
    ]);
    expect(p.wind).toEqual([[7, 9]]);
    expect(p.cues).toEqual([[1, 'latch']]);
  });

  test('a span still open at the end runs to the end of the film', () => {
    const p = plan([{ t: 2, type: 'mode', detail: 'playing' }, { t: 2, type: 'play', detail: 'B:10.5000:spin' }], 8);
    expect(p.music).toEqual([{ side: 'B', at: 2, offset: 10.5, until: 8, spinUp: true }]);
    expect(p.motor).toEqual([[2, 8]]);
  });
});
