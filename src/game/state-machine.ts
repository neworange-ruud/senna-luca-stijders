import { COUNTDOWN_TICKS } from "./config.js";
import { createChestSchedule } from "./chests.js";
import { UNARMED_SLOT } from "./items.js";
import {
  EMPTY_INPUT,
  GAME_SCHEMA_VERSION,
  type CosmeticId,
  type GameError,
  type GameState,
  type PlayerRole,
  type PlayerState,
  type WorldId,
} from "./types.js";

const ROLES: readonly PlayerRole[] = ["luca", "senna"];

function player(role: PlayerRole): PlayerState {
  return {
    role,
    connected: false,
    ready: false,
    cosmetic: null,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    size: { width: 64, height: 96 },
    facing: role === "luca" ? "right" : "left",
    grounded: false,
    health: 10,
    invulnerableUntilTick: 0,
    nextAttackTick: 0,
    attackHeldTicks: 0,
    selectedSlot: UNARMED_SLOT,
    lastProcessedSequence: 0,
    input: { ...EMPTY_INPUT },
    inventory: [],
    effects: [],
  };
}

export function createInitialGameState(randomSeed = 1): GameState {
  return {
    schemaVersion: GAME_SCHEMA_VERSION,
    lobby: {
      chooser: "luca",
      selectedWorld: null,
      worldConfirmed: false,
      completedMatches: 0,
    },
    match: {
      phase: "waiting",
      tick: 0,
      phaseStartedTick: 0,
      countdownEndsTick: null,
      resumeTarget: null,
      pausedBy: null,
      winner: null,
      arenaId: null,
      randomState: randomSeed >>> 0,
      nextEntityNumber: 1,
      players: { luca: player("luca"), senna: player("senna") },
      entities: [],
      events: [],
      chests: [],
      chestSchedule: createChestSchedule(),
    },
    processedCommandIds: [],
  };
}

function invalidPhase(): GameError {
  return { code: "INVALID_PHASE", messageKey: "fout.verkeerdeSpelfase" };
}

function bothPlayers(
  state: GameState,
  condition: (value: PlayerState) => boolean,
): boolean {
  return ROLES.every((role) => condition(state.match.players[role]));
}

function setPhase(state: GameState, phase: GameState["match"]["phase"]): void {
  state.match.phase = phase;
  state.match.phaseStartedTick = state.match.tick;
}

export function setPlayerConnected(
  state: GameState,
  role: PlayerRole,
  connected: boolean,
): void {
  const target = state.match.players[role];
  target.connected = connected;

  if (!connected) {
    target.input = { ...EMPTY_INPUT };
    target.ready = false;
    if (["countdown", "playing", "paused"].includes(state.match.phase)) {
      state.match.resumeTarget = "playing";
      state.match.countdownEndsTick = null;
      setPhase(state, "reconnecting");
    }
    return;
  }

  if (
    state.match.phase === "waiting" &&
    bothPlayers(state, (candidate) => candidate.connected)
  ) {
    setPhase(state, "world-selection");
  } else if (
    state.match.phase === "reconnecting" &&
    bothPlayers(state, (candidate) => candidate.connected)
  ) {
    for (const playerState of Object.values(state.match.players)) {
      playerState.ready = false;
    }
    setPhase(state, "paused");
  }
}

export function selectWorld(
  state: GameState,
  role: PlayerRole,
  world: WorldId,
): GameError | null {
  if (state.match.phase !== "world-selection" || state.lobby.chooser !== role) {
    return invalidPhase();
  }
  state.lobby.selectedWorld = world;
  state.lobby.worldConfirmed = false;
  state.match.arenaId = world;
  return null;
}

export function confirmWorld(
  state: GameState,
  role: PlayerRole,
): GameError | null {
  if (
    state.match.phase !== "world-selection" ||
    state.lobby.chooser === role ||
    state.lobby.selectedWorld === null
  ) {
    return invalidPhase();
  }
  state.lobby.worldConfirmed = true;
  setPhase(state, "ready");
  return null;
}

export function selectCosmetic(
  state: GameState,
  role: PlayerRole,
  cosmetic: CosmeticId,
): GameError | null {
  if (!["world-selection", "ready"].includes(state.match.phase)) {
    return invalidPhase();
  }
  state.match.players[role].cosmetic = cosmetic;
  state.match.players[role].ready = false;
  return null;
}

export function setPlayerReady(
  state: GameState,
  role: PlayerRole,
  ready: boolean,
): GameError | null {
  const isInitialReady = state.match.phase === "ready";
  const isResumeReady = state.match.phase === "paused";
  if (!isInitialReady && !isResumeReady) return invalidPhase();

  const target = state.match.players[role];
  if (!target.connected || (isInitialReady && target.cosmetic === null)) {
    return invalidPhase();
  }
  target.ready = ready;

  if (
    bothPlayers(state, (candidate) => candidate.ready && candidate.connected)
  ) {
    state.match.countdownEndsTick = state.match.tick + COUNTDOWN_TICKS;
    state.match.resumeTarget = isResumeReady ? "playing" : null;
    setPhase(state, "countdown");
  }
  return null;
}

export function advanceLifecycle(state: GameState, tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < state.match.tick) {
    throw new RangeError("Lifecycle tick cannot move backwards.");
  }
  state.match.tick = tick;
  if (
    state.match.phase === "countdown" &&
    state.match.countdownEndsTick !== null &&
    tick >= state.match.countdownEndsTick
  ) {
    setPhase(state, state.match.resumeTarget ?? "playing");
    state.match.countdownEndsTick = null;
    state.match.resumeTarget = null;
    for (const playerState of Object.values(state.match.players)) {
      playerState.ready = false;
    }
  }
}

export function pauseMatch(
  state: GameState,
  role: PlayerRole,
): GameError | null {
  if (state.match.phase !== "playing") return invalidPhase();
  state.match.pausedBy = role;
  state.match.resumeTarget = "playing";
  for (const playerState of Object.values(state.match.players)) {
    playerState.ready = false;
    playerState.input = { ...EMPTY_INPUT };
  }
  setPhase(state, "paused");
  return null;
}

export function finishMatch(state: GameState): GameError | null {
  if (state.match.phase !== "playing") return invalidPhase();
  const { luca, senna } = state.match.players;
  if (luca.health > 0 && senna.health > 0) return invalidPhase();
  state.match.winner =
    luca.health === senna.health
      ? null
      : luca.health > senna.health
        ? "luca"
        : "senna";
  for (const playerState of Object.values(state.match.players)) {
    playerState.input = { ...EMPTY_INPUT };
    playerState.ready = false;
  }
  setPhase(state, "finished");
  return null;
}

export function requestRematch(
  state: GameState,
  role: PlayerRole,
): GameError | null {
  if (
    state.match.phase !== "finished" ||
    !state.match.players[role].connected
  ) {
    return invalidPhase();
  }
  state.match.players[role].ready = true;
  if (
    !bothPlayers(state, (candidate) => candidate.ready && candidate.connected)
  ) {
    return null;
  }

  state.lobby.completedMatches += 1;
  state.lobby.chooser =
    state.lobby.completedMatches % 2 === 0 ? "luca" : "senna";
  state.lobby.selectedWorld = null;
  state.lobby.worldConfirmed = false;
  state.match.arenaId = null;
  state.match.winner = null;
  state.match.pausedBy = null;
  state.match.resumeTarget = null;
  state.match.countdownEndsTick = null;
  state.match.entities = [];
  state.match.events = [];
  state.match.chests = [];
  state.match.chestSchedule = createChestSchedule();
  state.processedCommandIds = [];
  for (const playerState of Object.values(state.match.players)) {
    const fresh = player(playerState.role);
    fresh.connected = playerState.connected;
    state.match.players[playerState.role] = fresh;
  }
  state.match.nextEntityNumber = 1;
  setPhase(state, "world-selection");
  return null;
}
