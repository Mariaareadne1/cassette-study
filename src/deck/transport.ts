/**
 * Tape transport geometry. Pure, deterministic, unit-tested.
 *
 * One physical tape of length L (mm) runs between two hubs. `wound` is the length of tape on the
 * cassette's right hub (right when Side A faces you). Side A plays left → right, so its time is
 * `wound / speed`; Side B is the same tape turned over, so its time is `(L − wound) / speed`.
 * Flipping therefore keeps the physical tape where it is, exactly like a real cassette.
 *
 * Pack radius comes from conserving the annulus area: π(R² − r0²) = wound · thickness.
 * The angle a hub has turned is the closed form of ∫ dwound / R(wound), so reels can be posed
 * directly from position after any seek and still satisfy ω = v / R while moving.
 */

export type Side = 'A' | 'B';

/** Real compact-cassette numbers, in millimetres and seconds. */
export const TAPE_SPEED = 47.625; // 1⅞ in/s
export const HUB_RADIUS = 10.8;
export const FULL_PACK_RADIUS = 24.2;
/** Seconds of tape beyond the longest recording, so both sides have a little leader. */
export const LEADER_SECONDS = 1.5;
/** Minimum virtual programme length, so a 3-second clip still looks like a cassette. */
export const MIN_SIDE_SECONDS = 20;

export interface TapeSpec {
  /** Tape length in mm. */
  readonly length: number;
  /** Effective tape thickness in mm, chosen so a full pack has FULL_PACK_RADIUS. */
  readonly thickness: number;
  readonly hub: number;
  readonly speed: number;
}

export interface ReelPose {
  readonly leftRadius: number;
  readonly rightRadius: number;
  /** Hub angles in radians in the cassette's own frame (counter-clockwise, Side A facing). */
  readonly leftAngle: number;
  readonly rightAngle: number;
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Builds a tape long enough for the longer of the two recordings. */
export function makeTape(durationA: number, durationB: number): TapeSpec {
  const longest = Math.max(finiteOr(durationA, 0), finiteOr(durationB, 0), MIN_SIDE_SECONDS);
  const length = (longest + LEADER_SECONDS) * TAPE_SPEED;
  const thickness = (Math.PI * (FULL_PACK_RADIUS ** 2 - HUB_RADIUS ** 2)) / length;
  return { length, thickness, hub: HUB_RADIUS, speed: TAPE_SPEED };
}

export function clampWound(tape: TapeSpec, wound: number): number {
  return clamp(finiteOr(wound, 0), 0, tape.length);
}

/** Radius of a pack holding `amount` mm of tape. */
export function packRadius(tape: TapeSpec, amount: number): number {
  const a = clamp(finiteOr(amount, 0), 0, tape.length);
  return Math.sqrt(tape.hub ** 2 + (a * tape.thickness) / Math.PI);
}

/** Playback time on a side for a physical tape position. Leader is split evenly between ends. */
export function timeAt(tape: TapeSpec, side: Side, wound: number): number {
  const w = clampWound(tape, wound);
  const lead = (LEADER_SECONDS * tape.speed) / 2;
  const along = side === 'A' ? w - lead : tape.length - w - lead;
  return along / tape.speed;
}

/** Physical tape position for a playback time on a side (inverse of timeAt). */
export function woundAt(tape: TapeSpec, side: Side, time: number): number {
  const lead = (LEADER_SECONDS * tape.speed) / 2;
  const along = finiteOr(time, 0) * tape.speed + lead;
  return clampWound(tape, side === 'A' ? along : tape.length - along);
}

/** Pose of both hubs for a tape position. Angles are continuous functions of position. */
export function reelPose(tape: TapeSpec, wound: number): ReelPose {
  const w = clampWound(tape, wound);
  const k = (2 * Math.PI) / tape.thickness; // 2 / (h / π)
  const rightRadius = packRadius(tape, w);
  const leftRadius = packRadius(tape, tape.length - w);
  const leftFull = packRadius(tape, tape.length);
  return {
    leftRadius,
    rightRadius,
    // Side A play (wound rising) turns both hubs counter-clockwise.
    rightAngle: k * (rightRadius - tape.hub),
    leftAngle: k * (leftFull - leftRadius),
  };
}

/** Instantaneous hub angular speeds (rad/s) for a tape velocity in mm/s (+ = toward right hub). */
export function hubSpeeds(tape: TapeSpec, wound: number, velocity: number): { left: number; right: number } {
  const p = reelPose(tape, wound);
  return { left: velocity / p.leftRadius, right: velocity / p.rightRadius };
}

/**
 * Winding: the motor turns the take-up hub at a near-constant angular speed, so tape speed grows
 * with the take-up pack radius. `direction` +1 winds toward the right hub, −1 toward the left.
 * The angular speed is chosen so a full wind takes about `windSeconds`.
 */
export function windStep(tape: TapeSpec, wound: number, direction: 1 | -1, dt: number, windSeconds: number): number {
  const meanRadius = (tape.hub + FULL_PACK_RADIUS) / 2;
  const omega = tape.length / (meanRadius * Math.max(windSeconds, 0.5));
  const takeUp = direction > 0 ? packRadius(tape, wound) : packRadius(tape, tape.length - wound);
  return clampWound(tape, wound + direction * omega * takeUp * Math.max(dt, 0));
}

/** How long a full wind should take for a programme of this length: brisk, never a blur. */
export function windSecondsFor(tape: TapeSpec): number {
  return clamp(tape.length / tape.speed / 7, 3, 9);
}

/** Direction the tape moves while playing a side (+1 = toward the right hub). */
export const playDirection = (side: Side): 1 | -1 => (side === 'A' ? 1 : -1);
