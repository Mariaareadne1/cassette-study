import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { blankTape } from '../../src/library/schema';
import { LibraryError, openLibrary } from '../../src/library/store';

const fresh = () => openLibrary({ idb: new IDBFactory(), name: `t-${Math.random()}` });
const audio = (bytes = 64) => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });

describe('tape library (IndexedDB)', () => {
  test('saves a tape with media and reads it back after reopening', async () => {
    const idb = new IDBFactory();
    const lib = await openLibrary({ idb, name: 'persist' });
    const tape = { ...blankTape(), title: 'Kitchen radio' };
    tape.sides.A = { ...tape.sides.A, audioKey: 'a1', audioName: 'a.mp3', duration: 12 };
    await lib.save(tape, { a1: audio(128) });
    lib.close();

    const again = await openLibrary({ idb, name: 'persist' });
    const list = await again.list();
    expect(list.map((t) => t.title)).toEqual(['Kitchen radio']);
    const blob = await again.media('a1');
    expect(blob?.size).toBe(128);
    expect(again.persistent).toBe(true);
  });

  test('lists newest first and renames without touching media', async () => {
    const lib = await fresh();
    const a = { ...blankTape(), title: 'One', updatedAt: 1 };
    const b = { ...blankTape(), title: 'Two', updatedAt: 2 };
    await lib.save(a, {});
    await lib.save(b, {});
    expect((await lib.list()).map((t) => t.title)).toEqual(['Two', 'One']);
    const renamed = await lib.rename(a.id, '  Renamed  ');
    expect(renamed.title).toBe('Renamed');
    expect((await lib.list())[0].title).toBe('Renamed');
  });

  test('rejects an empty name', async () => {
    const lib = await fresh();
    const a = blankTape();
    await lib.save(a, {});
    await expect(lib.rename(a.id, '   ')).rejects.toBeInstanceOf(LibraryError);
  });

  test('duplicate copies media under new keys', async () => {
    const lib = await fresh();
    const a = blankTape();
    a.sides.A = { ...a.sides.A, audioKey: 'k1', audioName: 'x.mp3', duration: 3 };
    await lib.save(a, { k1: audio(10) });
    const copy = await lib.duplicate(a.id);
    expect(copy.id).not.toBe(a.id);
    expect(copy.title).toBe(`${a.title} (copy)`);
    expect(copy.sides.A.audioKey).not.toBe('k1');
    expect((await lib.media(copy.sides.A.audioKey!))?.size).toBe(10);
    await lib.remove(a.id);
    expect((await lib.media(copy.sides.A.audioKey!))?.size).toBe(10);
    expect(await lib.media('k1')).toBeNull();
  });

  test('replacing a side removes the old recording', async () => {
    const lib = await fresh();
    const a = blankTape();
    a.sides.A = { ...a.sides.A, audioKey: 'old', audioName: 'o.mp3', duration: 3 };
    await lib.save(a, { old: audio() });
    const next = { ...a, sides: { ...a.sides, A: { ...a.sides.A, audioKey: 'new' } } };
    await lib.save(next, { new: audio(20) });
    expect(await lib.media('old')).toBeNull();
    expect((await lib.media('new'))?.size).toBe(20);
  });

  test('deleting removes the tape and its media', async () => {
    const lib = await fresh();
    const a = blankTape();
    a.artKey = 'art1';
    await lib.save(a, { art1: new Blob(['x'], { type: 'image/png' }) });
    await lib.remove(a.id);
    expect(await lib.list()).toEqual([]);
    expect(await lib.media('art1')).toBeNull();
  });

  test('refuses to save a tape whose media is missing', async () => {
    const lib = await fresh();
    const a = blankTape();
    a.sides.B = { ...a.sides.B, audioKey: 'ghost', audioName: 'g.mp3', duration: 1 };
    await expect(lib.save(a, {})).rejects.toThrow(/missing/i);
  });

  test('skips corrupt records instead of failing the whole shelf', async () => {
    const idb = new IDBFactory();
    const lib = await openLibrary({ idb, name: 'corrupt' });
    await lib.save(blankTape(), {});
    await lib.putRaw({ id: 'bad-1', nonsense: true });
    const list = await lib.list();
    expect(list).toHaveLength(1);
    expect(lib.skipped).toBe(1);
  });

  test('falls back to a session-only shelf when IndexedDB is unavailable', async () => {
    const lib = await openLibrary({ idb: null });
    expect(lib.persistent).toBe(false);
    const a = blankTape();
    await lib.save(a, {});
    expect(await lib.list()).toHaveLength(1);
  });
});
