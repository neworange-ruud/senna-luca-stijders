import { intersects, moveWithCollisions } from "./arena.js";
import { COMBAT, MOVEMENT } from "./config.js";
import { giveItem } from "./items.js";
import type {
  ArenaDefinition,
  EntityState,
  GameState,
  MatchEvent,
  PlayerRole,
  PlayerState,
  Rectangle,
} from "./types.js";

const ROLES: readonly PlayerRole[] = ["luca", "senna"];

function reachRectangle(player: PlayerState): Rectangle {
  return {
    x: player.position.x - COMBAT.pickupRange,
    y: player.position.y - COMBAT.pickupRange / 2,
    width: player.size.width + COMBAT.pickupRange * 2,
    height: player.size.height + COMBAT.pickupRange,
  };
}

function distanceBetween(player: PlayerState, entity: EntityState): number {
  return Math.hypot(
    player.position.x + player.size.width / 2 - entity.position.x,
    player.position.y + player.size.height / 2 - entity.position.y,
  );
}

function pickupEvent(
  role: PlayerRole,
  entity: EntityState,
  tick: number,
  kind: "pickup" | "drop",
): MatchEvent {
  return {
    id: `${role}:${kind}:${entity.id}:${tick}`,
    tick,
    kind,
    role,
    target: null,
    item: entity.itemId,
    outcome: null,
    damage: 0,
    position: { ...entity.position },
  };
}

function asDroppedItem(
  entity: EntityState,
  itemId: EntityState["itemId"],
  ammo: number | null,
  position: EntityState["position"],
  tick: number,
): EntityState {
  return {
    ...entity,
    itemId,
    ammo,
    position: { ...position },
    kind: "dropped-item",
    velocity: { x: 0, y: 0 },
    expiresAtTick: tick + COMBAT.droppedReturnTicks,
  };
}

/**
 * Chooses which player claims a contested item on the exact tick both are in
 * range: closest first, then an alternating tie-break so neither role has a
 * permanent advantage.
 */
export function claimant(
  candidates: readonly PlayerState[],
  entity: EntityState,
  tick: number,
): PlayerState | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((first, second) => {
    const gap =
      distanceBetween(first, entity) - distanceBetween(second, entity);
    if (Math.abs(gap) > 0.001) return gap;
    const preferred: PlayerRole = tick % 2 === 0 ? "luca" : "senna";
    return first.role === preferred ? -1 : 1;
  });
  return sorted[0] ?? null;
}

/**
 * Settles everything lying in the arena for one tick: items fall to a surface,
 * a player pressing Action picks one up, and an unclaimed thrown weapon returns
 * to its owner once its eight active seconds are up.
 */
export function simulateDroppedItems(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
  seconds: number,
): readonly MatchEvent[] {
  const events: MatchEvent[] = [];
  const surviving: EntityState[] = [];
  for (const entity of state.match.entities) {
    if (entity.kind !== "dropped-item") {
      surviving.push(entity);
      continue;
    }

    const fall = moveWithCollisions(
      { ...entity.position, ...entity.size },
      { x: 0, y: Math.min(MOVEMENT.maximumFallSpeed * seconds, 40) },
      arena.surfaces,
    );
    const resting: EntityState = {
      ...entity,
      position: { x: fall.rectangle.x, y: fall.rectangle.y },
    };

    const reachable = ROLES.map((role) => state.match.players[role]).filter(
      (player) =>
        player.input.action &&
        player.health > 0 &&
        intersects(reachRectangle(player), {
          ...resting.position,
          ...resting.size,
        }),
    );
    const winner = claimant(reachable, resting, tick);
    if (winner) {
      const replaced = giveItem(winner, {
        id: resting.id,
        itemId: resting.itemId,
        owner: winner.role,
        ammo: resting.ammo,
      });
      events.push(pickupEvent(winner.role, resting, tick, "pickup"));
      if (replaced) {
        const dropped = asDroppedItem(
          resting,
          replaced.itemId,
          replaced.ammo,
          winner.position,
          tick,
        );
        surviving.push({ ...dropped, id: `${replaced.id}-dropped` });
        events.push(pickupEvent(winner.role, dropped, tick, "drop"));
      }
      continue;
    }

    if (
      resting.expiresAtTick !== null &&
      tick >= resting.expiresAtTick &&
      resting.owner
    ) {
      const owner = state.match.players[resting.owner];
      const replaced = giveItem(owner, {
        id: resting.id,
        itemId: resting.itemId,
        owner: owner.role,
        ammo: resting.ammo,
      });
      events.push(pickupEvent(owner.role, resting, tick, "pickup"));
      if (replaced) {
        // The owner's hands were full, so the returned weapon swaps places with
        // the one it replaced instead of disappearing.
        surviving.push(
          asDroppedItem(
            resting,
            replaced.itemId,
            replaced.ammo,
            owner.position,
            tick,
          ),
        );
      }
      continue;
    }
    surviving.push(resting);
  }
  state.match.entities = surviving;
  return events;
}
