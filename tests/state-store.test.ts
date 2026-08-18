import { describe, expect, it } from "vitest";
import { StateStore } from "../server/state-store";

class FakeRedis {
  readonly calls: Array<{ script: string; keys: string[]; args: unknown[] }> = [];

  constructor(private readonly results: unknown[]) {}

  async eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData> {
    this.calls.push({ script, keys, args });
    return this.results.shift() as TData;
  }
}

describe("StateStore", () => {
  it("reads shared state and exposes its revision", async () => {
    const redis = new FakeRedis([
      ["7", '{"players":{},"totalTaps":3}'],
    ]);
    const store = new StateStore(redis, "game:test", { players: {}, totalTaps: 0 });

    await expect(store.read()).resolves.toEqual({
      version: '"7"',
      state: { players: {}, totalTaps: 3 },
    });
    expect(redis.calls[0]?.keys).toEqual(["game:test"]);
  });

  it("atomically advances matching state", async () => {
    const nextState = {
      players: { one: { name: "Ada", taps: 1 } },
      totalTaps: 1,
    };
    const redis = new FakeRedis([
      ["0", '{"players":{},"totalTaps":0}'],
      ["1", "1", JSON.stringify(nextState)],
    ]);
    const store = new StateStore(redis, "game:test", { players: {}, totalTaps: 0 });

    await expect(
      store.merge('"0"', {
        players: { one: { name: "Ada", taps: 1 } },
        totalTaps: 1,
      }),
    ).resolves.toEqual({
      applied: true,
      snapshot: { version: '"1"', state: nextState },
    });
    expect(redis.calls[1]?.args[2]).toBe("0");
    expect(redis.calls[1]?.args[3]).toBe(JSON.stringify(nextState));
  });

  it("rejects a stale version without attempting a write", async () => {
    const redis = new FakeRedis([
      ["4", '{"players":{},"totalTaps":4}'],
    ]);
    const store = new StateStore(redis, "game:test", { players: {}, totalTaps: 0 });

    await expect(store.merge('"3"', { totalTaps: 5 })).resolves.toEqual({
      applied: false,
      snapshot: {
        version: '"4"',
        state: { players: {}, totalTaps: 4 },
      },
    });
    expect(redis.calls).toHaveLength(1);
  });

  it("returns the winner when another writer wins during compare-and-set", async () => {
    const winningState = { players: {}, totalTaps: 1 };
    const redis = new FakeRedis([
      ["0", '{"players":{},"totalTaps":0}'],
      ["0", "1", JSON.stringify(winningState)],
    ]);
    const store = new StateStore(redis, "game:test", { players: {}, totalTaps: 0 });

    await expect(store.merge('"0"', { totalTaps: 2 })).resolves.toEqual({
      applied: false,
      snapshot: { version: '"1"', state: winningState },
    });
    expect(redis.calls).toHaveLength(2);
  });
});
