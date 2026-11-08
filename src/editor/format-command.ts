/** The "Format document" command: formats or validates the active document by its type and reports what it did or where it found an error. */
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { showToast } from "../ui/toast";
import { view } from "./editor-view";
import { formatterFor } from "./format-document";

export function formatActiveDocument(): void {
  const path = documentState.currentPath || documentState.untitledLabel;
  const formatter = formatterFor(path);
  if (!formatter) { showToast(langText("Dla tego typu pliku nie ma formatowania (obsługiwane: JSON, JSONL, YAML, TOML, XML i tabele w Markdown).", "There is no formatter for this file type (supported: JSON, JSON Lines, YAML, TOML, XML and Markdown tables).")); return; }
  const before = view.state.doc.toString();
  const result = formatter.format(before);
  if (!result.ok) {
    if (result.line) {
      const line = view.state.doc.line(Math.min(result.line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: Math.min(line.from + Math.max(0, (result.column ?? 1) - 1), line.to) }, scrollIntoView: true }); view.focus();
    }
    showToast(`${formatter.kind}: ${result.message}${result.line ? ` (${langText("wiersz", "line")} ${result.line}${result.column ? `, ${langText("kol.", "col.")} ${result.column}` : ""})` : ""}`);
    return;
  }
  if (result.note === "valid") { showToast(langText(`${formatter.kind} jest poprawny.`, `${formatter.kind} is valid.`)); return; }
  if (result.text === before) { showToast(langText("Dokument jest już sformatowany.", "The document is already formatted.")); return; }
  const anchor = Math.min(view.state.selection.main.head, result.text.length);
  view.dispatch({ changes: { from: 0, to: before.length, insert: result.text }, selection: { anchor }, userEvent: "input.format" });
  view.focus();
  showToast(langText(`Sformatowano (${formatter.kind}).`, `Formatted (${formatter.kind}).`));
}

export function initFormatCommand(): void {
  $("menuImport").addEventListener("click", () => void import("../documents/import-document").then(module => module.importDocument()));
  $("menuFormat").addEventListener("click", () => formatActiveDocument());
  document.addEventListener("keydown", event => {
    if (event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyF") { event.preventDefault(); formatActiveDocument(); }
  });
}
