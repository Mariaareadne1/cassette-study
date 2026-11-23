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

## Milestone 5 — Demo films ✅
- `scripts/film.mjs` steps the real app on a virtual clock (`?capture`) and performs the same controller calls a click would; 840 frames per film.
- Soundtrack re-rendered offline from the logged events (same demo recordings, same Sfx code, gentle limiter; peaks −0.9 dBFS, mean −19 dB). Not a recording of live output — documented.
- `demo/cassette-study-landscape.mp4` (1920×1080) and `-portrait.mp4` (1080×1920): H.264 High, yuv420p, 30 fps, AAC 48 kHz, 28.00 s, ~34 MB each — verified with ffprobe by `scripts/media.mjs`; published as release assets, not committed.
- `demo/poster.png`, `demo/contact-sheet.png`, `demo/screenshots/*.jpg`, `demo/reels-loop.{gif,webp}` (loops are release assets).

## Milestone 6 — Docs and deploy ✅
- README, ARCHITECTURE, TESTING, CASE_STUDY, ATTRIBUTION, SOURCE_AUDIT.
- Next upgraded 15.5.4 → 15.5.29 (Vercel blocked the vulnerable version). Production build passes (first load 99 kB; Three.js loads with the experience).
- Live at https://cassette-study-six.vercel.app (Vercel CLI deploy, no Git integration — redeploy with `npx vercel deploy --prod` after pushing). Boot and audio-playback e2e tests pass against the live URL.

## Known limitations
- Glass groups are ordered per group, not per fragment: at extreme angles with the door half open a thin edge can composite out of order.
- Flipping a fully rewound tape lands at the end of side B (physically correct); the toast says to rewind.
- In the portrait film's final seconds the object overlaps the lower controls briefly.
- `npm audit` still reports Next's bundled build-time `postcss`; fixing it needs a Next major upgrade. Not shipped to the browser.
- Checked in Chrome (desktop, headless GPU). Safari / Firefox and real touch devices not yet tested by hand.
