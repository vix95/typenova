/** Opening a project folder and rendering the project tree. */
import { open } from "@tauri-apps/plugin-dialog";
import { normalizedFsPath } from "../filesystem/project-tree-operations";
import { basename, isEditableTextFile } from "../filesystem/path-utils";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { $ } from "../app/dom";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { renderGraphFilterTree, setGraphFilesPanelOpen } from "../graph-ui/filter-panel";
import { graphWorkspaceController, graphUi } from "../graph-ui/graph-state";
import { buildGraph } from "../graph-ui/indexing";
import { langText } from "../i18n/language";
import { isFilesystemScopeError, projectTreeState } from "./project-tree-ops";
import { openProjectTreeEntry, showTreeContextMenu } from "./tree-context-menu";
import { installTreeDragDrop } from "./tree-drag-drop";
import { appAlert } from "../ui/dialogs";

export async function openProject() { try { const chosen = await open({ directory: true, multiple: false, recursive: true }); if (typeof chosen !== "string") return; const previousRoot = documentState.projectRoot; if (!previousRoot || normalizedFsPath(previousRoot) !== normalizedFsPath(chosen)) graphWorkspaceController.cancel(); documentState.projectRoot = chosen; if (!previousRoot || normalizedFsPath(previousRoot) !== normalizedFsPath(chosen)) { graphUi.graphSelectedFiles = null; graphUi.graphAvailableFiles = []; localStorage.removeItem("typenova.brain.selectedFiles"); localStorage.setItem("typenova.brain.selectedProjectRoot", chosen); setGraphFilesPanelOpen(false, false); renderGraphFilterTree(); } localStorage.setItem("typenova.projectRoot", chosen); graphUi.graphSections = []; graphUi.graphSectionGraphModel = null; graphUi.selectedGraphSection = null; ($("brainPreview") as HTMLElement).hidden = true; ($("brainPreviewResizer") as HTMLElement).hidden = true; $("brainView").classList.remove("has-preview"); await renderProjectTree(); if (activeSidebarTab === "brain") void buildGraph(); } catch (e) { const message = isFilesystemScopeError(e) ? langText("TypeNova nie ma aktualnego dostępu do wybranego folderu. Wybierz folder projektu ponownie.", "TypeNova no longer has access to this folder. Choose the project folder again.") : `${langText("Nie udało się otworzyć projektu", "Could not open project")}: ${String(e)}`; await appAlert(message); } }
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

export async function renderProjectTree() {
  const root = $("projectFiles") as HTMLElement;
  root.replaceChildren();
  $("projectName").textContent = documentState.projectRoot ? basename(documentState.projectRoot) : langText("Brak otwartego projektu", "No project open");
  $("projectTree").hidden = !documentState.projectRoot;
  $("fileEmptyState").hidden = !!documentState.projectRoot;
  $("recentFiles").hidden = !!documentState.projectRoot;
  if (!documentState.projectRoot) return;
  installTreeDragDrop();
  const walk = async (path: string, depth: number, parent: HTMLElement): Promise<boolean> => {
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
      const { row, disclosure } = createTreeEntryRow(entry, full, depth);
      parent.append(row);

      if (!entry.isDirectory) {
        row.addEventListener("click", () => void openProjectTreeEntry(full, false));
        continue;
      }
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
    }
    return true;
  };
  await walk(documentState.projectRoot, 0, root);
}
