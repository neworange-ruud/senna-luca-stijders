# Phase 9 - Worlds, teleports, tutorial, audio, and accessibility

Inspect this phase by opening the game, choosing a world, and reading the one
green line above the arena. `docs/checkpoints/phase-09-boat.png` shows the boat,
`phase-09-city-roof.png` shows a child who took the lift to a rooftop, and
`phase-09-performance-chromium.json` and `phase-09-performance-webkit.json`
carry the measured frame reports.

## What the children get

- Six worlds that actually play differently. The beach is the gentle one. The
  forest is two tree staircases with trunks to hide behind. The space planet has
  a gap in the ground with a crater island in the middle, so a jump can be
  missed. The building site is a scaffolding tower against long girders. The city
  is a street with two rooftops. The boat is the smallest world, for a short
  loud fight.
- Lifts in the city. A lift always leads to the one lift with the same name, and
  both ends carry that name on screen, so where it goes is visible without a
  menu. Riding is a press of Actie, arriving is safe, and the same child cannot
  ride again for a second and a half.
- One short instruction at a time, in Dutch, above the arena. It explains
  walking, jumping, attacking, blocking, switching weapons, and pausing, in that
  order, and only while it is still useful. A lift or a chest in reach always
  comes first because that is what is in front of the child.
- A chest or a lift now also answers to a quick tap. Both used to need the
  control to be held across a whole tick.
- Sound for every gameplay event, plus the pause and the countdown, with
  separate mutes for effects and music that survive a reload.

## Decisions

- Every world has its own arena file, and the arena is derived from the world the
  match is playing rather than stored separately, so a checkpoint can never
  disagree with the world it says it is in. An unknown world falls back to the
  beach instead of failing.
- Reachability counts teleports as travel. Without that, a rooftop only a lift
  can reach would look unreachable and the city would have had to be flattened
  into another beach.
- A teleport leads to exactly one other teleport. A list of destinations would
  need a menu in the middle of a fight, which a seven-year-old should not have to
  read; a named pair is visible on the wall instead.
- A refused ride costs no cooldown, so a child whose exit is blocked can simply
  try again, and it still makes a sound so nothing happens silently.
- One press does one thing: a child who opens a chest while standing on a lift
  keeps the chest and stays where they are.
- Persisted state moved to schema v7 for the remembered Action press and the
  lift cooldown.
- Every Dutch word the children read now lives in one catalogue, and the tests
  walk that catalogue against the types it describes, so a new rule cannot ship
  with an English label.
- The frame rate is only asserted where the browser composites on a GPU. The
  work the game itself does per frame is asserted everywhere, because that is
  the part this repository owns. See the note below.

## Verification

- `npm run check`: 228 unit tests, 10 Node integration tests, 12 Worker
  integration tests, formatting, typed lint, three TypeScript runtimes, build.
- `npx playwright test`: 43 journeys pass in Chromium and WebKit, 1 skipped
  (the documented WebKit socket-cut limitation).
- `tests/unit/worlds.test.ts` (24 tests): all six arenas validate, every
  non-cover surface is reachable, no spawn or chest point stands inside cover,
  the two players always start far apart, the city rooftops are reachable only
  through a lift, and every teleport leads to one that leads back.
- `tests/unit/teleports.test.ts` (10 tests): a ride, a refusal without a lift,
  no ride without a press, the cooldown, a sideways arrival when the exit is
  taken, a reported refusal when nothing is free, chest before lift, no ride
  without hearts, worlds without lifts, and a tap between two ticks.
- `tests/unit/hints.test.ts` (12 tests): the order of the lesson, hints that
  stop once a control is used, hints that never come back, the lift and the
  chest jumping the queue, and damaged storage.
- `tests/unit/dutch.test.ts` (7 tests): every phase, event, outcome, weapon,
  effect, role, chest outcome, world, and appearance has a Dutch name; the same
  word is used for a weapon everywhere; and no English is left in the pages or
  the catalogue.
- `tests/e2e/worlds.spec.ts`: the chosen world decides the ground, and a lift
  carries a child to a rooftop while the other player sees the same move.
- `tests/e2e/accessibility.spec.ts`: every visible control is at least 44 by 44
  pixels and has a name, every text and background pair meets 4.5:1 (3:1 for
  large text) measured from the computed styles, the setup is reachable by
  keyboard, the whole match is described in text outside the canvas, browser
  gestures cannot be triggered on the arena, a portrait iPad is told to turn,
  and a reduced-motion match still plays.
- `tests/e2e/performance.spec.ts`: six seconds of a moving match in the busiest
  world, with the frame report written to `docs/checkpoints/`.

## Measured performance

| Engine | Average fps | Median frame | Game work per frame | Snapshot parsing | Heap growth |
| --- | --- | --- | --- | --- | --- |
| Chromium | 58.4 | 16.7 ms | 0.24 ms | 2.5 ms total | 0 MB |
| WebKit | 7.4 | 139 ms | 0.32 ms | 2.0 ms total | not reported |

Culling everything the camera cannot see took Chromium from 50.3 to 58.4 frames
per second and dropped its slow frames from 12 to 1 in six seconds. The backdrop
is now scaled once and copied rather than resampled 60 times a second.

WebKit's 7.4 frames per second was investigated rather than accepted:

- An empty page in the same browser holds 60 frames per second, so it is not a
  general throttle.
- Timing every canvas call in a running match accounts for 2 ms out of 3.1
  seconds, and the game's own frame callbacks account for 10 ms of it. Over 3.1
  seconds, 3.108 seconds are spent outside our code.
- Rendering the same match at 24 percent of the pixels raises it from 24 frames
  to 88 frames in the same three seconds, which tracks the pixel count.

Playwright's WebKit on this machine rasterises in software with no GPU, so the
frame rate it reports says nothing about an iPad, while the 0.32 ms the game
spends per frame does. The 30 frames per second floor on the target devices is
measured physically in Phase 10, which is where that gate belongs.

## Remaining

Phase 10: acceptance mapping, the full security and dependency audit, the
physical iPad measurements, and the release documentation.
