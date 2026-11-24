/**
 * Printed and engraved markings, drawn once into canvases. All lettering is original; no
 * third-party marks. `fonts.mono` / `fonts.serif` are CSS font-family strings loaded by the page.
 */
import * as THREE from 'three';

export interface Fonts {
  mono: string;
  serif: string;
  sans: string;
}

export const DEFAULT_FONTS: Fonts = {
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
};

/** px per mm for prints: fine enough for 1.2 mm type to stay crisp in macro shots. */
const PX = 22;

function canvas(wMm: number, hMm: number, scale = PX): { c: HTMLCanvasElement; g: CanvasRenderingContext2D; s: number } {
  const c = document.createElement('canvas');
  c.width = Math.round(wMm * scale);
  c.height = Math.round(hMm * scale);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.scale(scale, scale);
  return { c, g, s: scale };
}

export function toTexture(c: HTMLCanvasElement, renderer?: THREE.WebGLRenderer, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const tracked = (g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number, align: 'left' | 'center' | 'right' = 'left'): void => {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  const prev = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => {
    g.fillText(ch, cx, y);
    cx += widths[i] + track;
  });
  g.textAlign = prev;
};

/** Engraving on the deck plate (104 × 73 mm, origin bottom-left; canvas y is flipped by the uv). */
export function deckPrint(fonts: Fonts): HTMLCanvasElement {
  const W = 104;
  const H = 73;
  const { c, g } = canvas(W, H);
  // Canvas y grows downward; the plate's local y grows upward. Flip once here.
  g.translate(0, H);
  g.scale(1, -1);
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  const text = (s: string, x: number, y: number, size: number, track = 0.12, align: 'left' | 'center' | 'right' = 'left', font = fonts.mono, weight = 500): void => {
    g.save();
    g.translate(x, y);
    g.scale(1, -1);
    g.font = `${weight} ${size}px ${font}`;
    tracked(g, s, 0, 0, track, align);
    g.restore();
  };
  // Hub positions relative to the plate: plate spans x −52..52, y (SLOT.y − 38.5)..; hubs at y = 38.5 + 2.
  const hubY = 38.5 + 2;
  for (const s of [-1, 1]) {
    const cx = 52 + s * 21.25;
    g.lineWidth = 0.14;
    g.beginPath();
    g.arc(cx, hubY, 9.4, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = i % 5 === 0 ? 10.0 : 10.3;
      g.lineWidth = i % 5 === 0 ? 0.16 : 0.08;
      g.beginPath();
      g.moveTo(cx + r0 * Math.cos(a), hubY + r0 * Math.sin(a));
      g.lineTo(cx + 11 * Math.cos(a), hubY + 11 * Math.sin(a));
      g.stroke();
    }
    text(s < 0 ? 'SUPPLY' : 'TAKE-UP', cx, hubY - 14.2, 1.55, 0.32, 'center');
  }
  text('CS-001', 6, 66, 3.1, 0.3, 'left', fonts.mono, 600);
  text('STEREO CASSETTE PLAYER', 6, 62.2, 1.5, 0.28);
  text('4.76 cm/s', 98, 66, 1.7, 0.18, 'right');
  text('TYPE I · II', 98, 62.2, 1.5, 0.22, 'right');
  text('TWO SIDES · ONE TAPE', 52, 9.5, 1.5, 0.36, 'center');
  text('◀ A   TAPE TRAVEL   B ▶', 52, 6.2, 1.3, 0.24, 'center');
  text('S/N 0001-1999', 6, 3.4, 1.05, 0.2);
  text('MADE FOR LISTENING', 98, 3.4, 1.05, 0.2, 'right');
  g.lineWidth = 0.12;
  g.beginPath();
  g.moveTo(6, 60.4);
  g.lineTo(44, 60.4);
  g.moveTo(60, 60.4);
  g.lineTo(98, 60.4);
  g.stroke();
  // Fine ruler along the bottom.
  for (let i = 0; i <= 80; i++) {
    const x = 12 + i;
    const h = i % 10 === 0 ? 1.4 : i % 5 === 0 ? 0.9 : 0.5;
    g.lineWidth = 0.07;
    g.beginPath();
    g.moveTo(x, 12.4);
    g.lineTo(x, 12.4 + h);
    g.stroke();
  }
  return c;
}

export const GLYPHS = ['stop', 'rewind', 'play', 'fastForward', 'pause', 'eject'] as const;

/** One key-cap glyph, ink on transparent, square. */
export function keyGlyph(name: (typeof GLYPHS)[number], fonts: Fonts, label: string): HTMLCanvasElement {
  const { c, g } = canvas(14, 9.2, 40);
  g.fillStyle = 'rgba(28,30,34,1)';
  const cx = 7;
  const cy = 3.9;
  const tri = (x: number, dir: 1 | -1, s = 1.25): void => {
    g.beginPath();
    g.moveTo(x - dir * s, cy - s);
    g.lineTo(x + dir * s, cy);
    g.lineTo(x - dir * s, cy + s);
    g.closePath();
    g.fill();
  };
  switch (name) {
    case 'stop':
      g.fillRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
      break;
    case 'play':
      tri(cx + 0.2, 1, 1.45);
      break;
    case 'rewind':
      tri(cx - 0.9, -1);
      tri(cx + 0.9, -1);
      break;
    case 'fastForward':
      tri(cx - 0.9, 1);
      tri(cx + 0.9, 1);
      break;
    case 'pause':
      g.fillRect(cx - 1.2, cy - 1.25, 0.8, 2.5);
      g.fillRect(cx + 0.4, cy - 1.25, 0.8, 2.5);
      break;
    case 'eject':
      g.beginPath();
      g.moveTo(cx - 1.4, cy + 0.2);
      g.lineTo(cx, cy - 1.4);
      g.lineTo(cx + 1.4, cy + 0.2);
      g.closePath();
      g.fill();
      g.fillRect(cx - 1.4, cy + 0.75, 2.8, 0.55);
      break;
  }
  g.font = `600 1.05px ${fonts.mono}`;
  g.fillStyle = 'rgba(28,30,34,0.85)';
  tracked(g, label, cx, 7.6, 0.16, 'center');
  return c;
}

/** Screen print on the inside of the door pane: wordmark, reel window frame, travel arrows. */
export function doorPrint(fonts: Fonts, w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const ink = 'rgba(246,247,250,0.94)';
  g.strokeStyle = ink;
  g.fillStyle = ink;
  // Reel window frame (matches the inner rod frame on the door).
  const fx = w / 2;
  const fy = h / 2 - 6;
  g.lineWidth = 0.32;
  roundRect(g, fx - 41.2, fy - 18.2, 82.4, 36.4, 6);
  g.stroke();
  g.lineWidth = 0.1;
  roundRect(g, fx - 42.4, fy - 19.4, 84.8, 38.8, 7);
  g.stroke();
  for (let i = 0; i <= 40; i++) {
    const x = fx - 30 + i * 1.5;
    const tall = i % 10 === 0 ? 1.4 : i % 5 === 0 ? 0.9 : 0.5;
    g.lineWidth = 0.08;
    g.beginPath();
    g.moveTo(x, fy + 18.2);
    g.lineTo(x, fy + 18.2 + tall);
    g.stroke();
  }
  g.font = `400 6.4px ${fonts.serif}`;
  g.textBaseline = 'alphabetic';
  g.fillText('Cassette', 6.2, h - 6.6);
  g.font = `500 1.5px ${fonts.mono}`;
  tracked(g, 'MODEL CS-001', 6.4, h - 3.4, 0.36);
  tracked(g, 'AUTO STOP · FULL LOGIC', w - 6.4, h - 3.4, 0.3, 'right');
  g.font = `500 1.9px ${fonts.mono}`;
  tracked(g, '◀  A', fx - 41, fy - 21.2, 0.3);
  tracked(g, 'B  ▶', fx + 41, fy - 21.2, 0.3, 'right');
  tracked(g, 'OPEN ⏏', w - 6.4, 6.6, 0.34, 'right');
  return c;
}

/** Labels printed on the top edge in front of the keys. */
export function keyStrip(fonts: Fonts, labels: string[], pitch: number): HTMLCanvasElement {
  const w = pitch * labels.length;
  const { c, g } = canvas(w, 5);
  g.fillStyle = 'rgba(244,246,250,0.95)';
  g.font = `500 1.35px ${fonts.mono}`;
  labels.forEach((l, i) => tracked(g, l, pitch * (i + 0.5), 3.1, 0.26, 'center'));
  return c;
}

/** Rear panel print: original specification block. */
export function backPrint(fonts: Fonts, w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  g.fillStyle = 'rgba(244,246,250,0.92)';
  g.strokeStyle = 'rgba(244,246,250,0.92)';
  g.font = `400 5px ${fonts.serif}`;
  g.fillText('Cassette', 8, 13);
  g.font = `500 1.6px ${fonts.mono}`;
  const lines = [
    'MODEL CS-001  ·  STEREO CASSETTE PLAYER',
    'DC 3V  (1.5V × 2, SIZE AA)',
    'TAPE SPEED 4.76 cm/s  ·  WOW & FLUTTER 0.15% WRMS',
    'FREQUENCY RESPONSE 40 – 14,000 Hz (TYPE II)',
    'MADE FOR LISTENING.',
  ];
  lines.forEach((l, i) => tracked(g, l, 8, 18.5 + i * 2.6, 0.2));
  g.lineWidth = 0.12;
  g.beginPath();
  g.moveTo(8, 15.2);
  g.lineTo(w - 8, 15.2);
  g.stroke();
  g.font = `500 1.3px ${fonts.mono}`;
  tracked(g, 'BATTERY  ⊕ ⊖', w / 2 - 14, h - 13, 0.3, 'center');
  tracked(g, 'S/N 0001', w - 8, h - 5, 0.24, 'right');
  return c;
}

/** Volume scale next to the thumb wheel (on the right wall). */
export function volumeScale(fonts: Fonts): HTMLCanvasElement {
  const { c, g } = canvas(26, 8);
  g.fillStyle = 'rgba(244,246,250,0.92)';
  g.font = `500 1.4px ${fonts.mono}`;
  tracked(g, 'VOL', 1, 3, 0.3);
  for (let i = 0; i < 10; i++) {
    const r = 0.18 + i * 0.05;
    g.beginPath();
    g.arc(7 + i * 1.8, 2.5, r, 0, Math.PI * 2);
    g.fill();
  }
  tracked(g, 'PHONES', 1, 6.8, 0.3);
  return c;
}

/** Moulded markings on a cassette face: big side letter, type, and the tape travel arrow. */
export function shellPrint(fonts: Fonts, side: 'A' | 'B'): HTMLCanvasElement {
  const { c, g } = canvas(100, 64);
  g.fillStyle = 'rgba(255,255,255,0.82)';
  g.font = `500 7.5px ${fonts.serif}`;
  g.fillText(side, 4.6, 61.2);
  g.font = `500 1.5px ${fonts.mono}`;
  tracked(g, 'CS · 60', 95.6, 59.8, 0.3, 'right');
  tracked(g, 'NORMAL BIAS · TYPE I', 95.6, 61.9, 0.24, 'right');
  tracked(g, `SIDE ${side}`, 50, 46.5, 0.4, 'center');
  g.lineWidth = 0.18;
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.moveTo(38, 49);
  g.lineTo(62, 49);
  g.lineTo(60.5, 48);
  g.stroke();
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
