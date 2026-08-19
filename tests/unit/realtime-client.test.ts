import { describe, expect, it } from "vitest";
import { shouldAcceptSnapshot } from "../../src/client/realtime-client";

describe("realtime snapshot ordering", () => {
  it("accepts only finite forward integer revisions, including same-tick updates", () => {
    expect(shouldAcceptSnapshot(-1, 0)).toBe(true);
    expect(shouldAcceptSnapshot(10, 11)).toBe(true);
    expect(shouldAcceptSnapshot(10, 10)).toBe(false);
    expect(shouldAcceptSnapshot(10, 9)).toBe(false);
    expect(shouldAcceptSnapshot(10, 10.5)).toBe(false);
    expect(shouldAcceptSnapshot(10, Number.NaN)).toBe(false);
  });
});
