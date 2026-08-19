import { movePlayer } from "../game/movement.js";
import type {
  ArenaDefinition,
  GameSnapshot,
  InputIntent,
  PlayerRole,
  PlayerState,
  Vector,
} from "../game/types.js";

interface PendingInput {
  sequence: number;
  tick: number;
  intent: InputIntent;
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity },
    size: { ...player.size },
    input: { ...player.input },
    inventory: player.inventory.map((item) => ({ ...item })),
    effects: player.effects.map((effect) => ({ ...effect })),
  };
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, alpha));
}

export function interpolatePlayer(
  previous: PlayerState,
  current: PlayerState,
  alpha: number,
): PlayerState {
  const interpolated = clonePlayer(current);
  interpolated.position = {
    x: lerp(previous.position.x, current.position.x, alpha),
    y: lerp(previous.position.y, current.position.y, alpha),
  };
  interpolated.velocity = {
    x: lerp(previous.velocity.x, current.velocity.x, alpha),
    y: lerp(previous.velocity.y, current.velocity.y, alpha),
  };
  return interpolated;
}

export class LocalMovementPrediction {
  private player: PlayerState | null = null;
  private opponentPosition: Vector = { x: 0, y: 0 };
  private pending: PendingInput[] = [];
  private currentIntent: InputIntent | null = null;
  private tick = 0;
  private correction = 0;

  constructor(
    private readonly role: PlayerRole,
    private readonly arena: ArenaDefinition,
  ) {}

  setIntent(sequence: number, intent: InputIntent): void {
    this.currentIntent = { ...intent };
    this.pending.push({ sequence, tick: this.tick, intent: { ...intent } });
  }

  reconcile(snapshot: GameSnapshot): void {
    const authoritative = snapshot.state.match.players[this.role];
    const predicted = this.player;
    this.correction = predicted
      ? Math.hypot(
          predicted.position.x - authoritative.position.x,
          predicted.position.y - authoritative.position.y,
        )
      : 0;
    const targetTick = Math.max(this.tick, snapshot.tick);
    this.pending = this.pending.filter(
      (input) => input.sequence > snapshot.acknowledgedSequences[this.role],
    );
    this.player = clonePlayer(authoritative);
    this.opponentPosition = {
      ...snapshot.state.match.players[this.role === "luca" ? "senna" : "luca"]
        .position,
    };
    this.tick = snapshot.tick;

    let intent = { ...authoritative.input };
    for (const input of this.pending) {
      if (input.tick <= snapshot.tick) intent = input.intent;
    }
    while (this.tick < targetTick) {
      this.tick += 1;
      for (const input of this.pending) {
        if (input.tick === this.tick) intent = input.intent;
      }
      movePlayer(
        this.player,
        intent,
        this.arena,
        this.opponentPosition,
        this.tick,
      );
    }
    this.currentIntent = this.pending.at(-1)?.intent ?? authoritative.input;
  }

  advance(): void {
    if (!this.player || !this.currentIntent) return;
    this.tick += 1;
    movePlayer(
      this.player,
      this.currentIntent,
      this.arena,
      this.opponentPosition,
      this.tick,
    );
  }

  get predictedPlayer(): PlayerState | null {
    return this.player ? clonePlayer(this.player) : null;
  }

  get correctionPixels(): number {
    return this.correction;
  }
}
