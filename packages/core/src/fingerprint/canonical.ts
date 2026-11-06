export function toCanonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysRecursively(obj));
}

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }

  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    const val = (value as Record<string, unknown>)[key];
    if (val !== undefined) {
      result[key] = sortKeysRecursively(val);
    }
  }

  return result;
}
