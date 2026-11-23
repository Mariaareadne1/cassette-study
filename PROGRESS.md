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

## Next
- Milestone 2: full UI, accessible control strip, keyboard, reduced motion, portrait layout, credits.
- Milestone 3: Make a Tape + IndexedDB library, archive export/import, collector card.
- Milestone 4: Playwright E2E. Milestone 5: demo films. Milestone 6: docs, deploy.
