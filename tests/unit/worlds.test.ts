import { describe, expect, it } from "vitest";

import {
  intersects,
  reachableSurfaceIds,
  validateArena,
} from "../../src/game/arena";
import { MOVEMENT } from "../../src/game/config";
import { ARENAS, WORLDS, arenaForWorld } from "../../src/game/content";
import type { ArenaDefinition, WorldId } from "../../src/game/types";

const WORLD_IDS: readonly WorldId[] = [
  "beach",
  "forest",
  "space",
  "construction",
  "city",
  "boat",
];

/** Where a player standing on this point would be. */
function standingBox(x: number, y: number) {
  return {
    x: x - MOVEMENT.playerWidth / 2,
    y: y - MOVEMENT.playerHeight,
    width: MOVEMENT.playerWidth,
    height: MOVEMENT.playerHeight,
  };
}

function blockedBy(arena: ArenaDefinition, x: number, y: number): string[] {
  const box = standingBox(x, y);
  return arena.surfaces
    .filter((surface) => surface.kind === "cover" && intersects(box, surface))
    .map((surface) => surface.id);
}

describe("worlds", () => {
  it("offers exactly the six worlds the children can choose", () => {
    expect(WORLDS.map((world) => world.id)).toEqual(WORLD_IDS);
    expect(WORLDS.every((world) => world.label.length > 0)).toBe(true);
  });

  it("gives every world its own geometry instead of a copy", () => {
    const shapes = WORLDS.map((world) =>
      JSON.stringify([world.bounds, world.surfaces]),
    );
    expect(new Set(shapes).size).toBe(WORLD_IDS.length);
  });

  it.each(WORLD_IDS)("validates the %s arena", (id) => {
    expect(validateArena(ARENAS[id])).toEqual([]);
  });

  it.each(WORLD_IDS)("can reach every surface of the %s arena", (id) => {
    const arena = ARENAS[id];
    const reachable = reachableSurfaceIds(arena);
    const expected = arena.surfaces
      .filter((surface) => surface.kind !== "cover")
      .map((surface) => surface.id);
    expect([...reachable].sort()).toEqual([...expected].sort());
  });

  it.each(WORLD_IDS)("keeps spawns and chest points clear in %s", (id) => {
    const arena = ARENAS[id];
    const points = [
      ...arena.spawns.luca,
      ...arena.spawns.senna,
      ...arena.chestPoints,
      ...arena.teleports,
    ];
    for (const point of points) {
      expect({
        id: point.id,
        blocked: blockedBy(arena, point.x, point.y),
      }).toEqual({ id: point.id, blocked: [] });
    }
  });

  it("puts the two players apart at the start of every world", () => {
    for (const world of WORLDS) {
      const [luca] = world.spawns.luca;
      const [senna] = world.spawns.senna;
      expect(Math.abs((luca?.x ?? 0) - (senna?.x ?? 0))).toBeGreaterThan(600);
    }
  });

  it("only reaches the city rooftops through a lift", () => {
    const city = ARENAS.city;
    const withoutLifts: ArenaDefinition = { ...city, teleports: [] };
    const reachable = reachableSurfaceIds(withoutLifts);
    expect(reachable.has("roof-west")).toBe(false);
    expect(reachable.has("roof-east")).toBe(false);
    expect(reachableSurfaceIds(city).has("roof-west")).toBe(true);
  });

  it("links every teleport to a teleport that leads back", () => {
    for (const world of WORLDS) {
      const byId = new Map(world.teleports.map((one) => [one.id, one]));
      for (const teleport of world.teleports) {
        expect(teleport.destinations.length).toBeGreaterThan(0);
        for (const destination of teleport.destinations) {
          const target = byId.get(destination);
          expect(target?.destinations).toContain(teleport.id);
        }
      }
    }
  });

  it("falls back to the beach for an unknown or missing world", () => {
    expect(arenaForWorld("city").id).toBe("city");
    expect(arenaForWorld(null).id).toBe("beach");
    expect(arenaForWorld("atlantis").id).toBe("beach");
  });
});
