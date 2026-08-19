import { describe, expect, it } from "vitest";
import {
  acceptCommand,
  EntityIdSequence,
  SeededRandom,
  TickClock,
  type SequenceState,
} from "../../src/game/determinism";

describe("deterministic primitives", () => {
  it("advances only by whole non-negative ticks", () => {
    const clock = new TickClock(4);
    expect(clock.advance(3)).toBe(7);
    expect(() => clock.advance(0.5)).toThrow(RangeError);
    expect(() => new TickClock(-1)).toThrow(RangeError);
  });

  it("replays the same random sequence and exposes restorable state", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    const values = Array.from({ length: 20 }, () => first.next());

    expect(Array.from({ length: 20 }, () => second.next())).toEqual(values);
    expect(first.state).toBe(second.state);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("creates stable monotonic entity IDs", () => {
    const ids = new EntityIdSequence("match7");
    expect([ids.next(), ids.next(), ids.nextNumber]).toEqual([
      "match7-0001",
      "match7-0002",
      3,
    ]);
  });

  it("accepts each monotonic command exactly once", () => {
    const state: SequenceState = {
      lastByRole: { luca: 0, senna: 0 },
      processedIds: new Set(),
    };
    expect(
      acceptCommand(state, { id: "a", role: "luca", sequence: 1 }),
    ).toEqual({
      accepted: true,
    });
    expect(
      acceptCommand(state, { id: "a", role: "luca", sequence: 2 }),
    ).toMatchObject({
      accepted: false,
      error: { code: "DUPLICATE_COMMAND" },
    });
    expect(
      acceptCommand(state, { id: "b", role: "luca", sequence: 1 }),
    ).toMatchObject({
      accepted: false,
      error: { code: "STALE_SEQUENCE" },
    });
    expect(
      acceptCommand(state, { id: "c", role: "senna", sequence: 1 }),
    ).toEqual({
      accepted: true,
    });
  });
});
