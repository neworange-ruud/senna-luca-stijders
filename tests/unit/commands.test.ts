import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach.js";
import { applyGameCommand } from "../../src/game/commands.js";
import { createPracticeState } from "../../src/game/practice.js";
import { createInitialGameState } from "../../src/game/state-machine.js";
import { EMPTY_INPUT, type GameCommand } from "../../src/game/types.js";

function command(overrides: Partial<GameCommand> & { type: string }) {
  return {
    id: `luca-${overrides.type}`,
    role: "luca",
    sequence: 1,
    ...overrides,
  } as GameCommand;
}

describe("shared command reducer", () => {
  it("rejects input outside the playing phase and accepts it during play", () => {
    const lobby = createInitialGameState(7);
    expect(
      applyGameCommand(lobby, command({ type: "input", intent: EMPTY_INPUT })),
    ).toMatchObject({ code: "INVALID_PHASE" });

    const playing = createPracticeState("luca", { arena: BEACH_ARENA });
    const intent = { ...EMPTY_INPUT, horizontal: 1 as const, jump: true };
    expect(
      applyGameCommand(playing, command({ type: "input", intent })),
    ).toBeNull();
    expect(playing.match.players.luca.input).toMatchObject(intent);
  });

  it("routes lobby commands to the same rules the Durable Object uses", () => {
    const state = createInitialGameState(7);
    state.match.players.luca.connected = true;
    state.match.players.senna.connected = true;
    state.match.phase = "world-selection";
    expect(
      applyGameCommand(
        state,
        command({ type: "select-world", world: "beach" }),
      ),
    ).toBeNull();
    expect(state.lobby.selectedWorld).toBe("beach");
    expect(
      applyGameCommand(
        state,
        command({ type: "select-cosmetic", cosmetic: "knight" }),
      ),
    ).toBeNull();
    expect(state.match.players.luca.cosmetic).toBe("knight");
    expect(
      applyGameCommand(
        state,
        command({ type: "confirm-world", role: "senna" }),
      ),
    ).toBeNull();
    expect(state.match.phase).toBe("ready");
    expect(applyGameCommand(state, command({ type: "pause" }))).toMatchObject({
      code: "INVALID_PHASE",
    });
  });
});
