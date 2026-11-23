import type { ControllerView, DeckController } from '@/deck/controller';
import type { KeyName } from '@/engine/geometry/player';
import { Icon } from './icons';

/** Running clock: floors, so it never shows 0:60 and reads 0:00 at the start. */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

type Props = { controller: DeckController; view: ControllerView };

const KEYS: ReadonlyArray<{ key: KeyName; label: string }> = [
  { key: 'rewind', label: 'Rewind' },
  { key: 'play', label: 'Play' },
  { key: 'pause', label: 'Pause' },
  { key: 'stop', label: 'Stop' },
  { key: 'fastForward', label: 'Fast-forward' },
  { key: 'eject', label: 'Eject' },
];

/** Latched keys stay down on the object; the strip mirrors that with aria-pressed. */
function latched(key: KeyName, mode: ControllerView['deck']['mode']): boolean {
  if (key === 'play') return mode === 'playing' || mode === 'paused';
  if (key === 'pause') return mode === 'paused';
  if (key === 'fastForward') return mode === 'fastForward';
  if (key === 'rewind') return mode === 'rewind';
  return false;
}

/** The accessible alternative to the physical keys. It drives the same controller state. */
export function Transport({ controller, view }: Props) {
  const d = view.deck;
  const seated = d.cassette === 'seated';
  const sideTitle = view.tape?.sides[d.side]?.label || `Side ${d.side}`;
  const progress = d.duration > 0 ? d.time / d.duration : 0;
  return (
    <section className="cs-transport" aria-label="Player controls">
      <div className="cs-readout">
        <p className="cs-now">
          <span className="cs-side" aria-label={`Side ${d.side}`}>
            {d.side}
          </span>
          <span className="cs-track">{seated ? sideTitle : view.tape?.title ?? 'No tape'}</span>
          <span className="cs-mode">{seated ? d.mode.replace('fastForward', 'fast-forward') : d.cassette === 'outside' ? 'not loaded' : '…'}</span>
        </p>
        <label className="cs-scrub" style={{ ['--p' as string]: progress }}>
          <span className="sr-only">Position on side {d.side}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, d.duration)}
            step={0.1}
            value={Math.min(d.time, d.duration)}
            disabled={!seated}
            onChange={(e) => controller.seekTo(Number(e.target.value))}
            aria-valuetext={`${clock(d.time)} of ${clock(d.duration)}`}
          />
        </label>
        <p className="cs-clock" aria-hidden="true">
          <span>{clock(d.time)}</span>
          <span>−{clock(Math.max(0, d.duration - d.time))}</span>
        </p>
      </div>
      <div className="cs-keys" role="group" aria-label="Transport keys">
        {KEYS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`cs-key cs-key-${key}`}
            aria-label={label}
            aria-pressed={key === 'eject' || key === 'stop' ? undefined : latched(key, d.mode)}
            title={label}
            onClick={() => controller.tapKey(key)}
          >
            <Icon name={key} />
          </button>
        ))}
        <span className="cs-keys-rule" aria-hidden="true" />
        <button type="button" className="cs-key" aria-label={`Turn the tape over (now side ${d.side})`} title="Turn the tape over" onClick={() => controller.flip()}>
          <Icon name="flip" />
        </button>
      </div>
    </section>
  );
}
