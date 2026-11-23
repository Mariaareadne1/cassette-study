# Case study — Cassette Study, Object Study 001

## The brief

Take Ann Nguyen's CD case — a single transparent object whose glass is so well lit you want to pick it
up — and ask what happens when the object has to *work*. A cassette player is the right next object: it
is transparent in the late-90s way (clear polycarbonate, silver mechanics showing through), and its whole
appeal is mechanical — keys that latch, a door that swings, reels you watch turn.

## Decisions

**Keep the light, change the object.** The CD case's rendering is the reason it feels real: an analytic
studio baked to an HDR cube map, lighting that stays fixed to the camera while the object turns, and
glass made of swept "rods" that ray-trace their own refraction. Replacing that with a generic
transmission material would have lost the point, so the shaders were ported almost verbatim and the
work went into generalising the framebuffer sequence from one glass object to three nested ones (body,
cassette, door), and into drawing a whole mechanism — deck plate, spindles, flywheel, capstan, head,
pinch roller, keys — behind the glass.

**Model the tape, not the animation.** Reels are the thing everyone watches, and they are easy to fake
badly. Here there is one physical tape: pack radii come from conserved area, each hub turns at `v/R`, and
fast-forward drives the take-up hub at constant angular speed, so the tape visibly accelerates. Side B is
the same tape run backwards, so flipping a fully rewound tape puts you at the *end* of side B — as it
would in your hand. The audio element's clock drives the tape while music plays; the reels follow the
music, not a timer.

**One state, many hands.** The physical keys, the accessible control strip, keyboard shortcuts and the
demo-film script all call the same controller methods on one pure state machine. That made the strange
cases testable — eject mid-load, dropping the tape beside the deck, closing the door on your own hand —
and it is why the films are real captures of the app rather than an animation.

**Make it forgiving.** Real decks are fussy; this one is honest but kind. One tap on the cassette opens
the door, seats the tape and shuts the door. Pressing play with the door open shuts it first. A drag
snaps the tape in once it's near the slot. Every refusal makes a small sound and says why.

**Your tape stays yours.** Make a Tape stores audio only in IndexedDB. Nothing uploads. A tape can leave
the browser only as a `.cassette` file the person downloads, and imports are validated byte by byte.

## What was hard

- **Nested glass.** A seated cassette is glass inside glass inside glass. The pipeline composites each
  group into the previous one's refraction, so order matters; it is forced by the camera's side of the
  object rather than sorted per frame, which removed popping during orbit.
- **Physical credibility at macro distance.** The Reels view puts the camera ~110 mm from a 100 mm
  cassette. Pack rings, leader clamps, guide rollers and the pressure pad had to hold up there.
- **Deterministic films with real sound.** Capture steps the app frame by frame, so the live audio can't
  be recorded. Instead the controller logs every event against the frame clock and the soundtrack is
  re-rendered offline from that log with the same recordings and the same synthesis code.

## Known limits

- Glass-group ordering is decided per group, not per fragment; at extreme angles with the door half
  open a thin edge can composite in the wrong order.
- No real record function — "Make a Tape" assembles a tape from files; it does not capture a microphone.
- Stop holds the tape where it is (as real decks do); there is no auto-reverse.
