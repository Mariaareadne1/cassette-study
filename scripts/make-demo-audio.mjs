// Synthesises the two original demo recordings (Side A / Side B) from scratch and encodes them to
// AAC/M4A with ffmpeg-static. Deterministic: same input, same files. No samples, no third-party audio.
//   node scripts/make-demo-audio.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const SR = 44100;
const OUT = path.resolve('public/audio');
mkdirSync(OUT, { recursive: true });

// ───────────── helpers ─────────────
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const env = (t, a, d, s, r, len) => {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len) return s;
  const k = 1 - (t - len) / r;
  return k > 0 ? s * k * k : 0;
};

function buffer(seconds) {
  const n = Math.ceil(seconds * SR);
  return [new Float32Array(n), new Float32Array(n)];
}

function addVoice(buf, start, dur, fn, pan = 0, gain = 1) {
  const [L, R] = buf;
  const i0 = Math.max(0, Math.floor(start * SR));
  const i1 = Math.min(L.length, Math.floor((start + dur) * SR));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = i0; i < i1; i++) {
    const t = i / SR - start;
    const v = fn(t);
    L[i] += v * gl;
    R[i] += v * gr;
  }
}

/** FM electric piano: bell-ish tine on the attack, warm body under it. */
const epiano = (f, len) => (t) => {
  const e = env(t, 0.004, 1.6, 0.25, 0.5, len);
  const idx = 1.6 * Math.exp(-t * 3.2) + 0.25;
  const mod = Math.sin(2 * Math.PI * f * t) * idx;
  const tine = Math.sin(2 * Math.PI * f * 14 * t) * Math.exp(-t * 18) * 0.12;
  return (Math.sin(2 * Math.PI * f * t + mod) * 0.6 + tine) * e;
};
const bell = (f, len) => (t) => {
  const e = Math.exp(-t * 2.4) * Math.min(1, t / 0.003) * (t < len + 1.2 ? 1 : 0);
  const mod = Math.sin(2 * Math.PI * f * 3.5 * t) * 2.2 * Math.exp(-t * 4);
  return Math.sin(2 * Math.PI * f * t + mod) * e * 0.5;
};
const musicBox = (f) => (t) => {
  const e = Math.exp(-t * 3.6) * Math.min(1, t / 0.002);
  return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 4.01 * t) * Math.exp(-t * 9)) * e * 0.4;
};
const bass = (f, len) => (t) => {
  const e = env(t, 0.01, 0.3, 0.7, 0.12, len);
  const s = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t);
  return Math.tanh(s * 1.4) * e * 0.55;
};
const pad = (f, len) => (t) => {
  const e = env(t, 1.2, 0.8, 0.8, 1.6, len);
  let s = 0;
  for (const d of [-0.11, 0, 0.13]) {
    const ff = f * 2 ** (d / 12);
    const ph = (ff * t) % 1;
    s += (2 * ph - 1) * 0.33;
  }
  return s * e * 0.22;
};
const kick = (t) => {
  const f = 45 + 80 * Math.exp(-t * 28);
  return Math.sin(2 * Math.PI * f * t * (1 - Math.exp(-t * 30)) / 1) * Math.exp(-t * 7) * 0.9;
};
const snare = (t) => (rand() * 2 - 1) * Math.exp(-t * 26) * 0.32 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.25;
const hat = (t) => (rand() * 2 - 1) * Math.exp(-t * 70) * 0.12;

/** One-pole lowpass applied in place. */
function lowpass(buf, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  for (const ch of buf) {
    let y = 0;
    for (let i = 0; i < ch.length; i++) ch[i] = y = (1 - a) * ch[i] + a * y;
  }
}
function highpass(buf, cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  for (const ch of buf) {
    let y = 0;
    let x1 = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      y = a * (y + x - x1);
      x1 = x;
      ch[i] = y;
    }
  }
}

/** Schroeder reverb (4 combs + 2 allpasses per channel). */
function reverb(buf, mix, size = 1) {
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.floor(d * size));
  const aps = [225, 556];
  const out = buf.map((ch, c) => {
    const wet = new Float32Array(ch.length);
    for (const [k, d0] of combs.entries()) {
      const d = d0 + c * 23 + k;
      const line = new Float32Array(d);
      let idx = 0;
      let lp = 0;
      for (let i = 0; i < ch.length; i++) {
        const y = line[idx];
        lp = y * 0.6 + lp * 0.4;
        line[idx] = ch[i] + lp * 0.8;
        wet[i] += y * 0.25;
        idx = (idx + 1) % d;
      }
    }
    for (const d0 of aps) {
      const d = d0 + c * 7;
      const line = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < wet.length; i++) {
        const b = line[idx];
        const x = wet[i];
        line[idx] = x + b * 0.5;
        wet[i] = b - x * 0.5;
        idx = (idx + 1) % d;
      }
    }
    return wet;
  });
  buf.forEach((ch, c) => {
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * (1 - mix) + out[c][i] * mix;
  });
}

/** Tape: slow wow via a modulated delay, gentle saturation, a breath of hiss, fades. */
function tape(buf, seconds) {
  const n = buf[0].length;
  const out = buf.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const d = 0.004 + 0.0011 * Math.sin(2 * Math.PI * 0.55 * t) + 0.00025 * Math.sin(2 * Math.PI * 6.2 * t);
    const p = i - d * SR;
    const j = Math.floor(p);
    const f = p - j;
    for (let c = 0; c < 2; c++) {
      const a = buf[c][Math.max(0, j)] ?? 0;
      const b = buf[c][Math.max(0, j + 1)] ?? 0;
      let v = a + (b - a) * f;
      v = Math.tanh(v * 1.25) / 1.1;
      v += (rand() * 2 - 1) * 0.0022;
      const fade = Math.min(1, t / 1.2, (seconds - t) / 2.2);
      out[c][i] = v * Math.max(0, fade);
    }
  }
  return out;
}

function normalise(buf, peak = 0.89) {
  let m = 0;
  for (const ch of buf) for (const v of ch) m = Math.max(m, Math.abs(v));
  const k = peak / (m || 1);
  for (const ch of buf) for (let i = 0; i < ch.length; i++) ch[i] *= k;
}

function wav(buf) {
  const n = buf[0].length;
  const data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 4, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[0][i])) * 32767), 44 + i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[1][i])) * 32767), 46 + i * 4);
  }
  return data;
}

// ───────────── Side A: "Glass Morning" — 84 bpm electric piano ─────────────
function sideA() {
  const bpm = 84;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = 16;
  const seconds = bars * bar + 2.5;
  const buf = buffer(seconds);
  const chords = [
    [50, [62, 66, 69, 73, 76]], // Dmaj9
    [47, [62, 66, 69, 71, 74]], // Bm9
    [43, [59, 62, 66, 71, 74]], // Gmaj7
    [45, [61, 64, 66, 69, 73]], // A6/9
  ];
  for (let b = 0; b < bars; b++) {
    const t0 = 0.4 + b * bar;
    const [root, notes] = chords[b % 4];
    notes.forEach((n, k) => addVoice(buf, t0 + k * 0.018, bar + 0.6, epiano(midi(n), bar * 0.9), -0.3 + k * 0.15, 0.32));
    if (b % 2 === 1) notes.slice(1, 4).forEach((n, k) => addVoice(buf, t0 + beat * 2.5 + k * 0.015, beat * 1.5, epiano(midi(n + 12), beat), 0.25, 0.12));
    addVoice(buf, t0, beat * 1.4, bass(midi(root - 12), beat * 1.2), 0, 0.9);
    addVoice(buf, t0 + beat * 2.5, beat * 1.2, bass(midi(root - 12 + (b % 4 === 3 ? 2 : 7)), beat), 0, 0.7);
    if (b >= 2) {
      addVoice(buf, t0, 0.6, kick, 0, 0.9);
      addVoice(buf, t0 + beat * 2.25, 0.6, kick, 0, 0.55);
      addVoice(buf, t0 + beat, 0.4, snare, 0.08, 0.8);
      addVoice(buf, t0 + beat * 3, 0.4, snare, 0.08, 0.8);
      for (let h = 0; h < 8; h++) addVoice(buf, t0 + h * beat * 0.5 + (h % 2 ? 0.045 : 0), 0.2, hat, 0.35, h % 2 ? 0.6 : 0.9);
    }
  }
  const melody = [78, 76, 73, 71, 73, 69, 66, 69, 71, 73, 76, 78, 81, 78, 76, 73];
  melody.forEach((n, i) => {
    const t = 0.4 + 8 * bar + i * beat * 2 + (i % 2 ? beat * 0.5 : 0);
    addVoice(buf, t, 3, bell(midi(n), 0.6), 0.2 * Math.sin(i), 0.22);
  });
  highpass(buf, 28);
  reverb(buf, 0.22, 1.05);
  lowpass(buf, 9500);
  const out = tape(buf, seconds);
  normalise(out);
  return out;
}

// ───────────── Side B: "Night Index" — slow pads and a music box ─────────────
function sideB() {
  const bpm = 68;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const bars = 11;
  const seconds = bars * bar + 3;
  const buf = buffer(seconds);
  const chords = [
    [53, [65, 69, 72, 76]], // Fmaj7
    [52, [64, 67, 71, 74]], // Em7
    [50, [62, 65, 69, 72, 76]], // Dm9
    [48, [64, 67, 71, 78]], // Cmaj7#11
  ];
  for (let b = 0; b < bars; b++) {
    const t0 = 0.3 + b * bar;
    const [root, notes] = chords[b % 4];
    notes.forEach((n, k) => addVoice(buf, t0, bar + 2, pad(midi(n), bar), -0.5 + k * 0.33, 0.28));
    addVoice(buf, t0, bar, bass(midi(root - 12), bar * 0.8), 0, 0.5);
    if (b >= 1) addVoice(buf, t0, 0.6, kick, 0, 0.45);
    const arp = [0, 2, 1, 3, 2, 1, 3, 2];
    arp.forEach((a, i) => {
      if (b < 2 && i % 2) return;
      const n = notes[a % notes.length] + 12;
      addVoice(buf, t0 + i * beat * 0.5, 2.5, musicBox(midi(n)), Math.sin(i * 1.7) * 0.5, 0.32);
    });
  }
  highpass(buf, 30);
  reverb(buf, 0.4, 1.3);
  lowpass(buf, 8000);
  const out = tape(buf, seconds);
  normalise(out, 0.85);
  return out;
}

const tmp = path.resolve('artifacts/audio-tmp');
mkdirSync(tmp, { recursive: true });
for (const [name, make, title] of [
  ['side-a', sideA, 'Glass Morning'],
  ['side-b', sideB, 'Night Index'],
]) {
  const w = path.join(tmp, `${name}.wav`);
  writeFileSync(w, wav(make()));
  const out = path.join(OUT, `${name}.m4a`);
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-i', w, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-metadata', `title=${title}`, '-metadata', 'artist=Cassette Study', out],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  console.log(`wrote ${out}`);
}
rmSync(tmp, { recursive: true, force: true });
