// Visual QA: renders the real app in headless Chrome (Metal) and saves screenshots.
// usage: node scripts/shoot.mjs [baseUrl] [outDir] [--w=1440 --h=900] [--shots=hero,side,...]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const pos = args.filter((a) => !a.startsWith('--'));
const base = pos[0] ?? 'http://localhost:5560';
const out = pos[1] ?? 'artifacts/shots';
const W = Number(flag('w', 1440));
const H = Number(flag('h', 900));
const only = flag('shots', '').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });

const SHOTS = {
  hero: [],
  side: [['orbit', 1.25, 0.1]],
  back: [['orbit', 2.6, 0.25]],
  top: [['orbit', -0.2, 0.9]],
  low: [['orbit', -0.6, -0.5]],
  open: [['call', 'toggleDoor'], ['wait', 1.2]],
  out: [['call', 'press', 'eject'], ['wait', 2.4]],
  loaded: [['call', 'insertOrRemove'], ['wait', 3]],
  playing: [['call', 'insertOrRemove'], ['wait', 3], ['call', 'press', 'play'], ['wait', 4]],
  ff: [['call', 'insertOrRemove'], ['wait', 3], ['call', 'press', 'fastForward'], ['wait', 2]],
  reels: [['view', 'reels'], ['wait', 1.5]],
  keys: [['view', 'keys'], ['wait', 1.5]],
};

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
for (const [name, steps] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${base}/?capture`);
  await page.waitForFunction(() => window.__cassette?.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__cassette.stage.advance(1 / 60));
  for (const [kind, a, b] of steps) {
    await page.evaluate(([kind, a, b]) => {
      const { stage, controller } = window.__cassette;
      if (kind === 'orbit') stage.setOrbit(a, b);
      if (kind === 'view') stage.setView(a);
      if (kind === 'call') controller[a](b);
      if (kind === 'wait') for (let i = 0; i < a * 60; i++) stage.advance(1 / 60);
    }, [kind, a, b]);
  }
  await page.evaluate(() => { for (let i = 0; i < 90; i++) window.__cassette.stage.advance(1 / 60); });
  const dbg = await page.evaluate(() => window.__cassette.stage.debug());
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(name, JSON.stringify(dbg));
  await page.close();
}
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
