import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isReplayFixture, replay } from "../../scripts/replay";

const fixture: unknown = JSON.parse(
  readFileSync("tests/fixtures/phase-06-duel.json", "utf8"),
);

/**
 * The recorded duel is the Phase 6 combat evidence. Asserting its outcomes here
 * turns that evidence into a regression guard: a balance or rule change that
 * alters the duel has to be acknowledged by updating these numbers.
 */
describe("recorded duel", () => {
  if (!isReplayFixture(fixture)) throw new Error("Duel fixture is invalid.");

  it("replays identically twice", () => {
    expect(replay(fixture).hash).toBe(replay(fixture).hash);
  });

  it("ends with the authoritative hearts the recording expects", () => {
    const { state } = replay(fixture);
    expect(state.match.players.luca.health).toBe(8);
    expect(state.match.players.senna.health).toBe(4);
    expect(state.match.phase).toBe("playing");
  });

  it("exercises every base weapon and both block outcomes", () => {
    const { events } = replay(fixture);
    const signature = events.map(
      (event) => `${event.kind}:${event.item}:${event.outcome ?? "-"}`,
    );
    expect(signature).toEqual([
      // Senna opens with a dart that lands.
      "shoot:nerf:-",
      "impact:nerf:hit",
      // An unblocked sword takes two hearts.
      "melee:sword:hit",
      // Blocking a sword still lets one heart through, twice.
      "melee:sword:hit",
      "melee:sword:hit",
      // Holding and releasing attack throws the sword, which also gets through.
      "throw:sword:-",
      "impact:sword:hit",
      // The thrown sword is recovered from the arena with Action.
      "pickup:sword:-",
      "melee:sword:hit",
      "shoot:nerf:-",
      "impact:nerf:hit",
      // Switching to bare fists is visibly shorter ranged and misses.
      "melee:unarmed:miss",
    ]);
    expect(
      events
        .filter((event) => event.damage > 0)
        .reduce((total, event) => total + event.damage, 0),
    ).toBe(8);
  });

  it("leaves no weapon lying in the arena and no stale event", () => {
    const { state, events } = replay(fixture);
    expect(state.match.entities).toEqual([]);
    // The last event happened well over the retention window ago, so nothing is
    // still queued for a reconnecting client to replay as fresh feedback.
    expect(events.at(-1)!.tick).toBeLessThan(state.match.tick - 45);
    expect(state.match.events).toEqual([]);
  });
});
