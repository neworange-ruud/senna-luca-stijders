import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { simulateChests } from "../../src/game/chests";
import { applyGameCommand } from "../../src/game/commands";
import { COUNTDOWN_TICKS } from "../../src/game/config";
import {
  HEARTBEAT_OFFLINE_MS,
  HEARTBEAT_STALE_MS,
  applyConnectionHealth,
  everyoneCanAct,
} from "../../src/game/connection";
import { applyEffect } from "../../src/game/effects";
import { createItem, giveItem } from "../../src/game/items";
import {
  initializeArena,
  simulateMovementTick,
} from "../../src/game/simulation";
import {
  advanceLifecycle,
  createInitialGameState,
  pauseMatch,
  setPlayerConnected,
} from "../../src/game/state-machine";
import {
  EMPTY_INPUT,
  type GameState,
  type MatchPhase,
  type PlayerRole,
} from "../../src/game/types";

function playingMatch(): GameState {
  const state = createInitialGameState(11);
  for (const role of ["luca", "senna"] as const) {
    state.match.players[role].connected = true;
    state.match.players[role].cosmetic = "knight";
  }
  state.match.phase = "playing";
  initializeArena(state, BEACH_ARENA);
  return state;
}

const silence = (luca: number, senna: number) => ({ luca, senna });

describe("player pause", () => {
  it("freezes every clock and records who asked for it", () => {
    const state = playingMatch();
    applyEffect(state.match.players.luca, "speed");
    // Let the match run far enough to have a chest on its way.
    for (let index = 0; index < 250; index += 1) {
      simulateMovementTick(state, BEACH_ARENA);
    }
    const frozen = {
      tick: state.match.tick,
      chests: state.match.chests.length,
      announcement: state.match.chestSchedule.nextAnnouncementTick,
      effect: state.match.players.luca.effects[0]?.remainingTicks,
      position: { ...state.match.players.luca.position },
    };
    expect(frozen.chests).toBeGreaterThan(0);

    expect(pauseMatch(state, "senna")).toBeNull();
    expect(state.match.pausedBy).toBe("senna");
    expect(state.match.pauseReason).toBe("player");

    // Held controls are dropped, so nobody keeps running while paused.
    for (const role of ["luca", "senna"] as const) {
      expect(state.match.players[role].input).toEqual(EMPTY_INPUT);
      state.match.players[role].input = { ...EMPTY_INPUT, horizontal: 1 };
    }
    for (let index = 0; index < 200; index += 1) {
      simulateMovementTick(state, BEACH_ARENA);
      simulateChests(state, BEACH_ARENA, state.match.tick);
    }

    expect(state.match.tick).toBe(frozen.tick);
    expect(state.match.chests).toHaveLength(frozen.chests);
    expect(state.match.chestSchedule.nextAnnouncementTick).toBe(
      frozen.announcement,
    );
    expect(state.match.players.luca.effects[0]?.remainingTicks).toBe(
      frozen.effect,
    );
    expect(state.match.players.luca.position).toEqual(frozen.position);
  });

  it("resumes only after both players are ready, through a countdown", () => {
    const state = playingMatch();
    pauseMatch(state, "luca");
    expect(
      applyGameCommand(state, {
        type: "ready",
        id: "r1",
        role: "luca",
        sequence: 1,
        ready: true,
      }),
    ).toBeNull();
    expect(state.match.phase).toBe("paused");

    applyGameCommand(state, {
      type: "ready",
      id: "r2",
      role: "senna",
      sequence: 1,
      ready: true,
    });
    expect(state.match.phase).toBe("countdown");
    advanceLifecycle(state, state.match.tick + COUNTDOWN_TICKS);
    expect(state.match.phase).toBe("playing");
    // The reason and the requester are cleared when play resumes.
    expect(state.match.pausedBy).toBeNull();
    expect(state.match.pauseReason).toBeNull();
  });
});

describe("heartbeat staleness", () => {
  it("freezes the whole match for both players when one goes quiet", () => {
    const state = playingMatch();
    for (const role of ["luca", "senna"] as const) {
      state.match.players[role].input = { ...EMPTY_INPUT, horizontal: 1 };
    }
    const health = applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    expect(health.stale).toEqual(["senna"]);
    expect(health.paused).toBe(true);
    expect(state.match.phase).toBe("paused");
    expect(state.match.pauseReason).toBe("connection");
    expect(state.match.pausedBy).toBeNull();

    // Neither player keeps a held control, so neither keeps moving.
    for (const role of ["luca", "senna"] as const) {
      expect(state.match.players[role].input).toEqual(EMPTY_INPUT);
    }
  });

  it("refuses gameplay from both players while either heartbeat is late", () => {
    expect(everyoneCanAct(silence(0, 0))).toBe(true);
    expect(everyoneCanAct(silence(0, HEARTBEAT_STALE_MS))).toBe(false);
    expect(everyoneCanAct(silence(HEARTBEAT_STALE_MS, 0))).toBe(false);
    expect(everyoneCanAct(silence(0, HEARTBEAT_STALE_MS - 1))).toBe(true);
  });

  it("marks the quiet role offline only after two seconds", () => {
    const state = playingMatch();
    applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    expect(state.match.players.senna.connected).toBe(true);
    applyConnectionHealth(state, silence(0, HEARTBEAT_OFFLINE_MS));
    expect(state.match.players.senna.connected).toBe(false);
    expect(state.match.players.luca.connected).toBe(true);
  });

  it("leaves an already paused or finished match alone", () => {
    for (const phase of ["paused", "finished", "world-selection"] as const) {
      const state = playingMatch();
      state.match.phase = phase;
      const health = applyConnectionHealth(
        state,
        silence(0, HEARTBEAT_STALE_MS),
      );
      expect(health.paused).toBe(false);
      expect(state.match.phase as MatchPhase).toBe(phase);
    }
  });

  it("carries on by itself after a stall that never became an absence", () => {
    const state = playingMatch();
    applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    expect(state.match.phase).toBe("paused");
    expect(state.match.pauseEscalated).toBe(false);

    // The connection comes back well before anybody is called absent. Neither
    // child should have to press a button after a one-second stall.
    const health = applyConnectionHealth(state, silence(0, 0));
    expect(health.resumed).toBe(true);
    expect(health.changed).toBe(true);
    expect(state.match.phase).toBe("countdown");
    expect(state.match.resumeTarget).toBe("playing");
    expect(state.match.pauseReason).toBeNull();
    // The countdown still runs, so nobody is dropped straight into a fight.
    expect(state.match.countdownEndsTick).toBe(state.match.tick + 90);
    for (const role of ["luca", "senna"] as const) {
      expect(state.match.players[role].ready).toBe(false);
    }
  });

  it("waits for both children when somebody was really gone", () => {
    const state = playingMatch();
    applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    applyConnectionHealth(state, silence(0, HEARTBEAT_OFFLINE_MS));
    expect(state.match.pauseEscalated).toBe(true);

    // Even once the absent player is back and answering, the match stays frozen
    // until both of them say they are ready.
    state.match.players.senna.connected = true;
    const health = applyConnectionHealth(state, silence(0, 0));
    expect(health.resumed).toBe(false);
    expect(state.match.phase).toBe("paused");
    expect(state.match.pauseReason).toBe("connection");
  });

  it("never resumes a pause a child asked for", () => {
    const state = playingMatch();
    expect(pauseMatch(state, "luca")).toBeNull();
    expect(state.match.pauseReason).toBe("player");
    const health = applyConnectionHealth(state, silence(0, 0));
    expect(health.resumed).toBe(false);
    expect(state.match.phase).toBe("paused");
    expect(state.match.pausedBy).toBe("luca");
  });

  it("does not resume while one side is still quiet", () => {
    const state = playingMatch();
    applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    const health = applyConnectionHealth(state, silence(0, HEARTBEAT_STALE_MS));
    expect(health.resumed).toBe(false);
    expect(state.match.phase).toBe("paused");
  });

  it("does not report a role that never connected as stale", () => {
    const state = createInitialGameState(3);
    const health = applyConnectionHealth(
      state,
      silence(HEARTBEAT_STALE_MS, HEARTBEAT_STALE_MS),
    );
    expect(health.stale).toEqual([]);
    expect(health.paused).toBe(false);
  });
});

describe("reconnecting", () => {
  it("parks the match until both players are back, then waits for ready", () => {
    const state = playingMatch();
    setPlayerConnected(state, "senna", false);
    expect(state.match.phase).toBe("reconnecting");
    expect(state.match.players.senna.input).toEqual(EMPTY_INPUT);

    setPlayerConnected(state, "senna", true);
    expect(state.match.phase).toBe("paused");
    for (const role of ["luca", "senna"] as const) {
      expect(state.match.players[role].ready).toBe(false);
    }
  });

  it("keeps one match with one set of players across a reconnect", () => {
    const state = playingMatch();
    giveItem(state.match.players.luca, createItem(state, "sword", "luca"));
    state.match.players.senna.health = 7;
    for (let index = 0; index < 250; index += 1) {
      simulateMovementTick(state, BEACH_ARENA);
    }
    const before = {
      chests: state.match.chests.map((chest) => chest.id),
      entities: state.match.entities.map((entity) => entity.id),
      inventory: state.match.players.luca.inventory.map((item) => item.id),
      health: state.match.players.senna.health,
    };

    setPlayerConnected(state, "luca", false);
    setPlayerConnected(state, "luca", true);

    expect(Object.keys(state.match.players)).toEqual(["luca", "senna"]);
    expect(state.match.chests.map((chest) => chest.id)).toEqual(before.chests);
    expect(state.match.entities.map((entity) => entity.id)).toEqual(
      before.entities,
    );
    expect(state.match.players.luca.inventory.map((item) => item.id)).toEqual(
      before.inventory,
    );
    expect(state.match.players.senna.health).toBe(before.health);
  });
});

describe("disconnecting from every phase", () => {
  const phases: MatchPhase[] = [
    "waiting",
    "world-selection",
    "ready",
    "countdown",
    "playing",
    "paused",
    "reconnecting",
    "finished",
  ];

  it("never leaves a phase where the missing player could still be needed", () => {
    for (const phase of phases) {
      const state = playingMatch();
      state.match.phase = phase;
      state.match.players.senna.ready = true;
      state.match.players.senna.input = { ...EMPTY_INPUT, horizontal: 1 };

      setPlayerConnected(state, "senna", false);

      // Held controls are always dropped and readiness never survives.
      expect(state.match.players.senna.input).toEqual(EMPTY_INPUT);
      expect(state.match.players.senna.ready).toBe(false);
      expect(state.match.players.senna.connected).toBe(false);
      // A match that was underway waits; a lobby phase simply stays put.
      const expected: MatchPhase = ["countdown", "playing", "paused"].includes(
        phase,
      )
        ? "reconnecting"
        : phase;
      expect(state.match.phase, phase).toBe(expected);
    }
  });

  it("cannot be acted on by the player who left", () => {
    const state = playingMatch();
    setPlayerConnected(state, "senna", false);
    for (const command of [
      { type: "pause" as const },
      { type: "ready" as const, ready: true },
      { type: "rematch" as const },
    ]) {
      expect(
        applyGameCommand(state, {
          ...command,
          id: `gone-${command.type}`,
          role: "senna",
          sequence: 4,
        }),
      ).toMatchObject({ code: "INVALID_PHASE" });
    }
  });
});

describe("finish and rematch", () => {
  function finishedMatch(): GameState {
    const state = playingMatch();
    giveItem(state.match.players.luca, createItem(state, "sword", "luca"));
    state.match.players.senna.health = 0;
    state.match.players.senna.input = { ...EMPTY_INPUT, horizontal: 1 };
    simulateMovementTick(state, BEACH_ARENA);
    return state;
  }

  it("needs both players before it resets, and remembers who asked", () => {
    const state = finishedMatch();
    expect(state.match.phase).toBe("finished");
    expect(state.match.winner).toBe("luca");

    expect(
      applyGameCommand(state, {
        type: "rematch",
        id: "m1",
        role: "luca",
        sequence: 5,
      }),
    ).toBeNull();
    expect(state.match.phase).toBe("finished");
    expect(state.match.players.luca.ready).toBe(true);

    applyGameCommand(state, {
      type: "rematch",
      id: "m2",
      role: "senna",
      sequence: 5,
    });
    expect(state.match.phase).toBe("world-selection");
  });

  it("leaves nothing from the previous match behind", () => {
    const state = finishedMatch();
    applyEffect(state.match.players.luca, "armor");
    state.match.entities = [
      {
        id: "old-sword",
        kind: "dropped-item",
        itemId: "sword",
        owner: "luca",
        position: { x: 10, y: 10 },
        velocity: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        facing: "right",
        ammo: null,
        expiresAtTick: null,
      },
    ];
    const staleIds = [
      ...state.match.entities.map((entity) => entity.id),
      ...state.match.chests.map((chest) => chest.id),
      ...state.match.players.luca.inventory.map((item) => item.id),
    ];

    for (const role of ["luca", "senna"] as const) {
      applyGameCommand(state, {
        type: "rematch",
        id: `reset-${role}`,
        role,
        sequence: 9,
      });
    }

    const serialised = JSON.stringify(state.match);
    for (const id of staleIds) expect(serialised).not.toContain(id);
    expect(state.match.entities).toEqual([]);
    expect(state.match.chests).toEqual([]);
    expect(state.match.events).toEqual([]);
    expect(state.match.winner).toBeNull();
    expect(state.processedCommandIds).toEqual([]);
    for (const role of ["luca", "senna"] as const) {
      const player = state.match.players[role];
      expect(player.health).toBe(10);
      expect(player.inventory).toEqual([]);
      expect(player.effects).toEqual([]);
      expect(player.ready).toBe(false);
      expect(player.connected).toBe(true);
    }
  });

  it("hands the next world choice to the other player", () => {
    const chooserAfter = (matches: number): PlayerRole => {
      const state = finishedMatch();
      state.lobby.completedMatches = matches;
      for (const role of ["luca", "senna"] as const) {
        applyGameCommand(state, {
          type: "rematch",
          id: `c-${matches}-${role}`,
          role,
          sequence: 3,
        });
      }
      return state.lobby.chooser;
    };
    // Luca chooses the first match, so Senna chooses the second.
    expect(chooserAfter(0)).toBe("senna");
    expect(chooserAfter(1)).toBe("luca");
  });

  it("refuses a rematch from a player who is not connected", () => {
    const state = finishedMatch();
    state.match.players.senna.connected = false;
    expect(
      applyGameCommand(state, {
        type: "rematch",
        id: "m3",
        role: "senna",
        sequence: 7,
      }),
    ).toMatchObject({ code: "INVALID_PHASE" });
  });
});
