/** Application composition root: wires the feature modules together and runs the boot sequence. */
import "./style.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { initWorkspaceDom } from "./app/workspace-dom";
import { initEditorView, view } from "./editor/editor-view";
import { initTabInteractions } from "./documents/tab-interactions";
import { initTabDropTarget } from "./documents/tab-drop-target";
import { initTabs, renderTabs, configureLanguageForTab, persistOpenSession } from "./documents/tabs";
import { initPreviewObservers } from "./preview/preview-observers";
import { initPreviewContextMenu } from "./preview/preview-context-menu";
import { initMediaViewer } from "./preview/media-viewer";
import { initViewPositionPersistence, rememberViewPosition } from "./documents/view-position";
import { initOutline } from "./outline/outline";
import { initExportPrint } from "./preview/export-print";
import { initProjectBindings, initProjectRestore } from "./project/project-bindings";
import { initEditMenuBindings, initSaveFindBindings, initFileMenuBindings } from "./app/menu-bindings";
import { initProjectTreeFocus } from "./project/project-tree-focus";
import { initGraphState } from "./graph-ui/graph-state";
import { initFilterPanel } from "./graph-ui/filter-panel";
import { initGraphWorkspaceLayout } from "./graph-ui/workspace-layout";
import { initGraphControls } from "./graph-ui/graph-controls";
import { initPreviewResizer } from "./graph-ui/preview-resizer";
import { initGraphInteractions } from "./graph-ui/graph-interactions";
import { initSidebarBindings } from "./app/sidebar";
import { initToolbarBindings } from "./app/toolbar-bindings";
import { initToolbarLayout } from "./layout/toolbar-layout";
import { initSettingsBindings } from "./app/settings-bindings";
import { initImageInsert } from "./editor/image-insert";
import { initPaneResize } from "./layout/pane-resize";
import { initScrollSync } from "./editor/scroll-sync";
import { initGlobalBindings, initDismissBindings, initNativeContextMenuGuard } from "./app/global-bindings";
import { initExternalLinks } from "./app/external-links";
import { initTranslatableText, initLanguage, langText } from "./i18n/language";
import { initTooltips } from "./ui/tooltip";
import { initEditorContextMenu } from "./editor/context-menu";
import { initDialogLabels } from "./ui/dialogs";
import { initCustomSelects } from "./ui/custom-select";
import { initializeEditorMinimap } from "./editor/minimap";
import { setupImageHoverPreview } from "./editor/image-hover";
import { documentState } from "./documents/document-state";
import { updateHeadingBreadcrumbs } from "./outline/breadcrumbs";
import { updateStats } from "./documents/document-stats";
import { applyTheme } from "./layout/appearance";
import { applyWidths } from "./layout/layout";
import { syncPreviewForActiveDocument, markStartupReady } from "./preview/preview-scheduler";
import { $ } from "./app/dom";
import { restoreOpenSessionAtStartup, offerRecovery } from "./documents/recovery";

// Boot sequence. The order below is the original top-level execution order of the
// pre-0.5.113 monolithic main.ts; event-listener registration order is behaviour.

// DOM scaffolding
initWorkspaceDom();

// Editor
initEditorView();

// Initial document, tab and layout bootstrap
view.contentDOM.setAttribute("spellcheck", "false");
initializeEditorMinimap();
setupImageHoverPreview();
view.contentDOM.setAttribute("lang", "pl-PL");
document.documentElement.lang = "pl";
documentState.savedText = view.state.doc.toString();
documentState.tabs = [{ id: `tab-${documentState.tabSequence++}`, path: null, label: documentState.untitledLabel, state: view.state, savedText: documentState.savedText, dirty: false }];
documentState.activeTabId = documentState.tabs[0].id;
documentState.performanceMode = view.state.doc.length >= 1_000_000;
renderTabs();
updateHeadingBreadcrumbs();
void configureLanguageForTab(documentState.tabs[0]);
updateStats();
applyTheme(localStorage.getItem("typenova.theme") || "midnight");
applyWidths();
syncPreviewForActiveDocument();
// Keep the startup screen visible until the first preview frame or a guarded fallback.
// Fail open after 8 seconds so a stalled worker can never leave the whole app covered.
window.setTimeout(() => {
  if (document.body.classList.contains("booting")) {
    $("renderState").textContent = langText("Podgląd nadal się uruchamia…", "Preview is still starting…");
    markStartupReady();
  }
}, 8000);

// Document tabs
initTabs();
initTabInteractions();
initTabDropTarget();

// Preview
initPreviewObservers();
initPreviewContextMenu();
initMediaViewer();
initViewPositionPersistence();
initOutline();
initExportPrint();

// Project tree and menu bindings
initProjectBindings();
initEditMenuBindings();
initProjectRestore();
initSaveFindBindings();

// Project tree keyboard target
initProjectTreeFocus();

// Section graph
initGraphState();
initFilterPanel();
initGraphWorkspaceLayout();
initGraphControls();
initPreviewResizer();
initGraphInteractions();

// Sidebar, toolbar and settings
initSidebarBindings();
initToolbarBindings();
initToolbarLayout();
initFileMenuBindings();
initSettingsBindings();
initImageInsert();

// Panes and scrolling
initPaneResize();
initScrollSync();

// Global listeners
initGlobalBindings();

// Session restore and unload handling
void (async () => {
  await restoreOpenSessionAtStartup();
  await offerRecovery();
})();
window.addEventListener("beforeunload", event => {
  const active = documentState.tabs.find(tab => tab.id === documentState.activeTabId);
  if (active && documentState.startupSessionReady) rememberViewPosition(active);
  persistOpenSession();
  const autoSave = localStorage.getItem("typenova.autoSave") === "true" && !!documentState.currentPath;
  if (documentState.dirty && !autoSave) event.preventDefault();
});

// External links, language, tooltips, context menus and dialogs
initExternalLinks();
initDismissBindings();
initTranslatableText();
initLanguage();
initTooltips();
initNativeContextMenuGuard();
initEditorContextMenu();
initDialogLabels();

// Custom selects wrap the final DOM, so they run last
initCustomSelects();
