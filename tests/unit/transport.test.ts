import { describe, expect, test } from 'vitest';
import {
  FULL_PACK_RADIUS,
  HUB_RADIUS,
  hubSpeeds,
  makeTape,
  packRadius,
  reelPose,
  timeAt,
  windSecondsFor,
  windStep,
  woundAt,
} from '../../src/deck/transport';

const tape = makeTape(60, 45);

describe('tape geometry', () => {
  test('starts with all tape on the left hub and ends with all on the right', () => {
    const start = reelPose(tape, 0);
    const end = reelPose(tape, tape.length);
    expect(start.leftRadius).toBeCloseTo(FULL_PACK_RADIUS, 6);
    expect(start.rightRadius).toBeCloseTo(HUB_RADIUS, 6);
    expect(end.leftRadius).toBeCloseTo(HUB_RADIUS, 6);
    expect(end.rightRadius).toBeCloseTo(FULL_PACK_RADIUS, 6);
  });

  test('both packs have equal radius at the area midpoint, not the tape midpoint radius average', () => {
    const mid = reelPose(tape, tape.length / 2);
    expect(mid.leftRadius).toBeCloseTo(mid.rightRadius, 9);
    const rms = Math.sqrt((HUB_RADIUS ** 2 + FULL_PACK_RADIUS ** 2) / 2);
    expect(mid.leftRadius).toBeCloseTo(rms, 6);
  });

  test('conserves wound area at every position', () => {
    const total = Math.PI * (FULL_PACK_RADIUS ** 2 - HUB_RADIUS ** 2);
    for (let i = 0; i <= 20; i++) {
      const p = reelPose(tape, (tape.length * i) / 20);
      const area = Math.PI * (p.leftRadius ** 2 + p.rightRadius ** 2 - 2 * HUB_RADIUS ** 2);
      expect(area).toBeCloseTo(total, 6);
    }
  });

  test('transfer is monotonic: supply only shrinks, take-up only grows', () => {
    let prev = reelPose(tape, 0);
    for (let i = 1; i <= 200; i++) {
      const next = reelPose(tape, (tape.length * i) / 200);
      expect(next.leftRadius).toBeLessThan(prev.leftRadius);
      expect(next.rightRadius).toBeGreaterThan(prev.rightRadius);
      expect(next.leftAngle).toBeGreaterThan(prev.leftAngle);
      expect(next.rightAngle).toBeGreaterThan(prev.rightAngle);
      prev = next;
    }
  });

  test('closed-form angles satisfy omega = v / R (numerical derivative)', () => {
    const v = tape.speed;
    for (const f of [0.05, 0.3, 0.5, 0.8, 0.97]) {
      const w = tape.length * f;
      const dt = 1e-4;
      const a = reelPose(tape, w);
      const b = reelPose(tape, w + v * dt);
      const s = hubSpeeds(tape, w, v);
      expect((b.rightAngle - a.rightAngle) / dt).toBeCloseTo(s.right, 2);
      expect((b.leftAngle - a.leftAngle) / dt).toBeCloseTo(s.left, 2);
    }
  });

  test('the small pack spins faster than the big one', () => {
    const s = hubSpeeds(tape, tape.length * 0.1, tape.speed);
    expect(s.right).toBeGreaterThan(s.left);
    const e = hubSpeeds(tape, tape.length * 0.9, tape.speed);
    expect(e.left).toBeGreaterThan(e.right);
  });

  test('never produces NaN or infinite values for hostile input', () => {
    for (const w of [NaN, Infinity, -Infinity, -1e9, 1e12, 0]) {
      const p = reelPose(tape, w);
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(hubSpeeds(tape, w, 100).left)).toBe(true);
    }
    const t0 = makeTape(NaN, Infinity);
    expect(Number.isFinite(t0.length)).toBe(true);
    expect(t0.length).toBeGreaterThan(0);
    expect(Number.isFinite(packRadius(t0, NaN))).toBe(true);
  });
});

describe('sides and time', () => {
  test('time and position are inverses on both sides', () => {
    for (const t of [0, 1, 12.5, 44]) {
      expect(timeAt(tape, 'A', woundAt(tape, 'A', t))).toBeCloseTo(t, 9);
      expect(timeAt(tape, 'B', woundAt(tape, 'B', t))).toBeCloseTo(t, 9);
    }
  });

  test('side A play winds toward the right hub; side B toward the left', () => {
    expect(woundAt(tape, 'A', 10)).toBeGreaterThan(woundAt(tape, 'A', 5));
    expect(woundAt(tape, 'B', 10)).toBeLessThan(woundAt(tape, 'B', 5));
  });

  test('flipping keeps the physical tape: side B time mirrors side A time', () => {
    const w = woundAt(tape, 'A', 20);
    const total = tape.length / tape.speed;
    const leader = total - (timeAt(tape, 'A', w) + timeAt(tape, 'B', w));
    expect(leader).toBeGreaterThan(0);
    expect(timeAt(tape, 'B', w)).toBeCloseTo(total - leader - 20, 9);
  });

  test('a tape is long enough for the longer side', () => {
    expect(timeAt(tape, 'A', tape.length)).toBeGreaterThanOrEqual(60);
    expect(timeAt(tape, 'B', 0)).toBeGreaterThanOrEqual(60);
  });

  test('seeking re-poses the reels directly from position', () => {
    const before = reelPose(tape, woundAt(tape, 'A', 5));
    const after = reelPose(tape, woundAt(tape, 'A', 40));
    expect(after.rightRadius).toBeGreaterThan(before.rightRadius);
    expect(after.rightAngle).toBeGreaterThan(before.rightAngle);
  });
});

describe('winding', () => {
  test('fast-forward moves toward the right hub and rewind toward the left', () => {
    const w = tape.length / 2;
    const ws = windSecondsFor(tape);
    expect(windStep(tape, w, 1, 0.1, ws)).toBeGreaterThan(w);
    expect(windStep(tape, w, -1, 0.1, ws)).toBeLessThan(w);
  });

  test('winding is much faster than playback and accelerates as the take-up pack grows', () => {
    const ws = windSecondsFor(tape);
    const early = windStep(tape, tape.length * 0.1, 1, 0.01, ws) - tape.length * 0.1;
    const late = windStep(tape, tape.length * 0.8, 1, 0.01, ws) - tape.length * 0.8;
    expect(early / 0.01).toBeGreaterThan(tape.speed * 3);
    expect(late).toBeGreaterThan(early);
  });

  test('a full wind completes in roughly the advertised time and clamps at the end', () => {
    const ws = windSecondsFor(tape);
    let w = 0;
    let t = 0;
    while (w < tape.length && t < 60) {
      w = windStep(tape, w, 1, 1 / 60, ws);
      t += 1 / 60;
    }
    expect(w).toBe(tape.length);
    expect(t).toBeGreaterThan(ws * 0.6);
    expect(t).toBeLessThan(ws * 1.6);
    expect(windStep(tape, tape.length, 1, 1, ws)).toBe(tape.length);
    expect(windStep(tape, 0, -1, 1, ws)).toBe(0);
  });

  test('negative dt never moves the tape', () => {
    expect(windStep(tape, 100, 1, -5, 4)).toBe(100);
  });
});
