/** Sidebar tab state (Files / Outline / Graph), sidebar visibility and its button bindings. */
import { $ } from "./dom";
import { documentState } from "../documents/document-state";
import { view } from "../editor/editor-view";
import { renderGraph } from "../graph-ui/graph-renderer";
import { graphUi } from "../graph-ui/graph-state";
import { buildGraph } from "../graph-ui/indexing";
import { restoreGraphPreviewRenderer } from "../graph-ui/preview-host";
import { selectGraphSection } from "../graph-ui/selection";
import { updateGraphWorkspaceTop } from "../graph-ui/workspace-layout";
import { applyWidths } from "../layout/layout";
import { outlineState, renderOutlineWindow } from "../outline/outline";

type SidebarTab = "files" | "outline" | "brain";
export let activeSidebarTab: SidebarTab = "files";
export let previousSidebarTab: "files" | "outline" = "files";
export function setSidebarTab(tab: SidebarTab) {
  if (tab !== "brain") restoreGraphPreviewRenderer();
  if (tab !== "brain" && graphUi.graphAmbientMotionStop) { graphUi.graphAmbientMotionStop(); graphUi.graphAmbientMotionStop = null; }
  if (tab === "brain" && activeSidebarTab !== "brain") { previousSidebarTab = activeSidebarTab === "outline" ? "outline" : "files"; graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = true; }
  activeSidebarTab = tab;
  for (const [id, key] of [["sidebarFilesTab", "files"], ["sidebarOutlineTab", "outline"], ["sidebarBrainTab", "brain"]] as const) { $(id).classList.toggle("active", tab === key); $(id).setAttribute("aria-selected", String(tab === key)); }
  $("filesView").hidden = tab !== "files"; $("outlineView").hidden = tab !== "outline"; $("brainView").hidden = tab !== "brain";
  const graphOpen = tab === "brain";
  document.body.classList.toggle("graph-mode", graphOpen);
  if (graphOpen) $("layout").setAttribute("aria-hidden", "true"); else $("layout").removeAttribute("aria-hidden");
  $("toggleOutline").classList.toggle("selected", outlineState.outlineVisible && tab === "outline");
  updateGraphWorkspaceTop();
  if (tab === "outline") renderOutlineWindow(true);
  if (tab === "brain" && documentState.projectRoot && !graphUi.graphSections.length) void buildGraph();
  if (tab === "brain") requestAnimationFrame(() => {
    if ($("brainView").hidden) return;
    // Moving to the editor restores #preview to its normal parent. Re-mount the
    // last graph section preview when the user returns to the graph workspace.
    const restoredSection = graphUi.selectedGraphSection ? graphUi.graphSections.find(item => item.id === graphUi.selectedGraphSection!.id) : undefined;
    if (restoredSection) selectGraphSection(restoredSection);
    else if (graphUi.graphSections.length) renderGraph();
    ($("brainFilter") as HTMLInputElement).focus({ preventScroll: true });
  });
}
export function showSidebar() {
  outlineState.outlineVisible = true;
  $("sidebarExpandButton").hidden = true;
  $("outlinePane").classList.remove("hidden");
  $("layout").classList.remove("outline-hidden");
  $("toggleOutline").classList.toggle("selected", activeSidebarTab === "outline");
  applyWidths(); view.requestMeasure();
}

export function initSidebarBindings(): void {
  $("sidebarFilesTab").addEventListener("click", () => { if (!outlineState.outlineVisible) showSidebar(); setSidebarTab("files"); });
  $("sidebarOutlineTab").addEventListener("click", () => { if (!outlineState.outlineVisible) showSidebar(); setSidebarTab("outline"); });
  $("sidebarBrainTab").addEventListener("click", () => { if (!outlineState.outlineVisible) showSidebar(); setSidebarTab("brain"); });
  $("sidebarCollapse").addEventListener("click", () => { outlineState.outlineVisible = false; $("outlinePane").classList.add("hidden"); $("layout").classList.add("outline-hidden"); $("toggleOutline").classList.remove("selected"); $("sidebarExpandButton").hidden = false; applyWidths(); view.requestMeasure(); });
  $("sidebarExpandButton").addEventListener("click", () => { showSidebar(); setSidebarTab(activeSidebarTab); $("sidebarExpandButton").hidden = true; });
}
