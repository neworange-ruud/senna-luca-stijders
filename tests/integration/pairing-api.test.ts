import { describe, expect, it, vi } from "vitest";
import { createPairHandler, revocationEndpoint } from "../../api/pair.js";
import { createSessionHandler } from "../../api/session.js";
import type { FunctionRequest, FunctionResponse } from "../../server/http.js";
import { hashDeviceCredential } from "../../server/credentials.js";
import type {
  DeviceBinding,
  DeviceStoreContract,
  PairResult,
} from "../../server/device-store.js";
import { verifyRoleToken } from "../../src/shared/role-token.js";

class MemoryDevices implements DeviceStoreContract {
  bindings: Partial<Record<"luca" | "senna", DeviceBinding>> = {};
  limited = false;
  get(role: "luca" | "senna"): Promise<DeviceBinding | null> {
    return Promise.resolve(this.bindings[role] ?? null);
  }
  pair(
    role: "luca" | "senna",
    credential: { salt: string; hash: string },
    replace: boolean,
    now: number,
  ): Promise<PairResult> {
    const current = this.bindings[role];
    if (current && !replace)
      return Promise.resolve({ paired: false, binding: current });
    const binding = {
      role,
      generation: (current?.generation ?? 0) + 1,
      credential,
      pairedAt: now,
    };
    this.bindings[role] = binding;
    return Promise.resolve({ paired: true, binding });
  }
  rateLimit(): Promise<boolean> {
    return Promise.resolve(!this.limited);
  }
}

class Response implements FunctionResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  json(value: unknown): this {
    this.body = value;
    return this;
  }
  end(): void {}
}

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): FunctionRequest {
  return { method, body, headers };
}

describe("pairing API", () => {
  const config = {
    adminPin: "482913",
    allowedOrigins: new Set(["https://game.test"]),
    secureCookie: true,
    revoke: () => Promise.resolve(true),
  };

  it("rejects cross-origin, wrong-PIN, and throttled attempts", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const store = new MemoryDevices();
    const handler = createPairHandler(store, config);
    const crossOrigin = new Response();
    await handler(
      request(
        "POST",
        { role: "luca", pin: "482913" },
        { "content-type": "application/json" },
      ),
      crossOrigin,
    );
    expect(crossOrigin.statusCode).toBe(403);

    const wrongPin = new Response();
    await handler(
      request(
        "POST",
        { role: "luca", pin: "000000" },
        { origin: "https://game.test", "content-type": "application/json" },
      ),
      wrongPin,
    );
    expect(wrongPin.statusCode).toBe(401);

    store.limited = true;
    const limited = new Response();
    await handler(
      request(
        "POST",
        { role: "luca", pin: "482913" },
        { origin: "https://game.test", "content-type": "application/json" },
      ),
      limited,
    );
    expect(limited.statusCode).toBe(429);
    const serializedLogs = JSON.stringify(log.mock.calls);
    expect(serializedLogs).toContain("requestId");
    expect(serializedLogs).not.toContain("000000");
    expect(serializedLogs).not.toContain("482913");
    log.mockRestore();
  });

  it("pairs once, requires replacement confirmation, and rotates generation", async () => {
    const store = new MemoryDevices();
    const handler = createPairHandler(store, config);
    const send = async (replace = false) => {
      const response = new Response();
      await handler(
        request(
          "POST",
          { role: "luca", pin: "482913", replace },
          { origin: "https://game.test", "content-type": "application/json" },
        ),
        response,
      );
      return response;
    };

    const first = await send();
    expect(first.statusCode).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await send()).statusCode).toBe(409);
    const replacement = await send(true);
    expect(replacement.body).toMatchObject({ generation: 2, vervangen: true });
  });

  it("derives a fetchable revocation endpoint from the realtime WebSocket URL", () => {
    expect(revocationEndpoint("wss://worker.test/ws")).toBe(
      "https://worker.test/internal/revoke",
    );
    expect(revocationEndpoint("ws://127.0.0.1:8787/ws")).toBe(
      "http://127.0.0.1:8787/internal/revoke",
    );
    expect(revocationEndpoint("https://worker.test")).toBe(
      "https://worker.test/internal/revoke",
    );
    expect(revocationEndpoint(undefined)).toBeNull();
    expect(revocationEndpoint("not a url")).toBeNull();
  });

  it("still hands the replacement device its cookie when live revocation fails", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const store = new MemoryDevices();
    const handler = createPairHandler(store, {
      ...config,
      revoke: () => Promise.resolve(false),
    });
    const headers = {
      origin: "https://game.test",
      "content-type": "application/json",
    };
    const first = new Response();
    await handler(
      request("POST", { role: "luca", pin: "482913" }, headers),
      first,
    );
    expect(first.statusCode).toBe(200);
    const replacement = new Response();
    await handler(
      request("POST", { role: "luca", pin: "482913", replace: true }, headers),
      replacement,
    );
    // A failed live revocation must never leave both devices locked out.
    expect(replacement.statusCode).toBe(200);
    expect(replacement.headers.get("set-cookie")).toContain("HttpOnly");
    expect(replacement.body).toMatchObject({ generation: 2, vervangen: true });
    expect(JSON.stringify(log.mock.calls)).toContain("REVOCATION_DEFERRED");
    log.mockRestore();
  });

  it("issues a first-pair cookie without contacting the Worker", async () => {
    const revoke = vi.fn(() => Promise.resolve(false));
    const handler = createPairHandler(new MemoryDevices(), {
      ...config,
      revoke,
    });
    const response = new Response();
    await handler(
      request(
        "POST",
        { role: "senna", pin: "482913" },
        { origin: "https://game.test", "content-type": "application/json" },
      ),
      response,
    );
    expect(response.statusCode).toBe(200);
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("session API", () => {
  it("exchanges a valid device cookie for a short-lived scoped token", async () => {
    const store = new MemoryDevices();
    store.bindings.luca = {
      role: "luca",
      generation: 4,
      credential: hashDeviceCredential("device-secret", "fixed-salt"),
      pairedAt: 1,
    };
    const secret = "a long integration signing secret";
    const handler = createSessionHandler(store, {
      environment: "preview",
      signingSecret: secret,
      realtimeUrl: "wss://worker.test/ws",
      nowSeconds: () => 1_000,
    });
    const response = new Response();
    await handler(
      request("GET", undefined, { cookie: "strijders_device=device-secret" }),
      response,
    );
    expect(response.statusCode).toBe(200);
    const body = response.body as { token: string };
    await expect(
      verifyRoleToken(secret, body.token, "preview", 1_050),
    ).resolves.toMatchObject({
      role: "luca",
      generation: 4,
    });
  });

  it("rejects missing and stale device cookies", async () => {
    const handler = createSessionHandler(new MemoryDevices(), {
      environment: "preview",
      signingSecret: "a long integration signing secret",
      realtimeUrl: "wss://worker.test/ws",
      nowSeconds: () => 1_000,
    });
    const response = new Response();
    await handler(request("GET"), response);
    expect(response.statusCode).toBe(401);
  });
});
