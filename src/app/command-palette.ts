/** Ctrl+K command palette: command catalogue, filtering and keyboard navigation. */
import { formatActiveDocument } from "../editor/format-command";
import { openGitHistory } from "../git-ui/git-history";
import { openSearchPanel } from "@codemirror/search";
import { undo, redo } from "@codemirror/commands";
import { $ } from "./dom";
import { openDocument, saveDocument, saveDocumentAs } from "../documents/file-actions";
import { showVersionHistory } from "../documents/recovery";
import { wrapSelection } from "../editor/editing-commands";
import { view } from "../editor/editor-view";
import { langText } from "../i18n/language";
import { applyTheme, setWrapping } from "../layout/appearance";
import { toggleFocus } from "../layout/focus-mode";
import { exportHtml, printDocument } from "../preview/export-print";
import { toggleShowHiddenSections } from "../documents/section-visibility";
import { editBookmarkAtCaret } from "../editor/bookmark-dialogs";
import { showBookmarksPanel } from "./bookmark-sidebar";
import { goToNeighbourBookmark, toggleBookmark } from "../editor/bookmarks";

type CommandItem = { labelPl: string; labelEn: string; shortcut?: string; run: () => void };
const commandItems: CommandItem[] = [
  { labelPl: "Plik: nowy dokument", labelEn: "File: new document", shortcut: "Ctrl+N", run: () => ($("menuNew") as HTMLButtonElement).click() },
  { labelPl: "Plik: otwórz dokument", labelEn: "File: open document", shortcut: "Ctrl+O", run: () => void openDocument() },
  { labelPl: "Plik: zapisz", labelEn: "File: save", shortcut: "Ctrl+S", run: () => void saveDocument() },
  { labelPl: "Plik: zapisz jako", labelEn: "File: save as", shortcut: "Ctrl+Shift+S", run: () => void saveDocumentAs() },
  { labelPl: "Eksportuj HTML", labelEn: "Export HTML", run: exportHtml },
  { labelPl: "Historia wersji", labelEn: "Version history", run: () => void showVersionHistory() },
  { labelPl: "Formatuj dokument (JSON, YAML, XML, tabele)", labelEn: "Format document (JSON, YAML, XML, tables)", shortcut: "Shift+Alt+F", run: () => formatActiveDocument() },
  { labelPl: "Importuj dokument Word/HTML jako Markdown…", labelEn: "Import Word/HTML document as Markdown…", run: () => void import("../documents/import-document").then(module => module.importDocument()) },
  { labelPl: "Historia Git: commity i gałęzie", labelEn: "Git history: commits and branches", run: () => void openGitHistory() },
  { labelPl: "Zakładki: dodaj lub usuń zakładkę", labelEn: "Bookmarks: toggle bookmark", shortcut: "Ctrl+F2", run: () => void toggleBookmark() },
  { labelPl: "Zakładki: nazwa i notatka", labelEn: "Bookmarks: name and note", run: () => editBookmarkAtCaret() },
  { labelPl: "Zakładki: następna zakładka", labelEn: "Bookmarks: next bookmark", shortcut: "F2", run: () => goToNeighbourBookmark(1) },
  { labelPl: "Zakładki: poprzednia zakładka", labelEn: "Bookmarks: previous bookmark", shortcut: "Shift+F2", run: () => goToNeighbourBookmark(-1) },
  { labelPl: "Zakładki: pokaż panel zakładek", labelEn: "Bookmarks: show the bookmarks panel", run: () => showBookmarksPanel() },
  { labelPl: "Pokaż / ukryj ukryte sekcje", labelEn: "Show / hide hidden sections", run: () => toggleShowHiddenSections() },
  { labelPl: "Drukuj / eksportuj PDF", labelEn: "Print / export PDF", run: () => void printDocument() },
  { labelPl: "Szukaj w dokumencie", labelEn: "Find in document", shortcut: "Ctrl+F", run: () => openSearchPanel(view) },
  { labelPl: "Cofnij", labelEn: "Undo", shortcut: "Ctrl+Z", run: () => undo(view) },
  { labelPl: "Ponów", labelEn: "Redo", shortcut: "Ctrl+Y", run: () => redo(view) },
  { labelPl: "Zaznacz wszystko", labelEn: "Select all", shortcut: "Ctrl+A", run: () => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); } },
  { labelPl: "Pogrubienie", labelEn: "Bold", shortcut: "Ctrl+B", run: () => wrapSelection("**", "**") },
  { labelPl: "Kursywa", labelEn: "Italic", shortcut: "Ctrl+I", run: () => wrapSelection("*", "*") },
  { labelPl: "Przekreślenie", labelEn: "Strikethrough", shortcut: "Ctrl+Shift+X", run: () => wrapSelection("~~", "~~") },
  { labelPl: "Paleta poleceń", labelEn: "Command palette", shortcut: "Ctrl+Shift+P", run: openCommandPalette },
  { labelPl: "Motyw: Midnight", labelEn: "Theme: Midnight", run: () => applyTheme("midnight") },
  { labelPl: "Motyw: Paper", labelEn: "Theme: Paper", run: () => applyTheme("light") },
  { labelPl: "Motyw: Terminal", labelEn: "Theme: Terminal", run: () => applyTheme("retro") },
  { labelPl: "Motyw: wysoki kontrast", labelEn: "Theme: high contrast", run: () => applyTheme("contrast") },
  { labelPl: "Przełącz zawijanie tekstu", labelEn: "Toggle word wrap", run: () => setWrapping(localStorage.getItem("typenova.wrap") !== "true") },
  { labelPl: "Przełącz tryb skupienia", labelEn: "Toggle focus mode", run: toggleFocus },
  { labelPl: "Pokaż / ukryj spis treści", labelEn: "Show / hide table of contents", run: () => ($("toggleOutline") as HTMLButtonElement).click() },
  { labelPl: "Pokaż / ukryj podgląd", labelEn: "Show / hide preview", run: () => ($("togglePreview") as HTMLButtonElement).click() },
  { labelPl: "Wstaw snippet", labelEn: "Insert snippet", run: () => ($("snippetDialog") as HTMLDialogElement).showModal() },
  { labelPl: "Pomoc i ściągawka", labelEn: "Help and shortcuts", shortcut: "F1", run: () => ($("helpDialog") as HTMLDialogElement).showModal() }
];
export function openCommandPalette() {
  const dialog = $("commandDialog") as HTMLDialogElement;
  if (!dialog.open) dialog.showModal();
  const query = $("commandQuery") as HTMLInputElement;
  query.value = "";
  renderCommandResults("");
  query.focus();
}
export function renderCommandResults(query: string) {
  const root = $("commandResults") as HTMLElement;
  root.replaceChildren();
  const en = document.documentElement.lang === "en";
  const normalized = query.trim().toLocaleLowerCase(en ? "en" : "pl");
  const items = commandItems.filter(item =>
    `${item.labelPl} ${item.labelEn} ${item.shortcut || ""}`.toLocaleLowerCase(en ? "en" : "pl").includes(normalized)
  );
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-result";
    const label = document.createElement("span");
    label.className = "command-result-label";
    label.textContent = en ? item.labelEn : item.labelPl;
    button.append(label);
    if (item.shortcut) {
      const shortcut = document.createElement("kbd");
      shortcut.textContent = item.shortcut;
      button.append(shortcut);
    }
    button.addEventListener("click", () => {
      ($("commandDialog") as HTMLDialogElement).close();
      item.run();
    });
    root.append(button);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "command-empty";
    empty.textContent = langText("Brak pasujących poleceń.", "No matching commands.");
    root.append(empty);
  }
}
