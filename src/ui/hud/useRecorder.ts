import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '@/deck/audio';
import { saveFile } from '@/library/media';

const FPS = 60;
const VIDEO_BITS = 8_000_000;
/** Preferred first: MP4 plays everywhere; WebM is the fallback where MP4 recording is missing. */
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];

export type RecorderState = { recording: boolean; seconds: number; error: string | null };

function pickType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/**
 * Records the player itself — the 3D canvas plus the sound it makes — until stopped, then saves
 * the video. Only the object is captured, so the interface (and this button) never appear in it.
 */
export function useRecorder(canvas: HTMLCanvasElement, audio: AudioEngine) {
  const [state, setState] = useState<RecorderState>({ recording: false, seconds: 0, error: null });
  const rec = useRef<{ mr: MediaRecorder; release: () => void; timer: number; tracks: MediaStreamTrack[] } | null>(null);

  const cleanup = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.tracks.forEach((t) => t.stop());
    r.release();
    rec.current = null;
  }, []);

  const start = useCallback(() => {
    const type = pickType();
    if (!type || typeof canvas.captureStream !== 'function') {
      setState({ recording: false, seconds: 0, error: 'This browser can’t record video.' });
      return;
    }
    try {
      const video = canvas.captureStream(FPS);
      const tap = audio.tap();
      const tracks = [...video.getVideoTracks(), ...(tap?.stream.getAudioTracks() ?? [])];
      const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: VIDEO_BITS });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      mr.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: mr.mimeType || type });
        if (blob.size > 0) saveFile(blob, `Cassette demo ${stamp()}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
        setState({ recording: false, seconds: 0, error: blob.size > 0 ? null : 'Nothing was recorded.' });
      };
      const t0 = performance.now();
      const timer = window.setInterval(() => setState((s) => ({ ...s, seconds: Math.floor((performance.now() - t0) / 1000) })), 250);
      rec.current = { mr, release: tap?.release ?? (() => undefined), timer, tracks };
      mr.start(1000);
      setState({ recording: true, seconds: 0, error: null });
    } catch (err) {
      cleanup();
      setState({ recording: false, seconds: 0, error: err instanceof Error ? err.message : 'Recording couldn’t start.' });
    }
  }, [audio, canvas, cleanup]);

  const stop = useCallback(() => {
    const mr = rec.current?.mr;
    if (mr && mr.state !== 'inactive') mr.stop();
  }, []);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  // Leaving the page mid-recording: stop cleanly rather than leak the streams.
  useEffect(() => () => {
    const mr = rec.current?.mr;
    if (mr && mr.state !== 'inactive') {
      mr.onstop = null;
      mr.stop();
    }
    cleanup();
  }, [cleanup]);

  return { ...state, toggle };
}
