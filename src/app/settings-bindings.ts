/** Settings dialog controls (theme, auto-save, wrapping, line numbers, minimap, fonts, welcome) and help dialogs. */
import { $ } from "./dom";
import { documentState } from "../documents/document-state";
import { autoSaveTimer, renderRecentFiles, scheduleAutoSave } from "../documents/file-actions";
import { insertAtCursor } from "../editor/editing-commands";
import { minimapState, scheduleMinimapDraw, updateMinimapLayout } from "../editor/minimap";
import { scrollSyncIdleTimer, scrollSyncState, syncPreviewToEditor } from "../editor/scroll-sync";
import { langText } from "../i18n/language";
import { applyFontSize, applyTheme, lineNumbersEnabled, setLineNumbers, setWrapping } from "../layout/appearance";
import { applyWidths, layoutState, preferences, saveWidths } from "../layout/layout";
import { applyOutlineCollapse, collapsedHeadings, outlineHeadings } from "../outline/outline";

const lineNumbersToggle = $("lineNumbersToggle") as HTMLInputElement;
const minimapToggle = $("minimapToggle") as HTMLInputElement;
const showWelcomeWhenNoSessionToggle = $("showWelcomeWhenNoSessionToggle") as HTMLInputElement;
const editorFontSizeSelect = $("editorFontSizeSelect") as HTMLSelectElement;
const previewFontSizeSelect = $("previewFontSizeSelect") as HTMLSelectElement;

export function initSettingsBindings(): void {
  $("themeSelect").addEventListener("change", (e: Event) => applyTheme((e.target as HTMLSelectElement).value));
  $<HTMLInputElement>("autoSaveToggle").checked = localStorage.getItem("typenova.autoSave") === "true";
  $("autoSaveToggle").addEventListener("change", (e: Event) => { const enabled = (e.target as HTMLInputElement).checked; localStorage.setItem("typenova.autoSave", String(enabled)); if (enabled) { scheduleAutoSave(); $("statusText").textContent = documentState.currentPath ? langText("Automatyczny zapis włączony", "Auto-save enabled") : langText("Zapisz dokument raz, aby aktywować automatyczny zapis", "Save the document once to enable auto-save"); } else { clearTimeout(autoSaveTimer); $("statusText").textContent = langText("Automatyczny zapis wyłączony", "Auto-save disabled"); } });
  renderRecentFiles();
  $<HTMLInputElement>("wrapToggle").checked = localStorage.getItem("typenova.wrap") === "true";
  $("wrapToggle").addEventListener("change", (e: Event) => setWrapping((e.target as HTMLInputElement).checked));
  lineNumbersToggle.checked = lineNumbersEnabled;
  lineNumbersToggle.addEventListener("change", (e: Event) => setLineNumbers((e.target as HTMLInputElement).checked));
  minimapToggle.checked = minimapState.minimapEnabled;
  minimapToggle.addEventListener("change", (e: Event) => {
    minimapState.minimapEnabled = (e.target as HTMLInputElement).checked;
    localStorage.setItem("typenova.minimap", String(minimapState.minimapEnabled));
    updateMinimapLayout();
    scheduleMinimapDraw();
  });
  showWelcomeWhenNoSessionToggle.checked = localStorage.getItem("typenova.showWelcomeWhenNoSession") === "true";
  showWelcomeWhenNoSessionToggle.addEventListener("change", (event: Event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    localStorage.setItem("typenova.showWelcomeWhenNoSession", String(enabled));
    $("statusText").textContent = enabled
      ? langText("Welcome.md pojawi się przy następnym uruchomieniu, jeśli nie będzie plików do przywrócenia.", "Welcome.md will appear on next launch if there are no files to restore.")
      : langText("Przy braku plików do przywrócenia otworzy się pusty Untitled.md.", "If there are no files to restore, a blank Untitled.md will open.");
  });
  applyFontSize("editor", localStorage.getItem("typenova.editorFontSize") || "small", false);
  applyFontSize("preview", localStorage.getItem("typenova.previewFontSize") || "small", false);
  editorFontSizeSelect.addEventListener("change", (event: Event) => applyFontSize("editor", (event.target as HTMLSelectElement).value));
  previewFontSizeSelect.addEventListener("change", (event: Event) => applyFontSize("preview", (event.target as HTMLSelectElement).value));
  $<HTMLInputElement>("syncToggle").checked = scrollSyncState.syncScroll;
  $("syncToggle").addEventListener("change", (e: Event) => { scrollSyncState.syncScroll = (e.target as HTMLInputElement).checked; localStorage.setItem("typenova.syncScroll", String(scrollSyncState.syncScroll)); if (!scrollSyncState.syncScroll) { window.clearTimeout(scrollSyncIdleTimer); scrollSyncState.scrollSyncOwner = null; scrollSyncState.expectedPreviewScrollTop = null; scrollSyncState.expectedEditorScrollTop = null; } else requestAnimationFrame(() => syncPreviewToEditor()); });
  $("collapseAll").addEventListener("click", () => { outlineHeadings.forEach((h, i) => { if (i + 1 < outlineHeadings.length && outlineHeadings[i + 1].level > h.level) collapsedHeadings.add(h.key); }); localStorage.setItem("typenova.collapsed", JSON.stringify([...collapsedHeadings])); applyOutlineCollapse(); });
  $("expandAll").addEventListener("click", () => { collapsedHeadings.clear(); localStorage.setItem("typenova.collapsed", "[]"); applyOutlineCollapse(); });
  $("resetLayout").addEventListener("click", () => { layoutState.savedWidthRatios = null; const w = ($("layout") as HTMLElement).getBoundingClientRect().width; const usable = Math.max(1, w - 10); Object.assign(preferences, { outline: Math.round(usable * .20), editor: Math.round(usable * .49), preview: Math.round(usable * .31) }); applyWidths(); saveWidths(); });
  $("helpOpen").addEventListener("click", () => ($("helpDialog") as HTMLDialogElement).showModal());
  $("helpClose").addEventListener("click", () => ($("helpDialog") as HTMLDialogElement).close());
  $("shortcutsOpen").addEventListener("click", () => ($("shortcutsDialog") as HTMLDialogElement).showModal());
  $("shortcutsClose").addEventListener("click", () => ($("shortcutsDialog") as HTMLDialogElement).close());
  $("aboutOpen").addEventListener("click", () => ($("aboutDialog") as HTMLDialogElement).showModal());
  $("aboutClose").addEventListener("click", () => ($("aboutDialog") as HTMLDialogElement).close());
  $("cheatsheetOpen").addEventListener("click", () => ($("cheatsheetDialog") as HTMLDialogElement).showModal());
  $("helpCheatsheet").addEventListener("click", () => { ($("helpDialog") as HTMLDialogElement).close(); ($("cheatsheetDialog") as HTMLDialogElement).showModal(); });
  $("cheatsheetClose").addEventListener("click", () => ($("cheatsheetDialog") as HTMLDialogElement).close());
  $("insertImageSnippet").addEventListener("click", () => insertAtCursor("![Alt text](./path/to/image.png)"));
}
