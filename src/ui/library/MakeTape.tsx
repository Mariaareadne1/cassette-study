import { useEffect, useRef, useState } from 'react';
import type { Side } from '@/deck/transport';
import { labelCanvas, type Art } from '@/engine/textures/label';
import { decodeArt, probeDuration } from '@/library/media';
import {
  blankTape,
  checkArtFile,
  checkAudioFile,
  LABEL_COLORS,
  LIMITS,
  newId,
  type LabelTemplate,
  type TapeMeta,
  TEMPLATES,
} from '@/library/schema';
import type { Engine } from '../Experience';
import { FONTS } from '../fonts';
import { clock } from '../hud/Transport';
import type { Shelf } from './useShelf';

type Props = {
  engine: Engine;
  shelf: Shelf;
  initial: TapeMeta | null;
  onDone: (saved: TapeMeta, playNow: boolean) => void | Promise<void>;
};

const TEMPLATE_NAMES: Record<LabelTemplate, string> = { index: 'Index card', editorial: 'Editorial', mono: 'Typewriter' };
const COLOR_NAMES = ['Cream', 'Cool white', 'Manila', 'Sage', 'Rose', 'Graphite'];

type SideState = { busy: boolean; error: string | null };

/** Draws the live label preview into the given canvas. */
function usePreview(canvas: React.RefObject<HTMLCanvasElement | null>, tape: TapeMeta, side: Side, art: Art | null): void {
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const src = labelCanvas(tape, side, art, FONTS);
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
  }, [canvas, tape, side, art]);
}

export function MakeTape({ engine, shelf, initial, onDone }: Props) {
  const [draft, setDraft] = useState<TapeMeta>(() => (initial ? { ...initial, builtIn: undefined } : blankTape()));
  const [added, setAdded] = useState<Record<string, Blob>>({});
  const [art, setArt] = useState<ImageBitmap | null>(null);
  const [sides, setSides] = useState<Record<Side, SideState>>({ A: { busy: false, error: null }, B: { busy: false, error: null } });
  const [artError, setArtError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewSide, setPreviewSide] = useState<Side>('A');
  const preview = useRef<HTMLCanvasElement>(null);
  const editingBuiltIn = initial?.builtIn === true;

  // Existing artwork, when editing.
  useEffect(() => {
    let live = true;
    if (initial) void shelf.art(initial).then((a) => live && setArt(a));
    return () => {
      live = false;
    };
  }, [initial, shelf]);

  // The object's labels follow the draft while the panel is open, then return to the loaded tape.
  useEffect(() => {
    engine.drawLabels(draft, art);
  }, [engine, draft, art]);
  useEffect(
    () => () => {
      const loaded = engine.controller.currentTape?.meta;
      if (loaded) engine.drawLabels(loaded, engine.getArt());
    },
    [engine],
  );

  usePreview(preview, draft, previewSide, art);

  const patch = (p: Partial<TapeMeta>): void => setDraft((d) => ({ ...d, ...p }));
  const patchSide = (side: Side, p: Partial<TapeMeta['sides']['A']>): void =>
    setDraft((d) => ({ ...d, sides: { ...d.sides, [side]: { ...d.sides[side], ...p } } }));
  const sideStatus = (side: Side, s: SideState): void => setSides((all) => ({ ...all, [side]: s }));

  async function pickAudio(side: Side, file: File | undefined): Promise<void> {
    if (!file) return;
    const check = checkAudioFile(file);
    if (!check.ok) return sideStatus(side, { busy: false, error: check.error });
    sideStatus(side, { busy: true, error: null });
    try {
      const duration = await probeDuration(file, file.name);
      const key = newId('m');
      setAdded((a) => ({ ...a, [key]: file }));
      const stem = file.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.sideLabel);
      const current = draft.sides[side].label;
      const keepLabel = current && current !== `Side ${side}`;
      patchSide(side, { audioKey: key, audioName: file.name, duration, label: keepLabel ? current : stem });
      setPreviewSide(side);
      sideStatus(side, { busy: false, error: null });
    } catch (err) {
      sideStatus(side, { busy: false, error: err instanceof Error ? err.message : 'That file couldn’t be opened.' });
    }
  }

  async function pickArt(file: File | undefined): Promise<void> {
    if (!file) return;
    const check = checkArtFile(file);
    if (!check.ok) return setArtError(check.error);
    try {
      const bitmap = await decodeArt(file);
      const key = newId('m');
      setAdded((a) => ({ ...a, [key]: file }));
      setArt(bitmap);
      patch({ artKey: key });
      setArtError(null);
    } catch (err) {
      setArtError(err instanceof Error ? err.message : 'That image couldn’t be read.');
    }
  }

  async function submit(playNow: boolean): Promise<void> {
    setFormError(null);
    if (!draft.sides.A.audioKey && !draft.sides.B.audioKey) {
      setFormError('Add a recording to at least one side.');
      return;
    }
    if (!draft.title.trim()) {
      setFormError('Give the tape a title.');
      return;
    }
    setSaving(true);
    try {
      // Editing the built-in demo saves a new tape, so the original always stays on the shelf.
      const base = editingBuiltIn ? { ...draft, id: newId() } : draft;
      const saved = await shelf.save({ ...base, title: base.title.trim() }, added);
      await onDone(saved, playNow);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The tape couldn’t be saved.');
    } finally {
      setSaving(false);
    }
  }

  const sideField = (side: Side) => {
    const meta = draft.sides[side];
    const st = sides[side];
    const id = `cs-side-${side}`;
    return (
      <fieldset className="cs-side-field" key={side}>
        <legend>
          <span className="cs-side">{side}</span> Side {side}
        </legend>
        <label className="cs-field">
          <span>Label</span>
          <input
            value={meta.label}
            maxLength={LIMITS.sideLabel}
            onChange={(e) => patchSide(side, { label: e.target.value })}
            onFocus={() => setPreviewSide(side)}
          />
        </label>
        <label className="cs-field">
          <span>Artist</span>
          <input
            value={meta.artist ?? ''}
            maxLength={LIMITS.sideLabel}
            onChange={(e) => patchSide(side, { artist: e.target.value })}
            onFocus={() => setPreviewSide(side)}
          />
        </label>
        <div className="cs-file">
          <input
            id={id}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac"
            onChange={(e) => {
              void pickAudio(side, e.target.files?.[0]);
              e.target.value = '';
            }}
            disabled={st.busy || (editingBuiltIn && !meta.audioKey)}
          />
          <label htmlFor={id} className="cs-pill">
            {st.busy ? 'Reading…' : meta.audioKey ? 'Replace recording' : 'Add recording'}
          </label>
          <span className="cs-file-name">
            {meta.audioKey ? `${meta.audioName ?? 'Recording'} · ${clock(meta.duration)}` : editingBuiltIn ? 'Demo recording' : 'Blank side'}
          </span>
          {meta.audioKey && (
            <button type="button" className="cs-link" onClick={() => patchSide(side, { audioKey: null, audioName: null, duration: 0 })}>
              Remove
            </button>
          )}
        </div>
        {st.error && (
          <p className="cs-error" role="alert">
            {st.error}
          </p>
        )}
      </fieldset>
    );
  };

  return (
    <form
      className="cs-make"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <div className="cs-make-fields">
        <label className="cs-field">
          <span>Title</span>
          <input value={draft.title} maxLength={LIMITS.title} required onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className="cs-field">
          <span>Note</span>
          <input
            value={draft.note}
            maxLength={LIMITS.note}
            placeholder="For whom, from whom, when"
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>
        {sideField('A')}
        {sideField('B')}
        <p className="cs-fine">MP3, WAV or M4A, up to 80 MB and 60 minutes a side. Your audio stays in this browser.</p>
      </div>

      <div className="cs-make-label">
        <div className="cs-preview">
          <canvas ref={preview} aria-label={`Label preview, side ${previewSide}`} role="img" />
          <div className="cs-preview-sides" role="group" aria-label="Preview side">
            {(['A', 'B'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={previewSide === s} onClick={() => setPreviewSide(s)}>
                Side {s}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="cs-choice">
          <legend>Label stock</legend>
          <div className="cs-swatches">
            {LABEL_COLORS.map((c, i) => (
              <label key={c} className="cs-swatch" style={{ ['--c' as string]: c }} title={COLOR_NAMES[i]}>
                <input type="radio" name="color" value={c} checked={draft.color === c} onChange={() => patch({ color: c })} />
                <span className="sr-only">{COLOR_NAMES[i]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="cs-choice">
          <legend>Layout</legend>
          <div className="cs-templates">
            {TEMPLATES.map((t) => (
              <label key={t} className="cs-template">
                <input type="radio" name="template" value={t} checked={draft.template === t} onChange={() => patch({ template: t })} />
                <span>{TEMPLATE_NAMES[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="cs-choice">
          <legend>Artwork</legend>
          <div className="cs-file">
            <input
              id="cs-art"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                void pickArt(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <label htmlFor="cs-art" className="cs-pill">
              {draft.artKey ? 'Replace image' : 'Add image'}
            </label>
            {draft.artKey && (
              <button
                type="button"
                className="cs-link"
                onClick={() => {
                  patch({ artKey: null });
                  setArt(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
          {artError && (
            <p className="cs-error" role="alert">
              {artError}
            </p>
          )}
        </fieldset>
      </div>

      <footer className="cs-make-foot">
        {formError && (
          <p className="cs-error" role="alert">
            {formError}
          </p>
        )}
        {!shelf.persistent && <p className="cs-fine">Storage is unavailable here, so this tape lasts until you close the tab.</p>}
        <button type="button" className="cs-pill" disabled={saving || !shelf.ready} onClick={() => void submit(false)}>
          Save to shelf
        </button>
        <button type="submit" className="cs-pill cs-pill-accent" disabled={saving || !shelf.ready}>
          {saving ? 'Saving…' : 'Save and play'}
        </button>
      </footer>
    </form>
  );
}
