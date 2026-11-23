// Deterministic demo film of the real app.
//
// The page runs with ?capture: the render loop stops and this script advances the stage one
// frame at a time on a virtual clock (no wall-clock timing anywhere), performing the same
// controller calls a person's clicks would. Every deck event is logged against that clock and
// the soundtrack is rendered offline from the log (same demo recordings, same Sfx code), then
// muxed with the frames by ffmpeg-static.
//
// usage: node scripts/film.mjs --variant=landscape|portrait [--base=http://localhost:5560] [--fps=30] [--keep]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true']; }));
const variant = args.variant ?? 'landscape';
const base = args.base ?? 'http://localhost:5560';
const FPS = Number(args.fps ?? 30);
const DURATION = 28;
const VIEW = variant === 'portrait' ? { width: 540, height: 960, scale: 2 } : { width: 1280, height: 720, scale: 1.5 };

const outDir = path.resolve('demo');
const frameDir = path.join(outDir, 'frames', variant);
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const HERO = { yaw: -0.46, pitch: 0.3 };

/** Camera path: keyframes of [time, yaw, pitch], eased between. */
const ORBIT = [
  [0, -1.05, 0.44],
  [2.6, HERO.yaw, HERO.pitch],
  [5.6, HERO.yaw, HERO.pitch],
  [11.2, 0.42, 0.12],
  [14.6, HERO.yaw, HERO.pitch],
  [22.4, HERO.yaw, HERO.pitch],
  [25.6, -0.7, 0.4],
  [28, -0.56, 0.34],
];
function orbitAt(t) {
  for (let i = 0; i < ORBIT.length - 1; i++) {
    const [t0, y0, p0] = ORBIT[i];
    const [t1, y1, p1] = ORBIT[i + 1];
    if (t <= t1) {
      const k = ease((t - t0) / (t1 - t0));
      return [y0 + (y1 - y0) * k, p0 + (p1 - p0) * k];
    }
  }
  return ORBIT.at(-1).slice(1);
}

/** What happens, when. Each is exactly what the UI calls on a click or key press. */
const ACTIONS = [
  [2.7, 'insertOrRemove'],
  [5.0, 'tapKey', 'play'],
  [8.6, 'view', 'reels'],
  [12.4, 'view', 'hero'],
  [15.2, 'tapKey', 'fastForward'],
  [16.9, 'tapKey', 'play'],
  [19.2, 'tapKey', 'pause'],
  [20.2, 'tapKey', 'eject'],
  [21.2, 'flip'],
  [22.8, 'tapKey', 'play'],
  [25.0, 'view', 'keys'],
  [27.0, 'view', 'hero'],
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.scale });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}/?capture`);
await page.waitForFunction(() => window.__cassette?.ready, null, { timeout: 60000 });
await page.addStyleTag({ content: '*{cursor:none!important} .cs-boot{display:none!important}' });
await page.evaluate(() => {
  const { controller, stage } = window.__cassette;
  stage.setOrbit(-1.05, 0.44);
  for (let i = 0; i < 60; i++) stage.advance(1 / 60); // settle springs before frame 0
  controller.startTimeline();
});

const frames = Math.round(DURATION * FPS);
let next = 0;
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = f / FPS;
  const due = [];
  while (next < ACTIONS.length && ACTIONS[next][0] <= t) due.push(ACTIONS[next++]);
  const [yaw, pitch] = orbitAt(t);
  await page.evaluate(
    ({ due, yaw, pitch, dt }) => {
      const { controller, stage } = window.__cassette;
      for (const [, kind, arg] of due) {
        if (kind === 'view') stage.setView(arg);
        else controller[kind](arg);
      }
      stage.setOrbit(yaw, pitch);
      stage.advance(dt);
    },
    { due, yaw, pitch, dt: 1 / FPS },
  );
  await page.screenshot({ path: path.join(frameDir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  if (f % 60 === 0) process.stdout.write(`\r${variant}: frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
process.stdout.write('\n');

const timeline = await page.evaluate(() => window.__cassette.controller.takeTimeline());
fs.writeFileSync(path.join(outDir, `timeline-${variant}.json`), JSON.stringify(timeline, null, 1));
const b64 = await page.evaluate(({ tl, d }) => window.__cassette.soundtrack(tl, d), { tl: timeline, d: DURATION });
const wavPath = path.join(outDir, 'frames', `${variant}.wav`);
fs.writeFileSync(wavPath, Buffer.from(b64, 'base64'));
await browser.close();
if (errors.length) console.warn('page errors:\n' + errors.join('\n'));

const mp4 = path.join(outDir, `cassette-study-${variant}.mp4`);
execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', path.join(frameDir, '%05d.jpg'),
  '-i', wavPath,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-shortest', '-movflags', '+faststart',
  mp4,
]);
console.log('wrote', mp4, `${(fs.statSync(mp4).size / 1048576).toFixed(1)} MB`);
if (!args.keep) fs.rmSync(frameDir, { recursive: true, force: true });
