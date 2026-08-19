import type { Redis } from "@upstash/redis";
import type { PlayerRole } from "../src/game/types.js";
import type { StoredCredential } from "./credentials.js";

export interface DeviceBinding {
  role: PlayerRole;
  generation: number;
  credential: StoredCredential;
  pairedAt: number;
}

export interface PairResult {
  paired: boolean;
  binding: DeviceBinding;
}

export interface DeviceStoreContract {
  get(role: PlayerRole): Promise<DeviceBinding | null>;
  pair(
    role: PlayerRole,
    credential: StoredCredential,
    replace: boolean,
    now: number,
  ): Promise<PairResult>;
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean>;
}

type RedisClient = Pick<Redis, "eval" | "get">;

const PAIR_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if current and ARGV[1] ~= "1" then
  return {"0", current}
end
local generation = 1
if current then
  local decoded = cjson.decode(current)
  generation = tonumber(decoded.generation) + 1
end
local binding = cjson.encode({
  role = ARGV[2],
  generation = generation,
  credential = { salt = ARGV[3], hash = ARGV[4] },
  pairedAt = tonumber(ARGV[5])
})
redis.call("SET", KEYS[1], binding)
return {"1", binding}
`;

const RATE_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count
`;

function decodeBinding(value: unknown): DeviceBinding | null {
  if (value === null || value === undefined) return null;
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object")
    throw new Error("Invalid device binding.");
  const binding = parsed as DeviceBinding;
  if (
    (binding.role !== "luca" && binding.role !== "senna") ||
    !Number.isSafeInteger(binding.generation) ||
    binding.generation < 1 ||
    typeof binding.credential?.salt !== "string" ||
    typeof binding.credential.hash !== "string" ||
    !Number.isSafeInteger(binding.pairedAt)
  ) {
    throw new Error("Invalid device binding.");
  }
  return binding;
}

export class DeviceStore implements DeviceStoreContract {
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix: string,
  ) {}

  async get(role: PlayerRole): Promise<DeviceBinding | null> {
    return decodeBinding(await this.redis.get(`${this.prefix}:role:${role}`));
  }

  async pair(
    role: PlayerRole,
    credential: StoredCredential,
    replace: boolean,
    now: number,
  ): Promise<PairResult> {
    const result: unknown = await this.redis.eval(
      PAIR_SCRIPT,
      [`${this.prefix}:role:${role}`],
      [
        replace ? "1" : "0",
        role,
        credential.salt,
        credential.hash,
        String(now),
      ],
    );
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error("Invalid pairing response.");
    }
    const binding = decodeBinding(result[1]);
    if (!binding) throw new Error("Missing pairing response.");
    return { paired: String(result[0]) === "1", binding };
  }

  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const count: unknown = await this.redis.eval(
      RATE_SCRIPT,
      [`${this.prefix}:rate:${key}`],
      [String(windowSeconds)],
    );
    return Number(count) <= limit;
  }
}
