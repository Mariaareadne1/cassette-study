/**
 * The tape shelf: tape records and their media (audio sides, artwork) in IndexedDB, so tapes
 * survive reloads and never leave the browser. When IndexedDB is unavailable (private modes,
 * blocked storage) the same API runs in memory and says so via `persistent = false`.
 */
import { newId, parseTape, type TapeMeta } from './schema';

const STORE_TAPES = 'tapes';
const STORE_MEDIA = 'media';
const VERSION = 1;

export class LibraryError extends Error {
  constructor(message: string, readonly code: 'quota' | 'missing' | 'invalid' | 'notFound' | 'storage' = 'storage') {
    super(message);
    this.name = 'LibraryError';
  }
}

interface Writes {
  tapes?: unknown[];
  media?: Array<[string, Blob]>;
  deleteTapes?: string[];
  deleteMedia?: string[];
}

interface Backend {
  readonly persistent: boolean;
  allTapes(): Promise<unknown[]>;
  tape(id: string): Promise<unknown>;
  media(key: string): Promise<Blob | undefined>;
  write(w: Writes): Promise<void>;
  close(): void;
}

// ───────────────────────── backends ─────────────────────────

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function storageError(err: unknown): LibraryError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'QuotaExceededError') {
    return new LibraryError('This browser has run out of space for tapes. Delete a tape from the shelf, or use shorter recordings.', 'quota');
  }
  return new LibraryError(`The shelf couldn’t be saved (${err instanceof Error ? err.message : 'storage error'}).`);
}

class IdbBackend implements Backend {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase) {}

  static async open(idb: IDBFactory, name: string): Promise<IdbBackend> {
    const open = idb.open(name, VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_TAPES)) db.createObjectStore(STORE_TAPES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('The shelf is open in another tab that needs reloading.'));
    });
    return new IdbBackend(db);
  }

  async allTapes(): Promise<unknown[]> {
    return req(this.db.transaction(STORE_TAPES).objectStore(STORE_TAPES).getAll());
  }

  async tape(id: string): Promise<unknown> {
    return req(this.db.transaction(STORE_TAPES).objectStore(STORE_TAPES).get(id));
  }

  async media(key: string): Promise<Blob | undefined> {
    return req(this.db.transaction(STORE_MEDIA).objectStore(STORE_MEDIA).get(key));
  }

  /** One transaction for everything, so a tape and its media land (or fail) together. */
  write(w: Writes): Promise<void> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction([STORE_TAPES, STORE_MEDIA], 'readwrite');
      } catch (err) {
        reject(storageError(err));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storageError(tx.error));
      tx.onabort = () => reject(storageError(tx.error));
      const tapes = tx.objectStore(STORE_TAPES);
      const media = tx.objectStore(STORE_MEDIA);
      for (const [k, blob] of w.media ?? []) media.put(blob, k);
      for (const t of w.tapes ?? []) tapes.put(t);
      for (const k of w.deleteMedia ?? []) media.delete(k);
      for (const id of w.deleteTapes ?? []) tapes.delete(id);
    });
  }

  close(): void {
    this.db.close();
  }
}

class MemoryBackend implements Backend {
  readonly persistent = false;
  private readonly tapes = new Map<string, unknown>();
  private readonly blobs = new Map<string, Blob>();

  async allTapes(): Promise<unknown[]> {
    return [...this.tapes.values()];
  }
  async tape(id: string): Promise<unknown> {
    return this.tapes.get(id);
  }
  async media(key: string): Promise<Blob | undefined> {
    return this.blobs.get(key);
  }
  async write(w: Writes): Promise<void> {
    for (const [k, b] of w.media ?? []) this.blobs.set(k, b);
    for (const t of w.tapes ?? []) this.tapes.set((t as { id: string }).id, t);
    for (const k of w.deleteMedia ?? []) this.blobs.delete(k);
    for (const id of w.deleteTapes ?? []) this.tapes.delete(id);
  }
  close(): void {}
}

// ───────────────────────── library ─────────────────────────

/** Every media key a tape refers to. */
export function mediaKeys(t: TapeMeta): string[] {
  return [t.sides.A.audioKey, t.sides.B.audioKey, t.artKey].filter((k): k is string => !!k);
}

export class Library {
  /** Records that failed validation on the last list(); they are left alone, not deleted. */
  skipped = 0;
  constructor(private readonly backend: Backend) {}

  get persistent(): boolean {
    return this.backend.persistent;
  }

  async list(): Promise<TapeMeta[]> {
    const raw = await this.backend.allTapes();
    const tapes: TapeMeta[] = [];
    let skipped = 0;
    for (const r of raw) {
      const parsed = parseTape(r);
      if (parsed.ok) tapes.push(parsed.tape);
      else skipped++;
    }
    this.skipped = skipped;
    return tapes.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<TapeMeta> {
    const parsed = parseTape(await this.backend.tape(id));
    if (!parsed.ok) throw new LibraryError('That tape is no longer on the shelf.', 'notFound');
    return parsed.tape;
  }

  async media(key: string): Promise<Blob | null> {
    return (await this.backend.media(key)) ?? null;
  }

  /**
   * Saves a tape. `added` holds new media by key; media the tape no longer uses is removed in the
   * same transaction. Fails if the tape points at media that is neither added nor stored.
   */
  async save(tape: TapeMeta, added: Record<string, Blob>): Promise<TapeMeta> {
    const parsed = parseTape(tape);
    if (!parsed.ok) throw new LibraryError(parsed.error, 'invalid');
    const next = parsed.tape;
    for (const k of mediaKeys(next)) {
      if (!added[k] && !(await this.backend.media(k))) throw new LibraryError(`A recording for this tape is missing (${k}).`, 'missing');
    }
    const prevRaw = await this.backend.tape(next.id);
    const prev = prevRaw ? parseTape(prevRaw) : null;
    const keep = new Set(mediaKeys(next));
    const stale = prev?.ok ? mediaKeys(prev.tape).filter((k) => !keep.has(k)) : [];
    const media = Object.entries(added).filter(([k]) => keep.has(k));
    await this.backend.write({ tapes: [next], media, deleteMedia: stale });
    return next;
  }

  async rename(id: string, title: string): Promise<TapeMeta> {
    const clean = title.trim();
    if (!clean) throw new LibraryError('A tape needs a name.', 'invalid');
    const tape = await this.get(id);
    return this.save({ ...tape, title: clean, updatedAt: Date.now() }, {});
  }

  async duplicate(id: string): Promise<TapeMeta> {
    const tape = await this.get(id);
    const added: Record<string, Blob> = {};
    const remap = async (k: string | null): Promise<string | null> => {
      if (!k) return null;
      const blob = await this.backend.media(k);
      if (!blob) return null;
      const nk = newId('m');
      added[nk] = blob;
      return nk;
    };
    const now = Date.now();
    const copy: TapeMeta = {
      ...tape,
      id: newId(),
      title: `${tape.title} (copy)`.slice(0, 60),
      builtIn: undefined,
      artKey: await remap(tape.artKey),
      sides: {
        A: { ...tape.sides.A, audioKey: await remap(tape.sides.A.audioKey) },
        B: { ...tape.sides.B, audioKey: await remap(tape.sides.B.audioKey) },
      },
      createdAt: now,
      updatedAt: now,
    };
    return this.save(copy, added);
  }

  async remove(id: string): Promise<void> {
    const raw = await this.backend.tape(id);
    const parsed = raw ? parseTape(raw) : null;
    await this.backend.write({ deleteTapes: [id], deleteMedia: parsed?.ok ? mediaKeys(parsed.tape) : [] });
  }

  /** Writes an unvalidated record. Only for migration tooling and tests of corrupt data. */
  async putRaw(record: { id: string } & Record<string, unknown>): Promise<void> {
    await this.backend.write({ tapes: [record] });
  }

  close(): void {
    this.backend.close();
  }
}

export interface OpenOptions {
  /** IndexedDB factory; null forces the in-memory shelf. Defaults to the browser's. */
  idb?: IDBFactory | null;
  name?: string;
}

export async function openLibrary(opts: OpenOptions = {}): Promise<Library> {
  const idb = opts.idb === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : opts.idb;
  if (idb) {
    try {
      return new Library(await IdbBackend.open(idb, opts.name ?? 'cassette-study'));
    } catch {
      // Storage blocked or broken: keep working for this session instead of failing.
    }
  }
  return new Library(new MemoryBackend());
}
