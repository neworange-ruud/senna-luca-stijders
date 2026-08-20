# Senna & Luca Strijders Implementation Plan

This is the durable execution record for implementing [`PRD.md`](./PRD.md). It is both a plan and a restart point for later sessions. Implementation must not rely on chat history.

## Status

- Last updated: 2026-08-20
- Overall status: Implementation in progress
- Current phase: Phase 10 - Final headless acceptance, deployment, and physical release
- Implementation progress: 10 of 11 phases complete
- Current blocker: None for the automated part of Phase 10. Two items need the physical devices: the exact target iPad model identifiers, and the unassisted first-use and frame-rate measurements on them.
- Next action: Start Phase 10 at the acceptance-criterion mapping, then the security and dependency audit. Deploy the schema v7 Worker before the matching frontend.

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
8. Generated art and audio are now explicitly requested and in scope. Gameplay, collision, accessibility, and layout must still not depend on artwork: every asset renders inside the existing bounding-box contract and the game stays playable and understandable when an asset fails to load.

## Scope And Completion Rules

- All P0 requirements and all 14 version 1 acceptance criteria in the PRD are mandatory.
- P1 requirements are included where they directly share a P0 implementation (for example keyboard input and world selection) or after the corresponding P0 system is proven. P1 work must never delay or weaken a P0 verification gate.
- P2 ideas and the items in PRD section 10 remain out of scope.
- Generated graphics and audio are in scope from the 2026-08-19 art request onward. Sprites, backgrounds, and icons come from the Layer MCP pipeline; audio is synthesised in the browser because this workspace has no enabled Layer audio model. Rendered characters keep distinct silhouettes, labels, contrast, hit feedback, and reduced-motion behavior, and a missing asset falls back to the geometric dummy drawing.
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
- Pairing a replacement device requires the adult PIN and explicit replacement confirmation. It increments the role generation and sends a signed revocation to the Durable Object, which disconnects the old session before the new role can act. If that signed call cannot be delivered, pairing still completes and is logged: the rotated credential already prevents the old device from obtaining a new session token, and the Durable Object closes the previous socket and rejects the older generation as soon as the replacement device connects. Pairing must never fail in a way that leaves both devices unable to play.
- A role has at most one active gameplay connection. A second unpaired or stale device is denied access, cannot observe live match state, and cannot send commands.
- Mutating APIs validate method, content type, request origin, body shape, rate limits, role, generation, and current game phase. Secrets never enter browser bundles or Git.

### Match Rules

- The world chooser alternates by completed match, with Luca choosing first. The chooser selects; the other player sees the same world and confirms it. Both players still choose a cosmetic and mark ready.
- Version 1 ships six functional data-driven arena configurations: beach, forest, space planet, construction site, city, and boat. Each has its own generated backdrop from Phase 6 onward; their distinct geometry lands in Phase 9.
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

- Luca and Senna use distinct labeled generated character sprites with a role-coloured pad underneath, and fall back to distinct geometric shapes when artwork is unavailable. The five required cosmetic themes are superhero, soldier, knight, astronaut, and pirate; cosmetics alter palette and silhouette decorations only.
- Arena definitions, cosmetic definitions, item definitions, tunables, and Dutch labels are data-driven and schema-validated.
- All visible strings come from one Dutch message catalog. Tests fail on missing entries and scan rendered routes for known English fallback text.
- The first match displays short contextual control hints. Essential information uses icon/shape plus text, not color alone.
- Sound effects and a simple music loop are synthesised at runtime without third-party assets. Effects and music have separate persistent mute controls and never autoplay before user interaction.
- Layer MCP is the generation path for game sprites and other images. Every run is price-estimated first and uses the cheapest enabled model compatible with the required modality, capabilities, and output size. Test generations use one output at the smallest suitable size; a more expensive model is allowed only when no cheaper compatible model meets the requirement or the user explicitly requests it. Raw generations live in `assets/source/` and `npm run assets` derives everything under `public/art/`. Sound effects and music are synthesised in the browser because the workspace has no enabled Layer audio model.
- The supplied GitHub destination is `neworange-ruud/senna-luca-stijders` (without the first `r` in `strijders`) as directed by PRD section 9. Product copy, package naming, and local folder naming use the correct Dutch `senna-luca-strijders`. The user explicitly requested early publication to the verified empty destination before Phase 0; this does not change implementation status.
- The current intro illustration remains a non-binding visual reference. This pass deliberately uses high-contrast geometric dummy art; approval or refinement of final portrait/style art is a separate post-gameplay decision and cannot block the functional release described here.

### Pending User Inputs

These are external facts, not implementation design choices. Record answers here as soon as they become available.

| Input | Needed by | Current handling |
| --- | --- | --- |
| Exact model identifier and iPadOS version for Luca's iPad | Phase 10 physical gate | Develop to Safari 17/iPadOS 17 floor and common iPad landscape viewports. |
| Exact model identifier and iPadOS version for Senna's iPad | Phase 10 physical gate | Same as above. |
| Provider/GitHub account authorization and production secrets | Phase 2 remote gate and Phase 10 deployment | Preview and production are both provisioned: each has its own Worker, room, signing secret, and internal secret. The release-check `ADMIN_PIN` was rotated to a value nobody holds, so the owner must set their own with `vercel env add ADMIN_PIN production` and redeploy before pairing an iPad. The Worker-side secrets are in the ignored `.production-secrets.local`, which is their only copy. Never store real values in Git. |

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

### Single-Player Test Mode

`?test=1` (or `?test=senna`) starts a complete match inside the browser using
the same pure rules as the Durable Object, with a deterministic training
opponent. It opens no socket, requires no pairing, and never reads or writes
shared authoritative state, so it can be used in any environment without
affecting a real match. It is an observation and manual-testing tool: it never
replaces an authoritative test layer below, and no acceptance criterion may be
marked passed on practice evidence alone.

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
npm run test:production
npm run build
npm run check
```

`npm run check` must include unit tests, integration tests, type checking, lint/format validation, and a production build. Browser E2E remains an explicit final command because it starts multiple local services and browsers.

## Implementation Phases

### [x] Phase 0 - Baseline And Toolchain

Goal: turn the foundation into a reproducible multi-runtime project before changing gameplay.

- [x] Record current `npm run check` output and preserve relevant generic protocol tests until replacements cover them.
- [x] Rename package/app metadata and replace README foundation instructions with project-specific local architecture instructions.
- [x] Add strict formatting/lint scripts, separate unit/integration scripts, Playwright with Chromium and WebKit, and coverage output for pure game rules.
- [x] Add Wrangler local configuration with separate dev/preview/production Durable Object namespaces and documented environment variables.
- [x] Add a one-command local full-stack launcher for Vite/Vercel APIs plus the Worker, with deterministic local secrets and no production credentials.
- [x] Add CI jobs for `npm ci`, `npm run check`, and headless E2E with failure artifacts.
- [x] Add test helpers for fake time, seeded random, paired players, and authoritative state snapshots.
- [x] Verify no secret or `.env` file is tracked and document setup through `.env.example` placeholders.

Verification:

- `npm run check`
- `npm run test:e2e` with a temporary two-WebSocket smoke test
- `npm run test:e2e:webkit` with the landing-page smoke test

Checkpoint: `docs/checkpoints/phase-00.md` records versions, commands, architecture diagram, baseline failures removed, and a screenshot of the local health/status page.

### [x] Phase 1 - Deterministic Game Core

Goal: build and test the server-independent rules before networking or UI depends on them.

- [x] Define versioned lobby, match, player, input, entity, item, effect, arena, snapshot, and error schemas.
- [x] Implement integer-tick clock, seeded random source, command sequence/idempotency rules, and stable entity IDs.
- [x] Implement the phase state machine: waiting, world selection, ready, countdown, playing, paused, reconnecting, finished, rematch reset.
- [x] Implement data-driven arena validation, floor/platform/solid collision, spawn selection, and valid/reachable chest points.
- [x] Implement horizontal movement, gravity, jump, air control, player/arena collision, and out-of-bounds safe respawn.
- [x] Add unit and invariant tests after each behavior, including long seeded simulations with finite-state assertions.

Verification:

- Focused test command after each rule file
- `npm run test:unit`
- `npm run check`

Checkpoint: a deterministic simulation CLI replays a saved input fixture twice and writes identical final snapshot hashes to `docs/checkpoints/phase-01.md`.

### [x] Phase 2 - Authoritative Realtime Runtime

Goal: prove two clients can observe and control one authoritative low-latency simulation.

- [x] Implement Worker routing, Durable Object lifecycle, environment/room isolation, and schema-versioned persistence.
- [x] Implement WebSocket hello, command, acknowledgement, snapshot, ping, structured Dutch error-code mapping, and protocol-version mismatch messages.
- [x] Run simulation only while needed, publish delta-friendly snapshots at 15 Hz, checkpoint lifecycle state, and restore safely after object restart.
- [x] Implement command validation, per-role monotonic sequence numbers, deduplication, rate limits, payload limits, and invalid-state rejection.
- [x] Implement a minimal client transport with reconnect/backoff, snapshot ordering, clock-offset estimate, and a debug network panel excluded from production by default.
- [x] Measure local two-client command-to-remote-snapshot latency and bandwidth; keep median comfortably below the PRD 200 ms budget.
- [x] Deploy the spike to isolated preview infrastructure and measure browser-to-remote-player action latency from two external connections. Require median at or below 200 ms and p95 at or below 350 ms during a 5-minute representative run; local measurements alone cannot pass this gate.

Verification:

- Worker integration tests for two sockets, duplicates, out-of-order messages, malformed commands, restart, and schema mismatch
- A 10-minute headless soak with deterministic bot input and convergent snapshots
- Preview latency run over the real Vercel-to-Worker architecture; mark Phase 2 `[!]` if account access is unavailable or the budget fails
- `npm run check`

Checkpoint: `docs/checkpoints/phase-02.md` contains the protocol summary, latency/traffic report, soak result, and two-client debug screenshot. If the architecture cannot meet the budget, stop and record an ADR before replacing it.

### [x] Phase 3 - Secure Device Pairing

Goal: make Luca and Senna the only writable roles and prove takeover prevention.

- [x] Replace `/api/state` with typed pairing, session, recovery/revoke, and health handlers.
- [x] Implement constant-time adult PIN validation, secure device-cookie issuance, hashed credential storage, generation rotation, origin checks, and rate limiting.
- [x] Implement short-lived signed role tokens and Worker-side signature, expiry, audience, environment, role, and generation validation.
- [x] Enforce one active connection per role and signed live revocation when a replacement device is paired.
- [x] Build Dutch first-pair, returning-device, role-occupied, invalid-PIN, recovery-confirmation, offline, and unauthorized screens.
- [x] Add logs containing request IDs and error codes but no PINs, credentials, tokens, free text, or personal data.

Verification:

- Unit tests for cookie/token/hash helpers and expiry/generation boundaries
- Integration tests for first pair, return, wrong PIN throttling, stale cookie, replay, replacement, old-socket disconnect, cross-environment rejection, and third-device denial
- Headless three-context security journey
- `npm run check`

Checkpoint: the user can inspect the pairing flow while `docs/checkpoints/phase-03.md` shows the redacted security matrix and attacker-context result.

### [x] Phase 4 - Lobby, Cosmetics, And Match Start

Goal: let both children reach a synchronized match countdown without free text.

- [x] Build responsive Dutch lobby UI for fixed identity, peer connection state, cosmetics, world chooser/confirmation, ready state, and waiting feedback.
- [x] Add Luca/Senna dummy sprites and the five required cosmetic definitions with no gameplay fields.
- [x] Implement alternating chooser state and six selectable world definitions, initially sharing validated geometry where unique layouts are not complete yet.
- [x] Require both authenticated roles, selected cosmetics, world confirmation, and ready state before a server countdown can begin.
- [x] Handle refresh, duplicate ready commands, chooser disconnect, and stale prior-match lobby state.
- [x] Add first-run setup hints and accessible names/focus behavior for lobby controls.

Verification:

- Unit tests for chooser alternation, readiness, cosmetic neutrality, and all match-start guards
- Integration test for two roles moving from lobby to countdown
- Headless desktop and iPad-landscape lobby journey with screenshots
- `npm run check`

Checkpoint: two local URLs show Luca and Senna selecting skins, confirming one world, and entering the same countdown. Evidence goes in `docs/checkpoints/phase-04.md`.

### [x] Phase 5 - Playable Movement Vertical Slice

Goal: make one complete arena fun to move around in on touch and keyboard before adding item complexity.

- [x] Build Canvas renderer with dummy sprites, platforms, cover, labels, HUD, camera bounds, and local-player follow.
- [x] Implement fixed touch controls with multi-touch move plus jump/action and safe-area/orientation handling.
- [x] Add keyboard controls and a shared input mapper that emits intent rather than state mutations.
- [x] Implement local movement prediction, remote interpolation, authoritative reconciliation, and visible connection quality.
- [x] Give immediate local visual/pressed feedback to every local action intent, including jump, attack, block, Action/chest attempt, switch, pause, and ready, while keeping authoritative outcomes pending.
- [x] Complete the beach arena layout with pursuit paths, hiding/cover, reachable platforms, safe spawn points, and chest locations.
- [x] Add fall/respawn presentation and 1.5-second spawn protection indicator.
- [x] Test camera and arena assumptions at common iPad landscape dimensions and adjust only through config.

Verification:

- Unit tests for input combinations, camera bounds, prediction replay, collision edges, jump/platform behavior, and safest respawn
- Dual-client headless movement race with simultaneous key input and an explicit two-contact pointer-injection harness proving move plus jump/attack/block multi-touch
- Automated screenshot checks at 1024x768, 1180x820, 1366x1024 landscape CSS viewports and reduced motion
- `npm run check`

Checkpoint: a local two-player movement build plus screenshots and measured correction/latency data in `docs/checkpoints/phase-05.md`. This explicitly validates camera size and whether players can meaningfully find and evade each other.

### [x] Phase 6 - Combat, Hearts, And Weapons

Goal: complete deterministic combat with immediate local feedback and server-authoritative outcomes.

- [x] Implement unarmed and sword melee hitboxes, cooldowns, facing, rear/front block rules, and non-bloody feedback events.
- [x] Implement sword charge/throw, projectile collision, ground retrieval, unreachable return, and owner/inventory transitions.
- [x] Implement Nerf darts, ammo, cooldown, cover collision, and toy-like projectile feedback.
- [x] Implement two weapon slots, switch control, full-inventory replacement/drop, pickup, and clear selected/empty states.
- [x] Implement heart changes, armor-independent base damage, respawn protection, simultaneous lethal-hit policy, immediate match stop, and winner state.
- [x] Add predicted animation/feedback that is cancelled or corrected without predicting opponent damage.

Verification:

- Focused unit tests after each weapon and combat rule
- Invariant tests for one damage application per attack ID, no friendly/self damage, no damage through cover, no damage after finish, and health bounds
- Integration tests with adversarial forged hits, impossible fire rates, stale inputs, and simultaneous attacks
- Dual-client headless scripted duel using every base weapon and block direction
- `npm run check`

Checkpoint: `docs/checkpoints/phase-06.md` links a reproducible duel fixture, final state hash, screenshots of each weapon, and combat test report.

### [x] Phase 7 - Chests, Effects, And Fairness

Goal: complete the pickup loop and prove that races and randomness are authoritative and bounded.

- [x] Implement announced chest landing, valid spawn selection, active limits, seeded shuffle bag, and persisted random state.
- [x] Implement Action-range claims, same-tick deterministic tie resolution, duplicate-command idempotency, and exactly-one reward events.
- [x] Implement sword, weak sword, Nerf, armor, camouflage, and speed chest outcomes with animated Dutch icon/label reveals that respect reduced motion.
- [x] Implement armor capacity and active-time effect timers, HUD indicators, opponent-visible states, pause behavior, and clean replacement/reset.
- [x] Implement and statistically test the exact eligible-recovery counter/replacement rule without changing already announced contents or consuming a base-bag item.
- [x] Ensure every configured chest location is reachable by deterministic movement validation or an explicit arena test route.

Verification:

- Unit tests for every item, timer boundary, claim race, bag cycle, pause, death, replacement, and rematch cleanup
- Seeded distribution tests over at least 10,000 draws with documented bounds
- Integration test with simultaneous claim packets and worker restart after announcement/claim
- Headless journey that acquires and demonstrates every chest outcome
- `npm run check`

Checkpoint: an item gallery/debug seed route and fairness report in `docs/checkpoints/phase-07.md`.

### [x] Phase 8 - Pause, Reconnect, Finish, And Rematch

Goal: make every interruption safe and every lifecycle transition convergent.

- [x] Implement immediate global pause, requester label, both-ready resume, authoritative 3-second countdown, and frozen movement/projectile/chest/effect clocks.
- [x] Implement socket-close and heartbeat-staleness safety, immediate stale-intent clearing and symmetric connection pause at 750 ms, offline status at 2 seconds, reconnect grace period, and role restoration.
- [x] Reconcile reconnecting clients from full snapshots without duplicate entities, claims, damage, or players.
- [x] Detect impossible protocol/state divergence, stop play, show a Dutch recovery message, and offer an authorized clean restart.
- [x] Implement winner overlay, both-player rematch consent, alternating next chooser, and exhaustive state reset.
- [x] Add persistence compatibility/version checks and a deployment policy that drains or explicitly resets incompatible active matches.

Verification:

- Unit tests prove all simulation clocks are unchanged during pause, neither player can move/attack/block/claim after either heartbeat becomes stale, and reset state contains no old entity IDs
- Integration tests for disconnect at every lifecycle phase, reconnect/replay, object restart, stale version, and revoked session
- Headless network-offline test during movement, projectile flight, chest claim, pause countdown, and finished screen
- 30-minute two-bot soak with random disconnects and snapshot convergence assertions
- `npm run check`

Checkpoint: `docs/checkpoints/phase-08.md` contains the lifecycle matrix, soak report, and Playwright trace of disconnect/reconnect/rematch.

### [x] Phase 9 - Worlds, Teleports, Tutorial, Audio, And Accessibility

Goal: finish P1 content and make the complete experience understandable and robust for the target children.

- [x] Give forest, space planet, construction site, city, and boat distinct validated geometry using the same game systems.
- [x] Add linked teleports to at least one arena with clear destination choice, cooldown, safe arrival, and tests for blocked/invalid destinations.
- [x] Finish first-match contextual hints for movement, jump, attack, block, Action, weapon switch, chests, and pause.
- [x] Centralize and audit all Dutch text, status, instruction, and error paths; remove the English demonstration UI.
- [x] Add generated placeholder sounds for jump, block, hit, chest opening, weapon use, pause, and countdown plus simple music; require first-interaction audio start, separate persistent mute controls, and no audio dependency for gameplay cues.
- [x] Verify touch target sizes, contrast, icon-plus-text cues, focus order, screen-reader labels outside the canvas, reduced motion, orientation messaging, safe areas, and prevention of accidental browser gestures.
- [x] Optimize rendering allocations and entity culling to sustain 60 fps target/30 fps floor on representative throttled profiles.

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
| 4. Start with 10 hearts and no weapons | 1, 4, 6 | Match initialization unit and E2E assertions | Passed: `tests/unit/combat.test.ts`, `tests/e2e/practice.spec.ts` assert ten hearts and bare fists at match start |
| 5. Move, jump, attack, block, evade | 5, 6 | Gameplay unit suite and scripted duel | Passed: movement, combat, and invariant suites plus the dual-client duel journey |
| 6. Chests spawn and have one claimant | 7 | Race/invariant tests and item E2E journey | Passed: `tests/unit/chests.test.ts`, simultaneous-claim Worker test, and `tests/e2e/chests.spec.ts` |
| 7. Sword, throw, Nerf, weapon switch | 6 | Per-weapon unit tests and duel trace | Passed: `docs/checkpoints/phase-06.md` fixture hash and `tests/e2e/duel.spec.ts` |
| 8. Shared authoritative hearts | 2, 6 | Forged-hit rejection and convergent snapshots | Passed: forged input rejected and cadence enforced in `tests/worker/realtime-worker.test.ts`; both clients agree on every heart change in `tests/e2e/duel.spec.ts` |
| 9. Safe no-damage out-of-bounds return | 1, 5 | Respawn unit and browser journey | Pending |
| 10. Pause/reconnect gives no advantage | 8 | Frozen-clock tests and offline Playwright trace | Passed: frozen clocks and symmetric freeze in `tests/unit/lifecycle.test.ts`, plus the offline journey in `tests/e2e/lifecycle.spec.ts` |
| 11. Zero hearts and clean rematch | 6, 8 | Finish/reset invariants and full journey | Passed: exhaustive reset invariants and the winner journey with rematch consent |
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
| 2026-08-20 | Every world has its own arena file, and the arena is derived from the world the match is playing. | Six worlds that all played on the beach geometry were six names for one world. Deriving the arena instead of storing it means a checkpoint can never disagree with the world it says it is in. |
| 2026-08-20 | Reachability treats a teleport as a way to travel. | A rooftop that only a lift can reach would otherwise be reported unreachable, and the city would have had to be flattened into another beach. |
| 2026-08-20 | A teleport leads to exactly one other teleport, and both ends carry the same name on screen. | A list of destinations needs a menu in the middle of a fight. A named pair shows a seven-year-old where the lift goes without reading anything. |
| 2026-08-20 | Remember an Action press until a tick consumes it, moving persisted state to schema v7 together with the lift cooldown. | Chests already had the same defect the attack had: a tap shorter than one tick was dropped, so a child tapping quickly next to a chest saw nothing happen. |
| 2026-08-20 | Assert the frame rate only where the browser composites on a GPU, and assert the game's own per-frame work everywhere. | Headless WebKit on the build machine rasterises in software: an empty page holds 60 fps, a match holds 7, and rendering the same match at 24 percent of the pixels tracks the pixel count. Its frame rate says nothing about an iPad, while the 0.32 ms the game spends per frame does. The 30 fps floor on the target devices is measured physically in Phase 10 rather than lowered. |
| 2026-08-20 | A phase change is broadcast the moment it happens, outside the 15 Hz snapshot cadence. | The tick that ends a match is the last tick the room simulates. A closing snapshot that fell on a skipped tick was never sent, so about half of all finished matches were never reported to the players. |
| 2026-08-20 | An attack press is latched until a tick consumes it, moving persisted state to schema v6. | A tap can start and end inside one 33 ms tick. Sampling only the current control state lost it, so a fast tap on a touchscreen did nothing. |
| 2026-08-20 | Control releases are handled on the window instead of the button. | A finger sliding off a control, or a gesture the browser takes over, otherwise leaves the control held for the rest of the match and blocks every later attack. |
| 2026-08-19 | Use a Cloudflare Durable Object as the authoritative realtime simulation and keep Vercel for the app/pairing APIs. | Vercel functions cannot host a continuous authoritative WebSocket simulation; direct WebSockets plus a single state owner fit two-player low-latency rules. |
| 2026-08-19 | Implement a pure custom TypeScript AABB simulation and Canvas renderer rather than a browser-only physics engine. | The same rules can run authoritatively on the server and in unit tests, while rendering stays lightweight and replaceable. |
| 2026-08-19 | Pair fixed roles with an adult PIN and revocable HttpOnly device credentials. | This prevents a browser-stored name from claiming or taking over a player and supports replacement devices. |
| 2026-08-19 | Include all six world configs and P1 features, but only after each feature's P0 foundation is independently verified. | The user requested the entire game plan; low-risk shared work need not be duplicated, but P1 cannot weaken or delay a P0 gate. |
| 2026-08-19 | Persist at 5 Hz and commit irreversible simulation outcomes before broadcasting them. | This bounds movement rollback to 200 ms while preventing acknowledged damage, claims, inventory, or lifecycle changes from being lost on restart. |
| 2026-08-19 | Publish the existing project history to `neworange-ruud/senna-luca-stijders` before Phase 0. | The user explicitly requested the early repository move and the destination repository is empty, so no remote work is displaced. |
| 2026-08-19 | Treat checkpoints as visible evidence, not approval gates. | The user can follow progress while implementation remains autonomous and resumable. |
| 2026-08-19 | Generate sprites, images, and audio through Layer MCP using the cheapest compatible enabled model after estimating each run. | This provides one repeatable asset pipeline while minimizing Creative Unit use; the successful Senna sprite test proved the workflow at 0.3 CU. |
| 2026-08-19 | Make the unattended local launcher use Vite with API-compatible development adapters; keep `dev:vercel` as the provider-parity command. | Vercel CLI requires selecting one of the authenticated account's teams even with `--yes`, so it cannot be the deterministic credential-free default required by Phase 0. Handler integration tests and the explicit provider command preserve Vercel parity. |
| 2026-08-19 | Schedule each authoritative simulation callback only after the prior async tick completes, and keep Playwright's disposable latency room in memory. | This prevents overlapping state/persistence callbacks; real storage persistence remains covered by Worker integration tests and enabled in preview/production. |
| 2026-08-19 | Bump persisted game state to schema v2 when adding deterministic combat cooldown state. | Attack cadence must be authoritative and survive Durable Object restart; preview may reset incompatible v1 state during the Worker-first Phase 6 deployment, and production has no active match. |
| 2026-08-19 | Add a browser-only single-player test mode behind `?test=`, sharing one command reducer and one movement/combat implementation with the Worker. | Gameplay work needed a way to exercise movement and combat without two paired devices. Reusing the pure rules keeps the practice match faithful, and keeping it socket-free and state-free means it cannot influence or observe an authoritative match. |
| 2026-08-19 | Derive the Worker revocation endpoint from the realtime URL by converting ws/wss to http/https, and complete a replacement pairing even when live revocation fails. | The previous code fetched a `wss://` URL, so every replacement pairing failed with 503 after the stored credential had already been rotated, locking out both the old and the new device. The Durable Object still closes the previous socket and rejects the older generation when the new device connects, and the old device can no longer mint a session token. |
| 2026-08-19 | Bump persisted game state to schema v3 for inventory selection, attack charge state, arena entities, and pruned feedback events. | Throws, darts, pickups, and visible hit feedback all need authoritative state that survives a Durable Object restart. Preview may reset incompatible v2 state during the Worker-first deployment, and production has no active match. |
| 2026-08-19 | Let players move through each other, and measure the melee area from the attacker's own centre instead of the front of their body. | Pass-through keeps evasion readable for young players and avoids pushing collisions, but an overlapping opponent was unhittable while the hitbox started at the front edge. Measuring from the centre keeps the tuned outward reach and removes that dead zone. |
| 2026-08-19 | Publish authoritative outcomes as pruned `MatchEvent` records instead of letting the browser infer them from health changes. | Hit, block, protection, pickup, and empty-blaster feedback need the reason, not only the result, and pruning by tick stops a reconnecting client from replaying old events as fresh feedback. |
| 2026-08-19 | Generate art with Ideogram V4 on a flat magenta backdrop, then key, trim, slice, and scale it locally with a dependency-free pipeline under `npm run assets`. | Ideogram V4 is the cheapest enabled image model at 0.3 CU per megapixel and no enabled model outputs transparency. A border-grown key with an unmixed edge separates artwork from backdrop without eating colours that sit close to the key, which a plain distance key did. |
| 2026-08-19 | Synthesise all sound effects and music in the browser with the Web Audio API rather than generating audio through the Layer MCP. | This Layer workspace has no enabled audio model, so the MCP cannot produce audio at all. Synthesis also ships no third-party assets, needs no network, and keeps effects and music independently mutable. |
| 2026-08-19 | Add a development-only `/debug/give-weapon` route, gated to local development with `E2E_IN_MEMORY`, and a practice-mode weapon selector. | The Phase 6 gate requires a dual-client duel with every base weapon, but chests only arrive in Phase 7. The route is unreachable in preview and production and is replaced by real chest pickups once Phase 7 lands. |
| 2026-08-20 | Bump persisted game state to schema v4 for chests and the chest schedule. | Announced chests, their contents, and the shuffle bag must survive a Durable Object restart, otherwise a restart would hand out a second reward or lose an announced landing. Preview may reset incompatible v3 state during the Worker-first deployment. |
| 2026-08-20 | Evaluate the eligible-recovery counter when a chest is scheduled, and keep the already announced contents untouched. | Deciding at scheduling time is what makes the rule testable and prevents a chest changing its contents mid-flight, which the PRD forbids. A recovery chest therefore replaces the draw rather than the chest. |
| 2026-08-20 | Spend armor after blocking and before hearts. | This keeps a weapon worth the same damage everywhere; armor only changes who pays for it, which is what the plan means by armor-independent base damage. |
| 2026-08-20 | Add a development-only `/debug/spawn-chest` route for the all-outcomes browser journey. | Demonstrating six chest outcomes through the real schedule would take over a minute per run. The route only skips the wait: the landing, the claim, and the reward run through the authoritative rules, and the schedule itself is unit tested. |
| 2026-08-20 | Bump persisted game state to schema v5 for the pause reason, and keep credential generations when an incompatible checkpoint is drained. | The browser has to explain a connection pause differently from a pause a child asked for. Dropping a whole checkpoint used to drop the generations with it, which would have let a replaced device back in after an incompatible deployment. |
| 2026-08-20 | Treat any message on a role's socket as that role's heartbeat, and require heartbeats only while a match runs or is already frozen by a connection. | The heartbeat is a statement about the connection, so a ping proves it just as well as an input. Requiring one during a lobby or countdown was wrong: nobody sends controls there, and an earlier version paused its own countdown because of it. |
| 2026-08-20 | Freeze the match for both players when either heartbeat is late, and refuse gameplay commands from both. | An asymmetric freeze would let the healthy player attack an opponent who cannot move or block, turning a bad connection into an advantage. |
| 2026-08-20 | Keep the room ticking while a match is frozen by a connection, and broadcast a snapshot when a socket closes. | The soak proved both were needed: without the tick the two-second offline escalation never ran, and without the broadcast the player who stayed kept watching an arena that was no longer running. |

## Verification Evidence

Append concise entries as work is verified. Do not replace prior evidence.

| Date | Phase | Command or check | Result | Evidence |
| --- | --- | --- | --- | --- |
| 2026-08-19 | Planning | PRD and foundation inspection | Plan created; implementation not started | `docs/PLAN.md` |
| 2026-08-19 | Planning | Independent PRD coverage and contradiction audit | Passed after revisions; no unresolved actionable findings | P0 coverage, acceptance traceability, and phase gates in this document |
| 2026-08-19 | Planning | `git diff --check` | Passed | `AGENTS.md`, `docs/PLAN.md` |
| 2026-08-19 | Repository | Destination and credential audit | Empty public destination verified; local credential-bearing `opencode.json` excluded | `.gitignore`, GitHub repository metadata |
| 2026-08-19 | Repository | `npm run check` | Passed: 3 test files, 7 tests, TypeScript checks, and production build | Local command output before publication |
| 2026-08-19 | Phase 0 | `npm ci` | Passed; 207 packages installed, 0 vulnerabilities | Local command output |
| 2026-08-19 | Phase 0 | `npm run check` | Passed: formatting, typed lint, 2 unit tests, 5 integration tests, three-runtime type checks, and production build | `docs/checkpoints/phase-00.md` |
| 2026-08-19 | Phase 0 | `npm run test:e2e` and `npm run test:e2e:webkit` | Passed: landing and shared two-WebSocket Durable Object smoke in Chromium and WebKit | `tests/e2e/smoke.spec.ts` |
| 2026-08-19 | Phase 0 | Live `npm run dev` health probe and tracked-secret scan | Passed: API and Worker status `ok`; no secret/local env files tracked | `docs/checkpoints/phase-00-health.png` |
| 2026-08-19 | Phase 1 | Focused rule tests and `npm run test:unit` | Passed: 7 files, 31 tests, including 10,000 seeded simulation ticks | `docs/checkpoints/phase-01.md` |
| 2026-08-19 | Phase 1 | `npm run test:unit:coverage` | Passed: 90.74% statements, 86.22% branches, 95.08% functions, 93.11% lines in `src/game` | `coverage/unit/` |
| 2026-08-19 | Phase 1 | `npm run simulation:replay` | Passed: two independent 360-tick runs produced SHA-256 `e868d444f2c2f4d133409158a521f6d0eb6c8ffc008cb28ea99846ae77082656` | `tests/fixtures/phase-01-replay.json` |
| 2026-08-19 | Phase 1 | `npm run check` | Passed: formatting, typed lint, 31 unit tests, 5 integration tests, all type checks, and production build | `docs/checkpoints/phase-01.md` |
| 2026-08-19 | Phase 2 | `npm run test:integration:worker` | Passed: 5 Workers-runtime tests covering protocol, two roles, persistence/eviction, validation, sequencing, forged roles, and limits | `tests/worker/realtime-worker.test.ts` |
| 2026-08-19 | Phase 2 | Chromium/WebKit local realtime journey | Passed: Chromium median/p95 75.2/92.6 ms; WebKit 61/77 ms; snapshots converged | `docs/checkpoints/phase-02.md` |
| 2026-08-19 | Phase 2 | `npm run test:soak` | Passed: 10.2 minutes, 6,400 commands, median/p95 51/55.9 ms, 92,078,943 combined bytes, converged final revisions | `docs/checkpoints/phase-02.md` |
| 2026-08-19 | Phase 2 | `npm run check` and `git diff --check` | Passed: 32 unit tests, 10 integration tests across Node and Workers runtime, formatting, typed lint, all type checks, production build, and whitespace audit | Local command output |
| 2026-08-19 | Phase 2 | Remote preview latency gate | Blocked: provider authorization, isolated preview resources, and secrets unavailable | `docs/checkpoints/phase-02.md` |
| 2026-08-19 | Phase 2 | Vercel/Cloudflare/Upstash preview deployment and health checks | Passed: Vercel Ready, Functions in `fra1`, Redis revision returned, Worker protocol/schema v1 | `docs/checkpoints/phase-02.md` |
| 2026-08-19 | Phase 2 | Five-minute external Worker latency gate | Passed: 4,500 commands over 5.1 minutes, median 46 ms, p95 62.9 ms, converged revisions | `docs/checkpoints/phase-02.md` |
| 2026-08-19 | Infrastructure | Vercel Marketplace Upstash provisioning | Passed: `senna-luca-strijders-state`, `fra1`, pay-as-you-go, eviction enabled, auto-upgrade disabled, connected to development/preview/production | Vercel integration resource `store_qr5yJDCEFxT4syqR` |
| 2026-08-19 | Phase 3 | Focused credential, token, device-store, pairing, and session tests | Passed: salted hashes, constant-time PIN digest comparison, hardened cookies, token scope/expiry/tamper, atomic generation rotation, throttling, API guards | `tests/unit/credentials.test.ts`, `tests/unit/role-token.test.ts`, `tests/integration/device-store.test.ts`, `tests/integration/pairing-api.test.ts` |
| 2026-08-19 | Phase 3 | `npm run check` and secure preview deployment | Passed: 37 unit tests, 18 integration tests, lint/type/build; Vercel preview pairing/session Functions and token-enforcing Worker deployed | Vercel deployment `dpl_6wPyUnQm5LKsqki2xvpYpMfcE1gY`, Worker version `5d8c996c-11e2-4a36-b43c-ed8c9a438b8c` |
| 2026-08-19 | Phase 3 | Legacy remote write containment | Passed: preview `PATCH /api/state` returns Dutch `410 Gone`; shared HTTP helper no longer deploys as a Function | Vercel deployment `dpl_28fqfRxiuK2NsyPM7zBQb29XVMHn` |
| 2026-08-19 | Phase 3 | Complete secure pairing gate | Passed: 36 unit, 14 integration, and 8 browser-matrix journeys; old state surface removed; stale replacement token rejected; logs redacted | `docs/checkpoints/phase-03.md` |
| 2026-08-19 | Phase 4 | Content, lobby, returning-device, and dual-client countdown gate | Passed: 38 unit tests; Chromium/WebKit touch-enabled 1180×820 lobby journey reaches matching authoritative play state | `docs/checkpoints/phase-04.md` |
| 2026-08-19 | Phase 5 | Input/camera focused suites and `npm run check` | Passed: 43 unit tests, 14 integration tests, formatting, lint, three-runtime type checks, production build; Chromium/WebKit lobby-to-Canvas journey remains green | `src/client/input-mapper.ts`, `src/game/camera.ts`, `src/client/canvas-renderer.ts` |
| 2026-08-19 | Phase 5 | Complete movement, viewport, latency, and deployment gate | Passed: 46 unit, 15 integration, 6 Chromium and 6 WebKit journeys; 74/184.1 ms Chromium and 61/91 ms WebKit median/p95 movement latency; preview health v1 | `docs/checkpoints/phase-05.md` |
| 2026-08-19 | Phase 6 | Focused melee tests, full unit suite, and `npm run check` | Passed: 5 focused melee tests; 51 unit, 15 integration, formatting, lint, type checks, and build; schema v2 compiles across browser/server/Worker | `src/game/combat.ts`, `tests/unit/combat.test.ts` |
| 2026-08-19 | Tooling | Test-mode rule tests, shared reducer tests, and `npm run check` | Passed: 7 practice and 2 reducer tests added; 60 unit and 18 integration tests, formatting, lint, three-runtime type checks, and production build | `src/game/practice.ts`, `tests/unit/practice.test.ts`, `tests/unit/commands.test.ts` |
| 2026-08-19 | Tooling | `npm run test:e2e` and `npm run test:e2e:webkit` | Passed: 7 Chromium and 7 WebKit journeys, including a solo test-mode match that moves, takes authoritative damage, restarts, and keeps its controls unclipped at 1180x820 | `tests/e2e/practice.spec.ts`, `docs/checkpoints/phase-06-testmode.png` |
| 2026-08-19 | Phase 3 | Worker-first preview deployment of the pairing fix | Passed: preview Worker reports protocol 1 / schema 2 and Vercel preview `/api/health` reports `ok`; replacement pairing on the new preview URL still needs the owner's rotated `ADMIN_PIN` to confirm end to end | Worker version `56cc460c-c143-4b0e-a265-8d5f7bb05366`, deployment `dpl_56LCrjGVjF7pAoCPRwHFLZLW2ZvL` (`senna-luca-stijders-e28tvh9rm-neworange-ruud.vercel.app`) |
| 2026-08-19 | Phase 3 | Pairing replacement regression tests | Passed: revocation endpoint derivation for ws/wss/https inputs; a failed live revocation now still issues the replacement cookie and logs `REVOCATION_DEFERRED` instead of locking out both devices | `api/pair.ts`, `tests/integration/pairing-api.test.ts` |
| 2026-08-19 | Phase 6 | Focused combat, inventory, pickup, and duel-replay suites | Passed: 21 combat, 11 inventory/pickup, and 4 recorded-duel tests covering cooldowns, block reduction, rear attacks, cover, protection, throws, darts, ammo, slots, switching, drops, and returns | `tests/unit/combat.test.ts`, `tests/unit/items.test.ts`, `tests/unit/duel-replay.test.ts` |
| 2026-08-19 | Phase 6 | `npm run simulation:replay tests/fixtures/phase-06-duel.json` | Passed: two identical runs, hash `42c270739276ea38429efc1b64dfe9d3db0b4fc00d7379e0dc25eb57cca19c31`, final 8 versus 4 hearts with every base weapon exercised | `docs/checkpoints/phase-06.md` |
| 2026-08-19 | Phase 6 | Combat invariants over a 4,000-tick seeded brawl | Passed: one application per outcome id, no self damage, no damage through cover or protection, health 0-10, at most two weapons, no negative ammo, finish at zero hearts, no damage after finish | `tests/unit/simulation-invariants.test.ts` |
| 2026-08-19 | Phase 6 | `npm run test:integration:worker` adversarial combat | Passed: forged-role input rejected, six press/release cycles inside one cooldown landed exactly one hit, damage present in the durable checkpoint before broadcast | `tests/worker/realtime-worker.test.ts` |
| 2026-08-19 | Phase 6 | `npm run test:e2e` and `npm run test:e2e:webkit` | Passed: 10 Chromium and 10 WebKit journeys, including a dual-client duel where both devices agree on hearts across sword, block, throw, pickup, dart, and switch | `tests/e2e/duel.spec.ts`, `docs/checkpoints/phase-06-duel.png` |
| 2026-08-19 | Phase 6 | `npm run check` | Passed: 126 unit, 10 Node integration, 8 Worker integration tests, formatting, typed lint, three-runtime type checks, and production build | Local command output |
| 2026-08-19 | Art and audio | Layer MCP generation and `npm run assets` | Passed: 2 character sprites, 15 shipped icons, and 6 world backdrops prepared; each run price-estimated at 0.3 CU on the cheapest enabled model; pipeline covered by 9 unit tests | `assets/source/`, `public/art/`, `tests/unit/asset-pipeline.test.ts` |
| 2026-08-19 | Art and audio | Browser audio gate | Passed: every gameplay event maps to a synthesised cue, no audio node exists before a user gesture, and independent effect/music mutes survive a reload in Chromium and WebKit | `tests/unit/audio.test.ts`, `tests/e2e/practice.spec.ts` |
| 2026-08-20 | Phase 7 | Focused chest and effect suites | Passed: 20 chest tests and 7 effect tests covering schedule timing, the two-chest limit, claim reach, tie-break, one-reward-only, bag cycling, the recovery rule, armor ordering, timer expiry, replacement, and pause freezing | `tests/unit/chests.test.ts`, `tests/unit/effects.test.ts` |
| 2026-08-20 | Phase 7 | Seeded chest distribution over 10,002 draws | Passed: exactly 1,667 of each of the six outcomes, because one-of-each-per-bag makes the distribution exact | `tests/unit/chests.test.ts` |
| 2026-08-20 | Phase 7 | `npm run test:integration:worker` chest races | Passed: two simultaneous claim packets left exactly one reward and it was in the durable checkpoint; an announced chest and its schedule are committed before a restart could occur | `tests/worker/realtime-worker.test.ts` |
| 2026-08-20 | Phase 7 | `npm run test:e2e` and `npm run test:e2e:webkit` | Passed: 11 Chromium and 11 WebKit journeys, including one match that delivers all six chest outcomes with Dutch labels and accessible power indicators | `tests/e2e/chests.spec.ts`, `docs/checkpoints/phase-07-chests.png` |
| 2026-08-20 | Phase 7 | `npm run check` | Passed: 157 unit, 10 Node integration, 10 Worker integration tests, formatting, typed lint, three-runtime type checks, and production build | `docs/checkpoints/phase-07.md` |
| 2026-08-20 | Deployment | Worker-first deployment of schema v4 | Passed: preview Worker version `e2cacbba-403c-48e4-be58-bc9189a36b90` and production Worker version `6f62fb01-7d3b-4872-82f7-6bd42e95f259` both report protocol 1 / schema 4 | Cloudflare deploy output |
| 2026-08-20 | Deployment | Vercel production build from `main` | Passed: deployment `senna-luca-stijders-gsj650w9q` Ready, serves the new HUD and the prepared artwork | `npx vercel ls` |
| 2026-08-20 | Deployment | `npm run test:production` | Passed: 5 Chromium and 5 WebKit checks covering health, Dutch unpaired refusal, retired state surface, no secret in the bundle, artwork delivery, and a full test-mode match on the deployed build | `tests/production/smoke.spec.ts` |
| 2026-08-20 | Deployment | Production pairing probe | Passed as fail-closed: with `ADMIN_PIN` unset every pin, including an empty one, is rejected with a Dutch 401, so production cannot be paired until it is provisioned | Live `POST /api/pair` |
| 2026-08-20 | Deployment | Vercel production provisioning | Passed: `ADMIN_PIN`, `SESSION_SIGNING_SECRET`, `WORKER_INTERNAL_SECRET`, and `REALTIME_URL` set as sensitive production variables, matching the production Worker's own secrets; correct pin returns 200 and a wrong pin returns a Dutch 401 | `npx vercel env ls production` |
| 2026-08-20 | Deployment | Paired production journey | Passed: two isolated contexts paired Luca and Senna against the production URL, reached one authoritative match on the release room, both moved and converged, latency well inside the 350 ms p95 budget, and neither player took phantom damage | `tests/production/paired.spec.ts`, `docs/checkpoints/phase-07-production.png` |
| 2026-08-20 | Deployment | Release-check credential rotation | Passed: the release-check `ADMIN_PIN` was replaced with an unheld value and production was redeployed; the old pin now returns a Dutch 401 and the read-only production suite still passes 10/10 with the paired journey correctly skipped | Live `POST /api/pair`, `npm run test:production` |
| 2026-08-20 | Phase 8 | Focused lifecycle suite | Passed: 15 tests covering frozen clocks, symmetric heartbeat freeze, offline escalation, refusal to act while a heartbeat is late, reconnect without duplicates, disconnect from all eight phases, exhaustive reset, and alternating chooser | `tests/unit/lifecycle.test.ts` |
| 2026-08-20 | Phase 8 | `npm run test:integration:worker` | Passed: 11 tests including an incompatible checkpoint that is drained while its credential generations survive | `tests/worker/realtime-worker.test.ts` |
| 2026-08-20 | Phase 8 | Lifecycle browser journeys | Passed in Chromium and WebKit: a named pause needing both players, a real network outage that freezes both sides and recovers, and a winner overlay with rematch consent and a reset to the other chooser | `tests/e2e/lifecycle.spec.ts`, `docs/checkpoints/phase-08-winner.png` |
| 2026-08-20 | Phase 8 | Disconnect soak | Passed: repeated disconnect and recovery cycles with both clients convergent on the same tick after every recovery, no duplicate entities, and health always inside bounds; the soak surfaced two real defects, both fixed | `tests/e2e/soak.spec.ts`, `docs/checkpoints/phase-08.md` |
| 2026-08-20 | Phase 8 | `npm run check` | Passed: 172 unit, 10 Node integration, 11 Worker integration tests, formatting, typed lint, three-runtime type checks, and production build | `docs/checkpoints/phase-08.md` |

## Session Log

Append one row at session start and update its outcome before session end.

| Date | Phase | Work | Outcome / restart point |
| --- | --- | --- | --- |
| 2026-08-19 | Planning | Read the PRD and current Vite/Vercel/Upstash foundation; selected architecture, testing strategy, phases, checkpoints, and defaults; completed an independent audit and corrected all findings. | Plan audit passed. Ready to start Phase 0 at its first unchecked task. No implementation code changed. |
| 2026-08-19 | Repository | Prepared the complete application, documentation, concept assets, and existing history for the user-requested GitHub destination. | Implementation restart point remains Phase 0. Machine-local OpenCode credentials are intentionally excluded from source control. |
| 2026-08-19 | Phase 0 | Captured the foundation state; added the reproducible multi-runtime toolchain, test layers, local stack, CI, helpers, environment isolation, and visible checkpoint. | Complete. All Phase 0 verification passed. Continued to Phase 1 schemas and deterministic primitives. |
| 2026-08-19 | Phase 1 | Implemented and independently tested versioned schemas, deterministic primitives, lifecycle, arena validation/reachability, AABB collision, movement, safe respawn, long-run invariants, and replay hashing. | Complete. Checkpoint and all gates passed. Continued to the local Phase 2 realtime runtime; remote preview evidence still requires provider access. |
| 2026-08-19 | Phase 2 | Implemented the local authoritative Worker/DO protocol, persistence and eviction recovery, command defenses, reconnecting client transport, browser latency journey, and continuous soak. | Local work passed. Phase is `[!]` at the mandatory remote preview latency gate; do not begin Phase 3 until preview architecture is measured or an ADR changes the gate. |
| 2026-08-19 | Phase 2 | Resumed after the user created and connected the Vercel project; began provider-scope verification, marketplace storage setup, Worker-first preview deployment, and remote gate execution. | In progress. Restart at provider verification before changing remote resources. |
| 2026-08-19 | Phase 2 | Provisioned Vercel Marketplace Upstash, authenticated/deployed Cloudflare preview Worker first, deployed Vercel preview, corrected live status routing, and passed remote health/latency gates. | Complete. Continued to Phase 3 secure device pairing. Preview remains protected by Vercel deployment protection. |
| 2026-08-19 | Phase 3 | Implemented credential/PIN/token primitives, atomic Redis device bindings and limits, guarded pairing/session APIs, provider secrets, and preview-only Worker token enforcement; deployed and verified unauthorized Dutch responses; disabled remote legacy state writes. | In progress. Restart with signed replacement/revocation, then pairing UI and full removal of generic `/api/state`; temporary preview `ADMIN_PIN` must be replaced in Vercel before physical pairing. |
| 2026-08-19 | Phase 3 | Resumed secure pairing implementation at signed live revocation, Dutch pairing/session UI, legacy state removal, and three-context takeover verification. | In progress. Restart at signed replacement notification to the Worker. |
| 2026-08-19 | Phase 3 | Completed signed revocation, persisted generation enforcement, local API adapter, Dutch pairing/returning-device UI, legacy state removal, redacted logs, and Chromium/WebKit three-context verification; deployed Worker-first and Vercel preview. | Complete. Continued to Phase 4 data-driven lobby and authoritative match start. Temporary preview `ADMIN_PIN` still must be replaced before physical pairing. |
| 2026-08-19 | Phase 4 | Added five neutral cosmetic definitions, six shared-geometry worlds, responsive accessible lobby controls, returning-device restoration, chooser/confirmation/readiness flow, and touch-enabled dual-client browser coverage. | Complete. Deployed Vercel preview and continued to Phase 5 movement rendering and controls. |
| 2026-08-19 | Phase 5 | Added deterministic bounded camera math, shared concurrent keyboard/pointer intent mapping, initial snapshot-driven Canvas arena rendering, geometric labeled fighters, and fixed movement/action controls. | In progress. `npm run check` and focused Chromium/WebKit lobby-to-play pass. Restart with HUD and prediction/interpolation; Canvas, touch, feedback, and viewport tasks remain unchecked until their full acceptance coverage passes. |
| 2026-08-19 | Phase 5 | Resumed the movement slice after the preview administrator PIN was rotated in Vercel; validated that the existing 4-12 character pairing input supports the provider setting without persisting it in source. | In progress. Implement prediction/interpolation as pure tested rules, then connect HUD and input feedback before browser verification. |
| 2026-08-19 | Phase 5 | Completed prediction/reconciliation, remote interpolation, Canvas/HUD, fixed multi-touch and keyboard controls, action feedback, viewport evidence, spawn protection presentation, same-role socket handoff safety, full browser gates, and Worker-first preview deployment. | Complete. Continue at Phase 6's first unchecked melee/combat rule; inspect `docs/checkpoints/phase-05.md` and `phase-05-movement.png`. |
| 2026-08-19 | Tooling and Phase 3 fix | Added single-player test mode (shared command reducer, deterministic training opponent, browser practice session, Dutch test panel, unit and dual-browser E2E coverage) and repaired replacement pairing after the user could not reconnect a previously linked device. | Complete and verified. `npm run check`, Chromium and WebKit E2E pass. Restart at Phase 6's first unchecked melee task. The corrected pairing must be deployed before the next physical pairing attempt. |
| 2026-08-19 | Phase 6 | Added schema v2 authoritative attack cooldowns; unarmed, sword, and weak-sword melee planning; directional block, cover, protection, simultaneous damage, finish integration, and confirmed persistence before damage broadcasts. | In progress. Focused and full unit/check gates pass. Restart with Worker adversarial melee tests and rendered hit/block events; do not deploy schema v2 until the Phase 6 compatible frontend/Worker slice is ready. |
| 2026-08-19 | Phase 6 and art | Completed combat: block damage reduction and slowdown, centre-based melee reach, sword charge/throw with retrieval and owner return, Nerf darts with ammo, two weapon slots with switching and drops, immediate finish and winner, pruned authoritative feedback events, adversarial Worker tests, a recorded duel fixture, and a dual-client duel journey. Landed the requested art and audio: Layer MCP sprites, icons, and six world backdrops through a tested local preparation pipeline, plus synthesised sound with independent mutes. | Complete and verified. `npm run check`, Chromium and WebKit E2E all pass. Restart at Phase 7's first unchecked task; inspect `docs/checkpoints/phase-06.md`. |
| 2026-08-20 | Phase 7 | Implemented announced chests, the seeded shuffle bag, Action claims with deterministic tie resolution, all six outcomes, armor/camouflage/speed effects with HUD and opponent-visible indicators, and the eligible-recovery counter. | Complete and verified. `npm run check`, 11 Chromium and 11 WebKit journeys pass. Restart at Phase 8's first unchecked task; inspect `docs/checkpoints/phase-07.md`. |
| 2026-08-20 | Deployment | Deployed the schema v4 Worker to preview and production, pushed the frontend, added a read-only production smoke suite, and audited the deployed environment. | Complete for everything that does not need production credentials. Production Vercel still needs its four environment variables before a device can be paired; the Worker side is already provisioned. |
| 2026-08-20 | Deployment | Provisioned Vercel production, gave production its own release room, and ran the paired production journey from two isolated contexts. | Complete. Production is playable end to end. The temporary release-check `ADMIN_PIN` must be replaced by the owner, and those release-check device credentials are replaced automatically when the physical iPads are paired. |
| 2026-08-20 | Phase 9 | Gave all six worlds their own validated geometry, added named lifts to the city with cooldown and safe arrival, added one-at-a-time Dutch hints that stop once a control is used, centralised and audited every Dutch label, added a pause cue, and ran automated accessibility and performance passes. | Complete and verified. `npm run check` (228 unit, 10 Node, 12 Worker) and 43 journeys in both engines pass; frame reports are in `docs/checkpoints/`. Restart at Phase 10's first unchecked task; inspect `docs/checkpoints/phase-09.md`. |
| 2026-08-20 | Phase 8 hardening | Fixed three defects the winner journey exposed: a finished match was reported to nobody when its last tick fell between two snapshots, a tap shorter than one tick was dropped, and a control release that missed its button stayed held forever. Added regression tests for all three. | Complete and verified. `npm run check` (173 unit, 10 Node, 12 Worker), both browser engines, and the disconnect soak pass; the previously intermittent winner journey passed three consecutive chain runs. Restart at Phase 9's first unchecked task. |
| 2026-08-20 | Phase 8 | Implemented the whole lifecycle: one Dutch overlay for every interruption, pause with requester and reason, input heartbeats with a symmetric connection freeze and offline escalation, reconnect reconciliation, winner overlay with rematch consent and exhaustive reset, divergence recovery, and a checkpoint drain that keeps credential generations. | Complete and verified. `npm run check`, both browser engines, and a disconnect soak pass. Restart at Phase 9's first unchecked task; inspect `docs/checkpoints/phase-08.md`. |
