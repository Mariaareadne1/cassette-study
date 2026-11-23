/** Small, hand-drawn transport glyphs — same vocabulary as the key caps on the object. */
type IconName = 'play' | 'pause' | 'stop' | 'rewind' | 'fastForward' | 'eject' | 'flip' | 'reset' | 'sound' | 'mute' | 'close';

const PATHS: Record<IconName, string> = {
  play: 'M6 4.5v11l9-5.5z',
  pause: 'M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z',
  stop: 'M5 5h10v10H5z',
  rewind: 'M10 5v10L3 10zM17 5v10l-7-5z',
  fastForward: 'M3 5v10l7-5zM10 5v10l7-5z',
  eject: 'M10 4l6.5 7h-13zM3.5 13h13v2.5h-13z',
  flip: 'M4 8a6 6 0 0 1 11-2.5M16 12a6 6 0 0 1-11 2.5M15 2.5v3.3h-3.3M5 17.5v-3.3h3.3',
  reset: 'M4.5 10a5.5 5.5 0 1 0 1.8-4.1M4 3.5v3.4h3.4',
  sound: 'M3.5 8h3l4-3.5v11l-4-3.5h-3zM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.4 6.4 0 0 1 0 9',
  mute: 'M3.5 8h3l4-3.5v11l-4-3.5h-3zM13.5 8l4 4M17.5 8l-4 4',
  close: 'M5 5l10 10M15 5L5 15',
};

const STROKED: ReadonlySet<IconName> = new Set(['flip', 'reset', 'sound', 'mute', 'close']);

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const stroked = STROKED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill={stroked ? 'none' : 'currentColor'}
        stroke={stroked ? 'currentColor' : 'none'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type { IconName };
