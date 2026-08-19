# Phase 06 Checkpoint: Combat, Hearts, And Weapons

Date: 2026-08-19

## Observable Build

- Local: `npm run dev`, then open `http://localhost:3000/?test=1` and pick a weapon in the test panel.
- Dual-client duel journey: `npx playwright test tests/e2e/duel.spec.ts`
- Screenshots:
  - [`phase-06-duel.png`](./phase-06-duel.png) two paired clients after a sword, block, throw, and dart exchange
  - [`phase-06-weapons.png`](./phase-06-weapons.png) blaster with ammo count, thrown sword lying in the arena
  - [`phase-06-testmode.png`](./phase-06-testmode.png) single-player test mode
  - [`phase-06-lobby.png`](./phase-06-lobby.png) lobby with generated cosmetic and world artwork

## Implemented

- Unarmed, sword, and weak-sword melee with configured range, damage, and 700/650/500 ms cooldowns. A swing happens on the tick the control is pressed; holding it does not swing again.
- The melee area runs from the attacker's own centre to `range` beyond their body, so an opponent who has walked through them is still reachable.
- Blocking removes one heart of frontal damage, so unarmed attacks and darts stop completely while a normal sword still gets one heart through. Rear attacks ignore the block. Respawn protection stops everything. Blocking also slows movement by 40 percent.
- Sword charge and throw: holding attack for 500 ms and releasing throws the held sword as a projectile that damages, then stays in the arena as a recoverable item, is picked up with Action, or returns to its owner after eight active seconds.
- Nerf blaster with six visible darts, a 450 ms cadence, cover collision, and an empty state that stays selectable until replaced.
- Two weapon slots plus always-available fists, an edge-triggered switch control, replacement of the held weapon with a recoverable drop, and a HUD weapon/ammo label.
- Hearts, immediate match stop at zero, winner state, and a drawn result when both players reach zero on the same tick.
- Every outcome is published as a pruned authoritative `MatchEvent`, which the browser turns into hit, block, "Geblokt!", pickup, and sound feedback. The browser predicts only its own movement and never health, weapons, or protection.
- Persisted state moved to schema v3 for combat cooldowns, inventory selection, arena entities, and feedback events. A tick containing damage, a throw, a shot, a pickup, or a drop is committed before it is broadcast.

## Reproducible Duel Fixture

```sh
npm run simulation:replay tests/fixtures/phase-06-duel.json
```

- Fixture: [`tests/fixtures/phase-06-duel.json`](../../tests/fixtures/phase-06-duel.json)
- Final snapshot hash (twice, identical): `42c270739276ea38429efc1b64dfe9d3db0b4fc00d7379e0dc25eb57cca19c31`
- Final state: `tick=200, phase=playing, luca=8 hearts/1 weapons, senna=4 hearts/1 weapons, entities=0, events=12`
- Event sequence: dart hit, sword hit for 2, two blocked sword hits for 1 each, charged throw, thrown-sword hit, Action pickup, sword hit, dart hit, unarmed miss out of range.
- `tests/unit/duel-replay.test.ts` asserts that exact sequence, so a balance change cannot pass unnoticed.
- The Phase 1 movement fixture still replays identically; its hash changed to `46af75dbf19b752eeef6e0d37deb3ac8f21afe9c844428431cb308af3b9e58e2` because schema v3 adds fields to the snapshot it hashes.

## Verification

- `npm run check`: passed with 126 unit tests, 10 Node integration tests, 8 Worker integration tests, formatting, typed lint, all three TypeScript runtimes, and the production build.
- `npm run test:e2e`: 10/10 Chromium journeys passed. `npm run test:e2e:webkit`: 10/10 WebKit journeys passed.
- Focused combat suites: `tests/unit/combat.test.ts` (21), `tests/unit/items.test.ts` (11), `tests/unit/duel-replay.test.ts` (4).
- Combat invariants over a 4,000-tick seeded brawl: every outcome id applied once, no self damage, no damage through cover or protection, health inside 0 to 10, at most two weapons, never negative ammo, the match finishes at zero hearts, and no damage lands afterwards.
- Adversarial Worker test: a client that forges the other role's input is rejected with `UNAUTHORIZED`, six press-and-release cycles inside one cooldown window still land exactly one hit, and the resulting heart loss is in the durable checkpoint.
- Dual-client duel journey in Chromium and WebKit: both devices agree on every heart change across an unblocked sword hit, a dart, a blocked sword hit, a charged throw, an Action pickup, and a weapon switch.
- Client prediction test proves the browser never predicts health, inventory, weapon selection, cooldown, or protection.

## Art And Audio In This Pass

- Generated with the Layer MCP through Ideogram V4 at 0.3 CU per image: two character sprites, a sixteen-icon sheet, and six world backdrops. Three generations were re-rolled and one was rejected by the provider's safety filter at no cost; the whole pass cost 4.485 CU across 15 accepted images.
- `assets/source/` holds the raw generations and `npm run assets` derives everything under `public/art/` (backdrop keying, trimming, slicing, scaling). The pipeline is dependency-free and unit tested.
- Sound effects and music are synthesised in the browser with the Web Audio API, because this Layer workspace has no enabled audio model. Effects and music have separate mute controls that survive a reload, and nothing is created before a real user gesture.
- Artwork is optional at runtime: every draw falls back to the geometric shape, and the collision boxes are unchanged.

## Remaining

Chests are the real source of weapons and land in Phase 7; until then the development-only `/debug/give-weapon` route (local development with `E2E_IN_MEMORY` only) arms the automated duel. Armor, camouflage, and speed effects, and their interaction with base damage, are Phase 7 work.
