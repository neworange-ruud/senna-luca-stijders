# Phase 11 - Animated player sprites

Inspect this by playing a match and walking: `docs/checkpoints/phase-11-idle.png`,
`phase-11-walk.png` and `phase-11-jump.png` are the three states, captured from a
real match in the browser.

## What the children get

- Both children play the same boy. Luca and Senna are both boys, so there is no
  longer one drawing for each of them; who is who is told by the name above the
  head and the coloured pad under the feet.
- The outfit they picked is the character they see. There is a spritesheet for
  each of the five outfits, so a child who picks the knight plays a knight in
  armour rather than a plain boy with a badge floating over his head. The badge
  is now only drawn while the artwork is still loading.
- Walking and jumping are animated. A walk cycles step, pass, other step, pass,
  and the steps come quicker the faster the child runs, so the speed power looks
  faster as well as being faster. Both feet off the ground draws the jump.

## How the sheets are made

Five generations, one per outfit, each a 2x2 block of four poses of the same
character: standing, one step, the other step, and a jump. Ideogram V4 at 1024 by
1024, the cheapest enabled image model, one output each, 0.3 Creative Units per
generation. The raw generations are in `assets/source/poses-<outfit>.png` and
`npm run assets` turns them into the strips the game loads.

The interesting part is the slicing, in `scripts/sprite-sheet.ts`:

- The poses are found by their own outlines, not by cutting the image into
  quarters. A generator puts the poses where it likes, and reading the outlines
  also means a pose that sits a little off centre still lands correctly.
- Every frame is scaled by one shared factor and stood on a shared baseline.
  Scaling each frame to fill its own cell would make the character grow and
  shrink while walking, which is exactly the jitter that makes generated
  animation look cheap.
- The drop shadows the generator drew, despite being asked not to, are removed.
  A shadow that sits apart from the character is a small region and is dropped;
  a shadow that touches a boot is caught by the keying instead, because a shadow
  on a flat backdrop is that backdrop with the light turned down.

## Two real defects in the keying

Both were found by looking at the built sheets rather than by a failing test.

- The chroma key ate the pirate's red stripes. Any pixel near the backdrop
  colour anywhere in the image was used as a seed to grow the backdrop from, and
  the red of the stripes is close to magenta. A seed now has to be either the
  backdrop colour almost exactly, which is what a small enclosed pocket such as
  the gap between two legs looks like, or near it with backdrop all around,
  which is what the open backdrop looks like even where it shades off. A thin
  stripe is neither.
- The keying stopped at the shadows. It now grows through a shadow as well,
  recognised as the key colour scaled down towards black, which leaves the boot
  above it untouched.

## Verification

- `npm run check`: 247 unit tests, 10 Node integration tests, 14 Worker
  integration tests, formatting, typed lint, three TypeScript runtimes, build.
- `npx playwright test`: 50 journeys pass in Chromium and WebKit.
- `tests/unit/sprite-sheet.test.ts` (7 tests): poses read from outlines, put in
  reading order, a shadow left out, a missing pose refused rather than shipped,
  equal cells, one shared scale, and a shared baseline with centred frames.
- `tests/unit/sprite-animation.test.ts` (8 tests): standing still, jumping with
  both feet off the ground, the four-step cycle, the same cycle in both
  directions, quicker steps at higher speed with a floor and a ceiling, no
  walking on the spot while sliding to a stop, planted feet while blocking, and
  the frame rectangles including out-of-range indexes.
- `tests/e2e/sprites.spec.ts`: both sheets are served and are strips of four,
  the drawing really changes while walking, and jumping changes it again.
- `tests/unit/asset-pipeline.test.ts` still passes unchanged, so the keying fix
  did not weaken what it already guaranteed.
