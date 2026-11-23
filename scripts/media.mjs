// Derived media from the rendered films: poster, contact sheet, short loops, README still.
// Verifies each film with ffprobe first. usage: node scripts/media.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const run = (args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args]);
const probe = (file) =>
  JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());

const FILMS = {
  landscape: { file: 'demo/cassette-study-landscape.mp4', w: 1920, h: 1080 },
  portrait: { file: 'demo/cassette-study-portrait.mp4', w: 1080, h: 1920 },
};

for (const [name, f] of Object.entries(FILMS)) {
  const p = probe(f.file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const problems = [];
  if (v?.codec_name !== 'h264') problems.push(`video codec ${v?.codec_name}`);
  if (v?.pix_fmt !== 'yuv420p') problems.push(`pix_fmt ${v?.pix_fmt}`);
  if (v?.width !== f.w || v?.height !== f.h) problems.push(`size ${v?.width}x${v?.height}`);
  if (v?.r_frame_rate !== '30/1') problems.push(`fps ${v?.r_frame_rate}`);
  if (a?.codec_name !== 'aac') problems.push('no AAC audio');
  const dur = Number(p.format.duration);
  if (Math.abs(dur - 28) > 0.1) problems.push(`duration ${dur}`);
  console.log(`${name}: ${v.width}x${v.height} ${v.codec_name} ${v.pix_fmt} ${v.r_frame_rate} · ${a?.codec_name} ${a?.sample_rate}Hz · ${dur.toFixed(2)}s · ${(Number(p.format.size) / 1048576).toFixed(1)} MB${problems.length ? ' — PROBLEMS: ' + problems.join(', ') : ' ✓'}`);
  if (problems.length) process.exitCode = 1;
}

fs.mkdirSync('demo/screenshots', { recursive: true });
fs.mkdirSync('docs/media', { recursive: true });
const L = FILMS.landscape.file;
const P = FILMS.portrait.file;
// Poster: playing, mid-orbit, reels in view.
run(['-ss', '7.2', '-i', L, '-frames:v', '1', 'demo/poster.png']);
run(['-ss', '7.2', '-i', L, '-frames:v', '1', '-vf', 'scale=1600:-1', '-q:v', '2', 'docs/media/hero.jpg']);
// Contact sheet: 12 moments of the landscape film.
run(['-i', L, '-vf', 'fps=12/28,scale=640:-1,tile=4x3:padding=8:margin=8:color=0xfbfaf7', '-frames:v', '1', 'demo/contact-sheet.png']);
// Stills of key states.
for (const [t, n] of [[1.0, 'outside'], [3.4, 'loading'], [7.2, 'playing'], [10.5, 'reels'], [20.9, 'door-open'], [22.0, 'flip'], [26.0, 'keys']]) {
  run(['-ss', String(t), '-i', L, '-frames:v', '1', '-q:v', '3', `demo/screenshots/landscape-${n}.jpg`]);
  run(['-ss', String(t), '-i', P, '-frames:v', '1', '-q:v', '3', `demo/screenshots/portrait-${n}.jpg`]);
}
// Short loops: reels close-up from the landscape film.
run(['-ss', '9.6', '-t', '2.6', '-i', L, '-vf', 'fps=20,crop=1080:1080:420:0,scale=480:480:flags=lanczos', '-loop', '0', '-c:v', 'libwebp', '-quality', '80', 'demo/reels-loop.webp']);
run(['-ss', '9.6', '-t', '2.6', '-i', L, '-vf', 'fps=15,crop=1080:1080:420:0,scale=360:360:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', '-loop', '0', 'demo/reels-loop.gif']);
for (const f of ['demo/poster.png', 'demo/contact-sheet.png', 'demo/reels-loop.webp', 'demo/reels-loop.gif', 'docs/media/hero.jpg']) {
  console.log(f, `${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
