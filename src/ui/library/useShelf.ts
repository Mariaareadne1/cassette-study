import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadedTape } from '@/deck/controller';
import { ARCHIVE_EXT, packTape, unpackTape } from '@/library/archive';
import { DEMO_TAPE, DEMO_URLS } from '@/library/demo';
import { decodeArt, saveFile, slug } from '@/library/media';
import type { TapeMeta } from '@/library/schema';
import { type Library, mediaKeys, openLibrary } from '@/library/store';
import type { Engine } from '../Experience';

export interface Shelf {
  ready: boolean;
  persistent: boolean;
  tapes: TapeMeta[];
  /** The tape currently in (or beside) the deck. */
  currentId: string;
  busy: boolean;
  play: (tape: TapeMeta) => Promise<void>;
  save: (tape: TapeMeta, added: Record<string, Blob>) => Promise<TapeMeta>;
  rename: (id: string, title: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  exportTape: (tape: TapeMeta) => Promise<void>;
  importFile: (file: File) => Promise<TapeMeta>;
  media: (key: string) => Promise<Blob | null>;
  art: (tape: TapeMeta) => Promise<ImageBitmap | null>;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Owns the IndexedDB shelf and the object URLs of whichever tape is loaded. */
export function useShelf(engine: Engine): Shelf {
  const lib = useRef<Library | null>(null);
  const urls = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [tapes, setTapes] = useState<TapeMeta[]>([DEMO_TAPE]);
  const [currentId, setCurrentId] = useState(DEMO_TAPE.id);
  const [busy, setBusy] = useState(false);
  const { controller } = engine;

  const need = useCallback((): Library => {
    if (!lib.current) throw new Error('The shelf is still opening.');
    return lib.current;
  }, []);

  const refresh = useCallback(async () => {
    const l = lib.current;
    if (!l) return;
    const list = await l.list();
    setTapes([...list, DEMO_TAPE]);
    if (l.skipped) controller.say(`${l.skipped} damaged tape record(s) were skipped.`, 'warn');
  }, [controller]);

  useEffect(() => {
    let live = true;
    const held = urls.current;
    void openLibrary().then(async (l) => {
      if (!live) {
        l.close();
        return;
      }
      lib.current = l;
      setPersistent(l.persistent);
      await refresh();
      setReady(true);
    });
    return () => {
      live = false;
      lib.current?.close();
      lib.current = null;
      for (const u of held) URL.revokeObjectURL(u);
    };
  }, [refresh]);

  const media = useCallback((key: string) => need().media(key), [need]);

  const art = useCallback(async (tape: TapeMeta) => {
    if (!tape.artKey || !lib.current) return null;
    const blob = await lib.current.media(tape.artKey);
    return blob ? decodeArt(blob).catch(() => null) : null;
  }, []);

  const play = useCallback(
    async (tape: TapeMeta) => {
      setBusy(true);
      const fresh: string[] = [];
      try {
        let loaded: LoadedTape;
        if (tape.builtIn) loaded = { meta: tape, urls: { ...DEMO_URLS } };
        else {
          const url = async (k: string | null): Promise<string | null> => {
            if (!k) return null;
            const b = await need().media(k);
            if (!b) throw new Error('A recording for this tape is missing from the shelf.');
            const u = URL.createObjectURL(b);
            fresh.push(u);
            return u;
          };
          loaded = { meta: tape, urls: { A: await url(tape.sides.A.audioKey), B: await url(tape.sides.B.audioKey) } };
        }
        engine.setArt(await art(tape));
        await controller.swapTape(loaded);
        for (const u of urls.current) URL.revokeObjectURL(u);
        urls.current = fresh;
        setCurrentId(tape.id);
      } catch (err) {
        for (const u of fresh) URL.revokeObjectURL(u);
        controller.say(message(err), 'warn');
      } finally {
        setBusy(false);
      }
    },
    [engine, controller, art, need],
  );

  const save = useCallback(
    async (tape: TapeMeta, added: Record<string, Blob>) => {
      const saved = await need().save({ ...tape, updatedAt: Date.now() }, added);
      await refresh();
      return saved;
    },
    [refresh, need],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await need().rename(id, title);
      await refresh();
    },
    [refresh, need],
  );

  const duplicate = useCallback(
    async (id: string) => {
      await need().duplicate(id);
      await refresh();
    },
    [refresh, need],
  );

  const remove = useCallback(
    async (id: string) => {
      await need().remove(id);
      await refresh();
      if (id === currentId) await play(DEMO_TAPE);
    },
    [refresh, currentId, play, need],
  );

  const exportTape = useCallback(
    async (tape: TapeMeta) => {
      const files: Record<string, Blob> = {};
      let out = tape;
      if (tape.builtIn) {
        // The demo ships as static files; pack them in so the export is self-contained.
        for (const side of ['A', 'B'] as const) {
          const res = await fetch(DEMO_URLS[side]);
          if (!res.ok) throw new Error('The demo recording could not be read.');
          const key = `demo-${side}`;
          files[key] = new Blob([await res.blob()], { type: 'audio/mp4' });
          out = { ...out, sides: { ...out.sides, [side]: { ...out.sides[side], audioKey: key } } };
        }
      } else {
        for (const k of mediaKeys(tape)) {
          const b = await need().media(k);
          if (b) files[k] = b;
        }
      }
      saveFile(await packTape(out, files), `${slug(tape.title)}${ARCHIVE_EXT}`);
    },
    [need],
  );

  const importFile = useCallback(
    async (file: File) => {
      const { tape, media: added } = await unpackTape(file);
      const saved = await need().save(tape, added);
      await refresh();
      return saved;
    },
    [refresh, need],
  );

  return { ready, persistent, tapes, currentId, busy, play, save, rename, duplicate, remove, exportTape, importFile, media, art };
}
