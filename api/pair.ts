import {
  createDeviceCredential,
  deviceCookie,
  verifyAdminPin,
} from "../server/credentials.js";
import type { DeviceStoreContract } from "../server/device-store.js";
import { deviceStore } from "../server/device-store-runtime.js";
import type { PlayerRole } from "../src/game/types.js";
import { signInternalRequest } from "../src/shared/internal-signature.js";
import {
  header,
  parseObjectBody,
  type FunctionRequest,
  type FunctionResponse,
} from "../server/http.js";
import { requestId, securityLog } from "../server/security-log.js";

export interface PairConfig {
  adminPin: string;
  allowedOrigins: ReadonlySet<string>;
  secureCookie: boolean;
  revoke(role: PlayerRole, generation: number): Promise<boolean>;
}

/**
 * Derives the Worker revocation endpoint from the realtime WebSocket URL.
 * The realtime URL uses ws/wss because the browser connects to it, so it
 * must be converted before a Vercel function can fetch it.
 */
export function revocationEndpoint(
  realtimeUrl: string | undefined,
): string | null {
  if (!realtimeUrl) return null;
  let url: URL;
  try {
    url = new URL(realtimeUrl);
  } catch {
    return null;
  }
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.pathname = `${url.pathname.replace(/\/(ws)?$/, "")}/internal/revoke`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function runtimeConfig(): PairConfig {
  const origins = new Set<string>();
  if (process.env.APP_ORIGIN) origins.add(process.env.APP_ORIGIN);
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  if (process.env.VERCEL_ENV === "development")
    origins.add("http://localhost:3000");
  return {
    adminPin: process.env.ADMIN_PIN ?? "",
    allowedOrigins: origins,
    secureCookie: process.env.VERCEL_ENV !== "development",
    async revoke(role, generation) {
      const endpoint = revocationEndpoint(
        process.env.REALTIME_URL ?? process.env.VITE_REALTIME_URL,
      );
      const secret = process.env.WORKER_INTERNAL_SECRET ?? "";
      if (!endpoint || !secret) return false;
      const body = JSON.stringify({
        role,
        generation,
        issuedAt: Math.floor(Date.now() / 1_000),
      });
      const signature = await signInternalRequest(secret, body);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-strijders-signature": signature,
            },
            body,
          });
          if (result.ok) return true;
        } catch {
          // Retry the same signed, idempotent generation update.
        }
      }
      return false;
    },
  };
}

export function createPairHandler(
  store: DeviceStoreContract,
  config: PairConfig,
) {
  return async (
    request: FunctionRequest,
    response: FunctionResponse,
  ): Promise<void> => {
    const id = requestId(request);
    response.setHeader("X-Request-ID", id);
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.status(405).json({ fout: "Methode niet toegestaan." });
      return;
    }
    const origin = header(request, "origin");
    if (!origin || !config.allowedOrigins.has(origin)) {
      response
        .status(403)
        .json({ fout: "Deze aanvraag komt niet van het spel." });
      return;
    }
    if (
      !header(request, "content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      response.status(415).json({ fout: "Stuur geldige spelgegevens." });
      return;
    }
    const body = parseObjectBody(request.body);
    const role = body?.role;
    const pin = body?.pin;
    const replace = body?.replace === true;
    if ((role !== "luca" && role !== "senna") || typeof pin !== "string") {
      response
        .status(400)
        .json({ fout: "Kies Luca of Senna en vul de beheerpincode in." });
      return;
    }
    const client =
      header(request, "x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await store.rateLimit(`pair:${client}`, 5, 60))) {
      securityLog(id, "pair", "RATE_LIMITED");
      response
        .status(429)
        .json({ fout: "Te veel pogingen. Wacht even en probeer opnieuw." });
      return;
    }
    if (!config.adminPin || !verifyAdminPin(config.adminPin, pin)) {
      securityLog(id, "pair", "INVALID_PIN");
      response.status(401).json({ fout: "De beheerpincode klopt niet." });
      return;
    }

    const created = createDeviceCredential();
    const result = await store.pair(role, created.stored, replace, Date.now());
    if (!result.paired) {
      securityLog(id, "pair", "ROLE_OCCUPIED", role);
      response.status(409).json({
        fout: `${role === "luca" ? "Luca" : "Senna"} is al gekoppeld. Bevestig vervangen om door te gaan.`,
        code: "ROLE_OCCUPIED",
      });
      return;
    }
    // The stored credential is already rotated here. Withholding the cookie
    // when live revocation fails would lock out both the old and the new
    // device, so pairing completes: the old device can no longer mint a
    // session, and the Durable Object closes its socket and rejects the older
    // generation as soon as this device connects.
    const revoked =
      result.binding.generation === 1 ||
      (await config.revoke(role, result.binding.generation));
    if (!revoked) securityLog(id, "pair", "REVOCATION_DEFERRED", role);
    response.setHeader(
      "Set-Cookie",
      deviceCookie(created.credential, config.secureCookie),
    );
    securityLog(
      id,
      "pair",
      result.binding.generation > 1 ? "REPLACED" : "PAIRED",
      role,
    );
    response.status(200).json({
      role,
      generation: result.binding.generation,
      vervangen: result.binding.generation > 1,
      waarschuwing: revoked
        ? undefined
        : "Het oude apparaat wordt afgemeld zodra dit apparaat verbinding maakt.",
    });
  };
}

let runtimeHandler: ReturnType<typeof createPairHandler> | undefined;

export default async function handler(
  request: FunctionRequest,
  response: FunctionResponse,
): Promise<void> {
  runtimeHandler ??= createPairHandler(deviceStore(), runtimeConfig());
  await runtimeHandler(request, response);
}
