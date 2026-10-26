/** Reading position inside a preview, independent of rendered heights: a source line and the fraction travelled through its block. */
export interface PreviewAnchor { line: number; fraction: number }
/** Where a document was scrolled to: the first visible editor line and the preview anchor. */
export interface ViewPosition { editorLine: number; preview: PreviewAnchor | null }
/** Positions are stored per file under its normalised path. */
export type ViewPositions = Record<string, ViewPosition>;

export interface OpenSessionSnapshot {
  paths: string[];
  activePath: string | null;
  positions: ViewPositions;
}

const MAX_STORED_POSITIONS = 200;

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

function parseViewPosition(value: unknown): ViewPosition | null {
  if (!value || typeof value !== "object") return null;
  const { editorLine, preview } = value as { editorLine?: unknown; preview?: unknown };
  if (typeof editorLine !== "number" || !Number.isFinite(editorLine) || editorLine < 1) return null;
  let anchor: PreviewAnchor | null = null;
  if (preview && typeof preview === "object") {
    const { line, fraction } = preview as { line?: unknown; fraction?: unknown };
    if (typeof line === "number" && Number.isFinite(line) && line >= 1 && typeof fraction === "number" && Number.isFinite(fraction)) {
      anchor = { line: Math.floor(line), fraction: Math.max(0, Math.min(1, fraction)) };
    }
  }
  return { editorLine: Math.floor(editorLine), preview: anchor };
}

export function parseViewPositions(value: unknown): ViewPositions {
  const result: ViewPositions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, MAX_STORED_POSITIONS)) {
    const position = parseViewPosition(raw);
    if (position) result[key] = position;
  }
  return result;
}

export function parseOpenSession(raw: string | null): OpenSessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as { paths?: unknown; activePath?: unknown; positions?: unknown };
    const paths = Array.isArray(value.paths)
      ? value.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      : [];
    const activePath = typeof value.activePath === "string" && value.activePath.trim() ? value.activePath : null;
    return { paths: deduplicateSessionPaths(paths), activePath, positions: parseViewPositions(value.positions) };
  } catch {
    return null;
  }
}

export function serializeOpenSession(paths: readonly string[], activePath: string | null, positions: ViewPositions = {}): string {
  return JSON.stringify({ paths: deduplicateSessionPaths(paths), activePath, positions });
}

/** Looks up a stored position by file path (keys are normalised the same way as session paths). */
export function findViewPosition(positions: ViewPositions, path: string | null | undefined): ViewPosition | null {
  return path ? positions[normalizeSessionPath(path)] ?? null : null;
}

export function sameSessionPath(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && normalizeSessionPath(left) === normalizeSessionPath(right);
}
