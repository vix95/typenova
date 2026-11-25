/** The setting "Hide TypeNova's files" (on by default) and the folder listing every list of the program uses, so that they all agree. */
import { readDir } from "@tauri-apps/plugin-fs";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { withoutOwnEntries, type ListedEntry } from "./own-files";

const SETTING_KEY = "typenova.hideOwnFiles";

export const hideOwnFilesEnabled = (): boolean => readPreferenceFlag(SETTING_KEY, true);
export const setHideOwnFiles = (enabled: boolean): void => writePreferenceFlag(SETTING_KEY, enabled);

/** The listing as the person should see it: without TypeNova's files while the setting is on. */
export function visibleEntries<T extends ListedEntry>(entries: readonly T[]): T[] {
  return hideOwnFilesEnabled() ? withoutOwnEntries(entries) : [...entries];
}

/** Reads a folder for a list shown to the person (the tree, the choice of a folder, completions). Copying, moving and deleting read the folder themselves, with everything in it. */
export async function readVisibleDir(path: string): Promise<Awaited<ReturnType<typeof readDir>>> {
  return visibleEntries(await readDir(path));
}
