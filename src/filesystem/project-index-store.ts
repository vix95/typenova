/** The link index's contact with the real file system (Tauri): reading folders, stamping files and keeping the index in the application data folder between sessions. */
import { BaseDirectory, mkdir, readDir, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { INDEX_VERSION, type IndexedFile } from "../graph/project-index-model";
import type { IndexPort } from "../graph/project-index-engine";
import { readTextAuto } from "./text-io";

const FOLDER = "link-index";

async function load(key: string): Promise<IndexedFile[]> {
  try {
    const stored = JSON.parse(await readTextFile(`${FOLDER}/${key}.json`, { baseDir: BaseDirectory.AppData })) as { version?: number; files?: IndexedFile[] };
    return stored.version === INDEX_VERSION && Array.isArray(stored.files) ? stored.files : [];
  } catch { return []; }
}

async function save(key: string, files: readonly IndexedFile[]): Promise<void> {
  await mkdir(FOLDER, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(`${FOLDER}/${key}.json`, JSON.stringify({ version: INDEX_VERSION, files }), { baseDir: BaseDirectory.AppData });
}

/** The stamp of a file: changes with its modification time or size. "?" when the system does not say (such a file is read every time). */
async function stamp(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return info.mtime ? `${info.mtime.getTime()}:${info.size}` : "?";
  } catch { return "?"; }
}

/** What the index engine needs from the real system; `roots`, `isInside` and `samePath` are added where the application state is known. */
export const tauriFiles: Pick<IndexPort, "load" | "save" | "stamp" | "readDir" | "readText" | "join"> = {
  load, save, stamp,
  readDir: path => readDir(path),
  readText: readTextAuto,
  join,
};
