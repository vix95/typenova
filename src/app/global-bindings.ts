/** Application-wide listeners: menu popovers, global shortcuts, dialog dismissal and the native context-menu guard. */
import { openSearchPanel } from "@codemirror/search";
import { openCommandPalette, renderCommandResults } from "./command-palette";
import { $ } from "./dom";
import { activeSidebarTab } from "./sidebar";
import { documentState } from "../documents/document-state";
import { openDocument, saveDocument, saveDocumentAs } from "../documents/file-actions";
import { showVersionHistory } from "../documents/recovery";
import { view } from "../editor/editor-view";
import { setFocusMode, toggleFocus } from "../layout/focus-mode";
import { exportHtml, printDocument } from "../preview/export-print";
import { projectTreeState, setTreeClipboard } from "../project/project-tree-ops";
import { handleTreeContextAction } from "../project/tree-context-menu";

// Menus behave like desktop application menus: one open at a time, dismissed
// after an action, after changing a setting, or when clicking outside.
export const menuDetails = Array.from(document.querySelectorAll<HTMLDetailsElement>("details.menu"));
const toolbarOverflow = document.querySelector<HTMLDetailsElement>(".toolbar-overflow");

export function initGlobalBindings(): void {
  $("menuExportHtml").addEventListener("click", exportHtml);
  $("menuPrint").addEventListener("click", () => void printDocument());
  $("menuHistory").addEventListener("click", () => void showVersionHistory());
  $("historyClose").addEventListener("click", () => ($("historyDialog") as HTMLDialogElement).close());
  toolbarOverflow?.addEventListener("click", event => { if ((event.target as HTMLElement).closest("button")) toolbarOverflow.open = false; });
  for (const menu of menuDetails) {
    menu.addEventListener("toggle", () => { if (menu.open) for (const other of menuDetails) if (other !== menu) other.open = false; });
    menu.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".settings-pop") && target.closest("input,select,label")) return;
      if (target.closest("button, a")) window.setTimeout(() => { menu.open = false; $("topbar").classList.remove("menu-open"); $("hamburgerButton").setAttribute("aria-expanded", "false"); }, 0);
    });
    // Settings stay open while checkboxes and selects change: only clicks on buttons/links close the menu (handled above).
  }
  document.addEventListener("pointerdown", (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest("details.menu")) for (const menu of menuDetails) menu.open = false;
    if (!target.closest(".menubar") && !target.closest("#hamburgerButton")) { $("topbar").classList.remove("menu-open"); $("hamburgerButton").setAttribute("aria-expanded", "false"); }
    if (!target.closest(".preview-tools")) ($("previewQuickMenu") as HTMLElement).hidden = true;
    const previewMenu = document.getElementById("previewContextMenu"); if (previewMenu && !target.closest("#previewContextMenu")) previewMenu.hidden = true;
    if (!target.closest(".toolbar-overflow")) { const overflow = document.querySelector<HTMLDetailsElement>(".toolbar-overflow"); if (overflow) overflow.open = false; }
  });
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const projectShortcutModifier = event.ctrlKey || event.metaKey;
    const projectTarget = event.target instanceof Element ? event.target : null;
    const editingTarget = !!projectTarget?.closest("input,textarea,select,dialog[open],.command-center,#treeContextMenu");
    // Clicking anywhere in Project establishes the shortcut context even if WebView2
    // leaves CodeMirror as document.activeElement. A pointer press outside Project
    // clears this flag before another editor shortcut can be captured.
    if (activeSidebarTab === "files" && projectTreeState.keyboardActive && !editingTarget) {
      const key = event.key.toLowerCase(); const target = projectTreeState.lastTarget || (documentState.projectRoots.length === 1 && documentState.projectRoot ? { path: documentState.projectRoot, isDirectory: true, isRoot: true } : null);
      if (projectShortcutModifier && !event.altKey && target) {
        if ((key === "c" || key === "x") && !target.isRoot) { event.preventDefault(); event.stopImmediatePropagation(); setTreeClipboard(target.path, key === "c" ? "copy" : "cut", target.isDirectory); return; }
        if (key === "v" && projectTreeState.clipboard) { event.preventDefault(); event.stopImmediatePropagation(); projectTreeState.contextTarget = target; void handleTreeContextAction("paste"); return; }
      }
      if (event.key === "Delete" && !event.ctrlKey && !event.metaKey && !event.altKey && target && !target.isRoot) { event.preventDefault(); event.stopImmediatePropagation(); projectTreeState.contextTarget = target; void handleTreeContextAction("delete"); return; }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); event.stopPropagation(); openCommandPalette(); return; }
    if (event.key === "Escape") { for (const menu of menuDetails) menu.open = false; if (document.body.classList.contains("focus-mode")) { toggleFocus(); event.preventDefault(); } }
    if (event.key === "F1" && !((event.target as HTMLElement)?.closest("input, textarea"))) { event.preventDefault(); ($("helpDialog") as HTMLDialogElement).showModal(); return; }
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (mod && event.shiftKey && key === "p") { event.preventDefault(); event.stopPropagation(); openCommandPalette(); return; }
    if (mod && key === "s") { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) void saveDocumentAs(); else void saveDocument(); return; }
    if (mod && key === "o") { event.preventDefault(); event.stopPropagation(); void openDocument(); return; }
    if (mod && key === "n") { event.preventDefault(); event.stopPropagation(); ($("menuNew") as HTMLButtonElement).click(); return; }
    if (mod && key === "f") { event.preventDefault(); event.stopPropagation(); openSearchPanel(view); return; }
    if (mod && key === "p") { event.preventDefault(); event.stopPropagation(); void printDocument(); return; }
  }, true);
  $("menuSettingsOpen").addEventListener("click", () => ($("settingsDialog") as HTMLDialogElement).showModal());
  $("settingsClose").addEventListener("click", () => ($("settingsDialog") as HTMLDialogElement).close());
  $("settingsDismiss").addEventListener("click", () => ($("settingsDialog") as HTMLDialogElement).close());
  $("commandOpenToolbar").addEventListener("click", openCommandPalette);
  $("commandButton").addEventListener("click", openCommandPalette);
  $("focusButton").addEventListener("click", toggleFocus);
  $("commandClose").addEventListener("click", () => ($("commandDialog") as HTMLDialogElement).close());
  $("commandQuery").addEventListener("input", (e: Event) => renderCommandResults((e.target as HTMLInputElement).value));
  document.body.setAttribute("spellcheck", "false");
  view.contentDOM.setAttribute("spellcheck", "false");
  document.querySelectorAll<HTMLInputElement>("input,textarea").forEach(element => { element.setAttribute("spellcheck", "false"); element.setAttribute("autocorrect", "off"); });
  localStorage.setItem("typenova.spellcheck", "false");
  $<HTMLInputElement>("focusToggle").checked = localStorage.getItem("typenova.focus") === "true";
  setFocusMode($<HTMLInputElement>("focusToggle").checked);
  $("focusToggle").addEventListener("change", () => setFocusMode(($("focusToggle") as HTMLInputElement).checked));
}

export function initDismissBindings(): void {
  // Close transient menus and dialogs when the user clicks outside their surface.
  document.addEventListener("click", (event) => { const target = event.target as HTMLElement; if (target.closest("#topbar .menubar .menu-direct")) { $("topbar").classList.remove("menu-open"); $("hamburgerButton").setAttribute("aria-expanded", "false"); } document.querySelectorAll("details.menu[open]").forEach((menu) => { if (!menu.contains(target)) menu.removeAttribute("open"); }); });
  document.querySelectorAll("dialog").forEach((dialog) => { dialog.addEventListener("click", (event) => { if (event.target === dialog) (dialog as HTMLDialogElement).close(); }); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.body.classList.contains("focus-mode")) { setFocusMode(false); } });
  // Fallback tooltips for controls that do not declare a dedicated description.
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => { if (!button.title) { const label = (button.getAttribute("aria-label") || button.textContent || "").trim().replace(/\s+/g, " "); if (label) button.title = label; } });
}

export function initNativeContextMenuGuard(): void {
  // Disable the WebView's native browser context menu everywhere except the CodeMirror editor.
  // CodeMirror owns the one intentional context menu in TypeNova (formatting/editing actions).
  document.addEventListener("contextmenu", (event: MouseEvent) => {
    const target = event.target;
    const isEditorSurface = target instanceof Element && target.closest(".cm-editor") !== null;
    const isProjectTree = target instanceof Element && (target.closest("#projectFiles .tree-entry") !== null || target.closest(".project-tree-head") !== null || target.closest("#projectFiles") !== null);
    const isPreviewSurface = target instanceof Element && target.closest("#preview") !== null;
    const isEditorTabStrip = target instanceof Element && target.closest("#editorTabList") !== null;
    if (isEditorSurface || isProjectTree || isPreviewSurface || isEditorTabStrip) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
