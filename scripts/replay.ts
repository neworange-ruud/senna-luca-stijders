import { createHash } from "node:crypto";
import { BEACH_ARENA } from "../src/game/arenas/beach.js";
import { createItem, giveItem } from "../src/game/items.js";
import { createInitialGameState } from "../src/game/state-machine.js";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../src/game/simulation.js";
import {
  EMPTY_INPUT,
  GAME_PROTOCOL_VERSION,
  GAME_SCHEMA_VERSION,
  isPlayerRole,
  type GameSnapshot,
  type GameState,
  type ItemId,
  type MatchEvent,
  type PlayerRole,
} from "../src/game/types.js";

export interface ReplayInput {
  tick: number;
  role: PlayerRole;
  horizontal: -1 | 0 | 1;
  jump: boolean;
  attack?: boolean;
  block?: boolean;
  action?: boolean;
  switchWeapon?: boolean;
}

export interface ReplayFixture {
  seed: number;
  ticks: number;
  inputs: ReplayInput[];
  /** Weapons each role starts the replay holding, for combat fixtures. */
  weapons?: Partial<Record<PlayerRole, ItemId>>;
  /** Start positions, so a duel fixture does not need a long approach run. */
  positions?: Partial<Record<PlayerRole, { x: number; y: number }>>;
}

export interface ReplayResult {
  hash: string;
  summary: string;
  state: GameState;
  /** Every event the replay produced, including ones already pruned from state. */
  events: MatchEvent[];
}

export function isReplayFixture(value: unknown): value is ReplayFixture {
  if (!value || typeof value !== "object") return false;
  const fixture = value as Partial<ReplayFixture>;
  return (
    Number.isSafeInteger(fixture.seed) &&
    Number.isSafeInteger(fixture.ticks) &&
    (fixture.ticks ?? 0) > 0 &&
    Array.isArray(fixture.inputs)
  );
}

/**
 * Replays a recorded input fixture against the pure game rules. The same
 * function backs the command line tool and the regression test, so a recorded
 * duel is both human-inspectable evidence and an automated guard.
 */
export function replay(fixture: ReplayFixture): ReplayResult {
  const state = createInitialGameState(fixture.seed);
  state.match.phase = "playing";
  state.match.players.luca.connected = true;
  state.match.players.senna.connected = true;
  initializeArena(state, BEACH_ARENA);
  for (const [role, itemId] of Object.entries(fixture.weapons ?? {})) {
    if (!isPlayerRole(role) || !itemId) continue;
    giveItem(state.match.players[role], createItem(state, itemId, role));
  }
  for (const [role, position] of Object.entries(fixture.positions ?? {})) {
    if (!isPlayerRole(role) || !position) continue;
    state.match.players[role].position = { ...position };
    state.match.players[role].facing = role === "luca" ? "right" : "left";
  }

  const events: MatchEvent[] = [];
  for (let tick = 0; tick < fixture.ticks; tick += 1) {
    for (const input of fixture.inputs.filter(
      (candidate) => candidate.tick === tick,
    )) {
      setInputIntent(state, input.role, {
        ...EMPTY_INPUT,
        horizontal: input.horizontal,
        jump: input.jump,
        attack: input.attack === true,
        block: input.block === true,
        action: input.action === true,
        switchWeapon: input.switchWeapon === true,
      });
    }
    events.push(...simulateMovementTick(state, BEACH_ARENA).events);
  }

  const snapshot: GameSnapshot = {
    schemaVersion: GAME_SCHEMA_VERSION,
    protocolVersion: GAME_PROTOCOL_VERSION,
    revision: 1,
    tick: state.match.tick,
    acknowledgedSequences: { luca: 0, senna: 0 },
    state,
  };
  const { luca, senna } = state.match.players;
  return {
    hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    state,
    events,
    summary: [
      `tick=${state.match.tick}`,
      `phase=${state.match.phase}`,
      `luca=${luca.health} hearts/${luca.inventory.length} weapons`,
      `senna=${senna.health} hearts/${senna.inventory.length} weapons`,
      `entities=${state.match.entities.length}`,
      `events=${events.length}`,
    ].join(", "),
  };
}
