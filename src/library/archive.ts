/**
 * A tape as a single file: `CSTAPE1\n`, a 4-byte big-endian header length, a JSON header
 * (tape record + media index), then the media bytes. No dependencies, streams nothing to a
 * server, and every field is validated on the way back in.
 */
import { ART_TYPES, AUDIO_TYPES, LIMITS, newId, parseTape, type TapeMeta } from './schema';
import { mediaKeys } from './store';

export const ARCHIVE_EXT = '.cassette';
export const ARCHIVE_TYPE = 'application/x-cassette-study';
const MAGIC = 'CSTAPE1\n';
const MAX_HEADER = 64 * 1024;

interface Entry {
  key: string;
  type: string;
  offset: number;
  size: number;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export async function packTape(tape: TapeMeta, media: Record<string, Blob>): Promise<Blob> {
  const entries: Entry[] = [];
  const parts: Blob[] = [];
  let offset = 0;
  for (const key of mediaKeys(tape)) {
    const blob = media[key];
    if (!blob) throw new ArchiveError(`Missing media ${key}`);
    entries.push({ key, type: blob.type, offset, size: blob.size });
    parts.push(blob);
    offset += blob.size;
  }
  const { builtIn: _builtIn, ...record } = tape;
  const header = new TextEncoder().encode(JSON.stringify({ tape: record, media: entries }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length);
  return new Blob([MAGIC, len, header, ...parts], { type: ARCHIVE_TYPE });
}

const damaged = (): ArchiveError => new ArchiveError('This tape file is damaged or incomplete.');

function isAudio(type: string): boolean {
  return type in AUDIO_TYPES;
}

/** Reads a tape file. The tape and its media get fresh ids so imports never clash. */
export async function unpackTape(file: Blob): Promise<{ tape: TapeMeta; media: Record<string, Blob> }> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.slice(0, MAGIC.length)) !== MAGIC) {
    throw new ArchiveError('That file is not a Cassette Study tape.');
  }
  if (head.length < MAGIC.length + 4) throw damaged();
  const headerLen = new DataView(head.buffer).getUint32(MAGIC.length);
  if (headerLen <= 0 || headerLen > MAX_HEADER) throw damaged();
  const start = MAGIC.length + 4;
  const bodyStart = start + headerLen;
  if (bodyStart > file.size) throw damaged();
  let header: { tape?: unknown; media?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(await file.slice(start, bodyStart).arrayBuffer()));
  } catch {
    throw damaged();
  }
  const parsed = parseTape(header.tape);
  if (!parsed.ok) throw new ArchiveError(`This tape file can’t be read: ${parsed.error}.`);
  if (!Array.isArray(header.media)) throw damaged();

  const index = new Map<string, Entry>();
  for (const raw of header.media as unknown[]) {
    const e = raw as Partial<Entry>;
    const ok =
      typeof e.key === 'string' &&
      typeof e.type === 'string' &&
      Number.isInteger(e.offset) &&
      Number.isInteger(e.size) &&
      (e.offset as number) >= 0 &&
      (e.size as number) > 0;
    if (!ok) throw damaged();
    if (bodyStart + (e.offset as number) + (e.size as number) > file.size) throw damaged();
    index.set(e.key as string, e as Entry);
  }

  const tape = parsed.tape;
  const media: Record<string, Blob> = {};
  const take = (key: string | null, kind: 'audio' | 'art'): string | null => {
    if (!key) return null;
    const e = index.get(key);
    if (!e) throw damaged();
    if (kind === 'audio' && (!isAudio(e.type) || e.size > LIMITS.audioBytes)) throw new ArchiveError('This tape file contains something that isn’t audio.');
    if (kind === 'art' && (!ART_TYPES.includes(e.type) || e.size > LIMITS.artBytes)) throw new ArchiveError('This tape file’s artwork isn’t a supported image.');
    const nk = newId('m');
    media[nk] = file.slice(bodyStart + e.offset, bodyStart + e.offset + e.size, e.type);
    return nk;
  };
  const now = Date.now();
  const fresh: TapeMeta = {
    ...tape,
    id: newId(),
    builtIn: undefined,
    artKey: take(tape.artKey, 'art'),
    sides: {
      A: { ...tape.sides.A, audioKey: take(tape.sides.A.audioKey, 'audio') },
      B: { ...tape.sides.B, audioKey: take(tape.sides.B.audioKey, 'audio') },
    },
    updatedAt: now,
  };
  return { tape: fresh, media };
}
