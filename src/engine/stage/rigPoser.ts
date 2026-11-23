/**
 * Turns the deck snapshot into rig transforms each frame: door hinge, cassette path, reels,
 * spindles, head carriage, pinch roller, flywheel, keys and volume wheel.
 */
import * as THREE from 'three';
import type { DeckSnapshot } from '../../deck/machine';
import { reelPose } from '../../deck/transport';
import { tapePath, updateRibbon } from '../geometry/cassette';
import { CAPSTAN, HINGE, KEY, KEY_ORDER, type KeyName, SLOT } from '../geometry/player';
import type { Assembly } from './assembly';
import { type Pose, doorAngle, ease, easeOut, mixPose, pose, span, spring } from './motion';

export interface PoserInput {
  deck: DeckSnapshot;
  pressed: ReadonlySet<KeyName>;
  volume: number;
  /** World pose of the loose cassette's resting place. */
  rest: Pose;
  /** Player orientation (world). */
  player: THREE.Quaternion;
  reduced: boolean;
  time: number;
}

const HEAD_TRAVEL = 2.2;
const PINCH_TRAVEL = 2.6;
const FLIP_LIFT = 26;

export class RigPoser {
  private readonly from: Pose = pose();
  private readonly shown: Pose = pose();
  private lastState = '';
  private lastSide: 'A' | 'B' = 'A';
  private flipFrom: 'A' | 'B' = 'A';
  private keyTravel = new Map<KeyName, [number, number]>();
  private head: [number, number] = [0, 0];
  private pop: [number, number] = [0, 0];
  private flywheel = 0;
  private flySpeed = 0;
  private pinchAngle = 0;
  private spindleOffsetL = 0;
  private spindleOffsetR = 0;
  private readonly tmp = { a: pose(), b: pose(), c: pose(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3() };

  constructor(private readonly asm: Assembly) {
    for (const k of KEY_ORDER) this.keyTravel.set(k, [0, 0]);
  }

  /** Current displayed cassette pose (world). */
  get cassettePose(): Pose {
    return this.shown;
  }

  /** World pose of the seated cassette slot (side-aware). */
  slotPose(side: 'A' | 'B', out: Pose, extra = new THREE.Vector3()): Pose {
    const player = this.asm.rig('player');
    const m = this.tmp.m.compose(
      this.tmp.v.copy(SLOT).add(extra),
      this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side === 'A' ? 0 : Math.PI),
      new THREE.Vector3(1, 1, 1),
    );
    m.premultiply(player.matrixWorld);
    const s = new THREE.Vector3();
    m.decompose(out.p, out.q, s);
    return out;
  }

  /** In front of the open door, where the cassette lines up before sliding home. */
  approachPose(side: 'A' | 'B', out: Pose): Pose {
    return this.slotPose(side, out, new THREE.Vector3(0, 5, 40));
  }

  restPose(side: 'A' | 'B', rest: Pose, out: Pose): Pose {
    out.p.copy(rest.p);
    out.q.copy(rest.q);
    if (side === 'B') out.q.multiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    return out;
  }

  update(dt: number, inp: PoserInput): void {
    const { deck } = inp;
    const player = this.asm.rig('player');
    player.quaternion.copy(inp.player);
    player.updateMatrixWorld(true);

    // Door hinge.
    const door = this.asm.rig('door');
    const angle = doorAngle(deck, inp.reduced);
    door.position.set(0, HINGE.y, HINGE.z);
    door.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    door.position.applyQuaternion(door.quaternion).multiplyScalar(-1).add(new THREE.Vector3(0, HINGE.y, HINGE.z));

    this.poseCassette(dt, inp);
    this.poseTransport(dt, inp);
    this.poseKeys(dt, inp);
    this.asm.rig('wheel').rotation.x = -inp.volume * Math.PI * 1.5;
  }

  private poseCassette(dt: number, inp: PoserInput): void {
    const { deck } = inp;
    const t = deck.cassetteT;
    const state = deck.cassette;
    const key = `${state}`;
    if (key !== this.lastState) {
      // Every transition starts from wherever the cassette is drawn right now: no teleporting.
      this.from.p.copy(this.shown.p);
      this.from.q.copy(this.shown.q);
      if (state === 'flipping') this.flipFrom = this.lastSide;
      this.lastState = key;
    }
    this.lastSide = deck.side;
    const { a, b, c } = this.tmp;
    const side = deck.side;
    const doorOpen = deck.door === 'open' || deck.door === 'opening' || deck.door === 'obstructed';
    // Ejector spring: a seated cassette pops forward a few millimetres when the door opens.
    [this.pop[0], this.pop[1]] = spring(this.pop[0], this.pop[1], doorOpen ? 2.6 : 0, inp.reduced ? 30 : 22, dt);

    switch (state) {
      case 'outside': {
        this.restPose(side, inp.rest, this.shown);
        if (!inp.reduced) this.shown.p.y += Math.sin(inp.time * 0.9) * 0.9;
        break;
      }
      case 'held':
      case 'aligned': {
        b.p.copy(deck.holdPose as THREE.Vector3);
        this.restPose(side, inp.rest, c);
        b.q.copy(c.q);
        if (state === 'aligned') {
          this.approachPose(side, a);
          mixPose(b, a, 0.72, b);
        }
        const k = 1 - Math.exp(-dt * 18);
        mixPose(this.shown, b, k, this.shown);
        break;
      }
      case 'inserting': {
        this.approachPose(side, a);
        this.slotPose(side, b);
        if (t < 0.55) mixPose(this.from, a, ease(t / 0.55), this.shown);
        else {
          const u = span(t, 0.55, 1);
          // Slides in, seats, a hair of rebound as the clips take it.
          const push = u < 0.8 ? easeOut(u / 0.8) * 1.04 : 1.04 - 0.04 * ease((u - 0.8) / 0.2);
          mixPose(a, b, push, this.shown);
        }
        break;
      }
      case 'seated': {
        this.slotPose(side, this.shown, new THREE.Vector3(0, 0, this.pop[0]));
        break;
      }
      case 'ejecting': {
        this.approachPose(side, a);
        this.restPose(side, inp.rest, b);
        if (t < 0.28) mixPose(this.from, a, easeOut(t / 0.28), this.shown);
        else mixPose(a, b, ease(span(t, 0.28, 1)), this.shown);
        break;
      }
      case 'returning': {
        this.restPose(side, inp.rest, b);
        mixPose(this.from, b, easeOut(t), this.shown);
        break;
      }
      case 'flipping': {
        const base = deck.cassetteFrom === 'seated' ? this.slotPose(this.flipFrom, b) : this.restPose(this.flipFrom, inp.rest, b);
        // Lift toward the viewer, turn over about the vertical axis, set back down.
        const lift = deck.cassetteFrom === 'seated' ? new THREE.Vector3(0, 6, FLIP_LIFT + 22) : new THREE.Vector3(0, 8, FLIP_LIFT);
        const liftWorld = deck.cassetteFrom === 'seated' ? lift.applyQuaternion(this.asm.rig('player').quaternion) : lift;
        const up = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7;
        const turn = ease(span(t, 0.18, 0.82));
        this.shown.p.copy(base.p).addScaledVector(liftWorld, up);
        this.shown.q.copy(base.q).multiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * turn));
        // Slight tilt into the turn reads as a hand doing it.
        this.shown.q.multiply(this.tmp.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18 * Math.sin(Math.PI * turn)));
        break;
      }
    }
    const cas = this.asm.rig('cassette');
    cas.position.copy(this.shown.p);
    cas.quaternion.copy(this.shown.q);
  }

  private poseTransport(dt: number, inp: PoserInput): void {
    const { deck } = inp;
    const reels = reelPose(deck.tape, deck.wound);
    this.asm.rig('hubL').rotation.z = reels.leftAngle;
    this.asm.rig('hubR').rotation.z = reels.rightAngle;
    this.asm.rig('packL').rotation.z = reels.leftAngle;
    this.asm.rig('packR').rotation.z = reels.rightAngle;
    this.asm.packMaterials.L.uniforms.uRadius.value = reels.leftRadius;
    this.asm.packMaterials.R.uniforms.uRadius.value = reels.rightRadius;
    updateRibbon(this.asm.ribbon, tapePath(reels.leftRadius, reels.rightRadius));

    // Spindles follow the hubs they engage. Turning the tape over mirrors which hub sits on which
    // spindle and the sense of rotation, because the cassette is rotated 180° about its vertical axis.
    const seated = deck.cassette === 'seated';
    if (seated) {
      const l = deck.side === 'A' ? reels.leftAngle : -reels.rightAngle;
      const r = deck.side === 'A' ? reels.rightAngle : -reels.leftAngle;
      this.spindleOffsetL = l;
      this.spindleOffsetR = r;
    }
    this.asm.rig('spindleL').rotation.z = this.spindleOffsetL;
    this.asm.rig('spindleR').rotation.z = this.spindleOffsetR;
    this.asm.rig('idler').rotation.z = -this.spindleOffsetR * 1.7;

    const engaged = deck.mode === 'playing' || deck.mode === 'paused';
    [this.head[0], this.head[1]] = spring(this.head[0], this.head[1], engaged ? 1 : 0, inp.reduced ? 40 : 26, dt);
    const h = this.head[0];
    this.asm.rig('head').position.y = -HEAD_TRAVEL * (1 - h);
    const pinch = this.asm.rig('pinch');
    pinch.position.set(CAPSTAN[0], CAPSTAN[1] - 4.6 - PINCH_TRAVEL * (1 - h), SLOT.z);

    const motorOn = deck.mode === 'playing' ? 1 : deck.mode === 'fastForward' || deck.mode === 'rewind' ? 1.6 : 0;
    // The flywheel spins up and coasts down: it has mass.
    this.flySpeed += (motorOn * 47.6 - this.flySpeed) * (1 - Math.exp(-dt * (motorOn ? 5 : 2.2)));
    this.flywheel += this.flySpeed * dt * 0.22;
    this.asm.rig('flywheel').rotation.z = -this.flywheel;
    this.asm.rig('pulley').rotation.z = -this.flywheel * 4.9;
    if (deck.mode === 'playing') this.pinchAngle += (deck.tape.speed / 3.3) * dt;
    pinch.rotation.z = this.pinchAngle;
  }

  private poseKeys(dt: number, inp: PoserInput): void {
    const { deck, pressed } = inp;
    const latched: Record<KeyName, boolean> = {
      play: deck.mode === 'playing' || deck.mode === 'paused',
      pause: deck.mode === 'paused',
      fastForward: deck.mode === 'fastForward',
      rewind: deck.mode === 'rewind',
      stop: false,
      eject: false,
    };
    for (const k of KEY_ORDER) {
      const target = pressed.has(k) ? 1 : latched[k] ? 0.62 : 0;
      const s = this.keyTravel.get(k)!;
      [s[0], s[1]] = spring(s[0], s[1], target, inp.reduced ? 60 : 42, dt);
      const rig = this.asm.rig(`key:${k}`);
      rig.position.y = KEY.top + 1.05 - KEY.travel * s[0];
    }
  }
}
