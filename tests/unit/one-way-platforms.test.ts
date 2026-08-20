import { describe, expect, it } from "vitest";

import { moveWithCollisions } from "../../src/game/arena";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { MOVEMENT } from "../../src/game/config";
import { createInitialGameState } from "../../src/game/state-machine";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../../src/game/simulation";
import { EMPTY_INPUT } from "../../src/game/types";
import type { ArenaSurface, GameState } from "../../src/game/types";

/** A floor, a one-way platform above it, and a piece of solid cover. */
const SURFACES: readonly ArenaSurface[] = [
  { id: "floor", kind: "floor", x: 0, y: 400, width: 1_000, height: 100 },
  { id: "ledge", kind: "platform", x: 200, y: 300, width: 300, height: 26 },
  { id: "hut", kind: "cover", x: 700, y: 300, width: 100, height: 100 },
];

const BOX = { width: MOVEMENT.playerWidth, height: MOVEMENT.playerHeight };

/** A box standing with its feet on the given height. */
function standing(x: number, feet: number) {
  return { x, y: feet - BOX.height, ...BOX };
}

function playing(): GameState {
  const state = createInitialGameState(123);
  state.match.phase = "playing";
  state.match.players.luca.connected = true;
  state.match.players.senna.connected = true;
  initializeArena(state, BEACH_ARENA);
  return state;
}

describe("platforms are one-way", () => {
  it("lets a rising box pass straight through a platform", () => {
    // Feet just under the platform, moving up fast.
    const result = moveWithCollisions(
      standing(300, 330),
      { x: 0, y: -40 },
      SURFACES,
    );
    expect(result.rectangle.y).toBe(330 - BOX.height - 40);
    expect(result.hitCeiling).toBe(false);
    expect(result.grounded).toBe(false);
  });

  it("catches the same box on the way back down", () => {
    // Feet above the platform, falling onto it.
    const result = moveWithCollisions(
      standing(300, 290),
      { x: 0, y: 40 },
      SURFACES,
    );
    expect(result.rectangle.y + BOX.height).toBe(300);
    expect(result.grounded).toBe(true);
  });

  it("keeps a box standing on a platform standing on it", () => {
    let box = standing(300, 300);
    for (let tick = 0; tick < 30; tick += 1) {
      const result = moveWithCollisions(box, { x: 0, y: 12 }, SURFACES);
      expect(result.grounded).toBe(true);
      box = { ...result.rectangle, ...BOX };
      expect(box.y + BOX.height).toBe(300);
    }
  });

  it("never blocks a box sideways", () => {
    // Level with the middle of the platform, walking into its edge.
    const result = moveWithCollisions(
      { x: 120, y: 290, ...BOX },
      { x: 90, y: 0 },
      SURFACES,
    );
    expect(result.rectangle.x).toBe(210);
    expect(result.hitRight).toBe(false);
    expect(result.hitLeft).toBe(false);
  });

  it("keeps the floor and the cover solid from every side", () => {
    // The floor still stops a fall.
    const landing = moveWithCollisions(
      standing(100, 380),
      { x: 0, y: 40 },
      SURFACES,
    );
    expect(landing.rectangle.y + BOX.height).toBe(400);

    // The floor is still a ceiling from below.
    const underneath = moveWithCollisions(
      { x: 100, y: 500, ...BOX },
      { x: 0, y: -40 },
      SURFACES,
    );
    expect(underneath.rectangle.y).toBe(500);
    expect(underneath.hitCeiling).toBe(true);

    // Cover is still a wall, and still a ceiling.
    const wall = moveWithCollisions(
      standing(600, 400),
      { x: 60, y: 0 },
      SURFACES,
    );
    expect(wall.rectangle.x).toBe(700 - BOX.width);
    expect(wall.hitRight).toBe(true);
    const head = moveWithCollisions(
      { x: 720, y: 410, ...BOX },
      { x: 0, y: -30 },
      SURFACES,
    );
    expect(head.hitCeiling).toBe(true);
  });

  it("jumps on a tap that starts and ends between two ticks", () => {
    const state = playing();
    const luca = state.match.players.luca;
    // Pressed and released before the next tick runs, as a fast tap does.
    setInputIntent(state, "luca", { ...EMPTY_INPUT, jump: true });
    setInputIntent(state, "luca", { ...EMPTY_INPUT });
    simulateMovementTick(state, BEACH_ARENA);
    expect(luca.velocity.y).toBeLessThan(0);
    expect(luca.grounded).toBe(false);
    // The memory is used once and cannot become a second jump.
    expect(luca.jumpQueued).toBe(false);
  });

  it("lets a child jump from the sand onto the platform above", () => {
    const state = playing();
    const luca = state.match.players.luca;
    // Under the western beach platform, whose top is 130 above the floor.
    luca.position = { x: 700, y: 1_200 - luca.size.height };
    luca.velocity = { x: 0, y: 0 };
    luca.grounded = true;
    setInputIntent(state, "luca", { ...EMPTY_INPUT, jump: true });

    let passedThrough = false;
    for (let tick = 0; tick < 60; tick += 1) {
      simulateMovementTick(state, BEACH_ARENA);
      const feet = luca.position.y + luca.size.height;
      if (feet < 1_070) passedThrough = true;
      // Jump is a press, not a hold: it is released after the first tick.
      setInputIntent(state, "luca", { ...EMPTY_INPUT });
      if (passedThrough && luca.grounded) break;
    }
    expect(passedThrough).toBe(true);
    expect(luca.grounded).toBe(true);
    // Standing on the platform, not back down on the sand.
    expect(luca.position.y + luca.size.height).toBe(1_070);
  });
});
