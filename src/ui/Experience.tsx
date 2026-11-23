'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeckController, type LoadedTape } from '@/deck/controller';
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
}

declare global {
  interface Window {
    __cassette?: {
      controller: DeckController;
      stage: Stage;
      ready: boolean;
      labels: (tape: LoadedTape, art: Art | null) => void;
    };
  }
}

function query(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

export default function Experience() {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
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
          { fonts: FONTS, manual, preserveBuffer: manual || q.has('preserve'), reducedMotion: reduced, maxDpr: manual ? 1 : 2 },
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
      controller.onTapeChanged = (tape) => {
        if (tape) drawLabels(s, tape, null);
      };
      const demo: LoadedTape = { meta: DEMO_TAPE, urls: { ...DEMO_URLS } };
      drawLabels(s, demo, null);
      window.__cassette = { controller, stage: s, ready: false, labels: (t, a) => drawLabels(s, t, a) };
      setEngine({ controller, stage: s });
      await controller.loadTape(demo);
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
      {failed && (
        <p className="cs-fail" role="alert">
          Cassette Study needs WebGL, and this browser couldn’t start it. ({failed})
        </p>
      )}
      {engine && view && <Hud engine={engine} view={view} onDrawLabels={drawLabels} />}
    </main>
  );
}
