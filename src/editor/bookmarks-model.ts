/** Bookmarks: a pure model (no DOM, no CodeMirror) for places in files that the user wants to return to. */
import { normalizeSessionPath } from "../documents/session.js";

export interface Bookmark {
  id: string;
  /** Path of the file as it was opened. */
  path: string;
  /** 1-based line of the bookmark. */
  line: number;
  /** 0-based column on that line. */
  column: number;
  /** The line's text (trimmed, shortened), used to find the place again when the file changed while it was closed. */
  excerpt: string;
  /** Name chosen by the user; empty means "use the generated name". */
  name: string;
  note: string;
  /** Running number that gives the generated name ("Bookmark #3"); never reused. */
  seq: number;
  created: number;
}

export const MAX_BOOKMARKS = 500;
export const MAX_NAME = 80;
export const MAX_NOTE = 2000;
const MAX_EXCERPT = 120;
const SEARCH_RADIUS = 200;

/** A line's text reduced to what identifies it. */
export function excerptOf(lineText: string): string {
  return lineText.trim().replace(/\s+/g, " ").slice(0, MAX_EXCERPT);
}

/** The name shown for a bookmark: the user's name, or "<label> #<seq>". */
export function bookmarkTitle(bookmark: Pick<Bookmark, "name" | "seq">, generatedLabel: string): string {
  const name = bookmark.name.trim();
  return name || `${generatedLabel} #${bookmark.seq}`;
}

export function samePath(a: string, b: string): boolean {
  return normalizeSessionPath(a) === normalizeSessionPath(b);
}

export function nextSeq(bookmarks: readonly Bookmark[]): number {
  return bookmarks.reduce((highest, bookmark) => Math.max(highest, bookmark.seq), 0) + 1;
}

export function bookmarksOfFile(bookmarks: readonly Bookmark[], path: string): Bookmark[] {
  return bookmarks.filter(bookmark => samePath(bookmark.path, path));
}

/** The bookmark on a line of a file, if any. */
export function bookmarkAtLine(bookmarks: readonly Bookmark[], path: string, line: number): Bookmark | undefined {
  return bookmarks.find(bookmark => bookmark.line === line && samePath(bookmark.path, path));
}

export interface NewBookmark { path: string; line: number; column: number; excerpt: string; id: string; now: number }

/** Adds a bookmark; returns the list unchanged when the line already has one or the limit is reached. */
export function addBookmark(bookmarks: readonly Bookmark[], input: NewBookmark): Bookmark[] {
  if (bookmarks.length >= MAX_BOOKMARKS || bookmarkAtLine(bookmarks, input.path, input.line)) return [...bookmarks];
  const created: Bookmark = { id: input.id, path: input.path, line: input.line, column: input.column, excerpt: input.excerpt, name: "", note: "", seq: nextSeq(bookmarks), created: input.now };
  return [...bookmarks, created];
}

export function removeBookmark(bookmarks: readonly Bookmark[], id: string): Bookmark[] {
  return bookmarks.filter(bookmark => bookmark.id !== id);
}

/** Changes the name and note (trimmed and limited); other fields stay. */
export function editBookmark(bookmarks: readonly Bookmark[], id: string, changes: { name?: string; note?: string }): Bookmark[] {
  return bookmarks.map(bookmark => bookmark.id !== id ? bookmark : {
    ...bookmark,
    name: changes.name === undefined ? bookmark.name : changes.name.trim().slice(0, MAX_NAME),
    note: changes.note === undefined ? bookmark.note : changes.note.trim().slice(0, MAX_NOTE),
  });
}

/** Moves a bookmark to where it is now in the open document (after edits). */
export function moveBookmark(bookmarks: readonly Bookmark[], id: string, place: { line: number; column: number; excerpt: string }): Bookmark[] {
  return bookmarks.map(bookmark => bookmark.id === id ? { ...bookmark, line: place.line, column: place.column, excerpt: place.excerpt } : bookmark);
}

/** Follows a renamed or moved file, or every file inside a renamed or moved folder. */
export function renamePath(bookmarks: readonly Bookmark[], from: string, to: string): Bookmark[] {
  const prefix = normalizeSessionPath(from);
  return bookmarks.map(bookmark => {
    const path = normalizeSessionPath(bookmark.path);
    if (path === prefix) return { ...bookmark, path: to };
    if (path.startsWith(`${prefix}/`)) return { ...bookmark, path: to + bookmark.path.slice(from.length) };
    return bookmark;
  });
}

export function removeFile(bookmarks: readonly Bookmark[], path: string): Bookmark[] {
  return bookmarks.filter(bookmark => !samePath(bookmark.path, path));
}

/**
 * The line a bookmark should sit on in a file of `lineCount` lines (`readLine` returns the text of a 1-based line): its own line
 * when the text still matches, otherwise the closest line with the same text, otherwise the stored line limited to the file.
 */
export function relocateLine(bookmark: Pick<Bookmark, "line" | "excerpt">, lineCount: number, readLine: (line: number) => string): number {
  const clamp = (line: number) => Math.min(Math.max(line, 1), Math.max(lineCount, 1));
  const own = clamp(bookmark.line);
  if (!bookmark.excerpt) return own;
  const matches = (line: number) => excerptOf(readLine(line)) === bookmark.excerpt;
  if (matches(own)) return own;
  for (let distance = 1; distance <= SEARCH_RADIUS; distance++) {
    if (own - distance >= 1 && matches(own - distance)) return own - distance;
    if (own + distance <= lineCount && matches(own + distance)) return own + distance;
  }
  return own;
}

/** Orders bookmarks by file path and, within a file, by position. */
export function sortBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return [...bookmarks].sort((a, b) => {
    const pathA = normalizeSessionPath(a.path), pathB = normalizeSessionPath(b.path);
    return pathA === pathB ? a.line - b.line || a.column - b.column : pathA.localeCompare(pathB);
  });
}

/**
 * The bookmark after (`direction` 1) or before (-1) a place, going on to the next file and around to the first one at the end.
 * Returns undefined when there are no bookmarks.
 */
export function neighbourBookmark(bookmarks: readonly Bookmark[], here: { path: string | null; line: number }, direction: 1 | -1): Bookmark | undefined {
  const ordered = sortBookmarks(bookmarks);
  if (!ordered.length) return undefined;
  const herePath = here.path === null ? null : normalizeSessionPath(here.path);
  const isAfter = (bookmark: Bookmark) => {
    const path = normalizeSessionPath(bookmark.path);
    if (herePath === null) return true;
    return path === herePath ? bookmark.line > here.line : path.localeCompare(herePath) > 0;
  };
  const isBefore = (bookmark: Bookmark) => {
    const path = normalizeSessionPath(bookmark.path);
    if (herePath === null) return true;
    return path === herePath ? bookmark.line < here.line : path.localeCompare(herePath) < 0;
  };
  if (direction === 1) return ordered.find(isAfter) ?? ordered[0];
  const earlier = ordered.filter(isBefore);
  return earlier.length ? earlier[earlier.length - 1] : ordered[ordered.length - 1];
}

/** Bookmarks whose title, note, file name or text match every word of the query. */
export function filterBookmarks(bookmarks: readonly Bookmark[], query: string, generatedLabel: string): Bookmark[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...bookmarks];
  return bookmarks.filter(bookmark => {
    const haystack = `${bookmarkTitle(bookmark, generatedLabel)} ${bookmark.note} ${bookmark.path} ${bookmark.excerpt}`.toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && typeof item.path === "string" && item.path.length > 0
    && Number.isInteger(item.line) && (item.line as number) >= 1 && Number.isInteger(item.column) && (item.column as number) >= 0
    && typeof item.excerpt === "string" && typeof item.name === "string" && typeof item.note === "string"
    && Number.isInteger(item.seq) && (item.seq as number) >= 1 && typeof item.created === "number";
}

/** Reads stored bookmarks; anything malformed is dropped, ids stay unique, and the list is limited. */
export function parseStoredBookmarks(raw: string | null): Bookmark[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Bookmark[] = [];
  for (const item of value) {
    if (!isBookmark(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ ...item, name: item.name.slice(0, MAX_NAME), note: item.note.slice(0, MAX_NOTE), excerpt: item.excerpt.slice(0, MAX_EXCERPT) });
    if (result.length >= MAX_BOOKMARKS) break;
  }
  return result;
}

/** Name of the bookmarks file next to a Markdown file: the file's own name plus `.bookmarks.json`. */
export function bookmarkFilePath(documentPath: string): string { return `${documentPath}.bookmarks.json`; }

/**
 * The text of a bookmarks file for one document. It holds no path (the file is found next to its document, so it keeps
 * working when the folder is moved or opened on another computer), and lists bookmarks in the order of the document.
 */
export function serializeBookmarkFile(documentName: string, bookmarks: readonly Bookmark[]): string {
  const entries = [...bookmarks].sort((a, b) => a.line - b.line || a.column - b.column).map(({ path: _path, ...rest }) => rest);
  return JSON.stringify({ version: 1, document: documentName, bookmarks: entries }, null, 2) + "\n";
}

/**
 * The bookmarks in a bookmarks file's text, placed in the document at `path`; malformed entries are ignored.
 * Null when the text is not a bookmarks file at all (so a damaged file is left alone instead of being overwritten).
 */
export function parseBookmarkFile(raw: string | null | undefined, path: string): Bookmark[] | null {
  if (!raw) return null;
  let list: unknown;
  try { list = (JSON.parse(raw) as { bookmarks?: unknown } | null)?.bookmarks; } catch { return null; }
  if (!Array.isArray(list)) return null;
  return parseStoredBookmarks(JSON.stringify(list.map(item => (typeof item === "object" && item !== null ? { ...item, path } : item))));
}

/** True when two lists hold the same bookmarks of a document (the order and the path do not matter). */
export function sameBookmarkContent(a: readonly Bookmark[], b: readonly Bookmark[]): boolean {
  const text = (list: readonly Bookmark[]) => serializeBookmarkFile("", [...list].sort((x, y) => x.id.localeCompare(y.id)));
  return text(a) === text(b);
}

/**
 * Replaces the bookmarks of one file with `replacement` (read from its bookmarks file). A copied document brings a copy
 * of its bookmarks file with the same ids, so an id that another file already uses is renewed with `makeId`.
 */
export function replaceFileBookmarks(bookmarks: readonly Bookmark[], path: string, replacement: readonly Bookmark[], makeId: () => string): Bookmark[] {
  const others = bookmarks.filter(bookmark => !samePath(bookmark.path, path));
  const used = new Set(others.map(bookmark => bookmark.id));
  const fresh = replacement.slice(0, Math.max(0, MAX_BOOKMARKS - others.length)).map(bookmark => {
    let id = bookmark.id;
    while (used.has(id)) id = makeId();
    used.add(id);
    return { ...bookmark, path, id };
  });
  return [...others, ...fresh];
}
