import { useEffect, useRef, useState } from 'react';
import { labelCanvas } from '@/engine/textures/label';
import { ARCHIVE_EXT } from '@/library/archive';
import { cardCanvas } from '@/library/card';
import { saveFile, slug } from '@/library/media';
import type { TapeMeta } from '@/library/schema';
import type { Engine } from '../Experience';
import { FONTS } from '../fonts';
import { clock } from '../hud/Transport';
import type { Shelf } from './useShelf';

type Props = {
  engine: Engine;
  shelf: Shelf;
  onPlay: (t: TapeMeta) => void;
  onEdit: (t: TapeMeta) => void;
  onNew: () => void;
};

function Spine({ tape, shelf }: { tape: TapeMeta; shelf: Shelf }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void shelf.art(tape).then((art) => {
      const c = ref.current;
      if (!live || !c) return;
      const src = labelCanvas(tape, 'A', art, FONTS, 6);
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')?.drawImage(src, 0, 0);
    });
    return () => {
      live = false;
    };
  }, [tape, shelf]);
  return <canvas ref={ref} className="cs-spine" aria-hidden="true" />;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The render could not be captured.'));
    img.src = src;
  });
}

export function ShelfView({ engine, shelf, onPlay, onEdit, onNew }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  async function run(id: string, fn: () => Promise<void>): Promise<void> {
    setError(null);
    setWorking(id);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setWorking(null);
    }
  }

  async function card(tape: TapeMeta, index: number): Promise<void> {
    const art = await shelf.art(tape);
    // Photograph the object wearing this tape's labels, then put the loaded tape's labels back.
    engine.drawLabels(tape, art);
    const data = engine.stage.snapshot();
    const loaded = engine.controller.currentTape?.meta;
    if (loaded) engine.drawLabels(loaded, engine.getArt());
    const shot = await loadImage(data);
    const canvas = cardCanvas(tape, shot, art, FONTS, index);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('The card could not be drawn.');
    saveFile(blob, `${slug(tape.title)}-card.png`);
  }

  const own = shelf.tapes.filter((t) => !t.builtIn);

  return (
    <div className="cs-shelf">
      <div className="cs-shelf-bar">
        <p className="cs-fine">
          {own.length === 0 ? 'No tapes of your own yet.' : `${own.length} tape${own.length === 1 ? '' : 's'} of your own.`}{' '}
          {shelf.persistent ? 'Kept in this browser only.' : 'Storage is unavailable, so the shelf clears when you close the tab.'}
        </p>
        <input
          ref={importRef}
          type="file"
          accept={`${ARCHIVE_EXT},application/x-cassette-study,application/octet-stream`}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void run('import', async () => {
              const t = await shelf.importFile(f);
              engine.controller.say(`Imported “${t.title}”`);
            });
          }}
        />
        <button type="button" className="cs-pill" onClick={() => importRef.current?.click()} disabled={!shelf.ready}>
          Import tape
        </button>
        <button type="button" className="cs-pill cs-pill-accent" onClick={onNew}>
          New tape
        </button>
      </div>
      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
      <ul className="cs-tapes">
        {shelf.tapes.map((t, i) => {
          const current = t.id === shelf.currentId;
          const busy = working === t.id;
          return (
            <li key={t.id} className="cs-tape" aria-current={current ? 'true' : undefined}>
              <Spine tape={t} shelf={shelf} />
              <div className="cs-tape-info">
                {renaming === t.id ? (
                  <form
                    className="cs-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(t.id, async () => {
                        await shelf.rename(t.id, name);
                        setRenaming(null);
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor={`rn-${t.id}`}>
                      New name
                    </label>
                    <input id={`rn-${t.id}`} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
                    <button type="submit" className="cs-link">
                      Save
                    </button>
                    <button type="button" className="cs-link" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <h3>
                    {t.title}
                    {current && <span className="cs-badge">Current</span>}
                    {t.builtIn && <span className="cs-badge cs-badge-quiet">Demo</span>}
                  </h3>
                )}
                <p className="cs-fine">
                  A · {t.sides.A.label} {t.sides.A.audioKey || t.builtIn ? clock(t.sides.A.duration) : '(blank)'} — B · {t.sides.B.label}{' '}
                  {t.sides.B.audioKey || t.builtIn ? clock(t.sides.B.duration) : '(blank)'}
                </p>
                <div className="cs-tape-actions">
                  <button type="button" className="cs-pill cs-pill-accent" disabled={busy || shelf.busy} onClick={() => onPlay(t)}>
                    {current ? 'Play' : 'Load'}
                  </button>
                  {!t.builtIn && (
                    <>
                      <button type="button" className="cs-link" onClick={() => onEdit(t)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="cs-link"
                        onClick={() => {
                          setRenaming(t.id);
                          setName(t.title);
                        }}
                      >
                        Rename
                      </button>
                      <button type="button" className="cs-link" disabled={busy} onClick={() => void run(t.id, () => shelf.duplicate(t.id))}>
                        Duplicate
                      </button>
                    </>
                  )}
                  <button type="button" className="cs-link" disabled={busy} onClick={() => void run(t.id, () => shelf.exportTape(t))}>
                    Export
                  </button>
                  <button type="button" className="cs-link" disabled={busy} onClick={() => void run(t.id, () => card(t, shelf.tapes.length - i))}>
                    Collector card
                  </button>
                  {!t.builtIn &&
                    (confirming === t.id ? (
                      <span className="cs-confirm" role="group" aria-label={`Delete ${t.title}?`}>
                        <span>Delete for good?</span>
                        <button
                          type="button"
                          className="cs-link cs-danger"
                          onClick={() =>
                            void run(t.id, async () => {
                              await shelf.remove(t.id);
                              setConfirming(null);
                            })
                          }
                        >
                          Delete
                        </button>
                        <button type="button" className="cs-link" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="cs-link" onClick={() => setConfirming(t.id)}>
                        Delete
                      </button>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
