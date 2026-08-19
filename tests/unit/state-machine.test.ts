import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS } from "../../src/game/config";
import {
  advanceLifecycle,
  confirmWorld,
  createInitialGameState,
  finishMatch,
  pauseMatch,
  requestRematch,
  selectCosmetic,
  selectWorld,
  setPlayerConnected,
  setPlayerReady,
} from "../../src/game/state-machine";

function readyGame() {
  const state = createInitialGameState(42);
  setPlayerConnected(state, "luca", true);
  setPlayerConnected(state, "senna", true);
  selectWorld(state, "luca", "beach");
  confirmWorld(state, "senna");
  selectCosmetic(state, "luca", "knight");
  selectCosmetic(state, "senna", "pirate");
  return state;
}

function playingGame() {
  const state = readyGame();
  setPlayerReady(state, "luca", true);
  setPlayerReady(state, "senna", true);
  advanceLifecycle(state, COUNTDOWN_TICKS);
  return state;
}

describe("match lifecycle", () => {
  it("guards selection and starts only after both connected, configured, and ready", () => {
    const state = createInitialGameState();
    expect(selectWorld(state, "luca", "beach")).toMatchObject({
      code: "INVALID_PHASE",
    });
    setPlayerConnected(state, "luca", true);
    expect(state.match.phase).toBe("waiting");
    setPlayerConnected(state, "senna", true);
    expect(state.match.phase).toBe("world-selection");
    expect(selectWorld(state, "senna", "forest")).toMatchObject({
      code: "INVALID_PHASE",
    });
    expect(selectWorld(state, "luca", "beach")).toBeNull();
    expect(confirmWorld(state, "luca")).toMatchObject({
      code: "INVALID_PHASE",
    });
    expect(confirmWorld(state, "senna")).toBeNull();
    expect(setPlayerReady(state, "luca", true)).toMatchObject({
      code: "INVALID_PHASE",
    });

    selectCosmetic(state, "luca", "knight");
    selectCosmetic(state, "senna", "pirate");
    setPlayerReady(state, "luca", true);
    expect(state.match.phase).toBe("ready");
    setPlayerReady(state, "senna", true);
    expect(state.match.phase).toBe("countdown");
    advanceLifecycle(state, COUNTDOWN_TICKS - 1);
    expect(state.match.phase).toBe("countdown");
    advanceLifecycle(state, COUNTDOWN_TICKS);
    expect(state.match.phase).toBe("playing");
  });

  it("freezes held input for pause and resumes only after both ready plus countdown", () => {
    const state = playingGame();
    state.match.players.luca.input.horizontal = 1;
    expect(pauseMatch(state, "senna")).toBeNull();
    expect(state.match.phase).toBe("paused");
    expect(state.match.pausedBy).toBe("senna");
    expect(state.match.players.luca.input.horizontal).toBe(0);

    setPlayerReady(state, "luca", true);
    expect(state.match.phase).toBe("paused");
    setPlayerReady(state, "senna", true);
    const end = state.match.countdownEndsTick!;
    advanceLifecycle(state, end - 1);
    expect(state.match.phase).toBe("countdown");
    advanceLifecycle(state, end);
    expect(state.match.phase).toBe("playing");
  });

  it("enters reconnecting immediately and uses the same safe resume flow", () => {
    const state = playingGame();
    state.match.players.senna.input.attack = true;
    setPlayerConnected(state, "senna", false);
    expect(state.match.phase).toBe("reconnecting");
    expect(state.match.players.senna.input.attack).toBe(false);
    setPlayerConnected(state, "senna", true);
    expect(state.match.phase).toBe("paused");
  });

  it("finishes at zero health and exhaustively resets on mutual rematch", () => {
    const state = playingGame();
    state.match.players.senna.health = 0;
    state.match.entities = [
      {
        id: "old",
        kind: "projectile",
        itemId: "sword",
        owner: "senna",
        position: { x: 1, y: 1 },
        velocity: { x: 1, y: 0 },
        size: { width: 10, height: 10 },
        facing: "left",
        ammo: null,
        expiresAtTick: null,
      },
    ];
    state.match.players.luca.inventory = [
      { id: "sword-1", itemId: "sword", owner: "luca", ammo: null },
    ];
    state.processedCommandIds = ["hit-1"];
    expect(finishMatch(state)).toBeNull();
    expect(state.match.phase).toBe("finished");
    expect(state.match.winner).toBe("luca");

    requestRematch(state, "luca");
    expect(state.match.phase).toBe("finished");
    requestRematch(state, "senna");
    expect(state.match.phase).toBe("world-selection");
    expect(state.lobby.chooser).toBe("senna");
    expect(state.match.entities).toEqual([]);
    expect(state.processedCommandIds).toEqual([]);
    expect(state.match.players.luca).toMatchObject({
      health: 10,
      inventory: [],
      cosmetic: null,
      ready: false,
    });
  });

  it("rejects backward lifecycle time", () => {
    const state = playingGame();
    expect(() => advanceLifecycle(state, state.match.tick - 1)).toThrow(
      RangeError,
    );
  });
});
