import { describe, expect, it } from "vitest";
import {
  createHandler,
  type FunctionRequest,
  type FunctionResponse,
} from "../api/state";
import { applyMergePatch, type JsonObject } from "../src/protocol";
import type {
  MergeResult,
  StateSnapshot,
  StateStoreContract,
} from "../server/state-store";

class MemoryStore implements StateStoreContract {
  private revision = 0;
  private state: JsonObject = { players: {}, totalTaps: 0 };

  async read(): Promise<StateSnapshot> {
    return {
      version: `"${this.revision}"`,
      state: structuredClone(this.state),
    };
  }

  async merge(expectedVersion: string, patch: JsonObject): Promise<MergeResult> {
    if (expectedVersion !== `"${this.revision}"`) {
      return { applied: false, snapshot: await this.read() };
    }

    this.state = applyMergePatch(this.state, patch) as JsonObject;
    this.revision += 1;
    return { applied: true, snapshot: await this.read() };
  }
}

class MockResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body: unknown;

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

  end(): this {
    return this;
  }
}

function request(
  method: string,
  headers: Record<string, string> = {},
  body?: unknown,
): FunctionRequest {
  return { method, headers, body };
}

function response(): MockResponse & FunctionResponse {
  return new MockResponse() as MockResponse & FunctionResponse;
}

describe("state API", () => {
  it("supports conditional reads and optimistic writes", async () => {
    const handler = createHandler(new MemoryStore());
    const initial = response();
    await handler(request("GET"), initial);

    expect(initial.statusCode).toBe(200);
    expect(initial.body).toMatchObject({ players: {}, totalTaps: 0 });
    const firstTag = initial.headers.get("x-state-version")!;

    const unchanged = response();
    await handler(request("GET", { "x-state-version": firstTag }), unchanged);
    expect(unchanged.statusCode).toBe(204);
    expect(unchanged.body).toBeUndefined();

    const stale = response();
    await handler(
      request("PATCH", { "x-state-version": '"different:0"' }, { totalTaps: 1 }),
      stale,
    );
    expect(stale.statusCode).toBe(412);

    const update = response();
    await handler(
      request("PATCH", { "x-state-version": firstTag }, { totalTaps: 1 }),
      update,
    );
    expect(update.statusCode).toBe(200);
    expect(update.body).toMatchObject({ totalTaps: 1 });
    expect(update.headers.get("x-state-version")).not.toBe(firstTag);
  });
});
