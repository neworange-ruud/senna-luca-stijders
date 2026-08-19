import { describe, expect, it } from "vitest";
import {
  signInternalRequest,
  verifyInternalRequest,
} from "../../src/shared/internal-signature";

describe("internal request signatures", () => {
  it("accepts only the exact signed body and secret", async () => {
    const body = '{"role":"luca","generation":2}';
    const signature = await signInternalRequest("internal test secret", body);
    await expect(
      verifyInternalRequest("internal test secret", body, signature),
    ).resolves.toBe(true);
    await expect(
      verifyInternalRequest("internal test secret", `${body} `, signature),
    ).resolves.toBe(false);
    await expect(verifyInternalRequest("wrong", body, signature)).resolves.toBe(
      false,
    );
  });
});
