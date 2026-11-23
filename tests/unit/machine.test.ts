import { describe, expect, test } from 'vitest';
import { Deck, TIMING } from '../../src/deck/machine';
import { reelPose } from '../../src/deck/transport';

const run = (deck: Deck, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) deck.update(dt);
};

/** A deck with the tape seated and the door closed. */
function loaded(a = 40, b = 30): Deck {
  const deck = new Deck(a, b);
  expect(deck.insert().ok).toBe(true);
  // One-tap loading opens the door, seats the tape and shuts the door again.
  run(deck, TIMING.doorOpen + TIMING.insert + TIMING.doorClose + 0.1);
  expect(deck.snapshot().cassette).toBe('seated');
  expect(deck.engaged).toBe(true);
  deck.drain();
  return deck;
}

describe('door and cassette', () => {
  test('a full insert / eject cycle works repeatedly without getting stuck', () => {
    const deck = new Deck();
    for (let i = 0; i < 5; i++) {
      deck.insert();
      run(deck, 2.5);
      expect(deck.snapshot().cassette).toBe('seated');
      expect(deck.snapshot().door).toBe('closed');
      expect(deck.engaged).toBe(true);
      deck.press('eject');
      run(deck, 1);
      expect(deck.snapshot().door).toBe('open');
      deck.press('eject');
      run(deck, 1);
      expect(deck.snapshot().cassette).toBe('outside');
      deck.closeDoor();
      run(deck, 1);
      expect(deck.snapshot().door).toBe('closed');
    }
  });

  test('door cannot close while a cassette is in the way', () => {
    const deck = new Deck();
    deck.openDoor();
    run(deck, 1);
    deck.pickUp({ x: 0, y: 0, z: 30 });
    deck.moveHeld({ x: 0, y: 0, z: 20 }, true);
    expect(deck.snapshot().cassette).toBe('aligned');
    const r = deck.closeDoor();
    expect(r.ok).toBe(false);
    expect(deck.snapshot().door).toBe('obstructed');
    expect(deck.drain().some((e) => e.type === 'doorObstructed')).toBe(true);
    run(deck, 1);
    expect(deck.snapshot().door).toBe('open');
  });

  test('releasing an aligned cassette seats it; releasing elsewhere sends it home', () => {
    const deck = new Deck();
    deck.openDoor();
    run(deck, 1);
    deck.pickUp({ x: 80, y: 0, z: 0 });
    deck.moveHeld({ x: 60, y: 0, z: 10 }, false);
    deck.release();
    expect(deck.snapshot().cassette).toBe('returning');
    run(deck, 1);
    expect(deck.snapshot().cassette).toBe('outside');
    deck.pickUp({ x: 80, y: 0, z: 0 });
    deck.moveHeld({ x: 2, y: 1, z: 10 }, true);
    deck.release();
    run(deck, 1);
    expect(deck.snapshot().cassette).toBe('seated');
  });

  test('insert works after an interrupted drag', () => {
    const deck = new Deck();
    deck.openDoor();
    run(deck, 1);
    deck.pickUp({ x: 80, y: 0, z: 0 });
    deck.moveHeld({ x: 1, y: 0, z: 5 }, true);
    deck.cancelHold();
    run(deck, 1);
    expect(deck.snapshot().cassette).toBe('outside');
    expect(deck.insert().ok).toBe(true);
    run(deck, 1);
    expect(deck.snapshot().cassette).toBe('seated');
  });

  test('rapid repeated eject presses never break the state', () => {
    const deck = loaded();
    deck.press('play');
    for (let i = 0; i < 40; i++) {
      deck.press('eject');
      run(deck, 0.05);
    }
    run(deck, 2);
    const s = deck.snapshot();
    expect(s.door).toBe('open');
    expect(s.cassette).toBe('outside');
    expect(s.mode).toBe('stopped');
  });

  test('one tap on the cassette with the door shut opens the door then seats the tape', () => {
    const deck = new Deck();
    deck.insert();
    expect(deck.snapshot().door).toBe('opening');
    run(deck, TIMING.doorOpen + 0.02);
    expect(deck.snapshot().cassette).toBe('inserting');
    run(deck, TIMING.insert);
    expect(deck.snapshot().cassette).toBe('seated');
  });

  test('a seated tape cannot be picked up through a closed door', () => {
    const deck = loaded();
    expect(deck.pickUp({ x: 0, y: 0, z: 0 }).ok).toBe(false);
    expect(deck.flip().ok).toBe(false);
  });
});

describe('transport', () => {
  test('playing without a seated tape gives feedback instead of silently succeeding', () => {
    const deck = new Deck();
    const r = deck.press('play');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/insert/i);
    expect(deck.snapshot().mode).toBe('stopped');
    expect(deck.drain().some((e) => e.type === 'denied')).toBe(true);
  });

  test('play while the door is opening on an empty deck is refused', () => {
    const deck = new Deck();
    deck.openDoor();
    run(deck, 0.2);
    expect(deck.press('play').ok).toBe(false);
  });

  test('audio time is the source of truth while playing', () => {
    const deck = loaded();
    deck.press('play');
    deck.syncFromAudio(12.5);
    expect(deck.time()).toBeCloseTo(12.5, 6);
    run(deck, 1); // update() alone must not advance the tape while playing
    expect(deck.time()).toBeCloseTo(12.5, 6);
  });

  test('pause stops mechanical motion and resumes on pause or play', () => {
    const deck = loaded();
    deck.press('play');
    deck.syncFromAudio(5);
    deck.press('pause');
    expect(deck.snapshot().mode).toBe('paused');
    const before = reelPose(deck.snapshot().tape, deck.snapshot().wound);
    run(deck, 1);
    const after = reelPose(deck.snapshot().tape, deck.snapshot().wound);
    expect(after).toEqual(before);
    deck.press('pause');
    expect(deck.snapshot().mode).toBe('playing');
  });

  test('fast-forward advances and rewind returns, clamping at the ends', () => {
    const deck = loaded(40, 30);
    deck.seekTo(10);
    deck.press('fastForward');
    run(deck, 0.5);
    const t1 = deck.time();
    expect(t1).toBeGreaterThan(10.5);
    run(deck, 20);
    expect(deck.snapshot().mode).toBe('ended');
    expect(deck.time()).toBeCloseTo(40, 3);
    deck.press('rewind');
    run(deck, 0.5);
    expect(deck.time()).toBeLessThan(40);
    run(deck, 20);
    expect(deck.snapshot().mode).toBe('stopped');
    expect(deck.time()).toBe(0);
  });

  test('pressing a wind key twice stops winding', () => {
    const deck = loaded();
    deck.seekTo(10);
    deck.press('rewind');
    deck.press('rewind');
    expect(deck.snapshot().mode).toBe('stopped');
  });

  test('end of playback enters the ended state and play is refused until rewound or flipped', () => {
    const deck = loaded(40, 30);
    deck.press('play');
    deck.syncFromAudio(40);
    deck.reachEnd();
    expect(deck.snapshot().mode).toBe('ended');
    expect(deck.press('play').ok).toBe(false);
    deck.seekBy(-10);
    expect(deck.snapshot().mode).toBe('stopped');
    expect(deck.press('play').ok).toBe(true);
  });

  test('flipping swaps the side and keeps the physical tape position', () => {
    const deck = loaded(40, 30);
    deck.seekTo(10);
    const wound = deck.snapshot().wound;
    deck.press('eject');
    run(deck, 1);
    deck.flip();
    run(deck, TIMING.flip + 0.05);
    const s = deck.snapshot();
    expect(s.side).toBe('B');
    expect(s.cassette).toBe('seated');
    expect(s.wound).toBeCloseTo(wound, 9);
    expect(s.duration).toBe(30);
    expect(deck.drain().some((e) => e.type === 'flipped' && e.side === 'B')).toBe(true);
  });

  test('side B playback winds the tape back toward side A’s start', () => {
    const deck = loaded(40, 40);
    deck.press('eject');
    run(deck, 1);
    deck.flip();
    run(deck, 2);
    deck.closeDoor();
    run(deck, 1);
    deck.seekTo(5);
    const w0 = deck.snapshot().wound;
    deck.seekTo(15);
    expect(deck.snapshot().wound).toBeLessThan(w0);
  });

  test('eject while playing stops the transport first', () => {
    const deck = loaded();
    deck.press('play');
    deck.press('eject');
    expect(deck.snapshot().mode).toBe('stopped');
    expect(deck.snapshot().door).toBe('opening');
  });

  test('a blank side still runs the transport on its own clock', () => {
    const deck = loaded(40, 0);
    deck.press('eject');
    run(deck, 1);
    deck.flip();
    run(deck, 2);
    deck.closeDoor();
    run(deck, 1);
    expect(deck.duration()).toBe(0);
    expect(deck.press('play').ok).toBe(false); // nothing recorded, nothing to play
  });

  test('setDuration keeps the current playback time', () => {
    const deck = loaded(30, 30);
    deck.seekTo(12);
    deck.setDuration('A', 95);
    expect(deck.time()).toBeCloseTo(12, 6);
    expect(deck.duration()).toBe(95);
  });
});

describe('one-tap loading and keys behind an open door', () => {
  test('one-tap insert opens the door, seats the tape and closes the door', () => {
    const d = new Deck(30, 30);
    d.insert();
    run(d, 3);
    const s = d.snapshot();
    expect(s.cassette).toBe('seated');
    expect(s.door).toBe('closed');
    expect(s.engaged).toBe(true);
  });

  test('play pressed during one-tap loading starts once the door shuts', () => {
    const d = new Deck(30, 30);
    d.insert();
    run(d, 0.3);
    expect(d.press('play').ok).toBe(true);
    expect(d.snapshot().mode).toBe('stopped');
    run(d, 3);
    expect(d.snapshot().mode).toBe('playing');
  });

  test('play with the door open and a tape seated closes the door, then plays', () => {
    const d = new Deck(30, 30);
    d.openDoor();
    run(d, 1);
    d.insert();
    run(d, 1);
    expect(d.snapshot().door).toBe('open');
    d.press('fastForward');
    expect(d.snapshot().door).toBe('closing');
    run(d, 1);
    expect(d.snapshot().door).toBe('closed');
    expect(d.snapshot().mode).toBe('fastForward');
  });

  test('opening the door cancels a queued key', () => {
    const d = new Deck(30, 30);
    d.openDoor();
    run(d, 1);
    d.insert();
    run(d, 1);
    d.press('play');
    run(d, 1);
    d.press('stop');
    d.press('eject');
    run(d, 1);
    expect(d.snapshot().door).toBe('open');
    expect(d.snapshot().mode).toBe('stopped');
  });

  test('play with the door open and no tape is still refused', () => {
    const d = new Deck(30, 30);
    d.openDoor();
    run(d, 1);
    expect(d.press('play').ok).toBe(false);
  });
});
