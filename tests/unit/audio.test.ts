import { describe, expect, it } from "vitest";
import {
  SOUNDS,
  readPreferences,
  soundForEvent,
  type SoundName,
} from "../../src/client/audio";
import type { MatchEvent, MatchEventKind } from "../../src/game/types";

function matchEvent(partial: Partial<MatchEvent>): MatchEvent {
  return {
    id: "event-1",
    tick: 10,
    kind: "melee",
    role: "luca",
    target: "senna",
    item: "unarmed",
    outcome: null,
    damage: 0,
    position: { x: 0, y: 0 },
    ...partial,
  };
}

describe("sound cues", () => {
  const cases: [Partial<MatchEvent>, SoundName | null][] = [
    [{ kind: "melee", outcome: "hit", damage: 1 }, "hit"],
    [{ kind: "melee", outcome: "blocked" }, "block"],
    [{ kind: "melee", outcome: "protected" }, "block"],
    [{ kind: "melee", outcome: "miss" }, "swing"],
    [{ kind: "melee", outcome: "cover" }, "swing"],
    [{ kind: "impact", outcome: "hit", damage: 2 }, "hit"],
    [{ kind: "impact", outcome: "cover" }, "block"],
    [{ kind: "throw", item: "sword" }, "throw"],
    [{ kind: "shoot", item: "nerf" }, "shoot"],
    [{ kind: "empty", item: "nerf" }, "empty"],
    [{ kind: "pickup", item: "sword" }, "pickup"],
    [{ kind: "drop", item: "sword" }, "pickup"],
    [{ kind: "respawn" }, "start"],
    [{ kind: "chest-announced" }, "countdown"],
    [{ kind: "chest-landed" }, "start"],
    [{ kind: "chest-claimed", chestOutcome: "armor" }, "win"],
    [{ kind: "effect-ended", chestOutcome: "speed" }, "empty"],
    [{ kind: "teleport", outcome: null }, "teleport"],
    [{ kind: "teleport", outcome: "blocked" }, "empty"],
  ];

  for (const [partial, expected] of cases) {
    it(`maps ${partial.kind} ${partial.outcome ?? ""} to ${expected}`, () => {
      expect(soundForEvent(matchEvent(partial))).toBe(expected);
    });
  }

  it("has a synthesised recipe for every cue it can return", () => {
    const cues = new Set(
      cases.map(([, expected]) => expected).filter(Boolean) as SoundName[],
    );
    for (const cue of cues) expect(SOUNDS[cue]).toBeDefined();
    for (const recipe of Object.values(SOUNDS)) {
      expect(recipe.seconds).toBeGreaterThan(0);
      expect(recipe.gain).toBeGreaterThan(0);
    }
  });

  it("covers every event kind that gameplay produces", () => {
    const kinds: MatchEventKind[] = [
      "melee",
      "throw",
      "shoot",
      "empty",
      "impact",
      "pickup",
      "drop",
      "respawn",
      "chest-announced",
      "chest-landed",
      "chest-claimed",
      "effect-ended",
      "teleport",
    ];
    for (const kind of kinds) {
      expect(soundForEvent(matchEvent({ kind }))).not.toBeNull();
    }
  });
});

describe("audio preferences", () => {
  it("starts with effects on and music off", () => {
    expect(readPreferences(null)).toEqual({
      effectsMuted: false,
      musicMuted: true,
    });
  });

  it("restores stored choices", () => {
    const storage = {
      getItem: () => JSON.stringify({ effectsMuted: true, musicMuted: false }),
    };
    expect(readPreferences(storage)).toEqual({
      effectsMuted: true,
      musicMuted: false,
    });
  });

  it("survives unreadable storage", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPreferences(storage)).toEqual({
      effectsMuted: false,
      musicMuted: true,
    });
  });
});
