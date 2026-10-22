/** Safely read JSON-backed local preferences. Invalid or stale values never break startup. */
export function readPreferenceJson<T>(
  key: string,
  isValid: (value: unknown) => value is T,
  defaultValue: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return defaultValue;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
