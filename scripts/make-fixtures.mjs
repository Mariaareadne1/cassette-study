// Writes tiny deterministic test media: two WAV tones and a PNG. Run: node scripts/make-fixtures.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

function wav(path, seconds, freq, rate = 8000) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9000 * env), 44 + i * 2);
  }
  fs.writeFileSync(path, buf);
}
wav('tests/fixtures/tone-a.wav', 6, 440);
wav('tests/fixtures/tone-b.wav', 4, 660);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'gradients=s=96x96:c0=0x8fb6d9:c1=0xf1e3cf:seed=7', '-frames:v', '1', 'tests/fixtures/art.png']);
fs.writeFileSync('tests/fixtures/not-audio.mp3', 'this is not audio');
console.log('fixtures written');
