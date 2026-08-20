# Phase 10 - Final headless acceptance, deployment, and release

This is the release phase. Everything that can be checked without holding an
iPad is checked here; the two items that need the physical devices are named at
the bottom and are the only things standing between this and a finished
version 1.

## What was verified

### Every acceptance criterion has evidence

The table in `docs/PLAN.md` now names, for each of the fourteen PRD criteria,
the test that proves it and where its evidence lives. Twelve are proven by
automation. Two need the iPads: the unassisted observation with Luca and Senna,
and the physical device report.

Two criteria only had half their evidence before this phase, and both now have
a browser journey behind them in `tests/e2e/acceptance.spec.ts`:

- Falling out of the world. A child is placed over the gap in the space planet
  and falls past the boundary. Both browsers still show ten hearts afterwards,
  the returning child is protected, and the protection runs out by itself so it
  cannot be used to camp a spawn. Screenshot: `phase-10-respawn.png`.
- A device that was paired earlier. Both pages are reloaded with nothing but
  their stored credential, and the two children are back in a running match in
  4.9 seconds in Chromium and 8.0 seconds in WebKit. The requirement is two
  minutes.

### Security and supply chain

- `npm audit` and `npm audit --omit=dev`: no vulnerabilities. The application
  ships one runtime dependency, `@upstash/redis`; everything else is a build or
  test tool.
- Secret scan across all tracked files: no key material and no secret
  assignments outside the documented local development values.
- The built bundle in `dist/` contains no secret, no admin pin, and not even an
  environment URL: the browser learns where to connect from the session API.
- `tests/production/isolation.spec.ts` proves against the live deployment that
  preview and production are separate environments on separate hosts with the
  same protocol and schema, that the production room refuses a socket without a
  signed role, refuses unsigned and wrongly signed internal calls, and exposes
  no debug route at all, and that pairing is refused before the pin is even read
  when the request has no origin or a foreign one.

### A bad connection

`tests/e2e/network.spec.ts` plays a match with 200 ms of latency and a narrow
pipe on both sides, and both pages still agree on where everybody is. Ordering
and replay themselves are decided by the sequence rules, which are covered by
the determinism and Worker suites, so this journey is about the experience
rather than the protocol. It runs in Chromium only, because that is the engine
that can emulate network conditions.

## Open, and why

- The exact iPad model identifiers are still unknown, so the browser floor is
  documented as iPadOS 17 and Safari 17 rather than as two specific devices.
- The unassisted first-use journey with Luca and Senna, the multi-touch check,
  and the frame rate on the devices themselves have to happen on the devices.
  The headless suites measure everything else, including the work the game does
  per frame, which is 0.24 ms in Chromium and 0.32 ms in WebKit.

Neither is a code change. Both are observations that need the two children and
their iPads.

## The 30-minute soak

`SOAK_MINUTES=30 npx playwright test tests/e2e/soak.spec.ts` drove two bots
through 320 disconnect and recovery cycles in half an hour. Every one of the
320 recoveries was checked: both clients described the same match, there were
exactly two players, no heart was outside its bounds, and no entity was
duplicated. Both clients ended on the same tick, 39369. No problems were
recorded.

## Four defects the release checks found

None of these were test problems.

- A player written off as offline was restored the moment the room heard from
  them again, but that change was never published. A frozen match does not tick,
  and nothing else broadcast a change made between two ticks, so the room could
  be perfectly healthy while the other child stared at "Even wachten" with a
  disabled button. The room now publishes the restored connection immediately,
  and a Worker test times out against the old code.
- While a match was frozen the browser sent nothing at all, because controls are
  refused outside play. Its only traffic was a ping every two seconds, which is
  slower than the three-quarters of a second the room treats as silence. A
  frozen match now keeps proving its connection with a ping four times a second,
  so a real recovery is noticed immediately.
- A freeze caused by a stall demanded a ceremony to end. Three missed
  heartbeats is three quarters of a second, which on a home network is a stall
  rather than a player leaving, and both children had to press ready before the
  match went on. A freeze that never reached the two-second absence rule now
  resumes by itself through the normal countdown; one that did still waits for
  both of them, because then somebody really was gone. This was found by a
  Playwright run where taking a screenshot stalled the page long enough to
  freeze the match.
- A pause a child asked for stopped saying so as soon as the next snapshot
  arrived, because that snapshot still says the match is running. On a slow
  link the button went back to "Pauze" while nothing had happened yet, which
  reads as an ignored tap. The request now stands until the pause actually
  happens or is refused.
