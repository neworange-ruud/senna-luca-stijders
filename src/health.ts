interface HealthResponse {
  status: string;
  omgeving?: string;
}

const viteEnvironment = import.meta.env as Record<string, unknown>;
const configuredRealtimeUrl = viteEnvironment["VITE_REALTIME_URL"];
const realtimeUrl =
  typeof configuredRealtimeUrl === "string"
    ? configuredRealtimeUrl
    : "ws://127.0.0.1:8787/ws";
const workerHealthUrl = realtimeUrl
  .replace(/^ws:/, "http:")
  .replace(/^wss:/, "https:")
  .replace(/\/ws(?:\?.*)?$/, "/health");

async function check(id: string, url: string): Promise<HealthResponse | null> {
  const row = document.querySelector<HTMLElement>(`#${id}`);
  if (!row) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const health = (await response.json()) as HealthResponse;
    row.dataset.state = "ok";
    const label = row.querySelector("strong");
    if (label) label.textContent = "Online";
    return health;
  } catch {
    row.dataset.state = "error";
    const label = row.querySelector("strong");
    if (label) label.textContent = "Niet bereikbaar";
    return null;
  }
}

const [apiHealth] = await Promise.all([
  check("api", "/api/health"),
  check("worker", workerHealthUrl),
]);
const environment = document.querySelector("#environment");
if (environment && apiHealth?.omgeving) {
  environment.textContent = `Omgeving: ${apiHealth.omgeving}`;
}
