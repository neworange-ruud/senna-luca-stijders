import { defineConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { healthBody } from "./api/health.js";
import { createPairHandler } from "./api/pair.js";
import { createSessionHandler } from "./api/session.js";
import { MemoryDeviceStore } from "./server/memory-device-store.js";
import type { FunctionRequest, FunctionResponse } from "./server/http.js";
import { signInternalRequest } from "./src/shared/internal-signature.js";

const localDevices = new MemoryDeviceStore();
const localPair = createPairHandler(localDevices, {
  adminPin: "000000",
  allowedOrigins: new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:4173",
  ]),
  secureCookie: false,
  async revoke(role, generation) {
    const body = JSON.stringify({
      role,
      generation,
      issuedAt: Math.floor(Date.now() / 1_000),
    });
    const signature = await signInternalRequest(
      "local-worker-secret-change-outside-development",
      body,
    );
    try {
      const response = await fetch("http://127.0.0.1:8787/internal/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-strijders-signature": signature,
        },
        body,
      });
      return response.ok;
    } catch {
      // The local Worker is optional while only the web app is running.
      return false;
    }
  },
});
const localSession = createSessionHandler(localDevices, {
  environment: "development",
  signingSecret: "local-session-secret-change-outside-development",
  realtimeUrl: "ws://127.0.0.1:8787/ws",
  nowSeconds: () => Math.floor(Date.now() / 1_000),
});

function responseAdapter(response: ServerResponse): FunctionResponse {
  return {
    status(code) {
      response.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      return this;
    },
    json(value) {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(value));
      return this;
    },
    end() {
      response.end();
    },
  };
}

async function requestBody(
  request: IncomingMessage,
): Promise<string | undefined> {
  if (request.method === "GET") return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: ["index.html", "health.html"],
    },
  },
  plugins: [
    {
      name: "local-vercel-api-adapter",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split("?")[0];
          if (
            ![
              "/api/health",
              "/api/pair",
              "/api/session",
              "/debug/reset-api",
            ].includes(path ?? "")
          ) {
            next();
            return;
          }
          void (async () => {
            if (path === "/debug/reset-api" && request.method === "POST") {
              localDevices.reset();
              response.statusCode = 200;
              response.end(JSON.stringify({ status: "ok" }));
              return;
            }
            if (path === "/api/health") {
              response.statusCode = 200;
              response.setHeader("cache-control", "no-store");
              response.setHeader(
                "content-type",
                "application/json; charset=utf-8",
              );
              response.end(JSON.stringify(healthBody(process.env.APP_ENV)));
              return;
            }
            const adaptedRequest: FunctionRequest = {
              method: request.method,
              headers: request.headers,
              body: await requestBody(request),
            };
            const adaptedResponse = responseAdapter(response);
            if (path === "/api/pair") {
              await localPair(adaptedRequest, adaptedResponse);
            } else {
              await localSession(adaptedRequest, adaptedResponse);
            }
          })().catch((error: unknown) => {
            console.error("Local API adapter failed", error);
            response.statusCode = 500;
            response.end(JSON.stringify({ fout: "Lokale serverfout." }));
          });
        });
      },
    },
  ],
  server: {
    port: 5173,
  },
});
