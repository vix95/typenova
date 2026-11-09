/** Bookmarks in the config file next to a Markdown document (`notes.md.config.json`): reading and writing them, and the setting that turns it on or off. */
import { exists, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { updateDocConfig, readDocConfig } from "../documents/doc-config";
import { withDocConfigParts } from "../documents/doc-config-model";
import { isMarkdownPath } from "../filesystem/path-utils";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { bookmarkEntries, bookmarkFilePath, parseBookmarkFile, parseBookmarkList, type Bookmark } from "./bookmarks-model";

const SETTING_KEY = "typenova.bookmarkFiles";

/** Writing the config file is on by default; the setting in the program settings turns it off (for bookmarks and highlights). */
export function bookmarkFilesEnabled(): boolean { return readPreferenceFlag(SETTING_KEY, true); }
export function setBookmarkFilesEnabled(enabled: boolean): void { writePreferenceFlag(SETTING_KEY, enabled); }

/** Only Markdown documents get a config file; bookmarks in other files stay in the program. */
export function hasBookmarkFile(path: string): boolean { return isMarkdownPath(path); }

/** What was found next to a document: nothing, bookmarks, or a file that is not a config file (it is never overwritten). */
export type BookmarkFileState = { kind: "none" } | { kind: "found"; bookmarks: Bookmark[]; fromLegacy?: boolean } | { kind: "unreadable" } | { kind: "unavailable" };

/** Earlier versions kept the bookmarks in a file of their own (`notes.md.bookmarks.json`); it is read once and removed when the config file is written. */
async function readLegacyBookmarks(path: string): Promise<Bookmark[] | null> {
  try {
    const legacy = bookmarkFilePath(path);
    return await exists(legacy) ? parseBookmarkFile(await readTextFile(legacy), path) : null;
  } catch { return null; }
}

export async function readBookmarkFile(path: string): Promise<BookmarkFileState> {
  const read = await readDocConfig(path);
  if (read.kind === "unreadable" || read.kind === "unavailable") return { kind: read.kind };
  if (read.kind === "found" && Array.isArray(read.config.bookmarks)) return { kind: "found", bookmarks: parseBookmarkList(read.config.bookmarks, path) };
  const legacy = await readLegacyBookmarks(path);
  return legacy ? { kind: "found", bookmarks: legacy, fromLegacy: true } : { kind: "none" };
}

/** Writes the bookmarks of a document into its config file (other parts stay as they are); with no bookmarks the part is removed, and the file with it when nothing is left. */
export async function writeBookmarkFile(path: string, bookmarks: readonly Bookmark[]): Promise<void> {
  await updateDocConfig(path, config => withDocConfigParts(config, { bookmarks: bookmarkEntries(bookmarks) }));
  try {
    const legacy = bookmarkFilePath(path);
    if (await readLegacyBookmarks(path) && await exists(legacy)) await remove(legacy);
  } catch { /* the old file stays where it is */ }
}
