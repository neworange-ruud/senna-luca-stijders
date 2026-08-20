import { arenaForWorld } from "../src/game/content.js";
import { applyGameCommand } from "../src/game/commands.js";
import {
  applyConnectionHealth,
  everyoneCanAct,
  watchesHeartbeats,
} from "../src/game/connection.js";
import { acceptCommand, type SequenceState } from "../src/game/determinism.js";
import { selectChestPoint } from "../src/game/chests.js";
import { CHESTS } from "../src/game/config.js";
import { createItem, giveItem } from "../src/game/items.js";
import {
  advanceLifecycle,
  createInitialGameState,
  setPlayerConnected,
} from "../src/game/state-machine.js";
import {
  hasIrreversibleOutcome,
  initializeArena,
  simulateMovementTick,
} from "../src/game/simulation.js";
import {
  CHEST_OUTCOMES,
  GAME_PROTOCOL_VERSION,
  GAME_SCHEMA_VERSION,
  isGameError,
  isPlayerRole,
  parseGameCommand,
  type ArenaDefinition,
  type GameCommand,
  type GameError,
  type GameSnapshot,
  type ChestOutcome,
  type GameState,
  type ItemId,
  type PlayerRole,
} from "../src/game/types.js";
import { verifyRoleToken } from "../src/shared/role-token.js";
import { verifyInternalRequest } from "../src/shared/internal-signature.js";

export interface Env {
  APP_ENV: string;
  CLIENT_ORIGIN: string;
  ROOM_ID: string;
  E2E_IN_MEMORY?: string;
  SESSION_SIGNING_SECRET: string;
  WORKER_INTERNAL_SECRET: string;
  GAME_ROOMS: DurableObjectNamespace;
}

interface SocketAttachment {
  role: PlayerRole;
  generation: number;
}

interface PersistedRoom {
  schemaVersion: typeof GAME_SCHEMA_VERSION;
  state: GameState;
  generations: Record<PlayerRole, number>;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

const SOCKET_PROTOCOL = `game.v${GAME_PROTOCOL_VERSION}`;
const MAX_MESSAGE_BYTES = 1_024;
const MAX_COMMANDS_PER_SECOND = 60;
const MAX_PROCESSED_COMMAND_IDS = 512;
const SNAPSHOT_INTERVAL_TICKS = 2;
const PERSIST_INTERVAL_TICKS = 6;
const ACTIVE_PHASES = new Set(["countdown", "playing"]);
/**
 * Only held controls are withdrawn while a heartbeat is late. Asking to pause,
 * to be ready, or for a rematch can never gain an advantage, and refusing a
 * pause from a child on a bad connection would just lose the request.
 */
const WITHDRAWN_WHILE_STALE = new Set(["input"]);

const DUTCH_ERRORS: Record<GameError["code"], string> = {
  INVALID_MESSAGE: "Dit spelbericht klopt niet.",
  PROTOCOL_MISMATCH: "Deze spelversie past niet bij de server.",
  UNAUTHORIZED: "Je mag deze speler niet besturen.",
  DUPLICATE_COMMAND: "Deze actie was al verwerkt.",
  STALE_SEQUENCE: "Deze actie is te oud.",
  INVALID_PHASE: "Deze actie kan nu niet.",
  INVALID_ARENA: "Deze wereld kan niet worden gestart.",
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorPayload(error: GameError) {
  return {
    code: error.code,
    message: DUTCH_ERRORS[error.code],
    details: error.details,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const requestOrigin = request.headers.get("origin");
      const allowedOrigin =
        requestOrigin &&
        (env.APP_ENV === "development" ||
          (env.APP_ENV === "preview" && requestOrigin.endsWith(".vercel.app")))
          ? requestOrigin
          : env.CLIENT_ORIGIN;
      return json(
        {
          status: "ok",
          omgeving: env.APP_ENV,
          protocolVersion: GAME_PROTOCOL_VERSION,
          schemaVersion: GAME_SCHEMA_VERSION,
        },
        { headers: { "access-control-allow-origin": allowedOrigin } },
      );
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ fout: "WebSocket-upgrade vereist." }, { status: 426 });
      }
      const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((protocol) => protocol.trim());
      if (!protocols.includes(SOCKET_PROTOCOL)) {
        return json(
          {
            fout: DUTCH_ERRORS.PROTOCOL_MISMATCH,
            protocolVersion: GAME_PROTOCOL_VERSION,
          },
          { status: 426 },
        );
      }
      let role: PlayerRole | null;
      let generation: number;
      if (env.APP_ENV === "development") {
        const encodedToken = protocols
          .find((protocol) => protocol.startsWith("auth."))
          ?.slice("auth.".length);
        const claims = encodedToken
          ? await verifyRoleToken(
              env.SESSION_SIGNING_SECRET,
              encodedToken,
              env.APP_ENV,
            )
          : null;
        const requestedRole = url.searchParams.get("role");
        role =
          claims?.role ?? (isPlayerRole(requestedRole) ? requestedRole : null);
        generation = claims?.generation ?? 0;
      } else {
        const encodedToken = protocols
          .find((protocol) => protocol.startsWith("auth."))
          ?.slice("auth.".length);
        const claims =
          encodedToken && env.SESSION_SIGNING_SECRET
            ? await verifyRoleToken(
                env.SESSION_SIGNING_SECRET,
                encodedToken,
                env.APP_ENV,
              )
            : null;
        role = claims?.role ?? null;
        generation = claims?.generation ?? 0;
      }
      if (!role) {
        return json({ fout: "Kies Luca of Senna." }, { status: 403 });
      }

      const room = env.GAME_ROOMS.getByName(`${env.APP_ENV}:${env.ROOM_ID}`);
      const roomUrl = new URL(request.url);
      roomUrl.searchParams.set("role", role);
      const roomHeaders = new Headers(request.headers);
      roomHeaders.set("x-role-generation", String(generation));
      return room.fetch(new Request(roomUrl, { headers: roomHeaders }));
    }

    if (url.pathname === "/internal/revoke" && request.method === "POST") {
      const body = await request.text();
      const supplied = request.headers.get("x-strijders-signature") ?? "";
      if (
        !env.WORKER_INTERNAL_SECRET ||
        !(await verifyInternalRequest(
          env.WORKER_INTERNAL_SECRET,
          body,
          supplied,
        ))
      ) {
        return json({ fout: "Geen toegang." }, { status: 403 });
      }
      let payload: { role?: unknown; generation?: unknown; issuedAt?: unknown };
      try {
        payload = JSON.parse(body) as typeof payload;
      } catch {
        return json({ fout: "Ongeldig bericht." }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1_000);
      if (
        !isPlayerRole(payload.role) ||
        !Number.isSafeInteger(payload.generation) ||
        Number(payload.generation) < 1 ||
        !Number.isSafeInteger(payload.issuedAt) ||
        Math.abs(now - Number(payload.issuedAt)) > 60
      ) {
        return json({ fout: "Ongeldig bericht." }, { status: 400 });
      }
      const room = env.GAME_ROOMS.getByName(`${env.APP_ENV}:${env.ROOM_ID}`);
      const headers = new Headers({
        "x-revoke-role": payload.role,
        "x-revoke-generation": String(payload.generation),
      });
      return room.fetch(
        new Request("https://room.internal/internal/revoke", {
          method: "POST",
          headers,
        }),
      );
    }

    if (
      [
        "/debug/reset",
        "/debug/start-playing",
        "/debug/give-weapon",
        "/debug/spawn-chest",
      ].includes(url.pathname) &&
      request.method === "POST" &&
      env.APP_ENV === "development" &&
      (url.pathname === "/debug/reset" || env.E2E_IN_MEMORY === "true")
    ) {
      const room = env.GAME_ROOMS.getByName(`${env.APP_ENV}:${env.ROOM_ID}`);
      return room.fetch(request);
    }

    return json({ fout: "Niet gevonden." }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class GameRoom {
  private state = createInitialGameState(20_260_819);
  private readonly ready: Promise<void>;
  private timer: number | null = null;
  private snapshotRevision = 0;
  private generations: Record<PlayerRole, number> = { luca: 0, senna: 0 };
  /** Wall-clock time each role last sent anything, for heartbeat staleness. */
  private lastHeardAt: Record<PlayerRole, number> = { luca: 0, senna: 0 };
  private readonly rateWindows = new Map<WebSocket, RateWindow>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const persisted = await this.ctx.storage.get<PersistedRoom>("checkpoint");
      if (!persisted) return;
      // Credential generations outlive the game rules. Keeping them across an
      // incompatible deployment means a replaced device stays replaced even
      // when the match itself has to be discarded.
      this.generations = persisted.generations ?? { luca: 0, senna: 0 };
      if (persisted.schemaVersion !== GAME_SCHEMA_VERSION) {
        // A match from another schema cannot be reasoned about safely, so it is
        // dropped rather than partly loaded. Deploying the Worker first means
        // this only ever discards a match that was already mid-upgrade.
        // Auditable in the Cloudflare log, with no player data in it.
        console.log(
          JSON.stringify({
            event: "checkpoint_drained",
            omgeving: this.env.APP_ENV,
            from: persisted.schemaVersion,
            to: GAME_SCHEMA_VERSION,
          }),
        );
        await this.persist();
        return;
      }
      this.state = persisted.state;
      if (["countdown", "playing", "paused"].includes(this.state.match.phase)) {
        this.state.match.phase = "reconnecting";
        this.state.match.resumeTarget = "playing";
      }
      for (const player of Object.values(this.state.match.players)) {
        player.connected = false;
        player.ready = false;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (new URL(request.url).pathname === "/internal/revoke") {
      const role = request.headers.get("x-revoke-role");
      const generation = Number(request.headers.get("x-revoke-generation"));
      if (
        !isPlayerRole(role) ||
        !Number.isSafeInteger(generation) ||
        generation < 1
      ) {
        return json({ fout: "Ongeldig bericht." }, { status: 400 });
      }
      this.generations[role] = Math.max(this.generations[role], generation);
      for (const socket of this.openSockets()) {
        const attachment =
          socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment?.role === role && attachment.generation < generation) {
          socket.close(4003, "Apparaat vervangen.");
        }
      }
      await this.persist();
      return json({ status: "ok", role, generation: this.generations[role] });
    }
    if (new URL(request.url).pathname === "/debug/reset") {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      for (const socket of this.openSockets())
        socket.close(4000, "Testruimte gewist.");
      this.state = createInitialGameState(20_260_819);
      this.snapshotRevision = 0;
      this.generations = { luca: 0, senna: 0 };
      // The heartbeat clock belongs to the old room; a fresh room must not
      // start out looking like a connection that has been quiet for minutes.
      this.lastHeardAt = { luca: 0, senna: 0 };
      this.rateWindows.clear();
      await this.ctx.storage.deleteAll();
      await this.persist();
      return json({ status: "ok" });
    }
    if (new URL(request.url).pathname === "/debug/start-playing") {
      this.state = createInitialGameState(20_260_819);
      this.state.match.players.luca.connected = true;
      this.state.match.players.senna.connected = true;
      this.state.match.players.luca.cosmetic = "knight";
      this.state.match.players.senna.cosmetic = "pirate";
      this.state.match.phase = "playing";
      const startedAt = Date.now();
      this.lastHeardAt = { luca: startedAt, senna: startedAt };
      initializeArena(this.state, this.arena());
      this.broadcast(this.snapshotMessage());
      this.ensureSimulationLoop();
      return json({ status: "ok" });
    }
    if (new URL(request.url).pathname === "/debug/spawn-chest") {
      // Development only. It announces a real chest with a chosen reward so the
      // automated journey can demonstrate every outcome without waiting out the
      // twelve-second schedule that the unit tests already cover.
      const query = new URL(request.url).searchParams;
      const outcome = query.get("outcome");
      const near = query.get("role");
      if (!CHEST_OUTCOMES.includes(outcome as ChestOutcome)) {
        return json({ fout: "Onbekende kistinhoud." }, { status: 400 });
      }
      // Clear whatever the normal schedule already put out and push the next
      // announcement back, so the requested chest always lands on the point
      // nearest the named player and the journey stays deterministic.
      this.state.match.chests = [];
      this.state.match.chestSchedule = {
        ...this.state.match.chestSchedule,
        nextAnnouncementTick: this.state.match.tick + CHESTS.intervalTicks * 10,
      };
      const point = selectChestPoint(
        this.state,
        this.arena(),
        isPlayerRole(near) ? near : "luca",
      );
      if (!point)
        return json({ fout: "Geen vrije kistplek." }, { status: 409 });
      const number = this.state.match.nextEntityNumber;
      this.state.match.nextEntityNumber += 1;
      this.state.match.chests = [
        ...this.state.match.chests,
        {
          id: `chest-debug-${number}`,
          pointId: point.id,
          position: { x: point.x, y: point.y },
          outcome: outcome as ChestOutcome,
          announcedAtTick: this.state.match.tick,
          landsAtTick: this.state.match.tick + CHESTS.announceTicks,
          recovery: false,
        },
      ];
      await this.persist();
      this.broadcast(this.snapshotMessage());
      return json({ status: "ok", point: point.id, outcome });
    }
    if (new URL(request.url).pathname === "/debug/give-weapon") {
      // Development only. Chests are the real source of weapons; this exists so
      // the automated dual-client duel can exercise every weapon before the
      // chest loop lands, and it is unreachable outside local development.
      const query = new URL(request.url).searchParams;
      const target = query.get("role");
      const itemId = query.get("item");
      if (
        !isPlayerRole(target) ||
        !["sword", "weak-sword", "nerf"].includes(itemId ?? "")
      ) {
        return json({ fout: "Ongeldig testwapen." }, { status: 400 });
      }
      const player = this.state.match.players[target];
      giveItem(player, createItem(this.state, itemId as ItemId, target));
      if (query.get("x")) {
        player.position = {
          x: Number(query.get("x")),
          y: Number(query.get("y") ?? player.position.y),
        };
        player.facing = target === "luca" ? "right" : "left";
      }
      const health = Number(query.get("health"));
      if (Number.isInteger(health) && health >= 1 && health <= 10) {
        // Lets a journey reach the last heart without grinding out nine hits.
        // The killing blow itself still has to be a real authoritative attack.
        player.health = health;
      }
      await this.persist();
      this.broadcast(this.snapshotMessage());
      return json({ status: "ok", role: target, item: itemId });
    }
    const role = new URL(request.url).searchParams.get("role");
    if (!isPlayerRole(role))
      return json({ fout: "Onbekende speler." }, { status: 403 });
    const generation = Number(request.headers.get("x-role-generation") ?? 0);
    if (
      !Number.isSafeInteger(generation) ||
      generation < this.generations[role]
    ) {
      return json(
        { fout: "Deze koppeling is niet meer geldig." },
        { status: 403 },
      );
    }
    this.generations[role] = Math.max(this.generations[role], generation);

    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.role === role && socket.readyState === WebSocket.OPEN) {
        socket.close(4001, "Speler is al verbonden.");
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ role, generation } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    setPlayerConnected(this.state, role, true);
    this.lastHeardAt[role] = Date.now();
    await this.persist();

    server.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: GAME_PROTOCOL_VERSION,
        schemaVersion: GAME_SCHEMA_VERSION,
        role,
        serverTime: Date.now(),
      }),
    );
    this.broadcast(this.snapshotMessage());
    this.broadcastPresence();
    this.ensureSimulationLoop();

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": SOCKET_PROTOCOL },
    });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.ready;
    // Anything at all on a role's socket proves that connection is answering,
    // so it counts as that role's heartbeat: a command, or just a ping.
    const speaker = (socket.deserializeAttachment() as SocketAttachment | null)
      ?.role;
    if (speaker) {
      this.lastHeardAt[speaker] = Date.now();
      if (!this.state.match.players[speaker].connected) {
        setPlayerConnected(this.state, speaker, true);
      }
    }
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES) {
      this.sendError(socket, {
        code: "INVALID_MESSAGE",
        messageKey: "fout.ongeldigBericht",
      });
      return;
    }
    if (!this.withinRateLimit(socket)) {
      this.sendError(socket, {
        code: "INVALID_MESSAGE",
        messageKey: "fout.teVeelActies",
        details: { limiet: MAX_COMMANDS_PER_SECOND },
      });
      return;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(message) as unknown;
    } catch {
      this.sendError(socket, {
        code: "INVALID_MESSAGE",
        messageKey: "fout.ongeldigBericht",
      });
      return;
    }
    if (!envelope || typeof envelope !== "object") {
      this.sendError(socket, {
        code: "INVALID_MESSAGE",
        messageKey: "fout.ongeldigBericht",
      });
      return;
    }
    const typedEnvelope = envelope as {
      type?: unknown;
      clientTime?: unknown;
      command?: unknown;
    };
    if (typedEnvelope.type === "ping") {
      socket.send(
        JSON.stringify({
          type: "pong",
          clientTime: typedEnvelope.clientTime,
          serverTime: Date.now(),
        }),
      );
      return;
    }
    if (typedEnvelope.type !== "command") {
      this.sendError(socket, {
        code: "INVALID_MESSAGE",
        messageKey: "fout.ongeldigBericht",
      });
      return;
    }

    const command = parseGameCommand(typedEnvelope.command);
    if (isGameError(command)) {
      this.sendError(socket, command);
      return;
    }
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.role !== command.role) {
      this.sendAcknowledgement(socket, command, {
        code: "UNAUTHORIZED",
        messageKey: "fout.geenToegang",
      });
      return;
    }

    if (
      WITHDRAWN_WHILE_STALE.has(command.type) &&
      !everyoneCanAct(this.silenceMilliseconds())
    ) {
      this.sendAcknowledgement(socket, command, {
        code: "INVALID_PHASE",
        messageKey: "fout.verbindingHapert",
      });
      return;
    }

    const sequenceState: SequenceState = {
      lastByRole: {
        luca: this.state.match.players.luca.lastProcessedSequence,
        senna: this.state.match.players.senna.lastProcessedSequence,
      },
      processedIds: new Set(this.state.processedCommandIds),
    };
    const acceptance = acceptCommand(sequenceState, command);
    if (!acceptance.accepted) {
      this.sendAcknowledgement(socket, command, acceptance.error);
      return;
    }
    this.state.match.players[command.role].lastProcessedSequence =
      command.sequence;
    this.state.processedCommandIds = [...sequenceState.processedIds].slice(
      -MAX_PROCESSED_COMMAND_IDS,
    );

    const beforePhase = this.state.match.phase;
    const error = applyGameCommand(this.state, command);
    const lifecycleChanged = beforePhase !== this.state.match.phase;
    if (command.type !== "input" || lifecycleChanged) await this.persist();
    this.sendAcknowledgement(socket, command, error);
    if (!error && command.type !== "input")
      this.broadcast(this.snapshotMessage());
    this.ensureSimulationLoop();
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    this.rateWindows.delete(socket);
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    const replacementIsOpen = attachment
      ? this.openSockets().some((candidate) => {
          const candidateAttachment =
            candidate.deserializeAttachment() as SocketAttachment | null;
          return candidateAttachment?.role === attachment.role;
        })
      : false;
    const left = Boolean(attachment) && !replacementIsOpen;
    if (attachment && left) {
      setPlayerConnected(this.state, attachment.role, false);
    }
    await this.persist();
    if (left) {
      // The player who stayed has to see that the match is frozen; presence
      // alone does not carry the new phase.
      this.broadcast(this.snapshotMessage());
    }
    this.broadcastPresence();
    this.stopSimulationLoopIfIdle();
  }

  /**
   * The arena of the world these two chose. Once play starts the choice is
   * fixed for the whole match, and the arena is derived rather than stored so a
   * checkpoint can never disagree with the world it says it is playing.
   */
  private arena(): ArenaDefinition {
    return arenaForWorld(
      this.state.match.arenaId ?? this.state.lobby.selectedWorld,
    );
  }

  /** The room keeps ticking while it simulates or while it watches heartbeats. */
  private needsLoop(): boolean {
    return (
      ACTIVE_PHASES.has(this.state.match.phase) || watchesHeartbeats(this.state)
    );
  }

  private ensureSimulationLoop(): void {
    if (this.timer !== null || !this.needsLoop()) return;
    this.timer = setTimeout(
      () => void this.runSimulationLoop(),
      1_000 / 30,
    ) as unknown as number;
  }

  private stopSimulationLoopIfIdle(): void {
    if (this.timer === null || this.needsLoop()) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** How long each role has been silent, from the room's own clock. */
  private silenceMilliseconds(): Record<PlayerRole, number> {
    const now = Date.now();
    return {
      luca: this.lastHeardAt.luca === 0 ? 0 : now - this.lastHeardAt.luca,
      senna: this.lastHeardAt.senna === 0 ? 0 : now - this.lastHeardAt.senna,
    };
  }

  private async runSimulationLoop(): Promise<void> {
    this.timer = null;
    try {
      await this.tick();
    } finally {
      this.ensureSimulationLoop();
    }
  }

  private async tick(): Promise<void> {
    await this.ready;
    let confirmed = false;
    // A quiet heartbeat freezes the whole match before anything else runs, so
    // no tick is simulated while one side cannot answer.
    const health = applyConnectionHealth(
      this.state,
      this.silenceMilliseconds(),
    );
    if (health.changed) {
      await this.persist();
      this.broadcast(this.snapshotMessage());
      this.broadcastPresence();
    }
    if (!ACTIVE_PHASES.has(this.state.match.phase)) {
      // Frozen by a connection: keep watching the heartbeats, simulate nothing.
      this.stopSimulationLoopIfIdle();
      return;
    }
    const phaseBeforeTick = this.state.match.phase;
    if (this.state.match.phase === "countdown") {
      const priorPhase = this.state.match.phase;
      advanceLifecycle(this.state, this.state.match.tick + 1);
      if (
        priorPhase !== this.state.match.phase &&
        this.state.match.phase === "playing"
      ) {
        // Play starts now, so the heartbeat clock starts now too. Otherwise a
        // long quiet lobby would look like a failing connection on tick one.
        const now = Date.now();
        this.lastHeardAt = { luca: now, senna: now };
        initializeArena(this.state, this.arena());
        await this.persist();
        confirmed = true;
      }
    } else if (this.state.match.phase === "playing") {
      const step = simulateMovementTick(this.state, this.arena());
      if (hasIrreversibleOutcome(step)) {
        await this.persist();
        confirmed = true;
      }
    }

    if (
      !confirmed &&
      this.env.APP_ENV !== "development" &&
      this.state.match.tick % PERSIST_INTERVAL_TICKS === 0
    ) {
      await this.persist();
    }
    // A phase change never waits for the snapshot cadence. The tick that ends a
    // match is also the last tick the room simulates, so a snapshot skipped
    // here is never sent at all and both players keep staring at a match that
    // is already over.
    const phaseChanged = phaseBeforeTick !== this.state.match.phase;
    if (phaseChanged && !confirmed) await this.persist();
    if (phaseChanged || this.state.match.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcast(this.snapshotMessage());
    }
    this.stopSimulationLoopIfIdle();
  }

  private snapshotMessage() {
    this.snapshotRevision += 1;
    const snapshot: GameSnapshot = {
      schemaVersion: GAME_SCHEMA_VERSION,
      protocolVersion: GAME_PROTOCOL_VERSION,
      revision: this.snapshotRevision,
      tick: this.state.match.tick,
      acknowledgedSequences: {
        luca: this.state.match.players.luca.lastProcessedSequence,
        senna: this.state.match.players.senna.lastProcessedSequence,
      },
      state: structuredClone(this.state),
    };
    return { type: "snapshot", snapshot } as const;
  }

  private sendAcknowledgement(
    socket: WebSocket,
    command: GameCommand,
    error: GameError | null,
  ): void {
    socket.send(
      JSON.stringify({
        type: "ack",
        commandId: command.id,
        sequence: command.sequence,
        tick: this.state.match.tick,
        accepted: error === null,
        error: error ? errorPayload(error) : undefined,
      }),
    );
  }

  private sendError(socket: WebSocket, error: GameError): void {
    socket.send(JSON.stringify({ type: "error", error: errorPayload(error) }));
  }

  private withinRateLimit(socket: WebSocket): boolean {
    const now = Date.now();
    const window = this.rateWindows.get(socket);
    if (!window || now - window.startedAt >= 1_000) {
      this.rateWindows.set(socket, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= MAX_COMMANDS_PER_SECOND;
  }

  private openSockets(): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private broadcastPresence(): void {
    const sockets = this.openSockets();
    this.broadcast({ type: "presence", connections: sockets.length });
  }

  private broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.openSockets()) socket.send(serialized);
  }

  private async persist(): Promise<void> {
    if (this.env.E2E_IN_MEMORY === "true") return;
    await this.ctx.storage.put("checkpoint", {
      schemaVersion: GAME_SCHEMA_VERSION,
      state: this.state,
      generations: this.generations,
    } satisfies PersistedRoom);
  }
}
