import { env, exports } from "cloudflare:workers";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { GameRoom } from "../../worker/index";

interface ProtocolMessage {
  type: string;
  accepted?: boolean;
  error?: { code: string; message: string };
  snapshot?: {
    state: {
      lobby: { selectedWorld: string | null };
      match: { phase: string };
    };
  };
}

/** The parts of the room's private state these adversarial tests inspect. */
interface RoomState {
  match: {
    phase: string;
    tick: number;
    chests: { position: { x: number; y: number } }[];
    chestSchedule: { nextAnnouncementTick: number };
    players: Record<
      "luca" | "senna",
      {
        health: number;
        attackQueued: boolean;
        nextAttackTick: number;
        input: { attack: boolean };
        facing: "left" | "right";
        position: { x: number; y: number };
        inventory: unknown[];
      }
    >;
  };
}

const IDLE_INTENT = {
  horizontal: 0,
  jump: false,
  attack: false,
  block: false,
  action: false,
  switchWeapon: false,
} as const;

afterEach(async () => reset());

/**
 * Real clients resend their held controls every 250 ms, and the room freezes the
 * match when that stops. Tests that wait for a simulated outcome have to keep
 * that heartbeat going, so this pumps one intent per role until it is stopped.
 */
function startHeartbeat(
  sockets: readonly (readonly [WebSocket, "luca" | "senna"])[],
  intent: Record<string, unknown>,
): () => void {
  let sequence = 100;
  const timer = setInterval(() => {
    for (const [socket, role] of sockets) {
      sequence += 1;
      socket.send(
        JSON.stringify({
          type: "command",
          command: {
            type: "input",
            id: `beat-${role}-${sequence}`,
            role,
            sequence,
            intent,
          },
        }),
      );
    }
  }, 200);
  return () => clearInterval(timer);
}

function nextMessage(
  socket: WebSocket,
  predicate: (message: ProtocolMessage) => boolean,
): Promise<ProtocolMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Protocol message timed out")),
      2_000,
    );
    const listener = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as ProtocolMessage;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      resolve(message);
    };
    socket.addEventListener("message", listener);
  });
}

async function connect(role: "luca" | "senna"): Promise<WebSocket> {
  const response = await exports.default.fetch(
    `https://game.test/ws?role=${role}`,
    {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": "game.v1",
      },
    },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Worker returned no WebSocket.");
  socket.accept();
  return socket;
}

describe("realtime Worker", () => {
  it("reports matching protocol and schema health", async () => {
    const response = await exports.default.fetch("https://game.test/health");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      protocolVersion: 1,
      schemaVersion: 7,
    });
  });

  it("rejects missing protocol and invalid roles before room access", async () => {
    const mismatch = await exports.default.fetch(
      "https://game.test/ws?role=luca",
      {
        headers: { Upgrade: "websocket" },
      },
    );
    expect(mismatch.status).toBe(426);
    await expect(mismatch.json()).resolves.toMatchObject({
      protocolVersion: 1,
    });

    const invalidRole = await exports.default.fetch(
      "https://game.test/ws?role=ander",
      {
        headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "game.v1" },
      },
    );
    expect(invalidRole.status).toBe(403);
  });

  it("connects two roles to one room and persists accepted lifecycle commands", async () => {
    const luca = await connect("luca");
    const senna = await connect("senna");
    const selection = await nextMessage(
      senna,
      (message) =>
        message.type === "snapshot" &&
        message.snapshot?.state.match.phase === "world-selection",
    );
    expect(selection.snapshot?.state.match.phase).toBe("world-selection");

    const acknowledgement = nextMessage(
      luca,
      (message) => message.type === "ack",
    );
    luca.send(
      JSON.stringify({
        type: "command",
        command: {
          type: "select-world",
          id: "select-1",
          role: "luca",
          sequence: 1,
          world: "beach",
        },
      }),
    );
    await expect(acknowledgement).resolves.toMatchObject({
      type: "ack",
      accepted: true,
    });

    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    const checkpoint = await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.get("checkpoint"),
    );
    expect(checkpoint).toMatchObject({
      schemaVersion: 7,
      state: { lobby: { selectedWorld: "beach" } },
    });
    await evictDurableObject(stub, { webSockets: "close" });
    const restoredLuca = await connect("luca");
    const restored = await nextMessage(
      restoredLuca,
      (message) => message.type === "snapshot",
    );
    expect(restored.snapshot?.state.lobby.selectedWorld).toBe("beach");
    restoredLuca.close();
    luca.close();
    senna.close();
  });

  it("keeps a role online when an older same-role socket closes", async () => {
    const oldLuca = await connect("luca");
    const replacementLuca = await connect("luca");
    const selectionMessage = nextMessage(
      replacementLuca,
      (message) =>
        message.type === "snapshot" &&
        message.snapshot?.state.match.phase === "world-selection",
    );
    const senna = await connect("senna");
    const selection = await selectionMessage;
    expect(selection.snapshot?.state.match.phase).toBe("world-selection");
    oldLuca.close();
    replacementLuca.close();
    senna.close();
  });

  it("rejects malformed, forged-role, duplicate, and stale commands", async () => {
    const luca = await connect("luca");
    luca.send("not-json");
    const malformed = await nextMessage(
      luca,
      (message) => message.type === "error",
    );
    expect(malformed).toMatchObject({ error: { code: "INVALID_MESSAGE" } });
    expect(malformed.error?.message).toBeTypeOf("string");

    const forged = nextMessage(luca, (message) => message.type === "ack");
    luca.send(
      JSON.stringify({
        type: "command",
        command: { type: "pause", id: "forged", role: "senna", sequence: 1 },
      }),
    );
    await expect(forged).resolves.toMatchObject({
      accepted: false,
      error: { code: "UNAUTHORIZED" },
    });

    const first = nextMessage(luca, (message) => message.type === "ack");
    luca.send(
      JSON.stringify({
        type: "command",
        command: { type: "pause", id: "base", role: "luca", sequence: 1 },
      }),
    );
    await expect(first).resolves.toMatchObject({
      accepted: false,
      error: { code: "INVALID_PHASE" },
    });

    const duplicate = nextMessage(luca, (message) => message.type === "ack");
    luca.send(
      JSON.stringify({
        type: "command",
        command: { type: "pause", id: "base", role: "luca", sequence: 2 },
      }),
    );
    await expect(duplicate).resolves.toMatchObject({
      accepted: false,
      error: { code: "DUPLICATE_COMMAND" },
    });

    const stale = nextMessage(luca, (message) => message.type === "ack");
    luca.send(
      JSON.stringify({
        type: "command",
        command: { type: "pause", id: "stale", role: "luca", sequence: 1 },
      }),
    );
    await expect(stale).resolves.toMatchObject({
      accepted: false,
      error: { code: "STALE_SEQUENCE" },
    });
    luca.close();
  });

  it("rate limits command floods", async () => {
    const luca = await connect("luca");
    const limited = nextMessage(luca, (message) => message.type === "error");
    for (let index = 0; index <= 60; index += 1) {
      luca.send(JSON.stringify({ type: "ping", clientTime: index }));
    }
    const rateError = await limited;
    expect(rateError).toMatchObject({ error: { code: "INVALID_MESSAGE" } });
    expect(rateError.error?.message).toBeTypeOf("string");
    luca.close();
  });

  it("keeps combat authoritative when a client forges or floods attacks", async () => {
    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    const luca = await connect("luca");
    const senna = await connect("senna");
    const started = await stub.fetch(
      "https://room.internal/debug/start-playing",
      { method: "POST" },
    );
    expect(started.status).toBe(200);

    // Put the two fighters within unarmed reach of each other.
    await runInDurableObject(stub, (instance: GameRoom) => {
      const room = instance as unknown as { state: RoomState };
      const players = room.state.match.players;
      players.luca.position = { x: 300, y: 1_104 };
      players.senna.position = { x: 380, y: 1_104 };
      players.luca.facing = "right";
      players.senna.facing = "left";
    });

    const forged = nextMessage(senna, (message) => message.type === "ack");
    senna.send(
      JSON.stringify({
        type: "command",
        command: {
          type: "input",
          id: "forged-attack",
          role: "luca",
          sequence: 1,
          intent: { ...IDLE_INTENT, attack: true },
        },
      }),
    );
    await expect(forged).resolves.toMatchObject({
      accepted: false,
      error: { code: "UNAUTHORIZED" },
    });

    // Six full press and release cycles inside one cooldown window may still
    // only land a single unarmed hit, because the cadence is server owned.
    let sequence = 1;
    const press = (attack: boolean): void => {
      luca.send(
        JSON.stringify({
          type: "command",
          command: {
            type: "input",
            id: `flood-${sequence}`,
            role: "luca",
            sequence: (sequence += 1),
            intent: { ...IDLE_INTENT, attack },
          },
        }),
      );
    };
    for (let index = 0; index < 6; index += 1) {
      press(true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      press(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const health = await runInDurableObject(stub, (instance: GameRoom) => {
      const room = instance as unknown as { state: RoomState };
      return room.state.match.players.senna.health;
    });
    expect(health).toBe(9);

    const checkpoint = await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.get<{ state: RoomState }>("checkpoint"),
    );
    // The damage was durable before any client could see it.
    expect(checkpoint?.state.match.players.senna.health).toBe(9);

    luca.close();
    senna.close();
  });

  it(
    "gives a chest to exactly one of two simultaneous claim packets",
    { timeout: 20_000 },
    async () => {
      const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
      const stub = bindings.GAME_ROOMS.getByName("development:main");
      const luca = await connect("luca");
      const senna = await connect("senna");
      await stub.fetch("https://room.internal/debug/start-playing", {
        method: "POST",
      });
      const spawned = await stub.fetch(
        "https://room.internal/debug/spawn-chest?outcome=sword&role=luca",
        { method: "POST" },
      );
      expect(spawned.status).toBe(200);

      // Both players stand on the chest, so only the tie-break separates them.
      await runInDurableObject(stub, (instance: GameRoom) => {
        const room = instance as unknown as { state: RoomState };
        const chest = room.state.match.chests[0]!;
        for (const role of ["luca", "senna"] as const) {
          room.state.match.players[role].position = {
            x: chest.position.x - 32,
            y: chest.position.y - 96,
          };
        }
      });

      const stopHeartbeat = startHeartbeat(
        [
          [luca, "luca"],
          [senna, "senna"],
        ],
        { ...IDLE_INTENT, action: true },
      );
      // The chest still has to land before either claim can count, and the
      // simulation runs on its own clock, so wait for the outcome instead of
      // guessing how long that takes.
      const readRoom = () =>
        runInDurableObject(stub, (instance: GameRoom) => {
          const room = instance as unknown as { state: RoomState };
          return {
            chests: room.state.match.chests.length,
            luca: room.state.match.players.luca.inventory.length,
            senna: room.state.match.players.senna.inventory.length,
          };
        });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if ((await readRoom()).chests === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const result = await runInDurableObject(stub, (instance: GameRoom) => {
        const room = instance as unknown as { state: RoomState };
        return {
          chests: room.state.match.chests.length,
          luca: room.state.match.players.luca.inventory.length,
          senna: room.state.match.players.senna.inventory.length,
        };
      });
      expect(result.chests).toBe(0);
      // Exactly one player was rewarded, never both and never neither.
      expect(result.luca + result.senna).toBe(1);

      const checkpoint = await runInDurableObject(
        stub,
        async (_instance: GameRoom, state: DurableObjectState) =>
          state.storage.get<{ state: RoomState }>("checkpoint"),
      );
      const stored = checkpoint!.state.match.players;
      expect(stored.luca.inventory.length + stored.senna.inventory.length).toBe(
        1,
      );

      stopHeartbeat();
      luca.close();
      senna.close();
    },
  );

  it("tells both players about a match that ends between two snapshots", async () => {
    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    const luca = await connect("luca");
    const senna = await connect("senna");
    await stub.fetch("https://room.internal/debug/start-playing", {
      method: "POST",
    });

    const finishedForLuca = nextMessage(
      luca,
      (message) => message.snapshot?.state.match.phase === "finished",
    );
    const finishedForSenna = nextMessage(
      senna,
      (message) => message.snapshot?.state.match.phase === "finished",
    );

    // Arrange the killing blow so that it lands on an odd tick, which is
    // exactly the tick the snapshot cadence skips. The room stops simulating
    // right after it, so that snapshot is the only chance to tell anyone.
    await runInDurableObject(stub, (instance: GameRoom) => {
      const room = instance as unknown as { state: RoomState };
      const match = room.state.match;
      match.tick = 200;
      match.players.luca.position = { x: 300, y: 1_104 };
      match.players.senna.position = { x: 380, y: 1_104 };
      match.players.luca.facing = "right";
      match.players.senna.facing = "left";
      match.players.luca.nextAttackTick = 0;
      match.players.luca.input.attack = false;
      match.players.luca.attackQueued = true;
      match.players.senna.health = 1;
    });

    const seen = await Promise.all([finishedForLuca, finishedForSenna]);
    for (const message of seen) {
      expect(message.snapshot?.state.match.phase).toBe("finished");
    }
    const ending = await runInDurableObject(stub, (instance: GameRoom) => {
      const room = instance as unknown as { state: RoomState };
      return room.state.match.tick;
    });
    expect(ending % 2).toBe(1);

    luca.close();
    senna.close();
  });

  it("commits an announced chest and its schedule before a restart could happen", async () => {
    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    const luca = await connect("luca");
    const senna = await connect("senna");
    await stub.fetch("https://room.internal/debug/start-playing", {
      method: "POST",
    });
    await stub.fetch(
      "https://room.internal/debug/spawn-chest?outcome=armor&role=senna",
      { method: "POST" },
    );

    // Restarting restores the last checkpoint, so the announcement only counts
    // as safe once it is in that checkpoint. The restore path itself is covered
    // by the lobby eviction test above; an object that is actively simulating
    // cannot be evicted by the test harness.
    const checkpoint = await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.get<{ state: RoomState }>("checkpoint"),
    );
    expect(checkpoint?.state.match.chests).toHaveLength(1);
    expect(
      checkpoint?.state.match.chestSchedule.nextAnnouncementTick,
    ).toBeGreaterThan(0);
    luca.close();
    senna.close();
  });

  it("drains a checkpoint from another schema but keeps its generations", async () => {
    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    // Write a checkpoint that looks like an older deployment left it behind.
    await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.put("checkpoint", {
          schemaVersion: 1,
          generations: { luca: 4, senna: 2 },
          state: { nonsense: true },
        }),
    );
    await evictDurableObject(stub, { webSockets: "close" });

    // The match starts clean instead of loading a state it cannot reason about.
    const restored = await runInDurableObject(stub, (instance: GameRoom) => {
      const room = instance as unknown as { state: RoomState };
      return {
        phase: room.state.match.phase,
        chests: room.state.match.chests.length,
      };
    });
    expect(restored).toEqual({ phase: "waiting", chests: 0 });

    // A replaced device stays replaced across the incompatible deployment, and
    // the current generation still gets in.
    const stale = await runInDurableObject(stub, async (instance: GameRoom) =>
      instance.fetch(
        new Request("https://room.internal/ws?role=luca", {
          headers: { "x-role-generation": "3" },
        }),
      ),
    );
    expect(stale.status).toBe(403);

    // The drained checkpoint was rewritten at the current schema.
    const rewritten = await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.get<{ schemaVersion: number }>("checkpoint"),
    );
    expect(rewritten?.schemaVersion).toBe(7);
  });

  it("persists revocation generations and rejects stale role tokens", async () => {
    const bindings = env as unknown as { GAME_ROOMS: DurableObjectNamespace };
    const stub = bindings.GAME_ROOMS.getByName("development:main");
    const revoked = await stub.fetch("https://room.internal/internal/revoke", {
      method: "POST",
      headers: {
        "x-revoke-role": "luca",
        "x-revoke-generation": "2",
      },
    });
    expect(revoked.status).toBe(200);

    const stale = await runInDurableObject(stub, async (instance: GameRoom) =>
      instance.fetch(
        new Request("https://room.internal/ws?role=luca", {
          headers: { "x-role-generation": "1" },
        }),
      ),
    );
    expect(stale.status).toBe(403);

    const checkpoint = await runInDurableObject(
      stub,
      async (_instance: GameRoom, state: DurableObjectState) =>
        state.storage.get("checkpoint"),
    );
    expect(checkpoint).toMatchObject({ generations: { luca: 2 } });
  });
});
