import type { FunctionRequest, FunctionResponse } from "../server/http.js";

export function healthBody(environment = "development") {
  return {
    status: "ok",
    omgeving: environment,
    apiVersion: 1,
  } as const;
}

export default function handler(
  request: FunctionRequest,
  response: FunctionResponse,
): void {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ fout: "Methode niet toegestaan." });
    return;
  }

  response
    .status(200)
    .json(
      healthBody(
        process.env.APP_ENV ??
          process.env.VERCEL_TARGET_ENV ??
          process.env.VERCEL_ENV,
      ),
    );
}
