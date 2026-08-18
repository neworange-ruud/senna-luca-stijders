export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return (
    isJsonObject(value) && Object.values(value).every((item) => isJsonValue(item))
  );
}

export function applyMergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  if (!isJsonObject(patch)) {
    return structuredClone(patch);
  }

  const result: JsonObject = isJsonObject(target)
    ? structuredClone(target)
    : {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key] ?? null, value);
    }
  }

  return result;
}

export function createMergePatch(
  before: JsonValue,
  after: JsonValue,
): JsonValue | undefined {
  if (Object.is(before, after)) {
    return undefined;
  }

  if (!isJsonObject(before) || !isJsonObject(after)) {
    return structuredClone(after);
  }

  const patch: JsonObject = {};

  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      patch[key] = null;
    }
  }

  for (const [key, value] of Object.entries(after)) {
    const difference = createMergePatch(before[key] ?? null, value);
    if (difference !== undefined) {
      patch[key] = difference;
    }
  }

  return Object.keys(patch).length === 0 ? undefined : patch;
}
