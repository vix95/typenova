/** Bindings for the preview toolbar, the view toggles and the formatting toolbar buttons. */
import { $ } from "./dom";
import { menuDetails } from "./global-bindings";
import { activeSidebarTab, setSidebarTab, showSidebar } from "./sidebar";
import { documentState } from "../documents/document-state";
import { documentMode } from "../documents/document-stats";
import { showVersionHistory } from "../documents/recovery";
import { insertAtCursor, prefixLine, wrapSelection } from "../editor/editing-commands";
import { view } from "../editor/editor-view";
import { snippets } from "../editor/snippets";
import { langText } from "../i18n/language";
import { applyWidths } from "../layout/layout";
import { outlineState } from "../outline/outline";
import { exportHtml, printDocument } from "../preview/export-print";
import { pagePreviewActive, refreshPagePreview } from "../preview/page-preview";
import { refreshTreePreview, treePreviewActive } from "../preview/tree-preview";
import { dataPreviewActive, refreshDataPreview } from "../data/data-preview";
import { schedulePreview, syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { previewState } from "../preview/preview-state";
import { showToast } from "../ui/toast";



export function initToolbarBindings(): void {
  $("hamburgerButton").addEventListener("click", () => {
    const topbar = $("topbar"); const openNow = !topbar.classList.contains("menu-open"); topbar.classList.toggle("menu-open", openNow);
    $("hamburgerButton").setAttribute("aria-expanded", String(openNow));
    if (!openNow) for (const menu of menuDetails) menu.open = false;
  });
  $("previewFullscreenButton").addEventListener("click", () => {
    const pane = $("previewPane") as HTMLElement;
    if (document.fullscreenElement === pane) { void document.exitFullscreen().catch(() => { }); }
    else if (pane.requestFullscreen) { void pane.requestFullscreen().catch(() => showToast(langText("Pełny ekran nie jest dostępny w tym środowisku.", "Fullscreen is unavailable in this environment."))); }
  });
  $("refreshPreviewButton").addEventListener("click", () => { if (pagePreviewActive()) refreshPagePreview(true); else if (treePreviewActive()) refreshTreePreview(true); else if (dataPreviewActive()) refreshDataPreview(true); else schedulePreview(); });
  $("previewMoreButton").addEventListener("click", () => { const m = $("previewQuickMenu") as HTMLElement; m.hidden = !m.hidden; });
  $("previewExportButton").addEventListener("click", () => { ($("previewQuickMenu") as HTMLElement).hidden = true; void exportHtml(); });
  $("previewPrintButton").addEventListener("click", () => { ($("previewQuickMenu") as HTMLElement).hidden = true; void printDocument(); });
  $("previewHistoryButton").addEventListener("click", () => { ($("previewQuickMenu") as HTMLElement).hidden = true; void showVersionHistory(); });
  $("togglePreview").addEventListener("click", () => {
    if (documentMode(documentState.currentPath || documentState.untitledLabel) === "plain") return;
    previewState.previewPreference = !previewState.previewPreference;
    localStorage.setItem("typenova.previewVisible", String(previewState.previewPreference));
    syncPreviewForActiveDocument();
    if (previewState.previewVisible) schedulePreview();
  });
  $("toggleOutline").addEventListener("click", () => {
    if (!outlineState.outlineVisible) { showSidebar(); setSidebarTab("outline"); return; }
    if (activeSidebarTab !== "outline") { setSidebarTab("outline"); return; }
    outlineState.outlineVisible = false; $("outlinePane").classList.add("hidden"); $("layout").classList.add("outline-hidden"); $("toggleOutline").classList.remove("selected"); applyWidths(); view.requestMeasure();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-wrap]").forEach(button => button.addEventListener("click", () => {
    const [before, after = ""] = button.dataset.wrap!.split("|"); wrapSelection(before, after);
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-prefix]").forEach(button => button.addEventListener("click", () => prefixLine(button.dataset.prefix!)));
  $("insertSnippet").addEventListener("click", () => ($("snippetDialog") as HTMLDialogElement).showModal());
  $("confirmSnippet").addEventListener("click", () => insertAtCursor("\n" + snippets[($("snippetSelect") as HTMLSelectElement).value] + "\n"));
  $("insertTable").addEventListener("click", () => insertAtCursor("\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n"));
  $("insertRule").addEventListener("click", () => insertAtCursor("\n---\n"));
}
