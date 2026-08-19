import type { PlayerRole } from "../game/types.js";

export interface RoleTokenClaims {
  aud: "senna-luca-realtime";
  environment: string;
  role: PlayerRole;
  generation: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

export async function signRoleToken(
  secret: string,
  claims: RoleTokenClaims,
): Promise<string> {
  const payload = encodeBytes(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = encodeBytes(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function verifyRoleToken(
  secret: string,
  token: string,
  expectedEnvironment: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<RoleTokenClaims | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = encodeBytes(await hmac(secret, payload));
  if (signature.length !== expected.length) return null;

  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (difference !== 0) return null;

  try {
    const claims = JSON.parse(
      new TextDecoder().decode(decodeBytes(payload)),
    ) as RoleTokenClaims;
    if (
      claims.aud !== "senna-luca-realtime" ||
      claims.environment !== expectedEnvironment ||
      (claims.role !== "luca" && claims.role !== "senna") ||
      !Number.isSafeInteger(claims.generation) ||
      claims.generation < 1 ||
      !Number.isSafeInteger(claims.issuedAt) ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.issuedAt > nowSeconds + 30 ||
      claims.expiresAt <= nowSeconds ||
      claims.expiresAt - claims.issuedAt > 5 * 60 ||
      typeof claims.nonce !== "string" ||
      claims.nonce.length < 16
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
