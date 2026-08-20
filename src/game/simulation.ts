import { createChestSchedule, simulateChests } from "./chests.js";
import { simulateCombat, simulateProjectiles } from "./combat.js";
import { TICK_SECONDS } from "./config.js";
import { advanceEffects } from "./effects.js";
import { recordEvents } from "./events.js";
import { switchWeapon } from "./items.js";
import { placeAtSpawn, movePlayer, type MovementResult } from "./movement.js";
import { simulateDroppedItems } from "./pickups.js";
import { simulateTeleports } from "./teleports.js";
import { finishMatch } from "./state-machine.js";
import type {
  ArenaDefinition,
  GameState,
  InputIntent,
  MatchEvent,
  PlayerRole,
  Vector,
} from "./types.js";

const ROLES: readonly PlayerRole[] = ["luca", "senna"];

export function initializeArena(
  state: GameState,
  arena: ArenaDefinition,
): void {
  for (const role of ROLES) {
    const spawn = arena.spawns[role][0];
    if (!spawn) throw new Error(`Arena has no spawn for ${role}.`);
    placeAtSpawn(state.match.players[role], spawn);
  }
  state.match.arenaId = arena.id as GameState["match"]["arenaId"];
  // The chest clock starts when play does, not when the lobby opened.
  state.match.chests = [];
  state.match.chestSchedule = {
    ...createChestSchedule(),
    nextAnnouncementTick:
      state.match.tick + createChestSchedule().nextAnnouncementTick,
  };
}

/**
 * Stores a player's held controls. The weapon switch is edge triggered here so
 * that holding the control does not cycle the inventory every tick.
 */
export function setInputIntent(
  state: GameState,
  role: PlayerRole,
  intent: InputIntent,
): void {
  const player = state.match.players[role];
  const wasSwitching = player.input.switchWeapon;
  // Remember a press even if it is released again before the next tick.
  if (intent.attack && !player.input.attack) player.attackQueued = true;
  if (intent.action && !player.input.action) player.actionQueued = true;
  if (intent.jump && !player.input.jump) player.jumpQueued = true;
  player.input = { ...intent };
  if (intent.switchWeapon && !wasSwitching && state.match.phase === "playing") {
    switchWeapon(player);
  }
}

export interface SimulationStep {
  advanced: boolean;
  tick: number;
  movement: Record<PlayerRole, MovementResult>;
  events: readonly MatchEvent[];
}

const NO_MOVEMENT: MovementResult = { respawned: false, spawnId: null };

/** True when a tick produced an outcome that must be durable before it is shown. */
export function hasIrreversibleOutcome(step: SimulationStep): boolean {
  return step.events.some(
    (event) =>
      event.damage > 0 ||
      ["throw", "shoot", "pickup", "drop", "chest-claimed"].includes(
        event.kind,
      ),
  );
}

export function simulateMovementTick(
  state: GameState,
  arena: ArenaDefinition,
): SimulationStep {
  if (state.match.phase !== "playing") {
    return {
      advanced: false,
      tick: state.match.tick,
      movement: { luca: NO_MOVEMENT, senna: NO_MOVEMENT },
      events: [],
    };
  }

  state.match.tick += 1;
  const tick = state.match.tick;
  const positions: Record<PlayerRole, Vector> = {
    luca: { ...state.match.players.luca.position },
    senna: { ...state.match.players.senna.position },
  };
  const movement = {
    luca: movePlayer(
      state.match.players.luca,
      state.match.players.luca.input,
      arena,
      positions.senna,
      tick,
    ),
    senna: movePlayer(
      state.match.players.senna,
      state.match.players.senna.input,
      arena,
      positions.luca,
      tick,
    ),
  };
  const chestEvents = simulateChests(state, arena, tick);
  // One press does one thing: whoever just opened a chest does not also ride
  // the lift they happen to be standing on.
  const claimed = new Set<PlayerRole>(
    chestEvents
      .filter((event) => event.kind === "chest-claimed")
      .map((event) => event.role),
  );
  const events = [
    ...simulateCombat(state, arena, tick),
    ...simulateProjectiles(state, arena, tick, TICK_SECONDS),
    ...simulateDroppedItems(state, arena, tick, TICK_SECONDS),
    ...chestEvents,
    ...simulateTeleports(state, arena, tick, claimed),
    ...ROLES.flatMap((role) => advanceEffects(state.match.players[role], tick)),
  ];
  // The remembered press is used up by this tick, whatever it was used for.
  for (const role of ROLES) state.match.players[role].actionQueued = false;
  recordEvents(state, events);
  if (
    state.match.players.luca.health === 0 ||
    state.match.players.senna.health === 0
  ) {
    finishMatch(state);
  }
  return { advanced: true, tick, movement, events };
}
