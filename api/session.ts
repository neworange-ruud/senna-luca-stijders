import { randomBytes } from "node:crypto";
import { parseCookie, verifyDeviceCredential } from "../server/credentials.js";
import type { DeviceStoreContract } from "../server/device-store.js";
import {
  deviceStore,
  environmentName,
} from "../server/device-store-runtime.js";
import { signRoleToken } from "../src/shared/role-token.js";
import {
  header,
  type FunctionRequest,
  type FunctionResponse,
} from "../server/http.js";
import { requestId, securityLog } from "../server/security-log.js";

export interface SessionConfig {
  environment: string;
  signingSecret: string;
  realtimeUrl: string;
  nowSeconds(): number;
}

export function createSessionHandler(
  store: DeviceStoreContract,
  config: SessionConfig,
) {
  return async (
    request: FunctionRequest,
    response: FunctionResponse,
  ): Promise<void> => {
    const id = requestId(request);
    response.setHeader("X-Request-ID", id);
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.status(405).json({ fout: "Methode niet toegestaan." });
      return;
    }
    const credential = parseCookie(
      header(request, "cookie"),
      "strijders_device",
    );
    if (!credential || !config.signingSecret || !config.realtimeUrl) {
      securityLog(id, "session", "UNPAIRED");
      response
        .status(401)
        .json({ fout: "Dit apparaat is nog niet gekoppeld." });
      return;
    }

    for (const role of ["luca", "senna"] as const) {
      const binding = await store.get(role);
      if (!binding || !verifyDeviceCredential(credential, binding.credential))
        continue;
      const issuedAt = config.nowSeconds();
      const token = await signRoleToken(config.signingSecret, {
        aud: "senna-luca-realtime",
        environment: config.environment,
        role,
        generation: binding.generation,
        issuedAt,
        expiresAt: issuedAt + 120,
        nonce: randomBytes(16).toString("hex"),
      });
      securityLog(id, "session", "ISSUED", role);
      response
        .status(200)
        .json({ role, token, realtimeUrl: config.realtimeUrl });
      return;
    }
    securityLog(id, "session", "STALE_CREDENTIAL");
    response.status(401).json({ fout: "De koppeling is niet meer geldig." });
  };
}

let runtimeHandler: ReturnType<typeof createSessionHandler> | undefined;

export default async function handler(
  request: FunctionRequest,
  response: FunctionResponse,
): Promise<void> {
  runtimeHandler ??= createSessionHandler(deviceStore(), {
    environment: environmentName(),
    signingSecret: process.env.SESSION_SIGNING_SECRET ?? "",
    realtimeUrl:
      process.env.REALTIME_URL ?? process.env.VITE_REALTIME_URL ?? "",
    nowSeconds: () => Math.floor(Date.now() / 1_000),
  });
  await runtimeHandler(request, response);
}
