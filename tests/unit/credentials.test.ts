import { describe, expect, it } from "vitest";
import {
  createDeviceCredential,
  deviceCookie,
  parseCookie,
  verifyAdminPin,
  verifyDeviceCredential,
} from "../../server/credentials";

describe("device credentials", () => {
  it("stores only a salted hash and verifies the opaque credential", () => {
    const created = createDeviceCredential();
    expect(created.credential).toHaveLength(43);
    expect(JSON.stringify(created.stored)).not.toContain(created.credential);
    expect(verifyDeviceCredential(created.credential, created.stored)).toBe(
      true,
    );
    expect(
      verifyDeviceCredential(`${created.credential}x`, created.stored),
    ).toBe(false);
  });

  it("compares PIN digests and rejects a different PIN", () => {
    expect(verifyAdminPin("482913", "482913")).toBe(true);
    expect(verifyAdminPin("482913", "482914")).toBe(false);
  });

  it("issues and parses a hardened device cookie", () => {
    const cookie = deviceCookie("opaque-value");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(
      parseCookie("other=x; strijders_device=opaque-value", "strijders_device"),
    ).toBe("opaque-value");
  });
});
