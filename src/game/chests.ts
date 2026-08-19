import { intersects } from "./arena.js";
import { CHESTS } from "./config.js";
import { applyEffect } from "./effects.js";
import { createItem, giveItem } from "./items.js";
import type {
  ArenaDefinition,
  ArenaPoint,
  ChestOutcome,
  ChestScheduleState,
  ChestState,
  GameState,
  ItemId,
  MatchEvent,
  PlayerRole,
  PlayerState,
  Rectangle,
} from "./types.js";
import { CHEST_OUTCOMES } from "./types.js";

const ROLES: readonly PlayerRole[] = ["luca", "senna"];
const ITEM_OUTCOMES: readonly ItemId[] = ["sword", "weak-sword", "nerf"];

export function isItemOutcome(outcome: ChestOutcome): outcome is ItemId {
  return (ITEM_OUTCOMES as readonly string[]).includes(outcome);
}

export function createChestSchedule(): ChestScheduleState {
  return {
    nextAnnouncementTick: CHESTS.firstAnnouncementTicks,
    bag: [],
    recoveryCounter: 0,
    nextRecovery: "armor",
  };
}

/**
 * Draws the seeded random numbers from the persisted match state, so a Durable
 * Object restart continues the same sequence instead of starting a new one.
 */
function nextRandom(state: GameState): number {
  state.match.randomState =
    (Math.imul(state.match.randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return state.match.randomState / 0x1_0000_0000;
}

/**
 * Takes one outcome out of the current base bag, refilling it first when it is
 * empty. Exported so the distribution can be measured directly over many draws.
 */
export function drawChestOutcome(state: GameState): ChestOutcome {
  const schedule = state.match.chestSchedule;
  if (schedule.bag.length === 0) {
    // Refill with exactly one of each outcome, so six consecutive chests always
    // contain six different things before anything can repeat.
    schedule.bag = [...CHEST_OUTCOMES];
  }
  const index = Math.floor(nextRandom(state) * schedule.bag.length);
  const remaining = [...schedule.bag];
  const [outcome] = remaining.splice(index, 1);
  schedule.bag = remaining;
  return outcome ?? "sword";
}

function trailingRole(state: GameState): PlayerRole | null {
  const { luca, senna } = state.match.players;
  const gap = luca.health - senna.health;
  if (Math.abs(gap) < CHESTS.recoveryHeartGap) return null;
  return gap < 0 ? "luca" : "senna";
}

function distanceToPoint(player: PlayerState, point: ArenaPoint): number {
  return Math.hypot(
    player.position.x + player.size.width / 2 - point.x,
    player.position.y + player.size.height - point.y,
  );
}

function freePoints(
  state: GameState,
  arena: ArenaDefinition,
): readonly ArenaPoint[] {
  const taken = new Set(state.match.chests.map((chest) => chest.pointId));
  return arena.chestPoints.filter((point) => !taken.has(point.id));
}

/**
 * Decides where the next chest lands. A recovery chest goes to the free point
 * the trailing player can reach fastest; any other chest picks a free point
 * from the seeded sequence.
 */
export function selectChestPoint(
  state: GameState,
  arena: ArenaDefinition,
  forRole: PlayerRole | null,
): ArenaPoint | null {
  const available = freePoints(state, arena);
  if (available.length === 0) return null;
  if (forRole) {
    const player = state.match.players[forRole];
    return available.reduce((closest, candidate) =>
      distanceToPoint(player, candidate) < distanceToPoint(player, closest)
        ? candidate
        : closest,
    );
  }
  return available[Math.floor(nextRandom(state) * available.length)] ?? null;
}

function chestEvent(
  chest: ChestState,
  tick: number,
  kind: "chest-announced" | "chest-landed" | "chest-claimed",
  role: PlayerRole,
  reveal: boolean,
): MatchEvent {
  return {
    id: `${kind}:${chest.id}:${tick}`,
    tick,
    kind,
    role,
    target: null,
    item: "unarmed",
    outcome: null,
    damage: 0,
    position: { ...chest.position },
    // The contents stay secret until the chest is opened.
    ...(reveal ? { chestOutcome: chest.outcome } : {}),
  };
}

/**
 * Schedules the next chest when its time comes. The eligible-recovery counter
 * is evaluated at scheduling time: it counts consecutive scheduled chests while
 * one player trails by at least three hearts, and the third one is replaced by
 * a recovery chest that does not consume a base-bag entry.
 */
function scheduleChest(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
): MatchEvent | null {
  const schedule = state.match.chestSchedule;
  if (tick < schedule.nextAnnouncementTick) return null;
  if (state.match.chests.length >= CHESTS.maximumActive) {
    // Wait for a claim rather than dropping the schedule entirely.
    schedule.nextAnnouncementTick = tick + CHESTS.intervalTicks;
    return null;
  }

  const trailing = trailingRole(state);
  schedule.recoveryCounter = trailing ? schedule.recoveryCounter + 1 : 0;
  const isRecovery = schedule.recoveryCounter >= CHESTS.recoveryCount;

  const point = selectChestPoint(state, arena, isRecovery ? trailing : null);
  if (!point) {
    schedule.nextAnnouncementTick = tick + CHESTS.intervalTicks;
    return null;
  }

  let outcome: ChestOutcome;
  if (isRecovery) {
    outcome = schedule.nextRecovery;
    schedule.nextRecovery = outcome === "armor" ? "speed" : "armor";
    schedule.recoveryCounter = 0;
  } else {
    outcome = drawChestOutcome(state);
  }

  const number = state.match.nextEntityNumber;
  state.match.nextEntityNumber += 1;
  const chest: ChestState = {
    id: `chest-${number}`,
    pointId: point.id,
    position: { x: point.x, y: point.y },
    outcome,
    announcedAtTick: tick,
    landsAtTick: tick + CHESTS.announceTicks,
    recovery: isRecovery,
  };
  state.match.chests = [...state.match.chests, chest];
  schedule.nextAnnouncementTick = tick + CHESTS.intervalTicks;
  return chestEvent(chest, tick, "chest-announced", "luca", false);
}

function claimRectangle(player: PlayerState): Rectangle {
  return {
    x: player.position.x - CHESTS.claimRange,
    y: player.position.y - CHESTS.claimRange / 2,
    width: player.size.width + CHESTS.claimRange * 2,
    height: player.size.height + CHESTS.claimRange,
  };
}

function chestBody(chest: ChestState): Rectangle {
  return {
    x: chest.position.x - 32,
    y: chest.position.y - 56,
    width: 64,
    height: 56,
  };
}

/**
 * Picks the single player who claims a chest on this tick: reach first, then
 * the shortest distance, then an alternating tie-break so an exact tie does not
 * always fall to the same child.
 */
export function chestClaimant(
  state: GameState,
  chest: ChestState,
  tick: number,
): PlayerRole | null {
  const contenders = ROLES.map((role) => state.match.players[role]).filter(
    (player) =>
      player.input.action &&
      player.health > 0 &&
      intersects(claimRectangle(player), chestBody(chest)),
  );
  if (contenders.length === 0) return null;
  const sorted = [...contenders].sort((first, second) => {
    const gap =
      Math.hypot(
        first.position.x + first.size.width / 2 - chest.position.x,
        first.position.y + first.size.height - chest.position.y,
      ) -
      Math.hypot(
        second.position.x + second.size.width / 2 - chest.position.x,
        second.position.y + second.size.height - chest.position.y,
      );
    if (Math.abs(gap) > 0.001) return gap;
    const preferred: PlayerRole = tick % 2 === 0 ? "luca" : "senna";
    return first.role === preferred ? -1 : 1;
  });
  return sorted[0]?.role ?? null;
}

/** Hands a chest's contents to its claimant. */
export function awardChest(
  state: GameState,
  role: PlayerRole,
  outcome: ChestOutcome,
): void {
  const player = state.match.players[role];
  if (isItemOutcome(outcome)) {
    giveItem(player, createItem(state, outcome, role));
    return;
  }
  applyEffect(player, outcome);
}

/**
 * Runs the whole chest loop for one tick: schedule, land, and resolve claims.
 * A chest is removed the moment it is claimed, so exactly one reward event can
 * ever come out of it.
 */
export function simulateChests(
  state: GameState,
  arena: ArenaDefinition,
  tick: number,
): readonly MatchEvent[] {
  const events: MatchEvent[] = [];
  const announced = scheduleChest(state, arena, tick);
  if (announced) events.push(announced);

  const remaining: ChestState[] = [];
  for (const chest of state.match.chests) {
    if (tick === chest.landsAtTick) {
      events.push(chestEvent(chest, tick, "chest-landed", "luca", false));
    }
    if (tick < chest.landsAtTick) {
      remaining.push(chest);
      continue;
    }
    const claimant = chestClaimant(state, chest, tick);
    if (!claimant) {
      remaining.push(chest);
      continue;
    }
    awardChest(state, claimant, chest.outcome);
    events.push(chestEvent(chest, tick, "chest-claimed", claimant, true));
  }
  state.match.chests = remaining;
  return events;
}
