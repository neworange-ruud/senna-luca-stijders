import { moveWithCollisions } from "./arena.js";
import { speedMultiplier } from "./effects.js";
import {
  COMBAT,
  MOVEMENT,
  RESPAWN_PROTECTION_TICKS,
  TICK_SECONDS,
} from "./config.js";
import type {
  ArenaDefinition,
  ArenaPoint,
  InputIntent,
  PlayerRole,
  PlayerState,
  Vector,
} from "./types.js";

function approach(
  current: number,
  target: number,
  maximumChange: number,
): number {
  if (current < target) return Math.min(current + maximumChange, target);
  if (current > target) return Math.max(current - maximumChange, target);
  return target;
}

function spawnPosition(player: PlayerState, spawn: ArenaPoint): Vector {
  return {
    x: spawn.x - player.size.width / 2,
    y: spawn.y - player.size.height,
  };
}

export function chooseSafestSpawn(
  arena: ArenaDefinition,
  role: PlayerRole,
  opponentPosition: Vector,
): ArenaPoint {
  const spawns = arena.spawns[role];
  const first = spawns[0];
  if (!first) throw new Error(`Arena has no spawn for ${role}.`);

  return spawns.reduce((safest, candidate) => {
    const currentDistance =
      (safest.x - opponentPosition.x) ** 2 +
      (safest.y - opponentPosition.y) ** 2;
    const candidateDistance =
      (candidate.x - opponentPosition.x) ** 2 +
      (candidate.y - opponentPosition.y) ** 2;
    return candidateDistance > currentDistance ? candidate : safest;
  }, first);
}

export function placeAtSpawn(player: PlayerState, spawn: ArenaPoint): void {
  player.position = spawnPosition(player, spawn);
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
}

export function respawnPlayer(
  player: PlayerState,
  arena: ArenaDefinition,
  opponentPosition: Vector,
  tick: number,
): ArenaPoint {
  const spawn = chooseSafestSpawn(arena, player.role, opponentPosition);
  placeAtSpawn(player, spawn);
  player.invulnerableUntilTick = tick + RESPAWN_PROTECTION_TICKS;
  return spawn;
}

export interface MovementResult {
  respawned: boolean;
  spawnId: string | null;
}

export function movePlayer(
  player: PlayerState,
  input: InputIntent,
  arena: ArenaDefinition,
  opponentPosition: Vector,
  tick: number,
): MovementResult {
  if (
    !Number.isFinite(player.position.x) ||
    !Number.isFinite(player.position.y) ||
    player.position.y > arena.fallBoundaryY
  ) {
    const spawn = respawnPlayer(player, arena, opponentPosition, tick);
    return { respawned: true, spawnId: spawn.id };
  }

  const acceleration = player.grounded
    ? MOVEMENT.groundAcceleration
    : MOVEMENT.airAcceleration;
  // Blocking keeps the player mobile but visibly slower; the speed effect
  // multiplies whatever is left, so the two stack predictably.
  const speed =
    MOVEMENT.runSpeed *
    (input.block ? COMBAT.blockSpeedFactor : 1) *
    speedMultiplier(player);
  player.velocity.x = approach(
    player.velocity.x,
    input.horizontal * speed,
    acceleration * TICK_SECONDS,
  );
  if (input.horizontal !== 0) {
    player.facing = input.horizontal < 0 ? "left" : "right";
  }

  // A tap on Springen that came and went between two ticks still jumps, the
  // same way a tap on Aanval or Actie does. The memory is used up by this tick
  // either way, so it can never turn into a second jump later on.
  const wantsJump = input.jump || player.jumpQueued;
  player.jumpQueued = false;
  if (wantsJump && player.grounded) {
    player.velocity.y = -MOVEMENT.jumpImpulse;
    player.grounded = false;
  }
  player.velocity.y = Math.min(
    player.velocity.y + MOVEMENT.gravity * TICK_SECONDS,
    MOVEMENT.maximumFallSpeed,
  );

  const collision = moveWithCollisions(
    {
      ...player.position,
      width: player.size.width,
      height: player.size.height,
    },
    {
      x: player.velocity.x * TICK_SECONDS,
      y: player.velocity.y * TICK_SECONDS,
    },
    arena.surfaces,
  );
  player.position = {
    x: Math.max(
      arena.bounds.x,
      Math.min(
        collision.rectangle.x,
        arena.bounds.x + arena.bounds.width - player.size.width,
      ),
    ),
    y: collision.rectangle.y,
  };
  if (collision.hitLeft || collision.hitRight) player.velocity.x = 0;
  if (collision.grounded || collision.hitCeiling) player.velocity.y = 0;
  player.grounded = collision.grounded;

  if (player.position.y > arena.fallBoundaryY) {
    const spawn = respawnPlayer(player, arena, opponentPosition, tick);
    return { respawned: true, spawnId: spawn.id };
  }
  return { respawned: false, spawnId: null };
}
