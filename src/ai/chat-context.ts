/** What the chat sends along with a message: the open document (its full path, with a button that opens it) and the selection (the section it lies in, its lines, a button that goes to it). Shown live above the message field and with every message sent. */
import { documentState } from "../documents/document-state";
import { showFileTab } from "../documents/file-navigation";
import { button, el } from "../editor/bookmark-browser";
import { view } from "../editor/editor-view";
import { basename } from "../filesystem/path-utils";
import { langText } from "../i18n/language";
import { outlineHeadings } from "../outline/outline";
import { ICONS } from "../ui/icons";
import { showToast } from "../ui/toast";

export interface ContextSelection { text: string; from: number; to: number; startLine: number; endLine: number; section: string | null }
export interface ContextSnapshot {
  /** The document that is sent; the path is null for a document that is not saved yet. */
  document: { name: string; path: string | null } | null;
  selection: ContextSelection | null;
}

/** The heading of the section a line lies in; null before the first heading or when there are no headings. */
export function sectionOfLine(line: number): string | null {
  let found: string | null = null;
  for (const heading of outlineHeadings) {
    if (heading.line > line) break;
    found = heading.text;
  }
  return found;
}

/** What would be sent now, given which of the two are switched on. */
export function captureContext(useDocument: boolean, useSelection: boolean): ContextSnapshot {
  const state = view.state;
  const range = state.selection.main;
  const path = documentState.currentPath;
  const document = useDocument ? { name: path ? basename(path) : documentState.untitledLabel, path } : null;
  if (!useSelection || range.empty) return { document, selection: null };
  const startLine = state.doc.lineAt(range.from).number;
  return {
    document,
    selection: { text: state.sliceDoc(range.from, range.to), from: range.from, to: range.to, startLine, endLine: state.doc.lineAt(range.to).number, section: sectionOfLine(startLine) },
  };
}

/** Opens the document that was sent (it is switched to when it is already open). */
async function openDocument(path: string): Promise<void> {
  const result = await showFileTab(path);
  if (result === "shown") return;
  showToast(langText("Nie można otworzyć tego dokumentu. Mógł zostać przeniesiony lub usunięty.", "This document could not be opened. It may have been moved or deleted."));
}

/** Goes to the selection that was sent: opens its document and selects the passage when the text is still where it was. */
async function goToSelection(snapshot: ContextSnapshot): Promise<void> {
  const selection = snapshot.selection;
  if (!selection) return;
  if (snapshot.document?.path) await openDocument(snapshot.document.path);
  const doc = view.state.doc;
  const intact = selection.to <= doc.length && view.state.sliceDoc(selection.from, selection.to) === selection.text;
  if (!intact) { showToast(langText("Tekst w tym miejscu się zmienił.", "The text in this place has changed.")); return; }
  view.dispatch({ selection: { anchor: selection.from, head: selection.to }, scrollIntoView: true });
  view.focus();
}

function row(icon: string, children: (HTMLElement | string)[], action: HTMLElement | null): HTMLElement {
  const item = el("li", "ai-context-item");
  item.insertAdjacentHTML("afterbegin", icon);
  const body = el("span", "ai-context-body");
  for (const child of children) body.append(child);
  item.append(body);
  if (action) item.append(action);
  return item;
}

function linesText(selection: ContextSelection): string {
  const lines = selection.startLine === selection.endLine ? `${selection.startLine}` : `${selection.startLine}–${selection.endLine}`;
  return langText(`wiersze ${lines}, ${selection.text.length} znaków`, `lines ${lines}, ${selection.text.length} characters`);
}

/** Draws what is (or was) sent: one row for the document and one for the selection. */
export function renderContext(container: HTMLElement, snapshot: ContextSnapshot): void {
  container.replaceChildren();
  if (snapshot.document) {
    const { name, path } = snapshot.document;
    container.append(row(ICONS.note, [
      el("span", "ai-context-title", langText("Dokument", "Document")),
      el("span", "ai-context-path", path ?? `${name} (${langText("niezapisany, nie ma ścieżki", "not saved, it has no path")})`),
    ], path ? button("ai-icon-button", "arrowRight", langText("Otwórz dokument", "Open the document"), () => { void openDocument(path); }) : null));
    (container.lastElementChild as HTMLElement | null)?.setAttribute("title", path ?? name);
  }
  if (snapshot.selection) {
    const selection = snapshot.selection;
    container.append(row(ICONS.replaceText, [
      el("span", "ai-context-title", langText("Zaznaczenie", "Selection")),
      el("span", "ai-context-path", selection.section
        ? `${langText("sekcja", "section")} „${selection.section}”, ${linesText(selection)}`
        : `${langText("przed pierwszym nagłówkiem", "before the first heading")}, ${linesText(selection)}`),
    ], button("ai-icon-button", "arrowRight", langText("Przejdź do zaznaczenia", "Go to the selection"), () => { void goToSelection(snapshot); })));
  }
}
