/** Highlights: the list the user keeps, its storage (the program's memory and the config file next to a Markdown document), marking and unmarking passages, and going to a highlight. */
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { DocConfigUnreadable } from "../documents/doc-config";
import { documentState } from "../documents/document-state";
import { showFileTab } from "../documents/file-navigation";
import { normalizeSessionPath } from "../documents/session";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { setPreviewHighlights } from "../preview/preview-highlights";
import { appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";
import { bookmarkFilesEnabled, hasBookmarkFile } from "./bookmark-files";
import { view } from "./editor-view";
import { highlightPositions, setHighlightMarks, type HighlightMark } from "./highlight-field";
import { highlightApplied, highlightChanged, highlightsAdded, highlightsRemoved, onHighlightHistory, type HighlightOperation } from "./highlight-history";
import { readHighlightFile, writeHighlightFile } from "./highlight-files";
import {
  addHighlight, editHighlight, highlightEntries, highlightsOfFile, highlightsToMarkdown, highlightsTouching, MAX_HIGHLIGHT_TEXT, MAX_HIGHLIGHTS, moveHighlight,
  neighbourHighlight, parseStoredHighlights, plainText, relocateHighlight, removeFile, removeHighlights, renamePath, replaceFileHighlights, sameHighlightContent, shorten,
  type Highlight, type HighlightColor, isHighlightColor,
} from "./highlights-model";

const STORAGE_KEY = "typenova.highlights.v1";
const COLOR_KEY = "typenova.highlights.color";
const SAVE_DELAY_MS = 400;
const TOOLTIP_NOTE_LENGTH = 160;

let highlights: Highlight[] = [];
/** Highlights whose text was not found when their file was opened (they stay in the list, without a mark). */
const missing = new Set<string>();
let saveTimer = 0;
const listeners = new Set<() => void>();

export function getHighlights(): readonly Highlight[] { return highlights; }
export function isHighlightMissing(id: string): boolean { return missing.has(id); }
/** Calls `listener` whenever the list changes; the returned function stops it. */
export function onHighlightsChanged(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function notify(): void { for (const listener of listeners) listener(); }

/** The colour used for new highlights: the one last chosen, yellow at first. */
export function defaultHighlightColor(): HighlightColor {
  try { const stored = localStorage.getItem(COLOR_KEY); if (isHighlightColor(stored)) return stored; } catch { /* storage unavailable */ }
  return "yellow";
}

function persist(): void {
  window.clearTimeout(saveTimer); saveTimer = 0;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(highlights)); } catch { /* storage unavailable or full: highlights last until the app closes */ }
  scheduleFileWrite();
}
function schedulePersist(): void { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(persist, SAVE_DELAY_MS); }

/** The list changed through a deliberate action: save it, redraw the marks and tell the panel and the menus. */
function commit(next: Highlight[]): void {
  highlights = next;
  persist();
  refreshHighlightMarks();
  notify();
}

export function tooltipOf(item: Highlight): string {
  const note = item.note.replace(/\s+/g, " ").trim();
  const group = item.group ? `[${item.group}] ` : "";
  const shortNote = note.length > TOOLTIP_NOTE_LENGTH ? `${note.slice(0, TOOLTIP_NOTE_LENGTH)}…` : note;
  return shortNote ? `${group}${shortNote}` : group ? group.trim() : langText("Wyróżnienie", "Highlight");
}

/** Tells the preview where the highlights of the open document are (in lines), from the marks the editor keeps. */
function pushPreviewHighlights(): void {
  const path = documentState.currentPath;
  if (!path) { setPreviewHighlights([]); return; }
  const doc = view.state.doc;
  const byId = new Map(highlightsOfFile(highlights, path).map(item => [item.id, item]));
  setPreviewHighlights(highlightPositions(view.state).flatMap(position => {
    const item = byId.get(position.id);
    return item ? [{ id: item.id, startLine: doc.lineAt(position.from).number, endLine: doc.lineAt(position.to).number, text: doc.sliceString(position.from, position.to), color: item.color, label: tooltipOf(item), hasNote: item.note.trim() !== "" }] : [];
  }));
}

/** Shows the highlights of the open document in the editor and the preview (called when a tab becomes active and whenever the list changes). */
export function refreshHighlightMarks(): void {
  if (!view) return;
  const path = documentState.currentPath;
  const doc = view.state.doc;
  let next = highlights;
  let fullText: string | null = null;
  const marks: HighlightMark[] = [];
  for (const item of path ? highlightsOfFile(highlights, path) : []) {
    let { from, to } = item;
    const inPlace = to <= doc.length && doc.sliceString(from, Math.min(to, from + item.text.length)) === item.text;
    if (!inPlace) {
      // A file that changed while it was closed: find the passage again by its text.
      fullText ??= doc.toString();
      const found = relocateHighlight(item, fullText);
      if (!found) { missing.add(item.id); continue; }
      ({ from, to } = found);
      next = moveHighlight(next, item.id, { from, to, text: item.text });
    }
    missing.delete(item.id);
    marks.push({ id: item.id, from, to, color: item.color, label: tooltipOf(item), hasNote: item.note.trim() !== "" });
  }
  if (next !== highlights) { highlights = next; schedulePersist(); }
  view.dispatch({ effects: setHighlightMarks.of(marks), annotations: Transaction.addToHistory.of(false) });
  pushPreviewHighlights();
  if (path) void importHighlightFile(path);
}

let previewTimer = 0;
/** After an edit: highlights follow their text, so their stored place and text are brought up to date; one whose text was deleted is removed. */
export function syncHighlightsFromEditor(): void {
  const path = documentState.currentPath;
  if (!path) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(pushPreviewHighlights, 150);
  const mine = highlightsOfFile(highlights, path).filter(item => !missing.has(item.id));
  if (!mine.length) return;
  const doc = view.state.doc;
  const places = new Map(highlightPositions(view.state).map(position => [position.id, position]));
  let next = highlights;
  for (const item of mine) {
    const place = places.get(item.id);
    if (!place) { next = next.filter(other => other.id !== item.id); continue; }
    const text = doc.sliceString(place.from, Math.min(place.to, place.from + MAX_HIGHLIGHT_TEXT));
    if (place.from !== item.from || place.to !== item.to || text !== item.text) next = moveHighlight(next, item.id, { from: place.from, to: place.to, text });
  }
  if (next === highlights) return;
  const removed = next.length !== highlights.length;
  highlights = next; schedulePersist();
  if (removed) notify();
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The selection without the white space at its ends, as positions in the document; null when nothing but white space is selected. */
function trimmedSelection(): { from: number; to: number } | null {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return lead + trail >= text.length ? null : { from: range.from + lead, to: range.to - trail };
}

/** Whether the highlight is in the document the editor shows (only those are in its undo history). */
const isInOpenDocument = (item: Highlight): boolean => !!documentState.currentPath && normalizeSessionPath(item.path) === normalizeSessionPath(documentState.currentPath);

/** Puts a change of the highlights into the editor's undo history as an event of its own: Ctrl+Z takes it back and Ctrl+Y brings it again. The list is already changed, so this transaction is marked as applied. */
function recordInHistory(effect: ReturnType<typeof highlightsAdded.of> | ReturnType<typeof highlightsRemoved.of> | ReturnType<typeof highlightChanged.of>): void {
  view.dispatch({ effects: effect, annotations: [highlightApplied.of(true), isolateHistory.of("full")] });
}

/** What undo and redo bring back: the same changes of the list, applied the other way round. */
function applyHistoryOperations(operations: readonly HighlightOperation[]): void {
  let next = highlights;
  for (const operation of operations) {
    if (operation.kind === "add") { const ids = new Set(operation.items.map(item => item.id)); next = [...next.filter(item => !ids.has(item.id)), ...operation.items]; }
    else if (operation.kind === "remove") next = removeHighlights(next, new Set(operation.items.map(item => item.id)));
    else next = next.map(item => (item.id === operation.change.after.id ? operation.change.after : item));
  }
  if (next !== highlights) commit(next);
}

/** Marks the selected passage. Returns the highlight, or null when it cannot be added (and says why). */
export function addHighlightFromSelection(color: HighlightColor = defaultHighlightColor()): Highlight | null {
  const path = documentState.currentPath;
  if (!path) { showToast(langText("Zapisz dokument, aby wyróżnić fragment.", "Save the document to highlight a passage.")); return null; }
  const place = trimmedSelection();
  if (!place) { showToast(langText("Zaznacz fragment tekstu, który chcesz wyróżnić.", "Select the passage you want to highlight.")); return null; }
  if (highlights.length >= MAX_HIGHLIGHTS) { showToast(langText(`Osiągnięto limit ${MAX_HIGHLIGHTS} wyróżnień.`, `The limit of ${MAX_HIGHLIGHTS} highlights was reached.`)); return null; }
  if (highlightsTouching(highlights, path, place.from, place.to).length) { showToast(langText("Ten fragment zachodzi na istniejące wyróżnienie.", "This passage overlaps an existing highlight.")); return null; }
  const id = newId();
  commit(addHighlight(highlights, { path, from: place.from, to: place.to, text: view.state.sliceDoc(place.from, place.to), color, id, now: Date.now() }));
  const added = highlights.find(item => item.id === id) ?? null;
  if (added) recordInHistory(highlightsAdded.of([added]));
  return added;
}

/** Deletes highlights; one with a note or a group asks first, because it holds something the user wrote. */
export async function deleteHighlights(ids: readonly string[], ask = true): Promise<boolean> {
  const targets = highlights.filter(item => ids.includes(item.id));
  if (!targets.length) return false;
  if (ask && targets.some(item => item.note || item.group)) {
    const confirmed = await appConfirm(langText(targets.length === 1 ? "Usunąć to wyróżnienie razem z notatką i grupą?" : `Usunąć ${targets.length} wyróżnień razem z notatkami i grupami?`, targets.length === 1 ? "Delete this highlight together with its note and group?" : `Delete ${targets.length} highlights together with their notes and groups?`), { confirmLabel: langText("Usuń", "Delete"), primaryAction: "cancel" });
    if (!confirmed) return false;
  }
  commit(removeHighlights(highlights, new Set(targets.map(item => item.id))));
  const here = targets.filter(item => isInOpenDocument(item));
  if (here.length) recordInHistory(highlightsRemoved.of(here));
  return true;
}

export const deleteHighlight = (id: string, ask = true): Promise<boolean> => deleteHighlights([id], ask);

/** The highlights the selection touches (or the caret lies in) in the open file. */
export function highlightsAtSelection(): Highlight[] {
  const path = documentState.currentPath;
  const range = view.state.selection.main;
  return path ? highlightsTouching(highlights, path, range.from, range.to) : [];
}

/** Marks the selection, or removes the highlight the selection or caret is on: the action of Ctrl+Shift+H, the toolbar button and the menus. */
export async function toggleHighlight(): Promise<void> {
  const touching = highlightsAtSelection();
  if (!touching.length) { if (addHighlightFromSelection()) showToast(langText("Wyróżniono fragment.", "Passage highlighted.")); return; }
  if (await deleteHighlights(touching.map(item => item.id))) showToast(langText("Usunięto wyróżnienie.", "Highlight removed."));
}

export function updateHighlight(id: string, changes: { note?: string; group?: string; color?: HighlightColor }): void {
  if (changes.color) { try { localStorage.setItem(COLOR_KEY, changes.color); } catch { /* storage unavailable */ } }
  const before = highlights.find(item => item.id === id);
  commit(editHighlight(highlights, id, changes));
  const after = highlights.find(item => item.id === id);
  if (before && after && isInOpenDocument(after) && !sameHighlightContent([before], [after])) recordInHistory(highlightChanged.of({ before, after }));
}

/** Opens the highlight's file (if it is not open) and selects the highlighted passage. */
export async function goToHighlight(item: Highlight): Promise<void> {
  const result = await showFileTab(item.path);
  if (result === "scope") { showToast(langText("Dostęp do tego pliku wygasł. Otwórz go ponownie przez wybór pliku lub folderu projektu.", "Access to this file has expired. Reopen it using the file picker or project folder picker.")); return; }
  if (result === "binary") { showToast(langText("Ten plik nie jest tekstowy.", "This file is not a text file.")); return; }
  if (result === "failed") {
    const remove = await appConfirm(langText(`Nie można otworzyć pliku wyróżnienia:\n${item.path}\nMógł zostać przeniesiony lub usunięty. Usunąć wszystkie wyróżnienia tego pliku?`, `The highlight's file could not be opened:\n${item.path}\nIt may have been moved or deleted. Remove all highlights of this file?`), { confirmLabel: langText("Usuń wyróżnienia", "Remove highlights"), primaryAction: "cancel" });
    if (remove) commit(removeFile(highlights, item.path));
    return;
  }
  const place = highlightPositions(view.state).find(position => position.id === item.id) ?? { from: Math.min(item.from, view.state.doc.length), to: Math.min(item.to, view.state.doc.length) };
  const reveal = () => { view.dispatch({ selection: { anchor: place.from, head: place.to }, effects: EditorView.scrollIntoView(place.from, { y: "center" }) }); view.focus(); };
  reveal();
  // Switching tabs restores the previous scroll position a moment later; reveal again so the highlight wins.
  requestAnimationFrame(reveal);
}

/** Goes to the next (1) or previous (-1) highlight, continuing in the next file and from the last to the first. */
export function goToNeighbourHighlight(direction: 1 | -1): void {
  const target = neighbourHighlight(highlights, { path: documentState.currentPath, position: view.state.selection.main.head }, direction);
  if (!target) { showToast(langText("Nie ma jeszcze żadnych wyróżnień.", "There are no highlights yet.")); return; }
  void goToHighlight(target);
}

/** All highlights (or those given) as Markdown on the clipboard. */
export async function copyHighlightsAsMarkdown(list: readonly Highlight[], by: "file" | "group"): Promise<void> {
  if (!list.length) { showToast(langText("Nie ma wyróżnień do skopiowania.", "There are no highlights to copy.")); return; }
  const text = highlightsToMarkdown(list, by, { noGroup: langText("Bez grupy", "No group"), fileName: basename, title: langText("Wyróżnienia", "Highlights") });
  try { await navigator.clipboard.writeText(text); showToast(langText("Skopiowano wyróżnienia jako Markdown.", "Highlights copied as Markdown.")); }
  catch { showToast(langText("Nie można zapisać do schowka.", "Could not write to the clipboard.")); }
}

// ---- Highlights in the config file next to a Markdown document ----
// The program keeps all highlights itself; for a Markdown document they are also written to its config file (the same
// file that holds its hidden sections and bookmarks). A document's file is read once, when the document is first shown,
// and from then on only written; a file that could not be read is never overwritten.

const fileStates = new Map<string, { path: string; text: string }>();
const reading = new Set<string>();
const unreadableFiles = new Set<string>();
let fileQueue: Promise<void> = Promise.resolve();
let writeProblemShown = false;

function fileGroups(): Map<string, { path: string; items: Highlight[] }> {
  const groups = new Map<string, { path: string; items: Highlight[] }>();
  for (const item of highlights) {
    if (!hasBookmarkFile(item.path)) continue;
    const key = normalizeSessionPath(item.path);
    const group = groups.get(key);
    if (group) group.items.push(item); else groups.set(key, { path: item.path, items: [item] });
  }
  return groups;
}

const signature = (items: readonly Highlight[]): string => JSON.stringify(highlightEntries(items));

async function writeFiles(): Promise<void> {
  if (!bookmarkFilesEnabled()) return;
  const groups = fileGroups();
  for (const [key, state] of fileStates) {
    const items = groups.get(key)?.items ?? [];
    const text = signature(items);
    if (text === state.text) continue;
    try { await writeHighlightFile(state.path, items); state.text = text; }
    catch (error) {
      if (writeProblemShown) continue;
      writeProblemShown = true;
      showToast(error instanceof DocConfigUnreadable
        ? langText("Plik konfiguracji obok dokumentu jest uszkodzony, więc wyróżnienia nie zostały do niego zapisane.", "The config file next to the document is damaged, so the highlights were not saved to it.")
        : langText("Nie udało się zapisać wyróżnień w pliku obok dokumentu. Zostają w programie.", "Could not save the highlights in the file next to the document. They stay in the program."));
    }
  }
}
function scheduleFileWrite(): void { fileQueue = fileQueue.then(writeFiles).catch(() => undefined); }

/** Reads the config file of a document the first time it is needed; the highlights it holds replace the program's highlights of that document. */
async function importHighlightFile(path: string): Promise<void> {
  const key = normalizeSessionPath(path);
  if (!bookmarkFilesEnabled() || !hasBookmarkFile(path) || fileStates.has(key) || reading.has(key) || unreadableFiles.has(key)) return;
  reading.add(key);
  const before = signature(highlightsOfFile(highlights, path));
  const found = await readHighlightFile(path);
  reading.delete(key);
  if (found.kind === "unavailable") { unreadableFiles.add(key); return; }
  if (found.kind === "unreadable") { unreadableFiles.add(key); return; }
  fileStates.set(key, { path, text: found.kind === "found" ? signature(found.highlights) : "" });
  // If the user changed this document's highlights while the file was being read, their version is the newer one.
  const local = highlightsOfFile(highlights, path);
  if (found.kind === "found" && signature(local) === before && !sameHighlightContent(local, found.highlights)) commit(replaceFileHighlights(highlights, path, found.highlights, newId));
  else scheduleFileWrite();
}

async function importAllFiles(): Promise<void> {
  for (const group of fileGroups().values()) await importHighlightFile(group.path);
}

/** The setting for the config file was switched: from now on the files are read and written, or left alone. */
export function applyHighlightFilesSetting(enabled: boolean): void {
  fileStates.clear(); unreadableFiles.clear();
  if (!enabled) return;
  void importAllFiles();
  refreshHighlightMarks();
}

/** A renamed or moved file or folder keeps its highlights. */
export function renameHighlightPaths(from: string, to: string): void {
  const next = renamePath(highlights, from, to);
  if (!next.some((item, index) => item !== highlights[index])) return;
  // The config files moved with their documents (the caller renames them first); the new paths are read again.
  const fromKey = normalizeSessionPath(from);
  for (const key of [...fileStates.keys()]) if (key === fromKey || key.startsWith(`${fromKey}/`)) fileStates.delete(key);
  commit(next);
  void importAllFiles();
}

/** Loads the saved highlights. */
export function initHighlights(): void {
  onHighlightHistory(applyHistoryOperations);
  highlights = parseStoredHighlights(localStorage.getItem(STORAGE_KEY));
  document.addEventListener("typenova:language-changed", () => { refreshHighlightMarks(); notify(); });
  window.addEventListener("pagehide", persist);
  refreshHighlightMarks();
  void importAllFiles();
}

/** A short line for lists: the highlighted text on one line, as it reads after Markdown is rendered. */
export function highlightExcerpt(item: Highlight, limit = 160): string { return shorten(plainText(item.text) || item.text, limit); }
