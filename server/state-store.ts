import type { Redis } from "@upstash/redis";
import {
  applyMergePatch,
  isJsonObject,
  type JsonObject,
} from "../src/protocol.js";

const READ_SCRIPT = `
local revision = redis.call("HGET", KEYS[1], "revision")
local state = redis.call("HGET", KEYS[1], "state")

if not revision or not state then
  revision = ARGV[2]
  state = ARGV[1]
  redis.call("HSET", KEYS[1], "revision", revision, "state", state)
end

return {revision, state}
`;

const COMPARE_AND_SET_SCRIPT = `
local revision = redis.call("HGET", KEYS[1], "revision")
local state = redis.call("HGET", KEYS[1], "state")

if not revision or not state then
  revision = ARGV[2]
  state = ARGV[1]
  redis.call("HSET", KEYS[1], "revision", revision, "state", state)
end

if revision ~= ARGV[3] then
  return {"0", revision, state}
end

local generation, counter = string.match(revision, "^([^:]+):(%d+)$")
local nextRevision
if generation then
  nextRevision = generation .. ":" .. tostring(tonumber(counter) + 1)
else
  nextRevision = tostring(tonumber(revision) + 1)
end
redis.call("HSET", KEYS[1], "revision", nextRevision, "state", ARGV[4])
return {"1", nextRevision, ARGV[4]}
`;

type RedisClient = Pick<Redis, "eval">;

export type StateSnapshot = {
  version: string;
  state: JsonObject;
};

export type MergeResult = {
  applied: boolean;
  snapshot: StateSnapshot;
};

export type StateStoreContract = {
  read(): Promise<StateSnapshot>;
  merge(expectedVersion: string, patch: JsonObject): Promise<MergeResult>;
};

function decodeSnapshot(revision: unknown, serializedState: unknown): StateSnapshot {
  const parsedState =
    typeof serializedState === "string"
      ? (JSON.parse(serializedState) as unknown)
      : serializedState;

  if (!isJsonObject(parsedState)) {
    throw new Error("Redis returned invalid game state.");
  }

  return {
    version: `"${String(revision)}"`,
    state: parsedState,
  };
}

function decodeResult(value: unknown, offset = 0): StateSnapshot {
  if (!Array.isArray(value) || value.length < offset + 2) {
    throw new Error("Redis returned an invalid state response.");
  }

  return decodeSnapshot(value[offset], value[offset + 1]);
}

function revisionFromVersion(version: string): string | undefined {
  return /^"([a-z0-9]+:\d+|\d+)"$/.exec(version)?.[1];
}

export class StateStore implements StateStoreContract {
  private readonly initialState: string;
  private readonly initialRevision = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}:0`;

  constructor(
    private readonly redis: RedisClient,
    private readonly key: string,
    initialState: JsonObject,
  ) {
    this.initialState = JSON.stringify(initialState);
  }

  async read(): Promise<StateSnapshot> {
    const result: unknown = await this.redis.eval(
      READ_SCRIPT,
      [this.key],
      [this.initialState, this.initialRevision],
    );
    return decodeResult(result);
  }

  async merge(expectedVersion: string, patch: JsonObject): Promise<MergeResult> {
    const current = await this.read();
    const expectedRevision = revisionFromVersion(expectedVersion);

    if (!expectedRevision || current.version !== expectedVersion) {
      return { applied: false, snapshot: current };
    }

    const nextState = applyMergePatch(current.state, patch);
    if (!isJsonObject(nextState)) {
      throw new Error("The top-level game state must remain an object.");
    }

    const result: unknown = await this.redis.eval(
      COMPARE_AND_SET_SCRIPT,
      [this.key],
      [
        this.initialState,
        this.initialRevision,
        expectedRevision,
        JSON.stringify(nextState),
      ],
    );

    if (!Array.isArray(result) || result.length < 3) {
      throw new Error("Redis returned an invalid update response.");
    }

    return {
      applied: String(result[0]) === "1",
      snapshot: decodeResult(result, 1),
    };
  }
}
