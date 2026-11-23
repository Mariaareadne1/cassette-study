import { useEffect } from 'react';
import type { Engine } from '../Experience';

export const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'Play / pause'],
  ['S', 'Stop'],
  ['← / →', 'Rewind / fast-forward'],
  ['Shift + ← / →', 'Skip 10 s'],
  ['E', 'Eject / open door'],
  ['L', 'Load or take out the tape'],
  ['F', 'Turn the tape over'],
  ['M', 'Mute'],
  ['1 · 2 · 3', 'Whole object · reels · keys'],
  ['R', 'Reset view'],
];

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Global keyboard control. Disabled while a dialog or panel owns focus. */
export function useShortcuts(engine: Engine, enabled: boolean, onMute: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const { controller, stage } = engine;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const d = controller.getView().deck;
      let handled = true;
      switch (e.key) {
        case ' ':
          // Space on a focused button activates that button instead.
          if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
          controller.tapKey(d.mode === 'playing' || d.mode === 'paused' ? 'pause' : 'play');
          break;
        case 's':
        case 'S':
          controller.tapKey('stop');
          break;
        case 'ArrowLeft':
          if (e.shiftKey) controller.seekBy(-10);
          else if (!e.repeat) controller.tapKey('rewind');
          break;
        case 'ArrowRight':
          if (e.shiftKey) controller.seekBy(10);
          else if (!e.repeat) controller.tapKey('fastForward');
          break;
        case 'e':
        case 'E':
          controller.tapKey('eject');
          break;
        case 'l':
        case 'L':
          controller.insertOrRemove();
          break;
        case 'f':
        case 'F':
          controller.flip();
          break;
        case 'm':
        case 'M':
          onMute();
          break;
        case 'r':
        case 'R':
          stage.resetView();
          break;
        case '1':
          stage.setView('hero');
          break;
        case '2':
          stage.setView('reels');
          break;
        case '3':
          stage.setView('keys');
          break;
        case 'Escape':
          stage.cancelGestures();
          handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, enabled, onMute]);
}
