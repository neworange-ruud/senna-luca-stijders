# Phase 07 Checkpoint: Chests, Effects, And Fairness

Date: 2026-08-20

## Observable Build

- Local: `npm run dev`, pair both devices, and wait eight seconds into a match for the first announced chest.
- Chest journey: `npx playwright test tests/e2e/chests.spec.ts`
- Screenshot: [`phase-07-chests.png`](./phase-07-chests.png) shows a landed chest, the Dutch "Kist! Pak op" label, and the armor, speed, and camouflage indicators in the HUD.

## Implemented

- Announced chest landings: the first announcement starts eight active seconds after play begins and later ones every twelve, each chest is claimable two seconds after its announcement, and at most two chests are ever out. A postponed announcement waits for a claim instead of being dropped.
- Chest points come from the arena definition, are never used twice at once, and are already validated as reachable from both players' spawns.
- A seeded shuffle bag holds exactly one of each of the six outcomes before refilling, and it draws from the persisted match random state so a restart continues the same sequence.
- Action-range claims resolved on the authoritative tick by reach, then distance, then an alternating exact-tie priority. A claimed chest is removed in the same tick, so exactly one reward event can ever come out of it and holding Action cannot claim twice.
- All six outcomes: sword, weak sword, and blaster go into the two weapon slots; armor, camouflage, and speed become effects. Every reward is revealed with its Dutch label plus an icon, and the reveal animation is skipped under reduced motion.
- Armor absorbs the next three damage points and is spent after blocking, so a weapon is always worth the same damage and only the payer changes. Camouflage and speed last eight active seconds; camouflage dims the opponent's drawing without hiding them, and speed adds a quarter to run speed.
- Effect timers only advance on simulated ticks, so a pause freezes them. A second helping of the same effect replaces the first instead of stacking. Both players see each other's active powers above their fighter, and the HUD shows each power's remaining time or capacity as an icon plus an accessible label.
- The eligible-recovery counter increments whenever a chest is scheduled while a player trails by at least three hearts and resets the moment the gap closes. The third consecutive eligible chest is replaced by a recovery chest that alternates armor and speed, lands on the free point nearest the trailing player, does not consume a base-bag entry, and stays claimable by either player.
- Persisted state moved to schema v4 for chests and the schedule. A claimed chest is committed before it is broadcast.

## Verification

- `npm run check`: passed with 157 unit tests, 10 Node integration tests, 10 Worker integration tests, formatting, typed lint, all three TypeScript runtimes, and the production build.
- `npm run test:e2e`: 11/11 Chromium journeys passed. `npm run test:e2e:webkit`: 11/11 WebKit journeys passed.
- Focused suites: `tests/unit/chests.test.ts` (20) covers schedule timing, the active limit, point selection, claim reach, the tie-break, one-reward-only, the bag cycle, the recovery rule, and rematch cleanup. `tests/unit/effects.test.ts` (7) covers armor capacity and ordering, timer expiry, the speed multiplier, replacement, and pause freezing.
- Distribution: 10,002 seeded draws produce exactly 1,667 of each outcome, because one-of-each-per-bag makes the distribution exact rather than merely close.
- Worker integration: two simultaneous claim packets leave exactly one reward, never both and never neither, and the reward is in the durable checkpoint. An announced chest and its schedule are committed before a restart could occur; the restore path itself stays covered by the lobby eviction test, because the harness cannot evict an object that is actively simulating.
- Browser journey: one match delivers all six outcomes to the player who opens each chest, asserting the weapon label for the three weapons and the accessible power label for the three effects, in Chromium and WebKit.

## Notes

- The Phase 6 duel fixture still replays identically twice; its hash is now `361b7f5ed5db72259214b0784fec99ce88ac3b1bb54e088a4ca8c670b0657730` because schema v4 adds chest fields to the snapshot that is hashed. Its asserted event sequence and final hearts are unchanged.
- The journey uses a development-only `/debug/spawn-chest` route (local development with `E2E_IN_MEMORY` only) to skip the twelve-second wait between chests. The landing, the claim, and the reward all run through the real authoritative rules; only the schedule is short-circuited, and the schedule itself is covered by unit tests.

## Deployed Verification

Worker before frontend, as the plan requires:

| Environment | Worker | Room | Health |
| --- | --- | --- | --- |
| Preview | `senna-luca-strijders-preview` version `e2cacbba-403c-48e4-be58-bc9189a36b90` | `gate-20260819` | protocol 1, schema 4 |
| Production | `senna-luca-strijders-production` version `537e1456-79d8-4fec-8b84-59748ea56dd2` | `release-20260820` | protocol 1, schema 4 |

- Vercel production deployment is Ready and aliased to `https://senna-luca-stijders.vercel.app`.
- `npm run test:production`: 5 read-only checks in Chromium and 5 in WebKit. Health, the Dutch unpaired refusal, the retired state surface, no secret in the browser bundle, artwork delivery, and a full test-mode match on the deployed build.
- `tests/production/paired.spec.ts`: two isolated contexts paired Luca and Senna against the production URL, reached one authoritative match, both moved and converged, remote latency stayed far inside the 350 ms p95 budget, and neither player took phantom damage. Evidence: [`phase-07-production.png`](./phase-07-production.png).
- Before provisioning, production rejected every pin including an empty one, so an unconfigured environment fails closed rather than open.
- Environment isolation is structural: each environment has its own Worker, its own Durable Object room id, its own signing and internal secrets, and Redis keys prefixed with the environment name, so a preview credential cannot address production state. The runtime proof of that isolation stays a Phase 10 gate.

After the journey the release-check `ADMIN_PIN` was rotated to a value nobody holds and production was redeployed, so the pin used during the check can no longer pair anything. Production therefore accepts no pin until the owner sets one:

```sh
vercel env add ADMIN_PIN production   # type the pin, it is never echoed
vercel redeploy <latest production deployment>
```

The release-check device credentials for Luca and Senna are still bound in production Redis; pairing each physical iPad replaces them, which is exactly the revocation path the plan describes.

## Remaining

Pause and reconnect behaviour around chests, the winner overlay, and rematch consent are Phase 8. Distinct geometry per world and teleports are Phase 9.
