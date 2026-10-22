import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { isMarkdownPath } from "./path-utils";

export interface ProjectMarkdownFile {
  path: string;
  name: string;
  text: string;
}
export interface MarkdownProjectScanOptions {
  isCancelled?: () => boolean;
  onProgress?: (visitedFiles: number) => void;
  onError?: (issue: { path: string; operation: "read-directory" | "read-file"; message: string }) => void;
  yieldControl?: () => Promise<void>;
}
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "target", "dist", "build", "vendor"]);
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Reads the project's Markdown inputs without knowing anything about graph renderers. */
export async function scanMarkdownProject(
  rootPath: string,
  options: MarkdownProjectScanOptions = {}
): Promise<ProjectMarkdownFile[]> {
  const files: ProjectMarkdownFile[] = [];
  let visited = 0;
  const cancelled = () => options.isCancelled?.() === true;
  const yieldControl = options.yieldControl || yieldTask;
  const walk = async (directoryPath: string): Promise<void> => {
    if (cancelled()) return;
    let entries: Array<{ name: string; isDirectory: boolean }> = [];
    try {
      entries = await readDir(directoryPath);
    } catch (error) {
      options.onError?.({ path: directoryPath, operation: "read-directory", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const entry of entries) {
      if (cancelled()) return;
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      const fullPath = await join(directoryPath, entry.name);
      if (entry.isDirectory) { await walk(fullPath); continue; }
      if (!isMarkdownPath(entry.name)) continue;
      try {
        const text = await readTextFile(fullPath);
        files.push({ path: fullPath, name: entry.name, text });
      } catch (error) {
        // Report incomplete indexing rather than silently presenting a partial graph as complete.
        options.onError?.({ path: fullPath, operation: "read-file", message: error instanceof Error ? error.message : String(error) });
      }
      visited++;
      options.onProgress?.(visited);
      if (visited % 10 === 0) {
        options.onProgress?.(visited);
        await yieldControl();
        if (cancelled()) return;
      }
    }
  };
  await walk(rootPath);
  return files;
}
