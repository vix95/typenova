/** Opening a project folder and rendering the project tree. */
import { open } from "@tauri-apps/plugin-dialog";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { basename, isEditableTextFile } from "../filesystem/path-utils";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { $ } from "../app/dom";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { persistGraphFileSelection, renderGraphFilterTree, setGraphFilesPanelOpen } from "../graph-ui/filter-panel";
import { graphWorkspaceController, graphUi } from "../graph-ui/graph-state";
import { buildGraph } from "../graph-ui/indexing";
import { langText } from "../i18n/language";
import { addProjectRoot, removeProjectRoot } from "../filesystem/project-roots";
import { isFilesystemScopeError, markTreeClipboardState, projectTreeController, projectTreeState } from "./project-tree-ops";
import { setProjectRoots } from "./project-roots";
import { openProjectTreeEntry, showTreeContextMenu } from "./tree-context-menu";
import { installTreeDragDrop } from "./tree-drag-drop";
import { appAlert, appConfirm } from "../ui/dialogs";
import { showToast } from "../ui/toast";

/** Applies a new set of tree folders: resets what depended on the old set, then refreshes the tree and (when shown) the graph. */
export async function applyProjectRoots(roots: readonly string[], options: { resetGraphSelection: boolean; resetTransient: boolean }) {
  graphWorkspaceController.cancel();
  setProjectRoots(roots);
  if (options.resetTransient) { projectTreeController.resetTransientState(); markTreeClipboardState(); }
  if (options.resetGraphSelection || !roots.length) {
    graphUi.graphSelectedFiles = null; graphUi.graphAvailableFiles = []; localStorage.removeItem("typenova.brain.selectedFiles");
    setGraphFilesPanelOpen(false, false); renderGraphFilterTree(); persistGraphFileSelection();
  }
  graphUi.graphSections = []; graphUi.graphSectionGraphModel = null; graphUi.selectedGraphSection = null;
  ($("brainPreview") as HTMLElement).hidden = true; ($("brainPreviewResizer") as HTMLElement).hidden = true; $("brainView").classList.remove("has-preview");
  await renderProjectTree();
  if (activeSidebarTab === "brain") void buildGraph();
}

function reportOpenError(error: unknown) {
  const message = isFilesystemScopeError(error)
    ? langText("TypeNova nie ma aktualnego dostępu do wybranego folderu. Wybierz folder projektu ponownie.", "TypeNova no longer has access to this folder. Choose the project folder again.")
    : `${langText("Nie udało się otworzyć projektu", "Could not open project")}: ${String(error)}`;
  return appAlert(message);
}

/** Opens a folder as the only one in the tree; with several folders open the user is asked first because they are replaced. */
export async function openProject() {
  try {
    const open_ = documentState.projectRoots.length;
    if (open_ > 1) {
      const confirmed = await appConfirm(
        langText(`Otwarcie folderu zastąpi obecne drzewo (otwarte foldery: ${open_}). Kontynuować?`, `Opening a folder will replace the current tree (${open_} open folders). Continue?`),
        { confirmLabel: langText("Zastąp drzewo", "Replace tree") });
      if (!confirmed) return;
    }
    const chosen = await open({ directory: true, multiple: false, recursive: true });
    if (typeof chosen !== "string") return;
    const same = documentState.projectRoots.length === 1 && normalizedFsPath(documentState.projectRoots[0]) === normalizedFsPath(chosen);
    await applyProjectRoots([chosen], { resetGraphSelection: !same, resetTransient: !same });
  } catch (error) { await reportOpenError(error); }
}

/** Adds a folder to the tree next to the ones already open. */
export async function addProjectFolder() {
  try {
    const chosen = await open({ directory: true, multiple: false, recursive: true });
    if (typeof chosen !== "string") return;
    const previous = documentState.projectRoots;
    const result = addProjectRoot(previous, chosen);
    if (result.status === "duplicate") { showToast(langText("Ten folder jest już w drzewie.", "This folder is already in the tree.")); return; }
    if (result.status === "inside") { showToast(langText(`Ten folder jest już częścią otwartego folderu: ${basename(result.existing)}.`, `This folder is already part of an open folder: ${basename(result.existing)}.`)); return; }
    if (result.status === "contains") { showToast(langText(`Ten folder zawiera otwarty folder (${basename(result.existing)}). Najpierw usuń go z drzewa.`, `This folder contains an open folder (${basename(result.existing)}). Remove that one from the tree first.`)); return; }
    // Folders shown as roots start expanded, including the one that was the only folder until now.
    for (const root of result.roots) projectTreeState.expandedFolders.add(root);
    const first = previous.length === 0;
    await applyProjectRoots(result.roots, { resetGraphSelection: first, resetTransient: first });
  } catch (error) { await reportOpenError(error); }
}

/** Removes one folder from the tree (its files stay on disk); removing the last one closes the project. */
export async function removeProjectFolder(path: string) {
  const roots = removeProjectRoot(documentState.projectRoots, path);
  await applyProjectRoots(roots, { resetGraphSelection: !roots.length, resetTransient: !roots.length });
}

/** Closes every folder in the tree. */
export async function closeProject() { await applyProjectRoots([], { resetGraphSelection: true, resetTransient: true }); }
const CHEVRON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 3.5 4.5 4.5-4.5 4.5"/></svg>';
const FOLDER_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 4.25a1.25 1.25 0 0 1 1.25-1.25h3l1.5 1.5h5a1.25 1.25 0 0 1 1.25 1.25v5.75A1.25 1.25 0 0 1 12.5 12.75h-9.5a1.25 1.25 0 0 1-1.25-1.25z"/><path d="M1.9 6h11.9"/></svg>';
const FILE_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.75h6l4 4v8.5H3z"/><path d="M9 1.75v4h4M5.25 8.5h5.5M5.25 11h5.5"/></svg>';

/** Row shown in place of a folder's content when it cannot be read, with a retry (or re-pick) action. */
function createTreeLoadErrorRow(error: unknown, retryLoad: () => Promise<void>): HTMLElement {
  const errorRow = document.createElement("div");
  errorRow.className = "tree-load-error";
  const scopeDenied = isFilesystemScopeError(error);
  const message = document.createElement("span");
  message.textContent = scopeDenied
    ? langText("TypeNova nie ma dostępu do tego folderu. Wybierz folder projektu ponownie.", "TypeNova cannot access this folder. Choose the project folder again.")
    : langText("Nie udało się odczytać zawartości folderu.", "Could not read this folder.");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "tree-retry";
  retry.textContent = scopeDenied ? langText("Wybierz folder", "Choose folder") : langText("Ponów", "Retry");
  retry.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (scopeDenied) { await openProject(); return; }
    await retryLoad();
  });
  errorRow.append(message, retry);
  return errorRow;
}

/** Builds the (not yet attached) explorer row for one directory entry. */
function createTreeEntryRow(entry: { name: string; isDirectory?: boolean }, full: string, depth: number): { row: HTMLButtonElement; disclosure: HTMLElement } {
  const editable = !entry.isDirectory && isEditableTextFile(entry.name);
  const row = document.createElement("button");
  row.type = "button";
  row.className = `tree-entry ${entry.isDirectory ? "tree-folder" : "tree-file"}${!entry.isDirectory && !editable ? " tree-file-unsupported" : ""}`;
  row.style.paddingLeft = `${9 + depth * 14}px`;
  row.title = entry.isDirectory ? full : (editable ? full : `${full}\n${langText("TypeNova nie może otworzyć tego pliku.", "TypeNova cannot open this file.")}`);
  row.dataset.filePath = full;
  row.dataset.entryType = entry.isDirectory ? "directory" : (editable ? "editable-file" : "other-file");
  // Internal Project moves use pointer-driven drag handling; native HTML DnD is unreliable in WebView2.
  row.draggable = false;
  row.classList.toggle("active", !!documentState.currentPath && documentState.currentPath.replace(/\\/g, "/").toLowerCase() === full.replace(/\\/g, "/").toLowerCase());
  row.addEventListener("contextmenu", event => showTreeContextMenu(event, row));

  const disclosure = document.createElement("span");
  disclosure.className = `tree-disclosure${entry.isDirectory ? " folder-disclosure" : ""}`;
  if (entry.isDirectory) disclosure.innerHTML = CHEVRON_SVG;

  const icon = document.createElement("span");
  icon.className = `tree-entry-icon ${entry.isDirectory ? "folder-kind-icon" : "file-glyph"}`;
  icon.innerHTML = entry.isDirectory ? FOLDER_SVG : FILE_SVG;
  const label = document.createElement("span");
  label.className = "tree-entry-label";
  label.textContent = entry.name;
  row.append(disclosure, icon, label);
  return { row, disclosure };
}

const REMOVE_ROOT_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75"/></svg>';

/** Small remove-from-tree control shown at the end of a root row (the row itself is a button, so this is a role=button span). */
function createRemoveRootControl(root: string): HTMLElement {
  const control = document.createElement("span");
  const label = langText("Usuń folder z drzewa", "Remove folder from tree");
  control.className = "tree-root-remove"; control.setAttribute("role", "button"); control.tabIndex = 0;
  control.setAttribute("aria-label", `${label}: ${basename(root)}`); control.dataset.tooltip = label;
  control.innerHTML = REMOVE_ROOT_SVG;
  const remove = (event: Event) => { event.preventDefault(); event.stopPropagation(); void removeProjectFolder(root); };
  control.addEventListener("click", remove);
  control.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") remove(event); });
  return control;
}

export async function renderProjectTree() {
  const root = $("projectFiles") as HTMLElement;
  root.replaceChildren();
  const roots = documentState.projectRoots;
  const multiple = roots.length > 1;
  $("projectName").textContent = !roots.length
    ? langText("Brak otwartego projektu", "No project open")
    : multiple ? langText(`Foldery (${roots.length})`, `Folders (${roots.length})`) : basename(roots[0]);
  $("projectName").title = roots.join("\n");
  $("projectTree").hidden = !roots.length;
  $("fileEmptyState").hidden = !!roots.length;
  $("recentFiles").hidden = !!roots.length;
  if (!roots.length) return;
  installTreeDragDrop();
  let walk: (path: string, depth: number, parent: HTMLElement) => Promise<boolean>;

  /** Adds one folder row with its lazily loaded content; `isProjectRoot` marks a top-level folder of a multi-folder tree. */
  const addDirectory = async (parent: HTMLElement, name: string, full: string, depth: number, isProjectRoot = false) => {
    const { row, disclosure } = createTreeEntryRow({ name, isDirectory: true }, full, depth);
    if (isProjectRoot) { row.dataset.projectRoot = "true"; row.classList.add("tree-project-root"); row.append(createRemoveRootControl(full)); }
    parent.append(row);
    const child = document.createElement("div");
    child.hidden = true;
    child.dataset.path = full;
    parent.append(child);
    row.addEventListener("click", async () => {
      if (child.hidden) {
        child.hidden = false;
        projectTreeState.expandedFolders.add(full);
        disclosure.classList.add("expanded");
        if (!child.dataset.loaded) {
          const loaded = await walk(full, depth + 1, child);
          if (loaded) child.dataset.loaded = "true";
        }
      } else {
        child.hidden = true;
        projectTreeState.expandedFolders.delete(full);
        disclosure.classList.remove("expanded");
      }
    });
    if (projectTreeState.expandedFolders.has(full)) {
      child.hidden = false; disclosure.classList.add("expanded");
      const loaded = await walk(full, depth + 1, child); if (loaded) child.dataset.loaded = "true";
    }
  };

  walk = async (path: string, depth: number, parent: HTMLElement): Promise<boolean> => {
    let entries: any[] = [];
    try {
      entries = await readDir(path);
    } catch (error) {
      parent.replaceChildren(createTreeLoadErrorRow(error, async () => {
        parent.replaceChildren();
        const loaded = await walk(path, depth, parent);
        if (loaded) parent.dataset.loaded = "true";
      }));
      return false;
    }

    // Show every filesystem entry (including dotfiles and non-text formats).
    // Directories are listed first for familiar explorer behavior; contents stay lazy-loaded.
    // Clear an earlier error placeholder before rendering a successful retry.
    parent.replaceChildren();
    entries.sort((a, b) => Number(!!b.isDirectory) - Number(!!a.isDirectory) || a.name.localeCompare(b.name, "pl"));
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.style.paddingLeft = `${23 + depth * 14}px`;
      empty.textContent = langText("Pusty folder", "Empty folder");
      parent.replaceChildren(empty);
      return true;
    }

    for (const entry of entries) {
      const full = await join(path, entry.name);
      if (entry.isDirectory) { await addDirectory(parent, entry.name, full, depth); continue; }
      const { row } = createTreeEntryRow(entry, full, depth);
      parent.append(row);
      row.addEventListener("click", () => void openProjectTreeEntry(full, false));
    }
    return true;
  };

  if (multiple) for (const folder of roots) await addDirectory(root, basename(folder), folder, 0, true);
  else await walk(roots[0], 0, root);
}
