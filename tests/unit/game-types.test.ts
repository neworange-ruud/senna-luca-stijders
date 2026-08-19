import { describe, expect, it } from "vitest";
import {
  EMPTY_INPUT,
  isGameError,
  parseGameCommand,
} from "../../src/game/types";

describe("game command schema", () => {
  it("accepts a complete versioned input command shape", () => {
    const command = parseGameCommand({
      type: "input",
      id: "luca-1",
      role: "luca",
      sequence: 1,
      intent: { ...EMPTY_INPUT, horizontal: 1, jump: true },
    });

    expect(isGameError(command)).toBe(false);
    expect(command).toMatchObject({ type: "input", role: "luca", sequence: 1 });
  });

  it.each([
    null,
    {},
    { type: "pause", id: "", role: "luca", sequence: 1 },
    { type: "pause", id: "x", role: "ander", sequence: 1 },
    { type: "input", id: "x", role: "luca", sequence: -1, intent: EMPTY_INPUT },
    {
      type: "input",
      id: "x",
      role: "luca",
      sequence: 1,
      intent: { ...EMPTY_INPUT, horizontal: 2 },
    },
  ])("rejects malformed command %#", (value) => {
    expect(parseGameCommand(value)).toEqual({
      code: "INVALID_MESSAGE",
      messageKey: "fout.ongeldigBericht",
    });
  });
});
