import { EMPTY_INPUT, type GameState, type PlayerRole } from "./types.js";

/**
 * A player's browser keeps sending its held controls even when nothing changes,
 * so silence means the connection is in trouble rather than the player standing
 * still. These thresholds are wall-clock, not ticks, because a stalled
 * connection is exactly the case where ticks stop arriving.
 */
export const HEARTBEAT_INTERVAL_MS = 250;
export const HEARTBEAT_STALE_MS = 750;
export const HEARTBEAT_OFFLINE_MS = 2_000;

const ROLES: readonly PlayerRole[] = ["luca", "senna"];

export interface ConnectionHealth {
  /** Roles whose heartbeat is late enough to freeze the match. */
  stale: readonly PlayerRole[];
  /** Roles quiet long enough to be shown as offline. */
  offline: readonly PlayerRole[];
  /** True when this call moved the match into connection pause. */
  paused: boolean;
  /** True when this call changed the state, so the room should publish it. */
  changed: boolean;
}

/** True while the room still has to watch heartbeats and cannot go idle. */
export function watchesHeartbeats(state: GameState): boolean {
  return (
    state.match.phase === "playing" ||
    (state.match.phase === "paused" && state.match.pauseReason === "connection")
  );
}

/**
 * Freezes the whole match as soon as either heartbeat goes quiet.
 *
 * The pause is symmetric on purpose: if only the quiet player were frozen, the
 * other one could keep hitting a target that cannot move or block, so a bad
 * connection would become an advantage. Held intents are cleared immediately so
 * a player who vanishes mid-run does not keep running.
 */
export function applyConnectionHealth(
  state: GameState,
  silenceMs: Readonly<Record<PlayerRole, number>>,
): ConnectionHealth {
  // Heartbeats only mean something while a match is running, or while it is
  // already frozen because of a connection. In a lobby, a countdown, or a pause
  // somebody asked for, nobody is expected to be sending controls, and a real
  // disconnect there is caught by the closing socket instead.
  if (!watchesHeartbeats(state)) {
    return { stale: [], offline: [], paused: false, changed: false };
  }
  const stale = ROLES.filter(
    (role) =>
      state.match.players[role].connected &&
      silenceMs[role] >= HEARTBEAT_STALE_MS,
  );
  const offline = ROLES.filter(
    (role) => silenceMs[role] >= HEARTBEAT_OFFLINE_MS,
  );

  if (stale.length > 0) {
    for (const role of ROLES) {
      state.match.players[role].input = { ...EMPTY_INPUT };
    }
  }
  // Only the flip matters for publishing, so remember who was still online.
  const newlyOffline = offline.filter(
    (role) => state.match.players[role].connected,
  );
  for (const role of offline) {
    state.match.players[role].connected = false;
    state.match.players[role].ready = false;
  }

  const shouldPause = stale.length > 0 && state.match.phase === "playing";
  if (shouldPause) {
    state.match.resumeTarget = "playing";
    state.match.countdownEndsTick = null;
    state.match.pausedBy = null;
    state.match.pauseReason = "connection";
    state.match.phase = "paused";
    state.match.phaseStartedTick = state.match.tick;
    for (const role of ROLES) state.match.players[role].ready = false;
  }
  return {
    stale,
    offline,
    paused: shouldPause,
    changed: shouldPause || newlyOffline.length > 0,
  };
}

/**
 * True when the match may still accept gameplay commands. It takes no role
 * because the rule is symmetric: one quiet heartbeat withdraws the right from
 * both players immediately, before the pause is even visible, so neither a
 * stale client nor its opponent can squeeze in a last command.
 */
export function everyoneCanAct(
  silenceMs: Readonly<Record<PlayerRole, number>>,
): boolean {
  return ROLES.every((role) => silenceMs[role] < HEARTBEAT_STALE_MS);
}
