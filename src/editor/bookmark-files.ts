/** The bookmarks file next to a Markdown document (`notes.md.bookmarks.json`): reading it, writing it, and the setting that turns it on or off. */
import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { readPreferenceFlag, writePreferenceFlag } from "../settings/preferences";
import { bookmarkFilePath, parseBookmarkFile, serializeBookmarkFile, type Bookmark } from "./bookmarks-model";

const SETTING_KEY = "typenova.bookmarkFiles";

/** Bookmarks files are on by default; the setting in the program settings turns them off. */
export function bookmarkFilesEnabled(): boolean { return readPreferenceFlag(SETTING_KEY, true); }
export function setBookmarkFilesEnabled(enabled: boolean): void { writePreferenceFlag(SETTING_KEY, enabled); }

/** Only Markdown documents get a bookmarks file; bookmarks in other files stay in the program. */
export function hasBookmarkFile(path: string): boolean { return isMarkdownPath(path); }

/** What was found next to a document: no file, a readable one, or a file that is not a bookmarks file (it is never overwritten). */
export type BookmarkFileState = { kind: "none" } | { kind: "found"; bookmarks: Bookmark[] } | { kind: "unreadable" } | { kind: "unavailable" };

/** "unreadable": the file exists but is not a bookmarks file. "unavailable": the file system could not be asked (no access to the folder). */
export async function readBookmarkFile(path: string): Promise<BookmarkFileState> {
  const filePath = bookmarkFilePath(path);
  let text: string;
  try {
    if (!await exists(filePath)) return { kind: "none" };
    text = await readTextFile(filePath);
  } catch { return { kind: "unavailable" }; }
  const bookmarks = parseBookmarkFile(text, path);
  return bookmarks ? { kind: "found", bookmarks } : { kind: "unreadable" };
}

/** Writes the bookmarks of a document next to it; with no bookmarks the file is removed. Returns the text written (empty when removed). */
export async function writeBookmarkFile(path: string, bookmarks: readonly Bookmark[]): Promise<string> {
  const filePath = bookmarkFilePath(path);
  if (!bookmarks.length) {
    if (await exists(filePath)) await remove(filePath);
    return "";
  }
  const text = serializeBookmarkFile(basename(path), bookmarks);
  await writeTextFile(filePath, text);
  return text;
}
