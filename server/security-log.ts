import { randomUUID } from "node:crypto";
import type { PlayerRole } from "../src/game/types.js";
import { header, type FunctionRequest } from "./http.js";

export function requestId(request: FunctionRequest): string {
  return header(request, "x-vercel-id") ?? randomUUID();
}

export function securityLog(
  id: string,
  operation: "pair" | "session",
  code: string,
  role?: PlayerRole,
): void {
  console.info(JSON.stringify({ requestId: id, operation, code, role }));
}
