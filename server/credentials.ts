import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface StoredCredential {
  salt: string;
  hash: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyAdminPin(
  expectedPin: string,
  suppliedPin: string,
): boolean {
  return timingSafeEqual(
    digest(`pin:${expectedPin}`),
    digest(`pin:${suppliedPin}`),
  );
}

export function createDeviceCredential(): {
  credential: string;
  stored: StoredCredential;
} {
  const credential = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("base64url");
  return { credential, stored: hashDeviceCredential(credential, salt) };
}

export function hashDeviceCredential(
  credential: string,
  salt = randomBytes(16).toString("base64url"),
): StoredCredential {
  return {
    salt,
    hash: digest(`device:${salt}:${credential}`).toString("base64url"),
  };
}

export function verifyDeviceCredential(
  credential: string,
  stored: StoredCredential,
): boolean {
  const candidate = hashDeviceCredential(credential, stored.salt);
  const expected = Buffer.from(stored.hash, "base64url");
  const actual = Buffer.from(candidate.hash, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function deviceCookie(credential: string, secure = true): string {
  return [
    `strijders_device=${encodeURIComponent(credential)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    `Max-Age=${60 * 60 * 24 * 365}`,
  ]
    .filter(Boolean)
    .join("; ");
}
