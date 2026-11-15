/** Project open/add/close bindings and restoration of the folders open last time. */
import { $ } from "../app/dom";
import { langText } from "../i18n/language";
import { appConfirm } from "../ui/dialogs";
import { isDetachedWindow } from "../app/detached-window";
import { rememberedProjectRoots, setProjectRoots } from "./project-roots";
import { installExternalChanges } from "./external-changes";
import { projectTreeState } from "./project-tree-ops";
import { refreshProjectTree } from "./project-tree-sync";
import { collapseAllFolders, expandAllFolders } from "./project-tree-fold";
import { installRevealActiveDocument } from "./reveal-active-document";
import { addProjectFolder, closeProject, openProject, renderProjectTree } from "./project-tree-view";

async function confirmCloseProject(): Promise<void> {
  const ok = await appConfirm(langText("Zamknąć projekt? Drzewo plików zostanie wyczyszczone (pliki na dysku zostają).", "Close the project? The file tree is cleared (the files on disk stay)."), { confirmLabel: langText("Zamknij projekt", "Close project"), primaryAction: "cancel" });
  if (ok) await closeProject();
}

const rememberedRoots = rememberedProjectRoots();

export function initProjectBindings(): void {
  $("openProject").addEventListener("click", () => void openProject());
  $("openProjectPrompt").addEventListener("click", () => void openProject());
  $("addProjectFolder").addEventListener("click", () => void addProjectFolder());
  $("refreshProject").addEventListener("click", () => void refreshProjectTree());
  $("expandAllFolders").addEventListener("click", () => void expandAllFolders());
  $("collapseAllFolders").addEventListener("click", () => void collapseAllFolders());
  $("closeProject").addEventListener("click", () => void confirmCloseProject());
  installRevealActiveDocument();
  installExternalChanges();
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
