/**
 * Real playback. One HTMLAudioElement per side, routed through Web Audio for volume, mute and an
 * analyser (used by tests to prove sound is actually flowing). The element's currentTime is the
 * source of truth for tape position while playing.
 */
import type { Side } from './transport';

export class AudioUnavailableError extends Error {}

const LOAD_TIMEOUT_MS = 20000;

interface Channel {
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode | null;
  url: string | null;
  duration: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly channels: Record<Side, Channel>;
  private volume = 0.8;
  private sfxVolume = 0.6;
  private muted = false;
  private rampTimer = 0;
  onEnded: (side: Side) => void = () => {};
  onError: (side: Side, message: string) => void = () => {};

  constructor() {
    const make = (side: Side): Channel => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
      el.addEventListener('ended', () => this.onEnded(side));
      return { el, node: null, url: null, duration: 0 };
    };
    this.channels = { A: make('A'), B: make('B') };
  }

  /** Creates/resumes the AudioContext. Must be called from a user gesture. */
  unlock(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.music.connect(this.analyser);
        this.music.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.applyGains();
        for (const ch of Object.values(this.channels)) this.route(ch);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get sfxOutput(): GainNode | null {
    return this.sfxBus;
  }

  /** A live copy of everything the player sounds (music and mechanism), for recording a demo. */
  tap(): { stream: MediaStream; release: () => void } | null {
    const ctx = this.unlock();
    const master = this.master;
    if (!ctx || !master) return null;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    return { stream: dest.stream, release: () => master.disconnect(dest) };
  }

  private route(ch: Channel): void {
    if (!this.ctx || !this.music || ch.node) return;
    try {
      ch.node = this.ctx.createMediaElementSource(ch.el);
      ch.node.connect(this.music);
    } catch {
      // Already routed or unsupported: element still plays directly, volume via el.volume.
      ch.node = null;
    }
  }

  private applyGains(): void {
    const on = this.muted ? 0 : 1;
    if (this.music && this.ctx) this.music.gain.setTargetAtTime(this.volume ** 1.6 * on, this.ctx.currentTime, 0.02);
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(this.sfxVolume * on, this.ctx.currentTime, 0.02);
    for (const ch of Object.values(this.channels)) {
      if (!ch.node) ch.el.volume = this.volume ** 1.6 * on;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGains();
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.applyGains();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGains();
  }

  /** Loads a recording for a side; resolves with its duration. `null` makes the side blank. */
  load(side: Side, url: string | null): Promise<number> {
    const ch = this.channels[side];
    ch.el.pause();
    if (!url) {
      ch.url = null;
      ch.duration = 0;
      ch.el.removeAttribute('src');
      ch.el.load();
      return Promise.resolve(0);
    }
    if (ch.url === url && ch.duration > 0) return Promise.resolve(ch.duration);
    ch.url = url;
    ch.duration = 0;
    return new Promise<number>((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer);
        ch.el.removeEventListener('loadedmetadata', onMeta);
        ch.el.removeEventListener('error', onError);
      };
      const onMeta = (): void => {
        const d = ch.el.duration;
        if (!Number.isFinite(d) || d <= 0) {
          done();
          reject(new Error('This recording has no readable length.'));
          return;
        }
        ch.duration = d;
        done();
        resolve(d);
      };
      const onError = (): void => {
        done();
        ch.url = null;
        reject(new Error(describeMediaError(ch.el.error)));
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error('The recording took too long to open.'));
      }, LOAD_TIMEOUT_MS);
      ch.el.addEventListener('loadedmetadata', onMeta);
      ch.el.addEventListener('error', onError);
      ch.el.src = url;
      ch.el.load();
    });
  }

  hasAudio(side: Side): boolean {
    return this.channels[side].url !== null;
  }

  duration(side: Side): number {
    return this.channels[side].duration;
  }

  currentTime(side: Side): number {
    return this.channels[side].el.currentTime;
  }

  isPlaying(side: Side): boolean {
    const el = this.channels[side].el;
    return !el.paused && !el.ended;
  }

  seek(side: Side, time: number): void {
    const ch = this.channels[side];
    if (!ch.url) return;
    const t = Math.min(Math.max(0, time), Math.max(0, ch.duration - 0.01));
    try {
      ch.el.currentTime = t;
    } catch {
      // Not seekable yet; the next play() will seek again.
    }
  }

  /** Starts playback at `time` with a short motor spin-up (pitch ramps to speed). */
  async play(side: Side, time: number, spinUp = true): Promise<void> {
    const other = side === 'A' ? 'B' : 'A';
    this.channels[other].el.pause();
    const ch = this.channels[side];
    if (!ch.url) throw new Error('This side is blank.');
    this.unlock();
    this.seek(side, time);
    window.clearInterval(this.rampTimer);
    ch.el.playbackRate = spinUp ? 0.8 : 1;
    try {
      await ch.el.play();
    } catch (err) {
      ch.el.playbackRate = 1;
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') throw new AudioUnavailableError('The browser blocked playback. Press play again.');
      if (name === 'AbortError') return;
      throw new Error(err instanceof Error ? err.message : 'Playback failed.');
    }
    if (spinUp) {
      const start = performance.now();
      this.rampTimer = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / 240);
        ch.el.playbackRate = 0.8 + 0.2 * (1 - (1 - k) ** 2);
        if (k >= 1) window.clearInterval(this.rampTimer);
      }, 16);
    }
  }

  pause(): void {
    window.clearInterval(this.rampTimer);
    for (const ch of Object.values(this.channels)) {
      ch.el.pause();
      ch.el.playbackRate = 1;
    }
  }

  /** RMS of the music bus right now (0 when silent or no context). */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    return Math.sqrt(s / buf.length);
  }

  dispose(): void {
    this.pause();
    for (const ch of Object.values(this.channels)) {
      ch.node?.disconnect();
      ch.el.removeAttribute('src');
      ch.el.load();
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}

function describeMediaError(err: MediaError | null): string {
  switch (err?.code) {
    case 1:
      return 'Loading the recording was interrupted.';
    case 2:
      return 'The recording could not be downloaded.';
    case 3:
      return 'This recording could not be decoded. It may be damaged.';
    case 4:
      return 'This browser can’t play that audio format.';
    default:
      return 'The recording could not be opened.';
  }
}
