/**
 * Mechanical sound, synthesised with Web Audio: quiet, short, and specific to each action.
 * Works with any BaseAudioContext, so the demo capture can render the exact same sounds offline.
 * Every one-shot node is scheduled to stop, so the graph cleans itself up; loops are held and
 * released explicitly.
 */

export type Cue =
  | 'key'
  | 'latch'
  | 'eject'
  | 'lidOpen'
  | 'lidClose'
  | 'insert'
  | 'seat'
  | 'engage'
  | 'stop'
  | 'deny'
  | 'flip'
  | 'lift';

interface Loop {
  stop: (at?: number) => void;
  setRate?: (r: number) => void;
}

export class Sfx {
  private noise: AudioBuffer | null = null;
  private motor: Loop | null = null;
  private wind: Loop | null = null;
  /** Seeded so offline renders of the same timeline are identical. */
  private seed = 0x2f6b1d;
  /** Offline contexts render after scheduling, so nodes must not be torn down on a wall-clock timer. */
  private readonly offline: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
  ) {
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  private later(fn: () => void): void {
    if (!this.offline) setTimeout(fn, 400);
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.floor(this.ctx.sampleRate * 1.5);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x3fffffff - 1) * 0.9;
    }
    this.noise = b;
    return b;
  }

  /** Band-limited noise burst. */
  private tick(at: number, freq: number, q: number, gain: number, decay: number, dest = this.out): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(bp).connect(g).connect(dest);
    src.start(at, this.rand() * 1.2);
    src.stop(at + decay + 0.02);
  }

  /** Damped sine: metal ring or plastic body resonance. */
  private ping(at: number, freq: number, gain: number, decay: number, toFreq?: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, at);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + decay + 0.02);
  }

  /** Slow filtered noise swell: a lid sliding on its hinge. */
  private swish(at: number, dur: number, from: number, to: number, gain: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, at);
    bp.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, at + dur);
    src.connect(bp).connect(g).connect(this.out);
    src.start(at, this.rand());
    src.stop(at + dur + 0.02);
  }

  play(cue: Cue, at = this.ctx.currentTime): void {
    const t = at + 0.002;
    switch (cue) {
      case 'key':
        this.tick(t, 3400, 2.5, 0.16, 0.025);
        this.ping(t, 190, 0.08, 0.04);
        this.tick(t + 0.045, 2600, 3, 0.07, 0.02);
        break;
      case 'latch':
        this.tick(t, 3000, 2.2, 0.18, 0.03);
        this.ping(t, 160, 0.11, 0.06);
        this.tick(t + 0.03, 1800, 4, 0.1, 0.03);
        break;
      case 'eject':
        this.tick(t, 2200, 1.6, 0.2, 0.05);
        this.ping(t + 0.004, 2380, 0.035, 0.22);
        this.ping(t + 0.004, 3710, 0.02, 0.16);
        this.ping(t + 0.01, 620, 0.05, 0.14, 330);
        break;
      case 'lidOpen':
        this.swish(t, 0.36, 700, 2400, 0.05);
        this.tick(t + 0.34, 1500, 2, 0.06, 0.05);
        break;
      case 'lidClose':
        this.swish(t, 0.28, 2000, 800, 0.04);
        this.ping(t + 0.3, 150, 0.16, 0.08);
        this.tick(t + 0.3, 2800, 2, 0.2, 0.035);
        this.tick(t + 0.33, 4200, 3, 0.08, 0.02);
        break;
      case 'insert':
        this.tick(t, 1900, 2, 0.12, 0.03);
        this.ping(t, 240, 0.07, 0.05);
        break;
      case 'seat':
        this.tick(t, 2400, 2.4, 0.17, 0.035);
        this.ping(t, 210, 0.12, 0.07);
        this.tick(t + 0.035, 3600, 3, 0.09, 0.02);
        break;
      case 'engage':
        this.ping(t, 120, 0.12, 0.09);
        this.tick(t, 900, 1.2, 0.12, 0.06);
        break;
      case 'stop':
        this.tick(t, 1200, 1.5, 0.12, 0.05);
        this.ping(t, 140, 0.08, 0.07);
        break;
      case 'deny':
        this.tick(t, 900, 3, 0.08, 0.03);
        this.tick(t + 0.09, 800, 3, 0.06, 0.03);
        break;
      case 'flip':
        this.swish(t, 0.5, 900, 1600, 0.035);
        break;
      case 'lift':
        this.tick(t, 1500, 2, 0.06, 0.03);
        break;
    }
  }

  /** Motor and tape hiss while playing. */
  startMotor(at = this.ctx.currentTime): void {
    if (this.motor) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(96, at + 0.25);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0, at);
    og.gain.linearRampToValueAtTime(0.012, at + 0.2);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.loop = true;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, at);
    ng.gain.linearRampToValueAtTime(0.006, at + 0.3);
    o.connect(lp).connect(og).connect(this.out);
    n.connect(hp).connect(ng).connect(this.out);
    o.start(at);
    n.start(at);
    this.motor = {
      stop: (when = this.ctx.currentTime) => {
        og.gain.cancelScheduledValues(when);
        ng.gain.cancelScheduledValues(when);
        og.gain.setValueAtTime(og.gain.value, when);
        ng.gain.setValueAtTime(ng.gain.value, when);
        og.gain.linearRampToValueAtTime(0, when + 0.18);
        ng.gain.linearRampToValueAtTime(0, when + 0.12);
        o.frequency.exponentialRampToValueAtTime(40, when + 0.18);
        o.stop(when + 0.2);
        n.stop(when + 0.2);
        this.later(() => {
          for (const node of [o, lp, og, n, hp, ng]) node.disconnect();
        });
      },
    };
  }

  stopMotor(at?: number): void {
    this.motor?.stop(at);
    this.motor = null;
  }

  /** Fast-wind whir; pitch follows hub speed via setRate. */
  startWind(at = this.ctx.currentTime): void {
    if (this.wind) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(240, at + 0.35);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.02, at + 0.2);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer();
    n.loop = true;
    const nb = this.ctx.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 3000;
    nb.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, at);
    ng.gain.linearRampToValueAtTime(0.012, at + 0.25);
    o.connect(bp).connect(g).connect(this.out);
    n.connect(nb).connect(ng).connect(this.out);
    o.start(at);
    n.start(at);
    this.wind = {
      setRate: (r: number) => {
        const now = this.offline ? at : this.ctx.currentTime;
        o.frequency.setTargetAtTime(160 + 220 * Math.min(1.6, r), now, 0.1);
      },
      stop: (when = this.ctx.currentTime) => {
        for (const gg of [g, ng]) {
          gg.gain.cancelScheduledValues(when);
          gg.gain.setValueAtTime(gg.gain.value, when);
          gg.gain.linearRampToValueAtTime(0, when + 0.15);
        }
        o.frequency.exponentialRampToValueAtTime(70, when + 0.15);
        o.stop(when + 0.18);
        n.stop(when + 0.18);
        this.later(() => {
          for (const node of [o, bp, g, n, nb, ng]) node.disconnect();
        });
      },
    };
  }

  setWindRate(r: number): void {
    this.wind?.setRate?.(r);
  }

  stopWind(at?: number): void {
    this.wind?.stop(at);
    this.wind = null;
  }

  stopAll(): void {
    this.stopMotor();
    this.stopWind();
  }
}
