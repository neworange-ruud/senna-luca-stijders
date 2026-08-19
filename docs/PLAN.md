# Senna & Luca Strijders Implementation Plan

This is the durable execution record for implementing [`PRD.md`](./PRD.md). It is both a plan and a restart point for later sessions. Implementation must not rely on chat history.

## Status

- Last updated: 2026-08-19
- Overall status: Ready to start
- Current phase: Phase 0 - Baseline and toolchain
- Implementation progress: 0 of 11 phases complete
- Current blocker: None for Phase 0 or local implementation. Cloudflare/Vercel account access is required to complete the remote latency gate in Phase 2; exact target iPad models must be recorded before Phase 10 can pass.
- Next action: Capture the existing baseline, add the test layers, and prove the local Vercel plus Durable Object development loop.

Status values used below:

- `[ ]` not started
- `[~]` in progress
- `[x]` complete and verified
- `[!]` blocked, with the reason recorded in Status and Session Log

## Working Method

This file must be updated continuously while implementation is in progress.

1. At the start of a session, read `docs/PRD.md`, `docs/PLAN.md`, and `AGENTS.md` before changing code.
2. Set exactly one phase to `[~]`, update Current phase and Next action, and append a Session Log entry before substantial implementation.
3. Implement one independently testable gameplay behavior at a time. Add or update its unit tests in the same change, run the focused tests, then run the full unit suite before moving to the next behavior.
4. Mark a task `[x]` only after its listed verification passes. Record the command and result in Verification Evidence. Never infer completion from code alone.
5. At each phase checkpoint, produce an observable artifact such as a runnable route, a screenshot, a short recording, a test report, or a latency report under `docs/checkpoints/`. Tell the user where to inspect it, but continue autonomously unless blocked.
6. Before ending any session, update Status, all affected checkboxes, decisions, blockers, verification evidence, and the Session Log. The first unchecked item must be a safe restart point.
7. If implementation changes scope or architecture, record the reason in Decision Log before changing this plan. Do not silently weaken a PRD requirement.
8. Keep dummy geometric sprites and generated placeholders until art is explicitly requested. Gameplay, accessibility, and layout must not depend on final artwork.

## Scope And Completion Rules

- All P0 requirements and all 14 version 1 acceptance criteria in the PRD are mandatory.
- P1 requirements are included where they directly share a P0 implementation (for example keyboard input and world selection) or after the corresponding P0 system is proven. P1 work must never delay or weaken a P0 verification gate.
- P2 ideas and the items in PRD section 10 remain out of scope.
- Final graphics are out of scope for this implementation pass. Dummy sprites must still have distinct silhouettes, labels, contrast, hit feedback, and reduced-motion behavior.
- Local and automated work proceeds without waiting at visibility checkpoints. User action is required only for account credentials, production deployment approval, confirmation of external facts listed under Pending User Inputs, and observed tests on the two physical iPads.
- A phase is complete only when its focused tests and `npm run check` pass.
- The game is complete only after unit, integration, security, dual-client headless browser, reconnect, and production smoke checks pass. Physical iPad verification is a release gate, not a substitute for automation.

## Locked Product Decisions

These defaults resolve the implementation choices in PRD section 12 where the repository has enough information. Unknown external facts are isolated under Pending User Inputs and do not block local work. Balance values live in typed configuration and may be tuned based on test evidence recorded in Decision Log.

### Platform And Architecture

- Browser support target: current Safari on the available iPads, with an initial technical floor of iPadOS 17 and Safari 17. Chromium, Edge, and desktop Safari remain secondary. Exact supported models are the two target iPads once their model identifiers are recorded; a model that cannot pass the 30 fps floor remains a release blocker rather than silently lowering the requirement.
- Internet play is the default; no same-network assumption is allowed.
- Vercel serves the Vite app and short-lived authentication/pairing APIs from `fra1`.
- Upstash Redis stores device-role bindings, credential generations, rate-limit records, and environment-separated administrative state. The generic client-writable JSON state endpoint is retired.
- A Cloudflare Worker and one Durable Object per environment host the authoritative lobby and match over WebSockets. The object validates every command, runs a fixed 30 Hz simulation while a match is active, publishes snapshots at 15 Hz, persists authoritative checkpoints, and supports WebSocket hibernation while idle.
- During active play, the Durable Object atomically persists a full checkpoint at 5 Hz. A tick containing an irreversible outcome (damage, chest claim, item/inventory change, match result, pause, or lifecycle transition) is committed with the tick, random state, and processed command IDs before its acknowledgement/event is broadcast. On restart, the last checkpoint is restored, the game enters connection pause, clients reconcile at most 200 ms of movement, and both players complete the normal resume countdown. No irreversible outcome may be visible before durable commit.
- The browser renders at `requestAnimationFrame` speed, predicts only its own movement, interpolates the opponent, and reconciles to authoritative snapshots. It never awards damage, items, wins, or chest claims.
- Shared game rules are pure TypeScript with injected time and seeded random sources. The worker is the only production caller allowed to commit simulation state.
- The app remains useful during a transient backend failure by showing a Dutch recovery state, never by continuing an unverified local match.

### Access And Recovery

- A device is paired to Luca or Senna through a large-button adult setup screen protected by an `ADMIN_PIN` secret. Normal play needs no text entry.
- Successful pairing sets a random opaque credential in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie. Only a salted hash and credential generation are stored in Redis.
- The Vercel session endpoint exchanges a valid device cookie for a short-lived, role-scoped signed WebSocket token. The token is sent as a WebSocket subprotocol, not in the URL.
- Pairing a replacement device requires the adult PIN and explicit replacement confirmation. It increments the role generation and sends a signed revocation to the Durable Object, which disconnects the old session before the new role can act.
- A role has at most one active gameplay connection. A second unpaired or stale device is denied access, cannot observe live match state, and cannot send commands.
- Mutating APIs validate method, content type, request origin, body shape, rate limits, role, generation, and current game phase. Secrets never enter browser bundles or Git.

### Match Rules

- The world chooser alternates by completed match, with Luca choosing first. The chooser selects; the other player sees the same world and confirms it. Both players still choose a cosmetic and mark ready.
- Version 1 ships six functional data-driven arena configurations: beach, forest, space planet, construction site, city, and boat. They use dummy colors and geometric sprites during this pass.
- Teleports are P1 content added after the first beach arena is complete; at least one later arena must contain multiple linked destinations.
- Initial arena working size is 3200 by 1400 world units with a landscape viewport, a soft follow camera, arena bounds, spawn points, platforms, solid cover, chest points, and optional linked teleports. The first movement checkpoint validates whether this gives useful pursuit and hiding time.
- Player collision uses deterministic axis-aligned shapes. The server simulates at 30 Hz using integer ticks; rendering may interpolate floating-point positions.
- Initial movement values: 360 units/second run speed, 760 units/second jump impulse, 1900 units/second squared gravity, limited air steering, and no double jump.
- Falling outside valid bounds causes no damage. The player respawns at the safest configured spawn with 1.5 seconds of visible invulnerability.
- Each player starts with 10 hearts and unarmed capability but no inventory weapon. Unarmed attacks deal 1 heart at short range with a 700 ms cooldown.
- There is no score, points counter, ranking, or gameplay currency. Hearts are the only win condition.
- Inventory contains two weapon slots plus always-available unarmed combat. Replacing a full slot drops its recoverable weapon. A dedicated switch control cycles available weapons.
- Normal sword: 2-heart melee damage, 650 ms cooldown. Holding attack for 500 ms then releasing throws it for 2 hearts; it remains in the arena until retrieved with Action or returns to its spawn owner after 8 seconds if unreachable.
- Weak/small sword: 1-heart melee or throw damage with a 500 ms cooldown.
- Nerf blaster: 6 visible toy darts, 1 heart each, 450 ms fire cooldown. An empty blaster remains selectable until replaced; a new pickup refills it.
- Holding Block slows movement by 40 percent and reduces frontal damage by 1 heart, so darts and unarmed attacks are visibly stopped while a normal sword still deals 1. Rear attacks bypass blocking. Respawn protection blocks all damage.
- Touch controls are fixed: left thumb movement pad; right-side Jump, Attack, Block, and Action buttons; an inventory switch above them. Attack hold/release throws a held sword. Keyboard mappings are arrows/A-D, Space, F, Shift, E, and Q.
- Chests announce a landing for 2 seconds. The first announcement starts 8 active seconds after play begins and later announcements start every 12 active seconds, with at most two landed chests. Claims are resolved on the authoritative tick by reach, then distance, then alternating exact-tie priority.
- The base shuffle bag contains exactly one of each six chest outcomes before refill. An eligible-recovery counter increments whenever a chest is scheduled while one player trails by at least 3 hearts and resets to zero as soon as the gap is smaller. On count 3, a recovery chest replaces that scheduled bag draw, does not consume a base-bag entry, alternates armor and speed, uses the reachable unoccupied point with the shortest path for the trailing player, and resets the counter. Recovery chests are announced normally and remain claimable by either player. The counter rule prevents consecutive recovery chests and removes discretionary weighting.
- Armor absorbs the next 3 damage points. Camouflage lasts 8 active seconds and reduces opponent-facing visual emphasis without making the player fully invisible. Speed adds 25 percent for 8 active seconds. Timers stop during pause.
- Either player can pause immediately. Resume begins only after both players choose Ready, followed by a server-driven 3-second countdown.
- A closed socket pauses immediately. At 750 ms without an input heartbeat, the server clears that player's held intents and immediately puts the entire match into connection pause; neither player can move, attack, block, claim, or advance any timer. At 2 seconds the stale role is additionally marked offline. Reconnection restores the authoritative match and input sequence, then uses the normal both-ready resume countdown.
- Match end is immediate at zero hearts. Rematch requires both players and resets health, positions, inventory, effects, projectiles, chests, timers, and ready state before world selection.

### Content And Presentation

- Luca and Senna use distinct labeled dummy character shapes. The five required cosmetic themes are superhero, soldier, knight, astronaut, and pirate; cosmetics alter palette and silhouette decorations only.
- Arena definitions, cosmetic definitions, item definitions, tunables, and Dutch labels are data-driven and schema-validated.
- All visible strings come from one Dutch message catalog. Tests fail on missing entries and scan rendered routes for known English fallback text.
- The first match displays short contextual control hints. Essential information uses icon/shape plus text, not color alone.
- Placeholder sound effects and a simple generated music loop are included without third-party assets. Effects and music have separate persistent mute controls and never autoplay before user interaction.
- The supplied GitHub destination is `neworange-ruud/senna-luca-stijders` (without the first `r` in `strijders`) as directed by PRD section 9. Product copy, package naming, and local folder naming use the correct Dutch `senna-luca-strijders`. The user explicitly requested early publication to the verified empty destination before Phase 0; this does not change implementation status.
- The current intro illustration remains a non-binding visual reference. This pass deliberately uses high-contrast geometric dummy art; approval or refinement of final portrait/style art is a separate post-gameplay decision and cannot block the functional release described here.

### Pending User Inputs

These are external facts, not implementation design choices. Record answers here as soon as they become available.

| Input | Needed by | Current handling |
| --- | --- | --- |
| Exact model identifier and iPadOS version for Luca's iPad | Phase 10 physical gate | Develop to Safari 17/iPadOS 17 floor and common iPad landscape viewports. |
| Exact model identifier and iPadOS version for Senna's iPad | Phase 10 physical gate | Same as above. |
| Provider/GitHub account authorization and production secrets | Phase 2 remote gate and Phase 10 deployment | Use deterministic local-only secrets until authorization is available. Never store real values in Git. |

## Target Code Shape

The exact file split may stay smaller where practical, but dependency direction must remain as follows:

```text
src/
  game/             Pure types, config, commands, physics, combat, items, state machine
  client/           WebSocket session, prediction/interpolation, input, canvas rendering
  ui/               Dutch lobby, HUD, overlays, setup, touch controls
worker/              Cloudflare Worker entry and Durable Object orchestration
api/                 Vercel pairing, session, recovery, and health handlers
server/              Redis access/auth helpers shared by Vercel handlers
tests/
  unit/              Pure game rules and UI-independent state tests
  integration/       API, Redis contract, Worker, WebSocket, and persistence tests
  e2e/               Playwright dual-player and security journeys
docs/checkpoints/    Human-visible phase evidence
```

The pure `src/game` layer must not import DOM, Canvas, WebSocket, Redis, Vercel, or Cloudflare APIs. Client and server share commands and snapshots but not authority.

## Verification Strategy

### Continuous Gameplay Unit Tests

Every gameplay change follows this loop:

1. Express the rule as a pure state transition or fixed-tick simulation test.
2. Include the success case, invalid-command case, boundary/timing case, and pause/reconnect interaction where relevant.
3. Run the focused file with `npm run test:unit -- <test-file>`.
4. Run `npm run test:unit` before marking the behavior complete.
5. Run `npm run check` at every phase checkpoint.

Tests use fake clocks, deterministic seeds, and command sequence numbers. No unit test waits on real time or a public service.

### Test Layers

- Static: TypeScript strict checks, formatting/lint checks, schema exhaustiveness, and production build.
- Unit: lobby state machine, physics, collisions, movement, combat, blocking, projectiles, inventory, chest fairness, effects, pause, countdown, disconnect, reconnect, win, rematch, camera math, and input mapping.
- Property/invariant: health remains 0 to 10; exactly one chest claimant; positions stay finite; paused state does not advance; stale/duplicate commands are idempotent; a reset leaves no prior-match entities.
- Integration: Vercel API handlers against in-memory and local Redis-compatible stores; token verification; Worker/Durable Object WebSockets; persistence/restart; generation revocation; malformed/rate-limited commands.
- Browser component smoke: every route/overlay renders at desktop and iPad landscape sizes with no console error, clipped essential controls, or English fallback.
- Headless end-to-end: Playwright launches separate Luca, Senna, and attacker contexts against the local full stack. It pairs devices, starts a match, drives simultaneous inputs, claims chests, uses every weapon/effect, pauses, disconnects/reconnects, finishes, and rematches.
- Browser matrix: the final critical journey runs in headless Chromium and WebKit with iPad landscape viewport, touch enabled, reduced-motion coverage, and screenshots/traces retained on failure.
- Production smoke: before the physical iPads are finally paired, two isolated release contexts connect through the Vercel production URL, complete a short scripted match, and confirm preview data isolation. Those temporary credentials are then revoked by pairing the physical iPads. Recurring full automation runs in preview; post-pairing production automation is read-only unless the owner explicitly enters maintenance mode.
- Physical release check: after adult pairing, Luca and Senna complete the first-use and full-match acceptance journey themselves with no gameplay help, over separate networks where possible. An adult may observe and record but may only assist with the protected pairing step. Each returning-device journey from opening the URL to match countdown must take at most 2 minutes. Record model, iPadOS, Safari, time-to-start, orientation, concurrent-touch behavior, safe areas, measured remote-action latency, and any comprehension, thermal, or frame-rate issue.

### Standard Commands To Establish In Phase 0

```sh
npm run dev
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:webkit
npm run build
npm run check
```

`npm run check` must include unit tests, integration tests, type checking, lint/format validation, and a production build. Browser E2E remains an explicit final command because it starts multiple local services and browsers.

## Implementation Phases

### [ ] Phase 0 - Baseline And Toolchain

Goal: turn the foundation into a reproducible multi-runtime project before changing gameplay.

- [ ] Record current `npm run check` output and preserve relevant generic protocol tests until replacements cover them.
- [ ] Rename package/app metadata and replace README foundation instructions with project-specific local architecture instructions.
- [ ] Add strict formatting/lint scripts, separate unit/integration scripts, Playwright with Chromium and WebKit, and coverage output for pure game rules.
- [ ] Add Wrangler local configuration with separate dev/preview/production Durable Object namespaces and documented environment variables.
- [ ] Add a one-command local full-stack launcher for Vite/Vercel APIs plus the Worker, with deterministic local secrets and no production credentials.
- [ ] Add CI jobs for `npm ci`, `npm run check`, and headless E2E with failure artifacts.
- [ ] Add test helpers for fake time, seeded random, paired players, and authoritative state snapshots.
- [ ] Verify no secret or `.env` file is tracked and document setup through `.env.example` placeholders.

Verification:

- `npm run check`
- `npm run test:e2e` with a temporary two-WebSocket smoke test
- `npm run test:e2e:webkit` with the landing-page smoke test

Checkpoint: `docs/checkpoints/phase-00.md` records versions, commands, architecture diagram, baseline failures removed, and a screenshot of the local health/status page.

### [ ] Phase 1 - Deterministic Game Core

Goal: build and test the server-independent rules before networking or UI depends on them.

- [ ] Define versioned lobby, match, player, input, entity, item, effect, arena, snapshot, and error schemas.
- [ ] Implement integer-tick clock, seeded random source, command sequence/idempotency rules, and stable entity IDs.
- [ ] Implement the phase state machine: waiting, world selection, ready, countdown, playing, paused, reconnecting, finished, rematch reset.
- [ ] Implement data-driven arena validation, floor/platform/solid collision, spawn selection, and valid/reachable chest points.
- [ ] Implement horizontal movement, gravity, jump, air control, player/arena collision, and out-of-bounds safe respawn.
- [ ] Add unit and invariant tests after each behavior, including long seeded simulations with finite-state assertions.

Verification:

- Focused test command after each rule file
- `npm run test:unit`
- `npm run check`

Checkpoint: a deterministic simulation CLI replays a saved input fixture twice and writes identical final snapshot hashes to `docs/checkpoints/phase-01.md`.

### [ ] Phase 2 - Authoritative Realtime Runtime

Goal: prove two clients can observe and control one authoritative low-latency simulation.

- [ ] Implement Worker routing, Durable Object lifecycle, environment/room isolation, and schema-versioned persistence.
- [ ] Implement WebSocket hello, command, acknowledgement, snapshot, ping, structured Dutch error-code mapping, and protocol-version mismatch messages.
- [ ] Run simulation only while needed, publish delta-friendly snapshots at 15 Hz, checkpoint lifecycle state, and restore safely after object restart.
- [ ] Implement command validation, per-role monotonic sequence numbers, deduplication, rate limits, payload limits, and invalid-state rejection.
- [ ] Implement a minimal client transport with reconnect/backoff, snapshot ordering, clock-offset estimate, and a debug network panel excluded from production by default.
- [ ] Measure local two-client command-to-remote-snapshot latency and bandwidth; keep median comfortably below the PRD 200 ms budget.
- [ ] Deploy the spike to isolated preview infrastructure and measure browser-to-remote-player action latency from two external connections. Require median at or below 200 ms and p95 at or below 350 ms during a 5-minute representative run; local measurements alone cannot pass this gate.

Verification:

- Worker integration tests for two sockets, duplicates, out-of-order messages, malformed commands, restart, and schema mismatch
- A 10-minute headless soak with deterministic bot input and convergent snapshots
- Preview latency run over the real Vercel-to-Worker architecture; mark Phase 2 `[!]` if account access is unavailable or the budget fails
- `npm run check`

Checkpoint: `docs/checkpoints/phase-02.md` contains the protocol summary, latency/traffic report, soak result, and two-client debug screenshot. If the architecture cannot meet the budget, stop and record an ADR before replacing it.

### [ ] Phase 3 - Secure Device Pairing

Goal: make Luca and Senna the only writable roles and prove takeover prevention.

- [ ] Replace `/api/state` with typed pairing, session, recovery/revoke, and health handlers.
- [ ] Implement constant-time adult PIN validation, secure device-cookie issuance, hashed credential storage, generation rotation, origin checks, and rate limiting.
- [ ] Implement short-lived signed role tokens and Worker-side signature, expiry, audience, environment, role, and generation validation.
- [ ] Enforce one active connection per role and signed live revocation when a replacement device is paired.
- [ ] Build Dutch first-pair, returning-device, role-occupied, invalid-PIN, recovery-confirmation, offline, and unauthorized screens.
- [ ] Add logs containing request IDs and error codes but no PINs, credentials, tokens, free text, or personal data.

Verification:

- Unit tests for cookie/token/hash helpers and expiry/generation boundaries
- Integration tests for first pair, return, wrong PIN throttling, stale cookie, replay, replacement, old-socket disconnect, cross-environment rejection, and third-device denial
- Headless three-context security journey
- `npm run check`

Checkpoint: the user can inspect the pairing flow while `docs/checkpoints/phase-03.md` shows the redacted security matrix and attacker-context result.

### [ ] Phase 4 - Lobby, Cosmetics, And Match Start

Goal: let both children reach a synchronized match countdown without free text.

- [ ] Build responsive Dutch lobby UI for fixed identity, peer connection state, cosmetics, world chooser/confirmation, ready state, and waiting feedback.
- [ ] Add Luca/Senna dummy sprites and the five required cosmetic definitions with no gameplay fields.
- [ ] Implement alternating chooser state and six selectable world definitions, initially sharing validated geometry where unique layouts are not complete yet.
- [ ] Require both authenticated roles, selected cosmetics, world confirmation, and ready state before a server countdown can begin.
- [ ] Handle refresh, duplicate ready commands, chooser disconnect, and stale prior-match lobby state.
- [ ] Add first-run setup hints and accessible names/focus behavior for lobby controls.

Verification:

- Unit tests for chooser alternation, readiness, cosmetic neutrality, and all match-start guards
- Integration test for two roles moving from lobby to countdown
- Headless desktop and iPad-landscape lobby journey with screenshots
- `npm run check`

Checkpoint: two local URLs show Luca and Senna selecting skins, confirming one world, and entering the same countdown. Evidence goes in `docs/checkpoints/phase-04.md`.

### [ ] Phase 5 - Playable Movement Vertical Slice

Goal: make one complete arena fun to move around in on touch and keyboard before adding item complexity.

- [ ] Build Canvas renderer with dummy sprites, platforms, cover, labels, HUD, camera bounds, and local-player follow.
- [ ] Implement fixed touch controls with multi-touch move plus jump/action and safe-area/orientation handling.
- [ ] Add keyboard controls and a shared input mapper that emits intent rather than state mutations.
- [ ] Implement local movement prediction, remote interpolation, authoritative reconciliation, and visible connection quality.
- [ ] Give immediate local visual/pressed feedback to every local action intent, including jump, attack, block, Action/chest attempt, switch, pause, and ready, while keeping authoritative outcomes pending.
- [ ] Complete the beach arena layout with pursuit paths, hiding/cover, reachable platforms, safe spawn points, and chest locations.
- [ ] Add fall/respawn presentation and 1.5-second spawn protection indicator.
- [ ] Test camera and arena assumptions at common iPad landscape dimensions and adjust only through config.

Verification:

- Unit tests for input combinations, camera bounds, prediction replay, collision edges, jump/platform behavior, and safest respawn
- Dual-client headless movement race with simultaneous key input and an explicit two-contact pointer-injection harness proving move plus jump/attack/block multi-touch
- Automated screenshot checks at 1024x768, 1180x820, 1366x1024 landscape CSS viewports and reduced motion
- `npm run check`

Checkpoint: a local two-player movement build plus screenshots and measured correction/latency data in `docs/checkpoints/phase-05.md`. This explicitly validates camera size and whether players can meaningfully find and evade each other.

### [ ] Phase 6 - Combat, Hearts, And Weapons

Goal: complete deterministic combat with immediate local feedback and server-authoritative outcomes.

- [ ] Implement unarmed and sword melee hitboxes, cooldowns, facing, rear/front block rules, and non-bloody feedback events.
- [ ] Implement sword charge/throw, projectile collision, ground retrieval, unreachable return, and owner/inventory transitions.
- [ ] Implement Nerf darts, ammo, cooldown, cover collision, and toy-like projectile feedback.
- [ ] Implement two weapon slots, switch control, full-inventory replacement/drop, pickup, and clear selected/empty states.
- [ ] Implement heart changes, armor-independent base damage, respawn protection, simultaneous lethal-hit policy, immediate match stop, and winner state.
- [ ] Add predicted animation/feedback that is cancelled or corrected without predicting opponent damage.

Verification:

- Focused unit tests after each weapon and combat rule
- Invariant tests for one damage application per attack ID, no friendly/self damage, no damage through cover, no damage after finish, and health bounds
- Integration tests with adversarial forged hits, impossible fire rates, stale inputs, and simultaneous attacks
- Dual-client headless scripted duel using every base weapon and block direction
- `npm run check`

Checkpoint: `docs/checkpoints/phase-06.md` links a reproducible duel fixture, final state hash, screenshots of each weapon, and combat test report.

### [ ] Phase 7 - Chests, Effects, And Fairness

Goal: complete the pickup loop and prove that races and randomness are authoritative and bounded.

- [ ] Implement announced chest landing, valid spawn selection, active limits, seeded shuffle bag, and persisted random state.
- [ ] Implement Action-range claims, same-tick deterministic tie resolution, duplicate-command idempotency, and exactly-one reward events.
- [ ] Implement sword, weak sword, Nerf, armor, camouflage, and speed chest outcomes with animated Dutch icon/label reveals that respect reduced motion.
- [ ] Implement armor capacity and active-time effect timers, HUD indicators, opponent-visible states, pause behavior, and clean replacement/reset.
- [ ] Implement and statistically test the exact eligible-recovery counter/replacement rule without changing already announced contents or consuming a base-bag item.
- [ ] Ensure every configured chest location is reachable by deterministic movement validation or an explicit arena test route.

Verification:

- Unit tests for every item, timer boundary, claim race, bag cycle, pause, death, replacement, and rematch cleanup
- Seeded distribution tests over at least 10,000 draws with documented bounds
- Integration test with simultaneous claim packets and worker restart after announcement/claim
- Headless journey that acquires and demonstrates every chest outcome
- `npm run check`

Checkpoint: an item gallery/debug seed route and fairness report in `docs/checkpoints/phase-07.md`.

### [ ] Phase 8 - Pause, Reconnect, Finish, And Rematch

Goal: make every interruption safe and every lifecycle transition convergent.

- [ ] Implement immediate global pause, requester label, both-ready resume, authoritative 3-second countdown, and frozen movement/projectile/chest/effect clocks.
- [ ] Implement socket-close and heartbeat-staleness safety, immediate stale-intent clearing and symmetric connection pause at 750 ms, offline status at 2 seconds, reconnect grace period, and role restoration.
- [ ] Reconcile reconnecting clients from full snapshots without duplicate entities, claims, damage, or players.
- [ ] Detect impossible protocol/state divergence, stop play, show a Dutch recovery message, and offer an authorized clean restart.
- [ ] Implement winner overlay, both-player rematch consent, alternating next chooser, and exhaustive state reset.
- [ ] Add persistence compatibility/version checks and a deployment policy that drains or explicitly resets incompatible active matches.

Verification:

- Unit tests prove all simulation clocks are unchanged during pause, neither player can move/attack/block/claim after either heartbeat becomes stale, and reset state contains no old entity IDs
- Integration tests for disconnect at every lifecycle phase, reconnect/replay, object restart, stale version, and revoked session
- Headless network-offline test during movement, projectile flight, chest claim, pause countdown, and finished screen
- 30-minute two-bot soak with random disconnects and snapshot convergence assertions
- `npm run check`

Checkpoint: `docs/checkpoints/phase-08.md` contains the lifecycle matrix, soak report, and Playwright trace of disconnect/reconnect/rematch.

### [ ] Phase 9 - Worlds, Teleports, Tutorial, Audio, And Accessibility

Goal: finish P1 content and make the complete experience understandable and robust for the target children.

- [ ] Give forest, space planet, construction site, city, and boat distinct validated geometry using the same game systems.
- [ ] Add linked teleports to at least one arena with clear destination choice, cooldown, safe arrival, and tests for blocked/invalid destinations.
- [ ] Finish first-match contextual hints for movement, jump, attack, block, Action, weapon switch, chests, and pause.
- [ ] Centralize and audit all Dutch text, status, instruction, and error paths; remove the English demonstration UI.
- [ ] Add generated placeholder sounds for jump, block, hit, chest opening, weapon use, pause, and countdown plus simple music; require first-interaction audio start, separate persistent mute controls, and no audio dependency for gameplay cues.
- [ ] Verify touch target sizes, contrast, icon-plus-text cues, focus order, screen-reader labels outside the canvas, reduced motion, orientation messaging, safe areas, and prevention of accidental browser gestures.
- [ ] Optimize rendering allocations and entity culling to sustain 60 fps target/30 fps floor on representative throttled profiles.

Verification:

- Arena schema/reachability tests for all six worlds and teleport transition tests
- Dutch-catalog completeness and rendered English-fallback scan
- Automated accessibility audit plus manual keyboard/focus pass
- Headless first-time tutorial in Chromium and WebKit with touch and reduced motion
- Unit tests map every required gameplay event to a sound cue; browser tests prove no pre-interaction autoplay and that independent music/effect mute settings survive reload
- Performance trace with frame-time, long-task, memory, and snapshot-processing budget recorded
- `npm run check`

Checkpoint: a six-world selector/gallery, accessibility report, and performance report in `docs/checkpoints/phase-09.md`.

### [ ] Phase 10 - Final Headless Acceptance, Deployment, And Physical Release

Goal: verify the whole product, deploy isolated environments, and leave an operable release.

- [ ] Map every PRD acceptance criterion to at least one automated test and one evidence location where appropriate.
- [ ] Run the complete dual-player Playwright journey in headless Chromium and WebKit from fresh storage, including the attacker context.
- [ ] Run 30-minute soak, packet delay/reordering where supported, offline/reconnect, reduced-motion, touch, and rematch suites with traces on failure.
- [ ] Run dependency audit, secret scan, production bundle inspection, API security checks, and direct forged WebSocket/API command tests.
- [ ] Provision separate Cloudflare Durable Object namespaces and Upstash keys for preview and production; configure secrets without writing them to disk or Git.
- [ ] Create/confirm the target GitHub repository and Vercel project, deploy Worker before compatible frontend, and verify health/protocol versions.
- [ ] Run the one-time pre-pairing production smoke from two isolated contexts, prove preview cannot observe or mutate production state, revoke those credentials, and then pair the physical iPads. Later production smoke is read-only unless maintenance mode is explicitly enabled.
- [ ] Have Luca and Senna each complete the unassisted first-use and full-match acceptance journey on their target iPads, ideally over separate networks. Require each returning-device start to reach match countdown within 2 minutes and record exact device/browser, time-to-start, comprehension, multi-touch, frame-rate, and measured latency results.
- [ ] Update README with setup, operations, pairing/recovery, deployment order, rollback/reset, and troubleshooting instructions.
- [ ] Record final known limitations and balance values; set PRD implementation status and this plan to complete only after all gates pass.

Verification:

```sh
npm ci
npm run check
npm run test:e2e
npm run test:e2e:webkit
```

Also required: clean production smoke report, no unexpected browser console/network errors, two-iPad checklist, and all acceptance rows marked passed.

Checkpoint: `docs/checkpoints/phase-10.md` is the release report with deployment URLs, commit SHA, test summaries, screenshots, device matrix, and rollback reference. It must contain no secrets.

## P0 Requirement Coverage

This section prevents an aggregate acceptance test from hiding an omitted P0 rule. Each row remains required even if the related acceptance criterion passes.

| PRD area | Explicit implementation coverage | Required verification |
| --- | --- | --- |
| 5.1 Access and players | Two fixed roles; role-scoped secure device credential; no live spectator access; returning device; adult replacement/revocation; online/offline/ready/paused peer states | Phase 3 API/token/unit tests, three-context takeover E2E, Phase 4/8 status journeys |
| 5.2 Lobby and start | Own identity; cosmetic selection; both ready; one shared visible world; Dutch waiting feedback; alternating chooser | Phase 4 state-machine tests and dual-client lobby E2E |
| 5.3 Characters and cosmetics | Distinct Luca/Senna dummy silhouettes; superhero, soldier, knight, astronaut, pirate; no cosmetic fields in simulation stats | Definition schema test, cosmetic-neutral snapshot test, visual checkpoint |
| 5.4 Controls and movement | Left/right, jump/platform traversal, attack, block, movement evasion, fixed touch layout, concurrent contacts, immediate local intent feedback | Phase 5 input/collision unit tests, two-contact browser harness, physical multi-touch check |
| 5.5 Arenas | Floor, platforms, bounds, spawns, chest points, solid sight/attack cover, safe no-damage fall return, 1.5-second protection, one complete arena before expansion | Arena schema/reachability tests, cover collision tests, respawn unit/E2E journey |
| 5.6 Chests | Starts weaponless; announced timed landing; reachable locations; Action range; one authoritative claimant; animated Dutch icon/label; all six outcomes; visible active timers; explicit weapon lifetime | Phase 7 item/timer/race/restart tests and all-items browser journey |
| 5.7 Combat | Toy action only; melee/throw/retrieve sword; limited Nerf darts; two weapon slots/switch; configured range/speed/damage; visible block rule; server authority; non-bloody feedback | Phase 6 per-weapon and forged-command tests, duel E2E trace |
| 5.8 Hearts/end/rematch | Ten visible hearts; protected damage; no points; immediate stop at zero; Dutch winner/rematch; exhaustive clean reset | Phase 6/8 health, finish, no-score UI, and reset invariants plus full E2E journey |
| 5.9 Pause/recovery | Either player pauses; all clocks freeze; requester shown; both-ready countdown; symmetric stale-heartbeat freeze; same-match return; explicit desync recovery | Phase 8 frozen-clock, stale-heartbeat, disconnect-at-each-phase, restart, recovery, and offline browser tests |
| 5.10 Language/explanation/audio | Dutch catalog including errors; contextual first-match hints; icon/shape plus text; reduced motion | Phase 9 catalog/render scan, tutorial E2E, accessibility audit, child-observed release check |
| Performance/synchronization | 60 fps target/30 fps floor; immediate feedback; remote median at most 200 ms; ordering/reconnect convergence | Phase 2 remote latency/soak, Phase 5 correction metrics, Phase 9 traces, Phase 10 physical measurements |
| Devices/browser behavior | Landscape iPad layout; current Safari target; safe areas/browser gestures; smaller-screen usability | Chromium/WebKit viewport matrix, touch harness, physical device report |
| Security/privacy | Server-side identity/rule validation; no browser secrets; no sensitive data, analytics, tracking, chat, or public list | Secret/bundle scan, log-redaction tests, attacker suite, network inspection |
| Reliability/hosting | Dev/preview/production isolation; compatible schema/deployment; Dutch backend failure; Vercel production URL | Environment tests, protocol mismatch/restart tests, production and preview smoke reports |

## Acceptance Traceability

Update Status only after the required evidence is linked from Verification Evidence or the relevant checkpoint.

| PRD acceptance criterion | Primary phases | Required evidence | Status |
| --- | --- | --- | --- |
| 1. Luca and Senna join one match | 2, 3, 4 | Dual-role integration and E2E journey | Pending |
| 2. Unauthorized role use is rejected | 3, 10 | Three-context security suite and forged-command tests | Pending |
| 3. Cosmetic/world selection and ready | 4 | Lobby state tests and two-client screenshot | Pending |
| 4. Start with 10 hearts and no weapons | 1, 4, 6 | Match initialization unit and E2E assertions | Pending |
| 5. Move, jump, attack, block, evade | 5, 6 | Gameplay unit suite and scripted duel | Pending |
| 6. Chests spawn and have one claimant | 7 | Race/invariant tests and item E2E journey | Pending |
| 7. Sword, throw, Nerf, weapon switch | 6 | Per-weapon unit tests and duel trace | Pending |
| 8. Shared authoritative hearts | 2, 6 | Forged-hit rejection and convergent snapshots | Pending |
| 9. Safe no-damage out-of-bounds return | 1, 5 | Respawn unit and browser journey | Pending |
| 10. Pause/reconnect gives no advantage | 8 | Frozen-clock tests and offline Playwright trace | Pending |
| 11. Zero hearts and clean rematch | 6, 8 | Finish/reset invariants and full journey | Pending |
| 12. Dutch child-understandable experience | 4, 9, 10 | Catalog/tutorial automation, unassisted Luca/Senna observation, and returning-device start within 2 minutes | Pending |
| 13. Two iPads play production URL | 10 | Physical device release report | Pending |
| 14. Critical automation exists | All | `npm run check`, E2E reports, CI | Pending |

## Risk Register

| Risk | Mitigation and trigger |
| --- | --- |
| Cross-provider latency exceeds 200 ms | Phase 2 spike measures before UI investment; place Vercel/Upstash in Europe and use direct browser-to-Worker WebSockets. Stop for an ADR if budget fails. |
| Safari touch/audio/WebSocket behavior differs from desktop | WebKit runs from Phase 0, iPad viewports from Phase 4, and physical devices remain a release gate. |
| Client prediction diverges from authoritative collision | Keep one shared pure movement implementation, reconcile by input sequence, expose correction metrics, and test recorded input replay. |
| Durable Object restart duplicates or loses outcomes | Commit irreversible ticks before broadcast, checkpoint at 5 Hz, restore into connection pause, use stable command IDs, and run restart tests around attacks and claims. |
| Replacement pairing permits takeover | Adult PIN, hashed device credentials, generation rotation, one active socket, direct revocation, and attacker E2E coverage. |
| Random items dominate results | One-of-each seeded shuffle bag, exact every-third eligible recovery replacement, configurable values, and statistical regression tests. |
| Final art changes collision or readability | Collision geometry and UI layout remain independent of sprites; dummy assets use the final bounding-box contract. |
| Provider credentials block autonomous deployment | Complete Phase 0 and local Phase 1/2 work first; list exact non-secret variables, mark the Phase 2 remote gate blocked if needed, and limit the user checkpoint to account authorization. |
| Active match breaks across deployment | Protocol/schema version handshake, compatibility tests, Worker-first deployment order, and explicit drain/reset procedure. |

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-19 | Use a Cloudflare Durable Object as the authoritative realtime simulation and keep Vercel for the app/pairing APIs. | Vercel functions cannot host a continuous authoritative WebSocket simulation; direct WebSockets plus a single state owner fit two-player low-latency rules. |
| 2026-08-19 | Implement a pure custom TypeScript AABB simulation and Canvas renderer rather than a browser-only physics engine. | The same rules can run authoritatively on the server and in unit tests, while rendering stays lightweight and replaceable. |
| 2026-08-19 | Pair fixed roles with an adult PIN and revocable HttpOnly device credentials. | This prevents a browser-stored name from claiming or taking over a player and supports replacement devices. |
| 2026-08-19 | Include all six world configs and P1 features, but only after each feature's P0 foundation is independently verified. | The user requested the entire game plan; low-risk shared work need not be duplicated, but P1 cannot weaken or delay a P0 gate. |
| 2026-08-19 | Persist at 5 Hz and commit irreversible simulation outcomes before broadcasting them. | This bounds movement rollback to 200 ms while preventing acknowledged damage, claims, inventory, or lifecycle changes from being lost on restart. |
| 2026-08-19 | Publish the existing project history to `neworange-ruud/senna-luca-stijders` before Phase 0. | The user explicitly requested the early repository move and the destination repository is empty, so no remote work is displaced. |
| 2026-08-19 | Treat checkpoints as visible evidence, not approval gates. | The user can follow progress while implementation remains autonomous and resumable. |

## Verification Evidence

Append concise entries as work is verified. Do not replace prior evidence.

| Date | Phase | Command or check | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-08-19 | Planning | PRD and foundation inspection | Plan created; implementation not started | `docs/PLAN.md` |
| 2026-08-19 | Planning | Independent PRD coverage and contradiction audit | Passed after revisions; no unresolved actionable findings | P0 coverage, acceptance traceability, and phase gates in this document |
| 2026-08-19 | Planning | `git diff --check` | Passed | `AGENTS.md`, `docs/PLAN.md` |
| 2026-08-19 | Repository | Destination and credential audit | Empty public destination verified; local credential-bearing `opencode.json` excluded | `.gitignore`, GitHub repository metadata |
| 2026-08-19 | Repository | `npm run check` | Passed: 3 test files, 7 tests, TypeScript checks, and production build | Local command output before publication |

## Session Log

Append one row at session start and update its outcome before session end.

| Date | Phase | Work | Outcome / restart point |
| --- | --- | --- | --- |
| 2026-08-19 | Planning | Read the PRD and current Vite/Vercel/Upstash foundation; selected architecture, testing strategy, phases, checkpoints, and defaults; completed an independent audit and corrected all findings. | Plan audit passed. Ready to start Phase 0 at its first unchecked task. No implementation code changed. |
| 2026-08-19 | Repository | Prepared the complete application, documentation, concept assets, and existing history for the user-requested GitHub destination. | Implementation restart point remains Phase 0. Machine-local OpenCode credentials are intentionally excluded from source control. |
