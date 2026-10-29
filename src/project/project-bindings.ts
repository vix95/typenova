/** Project open/add/close bindings and restoration of the folders open last time. */
import { $ } from "../app/dom";
import { isDetachedWindow } from "../app/detached-window";
import { rememberedProjectRoots, setProjectRoots } from "./project-roots";
import { projectTreeState } from "./project-tree-ops";
import { addProjectFolder, closeProject, openProject, renderProjectTree } from "./project-tree-view";

const rememberedRoots = rememberedProjectRoots();

export function initProjectBindings(): void {
  $("openProject").addEventListener("click", () => void openProject());
  $("openProjectPrompt").addEventListener("click", () => void openProject());
  $("addProjectFolder").addEventListener("click", () => void addProjectFolder());
  $("closeProject").addEventListener("click", () => void closeProject());
}

export function initProjectRestore(): void {
  // A torn-off document window shows only its document; it neither opens nor changes the saved folders.
  if (isDetachedWindow) return;
  if (rememberedRoots.length) {
    setProjectRoots(rememberedRoots);
    // Top-level folders of a multi-folder tree start expanded.
    if (rememberedRoots.length > 1) for (const folder of rememberedRoots) projectTreeState.expandedFolders.add(folder);
    void renderProjectTree();
  }
}
