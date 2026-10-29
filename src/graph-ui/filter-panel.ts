/** Visible-documents filter panel: folder/file tree, search and bulk selection. */
import { type ProjectFilterTreeNode, buildProjectFilterTree } from "../filesystem/project-filter-tree";
import { basename } from "../filesystem/path-utils";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { renderGraph } from "./graph-renderer";
import { graphUi } from "./graph-state";
import { restoreGraphPreviewRenderer } from "./preview-host";
import { updateGraphRelatedPanel } from "./related-panel";
import { langText } from "../i18n/language";
import { projectRootFor, projectRootsKey } from "../project/project-roots";

export function syncGraphFilesButton() {
  const button = $("brainFilesButton") as HTMLButtonElement;
  const total = graphUi.graphAvailableFiles.length;
  const isSelected = (path: string) => graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(path);
  const chosen = graphUi.graphAvailableFiles.filter(f => isSelected(f.path)).length;
  const panel = $("brainFilterPanel") as HTMLElement;
  button.textContent = `${langText("Filtry", "Filters")} · ${chosen}/${total}`;
  button.setAttribute("aria-label", langText(`Filtry grafu: ${chosen} z ${total} dokumentów widocznych`, `Graph filters: ${chosen} of ${total} documents visible`));
  button.dataset.tooltip = langText("Otwórz filtry dokumentów i katalogów grafu", "Open graph document and folder filters");
  button.removeAttribute("title");
  button.setAttribute("aria-expanded", String(!panel.hidden));
  button.classList.toggle("is-active", !panel.hidden);
  const selectAllButton = $("brainSelectAllFiles") as HTMLButtonElement | null;
  if (selectAllButton) { const label = langText("Zaznacz wszystkie dokumenty", "Select all documents"); selectAllButton.dataset.tooltip = label; selectAllButton.setAttribute("aria-label", label); selectAllButton.removeAttribute("title"); }
  const clearAllButton = $("brainClearAllFiles") as HTMLButtonElement | null;
  if (clearAllButton) { const label = langText("Odznacz wszystkie dokumenty", "Deselect all documents"); clearAllButton.dataset.tooltip = label; clearAllButton.setAttribute("aria-label", label); clearAllButton.removeAttribute("title"); }
  button.classList.toggle("has-filter-selection", chosen < total);
  $("brainFilesSummary").textContent = `${chosen}/${total}`;
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("#brainFilesList input[data-graph-file]"))) {
    input.checked = isSelected(input.dataset.graphFile || "");
    input.indeterminate = false;
    input.setAttribute("aria-checked", String(input.checked));
  }
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("#brainFilesList input[data-graph-folder]"))) {
    let paths: string[] = []; try { paths = JSON.parse(input.dataset.graphFiles || "[]"); } catch { }
    const count = paths.filter(isSelected).length;
    input.checked = paths.length > 0 && count === paths.length;
    input.indeterminate = count > 0 && count < paths.length;
    input.setAttribute("aria-checked", input.indeterminate ? "mixed" : String(input.checked));
    const row = input.closest(".brain-filter-check-row");
    const countLabel = row?.querySelector<HTMLElement>(".brain-filter-count");
    if (countLabel) countLabel.textContent = `${count}/${paths.length}`;
  }
}
export function persistGraphFileSelection() {
  try {
    localStorage.setItem("typenova.brain.selectedProjectRoot", projectRootsKey());
    if (graphUi.graphSelectedFiles === null) localStorage.removeItem("typenova.brain.selectedFiles");
    else localStorage.setItem("typenova.brain.selectedFiles", JSON.stringify([...graphUi.graphSelectedFiles]));
  } catch { }
}
type GraphFilterTreeNode = ProjectFilterTreeNode;
const graphFilterCollapsedFolders = new Set<string>();
/** Gives every folder of a sub-tree a path that is unique across the open root folders (file nodes keep their absolute path). */
function prefixFolderPaths(node: GraphFilterTreeNode, prefix: string): void {
  if (node.kind === "folder") node.path = node.path ? `${prefix}/${node.path}` : prefix;
  for (const child of node.children) prefixFolderPaths(child, prefix);
}
function createGraphFilterTree(): GraphFilterTreeNode {
  const locale = document.documentElement.lang === "en" ? "en" : "pl";
  const roots = documentState.projectRoots;
  if (roots.length <= 1) {
    return buildProjectFilterTree(graphUi.graphAvailableFiles, roots[0] || "", roots[0] ? basename(roots[0]) : langText("Projekt", "Project"), locale);
  }
  // Several folders: one top node, one sub-tree per open folder.
  const top: GraphFilterTreeNode = { kind: "folder", name: langText("Foldery", "Folders"), path: "", children: [], filePaths: [] };
  roots.forEach((root, index) => {
    const own = graphUi.graphAvailableFiles.filter(file => projectRootFor(file.path) === root);
    if (!own.length) return;
    const subTree = buildProjectFilterTree(own, root, basename(root), locale);
    prefixFolderPaths(subTree, `${index}:${basename(root)}`);
    top.children.push(subTree);
    top.filePaths.push(...subTree.filePaths);
  });
  return top;
}
export function renderGraphFilterTree() {
  const list = $("brainFilesList"); list.replaceChildren();
  if (!graphUi.graphAvailableFiles.length) { const empty = document.createElement("div"); empty.className = "brain-files-empty"; empty.textContent = langText("Brak dokumentów Markdown z nagłówkami.", "No Markdown documents with headings."); list.append(empty); syncGraphFilesButton(); return; }
  const rootNode = createGraphFilterTree();
  const renderNode = (node: GraphFilterTreeNode, parent: HTMLElement, isRoot = false) => {
    const wrap = document.createElement("div"); wrap.className = `brain-filter-node brain-filter-${node.kind}${isRoot ? " is-root" : ""}`; wrap.setAttribute("role", "treeitem");
    wrap.dataset.filterSearchText = `${node.name} ${node.path}`.toLocaleLowerCase();
    wrap.dataset.filterPath = node.path;
    if (node.kind === "file") {
      const row = document.createElement("label"); row.className = "brain-filter-row brain-filter-check-row brain-filter-file-row";
      const input = document.createElement("input"); input.type = "checkbox"; input.dataset.graphFile = node.path; input.checked = graphUi.graphSelectedFiles === null || graphUi.graphSelectedFiles.has(node.path); input.setAttribute("aria-label", langText(`Pokaż dokument ${node.name}`, `Show document ${node.name}`)); input.addEventListener("change", () => {
        const selected = new Set(graphUi.graphSelectedFiles === null ? graphUi.graphAvailableFiles.map(f => f.path) : graphUi.graphSelectedFiles);
        if (input.checked) selected.add(node.path); else selected.delete(node.path);
        commitGraphFileSelection(selected.size >= graphUi.graphAvailableFiles.length ? null : selected);
      });
      const icon = document.createElement("span"); icon.className = "brain-filter-file-icon"; icon.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 1.75h6l4 4v8.5H3z"/><path d="M9 1.75v4h4M5.25 8.5h5.5M5.25 11h5.5"/></svg>'; icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.className = "brain-filter-name"; name.textContent = node.name; name.title = node.path;
      row.append(input, icon, name); wrap.append(row); parent.append(wrap); return;
    }
    const nodeKey = node.path || "__project_root__"; const collapsed = graphFilterCollapsedFolders.has(nodeKey);
    const row = document.createElement("div"); row.className = "brain-filter-row brain-filter-folder-row";
    const expand = document.createElement("button"); expand.type = "button"; expand.className = "brain-filter-expand"; expand.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5"/></svg>'; expand.setAttribute("aria-expanded", String(!collapsed)); const expandLabel = langText(`${collapsed ? "Rozwiń" : "Zwiń"} katalog ${node.name}`, `${collapsed ? "Expand" : "Collapse"} folder ${node.name}`); expand.setAttribute("aria-label", expandLabel); expand.dataset.tooltip = expandLabel;
    const label = document.createElement("label"); label.className = "brain-filter-check-row";
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.graphFolder = node.path; input.dataset.graphFiles = JSON.stringify(node.filePaths); input.setAttribute("aria-label", langText(`Pokaż wszystkie dokumenty w katalogu ${node.name}`, `Show all documents in folder ${node.name}`));
    const icon = document.createElement("span"); icon.className = "brain-filter-folder-icon"; icon.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M1.75 4.25A1.25 1.25 0 0 1 3 3h3l1.5 1.5h5A1.25 1.25 0 0 1 13.75 5.75v5.75A1.25 1.25 0 0 1 12.5 12.75h-9.5a1.25 1.25 0 0 1-1.25-1.25z"/><path d="M1.9 6h11.9"/></svg>'; icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span"); name.className = "brain-filter-name"; name.textContent = node.name; name.title = node.path || node.name;
    const count = document.createElement("small"); count.className = "brain-filter-count";
    label.append(input, icon, name, count); row.append(expand, label); wrap.append(row);
    const children = document.createElement("div"); children.className = "brain-filter-children"; children.hidden = collapsed; children.setAttribute("role", "group");
    for (const child of node.children) renderNode(child, children, false);
    wrap.append(children); parent.append(wrap);
    expand.addEventListener("click", () => { children.hidden = !children.hidden; const expanded = !children.hidden; if (expanded) graphFilterCollapsedFolders.delete(nodeKey); else graphFilterCollapsedFolders.add(nodeKey); expand.setAttribute("aria-expanded", String(expanded)); const label = langText(`${expanded ? "Zwiń" : "Rozwiń"} katalog ${node.name}`, `${expanded ? "Collapse" : "Expand"} folder ${node.name}`); expand.setAttribute("aria-label", label); expand.dataset.tooltip = label; });
    input.addEventListener("change", () => {
      const selected = new Set(graphUi.graphSelectedFiles === null ? graphUi.graphAvailableFiles.map(f => f.path) : graphUi.graphSelectedFiles);
      for (const path of node.filePaths) { if (input.checked) selected.add(path); else selected.delete(path); }
      commitGraphFileSelection(selected.size >= graphUi.graphAvailableFiles.length ? null : selected);
    });
  };
  renderNode(rootNode, list, true);
  applyGraphFilterTreeSearch();
  syncGraphFilesButton();
}
const graphFilesSearch = $("brainFilesSearch") as HTMLInputElement;
const graphFilesSearchClear = $("brainFilesSearchClear") as HTMLButtonElement;
function applyGraphFilterTreeSearch() {
  const query = (graphFilesSearch?.value || "").trim().toLocaleLowerCase();
  if (graphFilesSearchClear) graphFilesSearchClear.hidden = !query;
  const list = $("brainFilesList");
  if (!list) return;
  const roots = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("brain-filter-node"));
  let matched = false;
  const visit = (node: HTMLElement, inheritedMatch = false): boolean => {
    const isFolder = node.classList.contains("brain-filter-folder");
    const ownText = node.dataset.filterSearchText || "";
    const directMatch = !query || ownText.includes(query);
    const includeDescendants = !!query && (inheritedMatch || (isFolder && directMatch));
    const children = node.querySelector<HTMLElement>(":scope > .brain-filter-children");
    let childMatch = false;
    if (children) {
      const childNodes = Array.from(children.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("brain-filter-node"));
      for (const child of childNodes) childMatch = visit(child, includeDescendants) || childMatch;
      if (query) children.hidden = !(includeDescendants || childMatch);
      else children.hidden = graphFilterCollapsedFolders.has(node.dataset.filterPath || "__project_root__");
      const expandButton = node.querySelector<HTMLButtonElement>(":scope > .brain-filter-folder-row .brain-filter-expand");
      if (expandButton) expandButton.setAttribute("aria-expanded", String(!children.hidden));
    }
    const visible = !query || inheritedMatch || directMatch || childMatch;
    node.hidden = !visible;
    if (visible) matched = true;
    return visible;
  };
  for (const root of roots) visit(root);
  const existing = list.querySelector(".brain-files-no-matches") as HTMLElement | null;
  if (!matched) {
    if (!existing) { const empty = document.createElement("div"); empty.className = "brain-files-empty brain-files-no-matches"; empty.textContent = query ? langText("Brak pasujących dokumentów lub katalogów.", "No matching documents or folders.") : langText("Brak dokumentów Markdown z nagłówkami.", "No Markdown documents with headings."); list.append(empty); }
    else existing.textContent = query ? langText("Brak pasujących dokumentów lub katalogów.", "No matching documents or folders.") : langText("Brak dokumentów Markdown z nagłówkami.", "No Markdown documents with headings.");
  } else existing?.remove();
}
export function setGraphFilesPanelOpen(open: boolean, focusPanel = true) {
  const panel = $("brainFilterPanel") as HTMLElement; panel.hidden = !open; $("brainView").classList.toggle("has-filters", open);
  try { localStorage.setItem("typenova.brain.filters.open", open ? "on" : "off"); } catch { }
  syncGraphFilesButton();
  if (open && focusPanel) { graphFilesSearch?.focus({ preventScroll: true }); }
}
export function closeGraphPreview(clearSelection = false, redraw = true) {
  restoreGraphPreviewRenderer();
  ($("brainPreview") as HTMLElement).hidden = true; ($("brainPreviewResizer") as HTMLElement).hidden = true; $("brainGraphBreadcrumbRow").hidden = true; $("brainView").classList.remove("has-preview");
  if (clearSelection) { graphUi.selectedGraphSection = null; graphUi.graphRelatedPanelDismissed = false; updateGraphRelatedPanel(null); }
  graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false;
  if (redraw) requestAnimationFrame(() => renderGraph());
}
function commitGraphFileSelection(selection: Set<string> | null) {
  graphUi.graphSelectedFiles = selection; persistGraphFileSelection(); syncGraphFilesButton();
  if (graphUi.selectedGraphSection && (selection !== null && !selection.has(graphUi.selectedGraphSection.path))) closeGraphPreview(true, false);
  graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false; renderGraph();
}
const graphFilesButton = $("brainFilesButton") as HTMLButtonElement;
const graphFilterPanel = $("brainFilterPanel") as HTMLElement;
const rememberedFilterPanelOpen = localStorage.getItem("typenova.brain.filters.open") === "on";

export function initFilterPanel(): void {
  graphFilesSearch.addEventListener("input", applyGraphFilterTreeSearch);
  graphFilesSearchClear.addEventListener("click", () => { graphFilesSearch.value = ""; applyGraphFilterTreeSearch(); graphFilesSearch.focus({ preventScroll: true }); });
  graphFilterPanel.hidden = !rememberedFilterPanelOpen;
  $("brainView").classList.toggle("has-filters", rememberedFilterPanelOpen);
  syncGraphFilesButton();
  graphFilesButton.addEventListener("click", () => setGraphFilesPanelOpen(graphFilterPanel.hidden));
  $("brainCloseFiltersButton").addEventListener("click", () => { setGraphFilesPanelOpen(false, false); graphFilesButton.focus({ preventScroll: true }); });
  $("brainSelectAllFiles").addEventListener("click", () => commitGraphFileSelection(null));
  $("brainClearAllFiles").addEventListener("click", () => commitGraphFileSelection(new Set()));
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !graphFilterPanel.hidden) { setGraphFilesPanelOpen(false, false); graphFilesButton.focus({ preventScroll: true }); event.stopImmediatePropagation(); } });
}
