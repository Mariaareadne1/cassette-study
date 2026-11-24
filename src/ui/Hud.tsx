import { useCallback, useEffect, useState } from 'react';
import type { ControllerView } from '@/deck/controller';
import type { ViewMode } from '@/engine/stage/Stage';
import type { TapeMeta } from '@/library/schema';
import type { Engine } from './Experience';
import { About } from './hud/About';
import { Dialog } from './hud/Dialog';
import { hintFor } from './hud/hint';
import { Icon } from './hud/icons';
import { Toast } from './hud/Toast';
import { Transport } from './hud/Transport';
import { useRecorder } from './hud/useRecorder';
import { useShortcuts } from './hud/useShortcuts';
import { MakeTape } from './library/MakeTape';
import { ShelfView } from './library/ShelfView';
import { useShelf } from './library/useShelf';

export type Panel = 'make' | 'shelf' | 'about' | null;

type Props = { engine: Engine; view: ControllerView };

const VIEWS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'hero', label: 'Object' },
  { id: 'reels', label: 'Reels' },
  { id: 'keys', label: 'Keys' },
];

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const on = (): void => setCoarse(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return coarse;
}

export function Hud({ engine, view }: Props) {
  const { controller, stage } = engine;
  const [panel, setPanel] = useState<Panel>(null);
  const [editing, setEditing] = useState<TapeMeta | null>(null);
  const shelf = useShelf(engine);
  const [mode, setMode] = useState<ViewMode>('hero');
  const [mixer, setMixer] = useState(false);
  const touch = useCoarsePointer();
  const close = useCallback(() => {
    setPanel(null);
    setEditing(null);
  }, []);
  const toggleMute = useCallback(() => controller.setMuted(!controller.getView().muted), [controller]);
  useShortcuts(engine, panel === null, toggleMute);
  const recorder = useRecorder(stage, controller.audio);
  useEffect(() => {
    if (recorder.error) controller.say(recorder.error);
  }, [recorder.error, controller]);

  const chooseView = (m: ViewMode): void => {
    setMode(m);
    stage.setView(m);
  };
  const hint = hintFor(view.deck, touch);

  return (
    <>
      <h1 className="sr-only">Cassette player</h1>

      <nav className="cs-actions" aria-label="Tapes">
        <button
          type="button"
          className="cs-pill cs-rec"
          aria-pressed={recorder.recording}
          title={recorder.recording ? 'Stop and save the video' : 'Record a video of the player (the buttons aren’t filmed)'}
          onClick={recorder.toggle}
        >
          <span className="cs-rec-dot" aria-hidden="true" />
          {recorder.recording ? `Stop · ${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')}` : 'Record demo'}
        </button>
        <button
          type="button"
          className="cs-pill cs-pill-accent"
          onClick={() => {
            setEditing(null);
            setPanel('make');
          }}
        >
          Make a tape
        </button>
        <button type="button" className="cs-pill" onClick={() => setPanel('shelf')}>
          Shelf
        </button>
        <button type="button" className="cs-pill" onClick={() => setPanel('about')}>
          About
        </button>
        <div className="cs-mixer-wrap">
          <button
            type="button"
            className="cs-icon-btn"
            aria-label={view.muted ? 'Sound off — open sound settings' : 'Sound settings'}
            aria-expanded={mixer}
            aria-controls="cs-mixer"
            onClick={() => setMixer((m) => !m)}
          >
            <Icon name={view.muted ? 'mute' : 'sound'} />
          </button>
          {mixer && (
            <div className="cs-mixer" id="cs-mixer">
              <label>
                <span>Music</span>
                <input type="range" min={0} max={1} step={0.01} value={view.volume} onChange={(e) => controller.setVolume(Number(e.target.value))} />
              </label>
              <label>
                <span>Mechanism</span>
                <input type="range" min={0} max={1} step={0.01} value={view.sfxVolume} onChange={(e) => controller.setSfxVolume(Number(e.target.value))} />
              </label>
              <label className="cs-check">
                <input type="checkbox" checked={view.muted} onChange={toggleMute} />
                <span>All sound off</span>
              </label>
            </div>
          )}
        </div>
      </nav>

      <p className="cs-hint" aria-live="off">
        {hint}
      </p>

      <div className="cs-views" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={mode === v.id} onClick={() => chooseView(v.id)}>
            {v.label}
          </button>
        ))}
        <button
          type="button"
          className="cs-icon-btn"
          aria-label="Reset view"
          title="Reset view"
          onClick={() => {
            setMode('hero');
            stage.resetView();
          }}
        >
          <Icon name="reset" />
        </button>
      </div>

      <Transport controller={controller} view={view} />
      <Toast message={view.message} />
      {view.loading && <p className="cs-loading-chip">Threading the tape…</p>}

      <Dialog title="About" open={panel === 'about'} onClose={close}>
        <About />
      </Dialog>
      <Dialog title={editing ? 'Edit tape' : 'Make a tape'} open={panel === 'make'} onClose={close} wide>
        <MakeTape
          key={editing?.id ?? 'new'}
          engine={engine}
          shelf={shelf}
          initial={editing}
          onDone={async (saved, playNow) => {
            close();
            if (playNow) await shelf.play(saved);
            else controller.say(`“${saved.title}” is on the shelf`);
          }}
        />
      </Dialog>
      <Dialog title="Shelf" open={panel === 'shelf'} onClose={close} wide>
        <ShelfView
          engine={engine}
          shelf={shelf}
          onPlay={async (t) => {
            close();
            await shelf.play(t);
          }}
          onEdit={(t) => {
            setEditing(t);
            setPanel('make');
          }}
          onNew={() => {
            setEditing(null);
            setPanel('make');
          }}
        />
      </Dialog>
    </>
  );
}
