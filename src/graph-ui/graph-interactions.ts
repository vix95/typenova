/** Pointer and keyboard wiring for the Tree viewport, the Tree minimap, graph search and workspace buttons. */
import { $ } from "../app/dom";
import { previousSidebarTab, setSidebarTab } from "../app/sidebar";
import { closeGraphPreview } from "./filter-panel";
import { renderGraph } from "./graph-renderer";
import { graphUi } from "./graph-state";
import { buildGraph } from "./indexing";
import { applyGraphPreviewHeight, applyGraphPreviewWidth, syncGraphPreviewResizer } from "./preview-resizer";
import { updateGraphRelatedPanel } from "./related-panel";
import { openGraphSection } from "./selection";
import { GRAPH_TREE_ZOOM_STEP, applyGraphTreeLayerTransform, graphTreeMinimapModel, graphTreeZoom, centerGraphTreeOnMinimapPoint, changeGraphTreeZoom, setGraphTreeViewportCenter } from "./tree-navigation";
import { setGraphVisualMode, syncGraphVisualModeUI } from "./visual-mode";
import { langText } from "../i18n/language";
import { openProject } from "../project/project-tree-view";

const graphTreeViewport = $("brainTree") as HTMLElement;
let graphTreePanPointerId: number | null = null;
let graphTreePanStartX = 0, graphTreePanStartY = 0, graphTreePanStartOffsetX = 0, graphTreePanStartOffsetY = 0, graphTreePanMoved = false;
const finishGraphTreePan = (event: PointerEvent) => {
  if (graphTreePanPointerId !== event.pointerId) return;
  graphTreePanPointerId = null;
  graphTreeViewport.classList.remove("is-panning");
  if (graphTreeViewport.hasPointerCapture(event.pointerId)) graphTreeViewport.releasePointerCapture(event.pointerId);
};
const graphTreeMinimap = $("brainTreeMinimap") as HTMLElement;
const finishGraphTreeMinimapPan = (event: PointerEvent) => {
  if (graphUi.graphTreeMinimapPointerId !== event.pointerId) return;
  graphUi.graphTreeMinimapPointerId = null;
  if (graphTreeMinimap.hasPointerCapture(event.pointerId)) graphTreeMinimap.releasePointerCapture(event.pointerId);
};
let graphFilterTimer: number | undefined;
const graphSearchInput = $("brainFilter") as HTMLInputElement;
const graphSearchClear = $("brainFilterClear") as HTMLButtonElement | null;
export function syncGraphSearchClear() { if (graphSearchClear) { const label = graphUi.graphVisualMode === "tree" ? langText("Wyczyść wyszukiwanie drzewa", "Clear tree search") : langText("Wyczyść wyszukiwanie grafu", "Clear graph search"); graphSearchClear.hidden = !graphSearchInput.value; graphSearchClear.setAttribute("aria-label", label); graphSearchClear.dataset.tooltip = label; } }
function applyGraphSearchFilter() { window.clearTimeout(graphFilterTimer); graphFilterTimer = window.setTimeout(() => { graphUi.graphZoom = 1; graphUi.graphPanX = 28; graphUi.graphPanY = 24; graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false; renderGraph(); }, 90); }

export function initGraphInteractions(): void {
  $("brainOpenSection").addEventListener("click", () => { if (graphUi.selectedGraphSection) void openGraphSection(graphUi.selectedGraphSection); });
  $("brainClosePreview").addEventListener("click", () => closeGraphPreview(true));
  $("brainExit").addEventListener("click", () => setSidebarTab(previousSidebarTab));
  $("brainCloseRelatedButton").addEventListener("click", () => { graphUi.graphRelatedPanelDismissed = true; updateGraphRelatedPanel(graphUi.selectedGraphSection); });
  $("brainGraphModeButton").addEventListener("click", () => setGraphVisualMode("graph"));
  $("brainTreeModeButton").addEventListener("click", () => setGraphVisualMode("tree"));
  $("brainTreeZoomOut").addEventListener("click", () => changeGraphTreeZoom(1 / GRAPH_TREE_ZOOM_STEP));
  $("brainTreeZoomIn").addEventListener("click", () => changeGraphTreeZoom(GRAPH_TREE_ZOOM_STEP));
  graphTreeViewport.addEventListener("wheel", event => {
    if (graphUi.graphVisualMode !== "tree" || !graphTreeViewport.querySelector(".brain-tree-canvas") || event.deltaY === 0) return;
    event.preventDefault();
    let deltaY = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaY *= 40;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) deltaY *= Math.max(graphTreeViewport.clientHeight, 100);
    deltaY = Math.max(-300, Math.min(300, deltaY));
    changeGraphTreeZoom(Math.pow(GRAPH_TREE_ZOOM_STEP, -deltaY / 100), event.clientX, event.clientY, false);
  }, { passive: false });
  graphTreeViewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !graphTreeViewport.querySelector(".brain-tree-canvas")) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".brain-tree-node, button, a, input, select, textarea, [contenteditable='true']")) return;
    graphTreePanPointerId = event.pointerId;
    graphTreePanStartX = event.clientX; graphTreePanStartY = event.clientY;
    graphTreePanStartOffsetX = graphUi.graphTreePanX; graphTreePanStartOffsetY = graphUi.graphTreePanY; graphTreePanMoved = false;
    event.preventDefault();
    try { graphTreeViewport.setPointerCapture(event.pointerId); } catch { }
  });
  graphTreeViewport.addEventListener("pointermove", event => {
    if (graphTreePanPointerId !== event.pointerId) return;
    const deltaX = event.clientX - graphTreePanStartX, deltaY = event.clientY - graphTreePanStartY;
    if (!graphTreePanMoved && Math.hypot(deltaX, deltaY) < 3) return;
    graphTreePanMoved = true; graphTreeViewport.classList.add("is-panning");
    graphUi.graphTreePanX = graphTreePanStartOffsetX + deltaX; graphUi.graphTreePanY = graphTreePanStartOffsetY + deltaY;
    applyGraphTreeLayerTransform();
  });
  graphTreeViewport.addEventListener("pointerup", finishGraphTreePan);
  graphTreeViewport.addEventListener("pointercancel", finishGraphTreePan);
  graphTreeViewport.addEventListener("lostpointercapture", finishGraphTreePan);
  graphTreeMinimap.addEventListener("pointerdown", event => {
    const pointerTarget = event.target instanceof Element ? event.target : null;
    if (graphUi.graphVisualMode !== "tree" || !graphTreeMinimapModel || (event as PointerEvent).button !== 0 || !pointerTarget?.closest("#brainTreeMinimapPlot")) return;
    const pointerEvent = event as PointerEvent;
    graphUi.graphTreeMinimapPointerId = pointerEvent.pointerId;
    pointerEvent.preventDefault();
    try { graphTreeMinimap.setPointerCapture(pointerEvent.pointerId); } catch { }
    centerGraphTreeOnMinimapPoint(pointerEvent.clientX, pointerEvent.clientY);
  });
  graphTreeMinimap.addEventListener("pointermove", event => {
    if (graphUi.graphTreeMinimapPointerId !== (event as PointerEvent).pointerId) return;
    centerGraphTreeOnMinimapPoint((event as PointerEvent).clientX, (event as PointerEvent).clientY);
  });
  graphTreeMinimap.addEventListener("pointerup", finishGraphTreeMinimapPan);
  graphTreeMinimap.addEventListener("pointercancel", finishGraphTreeMinimapPan);
  graphTreeMinimap.addEventListener("lostpointercapture", finishGraphTreeMinimapPan);
  graphTreeMinimap.addEventListener("keydown", event => {
    const keyEvent = event as KeyboardEvent;
    if (!graphTreeMinimapModel || !(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(keyEvent.key))) return;
    const tree = $("brainTree") as HTMLElement;
    if (keyEvent.key === "Home") setGraphTreeViewportCenter(graphTreeMinimapModel.width / 2, graphTreeMinimapModel.height / 2);
    else {
      const currentX = (-graphUi.graphTreePanX + tree.clientWidth / 2) / graphTreeZoom;
      const currentY = (-graphUi.graphTreePanY + tree.clientHeight / 2) / graphTreeZoom;
      const dx = Math.max(tree.clientWidth / graphTreeZoom * .6, graphTreeMinimapModel.width * .035);
      const dy = Math.max(tree.clientHeight / graphTreeZoom * .6, graphTreeMinimapModel.height * .035);
      setGraphTreeViewportCenter(currentX + (keyEvent.key === "ArrowRight" ? dx : keyEvent.key === "ArrowLeft" ? -dx : 0), currentY + (keyEvent.key === "ArrowDown" ? dy : keyEvent.key === "ArrowUp" ? -dy : 0));
    }
    keyEvent.preventDefault();
  });
  syncGraphVisualModeUI();
  $("brainRefresh").addEventListener("click", () => void buildGraph());
  $("brainScopeButton").addEventListener("click", () => void openProject());
  $("brainSearchForm").addEventListener("submit", (event: SubmitEvent) => { event.preventDefault(); graphSearchInput.blur(); });
  graphSearchInput.addEventListener("input", () => { syncGraphSearchClear(); applyGraphSearchFilter(); });
  graphSearchClear?.addEventListener("click", () => { graphSearchInput.value = ""; syncGraphSearchClear(); applyGraphSearchFilter(); graphSearchInput.focus({ preventScroll: true }); });
  syncGraphSearchClear();
  document.addEventListener("keydown", e => { if (e.key !== "Escape" || !document.body.classList.contains("graph-mode") || document.querySelector("dialog[open]")) return; const input = $("brainFilter") as HTMLInputElement; if (document.activeElement === input && input.value) { input.value = ""; syncGraphSearchClear(); window.clearTimeout(graphFilterTimer); graphUi.graphZoom = 1; graphUi.graphPanX = 28; graphUi.graphPanY = 24; graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false; renderGraph(); e.preventDefault(); return; } setSidebarTab(previousSidebarTab); });
  window.addEventListener("resize", () => { applyGraphPreviewWidth(); applyGraphPreviewHeight(); syncGraphPreviewResizer(); if (document.body.classList.contains("graph-mode") && graphUi.graphSections.length) { graphUi.graphAutoFitNextRender = true; graphUi.graphAnimateNextRender = false; requestAnimationFrame(() => renderGraph()); } });
}
