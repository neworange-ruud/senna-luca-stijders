import { COMBAT } from "./config.js";
import type { GameState, MatchEvent } from "./types.js";

/**
 * Appends authoritative feedback events and drops the ones the browser has
 * already had time to show. Pruning matters for correctness as well as size: a
 * client that reconnects must not replay a hit that happened a minute ago.
 */
export function recordEvents(
  state: GameState,
  events: readonly MatchEvent[],
): void {
  if (events.length === 0 && state.match.events.length === 0) return;
  const oldest = state.match.tick - COMBAT.eventRetentionTicks;
  state.match.events = [...state.match.events, ...events]
    .filter((event) => event.tick >= oldest)
    .slice(-COMBAT.maximumEvents);
}
