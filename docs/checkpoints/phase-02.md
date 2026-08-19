# Phase 2 Checkpoint: Authoritative Realtime Runtime

Date: 2026-08-19

Status: complete; local and remote preview gates passed.

## Protocol

- WebSocket subprotocol: `game.v1`
- Message families: `hello`, `command`, `ack`, `snapshot`, `ping`, `pong`, `presence`, and structured `error`
- Snapshots carry schema version, protocol version, monotonic revision, authoritative tick, acknowledged per-role input sequence, and complete authoritative state.
- The client rejects stale revisions, estimates clock offset/RTT, records command latency, and reconnects with bounded exponential backoff.
- Every command is checked for shape, socket role, monotonic sequence, duplicate ID, current phase, 1 KiB payload, and 60-message/second socket limit.
- Visible protocol errors use simple Dutch messages.

## Runtime

- One Durable Object is addressed as `<environment>:main`; Wrangler environment names isolate development, preview, and production namespaces.
- Active countdown/play runs at 30 fixed ticks per second and emits scheduled snapshots every 2 ticks (15 Hz).
- Full checkpoints are written every 6 active ticks (5 Hz) and on lifecycle changes.
- Durable Object eviction restores the persisted selected world in the Workers-runtime integration test.
- Restart of an active match enters reconnecting state before normal both-ready recovery.
- The development-only `POST /debug/reset` clears the single local room so browser tests never inherit persisted state. It is unavailable in preview and production.

## Local Latency And Traffic

Twenty alternating authoritative input samples, measured from Luca command send to Senna snapshot receipt:

| Browser | Median | p95 | Combined bytes during journey | Converged |
| --- | ---: | ---: | ---: | --- |
| Chromium | 75.2 ms | 92.6 ms | 201,951 | Yes |
| WebKit | 61 ms | 77 ms | 201,991 | Yes |

Both are below the local 200 ms median and 350 ms p95 budgets. This does not replace the mandatory external-network preview measurement.

## Soak

`npm run test:soak` passed a continuous headless Chromium run lasting 10.2 minutes:

```text
samples: 6400
median: 51 ms
p95: 55.9 ms
combined traffic: 92,078,943 bytes
final snapshot revisions converged: yes
```

The bots alternated deterministic movement commands below the rate limit while the Worker continued its 30 Hz simulation, 15 Hz snapshots, and 5 Hz durable checkpoints.

## Automated Verification

- `npm run test:integration:worker`: 5 tests passed for health/version negotiation, protocol mismatch, invalid role, two sockets, lifecycle persistence, Durable Object eviction/restore, malformed data, forged roles, duplicate/stale commands, and flood limits.
- `npm run test:e2e`: Chromium passed landing, shared-room socket, and complete lobby-to-authoritative-movement latency journeys.
- `npm run test:e2e:webkit`: WebKit passed the same three journeys.
- `npm run check`: formatting, typed lint, unit, Node integration, Workers-runtime integration, all runtime type checks, and production build pass.

## Remote Preview Gate

- Vercel preview: `https://senna-luca-stijders-ijfjpalj5-neworange-ruud.vercel.app`
- Cloudflare preview Worker: `https://senna-luca-strijders-preview.senna-luca-strijders.workers.dev`
- Worker version: `aa31353d-fd12-4424-ae08-c124a52f2cc6`
- Vercel deployment: `dpl_2jK5EMtUN4eqc2JX1S7niRbWTRrZ`
- Upstash Marketplace resource: `senna-luca-strijders-state`, `fra1`, pay-as-you-go, eviction enabled, automatic upgrades disabled

The external Worker run passed for 5.1 continuous minutes with 4,500 commands:

```text
median: 46 ms
p95: 62.9 ms
combined traffic: 65,106,748 bytes
final snapshot revisions converged: yes
```

Vercel `/api/health`, Redis-backed `/api/state`, and Worker `/health` all returned 200 with preview isolation and matching version information. The measured median and p95 are comfortably below the required 200/350 ms gate.
