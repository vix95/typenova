/** The config file next to a document: reading it and changing parts of it, one change at a time. Hidden sections, bookmarks and highlights all live in it. */
import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { basename } from "../filesystem/path-utils";
import { docConfigPath, isEmptyDocConfig, parseDocConfig, serializeDocConfig, type DocConfig } from "./doc-config-model";

/** Thrown when the file next to a document is not a config file (it is left untouched). */
export class DocConfigUnreadable extends Error {}

export type DocConfigRead = { kind: "none" } | { kind: "found"; config: DocConfig } | { kind: "unreadable" } | { kind: "unavailable" };

/** What the config file next to a document holds: nothing, a config, or something that is not one. "unavailable": the file system could not be asked. */
export async function readDocConfig(path: string): Promise<DocConfigRead> {
  const filePath = docConfigPath(path);
  let text: string;
  try {
    if (!await exists(filePath)) return { kind: "none" };
    text = await readTextFile(filePath);
  } catch { return { kind: "unavailable" }; }
  const config = parseDocConfig(text);
  return config ? { kind: "found", config } : { kind: "unreadable" };
}

let queue: Promise<void> = Promise.resolve();

/**
 * Reads the config file, lets `change` alter it and writes it back (or removes the file when nothing is left). Changes
 * are made one after another, so two parts saved at the same time never overwrite each other.
 */
export function updateDocConfig(path: string, change: (config: DocConfig) => DocConfig): Promise<void> {
  const run = async (): Promise<void> => {
    const filePath = docConfigPath(path);
    const current = await exists(filePath) ? parseDocConfig(await readTextFile(filePath)) : {};
    if (current === null) throw new DocConfigUnreadable(filePath);
    const next = change(current);
    if (isEmptyDocConfig(next)) { if (await exists(filePath)) await remove(filePath); return; }
    await writeTextFile(filePath, serializeDocConfig(basename(path), next));
  };
  const result = queue.then(run);
  queue = result.catch(() => undefined);
  return result;
}
