/** Language switching: DOM text translation, menu shortcut hints and the `langText` helper. */
import { renderCommandResults } from "../app/command-palette";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { documentMode, lastWordCount } from "../documents/document-stats";
import { renderRecentFiles } from "../documents/file-actions";
import { view } from "../editor/editor-view";
import { minimapWrap } from "../editor/minimap";
import { renderGraphFilterTree, syncGraphFilesButton } from "../graph-ui/filter-panel";
import { syncGraph3dButton, syncGraphLabelsButton, syncGraphMotionButton, syncGraphResetLayoutButton } from "../graph-ui/graph-controls";
import { syncGraphSearchClear } from "../graph-ui/graph-interactions";
import { graphUi } from "../graph-ui/graph-state";
import { syncGraphPreviewResizer } from "../graph-ui/preview-resizer";
import { renderGraphTree } from "../graph-ui/tree-renderer";
import { syncGraphVisualModeUI } from "../graph-ui/visual-mode";
import { translations } from "./translations";
import { scheduleToolbarLayout } from "../layout/toolbar-layout";
import { updateHeadingBreadcrumbs } from "../outline/breadcrumbs";
import { relabelUnavailableImages } from "../preview/code-blocks";
import { schedulePreview, syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { previewState } from "../preview/preview-state";
import { syncAllCustomSelectControls } from "../ui/custom-select";

// Language selection: translate from stable Polish source labels on every change.
const languageSelect = $("languageSelect") as HTMLSelectElement;
const baseTextNodes = new WeakMap<Text, string>();
const translatableTextNodes: Text[] = [];
// Show shortcut badges only where the corresponding keyboard action is implemented.
const menuShortcutHints: Record<string, string> = { menuNew: "Ctrl+N", menuOpen: "Ctrl+O", menuSave: "Ctrl+S", menuSaveAs: "Ctrl+Shift+S", menuPrint: "Ctrl+P", menuUndo: "Ctrl+Z", menuRedo: "Ctrl+Y", menuFind: "Ctrl+F", menuSelectAll: "Ctrl+A", menuBold: "Ctrl+B", menuItalic: "Ctrl+I", menuStrike: "Ctrl+Shift+X" };
function renderMenuShortcutHints() { for (const [id, shortcut] of Object.entries(menuShortcutHints)) { const button = document.getElementById(id); if (!(button instanceof HTMLButtonElement)) continue; let badge = button.querySelector("kbd"); if (!badge) { badge = document.createElement("kbd"); badge.className = "menu-shortcut-badge"; button.append(badge); } badge.textContent = shortcut; } }
function effectiveLanguage(choice: string) { return choice === "auto" ? ((navigator.language || "en").toLowerCase().startsWith("pl") ? "pl" : "en") : choice; }
function applyLanguage(choice: string) {
  const lang = effectiveLanguage(choice); document.documentElement.lang = lang; document.documentElement.dataset.language = lang; localStorage.setItem("typenova.language", choice);
  // Explicitly localized labels use data-pl/data-en; this avoids destructive textContent rewrites.
  document.querySelectorAll<HTMLElement>("[data-pl][data-en]").forEach(el => { el.textContent = el.dataset[lang] || el.dataset.pl || ""; });
  const ids: Record<string, [string, string]> = { outlineTitle: ["Spis treści", "Table of contents"], focusButton: ["Skupienie", "Focus"], findButton: ["Szukaj", "Find"], collapseAll: ["Zwiń wszystko", "Collapse all"], expandAll: ["Rozwiń wszystko", "Expand all"], menuNew: ["Nowy dokument", "New document"], menuOpen: ["Otwórz…", "Open…"], menuSave: ["Zapisz", "Save"], menuSaveAs: ["Zapisz jako…", "Save as…"], menuExportHtml: ["Eksportuj HTML…", "Export HTML…"], menuPrint: ["Drukuj / PDF…", "Print / PDF…"], menuHistory: ["Historia wersji…", "Version history…"], insertImageSnippet: ["Obraz (snippet)", "Image snippet"], insertSnippet: ["Snippet", "Snippet"], insertMermaid: ["Mermaid", "Mermaid"], helpOpen: ["Pomoc", "Help"], cheatsheetOpen: ["LaTeX, Snippet i Mermaid", "LaTeX, snippets and Mermaid"], shortcutsOpen: ["Skróty klawiszowe", "Keyboard shortcuts"], aboutOpen: ["O programie", "About"], resetLayout: ["Przywróć szerokości paneli", "Reset panel widths"] };
  for (const [id, pair] of Object.entries(ids)) { const el = $(id); if (el) { el.textContent = pair[lang === "en" ? 1 : 0]; } }
  // Re-attach hints after translated labels update textContent on some menu items.
  renderMenuShortcutHints();
  const openProjectButton = $("openProject"); if (openProjectButton) { const projectLabel = lang === "en" ? "Open folder (replaces the current tree)" : "Otwórz folder (zastąpi obecne drzewo)"; openProjectButton.title = projectLabel; openProjectButton.setAttribute("aria-label", projectLabel); }
  const addProjectButton = $("addProjectFolder"); if (addProjectButton) { const addLabel = lang === "en" ? "Add folder to the tree" : "Dodaj folder do drzewa"; addProjectButton.title = addLabel; addProjectButton.setAttribute("aria-label", addLabel); }
  const insertImageButton = $("insertImage"); if (insertImageButton) { insertImageButton.title = lang === "en" ? "Insert image" : "Wstaw grafikę"; insertImageButton.setAttribute("aria-label", insertImageButton.title); }

  const en = lang === "en";
  const graphFilter = $("brainFilter") as HTMLInputElement | null;
  if (graphFilter) { graphFilter.placeholder = en ? (graphFilter.dataset.placeholderEn || "Filter sections and files…") : (graphFilter.dataset.placeholderPl || "Filtruj sekcje i pliki…"); graphFilter.setAttribute("aria-label", graphFilter.placeholder); graphFilter.dataset.tooltip = en ? "Filter graph sections and files" : "Filtruj sekcje i pliki w grafie"; graphFilter.removeAttribute("title"); graphFilter.autocomplete = "off"; graphFilter.setAttribute("name", "typenova-graph-query-ignore-autofill"); graphFilter.setAttribute("data-form-type", "other"); graphFilter.setAttribute("data-lpignore", "true"); graphFilter.setAttribute("data-1p-ignore", "true"); graphFilter.setAttribute("data-bwignore", "true"); }
  const graphClear = $("brainFilterClear") as HTMLButtonElement | null; if (graphClear) { const label = en ? "Clear graph search" : "Wyczyść wyszukiwanie grafu"; graphClear.dataset.tooltip = label; graphClear.setAttribute("aria-label", label); graphClear.removeAttribute("title"); }
  const graphSearchForm = $("brainSearchForm") as HTMLFormElement | null; if (graphSearchForm) { graphSearchForm.setAttribute("aria-label", en ? "Search graph" : "Wyszukaj w grafie"); graphSearchForm.setAttribute("autocomplete", "off"); }
  const graphExit = $("brainExit") as HTMLButtonElement | null;
  if (graphExit) { const label = en ? "Back to editor" : "Wróć do edytora"; graphExit.dataset.tooltip = label; graphExit.removeAttribute("title"); graphExit.setAttribute("aria-label", label); }
  const graphScope = $("brainScopeButton") as HTMLButtonElement | null;
  if (graphScope) { const label = en ? "Change folder" : "Zmień folder"; graphScope.dataset.tooltip = label; graphScope.removeAttribute("title"); graphScope.setAttribute("aria-label", label); }
  const graphFilterButton = $("brainFilesButton") as HTMLButtonElement | null;
  if (graphFilterButton) { graphFilterButton.dataset.tooltip = en ? "Open graph document and folder filters" : "Otwórz filtry dokumentów i katalogów grafu"; graphFilterButton.removeAttribute("title"); }
  const filterPanelElement = $("brainFilterPanel");
  if (filterPanelElement) filterPanelElement.setAttribute("aria-label", en ? "Graph document and folder filters" : "Filtry dokumentów i katalogów grafu");
  const graphFilterTree = $("brainFilesList");
  if (graphFilterTree) graphFilterTree.setAttribute("aria-label", en ? "Graph documents and folders" : "Dokumenty i katalogi grafu");
  const filterTreeSearch = $("brainFilesSearch") as HTMLInputElement | null;
  if (filterTreeSearch) { filterTreeSearch.placeholder = en ? (filterTreeSearch.dataset.placeholderEn || "Find a document or folder…") : (filterTreeSearch.dataset.placeholderPl || "Szukaj dokumentu lub katalogu…"); filterTreeSearch.setAttribute("aria-label", filterTreeSearch.placeholder); filterTreeSearch.dataset.tooltip = en ? "Search graph documents and folders" : "Szukaj dokumentów i katalogów grafu"; }
  const filterTreeSearchClear = $("brainFilesSearchClear") as HTMLButtonElement | null;
  if (filterTreeSearchClear) { const label = en ? "Clear document and folder search" : "Wyczyść wyszukiwanie dokumentów i katalogów"; filterTreeSearchClear.setAttribute("aria-label", label); filterTreeSearchClear.dataset.tooltip = label; }
  const closeGraphFilters = $("brainCloseFiltersButton") as HTMLButtonElement | null;
  if (closeGraphFilters) { const label = en ? "Close graph filters" : "Zamknij filtry grafu"; closeGraphFilters.dataset.tooltip = label; closeGraphFilters.setAttribute("aria-label", label); closeGraphFilters.removeAttribute("title"); }
  const closeRelatedSections = $("brainCloseRelatedButton") as HTMLButtonElement | null;
  if (closeRelatedSections) { const label = en ? "Close related sections" : "Zamknij powiązane sekcje"; closeRelatedSections.dataset.tooltip = label; closeRelatedSections.setAttribute("aria-label", label); closeRelatedSections.removeAttribute("title"); }
  syncGraphResetLayoutButton();
  if (graphUi.graphAvailableFiles.length) renderGraphFilterTree(); else syncGraphFilesButton();
  const langOptions = Array.from(languageSelect.options);[en ? "System default" : "System", en ? "Polish" : "Polski", "English"].forEach((v, i) => { if (langOptions[i]) langOptions[i].textContent = v; });
  const themeOptions = Array.from(($("themeSelect") as HTMLSelectElement).options); const themeNames = en ? ["Midnight — dark", "Paper — light", "Newsprint — newspaper", "Terminal — retro", "Contrast — high contrast"] : ["Midnight — ciemny", "Paper — jasny", "Newsprint — gazeta", "Terminal — retro", "Contrast — wysoki kontrast"]; themeOptions.forEach((o, i) => o.textContent = themeNames[i] || o.textContent);
  const commandLabel = $("commandButton").querySelector(".command-label"); if (commandLabel) commandLabel.textContent = en ? "Search commands…" : "Szukaj polecenia…";
  const query = $("commandQuery") as HTMLInputElement; if (query) { query.placeholder = en ? "Type a command…" : "Wpisz polecenie…"; query.setAttribute("aria-label", query.placeholder); }
  const commandTitle = ($("commandDialog") as HTMLDialogElement).querySelector<HTMLElement>(".dialog-title");
  if (commandTitle) commandTitle.textContent = en ? "Command palette" : "Paleta poleceń";
  const commandDialog = $("commandDialog") as HTMLDialogElement;
  if (commandDialog.open) renderCommandResults(query?.value || "");
  const focusHint = document.getElementById("focusHint") as HTMLButtonElement | null;
  if (focusHint) {
    focusHint.textContent = en ? "Focus mode · press Esc to exit" : "Tryb skupienia · Esc, aby wyjść";
    focusHint.title = en ? "Exit focus mode (Esc)" : "Wyjdź z trybu skupienia (Esc)";
  }
  renderRecentFiles();
  const settingsDismiss = $("settingsDismiss") as HTMLButtonElement | null; if (settingsDismiss) { const label = en ? "Close settings" : "Zamknij ustawienia"; settingsDismiss.setAttribute("aria-label", label); settingsDismiss.title = label; }
  const focusToggle = $("focusToggle") as HTMLInputElement | null; if (focusToggle) focusToggle.setAttribute("aria-label", en ? "Focus mode" : "Tryb skupienia");
  if (minimapWrap) minimapWrap.setAttribute("aria-label", en ? "Document minimap. Click or drag to navigate." : "Minimapa dokumentu. Kliknij lub przeciągnij, aby przewijać.");
  // Translate original static text nodes without destroying nested markup or keyboard hints.
  const englishToPolish = new Map<string, string>(Object.entries(translations).map(([polish, englishText]) => [englishText.trim(), polish.trim()]));
  for (const text of translatableTextNodes) {
    if (!text.isConnected) continue;
    const original = baseTextNodes.get(text) ?? text.data;
    const trimmed = original.trim();
    if (!trimmed) continue;
    const localized = en ? (translations[trimmed]?.trim() || trimmed) : (englishToPolish.get(trimmed) || trimmed);
    text.data = original.replace(trimmed, localized);
  }
  document.querySelectorAll<HTMLElement>("[title],[data-tooltip],[aria-label]").forEach(el => {
    for (const attr of ["data-tooltip", "title", "aria-label"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const trimmed = value.trim();
      const translated = en ? translations[trimmed] : englishToPolish.get(trimmed);
      if (translated) el.setAttribute(attr, value.replace(trimmed, translated.trim()));
    }
  });
  // Context-menu labels and heading levels are explicit, so all six headings are available in both languages.
  document.querySelectorAll<HTMLButtonElement>("#editorContextMenu button[data-context]").forEach(button => { const key = button.dataset.context || ""; const labels: Record<string, [string, string]> = { bold: ["Pogrubienie", "Bold"], italic: ["Kursywa", "Italic"], strike: ["Przekreślenie", "Strikethrough"], h1: ["Nagłówek H1", "Heading H1"], h2: ["Nagłówek H2", "Heading H2"], h3: ["Nagłówek H3", "Heading H3"], h4: ["Nagłówek H4", "Heading H4"], h5: ["Nagłówek H5", "Heading H5"], h6: ["Nagłówek H6", "Heading H6"], code: ["Kod inline", "Inline code"], fence: ["Blok kodu", "Code block"], link: ["Wstaw link", "Insert link"], quote: ["Cytat", "Quote"], list: ["Lista", "List"], copy: ["Kopiuj", "Copy"], cut: ["Wytnij", "Cut"], paste: ["Wklej", "Paste"], selectAll: ["Zaznacz wszystko", "Select all"] }; const shortcuts: Record<string, string> = { bold: "Ctrl+B", italic: "Ctrl+I", strike: "Ctrl+Shift+X", copy: "Ctrl+C", cut: "Ctrl+X", paste: "Ctrl+V", selectAll: "Ctrl+A" }; const label = labels[key]; if (label) { const existingKbd = button.querySelector("kbd"); button.textContent = label[en ? 1 : 0]; const shortcut = shortcuts[key]; if (shortcut) { const badge = existingKbd || document.createElement("kbd"); badge.textContent = shortcut; button.append(badge); } } });
  // Translate editor/document status and toolbar titles as well.
  const wordCount = $("wordCount"); if (wordCount) wordCount.textContent = en ? `${lastWordCount.toLocaleString("en-US")} words` : `${lastWordCount.toLocaleString("pl-PL")} słów`;
  const characterCount = $("characterCount"); if (characterCount) characterCount.textContent = en ? `${view.state.doc.length.toLocaleString("en-US")} characters` : `${view.state.doc.length.toLocaleString("pl-PL")} znaków`;
  const name = $("documentName") as HTMLElement | null; if (name && !documentState.currentPath) { name.textContent = documentState.untitledLabel; name.classList.toggle("dirty", documentState.dirty); }
  scheduleToolbarLayout();
  syncPreviewForActiveDocument();
  updateHeadingBreadcrumbs();
  syncAllCustomSelectControls();
  syncGraphMotionButton(); syncGraphLabelsButton(); syncGraph3dButton(); syncGraphFilesButton(); syncGraphPreviewResizer(); syncGraphVisualModeUI(); syncGraphSearchClear();
  relabelUnavailableImages();
  if (documentMode() === "notebook" && previewState.previewVisible) schedulePreview();
}
export function langText(plText: string, enText: string) { return document.documentElement.lang === "en" ? enText : plText; }

export function initTranslatableText(): void {
  { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node: Node | null; while ((node = walker.nextNode())) { const text = node as Text; baseTextNodes.set(text, text.data); translatableTextNodes.push(text); } }
  renderMenuShortcutHints();
}

export function initLanguage(): void {
  languageSelect.value = localStorage.getItem("typenova.language") || "en";
  applyLanguage(languageSelect.value);
  languageSelect.addEventListener("change", () => { applyLanguage(languageSelect.value); if (graphUi.graphVisualMode === "tree" && document.body.classList.contains("graph-mode")) renderGraphTree(); });
}
