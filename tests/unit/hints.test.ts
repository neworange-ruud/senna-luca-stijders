import { describe, expect, it } from "vitest";

import {
  chooseHint,
  readLearned,
  writeLearned,
  type HintId,
  type HintState,
} from "../../src/client/hints";

function hintState(partial: Partial<HintState> = {}): HintState {
  return {
    phase: "playing",
    used: new Set<HintId>(),
    learned: new Set<HintId>(),
    opponentDistance: 120,
    chestWithinReach: false,
    teleportLabel: null,
    holdsTwoWeapons: false,
    ...partial,
  };
}

describe("hints", () => {
  it("explains walking during the countdown", () => {
    expect(chooseHint(hintState({ phase: "countdown" }))?.id).toBe("move");
  });

  it("says nothing outside a match", () => {
    for (const phase of [
      "waiting",
      "world-selection",
      "ready",
      "paused",
      "reconnecting",
      "finished",
    ] as const) {
      expect(chooseHint(hintState({ phase }))).toBeNull();
    }
  });

  it("walks through the controls one at a time", () => {
    const used = new Set<HintId>();
    const order: HintId[] = [];
    for (let step = 0; step < 6; step += 1) {
      const hint = chooseHint(
        hintState({ used, holdsTwoWeapons: true, opponentDistance: 80 }),
      );
      if (!hint) break;
      order.push(hint.id);
      used.add(hint.id);
    }
    expect(order).toEqual([
      "move",
      "jump",
      "attack",
      "block",
      "switch",
      "pause",
    ]);
  });

  it("stops explaining a control the child already uses", () => {
    const hint = chooseHint(hintState({ used: new Set<HintId>(["move"]) }));
    expect(hint?.id).toBe("jump");
  });

  it("never repeats what an earlier match already taught", () => {
    const learned = new Set<HintId>([
      "move",
      "jump",
      "attack",
      "block",
      "switch",
      "pause",
    ]);
    expect(chooseHint(hintState({ learned }))).toBeNull();
  });

  it("does not ask for an attack while the other player is far away", () => {
    const used = new Set<HintId>(["move", "jump"]);
    expect(chooseHint(hintState({ used, opponentDistance: 900 }))?.id).toBe(
      "block",
    );
  });

  it("only mentions switching when there is a second weapon", () => {
    const used = new Set<HintId>(["move", "jump", "attack", "block"]);
    expect(chooseHint(hintState({ used }))?.id).toBe("pause");
    expect(chooseHint(hintState({ used, holdsTwoWeapons: true }))?.id).toBe(
      "switch",
    );
  });

  it("puts a lift and a chest before the lesson plan", () => {
    const learned = new Set<HintId>();
    expect(chooseHint(hintState({ learned, chestWithinReach: true }))?.id).toBe(
      "chest",
    );
    const lift = chooseHint(
      hintState({ teleportLabel: "Lift west", chestWithinReach: true }),
    );
    expect(lift?.id).toBe("teleport");
    expect(lift?.text).toContain("Lift west");
  });

  it("keeps showing the lift even to a child who knows the game", () => {
    const learned = new Set<HintId>([
      "move",
      "jump",
      "attack",
      "block",
      "switch",
      "pause",
      "teleport",
    ]);
    expect(
      chooseHint(hintState({ learned, teleportLabel: "Lift oost" }))?.id,
    ).toBe("teleport");
  });

  it("survives storage that is missing or damaged", () => {
    expect([...readLearned(null)]).toEqual([]);
    expect([...readLearned("not json")]).toEqual([]);
    expect([...readLearned('{"a":1}')]).toEqual([]);
    expect([...readLearned('["move","jump"]')]).toEqual(["move", "jump"]);
  });

  it("writes what it can read back", () => {
    const learned = new Set<HintId>(["move", "chest"]);
    expect(readLearned(writeLearned(learned))).toEqual(learned);
  });

  it("writes every hint in Dutch", () => {
    const texts = new Set<string>();
    const used = new Set<HintId>();
    for (let step = 0; step < 8; step += 1) {
      const hint = chooseHint(
        hintState({ used, holdsTwoWeapons: true, opponentDistance: 60 }),
      );
      if (!hint) break;
      texts.add(hint.text);
      used.add(hint.id);
    }
    for (const text of texts) {
      expect(text).toMatch(/^[A-Z]/);
      expect(text).not.toMatch(/\b(press|the|button|jump|attack)\b/i);
    }
  });
});
