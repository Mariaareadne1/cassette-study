# Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Vitest unit tests (Node; IndexedDB via fake-indexeddb) |
| `npm run test:e2e` | Playwright on real Chrome with GPU WebGL; starts `next dev` on 5560 unless `E2E_BASE_URL` is set |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · ESLint (next/core-web-vitals + typescript) |
| `node scripts/shoot.mjs` | Visual QA stills from several angles and states (`artifacts/shots`) |
| `node scripts/shoot-ui.mjs` | Make a Tape, Shelf, About and the collector card (`artifacts/ui`) |
| `node scripts/film.mjs --variant=…` | Deterministic demo films (`demo/`) |

Headless Chrome is launched with `--use-angle=metal --enable-gpu` so the shaders compile and run on the
GPU, as they do for visitors. On Linux CI swap in `--use-angle=swiftshader` (slower, same results).

## Unit (56)

- **transport** — pack radii at start / middle / end, area conservation, monotonic transfer,
  `ω = v/R` against a numerical derivative, no NaN at the extremes, time ↔ position inverses, side B
  mirror, seek re-poses reels, wind direction / acceleration / clamping.
- **machine** — repeated insert/eject cycles, door obstruction, aligned release seats / elsewhere returns,
  interrupted drag recovery, eject spam, one-tap load closes the door, keys behind an open door shut it
  first, no pickup through a closed door, play without a tape is refused with feedback, audio is the
  source of truth, pause freezes, FF/REW clamp, end state, flip keeps the tape position, side B winds
  back toward A, blank side runs on its own clock.
- **store** — persistence across reopen, ordering, rename validation, duplicate copies media, replacing
  a side deletes the old blob, delete removes media, missing media refused, corrupt records skipped,
  memory fallback.
- **archive** — byte-exact round trip under fresh ids, non-tapes rejected, truncated and tampered
  headers rejected, wrong media types rejected.
- **soundtrack** — event log → music / motor / wind spans and cues.

## Browser (9)

- Boots with no console errors and no shader compile errors; the stage renders frames.
- One real click loads the tape; **Play** makes sound (element playing, `currentTime` rising, the Web
  Audio analyser hears signal) and the reels turn; **Pause** freezes time and reels.
- Fast-forward winds ahead, Stop holds, Rewind returns to 0:00 and stops.
- Clicking the door opens it; dragging the cassette over the deck snaps it into alignment; releasing
  seats it.
- Keyboard: Space plays/pauses, E stops and opens the door.
- Wind side A to its end, eject, turn over: side B starts at 0:00 and plays “Night Index”.
- Make a tape with two WAV sides, artwork and a layout → it plays → **reload** → it's on the shelf →
  load and play the saved audio → delete with confirmation.
- A non-audio file is refused with a clear message; saving with no recordings is refused.
- Export downloads `round-trip.cassette`; importing it adds a second copy; the collector card downloads.

Last run: all 56 unit and 9 browser tests passing (see `PROGRESS.md` for the date).

## Not covered automatically

- Safari / Firefox: checked by hand only where noted in `PROGRESS.md`.
- Touch gestures on real phones (pointer logic is shared with mouse and covered by the drag test).
- Audible quality of the mix — judged by ear.
