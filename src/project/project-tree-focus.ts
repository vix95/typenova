/** Keyboard target tracking for the project tree. */
import { $ } from "../app/dom";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { projectTreeState } from "./project-tree-ops";

const projectTreeFocusZone = $("projectTree") as HTMLElement;
function updateProjectTreeKeyboardTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  const inProjectTree = !!element?.closest("#projectTree");
  const inProjectHeading = !!element?.closest("#filesView .sidebar-section-heading");
  if (activeSidebarTab !== "files" || (!inProjectTree && !inProjectHeading)) { projectTreeState.keyboardActive = false; return; }
  projectTreeState.keyboardActive = true;
  const row = element?.closest<HTMLElement>("#projectFiles .tree-entry");
  if (row?.dataset.filePath) { projectTreeState.lastTarget = { path: row.dataset.filePath, isDirectory: row.dataset.entryType === "directory", isRoot: row.dataset.projectRoot === "true" }; return; }
  if (documentState.projectRoots.length === 1 && documentState.projectRoot) projectTreeState.lastTarget = { path: documentState.projectRoot, isDirectory: true, isRoot: true };
}
const filesProjectHeading = ($("filesView") as HTMLElement).querySelector<HTMLElement>(".sidebar-section-heading");

export function initProjectTreeFocus(): void {
  projectTreeFocusZone.setAttribute("tabindex", "-1");
  projectTreeFocusZone.addEventListener("pointerdown", event => { updateProjectTreeKeyboardTarget(event.target); const target = event.target instanceof Element ? event.target : null; if (activeSidebarTab === "files" && target?.closest("#projectTree") && !target.closest("button,input,a,[tabindex]:not(#projectTree)")) projectTreeFocusZone.focus({ preventScroll: true }); }, true);
  projectTreeFocusZone.addEventListener("focusin", event => updateProjectTreeKeyboardTarget(event.target), true);
  filesProjectHeading?.addEventListener("pointerdown", event => updateProjectTreeKeyboardTarget(event.target), true);
  document.addEventListener("pointerdown", event => { const target = event.target instanceof Element ? event.target : null; if (!target?.closest("#projectTree,#filesView .sidebar-section-heading,#treeContextMenu")) projectTreeState.keyboardActive = false; }, true);
}
