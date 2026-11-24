'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeckController, type LoadedTape, type TimelineEntry } from '@/deck/controller';
import type { KeyName } from '@/engine/geometry/player';
import { Stage } from '@/engine/stage/Stage';
import { labelCanvas, type Art } from '@/engine/textures/label';
import { DEMO_TAPE, DEMO_URLS } from '@/library/demo';
import { FONTS, fontsReady } from './fonts';
import { Hud } from './Hud';
import { useDeck } from './useDeck';

export interface Engine {
  controller: DeckController;
  stage: Stage;
  /** Artwork for the next labels drawn (null for none). */
  setArt: (art: Art | null) => void;
  getArt: () => Art | null;
  /** Redraws both labels for a tape, e.g. while editing it. */
  drawLabels: (tape: LoadedTape['meta'], art: Art | null) => void;
}

declare global {
  interface Window {
    __cassette?: {
      controller: DeckController;
      stage: Stage;
      ready: boolean;
      labels: (tape: LoadedTape, art: Art | null) => void;
      /** Capture only: renders the logged session's audio offline and returns a base64 WAV. */
      soundtrack?: (timeline: TimelineEntry[], duration: number) => Promise<string>;
    };
  }
}

function query(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

/**
 * Development only: a personal tape kept in public/local/ (git- and deploy-ignored), so music
 * that can't be redistributed can still play on this machine. Automated browsers get the demo.
 */
async function localTape(): Promise<LoadedTape | null> {
  if (process.env.NODE_ENV !== 'development' || navigator.webdriver) return null;
  try {
    const res = await fetch('/local/tape.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    const t = raw as { title?: unknown; note?: unknown; sides?: Record<'A' | 'B', { label?: unknown; artist?: unknown; url?: unknown; duration?: unknown }> };
    const side = (k: 'A' | 'B') => {
      const s = t.sides?.[k];
      const ok = s && typeof s.url === 'string' && s.url.startsWith('/local/') && typeof s.duration === 'number' && s.duration > 0;
      return ok ? { label: String(s.label ?? `Side ${k}`).slice(0, 48), artist: typeof s.artist === 'string' ? s.artist.slice(0, 48) : '', url: s.url as string, duration: s.duration as number } : null;
    };
    const a = side('A');
    const b = side('B');
    if (!a && !b) return null;
    const meta = {
      ...DEMO_TAPE,
      title: String(t.title ?? 'My tape').slice(0, 60),
      note: String(t.note ?? '').slice(0, 80),
      sides: {
        A: a ? { ...DEMO_TAPE.sides.A, label: a.label, artist: a.artist, audioName: a.url, duration: a.duration } : { ...DEMO_TAPE.sides.A, label: 'Blank', duration: 0 },
        B: b ? { ...DEMO_TAPE.sides.B, label: b.label, artist: b.artist, audioName: b.url, duration: b.duration } : { ...DEMO_TAPE.sides.B, label: 'Blank', duration: 0 },
      },
    };
    return { meta, urls: { A: a?.url ?? null, B: b?.url ?? null } };
  } catch {
    return null;
  }
}

export default function Experience() {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [boot, setBoot] = useState({ step: 'Setting type', p: 0.1 });
  const view = useDeck(engine?.controller ?? null);

  const drawLabels = useCallback((stage: Stage, tape: LoadedTape, art: Art | null) => {
    stage.setLabel('A', labelCanvas(tape.meta, 'A', art, FONTS));
    stage.setLabel('B', labelCanvas(tape.meta, 'B', art, FONTS));
  }, []);

  useEffect(() => {
    let disposed = false;
    let stage: Stage | null = null;
    const controller = new DeckController();
    const q = query();
    const manual = q.has('capture');
    controller.virtualClock = manual;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || q.has('reduced');
    (async () => {
      await fontsReady();
      if (disposed || !host.current) return;
      setBoot({ step: 'Building the object', p: 0.45 });
      // Let the progress paint before the (synchronous) scene build.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (disposed || !host.current) return;
      try {
        stage = new Stage(
          host.current,
          {
            frame: controller.frame,
            tick: controller.tick,
            onKeyDown: (k: KeyName) => controller.keyDown(k),
            onKeyUp: (k: KeyName) => controller.keyUp(k),
            onDoorTap: () => controller.toggleDoor(),
            onCassetteTap: () => controller.insertOrRemove(),
            onCassetteGrab: (at) => controller.grab(at),
            onCassetteMove: (at, near) => controller.moveHeld(at, near),
            onCassetteDrop: () => controller.drop(),
            onCassetteCancel: () => controller.cancelHold(),
          },
          { fonts: FONTS, manual, preserveBuffer: manual || q.has('preserve'), reducedMotion: reduced, maxDpr: 2 },
        );
      } catch (err) {
        setFailed(err instanceof Error ? err.message : 'WebGL could not start.');
        controller.dispose();
        return;
      }
      if (disposed) {
        stage.dispose();
        return;
      }
      const s = stage;
      let art: Art | null = null;
      controller.onTapeChanged = (tape) => {
        if (tape) drawLabels(s, tape, art);
      };
      const demo: LoadedTape = (!manual && (await localTape())) || { meta: DEMO_TAPE, urls: { ...DEMO_URLS } };
      drawLabels(s, demo, null);
      window.__cassette = { controller, stage: s, ready: false, labels: (t, a) => drawLabels(s, t, a) };
      if (manual) {
        window.__cassette.soundtrack = async (timeline, duration) => {
          const { renderSoundtrack, encodeWav } = await import('@/deck/soundtrack');
          const wav = encodeWav(await renderSoundtrack(timeline, { duration, urls: DEMO_URLS }));
          let bin = '';
          for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
          return btoa(bin);
        };
      }
      setEngine({
        controller,
        stage: s,
        setArt: (a) => {
          art = a;
        },
        getArt: () => art,
        drawLabels: (meta, a) => drawLabels(s, { meta, urls: { A: null, B: null } }, a),
      });
      setBoot({ step: 'Threading the tape', p: 0.8 });
      await controller.loadTape(demo);
      if (!disposed) setBoot({ step: 'Ready', p: 1 });
      if (window.__cassette) window.__cassette.ready = true;
    })();
    const onBlur = (): void => stage?.cancelGestures();
    window.addEventListener('blur', onBlur);
    return () => {
      disposed = true;
      window.removeEventListener('blur', onBlur);
      stage?.dispose();
      controller.dispose();
      delete window.__cassette;
    };
  }, [drawLabels]);

  return (
    <main className="cs" data-ready={engine ? '' : undefined}>
      <div className="cs-stage" ref={host} />
      {!failed && (
        <div className="cs-boot" data-done={boot.p >= 1 ? '' : undefined} aria-hidden={boot.p >= 1}>
          <div className="cs-boot-inner" role="progressbar" aria-label="Loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boot.p * 100)}>
            {boot.step}
            <div className="cs-boot-bar">
              <span style={{ transform: `scaleX(${boot.p})` }} />
            </div>
          </div>
        </div>
      )}
      {failed && (
        <p className="cs-fail" role="alert">
          <strong>The object couldn’t be drawn.</strong>
          This player needs WebGL 2, and this browser or device couldn’t start it. Try a recent Chrome, Safari or Firefox with
          hardware acceleration on. <small>({failed})</small>
        </p>
      )}
      {engine && view && <Hud engine={engine} view={view} />}
    </main>
  );
}
