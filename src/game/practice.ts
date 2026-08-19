import { MELEE } from "./config.js";
import { createItem, giveItem, UNARMED_SLOT } from "./items.js";
import { placeAtSpawn } from "./movement.js";
import { initializeArena } from "./simulation.js";
import { createInitialGameState } from "./state-machine.js";
import {
  EMPTY_INPUT,
  type ItemId,
  type ArenaDefinition,
  type CosmeticId,
  type GameState,
  type InputIntent,
  type PlayerRole,
  type PlayerState,
  type WorldId,
} from "./types.js";

/**
 * Practice mode lets one player test gameplay without a second device. Rules
 * live here as pure functions so the behaviour of the training opponent is unit
 * tested exactly like every other game rule.
 */
export const PRACTICE_BEHAVIOURS = ["idle", "follow", "flee", "fight"] as const;

export type PracticeBehaviour = (typeof PRACTICE_BEHAVIOURS)[number];

export const PRACTICE_BEHAVIOUR_LABELS: Readonly<
  Record<PracticeBehaviour, string>
> = {
  idle: "Stilstaan",
  follow: "Achtervolgen",
  flee: "Wegrennen",
  fight: "Terugvechten",
};

export interface PracticeOptions {
  arena: ArenaDefinition;
  humanCosmetic?: CosmeticId;
  botCosmetic?: CosmeticId;
  seed?: number;
}

const KEEP_DISTANCE = 24;
const FLEE_JUMP_DISTANCE = 200;
const CLIMB_HEIGHT = 60;

function centerX(player: PlayerState): number {
  return player.position.x + player.size.width / 2;
}

/** Horizontal gap between the two player boxes, negative while overlapping. */
function edgeGap(bot: PlayerState, human: PlayerState): number {
  return (
    Math.abs(centerX(human) - centerX(bot)) -
    (bot.size.width + human.size.width) / 2
  );
}

export function practiceOpponent(role: PlayerRole): PlayerRole {
  return role === "luca" ? "senna" : "luca";
}

/**
 * Deterministic intent for the training opponent. It never reads randomness, so
 * a recorded practice session replays identically.
 */
export function practiceBotIntent(
  state: GameState,
  botRole: PlayerRole,
  behaviour: PracticeBehaviour,
  tick = state.match.tick,
): InputIntent {
  if (behaviour === "idle" || state.match.phase !== "playing") {
    return { ...EMPTY_INPUT };
  }
  const bot = state.match.players[botRole];
  const human = state.match.players[practiceOpponent(botRole)];
  const offset = centerX(human) - centerX(bot);
  const towards: InputIntent["horizontal"] =
    offset === 0 ? 0 : offset > 0 ? 1 : -1;
  const gap = edgeGap(bot, human);
  const humanIsHigher = bot.position.y - human.position.y > CLIMB_HEIGHT;

  if (behaviour === "flee") {
    return {
      ...EMPTY_INPUT,
      horizontal: (towards === 0 ? 1 : -towards) as InputIntent["horizontal"],
      jump: bot.grounded && gap < FLEE_JUMP_DISTANCE,
    };
  }

  const range = behaviour === "fight" ? MELEE.unarmed.range : KEEP_DISTANCE;
  const withinReach = gap <= MELEE.unarmed.range;
  const approach: InputIntent["horizontal"] = gap > range ? towards : 0;
  // Walking into arena cover or a platform edge zeroes horizontal speed, so the
  // opponent hops instead of pressing against the obstacle forever.
  const blocked = approach !== 0 && bot.velocity.x === 0;
  const jump = bot.grounded && (humanIsHigher || blocked);
  if (behaviour === "follow") {
    return { ...EMPTY_INPUT, horizontal: approach, jump };
  }
  return {
    ...EMPTY_INPUT,
    horizontal: approach,
    jump,
    attack: withinReach && tick >= bot.nextAttackTick,
    block: withinReach && tick < bot.nextAttackTick && human.input.attack,
  };
}

/**
 * Builds a match that is already playing, with both roles present, so a single
 * player can reach the arena without pairing a second device.
 */
export function createPracticeState(
  humanRole: PlayerRole,
  options: PracticeOptions,
): GameState {
  const state = createInitialGameState(options.seed ?? 20_260_819);
  const botRole = practiceOpponent(humanRole);
  const world = options.arena.id as WorldId;
  state.lobby.chooser = humanRole;
  state.lobby.selectedWorld = world;
  state.lobby.worldConfirmed = true;
  for (const player of Object.values(state.match.players)) {
    player.connected = true;
  }
  state.match.players[humanRole].cosmetic = options.humanCosmetic ?? "knight";
  state.match.players[botRole].cosmetic = options.botCosmetic ?? "pirate";
  state.match.phase = "playing";
  state.match.phaseStartedTick = 0;
  initializeArena(state, options.arena);
  // Solo testing starts with the training opponent within reach instead of
  // behind arena cover on the far side of the map.
  const human = state.match.players[humanRole];
  const nearest = options.arena.spawns[botRole].reduce((closest, candidate) =>
    Math.abs(candidate.x - human.position.x) <
    Math.abs(closest.x - human.position.x)
      ? candidate
      : closest,
  );
  placeAtSpawn(state.match.players[botRole], nearest);
  return state;
}

/**
 * Hands the practice player a weapon so a single tester can try melee, throws,
 * and darts before chest drops exist. This only ever touches the browser-local
 * practice state, never an authoritative match.
 */
export function grantPracticeWeapon(
  state: GameState,
  role: PlayerRole,
  itemId: ItemId | "unarmed",
): void {
  const player = state.match.players[role];
  player.inventory = [];
  player.selectedSlot = UNARMED_SLOT;
  if (itemId === "unarmed") return;
  giveItem(player, createItem(state, itemId, role));
}
