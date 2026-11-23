import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ControllerView, LoadedTape } from '@/deck/controller';
import type { Stage, ViewMode } from '@/engine/stage/Stage';
import type { Art } from '@/engine/textures/label';
import type { Engine } from './Experience';
import { About } from './hud/About';
import { Dialog } from './hud/Dialog';
import { hintFor } from './hud/hint';
import { Icon } from './hud/icons';
import { Toast } from './hud/Toast';
import { Transport } from './hud/Transport';
import { useShortcuts } from './hud/useShortcuts';

export type Panel = 'make' | 'shelf' | 'about' | null;

type Props = {
  engine: Engine;
  view: ControllerView;
  onDrawLabels: (stage: Stage, tape: LoadedTape, art: Art | null) => void;
  /** Library surfaces (Make a Tape, Shelf) are supplied by the page. */
  renderPanel?: (panel: 'make' | 'shelf', close: () => void) => ReactNode;
};

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

export function Hud({ engine, view, renderPanel }: Props) {
  const { controller, stage } = engine;
  const [panel, setPanel] = useState<Panel>(null);
  const [mode, setMode] = useState<ViewMode>('hero');
  const [mixer, setMixer] = useState(false);
  const touch = useCoarsePointer();
  const close = useCallback(() => setPanel(null), []);
  const toggleMute = useCallback(() => controller.setMuted(!controller.getView().muted), [controller]);
  useShortcuts(engine, panel === null, toggleMute);

  const chooseView = (m: ViewMode): void => {
    setMode(m);
    stage.setView(m);
  };
  const hint = hintFor(view.deck, touch);

  return (
    <>
      <header className="cs-head">
        <p className="cs-index">
          <span>Object Study</span>
          <span aria-hidden="true">/</span>
          <span>001</span>
        </p>
        <h1 className="cs-title">Cassette Study</h1>
        <p className="cs-sub">Clear polycarbonate portable, c. 1998 · working model</p>
      </header>

      <nav className="cs-actions" aria-label="Study">
        <button type="button" className="cs-pill cs-pill-accent" onClick={() => setPanel('make')}>
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

      <Dialog title="About this study" open={panel === 'about'} onClose={close}>
        <About />
      </Dialog>
      {renderPanel && (
        <>
          <Dialog title="Make a tape" open={panel === 'make'} onClose={close} wide>
            {renderPanel('make', close)}
          </Dialog>
          <Dialog title="Shelf" open={panel === 'shelf'} onClose={close} wide>
            {renderPanel('shelf', close)}
          </Dialog>
        </>
      )}
    </>
  );
}
