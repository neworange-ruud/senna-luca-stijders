import { isJsonObject, isJsonValue, type JsonObject } from "../src/protocol.js";
import { StateStore } from "../server/state-store.js";

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

type Runtime = {
  store: StateStore;
};

const server = globalThis as typeof globalThis & {
  __multiplayerGameRuntime?: Runtime;
};

const runtime = (server.__multiplayerGameRuntime ??= {
  store: new StateStore({
    players: {},
    totalTaps: 0,
  }),
});

function sendState(response: FunctionResponse, status: number): void {
  response
    .status(status)
    .setHeader("Cache-Control", "no-store")
    .setHeader("ETag", runtime.store.etag)
    .json(runtime.store.read());
}

function requestHeader(
  request: FunctionRequest,
  name: "if-match" | "if-none-match",
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

export default function handler(
  request: FunctionRequest,
  response: FunctionResponse,
): void {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "GET") {
    if (requestHeader(request, "if-none-match") === runtime.store.etag) {
      response.status(304).end();
      return;
    }

    sendState(response, 200);
    return;
  }

  if (request.method === "PATCH") {
    const expectedVersion = requestHeader(request, "if-match");
    if (!expectedVersion) {
      response.status(428).json({ error: "An If-Match header is required." });
      return;
    }

    if (expectedVersion !== runtime.store.etag) {
      sendState(response, 412);
      return;
    }

    const patch = parsePatch(request.body);
    if (!patch) {
      response.status(400).json({ error: "The body must be a JSON object." });
      return;
    }

    runtime.store.merge(patch);
    sendState(response, 200);
    return;
  }

  response.setHeader("Allow", "GET, PATCH");
  response.status(405).json({ error: "Method not allowed." });
}
