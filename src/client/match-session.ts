import type {
  GameCommand,
  GameErrorCode,
  GameSnapshot,
} from "../game/types.js";

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "offline";

export interface SessionError {
  code: GameErrorCode;
  message: string;
}

export interface TransportMetrics {
  state: ConnectionState;
  reconnects: number;
  latestTick: number;
  roundTripMilliseconds: number | null;
  commandLatencyMilliseconds: number | null;
  clockOffsetMilliseconds: number | null;
}

/**
 * Shared surface of every match transport. The networked client talks to the
 * authoritative Durable Object; the practice session runs the same rules locally
 * for single-player testing and never touches shared state.
 */
export interface MatchSession {
  start(): void;
  stop(): void;
  send(command: GameCommand): boolean;
  /** Proves this side is still connected without sending a game command. */
  ping(): boolean;
  onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void;
  onError(listener: (error: SessionError) => void): () => void;
  onMetrics(listener: (metrics: TransportMetrics) => void): () => void;
}
