# Progress

## Milestone 0 — Source audit ✅
- Cloned both references outside this repo (`~/Development/_refs`), ran Ann Nguyen's CD case locally, captured it (`docs/media/reference/`), wrote `docs/SOURCE_AUDIT.md` (rendering pipeline, reuse plan, licence position).

## Milestone 1 — Object, transport model, first render ✅
- Ported the reference studio / refraction-rod / sheet shaders and framebuffer sequence to TypeScript, generalised to several nested glass groups (body, cassette, door).
- Modelled the player (chassis, hinged door, deck plate, spindles, flywheel, capstan, head, pinch roller, keys, volume wheel, jack) and the cassette (shell, hubs, packs, rollers, guides, pad, screws, tape path, two labels).
- Pure, time-stepped deck state machine (door, cassette, transport) and a physical tape model (area-conserving pack radii, ω = v/R, FF/REW at constant take-up speed, Side A/B on one tape).
- Real audio (HTML media + Web Audio), synthesised mechanical sound, original demo recordings (`scripts/make-demo-audio.mjs`).
- One-tap loading opens the door, seats the tape and closes the door; Play/FF/REW with the door open shuts it first.
- Tests: 40 unit tests (transport + machine), all passing. Visual QA via `scripts/shoot.mjs` (headless Chrome, Metal).

## Milestone 2 — Interface ✅
- Editorial masthead, quiet state-derived hint line, accessible transport strip driving the same controller as the physical keys (latched keys mirrored with `aria-pressed`), seek bar, music / mechanism / mute mixer, Object · Reels · Keys macro views, reset view.
- Keyboard shortcuts, native modal dialogs, polite live-region toasts, boot progress, WebGL failure message, reduced motion, portrait layout. About dialog credits Ann Nguyen and TypingMind.

## Milestone 3 — Make a Tape and the shelf ✅
- Upload Side A/B (MP3/WAV/M4A; type, size and decode checks, 80 MB / 60 min limits), labels, note, six label stocks, three layouts, artwork; the 3D labels follow the draft live.
- IndexedDB shelf (`src/library/store.ts`): atomic tape+media writes, orphan cleanup, rename, duplicate, delete with confirmation, corrupt-record skipping, quota messages, in-memory fallback when storage is blocked.
- `.cassette` export/import archive with full validation; collector card PNG.
- Changing tapes ejects the seated one, relabels it at rest and loads it back in.

## Milestone 4 — Tests ✅
- 54 unit tests (transport, machine, store, archive) — `npm test`.
- 9 Playwright tests on real Chrome with GPU WebGL — `npm run test:e2e`: boot without console/shader errors; audio plays, analyser hears signal, time advances, reels turn; pause freezes both; FF/REW; door tap and drag-to-seat; keyboard; side B; make a tape → reload → play saved audio → delete; invalid upload; export/import + card download.

## Next
- Milestone 5: demo films. Milestone 6: docs, production build, deploy.
