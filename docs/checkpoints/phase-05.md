# Phase 05 Checkpoint: Playable Movement

Date: 2026-08-19

## Observable Build

- Protected Vercel preview: `https://senna-luca-stijders-n6oxr9fjd-neworange-ruud.vercel.app`
- Vercel deployment: `dpl_5Tcm1ELrr4oM77RfsBX4Sq4vhLFi`
- Preview Worker: `https://senna-luca-strijders-preview.senna-luca-strijders.workers.dev`
- Worker version: `55faf4ba-494c-489c-a9f0-dfbbb255669b`
- Screenshot: [`phase-05-movement.png`](./phase-05-movement.png)

The preview remains deployment-protected. Its administrator PIN was rotated in Vercel and is not recorded in source or this checkpoint.

## Implemented

- Snapshot-driven Canvas arena with geometric labeled fighters, floor, platforms, solid cover, bounded soft-follow camera, hearts, opponent direction/distance, spawn protection, latency, and reconciliation metrics.
- Shared keyboard/pointer intent mapper with concurrent contacts and immediate pressed feedback for movement, jump, attack, block, Action, and switch.
- Immediate ready and pause request feedback while outcomes remain authoritative.
- Local movement prediction through the shared collision rules, acknowledged-input reconciliation, and remote interpolation.
- Full-screen landscape play layout with fixed safe-area-aware controls and portrait orientation guidance.
- Same-role WebSocket handoff protection so a closing replaced socket cannot disconnect the active replacement.
- Non-overlapping self-scheduling authoritative simulation callbacks.

## Verification

- `npm run check`: passed with 46 unit tests, 8 Node integration tests, 7 Worker integration tests, lint, formatting, all TypeScript configurations, and production build.
- `npm run test:e2e`: 6/6 Chromium journeys passed.
- `npm run test:e2e:webkit`: 6/6 WebKit journeys passed.
- Chromium raw movement latency: 20 samples, 74 ms median, 184.1 ms p95, converged.
- WebKit raw movement latency: 10 samples, 61 ms median, 91 ms p95, converged.
- The dual-player movement journey proves both roles reduce authoritative distance simultaneously and injects independent pointer IDs for move plus jump, attack, block, Action, and switch.
- Reduced-motion screenshot/fit checks passed at 1024x768, 1180x820, and 1366x1024.
- Worker health after deployment returned preview environment, protocol v1, and schema v1.

## Remaining Physical Gate

Exact target iPad models and physical multi-touch/frame-rate measurements remain Phase 10 acceptance work.
