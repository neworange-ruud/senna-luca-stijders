import {
  applyMergePatch,
  isJsonObject,
  type JsonObject,
} from "../src/protocol";

export class StateStore {
  readonly instanceId = Math.random().toString(36).slice(2, 10);
  private revision = 0;
  private state: JsonObject;

  constructor(initialState: JsonObject) {
    this.state = structuredClone(initialState);
  }

  get etag(): string {
    return `"${this.instanceId}:${this.revision}"`;
  }

  read(): JsonObject {
    return structuredClone(this.state);
  }

  merge(patch: JsonObject): JsonObject {
    const nextState = applyMergePatch(this.state, patch);
    if (!isJsonObject(nextState)) {
      throw new Error("The top-level game state must remain an object.");
    }

    this.state = nextState;
    this.revision += 1;
    return this.read();
  }
}
