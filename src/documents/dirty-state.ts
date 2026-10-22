/** File-type icons and dirty/clean tracking with its UI feedback. */
import { basename } from "../filesystem/path-utils";
import { $ } from "../app/dom";
import { documentState } from "./document-state";
import { activeTab, renderTabs } from "./tabs";
import { view } from "../editor/editor-view";
import { updateHeadingBreadcrumbs } from "../outline/breadcrumbs";

export function iconForPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (["md", "markdown", "mdx", "mkd", "mdown"].includes(ext)) return "M";
  if (ext === "ipynb") return "NB";
  if (["py", "pyw"].includes(ext)) return "Py";
  if (["java", "kt", "kts"].includes(ext)) return "J";
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return "JS";
  if (["rs", "go", "rb", "php", "cs", "cpp", "c", "h", "hpp"].includes(ext)) return ext.toUpperCase();
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return "{}";
  if (["html", "htm", "css", "scss"].includes(ext)) return "</>";
  return ext.slice(0, 2).toUpperCase() || "T";
}
export function updateDirtyUi() {
  const label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel;
  const dirtyIndicator = $("dirtyIndicator");
  dirtyIndicator.replaceChildren();
  if (documentState.dirty) {
    const dot = document.createElement("span");
    dot.className = "tab-dirty-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = document.documentElement.lang === "en" ? "Unsaved" : "Niezapisane";
    dirtyIndicator.append(dot, label);
  }
  const documentName = $("documentName") as HTMLElement;
  documentName.textContent = label;
  documentName.classList.toggle("dirty", documentState.dirty);
  const tab = activeTab();
  if (tab) { tab.label = label; tab.path = documentState.currentPath; tab.dirty = documentState.dirty; tab.savedText = documentState.savedText; }
  renderTabs();
  updateHeadingBreadcrumbs();
}
export function setDirty() {
  documentState.dirty = true;
  const tab = activeTab();
  if (tab) { tab.state = view.state; tab.dirty = true; tab.path = documentState.currentPath; tab.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; tab.savedText = documentState.savedText; }
  updateDirtyUi();
}
export function markDirty() {
  // Do not stringify or compare the full document on every keystroke.
  const tab = activeTab();
  if (tab) { tab.state = view.state; tab.path = documentState.currentPath; tab.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; tab.dirty = true; }
  if (!documentState.dirty) { documentState.dirty = true; updateDirtyUi(); }
}
export function setClean() {
  documentState.dirty = false;
  const tab = activeTab();
  if (tab) { tab.state = view.state; tab.path = documentState.currentPath; tab.label = documentState.currentPath ? basename(documentState.currentPath) : documentState.untitledLabel; tab.dirty = false; tab.savedText = documentState.savedText; }
  updateDirtyUi();
}
