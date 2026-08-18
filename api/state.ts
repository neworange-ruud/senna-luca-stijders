import { Redis } from "@upstash/redis";
import { isJsonObject, isJsonValue, type JsonObject } from "../src/protocol.js";
import {
  StateStore,
  type StateSnapshot,
  type StateStoreContract,
} from "../server/state-store.js";

export type FunctionRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type FunctionResponse = {
  status(code: number): FunctionResponse;
  setHeader(name: string, value: string): FunctionResponse;
  json(value: unknown): FunctionResponse;
  end(): void;
};

let redisStore: StateStore | undefined;

function getRedisStore(): StateStore {
  if (!redisStore) {
    const environment = (
      process.env.VERCEL_TARGET_ENV ??
      process.env.VERCEL_ENV ??
      "development"
    ).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    const redis = Redis.fromEnv({
      automaticDeserialization: false,
      enableTelemetry: false,
      readYourWrites: true,
      retry: false,
    });
    redisStore = new StateStore(redis, `browsergame:state:${environment}:v1`, {
      players: {},
      totalTaps: 0,
    });
  }

  return redisStore;
}

function sendState(
  response: FunctionResponse,
  status: number,
  snapshot: StateSnapshot,
): void {
  response
    .status(status)
    .setHeader("Cache-Control", "no-store")
    .setHeader("X-State-Version", snapshot.version)
    .json(snapshot.state);
}

function requestHeader(
  request: FunctionRequest,
  name: "x-state-version",
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parsePatch(body: unknown): JsonObject | undefined {
  let parsed = body;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }

  return isJsonObject(parsed) && isJsonValue(parsed) ? parsed : undefined;
}

export function createHandler(store: StateStoreContract) {
  return async function handler(
    request: FunctionRequest,
    response: FunctionResponse,
  ): Promise<void> {
    response.setHeader("Cache-Control", "no-store");

    try {
      if (request.method === "GET") {
        const snapshot = await store.read();
        if (requestHeader(request, "x-state-version") === snapshot.version) {
          response.status(204).end();
          return;
        }

        sendState(response, 200, snapshot);
        return;
      }

      if (request.method === "PATCH") {
        const expectedVersion = requestHeader(request, "x-state-version");
        if (!expectedVersion) {
          response.status(428).json({ error: "An X-State-Version header is required." });
          return;
        }

        const patch = parsePatch(request.body);
        if (!patch) {
          response.status(400).json({ error: "The body must be a JSON object." });
          return;
        }

        const result = await store.merge(expectedVersion, patch);
        sendState(response, result.applied ? 200 : 412, result.snapshot);
        return;
      }

      response.setHeader("Allow", "GET, PATCH");
      response.status(405).json({ error: "Method not allowed." });
    } catch (error) {
      console.error("State store request failed", error);
      response.status(503).json({ error: "The state store is temporarily unavailable." });
    }
  };
}

const handler = createHandler({
  read: () => getRedisStore().read(),
  merge: (expectedVersion, patch) => getRedisStore().merge(expectedVersion, patch),
});

export default handler;
