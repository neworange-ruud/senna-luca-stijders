import { describe, expect, it } from "vitest";
import { DeviceStore } from "../../server/device-store.js";

class FakeRedis {
  readonly calls: Array<{ keys: string[]; args: unknown[] }> = [];
  constructor(
    private readonly getResults: unknown[] = [],
    private readonly evalResults: unknown[] = [],
  ) {}
  get<TData = unknown>(): Promise<TData | null> {
    return Promise.resolve((this.getResults.shift() ?? null) as TData | null);
  }
  eval<TArgs extends unknown[], TData = unknown>(
    _script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    this.calls.push({ keys, args });
    return Promise.resolve(this.evalResults.shift() as TData);
  }
}

const stored = { salt: "salt", hash: "hash" };
const binding = {
  role: "luca",
  generation: 2,
  credential: stored,
  pairedAt: 123,
} as const;

describe("DeviceStore", () => {
  it("reads environment-prefixed role bindings", async () => {
    const redis = new FakeRedis([JSON.stringify(binding)]);
    const store = new DeviceStore(redis, "strijders:preview:v1");
    await expect(store.get("luca")).resolves.toEqual(binding);
  });

  it("atomically pairs or reports an occupied role", async () => {
    const redis = new FakeRedis(
      [],
      [
        ["1", JSON.stringify(binding)],
        ["0", JSON.stringify(binding)],
      ],
    );
    const store = new DeviceStore(redis, "strijders:preview:v1");
    await expect(store.pair("luca", stored, true, 123)).resolves.toEqual({
      paired: true,
      binding,
    });
    await expect(store.pair("luca", stored, false, 123)).resolves.toEqual({
      paired: false,
      binding,
    });
    expect(redis.calls[0]?.keys).toEqual(["strijders:preview:v1:role:luca"]);
  });

  it("enforces fixed-window request limits", async () => {
    const redis = new FakeRedis([], [3, 4]);
    const store = new DeviceStore(redis, "strijders:preview:v1");
    await expect(store.rateLimit("pin:ip", 3, 60)).resolves.toBe(true);
    await expect(store.rateLimit("pin:ip", 3, 60)).resolves.toBe(false);
  });
});
