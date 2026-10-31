/** Editor tabs: rendering, switching, creating, closing and the tab context menu. */
import { isDetachedWindow, type DetachedDocument } from "../app/detached-window";
import { moveItem } from "./tab-order";
import { deduplicateSessionPaths, sameSessionPath, serializeOpenSession } from "./session";
import { rememberViewPosition, restoreViewPosition, viewPositionsForSession } from "./view-position";
import { basename, isMarkdownPath } from "../filesystem/path-utils";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { editorThemeFor, syntaxThemeFor } from "../editor/themes";
import { lineNumbers, EditorView } from "@codemirror/view";
import { $ } from "../app/dom";
import { previousSidebarTab, setSidebarTab } from "../app/sidebar";
import { iconForPath, updateDirtyUi } from "./dirty-state";
import { OPEN_SESSION_STORAGE_KEY, documentState, type DocumentTab } from "./document-state";
import { updateQuickStats, updateStats } from "./document-stats";
import { editorThemeCompartment, languageCompartment, lineNumbersCompartment, performanceCompartment, syntaxThemeCompartment, wrapping } from "../editor/compartments";
import { LARGE_SOURCE_THRESHOLD, editorExtensions, markdownSupportForSize, performanceExtensions } from "../editor/editor-extensions";
import { view } from "../editor/editor-view";
import { scheduleMinimapDraw, updateMinimapLayout } from "../editor/minimap";
import { graphPreviewOwnsPreview } from "../graph-ui/preview-host";
import { langText } from "../i18n/language";
import { lineNumbersEnabled } from "../layout/appearance";
import { updateHeadingBreadcrumbs } from "../outline/breadcrumbs";
import { outlineState } from "../outline/outline";
import { clearPreviewCache, schedulePreview, syncPreviewForActiveDocument } from "../preview/preview-scheduler";
import { appConfirm } from "../ui/dialogs";

let languageLoadSequence = 0;
export function activeTab(): DocumentTab | undefined { return documentState.tabs.find(tab => tab.id === documentState.activeTabId); }
export function persistOpenSession(): void {
  // A torn-off document window must not overwrite the session saved by the main window.
  if (isDetachedWindow || !documentState.startupSessionReady) return;
  try {
    const paths = deduplicateSessionPaths(documentState.tabs.flatMap(tab => tab.path ? [tab.path] : []));
    const selectedPath = activeTab()?.path || null;
    localStorage.setItem(OPEN_SESSION_STORAGE_KEY, serializeOpenSession(paths, selectedPath, viewPositionsForSession()));
  } catch (error) {
    console.warn("Could not persist the open-document session", error);
  }
}
function updateEditorTabScrollButtons() {
  const root = $("editorTabList") as HTMLElement | null;
  const left = $("editorTabsScrollLeft") as HTMLButtonElement | null;
  const right = $("editorTabsScrollRight") as HTMLButtonElement | null;
  if (!root || !left || !right) return;
  const hasOverflow = root.scrollWidth > root.clientWidth + 2;
  left.disabled = !hasOverflow || root.scrollLeft <= 2;
  right.disabled = !hasOverflow || root.scrollLeft + root.clientWidth >= root.scrollWidth - 2;
  left.setAttribute("aria-disabled", String(left.disabled));
  right.setAttribute("aria-disabled", String(right.disabled));
}
function revealActiveEditorTab() {
  const root = $("editorTabList") as HTMLElement | null;
  if (!root) return;
  const active = Array.from(root.querySelectorAll<HTMLElement>("[data-tab-id]")).find(el => el.dataset.tabId === documentState.activeTabId);
  if (active) {
    const rootRect = root.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    if (tabRect.left < rootRect.left) root.scrollLeft -= rootRect.left - tabRect.left + 8;
    else if (tabRect.right > rootRect.right) root.scrollLeft += tabRect.right - rootRect.right + 8;
  }
  updateEditorTabScrollButtons();
}
export function renderTabs() {
  const root = $("editorTabList") as HTMLElement;
  if (!root) return;
  const fragment = document.createDocumentFragment();
  for (const tab of documentState.tabs) {
    const wrapper = document.createElement("div");
    wrapper.className = `editor-tab${tab.id === documentState.activeTabId ? " active" : ""}${tab.dirty ? " dirty" : ""}`;
    wrapper.setAttribute("role", "presentation");
    wrapper.dataset.tabId = tab.id;
    const activate = document.createElement("button");
    activate.type = "button";
    activate.className = "editor-tab-main";
    activate.setAttribute("role", "tab");
    activate.setAttribute("aria-selected", String(tab.id === documentState.activeTabId));
    activate.dataset.tabId = tab.id;
    activate.title = tab.path || tab.label;
    const mark = document.createElement("span");
    mark.className = "tab-mark";
    mark.textContent = iconForPath(tab.path || tab.label);
    const label = document.createElement("span");
    label.className = "editor-tab-label";
    label.textContent = tab.label;
    const dirtyMark = document.createElement("span");
    dirtyMark.className = "tab-dirty-mark";
    dirtyMark.hidden = !tab.dirty;
    dirtyMark.setAttribute("aria-hidden", "true");
    activate.setAttribute("aria-label", `${tab.label}${tab.dirty ? ` — ${langText("niezapisane zmiany", "unsaved changes")}` : ""}`);
    activate.append(mark, label, dirtyMark);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close-button";
    close.dataset.closeTab = tab.id;
    close.title = langText("Zamknij kartę", "Close tab");
    close.setAttribute("aria-label", `${langText("Zamknij kartę", "Close tab")}: ${tab.label}`);
    close.innerHTML = '<svg class="tab-close-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" /></svg>';
    wrapper.append(activate, close);
    fragment.append(wrapper);
  }
  root.replaceChildren(fragment);
  persistOpenSession();
  requestAnimationFrame(revealActiveEditorTab);
}
const editorTabList = $("editorTabList") as HTMLElement;
// Right-click tab operations mirror the conventions used by desktop code editors.
let editorTabContextTargetId = "";
const editorTabContextMenu = $("editorTabContextMenu") as HTMLElement;
function hideEditorTabContextMenu() { editorTabContextMenu.hidden = true; editorTabContextTargetId = ""; }
function showEditorTabContextMenu(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".editor-tab[data-tab-id]") : null;
  if (!target?.dataset.tabId) return;
  event.preventDefault(); event.stopPropagation();
  editorTabContextTargetId = target.dataset.tabId;
  editorTabContextMenu.hidden = false;
  editorTabContextMenu.style.visibility = "hidden";
  editorTabContextMenu.style.left = "0px"; editorTabContextMenu.style.top = "0px";
  const targetIsActive = editorTabContextTargetId === documentState.activeTabId;
  const closeOthers = editorTabContextMenu.querySelector<HTMLButtonElement>('[data-tab-action="close-others"]');
  if (closeOthers) closeOthers.disabled = documentState.tabs.length <= 1;
  const closeAll = editorTabContextMenu.querySelector<HTMLButtonElement>('[data-tab-action="close-all"]');
  if (closeAll) closeAll.disabled = documentState.tabs.length === 0;
  editorTabContextMenu.dataset.contextActive = String(targetIsActive);
  requestAnimationFrame(() => {
    if (editorTabContextMenu.hidden) return;
    const w = editorTabContextMenu.offsetWidth, h = editorTabContextMenu.offsetHeight;
    editorTabContextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - w - 8))}px`;
    editorTabContextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - h - 8))}px`;
    editorTabContextMenu.style.visibility = "visible";
  });
}
async function closeTabsInBatch(ids: string[], desiredActiveId: string | null = null) {
  const closeIds = new Set(ids.filter(id => documentState.tabs.some(tab => tab.id === id)));
  if (!closeIds.size) return;
  const current = activeTab();
  if (current) rememberViewPosition(current);
  if (current) { current.state = view.state; current.path = documentState.currentPath; current.savedText = documentState.savedText; current.dirty = documentState.dirty; current.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; }
  const dirtyCount = documentState.tabs.filter(tab => closeIds.has(tab.id) && tab.dirty).length;
  if (dirtyCount > 0) {
    const message = dirtyCount === 1
      ? langText("Odrzucić niezapisane zmiany w jednej karcie?", "Discard unsaved changes in one tab?")
      : langText(`Odrzucić niezapisane zmiany w ${dirtyCount} kartach?`, `Discard unsaved changes in ${dirtyCount} tabs?`);
    if (!await appConfirm(message, { confirmLabel: langText("Odrzuć", "Discard"), primaryAction: "cancel" })) return;
  }
  const oldIndex = Math.max(0, documentState.tabs.findIndex(tab => tab.id === documentState.activeTabId));
  const removedActive = closeIds.has(documentState.activeTabId);
  documentState.tabs = documentState.tabs.filter(tab => !closeIds.has(tab.id));
  if (!documentState.tabs.length) {
    documentState.activeTabId = "";
    createNewTab("", "Untitled.md");
    return;
  }
  const nextId = desiredActiveId && documentState.tabs.some(tab => tab.id === desiredActiveId)
    ? desiredActiveId
    : removedActive ? documentState.tabs[Math.min(oldIndex, documentState.tabs.length - 1)].id : documentState.activeTabId;
  if (nextId && nextId !== documentState.activeTabId) switchToTab(nextId);
  else renderTabs();
}
export function switchToTab(id: string) {
  if (graphPreviewOwnsPreview && document.body.classList.contains("graph-mode")) setSidebarTab(previousSidebarTab);
  const target = documentState.tabs.find(tab => tab.id === id);
  if (!target || target.id === documentState.activeTabId) return;
  const current = activeTab();
  if (current) { current.state = view.state; current.path = documentState.currentPath; current.savedText = documentState.savedText; current.dirty = documentState.dirty; current.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; }
  documentState.activeTabId = target.id;
  outlineState.outlineTabId = ""; outlineState.lastHeadingBreadcrumbSignature = "";
  documentState.currentPath = target.path;
  documentState.untitledLabel = target.label;
  documentState.savedText = target.savedText;
  documentState.dirty = target.dirty;
  updateHeadingBreadcrumbs();
  view.setState(target.state);
  restoreViewPosition(target.viewPosition);
  scheduleMinimapDraw();
  updateMinimapLayout();
  documentState.performanceMode = view.state.doc.length >= 1_000_000;
  view.dispatch({ effects: [performanceCompartment.reconfigure(performanceExtensions(view.state.doc.length))] });
  clearPreviewCache();
  updateDirtyUi();
  updateStats();
  updateQuickStats();
  renderTabs();
  void configureLanguageForTab(target);
  syncPreviewForActiveDocument();
  documentState.docRevision++;
  schedulePreview();
  requestAnimationFrame(() => view.requestMeasure());
}
export async function configureLanguageForTab(tab: DocumentTab) {
  const requestId = ++languageLoadSequence;
  const ext = (tab.path || tab.label).split(".").pop()?.toLowerCase() || "md";
  const size = tab.state.doc.length;
  try {
    const languageExt = ext === "ipynb" ? "json" : ext;
    if (isMarkdownPath(tab.path || tab.label)) {
      const extension = markdownSupportForSize(size);
      if (tab.id === documentState.activeTabId && requestId === languageLoadSequence) view.dispatch({ effects: languageCompartment.reconfigure(extension) });
      return;
    }
    if (["txt", "text", "log", "csv", "tsv", "env", "diff", "patch"].includes(ext) || size >= LARGE_SOURCE_THRESHOLD) {
      if (tab.id === documentState.activeTabId && requestId === languageLoadSequence) view.dispatch({ effects: languageCompartment.reconfigure([]) });
      return;
    }
    const description = languages.find((language: { extensions?: readonly string[] }) => language.extensions?.some((extension: string) => extension.toLowerCase() === languageExt));
    const support = description ? await description.load() : null;
    if (tab.id === documentState.activeTabId && requestId === languageLoadSequence) view.dispatch({ effects: languageCompartment.reconfigure(support || []) });
  } catch (error) {
    console.warn("Could not load syntax mode for", ext, error);
    if (tab.id === documentState.activeTabId && requestId === languageLoadSequence) view.dispatch({ effects: languageCompartment.reconfigure([]) });
  }
}
export function createEditorState(doc: string) {
  let state = EditorState.create({ doc, extensions: editorExtensions });
  state = state.update({
    effects: [
      editorThemeCompartment.reconfigure(editorThemeFor(localStorage.getItem("typenova.theme") || "midnight")),
      syntaxThemeCompartment.reconfigure(syntaxThemeFor(localStorage.getItem("typenova.theme") || "midnight")),
      performanceCompartment.reconfigure(performanceExtensions(doc.length)),
      lineNumbersCompartment.reconfigure(lineNumbersEnabled ? lineNumbers() : []),
      wrapping.reconfigure(localStorage.getItem("typenova.wrap") === "true" ? EditorView.lineWrapping : []),
      languageCompartment.reconfigure([])
    ]
  }).state;
  return state;
}
export function createNewTab(initialText = "", label = "Untitled.md") {
  if (graphPreviewOwnsPreview && document.body.classList.contains("graph-mode")) setSidebarTab(previousSidebarTab);
  const newState = createEditorState(initialText);
  const tab: DocumentTab = { id: `tab-${documentState.tabSequence++}`, path: null, label, state: newState, savedText: initialText, dirty: false };
  documentState.tabs.push(tab);
  const previous = activeTab();
  if (previous) rememberViewPosition(previous);
  if (previous) { previous.state = view.state; previous.path = documentState.currentPath; previous.savedText = documentState.savedText; previous.dirty = documentState.dirty; previous.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; }
  const previousId = documentState.activeTabId;
  documentState.activeTabId = tab.id;
  outlineState.outlineTabId = ""; outlineState.lastHeadingBreadcrumbSignature = "";
  documentState.currentPath = null;
  documentState.untitledLabel = label;
  documentState.savedText = initialText;
  documentState.dirty = false;
  updateHeadingBreadcrumbs();
  view.setState(newState);
  restoreViewPosition(null);
  scheduleMinimapDraw();
  updateMinimapLayout();
  documentState.performanceMode = newState.doc.length >= 1_000_000;
  view.dispatch({ effects: [performanceCompartment.reconfigure(performanceExtensions(newState.doc.length))] });
  clearPreviewCache();
  updateDirtyUi();
  updateStats();
  renderTabs();
  void configureLanguageForTab(tab);
  syncPreviewForActiveDocument();
  documentState.docRevision++;
  schedulePreview();
  view.focus();
  if (previousId) requestAnimationFrame(() => view.requestMeasure());
  return tab;
}
/** Opens a document that arrived from another window as a new tab here, keeping its unsaved edits and scroll position. */
export function adoptDocumentTab(doc: DetachedDocument, index?: number): void {
  const existing = doc.path ? documentState.tabs.find(tab => sameSessionPath(tab.path, doc.path)) : undefined;
  // The same file is already open here and the incoming copy has no unsaved edits: just show that tab.
  if (existing && !doc.dirty) { switchToTab(existing.id); return; }
  const tab = createNewTab(doc.text, doc.label);
  tab.path = doc.path; tab.savedText = doc.savedText; tab.dirty = doc.dirty; tab.viewPosition = doc.position;
  documentState.currentPath = doc.path; documentState.savedText = doc.savedText; documentState.dirty = doc.dirty;
  // Dropped on the strip: open at the drop position instead of at the end.
  if (index !== undefined) documentState.tabs = moveItem(documentState.tabs, item => item.id === tab.id, index);
  updateDirtyUi(); renderTabs(); updateStats();
  void configureLanguageForTab(tab);
  restoreViewPosition(doc.position);
}
/** Takes a tab out of the strip without asking, for a document that now lives elsewhere (another window). */
export function removeTabWithoutPrompt(id: string): void {
  const index = documentState.tabs.findIndex(item => item.id === id);
  if (index < 0) return;
  const wasActive = id === documentState.activeTabId;
  documentState.tabs = documentState.tabs.filter(item => item.id !== id);
  if (wasActive) {
    if (documentState.tabs.length) switchToTab(documentState.tabs[Math.min(index, documentState.tabs.length - 1)].id);
    else createNewTab("", "Untitled.md");
  } else renderTabs();
}
async function closeTab(id: string) {
  const tab = documentState.tabs.find(item => item.id === id);
  if (!tab) return;
  if (tab.id === documentState.activeTabId) { tab.state = view.state; tab.dirty = documentState.dirty; tab.savedText = documentState.savedText; }
  if (tab.dirty && !await appConfirm(langText(`Odrzucić niezapisane zmiany w „${tab.label}”?`, `Discard unsaved changes in “${tab.label}”?`), {
    confirmLabel: langText("Odrzuć", "Discard"),
    primaryAction: "cancel"
  })) return;
  const index = documentState.tabs.findIndex(item => item.id === id);
  documentState.tabs = documentState.tabs.filter(item => item.id !== id);
  if (tab.id === documentState.activeTabId) {
    if (documentState.tabs.length) switchToTab(documentState.tabs[Math.min(index, documentState.tabs.length - 1)].id);
    else createNewTab("", "Untitled.md");
  } else renderTabs();
}

export function initTabs(): void {
  editorTabList.addEventListener("scroll", updateEditorTabScrollButtons, { passive: true });
  window.addEventListener("resize", updateEditorTabScrollButtons);
  $("editorTabsScrollLeft").addEventListener("click", () => {
    editorTabList.scrollBy({ left: -Math.max(150, editorTabList.clientWidth * .7), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  $("editorTabsScrollRight").addEventListener("click", () => {
    editorTabList.scrollBy({ left: Math.max(150, editorTabList.clientWidth * .7), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  editorTabList.addEventListener("contextmenu", showEditorTabContextMenu);
  // The tab context menu closes like the other menus: on a press anywhere outside it, on Escape, and when the window
  // loses focus or changes size (pressing inside it is handled by its own click handler below).
  document.addEventListener("pointerdown", event => {
    if (!editorTabContextMenu.hidden && !(event.target instanceof Element && event.target.closest("#editorTabContextMenu"))) hideEditorTabContextMenu();
  }, true);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !editorTabContextMenu.hidden) { event.preventDefault(); hideEditorTabContextMenu(); } }, true);
  window.addEventListener("blur", hideEditorTabContextMenu);
  window.addEventListener("resize", hideEditorTabContextMenu);
  editorTabContextMenu.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab-action]");
    const targetId = editorTabContextTargetId;
    if (!button || !targetId) return;
    const action = button.dataset.tabAction || "";
    hideEditorTabContextMenu();
    if (action === "close") { void closeTab(targetId); return; }
    if (action === "close-all") { void closeTabsInBatch(documentState.tabs.map(tab => tab.id)); return; }
    if (action === "close-others") { void closeTabsInBatch(documentState.tabs.filter(tab => tab.id !== targetId).map(tab => tab.id), targetId); }
  });
  // Tabs keep independent EditorState instances, including selection and undo history.
  $("editorTabList").addEventListener("click", (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const close = target.closest<HTMLElement>("[data-close-tab]");
    if (close) { event.stopPropagation(); void closeTab(close.dataset.closeTab || ""); return; }
    const activate = target.closest<HTMLElement>("[data-tab-id]");
    if (activate?.dataset.tabId) switchToTab(activate.dataset.tabId);
  });
}
