import { describe, expect, it } from "vitest";
import {
  intersects,
  moveWithCollisions,
  reachableSurfaceIds,
  validateArena,
} from "../../src/game/arena";
import { BEACH_ARENA } from "../../src/game/arenas/beach";

describe("arena validation", () => {
  it("accepts the complete beach geometry and reaches every chest surface", () => {
    expect(validateArena(BEACH_ARENA)).toEqual([]);
    const reachable = reachableSurfaceIds(BEACH_ARENA);
    expect(
      BEACH_ARENA.chestPoints.every((point) => reachable.has(point.surfaceId)),
    ).toBe(true);
  });

  it("rejects invalid bounds, duplicate surfaces, and unreachable chest points", () => {
    const invalid = {
      ...BEACH_ARENA,
      surfaces: [
        BEACH_ARENA.surfaces[0]!,
        { ...BEACH_ARENA.surfaces[1]!, id: "floor" },
        ...BEACH_ARENA.surfaces.slice(2),
        {
          id: "island",
          kind: "platform" as const,
          x: 2_900,
          y: 300,
          width: 200,
          height: 30,
        },
      ],
      chestPoints: [
        ...BEACH_ARENA.chestPoints,
        { id: "unreachable", surfaceId: "island", x: 3_000, y: 300 },
      ],
    };
    expect(validateArena(invalid)).toEqual(
      expect.arrayContaining([
        "Surface id is missing or duplicated: floor",
        "Chest point is unreachable: unreachable",
      ]),
    );
  });
});

describe("AABB collision", () => {
  const floor = {
    id: "floor",
    kind: "floor" as const,
    x: 0,
    y: 100,
    width: 300,
    height: 20,
  };
  const wall = {
    id: "wall",
    kind: "cover" as const,
    x: 140,
    y: 40,
    width: 20,
    height: 60,
  };

  it("uses strict overlap so touching edges are not penetrating", () => {
    expect(intersects({ x: 0, y: 80, width: 20, height: 20 }, floor)).toBe(
      false,
    );
  });

  it("lands on floors and platforms without tunneling at one tick movement", () => {
    const collision = moveWithCollisions(
      { x: 40, y: 60, width: 20, height: 20 },
      { x: 0, y: 30 },
      [floor],
    );
    expect(collision.grounded).toBe(true);
    expect(collision.rectangle.y).toBe(80);
  });

  it("stops at solid cover from either horizontal direction", () => {
    const right = moveWithCollisions(
      { x: 100, y: 60, width: 20, height: 20 },
      { x: 30, y: 0 },
      [wall],
    );
    const left = moveWithCollisions(
      { x: 170, y: 60, width: 20, height: 20 },
      { x: -20, y: 0 },
      [wall],
    );
    expect(right).toMatchObject({ hitRight: true, rectangle: { x: 120 } });
    expect(left).toMatchObject({ hitLeft: true, rectangle: { x: 160 } });
  });
});
