/**
 * The cassette player, CS-001. Millimetres; X right, Y up, Z toward the viewer (door side).
 * Clear polycarbonate shell and door are swept rods + sheets; the mechanism is opaque metal.
 */
import * as THREE from 'three';
import type { SurfaceSpec } from '../materials';
import { PRESET } from '../materials';
import { belt, cylinderX, cylinderZ, gear, knurledWheel, plate, ring, roundedBox, screwCross, screwHead } from './parts';
import { type P2, RodBuilder, circle, fillet, mergeSheets, roundedRect, sheet } from './rods';

export const BODY = { hw: 60, hh: 44, hd: 15, r: 9 } as const;
export const DOOR = { hw: 55, hh: 39.6, cy: 0.4, z0: 15.3, z1: 18.4, r: 7 } as const;
export const HINGE = { y: -40.6, z: 15.9 } as const;
export const DOOR_OPEN_ANGLE = THREE.MathUtils.degToRad(44);
/** Where the cassette's centre sits when seated. */
export const SLOT = new THREE.Vector3(0, 4, 5);
export const HUB_X = 21.25;
export const HUB_Y = 2;
export const KEY = { w: 14.2, d: 9.2, h: 7, pitch: 16.8, z: -3.6, travel: 2.6, top: BODY.hh } as const;
export const KEY_ORDER = ['stop', 'rewind', 'play', 'fastForward', 'pause', 'eject'] as const;
export type KeyName = (typeof KEY_ORDER)[number];
export const CAPSTAN: P2 = [17.4, SLOT.y - 27.3];
export const MOTOR: P2 = [36, 23];
export const WHEEL = { x: BODY.hw + 0.4, y: 15, z: -1.5, r: 9.2, w: 3.6 } as const;

const ICY_ABSORB: [number, number, number] = [0.0062, 0.0036, 0.0026];
const CLEAR_ABSORB: [number, number, number] = [0.0046, 0.0034, 0.003];
export const ABSORB = { body: ICY_ABSORB, door: CLEAR_ABSORB };

export type RigName =
  | 'player'
  | 'door'
  | 'spindleL'
  | 'spindleR'
  | 'head'
  | 'pinch'
  | 'flywheel'
  | 'idler'
  | 'pulley'
  | 'wheel'
  | `key:${KeyName}`;

export interface Part {
  geometry: THREE.BufferGeometry;
  spec: SurfaceSpec;
  rig: RigName;
  at?: [number, number, number];
  rot?: [number, number, number];
  /** Excluded from depth proxies (tiny parts never hide glass meaningfully). */
  noProxy?: boolean;
}

export interface Glass {
  rods: THREE.BufferGeometry;
  sheets: THREE.BufferGeometry;
}

export function bodyGlass(): Glass {
  const rods = new RodBuilder();
  const { hw, hh, hd, r } = BODY;
  // Thick wall band all the way round.
  rods.add(roundedRect(0, 0, hw - 1.7, hh - 1.7, r - 1.7), { hw: 1.7, hh: hd - 0.9, rc: 1.6, zc: 0, seg: 6 }, true);
  // Front bezel framing the door, and the back lip.
  rods.add(roundedRect(0, 0, hw - 2.6, hh - 2.6, r - 2.6), { hw: 2.6, hh: 1.0, rc: 0.95, zc: hd - 0.9, seg: 5 }, true);
  rods.add(roundedRect(0, 0, hw - 1.6, hh - 1.6, r - 1.6), { hw: 1.6, hh: 1.0, rc: 0.95, zc: -hd + 0.9, seg: 5 }, true);
  // Door seat gasket ridge.
  rods.add(roundedRect(0, DOOR.cy, DOOR.hw + 0.6, DOOR.hh + 0.6, DOOR.r + 0.6), { hw: 0.45, hh: 0.5, rc: 0.4, zc: hd - 0.3, seg: 3 }, true);
  // Internal screw bosses: tubes running front to back.
  for (const [x, y] of [
    [-hw + 7, hh - 7],
    [hw - 7, hh - 7],
    [-hw + 7, -hh + 7],
    [hw - 7, -hh + 7],
  ] as P2[]) {
    rods.add(circle(x, y, 2.3, 0.5), { hw: 0.75, hh: hd - 1.5, rc: 0.7, zc: -0.5, seg: 4 }, true);
  }
  // Compartment rails the cassette slides against.
  for (const s of [-1, 1]) {
    rods.add(
      [
        [s * 52.4, SLOT.y - 26],
        [s * 52.4, SLOT.y + 26],
      ],
      { hw: 0.9, hh: 3.2, rc: 0.8, zc: SLOT.z - 2.5, seg: 4 },
    );
  }
  // Hinge knuckles on the body.
  const knuckle = { hw: 2.1, hh: 2.1, rc: 2.08, zc: HINGE.z, seg: 6, ends: 'flat' as const };
  for (const [a, b] of [
    [-54.5, -47.6],
    [-21.5, 21.5],
    [47.6, 54.5],
  ]) {
    rods.add(
      [
        [a, HINGE.y],
        [b, HINGE.y],
      ],
      knuckle,
    );
  }
  // Latch catch at the top.
  rods.add(roundedRect(0, DOOR.cy + DOOR.hh + 1.6, 7, 1.0, 0.9), { hw: 0.5, hh: 0.9, rc: 0.45, zc: hd - 0.2, seg: 3 }, true);
  // Battery door outline on the back.
  rods.add(roundedRect(-14, -20, 30, 15, 4), { hw: 0.5, hh: 0.45, rc: 0.4, zc: -hd - 0.35, seg: 3 }, true);
  rods.add(
    fillet(
      [
        [-36, -20],
        [-40, -20],
      ],
      0.1,
      false,
    ),
    { hw: 0.6, hh: 0.6, rc: 0.55, zc: -hd - 0.4, seg: 3 },
  );

  const sheets = mergeSheets([
    sheet(roundedRect(0, 0, hw - 0.8, hh - 0.8, r - 0.8), -hd, -hd + 1.5),
    // A thin inner floor under the keys keeps the top reading as a solid edge.
    sheet(roundedRect(0, hh - 4.2, hw - 3.4, 1.0, 0.9), -hd + 2, hd - 2),
  ]);
  return { rods: rods.build(), sheets };
}

export function doorGlass(): Glass {
  const rods = new RodBuilder();
  const { hw, hh, cy, z0, z1, r } = DOOR;
  const zc = (z0 + z1) / 2;
  rods.add(roundedRect(0, cy, hw - 2.2, hh - 2.2, r - 2.2), { hw: 2.2, hh: (z1 - z0) / 2, rc: 1.5, zc, seg: 6 }, true);
  // Inner window frame stepping down to the pane.
  rods.add(roundedRect(0, cy + 6, 40, 17, 5), { hw: 0.7, hh: 0.55, rc: 0.5, zc: z1 - 0.2, seg: 3 }, true);
  // Finger grip ridges at the top edge.
  for (let i = -2; i <= 2; i++) {
    rods.add(
      [
        [i * 3.2, cy + hh - 5.5],
        [i * 3.2, cy + hh - 2.8],
      ],
      { hw: 0.55, hh: 0.5, rc: 0.45, zc: z1 + 0.1, seg: 3 },
    );
  }
  const knuckle = { hw: 2.0, hh: 2.0, rc: 1.98, zc: HINGE.z, seg: 6, ends: 'flat' as const };
  for (const [a, b] of [
    [-46.8, -22.4],
    [22.4, 46.8],
  ]) {
    rods.add(
      [
        [a, HINGE.y],
        [b, HINGE.y],
      ],
      knuckle,
    );
  }
  // Latch tongue.
  rods.add(
    [
      [-5, cy + hh + 0.4],
      [5, cy + hh + 0.4],
    ],
    { hw: 0.9, hh: 0.8, rc: 0.75, zc: z0 + 0.6, seg: 4 },
  );
  const sheets = mergeSheets([sheet(roundedRect(0, cy, hw - 1.2, hh - 1.2, r - 1.2), z0 + 0.4, z0 + 1.8)]);
  return { rods: rods.build(), sheets };
}

interface PrintSet {
  deck: THREE.Texture;
}

export function playerParts(prints: PrintSet): Part[] {
  const parts: Part[] = [];
  const add = (p: Part): void => {
    parts.push(p);
  };

  // ── Deck chassis plate: brushed aluminium with cut-outs that show the drive train behind it.
  const outline = roundedRect(0, SLOT.y - 2, 52, 36.5, 5);
  const holes = [
    roundedRect(0, HUB_Y + SLOT.y + 1, 9.5, 12, 4).reverse(),
    circle(HUB_X, SLOT.y + HUB_Y, 4.4, 0.5).reverse(),
    circle(-HUB_X, SLOT.y + HUB_Y, 4.4, 0.5).reverse(),
    roundedRect(-38, SLOT.y + 20, 8, 5, 2.5).reverse(),
    roundedRect(38, SLOT.y - 14, 8, 6, 2.5).reverse(),
    circle(CAPSTAN[0], CAPSTAN[1], 1.6, 0.3).reverse(),
  ];
  add({
    geometry: plate(outline, holes, 0.9, 0.2),
    spec: { ...PRESET.brushed, map: prints.deck, mapMode: 2, mapRect: [-52, SLOT.y - 38.5, 1 / 104, 1 / 73], ink: [0.06, 0.065, 0.075] },
    rig: 'player',
    at: [0, 0, -3.4],
  });
  // Posts holding the deck to the back shell.
  for (const [x, y] of [
    [-46, SLOT.y + 30],
    [46, SLOT.y + 30],
    [-46, SLOT.y - 34],
    [46, SLOT.y - 34],
  ] as P2[]) {
    add({ geometry: cylinderZ(1.6, 10.5, 20), spec: PRESET.satin, rig: 'player', at: [x, y, -9.1], noProxy: true });
    add({ geometry: screwHead(1.9), spec: PRESET.chrome, rig: 'player', at: [x, y, -2.95 + 0.8], noProxy: true });
    add({ geometry: screwCross(1.9), spec: PRESET.darkSteel, rig: 'player', at: [x, y, -2.95 + 0.82], noProxy: true });
  }

  // ── Reel spindles (rotate with the hubs).
  for (const [side, rig] of [
    [-1, 'spindleL'],
    [1, 'spindleR'],
  ] as const) {
    const at: [number, number, number] = [side * HUB_X, SLOT.y + HUB_Y, 0];
    add({ geometry: ring(6.6, 2, 1.4, 48), spec: PRESET.satin, rig, at: [0, 0, -2.2] });
    add({ geometry: cylinderZ(3.9, 10.5, 32), spec: PRESET.platinum, rig, at: [0, 0, 2.6] });
    add({ geometry: cylinderZ(2.1, 1.2, 24), spec: PRESET.chrome, rig, at: [0, 0, 8.1], noProxy: true });
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.BoxGeometry(1.1, 2.4, 6.5);
      tooth.translate(0, 4.4, 0);
      tooth.rotateZ((i / 6) * Math.PI * 2);
      add({ geometry: tooth, spec: PRESET.platinum, rig, at: [0, 0, 4.6], noProxy: true });
    }
    void at;
  }

  // ── Behind the deck: flywheel, idler gear, motor, belt.
  add({ geometry: cylinderZ(10.5, 2.4, 64), spec: PRESET.brushed, rig: 'flywheel', at: [0, 0, 0] });
  add({ geometry: ring(10.6, 8.6, 2.6, 64), spec: PRESET.chrome, rig: 'flywheel', at: [0, 0, 0], noProxy: true });
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.BoxGeometry(1.4, 15, 0.6);
    spoke.rotateZ((i / 3) * Math.PI);
    add({ geometry: spoke, spec: PRESET.darkSteel, rig: 'flywheel', at: [0, 0, 1.35], noProxy: true });
  }
  add({ geometry: cylinderZ(1.0, 16, 16), spec: PRESET.chrome, rig: 'player', at: [CAPSTAN[0], CAPSTAN[1], -0.5] });
  add({ geometry: gear(6.2, 28, 1.4, 1.2), spec: PRESET.bronze, rig: 'idler', at: [0, 0, 0] });
  add({ geometry: cylinderZ(8, 14, 40), spec: PRESET.satin, rig: 'player', at: [MOTOR[0], MOTOR[1], -9.3] });
  add({ geometry: ring(8.1, 6.5, 1.2, 40), spec: PRESET.darkSteel, rig: 'player', at: [MOTOR[0], MOTOR[1], -4.4], noProxy: true });
  add({ geometry: cylinderZ(2.0, 2.2, 20), spec: PRESET.chrome, rig: 'pulley', at: [0, 0, 0], noProxy: true });
  add({
    geometry: belt(MOTOR, 2.2, CAPSTAN, 10.8, -7.6, 0.5),
    spec: PRESET.rubber,
    rig: 'player',
    noProxy: true,
  });
  // Copper motor leads to a little contact plate.
  add({ geometry: roundedBox(14, 6, 0.6, 1, 0.15), spec: PRESET.copper, rig: 'player', at: [40, -33, -12.8], noProxy: true });

  // ── Head carriage (moves up when engaged): playback head, erase head, pinch roller lever.
  const headY = SLOT.y - 34.2;
  add({ geometry: roundedBox(11, 6.4, 8.2, 1.4, 0.5), spec: PRESET.chrome, rig: 'head', at: [0, headY, SLOT.z] });
  add({ geometry: new THREE.BoxGeometry(0.35, 0.6, 4.2), spec: PRESET.rubber, rig: 'head', at: [0, headY + 3.25, SLOT.z], noProxy: true });
  add({ geometry: roundedBox(5.4, 4.2, 6, 1, 0.4), spec: PRESET.satin, rig: 'head', at: [-13, headY - 0.8, SLOT.z], noProxy: true });
  add({ geometry: roundedBox(34, 1.2, 9, 0.5, 0.25), spec: PRESET.brushed, rig: 'head', at: [0, headY - 4, SLOT.z], noProxy: true });
  add({ geometry: cylinderZ(3.3, 6.2, 32), spec: PRESET.rubber, rig: 'pinch', at: [0, 0, 0] });
  add({ geometry: cylinderZ(1.3, 6.8, 16), spec: PRESET.chrome, rig: 'pinch', at: [0, 0, 0], noProxy: true });

  // ── Keys on the top edge: satin metal caps on a brushed key bed.
  add({
    geometry: roundedBox(104, KEY.d + 4, 1.2, 1.5, 0.3),
    spec: PRESET.brushed,
    rig: 'player',
    at: [0, KEY.top + 0.45, KEY.z],
    rot: [Math.PI / 2, 0, 0],
  });
  for (const name of KEY_ORDER) {
    const accent = name === 'eject' ? PRESET.icyCap : PRESET.keycap;
    add({
      geometry: roundedBox(KEY.w, KEY.d, KEY.h, 2.2, 1.1),
      spec: { ...accent, brushAxis: [1, 0, 0] },
      rig: `key:${name}`,
      at: [0, KEY.h / 2, 0],
      rot: [Math.PI / 2, 0, 0],
    });
  }

  // ── Volume thumb wheel on the right side, and the headphone socket.
  add({ geometry: knurledWheel(WHEEL.r, WHEEL.w), spec: PRESET.satin, rig: 'wheel' });
  add({ geometry: cylinderX(WHEEL.r * 0.55, WHEEL.w + 0.4, 32), spec: PRESET.chrome, rig: 'wheel', noProxy: true });
  add({ geometry: cylinderX(3.4, 2.2, 32), spec: PRESET.chrome, rig: 'player', at: [BODY.hw + 0.2, -22, 2] });
  add({ geometry: cylinderX(1.9, 2.4, 24), spec: PRESET.rubber, rig: 'player', at: [BODY.hw + 0.5, -22, 2], noProxy: true });

  // ── Hinge pin and door springs.
  add({ geometry: cylinderX(0.9, 109, 16), spec: PRESET.chrome, rig: 'player', at: [0, HINGE.y, HINGE.z], noProxy: true });
  for (const s of [-1, 1]) {
    add({
      geometry: roundedBox(14, 3.2, 0.5, 1.2, 0.15),
      spec: PRESET.chrome,
      rig: 'door',
      at: [s * 30, DOOR.cy - 22, DOOR.z0 - 0.4],
      noProxy: true,
    });
  }
  return parts;
}
