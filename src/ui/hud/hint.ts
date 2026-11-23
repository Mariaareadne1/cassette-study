import type { DeckSnapshot } from '@/deck/machine';

/** One quiet line of guidance, derived from the deck state (never stored). */
export function hintFor(d: DeckSnapshot, touch: boolean): string {
  const tap = touch ? 'Tap' : 'Click';
  if (d.cassette === 'held' || d.cassette === 'aligned') return d.cassette === 'aligned' ? 'Let go to seat the tape' : 'Bring it over the open deck';
  if (d.cassette === 'flipping') return `Turning over to side ${d.side}`;
  if (d.cassette === 'outside') {
    return d.door === 'open' ? `Drag the cassette into the deck, or ${tap.toLowerCase()} it` : `${tap} the cassette to load it — or drag it in`;
  }
  if (d.cassette !== 'seated') return '';
  if (d.door === 'open') return 'Close the door, or press play';
  switch (d.mode) {
    case 'playing':
      return touch ? 'Drag to turn the player' : 'Drag to turn the player · Space pauses';
    case 'paused':
      return 'Paused — press pause again to continue';
    case 'fastForward':
    case 'rewind':
      return 'Winding — press the key again to stop';
    case 'ended':
      return `End of side ${d.side} — rewind, or eject and turn the tape over`;
    default:
      return d.time < 0.05 ? 'Press play' : 'Press play to continue';
  }
}
