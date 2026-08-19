import { describe, expect, it } from "vitest";
import {
  LocalMovementPrediction,
  interpolatePlayer,
} from "../../src/client/movement-presentation";
import { BEACH_ARENA } from "../../src/game/arenas/beach";
import { createInitialGameState } from "../../src/game/state-machine";
import { initializeArena } from "../../src/game/simulation";
import {
  EMPTY_INPUT,
  GAME_PROTOCOL_VERSION,
  GAME_SCHEMA_VERSION,
} from "../../src/game/types";

function snapshot(revision = 1) {
  const state = createInitialGameState();
  state.match.phase = "playing";
  state.match.players.luca.connected = true;
  state.match.players.senna.connected = true;
  initializeArena(state, BEACH_ARENA);
  return {
    schemaVersion: GAME_SCHEMA_VERSION,
    protocolVersion: GAME_PROTOCOL_VERSION,
    revision,
    tick: state.match.tick,
    acknowledgedSequences: { luca: 0, senna: 0 },
    state,
  };
}

describe("movement presentation", () => {
  it("predicts local movement and drops acknowledged input during reconciliation", () => {
    const first = snapshot();
    const prediction = new LocalMovementPrediction("luca", BEACH_ARENA);
    prediction.reconcile(first);
    prediction.setIntent(1, { ...EMPTY_INPUT, horizontal: 1 });
    prediction.advance();
    prediction.advance();
    expect(prediction.predictedPlayer!.position.x).toBeGreaterThan(
      first.state.match.players.luca.position.x,
    );

    const acknowledged = snapshot(2);
    acknowledged.acknowledgedSequences.luca = 1;
    acknowledged.state.match.players.luca.lastProcessedSequence = 1;
    prediction.reconcile(acknowledged);
    expect(prediction.predictedPlayer!.position).toEqual(
      acknowledged.state.match.players.luca.position,
    );
    expect(prediction.correctionPixels).toBeGreaterThan(0);
  });

  it("replays unacknowledged intent over ticks newer than a snapshot", () => {
    const prediction = new LocalMovementPrediction("luca", BEACH_ARENA);
    prediction.reconcile(snapshot());
    prediction.setIntent(4, { ...EMPTY_INPUT, horizontal: 1 });
    for (let index = 0; index < 4; index += 1) prediction.advance();
    const before = prediction.predictedPlayer!.position.x;
    prediction.reconcile(snapshot(2));
    expect(prediction.predictedPlayer!.position.x).toBeCloseTo(before);
  });

  it("never predicts an outcome the server owns", () => {
    // The browser may predict its own movement, but hearts, weapons, and
    // protection must only ever come from an authoritative snapshot. Nothing has
    // to be cancelled later because nothing is guessed in the first place.
    const first = snapshot();
    const prediction = new LocalMovementPrediction("luca", BEACH_ARENA);
    prediction.reconcile(first);
    prediction.setIntent(1, {
      ...EMPTY_INPUT,
      horizontal: 1,
      attack: true,
      block: true,
      action: true,
      switchWeapon: true,
    });
    for (let index = 0; index < 40; index += 1) prediction.advance();

    const predicted = prediction.predictedPlayer!;
    const authoritative = first.state.match.players.luca;
    expect(predicted.health).toBe(authoritative.health);
    expect(predicted.inventory).toEqual(authoritative.inventory);
    expect(predicted.selectedSlot).toBe(authoritative.selectedSlot);
    expect(predicted.nextAttackTick).toBe(authoritative.nextAttackTick);
    expect(predicted.invulnerableUntilTick).toBe(
      authoritative.invulnerableUntilTick,
    );
    expect(first.state.match.players.senna.health).toBe(10);
  });

  it("interpolates remote transforms without mutating either snapshot", () => {
    const previous = snapshot().state.match.players.senna;
    const current = structuredClone(previous);
    current.position.x += 100;
    current.velocity.x = 200;
    const result = interpolatePlayer(previous, current, 0.25);
    expect(result.position.x).toBe(previous.position.x + 25);
    expect(result.velocity.x).toBe(50);
    expect(previous.position.x).not.toBe(current.position.x);
  });
});
