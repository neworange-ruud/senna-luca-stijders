import { describe, expect, it } from "vitest";

import {
  frameIndexFor,
  frameRectangle,
  PLAYER_FRAMES,
  stepDurationMs,
} from "../../src/client/sprite-animation";
import { MOVEMENT } from "../../src/game/config";
import { EMPTY_INPUT } from "../../src/game/types";

const IDLE = PLAYER_FRAMES.indexOf("idle");
const WALK_A = PLAYER_FRAMES.indexOf("walk-a");
const WALK_B = PLAYER_FRAMES.indexOf("walk-b");
const JUMP = PLAYER_FRAMES.indexOf("jump");

function player(
  partial: {
    horizontal?: number;
    grounded?: boolean;
    block?: boolean;
  } = {},
) {
  return {
    velocity: { x: partial.horizontal ?? 0, y: 0 },
    grounded: partial.grounded ?? true,
    input: { ...EMPTY_INPUT, block: partial.block ?? false },
  };
}

describe("player animation", () => {
  it("stands still when standing still", () => {
    expect(frameIndexFor(player(), 0)).toBe(IDLE);
    expect(frameIndexFor(player(), 5_000)).toBe(IDLE);
  });

  it("jumps whenever both feet are off the ground", () => {
    expect(frameIndexFor(player({ grounded: false }), 0)).toBe(JUMP);
    expect(
      frameIndexFor(player({ grounded: false, horizontal: 300 }), 1_234),
    ).toBe(JUMP);
  });

  it("walks in a step, pass, other step, pass cycle", () => {
    const step = stepDurationMs(MOVEMENT.runSpeed);
    const walking = player({ horizontal: MOVEMENT.runSpeed });
    const frames = [0, 1, 2, 3, 4].map((index) =>
      frameIndexFor(walking, index * step),
    );
    expect(frames).toEqual([WALK_A, IDLE, WALK_B, IDLE, WALK_A]);
  });

  it("walks in both directions the same way", () => {
    const step = stepDurationMs(MOVEMENT.runSpeed);
    expect(
      frameIndexFor(player({ horizontal: -MOVEMENT.runSpeed }), step),
    ).toBe(frameIndexFor(player({ horizontal: MOVEMENT.runSpeed }), step));
  });

  it("takes quicker steps the faster a player runs", () => {
    const walking = stepDurationMs(MOVEMENT.runSpeed);
    const sprinting = stepDurationMs(MOVEMENT.runSpeed * 1.25);
    expect(sprinting).toBeLessThan(walking);
    // Never so quick or so slow that it stops reading as walking.
    expect(stepDurationMs(4_000)).toBeGreaterThanOrEqual(90);
    expect(stepDurationMs(1)).toBeLessThanOrEqual(220);
    expect(stepDurationMs(0)).toBeLessThanOrEqual(220);
  });

  it("does not walk on the spot while sliding to a stop", () => {
    expect(frameIndexFor(player({ horizontal: 12 }), 0)).toBe(IDLE);
  });

  it("plants the feet while blocking", () => {
    expect(
      frameIndexFor(player({ horizontal: MOVEMENT.runSpeed, block: true }), 0),
    ).toBe(IDLE);
  });

  it("cuts the sheet into equal frames", () => {
    const sheet = { width: 800, height: 320 };
    expect(frameRectangle(sheet, 0)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 320,
    });
    expect(frameRectangle(sheet, 3).x).toBe(600);
    // An index that cannot exist still returns a real frame.
    expect(frameRectangle(sheet, 99).x).toBe(600);
    expect(frameRectangle(sheet, -1).x).toBe(0);
  });
});
