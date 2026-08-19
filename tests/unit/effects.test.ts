import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { simulateCombat } from "../../src/game/combat";
import { EFFECTS, MOVEMENT, TICK_SECONDS } from "../../src/game/config";
import {
  absorbWithArmor,
  advanceEffects,
  applyEffect,
  hasEffect,
  speedMultiplier,
} from "../../src/game/effects";
import { movePlayer } from "../../src/game/movement";
import { simulateMovementTick } from "../../src/game/simulation";
import {
  createInitialGameState,
  pauseMatch,
} from "../../src/game/state-machine";
import { EMPTY_INPUT, type GameState } from "../../src/game/types";

function playing(): GameState {
  const state = createInitialGameState();
  state.match.phase = "playing";
  const { luca, senna } = state.match.players;
  luca.position = { x: 300, y: 1_104 };
  senna.position = { x: 390, y: 1_104 };
  luca.facing = "right";
  senna.facing = "left";
  for (const player of Object.values(state.match.players)) {
    player.connected = true;
  }
  return state;
}

describe("armor", () => {
  it("absorbs exactly three damage points and then disappears", () => {
    const state = playing();
    const senna = state.match.players.senna;
    applyEffect(senna, "armor");
    expect(absorbWithArmor(senna, 2)).toBe(0);
    expect(absorbWithArmor(senna, 2)).toBe(1);
    expect(hasEffect(senna, "armor")).toBe(false);
    expect(absorbWithArmor(senna, 2)).toBe(2);
  });

  it("keeps hearts safe while it lasts without changing what a weapon is worth", () => {
    const state = playing();
    applyEffect(state.match.players.senna, "armor");
    state.match.players.luca.input = { ...EMPTY_INPUT, attack: true };
    const events = simulateCombat(state, BEACH_ARENA, 10);
    expect(events).toMatchObject([{ item: "unarmed", damage: 0 }]);
    expect(state.match.players.senna.health).toBe(10);
    expect(state.match.players.senna.effects[0]?.capacity).toBe(
      EFFECTS.armorCapacity - 1,
    );
  });

  it("is spent after a block, so a block plus armor stops a whole sword", () => {
    const state = playing();
    const senna = state.match.players.senna;
    applyEffect(senna, "armor");
    senna.input = { ...EMPTY_INPUT, block: true };
    state.match.players.luca.inventory = [
      { id: "sword-1", itemId: "sword", owner: "luca", ammo: null },
    ];
    state.match.players.luca.selectedSlot = 0;
    state.match.players.luca.input = { ...EMPTY_INPUT, attack: true };
    expect(simulateCombat(state, BEACH_ARENA, 10)).toMatchObject([
      { outcome: "blocked", damage: 0 },
    ]);
    // The block took one heart of the two, and armor absorbed the last one.
    expect(senna.effects[0]?.capacity).toBe(EFFECTS.armorCapacity - 1);
  });
});

describe("timed effects", () => {
  it("runs speed for eight active seconds and then reports the end", () => {
    const state = playing();
    const luca = state.match.players.luca;
    applyEffect(luca, "speed");
    expect(speedMultiplier(luca)).toBe(EFFECTS.speedFactor);
    for (let tick = 1; tick < EFFECTS.speedTicks; tick += 1) {
      expect(advanceEffects(luca, tick)).toEqual([]);
    }
    expect(advanceEffects(luca, EFFECTS.speedTicks)).toMatchObject([
      { kind: "effect-ended", role: "luca", chestOutcome: "speed" },
    ]);
    expect(luca.effects).toEqual([]);
    expect(speedMultiplier(luca)).toBe(1);
  });

  it("makes the player a quarter faster while it lasts", () => {
    const state = playing();
    const luca = state.match.players.luca;
    const intent = { ...EMPTY_INPUT, horizontal: 1 as const };
    const plain = { x: luca.position.x, y: luca.position.y };
    for (let tick = 1; tick <= 30; tick += 1) {
      movePlayer(luca, intent, BEACH_ARENA, { x: 3_000, y: 0 }, tick);
    }
    const plainDistance = luca.position.x - plain.x;

    const fast = state.match.players.senna;
    fast.facing = "right";
    applyEffect(fast, "speed");
    const start = fast.position.x;
    for (let tick = 1; tick <= 30; tick += 1) {
      movePlayer(fast, intent, BEACH_ARENA, { x: 3_000, y: 0 }, tick);
    }
    expect(fast.position.x - start).toBeGreaterThan(plainDistance);
    expect(fast.velocity.x).toBeCloseTo(
      MOVEMENT.runSpeed * EFFECTS.speedFactor,
      5,
    );
    expect(TICK_SECONDS).toBeGreaterThan(0);
  });

  it("replaces a second helping instead of stacking it", () => {
    const state = playing();
    const luca = state.match.players.luca;
    applyEffect(luca, "camouflage");
    advanceEffects(luca, 1);
    applyEffect(luca, "camouflage");
    expect(luca.effects).toHaveLength(1);
    expect(luca.effects[0]?.remainingTicks).toBe(EFFECTS.camouflageTicks);
  });

  it("freezes every timer while the match is paused", () => {
    const state = playing();
    applyEffect(state.match.players.luca, "camouflage");
    simulateMovementTick(state, BEACH_ARENA);
    const remaining = state.match.players.luca.effects[0]!.remainingTicks;
    pauseMatch(state, "luca");
    for (let index = 0; index < 100; index += 1) {
      simulateMovementTick(state, BEACH_ARENA);
    }
    expect(state.match.players.luca.effects[0]!.remainingTicks).toBe(remaining);
  });
});
