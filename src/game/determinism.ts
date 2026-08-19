import type { GameError, PlayerRole } from "./types.js";

export class TickClock {
  constructor(private value = 0) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Tick must be a non-negative safe integer.");
    }
  }

  get tick(): number {
    return this.value;
  }

  advance(count = 1): number {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("Tick count must be a non-negative safe integer.");
    }
    this.value += count;
    return this.value;
  }
}

export class SeededRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  get state(): number {
    return this.value;
  }

  next(): number {
    this.value = (Math.imul(this.value, 1_664_525) + 1_013_904_223) >>> 0;
    return this.value / 0x1_0000_0000;
  }

  integer(maximumExclusive: number): number {
    if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0) {
      throw new RangeError("Maximum must be a positive safe integer.");
    }
    return Math.floor(this.next() * maximumExclusive);
  }
}

export class EntityIdSequence {
  constructor(
    private readonly prefix: string,
    private value = 0,
  ) {
    if (!prefix || !Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Entity ID sequence is invalid.");
    }
  }

  next(): string {
    this.value += 1;
    return `${this.prefix}-${this.value.toString(36).padStart(4, "0")}`;
  }

  get nextNumber(): number {
    return this.value + 1;
  }
}

export interface SequenceState {
  lastByRole: Record<PlayerRole, number>;
  processedIds: Set<string>;
}

export type CommandAcceptance =
  { accepted: true } | { accepted: false; error: GameError };

export function acceptCommand(
  state: SequenceState,
  command: { id: string; role: PlayerRole; sequence: number },
): CommandAcceptance {
  if (state.processedIds.has(command.id)) {
    return {
      accepted: false,
      error: { code: "DUPLICATE_COMMAND", messageKey: "fout.dubbeleActie" },
    };
  }

  if (command.sequence <= state.lastByRole[command.role]) {
    return {
      accepted: false,
      error: { code: "STALE_SEQUENCE", messageKey: "fout.oudeActie" },
    };
  }

  state.lastByRole[command.role] = command.sequence;
  state.processedIds.add(command.id);
  return { accepted: true };
}
