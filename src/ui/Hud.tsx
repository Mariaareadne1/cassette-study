import type { ControllerView } from '@/deck/controller';
import type { LoadedTape } from '@/deck/controller';
import type { Stage } from '@/engine/stage/Stage';
import type { Art } from '@/engine/textures/label';
import type { Engine } from './Experience';

type Props = {
  engine: Engine;
  view: ControllerView;
  onDrawLabels: (stage: Stage, tape: LoadedTape, art: Art | null) => void;
};

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function Hud({ engine, view }: Props) {
  const d = view.deck;
  return (
    <>
      <header className="cs-head">
        <p className="cs-index">Object Study / 001</p>
        <h1 className="cs-title">Cassette Study</h1>
      </header>
      <p className="cs-time" aria-live="off">
        Side {d.side} · {clock(d.time)} / {clock(d.duration)} · {d.mode}
      </p>
      <nav className="cs-strip" aria-label="Transport">
        {(['rewind', 'play', 'pause', 'stop', 'fastForward', 'eject'] as const).map((k) => (
          <button key={k} type="button" onClick={() => engine.controller.tapKey(k)}>
            {k}
          </button>
        ))}
        <button type="button" onClick={() => engine.controller.flip()}>flip</button>
      </nav>
    </>
  );
}
