import { describe, expect, it } from "vitest";
import { StateStore } from "../server/state-store";

describe("StateStore", () => {
  it("keeps state in memory and advances its entity tag", () => {
    const store = new StateStore({ players: {}, totalTaps: 0 });
    const firstTag = store.etag;

    store.merge({ players: { one: { name: "Ada", taps: 1 } }, totalTaps: 1 });

    expect(store.read()).toEqual({
      players: { one: { name: "Ada", taps: 1 } },
      totalTaps: 1,
    });
    expect(store.etag).not.toBe(firstTag);
  });

  it("returns copies that cannot mutate server state", () => {
    const store = new StateStore({ totalTaps: 0 });
    const snapshot = store.read();
    snapshot.totalTaps = 99;

    expect(store.read()).toEqual({ totalTaps: 0 });
  });
});
