import { MOVEMENT } from "./config.js";
import type {
  ArenaDefinition,
  ArenaPoint,
  ArenaSurface,
  Rectangle,
  Vector,
} from "./types.js";

const MAXIMUM_JUMP_RISE =
  (MOVEMENT.jumpImpulse * MOVEMENT.jumpImpulse) / (2 * MOVEMENT.gravity);
const MAXIMUM_JUMP_GAP = 620;

function isFiniteRectangle(rectangle: Rectangle): boolean {
  return (
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.width) &&
    Number.isFinite(rectangle.height) &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}

function insideBounds(rectangle: Rectangle, bounds: Rectangle): boolean {
  return (
    rectangle.x >= bounds.x &&
    rectangle.y >= bounds.y &&
    rectangle.x + rectangle.width <= bounds.x + bounds.width &&
    rectangle.y + rectangle.height <= bounds.y + bounds.height
  );
}

function pointOnSurface(point: ArenaPoint, surface: ArenaSurface): boolean {
  return (
    point.y === surface.y &&
    point.x >= surface.x &&
    point.x <= surface.x + surface.width
  );
}

function horizontalGap(first: ArenaSurface, second: ArenaSurface): number {
  if (first.x + first.width < second.x)
    return second.x - (first.x + first.width);
  if (second.x + second.width < first.x)
    return first.x - (second.x + second.width);
  return 0;
}

function canTraverse(from: ArenaSurface, to: ArenaSurface): boolean {
  const rise = from.y - to.y;
  return (
    rise <= MAXIMUM_JUMP_RISE && horizontalGap(from, to) <= MAXIMUM_JUMP_GAP
  );
}

/** Where each teleport leads, by the surface it stands on. */
function teleportLinks(
  arena: ArenaDefinition,
): ReadonlyMap<string, readonly string[]> {
  const bySurface = new Map<string, string[]>();
  const surfaceOf = new Map(
    arena.teleports.map((teleport) => [teleport.id, teleport.surfaceId]),
  );
  for (const teleport of arena.teleports) {
    const targets = teleport.destinations
      .map((destination) => surfaceOf.get(destination))
      .filter((surfaceId): surfaceId is string => Boolean(surfaceId));
    const known = bySurface.get(teleport.surfaceId) ?? [];
    known.push(...targets);
    bySurface.set(teleport.surfaceId, known);
  }
  return bySurface;
}

export function reachableSurfaceIds(
  arena: ArenaDefinition,
): ReadonlySet<string> {
  const navigable = arena.surfaces.filter(
    (surface) => surface.kind !== "cover",
  );
  const surfaces = new Map(navigable.map((surface) => [surface.id, surface]));
  // A teleport is a way to travel, so it counts towards reachability. Without
  // this a rooftop that only a lift can reach would look unreachable, and the
  // city would have to be flattened into another beach.
  const links = teleportLinks(arena);
  const reachable = new Set<string>();
  const pending = [...arena.spawns.luca, ...arena.spawns.senna]
    .map((spawn) => spawn.surfaceId)
    .filter((id) => surfaces.has(id));

  while (pending.length > 0) {
    const id = pending.shift();
    if (!id || reachable.has(id)) continue;
    const current = surfaces.get(id);
    if (!current) continue;
    reachable.add(id);
    for (const candidate of navigable) {
      if (!reachable.has(candidate.id) && canTraverse(current, candidate)) {
        pending.push(candidate.id);
      }
    }
    for (const linked of links.get(id) ?? []) {
      if (!reachable.has(linked) && surfaces.has(linked)) pending.push(linked);
    }
  }
  return reachable;
}

export function validateArena(arena: ArenaDefinition): readonly string[] {
  const issues: string[] = [];
  if (!arena.id || !arena.label)
    issues.push("Arena id and label are required.");
  if (!isFiniteRectangle(arena.bounds))
    issues.push("Arena bounds are invalid.");
  if (arena.fallBoundaryY < arena.bounds.y + arena.bounds.height) {
    issues.push("Fall boundary must be below the arena bounds.");
  }

  const surfaceIds = new Set<string>();
  for (const surface of arena.surfaces) {
    if (!surface.id || surfaceIds.has(surface.id)) {
      issues.push(`Surface id is missing or duplicated: ${surface.id}`);
    }
    surfaceIds.add(surface.id);
    if (!isFiniteRectangle(surface) || !insideBounds(surface, arena.bounds)) {
      issues.push(`Surface is outside valid bounds: ${surface.id}`);
    }
  }

  const pointIds = new Set<string>();
  const validatePoint = (point: ArenaPoint, kind: string) => {
    const surface = arena.surfaces.find(
      (candidate) => candidate.id === point.surfaceId,
    );
    if (!point.id || pointIds.has(point.id)) {
      issues.push(`${kind} id is missing or duplicated: ${point.id}`);
    }
    pointIds.add(point.id);
    if (!surface || !pointOnSurface(point, surface)) {
      issues.push(`${kind} is not anchored to its surface: ${point.id}`);
    }
  };

  for (const spawn of [...arena.spawns.luca, ...arena.spawns.senna]) {
    validatePoint(spawn, "Spawn");
  }
  if (arena.spawns.luca.length === 0 || arena.spawns.senna.length === 0) {
    issues.push("Both players require at least one spawn.");
  }
  for (const chest of arena.chestPoints) validatePoint(chest, "Chest point");
  if (arena.chestPoints.length === 0)
    issues.push("At least one chest point is required.");

  const reachable = reachableSurfaceIds(arena);
  for (const chest of arena.chestPoints) {
    if (!reachable.has(chest.surfaceId)) {
      issues.push(`Chest point is unreachable: ${chest.id}`);
    }
  }

  const teleportIds = new Set(arena.teleports.map((teleport) => teleport.id));
  for (const teleport of arena.teleports) {
    validatePoint(teleport, "Teleport");
    if (
      teleport.destinations.length === 0 ||
      teleport.destinations.some((destination) => !teleportIds.has(destination))
    ) {
      issues.push(`Teleport has an invalid destination: ${teleport.id}`);
    }
  }
  return issues;
}

export function intersects(first: Rectangle, second: Rectangle): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

export interface CollisionResult {
  rectangle: Rectangle;
  hitLeft: boolean;
  hitRight: boolean;
  hitCeiling: boolean;
  grounded: boolean;
}

export function moveWithCollisions(
  rectangle: Rectangle,
  delta: Vector,
  surfaces: readonly ArenaSurface[],
): CollisionResult {
  const next = { ...rectangle, x: rectangle.x + delta.x };
  let hitLeft = false;
  let hitRight = false;
  let hitCeiling = false;
  let grounded = false;

  for (const surface of surfaces) {
    if (!intersects(next, surface)) continue;
    if (delta.x > 0) {
      next.x = Math.min(next.x, surface.x - next.width);
      hitRight = true;
    } else if (delta.x < 0) {
      next.x = Math.max(next.x, surface.x + surface.width);
      hitLeft = true;
    }
  }

  next.y += delta.y;
  for (const surface of surfaces) {
    if (!intersects(next, surface)) continue;
    if (delta.y > 0) {
      next.y = Math.min(next.y, surface.y - next.height);
      grounded = true;
    } else if (delta.y < 0) {
      next.y = Math.max(next.y, surface.y + surface.height);
      hitCeiling = true;
    }
  }

  return { rectangle: next, hitLeft, hitRight, hitCeiling, grounded };
}
