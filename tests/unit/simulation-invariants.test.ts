import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { SeededRandom } from "../../src/game/determinism";
import { createItem, giveItem } from "../../src/game/items";
import { createInitialGameState } from "../../src/game/state-machine";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../../src/game/simulation";
import {
  EMPTY_INPUT,
  type MatchPhase,
  type PlayerRole,
} from "../../src/game/types";

describe("movement invariants", () => {
  it("keeps player state finite and health bounded through a long seeded run", () => {
    const state = createInitialGameState(9);
    const random = new SeededRandom(9);
    state.match.phase = "playing";
    initializeArena(state, BEACH_ARENA);

    for (let tick = 0; tick < 10_000; tick += 1) {
      for (const role of [
        "luca",
        "senna",
      ] as const satisfies readonly PlayerRole[]) {
        const horizontal = (random.integer(3) - 1) as -1 | 0 | 1;
        setInputIntent(state, role, {
          ...EMPTY_INPUT,
          horizontal,
          jump: random.next() < 0.04,
        });
      }
      simulateMovementTick(state, BEACH_ARENA);

      for (const player of Object.values(state.match.players)) {
        expect(Number.isFinite(player.position.x)).toBe(true);
        expect(Number.isFinite(player.position.y)).toBe(true);
        expect(Number.isFinite(player.velocity.x)).toBe(true);
        expect(Number.isFinite(player.velocity.y)).toBe(true);
        expect(player.health).toBeGreaterThanOrEqual(0);
        expect(player.health).toBeLessThanOrEqual(10);
      }
    }
    expect(state.match.tick).toBe(10_000);
  });
});

describe("combat invariants", () => {
  it("holds every combat rule through a long seeded brawl", () => {
    const state = createInitialGameState(21);
    const random = new SeededRandom(21);
    state.match.phase = "playing";
    initializeArena(state, BEACH_ARENA);
    // Both fighters start armed and close enough to keep hitting each other.
    state.match.players.luca.position = { x: 700, y: 1_104 };
    state.match.players.senna.position = { x: 800, y: 1_104 };
    giveItem(state.match.players.luca, createItem(state, "sword", "luca"));
    giveItem(state.match.players.senna, createItem(state, "nerf", "senna"));

    const seenEventIds = new Set<string>();
    let finishedAtTick: number | null = null;
    let damageAfterFinish = 0;

    for (let tick = 0; tick < 4_000; tick += 1) {
      for (const role of ["luca", "senna"] as const) {
        setInputIntent(state, role, {
          ...EMPTY_INPUT,
          horizontal: (random.integer(3) - 1) as -1 | 0 | 1,
          jump: random.next() < 0.03,
          attack: random.next() < 0.35,
          block: random.next() < 0.2,
          action: random.next() < 0.1,
          switchWeapon: random.next() < 0.05,
        });
      }
      const step = simulateMovementTick(state, BEACH_ARENA);

      for (const event of step.events) {
        // Every outcome belongs to exactly one attack and is applied once.
        expect(seenEventIds.has(event.id)).toBe(false);
        seenEventIds.add(event.id);
        // Nobody can damage themselves.
        expect(event.target).not.toBe(event.role);
        expect(event.damage).toBeGreaterThanOrEqual(0);
        expect(event.damage).toBeLessThanOrEqual(2);
        if (event.outcome === "cover" || event.outcome === "protected") {
          expect(event.damage).toBe(0);
        }
        if (finishedAtTick !== null) damageAfterFinish += event.damage;
      }
      for (const player of Object.values(state.match.players)) {
        expect(player.health).toBeGreaterThanOrEqual(0);
        expect(player.health).toBeLessThanOrEqual(10);
        expect(player.inventory.length).toBeLessThanOrEqual(2);
        for (const item of player.inventory) {
          expect(item.ammo === null || item.ammo >= 0).toBe(true);
        }
      }
      // Read through a widened alias: TypeScript would otherwise narrow the
      // phase to the value assigned above and reject the comparison.
      const phase = state.match.phase as MatchPhase;
      if (phase === "finished" && finishedAtTick === null) {
        finishedAtTick = tick;
      }
    }

    // A brawl this long must reach zero hearts, and nothing may happen after.
    expect(finishedAtTick).not.toBeNull();
    expect(damageAfterFinish).toBe(0);
    expect(state.match.phase as MatchPhase).toBe("finished");
    expect(
      state.match.winner === "luca" || state.match.winner === "senna",
    ).toBe(true);
    expect(
      Math.min(
        state.match.players.luca.health,
        state.match.players.senna.health,
      ),
    ).toBe(0);
  });
});
