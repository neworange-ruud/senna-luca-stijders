import { beforeEach, describe, expect, it } from "vitest";

import { CITY_ARENA } from "../../src/game/arenas/city";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { TELEPORT } from "../../src/game/config";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../../src/game/simulation";
import { createInitialGameState } from "../../src/game/state-machine";
import { simulateTeleports } from "../../src/game/teleports";
import { EMPTY_INPUT } from "../../src/game/types";
import type { GameState, MatchEvent, PlayerRole } from "../../src/game/types";

/** A city match with both players on the street, ready to play. */
function cityMatch(): GameState {
  const state = createInitialGameState(7);
  state.match.phase = "playing";
  for (const player of Object.values(state.match.players)) {
    player.connected = true;
  }
  state.lobby.selectedWorld = "city";
  initializeArena(state, CITY_ARENA);
  return state;
}

function standAt(
  state: GameState,
  role: PlayerRole,
  x: number,
  y: number,
): void {
  const player = state.match.players[role];
  player.position = { x: x - player.size.width / 2, y: y - player.size.height };
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
}

function press(state: GameState, role: PlayerRole): void {
  setInputIntent(state, role, { ...EMPTY_INPUT, action: true });
}

function ride(
  state: GameState,
  tick = 10,
  busy: ReadonlySet<PlayerRole> = new Set(),
): readonly MatchEvent[] {
  return simulateTeleports(state, CITY_ARENA, tick, busy);
}

describe("teleports", () => {
  let state: GameState;

  beforeEach(() => {
    state = cityMatch();
  });

  it("takes a player who asks at a lift to the linked lift", () => {
    standAt(state, "luca", 300, 1_200);
    press(state, "luca");
    const events = ride(state);
    expect(events).toMatchObject([{ kind: "teleport", role: "luca" }]);
    const player = state.match.players.luca;
    expect(player.position.y + player.size.height).toBe(880);
    expect(player.position.x + player.size.width / 2).toBe(300);
    expect(player.velocity).toEqual({ x: 0, y: 0 });
  });

  it("leaves a player who is not at a lift where they are", () => {
    standAt(state, "luca", 1_600, 1_200);
    press(state, "luca");
    const before = { ...state.match.players.luca.position };
    expect(ride(state)).toEqual([]);
    expect(state.match.players.luca.position).toEqual(before);
  });

  it("does nothing without a press", () => {
    standAt(state, "luca", 300, 1_200);
    expect(ride(state)).toEqual([]);
    expect(state.match.players.luca.position.y).toBeGreaterThan(1_000);
  });

  it("refuses a second ride until the cooldown has passed", () => {
    standAt(state, "luca", 300, 1_200);
    press(state, "luca");
    expect(ride(state, 10)).toHaveLength(1);

    // Standing on the rooftop lift and asking again immediately.
    press(state, "luca");
    expect(ride(state, 11)).toEqual([]);
    expect(state.match.players.luca.position.y + 96).toBe(880);

    press(state, "luca");
    const events = ride(state, 10 + TELEPORT.cooldownTicks);
    expect(events).toHaveLength(1);
    expect(state.match.players.luca.position.y + 96).toBe(1_200);
  });

  it("slides the arrival sideways when the exit is occupied", () => {
    standAt(state, "luca", 300, 1_200);
    standAt(state, "senna", 300, 880);
    press(state, "luca");
    expect(ride(state)).toMatchObject([{ kind: "teleport", outcome: null }]);
    const luca = state.match.players.luca;
    expect(luca.position.y + luca.size.height).toBe(880);
    expect(luca.position.x + luca.size.width / 2).toBe(396);
  });

  it("reports a lift that cannot put anyone down safely", () => {
    standAt(state, "luca", 2_900, 1_200);
    press(state, "luca");
    // Every arrival offset on the eastern roof is taken or off the roof edge.
    const roof = CITY_ARENA.surfaces.find(
      (surface) => surface.id === "roof-east",
    );
    expect(roof).toBeDefined();
    state.match.players.senna.size = { width: 700, height: 96 };
    standAt(state, "senna", 2_900, 880);
    const events = ride(state);
    expect(events).toMatchObject([{ kind: "teleport", outcome: "blocked" }]);
    expect(state.match.players.luca.position.y + 96).toBe(1_200);
    // A refused ride costs no cooldown.
    expect(state.match.players.luca.teleportReadyTick).toBe(0);
  });

  it("gives the chest to a player who opens one on a lift, and no ride", () => {
    standAt(state, "luca", 300, 1_200);
    press(state, "luca");
    expect(ride(state, 10, new Set<PlayerRole>(["luca"]))).toEqual([]);
    expect(state.match.players.luca.position.y + 96).toBe(1_200);
  });

  it("does not move a player who has no hearts left", () => {
    standAt(state, "luca", 300, 1_200);
    state.match.players.luca.health = 0;
    press(state, "luca");
    expect(ride(state)).toEqual([]);
  });

  it("ignores lifts in a world that has none", () => {
    expect(simulateTeleports(state, BEACH_ARENA, 10, new Set())).toEqual([]);
  });

  it("rides on a tap that starts and ends between two ticks", () => {
    standAt(state, "luca", 300, 1_200);
    setInputIntent(state, "luca", { ...EMPTY_INPUT, action: true });
    setInputIntent(state, "luca", { ...EMPTY_INPUT });
    const step = simulateMovementTick(state, CITY_ARENA);
    expect(
      step.events.filter((event) => event.kind === "teleport"),
    ).toHaveLength(1);
    // The remembered press is used exactly once.
    expect(state.match.players.luca.actionQueued).toBe(false);
  });
});
