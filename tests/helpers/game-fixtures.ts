export const TEST_PLAYERS = ["luca", "senna"] as const;

export function authoritativeSnapshot<T>(state: T, tick = 0) {
  return structuredClone({ schemaVersion: 1, tick, state });
}
