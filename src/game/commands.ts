import { setInputIntent } from "./simulation.js";
import {
  confirmWorld,
  pauseMatch,
  requestRematch,
  selectCosmetic,
  selectWorld,
  setPlayerReady,
} from "./state-machine.js";
import type { GameCommand, GameError, GameState } from "./types.js";

/**
 * Applies one validated command to authoritative state. The Durable Object and
 * the local practice host share this reducer so single-player testing exercises
 * exactly the rules that production play uses.
 */
export function applyGameCommand(
  state: GameState,
  command: GameCommand,
): GameError | null {
  switch (command.type) {
    case "input":
      if (state.match.phase !== "playing") {
        return { code: "INVALID_PHASE", messageKey: "fout.verkeerdeSpelfase" };
      }
      setInputIntent(state, command.role, command.intent);
      return null;
    case "ready":
      return setPlayerReady(state, command.role, command.ready);
    case "pause":
      return pauseMatch(state, command.role);
    case "rematch":
      return requestRematch(state, command.role);
    case "select-world":
      return selectWorld(state, command.role, command.world);
    case "confirm-world":
      return confirmWorld(state, command.role);
    case "select-cosmetic":
      return selectCosmetic(state, command.role, command.cosmetic);
  }
}
