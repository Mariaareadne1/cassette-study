/**
 * Compact cassette, clear shell. Millimetres, centred; Side A faces +Z. Real outer dimensions
 * (100.4 × 63.8 × 12) and hub spacing (42.5) so the transport radii are physically meaningful.
 */
import * as THREE from 'three';
import { FULL_PACK_RADIUS, HUB_RADIUS } from '../../deck/transport';
import type { SurfaceSpec } from '../materials';
import { PRESET } from '../materials';
import { cylinderZ, hub, roundedBox, screwCross, screwHead } from './parts';
import { type P2, RodBuilder, circle, fillet, mergeSheets, roundedRect, sheet } from './rods';
import { HUB_X, HUB_Y } from './player';

export const CASSETTE = { hw: 50.2, hh: 31.9, hd: 6, r: 3.2 } as const;
export const TAPE_Y = -28.9;
export const TAPE_HALF_WIDTH = 1.9;
export const LABEL = { w: 80, h: 16.5, y: 21.4 } as const;
export const ROLLERS = {
  roller: [34.4, -22.6] as P2,
  rollerR: 2.3,
  pin: [26.6, -27.7] as P2,
  pinR: 1.1,
} as const;
export const SCREWS: P2[] = [
  [-45.2, 26.8],
  [45.2, 26.8],
  [-45.2, -26.6],
  [45.2, -26.6],
  [0, -21.6],
];

export type CassetteRig = 'cassette' | 'hubL' | 'hubR' | 'packL' | 'packR';

export interface CassettePart {
  geometry: THREE.BufferGeometry;
  spec: SurfaceSpec | 'pack' | 'label:A' | 'label:B' | 'tape';
  rig: CassetteRig;
  at?: [number, number, number];
  rot?: [number, number, number];
  noProxy?: boolean;
}

export function cassetteGlass(): { rods: THREE.BufferGeometry; sheets: THREE.BufferGeometry } {
  const rods = new RodBuilder();
  const { hw, hh, hd, r } = CASSETTE;
  const w = 0.85;
  const wall = { hw: w, hh: hd - 0.05, rc: 0.8, zc: 0, seg: 5, ends: 'flat' as const };
  const ix = hw - w;
  const iy = hh - w;
  // Perimeter with real openings along the bottom for the head, pinch rollers and capstans.
  rods.add(
    fillet(
      [
        [20.5, -iy],
        [ix, -iy],
        [ix, iy],
        [-ix, iy],
        [-ix, -iy],
        [-20.5, -iy],
      ],
      r - w,
      false,
    ),
    wall,
  );
  for (const s of [-1, 1]) {
    rods.add(
      [
        [s * 7.8, -iy],
        [s * 13.2, -iy],
      ],
      wall,
    );
  }
  // Screw bosses.
  for (const [x, y] of SCREWS) rods.add(circle(x, y, 2.1, 0.45), { hw: 0.65, hh: hd - 0.9, rc: 0.6, zc: 0, seg: 4 }, true);
  // Hub collars on both faces.
  for (const s of [-1, 1]) {
    for (const z of [hd - 0.55, -hd + 0.55]) {
      rods.add(circle(s * HUB_X, HUB_Y, 7.5, 0.5), { hw: 0.65, hh: 0.5, rc: 0.45, zc: z, seg: 3 }, true);
    }
  }
  // Moulded trapezoid at the head end, both faces.
  for (const z of [hd + 0.35, -hd - 0.35]) {
    rods.add(
      fillet(
        [
          [-31.5, -hh + 0.6],
          [-26, -17.6],
          [26, -17.6],
          [31.5, -hh + 0.6],
        ],
        2,
        false,
      ),
      { hw: 0.8, hh: 0.4, rc: 0.38, zc: z, seg: 3 },
    );
  }
  // Window frame ridge between the hubs.
  for (const z of [hd + 0.25, -hd - 0.25]) {
    rods.add(roundedRect(0, HUB_Y + 0.5, 11, 8.5, 3), { hw: 0.5, hh: 0.3, rc: 0.28, zc: z, seg: 3 }, true);
  }
  // Internal guide posts for the tape path.
  for (const s of [-1, 1]) {
    rods.add(circle(s * ROLLERS.roller[0], ROLLERS.roller[1], 1.0, 0.3), { hw: 0.35, hh: hd - 0.9, rc: 0.3, zc: 0, seg: 3 }, true);
  }

  const holes = (): P2[][] => [
    circle(-HUB_X, HUB_Y, 6.6, 0.5).reverse(),
    circle(HUB_X, HUB_Y, 6.6, 0.5).reverse(),
    circle(-33.5, -24, 1.5, 0.3).reverse(),
    circle(33.5, -24, 1.5, 0.3).reverse(),
  ];
  const outline = roundedRect(0, 0, hw - 0.4, hh - 0.4, r - 0.4);
  const sheets = mergeSheets([sheet(outline, hd - 0.85, hd, holes()), sheet(outline, -hd, -hd + 0.85, holes())]);
  return { rods: rods.build(), sheets };
}

/** Annulus whose outer radius is set per frame by the pack shader (aOuter = 1 marks outer verts). */
export function packGeometry(halfWidth = TAPE_HALF_WIDTH, seg = 96): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const outer: number[] = [];
  const index: number[] = [];
  const ringAt = (z: number, nz: number, o: number): number => {
    const base = pos.length / 3;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), z);
      nrm.push(nz === 0 ? Math.cos(a) : 0, nz === 0 ? Math.sin(a) : 0, nz);
      outer.push(o);
    }
    return base;
  };
  for (const nz of [1, -1]) {
    const z = nz * halfWidth;
    const inner = ringAt(z, nz, 0);
    const out = ringAt(z, nz, 1);
    for (let i = 0; i < seg; i++) {
      const a = inner + i;
      const b = inner + ((i + 1) % seg);
      const c = out + i;
      const d = out + ((i + 1) % seg);
      if (nz > 0) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const top = ringAt(halfWidth, 0, 1);
  const bottom = ringAt(-halfWidth, 0, 1);
  for (let i = 0; i < seg; i++) {
    const a = bottom + i;
    const b = bottom + ((i + 1) % seg);
    const c = top + i;
    const d = top + ((i + 1) % seg);
    index.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aOuter', new THREE.Float32BufferAttribute(outer, 1));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), FULL_PACK_RADIUS + 1);
  return g;
}

export function cassetteParts(): CassettePart[] {
  const parts: CassettePart[] = [];
  const { hd } = CASSETTE;
  for (const rig of ['hubL', 'hubR'] as const) {
    parts.push({ geometry: hub(HUB_RADIUS, 6.2, 1.5, 6.8), spec: PRESET.ivory, rig });
    // Leader clamp: the little wedge that holds the tape end in the hub.
    parts.push({ geometry: new THREE.BoxGeometry(3.2, 1.6, 3.4), spec: PRESET.ivory, rig, at: [0, HUB_RADIUS - 0.6, 0], noProxy: true });
  }
  for (const rig of ['packL', 'packR'] as const) parts.push({ geometry: packGeometry(), spec: 'pack', rig });

  // Guide rollers and pins.
  for (const s of [-1, 1]) {
    parts.push({
      geometry: cylinderZ(ROLLERS.rollerR, 4.4, 24),
      spec: { ...PRESET.ivory, color: [0.93, 0.93, 0.92] },
      rig: 'cassette',
      at: [s * ROLLERS.roller[0], ROLLERS.roller[1], 0],
      noProxy: true,
    });
    parts.push({
      geometry: cylinderZ(ROLLERS.pinR, hd * 2 - 1.8, 16),
      spec: PRESET.chrome,
      rig: 'cassette',
      at: [s * ROLLERS.pin[0], ROLLERS.pin[1], 0],
      noProxy: true,
    });
  }
  // Pressure pad on its phosphor-bronze leaf spring, and the hum shield behind it.
  parts.push({ geometry: roundedBox(4, 1.4, 3.6, 0.4, 0.2), spec: PRESET.felt, rig: 'cassette', at: [0, TAPE_Y + 1.15, 0], noProxy: true });
  parts.push({ geometry: roundedBox(16, 0.4, 3, 0.2, 0.08), spec: PRESET.bronze, rig: 'cassette', at: [0, TAPE_Y + 2.1, 0], noProxy: true });
  parts.push({ geometry: roundedBox(8, 3.6, 5.6, 0.4, 0.15), spec: PRESET.satin, rig: 'cassette', at: [0, TAPE_Y + 4.3, 0], noProxy: true });

  // Screws on both faces.
  for (const [x, y] of SCREWS) {
    for (const s of [1, -1]) {
      const rot: [number, number, number] = s > 0 ? [0, 0, 0] : [0, Math.PI, 0];
      parts.push({ geometry: screwHead(1.75), spec: PRESET.chrome, rig: 'cassette', at: [x, y, s * (hd + 0.62)], rot, noProxy: true });
      parts.push({ geometry: screwCross(1.75), spec: PRESET.darkSteel, rig: 'cassette', at: [x, y, s * (hd + 0.64)], rot, noProxy: true });
    }
  }

  // Paper labels.
  const label = new THREE.PlaneGeometry(LABEL.w, LABEL.h);
  parts.push({ geometry: label, spec: 'label:A', rig: 'cassette', at: [0, LABEL.y, hd + 0.06] });
  parts.push({ geometry: label.clone(), spec: 'label:B', rig: 'cassette', at: [0, LABEL.y, -hd - 0.06], rot: [0, Math.PI, 0] });
  return parts;
}

// ───────────────────────── tape ribbon ─────────────────────────

const tangentFrom = (p: P2, c: P2, r: number, pickLowX: boolean): P2 => {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const d = Math.max(Math.hypot(dx, dy), r + 1e-3);
  const base = Math.atan2(dy, dx);
  const off = Math.acos(r / d);
  const a1: P2 = [c[0] + r * Math.cos(base + off), c[1] + r * Math.sin(base + off)];
  const a2: P2 = [c[0] + r * Math.cos(base - off), c[1] + r * Math.sin(base - off)];
  return (a1[0] < a2[0]) === pickLowX ? a1 : a2;
};

/** Polyline of the visible tape path for the current pack radii (cassette-local XY). */
export function tapePath(leftRadius: number, rightRadius: number): P2[] {
  const pts: P2[] = [];
  const rl: P2 = [-ROLLERS.roller[0], ROLLERS.roller[1]];
  const rr: P2 = [ROLLERS.roller[0], ROLLERS.roller[1]];
  const R = ROLLERS.rollerR;
  const leftStart = tangentFrom([rl[0] - R, rl[1]], [-HUB_X, HUB_Y], leftRadius, true);
  const rightEnd = tangentFrom([rr[0] + R, rr[1]], [HUB_X, HUB_Y], rightRadius, false);
  pts.push(leftStart);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (i / 6) * (Math.PI / 2.4);
    pts.push([rl[0] + R * Math.cos(a), rl[1] + R * Math.sin(a)]);
  }
  pts.push([-ROLLERS.pin[0] - 0.3, TAPE_Y], [ROLLERS.pin[0] + 0.3, TAPE_Y]);
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + Math.PI / 2 - Math.PI / 2.4 + (i / 6) * (Math.PI / 2.4);
    pts.push([rr[0] + R * Math.cos(a), rr[1] + R * Math.sin(a)]);
  }
  pts.push(rightEnd);
  return pts;
}

export const TAPE_POINTS = 18;

export function ribbonGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = TAPE_POINTS;
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 3), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 2), 2));
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  return g;
}

/** Writes the current tape path into the ribbon geometry. */
export function updateRibbon(g: THREE.BufferGeometry, path: P2[]): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const n = TAPE_POINTS;
  for (let i = 0; i < n; i++) {
    const p = path[Math.min(i, path.length - 1)];
    const a = path[Math.max(0, Math.min(i, path.length - 1) - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    for (let k = 0; k < 2; k++) {
      pos.setXYZ(i * 2 + k, p[0], p[1], k === 0 ? TAPE_HALF_WIDTH : -TAPE_HALF_WIDTH);
      nrm.setXYZ(i * 2 + k, -ty, tx, 0);
    }
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}
