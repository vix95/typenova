/** Glue between the project tree controller and the UI: clipboard state, move/copy and open-tab path remapping. */
import { createProjectTreeState } from "../filesystem/project-tree-state";
import { join } from "@tauri-apps/api/path";
import { exists, readDir, mkdir, copyFile, remove, rename } from "@tauri-apps/plugin-fs";
import { createProjectTreeController } from "../filesystem/project-tree-controller";
import { remapPathPrefix, normalizedFsPath } from "../filesystem/project-tree-operations";
import { basename } from "../filesystem/path-utils";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { markProjectTreeSelection } from "../documents/file-actions";
import { activeTab, renderTabs } from "../documents/tabs";
import { buildGraph } from "../graph-ui/indexing";
import { langText } from "../i18n/language";
import { renderProjectTree } from "./project-tree-view";
import { showToast } from "../ui/toast";

export function isFilesystemScopeError(error: unknown) { return /forbidden path|not allowed|scope/i.test(String(error)); }
export const projectTreeState = createProjectTreeState();
const projectTreeFileSystem = { join, exists, readDir, mkdir, copyFile, remove, rename };
export const projectTreeController = createProjectTreeController({
  state: projectTreeState,
  fs: projectTreeFileSystem,
  getProjectRoot: () => documentState.projectRoot,
  getProjectRoots: () => documentState.projectRoots,
  getCopyLabel: () => langText("kopia", "copy"),
  getAlreadyExistsMessage: () => langText("Element o tej nazwie już istnieje w folderze docelowym.", "An item with that name already exists in the destination folder."),
  getProjectRequiredMessage: () => langText("Najpierw otwórz projekt.", "Open a project first."),
  getOutsideProjectMessage: () => langText("Operacja musi pozostać w otwartych folderach projektu.", "The operation must stay within the open project folders."),
  getProjectRootMutationMessage: () => langText("Nie można usunąć katalogu głównego projektu. Użyj „Usuń folder z drzewa”.", "The project root cannot be deleted. Use “Remove folder from tree”."),
  getDescendantMoveMessage: () => langText("Nie można przenieść folderu do niego samego ani do jego podfolderu.", "A folder cannot be moved into itself or one of its descendants."),
  onPathMoved: (oldPath, newPath) => remapOpenProjectPaths(oldPath, newPath),
});
function remapOpenProjectPaths(oldPath: string, newPath: string) {
  const mapPath = (path: string) => remapPathPrefix(path, oldPath, newPath);
  for (const tab of documentState.tabs) { if (tab.path) { const next = mapPath(tab.path); if (next !== tab.path) { tab.path = next; tab.label = basename(next); } } }
  if (documentState.currentPath) documentState.currentPath = mapPath(documentState.currentPath);
  const active = activeTab(); if (active && active.path) { documentState.currentPath = active.path; documentState.untitledLabel = active.label; }
  renderTabs();
}
export function markTreeClipboardState() {
  document.querySelectorAll<HTMLElement>("#projectFiles .tree-entry").forEach(row => {
    row.classList.toggle("tree-cut-pending", !!projectTreeState.clipboard && projectTreeState.clipboard.operation === "cut" && normalizedFsPath(row.dataset.filePath || "") === normalizedFsPath(projectTreeState.clipboard.path));
    row.classList.toggle("tree-copy-pending", !!projectTreeState.clipboard && projectTreeState.clipboard.operation === "copy" && normalizedFsPath(row.dataset.filePath || "") === normalizedFsPath(projectTreeState.clipboard.path));
  });
}
export function setTreeClipboard(path: string, operation: "copy" | "cut", isDirectory: boolean) {
  projectTreeController.setClipboard(path, operation, isDirectory);
  markTreeClipboardState();
  const label = basename(path);
  showToast(operation === "copy"
    ? `${langText("Skopiowano do schowka TypeNova", "Copied to TypeNova's file clipboard")}: ${label}. ${langText("Kliknij prawym przyciskiem folder docelowy i wybierz Wklej.", "Right-click a destination folder and choose Paste.")}`
    : `${langText("Wycięto", "Cut")}: ${label}. ${langText("Kliknij prawym przyciskiem folder docelowy i wybierz Wklej.", "Right-click a destination folder and choose Paste.")}`);
}
export async function performTreeMoveOrCopy(source: string, destinationFolder: string, operation: "copy" | "cut", isDirectory: boolean, forceDuplicate = false) {
  const result = await projectTreeController.moveOrCopy(source, destinationFolder, operation, isDirectory, forceDuplicate);
  if (result.status === "same-folder") {
    showToast(langText("Element już znajduje się w tym folderze.", "This item is already in that folder."));
    return;
  }
  await renderProjectTree();
  markTreeClipboardState();
  markProjectTreeSelection(documentState.currentPath);
  if (activeSidebarTab === "brain") void buildGraph();
  showToast(result.status === "moved"
    ? `${langText("Przeniesiono", "Moved")}: ${basename(result.destination)}`
    : `${langText("Utworzono kopię", "Created copy")}: ${basename(result.destination)}`);
}
