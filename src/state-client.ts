import {
  createMergePatch,
  isJsonObject,
  type JsonObject,
} from "./protocol";

type StateListener = (state: JsonObject) => void;
type StatusListener = (status: "connected" | "connecting" | "offline") => void;

export class StateClient {
  private state: JsonObject | undefined;
  private etag = "";
  private timer: number | undefined;
  private stopped = true;
  private queue: Promise<void> = Promise.resolve();
  private readonly stateListeners = new Set<StateListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(
    private readonly url: string,
    private readonly pollInterval: number,
  ) {}

  get current(): JsonObject | undefined {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (!this.stopped) return;

    this.stopped = false;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    try {
      await this.enqueue(() => this.refresh());
    } finally {
      this.schedulePoll();
    }
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  update(change: (draft: JsonObject) => void): Promise<void> {
    return this.enqueue(async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!this.state || !this.etag) {
          await this.refresh();
        }

        const before = structuredClone(this.state!);
        const after = structuredClone(before);
        change(after);
        const patch = createMergePatch(before, after);

        if (patch === undefined) return;
        if (!isJsonObject(patch)) {
          throw new Error("The top-level game state must remain an object.");
        }

        this.emitStatus("connecting");
        const response = await fetch(this.url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": this.etag,
          },
          body: JSON.stringify(patch),
        });

        if (response.status === 412) {
          await this.acceptState(response);
          continue;
        }

        if (!response.ok) {
          throw new Error(`State update failed (${response.status}).`);
        }

        await this.acceptState(response);
        return;
      }

      throw new Error("The state changed too often; please try again.");
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async refresh(): Promise<void> {
    this.emitStatus("connecting");
    const headers: HeadersInit = {};
    if (this.etag) headers["If-None-Match"] = this.etag;

    try {
      const response = await fetch(this.url, { headers, cache: "no-store" });
      if (response.status === 304) {
        this.emitStatus("connected");
        return;
      }

      if (!response.ok) {
        throw new Error(`State request failed (${response.status}).`);
      }

      await this.acceptState(response);
    } catch (error) {
      this.emitStatus("offline");
      throw error;
    }
  }

  private async acceptState(response: Response): Promise<void> {
    const value: unknown = await response.json();
    const etag = response.headers.get("ETag");

    if (!isJsonObject(value) || !etag) {
      throw new Error("The state server returned an invalid response.");
    }

    this.state = value;
    this.etag = etag;
    this.emitStatus("connected");
    for (const listener of this.stateListeners) listener(this.current!);
  }

  private schedulePoll(): void {
    window.clearTimeout(this.timer);
    if (this.stopped) return;

    this.timer = window.setTimeout(async () => {
      if (document.visibilityState === "visible") {
        await this.enqueue(() => this.refresh()).catch(() => undefined);
      }
      this.schedulePoll();
    }, this.pollInterval);
  }

  private emitStatus(status: "connected" | "connecting" | "offline"): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      void this.enqueue(() => this.refresh()).catch(() => undefined);
    }
  };
}
