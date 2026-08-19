import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach.js";
import { MELEE } from "../../src/game/config.js";
import {
  PRACTICE_BEHAVIOURS,
  PRACTICE_BEHAVIOUR_LABELS,
  createPracticeState,
  practiceBotIntent,
  practiceOpponent,
} from "../../src/game/practice.js";
import { simulateMovementTick } from "../../src/game/simulation.js";
import type { GameState } from "../../src/game/types.js";

function practice(): GameState {
  return createPracticeState("luca", { arena: BEACH_ARENA });
}

function place(state: GameState, lucaX: number, sennaX: number): void {
  state.match.players.luca.position.x = lucaX;
  state.match.players.senna.position.x = sennaX;
}

describe("practice mode", () => {
  it("starts a playable match for one player with both roles present", () => {
    const state = practice();
    expect(state.match.phase).toBe("playing");
    expect(state.match.arenaId).toBe("beach");
    expect(state.match.players.luca.connected).toBe(true);
    expect(state.match.players.senna.connected).toBe(true);
    expect(state.match.players.luca.health).toBe(10);
    expect(state.match.players.senna.health).toBe(10);
    expect(state.match.players.luca.cosmetic).not.toBeNull();
    expect(state.match.players.senna.cosmetic).not.toBeNull();
    expect(state.match.players.luca.inventory).toHaveLength(0);
  });

  it("labels every behaviour in Dutch", () => {
    for (const behaviour of PRACTICE_BEHAVIOURS) {
      expect(PRACTICE_BEHAVIOUR_LABELS[behaviour].length).toBeGreaterThan(2);
    }
    expect(practiceOpponent("luca")).toBe("senna");
    expect(practiceOpponent("senna")).toBe("luca");
  });

  it("stands still when idle and while the match is not playing", () => {
    const state = practice();
    place(state, 400, 1_200);
    expect(practiceBotIntent(state, "senna", "idle")).toMatchObject({
      horizontal: 0,
      jump: false,
      attack: false,
    });
    state.match.phase = "paused";
    expect(practiceBotIntent(state, "senna", "fight")).toMatchObject({
      horizontal: 0,
      attack: false,
    });
  });

  it("follows the player from either side and stops when close", () => {
    const state = practice();
    place(state, 400, 1_200);
    expect(practiceBotIntent(state, "senna", "follow").horizontal).toBe(-1);
    place(state, 1_600, 1_200);
    expect(practiceBotIntent(state, "senna", "follow").horizontal).toBe(1);
    place(state, 1_200, 1_260);
    expect(practiceBotIntent(state, "senna", "follow").horizontal).toBe(0);
  });

  it("runs away and jumps only when the player is near", () => {
    const state = practice();
    place(state, 1_100, 1_200);
    const near = practiceBotIntent(state, "senna", "flee");
    expect(near.horizontal).toBe(1);
    expect(near.jump).toBe(true);
    place(state, 200, 1_200);
    const far = practiceBotIntent(state, "senna", "flee");
    expect(far.horizontal).toBe(1);
    expect(far.jump).toBe(false);
  });

  it("attacks in range, blocks while cooling down, and never predicts damage", () => {
    const state = practice();
    place(state, 1_200 - MELEE.unarmed.range, 1_200);
    const bot = state.match.players.senna;
    const inRange = practiceBotIntent(state, "senna", "fight", 100);
    expect(inRange.attack).toBe(true);
    expect(inRange.block).toBe(false);

    bot.nextAttackTick = 120;
    state.match.players.luca.input = {
      ...state.match.players.luca.input,
      attack: true,
    };
    const cooling = practiceBotIntent(state, "senna", "fight", 100);
    expect(cooling.attack).toBe(false);
    expect(cooling.block).toBe(true);

    place(state, 200, 1_200);
    const outOfRange = practiceBotIntent(state, "senna", "fight", 100);
    expect(outOfRange.attack).toBe(false);
    expect(outOfRange.block).toBe(false);
    expect(outOfRange.horizontal).toBe(-1);
  });

  it("reaches the player and lands authoritative hits in a solo session", () => {
    const state = createPracticeState("luca", { arena: BEACH_ARENA });
    for (let tick = 0; tick < 600; tick += 1) {
      state.match.players.senna.input = practiceBotIntent(
        state,
        "senna",
        "fight",
      );
      simulateMovementTick(state, BEACH_ARENA);
      if (state.match.phase !== "playing") break;
    }
    expect(state.match.players.luca.health).toBeLessThan(10);
    expect(state.match.players.senna.health).toBe(10);
  });
});
