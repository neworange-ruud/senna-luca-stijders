import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { MOVEMENT, RESPAWN_PROTECTION_TICKS } from "../../src/game/config";
import { chooseSafestSpawn, movePlayer } from "../../src/game/movement";
import { createInitialGameState } from "../../src/game/state-machine";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";

function playingState() {
  const state = createInitialGameState(123);
  state.match.phase = "playing";
  state.match.players.luca.connected = true;
  state.match.players.senna.connected = true;
  initializeArena(state, BEACH_ARENA);
  return state;
}

describe("fixed-tick movement", () => {
  it("accelerates to configured run speed without exceeding it", () => {
    const state = playingState();
    setInputIntent(state, "luca", { ...EMPTY_INPUT, horizontal: 1 });
    for (let tick = 0; tick < 90; tick += 1)
      simulateMovementTick(state, BEACH_ARENA);
    expect(state.match.players.luca.velocity.x).toBe(MOVEMENT.runSpeed);
    expect(state.match.players.luca.position.x).toBeGreaterThan(320);
  });

  it("jumps once in the air and lands back on a surface", () => {
    const state = playingState();
    const luca = state.match.players.luca;
    setInputIntent(state, "luca", { ...EMPTY_INPUT, jump: true });
    simulateMovementTick(state, BEACH_ARENA);
    const firstVelocity = luca.velocity.y;
    expect(firstVelocity).toBeLessThan(0);
    simulateMovementTick(state, BEACH_ARENA);
    expect(luca.velocity.y).toBeGreaterThan(firstVelocity);

    setInputIntent(state, "luca", EMPTY_INPUT);
    for (let tick = 0; tick < 90 && !luca.grounded; tick += 1) {
      simulateMovementTick(state, BEACH_ARENA);
    }
    expect(luca.grounded).toBe(true);
    expect(luca.position.y + luca.size.height).toBe(1_200);
  });

  it("uses weaker steering while airborne", () => {
    const state = playingState();
    const luca = state.match.players.luca;
    luca.grounded = false;
    luca.position.y -= 200;
    movePlayer(
      luca,
      { ...EMPTY_INPUT, horizontal: 1 },
      BEACH_ARENA,
      state.match.players.senna.position,
      1,
    );
    expect(luca.velocity.x).toBeCloseTo(MOVEMENT.airAcceleration / 30);
  });

  it("clamps movement at arena boundaries and solid cover", () => {
    const state = playingState();
    const luca = state.match.players.luca;
    luca.position.x = -10;
    movePlayer(
      luca,
      EMPTY_INPUT,
      BEACH_ARENA,
      state.match.players.senna.position,
      1,
    );
    expect(luca.position.x).toBe(BEACH_ARENA.bounds.x);

    luca.position = { x: 1_430, y: 1_104 };
    luca.grounded = true;
    luca.velocity.x = MOVEMENT.runSpeed;
    movePlayer(
      luca,
      { ...EMPTY_INPUT, horizontal: 1 },
      BEACH_ARENA,
      state.match.players.senna.position,
      2,
    );
    expect(luca.position.x + luca.size.width).toBeLessThanOrEqual(1_500);
  });
});

describe("safe respawn", () => {
  it("chooses the configured spawn farthest from the opponent", () => {
    expect(
      chooseSafestSpawn(BEACH_ARENA, "luca", { x: 200, y: 1_000 }).id,
    ).toBe("luca-east");
  });

  it("returns out-of-bounds players without damage and grants 45 protected ticks", () => {
    const state = playingState();
    const luca = state.match.players.luca;
    luca.health = 7;
    luca.position.y = BEACH_ARENA.fallBoundaryY + 1;
    const result = simulateMovementTick(state, BEACH_ARENA);
    expect(result.movement.luca).toEqual({
      respawned: true,
      spawnId: "luca-west",
    });
    expect(luca.health).toBe(7);
    expect(luca.invulnerableUntilTick).toBe(
      state.match.tick + RESPAWN_PROTECTION_TICKS,
    );
    expect(Number.isFinite(luca.position.x)).toBe(true);
  });

  it("does not advance movement or active tick while paused", () => {
    const state = playingState();
    state.match.phase = "paused";
    const before = structuredClone(state.match.players);
    expect(simulateMovementTick(state, BEACH_ARENA)).toMatchObject({
      advanced: false,
      tick: 0,
    });
    expect(state.match.players).toEqual(before);
  });
});
