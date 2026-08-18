import { describe, expect, it } from "vitest";
import handler, { type FunctionRequest, type FunctionResponse } from "../api/state";

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
  it("supports conditional reads and optimistic writes", () => {
    const initial = response();
    handler(request("GET"), initial);

    expect(initial.statusCode).toBe(200);
    expect(initial.body).toMatchObject({ players: {}, totalTaps: 0 });
    const firstTag = initial.headers.get("x-state-version")!;

    const unchanged = response();
    handler(request("GET", { "x-state-version": firstTag }), unchanged);
    expect(unchanged.statusCode).toBe(204);
    expect(unchanged.body).toBeUndefined();

    const stale = response();
    handler(
      request("PATCH", { "x-state-version": '"different:0"' }, { totalTaps: 1 }),
      stale,
    );
    expect(stale.statusCode).toBe(412);

    const update = response();
    handler(
      request("PATCH", { "x-state-version": firstTag }, { totalTaps: 1 }),
      update,
    );
    expect(update.statusCode).toBe(200);
    expect(update.body).toMatchObject({ totalTaps: 1 });
    expect(update.headers.get("x-state-version")).not.toBe(firstTag);
  });
});
