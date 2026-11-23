/**
 * Collector card: a 4:5 print of the object with the tape's label, title and running times.
 * Drawn on a canvas in the browser and saved as a PNG; nothing is uploaded.
 */
import { drawLabel, LABEL_MM, type Art } from '../engine/textures/label';
import type { Fonts } from '../engine/textures/prints';
import type { TapeMeta } from './schema';

export const CARD = { w: 1080, h: 1350 } as const;

function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Crops the rendered object (a data URL or image) to a centred square-ish frame. */
function drawObject(g: CanvasRenderingContext2D, shot: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / shot.width, h / shot.height) * 1.08;
  const sw = w / scale;
  const sh = h / scale;
  g.drawImage(shot, (shot.width - sw) / 2, (shot.height - sh) / 2, sw, sh, x, y, w, h);
}

export function drawCard(
  g: CanvasRenderingContext2D,
  tape: TapeMeta,
  shot: (CanvasImageSource & { width: number; height: number }) | null,
  art: Art | null,
  fonts: Fonts,
  index = 1,
): void {
  const { w, h } = CARD;
  const m = 72;
  g.fillStyle = '#fbfaf7';
  g.fillRect(0, 0, w, h);
  // Warm paper falloff, like the studio sweep.
  const grad = g.createRadialGradient(w / 2, h * 0.42, 80, w / 2, h * 0.42, h * 0.75);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(232,228,220,0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  g.fillStyle = '#85837d';
  g.font = `500 22px ${fonts.mono}`;
  g.textBaseline = 'alphabetic';
  g.fillText('OBJECT STUDY / 001', m, m + 10);
  g.textAlign = 'right';
  g.fillText(`TAPE № ${String(index).padStart(3, '0')}`, w - m, m + 10);
  g.textAlign = 'left';

  if (shot) {
    drawObject(g, shot, m, m + 48, w - m * 2, 600);
    g.strokeStyle = 'rgba(27,28,31,0.10)';
    g.lineWidth = 2;
    g.strokeRect(m + 1, m + 49, w - m * 2 - 2, 598);
  }

  // The label itself, at print size.
  const lw = w - m * 2;
  const scale = lw / LABEL_MM.w;
  const ly = m + 680;
  g.save();
  g.translate(m, ly);
  g.scale(scale, scale);
  g.shadowColor = 'rgba(20,22,30,0.18)';
  g.shadowBlur = 18 / scale;
  g.shadowOffsetY = 6 / scale;
  g.fillStyle = tape.color;
  g.fillRect(0, 0, LABEL_MM.w, LABEL_MM.h);
  g.shadowColor = 'transparent';
  drawLabel(g, tape, 'A', art, fonts);
  g.restore();

  const ty = ly + LABEL_MM.h * scale + 88;
  g.fillStyle = '#1b1c1f';
  g.font = `400 72px ${fonts.serif}`;
  g.fillText(tape.title.slice(0, 40), m, ty);
  g.fillStyle = '#4a4a48';
  g.font = `400 26px ${fonts.mono}`;
  if (tape.note) g.fillText(tape.note.slice(0, 60), m, ty + 48);

  const row = (side: 'A' | 'B', y: number): void => {
    const s = tape.sides[side];
    g.fillStyle = '#1b1c1f';
    g.font = `400 30px ${fonts.serif}`;
    g.fillText(`${side}  ${s.label}`.slice(0, 44), m, y);
    g.font = `400 24px ${fonts.mono}`;
    g.fillStyle = '#85837d';
    g.textAlign = 'right';
    g.fillText(s.audioKey || tape.builtIn ? clock(s.duration) : 'blank', w - m, y);
    g.textAlign = 'left';
  };
  g.strokeStyle = 'rgba(27,28,31,0.14)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(m, ty + 84);
  g.lineTo(w - m, ty + 84);
  g.stroke();
  row('A', ty + 130);
  row('B', ty + 176);

  g.fillStyle = '#85837d';
  g.font = `400 20px ${fonts.mono}`;
  g.fillText('cassette study · rendered in the browser', m, h - 48);
}

export function cardCanvas(
  tape: TapeMeta,
  shot: (CanvasImageSource & { width: number; height: number }) | null,
  art: Art | null,
  fonts: Fonts,
  index?: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CARD.w;
  c.height = CARD.h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas is unavailable.');
  drawCard(g, tape, shot, art, fonts, index);
  return c;
}
