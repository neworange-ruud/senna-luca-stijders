import { describe, expect, it } from "vitest";
import {
  signRoleToken,
  verifyRoleToken,
  type RoleTokenClaims,
} from "../../src/shared/role-token";

const claims: RoleTokenClaims = {
  aud: "senna-luca-realtime",
  environment: "preview",
  role: "luca",
  generation: 3,
  issuedAt: 1_000,
  expiresAt: 1_120,
  nonce: "1234567890abcdef",
};

describe("role tokens", () => {
  it("round-trips scoped claims", async () => {
    const token = await signRoleToken(
      "a sufficiently long test secret",
      claims,
    );
    await expect(
      verifyRoleToken(
        "a sufficiently long test secret",
        token,
        "preview",
        1_050,
      ),
    ).resolves.toEqual(claims);
  });

  it("rejects tampering, wrong environment, expiry, and excessive lifetime", async () => {
    const token = await signRoleToken(
      "a sufficiently long test secret",
      claims,
    );
    await expect(
      verifyRoleToken("wrong secret", token, "preview", 1_050),
    ).resolves.toBeNull();
    await expect(
      verifyRoleToken(
        "a sufficiently long test secret",
        `${token}x`,
        "preview",
        1_050,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyRoleToken(
        "a sufficiently long test secret",
        token,
        "production",
        1_050,
      ),
    ).resolves.toBeNull();
    await expect(
      verifyRoleToken(
        "a sufficiently long test secret",
        token,
        "preview",
        1_120,
      ),
    ).resolves.toBeNull();

    const excessive = await signRoleToken("a sufficiently long test secret", {
      ...claims,
      expiresAt: claims.issuedAt + 301,
    });
    await expect(
      verifyRoleToken(
        "a sufficiently long test secret",
        excessive,
        "preview",
        1_050,
      ),
    ).resolves.toBeNull();
  });
});
