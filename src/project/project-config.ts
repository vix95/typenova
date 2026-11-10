/** The project config file: `typenova.config.json` in the root of a project folder. It holds what the program keeps about the project as a whole (today: its terminals); unknown parts are kept. */
import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { isEmptyProjectConfig, parseProjectConfig, PROJECT_CONFIG_FILE, serializeProjectConfig, type ProjectConfig } from "../terminal/terminal-model";

/** Thrown when the file is not a config file (it is left untouched). */
export class ProjectConfigUnreadable extends Error {}

export type ProjectConfigRead = { kind: "none" } | { kind: "found"; config: ProjectConfig } | { kind: "unreadable" } | { kind: "unavailable" };

export function projectConfigPath(root: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${PROJECT_CONFIG_FILE}`;
}

/** What the config file of a project folder holds: nothing, a config, or something that is not one. "unavailable": the file system could not be asked. */
export async function readProjectConfig(root: string): Promise<ProjectConfigRead> {
  const path = projectConfigPath(root);
  let text: string;
  try {
    if (!await exists(path)) return { kind: "none" };
    text = await readTextFile(path);
  } catch { return { kind: "unavailable" }; }
  const config = parseProjectConfig(text);
  return config ? { kind: "found", config } : { kind: "unreadable" };
}

let queue: Promise<void> = Promise.resolve();

/** Reads the config file, lets `change` alter it and writes it back (or removes the file when nothing is left). Changes are made one after another. */
export function updateProjectConfig(root: string, change: (config: ProjectConfig) => ProjectConfig): Promise<void> {
  const run = async (): Promise<void> => {
    const path = projectConfigPath(root);
    const present = await exists(path);
    const current = present ? parseProjectConfig(await readTextFile(path)) : {};
    if (current === null) throw new ProjectConfigUnreadable(path);
    const next = change(current);
    if (isEmptyProjectConfig(next)) { if (present) await remove(path); return; }
    const text = serializeProjectConfig(next);
    if (present && (await readTextFile(path)) === text) return;
    await writeTextFile(path, text);
  };
  const result = queue.then(run);
  queue = result.catch(() => undefined);
  return result;
}
