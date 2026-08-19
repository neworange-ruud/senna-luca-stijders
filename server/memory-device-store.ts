import type { PlayerRole } from "../src/game/types.js";
import type { StoredCredential } from "./credentials.js";
import type {
  DeviceBinding,
  DeviceStoreContract,
  PairResult,
} from "./device-store.js";

export class MemoryDeviceStore implements DeviceStoreContract {
  private readonly bindings = new Map<PlayerRole, DeviceBinding>();
  private readonly limits = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  reset(): void {
    this.bindings.clear();
    this.limits.clear();
  }

  get(role: PlayerRole): Promise<DeviceBinding | null> {
    return Promise.resolve(this.bindings.get(role) ?? null);
  }

  pair(
    role: PlayerRole,
    credential: StoredCredential,
    replace: boolean,
    now: number,
  ): Promise<PairResult> {
    const current = this.bindings.get(role);
    if (current && !replace)
      return Promise.resolve({ paired: false, binding: current });
    const binding: DeviceBinding = {
      role,
      generation: (current?.generation ?? 0) + 1,
      credential,
      pairedAt: now,
    };
    this.bindings.set(role, binding);
    return Promise.resolve({ paired: true, binding });
  }

  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const now = Date.now();
    const current = this.limits.get(key);
    const value =
      !current || current.expiresAt <= now
        ? { count: 1, expiresAt: now + windowSeconds * 1_000 }
        : { ...current, count: current.count + 1 };
    this.limits.set(key, value);
    return Promise.resolve(value.count <= limit);
  }
}
