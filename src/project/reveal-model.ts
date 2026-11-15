/** Which folders of the project tree lie above a file, so that the tree can open them and show the file. Pure, no DOM. */
import { normalizedFsPath, pathIsInside } from "../filesystem/project-tree-operations.js";

const separatorOf = (path: string): string => (path.includes("\\") ? "\\" : "/");

/**
 * The folders between `root` (not included) and the file, outermost first, written the way the tree writes its paths (with the separator of `root`).
 * Empty when the file is directly in `root` or is not inside it.
 */
export function foldersBetween(root: string, file: string): string[] {
  if (!pathIsInside(root, file)) return [];
  const rootKey = normalizedFsPath(root);
  const parts = normalizedFsPath(file).slice(rootKey.length).split("/").filter(Boolean);
  // The case of the names is taken from the file's own path, not from its normalised form.
  const original = file.replace(/\\/g, "/").split("/").filter(Boolean).slice(-parts.length);
  const separator = separatorOf(root);
  const base = root.replace(/[\\/]+$/, "");
  return original.slice(0, -1).map((_, index) => `${base}${separator}${original.slice(0, index + 1).join(separator)}`);
}
