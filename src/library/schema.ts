/**
 * Saved-tape metadata. Versioned and validated on every read, because IndexedDB contents and
 * imported archives are external data.
 */
export const SCHEMA_VERSION = 1;

export type LabelTemplate = 'index' | 'editorial' | 'mono';
export const TEMPLATES: readonly LabelTemplate[] = ['index', 'editorial', 'mono'];

/** Curated label stocks. The first is the default ivory card. */
export const LABEL_COLORS = ['#f3efe6', '#e7ecef', '#f1e3cf', '#dfe6dc', '#e9dde3', '#202226'] as const;

export interface SideMeta {
  label: string;
  /** Blob key in the media store, or null for a blank side. */
  audioKey: string | null;
  audioName: string | null;
  duration: number;
}

export interface TapeMeta {
  schema: number;
  id: string;
  title: string;
  note: string;
  color: string;
  template: LabelTemplate;
  artKey: string | null;
  sides: { A: SideMeta; B: SideMeta };
  createdAt: number;
  updatedAt: number;
  /** Built-in tapes ship with the app and cannot be deleted. */
  builtIn?: boolean;
}

export const LIMITS = {
  title: 60,
  note: 80,
  sideLabel: 48,
  audioBytes: 80 * 1024 * 1024,
  artBytes: 12 * 1024 * 1024,
  maxDuration: 60 * 60,
} as const;

export const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/vnd.wave': 'WAV',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/m4a': 'M4A',
  'audio/aac': 'AAC',
  'audio/x-aac': 'AAC',
};
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|mp4)$/i;
export const ART_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export type Check = { ok: true } | { ok: false; error: string };

/** Fast, synchronous checks on a picked audio file before we try to decode it. */
export function checkAudioFile(file: { name: string; type: string; size: number }): Check {
  const typeOk = file.type ? file.type in AUDIO_TYPES : AUDIO_EXT.test(file.name);
  if (!typeOk && !AUDIO_EXT.test(file.name)) {
    return { ok: false, error: `“${file.name}” isn’t a supported audio file. Use MP3, WAV or M4A/AAC.` };
  }
  if (file.size <= 0) return { ok: false, error: `“${file.name}” is empty.` };
  if (file.size > LIMITS.audioBytes) {
    return { ok: false, error: `“${file.name}” is ${(file.size / 1048576).toFixed(0)} MB. The limit is 80 MB per side.` };
  }
  return { ok: true };
}

export function checkArtFile(file: { name: string; type: string; size: number }): Check {
  if (!ART_TYPES.includes(file.type)) return { ok: false, error: 'Artwork must be a PNG, JPEG, WebP or GIF image.' };
  if (file.size > LIMITS.artBytes) return { ok: false, error: 'Artwork must be smaller than 12 MB.' };
  return { ok: true };
}

const str = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : fallback;
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const key = (v: unknown): string | null => (typeof v === 'string' && /^[\w-]{1,80}$/.test(v) ? v : null);
const COLOR = /^#[0-9a-f]{6}$/i;

function side(v: unknown, name: 'A' | 'B'): SideMeta {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    label: str(o.label, LIMITS.sideLabel, `Side ${name}`),
    audioKey: key(o.audioKey),
    audioName: o.audioName == null ? null : str(o.audioName, 120),
    duration: Math.min(Math.max(num(o.duration), 0), LIMITS.maxDuration),
  };
}

/**
 * Turns unknown data into a valid TapeMeta, or returns an error. Unknown fields are dropped;
 * out-of-range values are clamped; anything structurally wrong is rejected.
 */
export function parseTape(raw: unknown): { ok: true; tape: TapeMeta } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a tape record' };
  const o = raw as Record<string, unknown>;
  const id = key(o.id);
  if (!id) return { ok: false, error: 'Missing or invalid tape id' };
  const schema = num(o.schema, 0);
  if (schema < 1 || schema > SCHEMA_VERSION) return { ok: false, error: `Unsupported tape version ${schema}` };
  if (!o.sides || typeof o.sides !== 'object') return { ok: false, error: 'Missing sides' };
  const sides = o.sides as Record<string, unknown>;
  const template = TEMPLATES.includes(o.template as LabelTemplate) ? (o.template as LabelTemplate) : 'index';
  const color = typeof o.color === 'string' && COLOR.test(o.color) ? o.color : LABEL_COLORS[0];
  const now = Date.now();
  return {
    ok: true,
    tape: {
      schema: SCHEMA_VERSION,
      id,
      title: str(o.title, LIMITS.title, 'Untitled tape') || 'Untitled tape',
      note: str(o.note, LIMITS.note),
      color,
      template,
      artKey: key(o.artKey),
      sides: { A: side(sides.A, 'A'), B: side(sides.B, 'B') },
      createdAt: num(o.createdAt, now),
      updatedAt: num(o.updatedAt, now),
      builtIn: o.builtIn === true ? true : undefined,
    },
  };
}

export function newId(prefix = 'tape'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}-${rnd}`;
}

export function blankTape(): TapeMeta {
  const now = Date.now();
  return {
    schema: SCHEMA_VERSION,
    id: newId(),
    title: 'Untitled tape',
    note: '',
    color: LABEL_COLORS[0],
    template: 'index',
    artKey: null,
    sides: {
      A: { label: 'Side A', audioKey: null, audioName: null, duration: 0 },
      B: { label: 'Side B', audioKey: null, audioName: null, duration: 0 },
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Readable ink colour for a label stock. */
export function inkFor(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? '#1b1c1f' : '#f2f1ec';
}
