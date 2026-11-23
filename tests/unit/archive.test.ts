import { describe, expect, test } from 'vitest';
import { ARCHIVE_EXT, packTape, unpackTape } from '../../src/library/archive';
import { blankTape } from '../../src/library/schema';

function tapeWithMedia() {
  const t = { ...blankTape(), title: 'Road trip', note: 'Summer 1999' };
  t.sides.A = { ...t.sides.A, label: 'Highway', audioKey: 'a', audioName: 'a.mp3', duration: 30 };
  t.artKey = 'art';
  const media = {
    a: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/mpeg' }),
    art: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }),
  };
  return { t, media };
}

describe('tape archive', () => {
  test('round-trips a tape and its media byte for byte, under fresh ids', async () => {
    const { t, media } = tapeWithMedia();
    const file = await packTape(t, media);
    expect(file.type).toBe('application/x-cassette-study');
    const back = await unpackTape(file);
    expect(back.tape.title).toBe('Road trip');
    expect(back.tape.sides.A.label).toBe('Highway');
    expect(back.tape.id).not.toBe(t.id);
    const aKey = back.tape.sides.A.audioKey!;
    expect(aKey).not.toBe('a');
    expect(new Uint8Array(await back.media[aKey].arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(back.media[aKey].type).toBe('audio/mpeg');
    expect(back.media[back.tape.artKey!].size).toBe(2);
    expect(ARCHIVE_EXT).toBe('.cassette');
  });

  test('rejects files that are not tapes', async () => {
    await expect(unpackTape(new Blob(['hello world, definitely not a tape']))).rejects.toThrow(/not a Cassette Study tape/i);
  });

  test('rejects a truncated archive', async () => {
    const { t, media } = tapeWithMedia();
    const file = await packTape(t, media);
    const cut = file.slice(0, file.size - 3);
    await expect(unpackTape(cut)).rejects.toThrow(/damaged|incomplete/i);
  });

  test('rejects a tampered header that points outside the file', async () => {
    const { t, media } = tapeWithMedia();
    const buf = new Uint8Array(await (await packTape(t, media)).arrayBuffer());
    const text = new TextDecoder().decode(buf);
    const forged = text.replace(/"size":5/, '"size":9999999');
    await expect(unpackTape(new Blob([forged]))).rejects.toThrow(/damaged|incomplete/i);
  });

  test('rejects media of the wrong kind', async () => {
    const { t } = tapeWithMedia();
    const media = {
      a: new Blob(['<script>'], { type: 'text/html' }),
      art: new Blob([new Uint8Array([9])], { type: 'image/png' }),
    };
    const file = await packTape(t, media);
    await expect(unpackTape(file)).rejects.toThrow(/audio/i);
  });
});
