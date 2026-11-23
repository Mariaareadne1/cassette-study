# Architecture

```
src/
  deck/          the instrument — no rendering
    transport.ts   physical tape model (pure)
    machine.ts     Deck: door / cassette / transport state machine (pure, time-stepped)
    audio.ts       AudioEngine: one HTMLAudioElement per side + Web Audio graph
    sfx.ts         synthesised mechanical sound (any BaseAudioContext)
    controller.ts  DeckController: intents → Deck → events → audio, sfx, view
    soundtrack.ts  offline re-render of a logged session (demo films)
  engine/        the object — no React
    shaders/       studio + refraction (adapted), surfaces, packs, decals, backdrop
    geometry/      rods, parts, player, cassette (all dimensions in mm)
    textures/      printed lettering, cassette labels
    stage/         Pipeline (framebuffers), Assembly (rigs/meshes), RigPoser (motion), Stage (camera, input)
  library/       tapes — no React
    schema.ts      TapeMeta, limits, validation
    store.ts       IndexedDB shelf (memory fallback)
    archive.ts     .cassette export / import
    card.ts        collector card
    media.ts       browser media helpers
  ui/            React: Experience (mounts everything), Hud, hud/*, library/*
```

## One source of truth

`Deck` (`src/deck/machine.ts`) owns door, cassette and transport state. Nothing else stores a copy:

- **Audio feeds the deck**, not the other way round: while playing, `DeckController.tick` reads the
  element's `currentTime` and calls `deck.syncFromAudio`. A blank side, or a capture run, advances on
  the frame clock instead (`advanceBlank`).
- **The 3D stage only reads** a `DeckSnapshot` each frame (`StageFrame`) and turns it into poses.
- **React only reads** a throttled immutable `ControllerView` through `useSyncExternalStore`.
- **Every input is an intent** on the controller — a click on a physical key, a button in the accessible
  strip, a keyboard shortcut and a scripted film action all call the same method.

Commands that the deck can't honour return `{ ok: false, message }` and emit a `denied` event, which the
controller turns into a sound and a toast. Nothing fails silently.

## Tape transport model

One physical tape of length `L` (both programmes plus leaders). `wound` is how much sits on the
right-hand hub. Side A time is `wound / v`; side B time is `(L − wound) / v`, so turning the tape over
keeps its physical position — the end of side A is the start of side B, as on a real cassette.

- Pack radii conserve area: `R = √(r₀² + w·h/π)` for tape length `w` and thickness `h`.
- Hub angle is closed-form, `θ = (2π/h)(R − r₀)`, so reels are exactly where they should be after a seek.
- While playing, linear speed is constant (`v = 47.625 mm/s`) and each hub turns at `ω = v/R`: the
  small hub spins visibly faster.
- Fast-forward and rewind drive the take-up hub at constant angular speed (`windStep`), so tape speed
  rises as the take-up pack grows; a full wind takes 3–9 s depending on length.

## Rendering

Adapted from Ann Nguyen's CD case (see `ATTRIBUTION.md`): an analytic studio baked to an HDR cube map,
camera-relative lighting, swept rounded-rect "rods" whose fragment shader ray-traces refraction through
their own analytic cross-section, and a framebuffer sequence that draws opaque parts first and then each
glass group back to front into ping-pong MSAA targets. Ours has three glass groups — body, cassette and
door — and forces the nesting order when the tape is seated (front-facing: body → cassette → door;
reversed from behind). Mechanical parts use a small PBR-ish surface shader that reflects the same
studio, so metal, rubber, paper and tape sit in the same light.

## Lifecycle

`Experience` creates the controller and stage once, after fonts are ready (canvas lettering needs them).
Its cleanup disposes the stage (geometries, materials, textures, render targets, listeners, rAF) and the
controller (audio elements, contexts, timers, object URLs). The shelf hook revokes every object URL it
created.
