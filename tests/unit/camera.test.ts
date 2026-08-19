import { describe, expect, it } from "vitest";
import { cameraTarget, followCamera } from "../../src/game/camera";

const bounds = { x: 0, y: 0, width: 3_200, height: 1_400 };

describe("camera math", () => {
  it("centers the local player and clamps every arena edge", () => {
    expect(
      cameraTarget(
        { x: 1_568, y: 652, width: 64, height: 96 },
        { width: 1_180, height: 820 },
        bounds,
      ),
    ).toEqual({ x: 1_010, y: 290, width: 1_180, height: 820 });
    expect(
      cameraTarget(
        { x: 0, y: 0, width: 64, height: 96 },
        { width: 1_180, height: 820 },
        bounds,
      ),
    ).toMatchObject({ x: 0, y: 0 });
    expect(
      cameraTarget(
        { x: 3_136, y: 1_304, width: 64, height: 96 },
        { width: 1_180, height: 820 },
        bounds,
      ),
    ).toMatchObject({ x: 2_020, y: 580 });
  });

  it("soft-follows predictably and validates smoothing", () => {
    const current = { x: 0, y: 0, width: 1_000, height: 700 };
    const target = { x: 100, y: 50, width: 1_000, height: 700 };
    expect(followCamera(current, target, 0.2)).toEqual({
      x: 20,
      y: 10,
      width: 1_000,
      height: 700,
    });
    expect(() => followCamera(current, target, 2)).toThrow(RangeError);
  });
});
