/**
 * Offline soundtrack for the demo films. The capture script logs every deck event against the
 * frame clock; this replays that log into an OfflineAudioContext using the same demo recordings
 * and the same Sfx synthesis the live app uses, so picture and sound line up sample-accurately.
 * It is a re-render of the session's audio, not a recording of the speakers.
 */
import type { TimelineEntry } from './controller';
import { Sfx, type Cue } from './sfx';
import type { Side } from './transport';

export interface MusicSpan {
  side: Side;
  /** Timeline time the span starts. */
  at: number;
  /** Position in the recording at that moment. */
  offset: number;
  /** Timeline time the span ends (exclusive). */
  until: number;
  spinUp: boolean;
}

const RUNNING = new Set(['playing']);
const WINDING = new Set(['fastForward', 'rewind']);

/** Turns the event log into music spans, motor spans, wind spans and one-shot cues. Pure. */
export function plan(timeline: readonly TimelineEntry[], end: number) {
  const music: MusicSpan[] = [];
  const motor: Array<[number, number]> = [];
  const wind: Array<[number, number]> = [];
  const cues: Array<[number, Cue]> = [];
  let open: MusicSpan | null = null;
  let motorFrom: number | null = null;
  let windFrom: number | null = null;
  for (const e of timeline) {
    if (e.type === 'cue') cues.push([e.t, String(e.detail) as Cue]);
    if (e.type === 'play') {
      const [side, time, how] = String(e.detail).split(':');
      open = { side: side as Side, at: e.t, offset: Number(time), until: end, spinUp: how !== 'resume' };
    }
    if (e.type === 'mode') {
      const mode = String(e.detail);
      if (!RUNNING.has(mode) && open) {
        music.push({ ...open, until: e.t });
        open = null;
      }
      if (RUNNING.has(mode) && motorFrom === null) motorFrom = e.t;
      if (!RUNNING.has(mode) && motorFrom !== null) {
        motor.push([motorFrom, e.t]);
        motorFrom = null;
      }
      if (WINDING.has(mode) && windFrom === null) windFrom = e.t;
      if (!WINDING.has(mode) && windFrom !== null) {
        wind.push([windFrom, e.t]);
        windFrom = null;
      }
    }
  }
  if (open) music.push(open);
  if (motorFrom !== null) motor.push([motorFrom, end]);
  if (windFrom !== null) wind.push([windFrom, end]);
  return { music, motor, wind, cues };
}

export interface RenderOptions {
  duration: number;
  urls: Record<Side, string>;
  musicVolume?: number;
  sfxVolume?: number;
  sampleRate?: number;
}

export async function renderSoundtrack(timeline: readonly TimelineEntry[], o: RenderOptions): Promise<AudioBuffer> {
  const rate = o.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.duration * rate), rate);
  // A gentle limiter keeps the summed music and mechanism under full scale.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(limiter);
  const music = ctx.createGain();
  music.gain.value = (o.musicVolume ?? 0.8) ** 1.6;
  music.connect(master);
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = o.sfxVolume ?? 0.6;
  sfxBus.connect(master);

  const p = plan(timeline, o.duration);
  const buffers: Partial<Record<Side, AudioBuffer>> = {};
  for (const side of new Set(p.music.map((m) => m.side))) {
    const res = await fetch(o.urls[side]);
    buffers[side] = await ctx.decodeAudioData(await res.arrayBuffer());
  }
  for (const m of p.music) {
    const buf = buffers[m.side];
    if (!buf || m.until <= m.at) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, m.at);
    g.gain.linearRampToValueAtTime(1, m.at + 0.02);
    g.gain.setValueAtTime(1, Math.max(m.at + 0.02, m.until - 0.03));
    g.gain.linearRampToValueAtTime(0, m.until);
    if (m.spinUp) {
      src.playbackRate.setValueAtTime(0.8, m.at);
      src.playbackRate.linearRampToValueAtTime(1, m.at + 0.24);
    }
    src.connect(g).connect(music);
    src.start(m.at, Math.min(m.offset, buf.duration - 0.01));
    src.stop(m.until + 0.01);
  }

  const sfx = new Sfx(ctx, sfxBus);
  for (const [a, b] of p.motor) {
    sfx.startMotor(a);
    sfx.stopMotor(b);
  }
  for (const [a, b] of p.wind) {
    sfx.startWind(a);
    sfx.setWindRate(1);
    sfx.stopWind(b);
  }
  for (const [t, cue] of p.cues) sfx.play(cue, t);
  return ctx.startRendering();
}

/** 16-bit PCM WAV. */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string): void => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
