import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { simulateCombat, simulateProjectiles } from "../../src/game/combat";
import { COMBAT, MELEE, NERF, TICK_SECONDS } from "../../src/game/config";
import { createItem, giveItem } from "../../src/game/items";
import {
  setInputIntent,
  simulateMovementTick,
} from "../../src/game/simulation";
import { createInitialGameState } from "../../src/game/state-machine";
import {
  EMPTY_INPUT,
  type GameState,
  type ItemId,
  type MatchEvent,
} from "../../src/game/types";

function duel(gap = 26): GameState {
  const state = createInitialGameState();
  state.match.phase = "playing";
  const { luca, senna } = state.match.players;
  luca.position = { x: 300, y: 1_104 };
  senna.position = { x: 300 + luca.size.width + gap, y: 1_104 };
  luca.facing = "right";
  senna.facing = "left";
  luca.input = { ...EMPTY_INPUT, attack: true };
  return state;
}

function arm(state: GameState, role: "luca" | "senna", itemId: ItemId): void {
  giveItem(state.match.players[role], createItem(state, itemId, role));
}

/** Runs one attack tick and returns the events it produced. */
function attackTick(state: GameState, tick: number): readonly MatchEvent[] {
  return simulateCombat(state, BEACH_ARENA, tick);
}

describe("melee", () => {
  it("swings once per press and then waits out the cooldown", () => {
    const state = duel();
    expect(attackTick(state, 10)).toMatchObject([
      { kind: "melee", item: "unarmed", outcome: "hit", damage: 1 },
    ]);
    expect(state.match.players.senna.health).toBe(9);
    // Holding the control down does not swing again.
    expect(attackTick(state, 11)).toEqual([]);
    expect(attackTick(state, 12)).toEqual([]);
    // Releasing and pressing again inside the cooldown is also rejected.
    state.match.players.luca.input = { ...EMPTY_INPUT };
    attackTick(state, 13);
    state.match.players.luca.input = { ...EMPTY_INPUT, attack: true };
    expect(attackTick(state, 14)).toEqual([]);
    expect(state.match.players.senna.health).toBe(9);
  });

  it("lets the cooldown expire before the next swing", () => {
    const state = duel();
    attackTick(state, 10);
    state.match.players.luca.input = { ...EMPTY_INPUT };
    attackTick(state, 11);
    state.match.players.luca.input = { ...EMPTY_INPUT, attack: true };
    const ready = 10 + MELEE.unarmed.cooldownTicks;
    expect(attackTick(state, ready)).toMatchObject([{ outcome: "hit" }]);
    expect(state.match.players.senna.health).toBe(8);
  });

  it("gives a sword more range and damage than an unarmed attack", () => {
    const state = duel(80);
    expect(attackTick(state, 10)).toMatchObject([{ outcome: "miss" }]);
    const armed = duel(80);
    arm(armed, "luca", "sword");
    expect(attackTick(armed, 10)).toMatchObject([
      { item: "sword", outcome: "hit", damage: 2 },
    ]);
    expect(armed.match.players.senna.health).toBe(8);
  });

  it("misses when the attacker faces away", () => {
    const state = duel();
    state.match.players.luca.facing = "left";
    expect(attackTick(state, 10)).toMatchObject([{ outcome: "miss" }]);
    expect(state.match.players.senna.health).toBe(10);
  });

  it("does not lose a tap that starts and ends between two ticks", () => {
    const state = duel();
    // Start from a released control, as a real client would.
    state.match.players.luca.input = { ...EMPTY_INPUT };
    // A fast tap on a touchscreen can be pressed and released inside one tick,
    // so the press is remembered instead of thrown away.
    setInputIntent(state, "luca", { ...EMPTY_INPUT, attack: true });
    setInputIntent(state, "luca", { ...EMPTY_INPUT });
    expect(attackTick(state, 10)).toMatchObject([
      { kind: "melee", outcome: "hit", damage: 1 },
    ]);
    // The remembered press is consumed once and never repeats.
    expect(attackTick(state, 40)).toEqual([]);
  });

  it("still reaches an opponent who is standing on top of the attacker", () => {
    // Players can move through each other, so an overlapping opponent in front
    // of the attacker must remain hittable.
    const state = duel(-40);
    expect(attackTick(state, 10)).toMatchObject([
      { outcome: "hit", damage: 1 },
    ]);
  });
});

describe("blocking", () => {
  it("stops an unarmed attack completely while facing the attacker", () => {
    const state = duel();
    state.match.players.senna.input = { ...EMPTY_INPUT, block: true };
    expect(attackTick(state, 10)).toMatchObject([
      { outcome: "blocked", damage: 0 },
    ]);
    expect(state.match.players.senna.health).toBe(10);
  });

  it("lets one heart of a normal sword through a block", () => {
    const state = duel();
    arm(state, "luca", "sword");
    state.match.players.senna.input = { ...EMPTY_INPUT, block: true };
    expect(attackTick(state, 10)).toMatchObject([
      { outcome: "hit", damage: 2 - COMBAT.blockDamageReduction },
    ]);
    expect(state.match.players.senna.health).toBe(9);
  });

  it("is bypassed by an attack from behind", () => {
    const state = duel();
    state.match.players.senna.input = { ...EMPTY_INPUT, block: true };
    state.match.players.senna.facing = "right";
    expect(attackTick(state, 10)).toMatchObject([
      { outcome: "hit", damage: 1 },
    ]);
    expect(state.match.players.senna.health).toBe(9);
  });
});

describe("protection and cover", () => {
  it("blocks all damage during respawn protection", () => {
    const state = duel();
    state.match.players.senna.invulnerableUntilTick = 20;
    expect(attackTick(state, 10)).toMatchObject([{ outcome: "protected" }]);
    expect(state.match.players.senna.health).toBe(10);
  });

  it("stops an attack through solid cover", () => {
    const state = duel();
    const arena = {
      ...BEACH_ARENA,
      surfaces: [
        ...BEACH_ARENA.surfaces,
        {
          id: "test-cover",
          kind: "cover" as const,
          x: 370,
          y: 1_100,
          width: 10,
          height: 100,
        },
      ],
    };
    expect(simulateCombat(state, arena, 10)).toMatchObject([
      { outcome: "cover" },
    ]);
    expect(state.match.players.senna.health).toBe(10);
  });
});

describe("simultaneous attacks", () => {
  it("plans both hits before applying either result", () => {
    const state = duel();
    state.match.players.luca.health = 1;
    state.match.players.senna.health = 1;
    state.match.players.senna.input = { ...EMPTY_INPUT, attack: true };
    const events = attackTick(state, 10);
    expect(events).toHaveLength(2);
    expect(state.match.players.luca.health).toBe(0);
    expect(state.match.players.senna.health).toBe(0);
  });
});

describe("finishing the match", () => {
  it("stops play on the tick the last heart is lost and names the winner", () => {
    const state = duel();
    state.match.players.senna.health = 1;
    const step = simulateMovementTick(state, BEACH_ARENA);
    expect(step.events).toMatchObject([{ outcome: "hit", damage: 1 }]);
    expect(state.match.players.senna.health).toBe(0);
    expect(state.match.phase).toBe("finished");
    expect(state.match.winner).toBe("luca");
    // A finished match runs no further ticks, so no later hit can land.
    const after = simulateMovementTick(state, BEACH_ARENA);
    expect(after.advanced).toBe(false);
    expect(after.events).toEqual([]);
  });

  it("has no winner when both players reach zero on the same tick", () => {
    const state = duel();
    state.match.players.luca.health = 1;
    state.match.players.senna.health = 1;
    state.match.players.senna.input = { ...EMPTY_INPUT, attack: true };
    simulateMovementTick(state, BEACH_ARENA);
    expect(state.match.phase).toBe("finished");
    expect(state.match.winner).toBeNull();
  });
});

describe("sword throw", () => {
  function chargeAndRelease(state: GameState, start: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    for (let tick = start; tick < start + COMBAT.throwChargeTicks; tick += 1) {
      events.push(...attackTick(state, tick));
    }
    state.match.players.luca.input = { ...EMPTY_INPUT };
    events.push(...attackTick(state, start + COMBAT.throwChargeTicks));
    return events;
  }

  it("throws the held sword after a long enough hold", () => {
    const state = duel(400);
    arm(state, "luca", "sword");
    const events = chargeAndRelease(state, 10);
    expect(events.at(-1)).toMatchObject({ kind: "throw", item: "sword" });
    expect(state.match.players.luca.inventory).toHaveLength(0);
    expect(state.match.entities).toHaveLength(1);
    expect(state.match.entities[0]).toMatchObject({
      kind: "projectile",
      itemId: "sword",
      owner: "luca",
    });
    expect(state.match.entities[0]!.velocity.x).toBeGreaterThan(0);
  });

  it("keeps the sword when the hold was too short", () => {
    const state = duel(400);
    arm(state, "luca", "sword");
    attackTick(state, 10);
    state.match.players.luca.input = { ...EMPTY_INPUT };
    expect(attackTick(state, 11)).toEqual([]);
    expect(state.match.players.luca.inventory).toHaveLength(1);
    expect(state.match.entities).toHaveLength(0);
  });

  it("damages the opponent and stays in the arena as a recoverable item", () => {
    const state = duel(400);
    arm(state, "luca", "sword");
    chargeAndRelease(state, 10);
    let events: readonly MatchEvent[] = [];
    for (let tick = 30; tick < 60 && events.length === 0; tick += 1) {
      events = simulateProjectiles(state, BEACH_ARENA, tick, TICK_SECONDS);
    }
    expect(events).toMatchObject([
      { kind: "impact", item: "sword", outcome: "hit", damage: 2 },
    ]);
    expect(state.match.players.senna.health).toBe(8);
    expect(state.match.entities[0]).toMatchObject({
      kind: "dropped-item",
      itemId: "sword",
    });
  });
});

describe("nerf blaster", () => {
  it("fires a dart, spends ammo, and respects its cooldown", () => {
    const state = duel(400);
    arm(state, "luca", "nerf");
    expect(attackTick(state, 10)).toMatchObject([
      { kind: "shoot", item: "nerf" },
    ]);
    expect(state.match.players.luca.inventory[0]!.ammo).toBe(NERF.ammo - 1);
    state.match.players.luca.input = { ...EMPTY_INPUT };
    attackTick(state, 11);
    state.match.players.luca.input = { ...EMPTY_INPUT, attack: true };
    expect(attackTick(state, 12)).toEqual([]);
    expect(state.match.players.luca.inventory[0]!.ammo).toBe(NERF.ammo - 1);
  });

  it("reports an empty blaster instead of firing", () => {
    const state = duel(400);
    arm(state, "luca", "nerf");
    state.match.players.luca.inventory = [
      { ...state.match.players.luca.inventory[0]!, ammo: 0 },
    ];
    expect(attackTick(state, 10)).toMatchObject([
      { kind: "empty", item: "nerf" },
    ]);
    expect(state.match.entities).toHaveLength(0);
  });

  it("deals one heart and disappears on impact", () => {
    const state = duel(400);
    arm(state, "luca", "nerf");
    attackTick(state, 10);
    let events: readonly MatchEvent[] = [];
    for (let tick = 11; tick < 60 && events.length === 0; tick += 1) {
      events = simulateProjectiles(state, BEACH_ARENA, tick, TICK_SECONDS);
    }
    expect(events).toMatchObject([{ kind: "impact", damage: 1 }]);
    expect(state.match.players.senna.health).toBe(9);
    expect(state.match.entities).toHaveLength(0);
  });

  it("reports a dart that leaves the arena as a miss, not as cover", () => {
    const state = duel(400);
    arm(state, "luca", "nerf");
    state.match.players.luca.facing = "left";
    attackTick(state, 10);
    let events: readonly MatchEvent[] = [];
    for (let tick = 11; tick < 120 && events.length === 0; tick += 1) {
      events = simulateProjectiles(state, BEACH_ARENA, tick, TICK_SECONDS);
    }
    expect(events).toMatchObject([{ kind: "impact", outcome: "miss" }]);
    expect(state.match.entities).toHaveLength(0);
  });

  it("is stopped completely by a frontal block", () => {
    const state = duel(400);
    arm(state, "luca", "nerf");
    attackTick(state, 10);
    state.match.players.senna.input = { ...EMPTY_INPUT, block: true };
    let events: readonly MatchEvent[] = [];
    for (let tick = 11; tick < 60 && events.length === 0; tick += 1) {
      events = simulateProjectiles(state, BEACH_ARENA, tick, TICK_SECONDS);
    }
    expect(events).toMatchObject([{ outcome: "blocked", damage: 0 }]);
    expect(state.match.players.senna.health).toBe(10);
  });
});
