/**
 * Keyed mechanical motion. `curve` is the monotone cubic Hermite spline from Ann Nguyen's CD Case
 * (`CaseStage.js`), used here for spring-released doors and key travel.
 */
import * as THREE from 'three';
import type { DeckSnapshot } from '../../deck/machine';
import { DOOR_OPEN_ANGLE } from '../geometry/player';

export type Curve = (t: number) => number;

export function curve(frames: [number, number][]): Curve {
  const n = frames.length;
  const ts = frames.map((f) => f[0]);
  const vs = frames.map((f) => f[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t: number): number => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (t - ts[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m[i + 1]
    );
  };
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number): number => clamp01(t) ** 2;
export const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

const A = DOOR_OPEN_ANGLE;
/** Spring-released door: a quick kick, a small overshoot, a settle. */
const DOOR_OPEN = curve([
  [0, 0],
  [0.12, 0.16 * A],
  [0.42, 0.86 * A],
  [0.62, 1.045 * A],
  [0.8, 0.985 * A],
  [1, A],
]);
/** Closing by hand: steady, then the latch catches with a tiny bounce. */
const DOOR_CLOSE = curve([
  [0, A],
  [0.25, 0.8 * A],
  [0.7, 0.08 * A],
  [0.8, 0],
  [0.88, 0.022 * A],
  [1, 0],
]);

export function doorAngle(s: Pick<DeckSnapshot, 'door' | 'doorT'>, reduced: boolean): number {
  switch (s.door) {
    case 'closed':
      return 0;
    case 'open':
      return A;
    case 'opening':
      return reduced ? A * ease(s.doorT) : DOOR_OPEN(s.doorT);
    case 'closing':
      return reduced ? A * (1 - ease(s.doorT)) : DOOR_CLOSE(s.doorT);
    case 'obstructed':
      return A * (1 - 0.2 * Math.sin(Math.PI * s.doorT) * (1 - s.doorT * 0.4));
  }
}

/** A rigid pose: position + orientation. */
export interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export const pose = (p = new THREE.Vector3(), q = new THREE.Quaternion()): Pose => ({ p, q });

export function mixPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.p.copy(a.p).lerp(b.p, t);
  out.q.copy(a.q).slerp(b.q, t);
  return out;
}

export function poseFromMatrix(m: THREE.Matrix4, out: Pose): Pose {
  const s = new THREE.Vector3();
  m.decompose(out.p, out.q, s);
  return out;
}

/** Critically damped spring towards a target; returns the new [value, velocity]. */
export function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const nx = (f * x + dt * v + hhoo * target) * det;
  const nv = (v + hoo * (target - x)) * det;
  return [nx, nv];
}
