import { describe, expect, it } from "vitest";
import { applyMergePatch, createMergePatch, type JsonObject } from "./protocol";

describe("JSON Merge Patch", () => {
  it("sends only changed nested values", () => {
    const before: JsonObject = {
      players: { one: { name: "Ada", taps: 2 }, two: { name: "Sam", taps: 1 } },
      totalTaps: 3,
    };
    const after: JsonObject = structuredClone(before);
    const players = after.players as JsonObject;
    (players.one as JsonObject).taps = 3;
    after.totalTaps = 4;

    expect(createMergePatch(before, after)).toEqual({
      players: { one: { taps: 3 } },
      totalTaps: 4,
    });
  });

  it("applies changes and removes properties", () => {
    expect(
      applyMergePatch(
        { score: 2, lastMove: "tap" },
        { score: 3, lastMove: null },
      ),
    ).toEqual({ score: 3 });
  });
});
