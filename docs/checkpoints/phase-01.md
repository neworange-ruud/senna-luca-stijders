# Phase 1 Checkpoint: Deterministic Game Core

Date: 2026-08-19

## Result

The pure `src/game` layer now owns versioned command/state types, fixed integer ticks, seeded randomness, command idempotency, stable entity IDs, lifecycle transitions, validated arena geometry, deterministic AABB collision, movement, jumping, and safe no-damage respawn. It has no DOM, Canvas, WebSocket, Redis, Vercel, or Cloudflare imports.

## Deterministic Replay

Command:

```sh
npm run simulation:replay
```

Fixture: `tests/fixtures/phase-01-replay.json`

```text
Replay A: e868d444f2c2f4d133409158a521f6d0eb6c8ffc008cb28ea99846ae77082656
Replay B: e868d444f2c2f4d133409158a521f6d0eb6c8ffc008cb28ea99846ae77082656
Identical: yes
```

The fixture runs 360 fixed ticks with recorded Luca and Senna movement/jump changes. Both runs initialize independently and hash the complete versioned authoritative snapshot.

## Rules Proven

- Both roles must connect before world selection.
- Luca chooses the first world; only the other role can confirm it.
- Both players require cosmetics and ready state before the exact 90-tick countdown.
- Pause and disconnect clear held input; resume uses both-ready plus the same countdown.
- Finish stops input and mutual rematch removes old entities, inventory, effects, command IDs, and ready state.
- Beach geometry is bounded, its spawn/chest anchors are valid, and every chest surface is reachable through the movement graph.
- Axis-separated AABB collision handles floors, platforms, solid cover, and arena boundaries.
- Movement reaches 360 units/second, uses a 760 units/second jump impulse, 1900 units/second squared gravity, and weaker air steering.
- Falling below the arena boundary keeps health unchanged, picks the farthest configured spawn, and grants 45 ticks (1.5 seconds) of protection.
- Paused simulation advances neither active tick nor movement.

## Verification

- Focused tests were run after each schema, deterministic primitive, lifecycle, arena/collision, movement, and invariant behavior.
- `npm run test:unit`: 7 files and 31 tests passed.
- The long invariant test completed 10,000 seeded ticks with finite positions/velocities and health bounded from 0 through 10.
- `npm run test:unit:coverage`: 90.74% statements, 86.22% branches, 95.08% functions, and 93.11% lines across `src/game`.
- `npm run check`: formatting, typed lint, 31 unit tests, 5 integration tests, all runtime type checks, and production build passed.
