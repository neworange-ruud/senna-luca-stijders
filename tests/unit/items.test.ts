import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { COMBAT, TICK_SECONDS } from "../../src/game/config";
import {
  UNARMED_SLOT,
  createItem,
  giveItem,
  selectedWeapon,
  switchWeapon,
} from "../../src/game/items";
import { claimant, simulateDroppedItems } from "../../src/game/pickups";
import { setInputIntent } from "../../src/game/simulation";
import { createInitialGameState } from "../../src/game/state-machine";
import {
  EMPTY_INPUT,
  type EntityState,
  type GameState,
  type ItemId,
} from "../../src/game/types";

function playing(): GameState {
  const state = createInitialGameState();
  state.match.phase = "playing";
  state.match.players.luca.position = { x: 300, y: 1_104 };
  state.match.players.senna.position = { x: 900, y: 1_104 };
  return state;
}

function droppedAt(
  state: GameState,
  itemId: ItemId,
  x: number,
  owner: "luca" | "senna" | null = "luca",
): EntityState {
  const entity: EntityState = {
    id: `${itemId}-loose`,
    kind: "dropped-item",
    itemId,
    owner,
    position: { x, y: 1_150 },
    velocity: { x: 0, y: 0 },
    size: { width: 40, height: 16 },
    facing: "right",
    ammo: itemId === "nerf" ? 6 : null,
    expiresAtTick: null,
  };
  state.match.entities = [entity];
  return entity;
}

describe("inventory", () => {
  it("starts unarmed and selects the first weapon it is given", () => {
    const state = playing();
    const player = state.match.players.luca;
    expect(player.selectedSlot).toBe(UNARMED_SLOT);
    expect(selectedWeapon(player)).toBe("unarmed");
    giveItem(player, createItem(state, "sword", "luca"));
    expect(selectedWeapon(player)).toBe("sword");
  });

  it("cycles unarmed and both slots with the switch control", () => {
    const state = playing();
    const player = state.match.players.luca;
    giveItem(player, createItem(state, "sword", "luca"));
    giveItem(player, createItem(state, "nerf", "luca"));
    expect(selectedWeapon(player)).toBe("nerf");
    expect(switchWeapon(player)).toBe("unarmed");
    expect(switchWeapon(player)).toBe("sword");
    expect(switchWeapon(player)).toBe("nerf");
  });

  it("switches only once while the control stays held", () => {
    const state = playing();
    const player = state.match.players.luca;
    giveItem(player, createItem(state, "sword", "luca"));
    setInputIntent(state, "luca", { ...EMPTY_INPUT, switchWeapon: true });
    expect(selectedWeapon(player)).toBe("unarmed");
    setInputIntent(state, "luca", { ...EMPTY_INPUT, switchWeapon: true });
    expect(selectedWeapon(player)).toBe("unarmed");
    setInputIntent(state, "luca", { ...EMPTY_INPUT });
    setInputIntent(state, "luca", { ...EMPTY_INPUT, switchWeapon: true });
    expect(selectedWeapon(player)).toBe("sword");
  });

  it("returns the replaced weapon when both slots are full", () => {
    const state = playing();
    const player = state.match.players.luca;
    giveItem(player, createItem(state, "sword", "luca"));
    giveItem(player, createItem(state, "nerf", "luca"));
    const replaced = giveItem(player, createItem(state, "weak-sword", "luca"));
    expect(replaced?.itemId).toBe("nerf");
    expect(player.inventory).toHaveLength(2);
    expect(selectedWeapon(player)).toBe("weak-sword");
  });
});

describe("picking items up", () => {
  it("needs the Action control and reach", () => {
    const state = playing();
    droppedAt(state, "sword", 320);
    expect(simulateDroppedItems(state, BEACH_ARENA, 5, TICK_SECONDS)).toEqual(
      [],
    );
    state.match.players.luca.input = { ...EMPTY_INPUT, action: true };
    expect(
      simulateDroppedItems(state, BEACH_ARENA, 6, TICK_SECONDS),
    ).toMatchObject([{ kind: "pickup", role: "luca", item: "sword" }]);
    expect(selectedWeapon(state.match.players.luca)).toBe("sword");
    expect(state.match.entities).toHaveLength(0);
  });

  it("is out of reach for a player standing far away", () => {
    const state = playing();
    droppedAt(state, "sword", 320);
    state.match.players.senna.input = { ...EMPTY_INPUT, action: true };
    expect(simulateDroppedItems(state, BEACH_ARENA, 6, TICK_SECONDS)).toEqual(
      [],
    );
    expect(state.match.entities).toHaveLength(1);
  });

  it("drops the replaced weapon back into the arena", () => {
    const state = playing();
    const player = state.match.players.luca;
    giveItem(player, createItem(state, "sword", "luca"));
    giveItem(player, createItem(state, "weak-sword", "luca"));
    droppedAt(state, "nerf", 320);
    player.input = { ...EMPTY_INPUT, action: true };
    const events = simulateDroppedItems(state, BEACH_ARENA, 6, TICK_SECONDS);
    expect(events.map((event) => event.kind)).toEqual(["pickup", "drop"]);
    expect(selectedWeapon(player)).toBe("nerf");
    expect(state.match.entities).toHaveLength(1);
    expect(state.match.entities[0]).toMatchObject({
      kind: "dropped-item",
      itemId: "weak-sword",
    });
  });

  it("gives a contested item to the closest player", () => {
    const state = playing();
    state.match.players.senna.position = { x: 340, y: 1_104 };
    const entity = droppedAt(state, "sword", 360);
    for (const role of ["luca", "senna"] as const) {
      state.match.players[role].input = { ...EMPTY_INPUT, action: true };
    }
    expect(
      claimant([state.match.players.luca, state.match.players.senna], entity, 6)
        ?.role,
    ).toBe("senna");
    const events = simulateDroppedItems(state, BEACH_ARENA, 6, TICK_SECONDS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "pickup", role: "senna" });
    expect(state.match.players.luca.inventory).toHaveLength(0);
  });

  it("alternates an exact tie so neither player always wins", () => {
    const state = playing();
    state.match.players.senna.position = {
      ...state.match.players.luca.position,
    };
    const entity = droppedAt(state, "sword", 320);
    const both = [state.match.players.luca, state.match.players.senna];
    expect(claimant(both, entity, 6)?.role).toBe("luca");
    expect(claimant(both, entity, 7)?.role).toBe("senna");
  });
});

describe("unreachable thrown weapons", () => {
  it("returns to its owner after the configured time", () => {
    const state = playing();
    const entity = droppedAt(state, "sword", 2_000);
    state.match.entities = [{ ...entity, expiresAtTick: 100 }];
    expect(simulateDroppedItems(state, BEACH_ARENA, 99, TICK_SECONDS)).toEqual(
      [],
    );
    expect(
      simulateDroppedItems(state, BEACH_ARENA, 100, TICK_SECONDS),
    ).toMatchObject([{ kind: "pickup", role: "luca", item: "sword" }]);
    expect(selectedWeapon(state.match.players.luca)).toBe("sword");
  });

  it("uses the configured eight active seconds", () => {
    expect(COMBAT.droppedReturnTicks).toBe(240);
  });
});
