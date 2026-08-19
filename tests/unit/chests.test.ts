import { describe, expect, it } from "vitest";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import {
  chestClaimant,
  drawChestOutcome,
  selectChestPoint,
  simulateChests,
} from "../../src/game/chests";
import { CHESTS } from "../../src/game/config";
import { selectedWeapon } from "../../src/game/items";
import {
  initializeArena,
  simulateMovementTick,
} from "../../src/game/simulation";
import {
  createInitialGameState,
  requestRematch,
} from "../../src/game/state-machine";
import {
  CHEST_OUTCOMES,
  EMPTY_INPUT,
  type ChestState,
  type GameState,
  type MatchEvent,
  type PlayerRole,
} from "../../src/game/types";

function playing(seed = 7): GameState {
  const state = createInitialGameState(seed);
  state.match.phase = "playing";
  for (const player of Object.values(state.match.players)) {
    player.connected = true;
  }
  initializeArena(state, BEACH_ARENA);
  return state;
}

/** Runs chest logic for a span of ticks and collects what it produced. */
function runChests(state: GameState, ticks: number): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let index = 0; index < ticks; index += 1) {
    state.match.tick += 1;
    events.push(...simulateChests(state, BEACH_ARENA, state.match.tick));
  }
  return events;
}

function standAt(state: GameState, role: PlayerRole, chest: ChestState): void {
  const player = state.match.players[role];
  player.position = {
    x: chest.position.x - player.size.width / 2,
    y: chest.position.y - player.size.height,
  };
  player.input = { ...EMPTY_INPUT, action: true };
}

describe("chest schedule", () => {
  it("announces the first chest eight active seconds after play starts", () => {
    const state = playing();
    expect(runChests(state, CHESTS.firstAnnouncementTicks - 1)).toEqual([]);
    const announcement = runChests(state, 1);
    expect(announcement).toMatchObject([{ kind: "chest-announced" }]);
    // The contents stay secret while the chest is still falling.
    expect(announcement[0]!.chestOutcome).toBeUndefined();
    expect(state.match.chests).toHaveLength(1);
  });

  it("lands the chest two seconds after the announcement", () => {
    const state = playing();
    runChests(state, CHESTS.firstAnnouncementTicks);
    const chest = state.match.chests[0]!;
    expect(runChests(state, CHESTS.announceTicks - 1)).toEqual([]);
    expect(runChests(state, 1)).toMatchObject([{ kind: "chest-landed" }]);
    expect(state.match.tick).toBe(chest.landsAtTick);
  });

  it("announces later chests every twelve active seconds", () => {
    const state = playing();
    const events = runChests(
      state,
      CHESTS.firstAnnouncementTicks + CHESTS.intervalTicks,
    );
    const announcements = events.filter(
      (event) => event.kind === "chest-announced",
    );
    expect(announcements).toHaveLength(2);
    expect(announcements[1]!.tick - announcements[0]!.tick).toBe(
      CHESTS.intervalTicks,
    );
  });

  it("never keeps more than two chests waiting to be claimed", () => {
    const state = playing();
    runChests(state, CHESTS.firstAnnouncementTicks + CHESTS.intervalTicks * 6);
    expect(state.match.chests.length).toBeLessThanOrEqual(CHESTS.maximumActive);
  });

  it("puts every chest on its own reachable arena point", () => {
    const state = playing();
    runChests(state, CHESTS.firstAnnouncementTicks + CHESTS.intervalTicks);
    const points = state.match.chests.map((chest) => chest.pointId);
    expect(new Set(points).size).toBe(points.length);
    for (const chest of state.match.chests) {
      expect(
        BEACH_ARENA.chestPoints.some((point) => point.id === chest.pointId),
      ).toBe(true);
    }
  });
});

describe("claiming a chest", () => {
  function landedChest(state: GameState): ChestState {
    runChests(state, CHESTS.firstAnnouncementTicks + CHESTS.announceTicks);
    return state.match.chests[0]!;
  }

  it("needs the Action control and reach, and rewards exactly once", () => {
    const state = playing();
    const chest = landedChest(state);
    chest.outcome = "sword";
    expect(runChests(state, 1)).toEqual([]);

    standAt(state, "luca", chest);
    const claimed = runChests(state, 1);
    expect(claimed).toMatchObject([
      { kind: "chest-claimed", role: "luca", chestOutcome: "sword" },
    ]);
    expect(selectedWeapon(state.match.players.luca)).toBe("sword");
    expect(state.match.chests).toEqual([]);
    // Holding Action afterwards cannot produce a second reward.
    expect(runChests(state, 5)).toEqual([]);
    expect(state.match.players.luca.inventory).toHaveLength(1);
  });

  it("cannot be claimed before it has landed", () => {
    const state = playing();
    runChests(state, CHESTS.firstAnnouncementTicks);
    const chest = state.match.chests[0]!;
    standAt(state, "luca", chest);
    expect(runChests(state, CHESTS.announceTicks - 1)).toEqual([]);
    expect(state.match.chests).toHaveLength(1);
  });

  it("is out of reach for a player standing far away", () => {
    const state = playing();
    const chest = landedChest(state);
    state.match.players.senna.position = {
      x: chest.position.x + 400,
      y: 1_104,
    };
    state.match.players.senna.input = { ...EMPTY_INPUT, action: true };
    expect(runChests(state, 1)).toEqual([]);
    expect(state.match.chests).toHaveLength(1);
  });

  it("gives a contested chest to the closest player", () => {
    const state = playing();
    const chest = landedChest(state);
    standAt(state, "luca", chest);
    standAt(state, "senna", chest);
    state.match.players.senna.position.x += 40;
    expect(chestClaimant(state, chest, 10)).toBe("luca");
    const events = runChests(state, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "chest-claimed", role: "luca" });
  });

  it("alternates an exact tie so neither player always wins", () => {
    const state = playing();
    const chest = landedChest(state);
    standAt(state, "luca", chest);
    standAt(state, "senna", chest);
    expect(chestClaimant(state, chest, 10)).toBe("luca");
    expect(chestClaimant(state, chest, 11)).toBe("senna");
  });

  it("applies an effect outcome instead of an inventory item", () => {
    const state = playing();
    const chest = landedChest(state);
    chest.outcome = "speed";
    standAt(state, "senna", chest);
    runChests(state, 1);
    expect(state.match.players.senna.effects).toMatchObject([
      { effectId: "speed" },
    ]);
    expect(state.match.players.senna.inventory).toEqual([]);
  });
});

describe("shuffle bag", () => {
  it("gives one of each outcome before anything repeats", () => {
    const state = playing();
    const drawn = CHEST_OUTCOMES.map(() => drawChestOutcome(state));
    expect(new Set(drawn)).toEqual(new Set(CHEST_OUTCOMES));
    expect(state.match.chestSchedule.bag).toEqual([]);
    // The seventh draw refills the bag rather than running dry.
    expect(CHEST_OUTCOMES).toContain(drawChestOutcome(state));
  });

  it("stays evenly distributed and bounded over ten thousand draws", () => {
    const state = playing(20_260_819);
    const counts = new Map<string, number>(
      CHEST_OUTCOMES.map((outcome) => [outcome, 0]),
    );
    const draws = 10_002; // A whole number of six-outcome bags.
    for (let index = 0; index < draws; index += 1) {
      const outcome = drawChestOutcome(state);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    // One of each per bag makes the distribution exact, not merely close.
    for (const outcome of CHEST_OUTCOMES) {
      expect(counts.get(outcome)).toBe(draws / CHEST_OUTCOMES.length);
    }
  });

  it("keeps drawing from the persisted random state", () => {
    const first = playing(5);
    const second = playing(5);
    const drawsA = Array.from({ length: 12 }, () => drawChestOutcome(first));
    const drawsB = Array.from({ length: 12 }, () => drawChestOutcome(second));
    expect(drawsA).toEqual(drawsB);
    expect(first.match.randomState).toBe(second.match.randomState);
    expect(first.match.randomState).not.toBe(5);
  });
});

describe("eligible-recovery rule", () => {
  /** Advances to each of the next `count` announcements, claiming as it goes. */
  function scheduleWithGap(state: GameState, count: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      // Pretend the previous chest was claimed so nothing is postponed.
      state.match.chests = [];
      const target = state.match.chestSchedule.nextAnnouncementTick;
      events.push(...runChests(state, target - state.match.tick));
    }
    return events;
  }

  it("replaces only the third consecutive eligible chest, alternating help", () => {
    const state = playing();
    state.match.players.senna.health = 5;
    state.match.players.luca.health = 10;
    scheduleWithGap(state, 2);
    expect(state.match.chests.every((chest) => !chest.recovery)).toBe(true);
    expect(state.match.chestSchedule.recoveryCounter).toBe(2);

    const bagBefore = state.match.chestSchedule.bag.length;
    scheduleWithGap(state, 1);
    const recovery = state.match.chests.at(-1)!;
    expect(recovery.recovery).toBe(true);
    expect(recovery.outcome).toBe("armor");
    // A recovery chest does not consume a base-bag entry.
    expect(state.match.chestSchedule.bag).toHaveLength(bagBefore);
    expect(state.match.chestSchedule.recoveryCounter).toBe(0);

    scheduleWithGap(state, 3);
    const second = state.match.chests.at(-1)!;
    expect(second.recovery).toBe(true);
    expect(second.outcome).toBe("speed");
  });

  it("resets the counter as soon as the gap closes", () => {
    const state = playing();
    state.match.players.senna.health = 5;
    scheduleWithGap(state, 2);
    expect(state.match.chestSchedule.recoveryCounter).toBe(2);
    state.match.players.senna.health = 9;
    scheduleWithGap(state, 1);
    expect(state.match.chestSchedule.recoveryCounter).toBe(0);
    expect(state.match.chests.at(-1)!.recovery).toBe(false);
  });

  it("lands a recovery chest on the point nearest the trailing player", () => {
    const state = playing();
    state.match.players.senna.health = 5;
    state.match.players.senna.position = { x: 2_260, y: 1_104 };
    const nearest = selectChestPoint(state, BEACH_ARENA, "senna");
    expect(nearest?.id).toBe("chest-east-floor");
    scheduleWithGap(state, 3);
    expect(state.match.chests.at(-1)).toMatchObject({
      recovery: true,
      pointId: "chest-east-floor",
    });
  });

  it("stays claimable by either player", () => {
    const state = playing();
    state.match.players.senna.health = 5;
    scheduleWithGap(state, 3);
    const chest = state.match.chests.at(-1)!;
    runChests(state, CHESTS.announceTicks);
    standAt(state, "luca", chest);
    expect(runChests(state, 1)).toMatchObject([
      { kind: "chest-claimed", role: "luca" },
    ]);
  });
});

describe("match reset", () => {
  it("clears chests and the schedule for a rematch", () => {
    const state = playing();
    runChests(state, CHESTS.firstAnnouncementTicks);
    state.match.players.senna.health = 0;
    state.match.phase = "finished";
    for (const role of ["luca", "senna"] as const) {
      requestRematch(state, role);
    }
    expect(state.match.chests).toEqual([]);
    expect(state.match.chestSchedule.recoveryCounter).toBe(0);
    expect(state.match.chestSchedule.bag).toEqual([]);
  });

  it("restarts the chest clock when a new arena is initialised", () => {
    const state = playing();
    state.match.tick = 500;
    initializeArena(state, BEACH_ARENA);
    expect(state.match.chestSchedule.nextAnnouncementTick).toBe(
      500 + CHESTS.firstAnnouncementTicks,
    );
    expect(simulateMovementTick(state, BEACH_ARENA).events).toEqual([]);
  });
});
