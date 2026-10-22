/** Project open/close bindings and restoration of the last project. */
import { $ } from "../app/dom";
import { activeSidebarTab } from "../app/sidebar";
import { documentState } from "../documents/document-state";
import { persistGraphFileSelection, renderGraphFilterTree, setGraphFilesPanelOpen } from "../graph-ui/filter-panel";
import { graphWorkspaceController, graphUi } from "../graph-ui/graph-state";
import { buildGraph } from "../graph-ui/indexing";
import { markTreeClipboardState, projectTreeController } from "./project-tree-ops";
import { openProject, renderProjectTree } from "./project-tree-view";

const rememberedProject = localStorage.getItem("typenova.projectRoot");

export function initProjectBindings(): void {
  $("openProject").addEventListener("click", () => void openProject());
  $("openProjectPrompt").addEventListener("click", () => void openProject());
  $("closeProject").addEventListener("click", () => { graphWorkspaceController.cancel(); documentState.projectRoot = null; projectTreeController.resetTransientState(); markTreeClipboardState(); graphUi.graphSections = []; graphUi.graphSectionGraphModel = null; graphUi.graphAvailableFiles = []; graphUi.graphSelectedFiles = null; graphUi.selectedGraphSection = null; ($("brainPreview") as HTMLElement).hidden = true; ($("brainPreviewResizer") as HTMLElement).hidden = true; $("brainView").classList.remove("has-preview"); setGraphFilesPanelOpen(false, false); renderGraphFilterTree(); persistGraphFileSelection(); localStorage.removeItem("typenova.projectRoot"); void renderProjectTree(); if (activeSidebarTab === "brain") void buildGraph(); });
}

export function initProjectRestore(): void {
  if (rememberedProject) { documentState.projectRoot = rememberedProject; void renderProjectTree(); }
}
