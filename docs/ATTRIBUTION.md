# Attribution

## Ann Nguyen — CD Case (primary reference)

Cassette Study's glass rendering is adapted from **Ann Nguyen**'s CD case experiment —
live at <https://www.bubbbly.com/cd-case>, source at
<https://github.com/annnguyentt/vibe-coding/tree/main/cd-case> (commit `faca2f6`), made with
**TypingMind** (<https://www.typingmind.com>).

The collection asks that anyone who uses, remixes, forks or learns from it gives credit to Ann Nguyen
and TypingMind; a mention or link back is enough. There is no licence file, so we treat this as
permission to remix with credit, not as an open-source licence.

| File here | What came from the CD case | What changed |
| --- | --- | --- |
| `src/engine/shaders/studio.ts` | `STUDIO`, room bake, `ROD_VERT/FRAG` (ray-traced refraction rods), `SHEET_*`, copy/bright/streak/final passes | Ported to TypeScript exports; star mix tinted toward the study's icy accent and softened |
| `src/engine/geometry/rods.ts` | Rounded-rect profile sweeps, `RodBuilder`, sheet helpers | Ported to TypeScript, generalised for many parts |
| `src/engine/stage/pipeline.ts` | The framebuffer sequence: opaque page → back-to-front glass in ping-pong MSAA targets with copy quad and depth proxies → bloom/streak → sRGB | Generalised from one case to several nested glass groups (body, cassette, door) with ordering rules; page target got depth |
| `src/engine/stage/motion.ts` | Monotone cubic `curve()` | Ported; new door, ejector and flip curves |

Not copied: the TypingMind badge, the disc print (`stickers.webp`), any of the case geometry, any
branding. Everything else — the player and cassette models, the mechanism, the tape transport model,
the state machine, audio, sound, library, UI and tooling — is new work for this study.

## iverene — The Cassette Player (secondary reference)

<https://github.com/iverene/the-cassette-player> was read for interaction ideas only. It has no licence
and no permission statement, so **no code, assets or styling were copied**, and its dark CRT look was
deliberately not reproduced.

## Audio

- “Glass Morning” (side A) and “Night Index” (side B) are synthesised from code in
  `scripts/make-demo-audio.mjs`; no samples or third-party recordings.
- Mechanical sounds are synthesised live with Web Audio (`src/deck/sfx.ts`).

## Dependencies

three.js, Next.js, React (MIT). Dev: Playwright, Vitest, fake-indexeddb, ffmpeg-static / ffprobe-static
(ffmpeg itself is LGPL/GPL; it is used only as a local build tool for the demo films and is not shipped).

## Marks

No manufacturer names or logos are used. “CS-001” and all lettering on the object are invented for
the study.
