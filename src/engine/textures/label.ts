/**
 * Cassette label artwork. Drawn into a canvas that becomes the label texture on the 3D tape, and
 * reused by the collector-card export so both always show the same thing.
 */
import { type TapeMeta, inkFor } from '../../library/schema';
import type { Fonts } from './prints';

export const LABEL_MM = { w: 80, h: 16.5 } as const;
const PX = 14;

export type Art = CanvasImageSource & { width: number; height: number };

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Draws `art` cropped to cover a square at (x, y, size), with a hairline frame. */
export function drawArt(g: CanvasRenderingContext2D, art: Art | null, x: number, y: number, size: number, ink: string): void {
  g.save();
  if (art && art.width > 0 && art.height > 0) {
    const side = Math.min(art.width, art.height);
    const sx = (art.width - side) / 2;
    const sy = (art.height - side) / 2;
    g.drawImage(art, sx, sy, side, side, x, y, size, size);
  } else {
    // Empty artwork well: fine diagonal hatching.
    g.beginPath();
    g.rect(x, y, size, size);
    g.clip();
    g.strokeStyle = ink;
    g.globalAlpha = 0.18;
    g.lineWidth = 0.12;
    for (let i = -size; i < size * 2; i += 0.9) {
      g.beginPath();
      g.moveTo(x + i, y);
      g.lineTo(x + i - size, y + size);
      g.stroke();
    }
  }
  g.restore();
  g.save();
  g.strokeStyle = ink;
  g.globalAlpha = 0.5;
  g.lineWidth = 0.1;
  g.strokeRect(x, y, size, size);
  g.restore();
}

function fit(g: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxW: number, min = size * 0.55): number {
  let s = size;
  g.font = font(s);
  while (s > min && g.measureText(text).width > maxW) {
    s *= 0.94;
    g.font = font(s);
  }
  return s;
}

function ellipsize(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws one side's label into an existing context at mm scale (origin top-left). */
export function drawLabel(g: CanvasRenderingContext2D, tape: TapeMeta, side: 'A' | 'B', art: Art | null, fonts: Fonts): void {
  const { w, h } = LABEL_MM;
  const ink = inkFor(tape.color);
  const meta = tape.sides[side];
  g.save();
  g.fillStyle = tape.color;
  g.fillRect(0, 0, w, h);
  // Card tooth: a whisper of grain.
  g.globalAlpha = 0.045;
  g.fillStyle = ink;
  for (let i = 0; i < 900; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 12345.678) % 1;
    g.fillRect(Math.abs(x) * w, Math.abs(y) * h, 0.08, 0.08);
  }
  g.globalAlpha = 1;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textBaseline = 'alphabetic';
  // Everything on the label is typed, like a home-made tape.
  const serif = (s: number): string => `400 ${s}px ${fonts.serif}`;
  const mono = (s: number, _wt = 400): string => `400 ${s}px ${fonts.serif}`;
  // Headline is the song itself; the artist (or the tape's name) sits under it.
  const song = meta.label || `Side ${side}`;
  const sub = meta.artist || tape.title;
  const third = meta.artist ? tape.title : tape.note || '';
  const dur = formatDuration(meta.duration);

  if (tape.template === 'editorial') {
    drawArt(g, art, w - h, 0, h, ink);
    g.font = serif(7.2);
    fit(g, song, serif, 7.2, w - h - 13);
    g.fillText(ellipsize(g, song, w - h - 13), 3.2, 8.6);
    g.font = mono(1.6);
    g.globalAlpha = 0.85;
    g.fillText(ellipsize(g, sub, w - h - 13), 3.3, 12.2);
    g.fillText(ellipsize(g, third ? `${third}  ·  ${dur}` : dur, w - h - 13), 3.3, 14.4);
    g.globalAlpha = 1;
    g.font = serif(9.5);
    g.textAlign = 'center';
    g.fillText(side, w - h - 4.8, 12.6);
    g.textAlign = 'left';
  } else if (tape.template === 'mono') {
    drawArt(g, art, 1.6, 1.6, h - 3.2, ink);
    const x0 = h + 0.6;
    g.lineWidth = 0.1;
    g.strokeRect(0.8, 0.8, w - 1.6, h - 1.6);
    g.beginPath();
    g.moveTo(x0, 6.3);
    g.lineTo(w - 1.6, 6.3);
    g.moveTo(x0, 11.2);
    g.lineTo(w - 1.6, 11.2);
    g.stroke();
    g.font = mono(1.25);
    g.globalAlpha = 0.7;
    g.fillText('TITLE', x0, 2.9);
    g.fillText('SIDE', x0, 7.9);
    g.fillText('TIME', w - 13, 7.9);
    g.globalAlpha = 1;
    g.font = mono(2.5, 600);
    fit(g, song.toUpperCase(), (s) => mono(s, 600), 2.5, w - x0 - 3);
    g.fillText(ellipsize(g, song.toUpperCase(), w - x0 - 3), x0, 5.5);
    g.font = mono(1.9, 600);
    g.fillText(ellipsize(g, `${side} — ${sub.toUpperCase()}`, w - x0 - 18), x0, 10.4);
    g.fillText(dur, w - 13, 10.4);
    g.font = mono(1.35);
    g.globalAlpha = 0.75;
    g.fillText(ellipsize(g, third.toUpperCase(), w - x0 - 3), x0, 14.3);
    g.globalAlpha = 1;
  } else {
    // Index card: ruled lines, side box, artwork on the right.
    g.lineWidth = 0.08;
    g.globalAlpha = 0.32;
    for (const y of [7.4, 11.0, 14.6]) {
      g.beginPath();
      g.moveTo(10.5, y);
      g.lineTo(w - h - 1.5, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 0.16;
    g.strokeRect(2.2, 2.2, 6.6, 6.6);
    g.font = serif(5.6);
    g.textAlign = 'center';
    g.fillText(side, 5.5, 7.4);
    g.textAlign = 'left';
    g.font = mono(1.15);
    g.globalAlpha = 0.7;
    g.fillText('SIDE', 2.6, 11);
    g.fillText(dur, 2.6, 13.2);
    g.globalAlpha = 1;
    g.font = serif(3.6);
    fit(g, song, serif, 3.6, w - h - 13);
    g.fillText(ellipsize(g, song, w - h - 13), 10.8, 6.8);
    g.font = mono(1.8);
    g.fillText(ellipsize(g, sub, w - h - 13), 10.9, 10.4);
    g.globalAlpha = 0.75;
    g.font = mono(1.5);
    g.fillText(ellipsize(g, third, w - h - 13), 10.9, 14.0);
    g.globalAlpha = 1;
    drawArt(g, art, w - h + 0.8, 1.6, h - 3.2, ink);
  }
  g.restore();
}

/** A fresh label canvas for one side at texture resolution. */
export function labelCanvas(tape: TapeMeta, side: 'A' | 'B', art: Art | null, fonts: Fonts, scale = PX): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(LABEL_MM.w * scale);
  c.height = Math.round(LABEL_MM.h * scale);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.scale(scale, scale);
  drawLabel(g, tape, side, art, fonts);
  return c;
}
