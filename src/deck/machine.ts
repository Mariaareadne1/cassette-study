/**
 * The deck: one authoritative state for door, cassette and transport. Pure and time-stepped, so it
 * runs identically in the browser, in unit tests and in deterministic demo capture.
 *
 * It never touches audio or WebGL. The controller reads `snapshot()` to pose the scene and drives
 * audio from `mode`; while playing, audio time is fed back in through `syncFromAudio`, so the
 * audio element is the source of truth for position.
 */
import {
  type Side,
  type TapeSpec,
  clamp,
  makeTape,
  playDirection,
  timeAt,
  windSecondsFor,
  windStep,
  woundAt,
} from './transport';

export type DoorState = 'closed' | 'opening' | 'open' | 'closing' | 'obstructed';
export type CassetteState =
  | 'outside'
  | 'held'
  | 'aligned'
  | 'inserting'
  | 'seated'
  | 'ejecting'
  | 'returning'
  | 'flipping';
export type TransportMode = 'stopped' | 'playing' | 'paused' | 'fastForward' | 'rewind' | 'ended';
export type Control = 'play' | 'pause' | 'stop' | 'rewind' | 'fastForward' | 'eject';

export type DeckEvent =
  | { type: 'press'; control: Control }
  | { type: 'doorOpening' }
  | { type: 'doorOpen' }
  | { type: 'doorClosing' }
  | { type: 'doorClosed'; engaged: boolean }
  | { type: 'doorObstructed' }
  | { type: 'cassetteLifted' }
  | { type: 'cassetteSeated' }
  | { type: 'cassetteOut' }
  | { type: 'flipped'; side: Side }
  | { type: 'mode'; mode: TransportMode; from: TransportMode }
  | { type: 'seek'; time: number }
  | { type: 'denied'; reason: string };

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly message?: string;
}

/** Durations (s) of each mechanical transition. The stage shapes the motion inside them. */
export const TIMING = {
  doorOpen: 0.62,
  doorClose: 0.5,
  obstructed: 0.42,
  insert: 0.62,
  eject: 0.78,
  returnHome: 0.5,
  flip: 1.15,
} as const;

export interface DeckSnapshot {
  readonly door: DoorState;
  readonly doorT: number;
  readonly cassette: CassetteState;
  readonly cassetteT: number;
  /** Where the cassette was when the current cassette transition started. */
  readonly cassetteFrom: 'outside' | 'seated' | 'held';
  readonly holdPose: Vec3;
  readonly mode: TransportMode;
  readonly side: Side;
  readonly wound: number;
  readonly tape: TapeSpec;
  readonly time: number;
  readonly duration: number;
  readonly engaged: boolean;
  readonly loaded: boolean;
}

const ok: CommandResult = { ok: true };
const no = (message: string): CommandResult => ({ ok: false, message });

export class Deck {
  private door: DoorState = 'closed';
  private doorT = 1;
  private cassette: CassetteState = 'outside';
  private cassetteT = 1;
  private cassetteFrom: 'outside' | 'seated' | 'held' = 'outside';
  private flipReturn: 'outside' | 'seated' = 'outside';
  private flipDone = false;
  private holdPose: Vec3 = { x: 0, y: 0, z: 0 };
  private pendingInsert = false;
  /** One-tap loading closes the door once the tape is seated. */
  private closeAfterSeat = false;
  /** A transport key pressed while the door was open runs once the door has shut. */
  private queued: 'play' | 'fastForward' | 'rewind' | null = null;
  private mode: TransportMode = 'stopped';
  private side: Side = 'A';
  private tape: TapeSpec;
  private wound: number;
  private durations: Record<Side, number>;
  private events: DeckEvent[] = [];

  constructor(durationA = 30, durationB = 30) {
    this.durations = { A: durationA, B: durationB };
    this.tape = makeTape(durationA, durationB);
    this.wound = woundAt(this.tape, 'A', 0);
  }

  // ───────────────────────── queries ─────────────────────────

  get engaged(): boolean {
    return this.door === 'closed' && this.cassette === 'seated';
  }

  get isRunning(): boolean {
    return this.mode === 'playing' || this.mode === 'fastForward' || this.mode === 'rewind';
  }

  /** Playback time on the active side, clamped to the recording. */
  time(): number {
    return clamp(timeAt(this.tape, this.side, this.wound), 0, this.duration());
  }

  /** Raw tape time on the active side; may be negative (leader) or beyond the recording. */
  rawTime(): number {
    return timeAt(this.tape, this.side, this.wound);
  }

  duration(side: Side = this.side): number {
    return this.durations[side];
  }

  snapshot(): DeckSnapshot {
    return {
      door: this.door,
      doorT: this.doorT,
      cassette: this.cassette,
      cassetteT: this.cassetteT,
      cassetteFrom: this.cassetteFrom,
      holdPose: this.holdPose,
      mode: this.mode,
      side: this.side,
      wound: this.wound,
      tape: this.tape,
      time: this.time(),
      duration: this.duration(),
      engaged: this.engaged,
      loaded: this.cassette === 'seated' || this.cassette === 'inserting',
    };
  }

  /** Drains events emitted since the last call. */
  drain(): DeckEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ───────────────────────── tape ─────────────────────────

  /** Loads a different tape (new recordings). Only allowed while the deck is not running. */
  loadTape(durationA: number, durationB: number, side: Side = 'A', time = 0): void {
    this.setMode('stopped');
    this.durations = { A: Math.max(0, durationA || 0), B: Math.max(0, durationB || 0) };
    this.tape = makeTape(this.durations.A, this.durations.B);
    this.side = side;
    this.wound = woundAt(this.tape, side, time);
  }

  /** Updates a side's duration once the audio metadata is known, keeping the playback time. */
  setDuration(side: Side, duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0 || Math.abs(this.durations[side] - duration) < 1e-3) return;
    const t = this.time();
    this.durations = { ...this.durations, [side]: duration };
    this.tape = makeTape(this.durations.A, this.durations.B);
    this.wound = woundAt(this.tape, this.side, t);
  }

  /** Audio is the source of truth while playing. */
  syncFromAudio(time: number): void {
    if (!Number.isFinite(time)) return;
    this.wound = woundAt(this.tape, this.side, time);
  }

  /** Advances tape for a blank (silent) side, which has no audio clock. */
  advanceBlank(dt: number): void {
    if (this.mode !== 'playing') return;
    const t = this.rawTime() + dt;
    this.wound = woundAt(this.tape, this.side, t);
    if (t >= this.duration()) this.reachEnd();
  }

  seekBy(seconds: number): CommandResult {
    return this.seekTo(this.time() + seconds);
  }

  seekTo(time: number): CommandResult {
    if (this.cassette !== 'seated') return no('No tape in the deck');
    if (!Number.isFinite(time)) return no('Invalid position');
    const t = clamp(time, 0, this.duration());
    this.wound = woundAt(this.tape, this.side, t);
    if (this.mode === 'ended' && t < this.duration() - 0.05) this.setMode('stopped');
    this.emit({ type: 'seek', time: t });
    return ok;
  }

  /** Called when the recording on the active side runs out. */
  reachEnd(): void {
    if (this.mode === 'playing' || this.mode === 'fastForward') {
      this.wound = woundAt(this.tape, this.side, this.duration());
      this.setMode('ended');
    }
  }

  // ───────────────────────── transport controls ─────────────────────────

  press(control: Control): CommandResult {
    this.emit({ type: 'press', control });
    switch (control) {
      case 'play':
        return this.play();
      case 'pause':
        return this.pause();
      case 'stop':
        return this.stop();
      case 'rewind':
        return this.wind(-1);
      case 'fastForward':
        return this.wind(1);
      case 'eject':
        return this.eject();
    }
  }

  private requireEngaged(): CommandResult | null {
    if (this.cassette !== 'seated' && this.cassette !== 'inserting') return this.deny('No tape — insert a cassette first');
    if (this.door === 'opening' || this.door === 'closing') return this.deny('Wait for the door');
    if (this.door !== 'closed') return this.deny('Close the door to play');
    if (this.cassette !== 'seated') return this.deny('The tape is still seating');
    return null;
  }

  /** With a tape loaded but the door open, a transport key shuts the door and then runs. */
  private queueBehindDoor(control: 'play' | 'fastForward' | 'rewind'): boolean {
    const loading = this.pendingInsert && this.closeAfterSeat;
    const loaded = this.cassette === 'seated' || this.cassette === 'inserting' || loading;
    if (!loaded) return false;
    if (this.door === 'open' && this.cassette === 'seated') {
      this.queued = control;
      this.startDoor('closing');
      return true;
    }
    if (this.door === 'closing' || loading || (this.cassette === 'inserting' && this.closeAfterSeat)) {
      this.queued = control;
      return true;
    }
    return false;
  }

  private play(): CommandResult {
    if (this.queueBehindDoor('play')) return ok;
    const blocked = this.requireEngaged();
    if (blocked) return blocked;
    if (this.mode === 'playing') return ok;
    if (this.time() >= this.duration() - 0.05) {
      this.setMode('ended');
      return this.deny(`End of side ${this.side} — rewind or turn the tape over`);
    }
    if (this.rawTime() < 0) this.wound = woundAt(this.tape, this.side, 0);
    this.setMode('playing');
    return ok;
  }

  private pause(): CommandResult {
    if (this.mode === 'playing') {
      this.setMode('paused');
      return ok;
    }
    if (this.mode === 'paused') return this.play();
    return this.deny('Nothing is playing');
  }

  private stop(): CommandResult {
    // Stop holds the tape where it is, as a real deck does; the mechanism disengages.
    this.setMode('stopped');
    return ok;
  }

  private wind(direction: 1 | -1): CommandResult {
    if (this.queueBehindDoor(direction > 0 ? 'fastForward' : 'rewind')) return ok;
    const blocked = this.requireEngaged();
    if (blocked) return blocked;
    const target: TransportMode = direction > 0 ? 'fastForward' : 'rewind';
    if (this.mode === target) {
      this.setMode('stopped');
      return ok;
    }
    const atEnd = direction > 0 ? this.time() >= this.duration() - 0.05 : this.time() <= 0.01;
    if (atEnd) return this.deny(direction > 0 ? 'Already at the end' : 'Already rewound');
    this.setMode(target);
    return ok;
  }

  private eject(): CommandResult {
    this.queued = null;
    this.closeAfterSeat = false;
    if (this.isRunning || this.mode === 'paused') this.setMode('stopped');
    if (this.door === 'opening' || this.door === 'closing' || this.door === 'obstructed') return { ok: false, message: 'busy' };
    if (this.door === 'closed') {
      this.startDoor('opening');
      return ok;
    }
    // Door is open.
    if (this.cassette === 'seated') {
      this.cassetteFrom = 'seated';
      this.startCassette('ejecting');
      return ok;
    }
    if (this.cassette === 'outside') return this.deny('The door is already open');
    return { ok: false, message: 'busy' };
  }

  // ───────────────────────── door & cassette ─────────────────────────

  openDoor(): CommandResult {
    if (this.door !== 'closed') return { ok: false, message: 'busy' };
    if (this.isRunning || this.mode === 'paused') this.setMode('stopped');
    this.queued = null;
    this.startDoor('opening');
    return ok;
  }

  closeDoor(): CommandResult {
    if (this.door !== 'open') return { ok: false, message: 'busy' };
    const inTheWay = ['held', 'aligned', 'inserting', 'ejecting', 'flipping'].includes(this.cassette);
    if (inTheWay) {
      this.door = 'obstructed';
      this.doorT = 0;
      this.emit({ type: 'doorObstructed' });
      return this.deny('Something is in the way of the door');
    }
    this.pendingInsert = false;
    this.startDoor('closing');
    return ok;
  }

  toggleDoor(): CommandResult {
    if (this.door === 'closed') return this.openDoor();
    if (this.door === 'open') return this.closeDoor();
    return { ok: false, message: 'busy' };
  }

  /** Begin dragging the cassette. Returns false when it can't be picked up right now. */
  pickUp(pose: Vec3): CommandResult {
    if (this.cassette === 'seated' && this.door !== 'open') return this.deny('Press eject to open the door');
    if (this.cassette !== 'outside' && this.cassette !== 'seated') return { ok: false, message: 'busy' };
    this.cassetteFrom = this.cassette === 'seated' ? 'seated' : 'outside';
    this.cassette = 'held';
    this.cassetteT = 1;
    this.holdPose = pose;
    this.pendingInsert = false;
    this.emit({ type: 'cassetteLifted' });
    return ok;
  }

  moveHeld(pose: Vec3, nearSlot: boolean): void {
    if (this.cassette !== 'held' && this.cassette !== 'aligned') return;
    this.holdPose = pose;
    this.cassette = nearSlot && this.door === 'open' ? 'aligned' : 'held';
  }

  /** Let go of a dragged cassette: it seats when aligned, otherwise springs home. */
  release(): CommandResult {
    if (this.cassette === 'aligned' && this.door === 'open') {
      this.cassetteFrom = 'held';
      this.startCassette('inserting');
      return ok;
    }
    if (this.cassette === 'held' || this.cassette === 'aligned') {
      this.cassetteFrom = 'held';
      this.startCassette('returning');
      return ok;
    }
    return { ok: false, message: 'not holding' };
  }

  /** Interrupted drag (pointer cancel, Escape, lost focus): always recover to a safe state. */
  cancelHold(): void {
    if (this.cassette === 'held' || this.cassette === 'aligned') {
      this.cassetteFrom = 'held';
      this.startCassette('returning');
    }
  }

  /** One-tap insertion: opens the door if needed, then seats the cassette. */
  insert(): CommandResult {
    if (this.cassette === 'seated') return this.deny('A tape is already in the deck');
    if (this.cassette !== 'outside') return { ok: false, message: 'busy' };
    if (this.door === 'open') {
      this.cassetteFrom = 'outside';
      this.startCassette('inserting');
      return ok;
    }
    if (this.door === 'closed') {
      this.pendingInsert = true;
      this.closeAfterSeat = true;
      this.startDoor('opening');
      return ok;
    }
    this.pendingInsert = this.door === 'opening';
    return this.pendingInsert ? ok : { ok: false, message: 'busy' };
  }

  /** Takes the cassette out to its resting place beside the player. */
  remove(): CommandResult {
    if (this.cassette !== 'seated') return this.deny('No tape in the deck');
    if (this.door === 'closed') return this.deny('Press eject to open the door');
    if (this.door !== 'open') return { ok: false, message: 'busy' };
    this.cassetteFrom = 'seated';
    this.startCassette('ejecting');
    return ok;
  }

  /** Turns the tape over. The tape itself stays where it is, so side B starts where A left off. */
  flip(): CommandResult {
    if (this.cassette === 'seated' && this.door !== 'open') return this.deny('Press eject, then turn the tape over');
    if (this.cassette !== 'outside' && this.cassette !== 'seated') return { ok: false, message: 'busy' };
    if (this.door === 'opening' || this.door === 'closing') return { ok: false, message: 'busy' };
    this.flipReturn = this.cassette === 'seated' ? 'seated' : 'outside';
    this.cassetteFrom = this.flipReturn;
    this.flipDone = false;
    this.startCassette('flipping');
    return ok;
  }

  // ───────────────────────── time ─────────────────────────

  update(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.25));
    this.updateDoor(step);
    this.updateCassette(step);
    if (this.mode === 'fastForward' || this.mode === 'rewind') {
      const dir = this.mode === 'fastForward' ? 1 : -1;
      const along = dir * playDirection(this.side);
      this.wound = windStep(this.tape, this.wound, along as 1 | -1, step, windSecondsFor(this.tape));
      const t = this.rawTime();
      if (dir > 0 && t >= this.duration()) {
        this.wound = woundAt(this.tape, this.side, this.duration());
        this.setMode('ended');
      } else if (dir < 0 && t <= 0) {
        this.wound = woundAt(this.tape, this.side, 0);
        this.setMode('stopped');
      }
    }
  }

  private updateDoor(dt: number): void {
    if (this.door === 'closed' || this.door === 'open') return;
    const length =
      this.door === 'opening' ? TIMING.doorOpen : this.door === 'closing' ? TIMING.doorClose : TIMING.obstructed;
    this.doorT = Math.min(1, this.doorT + dt / length);
    if (this.doorT < 1) return;
    if (this.door === 'opening') {
      this.door = 'open';
      this.emit({ type: 'doorOpen' });
      if (this.pendingInsert && this.cassette === 'outside') {
        this.pendingInsert = false;
        this.cassetteFrom = 'outside';
        this.startCassette('inserting');
      }
    } else if (this.door === 'closing') {
      this.door = 'closed';
      this.emit({ type: 'doorClosed', engaged: this.cassette === 'seated' });
      const queued = this.queued;
      this.queued = null;
      if (queued === 'play' && this.cassette === 'seated') this.play();
      else if (queued && this.cassette === 'seated') this.wind(queued === 'fastForward' ? 1 : -1);
    } else {
      this.door = 'open';
    }
  }

  private updateCassette(dt: number): void {
    const lengths: Partial<Record<CassetteState, number>> = {
      inserting: TIMING.insert,
      ejecting: TIMING.eject,
      returning: TIMING.returnHome,
      flipping: TIMING.flip,
    };
    const length = lengths[this.cassette];
    if (!length) return;
    this.cassetteT = Math.min(1, this.cassetteT + dt / length);
    if (this.cassette === 'flipping' && !this.flipDone && this.cassetteT >= 0.5) {
      this.flipDone = true;
      this.side = this.side === 'A' ? 'B' : 'A';
      if (this.mode === 'ended') this.setMode('stopped');
      this.emit({ type: 'flipped', side: this.side });
    }
    if (this.cassetteT < 1) return;
    if (this.cassette === 'inserting') {
      this.cassette = 'seated';
      this.emit({ type: 'cassetteSeated' });
      if ((this.closeAfterSeat || this.queued) && this.door === 'open') this.startDoor('closing');
      this.closeAfterSeat = false;
    } else if (this.cassette === 'flipping') {
      this.cassette = this.flipReturn;
      if (this.cassette === 'seated') this.emit({ type: 'cassetteSeated' });
    } else {
      this.cassette = 'outside';
      this.emit({ type: 'cassetteOut' });
    }
  }

  private startDoor(state: 'opening' | 'closing'): void {
    this.door = state;
    this.doorT = 0;
    this.emit({ type: state === 'opening' ? 'doorOpening' : 'doorClosing' });
  }

  private startCassette(state: CassetteState): void {
    this.cassette = state;
    this.cassetteT = 0;
  }

  private setMode(mode: TransportMode): void {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    this.emit({ type: 'mode', mode, from });
  }

  private deny(reason: string): CommandResult {
    this.emit({ type: 'denied', reason });
    return no(reason);
  }

  private emit(e: DeckEvent): void {
    this.events.push(e);
  }
}
