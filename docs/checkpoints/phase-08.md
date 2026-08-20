# Phase 08 Checkpoint: Pause, Reconnect, Finish, And Rematch

Date: 2026-08-20

## Observable Build

- Local: `npm run dev`, pair both devices, then press Pauze, pull a network cable, or fight to zero hearts.
- Lifecycle journeys: `npx playwright test tests/e2e/lifecycle.spec.ts`
- Screenshot: [`phase-08-winner.png`](./phase-08-winner.png) shows the winner overlay over the frozen arena with one clear next step.

## Lifecycle Matrix

| From | Event | Result | Who may act |
| --- | --- | --- | --- |
| playing | a player presses Pauze | paused, reason `player`, requester named on both screens | both, to say Klaar |
| playing | either heartbeat quiet for 750 ms | paused, reason `connection`, held controls cleared for both | neither, until the heartbeat returns |
| paused (connection) | quiet for 2 s | that role shown offline, match stays frozen | the remaining player waits |
| paused | both say Klaar | 3-second countdown, then playing | both |
| playing, countdown, paused | socket closes | reconnecting, controls cleared, other screen updated at once | nobody |
| reconnecting | both connected again | paused, readiness reset | both, to say Klaar |
| waiting, world-selection, ready, finished | socket closes | phase unchanged, that role marked offline | the remaining player |
| playing | a player reaches zero hearts | finished, winner named, or a draw when both reach zero on one tick | both, to ask for a rematch |
| finished | both ask for a rematch | full reset, next world choice handed to the other player | both |
| any | snapshot from another schema or protocol | play stops, Dutch recovery message, reload offered | nobody |
| restart | checkpoint from another schema | match discarded, credential generations kept, drain logged | nobody |

## Implemented

- One overlay explains every interruption in Dutch with at most one thing to do: who paused, that a connection is failing, that a player is away, who won, or that the page has to be reloaded. The arena stays visible behind it, and the full-screen play layout now covers the paused, reconnecting, and finished phases so the card is never cut off.
- Pause records both who asked and why. A player pause names the requester; a connection pause says so instead of blaming a child.
- Every simulation clock stops together: ticks, movement, projectiles, chest schedule, chest landings, and effect timers. A held control is dropped at the moment of the pause, so nobody keeps running.
- The browser resends its held controls every 250 ms. Any message on a role's socket counts as that role's heartbeat, so silence means a failing connection rather than a still player.
- One quiet heartbeat freezes the match for both players. An asymmetric freeze would turn a bad connection into an advantage, so gameplay commands are refused from both sides while either heartbeat is late.
- A quiet role is shown offline after 2 seconds. The room keeps ticking while frozen so that escalation actually happens, but simulates nothing.
- A closing socket now publishes a snapshot as well as presence, so the player who stayed sees the match freeze immediately instead of watching a live arena that is not running.
- A returning player restores the same match: same two players, same chests, same entities, same inventory, same hearts. Resuming always goes through the normal both-ready countdown.
- A finished match names the winner, or reports a draw when both players reach zero on the same tick, and only restarts when both children ask. The reset leaves no entity, chest, event, effect, weapon, or processed command behind, and hands the next world choice to the other player.
- A snapshot from a different schema or protocol stops play and offers a reload rather than showing a match the page cannot reason about.
- An incompatible checkpoint is discarded rather than partly loaded, its credential generations are kept so a replaced device stays replaced, and the drain is logged for auditing.
- Persisted state moved to schema v6: v5 added the pause reason, v6 the remembered attack press.
- A tap is remembered until a tick consumes it. A quick tap can start and end inside one 33 ms tick, and reading only the current control state lost it: on a touchscreen the game simply did not respond. The press is now latched on the rising edge and consumed exactly once, so a fast tap still swings once and a held control still swings once.
- The release of an on-screen control is heard on the window rather than on the button. A finger that slides off a control, or a gesture the browser takes over, would otherwise never deliver the release, the control would stay held for the rest of the match, and no later press could ever start an attack again.
- Any phase change is published immediately instead of waiting for the 15 Hz snapshot cadence. The tick that ends a match is also the last tick the room simulates, so a snapshot skipped there is never sent at all.

## Verification

- `npm run check`: passed with 173 unit tests, 10 Node integration tests, 12 Worker integration tests, formatting, typed lint, all three TypeScript runtimes, and the production build.
- `npm run test:e2e` and `npm run test:e2e:webkit`: all journeys passed in both engines, including three new lifecycle journeys covering a named pause, a real network outage mid-match, and a winner with rematch consent.
- Focused suite `tests/unit/lifecycle.test.ts` (15 tests): frozen clocks under pause, symmetric heartbeat freeze, the 2-second offline escalation, refusal to act while a heartbeat is late, reconnect without duplicate players or entities, disconnect from every one of the eight phases, exhaustive reset, alternating chooser, and refusal of a rematch from a player who is not there.
- Worker integration: an incompatible checkpoint is drained, its generations survive, and the rewritten checkpoint carries the current schema. A match that ends on an odd tick, which is exactly the tick the snapshot cadence skips, still reaches both players; the test times out against the previous code.
- Soak: `SOAK_MINUTES=30 npx playwright test tests/e2e/soak.spec.ts` drives two bots through repeated disconnects, resumes each time through the both-ready countdown, and asserts after every recovery that both clients agree, that there are exactly two players, that health stays inside bounds, and that no entity is duplicated. The short default run is part of the normal suite.

## Notes

- The heartbeat is checked only while a match is running or already frozen by a connection. In a lobby or a countdown nobody is expected to be sending controls, and a real disconnect there is caught by the closing socket instead. An earlier version checked it everywhere and paused its own countdown.
- The winner journey found a third defect, and it was the most serious of the three: a match could end without either player being told. The room finished the match, stopped simulating because the phase was no longer active, and the closing snapshot fell on a tick the 15 Hz cadence skipped. Both children kept playing a match that was already over, roughly half the time. The journey only failed intermittently, which is exactly how the bug would have reached them.
- The soak found two real defects that are now fixed: a clean disconnect never told the remaining player, and the room stopped ticking at the freeze so the 2-second offline escalation never ran.

## Remaining

Distinct geometry per world, teleports, the first-match tutorial, the full Dutch catalogue audit, and the accessibility and performance passes are Phase 9.
