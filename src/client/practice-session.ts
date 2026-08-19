import { BEACH_ARENA } from "../game/arenas/beach.js";
import { applyGameCommand } from "../game/commands.js";
import {
  createPracticeState,
  grantPracticeWeapon,
  practiceBotIntent,
  practiceOpponent,
  type PracticeBehaviour,
} from "../game/practice.js";
import {
  initializeArena,
  setInputIntent,
  simulateMovementTick,
} from "../game/simulation.js";
import { advanceLifecycle, setPlayerReady } from "../game/state-machine.js";
import {
  GAME_PROTOCOL_VERSION,
  GAME_SCHEMA_VERSION,
  type ArenaDefinition,
  type GameCommand,
  type GameSnapshot,
  type GameState,
  type ItemId,
  type PlayerRole,
} from "../game/types.js";
import type {
  MatchSession,
  SessionError,
  TransportMetrics,
} from "./match-session.js";

const TICK_MILLISECONDS = 1_000 / 30;
const SNAPSHOT_INTERVAL_TICKS = 2;

/**
 * Runs a complete match inside this browser so one player can test gameplay
 * without a second device. It opens no socket and never reads or writes shared
 * authoritative state, so it cannot influence a real match.
 */
export class PracticeSession implements MatchSession {
  private state: GameState;
  private timer: number | undefined;
  private revision = 0;
  private readonly snapshotListeners = new Set<
    (snapshot: GameSnapshot) => void
  >();
  private readonly errorListeners = new Set<(error: SessionError) => void>();
  private readonly metricsListeners = new Set<
    (metrics: TransportMetrics) => void
  >();
  private metrics: TransportMetrics = {
    state: "offline",
    reconnects: 0,
    latestTick: -1,
    roundTripMilliseconds: null,
    commandLatencyMilliseconds: null,
    clockOffsetMilliseconds: null,
  };

  private weapon: ItemId | "unarmed" = "unarmed";

  constructor(
    private readonly role: PlayerRole,
    private behaviour: PracticeBehaviour = "follow",
    private readonly arena: ArenaDefinition = BEACH_ARENA,
  ) {
    this.state = createPracticeState(role, { arena: this.arena });
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.updateMetrics({ state: "connected", roundTripMilliseconds: 0 });
    this.publish();
    this.timer = window.setInterval(() => this.tick(), TICK_MILLISECONDS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.updateMetrics({ state: "offline" });
  }

  send(command: GameCommand): boolean {
    if (command.role !== this.role) return false;
    const player = this.state.match.players[command.role];
    if (command.sequence <= player.lastProcessedSequence) return false;
    player.lastProcessedSequence = command.sequence;
    const error = applyGameCommand(this.state, command);
    if (error) {
      this.emitError({
        code: error.code,
        message: "Dit kan in de testmodus nu niet.",
      });
      return true;
    }
    if (command.type !== "input") this.publish();
    return true;
  }

  setBehaviour(behaviour: PracticeBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Practice-only: gives the tester a weapon without waiting for a chest. */
  setWeapon(itemId: ItemId | "unarmed"): void {
    this.weapon = itemId;
    grantPracticeWeapon(this.state, this.role, itemId);
    this.publish();
  }

  restart(): void {
    this.state = createPracticeState(this.role, { arena: this.arena });
    grantPracticeWeapon(this.state, this.role, this.weapon);
    this.publish();
  }

  onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onError(listener: (error: SessionError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onMetrics(listener: (metrics: TransportMetrics) => void): () => void {
    this.metricsListeners.add(listener);
    listener({ ...this.metrics });
    return () => this.metricsListeners.delete(listener);
  }

  private tick(): void {
    const botRole = practiceOpponent(this.role);
    const phase = this.state.match.phase;
    if (phase === "ready" || phase === "paused") {
      setPlayerReady(this.state, botRole, true);
    } else if (phase === "countdown") {
      advanceLifecycle(this.state, this.state.match.tick + 1);
      if (this.state.match.phase === "playing") {
        initializeArena(this.state, this.arena);
      }
    } else if (phase === "playing") {
      setInputIntent(
        this.state,
        botRole,
        practiceBotIntent(this.state, botRole, this.behaviour),
      );
      simulateMovementTick(this.state, this.arena);
    }
    if (this.state.match.tick % SNAPSHOT_INTERVAL_TICKS === 0) this.publish();
  }

  private publish(): void {
    this.revision += 1;
    const snapshot: GameSnapshot = {
      schemaVersion: GAME_SCHEMA_VERSION,
      protocolVersion: GAME_PROTOCOL_VERSION,
      revision: this.revision,
      tick: this.state.match.tick,
      acknowledgedSequences: {
        luca: this.state.match.players.luca.lastProcessedSequence,
        senna: this.state.match.players.senna.lastProcessedSequence,
      },
      state: structuredClone(this.state),
    };
    this.updateMetrics({ latestTick: snapshot.tick });
    for (const listener of this.snapshotListeners) listener(snapshot);
  }

  private emitError(error: SessionError): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private updateMetrics(update: Partial<TransportMetrics>): void {
    this.metrics = { ...this.metrics, ...update };
    for (const listener of this.metricsListeners) listener({ ...this.metrics });
  }
}
