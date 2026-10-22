export interface OpenSessionSnapshot {
  paths: string[];
  activePath: string | null;
}

export function normalizeSessionPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  // Preserve the two leading separators of UNC paths; collapsing them would make
  // a network share indistinguishable from a POSIX path with the same suffix.
  const isUncPath = /^\/\/[^/]+\/[^/]+/.test(slashed);
  const isDrivePath = /^[a-z]:\//i.test(slashed);
  const normalized = isUncPath
    ? `//${slashed.slice(2).replace(/\/{2,}/g, "/")}`
    : slashed.replace(/\/{2,}/g, "/");
  // Windows drive paths and UNC paths are case-insensitive; POSIX paths are not.
  return isUncPath || isDrivePath ? normalized.toLocaleLowerCase() : normalized;
}

export function deduplicateSessionPaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path.trim()) continue;
    const key = normalizeSessionPath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

export function parseOpenSession(raw: string | null): OpenSessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as { paths?: unknown; activePath?: unknown };
    const paths = Array.isArray(value.paths)
      ? value.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      : [];
    const activePath = typeof value.activePath === "string" && value.activePath.trim() ? value.activePath : null;
    return { paths: deduplicateSessionPaths(paths), activePath };
  } catch {
    return null;
  }
}

export function serializeOpenSession(paths: readonly string[], activePath: string | null): string {
  return JSON.stringify({ paths: deduplicateSessionPaths(paths), activePath });
}

export function sameSessionPath(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && normalizeSessionPath(left) === normalizeSessionPath(right);
}
