import { intersects } from "./arena.js";
import { TELEPORT } from "./config.js";
import type {
  ArenaDefinition,
  ArenaSurface,
  GameState,
  MatchEvent,
  PlayerRole,
  PlayerState,
  Rectangle,
  TeleportDefinition,
} from "./types.js";

const ROLES: readonly PlayerRole[] = ["luca", "senna"];

/** A player is asking to use something when the control is held or was tapped. */
export function wantsAction(player: PlayerState): boolean {
  return player.input.action || player.actionQueued;
}

function reachRectangle(player: PlayerState): Rectangle {
  return {
    x: player.position.x - TELEPORT.range,
    y: player.position.y - TELEPORT.range,
    width: player.size.width + TELEPORT.range * 2,
    height: player.size.height + TELEPORT.range * 2,
  };
}

/** The teleport a player is standing at, nearest first when two overlap. */
export function teleportUnderPlayer(
  player: PlayerState,
  arena: ArenaDefinition,
): TeleportDefinition | null {
  const reach = reachRectangle(player);
  const centre = player.position.x + player.size.width / 2;
  const candidates = arena.teleports
    .filter((teleport) =>
      intersects(reach, {
        x: teleport.x - 1,
        y: teleport.y - 1,
        width: 2,
        height: 2,
      }),
    )
    .sort(
      (first, second) =>
        Math.abs(first.x - centre) - Math.abs(second.x - centre),
    );
  return candidates[0] ?? null;
}

function standingBox(player: PlayerState, x: number, y: number): Rectangle {
  return {
    x: x - player.size.width / 2,
    y: y - player.size.height,
    width: player.size.width,
    height: player.size.height,
  };
}

function isFree(
  box: Rectangle,
  arena: ArenaDefinition,
  opponent: PlayerState,
): boolean {
  const blocked = arena.surfaces.some(
    (surface: ArenaSurface) =>
      surface.kind === "cover" && intersects(box, surface),
  );
  if (blocked) return false;
  return !intersects(box, {
    x: opponent.position.x,
    y: opponent.position.y,
    width: opponent.size.width,
    height: opponent.size.height,
  });
}

/**
 * Where a player actually arrives. The exit itself comes first, and if somebody
 * is standing in it the arrival slides sideways along the same surface, so
 * camping an exit cannot trap the other player inside a wall.
 */
export function arrivalPosition(
  player: PlayerState,
  arena: ArenaDefinition,
  exit: TeleportDefinition,
  opponent: PlayerState,
): Rectangle | null {
  const surface = arena.surfaces.find(
    (candidate) => candidate.id === exit.surfaceId,
  );
  for (const offset of TELEPORT.arrivalOffsets) {
    const box = standingBox(player, exit.x + offset, exit.y);
    const onSurface =
      !surface ||
      (box.x >= surface.x && box.x + box.width <= surface.x + surface.width);
    if (onSurface && isFree(box, arena, opponent)) return box;
  }
  return null;
}

function teleportEvent(
  state: GameState,
  role: PlayerRole,
  tick: number,
  used: boolean,
): MatchEvent {
  const player = state.match.players[role];
  const number = state.match.nextEntityNumber;
  state.match.nextEntityNumber += 1;
  return {
    id: `teleport-${number}`,
    tick,
    kind: "teleport",
    role,
    target: null,
    item: "unarmed",
    outcome: used ? null : "blocked",
    damage: 0,
    position: {
      x: player.position.x + player.size.width / 2,
      y: player.position.y,
    },
  };
}

/**
 * Runs the teleports for one tick. A player who already claimed a chest on this
 * tick keeps the chest and stays where they are: one press does one thing.
 */
export function simulateTeleports(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
  busy: ReadonlySet<PlayerRole>,
): readonly MatchEvent[] {
  if (arena.teleports.length === 0) return [];
  const events: MatchEvent[] = [];
  for (const role of ROLES) {
    const player = state.match.players[role];
    const opponent = state.match.players[role === "luca" ? "senna" : "luca"];
    if (busy.has(role) || player.health <= 0 || !wantsAction(player)) continue;
    if (tick < player.teleportReadyTick) continue;
    const entrance = teleportUnderPlayer(player, arena);
    if (!entrance) continue;
    const exit = arena.teleports.find(
      (candidate) => candidate.id === entrance.destinations[0],
    );
    if (!exit) continue;

    const arrival = arrivalPosition(player, arena, exit, opponent);
    if (!arrival) {
      // Refusing without a cooldown lets the child simply try again once the
      // exit is clear, and the event tells them the lift did not take them.
      events.push(teleportEvent(state, role, tick, false));
      continue;
    }
    player.position = { x: arrival.x, y: arrival.y };
    player.velocity = { x: 0, y: 0 };
    player.grounded = true;
    player.teleportReadyTick = tick + TELEPORT.cooldownTicks;
    events.push(teleportEvent(state, role, tick, true));
  }
  return events;
}
