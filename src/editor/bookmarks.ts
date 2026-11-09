/** Bookmarks: the list the user keeps, its storage, adding and removing, and going to a bookmark (also in a file that is not open). */
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { documentState } from "../documents/document-state";
import { openTextInTab } from "../documents/file-actions";
import { normalizeSessionPath } from "../documents/session";
import { switchToTab } from "../documents/tabs";
import { basename } from "../filesystem/path-utils";
import { BinaryFileError, loadTextFile } from "../filesystem/text-io";
import { langText } from "../i18n/language";
import { isFilesystemScopeError } from "../project/project-tree-ops";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { bookmarkFilesEnabled, hasBookmarkFile, readBookmarkFile, setBookmarkFilesEnabled, writeBookmarkFile } from "./bookmark-files";
import { bookmarkPositions, onBookmarkGutterClick, setBookmarkMarks, type BookmarkMark } from "./bookmark-field";
import {
  addBookmark, bookmarkAtLine, bookmarkTitle, bookmarksOfFile, editBookmark, excerptOf, MAX_BOOKMARKS, moveBookmark, neighbourBookmark,
  parseStoredBookmarks, relocateLine, removeBookmark, removeFile, renamePath, replaceFileBookmarks, sameBookmarkContent, samePath,
  serializeBookmarkFile, type Bookmark,
} from "./bookmarks-model";
import { view } from "./editor-view";

const STORAGE_KEY = "typenova.bookmarks.v1";
const SAVE_DELAY_MS = 400;
const TOOLTIP_NOTE_LENGTH = 160;

let bookmarks: Bookmark[] = [];
let saveTimer = 0;
const listeners = new Set<() => void>();

export function getBookmarks(): readonly Bookmark[] { return bookmarks; }
/** Calls `listener` whenever the list changes; the returned function stops it. */
export function onBookmarksChanged(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** The word used in generated names, in the current language. */
export function generatedBookmarkLabel(): string { return langText("Zakładka", "Bookmark"); }
export function titleOf(bookmark: Bookmark): string { return bookmarkTitle(bookmark, generatedBookmarkLabel()); }

function persist(): void {
  window.clearTimeout(saveTimer); saveTimer = 0;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks)); } catch { /* storage unavailable or full: bookmarks last until the app closes */ }
  scheduleFileWrite();
}
function schedulePersist(): void { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(persist, SAVE_DELAY_MS); }

/** The list changed through a deliberate action: save it, redraw the markers and tell the menus and dialogs. */
function commit(next: Bookmark[]): void {
  bookmarks = next;
  persist();
  refreshBookmarkMarkers();
  for (const listener of listeners) listener();
}

// ---- Bookmarks file next to a Markdown document ----
// The program keeps all bookmarks itself; for a Markdown document they are also written to `<name>.md.bookmarks.json`
// next to it. A document's file is read once (when the document is first shown) and from then on only written, so a
// file that could not be read is never overwritten.

/** Documents whose bookmarks file was read (or found missing), with the text last written there. */
const fileStates = new Map<string, { path: string; text: string }>();
const reading = new Set<string>();
const unreadableFiles = new Set<string>();
let fileQueue: Promise<void> = Promise.resolve();
let writeProblemShown = false;

function bookmarkFileGroups(): Map<string, { path: string; items: Bookmark[] }> {
  const groups = new Map<string, { path: string; items: Bookmark[] }>();
  for (const bookmark of bookmarks) {
    if (!hasBookmarkFile(bookmark.path)) continue;
    const key = normalizeSessionPath(bookmark.path);
    const group = groups.get(key);
    if (group) group.items.push(bookmark); else groups.set(key, { path: bookmark.path, items: [bookmark] });
  }
  return groups;
}

async function writeBookmarkFiles(): Promise<void> {
  if (!bookmarkFilesEnabled()) return;
  const groups = bookmarkFileGroups();
  for (const [key, state] of fileStates) {
    const group = groups.get(key);
    const text = group ? serializeBookmarkFile(basename(state.path), group.items) : "";
    if (text === state.text) continue;
    try { await writeBookmarkFile(state.path, group?.items ?? []); state.text = text; }
    catch {
      if (!writeProblemShown) { writeProblemShown = true; showToast(langText("Nie udało się zapisać pliku zakładek obok dokumentu. Zakładki zostają w programie.", "Could not save the bookmarks file next to the document. The bookmarks stay in the program.")); }
    }
  }
}
function scheduleFileWrite(): void { fileQueue = fileQueue.then(writeBookmarkFiles).catch(() => undefined); }

/** Reads the bookmarks file of a document the first time it is needed; what it holds replaces the program's bookmarks of that document. */
async function importBookmarkFile(path: string): Promise<void> {
  const key = normalizeSessionPath(path);
  if (!bookmarkFilesEnabled() || !hasBookmarkFile(path) || fileStates.has(key) || reading.has(key) || unreadableFiles.has(key)) return;
  reading.add(key);
  const snapshot = () => serializeBookmarkFile("", bookmarksOfFile(bookmarks, path));
  const before = snapshot();
  const found = await readBookmarkFile(path);
  reading.delete(key);
  if (found.kind === "unavailable") { unreadableFiles.add(key); return; }
  if (found.kind === "unreadable") {
    unreadableFiles.add(key);
    showToast(langText(`Plik zakładek obok „${basename(path)}” jest uszkodzony, więc go nie wczytano i nie nadpisano.`, `The bookmarks file next to “${basename(path)}” is damaged, so it was neither read nor overwritten.`));
    return;
  }
  fileStates.set(key, { path, text: found.kind === "found" ? serializeBookmarkFile(basename(path), found.bookmarks) : "" });
  // If the user changed this document's bookmarks while the file was being read, their version is the newer one.
  if (found.kind === "found" && snapshot() === before && !sameBookmarkContent(bookmarksOfFile(bookmarks, path), found.bookmarks)) {
    commit(replaceFileBookmarks(bookmarks, path, found.bookmarks, newId));
  } else scheduleFileWrite();
}

async function importAllBookmarkFiles(): Promise<void> {
  for (const group of bookmarkFileGroups().values()) await importBookmarkFile(group.path);
}

function tooltipOf(bookmark: Bookmark): string {
  const note = bookmark.note.replace(/\s+/g, " ").trim();
  const shortNote = note.length > TOOLTIP_NOTE_LENGTH ? `${note.slice(0, TOOLTIP_NOTE_LENGTH)}…` : note;
  return shortNote ? `${titleOf(bookmark)} — ${shortNote}` : titleOf(bookmark);
}

/** Shows the bookmarks of the open document in the editor (called when a tab becomes active and whenever the list changes). */
export function refreshBookmarkMarkers(): void {
  if (!view) return;
  const path = documentState.currentPath;
  const doc = view.state.doc;
  let next = bookmarks;
  const marks: BookmarkMark[] = [];
  for (const bookmark of path ? bookmarksOfFile(bookmarks, path) : []) {
    // A file that changed while it was closed: find the bookmark's line again by its text.
    const line = relocateLine(bookmark, doc.lines, number => doc.line(number).text);
    const info = doc.line(line);
    const column = line === bookmark.line ? bookmark.column : 0;
    if (line !== bookmark.line) next = moveBookmark(next, bookmark.id, { line, column, excerpt: excerptOf(info.text) });
    marks.push({ id: bookmark.id, position: info.from + Math.min(column, info.length), label: tooltipOf(bookmark) });
  }
  if (next !== bookmarks) { bookmarks = next; schedulePersist(); }
  view.dispatch({ effects: setBookmarkMarks.of(marks), annotations: Transaction.addToHistory.of(false) });
  if (path) void importBookmarkFile(path);
}

/** After an edit: bookmarks follow their text, so their stored line, column and text are brought up to date. */
export function syncBookmarksFromEditor(): void {
  const path = documentState.currentPath;
  if (!path || !bookmarksOfFile(bookmarks, path).length) return;
  const doc = view.state.doc;
  let next = bookmarks;
  for (const item of bookmarkPositions(view.state)) {
    const current = next.find(bookmark => bookmark.id === item.id);
    if (!current) continue;
    const line = doc.lineAt(item.position);
    const place = { line: line.number, column: item.position - line.from, excerpt: excerptOf(line.text) };
    if (current.line !== place.line || current.column !== place.column || current.excerpt !== place.excerpt) next = moveBookmark(next, item.id, place);
  }
  if (next !== bookmarks) { bookmarks = next; schedulePersist(); }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Adds a bookmark on a line of the open file (the caret's line when none is given). Returns it, or null when it cannot be added. */
export function addBookmarkAt(lineNumber?: number): Bookmark | null {
  const path = documentState.currentPath;
  if (!path) { showToast(langText("Zapisz dokument, aby dodać zakładkę.", "Save the document to add a bookmark.")); return null; }
  const doc = view.state.doc, head = view.state.selection.main.head;
  const line = lineNumber ? doc.line(lineNumber) : doc.lineAt(head);
  const existing = bookmarkAtLine(bookmarks, path, line.number);
  if (existing) return existing;
  if (bookmarks.length >= MAX_BOOKMARKS) { showToast(langText(`Osiągnięto limit ${MAX_BOOKMARKS} zakładek.`, `The limit of ${MAX_BOOKMARKS} bookmarks was reached.`)); return null; }
  const next = addBookmark(bookmarks, { path, line: line.number, column: lineNumber ? 0 : head - line.from, excerpt: excerptOf(line.text), id: newId(), now: Date.now() });
  commit(next);
  return bookmarkAtLine(bookmarks, path, line.number) ?? null;
}

/** Deletes a bookmark; one with a name or a note asks first, because they hold something the user wrote. */
export async function deleteBookmark(id: string, ask = true): Promise<boolean> {
  const target = bookmarks.find(bookmark => bookmark.id === id);
  if (!target) return false;
  if (ask && (target.name || target.note)) {
    const confirmed = await appConfirm(langText(`Usunąć zakładkę „${titleOf(target)}” razem z notatką?`, `Delete the bookmark “${titleOf(target)}” together with its note?`), { confirmLabel: langText("Usuń", "Delete"), primaryAction: "cancel" });
    if (!confirmed) return false;
  }
  commit(removeBookmark(bookmarks, id));
  return true;
}

/** Sets or removes the bookmark on a line: the action of Ctrl+F2, the menu and a click in the bookmark column. */
export async function toggleBookmark(lineNumber?: number): Promise<void> {
  const path = documentState.currentPath;
  const line = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
  const existing = path ? bookmarkAtLine(bookmarks, path, line) : undefined;
  if (!existing) { const added = addBookmarkAt(lineNumber); if (added) showToast(`${langText("Dodano zakładkę", "Bookmark added")}: ${titleOf(added)}`); return; }
  if (await deleteBookmark(existing.id)) showToast(`${langText("Usunięto zakładkę", "Bookmark removed")}: ${titleOf(existing)}`);
}

export function updateBookmark(id: string, changes: { name?: string; note?: string }): void { commit(editBookmark(bookmarks, id, changes)); }

/** The bookmark on the caret's line of the open file. */
export function bookmarkAtCaret(): Bookmark | undefined {
  const path = documentState.currentPath;
  return path ? bookmarkAtLine(bookmarks, path, view.state.doc.lineAt(view.state.selection.main.head).number) : undefined;
}

async function showFile(bookmark: Bookmark): Promise<boolean> {
  const open = documentState.tabs.find(tab => tab.path && samePath(tab.path, bookmark.path));
  if (open) { if (open.id !== documentState.activeTabId) switchToTab(open.id); return true; }
  try {
    const loaded = await loadTextFile(bookmark.path);
    openTextInTab(bookmark.path, loaded.text, loaded);
    return true;
  } catch (error) {
    if (isFilesystemScopeError(error)) { showToast(langText("Dostęp do tego pliku wygasł. Otwórz go ponownie przez wybór pliku lub folderu projektu.", "Access to this file has expired. Reopen it using the file picker or project folder picker.")); return false; }
    if (error instanceof BinaryFileError) { showToast(langText("Ten plik nie jest tekstowy.", "This file is not a text file.")); return false; }
    const remove = await appConfirm(langText(`Nie można otworzyć pliku zakładki:\n${bookmark.path}\nMógł zostać przeniesiony lub usunięty. Usunąć wszystkie zakładki tego pliku?`, `The bookmark's file could not be opened:\n${bookmark.path}\nIt may have been moved or deleted. Remove all bookmarks of this file?`), { confirmLabel: langText("Usuń zakładki", "Remove bookmarks"), primaryAction: "cancel" });
    if (remove) commit(removeFile(bookmarks, bookmark.path));
    return false;
  }
}

/** Opens the bookmark's file (if it is not open) and puts the caret on the bookmarked place. */
export async function goToBookmark(bookmark: Bookmark): Promise<void> {
  if (!await showFile(bookmark)) return;
  const doc = view.state.doc;
  const marker = bookmarkPositions(view.state).find(item => item.id === bookmark.id);
  const line = doc.line(Math.min(Math.max(bookmark.line, 1), doc.lines));
  const position = marker?.position ?? line.from + Math.min(bookmark.column, line.length);
  const reveal = () => { view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) }); view.focus(); };
  reveal();
  // Switching tabs restores the previous scroll position a moment later; reveal again so the bookmark wins.
  requestAnimationFrame(reveal);
}

/** Goes to the next (1) or previous (-1) bookmark, continuing in the next file and from the last to the first. */
export function goToNeighbourBookmark(direction: 1 | -1): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = neighbourBookmark(bookmarks, { path: documentState.currentPath, line }, direction);
  if (!target) { showToast(langText("Nie ma jeszcze żadnych zakładek.", "There are no bookmarks yet.")); return; }
  void goToBookmark(target);
}

/** A renamed or moved file or folder keeps its bookmarks. */
export function renameBookmarkPaths(from: string, to: string): void {
  const next = renamePath(bookmarks, from, to);
  if (!next.some((bookmark, index) => bookmark !== bookmarks[index])) return;
  // The bookmarks files moved with their documents (the caller renames them first); the new paths are read again.
  const fromKey = normalizeSessionPath(from);
  for (const key of [...fileStates.keys()]) if (key === fromKey || key.startsWith(`${fromKey}/`)) fileStates.delete(key);
  commit(next);
  void importAllBookmarkFiles();
}

/** The setting "bookmarks file next to the document" was switched: from now on the files are read and written, or left alone. */
export function applyBookmarkFilesSetting(enabled: boolean): void {
  setBookmarkFilesEnabled(enabled);
  fileStates.clear(); unreadableFiles.clear();
  if (!enabled) return;
  void importAllBookmarkFiles();
  refreshBookmarkMarkers();
}

/** Loads the saved bookmarks and connects the bookmark column of the editor. */
export function initBookmarks(): void {
  bookmarks = parseStoredBookmarks(localStorage.getItem(STORAGE_KEY));
  onBookmarkGutterClick(line => { void toggleBookmark(line); });
  document.addEventListener("typenova:language-changed", () => { refreshBookmarkMarkers(); for (const listener of listeners) listener(); });
  window.addEventListener("pagehide", persist);
  refreshBookmarkMarkers();
  void importAllBookmarkFiles();
}
