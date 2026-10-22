/** Top-menu bindings for file, edit, project and save/find commands. */
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { $ } from "./dom";
import { openDocument, saveDocument, saveDocumentAs } from "../documents/file-actions";
import { createNewTab } from "../documents/tabs";
import { prefixLine, wrapSelection } from "../editor/editing-commands";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { toggleFocus } from "../layout/focus-mode";
import { exportHtml } from "../preview/export-print";



export function initEditMenuBindings(): void {
  $("menuUndo").addEventListener("click", () => undo(view));
  $("menuRedo").addEventListener("click", () => redo(view));
  $("menuFind").addEventListener("click", () => openSearchPanel(view));
  $("menuSelectAll").addEventListener("click", () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); });
  $("menuViewPreview").addEventListener("click", () => ($("togglePreview") as HTMLButtonElement).click());
  $("menuViewOutline").addEventListener("click", () => ($("toggleOutline") as HTMLButtonElement).click());
  $("menuViewFocus").addEventListener("click", () => toggleFocus());
  $("menuBold").addEventListener("click", () => wrapSelection("**", "**"));
  $("menuItalic").addEventListener("click", () => wrapSelection("*", "*"));
  $("menuStrike").addEventListener("click", () => wrapSelection("~~", "~~"));
  $("menuHeading1").addEventListener("click", () => prefixLine("# "));
  $("menuHeading2").addEventListener("click", () => prefixLine("## "));
  $("menuHeading3").addEventListener("click", () => prefixLine("### "));
  $("menuSnippet").addEventListener("click", () => ($("snippetDialog") as HTMLDialogElement).showModal());
  $("menuImageSnippet").addEventListener("click", () => ($("insertImageSnippet") as HTMLButtonElement).click());
  $("menuInsertImage").addEventListener("click", () => ($("insertImage") as HTMLButtonElement).click());
  $("menuMermaid").addEventListener("click", () => ($("insertMermaid") as HTMLButtonElement).click());
  $("menuExport").addEventListener("click", () => void exportHtml());
  $("newTabButton").addEventListener("click", () => ($("menuNew") as HTMLButtonElement).click());
}

export function initSaveFindBindings(): void {
  $("saveButton").addEventListener("click", () => void saveDocument());
  $("findButton").addEventListener("click", () => openSearchPanel(view));
}

export function initFileMenuBindings(): void {
  $("menuNew").addEventListener("click", () => { createNewTab("# " + langText("Nowy dokument", "New document") + "\n\n", langText("Nowy dokument.md", "Untitled.md")); });
  $("menuOpen").addEventListener("click", () => void openDocument());
  $("menuSave").addEventListener("click", () => void saveDocument());
  $("menuSaveAs").addEventListener("click", () => void saveDocumentAs());
}
