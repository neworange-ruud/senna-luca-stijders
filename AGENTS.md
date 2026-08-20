# Project Agent Instructions

## Source Of Truth

- Read `docs/PRD.md` for product requirements and `docs/PLAN.md` for implementation state before making implementation changes.
- Treat `docs/PLAN.md` as the durable handoff between sessions. Chat history is not a substitute for updating it.
- Follow the architecture and locked defaults in the plan. Record a justified entry in its Decision Log before making a material change.

## Required Progress Tracking

- Before substantial implementation, update the plan's Last updated, Current phase, Next action, and Session Log. Exactly one phase may be `[~]` while work is active.
- Work in the plan's logical order unless a dependency requires otherwise. Keep the first unchecked task safe for another session to resume.
- Update task checkboxes, blockers, Verification Evidence, and the current Session Log row as work happens, not only at the end of a large milestone.
- Mark work `[x]` only after its listed verification passes. If a test cannot run, leave the work incomplete and record why.
- End every implementation session with `docs/PLAN.md` accurately describing the repository state and next action.
- Create the phase checkpoint described in the plan and tell the user where to inspect it. Checkpoints provide visibility and do not pause autonomous work unless user input is genuinely required.

## Implementation And Testing

- Implement gameplay as small, independently testable rules in the pure `src/game` layer.
- Add or update unit tests with every gameplay behavior. Run focused tests immediately, the full unit suite after each behavior, and `npm run check` at every phase boundary.
- Run the dual-player Playwright suite in headless Chromium and WebKit for final acceptance. Keep traces/screenshots for failures.
- Never let browser code authoritatively assign damage, items, chest claims, match results, or another player's state.
- Keep visible game text and errors in simple Dutch. Code, tests, and technical documentation may be English.
- Synthesise sound effects and music in the browser with the Web Audio API. The Layer workspace has no enabled audio model, so audio cannot be generated there; check again before assuming that changed.
- Generated art and audio are in scope since the 2026-08-19 request. Keep every asset inside the existing bounding-box contract, keep the geometric fallback working when an asset is missing, and never block gameplay on art.
- Generate game sprites and images through the Layer MCP. Before every generation, estimate the Creative Unit cost and use the cheapest enabled model that supports the required modality, capabilities, and output size. Use a single output and the smallest suitable size for tests; use a more expensive model only when no cheaper compatible model can satisfy the requirement or the user explicitly requests it. Commit raw generations to `assets/source/` and derive runtime files with `npm run assets`.
- Every world lives in its own file under `src/game/arenas/` and is registered in `src/game/content.ts`. A new world has to pass `validateArena` and the reachability and clearance checks in `tests/unit/worlds.test.ts` before it ships.
- Every Dutch word the children read belongs in `src/game/dutch.ts` or `src/game/content.ts`. `tests/unit/dutch.test.ts` walks those maps against the types they describe, so a new rule with an English label fails the suite rather than reaching a child.
- A control that can be tapped must survive a tap shorter than one 33 ms tick. Latch the press in `setInputIntent` and consume it in the tick, the way `attackQueued` and `actionQueued` do; reading only the current control state loses fast taps.
- Publish a phase change the moment it happens rather than waiting for the snapshot cadence. The tick that ends a match is the last tick the room simulates, so a skipped snapshot there is never sent at all.
- Do not weaken security, reconnect safety, pause behavior, test coverage, or a PRD acceptance criterion to make a checkpoint pass.
