import {
  GAME_PROTOCOL_VERSION,
  GAME_SCHEMA_VERSION,
  type GameCommand,
  type GameSnapshot,
  type PlayerRole,
} from "../game/types.js";
import type {
  MatchSession,
  SessionError,
  TransportMetrics,
} from "./match-session.js";

export type { TransportMetrics } from "./match-session.js";

interface ProtocolEnvelope {
  type?: string;
  protocolVersion?: number;
  schemaVersion?: number;
  serverTime?: number;
  clientTime?: number;
  commandId?: string;
  accepted?: boolean;
  error?: SessionError;
  snapshot?: GameSnapshot;
}

export function shouldAcceptSnapshot(
  latestRevision: number,
  incomingRevision: number,
): boolean {
  return (
    Number.isSafeInteger(incomingRevision) && incomingRevision > latestRevision
  );
}

export class RealtimeClient implements MatchSession {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private reconnectAttempt = 0;
  private latestTick = -1;
  private latestRevision = -1;
  private readonly commandSentAt = new Map<string, number>();
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

  constructor(
    private readonly endpoint: string,
    private readonly role: PlayerRole,
    private readonly token?: string,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.socket?.close(1000, "Client gestopt.");
    this.socket = null;
    this.updateMetrics({ state: "offline" });
  }

  send(command: GameCommand): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.commandSentAt.set(command.id, performance.now());
    this.socket.send(JSON.stringify({ type: "command", command }));
    return true;
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

  private open(): void {
    if (this.stopped) return;
    this.updateMetrics({
      state: this.reconnectAttempt === 0 ? "connecting" : "reconnecting",
    });
    const url = new URL(this.endpoint);
    url.searchParams.set("role", this.role);
    const protocols = [`game.v${GAME_PROTOCOL_VERSION}`];
    if (this.token) protocols.push(`auth.${this.token}`);
    const socket = new WebSocket(url, protocols);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.latestRevision = -1;
      this.updateMetrics({ state: "connected" });
      this.startPinging();
    });
    socket.addEventListener("message", (event: MessageEvent<string>) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      window.clearInterval(this.pingTimer);
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private handleMessage(serialized: string): void {
    let message: ProtocolEnvelope;
    try {
      message = JSON.parse(serialized) as ProtocolEnvelope;
    } catch {
      this.emitError({
        code: "INVALID_MESSAGE",
        message: "De server stuurde geen geldig bericht.",
      });
      return;
    }

    if (message.type === "hello") {
      if (
        message.protocolVersion !== GAME_PROTOCOL_VERSION ||
        message.schemaVersion !== GAME_SCHEMA_VERSION
      ) {
        this.emitError({
          code: "PROTOCOL_MISMATCH",
          message: "Vernieuw de pagina voor de juiste spelversie.",
        });
        this.stop();
        return;
      }
      if (typeof message.serverTime === "number") {
        this.updateMetrics({
          clockOffsetMilliseconds: message.serverTime - Date.now(),
        });
      }
      return;
    }

    if (message.type === "snapshot" && message.snapshot) {
      if (!shouldAcceptSnapshot(this.latestRevision, message.snapshot.revision))
        return;
      this.latestRevision = message.snapshot.revision;
      this.latestTick = message.snapshot.tick;
      this.updateMetrics({ latestTick: this.latestTick });
      for (const listener of this.snapshotListeners) listener(message.snapshot);
      return;
    }

    if (message.type === "ack" && message.commandId) {
      const sentAt = this.commandSentAt.get(message.commandId);
      if (sentAt !== undefined) {
        this.commandSentAt.delete(message.commandId);
        this.updateMetrics({
          commandLatencyMilliseconds: performance.now() - sentAt,
        });
      }
      if (message.accepted === false && message.error)
        this.emitError(message.error);
      return;
    }

    if (message.type === "pong" && typeof message.clientTime === "number") {
      this.updateMetrics({
        roundTripMilliseconds: performance.now() - message.clientTime,
      });
      return;
    }
    if (message.type === "error" && message.error)
      this.emitError(message.error);
  }

  /**
   * Sends a ping outside the normal rhythm. The room counts any message as
   * proof that this side is still there, so this is how a browser keeps its
   * connection alive while a match is frozen and no controls may be sent.
   */
  ping(): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(
      JSON.stringify({ type: "ping", clientTime: performance.now() }),
    );
    return true;
  }

  private startPinging(): void {
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({ type: "ping", clientTime: performance.now() }),
        );
      }
    }, 2_000);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    this.updateMetrics({
      state: "reconnecting",
      reconnects: this.metrics.reconnects + 1,
    });
    const delay = Math.min(5_000, 250 * 2 ** (this.reconnectAttempt - 1));
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private emitError(error: SessionError): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private updateMetrics(update: Partial<TransportMetrics>): void {
    this.metrics = { ...this.metrics, ...update };
    for (const listener of this.metricsListeners) listener({ ...this.metrics });
  }
}
