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
- Use dummy geometric sprites and generated placeholder assets until final graphics are explicitly requested. Do not block gameplay on art.
- Do not weaken security, reconnect safety, pause behavior, test coverage, or a PRD acceptance criterion to make a checkpoint pass.
