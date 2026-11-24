/**
 * Glue between the deck state machine, real audio, mechanical sound and the 3D stage. Owns no
 * duplicate transport state: the Deck is authoritative, audio time feeds it while playing.
 * React subscribes to a throttled, immutable view of it.
 */
import type * as THREE from 'three';
import type { KeyName } from '../engine/geometry/player';
import type { StageFrame } from '../engine/stage/Stage';
import type { TapeMeta } from '../library/schema';
import { AudioEngine } from './audio';
import { type Control, Deck, type DeckEvent, type DeckSnapshot } from './machine';
import { type Cue, Sfx } from './sfx';
import type { Side } from './transport';

export interface LoadedTape {
  meta: TapeMeta;
  urls: Record<Side, string | null>;
}

export interface ControllerView {
  deck: DeckSnapshot;
  message: { id: number; text: string; tone: 'info' | 'warn' } | null;
  volume: number;
  sfxVolume: number;
  muted: boolean;
  tape: TapeMeta | null;
  loading: boolean;
  level: number;
}

export interface TimelineEntry {
  t: number;
  type: string;
  detail?: string | number;
}

const PLAYABLE: readonly Control[] = ['play', 'pause', 'stop', 'rewind', 'fastForward', 'eject'];

export class DeckController {
  readonly deck = new Deck(30, 30);
  readonly audio = new AudioEngine();
  private sfx: Sfx | null = null;
  private readonly pressed = new Set<KeyName>();
  private readonly listeners = new Set<() => void>();
  private view: ControllerView;
  private volume = 0.8;
  private sfxVolume = 0.6;
  private muted = false;
  private tape: LoadedTape | null = null;
  private loading = false;
  private message: ControllerView['message'] = null;
  private messageId = 0;
  private sinceEmit = 0;
  private clock = 0;
  private timeline: TimelineEntry[] | null = null;
  private keyReleaseTimers = new Map<KeyName, number>();
  private loadToken = 0;
  private waiters: Array<{ pred: (s: DeckSnapshot) => boolean; done: (ok: boolean) => void; left: number }> = [];
  /** Set by the page when deterministic capture drives time instead of audio. */
  virtualClock = false;
  onTapeChanged: (tape: LoadedTape | null) => void = () => {};

  constructor() {
    this.view = this.makeView();
    this.audio.onEnded = (side) => {
      if (side === this.deck.snapshot().side) {
        this.deck.reachEnd();
        this.process();
      }
    };
  }

  // ───────────────────────── subscription (React) ─────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getView = (): ControllerView => this.view;

  private emit(): void {
    this.view = this.makeView();
    for (const l of this.listeners) l();
  }

  private makeView(): ControllerView {
    return {
      deck: this.deck.snapshot(),
      message: this.message,
      volume: this.volume,
      sfxVolume: this.sfxVolume,
      muted: this.muted,
      tape: this.tape?.meta ?? null,
      loading: this.loading,
      level: this.audio.level(),
    };
  }

  /** Frame data for the stage. */
  frame = (): StageFrame => ({ deck: this.deck.snapshot(), pressed: this.pressed, volume: this.volume });

  // ───────────────────────── tape loading ─────────────────────────

  async loadTape(tape: LoadedTape, opts: { side?: Side; time?: number } = {}): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    this.deck.press('stop');
    this.process();
    this.emit();
    const durations: Record<Side, number> = { A: 0, B: 0 };
    const errors: string[] = [];
    for (const side of ['A', 'B'] as const) {
      try {
        durations[side] = await this.audio.load(side, tape.urls[side]);
      } catch (err) {
        errors.push(`Side ${side}: ${err instanceof Error ? err.message : 'could not be opened'}`);
        await this.audio.load(side, null);
      }
    }
    if (token !== this.loadToken) return;
    // A blank side is real tape too: it runs for as long as the other side.
    const longest = Math.max(durations.A, durations.B, 20);
    this.deck.loadTape(durations.A || longest, durations.B || longest, opts.side ?? 'A', opts.time ?? 0);
    this.tape = tape;
    this.loading = false;
    if (errors.length) this.say(errors.join(' · '), 'warn');
    this.onTapeChanged(tape);
    this.emit();
  }

  /**
   * Changes tapes the way a person would: a seated tape is ejected and set down, the label
   * changes while it rests, and the new tape goes back in.
   */
  async swapTape(tape: LoadedTape): Promise<void> {
    const s = this.deck.snapshot();
    const wasIn = s.cassette === 'seated' || s.cassette === 'inserting';
    if (s.cassette !== 'outside' && s.cassette !== 'seated') this.cancelHold();
    if (wasIn) {
      if (s.door === 'closed') this.press('eject');
      await this.until((d) => d.door === 'open', 4);
      this.deck.remove();
      this.process();
      await this.until((d) => d.cassette === 'outside', 4);
    }
    await this.loadTape(tape);
    if (wasIn) this.insertOrRemove();
  }

  /** Resolves once the deck satisfies `pred`, or after `seconds` of deck time. */
  private until(pred: (s: DeckSnapshot) => boolean, seconds: number): Promise<boolean> {
    if (pred(this.deck.snapshot())) return Promise.resolve(true);
    return new Promise((done) => this.waiters.push({ pred, done, left: seconds }));
  }

  private settleWaiters(dt: number): void {
    if (!this.waiters.length) return;
    const s = this.deck.snapshot();
    const pending: typeof this.waiters = [];
    for (const w of this.waiters) {
      const left = w.left - dt;
      if (w.pred(s)) w.done(true);
      else if (left <= 0) w.done(false);
      else pending.push({ ...w, left });
    }
    this.waiters = pending;
  }

  get currentTape(): LoadedTape | null {
    return this.tape;
  }

  // ───────────────────────── intents ─────────────────────────

  private ensureSfx(): void {
    const ctx = this.audio.unlock();
    if (ctx && !this.sfx && this.audio.sfxOutput) this.sfx = new Sfx(ctx, this.audio.sfxOutput);
  }

  press(control: Control): void {
    if (!PLAYABLE.includes(control)) return;
    this.ensureSfx();
    this.log('press', control);
    this.deck.press(control);
    this.process();
  }

  /** Physical key down (pointer). The key stays visibly depressed until keyUp. */
  keyDown(key: KeyName): void {
    this.pressed.add(key);
    this.press(key);
  }

  keyUp(key: KeyName): void {
    this.pressed.delete(key);
  }

  /** Keyboard / accessible strip: a quick visible press of the physical key. */
  tapKey(key: KeyName): void {
    this.pressed.add(key);
    window.clearTimeout(this.keyReleaseTimers.get(key));
    this.keyReleaseTimers.set(
      key,
      window.setTimeout(() => this.pressed.delete(key), 140),
    );
    this.press(key);
  }

  toggleDoor(): void {
    this.ensureSfx();
    this.log('door');
    this.deck.toggleDoor();
    this.process();
  }

  insertOrRemove(): void {
    this.ensureSfx();
    const s = this.deck.snapshot();
    this.log('cassetteTap');
    if (s.cassette === 'seated') this.deck.remove();
    else this.deck.insert();
    this.process();
  }

  flip(): void {
    this.ensureSfx();
    this.log('flip');
    this.deck.flip();
    this.process();
  }

  grab(at: THREE.Vector3): boolean {
    // A seated tape behind a shut door isn't graspable; say nothing so the drag can turn the player.
    const snap = this.deck.snapshot();
    if (snap.cassette === 'seated' && snap.door !== 'open') return false;
    this.ensureSfx();
    const r = this.deck.pickUp({ x: at.x, y: at.y, z: at.z });
    this.process();
    return r.ok;
  }

  moveHeld(at: THREE.Vector3, near: boolean): void {
    const before = this.deck.snapshot().cassette;
    this.deck.moveHeld({ x: at.x, y: at.y, z: at.z }, near);
    if (before === 'held' && this.deck.snapshot().cassette === 'aligned') this.cue('lift');
  }

  drop(): void {
    this.log('drop');
    this.deck.release();
    this.process();
  }

  cancelHold(): void {
    this.deck.cancelHold();
    this.process();
  }

  seekBy(seconds: number): void {
    this.deck.seekBy(seconds);
    this.process();
  }

  seekTo(seconds: number): void {
    this.deck.seekTo(seconds);
    this.process();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.audio.setVolume(this.volume);
    this.emit();
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.audio.setSfxVolume(this.sfxVolume);
    this.emit();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.audio.setMuted(m);
    this.emit();
  }

  say(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.message = { id: ++this.messageId, text, tone };
    this.emit();
  }

  // ───────────────────────── time ─────────────────────────

  tick = (dt: number): void => {
    this.clock += dt;
    this.deck.update(dt);
    const s = this.deck.snapshot();
    if (s.mode === 'playing') {
      if (this.virtualClock || !this.audio.hasAudio(s.side)) {
        this.deck.advanceBlank(dt);
      } else if (this.audio.isPlaying(s.side)) {
        this.deck.syncFromAudio(this.audio.currentTime(s.side));
        if (this.audio.currentTime(s.side) >= s.duration - 0.03) this.deck.reachEnd();
      }
    }
    if (s.mode === 'fastForward' || s.mode === 'rewind') this.sfx?.setWindRate(1);
    this.process(false);
    this.settleWaiters(dt);
    this.sinceEmit += dt;
    if (this.sinceEmit > 0.1) {
      this.sinceEmit = 0;
      this.emit();
    }
  };

  /** Applies deck events: audio transport, mechanical sound, feedback. */
  private process(emit = true): void {
    const events = this.deck.drain();
    if (!events.length) return;
    for (const e of events) this.apply(e);
    if (emit) this.emit();
    else if (events.some((e) => e.type !== 'seek')) this.emit();
  }

  private cue(c: Cue): void {
    if (this.timeline) this.log('cue', c);
    this.sfx?.play(c);
  }

  private apply(e: DeckEvent): void {
    switch (e.type) {
      case 'press':
        this.cue(e.control === 'play' || e.control === 'fastForward' || e.control === 'rewind' || e.control === 'pause' ? 'latch' : 'key');
        if (e.control === 'eject') this.cue('eject');
        break;
      case 'doorOpening':
        this.cue('lidOpen');
        break;
      case 'doorClosing':
        this.cue('lidClose');
        break;
      case 'doorClosed':
        if (e.engaged) this.cue('engage');
        this.log('doorClosed', e.engaged ? 'engaged' : 'empty');
        break;
      case 'doorObstructed':
        this.cue('deny');
        break;
      case 'cassetteLifted':
        this.cue('lift');
        break;
      case 'cassetteSeated':
        this.cue('seat');
        this.log('seated');
        break;
      case 'cassetteOut':
        this.cue('insert');
        break;
      case 'flipped':
        this.cue('flip');
        this.say(`Side ${e.side}`);
        break;
      case 'mode':
        this.onMode(e.mode, e.from);
        break;
      case 'seek': {
        const s = this.deck.snapshot();
        if (!this.virtualClock) this.audio.seek(s.side, e.time);
        break;
      }
      case 'denied':
        this.cue('deny');
        this.say(e.reason, 'warn');
        break;
    }
  }

  private onMode(mode: DeckSnapshot['mode'], from: DeckSnapshot['mode']): void {
    const s = this.deck.snapshot();
    this.log('mode', mode);
    if (from === 'playing') this.sfx?.stopMotor();
    if (from === 'fastForward' || from === 'rewind') this.sfx?.stopWind();
    if (mode === 'playing') {
      this.log('play', `${s.side}:${s.time.toFixed(4)}:${from === 'paused' ? 'resume' : 'spin'}`);
      this.sfx?.startMotor();
      if (!this.virtualClock && this.audio.hasAudio(s.side)) {
        this.audio.play(s.side, s.time, from !== 'paused').catch((err: unknown) => {
          this.deck.press('stop');
          this.process();
          this.say(err instanceof Error ? err.message : 'Playback failed.', 'warn');
        });
      }
      return;
    }
    this.audio.pause();
    if (mode === 'fastForward' || mode === 'rewind') this.sfx?.startWind();
    if (mode === 'stopped' && (from === 'playing' || from === 'paused')) this.cue('stop');
    if (mode === 'ended') this.say(`End of side ${s.side}`);
  }

  // ───────────────────────── capture support ─────────────────────────

  startTimeline(): void {
    this.timeline = [];
    this.clock = 0;
  }

  takeTimeline(): TimelineEntry[] {
    const t = this.timeline ?? [];
    this.timeline = null;
    return t;
  }

  private log(type: string, detail?: string | number): void {
    this.timeline?.push({ t: this.clock, type, detail });
  }

  dispose(): void {
    this.sfx?.stopAll();
    this.audio.dispose();
    for (const t of this.keyReleaseTimers.values()) window.clearTimeout(t);
    this.listeners.clear();
    for (const w of this.waiters) w.done(false);
    this.waiters = [];
  }
}
