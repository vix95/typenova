/** Pointer-driven drag and drop for the project tree. */
import { pathIsInside, normalizedFsPath } from "../filesystem/project-tree-operations";
import { $ } from "../app/dom";
import { documentState } from "../documents/document-state";
import { langText } from "../i18n/language";
import { performTreeMoveOrCopy, projectTreeState, setTreeClipboard } from "./project-tree-ops";
import { handleTreeContextAction, showTreeContextMenu, treeContextMenuElement } from "./tree-context-menu";
import { showToast } from "../ui/toast";
import { hasSingleProjectRoot, projectRootFor } from "./project-roots";

type PointerDragState = {
  pointerId: number; path: string; isDirectory: boolean; row: HTMLElement;
  startX: number; startY: number; active: boolean;
};
type TreeDropTarget = { path: string; row: HTMLElement | null; container: HTMLElement | null; valid: boolean; insideProject: boolean };

const clearDropTargets = () => document.querySelectorAll(".tree-drop-target, .tree-drop-container-target").forEach(element => element.classList.remove("tree-drop-target", "tree-drop-container-target"));
const clearPointerDragVisuals = () => {
  clearDropTargets();
  document.body.classList.remove("tree-pointer-dragging");
  document.querySelectorAll(".tree-dragging").forEach(element => element.classList.remove("tree-dragging"));
};

/** Resolves what lies under the pointer into a (possibly invalid) move destination inside the project. */
function resolveDropTarget(head: HTMLElement | null, clientX: number, clientY: number, sourcePath: string, isDirectory: boolean): TreeDropTarget {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target) return { path: "", row: null, container: null, valid: false, insideProject: false };
  // The header and the blank area name "the project" only when exactly one folder is open.
  if (head && head.contains(target)) return { path: documentState.projectRoot || "", row: null, container: null, valid: hasSingleProjectRoot(), insideProject: true };
  if (!target.closest("#projectFiles")) return { path: "", row: null, container: null, valid: false, insideProject: false };

  const row = target.closest<HTMLElement>("#projectFiles .tree-entry");
  let destination = "";
  let targetRow: HTMLElement | null = null;
  let container: HTMLElement | null = null;
  if (row) {
    // A drop on a file is intentionally not treated as a drop into its parent.
    // The user must target a folder row or the blank area inside a folder.
    if (row.dataset.entryType !== "directory") return { path: "", row, container: null, valid: false, insideProject: true };
    destination = row.dataset.filePath || "";
    targetRow = row;
  } else {
    const folderContainer = target.closest<HTMLElement>("#projectFiles [data-path]");
    if (folderContainer?.dataset.path) {
      destination = folderContainer.dataset.path;
      container = folderContainer;
    } else {
      destination = hasSingleProjectRoot() ? (documentState.projectRoot || "") : "";
    }
  }
  const withinProject = !!destination && !!projectRootFor(destination);
  const wouldNestFolder = isDirectory && !!sourcePath && pathIsInside(sourcePath, destination);
  return { path: destination, row: targetRow, container, valid: withinProject && !wouldNestFolder, insideProject: true };
}

function paintDropTarget(files: HTMLElement, target: TreeDropTarget): void {
  clearDropTargets();
  if (!target.valid) return;
  if (target.row) target.row.classList.add("tree-drop-target");
  else if (target.container) target.container.classList.add("tree-drop-container-target");
  else files.classList.add("tree-drop-target");
}

function installTreeContextMenuTriggers(files: HTMLElement, head: HTMLElement | null): void {
  if (head) head.addEventListener("contextmenu", event => showTreeContextMenu(event as MouseEvent, null, true));
  files.addEventListener("contextmenu", event => {
    const row = (event.target as Element | null)?.closest<HTMLElement>(".tree-entry");
    if (row) showTreeContextMenu(event as MouseEvent, row);
    else if (documentState.projectRoots.length) showTreeContextMenu(event as MouseEvent, null, true);
  });
}

/**
 * Use app-managed Pointer Events instead of native HTML drag-and-drop. WebView2
 * can intermittently lose native drag payloads/targets for draggable buttons.
 * A 6px threshold preserves normal row clicks and folder expansion.
 */
function installPointerDrag(files: HTMLElement, head: HTMLElement | null): void {
  let pointerDrag: PointerDragState | null = null;
  let suppressClickAfterDrag = false;

  const finishPointerDrag = (event: PointerEvent, cancelled = false) => {
    const state = pointerDrag;
    if (!state || event.pointerId !== state.pointerId) return;
    const wasDragging = state.active;
    const target = wasDragging && !cancelled ? resolveDropTarget(head, event.clientX, event.clientY, state.path, state.isDirectory) : null;
    pointerDrag = null;
    clearPointerDragVisuals();
    if (!wasDragging) return; // A regular click remains a regular click.

    event.preventDefault();
    // Pointerup may be followed by a synthetic click on a drop row/header.
    // Consume that single click so dropping does not also open/toggle the target.
    suppressClickAfterDrag = true;
    window.setTimeout(() => { suppressClickAfterDrag = false; }, 0);
    if (cancelled || !target) return;
    if (!target.valid || !target.path) {
      if (target.insideProject) showToast(langText("Upuść plik lub folder na folder docelowy.", "Drop the item onto a destination folder."));
      return;
    }
    if (normalizedFsPath(state.path) === normalizedFsPath(target.path)) return;
    void performTreeMoveOrCopy(state.path, target.path, "cut", state.isDirectory).catch(error => showToast(`${langText("Nie udało się przenieść elementu", "Could not move item")}: ${String(error)}`));
  };

  files.addEventListener("pointerdown", event => {
    const e = event as PointerEvent;
    if (e.button !== 0 || e.isPrimary === false || !(e.pointerType === "mouse" || e.pointerType === "pen")) return;
    const row = (e.target as Element | null)?.closest<HTMLElement>("#projectFiles .tree-entry");
    if (!row || !row.dataset.filePath) return;
    pointerDrag = { pointerId: e.pointerId, path: row.dataset.filePath, isDirectory: row.dataset.entryType === "directory", row, startX: e.clientX, startY: e.clientY, active: false };
  }, true);

  document.addEventListener("pointermove", event => {
    const e = event as PointerEvent;
    const state = pointerDrag;
    if (!state || e.pointerId !== state.pointerId) return;
    if (!state.active) {
      const dx = e.clientX - state.startX, dy = e.clientY - state.startY;
      if (Math.hypot(dx, dy) < 6) return;
      state.active = true;
      state.row.classList.add("tree-dragging");
      document.body.classList.add("tree-pointer-dragging");
    }
    e.preventDefault();
    paintDropTarget(files, resolveDropTarget(head, e.clientX, e.clientY, state.path, state.isDirectory));
  }, true);

  document.addEventListener("pointerup", event => finishPointerDrag(event as PointerEvent), true);
  document.addEventListener("pointercancel", event => finishPointerDrag(event as PointerEvent, true), true);
  document.addEventListener("click", event => {
    if (suppressClickAfterDrag) {
      const clickedElement = event.target as Element | null;
      if (clickedElement?.closest("#projectFiles, .project-tree-head")) {
        suppressClickAfterDrag = false;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        return;
      }
    }
    const contextMenu = document.getElementById("treeContextMenu");
    if (contextMenu && !contextMenu.contains(event.target as Node)) contextMenu.hidden = true;
  }, true);
}

/** Ctrl+C / Ctrl+X / Ctrl+V / Delete on the focused tree row, and Escape closing the context menu. */
function installTreeKeyboardShortcuts(files: HTMLElement): void {
  files.addEventListener("keydown", event => {
    const e = event as KeyboardEvent; const row = (e.target as Element | null)?.closest<HTMLElement>(".tree-entry"); if (!row?.dataset.filePath) return;
    projectTreeState.keyboardActive = true; projectTreeState.lastTarget = { path: row.dataset.filePath, isDirectory: row.dataset.entryType === "directory", isRoot: false };
    const type = row.dataset.entryType; const path = row.dataset.filePath; const modifier = e.ctrlKey || e.metaKey;
    if (modifier && !e.altKey) {
      if (e.key.toLowerCase() === "c") { e.preventDefault(); setTreeClipboard(path, "copy", type === "directory"); return; }
      if (e.key.toLowerCase() === "x") { e.preventDefault(); setTreeClipboard(path, "cut", type === "directory"); return; }
      if (e.key.toLowerCase() === "v" && projectTreeState.clipboard) { e.preventDefault(); projectTreeState.contextTarget = { path, isDirectory: type === "directory", isRoot: false }; void handleTreeContextAction("paste"); return; }
    }
    if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); projectTreeState.contextTarget = { path, isDirectory: type === "directory", isRoot: false }; void handleTreeContextAction("rename"); return; }
    if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); projectTreeState.contextTarget = { path, isDirectory: type === "directory", isRoot: false }; void handleTreeContextAction("delete"); }
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { const menu = document.getElementById("treeContextMenu"); if (menu) menu.hidden = true; } });
}

/** Click and keyboard handling inside the open context menu (shortcuts, arrow navigation, Escape). */
function installTreeContextMenuInteractions(): void {
  const menu = treeContextMenuElement();
  menu.addEventListener("click", event => { const button = (event.target as Element).closest<HTMLButtonElement>("button[data-tree-context]"); if (button && !button.disabled) void handleTreeContextAction(button.dataset.treeContext || ""); });
  menu.addEventListener("keydown", event => {
    const e = event as KeyboardEvent;
    if (projectTreeState.contextTarget) {
      const shortcut = (e.ctrlKey || e.metaKey) && !e.altKey ? ({ c: "copy", x: "cut", v: "paste" } as Record<string, string>)[e.key.toLowerCase()] : undefined;
      if (shortcut && (shortcut === "paste" || !projectTreeState.contextTarget.isRoot)) { e.preventDefault(); e.stopPropagation(); void handleTreeContextAction(shortcut); return; }
      if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !projectTreeState.contextTarget.isRoot) { e.preventDefault(); e.stopPropagation(); void handleTreeContextAction("rename"); return; }
      if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey && !projectTreeState.contextTarget.isRoot) { e.preventDefault(); e.stopPropagation(); void handleTreeContextAction("delete"); return; }
    }
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button[data-tree-context]:not(:disabled)')); if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(current + 1 + items.length) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(current - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "Escape") {
      e.preventDefault(); menu.hidden = true;
      if (projectTreeState.contextTarget && !projectTreeState.contextTarget.isRoot) { const row = Array.from(document.querySelectorAll<HTMLElement>("#projectFiles .tree-entry")).find(el => normalizedFsPath(el.dataset.filePath || "") === normalizedFsPath(projectTreeState.contextTarget!.path)); row?.focus({ preventScroll: true }); }
    }
  });
}

/** Installs, once, every project-tree interaction. Registration order is behaviour (several listeners share `document`). */
export function installTreeDragDrop() {
  if (projectTreeState.dragDropInstalled) return;
  projectTreeState.dragDropInstalled = true;
  const files = $("projectFiles") as HTMLElement;
  const head = document.querySelector<HTMLElement>(".project-tree-head");
  installTreeContextMenuTriggers(files, head);
  installPointerDrag(files, head);
  installTreeKeyboardShortcuts(files);
  installTreeContextMenuInteractions();
}
