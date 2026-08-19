export interface FunctionRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface FunctionResponse {
  status(code: number): FunctionResponse;
  setHeader(name: string, value: string): FunctionResponse;
  json(value: unknown): FunctionResponse;
  end(): void;
}

export function header(
  request: FunctionRequest,
  name: string,
): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function parseObjectBody(body: unknown): Record<string, unknown> | null {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}
