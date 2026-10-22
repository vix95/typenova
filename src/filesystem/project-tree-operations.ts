/** Filesystem-independent path and tree-operation primitives used by the project explorer. */

export interface ProjectTreeEntry {
  name: string;
  isDirectory?: boolean;
}

export interface ProjectTreeFileSystem {
  join(...paths: string[]): Promise<string>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<ProjectTreeEntry[]>;
  mkdir(path: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

/** Normalize separators while preserving POSIX case and Windows path identity. */
export function normalizedFsPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const isDriveRoot = /^[a-zA-Z]:\/$/.test(slashed);
  const isPosixRoot = slashed === "/";
  const isUncRoot = /^\/\/[^/]+\/[^/]+\/?$/.test(slashed);
  const normalized = isDriveRoot || isPosixRoot ? slashed : slashed.replace(/\/+$/, "");
  const isWindowsPath = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//");
  const identity = isWindowsPath ? normalized.toLocaleLowerCase("en-US") : normalized;
  return isUncRoot ? identity.replace(/\/$/, "") : identity;
}

export function parentPath(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\/$/.test(slashed) || slashed === "/") return slashed;
  const normalized = slashed.replace(/\/+$/, "");
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  if (index === 0) return "/";
  if (index === 2 && /^[a-zA-Z]:/.test(normalized)) return normalized.slice(0, 3);
  if (normalized.startsWith("//")) {
    const segments = normalized.slice(2).split("/");
    if (segments.length <= 2) return normalized;
  }
  return normalized.slice(0, index);
}

export function pathIsInside(parent: string, child: string): boolean {
  const normalizedParent = normalizedFsPath(parent);
  const normalizedChild = normalizedFsPath(child);
  if (!normalizedParent) return false;
  if (normalizedChild === normalizedParent) return true;
  const prefix = normalizedParent.endsWith("/") ? normalizedParent : `${normalizedParent}/`;
  return normalizedChild.startsWith(prefix);
}

/** Map a path under a renamed directory without changing its original spelling. */
export function remapPathPrefix(path: string, oldPath: string, newPath: string): string {
  const normalizedOld = normalizedFsPath(oldPath);
  const normalizedPath = normalizedFsPath(path);
  if (normalizedPath === normalizedOld) return newPath;
  const prefix = normalizedOld.endsWith("/") ? normalizedOld : `${normalizedOld}/`;
  if (!normalizedPath.startsWith(prefix)) return path;

  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const sourceNormalized = path.replace(/\\/g, "/");
  const oldNormalized = oldPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const suffix = sourceNormalized.slice(oldNormalized.length);
  return newPath + (separator === "\\" ? suffix.replace(/\//g, "\\") : suffix);
}

export async function uniqueTreeDestination(
  directory: string,
  name: string,
  isDirectory: boolean,
  fs: Pick<ProjectTreeFileSystem, "join" | "exists">,
  copyLabel: string,
  alwaysCopyName = false,
): Promise<string> {
  const dot = !isDirectory ? name.lastIndexOf(".") : -1;
  const extension = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  let candidate = await fs.join(directory, name);
  if (!alwaysCopyName && !await fs.exists(candidate)) return candidate;
  let number = 1;
  do {
    const suffix = number === 1 ? ` (${copyLabel})` : ` (${copyLabel} ${number})`;
    candidate = await fs.join(directory, `${stem}${suffix}${extension}`);
    number++;
  } while (await fs.exists(candidate));
  return candidate;
}

/** Copy a file or directory tree; roll back a partial directory copy on failure. */
export async function copyTreeEntry(
  source: string,
  destination: string,
  isDirectory: boolean,
  fs: ProjectTreeFileSystem,
  alreadyExistsMessage: string,
): Promise<void> {
  if (await fs.exists(destination)) throw new Error(alreadyExistsMessage);
  if (!isDirectory) {
    await fs.copyFile(source, destination);
    return;
  }
  await fs.mkdir(destination);
  try {
    const entries = await fs.readDir(source);
    for (const entry of entries) {
      const from = await fs.join(source, entry.name);
      const to = await fs.join(destination, entry.name);
      await copyTreeEntry(from, to, !!entry.isDirectory, fs, alreadyExistsMessage);
    }
  } catch (error) {
    try { await fs.remove(destination, { recursive: true }); } catch { /* preserve original failure */ }
    throw error;
  }
}

export async function removeTreeEntry(
  path: string,
  isDirectory: boolean,
  fs: Pick<ProjectTreeFileSystem, "remove">,
): Promise<void> {
  await fs.remove(path, isDirectory ? { recursive: true } : undefined);
}
