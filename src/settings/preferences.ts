/** Small, defensive local preference API. Values stay in localStorage by design. */
export function readPreferenceFlag(key: string, defaultValue = false): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? defaultValue : value === "true" || value === "on";
  } catch {
    return defaultValue;
  }
}

export function writePreferenceFlag(key: string, value: boolean, encoding: "boolean" | "on-off" = "boolean"): void {
  try {
    localStorage.setItem(key, encoding === "on-off" ? (value ? "on" : "off") : String(value));
  } catch {
    // Settings must never prevent the application from opening when storage is unavailable.
  }
}

export function readPreferenceNumber(key: string, defaultValue: number, min: number, max: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null || stored.trim() === "") return defaultValue;
    const value = Number(stored);
    return Number.isFinite(value) && value >= min && value <= max ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}
